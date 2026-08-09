-- subscription_dupe_prevention_verify.sql
-- Deterministic BEGIN/ROLLBACK verification for the subscription duplicate
-- prevention schema slice (PR 1, migration 20260809000001).
--
-- What is verified (each scenario is a self-contained DO block):
--   a) Index exists — idx_subscriptions_user_plan_live (unique partial
--      (user_id, plan_id) WHERE status IN ('active','pending')).
--   b) 23505 raised on a duplicate live insert (active AND pending); a
--      cancelled or expired row for the same (user, plan) inserts fine.
--   c) CHECK rejects unknown status AND NULL status (23514).
--   d) Reconcile keeps the newest (created_at DESC, id DESC):
--      * migration NOT applied (pre-deploy): runs the migration's reconcile
--        UPDATEs against a synthetic 3-live-row fixture and asserts only the
--        newest survives;
--      * migration applied: asserts the global postcondition — no
--        (user_id, plan_id) group holds more than one live row.
--   e) Pin row 548a19b4* survives and stays active (incident state present).
--   f) Backfill idempotent — the migration's backfill UPDATE runs twice on the
--      incident profile and yields the same paid-Estandar state both times
--      (subscription_type 'estandar', subscription_status 'paid',
--      subscription_expires_at = pin row's expires_at).
--   g) Grants matrix — service_role has EXECUTE on the clear RPC; anon and
--      authenticated do NOT.
--   h) clear_profile_subscription_if_no_active RPC — returns FALSE and leaves
--      the profile untouched while an active row remains; returns TRUE and
--      clears (type 'none', expires NULL) once no active row remains.
--   i) expire_subscriptions conditional clear — a user whose expiring plan
--      still has another active plan keeps the profile; a user whose last
--      active plan expires gets the profile cleared.
--
-- Pre-deploy behavior (migration NOT yet applied — the state when this file
-- first ships): scenarios a/b/c/g/h/i detect the missing migration artifacts
-- and skip themselves with a NOTICE; d (reconcile logic) + e (pin) + f
-- (backfill) run against live data inside the transaction. NOTE: e and f
-- RAISE (hard-fail) when the incident row 548a19b4* / mp ddaa579d2b... is
-- absent — they do NOT skip. They are therefore only safe to run against an
-- environment that carries the incident state (umpi-prod); the migration's
-- pinned reconcile only reconciles around an existing pin row, it does not
-- create it, so running them on a fresh/dev database without the pin row
-- fails by design. Post-deploy, every
-- scenario runs for real. Either way the script PASSES by completing without
-- a FAIL exception and printing the verdict SELECT at the end.
--
-- Safety: the whole script runs inside one transaction that ROLLBACKs at the
-- end. Any UPDATE it performs on real rows (the incident profile in f, the
-- global reconcile in d) is reverted. The migration itself is NOT applied by
-- this file.
--
-- Prerequisites:
--   * Migration 20260809000001 applied for full coverage (structural checks
--     skip gracefully when absent — this file is safe to run pre-deploy).
--   * subscription_plans rows exist (ensured: estandar / premium upserted
--     ON CONFLICT (slug) DO NOTHING — same pattern as admin_panel_verify).
--   * Test users MUST exist in auth.users before profile updates (profiles.id
--     references auth.users(id)); the handle_new_user trigger creates the
--     profile on insert. Fixed UUIDs per design: …00f1 / …00f2 / …00f3.
--   * Run as a superuser (postgres) via:
--       supabase db query --linked -f supabase/tests/subscription_dupe_prevention_verify.sql
--
-- PASS = script completes and prints 'VERIFICATION PASSED …'; FAIL = an
-- exception with a 'FAIL: …' message aborts the transaction, persisting
-- nothing.

BEGIN;

-- ── Setup ───────────────────────────────────────────────────────────────────

-- 1) Ensure the two plans exist (slug is UNIQUE; ON CONFLICT tolerates an
--    existing seed). Skipped silently when the table is absent (migrations-only
--    replay — D10-style guard).
DO $$
BEGIN
  IF to_regclass('public.subscription_plans') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.subscription_plans
    (id, name, slug, price, currency, features, listing_priority,
     max_images, max_featured, featured_duration_days, is_active)
  VALUES
    ('00000000-0000-4000-8000-0000000000c1', 'Estándar', 'estandar', 100, 'ARS',
     '[]'::jsonb, 1, 10, 1, 30, true),
    ('00000000-0000-4000-8000-0000000000c2', 'Premium', 'premium', 200, 'ARS',
     '[]'::jsonb, 2, 20, 10, 30, true)
  ON CONFLICT (slug) DO NOTHING;
