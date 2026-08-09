# Design: Subscription Duplicate Prevention (rev. 3 — gate-review fixes)

Rev. 3 changes: (1) webhook-conflict convergence fixed — cron now picks up `conflict_resolution_pending` marker rows (rev. 2's cron only selected `status='pending'`, so a failed MP cancel was never retried → silent monthly double-charge loop); (2) guard treats `active` rows past `expires_at` as stale-replace eligible (no multi-day lockout); (3) GET-first before every non-conflict cancel (no blind cancels of paid preapprovals); (4) atomic single-statement conditional profile clear; (5) backfill ordering pinned; (6) cancel-subscription active-first; (7) resume only when MP status is pending.

## Technical Approach

DB-first (per proposal): the unique partial index `(user_id, plan_id) WHERE status IN ('active','pending')` is the invariant every writer relies on; the guard is the UX path (409/resume/stale-replace); the hourly cron is the slow-path reconciler (stale pendings + conflict markers); conditional profile clears stop the clobber class; the webhook conflict path always converges — MP cancel, on failure a marker row the cron retries hourly, 200 ack (locked spec: no 5xx). **MP is the authority: no preapproval is cancelled without a status check, except proven duplicates (conflict markers) and self-created orphans.**

## Architecture Decisions

### D1: One atomic migration `20260809000001_subscription_dupe_prevention.sql`

All inside the `to_regclass('public.subscriptions')` guard (pattern of 20260801000002; `subscriptions` is dump-only). **Exact order** (reconcile → backfill → structure; backfill MUST run after reconcile so the pinned row is guaranteed `active`):

| # | Step | SQL intent |
|---|---|---|
| 1 | Marker column | `ADD COLUMN IF NOT EXISTS conflict_resolution_pending boolean NOT NULL DEFAULT false` (D3 retry handle) |
| 2 | Reconcile pinned | Live rows sharing `(user_id, plan_id)` with the incident row → `'cancelled'`, EXCEPT the row matching `id::text LIKE '548a19b4%' AND mp_preapproval_id = 'ddaa579d2b374131b22c1ca2cebbf9e9'` — the pin survives regardless of recency (fixes silent backfill failure). `RAISE NOTICE` if the pin row is absent (apply must confirm incident state) |
| 3 | Reconcile generic | Live rows with a newer live sibling (same `user_id`, `plan_id IS NOT DISTINCT FROM`, tie-break `ORDER BY created_at DESC, id DESC`) → `'cancelled'` |
| 4 | Unknown status | `NULL`/unknown → `'cancelled'` + `RAISE NOTICE` (verified 0 today; loud if any appear) |
| 5 | Backfill | `UPDATE profiles p SET subscription_type = sp.slug, subscription_status='paid', subscription_expires_at = s.expires_at FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id WHERE p.id = s.user_id AND s.id::text LIKE '548a19b4%' AND s.mp_preapproval_id = 'ddaa579d2b374131b22c1ca2cebbf9e9' AND s.status='active'` — idempotent (same values each run; pin keeps row active). `RAISE NOTICE` if 0 rows |
| 6 | Index | `CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_plan_live ON subscriptions (user_id, plan_id) WHERE status IN ('active','pending')` (`idx_subscriptions_*` convention) |
| 7 | CHECK | `status IS NOT NULL AND status IN ('active','pending','cancelled','expired')`, via idempotent `pg_constraint` probe (bare `IN` passes NULL) |
| 8 | Clear RPC | `clear_profile_subscription_if_no_active(p_user uuid) RETURNS boolean` SECURITY DEFINER: **single atomic statement** `UPDATE profiles SET subscription_type='none', subscription_expires_at=NULL WHERE id = p_user AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE user_id = p_user AND status='active'); RETURN FOUND;` — no count-then-clear, no `FOR UPDATE` (READ COMMITTED re-checks the predicate against the latest committed row after any lock wait, so a concurrent webhook's paid write can never be clobbered). REVOKE PUBLIC/anon/authenticated, GRANT service_role (mirrors bump_rate_limit + 20260731000001) |
| 9 | `expire_subscriptions` | `CREATE OR REPLACE`: profile-clear UPDATE (20260731000001:63-65) gains `AND NOT EXISTS (... status='active')`; grants re-applied — the cron joins the conditional-clear invariant (included, not scoped out) |

`plan_id` nullable → index treats NULL as non-conflicting (writers always set it — accepted); reconcile still groups NULLs via `IS NOT DISTINCT FROM`.

### D2: create-subscription guard — state machine (auth + rate limit unchanged)

Guard: newest live row for `(user_id, plan_id)`, `ORDER BY created_at DESC, id DESC`. **MP GET precedes every decision; `init_point` is never stored** (verified — no column in dump).

| Found (DB) | MP status (GET) | Action |
|---|---|---|
| `active`, `expires_at IS NULL` OR `>= now()` | — | **409** (real active; NULL-expiry treated live — cron effective-expiry tiers reconcile it; closes today's pass-on-NULL bug) |
| `active`, `expires_at < now()` (**stale-active**) | GET fail → 5xx; `authorized` → `UPDATE … SET status='active', expires_at = next_billing_date\|\|+30d` → **409** "already active" (user still billed — cancel = money-loss; row untouched); else (`pending`/`cancelled`/`expired`/`paused`) → PUT cancel (fail → 5xx, stop) → conditional `UPDATE … SET status='expired' WHERE id AND status='active' AND expires_at < now()` (0 rows → 409) → create flow | |
| `pending` | GET fail → 5xx; `authorized` → `UPDATE … SET status='active', expires_at = next_billing_date\|\|+30d` → **409** (user paid; webhook/sync complete profile); `cancelled`/`expired`/`paused` → `UPDATE status='cancelled'` (no PUT) → create flow; **`pending` fresh (`> now()-24h`) → resume 200 `{init_point, preapproval_id, external_reference}` ONLY here — init_point returned only when MP status is `pending`** (dead-init_point contract: any other MP status falls through to recover/409 or replace); `pending` stale (`<= now()-24h`) → PUT cancel (fail → 5xx, stop) → conditional `UPDATE status='cancelled' WHERE id AND status='pending'` (0 rows → 409) → create flow | |
| none | — | create flow: plan fetch (404) → `POST /preapproval` → INSERT `pending`; `23505` (concurrent checkout won) → PUT-cancel orphan → **409**; other insert error → PUT-cancel orphan → **5xx** no `init_point` (never 200-without-row) |

Orphan exception (documented): created by this request, `init_point` never returned → cannot be paid → PUT-cancel without GET is safe. **GET-first everywhere else**: stale-active and stale-pending branches re-fetch before cancelling, so a paid 24h-old preapproval (webhook delayed — the incident's exact failure mode) is recovered to active, never cancelled. Cron interplay: guard = fast path; `expire_subscriptions` (D1-9) = slow path (effective-expiry tiers + 3-day grace for NULL-expiry rows); `expired`/`cancelled` rows free the index slot, so a lapsed user re-checkouts the moment the guard (or cron) marks the stale row — no multi-day lockout.

### D3: Webhook conflict — convergent (option b: 200 always, cron-converged)

Conflict = `subscription_authorized_payment` for P with a live `(user, plan)` row on a different preapproval. Pre-check (excluding same preapproval id) + `23505` on the upsert as race backstop. Then `PUT /preapproval/{P}` cancel:

- **Success** → ensure P's row `cancelled`, marker `false` → `200 {"ok":true,"skipped":"duplicate_conflict"}`. MP stops charging.
- **Failure** → ensure P's row `cancelled` + `conflict_resolution_pending = true` (upsert a `cancelled` row keyed by `mp_preapproval_id` if none — cancelled rows never trip the index; P never stays live) → structured `console.error` alert → `200 {"skipped":"duplicate_conflict","resolution":"retry_via_cron"}`.
- **Convergence (rev. 3 fix)**: the cron (D6) processes **marker rows `status='cancelled' AND conflict_resolution_pending = true` — no age filter** — hourly: GET P, PUT-cancel while `authorized`/`pending`, clear marker on success; `cancelled`/`expired` → clear marker; GET fail → keep + alert. Retried every run until MP converges → **no perpetual charge, no silent loss** (rev. 2 dead-ended here: its cron only selected `status='pending'`, so markers were never picked up). Winner row and profile never touched.
- **Sanctioned authorized-cancel**: the conflict/marker path is the ONLY place an `authorized` preapproval is cancelled — P is a proven duplicate (a live winner occupies the slot). All other paths cancel only `pending`/stale non-authorized preapprovals.

Rejected: 5xx-on-cancel-failure (violates locked spec "SHALL NOT return 5xx"; couples convergence to MP's webhook retry loop and leaves no DB trace of the conflict).

### D4: Selection + atomic clear

- `selectLiveSubscription(admin, userId, planId?)`: `status IN ('active','pending')`, `mp_preapproval_id IS NOT NULL AND != ''` (as sync/cancel use today), `ORDER BY created_at DESC, id DESC` — matches reconcile tie-break and max_images/feature_listing determinism. Used by sync (locked spec) and the guard.
- `cancel-subscription`: **active-first** — newest `active` if any, else newest `pending` (explicit user intent; PUT-cancel tolerates already-cancelled, no GET needed). Prevents "user cancels pending Y while active X keeps billing" (warning 6); spec's "Pending is cancellable" scenario (only live row is pending) still holds.
- Webhook cancelled/expired branches keep `mp_preapproval_id` keying (unique index — deterministic by identity).
- Clear (webhook cancelled/expired, sync cancelled/expired, cancel) runs AFTER the row update via the RPC — one atomic statement (D1-8). Pending rows never block the clear; `subscription_status` untouched.

### D5: Shared helper `_shared/subscription.ts`

**Adopt** (pattern of `_shared/rate-limit.ts`): `LIVE_STATUSES`, `PENDING_STALE_MS`, `selectLiveSubscription`, `fetchPreapproval`, `cancelPreapproval` (tolerates already-cancelled), `clearProfileSubscription` (RPC wrapper). Used by 5 functions. Rejected: per-function duplication (drift — the bug class this change kills); DB RPC for MP calls (can't reach MP API).

### D6: Expiry cron — edge function + dashboard ops step, never blind-cancels

| Option | Tradeoff | Decision |
|---|---|---|
| `expire-pending-subscriptions` edge function + dashboard Cron (hourly, POST + `service_role` bearer; function compares `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` timing-safe, else 401) | Needs `MP_ACCESS_TOKEN` (Deno env); no secrets/URLs in migrations; no pg_net precedent; proposal lists dashboard ops step | **Adopt** |
| pg_cron + `net.http_post` in migration | Secret material in git; no precedent | Rejected |

**Two row sets** (rev. 3: markers added — the convergence path):

**A) Stale pendings** (`status='pending' AND created_at <= now()-24h`) — **GET status FIRST** (no blind cancel of a paid 24h-old preapproval — incident mode):

| MP status | Action |
|---|---|
| GET fails | log, leave pending, next run |
| `authorized` | `UPDATE … SET status='active', expires_at = next_billing_date\|\|+30d` (webhook-delay payment recovery; NO profile change — spec: cron SHALL NOT modify profiles; webhook/sync complete it) |
| `pending` | PUT cancel (tolerate already-cancelled) → conditional `UPDATE status='cancelled' WHERE id AND status='pending' AND created_at <= cutoff` (0 rows → concurrent replace, no-op); cancel fails → keep pending + alert, next run |
| `cancelled`/`expired`/`paused` | conditional `UPDATE` to match, no PUT |

**B) Marker rows** (`status='cancelled' AND conflict_resolution_pending = true`) — no age filter; the ONLY sanctioned authorized-cancel (duplicate cleanup):

| MP status | Action |
|---|---|
| GET fails | keep marker + alert, next run |
| `authorized`/`pending` | PUT cancel → success clears marker (row stays cancelled); failure keeps marker + alert, next run |
| `cancelled`/`expired` | clear marker, no PUT |

TOCTOU-safe: every DB write is conditional on status+staleness, and cron only ever resolves markers or ≥24h pendings (resume is <24h). Returns `{cancelled, activated, markers_cleared, deferred}` 200.

## File Changes

| File | Action |
|---|---|
| `supabase/migrations/20260809000001_subscription_dupe_prevention.sql` | Create — D1 (marker col, reconcile pinned+generic, backfill, index, CHECK, RPC, expire_subscriptions) |
| `supabase/tests/subscription_dupe_prevention_verify.sql` | Create — repo verify convention (BEGIN/ROLLBACK, RAISE EXCEPTION) |
| `traspaso-supabase/supabase/functions/_shared/subscription.ts` | Create — D5 |
| `traspaso-supabase/supabase/functions/create-subscription/index.ts` | Modify — D2 state machine |
| `traspaso-supabase/supabase/functions/mp-webhook/index.ts` | Modify — D3 + atomic clear |
| `traspaso-supabase/supabase/functions/sync-subscription/index.ts` | Modify — D4 |
| `traspaso-supabase/supabase/functions/cancel-subscription/index.ts` | Modify — D4 active-first |
| `traspaso-supabase/supabase/functions/expire-pending-subscriptions/index.ts` | Create — D6 + bearer auth |
| Dashboard (ops, no file) | Hourly cron POST `…/expire-pending-subscriptions`, `service_role` bearer |

## Interfaces / Contracts

```ts
export const LIVE_STATUSES = ['active', 'pending']
export const PENDING_STALE_MS = 24 * 60 * 60 * 1000
export async function selectLiveSubscription(admin: SupabaseClient, userId: string, planId?: string): Promise<SubscriptionRow | null>
// MP helpers throw with HTTP status + body context on failure (fail-loud; no
// envelope to forget checking) — never return `ok: false` with partial data.
export async function fetchPreapproval(mpAccessToken: string, id: string): Promise<any>
export async function cancelPreapproval(mpAccessToken: string, id: string): Promise<{ cancelled: true; alreadyCancelled: boolean }>
export async function clearProfileSubscription(admin: SupabaseClient, userId: string): Promise<boolean>
// RPC: clear_profile_subscription_if_no_active(p_user uuid) RETURNS boolean — single atomic UPDATE, service_role only
// Cron: POST /expire-pending-subscriptions, Authorization: Bearer <SERVICE_ROLE_KEY> (timing-safe), else 401
```

## Testing Strategy

| Layer | What | How |
|---|---|---|
| SQL verify | Index rejects 2nd live insert (23505); CHECK rejects unknown AND NULL; reconcile keeps newest + pinned row survives; backfill idempotent + matches pin; RPC clears only when no active row (concurrent-active case); expire_subscriptions conditional clear | `subscription_dupe_prevention_verify.sql` (`supabase db query --linked --workdir traspaso-supabase`) |
| Edge functions | **Unverified by automation** (test infra = proposal non-goal; billing logic stays code-review + sandbox covered). Manual MP-sandbox checklist: guard stale-active authorized → recovered 409 NOT cancelled; stale pending paid (webhook delayed) → recovered active, not cancelled; resume contract (MP no-longer-pending → falls through, no dead init_point); webhook conflict with MP-cancel failure → 200 + marker set → cron converges (cancels + clears marker) next run; atomic clear vs concurrent authorize; active-first cancel mixed case; cron bearer 401 | MP sandbox + code review |

## Migration / Rollout

One migration (D1 order). Rollback: drop index + CHECK + marker column; restore `expire_subscriptions` / drop RPC; backfill reversible via recorded pre-change values; functions reverted via git; delete dashboard cron. Cron additive — guard fallback keeps behavior safe if scheduling is delayed.

## Open Questions

- [ ] Full UUID of row `548a19b4` (matched by prefix + pinned mp_preapproval_id) — confirm at apply.
- [ ] MP error shape for PUT-cancel of already-cancelled preapproval — treated as success.
- [ ] Confirm MP accepts PUT-cancel of an `authorized` preapproval (incident cleanup did — validate in sandbox).
- [ ] Edge: winner row still `pending` while conflicting P is `authorized` — locked spec cancels P (user's payment on P is the loser's); flag for product call: promote P instead?
- [ ] Dashboard cron job name for idempotent re-creation.
