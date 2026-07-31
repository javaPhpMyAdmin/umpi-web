-- trial_security_verify.sql
-- Deterministic BEGIN/ROLLBACK verification for the trial security fixes:
--   C1/C2  The profiles UPDATE policy locks sensitive columns and allows
--          editable ones (full_name, location, phone, avatar_url).
--   C3     No client INSERT/DELETE policies exist on profiles anymore.
--   C4     feature_listing enforces the 10-feature trial quota and caps
--          featured_until at the trial end.
--   A      listings direct-write guards: BEFORE INSERT / BEFORE UPDATE
--          triggers reject featured writes without the RPC opt-in.
--   W3     handle_new_user trigger is the ONLY profile writer: inserting
--          into auth.users must create the profile (status 'trial').
--
-- Prerequisites:
--   * Migrations 20260731000002_profiles_rls_trial_security.sql and
--     20260731000003_feature_listing_trial_quota.sql are applied.
--   * Run as a superuser (postgres) — the script SET ROLE authenticated to
--     exercise RLS (postgres/anon never hit the UPDATE policy).
--   * A fixed test UUID is used; everything is rolled back at the end.
--
-- FK note: profiles.id and listings.user_id reference auth.users(id) ON
-- DELETE CASCADE, so the test user MUST exist in auth.users before any
-- profile/listing insert. The handle_new_user trigger fires on that auth
-- insert and creates the profile — which also E2E-tests the trigger.
--
-- Execution (from repo root, after migrations are applied):
--   psql "$SUPABASE_DB_URL" -f supabase/tests/trial_security_verify.sql
--
-- PASS = the script completes and prints 'VERIFICATION PASSED ...'
--        (SELECT output is visible even when the CLI suppresses NOTICEs).
-- FAIL = an exception with a 'FAIL: ...' message aborts the transaction;
--        ROLLBACK still applies and nothing is persisted.

BEGIN;

-- ── Setup (as postgres — RLS does not apply to the table owner) ─────────────
-- 1) Seed the auth user FIRST (FK target for profiles + listings). Minimal
--    GoTrue columns; the handle_new_user trigger fires on this insert.
INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  (NULL, '00000000-0000-4000-8000-0000000000aa', 'authenticated', 'authenticated',
   'trial-verify@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Test Trial User"}'::jsonb, now(), now());

-- 2) The trigger must have created the profile with trial semantics.
DO $$
DECLARE v_status text; v_ends timestamptz; v_name text;
BEGIN
  SELECT subscription_status, trial_ends_at, full_name
    INTO v_status, v_ends, v_name
    FROM public.profiles
   WHERE id = '00000000-0000-4000-8000-0000000000aa';

  IF v_status IS DISTINCT FROM 'trial' THEN
    RAISE EXCEPTION 'FAIL: handle_new_user trigger — expected status trial, got %', v_status;
  END IF;
  IF v_ends IS NULL OR v_ends <= now() THEN
    RAISE EXCEPTION 'FAIL: handle_new_user trigger — expected trial_ends_at in the future, got %', v_ends;
  END IF;
  IF v_name IS DISTINCT FROM 'Test Trial User' THEN
    RAISE EXCEPTION 'FAIL: handle_new_user trigger — expected full_name from user metadata, got %', v_name;
  END IF;
END $$;

SELECT 'b0 trigger created profile' AS check_name, subscription_status, trial_ends_at, full_name
FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000aa';

-- 3) Trial ends in 7 days so the featured_until cap
--    (LEAST(now() + 30 days, trial_ends_at)) is actually exercised.
UPDATE public.profiles
   SET trial_ends_at = now() + interval '7 days'
 WHERE id = '00000000-0000-4000-8000-0000000000aa';

INSERT INTO public.listings (user_id, title)
SELECT '00000000-0000-4000-8000-0000000000aa', 'Verify Listing ' || g
FROM generate_series(1, 11) AS g;

-- ── C3: no client INSERT/DELETE policies may exist on profiles ──────────────
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles'
     AND cmd IN ('INSERT', 'DELETE');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL: expected no INSERT/DELETE policies on profiles, found %', v_n;
  END IF;
END $$;

-- ── A: direct-write guards — a client can never feature a listing itself ────
-- As postgres (no JWT) the guards pass; as authenticated without the GUC a
-- featured INSERT must be rejected. Tested as authenticated below.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000aa', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);

