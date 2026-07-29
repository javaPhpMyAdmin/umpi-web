-- Migration: Optimize view tracking with dedup
-- Date: 2026-07-26
-- Purpose: Count unique viewers per listing, not total views

-- ============================================================
-- 1. Add UNIQUE constraint on (listing_id, viewer_id)
-- ============================================================
-- This creates an automatic index for O(log n) lookups
-- NULL viewer_ids are excluded (anonymous views always count)
ALTER TABLE listing_views
  ADD CONSTRAINT unique_listing_viewer
  UNIQUE (listing_id, viewer_id);

-- ============================================================
-- 2. Update record_listing_view RPC
-- ============================================================
-- Uses ON CONFLICT DO NOTHING for dedup
-- Only increments counter when there's a real insert
CREATE OR REPLACE FUNCTION record_listing_view(p_listing_id UUID)
RETURNS VOID AS $$
DECLARE
  v_owner_id UUID;
  v_viewer_id UUID;
  v_rows_inserted INTEGER;
BEGIN
  -- Get listing owner
  SELECT user_id INTO v_owner_id FROM listings WHERE id = p_listing_id;
  IF v_owner_id IS NULL THEN RETURN; END IF;

  -- Get current viewer (NULL if not logged in)
  v_viewer_id := auth.uid();

  -- Don't count self-views
  IF v_viewer_id = v_owner_id THEN RETURN; END IF;

  -- Insert with dedup (ON CONFLICT does nothing)
  INSERT INTO listing_views (listing_id, viewer_id)
  VALUES (p_listing_id, v_viewer_id)
  ON CONFLICT (listing_id, viewer_id) DO NOTHING;

  -- GetRowsAffected to check if insert happened
  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

  -- Only increment counter if this was a new unique viewer
  IF v_rows_inserted > 0 THEN
    INSERT INTO listing_stats (user_id, total_views, updated_at)
    VALUES (v_owner_id, 1, now())
    ON CONFLICT (user_id)
    DO UPDATE SET
      total_views = listing_stats.total_views + 1,
      updated_at = now();
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
