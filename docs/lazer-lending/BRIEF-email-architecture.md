# Brief: Lazer Lending CRM — Email Sending & Deliverability Architecture

## Why

The PRD (`lazer-lending-crm-prd.md`) is an outcome spec that locks in seven core
outcomes for Lazer Lending's cold-outreach CRM, but its proposed email layer —
Resend as the outbound sender on rotating subdomains of `lazerlending.com`, plus
"torched root detection" as a fallback — is structurally misaligned with how
modern cold email actually works in 2025/2026. Without revising that layer, the
build risks getting Resend-suspended, burning the brand domain at Gmail/Outlook,
and landing in spam at materially higher rates than necessary regardless of
how good the rest of the CRM is.

This brief locks the architecture for the email sending and deliverability
layer. The CRM, reply classifier, FUB integration, and lead handling parts of
the PRD remain as written.

## Context

### What the PRD currently specifies (relevant excerpts)

- All sends go through Resend (PRD §5.8) on rotating subdomains of
  `lazerlending.com` (PRD §5.1, §5.4).
- 3–5 subdomains, each hard-capped at 300/day; volume target 100/day → 1,000/day
  ceiling (PRD §4).
- Warmup hardening with build-vs-buy left open (PRD §5.2).
- Torched-root detection triggers a new-root purchase flow (PRD §5.5).
- ZeroBounce at upload + just-in-time before send (PRD §5.3).
- Spam placement checks via seed inboxes (PRD §5.4).
- Reply classifier + per-campaign forwarding + FUB push on positive (PRD §5.6, §5.7).

### What the research established (citations in the discussion thread)

- **Subdomain rotation on a single root only gives partial isolation.** Gmail
  treats organizational-domain reputation as a strong signal; cold abuse on
  `mail.lazerlending.com` will leak into the brand root. Operator consensus in
  2025/2026 is that subdomains are appropriate for transactional/marketing
  separation, not for cold outreach.
- **Resend's AUP is the most cold-tolerant of the major transactional ESPs**,
  but it still requires <0.08% complaint rate and <4% bounce rate. Lending
  vertical at 1,000/day cold is a manual-review trigger. Postmark, SendGrid,
  Mailgun, Brevo, Mailjet, and SparkPost explicitly ban cold. SES is permissive
  in policy but the ~0.1% complaint ceiling is unreachable for cold lending and
  production-access review will deny the use case.
- **API-sent transactional mail underperforms real-mailbox-sent mail at Gmail's
  filters.** Gmail weights "real human inbox" heuristics — engagement graph,
  IMAP behavior, OAuth signature, IP class. ESP IPs are classified as bulk
  marketing infrastructure.
- **Modern dominant pattern**: N burner domains × M Workspace mailboxes (2–3
  mailboxes per domain) sending 25–40/day per warmed mailbox via OAuth/IMAP
  through a cold-email orchestrator (Smartlead, Instantly, Saleshandy).
- **Volume math**: 1,000/day at safe 30/day per mailbox = ~30 mailboxes across
  ~12 domains. 100–300/day = 5–10 mailboxes across 2–4 domains.
- **Inbound replies must land in the real mailbox** and be pulled out via the
  orchestrator's reply webhook (which polls Gmail API / IMAP). Inbound parse
  webhooks at the ESP level kill conversational signal and complicate threading.
- **Google's Nov-2025 + Outlook's Q1-2025 enforcement**: active rejection (not
  spam-folder) for missing DMARC alignment, RFC 8058 one-click List-Unsubscribe,
  and complaint rate >0.3%. PRD doesn't currently mention List-Unsubscribe.
- **Cost reality (corrected)**: at 100–300/day the realistic floor is ~$90–110/mo
  all-in; at 1,000/day ceiling it's ~$160–230/mo all-in via Smartlead Pro +
  Mailforge bulk Workspace + Resend transactional free tier + ZeroBounce.

### Connect CRM context

The build is based on Connect CRM (existing IntegrateAPI project). Connect CRM
contains warmup logic and a Resend-based send layer. Per the PRD's build
prompt, Connect CRM should be audited before any code is written. The
architectural decisions in this brief assume that audit will happen as the
first phase of work; if Connect CRM contains incompatible assumptions (e.g.
hardcoded Resend-only sending), Phase 0 of the plan will need to refactor
those out rather than extend them.

