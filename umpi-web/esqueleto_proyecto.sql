


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."archive_conversation"("conv_id" "uuid", "user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE conversations
  SET archived_by = array_append(COALESCE(archived_by, '{}'), user_id)
  WHERE id = conv_id
    AND (user1_id = user_id OR user2_id = user_id);
END;
$$;


ALTER FUNCTION "public"."archive_conversation"("conv_id" "uuid", "user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_conversation_with_message"("p_listing_id" "uuid", "p_user1_id" "uuid", "p_user2_id" "uuid", "p_content" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_conversation_id uuid;
  v_listing_exists boolean;
BEGIN
  -- Verificar que el usuario autenticado sea uno de los participantes
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF auth.uid() != p_user1_id AND auth.uid() != p_user2_id THEN
    RAISE EXCEPTION 'No sos parte de esta conversación';
  END IF;

  -- Verificar que el listing existe (opcional, pero evita conversaciones a listings inexistentes)
  SELECT EXISTS(SELECT 1 FROM public.listings WHERE id = p_listing_id)
  INTO v_listing_exists;

  IF NOT v_listing_exists THEN
    RAISE EXCEPTION 'El aviso no existe';
  END IF;

  -- Insertar conversación
  INSERT INTO public.conversations (listing_id, user1_id, user2_id)
  VALUES (p_listing_id, p_user1_id, p_user2_id)
  RETURNING id INTO v_conversation_id;

  -- Insertar mensaje (usando el ID de la conversación recién creada)
  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (v_conversation_id, auth.uid(), p_content);

  -- Actualizar last_message_at
  UPDATE public.conversations
  SET last_message_at = now()
  WHERE id = v_conversation_id;

  -- Devolver el ID de la conversación
  RETURN jsonb_build_object('conversation_id', v_conversation_id);
END;
$$;


ALTER FUNCTION "public"."create_conversation_with_message"("p_listing_id" "uuid", "p_user1_id" "uuid", "p_user2_id" "uuid", "p_content" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_featured_listings"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE listings
  SET is_featured = false,
      listing_priority = 0,
      featured_until = NULL
  WHERE is_featured = true
    AND featured_until IS NOT NULL
    AND featured_until < NOW();
  -- Return number of affected rows for logging if needed
  RAISE NOTICE 'Expired % featured listings', ROW_COUNT;
END;
$$;


ALTER FUNCTION "public"."expire_featured_listings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_subscriptions"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  sub RECORD;
BEGIN
  FOR sub IN
    SELECT id, user_id FROM subscriptions
    WHERE status = 'active' AND expires_at < NOW()
  LOOP
    UPDATE subscriptions SET status = 'expired' WHERE id = sub.id;
    UPDATE profiles SET subscription_type = 'none' WHERE id = sub.user_id;
    UPDATE listings SET is_featured = false, listing_priority = 0 WHERE user_id = sub.user_id;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."expire_subscriptions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."feature_listing"("p_listing_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ DECLARE v_uid uuid := auth.uid(); v_listing record; r record; v_new_featured_until timestamptz; v_featured_used int; BEGIN IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF; SELECT id INTO v_listing FROM listings WHERE id = p_listing_id AND user_id = v_uid; IF v_listing IS NULL THEN RAISE EXCEPTION 'No sos el dueño de este aviso'; END IF; SELECT s.id AS sub_id, s.featured_used, s.period_start, sp.listing_priority, sp.max_featured, sp.featured_duration_days INTO r FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id WHERE s.user_id = v_uid AND s.status = 'active'; IF r IS NULL THEN RAISE EXCEPTION 'No tenés un plan activo'; END IF; v_featured_used := r.featured_used; IF r.period_start + (r.featured_duration_days || ' days')::interval < now() THEN v_featured_used := 0; UPDATE subscriptions SET featured_used = 0, period_start = now() WHERE id = r.sub_id; END IF; IF v_featured_used >= r.max_featured THEN RAISE EXCEPTION 'Llegaste al límite de avisos destacados de este período (máximo %)', r.max_featured; END IF; UPDATE subscriptions SET featured_used = featured_used + 1 WHERE id = r.sub_id; v_new_featured_until := now() + (r.featured_duration_days || ' days')::interval; PERFORM set_config('app.allow_featured_write', 'true', true); UPDATE listings SET is_featured = true, listing_priority = r.listing_priority, featured_until = v_new_featured_until WHERE id = p_listing_id; RETURN jsonb_build_object('ok', true, 'listing_priority', r.listing_priority, 'featured_until', v_new_featured_until, 'featured_used', v_featured_used + 1, 'max_featured', r.max_featured); END; $$;


ALTER FUNCTION "public"."feature_listing"("p_listing_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_check_subscription_expiry"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- Insert notification for subscriptions expiring in 3 days
  INSERT INTO notifications (user_id, type, title, body, data)
  SELECT
    s.user_id,
    'subscription_expiring',
    'Suscripción por vencer',
    'Tu suscripción ' || COALESCE(sp.name, '') || ' vence el ' ||
      TO_CHAR(s.expires_at::date, 'DD/MM/YYYY'),
    jsonb_build_object(
      'subscription_id', s.id,
      'expires_at', s.expires_at
    )
  FROM subscriptions s
  LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
  WHERE s.status = 'active'
    AND s.expires_at IS NOT NULL
    AND s.expires_at::date = (CURRENT_DATE + INTERVAL '3 days')::date
    -- Avoid duplicate notifications
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = s.user_id
        AND n.type = 'subscription_expiring'
        AND (n.data->>'subscription_id')::uuid = s.id
        AND n.created_at::date = CURRENT_DATE
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."fn_check_subscription_expiry"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_create_message_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_receiver_id uuid;
  v_sender_name text;
  v_existing_id uuid;
BEGIN
  -- No te notifiques a vos mismo
  IF NEW.sender_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Encontrar al receptor
  SELECT CASE WHEN user1_id = NEW.sender_id THEN user2_id ELSE user1_id END
  INTO v_receiver_id
  FROM public.conversations
  WHERE id = NEW.conversation_id;

  IF v_receiver_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Nombre del que envía (profiles only has full_name, not display_name)
  SELECT COALESCE(NULLIF(full_name, ''), 'Usuario')
  INTO v_sender_name
  FROM public.profiles
  WHERE id = NEW.sender_id;

  -- Si ya hay una notificación NO LEÍDA para esta conversación, actualizarla
  SELECT id INTO v_existing_id
  FROM public.notifications
  WHERE user_id = v_receiver_id
    AND type = 'message'
    AND is_read = false
    AND data->>'conversation_id' = NEW.conversation_id::text;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.notifications
    SET body = v_sender_name || ': ' || LEFT(NEW.content, 150),
        created_at = now()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_receiver_id,
      'message',
      'Nuevo mensaje',
      v_sender_name || ': ' || LEFT(NEW.content, 150),
      jsonb_build_object('conversation_id', NEW.conversation_id)
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_create_message_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_create_review_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_listing_id uuid;
  v_listing_title text;
  v_owner_id uuid;
  v_reviewer_name text;
BEGIN
  -- Get listing info from the conversation
  SELECT c.listing_id, l.title, l.user_id
  INTO v_listing_id, v_listing_title, v_owner_id
  FROM public.conversations c
  JOIN public.listings l ON l.id = c.listing_id
  WHERE c.id = NEW.conversation_id;

  -- Get reviewer name (profiles only has full_name, not display_name)
  SELECT COALESCE(NULLIF(full_name, ''), 'Usuario')
  INTO v_reviewer_name
  FROM public.profiles
  WHERE id = NEW.reviewer_id;

  -- Don't notify yourself
  IF v_owner_id = NEW.reviewer_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_owner_id,
    'review',
    'Nueva calificación',
    v_reviewer_name || ' te calificó con ' || NEW.rating || ' estrellas',
    jsonb_build_object(
      'listing_id', v_listing_id,
      'listing_title', v_listing_title,
      'review_id', NEW.id,
      'rating', NEW.rating
    )
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_create_review_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_fill_review_listing_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  SELECT listing_id INTO NEW.listing_id
  FROM conversations
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_fill_review_listing_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_mark_message_notification_read"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  -- Se actualizó user1_last_read_at?
  IF NEW.user1_last_read_at IS DISTINCT FROM OLD.user1_last_read_at THEN
    UPDATE public.notifications
    SET is_read = true
    WHERE user_id = NEW.user1_id
      AND type = 'message'
      AND is_read = false
      AND data->>'conversation_id' = NEW.id::text;
  END IF;

  -- Se actualizó user2_last_read_at?
  IF NEW.user2_last_read_at IS DISTINCT FROM OLD.user2_last_read_at THEN
    UPDATE public.notifications
    SET is_read = true
    WHERE user_id = NEW.user2_id
      AND type = 'message'
      AND is_read = false
      AND data->>'conversation_id' = NEW.id::text;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_mark_message_notification_read"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_recalculate_ratings"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_old_seller_id uuid;
  v_new_seller_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.conversation_id IS DISTINCT FROM NEW.conversation_id THEN
    SELECT l.user_id INTO v_old_seller_id
    FROM conversations c
    JOIN listings l ON l.id = c.listing_id
    WHERE c.id = OLD.conversation_id;

    IF v_old_seller_id IS NOT NULL THEN
      UPDATE listings
      SET
        rating = COALESCE(
          (SELECT ROUND(AVG(r.rating), 1) FROM reviews r
           JOIN conversations c ON c.id = r.conversation_id
           WHERE c.listing_id = listings.id),
          listings.rating
        ),
        reviews_count = (
          SELECT COUNT(*) FROM reviews r
          JOIN conversations c ON c.id = r.conversation_id
          WHERE c.listing_id = listings.id
        )
      WHERE user_id = v_old_seller_id;

      UPDATE profiles
      SET
        rating = COALESCE(
          (SELECT ROUND(AVG(r.rating), 1) FROM reviews r
           JOIN conversations c ON c.id = r.conversation_id
           JOIN listings l ON l.id = c.listing_id
           WHERE l.user_id = v_old_seller_id),
          5.0
        ),
        reviews_count = (
          SELECT COUNT(*) FROM reviews r
          JOIN conversations c ON c.id = r.conversation_id
          JOIN listings l ON l.id = c.listing_id
          WHERE l.user_id = v_old_seller_id
        )
      WHERE id = v_old_seller_id;
    END IF;

    SELECT l.user_id INTO v_new_seller_id
    FROM conversations c
    JOIN listings l ON l.id = c.listing_id
    WHERE c.id = NEW.conversation_id;

    IF v_new_seller_id IS NOT NULL AND (v_new_seller_id IS DISTINCT FROM v_old_seller_id) THEN
      UPDATE listings
      SET
        rating = COALESCE(
          (SELECT ROUND(AVG(r.rating), 1) FROM reviews r
           JOIN conversations c ON c.id = r.conversation_id
           WHERE c.listing_id = listings.id),
          listings.rating
        ),
        reviews_count = (
          SELECT COUNT(*) FROM reviews r
          JOIN conversations c ON c.id = r.conversation_id
          WHERE c.listing_id = listings.id
        )
      WHERE user_id = v_new_seller_id;

      UPDATE profiles
      SET
        rating = COALESCE(
          (SELECT ROUND(AVG(r.rating), 1) FROM reviews r
           JOIN conversations c ON c.id = r.conversation_id
           JOIN listings l ON l.id = c.listing_id
           WHERE l.user_id = v_new_seller_id),
          5.0
        ),
        reviews_count = (
          SELECT COUNT(*) FROM reviews r
          JOIN conversations c ON c.id = r.conversation_id
          JOIN listings l ON l.id = c.listing_id
          WHERE l.user_id = v_new_seller_id
        )
      WHERE id = v_new_seller_id;
    END IF;

    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT l.user_id INTO v_new_seller_id
  FROM conversations c
  JOIN listings l ON l.id = c.listing_id
  WHERE c.id = COALESCE(NEW.conversation_id, OLD.conversation_id);

  IF v_new_seller_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE listings
  SET
    rating = COALESCE(
      (SELECT ROUND(AVG(r.rating), 1) FROM reviews r
       JOIN conversations c ON c.id = r.conversation_id
       WHERE c.listing_id = listings.id),
      listings.rating
    ),
    reviews_count = (
      SELECT COUNT(*) FROM reviews r
      JOIN conversations c ON c.id = r.conversation_id
      WHERE c.listing_id = listings.id
    )
  WHERE user_id = v_new_seller_id;

  UPDATE profiles
  SET
    rating = COALESCE(
      (SELECT ROUND(AVG(r.rating), 1) FROM reviews r
       JOIN conversations c ON c.id = r.conversation_id
       JOIN listings l ON l.id = c.listing_id
       WHERE l.user_id = v_new_seller_id),
      5.0
    ),
    reviews_count = (
      SELECT COUNT(*) FROM reviews r
      JOIN conversations c ON c.id = r.conversation_id
      JOIN listings l ON l.id = c.listing_id
      WHERE l.user_id = v_new_seller_id
    )
  WHERE id = v_new_seller_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."fn_recalculate_ratings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_total_unread_count"("p_user_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  total bigint;
BEGIN
  SELECT COALESCE(SUM(cnt), 0) INTO total
  FROM (
    SELECT COUNT(*) AS cnt
    FROM conversations c
    JOIN messages m ON m.conversation_id = c.id
    WHERE m.sender_id != p_user_id
      AND NOT (c.archived_by @> ARRAY[p_user_id])
      AND (
        (c.user1_id = p_user_id AND m.created_at > COALESCE(c.user1_last_read_at, '1970-01-01'::timestamptz))
        OR
        (c.user2_id = p_user_id AND m.created_at > COALESCE(c.user2_last_read_at, '1970-01-01'::timestamptz))
      )
    GROUP BY c.id
  ) sub;

  RETURN total;
END;
$$;


ALTER FUNCTION "public"."get_total_unread_count"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_conversation_read"("conv_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE conversations
  SET
    user1_last_read_at = CASE WHEN user1_id = p_user_id THEN now() ELSE user1_last_read_at END,
    user2_last_read_at = CASE WHEN user2_id = p_user_id THEN now() ELSE user2_last_read_at END
  WHERE id = conv_id AND (user1_id = p_user_id OR user2_id = p_user_id);
END;
$$;


ALTER FUNCTION "public"."mark_conversation_read"("conv_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_direct_featured_write"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF current_setting('app.allow_featured_write', true) = 'true' THEN
      -- Bypass: the RPC opted in via SET LOCAL
      RETURN NEW;
    END IF;

    IF NEW.is_featured IS DISTINCT FROM OLD.is_featured
       OR NEW.listing_priority IS DISTINCT FROM OLD.listing_priority
       OR NEW.featured_until IS DISTINCT FROM OLD.featured_until
    THEN
      RAISE EXCEPTION 'Only system processes can modify featured status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_direct_featured_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_listings"("p_query" "text", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_price_min" numeric DEFAULT NULL::numeric, "p_price_max" numeric DEFAULT NULL::numeric, "p_location" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 24, "p_offset" integer DEFAULT 0) RETURNS SETOF "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  WITH ranked AS (
    SELECT
      l.id, l.title, l.description, l.price, l.images, l.location,
      l.category_id, l.user_id, l.status, l.is_featured,
      l.listing_priority, l.created_at, l.price_type, l.rating,
      l.reviews_count, l.city_id,
      jsonb_build_object(
        'id', c.id, 'name', c.name, 'slug', c.slug,
        'icon', c.icon, 'image_url', c.image_url,
        'is_active', c.is_active, 'created_at', c.created_at
      ) AS category,
      CASE
        WHEN p_query IS NOT NULL AND p_query != ''
        THEN ts_rank(l.search_vector, plainto_tsquery('spanish', p_query))
        ELSE 0
      END AS rank
    FROM listings l
    LEFT JOIN categories c ON c.id = l.category_id
    WHERE l.status = 'active'
      AND (
        p_query IS NULL OR p_query = ''
        -- FTS: full token match with stemming ("nueva" → matches "nuevo")
        OR l.search_vector @@ plainto_tsquery('spanish', p_query)
        -- ILIKE: partial/prefix match ("lap" → matches "Laptop")
        OR l.title ILIKE '%' || p_query || '%'
        OR l.description ILIKE '%' || p_query || '%'
      )
      AND (p_category_id IS NULL OR l.category_id = p_category_id)
      AND (p_price_min IS NULL OR l.price >= p_price_min)
      AND (p_price_max IS NULL OR l.price <= p_price_max)
      AND (p_location IS NULL OR l.location ILIKE '%' || p_location || '%')
  )
  SELECT to_jsonb(r.*) - 'rank' FROM ranked r
  ORDER BY rank DESC, listing_priority DESC, created_at DESC, id DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;


ALTER FUNCTION "public"."search_listings"("p_query" "text", "p_category_id" "uuid", "p_price_min" numeric, "p_price_max" numeric, "p_location" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_message_notifications"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  -- Remove stale UNREAD message notifications only (keep read ones for history)
  DELETE FROM public.notifications
  WHERE user_id = p_user_id AND type = 'message' AND is_read = false;

  -- Insert one notification per conversation with unread messages
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    p_user_id,
    'message',
    'Nuevo mensaje',
    COALESCE(p.full_name, 'Usuario') || ': ' || latest.content,
    jsonb_build_object(
      'conversation_id', c.id,
      'unread_count', sub.unread_count
    )
  FROM (
    SELECT c.id, COUNT(*) AS unread_count
    FROM public.conversations c
    JOIN public.messages m ON m.conversation_id = c.id
    WHERE m.sender_id != p_user_id
      AND NOT (c.archived_by @> ARRAY[p_user_id])
      AND (
        (c.user1_id = p_user_id
          AND m.created_at > COALESCE(c.user1_last_read_at, '1970-01-01'::timestamptz))
        OR
        (c.user2_id = p_user_id
          AND m.created_at > COALESCE(c.user2_last_read_at, '1970-01-01'::timestamptz))
      )
    GROUP BY c.id
  ) sub
  JOIN public.conversations c ON c.id = sub.id
  -- Latest message for preview
  LEFT JOIN LATERAL (
    SELECT content, sender_id FROM public.messages
    WHERE conversation_id = c.id
    ORDER BY created_at DESC LIMIT 1
  ) latest ON true
  -- Sender name
  LEFT JOIN public.profiles p ON p.id = latest.sender_id
  -- Avoid duplicate unread notification for the same conversation
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id
      AND n.type = 'message'
      AND n.is_read = false
      AND n.data->>'conversation_id' = c.id::text
  );
END;
$$;


ALTER FUNCTION "public"."sync_message_notifications"("p_user_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "icon" "text" NOT NULL,
    "image_url" "text",
    "total_count" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL
);


ALTER TABLE "public"."cities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid",
    "user1_id" "uuid" NOT NULL,
    "user2_id" "uuid" NOT NULL,
    "last_message_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "archived_by" "uuid"[] DEFAULT '{}'::"uuid"[],
    "user1_last_read_at" timestamp with time zone DEFAULT "now"(),
    "user2_last_read_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."listings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "category_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "price" numeric(12,2),
    "price_type" "text" DEFAULT 'fixed'::"text",
    "location" "text",
    "images" "jsonb" DEFAULT '[]'::"jsonb",
    "is_featured" boolean DEFAULT false,
    "listing_priority" integer DEFAULT 0,
    "status" "text" DEFAULT 'active'::"text",
    "rating" numeric(2,1),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "reviews_count" integer DEFAULT 0,
    "featured_until" timestamp with time zone,
    "city_id" "uuid",
    "search_vector" "tsvector" GENERATED ALWAYS AS (("setweight"("to_tsvector"('"spanish"'::"regconfig", COALESCE("title", ''::"text")), 'A'::"char") || "setweight"("to_tsvector"('"spanish"'::"regconfig", COALESCE("description", ''::"text")), 'B'::"char"))) STORED,
    "condition" "text",
    CONSTRAINT "listings_condition_check" CHECK (("condition" = ANY (ARRAY['new'::"text", 'used'::"text"])))
);


ALTER TABLE "public"."listings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['review'::"text", 'subscription_expiring'::"text", 'message'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "phone" "text",
    "rating" numeric(2,1) DEFAULT 5.0,
    "total_sales" integer DEFAULT 0,
    "total_listings" integer DEFAULT 0,
    "subscription_type" "text" DEFAULT 'none'::"text",
    "subscription_expires_at" timestamp with time zone,
    "location" "text",
    "is_admin" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "reviews_count" integer DEFAULT 0
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rate_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "function_name" "text" NOT NULL,
    "window_start" timestamp with time zone DEFAULT "now"() NOT NULL,
    "request_count" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "reviewer_id" "uuid" NOT NULL,
    "rating" smallint NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "listing_id" "uuid" NOT NULL,
    CONSTRAINT "reviews_comment_check" CHECK (("char_length"("comment") <= 500)),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "price" numeric(12,2) NOT NULL,
    "currency" "text" DEFAULT 'ARS'::"text",
    "features" "jsonb" DEFAULT '[]'::"jsonb",
    "listing_priority" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "max_images" integer DEFAULT 2 NOT NULL,
    "max_featured" integer DEFAULT 0 NOT NULL,
    "featured_duration_days" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."subscription_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "plan_id" "uuid",
    "status" "text" DEFAULT 'active'::"text",
    "started_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "mp_preapproval_id" "text",
    "external_reference" "text",
    "featured_used" integer DEFAULT 0,
    "period_start" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."listings"
    ADD CONSTRAINT "listings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rate_limits"
    ADD CONSTRAINT "rate_limits_user_id_function_name_window_start_key" UNIQUE ("user_id", "function_name", "window_start");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_conversation_id_reviewer_id_key" UNIQUE ("conversation_id", "reviewer_id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_conversations_listing" ON "public"."conversations" USING "btree" ("listing_id");



CREATE INDEX "idx_conversations_user1" ON "public"."conversations" USING "btree" ("user1_id");



CREATE INDEX "idx_conversations_user2" ON "public"."conversations" USING "btree" ("user2_id");



CREATE INDEX "idx_listings_category" ON "public"."listings" USING "btree" ("category_id");



CREATE INDEX "idx_listings_city" ON "public"."listings" USING "btree" ("city_id");



CREATE INDEX "idx_listings_featured" ON "public"."listings" USING "btree" ("is_featured", "listing_priority" DESC);



CREATE INDEX "idx_listings_search" ON "public"."listings" USING "gin" ("search_vector");



CREATE INDEX "idx_listings_status" ON "public"."listings" USING "btree" ("status");



CREATE INDEX "idx_listings_status_price" ON "public"."listings" USING "btree" ("status", "price", "created_at" DESC);



CREATE INDEX "idx_listings_user" ON "public"."listings" USING "btree" ("user_id");



CREATE INDEX "idx_listings_user_featured" ON "public"."listings" USING "btree" ("user_id", "featured_until") WHERE (("is_featured" = true) AND ("featured_until" IS NOT NULL));



CREATE INDEX "idx_messages_conversation" ON "public"."messages" USING "btree" ("conversation_id");



CREATE INDEX "idx_messages_conversation_created" ON "public"."messages" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "idx_messages_created" ON "public"."messages" USING "btree" ("created_at");



CREATE INDEX "idx_notifications_data" ON "public"."notifications" USING "gin" ("data");



CREATE INDEX "idx_notifications_user_created" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id") WHERE ("is_read" = false);



CREATE INDEX "idx_rate_limits_lookup" ON "public"."rate_limits" USING "btree" ("user_id", "function_name", "window_start");



CREATE INDEX "idx_reviews_conversation" ON "public"."reviews" USING "btree" ("conversation_id");



CREATE INDEX "idx_reviews_listing_created" ON "public"."reviews" USING "btree" ("listing_id", "created_at" DESC);



CREATE INDEX "idx_reviews_reviewer" ON "public"."reviews" USING "btree" ("reviewer_id");



CREATE UNIQUE INDEX "idx_subscriptions_mp_preapproval_id" ON "public"."subscriptions" USING "btree" ("mp_preapproval_id");



CREATE INDEX "idx_subscriptions_status_expires" ON "public"."subscriptions" USING "btree" ("status", "expires_at");



CREATE INDEX "idx_subscriptions_user" ON "public"."subscriptions" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "check_featured_write_trigger" BEFORE UPDATE ON "public"."listings" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_direct_featured_write"();



CREATE OR REPLACE TRIGGER "trg_create_message_notification" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."fn_create_message_notification"();



CREATE OR REPLACE TRIGGER "trg_create_review_notification" AFTER INSERT ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."fn_create_review_notification"();



CREATE OR REPLACE TRIGGER "trg_fill_review_listing_id" BEFORE INSERT ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."fn_fill_review_listing_id"();



CREATE OR REPLACE TRIGGER "trg_mark_message_notification_read" AFTER UPDATE OF "user1_last_read_at", "user2_last_read_at" ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."fn_mark_message_notification_read"();



CREATE OR REPLACE TRIGGER "trg_recalculate_ratings" AFTER INSERT OR DELETE OR UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."fn_recalculate_ratings"();



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_user1_id_fkey" FOREIGN KEY ("user1_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_user2_id_fkey" FOREIGN KEY ("user2_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."listings"
    ADD CONSTRAINT "listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."listings"
    ADD CONSTRAINT "listings_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id");



ALTER TABLE ONLY "public"."listings"
    ADD CONSTRAINT "listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rate_limits"
    ADD CONSTRAINT "rate_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewer_id_profiles_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Authenticated users can insert reviews" ON "public"."reviews" FOR INSERT WITH CHECK (("reviewer_id" = "auth"."uid"()));



CREATE POLICY "Categories are publicly readable" ON "public"."categories" FOR SELECT USING (true);



CREATE POLICY "Cities are publicly readable" ON "public"."cities" FOR SELECT USING (true);



CREATE POLICY "Listings are publicly readable" ON "public"."listings" FOR SELECT USING ((("status" = 'active'::"text") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "Profiles are publicly readable" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Reviews are publicly readable" ON "public"."reviews" FOR SELECT USING (true);



CREATE POLICY "Service role only" ON "public"."rate_limits" USING (true) WITH CHECK (true);



CREATE POLICY "Subscription plans are publicly readable" ON "public"."subscription_plans" FOR SELECT USING (true);



CREATE POLICY "Users can delete own conversations" ON "public"."conversations" FOR DELETE USING ((("user1_id" = "auth"."uid"()) OR ("user2_id" = "auth"."uid"())));



CREATE POLICY "Users can delete own listings" ON "public"."listings" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own messages" ON "public"."messages" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "messages"."conversation_id") AND (("conversations"."user1_id" = "auth"."uid"()) OR ("conversations"."user2_id" = "auth"."uid"()))))));



CREATE POLICY "Users can delete own notifications" ON "public"."notifications" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own reviews" ON "public"."reviews" FOR DELETE USING (("reviewer_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own conversations" ON "public"."conversations" FOR INSERT WITH CHECK ((("user1_id" = "auth"."uid"()) OR ("user2_id" = "auth"."uid"())));



CREATE POLICY "Users can insert own listings" ON "public"."listings" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own messages" ON "public"."messages" FOR INSERT WITH CHECK ((("sender_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "messages"."conversation_id") AND (("conversations"."user1_id" = "auth"."uid"()) OR ("conversations"."user2_id" = "auth"."uid"())))))));



