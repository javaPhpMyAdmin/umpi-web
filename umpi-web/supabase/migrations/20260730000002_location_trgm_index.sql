-- Migration: pg_trgm GIN index on listings.location
-- Date: 2026-07-30
-- Purpose: Speed up ILIKE '%term%' location filters (ExplorePage uses
--          .ilike('location', '%...%'), which does a full table scan).
--          pg_trgm GIN indexes support index-backed ILIKE '%term%' matching.

-- Required extension for trigram indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index with trigram operator class on location
CREATE INDEX IF NOT EXISTS idx_listings_location_trgm
  ON public.listings USING GIN (location gin_trgm_ops);
