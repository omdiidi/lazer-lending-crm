-- =============================================================================
-- Lazer Lending CRM — v2 Seed Inbox / Spam Placement Tables
-- These tables sit empty until Phase 3 (spam placement monitoring) is implemented.
-- Migration history is immutable — creating them now preserves schema lineage.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- seed_inbox_set
-- Defines a named collection of seed inboxes (Gmail/Outlook/Yahoo) used to
-- measure inbox vs spam placement before and during a campaign send.
-- vault_secret_id references the Supabase Vault secret holding IMAP credentials.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seed_inbox_set (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label           text        NOT NULL,
  provider        text        NOT NULL
                              CHECK (provider IN ('gmail', 'outlook', 'yahoo')),
  vault_secret_id text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE seed_inbox_set IS
  'v2 — Phase 3 spam placement monitoring. Sits empty until implemented.';

ALTER TABLE seed_inbox_set ENABLE ROW LEVEL SECURITY;

-- Admin-only access (operator provisions seed inboxes via Settings panel in Phase 3)
CREATE POLICY "seed_inbox_set_select" ON seed_inbox_set
  FOR SELECT USING (is_admin());

CREATE POLICY "seed_inbox_set_insert" ON seed_inbox_set
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "seed_inbox_set_delete" ON seed_inbox_set
  FOR DELETE USING (is_admin());

-- ---------------------------------------------------------------------------
-- seed_inbox_checks
-- Per-campaign placement check result. One row per check run (10-min + 30-min).
-- checked_at_10min  — timestamp when the 10-minute check completed
-- checked_at_30min  — timestamp when the 30-minute check completed (may be NULL if paused before)
-- results           — full per-inbox jsonb array: [{inbox_id, provider, placement, checked_at}]
-- placement_summary — human-readable rollup: "3/5 inbox, 2/5 spam" for operator display
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seed_inbox_checks (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      uuid        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  results          jsonb       NOT NULL DEFAULT '[]',
  placement_summary text,
  checked_at_10min timestamptz,
  checked_at_30min timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE seed_inbox_checks IS
  'v2 — Phase 3 spam placement monitoring. Sits empty until implemented.';

ALTER TABLE seed_inbox_checks ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read check results (campaign health visibility)
CREATE POLICY "seed_inbox_checks_select" ON seed_inbox_checks
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only service-role writes check results (seed-placement-check Edge Function)
-- No INSERT policy for authenticated users.

CREATE INDEX IF NOT EXISTS idx_seed_inbox_checks_campaign_id
  ON seed_inbox_checks (campaign_id);