## Decisions

### D1. Cold mail does NOT send from `lazerlending.com` — burner-domain pool instead

- Use 2–4 brand-affiliated burner domains at v1 (e.g. `lazer-loans.com`,
  `getlazerloans.com`, `team-lazer.com`, `trylazerlending.com`). Specific names
  TBD with client.
- 2–3 Google Workspace mailboxes per burner domain.
- Each mailbox sends 25–40/day after warmup; 5–10 mailboxes covers 100–300/day.
- `lazerlending.com` brand root is **never** used for cold outreach. It remains
  Lazer's normal business domain.
- "Torched root" stops being an emergency architectural concept and becomes
  routine inventory rotation: a burned burner gets retired and replaced.

**Reasoning**: Subdomain rotation on a single root provides partial isolation
only. Cold-mail abuse signals leak to root. Burning the brand domain has 3–6+
month recovery cost and damages Lazer's actual business mail. Burner-domain
pools are the dominant 2025/2026 operator pattern for exactly this reason.
Cost of a burner domain is ~$10–15/yr; acceptable insurance.

### D2. Cold sending is via Smartlead Pro API, headless

- Smartlead Pro at $94/mo (annual ~$78/mo) as the cold sending engine.
- Headless usage: our CRM owns the UI; Smartlead is invoked via REST API,
  events ingested via webhooks (`send`, `open`, `click`, `reply`, `bounce`,
  `unsubscribe`).
- Mailboxes connected via Google OAuth.
- Smartlead's built-in warmup network is used per mailbox.

**Reasoning**: Smartlead has the most mature webhook coverage in the cold
space, unlimited mailbox support, proven reliability, and clean headless
operation. Saleshandy Pro at $69/mo was the cheaper alternative (unlimited
mailboxes, native warmup) but its reply-webhook documentation is ambiguous —
$25/mo is not worth the integration risk on the system's most important data
flow. User explicitly chose certainty over cost on this question.

### D3. Workspace inventory via Mailforge (bulk reseller)

- Mailforge bulk pricing (~$1.67/inbox at small scale, ~$3 retail) for 5–10
  Google Workspace mailboxes at v1.
- Mailforge handles SPF/DKIM/DMARC pre-configuration.
- Domains can be bundled or registered separately (Cloudflare/Porkbun); decide
  during Phase 0 based on Mailforge's current inclusion policy.

**Reasoning**: Retail Google Workspace at $7/seat × 10 mailboxes = $70/mo.
Mailforge at $1.67–$3/seat = $17–30/mo for the same Google Workspace seats.
Same product, reseller arbitrage. Pre-configured DNS saves ~2 hours per inbox.

**Risk**: Reseller TOS gray area — Google has occasionally deplatformed
resellers. Mitigation: keep `lazerlending.com` Workspace (if any) separate;
burner-domain mailboxes are disposable inventory anyway. Backup plan is
direct Google Workspace at retail or Microsoft 365 split.

### D4. Resend stays — for transactional only

- Resend is used for system mail: user invitations, password resets, internal
  alerts (mailbox-health warnings, spam-placement alerts, FUB push
  confirmations, daily digest emails to Lazer team).
- Resend sends from a dedicated transactional subdomain on the brand root:
  `notify.lazerlending.com`. This subdomain **never** sends cold mail.
- Resend's free tier (3k/mo) covers expected transactional volume; upgrade to
  Pro ($20/mo) only if needed.

**Reasoning**: Resend is purpose-built for transactional mail and does it
well. Removing it entirely would mean rebuilding transactional sending on a
different stack. Keeping it on a separate subdomain isolates the brand-mail
reputation flow from the cold-mail flow entirely.

### D5. Volume target for v1 is 100–300/day, with documented scale path to 1,000/day

- Build infrastructure inventory and warmup schedule for 5–10 mailboxes,
  100–300/day at ramp-up.
- Document the 1,000/day scale path (~30 mailboxes, ~12 domains, ~$200/mo
  recurring) but do not pre-build inventory.
- Architecture is elastic: scaling to 1,000/day is "add more mailboxes in
  Mailforge, register more burner domains, OAuth them into Smartlead" — no
  re-architecture.

**Reasoning**: PRD's 1,000/day was always a ceiling, never a starting point.
Pre-building inventory wastes warmup runway and money. Most cold operations
never hit their stated ceiling.

