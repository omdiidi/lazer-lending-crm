-- =============================================================================
-- Lazer Lending CRM — Atomic enrollment helpers
--
-- claim_pending_enrollments:
--   Atomically claims p_limit pending enrollments for a campaign using
--   FOR UPDATE SKIP LOCKED. Prevents concurrent cron invocations from
--   double-processing the same rows.
--
-- claim_mailbox_enrollment_slot:
--   Atomically picks the least-loaded eligible mailbox in a pool,
--   increments today_enrolled_count, and returns the mailbox row.
--   Uses FOR UPDATE SKIP LOCKED so concurrent callers pick different mailboxes.
--
-- release_mailbox_enrollment_slot:
--   Decrements today_enrolled_count when a post-claim Smartlead API call fails.
--   Prevents permanent slot leakage against the daily cap.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- claim_pending_enrollments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_pending_enrollments(
  p_campaign_id uuid,
  p_limit       integer DEFAULT 50
)
RETURNS SETOF campaign_enrollments
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    UPDATE campaign_enrollments
    SET status = 'claimed'
    WHERE id IN (
      SELECT id
      FROM campaign_enrollments
      WHERE campaign_id = p_campaign_id
        AND status      = 'pending'
        AND (next_send_at IS NULL OR next_send_at <= now())
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
    )
    RETURNING *;
END;
$$;

-- ---------------------------------------------------------------------------
-- claim_mailbox_enrollment_slot
--
-- Picks the single least-loaded eligible mailbox in the given pool and
-- atomically increments its today_enrolled_count.
--
-- Returns NULL (empty set) if no eligible mailbox exists — caller must treat
-- this as NoMailboxAvailable and stop the batch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_mailbox_enrollment_slot(
  p_pool_id uuid
)
RETURNS mailboxes
LANGUAGE plpgsql
AS $$
DECLARE
  v_result mailboxes;
BEGIN
  UPDATE mailboxes m
  SET today_enrolled_count = today_enrolled_count + 1
  FROM (
    SELECT m2.id
    FROM mailboxes m2
    JOIN pool_memberships pm ON pm.mailbox_id = m2.id
    WHERE pm.pool_id      = p_pool_id
      AND m2.warmup_state  = 'live'
      AND m2.paused_reason IS NULL
      AND m2.today_enrolled_count < m2.daily_cap
    ORDER BY (m2.today_enrolled_count::float / GREATEST(m2.daily_cap, 1)) ASC,
             random() ASC
    LIMIT 1
    FOR UPDATE OF m2 SKIP LOCKED
  ) AS eligible
  WHERE m.id = eligible.id
    -- Double-check cap hasn't been exceeded by a concurrent update that snuck in
    AND m.today_enrolled_count < m.daily_cap
  RETURNING m.* INTO v_result;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- release_mailbox_enrollment_slot
--
-- Decrements today_enrolled_count by 1 when a post-claim Smartlead API call
-- fails before the lead is actually accepted by Smartlead.
-- Guarded by MAX(0, ...) to prevent negative counts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_mailbox_enrollment_slot(
  p_mailbox_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE mailboxes
  SET today_enrolled_count = GREATEST(0, today_enrolled_count - 1)
  WHERE id = p_mailbox_id;
END;
$$;
