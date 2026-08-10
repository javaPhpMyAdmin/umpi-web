# Exploration: Admin Panel (Panel de Administración)

## Current State

**is_admin state (C2-hardened).** `profiles.is_admin boolean DEFAULT false` is defined ONLY in the dump (`esqueleto_proyecto.sql`), not in any migration. The security hardening commit `e442598` (migration `20260731000002_profiles_rls_trial_security.sql`) closed the C2 finding — the old permissive UPDATE policies let any user PATCH `is_admin = true` (self-grant admin). Today:
- RLS: single `profiles_update_own` policy scoping UPDATE to the caller's own row (`auth.uid() = id`).
- Column lock: `prevent_privileged_profile_update()` BEFORE UPDATE trigger rejects changes to 11 privileged columns — including `is_admin`, `subscription_status`, `trial_ends_at`, `created_at` — unless `current_user = 'postgres'` (system writer). Clients can only edit `full_name, avatar_url, phone, location`.
- `is_admin` is set by the developer/client via SQL only (postgres role). Verified by `supabase/tests/trial_security_verify.sql` (`a1 blocked columns` test: 11 rejected, 0 escalated).
- Frontend exposure: `AuthContext` fetches the full profile row (`select('*')`) into the `Profile` type (`src/types/index.ts` line 57: `is_admin: boolean`), exposed via `useAuth().profile`.

**Profiles schema.** Columns: `id (uuid PK)`, `full_name`, `avatar_url`, `phone`, `rating`, `total_sales`, `total_listings`, `subscription_type`, `subscription_expires_at`, `location`, `is_admin`, `created_at`, `reviews_count` (dump) + `subscription_status`, `trial_ends_at` (20260726000001), `trial_featured_used` (20260731000002). **NO email column.** Relations: `subscriptions.user_id` → `profiles.id` (`subscriptions`: `user_id`, `plan_id` → `subscription_plans.id`, `status`, `started_at`, `expires_at`, `created_at`, `mp_preapproval_id`, `featured_used`, `period_start`); `listings.user_id` → `profiles.id`.

**Reading all users — email requires a definer RPC.** `auth.users` is NOT queryable by the client SDK (PostgREST exposes only `public` to anon/authenticated; the `auth` schema is internal). Email + authoritative registration date live ONLY in `auth.users`. `profiles.created_at` is a trigger-written proxy that coincides with signup for normal users, but the 20260731000002 repair backfill inserted bare rows with `created_at = now()` for orphan users — so it is NOT a reliable registration date for those. Conclusion: an admin user list with email + true registration date REQUIRES a `SECURITY DEFINER` function joining `auth.users` (runs as postgres, bypasses the auth-schema restriction). A plain RLS policy granting admins SELECT on all profiles would still not yield email — the RPC is unavoidable.

**Existing SECURITY DEFINER RPC templates.**
- `record_legal_consent(p_version text)` (20260731000005) — THE template for a client-called definer RPC: `SECURITY DEFINER`, `SET search_path = 'public'`, `auth.uid()` null-check + raise, `ALTER FUNCTION ... OWNER TO postgres`, `REVOKE ALL ... FROM public, anon, authenticated` then `GRANT EXECUTE ... TO authenticated` (closes the Supabase default-privileges hole).
- `expire_trials()` (20260801000003) — maintenance function: revoked from client roles, `GRANT ALL ... TO service_role` only.
- `get_user_views(p_user_id)` / `record_listing_view` (20260725000002) — SECURITY DEFINER with NO explicit grants (exposed to anon/authenticated via default privileges). Anti-pattern to NOT copy: caller-supplied `p_user_id` + definer = any authenticated user can read any user's stats.
- Client-facing RPC grants in general rely on the default `GRANT EXECUTE` (e.g. `search_listings_cards`); the explicit REVOKE/GRANT pair in 20260731000005 is the hardened convention for anything sensitive.

