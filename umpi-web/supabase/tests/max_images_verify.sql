-- max_images_verify.sql
-- Deterministic BEGIN/ROLLBACK verification for audit W5: the max-images
-- per-listing limit is now enforced SERVER-SIDE by the
-- check_max_images_trigger / prevent_excessive_images() BEFORE INSERT OR
-- UPDATE OF images guard on public.listings (migration 20260801000004).
--
-- What is verified (through RLS, as role authenticated with a per-user JWT):
--   a) free user (no trial, no active sub)        → 3 images OK,   4 REJECTED
--   b) trial user (status 'trial', future end)    → 20 images OK,  21 REJECTED (trial = premium)
--   c) estandar paid user (active estandar sub)   → 10 images OK,  11 REJECTED
--   d) premium paid user (active premium sub)     → 20 images OK,  21 REJECTED
--   e) non-array images payload (e.g. '{"a":1}')  → REJECTED
--   f) expired-trial user (status 'trial', past end) → falls back to free → 3 OK, 4 REJECTED
--   g) mixed trial + active estandar sub (status 'trial', future end) → paid
--      wins, NOT premium → 10 OK, 11 REJECTED
--   Plus the system-writer bypass: as postgres with no JWT (auth.uid() IS
--   NULL), a 25-image listing insert is ACCEPTED — the guard only constrains
--   authenticated client writes.
--   Plus one UPDATE-path check: bumping an accepted listing from 3 to 4
--   images as the free user is rejected (UPDATE OF images fires the trigger).
--
-- Prerequisites:
--   * Migrations through 20260801000004_max_images_server_guard.sql applied.
--   * Run as a superuser (postgres) — the script SET ROLE authenticated to
--     exercise the guard through RLS (postgres has no JWT, so auth.uid() is
--     NULL and the guard skips system writes by design).
--   * subscription_plans rows are ensured (estandar=10, premium=20): the
--     script INSERTs them ON CONFLICT (slug) DO NOTHING if missing, then
--     re-applies the 20260718000008 max_images values so the assertions are
--     deterministic regardless of prior seed state.
--   * A fixed set of test UUIDs is used; everything is rolled back at the end.
--
-- FK note: profiles.id and listings.user_id reference auth.users(id) ON
-- DELETE CASCADE, so each test user MUST exist in auth.users before any
-- profile/listing insert. The handle_new_user trigger fires on that auth
-- insert and creates the profile (status 'trial'); the script then shapes
-- each profile for its scenario (as postgres, before SET ROLE).
--
-- Execution (from repo root, after migrations are applied):
--   psql "$SUPABASE_DB_URL" -f supabase/tests/max_images_verify.sql
--
-- PASS = the script completes and prints 'VERIFICATION PASSED ...'
-- FAIL = an exception with a 'FAIL: ...' message aborts the transaction;
--        ROLLBACK still applies and nothing is persisted.

BEGIN;

-- ── Setup (as postgres — RLS does not apply to the table owner) ─────────────

-- 1) Ensure the two plans exist with the max_images the assertions expect.
--    ON CONFLICT (slug) DO NOTHING tolerates an existing seed (slug is
--    UNIQUE); the UPDATEs below re-apply 20260718000008's values so prior
--    plan state cannot skew the test — the trigger reads max_images from
--    these rows at write time.
INSERT INTO public.subscription_plans
  (id, name, slug, price, currency, features, listing_priority,
   max_images, max_featured, featured_duration_days, is_active)
VALUES
  ('00000000-0000-4000-8000-0000000000c1', 'Estándar', 'estandar', 100, 'ARS',
   '[]'::jsonb, 1, 10, 1, 30, true),
  ('00000000-0000-4000-8000-0000000000c2', 'Premium', 'premium', 200, 'ARS',
   '[]'::jsonb, 2, 20, 10, 30, true)
ON CONFLICT (slug) DO NOTHING;

UPDATE public.subscription_plans SET max_images = 10 WHERE slug = 'estandar';
UPDATE public.subscription_plans SET max_images = 20 WHERE slug = 'premium';

