-- Fix pg_cron jobs: schedule process-campaigns and repoint all jobs at THIS project.
--
-- Root cause of "campaigns never reach Smartlead": the only migration that ever
-- scheduled process-campaigns (20260326130000, now in _archived-connect-crm-
-- incrementals/) was never applied to this project, and both it and
-- 20260505000006 hardcode the old Connect CRM scaffold project URL
-- (onthjkzdgsfvmgyhrorw.supabase.co) with a placeholder/foreign anon key.
-- Result: the dispatcher cron never existed here, and the five Lazer jobs POST
-- to a foreign project. This migration reschedules everything against
-- cmubrsnhsxbrqxsjhxnx with this project's anon key.
--
-- The anon key is a public client credential (shipped to every browser); the
-- Bearer here only satisfies the platform JWT check on the public function
-- endpoint. Functions do privileged work via their own service-role env.
--
-- Idempotent: unschedules matching jobs before re-registering.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  stale text;
BEGIN
  FOREACH stale IN ARRAY ARRAY[
    'process-campaigns-5min',
    'process-campaigns',            -- name used by the archived scaffold migration
    'mailbox-watchdog-hourly',
    'mailbox-cap-reset-hourly',
    'smartlead-reconcile-daily',
    'dns-health-check-daily',
    'webhook-event-sweeper-5min'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = stale) THEN
      PERFORM cron.unschedule(stale);
    END IF;
  END LOOP;
END $$;

-- 1. process-campaigns — every 5 minutes (the send dispatcher; was never scheduled here)
SELECT cron.schedule(
  'process-campaigns-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url        := 'https://cmubrsnhsxbrqxsjhxnx.supabase.co/functions/v1/process-campaigns',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdWJyc25oc3hicnF4c2poeG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTUxNjYsImV4cCI6MjA5MzY5MTE2Nn0.YzrC8q4KzzOdi3MC1ujtGmEZCS8xHnxC5z15xPVnW10'
    ),
    body       := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 2. mailbox-watchdog — hourly
SELECT cron.schedule(
  'mailbox-watchdog-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url        := 'https://cmubrsnhsxbrqxsjhxnx.supabase.co/functions/v1/mailbox-watchdog',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdWJyc25oc3hicnF4c2poeG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTUxNjYsImV4cCI6MjA5MzY5MTE2Nn0.YzrC8q4KzzOdi3MC1ujtGmEZCS8xHnxC5z15xPVnW10'
    ),
    body       := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 3. mailbox-cap-reset — hourly at :30
SELECT cron.schedule(
  'mailbox-cap-reset-hourly',
  '30 * * * *',
  $$
  SELECT net.http_post(
    url        := 'https://cmubrsnhsxbrqxsjhxnx.supabase.co/functions/v1/mailbox-cap-reset',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdWJyc25oc3hicnF4c2poeG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTUxNjYsImV4cCI6MjA5MzY5MTE2Nn0.YzrC8q4KzzOdi3MC1ujtGmEZCS8xHnxC5z15xPVnW10'
    ),
    body       := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 4. smartlead-reconcile — daily 06:00 UTC
SELECT cron.schedule(
  'smartlead-reconcile-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url        := 'https://cmubrsnhsxbrqxsjhxnx.supabase.co/functions/v1/smartlead-reconcile',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdWJyc25oc3hicnF4c2poeG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTUxNjYsImV4cCI6MjA5MzY5MTE2Nn0.YzrC8q4KzzOdi3MC1ujtGmEZCS8xHnxC5z15xPVnW10'
    ),
    body       := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 5. dns-health-check — daily 04:00 UTC
SELECT cron.schedule(
  'dns-health-check-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url        := 'https://cmubrsnhsxbrqxsjhxnx.supabase.co/functions/v1/dns-health-check',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdWJyc25oc3hicnF4c2poeG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTUxNjYsImV4cCI6MjA5MzY5MTE2Nn0.YzrC8q4KzzOdi3MC1ujtGmEZCS8xHnxC5z15xPVnW10'
    ),
    body       := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 6. webhook-event-sweeper — every 5 minutes
SELECT cron.schedule(
  'webhook-event-sweeper-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url        := 'https://cmubrsnhsxbrqxsjhxnx.supabase.co/functions/v1/smartlead-events?action=sweep',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtdWJyc25oc3hicnF4c2poeG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTUxNjYsImV4cCI6MjA5MzY5MTE2Nn0.YzrC8q4KzzOdi3MC1ujtGmEZCS8xHnxC5z15xPVnW10'
    ),
    body       := '{}'::jsonb
  ) AS request_id;
  $$
);
