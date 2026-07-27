-- update-feature-listing-for-trial.sql
-- Updates feature_listing RPC to also work for trial users
-- Run in Supabase SQL Editor

CREATE OR REPLACE FUNCTION "public"."feature_listing"("p_listing_id" "uuid")
RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_listing record;
  v_listing_priority int;
  v_max_featured int;
  v_featured_duration_days int;
  v_new_featured_until timestamptz;
  v_featured_used int;
  v_sub_id uuid;
  v_is_trial boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Check listing ownership
  SELECT id INTO v_listing FROM listings WHERE id = p_listing_id AND user_id = v_uid;
  IF v_listing IS NULL THEN
    RAISE EXCEPTION 'No sos el dueño de este aviso';
  END IF;

  -- Check for active trial in profiles
  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_uid
      AND subscription_status = 'trial'
      AND trial_ends_at > now()
  ) THEN
    v_is_trial := true;
    v_listing_priority := 2;   -- premium priority
    v_max_featured := 10;      -- premium limit
    v_featured_duration_days := 30;
    v_featured_used := 0;      -- TODO: could track in a separate table if needed
  ELSE
    -- Check for active paid subscription
    SELECT s.id, s.featured_used, sp.listing_priority, sp.max_featured, sp.featured_duration_days
    INTO v_sub_id, v_featured_used, v_listing_priority, v_max_featured, v_featured_duration_days
    FROM subscriptions s
    JOIN subscription_plans sp ON sp.id = s.plan_id
    WHERE s.user_id = v_uid AND s.status = 'active';

    IF v_sub_id IS NULL THEN
      RAISE EXCEPTION 'No tenés un plan activo';
    END IF;

    -- Reset featured_used if period expired
    SELECT s.featured_used INTO v_featured_used
    FROM subscriptions s WHERE id = v_sub_id;

    DECLARE v_period_start timestamptz;
    BEGIN
      SELECT period_start INTO v_period_start FROM subscriptions WHERE id = v_sub_id;
      IF v_period_start + (v_featured_duration_days || ' days')::interval < now() THEN
        v_featured_used := 0;
        UPDATE subscriptions SET featured_used = 0, period_start = now() WHERE id = v_sub_id;
      END IF;
    END;
  END IF;

  -- Check featured limit
  IF v_featured_used >= v_max_featured THEN
    RAISE EXCEPTION 'Llegaste al límite de avisos destacados de este período (máximo %)', v_max_featured;
  END IF;

  -- Increment featured_used (only for paid subscriptions)
  IF NOT v_is_trial THEN
    UPDATE subscriptions SET featured_used = featured_used + 1 WHERE id = v_sub_id;
  END IF;

  v_new_featured_until := now() + (v_featured_duration_days || ' days')::interval;

  PERFORM set_config('app.allow_featured_write', 'true', true);
  UPDATE listings SET is_featured = true, listing_priority = v_listing_priority, featured_until = v_new_featured_until WHERE id = p_listing_id;

  RETURN jsonb_build_object(
    'ok', true,
    'listing_priority', v_listing_priority,
    'featured_until', v_new_featured_until,
    'featured_used', v_featured_used + 1,
    'max_featured', v_max_featured
  );
END;
$$;

ALTER FUNCTION "public"."feature_listing"("p_listing_id" "uuid") OWNER TO "postgres";
