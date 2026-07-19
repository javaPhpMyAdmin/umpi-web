-- Migration: Set max_images on subscription_plans
-- Date: 2026-07-18
-- Purpose: Define photo limits per subscription tier

-- Sin plan (free): 3 fotos
-- Estándar: 10 fotos
-- Premium: 20 fotos

UPDATE subscription_plans SET max_images = 10 WHERE slug = 'estandar';
UPDATE subscription_plans SET max_images = 20 WHERE slug = 'premium';

-- Safety: any plan without a match gets 3 (free tier default)
UPDATE subscription_plans SET max_images = 3 WHERE max_images IS NULL OR max_images = 0;
