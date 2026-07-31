-- Deterministic verification for expire_subscriptions() effective-expiry logic
-- (migration 20260731000001).
--
-- Covers the contract change the migration introduces:
--   1. Tier-2 fallback: active sub with expires_at NULL + a plan and an old
--      period_start expires (period_start + featured_duration_days).
--   2. Tier-3 fallback: active sub with expires_at NULL and NO plan (LEFT JOIN
--      path) falls through to created_at + 30 days and expires.
--   3. Control: active sub with expires_at in the future stays active.
--   4. Profile is cleared (subscription_type='none', subscription_expires_at NULL).
--
-- Safe to run on a live database: everything runs inside one transaction that
-- ROLLBACKs at the end. No data is persisted.
--
-- Run with:
--   supabase db query --linked --workdir traspaso-supabase -f supabase/tests/expire_subscriptions_verify.sql
-- (or pipe the file into the query command)

BEGIN;

DO $$
DECLARE
  v_user uuid := 'dad4abc3-79e0-446b-ac3e-d37da0eef747';
  v_plan uuid;
  v_expired_via_plan uuid;
  v_expired_via_created uuid;
  v_stays_active uuid;
BEGIN
  SELECT id INTO v_plan FROM subscription_plans ORDER BY price DESC LIMIT 1;

  -- 1) Tier-2 fallback: expires_at NULL, has plan, period_start 40 days ago
  INSERT INTO subscriptions (id, user_id, plan_id, status, period_start, created_at, mp_preapproval_id)
  VALUES (gen_random_uuid(), v_user, v_plan, 'active', now() - interval '40 days', now() - interval '40 days', 'verify-tier2')
  RETURNING id INTO v_expired_via_plan;

  -- 2) Tier-3 fallback: expires_at NULL, NO plan (LEFT JOIN path), created 40 days ago
  INSERT INTO subscriptions (id, user_id, plan_id, status, period_start, created_at, mp_preapproval_id)
  VALUES (gen_random_uuid(), v_user, NULL, 'active', now() - interval '40 days', now() - interval '40 days', 'verify-tier3')
  RETURNING id INTO v_expired_via_created;

  -- 3) Control: expires_at 10 days in the future -> must NOT expire
  INSERT INTO subscriptions (id, user_id, plan_id, status, expires_at, period_start, created_at, mp_preapproval_id)
  VALUES (gen_random_uuid(), v_user, NULL, 'active', now() + interval '10 days', now() - interval '5 days', now() - interval '5 days', 'verify-control')
  RETURNING id INTO v_stays_active;

  -- Mark the profile paid so we can assert it gets cleared (ROLLBACK restores it)
  UPDATE profiles SET subscription_type = 'premium', subscription_expires_at = now() + interval '5 days' WHERE id = v_user;

  PERFORM public.expire_subscriptions();

  IF (SELECT status FROM subscriptions WHERE id = v_expired_via_plan) <> 'expired' THEN
    RAISE EXCEPTION 'FAIL: tier-2 sub did not expire';
  END IF;
  IF (SELECT status FROM subscriptions WHERE id = v_expired_via_created) <> 'expired' THEN
    RAISE EXCEPTION 'FAIL: tier-3 sub did not expire';
  END IF;
  IF (SELECT status FROM subscriptions WHERE id = v_stays_active) <> 'active' THEN
    RAISE EXCEPTION 'FAIL: control sub was wrongly expired';
  END IF;
  IF (SELECT subscription_type FROM profiles WHERE id = v_user) <> 'none' THEN
    RAISE EXCEPTION 'FAIL: profile subscription_type not cleared';
  END IF;
  IF (SELECT subscription_expires_at FROM profiles WHERE id = v_user) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: profile subscription_expires_at not cleared';
  END IF;

  RAISE NOTICE 'VERIFICATION PASSED: tier-2 expired, tier-3 expired, control stayed active, profile cleared';
END $$;

-- Visible PASS marker (the CLI suppresses NOTICEs)
SELECT 'VERIFICATION PASSED: tier-2 expired, tier-3 expired, control stayed active, profile cleared' AS result;

ROLLBACK;
