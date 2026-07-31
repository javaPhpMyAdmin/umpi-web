-- Migration: feature_listing — enforce the real trial featured quota (C4)
--
-- Audit finding: the trial branch hardcoded v_featured_used := 0 (never
-- counts features) and set featured_until = now() + 30 days with no cap,
-- so a trial user could feature unlimited listings and the featured spots
-- survived past the trial end (and were stackable by re-calling).
--
-- Fix (trial branch only — paid semantics preserved unchanged):
--   * profiles.trial_featured_used (integer NOT NULL DEFAULT 0) tracks the
--     features granted by the trial — the same column the C1 UPDATE policy
--     locks client-side.
--   * The trial branch reads the counter, rejects at >= v_max_featured (10,
--     the premium limit the branch already declared), and increments it via
--     an ATOMIC guarded UPDATE (WHERE trial_featured_used < v_max_featured,
--     RETURNING the post-increment value) so two concurrent calls cannot
--     both pass the limit (TOCTOU).
--   * featured_until is capped with LEAST(now() + interval '30 days',
--     trial_ends_at) so a featured spot NEVER outlives the trial.
--   * Direct-write guards: BEFORE INSERT + BEFORE UPDATE triggers on
--     listings reject any featured write unless the DML runs as postgres
--     (a SECURITY DEFINER function owned by postgres, e.g. feature_listing)
--     — closing the bypass where a client POSTs listings with
--     is_featured=true directly. Role check replaces the previous
--     app.allow_featured_write GUC, which any SQL role could spoof with
--     SET app.allow_featured_write='true'.
--
-- No GRANTs are issued for the new functions (see the REVOKE below); the
-- existing feature_listing grants from the baseline are preserved by
-- CREATE OR REPLACE.
--
-- Review-risk fixes (post-audit):
--   * Paid branch is deterministic: ORDER BY s.created_at DESC LIMIT 1,
--     matching the useFeaturedRemaining hook (.order('created_at', desc)
--     .limit(1)) — previously a user with 2+ active subscriptions got an
--     arbitrary row, so the UI could disagree with the RPC.
--   * The trial branch no longer wins over an active subscription: the
--     trial check requires NOT EXISTS(active sub), closing the window
--     where mp-webhook/sync-subscription upserted the subscription but the
--     profile still said 'trial' (or the writers failed permanently with a
--     planError → 500), which would leave a paying standard user capped at
--     the trial quota (10).
--   * Plan duration is normalized with GREATEST(COALESCE(..., 30), 30) —
--     same rule as expire_subscriptions — so a plan seeded with
--     featured_duration_days = 0 can neither reset the period cap on every
--     call nor expire the featured spot instantly.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_featured_used integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.feature_listing(p_listing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_listing record;
  v_listing_priority int;
  v_max_featured int;
  v_featured_duration_days int;
  v_new_featured_until timestamptz;
  v_featured_used int;
  v_used_after int;
  v_sub_id uuid;
  v_is_trial boolean := false;
  v_trial_ends_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Check listing ownership
  SELECT id INTO v_listing FROM listings WHERE id = p_listing_id AND user_id = v_uid;
  IF v_listing IS NULL THEN
    RAISE EXCEPTION 'No sos el dueño de este aviso';
  END IF;

  -- Check for active trial in profiles (reads the real quota counter). The
  -- trial only wins while there is NO active subscription: if the writers
  -- (mp-webhook / sync-subscription) upserted the subscription but the
  -- profile still says 'trial' (or they failed permanently), the paid
  -- branch must take over instead of capping a paying user at the trial
  -- quota.
  SELECT trial_ends_at, trial_featured_used
    INTO v_trial_ends_at, v_featured_used
    FROM profiles
   WHERE id = v_uid
     AND subscription_status = 'trial'
     AND trial_ends_at > now()
     AND NOT EXISTS (
       SELECT 1 FROM subscriptions s
        WHERE s.user_id = v_uid AND s.status = 'active'
     );

  IF FOUND THEN
    v_is_trial := true;
    v_listing_priority := 2;   -- premium priority
    v_max_featured := 10;      -- premium limit
    v_featured_duration_days := 30;
  ELSE
    -- Check for active paid subscription (deterministic: same newest-first
    -- rule the useFeaturedRemaining hook uses, so the UI and the RPC can
    -- never disagree on which subscription is the active one).
    SELECT s.id, s.featured_used, sp.listing_priority, sp.max_featured, sp.featured_duration_days
    INTO v_sub_id, v_featured_used, v_listing_priority, v_max_featured, v_featured_duration_days
    FROM subscriptions s
    JOIN subscription_plans sp ON sp.id = s.plan_id
    WHERE s.user_id = v_uid AND s.status = 'active'
    ORDER BY s.created_at DESC
    LIMIT 1;

    IF v_sub_id IS NULL THEN
      RAISE EXCEPTION 'No tenés un plan activo';
    END IF;

    -- Normalize the plan duration: 0/NULL means the plan did not declare a
    -- period — fall back to the 30-day default (same rule as
    -- expire_subscriptions) so a plan with featured_duration_days = 0 can
    -- neither reset the period cap on every call nor expire the feature
    -- instantly.
    v_featured_duration_days := GREATEST(COALESCE(v_featured_duration_days, 30), 30);

    -- Reset featured_used if period expired
    DECLARE v_period_start timestamptz;
    BEGIN
      SELECT period_start INTO v_period_start FROM subscriptions WHERE id = v_sub_id;
      IF v_period_start + (v_featured_duration_days || ' days')::interval < now() THEN
        v_featured_used := 0;
        UPDATE subscriptions SET featured_used = 0, period_start = now() WHERE id = v_sub_id;
      END IF;
    END;
  END IF;

  -- Check featured limit (trial counter is now real, not hardcoded 0)
  IF v_featured_used >= v_max_featured THEN
    RAISE EXCEPTION 'Llegaste al límite de avisos destacados de este período (máximo %)', v_max_featured;
  END IF;

  -- Increment the quota counter — atomically for trial. A separate
  -- SELECT-then-UPDATE would let two concurrent calls both read 9 and both
  -- pass the pre-check above (TOCTOU). The guarded UPDATE only bumps the
  -- counter while it is below the cap and returns the post-increment value;
  -- a NULL means the quota was consumed concurrently → reject.
  IF v_is_trial THEN
    UPDATE profiles
       SET trial_featured_used = trial_featured_used + 1
     WHERE id = v_uid AND trial_featured_used < v_max_featured
    RETURNING trial_featured_used INTO v_used_after;

    IF v_used_after IS NULL THEN
      RAISE EXCEPTION 'Llegaste al límite de avisos destacados de este período (máximo %)', v_max_featured;
    END IF;

    -- A trial feature can never outlive the trial itself
    v_new_featured_until := LEAST(now() + interval '30 days', v_trial_ends_at);
  ELSE
    UPDATE subscriptions SET featured_used = featured_used + 1 WHERE id = v_sub_id;
    v_new_featured_until := now() + (v_featured_duration_days || ' days')::interval;
  END IF;

  -- The direct-write guards bypass on current_user = 'postgres'; this UPDATE
  -- runs as postgres (SECURITY DEFINER), so no GUC is needed.
  UPDATE listings
     SET is_featured = true, listing_priority = v_listing_priority, featured_until = v_new_featured_until
   WHERE id = p_listing_id;

  RETURN jsonb_build_object(
    'ok', true,
    'listing_priority', v_listing_priority,
    'featured_until', v_new_featured_until,
    'featured_used', v_featured_used + 1,
    'max_featured', v_max_featured
  );
END;
$$;

ALTER FUNCTION public.feature_listing(p_listing_id uuid) OWNER TO postgres;

-- ── Direct-write guard for listings ─────────────────────────────────────────
-- Audit (finding A): the featured guard only existed as a BEFORE UPDATE
-- trigger (check_featured_write_trigger, esqueleto baseline) and there was
-- NO INSERT guard. Both here in one place so the guard is migration-chain
-- self-contained: a client could POST /listings with is_featured=true,
-- listing_priority=2, featured_until=2099 and get unlimited featuring
-- without ever calling feature_listing or touching the trial cap.
--
-- Bypass decision — current_user, NOT a GUC. The original guard read
-- current_setting('app.allow_featured_write') as the opt-in signal, which
-- ANY SQL role could spoof (SET app.allow_featured_write='true') and then
-- INSERT/PATCH featured columns at will. Both functions here are SECURITY
-- INVOKER — verified: the esqueleto baseline defines
-- prevent_direct_featured_write WITHOUT SECURITY DEFINER, and this
-- migration re-creates it the same way. A trigger function runs as the role
-- that executed the DML, so current_user separates the paths exactly:
--   * feature_listing / expire_featured_listings / expire_subscriptions are
--     SECURITY DEFINER owned by postgres → their UPDATE runs as postgres →
--     current_user = 'postgres' → bypass.
--   * A client INSERT/PATCH (PostgREST, anon/authenticated) runs as
--     'authenticated' → current_user ≠ 'postgres' → the defaults comparison
--     decides.
--   * service_role writers (mp-webhook / sync-subscription) carry no JWT →
--     auth.uid() IS NULL → the guards do not engage.
-- current_user is not spoofable here: SET ROLE postgres requires superuser
-- or role membership, and anon/authenticated have neither.
--
-- 1) Re-create the UPDATE guard idempotently (no-op semantics where the
--    esqueleto baseline already provided it; CREATE OR REPLACE keeps the
--    baseline's grants). Only blocks when a JWT identity is present —
--    authenticated clients. System writers (postgres paths above, or
--    service_role without a JWT) are unaffected.

CREATE OR REPLACE FUNCTION public.prevent_direct_featured_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF current_user = 'postgres' THEN
      -- System path: DML inside a SECURITY DEFINER function owned by postgres
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

DROP TRIGGER IF EXISTS check_featured_write_trigger ON public.listings;
CREATE TRIGGER check_featured_write_trigger
  BEFORE UPDATE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_direct_featured_write();

-- 2) INSERT guard: a plain listing create keeps the defaults (is_featured
--    false, listing_priority 0, featured_until NULL) and passes; any
--    attempt to insert a pre-featured row without the postgres path is
--    rejected.

CREATE OR REPLACE FUNCTION public.prevent_direct_featured_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF current_user = 'postgres' THEN
      -- System path: DML inside a SECURITY DEFINER function owned by postgres
      RETURN NEW;
    END IF;

    IF NEW.is_featured IS NOT DISTINCT FROM false
       AND NEW.listing_priority IS NOT DISTINCT FROM 0
       AND NEW.featured_until IS NULL
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only system processes can create featured listings';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_featured_insert_trigger ON public.listings;
CREATE TRIGGER check_featured_insert_trigger
  BEFORE INSERT ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_direct_featured_insert();

-- Trigger functions are invoked by the executor without EXECUTE checks, so
-- revoking the default PUBLIC execute (and any role grants) on both guards
-- closes the direct-call surface without affecting trigger firing.
REVOKE ALL ON FUNCTION public.prevent_direct_featured_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_direct_featured_write() FROM PUBLIC, anon, authenticated;
