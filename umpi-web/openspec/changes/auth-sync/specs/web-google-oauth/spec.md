# Web Google OAuth Specification

## Purpose

Enable Google OAuth sign-in on the web app (React/Vite), replacing dead Google buttons with a working OAuth flow backed by Supabase.

## Requirements

### Requirement: OAuth Sign-In Initiation

The system SHALL initiate Google OAuth via `supabase.auth.signInWithOAuth({ provider: 'google' })` when a user clicks any "Continuar con Google" button.

#### Scenario: Login page Google button triggers OAuth redirect

- GIVEN the user is on `/login`
- WHEN they click "Continuar con Google"
- THEN the browser redirects to Google's OAuth consent screen

#### Scenario: Register page Google button triggers same OAuth flow

- GIVEN the user is on `/registro`
- WHEN they click "Continuar con Google"
- THEN the browser redirects to Google's OAuth consent screen
- AND the resulting session is created identically to login (Supabase handles new vs. existing user)

### Requirement: OAuth Callback Handling

The system SHALL handle the OAuth redirect callback and exchange the authorization code for a session.

#### Scenario: Successful OAuth callback sets session

- GIVEN Google redirected back with a valid authorization code
- WHEN the callback route processes the code
- THEN `supabase.auth.getSession()` returns a valid session
- AND the user is redirected to `/`

#### Scenario: OAuth callback with error shows message

- GIVEN Google redirected back with an error parameter
- WHEN the callback route processes the response
- THEN the user sees an error message on the login page
- AND no session is created

#### Scenario: OAuth callback without code parameter

- GIVEN the browser lands on the callback URL without `code` or `error` params
- WHEN the callback route processes the request
- THEN the user is redirected to `/login`

### Requirement: Post-OAuth Profile Sync

After successful OAuth, the system SHALL sync the Google avatar into the `profiles` row if one exists and lacks an avatar.

#### Scenario: Existing profile with no avatar gets Google avatar

- GIVEN a user logs in via Google and has an existing `profiles` row with `avatar_url = null`
- WHEN the session is established
- THEN `profiles.avatar_url` is updated with `user_metadata.avatar_url`

#### Scenario: New Google user has no manual profile creation

- GIVEN a new user authenticates via Google for the first time
- WHEN the session is established
- THEN no client-side profile INSERT occurs (handled by DB trigger — see profile-provisioning spec)
