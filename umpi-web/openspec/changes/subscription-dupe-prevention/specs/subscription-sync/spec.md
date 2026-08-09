# Subscription Sync Specification

## Purpose

Deterministic state synchronization across writers (`mp-webhook`, `sync-subscription`, `cancel-subscription`) and the expiry cron: pick the newest active-or-pending row by `created_at`; clear profiles only when no other active row remains; resolve webhook conflicts without retry loops.

## Requirements

### Requirement: Deterministic row selection

`sync-subscription` and `cancel-subscription` SHALL select the newest row with status IN (`active`, `pending`) ordered by `created_at` DESC (not any-status by `started_at`). `sync-subscription` SHALL sync only that row against MP; `cancel-subscription` SHALL cancel only that row.

#### Scenario: Newest active-or-pending wins

- GIVEN a user with an older cancelled row and multiple legacy active rows with different `created_at`
- WHEN `sync-subscription` runs
- THEN the row with the newest `created_at` among active-or-pending rows is the one synced against MP

#### Scenario: Pending is cancellable

- GIVEN a user whose only active-or-pending row is pending
- WHEN `cancel-subscription` runs
- THEN the pending row is cancelled on MP and marked `cancelled`

### Requirement: Conditional profile clear

`mp-webhook` (cancelled/expired branches), `sync-subscription` (cancelled/expired branches) and `cancel-subscription` SHALL clear the profile subscription fields (`subscription_type` → `none`, `subscription_expires_at` → NULL) only when the user has no remaining row with status `active` across all plans; otherwise the profile SHALL be left unchanged.

#### Scenario: Webhook cancels the only active plan

- GIVEN a user with one active row and no other active rows
- WHEN `mp-webhook` processes a `cancelled` preapproval
- THEN the row becomes `cancelled` and the profile subscription fields are cleared

#### Scenario: Another active plan remains

- GIVEN a user with active rows on two different plans
- WHEN `mp-webhook` processes a `cancelled` preapproval for one of them
- THEN only that row becomes `cancelled`
- AND the profile keeps its subscription fields (no clear)

#### Scenario: sync-subscription cancelled branch

- GIVEN a user syncing whose MP preapproval reports `cancelled` and no other active row exists
- WHEN `sync-subscription` runs
- THEN the row becomes `cancelled` and the profile is cleared

### Requirement: Webhook conflict resolution

When an authorized-payment webhook would create a second active-or-pending row for the same (user, plan) (unique violation), `mp-webhook` SHALL resolve the conflict per decision 6.2 (RESOLVED — preserve the user's payment):

- winner still `pending` AND conflicting preapproval P `authorized` → **promote P**: cancel the unpaid pending winner in MP + DB (frees the live slot), activate P as the live row, then converge the profile to the paid state with the same write as the happy path (plan slug, `subscription_expires_at`, `paid`, trial consumed).
- otherwise → **cancel P**: PUT-cancel P on MP, ensure P's row is `cancelled`, and set the `conflict_resolution_pending` marker to reflect the outcome (false = converged, true = the hourly cron must retry the cancellation).

In both branches `mp-webhook` SHALL respond with a non-retryable success ack and SHALL NOT return 5xx for the conflict condition itself (no retry loop). The winner ROW is never modified; the profile is only modified in the promote branch (converged for P — never cleared by the conflict path). On promote, a profile-convergence failure SHALL ack 200 with `retry_via_cron`, never 5xx: P is already active (not a marker row), so the cron cannot cancel it, and the profile converges later via `sync-subscription` or P's next webhook event.

#### Scenario: Late payment of a stale preapproval

- GIVEN a user with an active row for (user, plan) and a cancelled preapproval that later reports `authorized`
- WHEN `mp-webhook` processes the authorized event
- THEN the conflicting preapproval is cancelled on MP
- AND `mp-webhook` acks non-retryably (2xx, not 5xx)
- AND the active row and profile are unchanged

#### Scenario: Authorized preapproval conflicts with an unpaid pending winner

- GIVEN a user with a `pending` row for (user, plan) (the winner) and a different preapproval P that reports `authorized` with the same `external_reference`
- WHEN `mp-webhook` processes the authorized event for P
- THEN the pending winner is cancelled on MP and marked `cancelled`
- AND P becomes the `active` row (promoted)
- AND the profile is converged to the paid state (plan slug, expiry, `paid`)
- AND `mp-webhook` acks non-retryably (2xx, not 5xx)

### Requirement: Stale pending expiry cron

The hourly `expire-pending-subscriptions` cron SHALL cancel every pending row with `created_at` ≤ now() − 24 hours: MP cancel first, then mark the row `cancelled`. It SHALL NOT touch pending rows younger than 24 hours and SHALL NOT modify profiles. If the MP cancel fails for a row, the row SHALL stay pending for the next run. The 24-hour threshold SHALL match the checkout guard's staleness definition.

#### Scenario: Cron cancels stale pendings

- GIVEN pending rows aged 25 hours and 23 hours
- WHEN the cron runs
- THEN the 25-hour row is cancelled on MP and marked `cancelled`
- AND the 23-hour row remains pending
- AND profiles are untouched

#### Scenario: MP failure defers the row

- GIVEN a stale pending row whose MP cancel returns an error
- WHEN the cron runs
- THEN the row stays `pending`
- AND a later run retries the cancellation
