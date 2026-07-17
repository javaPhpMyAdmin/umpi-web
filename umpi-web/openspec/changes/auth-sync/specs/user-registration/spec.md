# User Registration Specification

## Purpose

Unify the user_metadata schema and registration flow across web and mobile apps so both platforms produce consistent `auth.users` records.

## Requirements

### Requirement: Consistent user_metadata on Sign-Up

Both apps SHALL pass `full_name` in `user_metadata` during `signUp` / `signInWithPassword` registration.

#### Scenario: Web email/password registration includes full_name

- GIVEN a user submits the registration form on the web app with name "Ana García"
- WHEN `supabase.auth.signUp` is called
- THEN `user_metadata.full_name` is `"Ana García"`

#### Scenario: Mobile email/password registration includes full_name

- GIVEN a user submits the registration form on the mobile app with name "Ana García"
- WHEN `supabase.auth.signUp` is called
- THEN `user_metadata.full_name` is `"Ana García"`

#### Scenario: Google OAuth registration uses Google display_name

- GIVEN a user signs up via Google OAuth on either platform
- WHEN the session is created
- THEN `user_metadata.full_name` reflects Google's `user_metadata.full_name` (set by Supabase from Google profile)

### Requirement: Web Registration Passes Full Name

The web `registerMutation` SHALL pass `fullName` as `full_name` in `options.data` during sign-up. (Currently implemented — verified in `useAuth.ts` line 72.)

#### Scenario: Register mutation sends full_name in metadata

- GIVEN the `registerMutation` is invoked with `fullName: "Test User"`
- WHEN `supabase.auth.signUp` is called
- THEN `options.data.full_name` equals `"Test User"`
