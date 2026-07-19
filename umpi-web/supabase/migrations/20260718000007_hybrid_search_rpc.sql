-- Migration: Update search_listings RPC with hybrid FTS + ILIKE
-- Date: 2026-07-18
-- Purpose: plainto_tsquery requires full token match ("lap" ≠ "laptop")
--          Hybrid approach: FTS for stemmed ranking + ILIKE for partial/prefix matching

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
  )
  SELECT to_jsonb(r.*) - 'rank' FROM ranked r
  ORDER BY rank DESC, listing_priority DESC, created_at DESC, id DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;
