-- =============================================================================
-- Lazer Lending CRM — pg_cron schedules for Phase 1 Edge Functions
-- Idempotent: unschedules existing jobs before re-registering.
-- Pattern: matches 20260326130000_schedule_process_campaigns_cron.sql.
--
-- Jobs scheduled:
--   1. mailbox-watchdog         — every hour (Wilson + hard-rule + webhook gap-alert)
--   2. mailbox-cap-reset        — every hour (idempotent reset at mailbox-local midnight)
--   3. smartlead-reconcile      — daily at 06:00 UTC
--   4. dns-health-check         — daily at 04:00 UTC
--   5. webhook-event-sweeper    — every 5 minutes (?action=sweep on smartlead-events)
-- =============================================================================

-- Ensure extensions present (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- reset_mailbox_daily_counts
-- Atomic idempotent reset of today_enrolled_count + today_sent_count for all
-- mailboxes whose last_reset_at is before "today's midnight in their local timezone".
-- Called by mailbox-cap-reset Edge Function; returns count of rows reset.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reset_mailbox_daily_counts()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH updated AS (
    UPDATE mailboxes
    SET today_enrolled_count = 0,
        today_sent_count     = 0,
        last_reset_at        = now(),
        updated_at           = now()
    WHERE
      -- Reset if never reset before OR if last reset was before today's midnight
      -- in the mailbox's local timezone.
      -- date_trunc('day', now() AT TIME ZONE timezone) gives today's midnight in local TZ.
      -- Casting back via AT TIME ZONE timezone gives the UTC equivalent of that local midnight.
      (
        last_reset_at IS NULL
        OR last_reset_at < (
          date_trunc('day', now() AT TIME ZONE timezone) AT TIME ZONE timezone
        )
      )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: idempotent unschedule (avoid error if job doesn't exist)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mailbox-watchdog-hourly') THEN
    PERFORM cron.unschedule('mailbox-watchdog-hourly');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mailbox-cap-reset-hourly') THEN
    PERFORM cron.unschedule('mailbox-cap-reset-hourly');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'smartlead-reconcile-daily') THEN
    PERFORM cron.unschedule('smartlead-reconcile-daily');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dns-health-check-daily') THEN
    PERFORM cron.unschedule('dns-health-check-daily');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'webhook-event-sweeper-5min') THEN
    PERFORM cron.unschedule('webhook-event-sweeper-5min');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Note on the Authorization header:
-- The anon key is a public credential (already in committed .env.example).
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY via their own Deno.env — the
-- anon Bearer here only allows pg_net to call the public function endpoint.
-- Replace the placeholder below with the actual anon key for the Lazer Supabase
-- project once provisioned (B1 blocker). The IntegrateAPI key is shown as
-- a placeholder format only.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. mailbox-watchdog — hourly
-- Wilson lower-bound + hard-rule + webhook gap-alert (Task 1.12 + 1.17)
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'mailbox-watchdog-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url        := 'https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/mailbox-watchdog',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer LAZER_ANON_KEY_PLACEHOLDER'
    ),
    body       := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ---------------------------------------------------------------------------
-- 2. mailbox-cap-reset — hourly
-- Idempotent reset of today_enrolled_count + today_sent_count at mailbox-local midnight.
-- Running hourly ensures each mailbox resets within 1h of its local midnight.
-- (Task 1.16)
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'mailbox-cap-reset-hourly',
  '30 * * * *',
  $$
  SELECT net.http_post(
    url        := 'https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/mailbox-cap-reset',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer LAZER_ANON_KEY_PLACEHOLDER'
    ),
    body       := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ---------------------------------------------------------------------------
-- 3. smartlead-reconcile — daily at 06:00 UTC
-- Compares local sends against Smartlead campaign analytics for yesterday.
-- Offset to 06:00 so it runs after Smartlead's reporting window closes (midnight UTC).
-- (Task 1.13)
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'smartlead-reconcile-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url        := 'https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/smartlead-reconcile',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer LAZER_ANON_KEY_PLACEHOLDER'
    ),
    body       := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ---------------------------------------------------------------------------
-- 4. dns-health-check — daily at 04:00 UTC
-- Checks SPF / DKIM / DMARC for all active burner domains.
-- Runs before reconcile to catch DNS issues before the send day starts.
-- (Task 1.14)
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'dns-health-check-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url        := 'https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/dns-health-check',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer LAZER_ANON_KEY_PLACEHOLDER'
    ),
    body       := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ---------------------------------------------------------------------------
-- 5. webhook-event-sweeper — every 5 minutes
-- Heals stuck webhook_events rows (processed_at IS NULL AND received_at > 10 min ago).
-- Invokes the smartlead-events function with ?action=sweep.
-- Prevents permanent orphaning of events that failed mid-dispatch.
-- (Task 1.11 sweeper component)
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'webhook-event-sweeper-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url        := 'https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/smartlead-events?action=sweep',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer LAZER_ANON_KEY_PLACEHOLDER'
    ),
    body       := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ---------------------------------------------------------------------------
-- Verify all jobs are scheduled (informational — runs at migration time)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  expected_jobs text[] := ARRAY[
    'mailbox-watchdog-hourly',
    'mailbox-cap-reset-hourly',
    'smartlead-reconcile-daily',
    'dns-health-check-daily',
    'webhook-event-sweeper-5min'
  ];
  job_name text;
BEGIN
  FOREACH job_name IN ARRAY expected_jobs LOOP
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = job_name) THEN
      RAISE WARNING 'pg_cron job not registered: %', job_name;
    ELSE
      RAISE NOTICE 'pg_cron job registered: %', job_name;
    END IF;
  END LOOP;
END $$;
