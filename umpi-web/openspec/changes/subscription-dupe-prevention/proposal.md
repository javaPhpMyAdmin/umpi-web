# Proposal: Subscription Duplicate Prevention

## Intent

Stop duplicate subscriptions per (user, plan) and repair incident fallout: the guard passes pending preapprovals, insert errors are swallowed (still 200 + `init_point`), and profile clears are unconditional.

## Problem Statement (Incident 2026-07-24)

chelobat16411@gmail.com got 9+ ACTIVE Estándar subs: same `external_reference` each checkout, every pending passed the guard, each paid one upserted ACTIVE via mp-webhook. Manual cleanup kept 548a19b4 (expires 2026-09-02); sync-subscription then clobbered the profile to `none` — UI misrepresents the plan.

## Scope

### In Scope

1. **Migration**: unique partial index `(user_id, plan_id) WHERE status IN ('active','pending')`; `CHECK` on status; idempotent backfill of incident profile (estandar, 2026-09-02, from row 548a19b4)
2. **create-subscription**: reject active OR pending; resume pending < 24h (re-fetch MP `init_point`); stale → cancel + new checkout; unique-violation → 409 + orphan cancel; surface insert errors
3. **Sync writers** (mp-webhook / sync-subscription / cancel-subscription): newest ACTIVE-or-PENDING by `created_at DESC`; clear profile only when no other active row remains; webhook conflict → MP cancel + non-retryable
4. **Expiry**: hourly edge-function cron cancels pendings ≥ 24h (MP + DB); guard fallback fails closed

### Non-Goals

No MP-side changes (MP accepts duplicate `external_reference`); no panel/UI changes; no test-infra setup.

## Business Rules

- ONE active-or-pending subscription per user+plan (DB-enforced)
- Pending auto-cancels (MP + DB) after ~24h
- Pending checkout resumes via live `init_point`; no second preapproval

## Capabilities

### New Capabilities

- `subscription-checkout`: guard, resume, 409
- `subscription-sync`: determinism, conditional clears, conflicts, expiry
- `subscription-schema`: index, CHECK, backfill

### Modified Capabilities

- None — only `admin-panel` spec exists

## Approach

Combination, DB-first: the index enforces the invariant for every writer; the guard is the UX path; resume reuses pending checkouts; cron + guard fallback clear stale pendings (on-read lazy rejected — leaves MP dirty); conditional clears + deterministic selection stop the clobber class; backfill repairs state. Webhook conflict (late-paid stale preapproval) → cancel + non-retryable, no 500 loops.

## Affected Areas

Function paths: `traspaso-supabase/supabase/functions/`.

| Area | Impact |
|------|--------|
| `supabase/migrations/` | New — index, CHECK, backfill |
| `create-subscription/index.ts` | Modified |
| `mp-webhook/index.ts` | Modified |
| `sync-subscription/index.ts` | Modified |
| `cancel-subscription/index.ts` | Modified |
| `expire-pending-subscriptions/` | New — cron cleanup |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Stale pending blocks checkouts | Med | Hourly cron + guard fallback |
| Webhook unique-violation retry loop | Med | Non-retryable + MP cancel |
| TOCTOU guard↔insert (concurrent) | Low | Index arbitrates; loser 409 |
| Backfill non-idempotent | Low | Sourced from single active row |

## Rollback Plan

Drop index + CHECK; revert functions; unschedule cron. Backfill reversible via recorded pre-change values (`none`/`paid`/`NULL`).

## Dependencies

- `MP_ACCESS_TOKEN` env (existing) — resume fetch + expiry cancellations
- Supabase platform cron schedule (dashboard ops step)

## Success Criteria

- [ ] Index + CHECK applied; zero violations
- [ ] Duplicate checkout → 409, no new preapproval
- [ ] Pending resumes with live `init_point`
- [ ] Stale pending ≥ 24h cancelled (MP + DB)
- [ ] Profile backfilled, never cleared with another active row
- [ ] `pnpm build` passes
