-- Migration: expire featured listings when featured_until passes
-- 
-- This function sets is_featured = false for any listing whose
-- featured_until date has passed. It runs independently of
-- subscription cancellation/expiry so that users keep their
-- featured spot for the full duration they paid for.

CREATE OR REPLACE FUNCTION public.expire_featured_listings()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE listings
  SET
    is_featured = false,
    listing_priority = 0
  WHERE
    is_featured = true
    AND featured_until IS NOT NULL
    AND featured_until < NOW();
END;
$$;

-- Also hook it into the existing expire_subscriptions function
-- so both run together whenever subscriptions are checked
CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  sub RECORD;
BEGIN
  FOR sub IN
    SELECT id, user_id FROM subscriptions
    WHERE status = 'active' AND expires_at < NOW()
  LOOP
    UPDATE subscriptions SET status = 'expired' WHERE id = sub.id;
    UPDATE profiles SET subscription_type = 'none' WHERE id = sub.user_id;
  END LOOP;

  -- Also expire any featured listings whose time is up
  PERFORM public.expire_featured_listings();
END;
$$;

-- Grant execution to service_role (for scheduled tasks)
ALTER FUNCTION public.expire_featured_listings() OWNER TO postgres;
GRANT ALL ON FUNCTION public.expire_featured_listings() TO anon;
GRANT ALL ON FUNCTION public.expire_featured_listings() TO authenticated;
GRANT ALL ON FUNCTION public.expire_featured_listings() TO service_role;