END $$;

-- 2) Seed the test users FIRST (FK targets for profiles + subscriptions).
--    Minimal GoTrue columns; the handle_new_user trigger fires on each insert
--    and creates the profile. Fixed UUIDs: …00f1 / …00f2 / …00f3.
INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  (NULL, '00000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated',
   'sdp-f1@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"SDP F1"}'::jsonb, now(), now()),
  (NULL, '00000000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated',
   'sdp-f2@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"SDP F2"}'::jsonb, now(), now()),
  (NULL, '00000000-0000-4000-8000-0000000000f3', 'authenticated', 'authenticated',
   'sdp-f3@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"SDP F3"}'::jsonb, now(), now());

-- 3) The plan ids (looked up by slug — the setup may have skipped the upsert).
DO $$
DECLARE
  v_estandar uuid; v_premium uuid;
BEGIN
  IF to_regclass('public.subscription_plans') IS NULL
     OR to_regclass('public.subscriptions') IS NULL THEN
    RETURN;
  END IF;
  SELECT id INTO v_estandar FROM public.subscription_plans WHERE slug = 'estandar';
  SELECT id INTO v_premium FROM public.subscription_plans WHERE slug = 'premium';
  IF v_estandar IS NULL OR v_premium IS NULL THEN
    RAISE EXCEPTION 'FAIL: setup — plan rows missing (estandar or premium)';
  END IF;
  PERFORM set_config('sdp.estandar_plan', v_estandar::text, true);
  PERFORM set_config('sdp.premium_plan', v_premium::text, true);
END $$;

-- ── Migration-applied probe ─────────────────────────────────────────────────
-- The unique partial index is the migration's signature artifact. When it is
-- absent the migration has not been applied and the structural checks skip.
DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'subscriptions'
          AND indexname = 'idx_subscriptions_user_plan_live')
  THEN
    RAISE NOTICE 'migration artifacts absent (pre-deploy run) — structural checks a/b/c/g/h/i SKIPPED; reconcile/pin/backfill scenarios still run';
  END IF;
END $$;

-- ── a) Index exists (applied mode only) ─────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'public' AND tablename = 'subscriptions'
                AND indexname = 'idx_subscriptions_user_plan_live') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'subscriptions'
         AND indexname = 'idx_subscriptions_user_plan_live'
         AND indexdef LIKE '%UNIQUE%'
         AND indexdef LIKE '%(user_id, plan_id)%'
         AND indexdef LIKE '%status = ANY (ARRAY[''active''::text, ''pending''::text])%'
    ) THEN
      RAISE EXCEPTION 'FAIL: index exists but is not the expected unique partial (user_id, plan_id) WHERE status IN (active,pending)';
    END IF;
  END IF;
END $$;

-- ── b) 23505 on duplicate live insert (applied mode only) ───────────────────
DO $$
DECLARE
  v_plan uuid := current_setting('sdp.estandar_plan', true)::uuid;
  v_raised boolean;
