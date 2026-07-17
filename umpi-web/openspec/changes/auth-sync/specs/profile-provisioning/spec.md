# Profile Provisioning Specification

## Purpose

Auto-create a `profiles` row via a PostgreSQL database trigger when a new user is created in `auth.users`, eliminating fragile client-side profile creation.

## Requirements

### Requirement: Database Trigger on User Creation

A PostgreSQL trigger on `auth.users` SHALL insert a row into `profiles` on every new user INSERT.

#### Scenario: Email/password signup creates profile automatically

- GIVEN a new user signs up via email/password on either platform
- WHEN the row is inserted into `auth.users`
- THEN a `profiles` row is created with `id = auth.uid()`, `full_name` from `user_metadata.full_name`, and `avatar_url` from `user_metadata.avatar_url` (nullable)

#### Scenario: Google OAuth signup creates profile automatically

- GIVEN a new user signs up via Google OAuth
- WHEN the row is inserted into `auth.users`
- THEN a `profiles` row is created with `id = auth.uid()`, `full_name` from Google's `user_metadata`, and `avatar_url` from Google's profile picture

#### Scenario: Trigger does not fire for existing users

- GIVEN a user already exists in `auth.users` before the trigger is deployed
- WHEN the trigger is created
- THEN no duplicate `profiles` row is created for that user

### Requirement: Backfill Existing Users Without Profiles

A one-time backfill SQL script SHALL create `profiles` rows for any existing `auth.users` row that lacks a corresponding `profiles` entry.

#### Scenario: Backfill creates profiles for orphaned users

- GIVEN 10 users exist in `auth.users` and only 7 have `profiles` rows
- WHEN the backfill script runs
- THEN 3 new `profiles` rows are created with `full_name` from `user_metadata` and `avatar_url` from `user_metadata`

#### Scenario: Backfill is idempotent

- GIVEN the backfill script has already been executed
- WHEN it runs again
- THEN no duplicate rows are created (uses `INSERT ... ON CONFLICT DO NOTHING` or equivalent)

### Requirement: Client-Side Profile Creation Removal

After the trigger is deployed, both apps SHALL remove client-side `profiles` INSERT logic from their registration mutations. (Scope: this change documents the removal; actual code removal is a follow-up to reduce blast radius.)

#### Scenario: Web registerMutation no longer inserts profile

- GIVEN the DB trigger is deployed and verified
- WHEN `registerMutation` completes on the web app
- THEN no `supabase.from('profiles').insert(...)` call is made
- AND the profile exists via the trigger

#### Scenario: Mobile signUp no longer inserts profile

- GIVEN the DB trigger is deployed and verified
- WHEN `signUp` completes on the mobile app
- THEN no client-side profile INSERT call is made
