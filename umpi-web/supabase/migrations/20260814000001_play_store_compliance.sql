-- Migration: Play Store compliance — user blocks, reports, account deletion
-- Date: 2026-08-14
-- Purpose:
--   1. user_blocks — users can block other users; blocked users' listings are
--      excluded from the caller's search results (Google Play: in-app block).
--   2. reports — users can report listings/users/messages for moderation;
--      admins (profiles.is_admin) read reports.
--   3. delete_account() — self-service account deletion RPC (Google Play:
--      "Delete account" requirement). Storage cleanup + auth.users delete;
--      every dependent table cascades from auth.users(id).
--   4. search_listings / search_listings_cards — hide the caller's blocked
--      users' listings from search (search_listings is used by the mobile
--      app; search_listings_cards by this web app — both are shared-DB RPCs).
--
-- Conventions: idempotent, RLS enabled, SECURITY DEFINER SET search_path = '',
-- explicit revoke/grant pairs (see 20260731000005, 20260730000007).

-- ============================================================
-- 1. user_blocks — a user manages only their own blocks
-- ============================================================
create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  -- A user cannot block themselves (own listings would vanish from own search).
  constraint user_blocks_no_self_block check (blocker_id <> blocked_id)
);

-- Reverse lookup: "who blocks me" and per-blocked-user scans.
-- The (blocker_id, blocked_id) unique constraint already covers
-- forward lookups (blocker → their block list).
create index if not exists user_blocks_blocked_id_idx
  on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- Read own block list.
drop policy if exists "Users can read own blocks" on public.user_blocks;
create policy "Users can read own blocks"
  on public.user_blocks for select
  using (blocker_id = auth.uid());

-- Block another user.
drop policy if exists "Users can block others" on public.user_blocks;
create policy "Users can block others"
  on public.user_blocks for insert
  with check (blocker_id = auth.uid());

-- Unblock (blocks are insert/delete only — no UPDATE policy).
drop policy if exists "Users can unblock" on public.user_blocks;
create policy "Users can unblock"
  on public.user_blocks for delete
  using (blocker_id = auth.uid());

-- Default privileges grant ALL to anon/authenticated; close that and keep
-- only the verbs the policies allow (same convention as 20260731000005).
revoke all on public.user_blocks from anon, authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
-- anon SELECT is REQUIRED even though the RLS policy yields zero rows for
-- anon (auth.uid() IS NULL → blocker_id = NULL matches nothing): both search
-- RPCs are SECURITY INVOKER and anon has EXECUTE on them, so the NOT EXISTS
-- subquery against user_blocks is privilege-checked at PLAN time. Without
-- this grant every anonymous search raises permission denied for table
-- user_blocks and the public browse/search feature dies.
grant select on public.user_blocks to anon;

-- ============================================================
-- 2. reports — moderation queue; admins read, users file
-- ============================================================
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('listing', 'user', 'message')),
  target_id uuid not null,
  reason text not null check (char_length(reason) <= 2000),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

-- Any authenticated user can file a report against themselves as reporter.
drop policy if exists "Users can report" on public.reports;
create policy "Users can report"
  on public.reports for insert
  with check (reporter_id = auth.uid());

-- Admins read the moderation queue. Same is_admin pattern as
-- "Admins can delete any listing" (20260725000001).
drop policy if exists "Admins can read reports" on public.reports;
create policy "Admins can read reports"
  on public.reports for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );

-- No UPDATE/DELETE policies: regular users cannot modify or retract reports;
-- the only writer is the reporter at INSERT time, the only reader is admin.
revoke all on public.reports from anon, authenticated;
grant select, insert on public.reports to authenticated;

-- ============================================================
-- 3. delete_account() — self-service account deletion RPC
-- ============================================================
-- Google Play requires users to be able to delete their account and data
-- in-app. The RPC removes the user's storage objects and then the
-- auth.users row; every dependent table references auth.users(id) with
-- ON DELETE CASCADE (verified against create_umpi_schema +
-- esqueleto_proyecto.sql): profiles, listings, conversations, messages,
-- reviews, notifications, subscriptions, legal_consents, user_blocks
-- (blocker/blocked) and reports (reporter). No per-table deletes needed
-- — the cascade handles them, so none are duplicated here.
--
-- Storage: live policies on both buckets are path-based
-- (storage.foldername(name)[1] = auth.uid()), and the storage service
-- blocks direct DELETE from storage.objects via the protect_objects_delete
-- trigger unless storage.allow_delete_query is set. We must set it for the
-- duration of this transaction (3rd arg true = local to current tx) BEFORE
-- deleting, and match the path-based predicate so objects uploaded outside
-- the client API (e.g. admin/dashboard uploads with a different owner_id)
-- are also removed. The auth.users delete is NOT affected by that trigger.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Allow the storage trigger to proceed for this transaction only.
  perform set_config('storage.allow_delete_query', 'true', true);

  -- Remove the user's avatar (bucket 'avatars', path {userId}/...).
  delete from storage.objects
  where bucket_id = 'avatars'
    and (storage.foldername(name))[1] = v_uid::text;

  -- Remove the user's listing images (bucket 'listing-images').
  delete from storage.objects
  where bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = v_uid::text;

  -- Remove the auth identity — FK cascades wipe all dependent data.
  delete from auth.users where id = v_uid;
end;
$$;

