# Verify Report — admin-panel

**Change**: admin-panel
**Version**: delta spec (openspec/changes/admin-panel/specs/admin-panel/spec.md)
**Mode**: Standard (no test infra; SQL verify + tsc/build evidence; manual items documented UNVERIFIED)
**Date**: 2026-08-09
**Verified tree**: `feat/admin-panel-detail` @ `0cf84fb` (PR 3 tip; full stacked history PR 1 + PR 2 + PR 3)

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 11 |
| Tasks complete | 11 |
| Tasks incomplete | 0 |

## Build & Tests Execution

**DB verify (live prod DB)**: ✅ Passed
```text
$ ~/.local/bin/supabase db query --linked -f supabase/tests/admin_panel_verify.sql
┌────────────────────────────────────────────────────────────────┐
│ result                                                         │
├────────────────────────────────────────────────────────────────┤
│ VERIFICATION PASSED — admin panel RPC access control + payload │
└────────────────────────────────────────────────────────────────┘
```

**Type check**: ✅ Passed
```text
$ npx tsc --noEmit
TSC_EXIT=0
```

**Production build**: ✅ Passed
```text
$ pnpm build
dist/assets/AdminPage-C4kVY5vp.js  9.66 kB │ gzip: 2.48 kB   (lazy chunk present)
✓ built in 3.75s
BUILD_EXIT=0
```
(Only note: pre-existing `>500 kB` index-chunk rollup warning — unrelated to this change.)

**Coverage**: ➖ Not available (repo has no test runner; package.json scripts: dev/build/lint/preview only).

## Spec Compliance Matrix

| Requirement | Scenario | Covering test / evidence | Result |
|-------------|----------|--------------------------|--------|
| R1 Admin RPC access control | Admin success | `admin_panel_verify.sql` §d — admin JWT → payload returns | ✅ COMPLIANT |
| R1 | Non-admin denied | §c — SET ROLE authenticated, regular JWT → raises `admin access required`, no data | ✅ COMPLIANT |
| R1 | Unauthenticated denied | §b — no JWT → raises `not authenticated` | ✅ COMPLIANT |
| R1 | Anonymous cannot execute | §grants — `has_function_privilege('anon',...)` false, `authenticated` true | ✅ COMPLIANT |
| R2 Admin RPC payload | Stats from auth.users.created_at | §d asserts stats shape + 3 keys + `total_users >= 2`; day/week windows statically verified (migration L73-77 `date_trunc('day'/'week', now())` on `auth.users.created_at`) | ⚠️ PARTIAL |
| R2 | Registration date (orphan backfill) | No runtime seed; static only — migration L88 `'created_at', u.created_at` (auth.users, not profiles) | ❌ UNTESTED (static evidence) |
| R2 | Active-only | §d — regular user containment `active_listings_count: 1` (1 active + 1 inactive seeded); subscriptions `@>` active row present AND cancelled row absent | ✅ COMPLIANT |
| R2 | PII-free error | §b/§c — `SQLERRM` pinned to exact PII-free strings `not authenticated` / `admin access required`; no NOTICE/WARNING in migration | ✅ COMPLIANT |
| R3 Admin route guard | Admin reaches the panel | Static: AdminRoute (AdminPage.tsx wiring) + route `/administrador` inside LegalConsentGate; manual pending | ❌ UNTESTED (manual) |
| R3 | Non-admin redirect + RPC denial | RPC-denial half runtime-passed (§c); redirect half static (AdminRoute L81-83 `profile.is_admin !== true → /perfil`); manual pending | ⚠️ PARTIAL |
| R3 | Unauthenticated → login, path preserved | Static, end-to-end: AdminRoute L67 `state={{from:'/administrador'}}` → LoginPage L19 `redirectTo = location.state.from || '/'` → L28 `navigate(redirectTo)`; manual pending | ❌ UNTESTED (manual) |
| R4 Admin page and hook | Data rendered | Static: StatsCards 3 cards, UsersTable 6 columns, SubscriptionsSection 5 columns; manual pending | ❌ UNTESTED (manual) |
| R4 | Empty data | Static: AdminPage L60-72, UsersTable L121-133, SubscriptionsSection L39-51 empty states; manual pending | ❌ UNTESTED (manual) |
| R4 | Fetch failure | Static: AdminPage L41-59 error card + `Reintentar` (refetch); manual pending | ❌ UNTESTED (manual) |
| R5 Profile entry link | Link shown for admin | Static: ProfilePage L155 `profile?.is_admin === true && <Link to="/administrador">Panel Admin`; manual pending | ❌ UNTESTED (manual) |
| R5 | Link hidden for non-admin | Static: same gate — false → nothing renders; manual pending | ❌ UNTESTED (manual) |
| R6 SQL verification | Verify passes | `admin_panel_verify.sql` BEGIN/ROLLBACK → live verdict `VERIFICATION PASSED — admin panel RPC access control + payload` | ✅ COMPLIANT |

