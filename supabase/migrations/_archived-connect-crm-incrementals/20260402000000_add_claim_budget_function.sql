-- Atomically claim N slots from the daily email send budget.
-- Returns the number of slots actually granted (0 if cap already reached,
-- less than p_requested if near the cap).
-- Uses SELECT FOR UPDATE to serialize concurrent calls.
CREATE OR REPLACE FUNCTION claim_daily_send_budget(
  p_date      date,
  p_max       integer,
  p_requested integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_current integer := 0;
  v_granted integer := 0;
BEGIN
  -- Ensure a row exists for today (no-op if already exists)
  INSERT INTO email_send_log (send_date, emails_sent, updated_at)
  VALUES (p_date, 0, now())
  ON CONFLICT (send_date) DO NOTHING;

  -- Lock the row, read current count (FOR UPDATE serializes concurrent calls)
  SELECT emails_sent INTO v_current
  FROM email_send_log
  WHERE send_date = p_date
  FOR UPDATE;

  -- Compute how many slots we can actually grant
  v_granted := LEAST(p_requested, GREATEST(0, p_max - v_current));

  -- Only write if we're granting something
  IF v_granted > 0 THEN
    UPDATE email_send_log
    SET emails_sent = v_current + v_granted,
        updated_at  = now()
    WHERE send_date = p_date;
  END IF;

  RETURN v_granted;
END;
$$;
