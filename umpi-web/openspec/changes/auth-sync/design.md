# Design: Auth Synchronization (Web ↔ Mobile)

## Technical Approach

Four coordinated changes to unify auth across web (umpi-web) and mobile (umpi-app), both backed by the same Supabase project. Deploy mobile storage fix first (fixes daily pain), then web OAuth (new user-facing value), then DB trigger (structural improvement).

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| OAuth flow type | PKCE (Supabase default) vs implicit | PKCE is more secure, required by Supabase v2+; implicit is deprecated | **PKCE** — default, zero config needed |
| Callback route | New `/auth/callback` route vs inline hash parsing | New route is cleaner, follows Supabase docs pattern; inline is fragile | **New `/auth/callback` route** |
| Mobile storage | expo-secure-store (2KB limit) vs AsyncStorage (plaintext) | Secure-store uses Keychain (encrypted); AsyncStorage stores tokens in plaintext on device | **expo-secure-store** — security wins; split session JSON if needed |
| Profile trigger timing | DB trigger vs Edge Function | Trigger is simpler, runs in-DB, no cold start; Edge Function adds latency | **DB trigger** — simpler, lower latency |
| Google on register | Same OAuth flow (auto-creates account) vs email-only | Same flow reduces code, matches mobile behavior; email-only adds friction | **Same OAuth flow** — Supabase handles create-or-login automatically |
| Client-side profile creation | Keep during this change vs remove | Remove = bigger blast radius; keep = redundant but safe | **Keep during this change**, remove in follow-up |

## Data Flow

### Web Google OAuth

```
User clicks "Continuar con Google"
  → useAuth.googleLogin()
  → supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
  → Browser redirects to Google consent screen
  → Google redirects back to /auth/callback?code=...
  → AuthCallbackPage extracts ?code, calls supabase.auth.getSession()
  → Supabase exchanges code for session (PKCE)
  → Redirects to /
  → useAuth detects session via React Query, fetches profile
```

### Mobile Storage

```
App cold start
  → Supabase client reads session from expo-secure-store
  → Session found → auth state restored (no re-login needed)
  → Session missing → user must re-login (same as current behavior)
```

### DB Trigger

```
INSERT INTO auth.users (new user via any method)
  → Trigger: on_auth_user_created fires
  → INSERT INTO profiles (id, full_name, avatar_url)
  → Both apps query profiles normally
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/supabase.ts` | Modify | Add `auth: { flowType: 'pkce' }` to client options |
| `src/hooks/useAuth.ts` | Modify | Add `googleLogin()` mutation using `signInWithOAuth` |
| `src/features/auth/pages/AuthCallbackPage.tsx` | Create | OAuth callback route — exchanges code, redirects to `/` |
| `src/features/auth/pages/LoginPage.tsx` | Modify | Wire Google button onClick to `googleLogin()` |
| `src/features/auth/pages/RegisterPage.tsx` | Modify | Wire Google button onClick to `googleLogin()` |
| `src/app/AppProviders.tsx` | Modify | Add `<Route path="/auth/callback" element={...} />` |
| `lib/storage.ts` (mobile) | Modify | Replace memoryStorage Map with expo-secure-store adapter |

## Interfaces / Contracts

**`useAuth` hook — new return value:**

```typescript
googleLogin: () => Promise<void>  // triggers OAuth redirect, never returns
```

**OAuth callback page — minimal:**

```typescript
// AuthCallbackPage.tsx
// 1. Read ?code and ?error from URLSearchParams
// 2. If error → redirect to /login?error={message}
// 3. If code → supabase.auth.getSession() triggers PKCE exchange
// 4. On success → redirect to /
// 5. On failure → redirect to /login?error=session_expired
```

**Mobile storage adapter — contract:**

```typescript
// Must satisfy Supabase's AuthStorage interface:
// getItem(key: string) => Promise<string | null>
// setItem(key: string, value: string) => Promise<void>
// removeItem(key: string) => Promise<void>
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | googleLogin calls signInWithOAuth with correct params | Manual verification — no test runner configured |
| Integration | OAuth callback exchange succeeds and redirects | Manual browser test after Google Cloud Console config |
| E2E | Full login → authenticated state → logout cycle | Manual device/browser testing |
| Build | `pnpm build` passes after all changes | Automated via verify phase |

## Migration / Rollout

### Deployment Order (4 slices)

1. **Mobile storage fix** (`lib/storage.ts`) — ships alone, immediate value
2. **Web OAuth** (useAuth + AuthCallbackPage + route + button wiring) — needs Google Cloud Console domain add BEFORE deploy
3. **DB trigger** (Supabase SQL migration + backfill) — safe to run anytime, backward compatible
4. **Registration alignment** (verify mobile passes full_name) — trivial, ships with trigger

### Backfill SQL (one-time, idempotent)

```sql
-- Run AFTER trigger is created
-- Only affects users without a profiles row
INSERT INTO profiles (id, full_name, avatar_url)
SELECT
  au.id,
  au.raw_user_meta_data->>'full_name',
  au.raw_user_meta_data->>'avatar_url'
FROM auth.users au
LEFT JOIN profiles p ON p.id = au.id
WHERE p.id IS NULL;
```

### Rollback

- **OAuth**: Revert useAuth.ts changes; dead buttons return (current state)
- **Storage**: Revert lib/storage.ts; re-login required on cold start (current state)
- **Trigger**: `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users; DROP FUNCTION IF EXISTS handle_new_user();`

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Google redirect URI not configured → OAuth fails silently | Test with staging domain first; verify Google Cloud Console before deploy |
| expo-secure-store 2KB limit exceeded by session JSON | Split session across multiple keys OR verify Supabase session size is under 2KB |
| DB trigger conflicts with existing client-side profile creation | Trigger uses INSERT only; existing profiles unaffected by LEFT JOIN backfill |
| React Query cache stale after OAuth redirect | `onSuccess` callback in googleLogin invalidates `['auth']` query key |

## Open Questions

- [ ] Does Supabase session JSON exceed 2KB? If so, storage adapter needs key-splitting strategy
- [ ] Should the auth callback page show a loading spinner during exchange, or redirect immediately?
- [ ] Does the mobile app's `expo-secure-store` need a migration script, or does the adapter just work transparently?
