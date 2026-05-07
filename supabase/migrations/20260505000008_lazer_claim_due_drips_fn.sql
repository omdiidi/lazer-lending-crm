-- 20260505000008_lazer_claim_due_drips_fn.sql
--
-- Adds claim_due_drip_enrollments — sibling to claim_pending_enrollments
-- (migration _005), but scans across ALL campaigns for due drip-step rows
-- instead of being scoped to a single campaign.
--
-- Why this exists:
--   process-campaigns drip step 3 (around line 438) was selecting due
--   enrollments without FOR UPDATE SKIP LOCKED. Concurrent cron runs (the
--   default 5-minute pg_cron schedule plus any manual invocations) could
--   each see the same rows and double-process drip sends.
--
-- Status transition: pending → claimed (caller is responsible for moving
-- claimed rows to sent/failed/bounced/unsubscribed before returning).

CREATE OR REPLACE FUNCTION public.claim_due_drip_enrollments(
  p_limit integer DEFAULT 50
)
RETURNS SETOF campaign_enrollments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
    UPDATE campaign_enrollments
    SET status = 'claimed'
    WHERE id IN (
      SELECT id
      FROM campaign_enrollments
      WHERE status        = 'pending'
        AND next_send_at IS NOT NULL
        AND next_send_at <= now()
      ORDER BY next_send_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
    )
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_drip_enrollments(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_drip_enrollments(integer) TO service_role;

COMMENT ON FUNCTION public.claim_due_drip_enrollments(integer) IS
  'Atomically claims up to p_limit due drip-step enrollments across all campaigns using FOR UPDATE SKIP LOCKED. Flips status pending->claimed; caller must move to a terminal state before returning. Mirrors claim_pending_enrollments (per-campaign) but unscoped.';