**RLS posture relevant to an admin RPC.** Because SECURITY DEFINER bypasses RLS, protection comes from the in-body gate: `IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN RAISE EXCEPTION ... END IF;`. Precedent for is_admin checks: 20260725000001 admin RLS policies on listings (`Admins can delete/update/view any listing`, `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)`) — proving RLS-level is_admin gating works and is the existing admin surface.

**Routing.** `src/app/AppProviders.tsx` — `BrowserRouter` + `<Routes>/<Route>`, every page `React.lazy()`-loaded, Spanish locale paths, guards `ProtectedRoute` / `GuestRoute` (`src/components/auth/`). No `AdminRoute` exists; no `/administrador` route. `ProtectedRoute` pattern: loading spinner → `Navigate to /login` if no session → render children. An `AdminRoute` would compose `ProtectedRoute`-style auth + `profile?.is_admin === true`, redirecting non-admins (to `/perfil` or a 403 page).

**ProfilePage structure** (`src/features/profile/pages/ProfilePage.tsx`): left column = Profile Header Card (Avatar, name, "Miembro desde", a flex row with the "Configuración de Cuenta" button), "Mi Suscripción" card, "Reputación" card; right column = stats + listings tabs. The "Panel Admin" entry belongs in the header card next to "Configuración de Cuenta" (or as its own card), rendered only when `profile?.is_admin === true`. `useAuth().profile` is already loaded there (no extra fetch needed for the gate).

**UI primitives** (`src/components/ui/`): `Avatar`, `Modal`, `Select`, `Skeleton` (+ skeletons), `CharacterCounter`, `FeaturedCard`, `ProductCard`, `ReviewForm`. **NO Table component** — the admin user table would be hand-built with Tailwind (project style: Tailwind + Material Symbols icons + es-AR copy, cards with `bg-surface rounded-xl shadow-card`).

**Data fetching.** TanStack React Query 5 + supabase-js (`src/lib/supabase.ts`, anon key, PKCE). Hooks live in `src/hooks/` (`useProfile`, `useLegalConsents`, `useListings`, `useFeaturedRemaining`). RPC calls via `supabase.rpc('name', { p_param })` inside `queryFn`, `queryKey` with stable deps, `enabled` gating on session. The admin hook should mirror `useLegalConsents` (RPC + `enabled: !!session`).

**New-users count.** Compute in the RPC from `auth.users.created_at` (authoritative): today = `created_at >= date_trunc('day', now())`; this week = `created_at >= date_trunc('week', now())`. Return them alongside the list or as a second lightweight RPC.

## Affected Areas

- `supabase/migrations/202608XXXXXX_admin_list_users.sql` (new) — `admin_list_users()` SECURITY DEFINER RPC (list + counts), in-body is_admin gate, REVOKE/GRANT hygiene.
- `supabase/tests/admin_rpc_verify.sql` (new) — SQL verify script following `trial_security_verify.sql` conventions (BEGIN/ROLLBACK; non-admin → error, admin → rows).
- `src/components/auth/AdminRoute.tsx` (new) — admin-only guard (composes auth + `profile.is_admin`).
- `src/features/admin/pages/AdminPage.tsx` (new) — the section (route `/administrador`), lazy-loaded.
- `src/features/admin/components/UsersTable.tsx` (new, optional) — user table + stat cards.
- `src/hooks/useAdminUsers.ts` (new) — React Query hook calling the RPC.
- `src/features/profile/pages/ProfilePage.tsx` — conditional "Panel Admin" link in the header card.
- `src/app/AppProviders.tsx` — lazy import + `<Route path="/administrador" element={<AdminRoute><AdminPage/></AdminRoute>} />`.
- `src/types/index.ts` — optional `AdminUser` type.

## Approaches

1. **SECURITY DEFINER RPC `admin_list_users()` + AdminRoute + admin page** (recommended)
   - RPC returns `SETOF jsonb` (or a typed table) joining `auth.users` (email, `auth.users.created_at`) LEFT JOIN `profiles` (name, avatar, subscription_status/type, trial_ends_at) LEFT JOIN LATERAL listings count; gated on in-body is_admin; grants: REVOKE ALL from public/anon/authenticated + GRANT EXECUTE to authenticated; also returns `total_users`, `new_today`, `new_this_week` counts in one payload.
   - Pros: email + true registration date available (only viable path); single hardened surface; follows `record_legal_consent` convention; RLS untouched; one round trip.
   - Cons: needs a migration + SQL test; SECURITY DEFINER must be written carefully (gate in body, no caller-supplied ids).
   - Effort: Medium.

