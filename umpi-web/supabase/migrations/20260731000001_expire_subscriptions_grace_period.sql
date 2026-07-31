-- Migration: expire_subscriptions effective-expiry fallback + 3-day grace
--
-- 20260730000005 shipped the set-based expire_subscriptions(), but its WHERE
-- clause (expires_at < NOW()) never fires in practice: subscriptions.expires_at
-- is copied from MercadoPago's preapproval.next_billing_date, and MP TEST mode
-- returns null for that field, so expires_at stays NULL on every row and the
-- cron never expires anyone.
--
-- This migration replaces the function so it expires by EFFECTIVE expiry, the
-- best signal available for a subscription:
--   1. expires_at                          (real next billing date from MP, when present)
--   2. period_start + featured_duration_days  (both plans are 30 days)
--   3. created_at + interval '30 days'     (last-resort fallback)
-- …plus a 3-day grace period so a subscription only flips once it is truly
-- past its renewal date. Profile behavior now matches the other writers
-- (webhook, sync, cancel): subscription_type -> 'none' AND
-- subscription_expires_at is cleared. expire_featured_listings() is still
-- called at the end.
--
-- The "30 days" used as the tier-3 fallback and as the COALESCE default for
-- the plan duration is a backup period: keep it aligned with
-- subscription_plans.featured_duration_days (both plans are 30 today).
--
-- Must run AFTER 20260730000005 (the set-based version it replaces).

CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Set-based: expire every active subscription whose EFFECTIVE expiry
  -- (+ 3-day grace) is in the past, then clear subscription_type AND
  -- subscription_expires_at on the affected profiles. Featured listings are
  -- intentionally NOT touched here: a featured spot lasts until
  -- featured_until (handled by expire_featured_listings below).
  --
  -- LEFT JOIN on subscription_plans: subscriptions.plan_id is nullable and
  -- its FK is ON DELETE SET NULL, so rows without a matching plan must still
  -- be evaluated — GREATEST(COALESCE(..., 30), 30) makes them fall through to
  -- the tier-3 fallback (created_at + 30 days) instead of never expiring, and
  -- also protects against a plan seeded with featured_duration_days = 0 (the
  -- column DEFAULT is 0).
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
  UPDATE profiles
  SET subscription_type = 'none', subscription_expires_at = NULL
  WHERE id IN (SELECT user_id FROM expired);

  -- Also expire any featured listings whose time is up
  PERFORM public.expire_featured_listings();
END;
$$;

-- Security posture preserved from 20260730000007 (commit 6971f78), which
-- deliberately revoked client grants on admin functions: expire_subscriptions
-- is SECURITY DEFINER, and any anon/authenticated EXECUTE would let an
-- unauthenticated client revoke ALL subscriptions via PostgREST. Only
-- service_role may run it (cron / Edge Function). The REVOKE also re-covers
-- this function in case a previous migration ever granted it to clients.
--
-- IMPORTANT: PostgreSQL grants EXECUTE to PUBLIC on every new function by
-- default, and revoking from anon/authenticated does NOT close that path
-- (anon reaches the function through PUBLIC). Verified live right before this
-- migration: pg_proc.proacl for expire_subscriptions was
-- {=X/postgres, postgres=X/postgres, service_role=X/postgres} — PUBLIC still
-- had EXECUTE. REVOKE FROM PUBLIC closes it for good. The same live exposure
-- existed on expire_featured_listings (SECURITY DEFINER too: PUBLIC + anon +
-- authenticated had EXECUTE), so it gets the same hardening here; an
-- unauthenticated client could otherwise mass-expire featured listings.
REVOKE ALL ON FUNCTION public.expire_subscriptions() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_subscriptions() FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_subscriptions() TO service_role;

REVOKE ALL ON FUNCTION public.expire_featured_listings() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_featured_listings() FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_featured_listings() TO service_role;
