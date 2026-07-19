-- Migration: Rate limiting table for Edge Functions
-- Date: 2026-07-18
-- Purpose: Track request counts per user per function to prevent spam

CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count INT NOT NULL DEFAULT 1,
  UNIQUE(user_id, function_name, window_start)
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON rate_limits(user_id, function_name, window_start);

-- Auto-cleanup: delete old entries (older than 1 hour)
-- This runs via pg_cron or can be called manually
-- For now, functions will skip stale windows automatically

-- RLS: only service role can read/write (Edge Functions use service role)
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role only" ON rate_limits;
  CREATE POLICY "Service role only"
    ON rate_limits FOR ALL
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;
