-- Diagnostic: Check RLS status on all tables
-- Run this in Supabase SQL Editor to see which tables are exposed

SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled,
  (SELECT count(*) FROM pg_policies WHERE tablename = t.tablename) AS policy_count
FROM pg_tables t
WHERE schemaname = 'public'
ORDER BY rls_enabled ASC, tablename;
