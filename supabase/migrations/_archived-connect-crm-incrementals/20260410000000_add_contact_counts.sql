-- Add call_count and email_count columns to leads table
ALTER TABLE leads ADD COLUMN call_count integer NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN email_count integer NOT NULL DEFAULT 0;

CREATE INDEX idx_leads_call_count ON leads (call_count);
CREATE INDEX idx_leads_email_count ON leads (email_count);

-- RPC function to atomically increment call_count
CREATE OR REPLACE FUNCTION increment_call_count(lead_ids uuid[], amount integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE leads SET call_count = call_count + amount WHERE id = ANY(lead_ids);
END;
$$;

-- RPC function to atomically increment email_count
CREATE OR REPLACE FUNCTION increment_email_count(lead_ids uuid[], amount integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE leads SET email_count = email_count + amount WHERE id = ANY(lead_ids);
END;
$$;

-- Backfill call_count from activities
UPDATE leads SET call_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT lead_id, COUNT(*) as cnt
  FROM activities
  WHERE type = 'call' AND deleted_at IS NULL
  GROUP BY lead_id
) sub
WHERE leads.id = sub.lead_id;

-- Backfill email_count from activities
-- (covers both manual emails and campaign emails since process-campaigns
-- creates activity records with type='email_sent' for every send)
UPDATE leads SET email_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT lead_id, COUNT(*) as cnt
  FROM activities
  WHERE type = 'email_sent' AND deleted_at IS NULL
  GROUP BY lead_id
) sub
WHERE leads.id = sub.lead_id;
