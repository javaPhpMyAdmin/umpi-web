-- Migration: Fix CASCADE DELETE — prevent conversation/message loss when listing is deleted
-- Date: 2026-07-18
-- Purpose: Changing ON DELETE CASCADE to ON DELETE SET NULL on conversations.listing_id
-- so deleting a listing doesn't destroy associated conversations and messages.

-- First, drop the existing foreign key constraint
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_listing_id_fkey;

-- Re-add with ON DELETE SET NULL instead of CASCADE
ALTER TABLE conversations
  ADD CONSTRAINT conversations_listing_id_fkey
  FOREIGN KEY (listing_id)
  REFERENCES listings(id)
  ON DELETE SET NULL;
