-- Migration: admin panel — admin_list_users() server-side RPC (PR 1 of admin-panel)
--
-- WHY: the admin panel needs user statistics, a user roster with active-listing
-- counts, and an active-subscriptions overview. That data lives in auth.users
-- + profiles + listings (+ subscriptions / subscription_plans, which exist only
-- in the dump). auth.users is NOT readable through RLS — no policy can expose
-- it — so the only safe path is a SECURITY DEFINER RPC owned by postgres that
-- enforces the admin gate itself, in-body, exactly like record_legal_consent
-- (20260731000005).
--
-- ACCESS CONTROL (all server-side; the caller is derived ONLY from auth.uid(),
-- never from a parameter):
--   1. auth.uid() NULL → RAISE 'not authenticated' (no JWT → anonymous or
--      session-less caller).
--   2. profiles.is_admin ≠ true for the caller → RAISE 'admin access required'
--      (PII-free message — no admin email, no role hints; pinned by the verify
--      test so it cannot drift).
--   No caller-supplied id parameter can select another user — the anti-
--   get_user_views stance: a param-based variant would let any authenticated
--   caller read any email by passing an arbitrary id.
--
-- PAYLOAD: one jsonb { stats, users, subscriptions } round-trip:
--   * stats — total users + new users today / this week, from auth.users
--     created_at (D5: registration date; backfilled orphans skew
--     profiles.created_at). ISO week via date_trunc('week') (D6).
--   * users — auth.users ⋈ profiles ⋈ LATERAL active-listing count
--     (listings.status = 'active'), newest registration first, COALESCE '[]'.
--   * subscriptions — ACTIVE rows only (status = 'active') joined to
--     subscription_plans for the plan name and auth.users for the payer email.
--
-- DUMP-ONLY DEGRADATION: subscriptions / subscription_plans exist only in
-- esqueleto_proyecto.sql; on a migrations-only replay (staging, disaster
-- recovery) they are absent and the RPC returns '[]'::jsonb for subscriptions
-- instead of crashing — same guard philosophy as 20260801000004 /
-- 20260801000002 (D4).
--
-- GRANTS (template-identical to record_legal_consent): Supabase default
-- privileges grant EXECUTE on every new function to anon/authenticated (see
-- 20260730000007). Revoke everything, then open EXECUTE to authenticated only.
-- service_role keeps access via the superuser path — no explicit grant (D7).
--
-- Rollback: DROP FUNCTION public.admin_list_users();

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_stats jsonb;
  v_users jsonb;
  v_subscriptions jsonb;
BEGIN
  -- Gate 1: a JWT is required — anonymous / service-role callers without a
  -- user session never reach the payload.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Gate 2: the caller's own profile must carry the admin flag. The profiles
  -- column lock (20260731000002) blocks client-side self-grants, so this flag
  -- is only settable by postgres / service_role.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND is_admin
  ) THEN
    RAISE EXCEPTION 'admin access required';
  END IF;

  -- Stats: registration date comes from auth.users.created_at (D5).
  SELECT jsonb_build_object(
    'total_users', count(*),
    'new_users_today', count(*) FILTER (WHERE created_at >= date_trunc('day', now())),
    'new_users_this_week', count(*) FILTER (WHERE created_at >= date_trunc('week', now()))
  )
  INTO v_stats
  FROM auth.users;

  -- Users: roster + active-listing count, newest registration first.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'full_name', p.full_name,
        'created_at', u.created_at,
        'subscription_type', p.subscription_type,
        'subscription_status', p.subscription_status,
        'subscription_expires_at', p.subscription_expires_at,
        'trial_ends_at', p.trial_ends_at,
        'active_listings_count', al.active_count
      )
      ORDER BY u.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_users
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  LEFT JOIN LATERAL (
    SELECT count(*) AS active_count
    FROM public.listings l
    WHERE l.user_id = u.id AND l.status = 'active'
  ) al ON true;

  -- Subscriptions: active-only, dump-guarded (D4). On a migrations-only
  -- replay the tables are absent → empty array, never a crash.
  IF to_regclass('public.subscriptions') IS NULL
     OR to_regclass('public.subscription_plans') IS NULL
  THEN
    v_subscriptions := '[]'::jsonb;
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'payer_email', u.email,
          'plan_name', sp.name,
          'status', s.status,
          'started_at', s.started_at,
          'expires_at', s.expires_at
        )
        ORDER BY s.created_at DESC
      ),
      '[]'::jsonb
    )
    INTO v_subscriptions
    FROM public.subscriptions s
    JOIN public.subscription_plans sp ON sp.id = s.plan_id
    JOIN auth.users u ON u.id = s.user_id
    WHERE s.status = 'active';
  END IF;

  RETURN jsonb_build_object(
    'stats', v_stats,
    'users', v_users,
    'subscriptions', v_subscriptions
  );
END;
$$;

ALTER FUNCTION public.admin_list_users() OWNER TO postgres;

-- Supabase default privileges grant EXECUTE on every new function to
-- anon/authenticated (see 20260730000007). Revoke everything, then open the
-- RPC to authenticated only — anon must never reach it.
REVOKE ALL ON FUNCTION public.admin_list_users() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
