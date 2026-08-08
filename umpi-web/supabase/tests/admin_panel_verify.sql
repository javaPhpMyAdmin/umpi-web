-- admin_panel_verify.sql
-- Deterministic BEGIN/ROLLBACK verification for the admin panel DB slice
-- (PR 1): the admin_list_users() SECURITY DEFINER RPC (migration
-- 20260801000005) enforces the admin gate server-side and returns the
-- { stats, users, subscriptions } payload.
--
-- What is verified (as role authenticated with a per-user JWT, plus direct
-- superuser calls where the scenario demands it):
--   a) grants matrix — authenticated has EXECUTE, anon does NOT
--      (template-identical to record_legal_consent)
--   b) unauthenticated denial — no JWT (auth.uid() IS NULL) → RAISE
--      'not authenticated'
--   c) non-admin denial — regular user JWT → RAISE 'admin access required'
--      (pins the PII-free message so it cannot drift)
--   d) admin success — payload is a jsonb object with stats/users/subscriptions
--      keys; stats.total_users >= 2; the seeded regular user appears with
--      active_listings_count = 1 (1 active + 1 inactive listing seeded)
--   e) subscriptions — active-only: the seeded cancelled subscription is
--      filtered out; array length = 1 (guarded by to_regclass so a
--      migrations-only replay skips silently instead of failing, D10)
--
-- Prerequisites:
--   * Migration 20260801000005_admin_panel.sql applied (and the earlier
--     migrations through it, incl. 20260726000003 auto profile creation).
--   * Run as a superuser (postgres) — the script SET ROLE authenticated to
--     exercise the RPC's grant path with a per-user JWT (postgres has no JWT,
--     so auth.uid() is NULL and the unauth denial exercises that path).
--   * subscription_plans rows are ensured (estandar / premium): the script
--     INSERTs them ON CONFLICT (slug) DO NOTHING if missing, then looks the
--     ids up by slug — same pattern as max_images_verify.sql.
--   * A fixed set of test UUIDs is used; everything is rolled back at the end.
--
-- FK note: profiles.id references auth.users(id), so each test user MUST
-- exist in auth.users before any profile update. The handle_new_user trigger
-- fires on that insert and creates the profile; the script then sets
-- is_admin for the admin user (as postgres, before SET ROLE — the profiles
-- column lock bypasses system writes with auth.uid() IS NULL).
--
-- Execution (from repo root, after migrations are applied):
--   psql "$SUPABASE_DB_URL" -f supabase/tests/admin_panel_verify.sql
-- (or, via the CLI, `supabase db query --linked -f supabase/tests/admin_panel_verify.sql`)
--
-- PASS = the script completes and prints 'VERIFICATION PASSED ...'
-- FAIL = an exception with a 'FAIL: ...' message aborts the transaction;
--        ROLLBACK still applies and nothing is persisted.

BEGIN;

-- ── Setup (as postgres — RLS does not apply to the table owner) ─────────────

-- 1) Ensure the two plans exist (slug is UNIQUE; ON CONFLICT tolerates an
--    existing seed). The subscriptions join reads the plan NAME for the
--    payload, so only existence matters here.
INSERT INTO public.subscription_plans
  (id, name, slug, price, currency, features, listing_priority,
   max_images, max_featured, featured_duration_days, is_active)
VALUES
  ('00000000-0000-4000-8000-0000000000c1', 'Estándar', 'estandar', 100, 'ARS',
   '[]'::jsonb, 1, 10, 1, 30, true),
  ('00000000-0000-4000-8000-0000000000c2', 'Premium', 'premium', 200, 'ARS',
   '[]'::jsonb, 2, 20, 10, 30, true)
ON CONFLICT (slug) DO NOTHING;

-- 2) Seed the two test users FIRST (FK targets for profiles + listings).
--    Minimal GoTrue columns; the handle_new_user trigger fires on each
--    insert and creates the profile (subscription_status 'trial').
--    Fixed UUIDs per design: …00e1 admin, …00e2 regular.
INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  (NULL, '00000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated',
   'admin-ap@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Admin AP"}'::jsonb, now(), now()),
  (NULL, '00000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated',
   'regular-ap@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Regular AP"}'::jsonb, now(), now());

