-- Enable required extensions (idempotent)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Register the cleanup cron job idempotently
do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'cleanup-lead-assignments-nightly'
  ) then
    perform cron.unschedule('cleanup-lead-assignments-nightly');
  end if;
end $$;

-- Schedule cleanup-lead-assignments to run every night at 2am UTC.
-- CLEANUP_SECRET must match the CLEANUP_SECRET env var set in Supabase Edge Function secrets.
select cron.schedule(
  'cleanup-lead-assignments-nightly',
  '0 2 * * *',
  $$
  select net.http_post(
    url        := 'https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/cleanup-lead-assignments',
    headers    := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer 62ee7648ed9ba09f78a91f3ae7a4f672'
    ),
    body       := '{}'::jsonb
  ) as request_id;
  $$
);
