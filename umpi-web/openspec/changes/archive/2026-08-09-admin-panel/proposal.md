# Proposal: Admin Panel (Panel de Administración)

## Intent

Site owners (client + developer, identified via `profiles.is_admin`) cannot answer "did any new users register?" — no admin surface exists. Email and true registration dates live only in `auth.users` (not queryable by the client SDK), so the panel needs a hardened SECURITY DEFINER RPC. This change ships a gated `/administrador` page: user list (email, name, registration date, subscription/trial state, ACTIVE listings count), subscriptions overview, and quick stats.

## Scope

### In Scope
- `admin_list_users()` SECURITY DEFINER RPC — user list + stats + subscriptions overview in one payload; in-body `auth.uid()` + `is_admin` gate; explicit REVOKE/GRANT
- SQL verify test (per `trial_security_verify.sql` conventions)
- `AdminRoute` guard + lazy `/administrador` route
- `AdminPage`: stat cards, users table, subscriptions overview (hand-built Tailwind — no Table primitive)
- `useAdminUsers` hook + ProfilePage "Panel Admin" entry link (admins only)

### Out of Scope
- CSV export (v1)
- Phone/location/avatar in the projection (PII minimization)
- User management actions (delete/ban/impersonate)
- Separate counts RPC (folded into the main RPC)

## Capabilities

### New Capabilities
- `admin-panel`: gated admin surface — user list, subscriptions overview, quick stats, served by a hardened SECURITY DEFINER RPC

### Modified Capabilities
- None — `openspec/specs/` is empty

## Approach

1. **Migration** `supabase/migrations/20260801000005_admin_panel.sql` — one `admin_list_users() RETURNS jsonb` SECURITY DEFINER RPC following the `record_legal_consent` template (20260731000005): `SET search_path='public'`, `auth.uid()` null-check, in-body gate `NOT EXISTS (profiles WHERE id = auth.uid() AND is_admin)` → RAISE; `ALTER FUNCTION OWNER TO postgres`; `REVOKE ALL FROM public, anon, authenticated` + `GRANT EXECUTE TO authenticated`. Payload: `{stats: {total_users, new_today, new_this_week}, users: [...], subscriptions: [...]}`.
   - users: `auth.users` (email, `auth.users.created_at` = registration date) LEFT JOIN `profiles` (full_name, subscription_status/type, trial_ends_at) LEFT JOIN LATERAL active-listings count (`listings.status = 'active'`).
   - stats: counts from `auth.users.created_at` via `date_trunc('day'/'week', now())`.
   - subscriptions: `subscriptions` JOIN `subscription_plans` (plan name) JOIN `profiles`/`auth.users` (payer) — active rows only.
   - Caller derived ONLY from `auth.uid()` — never a parameter (anti-`get_user_views`).
2. **Test** `supabase/tests/admin_panel_verify.sql` (BEGIN/ROLLBACK; non-admin → error, admin → rows, grants asserted).
3. **Frontend**: `AdminRoute` (auth + `profile.is_admin`; non-admin → Navigate `/perfil`), lazy `AdminPage` at `/administrador` (`AppProviders.tsx`), `useAdminUsers` (React Query, `enabled: !!session`), ProfilePage header-card "Panel Admin" link gated `is_admin === true`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/20260801000005_admin_panel.sql` | New | SECURITY DEFINER RPC + grants |
| `supabase/tests/admin_panel_verify.sql` | New | Security verify (non-admin/admin) |
| `src/components/auth/AdminRoute.tsx` | New | Admin guard |
| `src/features/admin/pages/AdminPage.tsx` | New | `/administrador` page |
| `src/features/admin/components/UsersTable.tsx` | New | Table + stat cards |
| `src/hooks/useAdminUsers.ts` | New | RPC query hook |
| `src/app/AppProviders.tsx` | Modified | Route + lazy import |
| `src/features/profile/pages/ProfilePage.tsx` | Modified | Gated Panel Admin link |
| `src/types/index.ts` | Modified | Admin types |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Mis-gated definer RPC leaks all emails (default privileges grant EXECUTE to anon/authenticated; definer bypasses RLS) | Med | In-body gate + explicit REVOKE/GRANT per template; test asserts grants |
| Copying `get_user_views` (caller-supplied id) | Low | Caller from `auth.uid()` only; no id parameter |
| `profiles.created_at` skew for backfilled orphans | Low | Use `auth.users.created_at` |
| PII blast radius (emails) | Med | Minimal projection — no phone/location/avatar |
| >400-line review budget | High | Chained PRs: DB (migration+test) first, then frontend |

## Rollback Plan

- DB: `DROP FUNCTION admin_list_users()` — additive, read-only, no data mutation.
- Frontend: remove AdminRoute/AdminPage/hook; revert AppProviders route + ProfilePage link. Simple revert commit.

## Dependencies

- An admin profile row with `is_admin = true` (set via SQL/postgres role; C2 column-lock already prevents self-grant).

## Success Criteria

- [ ] SQL verify: non-admin call raises; admin call returns rows; grants confirmed
- [ ] `/administrador` reachable only with `is_admin`; non-admins redirected; ProfilePage link hidden
- [ ] Table shows email, full_name, registration date, subscription/trial state, active-listings count
- [ ] Stats header: total users, new today, new this week (`auth.users.created_at`)
- [ ] Subscriptions overview: payer, plan, status
- [ ] `pnpm build` passes
