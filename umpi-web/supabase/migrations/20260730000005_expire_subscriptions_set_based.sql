-- Migration: expire_subscriptions set-based rewrite
--
-- 20260730000001 shipped the OLD row-by-row expire_subscriptions() loop, and
-- that migration is ALREADY APPLIED to production — editing it in place would
-- silently never deploy. This migration ships the same behavior as a set-based
-- rewrite: one UPDATE for the subscriptions, one UPDATE for the profiles, no
-- PL/pgSQL loop. It must run AFTER 20260730000001 (which defined the function)
-- and after the original expire_featured_listings, which it calls.
--
-- Semantics are identical to the committed version:
--   1. Expire every active subscription past its expiry date.
--   2. Clear subscription_type on the affected profiles.
--   3. Deactivate featured listings whose featured_until passed
--      (via expire_featured_listings — a featured spot lasts the full
--      duration the user paid for).

CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Set-based: expire every active subscription past its expiry in a single
  -- UPDATE, then clear subscription_type on the affected profiles.
  -- Featured listings are intentionally NOT touched here: a featured spot
  -- lasts until featured_until (handled by expire_featured_listings below).
  WITH expired AS (
    UPDATE subscriptions
    SET status = 'expired'
    WHERE status = 'active' AND expires_at < NOW()
    RETURNING user_id
  )
  UPDATE profiles
  SET subscription_type = 'none'
  WHERE id IN (SELECT user_id FROM expired);

  -- Also expire any featured listings whose time is up
  PERFORM public.expire_featured_listings();
END;
$$;

-- Grant execution to service_role (for scheduled tasks); kept identical to
-- the grants the codebase applies to this function elsewhere (esqueleto).
GRANT ALL ON FUNCTION public.expire_subscriptions() TO anon;
GRANT ALL ON FUNCTION public.expire_subscriptions() TO authenticated;
GRANT ALL ON FUNCTION public.expire_subscriptions() TO service_role;
