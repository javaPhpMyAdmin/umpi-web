-- Migration: subscriptions RLS — move out-of-band dump RLS into migrations
--
-- WHY: audit finding W4 (trial/security audit, 2026-07-31). RLS on
-- public.subscriptions existed ONLY in esqueleto_proyecto.sql (the original
-- dump, applied out-of-band). No migration enabled RLS or created a policy
-- for this table, so a FRESH environment rebuilt purely from migrations
-- (staging, another Supabase project, disaster recovery) would have billing
-- rows with NO row-level security. subscription_plans was already covered by
-- 20260718000003; subscriptions was the missing billing table.
--
-- NOTE: no migration creates public.subscriptions today — it only exists in
-- esqueleto_proyecto.sql (the dump). The DO-block guard below makes this
-- migration a safe no-op if the table is ever absent, so it cannot abort a
-- migrations-only replay; the RLS takes effect as soon as the table exists.
--
-- WHAT THIS ADDS:
--   1. ENABLE RLS (idempotent; safe if a fresh dump already enabled it).
--   2. subscriptions_select_own — the same policy the dump ships: an
--      authenticated user can SELECT only their own subscription rows. No
--      INSERT/UPDATE/DELETE policies: client writes are not part of the
--      product (subscriptions are written by service_role edge functions:
--      create-subscription / sync-subscription / cancel-subscription /
--      mp-webhook) and the trial flow is profile-only. The only client read
--      is useFeaturedRemaining.ts (.from('subscriptions').select(...).
--      eq('user_id', session.user.id)), which this policy covers.
--   3. Grant hygiene matching 20260731000005 (legal_consents): revoke ALL
--      from anon + authenticated, then re-open SELECT for authenticated
--      only. The dump granted ALL to anon/authenticated; RLS makes those
--      writes inert today, but the grants are a foot-gun if RLS is ever
--      disabled or bypassed. service_role keeps its full grants (edge
--      functions), postgres owner is unaffected.
--
-- Convention: idempotent DROP POLICY IF EXISTS + CREATE, same style as
-- 20260718000003 and the legal consent hardening. Wrapped in a DO block with
-- a to_regclass guard: DROP POLICY IF EXISTS only tolerates a missing
-- POLICY, not a missing TABLE, and REVOKE/GRANT have no IF EXISTS — so on a
-- fresh environment where subscriptions does not exist yet, the guard keeps
-- this migration a no-op instead of aborting the migration chain.

DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
  CREATE POLICY "subscriptions_select_own"
    ON public.subscriptions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

  -- Client roles: authenticated keeps SELECT only; anon gets nothing on a
  -- billing table. service_role grants are untouched (edge functions).
  REVOKE ALL ON public.subscriptions FROM anon;
  REVOKE ALL ON public.subscriptions FROM authenticated;
  GRANT SELECT ON public.subscriptions TO authenticated;
END;
$$;