CREATE POLICY "Users can insert own notifications" ON "public"."notifications" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Users can read own conversations" ON "public"."conversations" FOR SELECT USING ((("user1_id" = "auth"."uid"()) OR ("user2_id" = "auth"."uid"())));



CREATE POLICY "Users can read own messages" ON "public"."messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "messages"."conversation_id") AND (("conversations"."user1_id" = "auth"."uid"()) OR ("conversations"."user2_id" = "auth"."uid"()))))));



CREATE POLICY "Users can read own notifications" ON "public"."notifications" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own conversations" ON "public"."conversations" FOR UPDATE USING ((("user1_id" = "auth"."uid"()) OR ("user2_id" = "auth"."uid"())));



CREATE POLICY "Users can update own listings" ON "public"."listings" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own notifications" ON "public"."notifications" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categories_delete_admin" ON "public"."categories" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "categories_insert_admin" ON "public"."categories" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "categories_select_public" ON "public"."categories" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "categories_update_admin" ON "public"."categories" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



ALTER TABLE "public"."cities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversations_insert_participant" ON "public"."conversations" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user1_id") OR ("auth"."uid"() = "user2_id")));



CREATE POLICY "conversations_select_participant" ON "public"."conversations" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user1_id") OR ("auth"."uid"() = "user2_id")));



