# Design: Admin Panel (Panel de Administración)

## Technical Approach

Ship a hardened SECURITY DEFINER RPC `admin_list_users()` (migration `20260801000005_admin_panel.sql`) that returns one jsonb payload — `{ stats, users, subscriptions }` — reading `auth.users` (email + registration date, not client-queryable), `profiles`, and `listings` (active count), with `subscriptions`/`subscription_plans` joins guarded by `to_regclass` (dump-only tables). Access control lives entirely server-side: `auth.uid()` NULL-check + `profiles.is_admin` EXISTS gate raising PII-free errors, caller derived only from `auth.uid()`, and an explicit REVOKE/GRANT mirroring `record_legal_consent` (20260731000005). Frontend adds a gated, lazy `/administrador` route (`AdminRoute` guard, `useAdminUsers` React Query hook, `AdminPage` with stats cards / users table / subscriptions overview) plus a gated ProfilePage "Panel Admin" link. Per spec (obs 686): denied calls RAISE (not empty), subscriptions are active-only, non-admin redirects to `/perfil`, filename is `20260801000005_admin_panel.sql`.

## Architecture Decisions

| # | Decision | Options considered | Choice & rationale |
|---|----------|-------------------|--------------------|
| D1 | Access control | RLS-only vs SECURITY DEFINER gate | SECURITY DEFINER + in-body gate, mirroring `record_legal_consent` exactly. RLS can't hide `auth.users` (not client-queryable at all); the definer is the only path, so the gate lives inside it. |
| D2 | Caller derivation | id parameter (like `get_user_views`) vs `auth.uid()` | `auth.uid()` only, no parameter — anti-`get_user_views`; a caller-supplied id would leak any user's email. |
| D3 | Payload shape | separate counts RPC vs one payload | One jsonb payload per spec: stats/users/subscriptions. One round-trip, one gate check. |
| D4 | Dump-only tables | assume dump vs degrade | `IF to_regclass('public.subscriptions') IS NULL OR to_regclass('public.subscription_plans') IS NULL THEN v_subscriptions := '[]'::jsonb` — same guard philosophy as 20260801000004 / 20260801000002; a migrations-only replay must not crash. |
| D5 | Registration date | `profiles.created_at` vs `auth.users.created_at` | `auth.users.created_at` — backfilled orphans have `profiles.created_at` = backfill time (spec scenario). |
| D6 | Stats window | — | `count(*) FILTER (WHERE created_at >= date_trunc('day'/'week', now()))`; ISO week starts Monday, deterministic. |
| D7 | Grants | leave defaults vs explicit | `REVOKE ALL ON FUNCTION ... FROM public, anon, authenticated; GRANT EXECUTE ... TO authenticated` — default privileges grant anon/authenticated EXECUTE (see 20260730000007); service_role keeps EXECUTE via its superuser path, no explicit grant (spec decision obs 686). |
| D8 | AdminRoute composition | wrap `ProtectedRoute` vs standalone | Standalone (spinner → `/login` with `state.from` → `/perfil` → children). Composing ProtectedRoute would render children while `profile` is still loading, flashing a non-admin redirect for a legit admin. Matches GuestRoute/ProtectedRoute self-contained-guard style. |
| D9 | Hook location | `src/features/admin/hooks/` vs `src/hooks/` | `src/hooks/useAdminUsers.ts` — repo convention: all 11 hooks live flat in `src/hooks/`; proposal.md's stated path. |
| D10 | Verification | full seed vs tolerant | Grants/denial/payload assertions always run; subscriptions-specific assertions wrapped in `IF to_regclass(...) IS NOT NULL` so the test passes on migrations-only replays too. |

## Data Flow

```
AdminPage ──useAdminUsers (RQ ['admin','users'])── supabase.rpc('admin_list_users')
    │                                                        │ PostgREST (role=authenticated)
    │                                                        ▼
StatsCards/UsersTable/Subscriptions ◄── jsonb payload ── admin_list_users() SECURITY DEFINER (owner postgres)
    │                                              │       1. auth.uid() NULL → RAISE 'not authenticated'
    └── loading/error(Reintentar)/empty states     │       2. profiles.is_admin ≠ true → RAISE 'admin access required'
                                                   │       3. stats ← auth.users.created_at (date_trunc day/week)
                                                   │       4. users ← auth.users ⋈ profiles ⋈ LATERAL active listings count
                                                   │       5. subscriptions ← active rows ⋈ subscription_plans ⋈ auth.users (to_regclass-guarded)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260801000005_admin_panel.sql` | Create | `admin_list_users()` RPC + `ALTER ... OWNER TO postgres` + REVOKE/GRANT (template-identical) |