BEGIN
  IF to_regclass('public.subscriptions') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_indexes
                     WHERE schemaname = 'public' AND tablename = 'subscriptions'
                       AND indexname = 'idx_subscriptions_user_plan_live') THEN
    RETURN;  -- index absent → migration not applied → skip
  END IF;

  -- Fixture: one active row for (f1, estandar)
  INSERT INTO public.subscriptions
    (user_id, plan_id, status, mp_preapproval_id, external_reference, created_at)
  VALUES ('00000000-0000-4000-8000-0000000000f1', v_plan, 'active',
          'sdp-b-active', 'sdp-b-active', now());

  -- Duplicate ACTIVE for same (user, plan) → 23505
  v_raised := false;
  BEGIN
    INSERT INTO public.subscriptions
      (user_id, plan_id, status, mp_preapproval_id, external_reference, created_at)
    VALUES ('00000000-0000-4000-8000-0000000000f1', v_plan, 'active',
            'sdp-b-dup-active', 'sdp-b-dup-active', now());
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: duplicate ACTIVE insert did not raise 23505';
  END IF;

  -- Duplicate PENDING for same (user, plan) → 23505
  v_raised := false;
  BEGIN
    INSERT INTO public.subscriptions
      (user_id, plan_id, status, mp_preapproval_id, external_reference, created_at)
    VALUES ('00000000-0000-4000-8000-0000000000f1', v_plan, 'pending',
            'sdp-b-dup-pending', 'sdp-b-dup-pending', now());
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: duplicate PENDING insert did not raise 23505';
  END IF;

  -- Non-conflicting statuses for the same (user, plan) insert fine
  INSERT INTO public.subscriptions
    (user_id, plan_id, status, mp_preapproval_id, external_reference, created_at)
  VALUES ('00000000-0000-4000-8000-0000000000f1', v_plan, 'cancelled',
          'sdp-b-cancelled', 'sdp-b-cancelled', now());
  INSERT INTO public.subscriptions
    (user_id, plan_id, status, mp_preapproval_id, external_reference, created_at)
  VALUES ('00000000-0000-4000-8000-0000000000f1', v_plan, 'expired',
          'sdp-b-expired', 'sdp-b-expired', now());
END $$;

-- ── c) CHECK rejects unknown + NULL status (applied mode only) ──────────────
DO $$
DECLARE
  v_plan uuid := current_setting('sdp.premium_plan', true)::uuid;
  v_raised boolean;