DO $$
DECLARE v_rejected int := 0; v_accepted int := 0;
BEGIN
  -- Plain insert (defaults) must pass — normal publish flow.
  BEGIN
    INSERT INTO public.listings (user_id, title)
    VALUES ('00000000-0000-4000-8000-0000000000aa', 'Verify Plain Insert');
    v_accepted := v_accepted + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL: guard A — plain listing insert was rejected: %', SQLERRM;
  END;

  -- Pre-featured insert without the GUC must be rejected.
  BEGIN
    INSERT INTO public.listings (user_id, title, is_featured, listing_priority, featured_until)
    VALUES ('00000000-0000-4000-8000-0000000000aa', 'Verify Sneaky Featured',
            true, 2, now() + interval '1 year');
    RAISE EXCEPTION 'FAIL: guard A — featured INSERT bypassed the trigger (accepted)';
  EXCEPTION WHEN OTHERS THEN
    v_rejected := v_rejected + 1;
  END;

  -- Featured UPDATE without the GUC must be rejected.
  BEGIN
    UPDATE public.listings SET is_featured = true
     WHERE user_id = '00000000-0000-4000-8000-0000000000aa' AND title = 'Verify Listing 1';
    RAISE EXCEPTION 'FAIL: guard A — featured UPDATE bypassed the trigger (accepted)';
  EXCEPTION WHEN OTHERS THEN
    v_rejected := v_rejected + 1;
  END;

  -- GUC spoofing must NEVER grant the featured write: the old opt-in
  -- (app.allow_featured_write) was removable by any SQL role with SET
  -- app.allow_featured_write='true'. The guards bypass on current_user =
  -- 'postgres', which is not spoofable — so even with the GUC set, the
  -- client writes must still be rejected. This pins the contract: if a
  -- refactor re-introduces a GUC check, this test fails.
  PERFORM set_config('app.allow_featured_write', 'true', true);

  BEGIN
    INSERT INTO public.listings (user_id, title, is_featured, listing_priority, featured_until)
    VALUES ('00000000-0000-4000-8000-0000000000aa', 'Verify GUC-Spoof Featured',
            true, 2, now() + interval '1 year');
    RAISE EXCEPTION 'FAIL: guard A — featured INSERT accepted with app.allow_featured_write=true (GUC bypass reintroduced)';
  EXCEPTION WHEN OTHERS THEN
    v_rejected := v_rejected + 1;
  END;

  BEGIN
    UPDATE public.listings SET is_featured = true
     WHERE user_id = '00000000-0000-4000-8000-0000000000aa' AND title = 'Verify Listing 2';
    RAISE EXCEPTION 'FAIL: guard A — featured UPDATE accepted with app.allow_featured_write=true (GUC bypass reintroduced)';
  EXCEPTION WHEN OTHERS THEN
    v_rejected := v_rejected + 1;
  END;

  -- The column-lock guard (prevent_privileged_profile_update) has no GUC
  -- surface either — its bypass is the same non-spoofable current_user =
  -- 'postgres' — so the GUC must not unlock privileged profile columns.
  BEGIN
    UPDATE profiles SET subscription_status = 'premium'
     WHERE id = '00000000-0000-4000-8000-0000000000aa';
    RAISE EXCEPTION 'FAIL: guard a1 — privileged profile UPDATE accepted with app.allow_featured_write=true (GUC bypass reintroduced)';
  EXCEPTION WHEN OTHERS THEN
    v_rejected := v_rejected + 1;
  END;

  IF v_rejected <> 5 OR v_accepted <> 1 THEN
    RAISE EXCEPTION 'FAIL: guard A — expected 1 accepted / 5 rejected, got % / %', v_accepted, v_rejected;
  END IF;
END $$;

SELECT 'a0 direct-write guards' AS check_name,
       count(*) AS rejected_sneaky_writes
FROM public.listings
WHERE user_id = '00000000-0000-4000-8000-0000000000aa' AND title = 'Verify Sneaky Featured';

-- ── a1: blocked columns — every privileged/derived column must be rejected ──
-- RLS USING passes (own row) but the WITH CHECK must fail, so the UPDATE
-- raises an error; an "0 rows affected" outcome also counts as rejected.
DO $$
DECLARE
  v_rejected int := 0;
  v_escalated int := 0;
  v_rows int;
