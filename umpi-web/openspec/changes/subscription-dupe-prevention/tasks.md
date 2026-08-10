# Tasks: Subscription Duplicate Prevention

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,700 (1,400–2,000) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 6 stacked-to-main PRs |
| Delivery strategy | ask-always (user decides before apply) |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR |
|------|------|-----------|
| 1 | Migration + verify SQL (D1) | PR 1 |
| 2 | `_shared/subscription.ts` + sync-subscription | PR 2 |
| 3 | cancel-subscription active-first | PR 3 |
| 4 | mp-webhook conflict + result-checked clears | PR 4 |
| 5 | create-subscription guard (D2) | PR 5 |
| 6 | Expiry cron + ops runbook | PR 6 |

## Phase 1: Schema Foundation

- [x] 1.1 Create `supabase/migrations/20260809000001_subscription_dupe_prevention.sql` (D1 order inside `to_regclass('public.subscriptions')` guard): marker col → reconcile pinned (548a19b4 survives) → reconcile generic (newest, `created_at DESC, id DESC`) → unknown→cancelled → idempotent backfill → unique partial index → CHECK via pg_constraint probe → `clear_profile_subscription_if_no_active` RPC (single atomic UPDATE, service_role only) → `expire_subscriptions` replace (+`AND NOT EXISTS` active). — DONE 2026-08-09 (dry-ran idempotent on linked DB)
- [x] 1.2 Create `supabase/tests/subscription_dupe_prevention_verify.sql` (BEGIN/ROLLBACK, RAISE EXCEPTION): 23505; CHECK rejects unknown+NULL; newest kept; pin survives; backfill idempotent; RPC no-active-only clear; conditional clear. — DONE 2026-08-09 (PASSED pre-apply)
- [x] 1.3 Confirm pin row + full UUID (`id::text LIKE '548a19b4%'` + mp id) before merge (design open question). — CONFIRMED 2026-08-09: 548a19b4-1b15-4482-9dca-0800d677fd37 (mp ddaa579d2b374131b22c1ca2cebbf9e9, active, expires 2026-09-02)
- [x] 1.4 Run verify (`supabase db query --linked --workdir traspaso-supabase`); zero violations. — PASSED 2026-08-09 pre-apply + `pnpm build` OK; migration NOT applied to live

## Phase 2: Shared Helper

- [x] 2.1 Create `traspaso-supabase/supabase/functions/_shared/subscription.ts`: `LIVE_STATUSES`, `PENDING_STALE_MS`, `selectLiveSubscription` (active+pending, mp filter, `created_at DESC, id DESC`), `fetchPreapproval`, `cancelPreapproval` (tolerates already-cancelled), `clearProfileSubscription` (RPC wrapper). — DONE 2026-08-09 (commit 3be981b; scratch strict-mode tsc pass vs real supabase-js types; no Deno CLI)

## Phase 3: Sync Writers

- [x] 3.1 `sync-subscription/index.ts`: `selectLiveSubscription`; sync only that row; cancelled/expired → result-checked update then `clearProfileSubscription` (check RPC result). — DONE 2026-08-09 (commit 3be981b; `pnpm build` OK; auth/rate-limit + authorized branch untouched; RPC not yet live → migration-first deploy)
- [x] 3.2 `cancel-subscription/index.ts`: **active-first** (newest active else newest pending — spec-drift contract); `cancelPreapproval`; update → conditional clear. — DONE 2026-08-09 (commit pending; scratch strict-mode tsc PASS; `pnpm build` OK; RPC not yet live → migration-first deploy)
- [x] 3.3 `mp-webhook/index.ts`: conflict path (pre-check excl. same preapproval + 23505 backstop → **if P is authorized: PROMOTE P to active (user decision 6.2), cancel the pending winner in MP+DB; else PUT-cancel P → ensure P `cancelled`+marker upsert**; **contract: marker ensure-write failure → 200-ack + console.error, never 5xx**); success `200 {"skipped":"duplicate_conflict"}`; failure `200 {"resolution":"retry_via_cron"}`; cancelled/expired: result-checked update (mp keyed) → conditional RPC clear; winner/profile untouched. — DONE 2026-08-09 (commit 3113305; scratch strict-mode tsc PASS incl. helper/sync/cancel/rate-limit; `pnpm build` OK; RPC + marker col not yet live → migration-first deploy)

## Phase 4: Checkout Guard

- [x] 4.1 `create-subscription/index.ts` (auth/rate-limit unchanged): guard `selectLiveSubscription(userId, planId)`; GET-first before every non-orphan cancel; active (expires NULL/>=now) → 409; stale-active → authorized→recover+409, else PUT-cancel+conditional expired → create; pending fresh → **resume only when MP `pending`** (spec-drift contract; else fall through); stale pending → PUT-cancel fail-closed → create; none → 404 → POST → INSERT; 23505 → orphan PUT-cancel → 409; insert error → orphan PUT-cancel → 5xx, no init_point. — DONE 2026-08-09 (scratch strict-mode tsc PASS incl. helper/rate-limit/cancel/sync/webhook; `pnpm build` OK; helper unchanged; RPC + index not yet live → migration-first deploy)

## Phase 5: Expiry Cron

- [x] 5.1 Create `expire-pending-subscriptions/index.ts`: timing-safe service_role bearer (401); set A stale pendings GET-first (authorized→activate+30d, no profile write; pending→PUT-cancel+conditional update; fail→defer); set B markers (authorized/pending→PUT-cancel+clear; cancelled→clear; GET fail→keep+alert); TOCTOU-safe conditional writes; `{cancelled, activated, markers_cleared, deferred}`; **marker >6h → escalation console.error (gate 1b)**. — DONE 2026-08-10 (commit eaf3dab; scratch strict-mode tsc PASS; `pnpm build` OK; escalation ages by `created_at` — table has NO `updated_at`; no-id pending anomaly → conditional local cancel; helper unchanged)
- [x] 5.2 Codified schedule (gate 1a): create `traspaso-supabase/EXPIRY_CRON.md` (job name, hourly, endpoint, service_role bearer) + create dashboard cron. — DONE 2026-08-10 (runbook created; dashboard cron creation is an ops step — see runbook § "Creating the dashboard cron")

## Phase 6: Verification & Sandbox

- [ ] 6.1 Sandbox: MP accepts PUT-cancel on `authorized` preapproval (gate 4a).
- [x] 6.2 Product decision: **RESOLVED 2026-08-09 (user): PROMOTE P** — when the conflict winner row is still pending while conflicting preapproval P is authorized, promote P to active (preserves user payment), cancel the pending winner row in MP + DB. Applies to the conflict path in 3.3: do NOT cancel an authorized P; promote it. Record (gate 4b closed). — APPLIED in 3.3 (commit 3113305)
- [ ] 6.3 Sandbox checklist: stale-active recovered 409; delayed-payment recovery; dead-init_point fall-through; conflict convergence (200+marker → cron clears); concurrent authorize clear; active-first mixed; cron 401.
- [ ] 6.4 Build/deploy: `pnpm build`, deploy functions, apply migration, confirm cron scheduled (runbook).
