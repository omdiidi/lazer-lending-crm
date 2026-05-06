-- =============================================================================
-- Lazer Lending CRM — Phase 1.1 Send Layer
-- New tables: domains, mailboxes, sending_pools, pool_memberships, sends
-- FK order: this file has no FKs to existing tables except leads/campaigns
-- (those tables already exist). pool_memberships and sends reference tables
-- created earlier in this same file.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- domains
-- Represents a burner sending domain (e.g. lazer-loans.com).
-- State machine: provisioning → dns_pending → connection_pending → verifying → ready
--                → cooldown (temporary pause) | retired | failed
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domains (
  id               uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  hostname         text        NOT NULL UNIQUE,
  provider         text        NOT NULL
                               CHECK (provider IN ('zapmail', 'maildoso', 'manual')),
  status           text        NOT NULL DEFAULT 'provisioning'
                               CHECK (status IN (
                                 'provisioning', 'dns_pending', 'connection_pending',
                                 'verifying', 'ready', 'cooldown', 'retired', 'failed'
                               )),
  dns_spf_ok       boolean     NOT NULL DEFAULT false,
  dns_dkim_ok      boolean     NOT NULL DEFAULT false,
  dns_dmarc_ok     boolean     NOT NULL DEFAULT false,
  dmarc_policy     text        NOT NULL DEFAULT 'none'
                               CHECK (dmarc_policy IN ('none', 'quarantine', 'reject')),
  dmarc_rua        text,
  registrar        text,
  owner_entity     text,
  registered_at    timestamptz,
  retired_at       timestamptz,
  cooldown_until   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE domains ENABLE ROW LEVEL SECURITY;

-- Admins and employees can read domain list; only admins mutate
CREATE POLICY "domains_select" ON domains
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "domains_insert" ON domains
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "domains_update" ON domains
  FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "domains_delete" ON domains
  FOR DELETE USING (is_admin());

CREATE TRIGGER handle_updated_at_domains
  BEFORE UPDATE ON domains
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ---------------------------------------------------------------------------
-- mailboxes
-- One Google Workspace mailbox connected to Smartlead on a burner domain.
-- warmup_state FSM: provisioning → connection_pending → warming → live → paused → failed
-- connection_status tracks IMAP/SMTP app-password health.
-- today_enrolled_count — incremented at enrollment (gates how many leads we push to SL today).
-- today_sent_count     — incremented only when EMAIL_SENT webhook confirms dispatch.
-- Both reset at mailbox-local midnight via mailbox-cap-reset Edge Function.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mailboxes (
  id                        uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain_id                 uuid        NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  address                   text        NOT NULL UNIQUE,
  smartlead_account_id      text,
  connection_status         text        NOT NULL DEFAULT 'disconnected'
                                        CHECK (connection_status IN (
                                          'connected', 'disconnected', 'app_password_invalid'
                                        )),
  warmup_state              text        NOT NULL DEFAULT 'provisioning'
                                        CHECK (warmup_state IN (
                                          'provisioning', 'connection_pending',
                                          'warming', 'live', 'paused', 'failed'
                                        )),
  -- daily_cap: configurable 10–60, default 30 (fresh mailboxes start at 10 for week 1)
  daily_cap                 integer     NOT NULL DEFAULT 30 CHECK (daily_cap BETWEEN 10 AND 60),
  today_enrolled_count      integer     NOT NULL DEFAULT 0,
  today_sent_count          integer     NOT NULL DEFAULT 0,
  last_reset_at             timestamptz,
  live_started_at           timestamptz,
  -- Rolling 24h rates — updated by mailbox-watchdog Edge Function
  last_24h_bounce_rate      numeric(6,4) NOT NULL DEFAULT 0,
  last_24h_complaint_rate   numeric(6,4) NOT NULL DEFAULT 0,
  paused_reason             text        CHECK (paused_reason IN (
                                          'bounce_threshold', 'complaint_threshold',
                                          'single_complaint_review', 'smartlead_rate_limit',
                                          'dns_failure', 'app_password_invalid',
                                          'connection_lost', 'manual'
                                        )),
  last_health_check_at      timestamptz,
  timezone                  text        NOT NULL DEFAULT 'America/Phoenix',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mailboxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mailboxes_select" ON mailboxes
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "mailboxes_insert" ON mailboxes
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "mailboxes_update" ON mailboxes
  FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "mailboxes_delete" ON mailboxes
  FOR DELETE USING (is_admin());

CREATE TRIGGER handle_updated_at_mailboxes
  BEFORE UPDATE ON mailboxes
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Index: mailbox lookup by domain (for domain-rotation stop-sends query)
CREATE INDEX IF NOT EXISTS idx_mailboxes_domain_id
  ON mailboxes (domain_id);

-- Index: eligible mailboxes for enrollment (live + not paused)
CREATE INDEX IF NOT EXISTS idx_mailboxes_warmup_state_active
  ON mailboxes (warmup_state)
  WHERE paused_reason IS NULL;

-- ---------------------------------------------------------------------------
-- sending_pools
-- Named groups of mailboxes. Campaigns reference a pool_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sending_pools (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text        NOT NULL UNIQUE,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sending_pools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sending_pools_select" ON sending_pools
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "sending_pools_insert" ON sending_pools
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "sending_pools_update" ON sending_pools
  FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "sending_pools_delete" ON sending_pools
  FOR DELETE USING (is_admin());

CREATE TRIGGER handle_updated_at_sending_pools
  BEFORE UPDATE ON sending_pools
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ---------------------------------------------------------------------------
-- pool_memberships
-- M:N join between sending_pools and mailboxes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pool_memberships (
  pool_id    uuid NOT NULL REFERENCES sending_pools(id) ON DELETE CASCADE,
  mailbox_id uuid NOT NULL REFERENCES mailboxes(id)     ON DELETE CASCADE,
  PRIMARY KEY (pool_id, mailbox_id)
);

ALTER TABLE pool_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pool_memberships_select" ON pool_memberships
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "pool_memberships_insert" ON pool_memberships
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "pool_memberships_delete" ON pool_memberships
  FOR DELETE USING (is_admin());

-- ---------------------------------------------------------------------------
-- sends
-- One row per Smartlead dispatch event (or enrollment-queued entry).
-- claimed_mailbox_id  — mailbox selected at enrollment time
-- mailbox_id          — confirmed mailbox from EMAIL_SENT webhook (may differ)
-- smartlead_lead_id   — Smartlead's internal lead ID, used for silent-drop detection
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sends (
  id                    uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id               uuid        NOT NULL REFERENCES leads(id)    ON DELETE RESTRICT,
  campaign_id           uuid        NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  -- campaign_steps already exists (linked to campaign_sequences); nullable because
  -- first-step sends may not have a step row yet during initial SL setup
  campaign_step_id      uuid        REFERENCES campaign_steps(id)    ON DELETE SET NULL,
  claimed_mailbox_id    uuid        NOT NULL REFERENCES mailboxes(id) ON DELETE RESTRICT,
  -- Confirmed sending mailbox arrives via EMAIL_SENT webhook; NULL until webhook fires
  mailbox_id            uuid        REFERENCES mailboxes(id)          ON DELETE SET NULL,
  smartlead_message_id  text,
  smartlead_lead_id     text,
  smartlead_thread_id   text,
  status                text        NOT NULL DEFAULT 'queued'
                                    CHECK (status IN (
                                      'queued', 'sent', 'delivered',
                                      'bounced', 'complained', 'failed', 'smartlead_rejected'
                                    )),
  bounce_type           text        CHECK (bounce_type IN ('hard', 'soft')),
  error_reason          text,
  sent_at               timestamptz,
  delivered_at          timestamptz,
  complaint_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sends ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read send history (dashboards, mailbox health)
CREATE POLICY "sends_select" ON sends
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only service-role (Edge Functions) may insert/update sends rows.
-- Authenticated users have no direct write path — all mutations go through Edge Functions.
-- NOTE: Supabase service-role bypasses RLS entirely, so these policies gate browser-level writes.
-- We intentionally do NOT create INSERT/UPDATE policies for authenticated users.

CREATE TRIGGER handle_updated_at_sends
  BEFORE UPDATE ON sends
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Index: per-mailbox send history (watchdog rolling-rate queries)
CREATE INDEX IF NOT EXISTS idx_sends_mailbox_sent_at
  ON sends (mailbox_id, sent_at DESC);

-- Index: dedup check — has this lead been enrolled in this campaign?
CREATE INDEX IF NOT EXISTS idx_sends_lead_campaign
  ON sends (lead_id, campaign_id);

-- Index: queued/pending sends for dispatcher reconcile
CREATE INDEX IF NOT EXISTS idx_sends_status_queued_sent
  ON sends (status)
  WHERE status IN ('queued', 'sent');
