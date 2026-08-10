# Admin Panel Specification

## Purpose

Gated `/administrador` surface (owners only) for registrations and subscription/trial state, backed by a SECURITY DEFINER RPC reading `auth.users` (email + registration date, not client-queryable).

## Requirements

### Requirement: Admin RPC access control

`admin_list_users()` SHALL be SECURITY DEFINER (`SET search_path = 'public'`, owner postgres), raising when `auth.uid()` is NULL or the caller's profile lacks `is_admin = true`. The caller SHALL derive only from `auth.uid()`, never a parameter. Migration `20260801000005_admin_panel.sql` SHALL `REVOKE ALL ON FUNCTION admin_list_users() FROM public, anon, authenticated` and `GRANT EXECUTE TO authenticated`; service_role keeps it via superuser.

#### Scenario: Admin success

- GIVEN a caller with `is_admin = true`
- WHEN `admin_list_users()` runs
- THEN the payload returns

#### Scenario: Non-admin denied

- GIVEN an authenticated caller with `is_admin = false`
- WHEN `admin_list_users()` runs
- THEN an exception raises and no data returns

#### Scenario: Unauthenticated denied

- GIVEN no session (`auth.uid()` IS NULL)
- WHEN `admin_list_users()` runs
- THEN an exception raises

#### Scenario: Anonymous cannot execute

- GIVEN the migration applied
- THEN `has_function_privilege('anon', ..., 'EXECUTE')` is false

### Requirement: Admin RPC payload

The RPC SHALL return one jsonb payload: `stats` (total_users, new_users_today, new_users_this_week); `users` (id, email, full_name, created_at, subscription_type, subscription_status, subscription_expires_at, trial_ends_at, active_listings_count); `subscriptions` (id, payer email, plan name, status, started_at, expires_at) — active only. No phone/location/avatar; no NOTICE/WARNING; raised messages carry no PII.

#### Scenario: Stats from auth.users.created_at

- GIVEN users registered today and earlier this week
- THEN total_users counts all `auth.users`; today/week via `date_trunc('day'/'week', now())`

#### Scenario: Registration date

- GIVEN a backfilled orphan profile (`profiles.created_at` = backfill time)
- THEN `created_at` comes from `auth.users.created_at`

#### Scenario: Active-only

- GIVEN a user with 2 active + 3 other listings and a payer with an active + cancelled subscription
- THEN `active_listings_count` is 2
- AND only the active subscription appears, with plan name and payer email

#### Scenario: PII-free error

- GIVEN a denied or failed call
- THEN the raised message contains no email, name, or row data

### Requirement: Admin route guard

The app SHALL expose `/administrador` behind `AdminRoute`: unauthenticated → `/login`, loading → spinner, non-admin → `/perfil`; lazy-loaded, inside `LegalConsentGate`.

#### Scenario: Admin reaches the panel

- GIVEN an admin who accepted the legal version
- WHEN opening `/administrador`
- THEN AdminPage renders

#### Scenario: Non-admin redirect + RPC denial

- GIVEN an authenticated non-admin opening `/administrador`
- THEN redirected to `/perfil`
- AND a direct RPC call still raises

#### Scenario: Unauthenticated redirected to login

- GIVEN no session at `/administrador`
- THEN redirect to `/login`, path preserved

### Requirement: Admin page and hook

AdminPage SHALL render stat cards (total, new today, new this week), a users table (email, full_name, registered, subscription, trial, active listings), and a subscriptions overview — hand-built Tailwind (no Table primitive) — with loading/empty/error states and Spanish UI strings; data via `useAdminUsers`.

#### Scenario: Data rendered

- GIVEN a successful RPC response
- THEN stats, table rows, and subscriptions render with the specified columns

#### Scenario: Empty data

- GIVEN no users or no active subscriptions
- THEN the section shows an empty state

#### Scenario: Fetch failure

- GIVEN the RPC call fails
- THEN an error state with retry shows

### Requirement: Profile entry link

ProfilePage SHALL render a "Panel Admin" link only when `profile.is_admin === true`, to `/administrador`.

#### Scenario: Link shown for admin

- GIVEN an admin viewing their profile
- THEN the "Panel Admin" link shows

#### Scenario: Link hidden for non-admin

- GIVEN a non-admin viewing their profile
- THEN no admin link renders

### Requirement: SQL verification

The change SHALL ship `supabase/tests/admin_panel_verify.sql` (BEGIN/ROLLBACK) asserting denial, success, grants.

#### Scenario: Verify passes

- GIVEN migrations applied, admin + non-admin seeded
- WHEN run as postgres
- THEN non-admin raises, admin gets rows, grants match

## Non-Goals

CSV export, phone/location/avatar, user edit/ban, listings moderation, email digests — out of scope for v1.