-- 2) Seed the six test users FIRST (FK targets for profiles + listings).
--    Minimal GoTrue columns; the handle_new_user trigger fires on each
--    insert and creates the profile with subscription_status 'trial'.
INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  (NULL, '00000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated',
   'free-w5@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"W5 Free"}'::jsonb, now(), now()),
  (NULL, '00000000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated',
   'trial-w5@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"W5 Trial"}'::jsonb, now(), now()),
  (NULL, '00000000-0000-4000-8000-0000000000d3', 'authenticated', 'authenticated',
   'estandar-w5@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"W5 Estandar"}'::jsonb, now(), now()),
  (NULL, '00000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated',
   'premium-w5@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"W5 Premium"}'::jsonb, now(), now()),
  (NULL, '00000000-0000-4000-8000-0000000000d5', 'authenticated', 'authenticated',
   'expired-w5@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"W5 Expired"}'::jsonb, now(), now()),
  (NULL, '00000000-0000-4000-8000-0000000000d6', 'authenticated', 'authenticated',
   'mixed-w5@umpi.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"W5 Mixed"}'::jsonb, now(), now());

-- 3) Shape each profile for its scenario (as postgres with no JWT, the
--    profiles column lock and the images guard skip system writes by design).
--    free:    no trial, no subscription.
--    estandar: paid, no trial, active estandar sub (added below).
--    premium:  paid, no trial, active premium sub (added below).
--    expired:  status stays 'trial' but trial_ends_at moves to the PAST.
--    trial:    untouched — the trigger already made it 'trial' (+30 days).
--    mixed:    LEFT as trigger-created 'trial' with a FUTURE trial_ends_at,
--              PLUS an active estandar sub (added below) — the paid plan must
--              win, mirroring feature_listing and the reordered getEffectivePlan.
UPDATE public.profiles
   SET subscription_status = 'none', trial_ends_at = NULL
 WHERE id = '00000000-0000-4000-8000-0000000000d1';

UPDATE public.profiles
   SET subscription_status = 'paid', trial_ends_at = NULL
 WHERE id = '00000000-0000-4000-8000-0000000000d3';

UPDATE public.profiles
   SET subscription_status = 'paid', trial_ends_at = NULL
 WHERE id = '00000000-0000-4000-8000-0000000000d4';

UPDATE public.profiles
   SET trial_ends_at = now() - interval '1 day'
 WHERE id = '00000000-0000-4000-8000-0000000000d5';

-- 4) Active subscriptions for the paid users, linked to the REAL plan ids
--    (looked up by slug — the ON CONFLICT seed above may have skipped).
DO $$
DECLARE v_plan uuid;
BEGIN
  SELECT id INTO v_plan FROM public.subscription_plans WHERE slug = 'estandar';
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'FAIL: setup — estandar plan row missing';
  END IF;
  INSERT INTO public.subscriptions (user_id, plan_id, status, mp_preapproval_id, external_reference)
  VALUES ('00000000-0000-4000-8000-0000000000d3', v_plan, 'active',
          'w5-estandar-1', 'w5-estandar-1');

  SELECT id INTO v_plan FROM public.subscription_plans WHERE slug = 'premium';
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'FAIL: setup — premium plan row missing';
  END IF;
  INSERT INTO public.subscriptions (user_id, plan_id, status, mp_preapproval_id, external_reference)
  VALUES ('00000000-0000-4000-8000-0000000000d4', v_plan, 'active',
          'w5-premium-1', 'w5-premium-1');

  -- d6 (mixed): active estandar sub on top of a STILL-TRIAL profile.
  SELECT id INTO v_plan FROM public.subscription_plans WHERE slug = 'estandar';
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'FAIL: setup — estandar plan row missing (d6)';
  END IF;
  INSERT INTO public.subscriptions (user_id, plan_id, status, mp_preapproval_id, external_reference)
  VALUES ('00000000-0000-4000-8000-0000000000d6', v_plan, 'active',
          'w5-estandar-2', 'w5-estandar-2');
END $$;

-- 5) Sanity-check the setup so a wrong seed fails loudly BEFORE the RLS phase.
DO $$
DECLARE
  v_est int; v_pre int; v_free text; v_exp timestamptz; v_subs int;
