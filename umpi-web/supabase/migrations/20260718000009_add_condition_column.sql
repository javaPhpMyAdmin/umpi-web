-- Add condition column to listings (new/used)
-- Only meaningful for categories: Autos, Motos y Camionetas / Celulares y Smartphones
ALTER TABLE listings ADD COLUMN IF NOT EXISTS condition text CHECK (condition IN ('new', 'used'));

-- Backfill existing listings with NULL (no condition set)
-- No data loss since this column didn't exist before