CREATE POLICY "conversations_update_participant" ON "public"."conversations" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user1_id") OR ("auth"."uid"() = "user2_id"))) WITH CHECK ((("auth"."uid"() = "user1_id") OR ("auth"."uid"() = "user2_id")));



ALTER TABLE "public"."listings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "listings_delete_own" ON "public"."listings" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "listings_insert_own" ON "public"."listings" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "listings_select_public" ON "public"."listings" FOR SELECT TO "authenticated", "anon" USING (("status" = 'active'::"text"));



CREATE POLICY "listings_update_own" ON "public"."listings" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_insert_participant" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "messages"."conversation_id") AND (("conversations"."user1_id" = "auth"."uid"()) OR ("conversations"."user2_id" = "auth"."uid"()))))) AND ("auth"."uid"() = "sender_id")));



CREATE POLICY "messages_select_participant" ON "public"."messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "messages"."conversation_id") AND (("conversations"."user1_id" = "auth"."uid"()) OR ("conversations"."user2_id" = "auth"."uid"()))))));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_delete_own" ON "public"."notifications" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_insert_system" ON "public"."notifications" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "notifications_select_own" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_update_own" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND (NOT ("is_read" IS DISTINCT FROM true))));



CREATE POLICY "plans_select_public" ON "public"."subscription_plans" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_delete_own" ON "public"."profiles" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "profiles_select_public" ON "public"."profiles" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



