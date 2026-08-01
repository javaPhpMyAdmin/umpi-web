-- Migration: expire_trials DB function + pg_cron schedule (audit finding W1)
--
-- WHY: the trial/security audit (2026-07-31) flagged W1 — trial expiry had no
-- reliable schedule. The design shipped an `expire-trials` EDGE function
-- (supabase/functions/expire-trials/index.ts, deleted in this change), but:
--   * it was never deployed to the edge functions project (traspaso-supabase),
--   * no pg_cron job called it (cron.job had expire_subscriptions,
--     fn_check_subscription_expiry, expire_featured_listings — all DB
--     functions, no HTTP job), and
--   * fn_check_subscription_expiry only writes "Suscripción por vencer"
--     notifications; it never touches trial status.
-- Result: profiles.subscription_status stayed 'trial' forever ("zombie"
-- trials), and the index created for this job in 20260726000001
-- (subscription_status, trial_ends_at) was never used.
--
-- IMPACT IS HYGIENE, NOT ENFORCEMENT: trial benefits are already cut at
-- call time — the frontend isInTrial/hasActiveBenefits check
-- trial_ends_at > now() (src/lib/subscription.ts) and the feature_listing
-- RPC gates on trial_ends_at > now() server-side (20260731000003). This
-- function makes the status column truthful and completes the original
-- design (clean-up job, same role as expire_subscriptions).
--
-- DESIGN: a DB function + pg_cron, matching the existing cron
-- infrastructure (all three current jobs call DB functions; no edge
-- function is involved). SECURITY DEFINER so it runs as postgres and
-- passes the prevent_privileged_profile_update hardening (the trigger
-- allows current_user = 'postgres' to modify privileged profile fields).
-- Grants mirror expire_subscriptions (20260730000007/20260731000001):
-- revoked from anon/authenticated, open to service_role only.

CREATE OR REPLACE FUNCTION public.expire_trials()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE profiles
  SET subscription_status = 'expired'
  WHERE subscription_status = 'trial'
    AND trial_ends_at IS NOT NULL
    AND trial_ends_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_trials() FROM public, anon, authenticated;
GRANT ALL ON FUNCTION public.expire_trials() TO service_role;

-- Schedule: daily 03:00, before the 06:00 expire_subscriptions run.
-- Idempotent: unschedule the same job name first (cron.schedule errors if
-- the name exists), then schedule. Guarded: on a fresh environment where
-- pg_cron is not installed (free tier, migrations-only replay) the whole
-- block is skipped instead of aborting the migration chain — the function
-- itself is the fix; the cron makes it automatic where available.
-- NOTE: the inner command uses $schedule$ (NOT $$) — a bare $$ inside the
-- DO block would terminate the outer dollar-quote and break the migration.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND to_regclass('cron.job') IS NOT NULL
  THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname = 'expire-trials-daily';

    PERFORM cron.schedule(
      'expire-trials-daily',
      '0 3 * * *',
      $schedule$SELECT public.expire_trials();$schedule$
    );
  END IF;
END;
$$;
