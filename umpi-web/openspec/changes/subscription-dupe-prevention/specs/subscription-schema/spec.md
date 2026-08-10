# Subscription Schema Specification

## Purpose

DB-enforced invariant for subscription uniqueness, status integrity, and incident repair: unique partial index, status CHECK constraint, duplicate reconciliation, and idempotent profile backfill.

## Requirements

### Requirement: Unique active-or-pending per user and plan

The `subscriptions` table SHALL have a unique partial index on (`user_id`, `plan_id`) WHERE `status` IN (`active`, `pending`). This SHALL be the invariant every writer (guard, webhooks, sync, cron) relies on.

#### Scenario: Duplicate active-or-pending rejected

- GIVEN an active row for (user, plan)
- WHEN any writer inserts another active or pending row for the same (user, plan)
- THEN the insert raises a unique violation (23505) and the DB rejects it

#### Scenario: Non-conflicting statuses allowed

- GIVEN cancelled and expired rows for (user, plan)
- WHEN a writer inserts one more cancelled or expired row for the same (user, plan)
- THEN the insert succeeds

### Requirement: Status CHECK constraint

`subscriptions.status` SHALL be constrained by CHECK to the known values (`active`, `pending`, `cancelled`, `expired`). The migration SHALL reconcile any existing rows with an unknown status so the constraint can be enabled with zero violations.

#### Scenario: Unknown status rejected

- GIVEN the constraint applied
- WHEN a writer inserts or updates a row to an unknown status
- THEN the write is rejected by the CHECK constraint

#### Scenario: Existing data conforms

- GIVEN the migration applied to live data
- THEN no row violates the status constraint (zero violations)

### Requirement: Duplicate reconciliation and incident backfill

The migration SHALL reconcile pre-existing duplicate active/pending rows per (user, plan) — keeping the newest by `created_at` and transitioning older rows out of active/pending — so the index can be created with zero violations. It SHALL then backfill the incident user's (chelobat16411) profile to the paid Estándar state (`subscription_type` `estandar`, `subscription_expires_at` 2026-09-02) sourced from the single active row 548a19b4. Both steps SHALL be idempotent: re-running SHALL NOT change the end state.

#### Scenario: Reconciliation keeps the newest

- GIVEN legacy duplicate active rows for one (user, plan) with different `created_at`
- WHEN the migration runs
- THEN the newest row stays active-or-pending and older rows transition to a non-conflicting status
- AND the index is created without violations

#### Scenario: Backfill is idempotent

- GIVEN the migration ran once (backfill applied)
- WHEN the migration runs again
- THEN the profile keeps `subscription_type` `estandar` and `subscription_expires_at` 2026-09-02 unchanged
