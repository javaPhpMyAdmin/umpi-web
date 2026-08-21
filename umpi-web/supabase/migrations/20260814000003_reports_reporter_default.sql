-- Migration: reports.reporter_id default auth.uid()
--
-- The mobile report hook inserts into public.reports without reporter_id,
-- relying on the documented contract "reporter_id is resolved server-side
-- from the session". The column was NOT NULL without a default, so every
-- insert failed with a null-value violation and the UI showed a generic
-- "could not send report" error. This migration makes the column default to
-- the session user, matching the documented behavior. RLS still enforces
-- reporter_id = auth.uid() via the WITH CHECK policy.

alter table public.reports
  alter column reporter_id set default auth.uid();