2. **RLS policy granting admins SELECT on all profiles** (+ keep email out / add email column)
   - Pros: no definer risk; instant list.
   - Cons: still no email (auth.users untouchable via PostgREST) — fails the product requirement; would require an email column + backfill into profiles (schema creep, write-path duplication); admin SELECT on all profiles is a wider blast radius than a single RPC.
   - Effort: Low-Medium but does not meet requirements → rejected.

3. **Two RPCs** (`admin_list_users()` + `admin_counts()`)
   - Pros: counts cached separately (e.g. 60s staleTime) while list paginates.
   - Cons: two round trips, two functions to audit. Marginal benefit at this scale.
   - Effort: Medium. (Not recommended — fold counts into the list RPC.)

## Recommendation

Approach 1: one `admin_list_users()` SECURITY DEFINER RPC (pattern: `record_legal_consent` 20260731000005) returning the user list (email, name, auth.users.created_at, subscription/trial state, listings count) plus `new_today` / `new_this_week` / `total` counts in a single payload; in-body `auth.uid()` + `profiles.is_admin` gate (never trust grants alone — default privileges grant EXECUTE to anon/authenticated and SECURITY DEFINER bypasses RLS); explicit `REVOKE ALL` + `GRANT EXECUTE TO authenticated`. Frontend: `AdminRoute` guard, lazy `AdminPage` at `/administrador`, `useAdminUsers` hook (React Query, `enabled: !!session`), entry link in ProfilePage header card gated on `profile?.is_admin === true`. Registration date MUST come from `auth.users.created_at` (profiles.created_at is unreliable for backfilled orphan users). Hand-built Tailwind table (no Table primitive exists).

## Risks

- CRITICAL — Privilege escalation via mis-gated definer RPC: SECURITY DEFINER bypasses RLS; Supabase default privileges grant EXECUTE to anon/authenticated on every new function. If the migration omits the explicit `REVOKE ALL FROM public, anon, authenticated` + `GRANT EXECUTE TO authenticated`, ANY authenticated user could list all users' emails (PII). The gate must be in the function body and the grants must be explicit — same class of bug 20260730000007 fixed for `bump_rate_limit`.
- CRITICAL — Do not copy the `get_user_views(p_user_id)` pattern (caller-supplied id + definer, no gate): it leaks any user's data by design. `admin_list_users()` must derive the caller from `auth.uid()` only.
- WARNING — PII blast radius: the RPC returns emails for every user. Return a minimal projection (email, full_name, created_at, subscription state, listings count) — do NOT include phone/location/avatar unless the product demands it.
- WARNING — `profiles.created_at` ≠ registration date for backfilled orphan profiles (20260731000002 repair backfill). Use `auth.users.created_at`.
- WARNING — Listings count semantics: decide "all statuses" vs "active only" (RLS admin policy in 20260725000001 sees all incl. deleted). Spec decision for sdd-spec.
- NOTE — `LegalConsentGate` wraps all routes; `/administrador` will require the same legal acceptance (fine — admin is a user). No exempt path needed.
- NOTE — No Table UI primitive; table is hand-built Tailwind. Frontend change (guard + page + hook + link + route) + migration + SQL test likely exceeds the 400-line review budget → sdd-tasks should plan chained PRs (DB migration first, then frontend).

## Ready for Proposal

Yes. The orchestrator should tell the user: the admin panel requires a SECURITY DEFINER RPC (`admin_list_users()`) because email + true registration date only exist in `auth.users`, which the client cannot query; `is_admin` is already C2-hardened and safely exposed via `useAuth().profile`; the recommended split is DB layer first (migration + SQL verify), then frontend (AdminRoute, `/administrador` page, ProfilePage link).
