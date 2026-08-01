-- Migration: max_images — enforce the per-listing photo limit server-side (W5)
--
-- Audit finding: the max-images-per-listing limit was FRONTEND-ONLY.
-- src/lib/subscription.ts getMaxImages() (free 3 / estandar 10 / premium 20,
-- trial → premium) is enforced only in PublishPage / EditPage; a modified
-- client could POST /listings with an arbitrarily large images array and
-- bypass the plan quota entirely.
--
-- Fix: a BEFORE INSERT OR UPDATE OF images trigger on public.listings
-- (prevent_excessive_images) validates jsonb_array_length(NEW.images) against
-- the effective plan at write time:
--   * free (no trial, no active sub) → 3 (DEFAULT_LIMITS)
--   * trial (status 'trial', trial_ends_at in the future, AND no active
--     subscription) → premium limit (20)
--   * paid (active subscription row) → the plan's max_images
-- The trial branch mirrors feature_listing (20260731000003): trial wins ONLY
-- while there is no active subscription, so a paying user is never capped at
-- the trial quota. The paid branch is deterministic (newest active
-- subscription first, ORDER BY created_at DESC LIMIT 1) so the UI and the
-- guard can never disagree on which subscription is the active one.
--
-- SECURITY INVOKER (the default — this function must NOT be SECURITY
-- DEFINER) is CRITICAL here. If it were DEFINER, current_user would always
-- be 'postgres' and the current_user = 'postgres' bypass below would fire on
-- EVERY client write, defeating the guard. As INVOKER, the trigger runs as
-- the DML role and the same non-spoofable path separation as the featured
-- guards (20260731000003) and the profiles column lock (20260731000002)
-- applies:
--   * authenticated client writes (PostgREST) → current_user =
--     'authenticated' → the count check engages.
--   * system writers (service_role edge functions with no JWT) →
--     auth.uid() IS NULL → skip.
--   * SECURITY DEFINER RPCs owned by postgres (e.g. feature_listing) →
--     current_user = 'postgres' → bypass.
-- current_user is not spoofable: SET ROLE postgres requires superuser or role
-- membership, and anon/authenticated have neither.
--
-- Review-risk fixes:
--   * Side-channel guard: BEFORE ROW triggers fire before the RLS WITH CHECK,
--     so a malicious client could probe another user's tier by writing
--     listings with THEIR user_id and escalating image counts, reading the
--     plan from the error message ('máximo 3' vs 'máximo 20'). The trigger
--     now returns NEW without resolving anything when NEW.user_id differs
--     from auth.uid() — RLS still blocks the write, but the victim's limit
--     is never computed (no side channel). Mirrors the same trust boundary
--     as the profiles column lock.
--   * to_regclass degradation: subscriptions / subscription_plans exist only
--     in the dump (esqueleto_proyecto.sql); on a migrations-only replay
--     (staging, disaster recovery) they are absent and the trigger's
--     plan-resolution queries would fail every listing write. The trigger
--     now degrades to count-free pass-through when either table is missing —
--     same guard philosophy as 20260801000002_subscriptions_rls.sql. Once
--     the dump is applied, the limit is enforced with no migration replay.
--
-- Scope note: enforcement is COUNT-only (jsonb array length). The 10MB per
-- file size limit remains a storage-layer concern and is out of scope here.
--
-- No GRANTs are issued for the new function; the REVOKE below closes the
-- direct-call surface (trigger functions are invoked by the executor without
-- EXECUTE checks) — same convention as the featured guards and the profiles
-- column lock.

CREATE OR REPLACE FUNCTION public.prevent_excessive_images()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  v_max_images integer := 3; -- free default, matches src/lib/subscription.ts DEFAULT_LIMITS
  v_count integer := 0;
BEGIN
  -- Only engage for authenticated client writes; system writers (service_role,
  -- definer paths) have no JWT and skip — same convention as the featured guards.
  IF auth.uid() IS NOT NULL THEN
    IF current_user = 'postgres' THEN
      RETURN NEW; -- system process (definer RPCs / cron) passes
    END IF;

    -- Never resolve another user's plan: BEFORE ROW triggers fire before the
    -- RLS WITH CHECK, so probing with another user's id + various image counts
    -- would otherwise leak their tier via the error message. RLS still blocks
    -- the write; we just don't compute the victim's limit.
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RETURN NEW;
    END IF;

    -- subscriptions / subscription_plans exist only in the dump
    -- (esqueleto_proyecto.sql); on a migrations-only replay they are absent.
    -- Degrade instead of breaking every listing write — same guard philosophy
    -- as 20260801000002.
    IF to_regclass('public.subscriptions') IS NULL
       OR to_regclass('public.subscription_plans') IS NULL
    THEN
      RETURN NEW;
    END IF;

    -- images is jsonb; reject non-array payloads outright.
    IF NEW.images IS NOT NULL AND jsonb_typeof(NEW.images) <> 'array' THEN
      RAISE EXCEPTION 'images must be an array';
    END IF;
    v_count := COALESCE(jsonb_array_length(NEW.images), 0);

    -- Trial branch mirrors feature_listing (20260731000003): trial wins ONLY
    -- with no active paid subscription; trial = premium limits.
    PERFORM 1 FROM public.profiles p
      WHERE p.id = NEW.user_id
        AND p.subscription_status = 'trial'
        AND p.trial_ends_at > now()
        AND NOT EXISTS (
          SELECT 1 FROM public.subscriptions s
          WHERE s.user_id = NEW.user_id AND s.status = 'active'
        );
    IF FOUND THEN
      v_max_images := COALESCE(
        (SELECT max_images FROM public.subscription_plans WHERE slug = 'premium'),
        20
      );
    ELSE
      -- Paid branch: deterministic newest-first, same as feature_listing.
      SELECT sp.max_images INTO v_max_images
        FROM public.subscriptions s
        JOIN public.subscription_plans sp ON sp.id = s.plan_id
        WHERE s.user_id = NEW.user_id AND s.status = 'active'
        ORDER BY s.created_at DESC
        LIMIT 1;
      v_max_images := COALESCE(v_max_images, 3);
    END IF;

    IF v_count > v_max_images THEN
      RAISE EXCEPTION 'Llegaste al límite de fotos para tu plan (máximo %)', v_max_images;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_max_images_trigger ON public.listings;
CREATE TRIGGER check_max_images_trigger
  BEFORE INSERT OR UPDATE OF images ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_excessive_images();

-- Trigger functions are invoked by the executor without EXECUTE checks, so
-- revoking the default PUBLIC execute (and any role grants) closes the
-- direct-call surface without affecting trigger firing.
REVOKE ALL ON FUNCTION public.prevent_excessive_images() FROM public, anon, authenticated;
