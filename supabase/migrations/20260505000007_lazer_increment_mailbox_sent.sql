-- 20260505000007_lazer_increment_mailbox_sent.sql
--
-- Adds the `increment_mailbox_sent_count_if_same_day` RPC referenced by
-- supabase/functions/smartlead-events/index.ts (EMAIL_SENT handler).
--
-- Why this exists:
--   today_sent_count is the operational sent counter, driven by Smartlead's
--   EMAIL_SENT webhook. If the webhook fires after the local-midnight reset
--   for that mailbox, naively incrementing would inflate the next day's
--   counter. This RPC checks that the send's `sent_at` falls in the same
--   local-day window as the mailbox's `last_reset_at` (per-mailbox timezone)
--   before incrementing.
--
--   The check is exact: date_trunc('day', sent_at AT TIME ZONE tz)
--                     = date_trunc('day', last_reset_at AT TIME ZONE tz).
--
-- Inputs:
--   p_smartlead_account_id — Smartlead's account id from the webhook payload
--   p_message_id           — Smartlead message id (joins to sends row)
--
-- Returns: nothing (void). Caller logs RPC errors but treats success+0-rows
-- as a no-op (e.g. when the send was reset between webhook fires).

CREATE OR REPLACE FUNCTION public.increment_mailbox_sent_count_if_same_day(
  p_smartlead_account_id text,
  p_message_id           text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE mailboxes m
  SET today_sent_count = today_sent_count + 1
  FROM sends s
  WHERE s.smartlead_message_id = p_message_id
    AND m.smartlead_account_id = p_smartlead_account_id
    AND m.id = s.mailbox_id
    AND s.sent_at IS NOT NULL
    AND m.last_reset_at IS NOT NULL
    AND date_trunc('day', s.sent_at      AT TIME ZONE m.timezone)
      = date_trunc('day', m.last_reset_at AT TIME ZONE m.timezone);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_mailbox_sent_count_if_same_day(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_mailbox_sent_count_if_same_day(text, text) TO service_role;

COMMENT ON FUNCTION public.increment_mailbox_sent_count_if_same_day(text, text) IS
  'Increments mailboxes.today_sent_count by 1 only if the matching send''s sent_at falls in the same local-day window as the mailbox''s last_reset_at (per-mailbox timezone). Called by smartlead-events EMAIL_SENT handler.';
