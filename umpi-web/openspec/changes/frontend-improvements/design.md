# Design: Frontend Improvements

## Architecture Overview

### Auth System

```
AppProviders
├── AuthProvider (AuthContext)
│   ├── Session management (supabase.auth.onAuthStateChange)
│   ├── Profile fetching (profiles table)
│   └── Auth mutations (login, register, logout, googleLogin)
├── ProtectedRoute → redirects to /login if no session
└── GuestRoute → redirects to / if authenticated
```

**Key Decisions:**
- AuthContext over useAuth hook: Global context needed for route guards
- Separate AuthCallbackPage: Handles OAuth redirect cleanly
- Profile fetched on auth state change, not on mount

### Infinite Scroll

```
useInfiniteQuery (TanStack Query)
├── Query key: ['listings', 'infinite', filters]
├── Cursor: { listing_priority, created_at, id }
├── PAGE_SIZE: 24
└── getNextPageParam: returns nextCursor or undefined

useInfiniteScroll (IntersectionObserver)
├── rootMargin: '200px' (pre-fetch)
├── sentinelRef: div at bottom of grid
└── onLoadMore: calls fetchNextPage()
```

**Key Decisions:**
- Cursor-based over offset-based: More stable with concurrent writes
- Compound cursor: Handles ties in sorting correctly
- PAGE_SIZE = 24: Optimal for 2-4 column grids
- rootMargin = 200px: Smooth UX with pre-fetching

### Publish Form

```
PublishPage
├── useCategories() → filter by name.includes('/')
├── useCities() → Supabase cities table
├── Custom Select component (animated dropdown)
├── CharacterCounter (green/amber/red transitions)
└── maxLength enforcement on inputs
```

**Key Decisions:**
- Category filter: Only show categories with `/` in name (user preference)
- Custom Select: Better UX than native select with animations
- Character counters: Visual feedback for limits

### Profile Page

```
ProfilePage
├── useUserListings → includes deleteMutation
├── Modal component → confirmation with danger mode
├── Featured badge → golden star pill
└── Tabs: "Mis Avisos" + "Favoritos" (no "Mis Compras")
```

**Key Decisions:**
- Modal over window.confirm: Better UX with loading state
- user_id check in delete: Security — only delete own listings
- Featured badge: Consistent across all listing cards

## Data Flow

### Auth Flow
```
Login/Register → supabase.auth → onAuthStateChange → AuthContext
→ Profile fetch → Navbar update (avatar, logout)
```

### Listings Flow
```
ExplorePage/FeaturedPage → useListings/useFeaturedListingsAllInfinite
→ useInfiniteQuery → Supabase range query → flattenListings
→ ProductCard grid → sentinel div → IntersectionObserver
→ fetchNextPage → append to pages → re-render
```

### Delete Flow
```
ProfilePage → delete button → Modal confirmation
→ deleteMutation → supabase.from('listings').delete()
→ invalidateQueries → refetch → UI update
```

## Performance Considerations

1. **Infinite scroll**: Only fetch 24 items initially, more on scroll
2. **Cursor pagination**: No OFFSET scan, uses index efficiently
3. **IntersectionObserver**: Native browser API, no library overhead
4. **useMemo/useCallback**: Stable references in PublishPage
5. **staleTime: 5min**: Reduces unnecessary refetches
