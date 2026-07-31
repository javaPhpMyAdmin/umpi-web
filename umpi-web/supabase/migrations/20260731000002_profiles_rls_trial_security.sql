-- Migration: profiles RLS hardening — lock sensitive columns, remove client
-- INSERT/DELETE, idempotent signup trigger, consume trials on purchase.
--
-- Security audit fixes:
--   C1+C2   Two permissive UPDATE policies ("Users can update own profile",
--           public, no WITH CHECK; "profiles_update_own", authenticated,
--           WITH CHECK only on id) let any user PATCH subscription_status /
--           trial_ends_at / subscription_type / is_admin → self-grant
--           premium and escalate to admin. Replaced by a two-layer guard:
--             * profiles_update_own (policy) — scope: own row only
--               (USING/WITH CHECK auth.uid() = id).
--             * check_privileged_profile_update_trigger (BEFORE UPDATE) —
--               the column lock: rejects any change to a derived / privileged
--               column (incl. created_at) while still allowing edits to the
--               editable fields (full_name, avatar_url, phone, location).
--           The column lock lives in a trigger, NOT in the policy WITH CHECK,
--           because the Supabase CLI (effect/sql, 2.110.0) fails to execute
--           CREATE POLICY expressions referencing NEW/OLD (42P01 "missing
--           FROM-clause entry for table new"). A trigger also fails loudly
--           with a clear message instead of the opaque RLS violation, and the
--           SECURITY INVOKER role check (auth.uid() IS NOT NULL) makes it a
--           no-op for system writers (postgres, service_role without JWT) —
--           the same shape as the listings featured guards.
--   C3      "Users can insert own profile" (public), "profiles_insert_own"
--           and "profiles_delete_own" (authenticated) let the client create
--           and delete profile rows (trial re-claim = DELETE + INSERT).
--           Dropped — the handle_new_user trigger is the only profile writer.
--   mini-W3 handle_new_user is now idempotent (ON CONFLICT (id) DO NOTHING)
--           and never aborts signup; duplicate rows are silent, any other
--           failure raises a WARNING so it stays observable in trigger logs.
--           It persists Google OAuth name/picture from raw_user_meta_data
--           (previously the client inserted those). A repair backfill gives
--           existing orphan users a bare profile row (no trial re-claim).
--   W2      Backfill: a user still flagged 'trial' with an ACTIVE
--           subscription (any plan) has already redeemed the trial → consume
--           it (status 'paid', trial_ends_at NULL). Paid writers (mp-webhook
--           / sync-subscription) write status='paid' + trial_ends_at=NULL on
--           authorize, so buying consumes the trial and cancelling after
--           (subscription_type='none') never re-grants trial benefits.

-- trial_featured_used is declared here (C4 column) because the UPDATE policy
-- below references it in WITH CHECK. The C4 migration re-declares it with
-- IF NOT EXISTS as a no-op, keeping both migrations self-contained.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_featured_used integer NOT NULL DEFAULT 0;

-- ── C1+C2: own-row UPDATE policy (scope) + column-lock trigger ──────────────
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Column lock (BEFORE UPDATE): rejects any change to derived / privileged
-- columns. SECURITY INVOKER — runs as the DML role, so auth.uid() reflects
-- the real client and system writers (postgres / service_role without JWT)
-- bypass automatically. Editable fields (full_name, avatar_url, phone,
-- location) pass through unchanged.
-- Bypass note: SECURITY DEFINER writers such as feature_listing run as
-- postgres while the session keeps the client JWT, so auth.uid() is NOT NULL
-- even though the write is system-originated. Mirror the listings-guard rule:
-- current_user = 'postgres' → system write → bypass. current_user is not
-- spoofable (SET ROLE postgres requires superuser or role membership).
CREATE OR REPLACE FUNCTION public.prevent_privileged_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF current_user = 'postgres' THEN
      RETURN NEW;
    END IF;
    IF NEW.subscription_type IS NOT DISTINCT FROM OLD.subscription_type
       AND NEW.subscription_status IS NOT DISTINCT FROM OLD.subscription_status
       AND NEW.subscription_expires_at IS NOT DISTINCT FROM OLD.subscription_expires_at
       AND NEW.trial_ends_at IS NOT DISTINCT FROM OLD.trial_ends_at
       AND NEW.trial_featured_used IS NOT DISTINCT FROM OLD.trial_featured_used
       AND NEW.is_admin IS NOT DISTINCT FROM OLD.is_admin
       AND NEW.rating IS NOT DISTINCT FROM OLD.rating
       AND NEW.total_sales IS NOT DISTINCT FROM OLD.total_sales
       AND NEW.total_listings IS NOT DISTINCT FROM OLD.total_listings
       AND NEW.reviews_count IS NOT DISTINCT FROM OLD.reviews_count
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only system processes can modify privileged profile fields';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_privileged_profile_update_trigger ON public.profiles;
CREATE TRIGGER check_privileged_profile_update_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_privileged_profile_update();

-- Trigger functions are invoked by the executor without EXECUTE checks, so
-- revoking the default PUBLIC execute closes the direct-call surface.
REVOKE ALL ON FUNCTION public.prevent_privileged_profile_update() FROM PUBLIC, anon, authenticated;

-- ── C3: no client INSERT/DELETE on profiles ────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;

-- ── mini-W3: idempotent, never-aborting signup trigger with OAuth metadata ─
-- Trial clock: the trial starts when GoTrue creates the auth.users row — the
-- magic-link request or email signup — NOT on first login. Accepted contract
-- change, consistent with email signup (the trigger fires on any INSERT, so
-- a user who never opens the link already consumes the trial window).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, subscription_status, trial_ends_at)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture',
      NULL
    ),
    'trial',
    NOW() + INTERVAL '30 days'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never abort signup. A duplicate profile row (SQLSTATE 23505) is a benign
  -- race — another writer won; stay silent. Any OTHER failure must still not
  -- block the auth flow, but has to be visible in the trigger logs, otherwise
  -- a user would silently end up without a profile forever.
  IF SQLSTATE = '23505' THEN
    RETURN NEW;
  END IF;
  RAISE WARNING 'handle_new_user: profile creation failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── Repair backfill: users who never got a profile row ──────────────────────
-- Any auth user without a profile (e.g. rows created while the old trigger
-- failed silently, or pre-trigger signups) gets a BARE row: id only, status
-- 'none', no trial. Explicit values keep assign_trial_on_signup from granting
-- a fresh trial to these pre-existing users.
INSERT INTO public.profiles (id, subscription_status, trial_ends_at)
SELECT id, 'none', NULL
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

-- ── W2 backfill: consume trials already redeemed with a purchase ───────────
-- A user still flagged 'trial' who has an ACTIVE subscription (any plan —
-- premium or estandar) has used their trial window; flip them to 'paid' with
-- no trial so they cannot re-claim trial benefits after a future
-- cancellation. Users whose subscription already expired/cancelled keep
-- their trial flag untouched (their premium is dead, so nothing to consume).
UPDATE public.profiles p
SET subscription_status = 'paid',
    trial_ends_at = NULL
WHERE p.subscription_status = 'trial'
  AND EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = p.id
      AND s.status = 'active'
  );
