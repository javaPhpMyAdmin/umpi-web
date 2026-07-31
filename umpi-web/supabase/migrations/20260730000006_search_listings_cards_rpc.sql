-- Migration: card-only projection for search results (search_listings_cards)
-- Date: 2026-07-30
-- Purpose: search_listings (20260718000007) returns full rows — description,
--          the full category jsonb — that the ExplorePage search grid never
--          renders: it shows ProductCard components, which only need the card
--          projection. That payload is several times larger than needed and
--          the original RPC also predates the `condition` column
--          (20260718000009), so search cards never showed the Nuevo/Usado
--          badge. This new variant returns exactly the card columns used by
--          the non-search listing queries (LISTING_CARD_COLUMNS in
--          useListings.ts). The old search_listings is left untouched for any
--          other consumer. search_vector is only used for ranking and was
--          never part of the returned payload.

CREATE OR REPLACE FUNCTION search_listings_cards(
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
  )
  SELECT to_jsonb(r.*) - 'rank' FROM ranked r
  ORDER BY rank DESC, listing_priority DESC, created_at DESC, id DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;
