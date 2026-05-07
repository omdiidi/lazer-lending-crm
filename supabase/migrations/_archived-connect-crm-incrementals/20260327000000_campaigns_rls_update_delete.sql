-- Add missing UPDATE and DELETE RLS policies for campaigns table.
-- Campaigns were missing these, causing silent write failures (RLS returns error:null
-- with 0 rows affected, so the client sees "success" but nothing persists).
--
-- Owner column: sent_by (equivalent to assigned_to on leads/deals)
-- Note: process-campaigns uses supabaseAdmin (service role) which bypasses RLS entirely,
-- so these policies do not affect automated campaign sends.

create policy "campaigns_update" on public.campaigns
  for update
  using  (public.is_admin() or auth.uid() = sent_by)
  with check (public.is_admin() or auth.uid() = sent_by);

create policy "campaigns_delete" on public.campaigns
  for delete
  using  (public.is_admin() or auth.uid() = sent_by);
