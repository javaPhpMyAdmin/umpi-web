-- Migration: Create RPC function for full-text search
-- Date: 2026-07-18
-- Purpose: textSearch PostgREST operator not supported; use RPC instead

CREATE OR REPLACE FUNCTION search_listings(
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
      l.listing_priority, l.created_at,
      CASE
        WHEN p_query IS NOT NULL AND p_query != ''
        THEN ts_rank(l.search_vector, plainto_tsquery('spanish', p_query))
        ELSE 0
      END AS rank
    FROM listings l
    WHERE l.status = 'active'
      AND (
        p_query IS NULL OR p_query = ''
        OR l.search_vector @@ plainto_tsquery('spanish', p_query)
      )
      AND (p_category_id IS NULL OR l.category_id = p_category_id)
      AND (p_price_min IS NULL OR l.price >= p_price_min)
      AND (p_price_max IS NULL OR l.price <= p_price_max)
      AND (p_location IS NULL OR l.location ILIKE '%' || p_location || '%')
  )
  SELECT to_jsonb(r.*) FROM ranked r
  ORDER BY rank DESC, listing_priority DESC, created_at DESC, id DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;
