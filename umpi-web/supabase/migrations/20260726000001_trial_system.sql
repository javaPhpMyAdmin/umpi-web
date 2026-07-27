-- Migration: Add trial system fields to profiles
-- Each new user gets 30 days of premium trial automatically

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none';

-- Index for the expire-trials cron (finds users whose trial has ended)
CREATE INDEX IF NOT EXISTS idx_profiles_trial_expires 
  ON profiles (subscription_status, trial_ends_at) 
  WHERE subscription_status = 'trial';