-- 3) Shape the profiles (as postgres with no JWT, the profiles column lock
--    bypasses system writes by design — auth.uid() IS NULL).
UPDATE public.profiles SET is_admin = true
 WHERE id = '00000000-0000-4000-8000-0000000000e1';

-- 4) Regular user: 1 active + 1 inactive listing → active_listings_count = 1.
--    (The max_images trigger skips system writes: auth.uid() IS NULL.)
INSERT INTO public.listings (user_id, title, status)
VALUES
  ('00000000-0000-4000-8000-0000000000e2', 'admin-test active', 'active'),
  ('00000000-0000-4000-8000-0000000000e2', 'admin-test inactive', 'inactive');

-- 5) Admin user: 1 active + 1 cancelled subscription (plan looked up by slug).
DO $$
DECLARE v_plan uuid;
BEGIN
  SELECT id INTO v_plan FROM public.subscription_plans WHERE slug = 'estandar';
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'FAIL: setup — estandar plan row missing';
  END IF;
  INSERT INTO public.subscriptions
    (user_id, plan_id, status, mp_preapproval_id, external_reference,
     started_at, expires_at)
  VALUES
    ('00000000-0000-4000-8000-0000000000e1', v_plan, 'active',
     'ap-active-1', 'ap-active-1', now(), now() + interval '30 days'),
    ('00000000-0000-4000-8000-0000000000e1', v_plan, 'cancelled',
     'ap-cancelled-1', 'ap-cancelled-1', now() - interval '60 days',
     now() - interval '30 days');
END $$;

-- 6) Sanity-check the setup so a wrong seed fails loudly BEFORE the RLS phase.
DO $$
DECLARE
  v_admin boolean; v_act int; v_inact int; v_subs int;
BEGIN
  SELECT is_admin INTO v_admin FROM public.profiles
   WHERE id = '00000000-0000-4000-8000-0000000000e1';
  IF v_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: setup — admin profile is_admin not set';
  END IF;

  SELECT count(*) FILTER (WHERE status = 'active'),
         count(*) FILTER (WHERE status = 'inactive')
    INTO v_act, v_inact
    FROM public.listings WHERE user_id = '00000000-0000-4000-8000-0000000000e2';
  IF v_act <> 1 OR v_inact <> 1 THEN
    RAISE EXCEPTION 'FAIL: setup — expected 1 active / 1 inactive listing, got % / %', v_act, v_inact;
  END IF;

  SELECT count(*) INTO v_subs FROM public.subscriptions
   WHERE user_id = '00000000-0000-4000-8000-0000000000e1';
  IF v_subs <> 2 THEN
    RAISE EXCEPTION 'FAIL: setup — expected 2 subscriptions, got %', v_subs;
  END IF;
END $$;

-- ── Grants matrix (as postgres; has_function_privilege reads the catalog) ───
DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.admin_list_users()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: grants — authenticated lacks EXECUTE on admin_list_users()';
  END IF;
  IF has_function_privilege('anon', 'public.admin_list_users()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: grants — anon has EXECUTE on admin_list_users()';
  END IF;
END $$;

-- ── Unauthenticated denial (postgres, NO JWT → auth.uid() IS NULL) ──────────
-- Same false-positive-safe pattern as max_images_verify: the flag separates
-- "the call raised" (gate engaged) from "the call returned" (gate bypassed),
-- and the bypass FAIL lives OUTSIDE the handler so it always aborts.
DO $$
DECLARE
  v_guard_raised boolean := false;
  v_msg text;
BEGIN
  BEGIN
    PERFORM public.admin_list_users();
    v_guard_raised := false;
  EXCEPTION WHEN OTHERS THEN
    v_guard_raised := true;
    v_msg := SQLERRM;
  END;

  IF NOT v_guard_raised THEN
    RAISE EXCEPTION 'FAIL: unauth denial — RPC returned without raising (gate bypass)';
  END IF;
  IF v_msg IS DISTINCT FROM 'not authenticated' THEN
    RAISE EXCEPTION 'FAIL: unauth denial — expected ''not authenticated'', got: %', v_msg;
  END IF;
END $$;

-- ── RLS phase ───────────────────────────────────────────────────────────────
SET ROLE authenticated;

-- c) Non-admin denial: regular user JWT → 'admin access required'.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e2', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);

DO $$
DECLARE
  v_guard_raised boolean := false;
  v_msg text;
