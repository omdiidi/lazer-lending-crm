-- =============================================================================
-- Lazer Lending CRM — Phase 1.1 Reply Layer
-- New tables: replies, webhook_events, classifier_circuit
-- FK dependencies: mailboxes (from _001), leads/campaigns (existing)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- replies
-- One row per inbound reply processed through the Smartlead webhook.
-- body_text            — full raw reply body (retained per lending-vertical retention policy)
-- redacted_body_text   — PII-scrubbed copy passed to LLM classifier
-- classification       — two-stage output: keyword pre-classify (~70%) + LLM for ambiguous (~30%)
-- requires_human_review — set TRUE when classifier errors/timeouts out; blocks auto-FUB push
-- fub_event_id         — FUB POST /v1/events response ID (audit trail, not dedup key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS replies (
  id                    uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id               uuid        NOT NULL REFERENCES leads(id)     ON DELETE RESTRICT,
  campaign_id           uuid        NOT NULL REFERENCES campaigns(id)  ON DELETE RESTRICT,
  mailbox_id            uuid        NOT NULL REFERENCES mailboxes(id)  ON DELETE RESTRICT,
  -- NULL if reply does not map to a tracked send (e.g. unsolicited inbound)
  in_reply_to_send_id   uuid        REFERENCES sends(id)              ON DELETE SET NULL,
  -- Smartlead thread identifier — flattened from v3-first-draft conversations table
  smartlead_thread_id   text,
  -- Two-stage classifier output
  classification        text        CHECK (classification IN (
                                      'positive', 'neutral', 'ooo',
                                      'unsubscribe', 'negative'
                                    )),
  classifier_confidence numeric(5,4),
  classifier_error      text,
  classifier_rationale  text,
  language              text,
  -- raw_message_id: the RFC 2822 Message-ID header value from the reply
  raw_message_id        text        NOT NULL,
  -- body_text: full reply body; retained 18 months then redacted per lending retention policy
  body_text             text        NOT NULL DEFAULT '',
  -- redacted_body_text: PII-scrubbed, max-200-char-truncated body passed to LLM
  redacted_body_text    text        NOT NULL DEFAULT '',
  received_at           timestamptz NOT NULL,
  -- Notification tracking (store-and-notify: Resend sends classification + first sentence + link)
  notified_at           timestamptz,
  notified_to           text,
  -- FUB push tracking
  fub_pushed_at         timestamptz,
  fub_event_id          text,
  requires_human_review boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE replies ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read replies (for the Replies page + human-review queue)
CREATE POLICY "replies_select" ON replies
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only service-role (Edge Functions: smartlead-events, classify-reply, fub-push) write replies.
-- No browser INSERT/UPDATE policies — all mutations go through Edge Functions.

CREATE TRIGGER handle_updated_at_replies
  BEFORE UPDATE ON replies
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Index: replies by lead + campaign (dedup + lead history view)
CREATE INDEX IF NOT EXISTS idx_replies_lead_campaign
  ON replies (lead_id, campaign_id);

-- Index: human-review queue (partial — only unresolved items)
CREATE INDEX IF NOT EXISTS idx_replies_human_review
  ON replies (classification)
  WHERE requires_human_review = true;

-- ---------------------------------------------------------------------------
-- webhook_events
-- Idempotency table for all inbound webhooks (Smartlead, and future providers).
-- UNIQUE (provider, external_event_id) enforces exactly-once processing.
-- external_event_id   — Smartlead's X-Request-Id header value
-- payload_hash        — SHA-256 of raw payload bytes (for fast diff detection on retries)
-- payload_raw         — full JSON payload stored for debugging and replay
-- processed_at        — set after successful processing; NULL = unprocessed / in-flight
-- last_error          — most recent processing error (for sweeper alerting)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
  id                uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider          text        NOT NULL,
  external_event_id text        NOT NULL,
  event_type        text        NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  last_error        text,
  payload_hash      text        NOT NULL,
  payload_raw       jsonb       NOT NULL,
  UNIQUE (provider, external_event_id)
);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- webhook_events: service-role only (Edge Functions read + write; no browser access)
-- No SELECT policy for authenticated users — this table contains raw payloads with PII.
-- Admins who need to inspect events must do so via Edge Function or Supabase Studio directly.

-- Index: sweeper query — find stuck/unprocessed events older than 10 minutes
CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed
  ON webhook_events (received_at)
  WHERE processed_at IS NULL;

-- ---------------------------------------------------------------------------
-- classifier_circuit
-- Single-row circuit breaker for the LLM classifier.
-- open_at        — non-NULL means circuit is open (LLM calls bypassed; human review fallback)
-- failure_count  — rolling count since last reset; used to decide when to re-close
-- last_failure_at — timestamp of most recent LLM error
--
-- Managed exclusively by the classify-reply Edge Function. No browser writes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classifier_circuit (
  id              text        PRIMARY KEY DEFAULT 'singleton',
  open_at         timestamptz,
  failure_count   integer     NOT NULL DEFAULT 0,
  last_failure_at timestamptz
);

ALTER TABLE classifier_circuit ENABLE ROW LEVEL SECURITY;

-- classifier_circuit: service-role only (same restriction as webhook_events)

-- Seed the single circuit row (idempotent — INSERT only if absent)
INSERT INTO classifier_circuit (id, failure_count)
VALUES ('singleton', 0)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Realtime: add replies to the publication so UI updates without polling
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE replies;
