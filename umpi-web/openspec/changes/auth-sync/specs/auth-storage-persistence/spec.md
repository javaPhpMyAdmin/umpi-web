# Auth Storage Persistence Specification

## Purpose

Ensure auth session tokens persist across app restarts in the React Native mobile app by replacing the in-memory storage adapter.

## Requirements

### Requirement: Secure Token Storage

The system SHALL persist auth tokens using `expo-secure-store` instead of the current in-memory `Map`-based storage.

#### Scenario: Auth session survives app kill and restart

- GIVEN a user is authenticated
- WHEN the app is killed (swipe away) and reopened
- THEN `supabase.auth.getSession()` returns a valid session
- AND no re-login is required

#### Scenario: Token refresh persists to secure storage

- GIVEN a user has a valid session with an expiring access token
- WHEN the Supabase client refreshes the token
- THEN the new tokens are written to `expo-secure-store`
- AND the next cold start reads the refreshed tokens

### Requirement: Backward Compatibility

The storage migration SHALL NOT break existing sessions. Users with active sessions before the storage change MAY need to re-login once.

#### Scenario: First launch after storage update

- GIVEN a user had an active session before the storage library change
- WHEN the updated app launches for the first time
- THEN if the session is lost, the user is directed to the login screen (not crashed)
- AND subsequent logins persist correctly via `expo-secure-store`

### Requirement: Storage Interface Compatibility

The replacement storage adapter SHALL implement the same `getItem`/`setItem`/`removeItem` interface expected by `@supabase/ssr` or the Supabase JS client's `storage` option.

#### Scenario: Supabase client accepts the new storage adapter

- GIVEN the Supabase client is initialized with `expo-secure-store` as the storage provider
- WHEN `signInWithPassword` or `signInWithOAuth` completes
- THEN tokens are stored without error
- AND subsequent `getSession` reads the stored tokens correctly
