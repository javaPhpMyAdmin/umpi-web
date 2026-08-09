-- Migration: subscription duplicate prevention — schema foundation (D1)
--
-- Incident 2026-07-24: chelobat16411@gmail.com ended up with 9+ ACTIVE
-- Estándar subscriptions for the same (user, plan). Same external_reference on
-- every checkout, every pending passed the guard, each paid one upserted
-- ACTIVE via mp-webhook. Manual cleanup kept row 548a19b4 (expires 2026-09-02);
-- sync-subscription then clobbered the profile to 'none' — the UI misrepresents
-- the plan.
--
-- WHAT THIS ADDS (design D1, exact order — reconcile → backfill → structure;
-- backfill MUST run after reconcile so the pinned row is guaranteed active):
--   1. conflict_resolution_pending marker column (D3 retry handle).
--   2. Reconcile pinned: live rows sharing (user_id, plan_id) with the incident
--      row 548a19b4 → 'cancelled', EXCEPT the pin itself — it survives
--      regardless of recency (fixes the silent backfill failure mode). NOTICE
--      if the pin row is absent.
--   3. Reconcile generic: within each (user_id, plan_id) group keep the newest
--      live row (ORDER BY created_at DESC, id DESC), cancel the rest.
--   4. Unknown/NULL statuses → 'cancelled', loudly (verified 0 today).
--   5. Backfill (idempotent): incident profile → subscription_type = plan slug
--      ('estandar'), subscription_status = 'paid', subscription_expires_at from
--      the pinned row's expires_at (2026-09-02). Same column vocabulary as the
--      mp-webhook profile write (traspaso-supabase/.../mp-webhook/index.ts
--      ~311-321: subscription_type=plan.slug, subscription_status='paid',
--      subscription_expires_at=<date>). Re-running writes identical values.
--   6. Unique partial index (user_id, plan_id) WHERE status IN
--      ('active','pending') — the DB-enforced invariant every writer relies on.
--      Created only if no conflicting unique index exists (pg_index probe).
--   7. CHECK: status IS NOT NULL AND status IN
--      ('active','pending','cancelled','expired'), via pg_constraint probe.
--   8. clear_profile_subscription_if_no_active(uuid) RPC: ONE atomic statement
--      — clears the profile ONLY when the user has no remaining active row
--      (READ COMMITTED re-checks the predicate after any lock wait, so a
--      concurrent webhook's paid write can never be clobbered). SECURITY
--      DEFINER, service_role only (mirrors bump_rate_limit + 20260731000001).
--   9. expire_subscriptions replace: the profile-clear UPDATE gains the same
--      conditional guard (AND NOT EXISTS ... status='active'), so the expiry
--      cron joins the conditional-clear invariant instead of clobbering a
--      user who still has an active plan on another row.
--
--   NOTE on step 9 (deviation from the literal D1-9 wording, verified live):
--   the conditional profile clear is a SEPARATE statement after the expiry
--   UPDATE, not an AND NOT EXISTS inside the same CTE statement. Within one
--   statement, subqueries see the PRE-update snapshot — an AND NOT EXISTS on
--   the same UPDATE would still see the just-expired row as 'active' and would
--   never clear the only-active-plan case (empirically confirmed on the linked
--   DB). Splitting into two statements makes the NOT EXISTS see the
--   post-expiry state and preserves the conditional-clear contract.
--
-- Guard: public.subscriptions is dump-only (no migration creates it today), so
-- the whole body is wrapped in the same to_regclass guard as 20260801000002 —
-- a migrations-only replay becomes a safe no-op instead of aborting the chain.
--
-- Rollback: drop index + CHECK + marker column; restore expire_subscriptions
-- (20260731000001) / drop the RPC; backfill reversible via recorded
-- pre-change values (none/paid/NULL).

DO $$
DECLARE
  v_pin_id uuid;
  v_pin_user_id uuid;
  v_pin_plan_id uuid;
  v_affected integer;
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RETURN;
  END IF;

  -- 1. Marker column (D3 conflict-resolution retry handle; cron picks up
  --    rows with conflict_resolution_pending = true regardless of status).
  ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS conflict_resolution_pending boolean NOT NULL DEFAULT false;

  -- 2. Reconcile pinned: cancel live siblings of the incident row, keep the pin.
  SELECT id, user_id, plan_id
    INTO v_pin_id, v_pin_user_id, v_pin_plan_id
    FROM public.subscriptions
   WHERE id::text LIKE '548a19b4%'
     AND mp_preapproval_id = 'ddaa579d2b374131b22c1ca2cebbf9e9'
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  IF v_pin_id IS NULL THEN
    RAISE NOTICE 'subscription_dupe_prevention: PIN ROW 548a19b4* / mp ddaa579d2b374131b22c1ca2cebbf9e9 MISSING — incident state not found; pinned reconcile + backfill skipped';
  ELSE
    UPDATE public.subscriptions s
       SET status = 'cancelled'
     WHERE s.user_id = v_pin_user_id
       AND s.plan_id IS NOT DISTINCT FROM v_pin_plan_id
       AND s.id <> v_pin_id
       AND s.status IN ('active','pending');
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected > 0 THEN
      RAISE NOTICE 'subscription_dupe_prevention: cancelled % live sibling(s) of pinned row 548a19b4', v_affected;
    END IF;
  END IF;

  -- 3. Reconcile generic: newest live row per (user_id, plan_id) wins
  --    (tie-break ORDER BY created_at DESC, id DESC); plan_id groups NULLs
  --    via IS NOT DISTINCT FROM (writers always set it — accepted).
  UPDATE public.subscriptions s
     SET status = 'cancelled'
   WHERE s.status IN ('active','pending')
     AND EXISTS (
       SELECT 1
         FROM public.subscriptions n
        WHERE n.user_id = s.user_id
          AND n.plan_id IS NOT DISTINCT FROM s.plan_id
          AND n.id <> s.id
          AND n.status IN ('active','pending')
          AND (n.created_at > s.created_at
               OR (n.created_at = s.created_at AND n.id > s.id))
     );
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected > 0 THEN
    RAISE NOTICE 'subscription_dupe_prevention: cancelled % duplicate live row(s) (newest kept)', v_affected;
  END IF;

  -- 4. Unknown/NULL statuses → 'cancelled' (loud if any appear so the CHECK
  --    in step 7 can be enabled with zero violations).
  UPDATE public.subscriptions
     SET status = 'cancelled'
   WHERE status IS NULL
      OR status NOT IN ('active','pending','cancelled','expired');
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected > 0 THEN
    RAISE NOTICE 'subscription_dupe_prevention: % row(s) with unknown/NULL status set to cancelled', v_affected;
  END IF;

  -- 5. Backfill (idempotent): restore the incident profile to the paid
  --    Estándar state sourced from the pinned row. Same column vocabulary as
  --    the mp-webhook profile write. Re-running writes identical values
  --    (pin stays active via step 2 → WHERE still matches → no-op write).
  UPDATE public.profiles p
     SET subscription_type = sp.slug,
         subscription_status = 'paid',
         subscription_expires_at = s.expires_at
    FROM public.subscriptions s
    JOIN public.subscription_plans sp ON sp.id = s.plan_id
   WHERE p.id = s.user_id
     AND s.id::text LIKE '548a19b4%'
     AND s.mp_preapproval_id = 'ddaa579d2b374131b22c1ca2cebbf9e9'
     AND s.status = 'active';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected = 0 THEN
    RAISE NOTICE 'subscription_dupe_prevention: backfill matched 0 rows (pin missing or not active)';
  END IF;

  -- 6. Unique partial index (user_id, plan_id) WHERE status IN
  --    ('active','pending') — the invariant every writer relies on. Probed:
  --    skip if an index with the convention name already exists, or if ANY
  --    other unique index already covers (user_id, plan_id) as its first two
  --    key columns (a conflicting index would make this one redundant).
  --
  --    Fail-loud pre-probe: the reconciles above only pair rows with a
  --    comparable created_at (NULL > x IS NULL → NULL pairs survive). If any
  --    (user_id, plan_id) group still holds >1 live row here, CREATE INDEX
  --    would die with a confusing 23505 — raise a clear error instead so the
  --    operator fixes the NULL-created_at rows before applying.
  IF EXISTS (
    SELECT 1
      FROM (
        SELECT user_id, plan_id
          FROM public.subscriptions
         WHERE status IN ('active','pending')
         GROUP BY user_id, plan_id
        HAVING count(*) > 1
      ) dup
  ) THEN
    RAISE EXCEPTION
      'subscription_dupe_prevention: % (user_id, plan_id) group(s) still hold >1 live row after reconcile (likely NULL created_at) — resolve before creating the unique index',
      (SELECT count(*) FROM (
         SELECT user_id, plan_id
           FROM public.subscriptions
          WHERE status IN ('active','pending')
          GROUP BY user_id, plan_id
         HAVING count(*) > 1) x);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'idx_subscriptions_user_plan_live'
       AND i.indisunique
  ) AND NOT EXISTS (
    SELECT 1
      FROM pg_index i
     WHERE i.indrelid = 'public.subscriptions'::regclass
       AND i.indisunique
       AND i.indnkeyatts = 2
       AND (SELECT attnum FROM pg_attribute
             WHERE attrelid = i.indrelid AND attname = 'user_id') = i.indkey[0]
       AND (SELECT attnum FROM pg_attribute
             WHERE attrelid = i.indrelid AND attname = 'plan_id') = i.indkey[1]
  ) THEN
    CREATE UNIQUE INDEX idx_subscriptions_user_plan_live
      ON public.subscriptions (user_id, plan_id)
      WHERE status IN ('active','pending');
  END IF;

  -- 7. Status CHECK via pg_constraint probe (name-based idempotent; the bare
  --    IN would pass NULL, so the constraint ALSO pins status IS NOT NULL).
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.subscriptions'::regclass
       AND conname = 'subscriptions_status_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_status_check
      CHECK (status IS NOT NULL AND status IN ('active','pending','cancelled','expired'));
  END IF;

  -- 8. Clear RPC — one atomic statement; the NOT EXISTS re-evaluates against
  --    the latest committed row state (READ COMMITTED), so a concurrent
  --    webhook's paid write can never be clobbered. Returns whether the
  --    profile was cleared. service_role only (edge functions).
  CREATE OR REPLACE FUNCTION public.clear_profile_subscription_if_no_active(p_user uuid)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = 'public'
  AS $rpc$
  BEGIN
    UPDATE public.profiles
       SET subscription_type = 'none',
           subscription_expires_at = NULL
     WHERE id = p_user
       AND NOT EXISTS (
         SELECT 1
           FROM public.subscriptions
          WHERE user_id = p_user
            AND status = 'active'
       );
    RETURN FOUND;
  END;
  $rpc$;

  REVOKE ALL ON FUNCTION public.clear_profile_subscription_if_no_active(uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.clear_profile_subscription_if_no_active(uuid) FROM anon, authenticated;
  GRANT ALL ON FUNCTION public.clear_profile_subscription_if_no_active(uuid) TO service_role;

  -- 9. expire_subscriptions replace: the profile-clear UPDATE gains the
  --    conditional guard. Two statements (not one CTE statement) so the
  --    NOT EXISTS sees the post-expiry state — see header NOTE. Grants
  --    re-applied identically to 20260731000001 (service_role only).
  CREATE OR REPLACE FUNCTION public.expire_subscriptions()
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = 'public'
  AS $exp$
  DECLARE
    v_expired_user_ids uuid[];
  BEGIN
    -- Set-based: expire every active subscription whose EFFECTIVE expiry
    -- (+ 3-day grace) is in the past, and collect the affected users.
    -- Effective expiry tiers: expires_at → period_start + featured_duration_days
    -- → created_at + 30 days (LEFT JOIN keeps plan-less rows evaluated).
    WITH plan_durations AS (
      SELECT s.id AS sub_id,
             GREATEST(COALESCE(p.featured_duration_days, 30), 30) AS featured_duration_days
        FROM subscriptions s
        LEFT JOIN subscription_plans p ON p.id = s.plan_id
    ),
    expired AS (
      UPDATE subscriptions s
         SET status = 'expired'
        FROM plan_durations d
       WHERE s.id = d.sub_id
         AND s.status = 'active'
         AND COALESCE(
               s.expires_at,
               s.period_start + make_interval(days => d.featured_duration_days),
               s.created_at + interval '30 days'
             ) + interval '3 days' < NOW()
       RETURNING s.user_id
    )
    SELECT array_agg(DISTINCT user_id)
      INTO v_expired_user_ids
      FROM expired;

    -- Conditional profile clear (SEPARATE statement — fresh snapshot): only
    -- clear users whose profile has NO remaining active row anywhere.
    IF v_expired_user_ids IS NOT NULL THEN
      UPDATE profiles
         SET subscription_type = 'none',
             subscription_expires_at = NULL
       WHERE id = ANY(v_expired_user_ids)
         AND NOT EXISTS (
           SELECT 1
             FROM subscriptions
            WHERE user_id = profiles.id
              AND status = 'active'
         );
    END IF;

    -- Also expire any featured listings whose time is up
    PERFORM public.expire_featured_listings();
  END;
  $exp$;

  REVOKE ALL ON FUNCTION public.expire_subscriptions() FROM anon, authenticated;
  REVOKE ALL ON FUNCTION public.expire_subscriptions() FROM PUBLIC;
  GRANT ALL ON FUNCTION public.expire_subscriptions() TO service_role;

  REVOKE ALL ON FUNCTION public.expire_featured_listings() FROM anon, authenticated;
  REVOKE ALL ON FUNCTION public.expire_featured_listings() FROM PUBLIC;
  GRANT ALL ON FUNCTION public.expire_featured_listings() TO service_role;
END;
$$;
