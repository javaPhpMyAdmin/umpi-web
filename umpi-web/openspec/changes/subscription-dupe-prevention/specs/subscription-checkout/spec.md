# Subscription Checkout Specification

## Purpose

`create-subscription` guard semantics: one active-or-pending subscription per (user, plan); resume young pendings with a live `init_point`; replace stale pendings; arbitrate concurrency via the unique partial index; never return success without an inserted row.

## Requirements

### Requirement: Guard rejects duplicate checkouts

`create-subscription` SHALL reject with 409 Conflict any checkout request for a (user, plan) that already has a subscription row with status `active` or `pending`. The guard SHALL scope by `user_id` AND `plan_id`; a checkout for a different plan SHALL NOT be blocked.

#### Scenario: Duplicate checkout while active

- GIVEN a user with an active row for (user, plan X)
- WHEN they request checkout for plan X
- THEN respond 409 Conflict
- AND no MP preapproval is created and no DB row is inserted

#### Scenario: Checkout for a different plan proceeds

- GIVEN a user with an active row for (user, plan X)
- WHEN they request checkout for plan Y
- THEN the checkout proceeds with a new preapproval and a new pending row

### Requirement: Resume pending checkout under 24 hours

When a pending row exists for (user, plan) with `created_at` newer than 24 hours, `create-subscription` SHALL resume it: re-fetch the existing MP preapproval and return its live `init_point` with `preapproval_id` and `external_reference` (200). It SHALL NOT create a new MP preapproval and SHALL NOT insert a new row.

#### Scenario: Resume returns the live init_point

- GIVEN a pending row for (user, plan) created 10 minutes ago
- WHEN the user requests checkout for that plan
- THEN respond 200 with the `init_point` from the re-fetched MP preapproval
- AND `preapproval_id` matches the pending row's `mp_preapproval_id`
- AND no new MP preapproval or DB row is created

### Requirement: Stale pending is replaced (fail closed)

When a pending row for (user, plan) has `created_at` at or before now − 24 hours, `create-subscription` SHALL cancel the old preapproval on MP, mark the old row `cancelled`, and only then create a new checkout (new MP preapproval + new pending row). If the MP cancel fails, it SHALL fail closed: return an error and SHALL NOT create a new preapproval or row.

#### Scenario: Stale pending replaced

- GIVEN a pending row for (user, plan) created 25 hours ago
- WHEN the user requests checkout for that plan
- THEN the old preapproval is cancelled on MP
- AND the old row status becomes `cancelled`
- AND a new MP preapproval and new pending row are created and returned (200)

#### Scenario: MP cancel failure fails closed

- GIVEN a stale pending row whose MP preapproval cannot be cancelled
- WHEN the user requests checkout for that plan
- THEN respond with an error (5xx)
- AND no new MP preapproval or DB row is created

### Requirement: Concurrent checkout arbitration

If the insert raises a unique violation on the (user_id, plan_id) partial index (a concurrent checkout won), `create-subscription` SHALL respond 409 Conflict, cancel the MP preapproval created by this request (orphan cleanup), and leave the winning row untouched.

#### Scenario: Double-checkout loser

- GIVEN two concurrent checkout requests for the same (user, plan) with no existing row
- WHEN both pass the guard and both insert
- THEN exactly one insert succeeds and returns 200
- AND the loser responds 409 and cancels its own MP preapproval

### Requirement: Insert failures are surfaced

`create-subscription` SHALL NOT return 200 with an `init_point` unless the subscription row was inserted. On any other insert failure, it SHALL return an error (5xx) and SHOULD cancel the MP preapproval created by the failed request.

#### Scenario: Insert error never returns 200-without-row

- GIVEN an MP preapproval created but the DB insert fails (non-unique error)
- WHEN the insert returns an error
- THEN respond 5xx with the error
- AND no `init_point` is returned to the client
