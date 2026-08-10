# Tasks: Admin Panel (Panel de Administración)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~980 total (PR 1 ~330, PR 2 ~300, PR 3 ~350) |
| 400-line budget risk | PR 1 Low / PR 2 Low / PR 3 Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (DB) → PR 2 (foundation) → PR 3 (detail) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes (resolved: stacked-to-main)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | DB: RPC migration + SQL verify | PR 1 | DONE — PR #1 open (feat/admin-panel-db, 1d81c35 + bd8f456) |
| 2 | Admin foundation: guard, route, hook, types, page shell | PR 2 | DONE — branch feat/admin-panel-foundation (stacked) |
| 3 | Panel detail + ProfilePage link | PR 3 | DONE — branch feat/admin-panel-detail (stacked, not pushed) |

## Phase 1: DB slice — migration + SQL verify (PR 1)

- [x] 1.1 **Create migration** `supabase/migrations/20260801000005_admin_panel.sql` — `admin_list_users()` RETURNS jsonb, SECURITY DEFINER, `SET search_path = 'public'`, mirroring `record_legal_consent` (20260731000005): auth.uid() NULL → RAISE 'not authenticated'; no `profiles.is_admin` → RAISE 'admin access required'; OWNER TO postgres; REVOKE ALL FROM public, anon, authenticated + GRANT EXECUTE TO authenticated. Body: stats (date_trunc day/week on auth.users.created_at), users (auth.users ⋈ profiles ⋈ LATERAL active listings count, COALESCE '[]'), subscriptions active-only behind to_regclass guard. AC: template-identical grants; caller derived only from auth.uid() (no param); PII-free raises; `20260801000005` unused (latest = 00004). Files: `supabase/migrations/20260801000005_admin_panel.sql`. Verify: `psql -f` applies clean.
- [x] 1.2 **Create verify test** `supabase/tests/admin_panel_verify.sql` — max_images_verify style: BEGIN/ROLLBACK; seed admin (…00e1) + regular (…00e2) via auth.users (trigger builds profiles), plans ON CONFLICT DO NOTHING; grants DO block (authenticated EXECUTE true, anon false); unauth denial SQLERRM='not authenticated'; non-admin denial SQLERRM='admin access required' (pins PII-free message); admin success payload (keys present, total_users ≥ 2, `active_listings_count` = 1 containment); subscriptions @> active only under `IF to_regclass(...) IS NOT NULL`; verdict 'VERIFICATION PASSED'. AC: covers spec scenarios for access control + payload. Files: `supabase/tests/admin_panel_verify.sql`. Verify: `psql -f` as postgres → VERIFICATION PASSED.
- [x] 1.3 **Run DB verify** — apply migrations, execute test as postgres. AC: test prints 'VERIFICATION PASSED — admin panel RPC access control + payload'. Verify: `psql -f supabase/tests/admin_panel_verify.sql`.

## Phase 2: Admin foundation (PR 2)

- [x] 2.1 **Add admin types** to `src/types/index.ts` — `AdminStats`, `AdminUser`, `AdminSubscription`, `AdminUsersResponse` with fields exactly per design payload. AC: every payload field typed. Verify: `npx tsc --noEmit`.
- [x] 2.2 **Create `src/hooks/useAdminUsers.ts`** — queryKey `['admin','users']`; `supabase.rpc('admin_list_users')` → `AdminUsersResponse`; `enabled: !!session?.user?.id`; staleTime 30_000; retry false. AC: hook contract per design. Verify: `npx tsc --noEmit`.
- [x] 2.3 **Create `src/components/auth/AdminRoute.tsx`** — standalone guard: spinner (ProtectedRoute markup) → not logged in → `/login` with `state.from='/administrador'` → non-admin → `/perfil` → children. AC: no wrong redirect flash for legit admins; spec redirect scenarios. Verify: `npx tsc --noEmit`.
- [x] 2.4 **Wire route** in `src/app/AppProviders.tsx` — `lazy(() => import('../features/admin/pages/AdminPage'))` + static AdminRoute import; `<Route path="/administrador">` in protected block inside LegalConsentGate. AC: spec route-guard scenario. Verify: `npx tsc --noEmit`.
- [x] 2.5 **Create `src/features/admin/pages/AdminPage.tsx` shell** — Navbar/Footer, header, loading spinner, error state with Reintentar (retry), empty state; renders StatsCards from useAdminUsers. AC: all four states present; Spanish UI strings. Verify: `npx tsc --noEmit` + manual admin render.
- [x] 2.6 **Create `src/features/admin/components/StatsCards.tsx`** — 3 stat cards (totales / hoy / esta semana). AC: renders from AdminStats. Verify: `npx tsc --noEmit`.

## Phase 3: Panel detail (PR 3)

- [x] 3.1 **Create `src/features/admin/components/UsersTable.tsx`** — hand-built Tailwind table (no Table primitive): email, nombre, registro, suscripción, trial, avisos activos; empty state. AC: spec columns. Verify: `npx tsc --noEmit`.
- [x] 3.2 **Create `src/features/admin/components/SubscriptionsSection.tsx`** — overview: pagador, plan, estado, inicio, vence; empty state. AC: spec columns. Verify: `npx tsc --noEmit`.
- [x] 3.3 **Wire into AdminPage** — UsersTable + SubscriptionsSection replace shell placeholders. AC: spec Data-rendered / Empty-data scenarios. Verify: `npx tsc --noEmit` + manual.
- [x] 3.4 **Add ProfilePage admin link** — "Panel Admin" → `/administrador` below "Configuración de Cuenta" in header card, only when `profile?.is_admin === true`. AC: spec link shown/hidden scenarios. Verify: `npx tsc --noEmit` + manual.
- [x] 3.5 **Full build** — verify whole change compiles. AC: `pnpm build` passes. Verify: `pnpm build`.

## Ordering & Dependencies

PR 1 → PR 2 → PR 3 (strict): 1.1 → 1.2 → 1.3; 2.1 → 2.2; 2.4 needs 2.3 + 2.5; 2.6 needs 2.1; 3.1/3.2 → 3.3; 3.4 independent within PR 3; 3.5 last.

**DB slice (tasks 1.1–1.3, PR 1) can be applied + pushed first independently** — it needs no frontend and lands alone; PR 2 code calls the RPC it ships, so PR 1 must land before PR 2/PR 3 open.

## Apply-Phase Manual Checklist (no test infra)

- [ ] Non-admin at `/administrador` → redirected to `/perfil`; direct `supabase.rpc('admin_list_users')` raises
- [ ] Admin at `/administrador` → stats, table, subscriptions render
- [ ] ProfilePage shows "Panel Admin" for admin, hides for non-admin
- [ ] Unauthenticated at `/administrador` → `/login`, path preserved