| `supabase/tests/admin_panel_verify.sql` | Create | BEGIN/ROLLBACK verify: grants matrix, non-admin + unauth denial, admin payload shape, active-only subscriptions (to_regclass-tolerant) |
| `src/types/index.ts` | Modify | Add `AdminUsersResponse`, `AdminStats`, `AdminUser`, `AdminSubscription` |
| `src/hooks/useAdminUsers.ts` | Create | React Query hook calling `supabase.rpc('admin_list_users')`, typed response |
| `src/components/auth/AdminRoute.tsx` | Create | Guard: spinner → `/login` (state.from) → `/perfil` → children |
| `src/app/AppProviders.tsx` | Modify | Lazy `AdminPage` chunk + `<Route path="/administrador">` in the protected block (inside `LegalConsentGate`) |
| `src/features/admin/pages/AdminPage.tsx` | Create | Page shell: Navbar/Footer, header, stats row, users table, subscriptions section, loading/error/empty states |
| `src/features/admin/components/StatsCards.tsx` | Create | 3 stat cards (totales / hoy / esta semana) |
| `src/features/admin/components/UsersTable.tsx` | Create | Users table (email, nombre, registro, suscripción, trial, avisos activos) |
| `src/features/admin/components/SubscriptionsSection.tsx` | Create | Subscriptions overview (pagador, plan, estado, inicio, vence) |
| `src/features/profile/pages/ProfilePage.tsx` | Modify | "Panel Admin" link → `/administrador`, rendered only when `profile?.is_admin === true`, below "Configuración de Cuenta" in the header card |

## Interfaces / Contracts

### SQL — exact signature and core body

```sql
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_stats jsonb; v_users jsonb; v_subscriptions jsonb;
BEGIN
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and is_admin) then
    raise exception 'admin access required';        -- PII-free, pinned by the test
  end if;

  v_stats := (select jsonb_build_object(
      'total_users', count(*),
      'new_users_today', count(*) filter (where created_at >= date_trunc('day', now())),
      'new_users_this_week', count(*) filter (where created_at >= date_trunc('week', now())))
    from auth.users);

  v_users := (select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'full_name', p.full_name, 'created_at', u.created_at,
      'subscription_type', p.subscription_type, 'subscription_status', p.subscription_status,
      'subscription_expires_at', p.subscription_expires_at, 'trial_ends_at', p.trial_ends_at,
      'active_listings_count', al.active_count) order by u.created_at desc), '[]'::jsonb)
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join lateral (select count(*) as active_count from public.listings l
      where l.user_id = u.id and l.status = 'active') al on true);

  if to_regclass('public.subscriptions') is null or to_regclass('public.subscription_plans') is null then
    v_subscriptions := '[]'::jsonb;                 -- migrations-only replay degradation (D4)
  else
    v_subscriptions := (select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'payer_email', u.email, 'plan_name', sp.name, 'status', s.status,
      'started_at', s.started_at, 'expires_at', s.expires_at) order by s.created_at desc), '[]'::jsonb)
      from public.subscriptions s
      join public.subscription_plans sp on sp.id = s.plan_id
      join auth.users u on u.id = s.user_id
      where s.status = 'active');                   -- active-only per spec
  end if;

  return jsonb_build_object('stats', v_stats, 'users', v_users, 'subscriptions', v_subscriptions);
END; $$;

ALTER FUNCTION public.admin_list_users() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
```

### Payload

```json
{ "stats": { "total_users": 42, "new_users_today": 3, "new_users_this_week": 12 },
  "users": [ { "id": "…", "email": "…", "full_name": "…", "created_at": "…",
    "subscription_type": "premium", "subscription_status": "paid",
    "subscription_expires_at": "…", "trial_ends_at": null, "active_listings_count": 2 } ],
  "subscriptions": [ { "id": "…", "payer_email": "…", "plan_name": "Premium",
    "status": "active", "started_at": "…", "expires_at": null } ] }
```

### TypeScript

```ts
export interface AdminStats { total_users: number; new_users_today: number; new_users_this_week: number }
export interface AdminUser {
  id: string; email: string; full_name: string | null; created_at: string;
  subscription_type: string; subscription_status: string | null;
  subscription_expires_at: string | null; trial_ends_at: string | null;
  active_listings_count: number
}
export interface AdminSubscription {
  id: string; payer_email: string; plan_name: string; status: string;
  started_at: string; expires_at: string | null
}
export interface AdminUsersResponse { stats: AdminStats; users: AdminUser[]; subscriptions: AdminSubscription[] }
```

### Frontend wiring

