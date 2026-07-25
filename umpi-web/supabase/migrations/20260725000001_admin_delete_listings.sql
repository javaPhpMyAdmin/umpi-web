-- Migration: Admin can delete any listing + view all listings
-- Date: 2026-07-25
-- Purpose: Allow admins to moderate content by deleting any listing

-- ============================================================
-- ADMIN DELETE POLICY: admins can delete any listing
-- ============================================================
DO $$ BEGIN
  DROP POLICY IF EXISTS "Admins can delete any listing" ON listings;
  CREATE POLICY "Admins can delete any listing"
    ON listings FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.is_admin = true
      )
    );
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- ADMIN UPDATE POLICY: admins can soft-delete (update status) any listing
-- ============================================================
DO $$ BEGIN
  DROP POLICY IF EXISTS "Admins can update any listing" ON listings;
  CREATE POLICY "Admins can update any listing"
    ON listings FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.is_admin = true
      )
    );
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- ADMIN SELECT POLICY: admins can see all listings (even inactive)
-- ============================================================
DO $$ BEGIN
  DROP POLICY IF EXISTS "Admins can view all listings" ON listings;
  CREATE POLICY "Admins can view all listings"
    ON listings FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.is_admin = true
      )
    );
EXCEPTION WHEN undefined_table THEN NULL; END $$;
