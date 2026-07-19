-- Migration: Full-text search, GIN indexes, RLS policies, and message optimization
-- Date: 2026-07-18
-- Purpose: Fix scalability bottlenecks found in Supabase query audit

-- ============================================================
-- 1. FULL-TEXT SEARCH ON LISTINGS (replaces ilike('%term%'))
-- ============================================================
-- ilike with leading wildcard does full table scan.
-- tsvector + GIN index enables instant search.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_listings_search ON listings USING GIN (search_vector);

-- ============================================================
-- 2. GIN INDEX ON NOTIFICATIONS.DATA (for .contains() queries)
-- ============================================================
-- The notification mark-read query uses .contains('data', { conversation_id }).
-- Without GIN, Postgres does sequential scan + JSON containment check per row.

CREATE INDEX IF NOT EXISTS idx_notifications_data ON notifications USING GIN (data);

-- ============================================================
-- 3. INDEXES FOR CONVERSATION QUERIES
-- ============================================================
-- Conversations are queried by user1_id OR user2_id.
-- Partial indexes speed up the most common query pattern.

CREATE INDEX IF NOT EXISTS idx_conversations_user1 ON conversations (user1_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_user2 ON conversations (user2_id, last_message_at DESC);

-- ============================================================
-- 4. INDEX FOR MESSAGES LOOKUP BY CONVERSATION
-- ============================================================
-- Messages are always queried by conversation_id + ordered by created_at.

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages (conversation_id, created_at DESC);

-- ============================================================
-- 5. INDEX FOR NOTIFICATION COUNT QUERY
-- ============================================================
-- Counts unread notifications per user — needs composite index.

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, is_read) WHERE is_read = false;

-- ============================================================
-- 6. RLS POLICIES FOR MESSAGES DELETE
-- ============================================================
-- Ensure only conversation participants can delete messages.

DO $$
BEGIN
  -- Drop existing delete policy if any (to avoid duplicates)
  DROP POLICY IF EXISTS "Users can delete own messages" ON messages;

  CREATE POLICY "Users can delete own messages"
    ON messages
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM conversations
        WHERE conversations.id = messages.conversation_id
          AND (conversations.user1_id = auth.uid() OR conversations.user2_id = auth.uid())
      )
    );
EXCEPTION WHEN undefined_table THEN
  -- messages table doesn't exist yet, skip
  NULL;
END $$;

-- ============================================================
-- 7. RLS POLICIES FOR CONVERSATIONS DELETE
-- ============================================================
-- Ensure only conversation participants can delete conversations.

DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can delete own conversations" ON conversations;

  CREATE POLICY "Users can delete own conversations"
    ON conversations
    FOR DELETE
    USING (
      user1_id = auth.uid() OR user2_id = auth.uid()
    );
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;