BEGIN
  SELECT max_images INTO v_est FROM public.subscription_plans WHERE slug = 'estandar';
  SELECT max_images INTO v_pre FROM public.subscription_plans WHERE slug = 'premium';
  IF v_est IS DISTINCT FROM 10 OR v_pre IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'FAIL: setup — plan limits wrong: estandar=%, premium=%', v_est, v_pre;
  END IF;

  SELECT subscription_status INTO v_free FROM public.profiles
   WHERE id = '00000000-0000-4000-8000-0000000000d1';
  IF v_free IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'FAIL: setup — free profile status expected none, got %', v_free;
  END IF;

  SELECT trial_ends_at INTO v_exp FROM public.profiles
   WHERE id = '00000000-0000-4000-8000-0000000000d5';
  IF v_exp IS NULL OR v_exp > now() THEN
    RAISE EXCEPTION 'FAIL: setup — expired-trial profile not expired: %', v_exp;
  END IF;

  SELECT count(*) INTO v_subs FROM public.subscriptions
   WHERE status = 'active' AND user_id IN
     ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000d4',
      '00000000-0000-4000-8000-0000000000d6');
  IF v_subs <> 3 THEN
    RAISE EXCEPTION 'FAIL: setup — expected 3 active subscriptions, got %', v_subs;
  END IF;
END $$;

-- ── RLS phase ───────────────────────────────────────────────────────────────
-- Helper (created postgres-side, SECURITY INVOKER by default → runs as the
-- caller): asserts that p_limit images are accepted and p_limit + 1 are
-- rejected, raising 'FAIL: ...' on any mismatch. Every sneaky insert is
-- wrapped in BEGIN/EXCEPTION; the listing INSERT goes through the RLS policy
-- (listings_insert_own, WITH CHECK auth.uid() = user_id), so the JWT sub must
-- match p_user_id — the caller sets it right before each invocation.
--
-- NOTE on the reject detection: a plain "INSERT; RAISE FAIL (accepted)"
-- inside a BEGIN...EXCEPTION block is a FALSE-POSITIVE trap — the FAIL raise
-- after a successful insert is swallowed by that same exception handler and
-- counted as a rejection, so a bypassed guard would silently pass. The
-- v_guard_raised flag separates "the INSERT raised" (guard engaged) from
-- "the INSERT succeeded" (guard bypassed), and the bypass FAIL lives OUTSIDE
-- the handler so it always aborts the test.
CREATE OR REPLACE FUNCTION public.w5_assert_max_images(p_user_id uuid, p_limit int, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_ok int := 0;
  v_rejected int := 0;
  v_guard_raised boolean := false;
BEGIN
  -- p_limit images must be accepted (normal publish flow).
  BEGIN
    INSERT INTO public.listings (user_id, title, images)
    VALUES (p_user_id, p_label || ' accept',
            (SELECT to_jsonb(array_fill('x'::text, ARRAY[p_limit]))));
    v_ok := v_ok + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL: % — % images rejected: %', p_label, p_limit, SQLERRM;
  END;

  -- p_limit + 1 images must be rejected by the guard.
  BEGIN
    INSERT INTO public.listings (user_id, title, images)
    VALUES (p_user_id, p_label || ' reject',
            (SELECT to_jsonb(array_fill('x'::text, ARRAY[p_limit + 1]))));
    v_guard_raised := false;
  EXCEPTION WHEN OTHERS THEN
    v_guard_raised := true;
  END;

  IF NOT v_guard_raised THEN
    RAISE EXCEPTION 'FAIL: % — % images accepted (guard bypass)', p_label, p_limit + 1;
  END IF;
  v_rejected := v_rejected + 1;

  IF v_ok <> 1 OR v_rejected <> 1 THEN
    RAISE EXCEPTION 'FAIL: % — expected 1 accepted / 1 rejected, got % / %', p_label, v_ok, v_rejected;
  END IF;
END;
$$;

SET ROLE authenticated;

-- a) free: 3 OK, 4 REJECTED
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d1', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
SELECT public.w5_assert_max_images('00000000-0000-4000-8000-0000000000d1', 3, 'a) free');

-- b) trial (trial = premium): 20 OK, 21 REJECTED
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d2', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
SELECT public.w5_assert_max_images('00000000-0000-4000-8000-0000000000d2', 20, 'b) trial');

-- c) estandar paid: 10 OK, 11 REJECTED
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d3', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true);
SELECT public.w5_assert_max_images('00000000-0000-4000-8000-0000000000d3', 10, 'c) estandar');

