# Proposal: Auth Synchronization (Web ↔ Mobile)

## Intent

Mobile app has full Google OAuth working; web app has dead Google buttons and a `memoryStorage` bug that loses auth state on cold start. Both apps share one Supabase project but have inconsistent auth behavior — users signing in via Google on mobile cannot use the web app, and profile creation is handled differently on each platform. This change unifies auth so both apps are interchangeable login surfaces for the same Supabase accounts.

## Scope

### In Scope
1. **Web Google OAuth**: Implement `signInWithOAuth({ provider: 'google' })` in `useAuth.ts`, wire dead buttons in `LoginPage.tsx` and `RegisterPage.tsx`, handle OAuth callback redirect
2. **Mobile storage fix**: Replace `memoryStorage` (Map) in `lib/storage.ts` with `expo-secure-store` or `AsyncStorage` so auth state survives cold starts
3. **Registration alignment**: Ensure both apps pass `full_name` in `user_metadata` during sign-up
4. **Profile auto-creation DB trigger**: Add a Supabase `on_auth_user_created` trigger that auto-inserts into `profiles` table — removes fragile client-side profile creation from both apps

### Out of Scope
- Password reset flow unification (separate change)
- Session management / refresh token rotation
- Role-based access control
- User profile editing / settings sync
- E2E or integration testing infrastructure (no test runner exists yet)

## Capabilities

### New Capabilities
- `web-google-oauth`: OAuth callback handling, provider sign-in in web app `useAuth.ts`, dead button wiring
- `auth-storage-persistence`: Platform-appropriate secure token storage for React Native

### Modified Capabilities
- `user-registration`: Unified `user_metadata` schema across web and mobile sign-up flows
- `profile-provisioning`: DB-triggered profile creation replacing client-side logic

## Approach

1. **Web OAuth first** (lowest risk, highest user-facing value): Add `signInWithOAuth` call, handle Supabase redirect callback in a new route or existing auth callback handler. Google Cloud Console must add web app domain as authorized redirect URI origin.
2. **Storage fix**: Replace `memoryStorage` Map with `expo-secure-store` (preferred for secrets) or `AsyncStorage` in `lib/storage.ts`. This is a one-file change.
3. **Registration alignment**: Add `full_name` to mobile's `signUp` `user_metadata`. Trivial but needs Supabase dashboard verification of column expectations.
4. **DB trigger**: Create an `on_auth_user_created` edge function or DB trigger that inserts a row into `profiles` with `id = auth.uid()`. Remove client-side profile creation from both apps in a follow-up (not this change — reduces blast radius).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/hooks/useAuth.ts` | Modified | Add `signInWithOAuth` method |
| `src/features/auth/pages/LoginPage.tsx` | Modified | Wire Google button onClick |
| `src/features/auth/pages/RegisterPage.tsx` | Modified | Wire Google button onClick |
| `lib/storage.ts` (mobile) | Modified | Replace memoryStorage with secure store |
| `contexts/AuthContext.tsx` (mobile) | Modified | Align signUp metadata |
| Supabase Dashboard | Config | Add `on_auth_user_created` trigger |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Google OAuth redirect fails for web domain | Medium | Test with staging; add web domain to Google Cloud Console BEFORE deploy |
| DB trigger creates duplicate profiles for existing users | Low | Trigger fires only on `INSERT` to `auth.users`; existing users unaffected |
| Storage migration loses current sessions | Low | `expo-secure-store` falls back gracefully; re-login required once |
| Breaking mobile auth during storage change | Medium | Deploy storage fix on mobile first, verify on device before web changes |

## Rollback Plan

- **Web OAuth**: Revert `useAuth.ts` changes; dead buttons return to non-functional state (current behavior). No data loss.
- **Storage fix**: Revert `lib/storage.ts`; users must re-login on cold start (current behavior).
- **DB trigger**: Drop the trigger function in SQL editor. No data loss — profiles already created client-side remain.

## Dependencies

- Google Cloud Console: web app domain must be added as authorized JavaScript origin
- Supabase Dashboard: `auth.providers.google` already configured; verify web redirect URIs allowed
- Both apps must have same Supabase `anon` key and `project URL` (already verified)

## Success Criteria

- [ ] User can sign in with Google on web and land on authenticated dashboard
- [ ] Mobile app retains auth state across cold starts (app kill + reopen)
- [ ] New user created via Google on either app has a `profiles` row
- [ ] Both apps pass `full_name` in user_metadata on email/password registration
- [ ] `pnpm build` passes after all changes (verify config: `pnpm build`)

## Proposal Question Round

Assumptions needing your review before finalizing:

1. **Profile trigger scope**: Should the DB trigger also handle `profiles` rows for users who signed up before this change (backfill), or only new users going forward?
2. **Storage library choice**: `expo-secure-store` is more secure but has a 2KB value limit; `AsyncStorage` is simpler but stores tokens in plaintext on device. Which tradeoff do you prefer?
3. **Google button on register page**: Should it trigger the same OAuth flow as login (creating an account if new), or should registration remain email/password only and Google is login-only?
4. **First slice order**: The exploration suggested "Web OAuth first" — does that match your priority, or would you rather fix the mobile storage bug first since it affects existing users daily?
