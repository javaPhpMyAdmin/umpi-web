-- assign-trial-trigger.sql
-- Auto-assigns 30-day trial to any new user (email, magic link, or Google)
-- Run this in Supabase SQL Editor

-- Function: assigns trial on first profile creation
CREATE OR REPLACE FUNCTION public.assign_trial_on_signup()
RETURNS trigger AS $$
BEGIN
  IF NEW.subscription_status IS NULL AND NEW.trial_ends_at IS NULL THEN
    NEW.subscription_status := 'trial';
    NEW.trial_ends_at := NOW() + INTERVAL '30 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: fires on INSERT into profiles
DROP TRIGGER IF EXISTS on_profile_created ON public.profiles;
CREATE TRIGGER on_profile_created
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_trial_on_signup();