**Compliance summary**: 7/16 fully compliant at runtime; 2 PARTIAL (stats windows, redirect half); 1 UNTESTED-with-static-evidence (registration date); 6 UNTESTED manual scenarios (no test infra — documented, not claimed passed).

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| RAISE messages | ✅ Implemented | Migration L59 `not authenticated`; L69 `admin access required` — PII-free, pinned by test |
| REVOKE/GRANT | ✅ Implemented | L149 `REVOKE ALL ON FUNCTION ... FROM public, anon, authenticated`; L150 `GRANT EXECUTE TO authenticated`; `OWNER TO postgres` L144 |
| SECURITY DEFINER + search_path | ✅ Implemented | L47-48; caller derived only from `auth.uid()` (L51), signature takes no param |
| Caller derivation | ✅ Implemented | No id parameter — anti-get_user_views stance honored |
| /perfil redirect | ✅ Implemented | AdminRoute L81-83 |
| /login redirect w/ return path | ✅ Implemented | AdminRoute L67 → LoginPage consumes `state.from` |
| Loading spinner | ✅ Implemented | AdminRoute L38-44, L72-78 (session + profile loading) |
| ProfilePage link gating | ✅ Implemented | `profile?.is_admin === true` only; below "Configuración de Cuenta", header card |
| Active-only subscriptions | ✅ Implemented | Migration L133 `WHERE s.status = 'active'` |
| Stats semantics | ✅ Implemented | `date_trunc('day'/'week', now())` on `auth.users.created_at` (L73-77) |
| Registration date source | ✅ Implemented | `u.created_at` (L88) — auth.users, not profiles |
| Minimal PII projection | ✅ Implemented | Payload: 9 user fields, 6 subscription fields, 3 stats keys. No phone/location/avatar in migration or admin components (grep: zero matches in `src/features/admin`) |
| No NOTICE/WARNING | ✅ Implemented | No RAISE NOTICE/RAISE WARNING in migration (only pre-existing 20260731000002 trigger has one) |
| Lazy-loaded route | ✅ Implemented | AppProviders L56 `lazy(() => import('../features/admin/pages/AdminPage'))` |
| Inside LegalConsentGate | ✅ Implemented | AppProviders L98/132 — route in protected block inside the gate |
| Hand-built Tailwind, no Table primitive | ✅ Implemented | Raw `<table>` markup in UsersTable/SubscriptionsSection |
| useAdminUsers contract | ✅ Implemented | queryKey `['admin','users']`, `enabled: !!session?.user?.id`, `staleTime 30_000`, `retry: false`, error thrown |
| Empty-data guard (stats.total_users === 0) | ✅ Implemented | AdminPage L60 |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 SECURITY DEFINER gate | ✅ Yes | Mirrors record_legal_consent |
| D2 auth.uid() only, no param | ✅ Yes | |
| D3 One jsonb payload | ✅ Yes | `{stats, users, subscriptions}` |
| D4 to_regclass dump guard | ✅ Yes | Migration L110-113, L133; test L61, L110, L150, L275 |
| D5 auth.users.created_at | ✅ Yes | |
| D6 date_trunc day/week | ✅ Yes | ISO week |
| D7 REVOKE/GRANT template | ✅ Yes | service_role via superuser, no explicit grant |
| D8 Standalone AdminRoute | ✅ Yes | No ProtectedRoute wrapper; profileError escape path added (commit 36cd432) |
| D9 Hook at src/hooks/useAdminUsers.ts | ✅ Yes | |
| D10 Test tolerance | ✅ Yes | to_regclass-guarded setup + assertions |
| File set (11 files) | ✅ Yes | All design files present + `src/lib/subscription.ts` (review-fix addition: shared SUBSCRIPTION_STATUS_LABELS, widened isInTrial) |

## Issues Found

**CRITICAL**: None.

**WARNING**:
1. **Spec filename drift** — spec R6 names `supabase/tests/admin_rpc_verify.sql`; implementation ships `supabase/tests/admin_panel_verify.sql` (design + tasks + apply all agree on the actual name). Substance fully implemented and runtime-passed; reconcile the spec text during archive. Evidence: spec.md L117 vs `ls supabase/tests/`.
2. **Registration-date scenario untested at runtime** — spec R2 scenario "backfilled orphan profile" has no covering seed; correctness rests on migration L88 (`u.created_at`). Recommend seeding an orphan-backfilled profile in `admin_panel_verify.sql` to close the gap.
3. **Stats-window values not runtime-asserted** — test asserts stats shape + `total_users >= 2`, but never seeds "registered today" vs "earlier this week" users to assert the day/week counts. Implementation verified statically (date_trunc on auth.users.created_at).
4. **Manual checklist UNVERIFIED (no test infra)** — repo has no test runner (no vitest/playwright; package.json has no `test` script). These are documented, NOT claimed passed, and require a live browser session: (a) admin renders table incl. trial row + paid chip; (b) non-admin at `/administrador` → `/perfil`; (c) guest at `/administrador` → `/login` with return path; (d) non-admin sees no "Panel Admin" link; (e) RPC denial path shows error card.

**SUGGESTION**:
1. Extract shared `EmptyState` / `TableShell` components (reviewer-deferred follow-up from apply) — three near-identical empty-state blocks exist across AdminPage/UsersTable/SubscriptionsSection.
2. Vite `>500 kB` index-chunk warning — pre-existing, not introduced by this change; worth a future code-splitting pass.

## Verdict

**PASS WITH WARNINGS** — implementation matches spec + design + tasks; all 11 tasks complete; SQL verify, tsc, and build all pass; the 4 WARNINGs are test-depth/spec-text/documentation items, none of which block archive.

---

## Evidence Log (exact commands)

```text
$ ~/.local/bin/supabase db query --linked -f supabase/tests/admin_panel_verify.sql
→ VERIFICATION PASSED — admin panel RPC access control + payload

$ npx tsc --noEmit ; echo $?
→ 0

$ pnpm build
→ ✓ built in 3.75s (exit 0; AdminPage-C4kVY5vp.js chunk present)

$ gh pr list --state open
→ #3 feat/admin-panel-detail (base feat/admin-panel-foundation, +328/-8, 5 files)
→ #2 feat/admin-panel-foundation (base feat/admin-panel-db, +319/-1, 7 files)
→ #1 feat/admin-panel-db (base main, +452/-0, 2 files)
```

PR chain: stacked-to-main, all under the 400-line review budget. Branches: `feat/admin-panel-db` → `feat/admin-panel-foundation` → `feat/admin-panel-detail` @ `0cf84fb`.
