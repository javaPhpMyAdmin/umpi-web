# Archive Report — admin-panel

**Change**: admin-panel | **Phase**: archive (hybrid mode: OpenSpec filesystem + Engram)
**Archived**: 2026-08-09 → `openspec/changes/archive/2026-08-09-admin-panel/`
**Status**: CLOSED — SDD cycle complete (proposal → spec → design → tasks → apply → verify → archive)
**Verdict**: success (verify PASS WITH WARNINGS; no CRITICAL; all warnings resolved or tracked as follow-ups)

## Engram observation IDs (traceability)

| Artifact | Obs ID | Notes |
|----------|--------|-------|
| proposal | 683 | Reconciled: stale `20260801000005_admin_list_users.sql` migration name + stale `admin_rpc_verify.sql` test name replaced with shipped names |
| spec | 685 | Reconciled: R6 test filename `admin_rpc_verify.sql` → `admin_panel_verify.sql` |
| spec-decisions | 686 | Pinned migration filename + locked choices (denied RAISEs, active-only subs, `/perfil` redirect, active-listings semantics, service_role superuser grant) |
| design | 688 | — |
| tasks | 690 | 11/11 tasks complete; archive-time stale-checkbox reconciliation applied to on-disk `tasks.md` (see below) |
| apply-progress | 698 | Cumulative PR 1 + PR 2 + PR 3 + review fixes (0cf84fb) |
| verify-report | 706 | PASS WITH WARNINGS, archive-ready; no CRITICAL |
| archive-report | this doc | Engram topic `sdd/admin-panel/archive-report` (type architecture) |

## Verification status (from verify-report obs 706)

- SQL verify live: `supabase db query --linked -f supabase/tests/admin_panel_verify.sql` → `VERIFICATION PASSED — admin panel RPC access control + payload` ✅
- `npx tsc --noEmit` exit 0 ✅ | `pnpm build` exit 0 (lazy `AdminPage-C4kVY5vp.js` chunk present) ✅
- PR chain: #1 feat/admin-panel-db (base main), #2 feat/admin-panel-foundation (base db), #3 feat/admin-panel-detail (base foundation) — all open, all under 400-line budget
- Spec compliance: 7 COMPLIANT, 2 PARTIAL (static-only), 1 UNTESTED w/ static evidence, 6 UNTESTED manual (no test infra) — documented, NOT claimed passed
- CRITICAL: none | WARNING: 4 (all addressed below)

## Reconciliations performed at archive

1. **Spec R6 filename drift** (verify WARNING #1): delta spec mandated `supabase/tests/admin_rpc_verify.sql`; implementation ships `supabase/tests/admin_panel_verify.sql` (design/tasks/apply/verify all agree on the shipped name; file exists at `supabase/tests/admin_panel_verify.sql`). Fixed the requirement text in the delta spec; canonical spec synced with the corrected name.
2. **Proposal.md stale filenames**: `20260801000005_admin_list_users.sql` → `20260801000005_admin_panel.sql` (Approach + Affected Areas; pinned by spec-decisions obs 686, migration exists) and `supabase/tests/admin_rpc_verify.sql` → `supabase/tests/admin_panel_verify.sql` (Approach + Affected Areas) so the archived proposal matches shipped reality.
3. **tasks.md stale checkboxes** (archive-time stale-checkbox reconciliation, per sdd-archive skill): on-disk `tasks.md` still showed Phase 1 tasks 1.1–1.3 as `[ ]` while the Engram tasks observation (obs 690) had them `[x]` and apply-progress (obs 698) + verify-report (obs 706) prove completion (11/11, live evidence). Marked 1.1/1.2/1.3 `[x]` and synced chain strategy to resolved `stacked-to-main`. The Apply-Phase Manual Checklist items remain `[ ]` intentionally — they are manual QA items NOT claimed passed by verify; tracked as post-archive follow-up (a).

No destructive deltas merged (new capability; `openspec/specs/` was empty). Config archive rule "warn before merging destructive deltas" not triggered.

## Delta sync → canonical spec

- `openspec/specs/` was empty → the delta spec is the full spec for the new `admin-panel` capability. Copied `openspec/changes/admin-panel/specs/admin-panel/spec.md` → `openspec/specs/admin-panel/spec.md` (reconciled version).
- Canonical spec now carries the admin-panel facts: migration `20260801000005_admin_panel.sql`, `admin_list_users()` SECURITY DEFINER RPC (REVOKE/GRANT, PII-free raises, `auth.uid()`-derived caller), one jsonb payload (stats/users/subscriptions), `AdminRoute` guard + lazy `/administrador`, `AdminPage` + `useAdminUsers` + ProfilePage gated link, and verify test `supabase/tests/admin_panel_verify.sql`.

## Post-archive follow-ups (OUTSIDE this change — intentionally NOT folded into the spec)

- (a) Manual browser checklist for the admin panel (no test infra in repo): trial row renders "Prueba" chip, paid status chip "Pagada", non-admin redirect to `/perfil`, ProfilePage link gating, direct RPC denial error card, unauth → `/login` with path preserved.
- (b) Deferred refactor: extract shared `EmptyState`/`TableShell` components between `UsersTable` and `SubscriptionsSection` (reviewer-suggested, separate change).
- (c) Pre-existing "profiles publicly readable" RLS policy (migrations 20260718000000/00003 `USING(true)`) surfaced by the risk review — worth a follow-up ticket (data-exposure audit, outside this change).
- (d) Optional hardening suggestions: CHECK constraint on `subscriptions.status`; LEFT JOIN plan in subscriptions query (review suggestions, optional).
- (e) Production currency UYU→ARS note — separate concern, not part of admin panel.

## Archive contents

- exploration.md ✅ | proposal.md ✅ (reconciled) | specs/admin-panel/spec.md ✅ (reconciled) | design.md ✅ | tasks.md ✅ (11/11, reconciled) | verify-report.md ✅ | archive-report.md ✅ (this file)

## Rules

- Archive is an audit trail: no further edits to archived artifacts. Post-archive follow-ups live in this report and Engram only.