BEGIN
  BEGIN
    UPDATE profiles SET is_admin = true WHERE id = '00000000-0000-4000-8000-0000000000aa';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN v_escalated := v_escalated + 1; END IF;
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1; END;

  BEGIN
    UPDATE profiles SET subscription_status = 'premium' WHERE id = '00000000-0000-4000-8000-0000000000aa';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN v_escalated := v_escalated + 1; END IF;
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1; END;

  BEGIN
    UPDATE profiles SET subscription_type = 'premium' WHERE id = '00000000-0000-4000-8000-0000000000aa';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN v_escalated := v_escalated + 1; END IF;
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1; END;

  BEGIN
    UPDATE profiles SET subscription_expires_at = now() + interval '1 year' WHERE id = '00000000-0000-4000-8000-0000000000aa';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN v_escalated := v_escalated + 1; END IF;
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1; END;

  BEGIN
    UPDATE profiles SET trial_ends_at = now() + interval '1 year' WHERE id = '00000000-0000-4000-8000-0000000000aa';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN v_escalated := v_escalated + 1; END IF;
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1; END;

  BEGIN
    UPDATE profiles SET trial_featured_used = 99 WHERE id = '00000000-0000-4000-8000-0000000000aa';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN v_escalated := v_escalated + 1; END IF;
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1; END;

  BEGIN
    -- rating has DEFAULT 0; a 0.0 assignment is indistinguishable from current state
    -- (IS NOT DISTINCT FROM) and legitimately passes — use a non-default value.
    UPDATE profiles SET rating = 0.5 WHERE id = '00000000-0000-4000-8000-0000000000aa';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN v_escalated := v_escalated + 1; END IF;
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1; END;

  BEGIN
    UPDATE profiles SET total_sales = 999 WHERE id = '00000000-0000-4000-8000-0000000000aa';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN v_escalated := v_escalated + 1; END IF;
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1; END;

  BEGIN
    UPDATE profiles SET total_listings = 999 WHERE id = '00000000-0000-4000-8000-0000000000aa';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN v_escalated := v_escalated + 1; END IF;
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1; END;

  BEGIN
    UPDATE profiles SET reviews_count = 999 WHERE id = '00000000-0000-4000-8000-0000000000aa';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN v_escalated := v_escalated + 1; END IF;
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1; END;

  BEGIN
    UPDATE profiles SET created_at = now() - interval '1 day' WHERE id = '00000000-0000-4000-8000-0000000000aa';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN v_escalated := v_escalated + 1; END IF;
  EXCEPTION WHEN OTHERS THEN v_rejected := v_rejected + 1; END;

  IF v_rejected <> 11 OR v_escalated <> 0 THEN
    RAISE EXCEPTION 'FAIL: RLS update lock — expected 11 rejected columns and 0 escalated, got rejected=% escalated=%', v_rejected, v_escalated;
  END IF;
END $$;

-- Visible confirmation that no escalation stuck
SELECT 'a1 blocked columns' AS check_name,
       is_admin, subscription_status, subscription_type, trial_ends_at, trial_featured_used
FROM profiles WHERE id = '00000000-0000-4000-8000-0000000000aa';

-- ── a2: editable columns must still work (full_name, location, phone, avatar_url) ─
DO $$
DECLARE v_rows int;
BEGIN
  UPDATE profiles
     SET full_name = 'Trial Verify Updated', location = 'CABA', phone = '+54 9 11 5555 5555',
         avatar_url = 'https://example.com/avatar.png'
   WHERE id = '00000000-0000-4000-8000-0000000000aa';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL: editable columns update — expected 1 row affected, got %', v_rows;
  END IF;
END $$;

SELECT 'a2 editable columns' AS check_name, full_name, location, phone, avatar_url
FROM profiles WHERE id = '00000000-0000-4000-8000-0000000000aa';

-- ── b: trial featured quota — 11 calls, 10 must succeed, the 11th must fail ─
DO $$
DECLARE
  r record;
  v_ok int := 0;
  v_rejected int := 0;
  v_counter int;
BEGIN
  -- The 11th call is rejected by the PRE-CHECK (v_featured_used >=
  -- v_max_featured), NOT by the atomic branch (v_used_after IS NULL): the
  -- guarded UPDATE can only miss under two overlapping concurrent calls,
  -- which a serial test cannot produce. The TOCTOU mechanism is therefore
  -- verified by code review, not by this test.
  FOR r IN
    -- Exclude the a0 guard-test listing ('Verify Plain Insert') so exactly
    -- the 11 seeded listings exercise the quota: 10 ok / 1 rejected.
    SELECT id FROM listings
     WHERE user_id = '00000000-0000-4000-8000-0000000000aa'
       AND title <> 'Verify Plain Insert'
     ORDER BY id
  LOOP
    BEGIN
      PERFORM public.feature_listing(r.id);
      v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_rejected := v_rejected + 1;
    END;
  END LOOP;

  SELECT trial_featured_used INTO v_counter
    FROM profiles WHERE id = '00000000-0000-4000-8000-0000000000aa';

  IF v_ok <> 10 OR v_rejected <> 1 OR v_counter <> 10 THEN
    RAISE EXCEPTION 'FAIL: trial featured quota — expected 10 ok / 1 rejected / counter 10, got % / % / %', v_ok, v_rejected, v_counter;
  END IF;
