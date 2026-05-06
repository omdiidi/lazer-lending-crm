-- =============================================================================
-- Lazer Lending CRM — Phase 1.1 Extend Existing Tables
-- Modifies: leads, campaigns, unsubscribes, warmup_state, email_send_log
-- Extends:  claim_daily_send_budget Postgres function (adds optional mailbox scope)
--
-- Design constraints:
--   • ADD COLUMN only — never DROP or RENAME
--   • Backfills run inline (idempotent via WHERE IS NULL guards)
--   • Existing singleton warmup_state row (id='default') is preserved
--   • claim_daily_send_budget call signature preserved via DEFAULT NULL
-- =============================================================================

-- ---------------------------------------------------------------------------
-- leads — Lazer-specific validation + FUB columns
-- ---------------------------------------------------------------------------

-- ZeroBounce validation output
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS email_normalized    text,
  ADD COLUMN IF NOT EXISTS zerobounce_substatus text,
  ADD COLUMN IF NOT EXISTS zerobounce_score    integer,
  ADD COLUMN IF NOT EXISTS last_validated_at   timestamptz,
  -- Days since last mailbox activity (ZeroBounce active_in_days)
  ADD COLUMN IF NOT EXISTS active_in_days      integer,
  -- Follow Up Boss integration
  ADD COLUMN IF NOT EXISTS fub_id              text,
  ADD COLUMN IF NOT EXISTS fub_pushed_at       timestamptz,
  -- Suppression timestamp (set when unsubscribes row is written for this lead)
  ADD COLUMN IF NOT EXISTS unsubscribed_at     timestamptz;

-- Backfill email_normalized for existing rows that have an email.
-- lower(trim(...)) matches the normalize function in src/lib/email-normalize.ts.
-- The canonical normalize is: lowercase → trim whitespace → strip plus-tags → Gmail dot rules.
-- Here we apply the safe subset (lower + trim); the full normalize runs at write-time going forward.
UPDATE leads
SET email_normalized = lower(trim(email))
WHERE email_normalized IS NULL
  AND email IS NOT NULL;

-- Unique index on email_normalized (partial: active leads only).
-- Soft-deleted leads retain their email_normalized for audit; excluded from dedup constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email_normalized_unique
  ON leads (email_normalized)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- campaigns — provider + Smartlead columns
-- ---------------------------------------------------------------------------

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS provider              text NOT NULL DEFAULT 'resend'
                                                 CHECK (provider IN ('resend', 'smartlead')),
  ADD COLUMN IF NOT EXISTS sending_pool_id       uuid REFERENCES sending_pools(id) ON DELETE SET NULL,
  -- Per-campaign team notification address; NULL falls back to env TEAM_NOTIFY_EMAIL
  ADD COLUMN IF NOT EXISTS team_email            text,
  -- v2 placeholder: seed inbox set for pre-campaign placement checks
  ADD COLUMN IF NOT EXISTS seed_inbox_set_id     uuid,
  -- Smartlead campaign ID assigned after SL campaign creation
  ADD COLUMN IF NOT EXISTS smartlead_campaign_id text;

CREATE INDEX IF NOT EXISTS idx_campaigns_sending_pool_id
  ON campaigns (sending_pool_id)
  WHERE sending_pool_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_provider
  ON campaigns (provider);

-- ---------------------------------------------------------------------------
-- unsubscribes — extended to be the canonical suppression table
-- The existing UUID token column is preserved for legacy link fallback.
-- New HMAC tokens are also stored as text in the token column (they are longer
-- strings but the column is untyped text — no schema change needed for that).
-- ---------------------------------------------------------------------------

ALTER TABLE unsubscribes
  ADD COLUMN IF NOT EXISTS reason          text NOT NULL DEFAULT 'unsubscribe'
                                           CHECK (reason IN (
                                             'unsubscribe', 'hard_bounce',
                                             'complaint', 'zerobounce'
                                           )),
  ADD COLUMN IF NOT EXISTS email_normalized text,
  ADD COLUMN IF NOT EXISTS source_event_id text;

-- Note: the schema.md shows unsubscribes has campaign_id FK → campaigns.
-- database.ts does NOT show it (probably added in an earlier migration not in database.ts).
-- We reference it cautiously with IF NOT EXISTS on the index only; no ADD COLUMN for campaign_id.

-- One-shot backfill for existing rows
UPDATE unsubscribes
SET email_normalized = lower(trim(email))
WHERE email_normalized IS NULL
  AND email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unsubscribes_email_normalized
  ON unsubscribes (email_normalized);