BEGIN
  BEGIN
    PERFORM public.admin_list_users();
    v_guard_raised := false;
  EXCEPTION WHEN OTHERS THEN
    v_guard_raised := true;
    v_msg := SQLERRM;
  END;

  IF NOT v_guard_raised THEN
    RAISE EXCEPTION 'FAIL: non-admin denial — RPC returned without raising (gate bypass)';
  END IF;
  IF v_msg IS DISTINCT FROM 'admin access required' THEN
    RAISE EXCEPTION 'FAIL: non-admin denial — expected ''admin access required'', got: %', v_msg;
  END IF;
END $$;

-- d) Admin success: admin user JWT → full payload shape + containment.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e1', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);

DO $$
DECLARE
  v_payload jsonb;
  v_stats jsonb;
  v_users jsonb;
  v_subscriptions jsonb;
  v_total int;
BEGIN
  SELECT public.admin_list_users() INTO v_payload;

  IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'FAIL: admin success — payload is not a jsonb object';
  END IF;
  IF NOT v_payload ? 'stats' OR NOT v_payload ? 'users' OR NOT v_payload ? 'subscriptions' THEN
    RAISE EXCEPTION 'FAIL: admin success — missing stats/users/subscriptions keys';
  END IF;

  v_stats := v_payload->'stats';
  v_users := v_payload->'users';
  v_subscriptions := v_payload->'subscriptions';

  IF jsonb_typeof(v_stats) IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_stats)) <> 3 THEN
    RAISE EXCEPTION 'FAIL: admin success — stats must be an object with 3 keys (total_users, new_users_today, new_users_this_week)';
  END IF;
  IF NOT v_stats ? 'total_users' OR NOT v_stats ? 'new_users_today' OR NOT v_stats ? 'new_users_this_week' THEN
    RAISE EXCEPTION 'FAIL: admin success — stats keys wrong';
  END IF;
  SELECT (v_stats->>'total_users')::int INTO v_total;
  IF v_total < 2 THEN
    RAISE EXCEPTION 'FAIL: admin success — total_users expected >= 2, got %', v_total;
  END IF;

  IF jsonb_typeof(v_users) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'FAIL: admin success — users is not an array';
  END IF;
  IF jsonb_array_length(v_users) < 2 THEN
    RAISE EXCEPTION 'FAIL: admin success — users array expected >= 2 entries, got %', jsonb_array_length(v_users);
  END IF;
  -- The seeded regular user must appear with exactly 1 active listing.
  IF NOT v_users @> '[{"email":"regular-ap@umpi.local","active_listings_count":1}]'::jsonb THEN
    RAISE EXCEPTION 'FAIL: admin success — users lacks regular-ap@umpi.local with active_listings_count 1';
  END IF;

  -- e) Subscriptions: active-only (the cancelled one must be filtered out).
  --    Guarded by to_regclass so a migrations-only replay (no subscriptions
  --    table) skips silently instead of failing — D10.
  IF to_regclass('public.subscriptions') IS NOT NULL
     AND to_regclass('public.subscription_plans') IS NOT NULL
  THEN
    IF jsonb_typeof(v_subscriptions) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'FAIL: subscriptions — not an array';
    END IF;
    -- The seeded ACTIVE admin subscription must be present...
    IF NOT v_subscriptions @> '[{"payer_email":"admin-ap@umpi.local","status":"active"}]'::jsonb THEN
      RAISE EXCEPTION 'FAIL: subscriptions — missing active admin-ap@umpi.local row';
    END IF;
    -- ...and the seeded CANCELLED one must be filtered out (active-only).
    IF v_subscriptions @> '[{"payer_email":"admin-ap@umpi.local","status":"cancelled"}]'::jsonb THEN
      RAISE EXCEPTION 'FAIL: subscriptions — cancelled row leaked into payload';
    END IF;
  END IF;
END $$;

-- ── Back to postgres: visible confirmation and verdict ──────────────────────
RESET ROLE;

SELECT 'admin_list_users RPC exercised through grants + JWT' AS check_name,
       has_function_privilege('authenticated', 'public.admin_list_users()', 'EXECUTE') AS authenticated_execute,
       has_function_privilege('anon', 'public.admin_list_users()', 'EXECUTE') AS anon_execute;

-- Final verdict (SELECT output is visible even when NOTICEs are suppressed)
SELECT 'VERIFICATION PASSED — admin panel RPC access control + payload' AS result;

ROLLBACK;
