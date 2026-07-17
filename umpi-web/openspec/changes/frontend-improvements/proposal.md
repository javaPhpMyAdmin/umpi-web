# Proposal: Frontend Improvements (Auth, Infinite Scroll, UX Polish)

## Intent

Major frontend improvements across multiple features for the umpi-web marketplace:

1. **Auth System** — Google OAuth with PKCE, route guards, auth-aware UI
2. **Infinite Scroll** — Progressive loading on ExplorePage and FeaturedPage
3. **Publish Form** — Cities select, category filtering, character counters
4. **Profile Page** — Delete listings, modal confirmation, badge cleanup
5. **Featured Badge** — Golden star pill on all listing cards

## Scope

### In Scope
- Google OAuth PKCE flow (AuthContext, AuthCallbackPage, ProtectedRoute, GuestRoute)
- Infinite scroll with useInfiniteQuery and cursor-based pagination
- Custom Select component with animated dropdown
- Cities select from Supabase
- Category filtering (only categories with `/` in name)
- Character counters (title: 100, description: 500)
- Delete listing with confirmation modal
- Featured badge styling (golden star pill)
- Auth-aware navbar (login/logout/avatar)
- Profile tab cleanup (remove "Mis Compras", sales count)
- "Publicador Confiable" rename

### Out of Scope
- Production Google OAuth redirect URL configuration
- Client-side profile INSERT removal (deferred to Phase 6)
- Real dashboard stats (views/clicks currently hardcoded)
- Favoritos tab implementation

## Approach

### Auth System
- Created `AuthContext.tsx` as global auth provider (session, profile, mutations)
- `AuthCallbackPage.tsx` handles OAuth redirect with PKCE token exchange
- `ProtectedRoute.tsx` and `GuestRoute.tsx` for route guards
- `AppProviders.tsx` restructured with route guards
- `Navbar.tsx` made auth-aware with dynamic login/logout/avatar

### Infinite Scroll
- Created `useInfiniteScroll.ts` hook with IntersectionObserver (rootMargin: 200px)
- Refactored `useListings` from `useQuery` to `useInfiniteQuery`
- Compound cursor: `listing_priority` + `created_at` + `id` for stable pagination
- PAGE_SIZE = 24 (optimal for 2-4 column grids)
- `flattenListings` helper for consuming paginated data

### Publish Form
- Created `useCities.ts` hook fetching cities from Supabase
- Custom `Select.tsx` component with animated dropdown, hover states, check marks
- Category filter: only show categories with `/` in name
- `CharacterCounter.tsx` component with color transitions (green → amber → red)
- `maxLength` enforcement on inputs, `.trim()` on mutation

### Profile Page
- Delete listing: `useMutation` in `useUserListings.ts` with user_id security check
- `Modal.tsx` component: danger mode, loading state, ESC/click-outside close
- Featured badge: golden star pill (`bg-amber-500`) on listing images
- Removed "Mis Compras" tab, sales count, changed "Vendedor" → "Publicador"

### Featured Badge
- Consistent golden star pill across `ProductCard`, `FeaturedCard`, `ProfilePage`
- `bg-amber-500`, white text, white star icon, pill shape with shadow
- Appears when `is_featured === true` on listing

## Key Decisions

1. **AuthContext over useAuth hook** — Global context needed for ProtectedRoute/GuestRoute guards
2. **Cursor-based pagination** — More stable than offset-based with concurrent writes
3. **Compound cursor** — Required for sorting by priority then date without gaps
4. **rootMargin: 200px** — Pre-fetches before user reaches bottom for smooth UX
5. **PAGE_SIZE = 24** — Balances initial load time with scroll frequency
6. **window.confirm → Modal** — Better UX with loading state and danger styling

## Risks

- **Google OAuth** — Needs production redirect URL configuration (deferred)
- **Profile INSERT** — Client-side insert still present (Phase 6 cleanup)
- **Dashboard stats** — Hardcoded values, needs real data integration