### D6. Reply handling pulls from real mailboxes via Smartlead webhooks

- Replies land in the real Google Workspace mailbox (preserves Gmail's
  conversational engagement signal).
- Smartlead reply webhook fires our CRM on each new reply.
- Our CRM runs the LLM classifier, applies routing rules, forwards to the
  configured team email, and pushes to FUB only on positive classification
  with dedup check.
- Per-campaign override fields control which team email each campaign's
  positive replies forward to.

**Reasoning**: API-only ESPs require inbound-parse webhooks, which bypass the
mailbox entirely. Real-mailbox replies preserve threading, are visible to
human operators, and contribute to the mailbox's engagement reputation
signal (a deliverability asset).

### D7. Compliance baseline (deliverability-mandatory features)

- RFC 8058 one-click List-Unsubscribe header on every cold send.
- DMARC alignment (`p=none` minimum on every burner domain at launch; ramp to
  `p=quarantine` once reputation establishes).
- Per-mailbox bounce-rate watchdog: pause mailbox at >2% bounce rate over 24h
  (well below ESP/Gmail thresholds).
- Per-mailbox complaint-rate watchdog: pause mailbox at >0.1% complaint rate
  over 24h.
- ZeroBounce validation at list upload AND just-in-time re-validation for
  contacts unverified in >60 days (per PRD §5.3).

**Reasoning**: Gmail Nov-2025 and Outlook Q1-2025 enforcement actively reject
mail without these signals; spam-folder is no longer the worst case. The PRD
is silent on List-Unsubscribe; that gap must be closed.

## Rejected Alternatives

- **Resend as cold sender (PRD's original plan)** — AUP risk on lending
  vertical at 1k/day, API-mail filter penalty at Gmail, no real mailboxes for
  warmup or replies. Keeps role for transactional only.
- **Subdomain rotation on `lazerlending.com`** — partial reputation isolation
  only; "torched root" mitigation is damage control, not prevention.
- **SendGrid / Mailgun / Postmark / Brevo / Mailjet / SparkPost** — explicit
  AUP bans on cold; immediate suspension risk.
- **Amazon SES** — production-access gate denies cold lending; 0.1% complaint
  ceiling unrealistic for the vertical.
- **Saleshandy Pro at $69/mo** — cheaper headless option with unlimited
  mailboxes, but reply-webhook documentation is ambiguous; user chose
  certainty over $25/mo savings.
- **Instantly** — viable but operator-reported reputation degradation since
  late 2024; webhook gating to $97 tier; UI-coupling heavier than Smartlead.
- **Lemlist / Woodpecker / Mailshake / Klenty / Reply.io / Apollo** — UI-first
  or per-seat pricing models that fight headless multi-mailbox scaling.
- **Mailreef (own MTA + dedicated IP at $240/mo+)** — overkill at 1k/day
  ceiling; revisit only if volume grows past 10k/day.
- **Self-hosted EmailEngine + custom warmup** — saves ~$10–20/mo vs Smartlead,
  but adds 2–4 weeks of dev for orchestration, throttling, and warmup. Wrong
  trade at this scale.
- **Fully managed outbound agency** — cannot satisfy the "build a custom
  Lazer-branded CRM" outcome; disqualifies the project premise.
- **Hypertide ($0.50/inbox at 100-pack)** — economics only work at agency
  scale; $1,500 setup fee makes it irrational for a 5–10 mailbox v1.

## Direction

Build the Lazer Lending CRM in-house, but treat the email sending layer as a
vendored utility: Smartlead Pro (API headless) on a Mailforge-managed pool of
5–10 Google Workspace mailboxes spread across 2–4 brand-affiliated burner
domains, with Resend retained on `notify.lazerlending.com` for transactional
mail only. Volume target for v1 is 100–300/day; scale path to 1,000/day is
documented but not pre-built. All deliverability-mandatory compliance signals
(List-Unsubscribe, DMARC alignment, bounce/complaint watchdogs, ZeroBounce
validation) are first-class architectural concerns. The brand root
`lazerlending.com` never sends cold mail. The CRM, reply classifier, FUB
integration, settings panel, and dashboards remain custom Lazer-branded code
per the PRD; the orchestration of Smartlead + Mailforge + Resend +
ZeroBounce is the system's primary build effort.