ALTER TABLE "public"."rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reviews_insert_participant" ON "public"."reviews" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "reviewer_id") AND (EXISTS ( SELECT 1
   FROM ("public"."conversations" "c"
     JOIN "public"."listings" "l" ON (("l"."id" = "c"."listing_id")))
  WHERE (("c"."id" = "reviews"."conversation_id") AND (("c"."user1_id" = "auth"."uid"()) OR ("c"."user2_id" = "auth"."uid"())) AND ("l"."user_id" <> "auth"."uid"()))))));



CREATE POLICY "reviews_no_delete" ON "public"."reviews" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "reviews_no_update" ON "public"."reviews" FOR UPDATE TO "authenticated" USING (false);



CREATE POLICY "reviews_select_participant" ON "public"."reviews" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "reviews"."conversation_id") AND (("conversations"."user1_id" = "auth"."uid"()) OR ("conversations"."user2_id" = "auth"."uid"()))))));



CREATE POLICY "reviews_select_public" ON "public"."reviews" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."listings"
  WHERE (("listings"."id" = "reviews"."listing_id") AND ("listings"."status" = 'active'::"text")))));



ALTER TABLE "public"."subscription_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_select_own" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."archive_conversation"("conv_id" "uuid", "user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."archive_conversation"("conv_id" "uuid", "user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_conversation"("conv_id" "uuid", "user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_conversation_with_message"("p_listing_id" "uuid", "p_user1_id" "uuid", "p_user2_id" "uuid", "p_content" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_conversation_with_message"("p_listing_id" "uuid", "p_user1_id" "uuid", "p_user2_id" "uuid", "p_content" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_conversation_with_message"("p_listing_id" "uuid", "p_user1_id" "uuid", "p_user2_id" "uuid", "p_content" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_featured_listings"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_featured_listings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_featured_listings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_subscriptions"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_subscriptions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_subscriptions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."feature_listing"("p_listing_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."feature_listing"("p_listing_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feature_listing"("p_listing_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_check_subscription_expiry"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_check_subscription_expiry"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_check_subscription_expiry"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_create_message_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_create_message_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_create_message_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_create_review_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_create_review_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_create_review_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_fill_review_listing_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_fill_review_listing_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_fill_review_listing_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_mark_message_notification_read"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_mark_message_notification_read"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_mark_message_notification_read"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_recalculate_ratings"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_recalculate_ratings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_recalculate_ratings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_total_unread_count"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_total_unread_count"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_total_unread_count"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_conversation_read"("conv_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_conversation_read"("conv_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_conversation_read"("conv_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_direct_featured_write"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_direct_featured_write"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_direct_featured_write"() TO "service_role";



GRANT ALL ON FUNCTION "public"."search_listings"("p_query" "text", "p_category_id" "uuid", "p_price_min" numeric, "p_price_max" numeric, "p_location" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_listings"("p_query" "text", "p_category_id" "uuid", "p_price_min" numeric, "p_price_max" numeric, "p_location" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_listings"("p_query" "text", "p_category_id" "uuid", "p_price_min" numeric, "p_price_max" numeric, "p_location" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_message_notifications"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_message_notifications"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_message_notifications"("p_user_id" "uuid") TO "service_role";
























GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."cities" TO "anon";
GRANT ALL ON TABLE "public"."cities" TO "authenticated";
GRANT ALL ON TABLE "public"."cities" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."listings" TO "anon";
GRANT ALL ON TABLE "public"."listings" TO "authenticated";
GRANT ALL ON TABLE "public"."listings" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_plans" TO "anon";
GRANT ALL ON TABLE "public"."subscription_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_plans" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































