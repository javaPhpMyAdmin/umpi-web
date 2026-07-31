-- Migration: revoke client grants on admin functions
-- Date: 2026-07-30
-- Purpose: Supabase default privileges (ALTER DEFAULT PRIVILEGES ... GRANT ALL
--          ON FUNCTIONS TO anon/authenticated) grant EXECUTE to client roles
--          on every newly created function. 20260730000003 and 20260730000005
--          only did REVOKE FROM PUBLIC + GRANT to service_role, which does NOT
--          undo the direct role grants added by default privileges. The dump
--          after applying 00003/00005 showed:
--
--            GRANT ALL ON bump_rate_limit(uuid, text) TO anon;
--            GRANT ALL ON bump_rate_limit(uuid, text) TO authenticated;
--            GRANT ALL ON expire_subscriptions() TO anon;
--            GRANT ALL ON expire_subscriptions() TO authenticated;
--
--          bump_rate_limit is SECURITY DEFINER with a caller-supplied
--          p_user_id: any logged-in client could inflate ANY user's counter
--          (deny a victim in 4 calls). expire_subscriptions is a maintenance
--          function that must only run as service_role (cron / Edge Function).
--          This migration revokes those client grants explicitly.
--
--          Intentionally left untouched (needed by design):
--            * fn_touch_conversation_on_message — the messages trigger runs as
--              the INSERTing role (authenticated), which needs EXECUTE.
--            * search_listings_cards — called directly by the frontend with
--              the anon/authenticated role.

REVOKE ALL ON FUNCTION public.bump_rate_limit(uuid, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_subscriptions() FROM anon, authenticated;

-- Keep service_role grants explicit for the admin functions (idempotent).
GRANT ALL ON FUNCTION public.bump_rate_limit(uuid, text) TO service_role;
GRANT ALL ON FUNCTION public.expire_subscriptions() TO service_role;
