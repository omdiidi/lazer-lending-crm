-- 20260505000009_lazer_realtime_publications.sql
--
-- Add every table our hooks subscribe to via supabase.channel(...) into the
-- supabase_realtime publication. Without this, postgres_changes events never
-- fire and the UI sits stale until the user manually refreshes.
--
-- Why each one:
--   leads, activities, deals, emails, projects, todos — Connect CRM base
--     hooks (use-leads/use-activities/...). The original project had these
--     enabled via the dashboard; not via migration. We re-add them here
--     idempotently so a fresh DB reset reproduces the right state.
--   mailboxes, domains — Lazer pages claim "Realtime updates enabled"; this
--     enables that promise.
--   replies — already added in _003 but listed here as a no-op; ALTER ... ADD
--     TABLE is idempotent under DO blocks.
--
-- Each ADD is wrapped in DO ... EXCEPTION so a partial state (some tables
-- already in the publication, others not) doesn't abort the whole migration.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'leads',
      'activities',
      'deals',
      'emails',
      'projects',
      'todos',
      'todo_columns',
      'todo_comments',
      'mailboxes',
      'domains',
      'replies',
      'campaign_enrollments',
      'sends',
      'system_alerts'
    ])
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION
      WHEN duplicate_object THEN
        -- table already in publication — fine
        NULL;
      WHEN undefined_table THEN
        -- table doesn't exist (e.g. todo_columns may not exist in this DB) — skip
        NULL;
    END;
  END LOOP;
END$$;
