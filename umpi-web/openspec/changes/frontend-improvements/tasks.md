# Tasks: Frontend Improvements

## Status: COMPLETED

All tasks completed and committed as `feat: auth system, infinite scroll, publish form, and profile improvements` (26187c6).

## Phase 1: Auth System ✅

- [x] 1.1 **`src/contexts/AuthContext.tsx`** — Global auth state provider with session, profile, mutations, onAuthStateChange listener
- [x] 1.2 **`src/features/auth/pages/AuthCallbackPage.tsx`** — OAuth callback handler with PKCE + implicit flow support
- [x] 1.3 **`src/components/auth/ProtectedRoute.tsx`** — Route guard requiring authentication
- [x] 1.4 **`src/components/auth/GuestRoute.tsx`** — Route guard for guest-only pages (login/register)
- [x] 1.5 **`src/app/AppProviders.tsx`** — Restructured with AuthProvider + route guards
- [x] 1.6 **`src/components/layout/Navbar.tsx`** — Auth-aware with dynamic login/logout/avatar
- [x] 1.7 **`src/features/auth/pages/LoginPage.tsx`** — Updated import to AuthContext, return-path redirect
- [x] 1.8 **`src/features/auth/pages/RegisterPage.tsx`** — Updated import to AuthContext
- [x] 1.9 **`src/hooks/useAuth.ts`** — DELETED (replaced by AuthContext)

## Phase 2: Infinite Scroll ✅

- [x] 2.1 **`src/hooks/useInfiniteScroll.ts`** — Reusable IntersectionObserver hook with rootMargin=200px
- [x] 2.2 **`src/hooks/useListings.ts`** — Migrated `useListings` to `useInfiniteQuery` with cursor pagination
- [x] 2.3 **`src/hooks/useListings.ts`** — Added `useFeaturedListingsAllInfinite` hook
- [x] 2.4 **`src/hooks/useListings.ts`** — Added `flattenListings` helper
- [x] 2.5 **`src/features/listings/pages/ExplorePage.tsx`** — Infinite scroll with sentinel, loading indicator, end-of-results UX
- [x] 2.6 **`src/features/listings/pages/FeaturedPage.tsx`** — Infinite scroll, removed inline `useFeaturedListingsAll`

## Phase 3: Publish Form ✅

- [x] 3.1 **`src/hooks/useCities.ts`** — Fetches cities from Supabase
- [x] 3.2 **`src/components/ui/Select.tsx`** — Custom animated dropdown with hover states, check marks, keyboard support
- [x] 3.3 **`src/components/ui/CharacterCounter.tsx`** — Character count with color transitions (green/amber/red)
- [x] 3.4 **`src/features/listings/pages/PublishPage.tsx`** — Cities select, category filter (/ only), character counters
- [x] 3.5 **`src/types/index.ts`** — Added `City` interface

## Phase 4: Profile Page ✅

- [x] 4.1 **`src/hooks/useUserListings.ts`** — Added `deleteMutation` with user_id security check
- [x] 4.2 **`src/components/ui/Modal.tsx`** — Reusable confirmation modal with danger mode, loading state
- [x] 4.3 **`src/features/profile/pages/ProfilePage.tsx`** — Delete listing with modal confirmation
- [x] 4.4 **`src/features/profile/pages/ProfilePage.tsx`** — Removed "Mis Compras" tab
- [x] 4.5 **`src/features/profile/pages/ProfilePage.tsx`** — Removed cart icon and sales count
- [x] 4.6 **`src/features/profile/pages/ProfilePage.tsx`** — Changed "Vendedor Confiable" → "Publicador Confiable"

## Phase 5: Featured Badge ✅

- [x] 5.1 **`src/components/ui/ProductCard.tsx`** — Added golden star pill badge for `is_featured`
- [x] 5.2 **`src/components/ui/FeaturedCard.tsx`** — Updated badge to golden style
- [x] 5.3 **`src/features/profile/pages/ProfilePage.tsx`** — Added featured badge on listing images

## Phase 6: Sorting ✅

- [x] 6.1 **`src/hooks/useListings.ts`** — "Más recientes" sorts by `listing_priority` then `created_at`
- [x] 6.2 **`src/hooks/useListings.ts`** — Compound cursor updated to include `listing_priority`

## Pending (Phase 7 - Follow-up)

- [ ] 7.1 Test Google OAuth end-to-end in browser
- [ ] 7.2 Configure production redirect URL for Google OAuth
- [ ] 7.3 Remove client-side profile INSERT once DB trigger verified
- [ ] 7.4 Wire up Favoritos tab on ProfilePage
- [ ] 7.5 Connect real data for dashboard stats (views/clicks)
