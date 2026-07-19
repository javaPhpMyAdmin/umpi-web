-- Migration: Enable RLS + policies on all public tables
-- Date: 2026-07-18
-- Purpose: Ensure no table is publicly accessible without RLS
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS)

-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================
ALTER TABLE IF EXISTS listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reviews ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- LISTINGS: anyone can read active, only owner can modify
-- ============================================================
DO $$ BEGIN
  DROP POLICY IF EXISTS "Listings are publicly readable" ON listings;
  CREATE POLICY "Listings are publicly readable"
    ON listings FOR SELECT
    USING (status = 'active' OR user_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can insert own listings" ON listings;
  CREATE POLICY "Users can insert own listings"
    ON listings FOR INSERT
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can update own listings" ON listings;
  CREATE POLICY "Users can update own listings"
    ON listings FOR UPDATE
    USING (user_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can delete own listings" ON listings;
  CREATE POLICY "Users can delete own listings"
    ON listings FOR DELETE
    USING (user_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- PROFILES: anyone can read, only owner can modify
-- ============================================================
DO $$ BEGIN
  DROP POLICY IF EXISTS "Profiles are publicly readable" ON profiles;
  CREATE POLICY "Profiles are publicly readable"
    ON profiles FOR SELECT
    USING (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
  CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
  CREATE POLICY "Users can insert own profile"
    ON profiles FOR INSERT
    WITH CHECK (id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- CONVERSATIONS: only participants can read/write
-- ============================================================
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can read own conversations" ON conversations;
  CREATE POLICY "Users can read own conversations"
    ON conversations FOR SELECT
    USING (user1_id = auth.uid() OR user2_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can insert own conversations" ON conversations;
  CREATE POLICY "Users can insert own conversations"
    ON conversations FOR INSERT
    WITH CHECK (user1_id = auth.uid() OR user2_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can update own conversations" ON conversations;
  CREATE POLICY "Users can update own conversations"
    ON conversations FOR UPDATE
    USING (user1_id = auth.uid() OR user2_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- MESSAGES: only conversation participants can read/write
-- ============================================================
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can read own messages" ON messages;
  CREATE POLICY "Users can read own messages"
    ON messages FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM conversations
        WHERE conversations.id = messages.conversation_id
          AND (conversations.user1_id = auth.uid() OR conversations.user2_id = auth.uid())
      )
    );
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can insert own messages" ON messages;
  CREATE POLICY "Users can insert own messages"
    ON messages FOR INSERT
    WITH CHECK (
      sender_id = auth.uid() AND
      EXISTS (
        SELECT 1 FROM conversations
        WHERE conversations.id = messages.conversation_id
          AND (conversations.user1_id = auth.uid() OR conversations.user2_id = auth.uid())
      )
    );
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- NOTIFICATIONS: only owner can read/write
-- ============================================================
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can read own notifications" ON notifications;
  CREATE POLICY "Users can read own notifications"
    ON notifications FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can insert own notifications" ON notifications;
  CREATE POLICY "Users can insert own notifications"
    ON notifications FOR INSERT
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
  CREATE POLICY "Users can update own notifications"
    ON notifications FOR UPDATE
    USING (user_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
  CREATE POLICY "Users can delete own notifications"
    ON notifications FOR DELETE
    USING (user_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- CATEGORIES + CITIES + SUBSCRIPTION_PLANS: public read-only
-- ============================================================
DO $$ BEGIN
  DROP POLICY IF EXISTS "Categories are publicly readable" ON categories;
  CREATE POLICY "Categories are publicly readable"
    ON categories FOR SELECT USING (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Cities are publicly readable" ON cities;
  CREATE POLICY "Cities are publicly readable"
    ON cities FOR SELECT USING (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Subscription plans are publicly readable" ON subscription_plans;
  CREATE POLICY "Subscription plans are publicly readable"
    ON subscription_plans FOR SELECT USING (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- REVIEWS: public read, only authenticated users can insert
-- ============================================================
DO $$ BEGIN
  DROP POLICY IF EXISTS "Reviews are publicly readable" ON reviews;
  CREATE POLICY "Reviews are publicly readable"
    ON reviews FOR SELECT USING (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Authenticated users can insert reviews" ON reviews;
  CREATE POLICY "Authenticated users can insert reviews"
    ON reviews FOR INSERT
    WITH CHECK (reviewer_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can delete own reviews" ON reviews;
  CREATE POLICY "Users can delete own reviews"
    ON reviews FOR DELETE
    USING (reviewer_id = auth.uid());
EXCEPTION WHEN undefined_table THEN NULL; END $$;