- `useAdminUsers` (src/hooks/useAdminUsers.ts): `queryKey: ['admin', 'users']`, `queryFn` = `supabase.rpc('admin_list_users')` → `data as AdminUsersResponse`, `enabled: !!session?.user?.id`, `staleTime: 30_000`, `retry: false` (denials shouldn't retry). Throws on `error` → AdminPage error state.
- `AdminRoute`: `isLoading || (session && !profile)` → spinner (same markup as ProtectedRoute); `!session` → `<Navigate to="/login" state={{ from: '/administrador' }} replace />`; `profile?.is_admin !== true` → `<Navigate to="/perfil" replace />`; else children.
- AppProviders: `const AdminPage = lazy(() => import('../features/admin/pages/AdminPage'))` with the other chunks; `AdminRoute` statically imported like ProtectedRoute; route added in the protected block (inside LegalConsentGate — admin without current legal acceptance sees the consent wall first, per spec).

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| SQL integration (psql, as postgres) | Grants matrix, denial, payload, active-only subs | `supabase/tests/admin_panel_verify.sql` — see below |
| Frontend types | All new TS/TSX compiles | `npx tsc --noEmit` from repo root (`pnpm build` uses `tsc -b`) |
| Manual (no test infra) | non-admin redirect, admin renders, direct RPC raises, ProfilePage link gated | apply-phase checklist |

### `supabase/tests/admin_panel_verify.sql` (concrete assertions)

Style: `max_images_verify.sql` — BEGIN, seed, sanity checks, `SET ROLE authenticated` + JWT GUCs, verdict SELECT, ROLLBACK. Fixed UUIDs `…00e1` (admin), `…00e2` (regular).

1. **Setup (postgres)**: insert 2 `auth.users` (trigger creates profiles); `UPDATE profiles SET is_admin = true` for admin; give the **regular** user 1 active + 1 inactive listing (asserts `active_listings_count` = 1); seed plans `ON CONFLICT (slug) DO NOTHING` + lookup-by-slug (max_images_verify pattern); give the **admin** user 1 active + 1 cancelled subscription (plan by slug lookup).
2. **Grants matrix (postgres)**: DO block — `has_function_privilege('authenticated', 'public.admin_list_users()', 'EXECUTE')` must be true; `has_function_privilege('anon', 'public.admin_list_users()', 'EXECUTE')` must be false; FAIL otherwise.
3. **Unauthenticated denial (postgres, no JWT)**: `PERFORM public.admin_list_users()` must raise; assert `SQLERRM = 'not authenticated'`.
4. **Non-admin denial (SET ROLE authenticated, JWT sub = regular)**: call must raise; assert `SQLERRM = 'admin access required'` (pins the PII-free message so a future change can't weaken it).
5. **Admin success (JWT sub = admin)**: `SELECT admin_list_users() INTO v_payload`; assert `jsonb_typeof` = 'object'; keys `stats`/`users`/`subscriptions` present; `stats` has all 3 keys and `total_users >= 2`; `jsonb_array_length(users) >= 2`; containment `users @> '[{"email":"…regular…","active_listings_count":1}]'`.
6. **Subscriptions (guarded `IF to_regclass(...) IS NOT NULL`)**: `subscriptions @> '[{"payer_email":"…admin…","status":"active"}]'`; `jsonb_array_length(subscriptions) = 1` (cancelled filtered out). Skipped silently on migrations-only replay — test stays tolerant (D10).
7. **Verdict**: `SELECT 'VERIFICATION PASSED — admin panel RPC access control + payload' AS result; ROLLBACK;`

## Migration / Rollout

Additive and read-only; no feature flag. Admin eligibility already exists (`profiles.is_admin`, set via SQL; C2 column-lock blocks self-grant). Rollback: DB = `DROP FUNCTION public.admin_list_users()`; frontend = revert route + remove files.

### Chained PRs (400-line review budget — Section E guard)

| PR | Slice (targets previous PR branch) | Contents | Verify |
|----|------------------------------------|----------|--------|
| **1 — DB slice** | `supabase/migrations/20260801000005_admin_panel.sql` + `supabase/tests/admin_panel_verify.sql` (~330 lines) | Backend capability live; RPC hardened and provably gated | `psql "$SUPABASE_DB_URL" -f supabase/tests/admin_panel_verify.sql` → VERIFICATION PASSED |
| **2 — Admin foundation** | `AdminRoute`, `/administrador` route + lazy `AdminPage`, `useAdminUsers`, types, AdminPage shell + StatsCards + loading/error/empty (~300 lines) | Admins reach a working page showing stats; guards proven in-app | `npx tsc --noEmit`; manual: admin renders / non-admin → /perfil |
| **3 — Panel detail** | `UsersTable`, `SubscriptionsSection`, wire into AdminPage, ProfilePage "Panel Admin" link (~350 lines) | Complete panel + discoverability | `npx tsc --noEmit`; manual: table + subscriptions + profile link |

Each slice: clear start/finish, autonomous, individually verifiable, revertible.

## Open Questions

None — all decisions locked by spec (obs 686) or resolved in the table above.