-- Client-facing RPC: revoke the default-privilege grants (anon + PUBLIC
-- execute; the direct authenticated grant is re-opened below) and keep
-- EXECUTE for authenticated only — anon must never reach it (same pair as
-- record_legal_consent in 20260731000005).
revoke all on function public.delete_account() from public, anon, authenticated;
grant execute on function public.delete_account() to authenticated;

-- Pin the SECURITY DEFINER owner: the definer bypasses RLS on
-- storage.objects/auth.users, so the owner must be the superuser-ish role
-- regardless of which role applied this migration (same convention as
-- record_legal_consent in 20260731000005).
alter function public.delete_account() owner to postgres;

-- ============================================================
-- 4. Search RPCs — exclude listings from users the caller blocked
-- ============================================================
-- Both functions are SECURITY INVOKER (no definer), so auth.uid() reflects
-- the real caller. For anon, auth.uid() IS NULL → the NOT EXISTS subquery
-- matches no rows → no filtering (anonymous search is unchanged). Grants
-- are preserved by CREATE OR REPLACE.

-- search_listings (last body: 20260718000007) — used by the mobile app.
create or replace function search_listings(
  p_query text,
  p_category_id uuid DEFAULT NULL,
  p_price_min numeric DEFAULT NULL,
  p_price_max numeric DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_limit int DEFAULT 24,
  p_offset int DEFAULT 0
)
RETURNS SETOF jsonb
LANGUAGE sql STABLE
AS $$
  WITH ranked AS (
    SELECT
      l.id, l.title, l.description, l.price, l.images, l.location,
      l.category_id, l.user_id, l.status, l.is_featured,
      l.listing_priority, l.created_at, l.price_type, l.rating,
      l.reviews_count, l.city_id,
      jsonb_build_object(
        'id', c.id, 'name', c.name, 'slug', c.slug,
        'icon', c.icon, 'image_url', c.image_url,
        'is_active', c.is_active, 'created_at', c.created_at
      ) AS category,
      CASE
        WHEN p_query IS NOT NULL AND p_query != ''
        THEN ts_rank(l.search_vector, plainto_tsquery('spanish', p_query))
        ELSE 0
      END AS rank
    FROM listings l
    LEFT JOIN categories c ON c.id = l.category_id
    WHERE l.status = 'active'
      AND (
        p_query IS NULL OR p_query = ''
        -- FTS: full token match with stemming ("nueva" → matches "nuevo")
        OR l.search_vector @@ plainto_tsquery('spanish', p_query)
        -- ILIKE: partial/prefix match ("lap" → matches "Laptop")
        OR l.title ILIKE '%' || p_query || '%'
        OR l.description ILIKE '%' || p_query || '%'
      )
      AND (p_category_id IS NULL OR l.category_id = p_category_id)
      AND (p_price_min IS NULL OR l.price >= p_price_min)
      AND (p_price_max IS NULL OR l.price <= p_price_max)
      AND (p_location IS NULL OR l.location ILIKE '%' || p_location || '%')
      -- Hide listings owned by users the caller has blocked.
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE ub.blocker_id = auth.uid()
          AND ub.blocked_id = l.user_id
      )
  )
  SELECT to_jsonb(r.*) - 'rank' FROM ranked r
  ORDER BY rank DESC, listing_priority DESC, created_at DESC, id DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;

-- search_listings_cards (20260730000006) — used by this web app's search
-- grid. Same block filter so the web UI and the mobile app behave alike.
create or replace function search_listings_cards(
  p_query text,
  p_category_id uuid DEFAULT NULL,
  p_price_min numeric DEFAULT NULL,
  p_price_max numeric DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_limit int DEFAULT 24,
  p_offset int DEFAULT 0
)
RETURNS SETOF jsonb
LANGUAGE sql STABLE
AS $$
  WITH ranked AS (
    SELECT
      l.id, l.title, l.price, l.price_type, l.images, l.location,
      l.condition, l.is_featured, l.listing_priority, l.featured_until,
      l.created_at, l.user_id, l.rating, l.reviews_count,
      l.category_id, l.city_id, l.status,
      CASE
        WHEN p_query IS NOT NULL AND p_query != ''
        THEN ts_rank(l.search_vector, plainto_tsquery('spanish', p_query))
        ELSE 0
      END AS rank
    FROM listings l
    WHERE l.status = 'active'
      AND (
        p_query IS NULL OR p_query = ''
        -- FTS: full token match with stemming ("nueva" → matches "nuevo")
        OR l.search_vector @@ plainto_tsquery('spanish', p_query)
        -- ILIKE: partial/prefix match ("lap" → matches "Laptop")
        OR l.title ILIKE '%' || p_query || '%'
        OR l.description ILIKE '%' || p_query || '%'
      )
      AND (p_category_id IS NULL OR l.category_id = p_category_id)
      AND (p_price_min IS NULL OR l.price >= p_price_min)
      AND (p_price_max IS NULL OR l.price <= p_price_max)
      AND (p_location IS NULL OR l.location ILIKE '%' || p_location || '%')
      -- Hide listings owned by users the caller has blocked.
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE ub.blocker_id = auth.uid()
          AND ub.blocked_id = l.user_id
      )
  )
  SELECT to_jsonb(r.*) - 'rank' FROM ranked r
  ORDER BY rank DESC, listing_priority DESC, created_at DESC, id DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;