BEGIN
  IF to_regclass('public.subscriptions') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'public.subscriptions'::regclass
                       AND conname = 'subscriptions_status_check') THEN
    RETURN;  -- constraint absent → migration not applied → skip
  END IF;

  -- Unknown status → 23514
  v_raised := false;
  BEGIN
    INSERT INTO public.subscriptions
      (user_id, plan_id, status, mp_preapproval_id, created_at)
    VALUES ('00000000-0000-4000-8000-0000000000f1', v_plan, 'bogus',
            'sdp-c-bogus', now());
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: CHECK accepted unknown status ''bogus''';
  END IF;

  -- NULL status → 23514 (bare IN would pass NULL; the CHECK pins IS NOT NULL)
  v_raised := false;
  BEGIN
    INSERT INTO public.subscriptions
      (user_id, plan_id, status, mp_preapproval_id, created_at)
    VALUES ('00000000-0000-4000-8000-0000000000f1', v_plan, NULL,
            'sdp-c-null', now());
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: CHECK accepted NULL status';
  END IF;
END $$;

-- ── d) Reconcile keeps the newest ───────────────────────────────────────────
-- Pre-deploy: replay the migration's reconcile UPDATEs (steps 2-3) against a
-- synthetic fixture and assert only the newest live row survives.
-- Post-deploy: assert the global postcondition — no group holds >1 live row
-- (the index makes the fixture unreachable, so the invariant is the check).
DO $$
DECLARE
  v_plan uuid := current_setting('sdp.premium_plan', true)::uuid;
  v_index_present boolean;
  v_live_after int;
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND tablename = 'subscriptions'
                    AND indexname = 'idx_subscriptions_user_plan_live')
    INTO v_index_present;

  IF v_index_present THEN
    -- Applied mode: postcondition — no (user_id, plan_id) group has >1 live row
    IF EXISTS (
      SELECT 1 FROM (
        SELECT user_id, plan_id
          FROM public.subscriptions
         WHERE status IN ('active','pending')
         GROUP BY user_id, plan_id
        HAVING count(*) > 1
      ) g
    ) THEN
      RAISE EXCEPTION 'FAIL: reconcile postcondition — duplicate live rows remain for a (user, plan) group';
    END IF;
    RETURN;
  END IF;

  -- Pre-deploy: synthetic 3-live-row fixture for (f2, premium), staggered.
  INSERT INTO public.subscriptions
    (user_id, plan_id, status, mp_preapproval_id, external_reference, created_at)
  VALUES
    ('00000000-0000-4000-8000-0000000000f2', v_plan, 'active',
     'sdp-d-old', 'sdp-d-old', now() - interval '3 hours'),
    ('00000000-0000-4000-8000-0000000000f2', v_plan, 'active',
     'sdp-d-mid', 'sdp-d-mid', now() - interval '2 hours'),
    ('00000000-0000-4000-8000-0000000000f2', v_plan, 'active',
     'sdp-d-new', 'sdp-d-new', now() - interval '1 hour');

  -- Replay the migration's generic reconcile UPDATE verbatim (design D1-3).
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

  SELECT count(*) INTO v_live_after
    FROM public.subscriptions
   WHERE user_id = '00000000-0000-4000-8000-0000000000f2'
     AND plan_id = v_plan
     AND status IN ('active','pending');

  IF v_live_after <> 1 THEN
    RAISE EXCEPTION 'FAIL: reconcile — expected exactly 1 live row after replay, got %', v_live_after;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions
                  WHERE user_id = '00000000-0000-4000-8000-0000000000f2'
                    AND plan_id = v_plan AND status = 'active'
                    AND mp_preapproval_id = 'sdp-d-new') THEN
    RAISE EXCEPTION 'FAIL: reconcile — newest live row (sdp-d-new) was cancelled';
  END IF;
END $$;

-- ── e) Pin row survives (both modes) ────────────────────────────────────────
DO $$
DECLARE
  v_pin uuid;
  v_pin_status text;
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RETURN;
  END IF;
  SELECT id, status INTO v_pin, v_pin_status
    FROM public.subscriptions
   WHERE id::text LIKE '548a19b4%'
     AND mp_preapproval_id = 'ddaa579d2b374131b22c1ca2cebbf9e9'
   ORDER BY created_at DESC, id DESC
   LIMIT 1;
  IF v_pin IS NULL THEN
    RAISE EXCEPTION 'FAIL: pinned row 548a19b4* (mp ddaa579d2b374131b22c1ca2cebbf9e9) missing — incident state absent';
  END IF;
  IF v_pin_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'FAIL: pinned row is %, expected active', v_pin_status;
  END IF;
END $$;

-- ── f) Backfill idempotent (both modes) ─────────────────────────────────────
DO $$
DECLARE
  v_pin uuid;
  v_pin_expires timestamptz;
  v_type1 text; v_status1 text; v_expires1 timestamptz;
  v_type2 text; v_status2 text; v_expires2 timestamptz;
BEGIN
  IF to_regclass('public.subscriptions') IS NULL
     OR to_regclass('public.subscription_plans') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RETURN;
  END IF;

  SELECT id, expires_at INTO v_pin, v_pin_expires
    FROM public.subscriptions
   WHERE id::text LIKE '548a19b4%'
     AND mp_preapproval_id = 'ddaa579d2b374131b22c1ca2cebbf9e9'
   ORDER BY created_at DESC, id DESC
   LIMIT 1;
  IF v_pin IS NULL THEN
    RAISE EXCEPTION 'FAIL: pinned row 548a19b4* missing — backfill target unresolved';
  END IF;

  -- First backfill run (the migration's UPDATE verbatim — design D1-5).
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

  SELECT subscription_type, subscription_status, subscription_expires_at
    INTO v_type1, v_status1, v_expires1
    FROM public.profiles WHERE id = (SELECT user_id FROM public.subscriptions WHERE id = v_pin);

  -- Second run — must yield identical values (idempotent).
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

  SELECT subscription_type, subscription_status, subscription_expires_at
    INTO v_type2, v_status2, v_expires2
    FROM public.profiles WHERE id = (SELECT user_id FROM public.subscriptions WHERE id = v_pin);

  IF v_type1 IS DISTINCT FROM v_type2
     OR v_status1 IS DISTINCT FROM v_status2
     OR v_expires1 IS DISTINCT FROM v_expires2 THEN
    RAISE EXCEPTION 'FAIL: backfill not idempotent — run 1 vs run 2 differ (%/%/% vs %/%/%)',
      v_type1, v_status1, v_expires1, v_type2, v_status2, v_expires2;
  END IF;
  IF v_type2 IS DISTINCT FROM 'estandar' THEN
    RAISE EXCEPTION 'FAIL: backfill — subscription_type expected estandar, got %', v_type2;
  END IF;
  IF v_status2 IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'FAIL: backfill — subscription_status expected paid, got %', v_status2;
  END IF;
  IF v_expires2 IS DISTINCT FROM v_pin_expires THEN
    RAISE EXCEPTION 'FAIL: backfill — subscription_expires_at % does not match pin expires_at %', v_expires2, v_pin_expires;
  END IF;
  IF v_expires2 IS NULL OR v_expires2::date <> DATE '2026-09-02' THEN
    RAISE EXCEPTION 'FAIL: backfill — subscription_expires_at expected 2026-09-02, got %', v_expires2;
  END IF;
END $$;

-- ── g) Grants matrix (applied mode only) ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public'
                    AND p.proname = 'clear_profile_subscription_if_no_active') THEN
    RETURN;  -- RPC absent → migration not applied → skip
  END IF;
  IF NOT has_function_privilege('service_role', 'public.clear_profile_subscription_if_no_active(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: grants — service_role lacks EXECUTE on clear_profile_subscription_if_no_active';
  END IF;
  IF has_function_privilege('anon', 'public.clear_profile_subscription_if_no_active(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: grants — anon has EXECUTE on clear_profile_subscription_if_no_active';
  END IF;
  IF has_function_privilege('authenticated', 'public.clear_profile_subscription_if_no_active(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: grants — authenticated has EXECUTE on clear_profile_subscription_if_no_active';
  END IF;
END $$;

-- ── h) Clear RPC: only clears when no active row remains (applied mode) ─────
DO $$
DECLARE
  v_plan uuid := current_setting('sdp.estandar_plan', true)::uuid;
  v_user uuid := '00000000-0000-4000-8000-0000000000f3';
  v_cleared boolean;
  v_type text; v_expires timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public'
                    AND p.proname = 'clear_profile_subscription_if_no_active') THEN
    RETURN;  -- RPC absent → migration not applied → skip
  END IF;

  -- Fixture: f3 has an active estandar row; profile shows a paid plan.
  INSERT INTO public.subscriptions
    (user_id, plan_id, status, mp_preapproval_id, external_reference, created_at)
  VALUES (v_user, v_plan, 'active', 'sdp-h-active', 'sdp-h-active', now());
  UPDATE public.profiles
     SET subscription_type = 'estandar',
         subscription_expires_at = now() + interval '40 days'
   WHERE id = v_user;

  -- Active remains → RPC must return FALSE and leave the profile untouched.
  SELECT public.clear_profile_subscription_if_no_active(v_user) INTO v_cleared;
  IF v_cleared THEN
    RAISE EXCEPTION 'FAIL: clear RPC returned TRUE while an active row remains';
  END IF;
  SELECT subscription_type, subscription_expires_at INTO v_type, v_expires
    FROM public.profiles WHERE id = v_user;
  IF v_type IS DISTINCT FROM 'estandar' OR v_expires IS NULL THEN
    RAISE EXCEPTION 'FAIL: clear RPC modified the profile while an active row remains (type %, expires %)', v_type, v_expires;
  END IF;

  -- No active remains → RPC must return TRUE and clear the profile.
  UPDATE public.subscriptions SET status = 'cancelled'
   WHERE user_id = v_user AND status = 'active';
  SELECT public.clear_profile_subscription_if_no_active(v_user) INTO v_cleared;
  IF NOT v_cleared THEN
    RAISE EXCEPTION 'FAIL: clear RPC returned FALSE with no active row remaining';
  END IF;
  SELECT subscription_type, subscription_expires_at INTO v_type, v_expires
    FROM public.profiles WHERE id = v_user;
  IF v_type IS DISTINCT FROM 'none' OR v_expires IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: clear RPC did not clear the profile (type %, expires %)', v_type, v_expires;
  END IF;

  -- Conditional clear: another active row elsewhere keeps the profile.
  -- f1 already has an active estandar row from scenario b; give it a paid
  -- profile, then run the RPC against f1 → FALSE and profile untouched.
  v_user := '00000000-0000-4000-8000-0000000000f1';
  UPDATE public.profiles
     SET subscription_type = 'premium',
         subscription_expires_at = now() + interval '40 days'
   WHERE id = v_user;
  SELECT public.clear_profile_subscription_if_no_active(v_user) INTO v_cleared;
  IF v_cleared THEN
    RAISE EXCEPTION 'FAIL: clear RPC returned TRUE when another active row remains';
  END IF;
  SELECT subscription_type INTO v_type FROM public.profiles WHERE id = v_user;
  IF v_type IS DISTINCT FROM 'premium' THEN
    RAISE EXCEPTION 'FAIL: clear RPC modified profile while another active remains (type %)', v_type;
  END IF;
END $$;

-- ── i) expire_subscriptions conditional clear (applied mode only) ───────────
-- A user whose expiring plan still has another active plan keeps the profile;
-- a user whose last active plan expires gets the profile cleared.
DO $$
DECLARE
  v_estandar uuid := current_setting('sdp.estandar_plan', true)::uuid;
  v_premium uuid := current_setting('sdp.premium_plan', true)::uuid;
  v_type text; v_expires timestamptz;
BEGIN
  IF to_regclass('public.subscriptions') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_indexes
                     WHERE schemaname = 'public' AND tablename = 'subscriptions'
                       AND indexname = 'idx_subscriptions_user_plan_live') THEN
    RETURN;  -- index absent → migration not applied → skip
  END IF;

  -- Fixture: f2 has estandar (expired 40 days ago) + premium (expires in 40
  -- days) — one row will expire, the other keeps the profile from clearing.
  INSERT INTO public.subscriptions
    (user_id, plan_id, status, mp_preapproval_id, external_reference, expires_at, created_at)
  VALUES ('00000000-0000-4000-8000-0000000000f2', v_estandar, 'active',
          'sdp-i-f2-stale', 'sdp-i-f2-stale', now() - interval '40 days', now() - interval '40 days'),
         ('00000000-0000-4000-8000-0000000000f2', v_premium, 'active',
          'sdp-i-f2-live', 'sdp-i-f2-live', now() + interval '40 days', now());
  UPDATE public.profiles
     SET subscription_type = 'premium',
         subscription_expires_at = now() + interval '40 days'
   WHERE id = '00000000-0000-4000-8000-0000000000f2';

  -- Fixture: f1's active estandar row from scenario b — make it stale so it
  -- expires; f1 has no other active row → profile must be cleared.
  UPDATE public.subscriptions
     SET expires_at = now() - interval '40 days'
   WHERE user_id = '00000000-0000-4000-8000-0000000000f1'
     AND status = 'active';

  PERFORM public.expire_subscriptions();

  -- f2: stale estandar expired, live premium stays, profile KEPT.
  IF EXISTS (SELECT 1 FROM public.subscriptions
              WHERE user_id = '00000000-0000-4000-8000-0000000000f2'
                AND plan_id = v_estandar AND status = 'active') THEN
    RAISE EXCEPTION 'FAIL: expire_subscriptions — stale estandar row for f2 not expired';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions
                  WHERE user_id = '00000000-0000-4000-8000-0000000000f2'
                    AND plan_id = v_premium AND status = 'active') THEN
    RAISE EXCEPTION 'FAIL: expire_subscriptions — live premium row for f2 wrongly expired';
  END IF;
  SELECT subscription_type, subscription_expires_at INTO v_type, v_expires
    FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000f2';
  IF v_type IS DISTINCT FROM 'premium' OR v_expires IS NULL THEN
    RAISE EXCEPTION 'FAIL: expire_subscriptions — profile cleared despite another active plan (type %, expires %)', v_type, v_expires;
  END IF;

  -- f1: last active row expired → profile CLEARED.
  IF EXISTS (SELECT 1 FROM public.subscriptions
              WHERE user_id = '00000000-0000-4000-8000-0000000000f1'
                AND status = 'active') THEN
    RAISE EXCEPTION 'FAIL: expire_subscriptions — stale estandar row for f1 not expired';
  END IF;
  SELECT subscription_type, subscription_expires_at INTO v_type, v_expires
    FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000f1';
  IF v_type IS DISTINCT FROM 'none' OR v_expires IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: expire_subscriptions — last-active profile not cleared (type %, expires %)', v_type, v_expires;
  END IF;
END $$;

-- ── Visible verdict (the CLI suppresses NOTICEs, so the verdict is a SELECT) ─
SELECT 'VERIFICATION PASSED — subscription dupe prevention (schema slice)' AS result,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname = 'public' AND tablename = 'subscriptions'
                            AND indexname = 'idx_subscriptions_user_plan_live')
            THEN 'mode: migration applied — full coverage (a–i)'
            ELSE 'mode: migration NOT applied — structural checks skipped (expected pre-deploy)' END AS mode;

ROLLBACK;