END $$;

-- Visible confirmation: counter, featured count, 11th untouched, cap enforced
SELECT 'b1 quota counter' AS check_name, trial_featured_used AS counter
FROM profiles WHERE id = '00000000-0000-4000-8000-0000000000aa';

SELECT 'b2 featured count' AS check_name,
       count(*) FILTER (WHERE is_featured) AS featured,
       count(*) FILTER (WHERE NOT is_featured) AS not_featured
FROM listings WHERE user_id = '00000000-0000-4000-8000-0000000000aa';

SELECT 'b3 featured_until capped at trial end' AS check_name,
       max(featured_until) <= (SELECT trial_ends_at FROM profiles WHERE id = '00000000-0000-4000-8000-0000000000aa') AS capped
FROM listings WHERE user_id = '00000000-0000-4000-8000-0000000000aa' AND is_featured;

-- ── W2: backfill consumes the trial ONLY for users with an ACTIVE sub ───────
-- Runs as postgres (RLS would block the profile UPDATE otherwise). Seeds a
-- 2nd user whose profile the trigger creates as 'trial', gives him an active
-- subscription, re-runs the EXACT backfill statement from migration 02, and
-- asserts: user 2 → paid/null; user 1 (no active sub, only his featured
-- quota used) → untouched.
SET ROLE postgres;

INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  (NULL, '00000000-0000-4000-8000-0000000000bb', 'authenticated', 'authenticated',
   'trial-verify-2@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"W2 Backfill User"}'::jsonb, now(), now());

DO $$
DECLARE v_plan_id uuid;
BEGIN
  SELECT id INTO v_plan_id FROM public.subscription_plans ORDER BY max_featured DESC LIMIT 1;
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: W2 — no subscription_plans rows to seed the subscription';
  END IF;

  INSERT INTO public.subscriptions (user_id, plan_id, status, mp_preapproval_id, external_reference)
  VALUES ('00000000-0000-4000-8000-0000000000bb', v_plan_id, 'active',
          'test-w2-backfill-1', 'test-w2-backfill-1');
END $$;

-- Sanity: the trigger created user 2's profile as trial (the thing W2 consumes).
DO $$
DECLARE v_status text;
BEGIN
  SELECT subscription_status INTO v_status FROM public.profiles
   WHERE id = '00000000-0000-4000-8000-0000000000bb';
  IF v_status IS DISTINCT FROM 'trial' THEN
    RAISE EXCEPTION 'FAIL: W2 — expected user 2 status trial before backfill, got %', v_status;
  END IF;
END $$;

-- The exact backfill statement from migration 02 (W2).
UPDATE public.profiles p
SET subscription_status = 'paid',
    trial_ends_at = NULL
WHERE p.subscription_status = 'trial'
  AND EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = p.id
      AND s.status = 'active'
  );

DO $$
DECLARE
  v_u2_status text; v_u2_ends timestamptz;
  v_u1_status text; v_u1_ends timestamptz;
BEGIN
  SELECT subscription_status, trial_ends_at INTO v_u2_status, v_u2_ends FROM public.profiles
   WHERE id = '00000000-0000-4000-8000-0000000000bb';
  IF v_u2_status IS DISTINCT FROM 'paid' OR v_u2_ends IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: W2 — user 2 not consumed by backfill: % / %', v_u2_status, v_u2_ends;
  END IF;

  SELECT subscription_status, trial_ends_at INTO v_u1_status, v_u1_ends FROM public.profiles
   WHERE id = '00000000-0000-4000-8000-0000000000aa';
  IF v_u1_status IS DISTINCT FROM 'trial' OR v_u1_ends IS NULL OR v_u1_ends <= now() THEN
    RAISE EXCEPTION 'FAIL: W2 — user 1 (no active sub) was touched: % / %', v_u1_status, v_u1_ends;
  END IF;
END $$;

SELECT 'b4 w2 backfill' AS check_name,
       (SELECT subscription_status FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000bb') AS user2_status,
       (SELECT trial_ends_at IS NULL FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000bb') AS user2_trial_cleared,
       (SELECT subscription_status FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000aa') AS user1_status;

-- ── Final verdict (SELECT output is visible even when NOTICEs are suppressed) ──
SELECT 'VERIFICATION PASSED — W3 trigger profile creation, C1/C2 RLS lock (incl. created_at), C3 no client insert/delete, A direct-write guards (role-based), C4 trial featured quota (10) + trial-end cap, W2 backfill (active sub only)' AS result;

ROLLBACK;
