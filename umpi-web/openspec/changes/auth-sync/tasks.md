# Tasks: Auth Synchronization (Web ↔ Mobile)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 140–180 (excluding follow-up removal) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR per slice, 4 slices total |
| Delivery strategy | ask-always |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Mobile storage persistence fix | PR 1 (umpi-app repo) | Standalone; fixes daily pain; ~50 lines |
| 2 | DB trigger + backfill | PR 2 (SQL migration) | Infrastructure; no app code deps; ~45 lines |
| 3 | Web Google OAuth (PKCE) | PR 3 (umpi-web) | Core value: working Google login; ~75 lines |
| 4 | Client-side profile removal | PR 4 (both repos) | Follow-up cleanup after trigger verified; ~-20 lines |

## Phase 1: Mobile Storage Fix (umpi-app)

- [ ] 1.1 **`lib/storage.ts`** — Replace in-memory `Map`-based `memoryStorage` with `expo-secure-store` adapter implementing `getItem`/`setItem`/`removeItem` for Supabase AuthStorage contract
- [ ] 1.2 **`contexts/AuthContext.tsx`** — Verify Supabase client init passes new storage adapter; no other changes expected
- [ ] 1.3 Manual test: kill app → reopen → session persists (no re-login)

## Phase 2: DB Trigger + Backfill (Supabase SQL)

- [ ] 2.1 Create migration file `supabase/migrations/<timestamp>_create_profile_trigger.sql` with `handle_new_user()` function and `on_auth_user_created` trigger on `auth.users` INSERT. Fields: `id`, `full_name` from `raw_user_meta_data->>'full_name'`, `avatar_url` from `raw_user_meta_data->>'avatar_url'` (nullable). Use `SECURITY DEFINER`.
- [ ] 2.2 Append backfill SQL to same migration (or separate file): `INSERT INTO profiles (id, full_name, avatar_url) SELECT au.id, au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'avatar_url' FROM auth.users au LEFT JOIN profiles p ON p.id = au.id WHERE p.id IS NULL` with `ON CONFLICT DO NOTHING`
- [ ] 2.3 Run `supabase db push` or apply migration; verify trigger exists: `SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_created'`
- [ ] 2.4 Manual test: create new user via web → verify profiles row auto-created; create new user via mobile → same

## Phase 3: Web Google OAuth (PKCE)

- [ ] 3.1 **`src/lib/supabase.ts`** — Add third arg to `createClient`: `{ auth: { flowType: 'pkce' } }` (~2 lines)
- [ ] 3.2 **`src/hooks/useAuth.ts`** — Add `googleLogin` mutation: calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })`. Add `onSuccess` invalidation for `['auth']` query key. Export from hook return. (~20 lines)
- [ ] 3.3 **`src/features/auth/pages/AuthCallbackPage.tsx`** — Create new file (~35 lines): reads `?code` and `?error` from `URLSearchParams`; on error → redirect `/login?error={message}`; on code → call `supabase.auth.getSession()` to trigger PKCE exchange; success → `/`; failure → `/login?error=session_expired`. Show loading state during exchange.
- [ ] 3.4 **`src/app/AppProviders.tsx`** — Add import for `AuthCallbackPage` and `<Route path="/auth/callback" element={<AuthCallbackPage />} />` (~4 lines)
- [ ] 3.5 **`src/features/auth/pages/LoginPage.tsx`** — Destructure `googleLogin` from `useAuth()`, add `onClick={googleLogin}` to Google button (~2 lines)
- [ ] 3.6 **`src/features/auth/pages/RegisterPage.tsx`** — Same: destructure `googleLogin`, wire to Google button onClick (~2 lines)
- [ ] 3.7 Manual test: click Google on /login → redirected to Google → consent → back to /auth/callback → redirected to / → authenticated. Repeat from /registro.

## Phase 4: Verification

- [ ] 4.1 Run `pnpm build` — confirm no type errors or build failures
- [ ] 4.2 Verify Google Cloud Console has correct authorized redirect URI: `{SUPABASE_URL}/auth/v1/callback`
- [ ] 4.3 Verify email/password signup still works (no regression from PKCE change)
- [ ] 4.4 Verify login → avatar sync still works for existing users with null avatar_url

## Phase 5: Client-Side Profile Removal (Follow-up — separate PR)

- [ ] 5.1 **`src/hooks/useAuth.ts`** — Remove `supabase.from('profiles').insert(...)` block from `registerMutation.mutationFn` (lines 78–89). Keep the `signUp` call and `options.data`. (~-10 lines)
- [ ] 5.2 **Mobile `contexts/AuthContext.tsx`** — Remove client-side profile INSERT from `signUp` handler (~-10 lines)
- [ ] 5.3 Manual test: register new user via email/password → verify profile exists (trigger created it)
- [ ] 5.4 Manual test: register new user via Google → verify profile exists with avatar (trigger created it)