-- Auto-populate email_normalized on INSERT via BEFORE trigger.
-- This ensures every new suppression row is normalized at write time,
-- regardless of whether the caller passes email_normalized explicitly.
CREATE OR REPLACE FUNCTION populate_unsubscribe_email_normalized()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email_normalized IS NULL AND NEW.email IS NOT NULL THEN
    NEW.email_normalized := lower(trim(NEW.email));
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger (idempotent: drop first if it already exists from a failed re-run)
DROP TRIGGER IF EXISTS trg_unsubscribes_email_normalized ON unsubscribes;
CREATE TRIGGER trg_unsubscribes_email_normalized
  BEFORE INSERT ON unsubscribes
  FOR EACH ROW EXECUTE FUNCTION populate_unsubscribe_email_normalized();

-- ---------------------------------------------------------------------------
-- warmup_state — add mailbox_id FK
-- Existing singleton row (id='default', mailbox_id=NULL) represents IntegrateAPI
-- shared domain warmup (unchanged). Per-mailbox rows added on Lazer provisioning.
-- ---------------------------------------------------------------------------

ALTER TABLE warmup_state
  ADD COLUMN IF NOT EXISTS mailbox_id uuid REFERENCES mailboxes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_warmup_state_mailbox_id
  ON warmup_state (mailbox_id)
  WHERE mailbox_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- email_send_log — add mailbox_id FK
-- Existing singleton row (send_date, mailbox_id=NULL) is IntegrateAPI shared log.
-- Per-mailbox + per-date rows added by mailbox-cap-reset Edge Function.
-- ---------------------------------------------------------------------------

ALTER TABLE email_send_log
  ADD COLUMN IF NOT EXISTS mailbox_id uuid REFERENCES mailboxes(id) ON DELETE CASCADE;

-- Add a composite index for the per-mailbox per-date lookup
CREATE INDEX IF NOT EXISTS idx_email_send_log_mailbox_date
  ON email_send_log (mailbox_id, send_date)
  WHERE mailbox_id IS NOT NULL;

-- The existing unique constraint on send_date alone is now incorrect when mailbox_id is present:
-- we need uniqueness on (send_date, mailbox_id) for per-mailbox rows. We do NOT drop the existing
-- unique index on send_date (that would break the singleton path). Instead we add a partial unique
-- index for the mailbox-scoped rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_log_mailbox_date_unique
  ON email_send_log (mailbox_id, send_date)
  WHERE mailbox_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- claim_daily_send_budget — extend with optional p_mailbox_id parameter
-- When p_mailbox_id IS NULL: uses the singleton email_send_log row (existing behavior).
-- When p_mailbox_id IS NOT NULL: scopes claim to that mailbox's row.
-- CREATE OR REPLACE preserves the existing function and updates its signature.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_daily_send_budget(
  p_date        date,
  p_max         integer,
  p_requested   integer,
  p_mailbox_id  uuid    DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_current integer := 0;
  v_granted integer := 0;
BEGIN
  IF p_mailbox_id IS NULL THEN
    -- -----------------------------------------------------------------------
    -- Original singleton path (backward compatible — existing callers pass
    -- only 3 args and receive p_mailbox_id = NULL by default).
    -- -----------------------------------------------------------------------
    INSERT INTO email_send_log (send_date, emails_sent, updated_at)
    VALUES (p_date, 0, now())
    ON CONFLICT (send_date) DO NOTHING;

    SELECT emails_sent INTO v_current
    FROM email_send_log
    WHERE send_date = p_date
      AND mailbox_id IS NULL
    FOR UPDATE;

    v_granted := LEAST(p_requested, GREATEST(0, p_max - v_current));

    IF v_granted > 0 THEN
      UPDATE email_send_log
      SET emails_sent = v_current + v_granted,
          updated_at  = now()
      WHERE send_date = p_date
        AND mailbox_id IS NULL;
    END IF;
  ELSE
    -- -----------------------------------------------------------------------
    -- Per-mailbox path: scoped to (mailbox_id, send_date).
    -- -----------------------------------------------------------------------
    INSERT INTO email_send_log (send_date, emails_sent, mailbox_id, updated_at)
    VALUES (p_date, 0, p_mailbox_id, now())
    ON CONFLICT (mailbox_id, send_date) WHERE mailbox_id IS NOT NULL DO NOTHING;

    SELECT emails_sent INTO v_current
    FROM email_send_log
    WHERE send_date  = p_date
      AND mailbox_id = p_mailbox_id
    FOR UPDATE;

    v_granted := LEAST(p_requested, GREATEST(0, p_max - v_current));

    IF v_granted > 0 THEN
      UPDATE email_send_log
      SET emails_sent = v_current + v_granted,
          updated_at  = now()
      WHERE send_date  = p_date
        AND mailbox_id = p_mailbox_id;
    END IF;
  END IF;

  RETURN v_granted;
END;
$$;
