-- Enable required extensions (idempotent — safe if already enabled)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Register the cron job idempotently using a DO block
-- (cron.unschedule errors if job doesn't exist, so check first)
do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'process-campaigns-every-5-min'
  ) then
    perform cron.unschedule('process-campaigns-every-5-min');
  end if;
end $$;

-- Schedule process-campaigns to run every 5 minutes.
-- The anon key is a public credential (already in committed .env).
-- The edge function uses its own SUPABASE_SERVICE_ROLE_KEY env var for admin operations.
select cron.schedule(
  'process-campaigns-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url        := 'https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/process-campaigns',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9udGhqa3pkZ3Nmdm1neWhyb3J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzk0MTQsImV4cCI6MjA4OTgxNTQxNH0.b0Sd3thLMdQZ_oIJU4n4lA3Gr_BOK5dOMNVTCH52b2Y'
    ),
    body       := '{}'::jsonb
  ) as request_id;
  $$
);
