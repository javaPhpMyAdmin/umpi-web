-- fix-existing-google-user.sql
-- Creates profile for existing Google user who doesn't have one yet
-- Run in Supabase SQL Editor

INSERT INTO profiles (id, full_name, avatar_url, subscription_status, trial_ends_at)
SELECT 
  id,
  COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1)),
  COALESCE(raw_user_meta_data->>'avatar_url', raw_user_meta_data->>'picture', NULL),
  'trial',
  NOW() + INTERVAL '30 days'
FROM auth.users
WHERE email = 'chelobat.dev@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.users.id)
ON CONFLICT (id) DO UPDATE SET
  subscription_status = COALESCE(profiles.subscription_status, 'trial'),
  trial_ends_at = COALESCE(profiles.trial_ends_at, NOW() + INTERVAL '30 days');
