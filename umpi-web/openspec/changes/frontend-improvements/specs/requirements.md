# Spec: Frontend Improvements

## 1. Auth System

### 1.1 Google OAuth

**Given** a user is on the login or register page  
**When** they click the Google button  
**Then** they are redirected to Google consent screen  
**And** after consent, they return to `/auth/callback`  
**And** the PKCE code exchange happens automatically  
**And** they are redirected to `/` authenticated

**Given** a user completes Google OAuth  
**When** the callback page receives the code  
**Then** `supabase.auth.getSession()` is called to exchange the code  
**And** on success, the user is redirected to `/`  
**And** on failure, the user is redirected to `/login?error=session_expired`

### 1.2 Route Guards

**Given** a user is not authenticated  
**When** they visit a protected route (e.g., `/perfil`, `/publicar`)  
**Then** they are redirected to `/login`

**Given** a user is authenticated  
**When** they visit a guest-only route (e.g., `/login`, `/registro`)  
**Then** they are redirected to `/`

### 1.3 Auth-Aware Navbar

**Given** a user is not authenticated  
**When** they view the navbar  
**Then** the "Publicar" button shows  
**And** the login link shows  
**And** no avatar shows

**Given** a user is authenticated  
**When** they view the navbar  
**Then** their avatar shows  
**And** a logout option shows  
**And** the login link is hidden

## 2. Infinite Scroll

### 2.1 ExplorePage

**Given** a user is on the explore page  
**When** they scroll near the bottom (200px threshold)  
**Then** the next page of results is fetched automatically  
**And** a "Cargando más..." indicator shows  
**And** new items are appended to the grid

**Given** all results are loaded  
**When** the user scrolls to the bottom  
**Then** a "No hay más resultados" message shows

### 2.2 Sorting

**Given** a user selects "Más recientes" sort  
**When** results are fetched  
**Then** items are sorted by `listing_priority` DESC first  
**And** then by `created_at` DESC  
**And** then by `id` DESC for ties

## 3. Publish Form

### 3.1 Cities Select

**Given** a user is on the publish page  
**When** they click the city dropdown  
**Then** cities from the Supabase `cities` table are shown  
**And** the dropdown animates open with a smooth transition  
**And** the selected city shows a check mark

### 3.2 Category Filter

**Given** a user is on the publish page  
**When** categories are loaded  
**Then** only categories with `/` in the name are shown (e.g., "Autos/motos")

### 3.3 Character Counters

**Given** a user types in the title field  
**When** the character count changes  
**Then** a counter shows `current/max`  
**And** the counter is green when < 70% used  
**And** amber when 70-90% used  
**And** red when > 90% or at limit  
**And** input is blocked at 100 characters

**Given** a user types in the description field  
**When** the character count changes  
**Then** the same counter behavior applies  
**And** input is blocked at 500 characters

## 4. Profile Page

### 4.1 Delete Listing

**Given** a user clicks the delete button on a listing  
**When** the confirmation modal opens  
**Then** the listing title is shown in the message  
**And** the modal has a danger styling (red icon)  
**And** the confirm button shows a spinner while deleting  
**And** the modal closes on success  
**And** the listing is removed from the grid

### 4.2 Featured Badge

**Given** a listing has `is_featured === true`  
**When** it is shown in any card component  
**Then** a golden star pill badge shows on the image  
**And** the badge has `bg-amber-500` background  
**And** white text "Destacado" with a white star icon  
**And** the badge is positioned top-left on the image

### 4.3 Tab Cleanup

**Given** a user views their profile  
**When** they see the tabs  
**Then** only "Mis Avisos" and "Favoritos" are shown  
**And** "Mis Compras" is not present  
**And** the sales count and cart icon are not present  
**And** "Vendedor Confiable" shows as "Publicador Confiable"
