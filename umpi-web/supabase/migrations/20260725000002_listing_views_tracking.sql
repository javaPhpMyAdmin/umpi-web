-- Migration: Listing views tracking
-- Date: 2026-07-25
-- Purpose: Track listing views with permanent summary + temporary detail

-- ============================================================
-- listing_views: temporary detail (deleted after 30 days by cron)
-- ============================================================
CREATE TABLE IF NOT EXISTS listing_views (
  id BIGSERIAL PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  viewer_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_views_listing ON listing_views(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_views_created ON listing_views(created_at);

ALTER TABLE listing_views ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (fire-and-forget from client)
DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can record a view" ON listing_views;
  CREATE POLICY "Anyone can record a view"
    ON listing_views FOR INSERT
    WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Only the listing owner can read their views
DO $$ BEGIN
  DROP POLICY IF EXISTS "Owner can read own listing views" ON listing_views;
  CREATE POLICY "Owner can read own listing views"
    ON listing_views FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM listings
        WHERE listings.id = listing_views.listing_id
          AND listings.user_id = auth.uid()
      )
    );
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- listing_stats: permanent summary (never deleted)
-- ============================================================
CREATE TABLE IF NOT EXISTS listing_stats (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  total_views BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE listing_stats ENABLE ROW LEVEL SECURITY;

-- Owner can read their own stats
DO $$ BEGIN
  DROP POLICY IF EXISTS "Owner can read own stats" ON listing_stats;
  CREATE POLICY "Owner can read own stats"
    ON listing_stats FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Service role can upsert stats (via RPC)
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role can manage stats" ON listing_stats;
  CREATE POLICY "Service role can manage stats"
    ON listing_stats FOR ALL
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- RPC: Record a view (insert detail + update summary)
-- ============================================================
CREATE OR REPLACE FUNCTION record_listing_view(p_listing_id UUID)
RETURNS VOID AS $$
DECLARE
  v_owner_id UUID;
  v_viewer_id UUID;
BEGIN
  -- Get listing owner
  SELECT user_id INTO v_owner_id FROM listings WHERE id = p_listing_id;
  IF v_owner_id IS NULL THEN RETURN; END IF;

  -- Get current viewer (NULL if not logged in)
  v_viewer_id := auth.uid();

  -- Don't count self-views
  IF v_viewer_id = v_owner_id THEN RETURN; END IF;

  -- Insert detail
  INSERT INTO listing_views (listing_id, viewer_id)
  VALUES (p_listing_id, v_viewer_id);

  -- Upsert summary (permanent counter)
  INSERT INTO listing_stats (user_id, total_views, updated_at)
  VALUES (v_owner_id, 1, now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    total_views = listing_stats.total_views + 1,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: Get user's total views
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_views(p_user_id UUID)
RETURNS BIGINT AS $$
  SELECT COALESCE(total_views, 0) FROM listing_stats WHERE user_id = p_user_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- Cron job: Clean up views older than 30 days
-- Run via pg_cron or manual schedule
-- ============================================================
-- SELECT cron.schedule(
--   'clean-old-listing-views',
--   '0 3 * * *',  -- every day at 3am
--   $$DELETE FROM listing_views WHERE created_at < now() - interval '30 days'$$
-- );
-- NOTE: pg_cron may not be available on free tier. Run manually or via edge function.
