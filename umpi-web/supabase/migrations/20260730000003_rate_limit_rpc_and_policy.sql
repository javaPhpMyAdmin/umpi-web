-- Migration: secure rate_limits RLS + atomic bump_rate_limit RPC
-- Date: 2026-07-30
-- Purpose:
--   1. Drop the "Service role only" RLS policy on rate_limits. It had no role
--      check (USING (true) WITH CHECK (true)), so ANY authenticated client
--      could delete/reset their own rate-limit rows through PostgREST and
--      bypass the Edge Function limits entirely. Edge Functions call with the
--      service role, which bypasses RLS, so no policy is needed on this table.
--   2. Add bump_rate_limit: an atomic increment-and-return RPC so the Edge
--      Function limiter performs its read-modify-write in ONE round trip
--      instead of the old racy SELECT/UPDATE/upsert dance (which could lose
--      increments and bypass the limit under concurrency).

-- No role check → drop. (DROP POLICY is idempotent-safe on missing policy only
-- via IF EXISTS; the policy exists in 20260718000004.)
DROP POLICY IF EXISTS "Service role only" ON public.rate_limits;

-- Atomic per-minute counter bump. Returns the POST-increment count so the
-- caller decides allow/deny in a single round trip. Windows are calendar
-- minutes (date_trunc('minute', now())); all current Edge Function callers
-- use 60s windows, which aligns exactly.
CREATE OR REPLACE FUNCTION public.bump_rate_limit(
  p_user_id uuid,
  p_function_name text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_window_start timestamptz := date_trunc('minute', now());
  v_count integer;
BEGIN
  INSERT INTO public.rate_limits (user_id, function_name, window_start, request_count)
  VALUES (p_user_id, p_function_name, v_window_start, 1)
  ON CONFLICT (user_id, function_name, window_start)
  DO UPDATE SET request_count = rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  -- Opportunistic cleanup: delete rows older than 2 hours
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '2 hours';

  RETURN v_count;
END;
$$;

-- Edge Functions (service_role) are the sole callers. Do NOT grant to
-- anon/authenticated: with SECURITY DEFINER and a caller-supplied p_user_id,
-- any logged-in client could inflate ANY user's counter for ANY function
-- (deny a victim in 4 calls) — the exact hole this migration closes. Also
-- revoke the implicit PUBLIC execute so the RPC is truly service-only.
REVOKE ALL ON FUNCTION public.bump_rate_limit(uuid, text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bump_rate_limit(uuid, text) TO service_role;