-- d) premium paid: 20 OK, 21 REJECTED
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d4', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
SELECT public.w5_assert_max_images('00000000-0000-4000-8000-0000000000d4', 20, 'd) premium');

-- f) expired-trial (status 'trial', past end) → falls back to free: 3 OK, 4 REJECTED
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d5', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d5","role":"authenticated"}', true);
SELECT public.w5_assert_max_images('00000000-0000-4000-8000-0000000000d5', 3, 'f) expired-trial');

-- g) mixed: status 'trial' + future end + ACTIVE estandar sub → PAID wins
--    (estandar 10, NOT premium 20) — mirrors feature_listing and the
--    reordered getEffectivePlan in src/lib/subscription.ts.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d6', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d6","role":"authenticated"}', true);
SELECT public.w5_assert_max_images('00000000-0000-4000-8000-0000000000d6', 10, 'g) mixed trial+active estandar');

-- e) non-array images payload must be rejected outright. Runs as the free
--    user again (JWT back to d1 so the listing INSERT passes RLS and the
--    guard's own non-array rejection is what gets exercised).
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d1', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);

DO $$
DECLARE v_guard_raised boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.listings (user_id, title, images)
    VALUES ('00000000-0000-4000-8000-0000000000d1', 'e) non-array', '{"a":1}'::jsonb);
    v_guard_raised := false;
  EXCEPTION WHEN OTHERS THEN
    v_guard_raised := true;
  END;

  IF NOT v_guard_raised THEN
    RAISE EXCEPTION 'FAIL: e) non-array — images object accepted (guard bypass)';
  END IF;
END $$;

-- UPDATE path: the trigger fires on UPDATE OF images. Bumping the free user's
-- accepted listing from 3 to 4 images must be rejected; a same-limit UPDATE
-- must still pass.
DO $$
DECLARE v_guard_raised boolean := false; v_listing uuid;
BEGIN
  SELECT id INTO v_listing FROM public.listings
   WHERE user_id = '00000000-0000-4000-8000-0000000000d1'
     AND title = 'a) free accept'
   LIMIT 1;
  IF v_listing IS NULL THEN
    RAISE EXCEPTION 'FAIL: update path — accepted listing not found';
  END IF;

  BEGIN
    UPDATE public.listings SET images = (SELECT to_jsonb(array_fill('x'::text, ARRAY[4])))
     WHERE id = v_listing;
    v_guard_raised := false;
  EXCEPTION WHEN OTHERS THEN
    v_guard_raised := true;
  END;

  IF NOT v_guard_raised THEN
    RAISE EXCEPTION 'FAIL: update path — 4-image UPDATE accepted (guard bypass)';
  END IF;

  BEGIN
    UPDATE public.listings SET images = (SELECT to_jsonb(array_fill('x'::text, ARRAY[3])))
     WHERE id = v_listing;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL: update path — 3-image UPDATE rejected: %', SQLERRM;
  END;
END $$;

-- ── Back to postgres: system-writer bypass, visible confirmation, verdict ───
RESET ROLE;

-- System-writer bypass: as postgres with NO JWT, auth.uid() IS NULL → the
-- guard skips entirely. A 25-image listing (way over premium) must be
-- ACCEPTED — same trust boundary as the featured guards: the count guard
-- constrains authenticated client writes; system writers carry their own
-- access control. A rejection here is a FAIL.
DO $$
BEGIN
  INSERT INTO public.listings (user_id, title, images)
  VALUES ('00000000-0000-4000-8000-0000000000d1', 'sys 25 images accepted',
          (SELECT to_jsonb(array_fill('x'::text, ARRAY[25]))));
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL: system-writer bypass — 25-image system INSERT rejected: %', SQLERRM;
END $$;

SELECT 'w5 guard exercised through RLS' AS check_name,
       (SELECT max_images FROM public.subscription_plans WHERE slug = 'estandar') AS estandar_limit,
       (SELECT max_images FROM public.subscription_plans WHERE slug = 'premium') AS premium_limit,
       count(*) AS listings_inserted_via_rls
FROM public.listings
WHERE user_id IN
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2',
   '00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000d4',
   '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d6');

-- Final verdict (SELECT output is visible even when NOTICEs are suppressed)
SELECT 'VERIFICATION PASSED — max images server guard' AS result;

ROLLBACK;
