# Lazer Lending CRM — Partner Handoff

Welcome. This doc is the **only thing you need to read first** to pick this project up. Everything else links from here.

**Project:** Cold-outreach CRM for Lazer Lending (residential mortgage). Built on Connect CRM scaffold. IntegrateAPI is the vendor.

**Status as of 2026-05-11:** Backend fully deployed and live. Frontend runs on localhost. All vendor integrations gated on credentials below — no live email traffic yet.

---

## 1. What's already done (don't redo this)

- ✅ **Supabase project live** — ref `cmubrsnhsxbrqxsjhxnx` (IntegrateAPI org, us-east).
- ✅ **All 10 migrations applied** — schema, RLS, RPC functions, realtime publication.
- ✅ **34 Edge Functions deployed** — send pipeline, classifier, webhooks, watchdogs.
- ✅ **5 pg_cron jobs scheduled** — process-campaigns (5min), cap-reset, dns-health-check, webhook-replay, smartlead-reconcile.
- ✅ **First admin user provisioned** — `zomid777@gmail.com` (Omid has the password; rotate via Settings → Profile after first login).
- ✅ **Frontend builds and runs** — `npm run dev` → `http://localhost:8080`.
- ✅ **6 commits pushed** to `github.com/omdiidi/lazer-lending-crm` on `main`.
- ✅ **All 7 smoke-test bugs fixed** (transforms regex, RateBadge, realtime channel collisions, Add Domain fallback, Add Mailbox/Lead UI, "undefined emp" render, hardcoded `integrateapi.ai`).

---

## 2. What's NOT done — your work starts here

### Hard blockers (cannot send mail without these)

| # | Item | Who provisions | Why blocked |
|---|---|---|---|
| B12 | Vendor credentials (6 services below) | You / partner | All Edge Functions deployed but inert |
| B2 | NMLS / state-licensing disclosure footer | Lazer compliance team | Regulatory — required on every cold send |
| B11 | FUB `X-System-Key` | Email FUB support | 1–2 day approval SLA |
| B13 | Smartlead List-Unsubscribe URL ownership | Smoke test in Phase 0.6 sandbox | Must inspect raw MIME to confirm header isn't overwritten |

See `docs/lazer-lending/BLOCKED-AWAITING-CLIENT.md` for all 16 numbered blockers + status.

---

## 3. Accounts to sign up for (in order)

Provision in this order — each unblocks specific Edge Functions. After each, push the key into Supabase:

```bash
supabase secrets set KEY=value --project-ref cmubrsnhsxbrqxsjhxnx
```

| Order | Vendor | Plan | Cost | Time | URL |
|---|---|---|---|---|---|
| 1 | **OpenRouter** | Pay-as-you-go | $5 credit to start, ~$5–20/mo burn | 5 min | https://openrouter.ai |
| 2 | **Resend** | Free tier (3K/mo) | $0 | 15 min + 10 min DNS verify | https://resend.com |
| 3 | **ZeroBounce** | Pay-as-you-go | $5–10 credit block, ~$5–25/mo | 10 min | https://zerobounce.net |
| 4 | **Smartlead Pro** | Pro (annual) | $78/mo | 20 min | https://app.smartlead.ai |
| 5 | **Zapmail** | Starter (10 mbx) | $39/mo + $13/yr per domain × 4 | 30 min | https://zapmail.ai |
| 6 | **Follow Up Boss** | Existing Lazer plan | $0 (Lazer pays) | 1–2 day approval | Lazer's FUB admin + email support@followupboss.com |

**Full per-vendor instructions, env-var names, formats, and gotchas:** `docs/lazer-lending/CREDENTIALS.md` — read this when you're actually provisioning.

**Total monthly cost at v1 volume (300–500/day):** ~$130/mo + per-domain registration.

---

## 4. Next steps (in order)

1. **Clone + boot locally**
   ```bash
   git clone https://github.com/omdiidi/lazer-lending-crm.git
   cd lazer-lending-crm
   npm install
   cp .env.example .env   # fill from Supabase dashboard + 1Password
   npm run dev            # → http://localhost:8080
   ```
   Login with the admin account Omid hands you, rotate the password.

2. **Read these in order** (1 hour total):
   - `README.md` — project context
   - `docs/lazer-lending/PRD.md` — outcome spec
   - `docs/lazer-lending/BRIEF-email-architecture.md` — locked email decisions (D1–D10)
   - `docs/lazer-lending/PLAN.md` — implementation plan, ~1100 lines, canonical
   - `docs/lazer-lending/CREDENTIALS.md` — vendor checklist

3. **Provision OpenRouter first** ($5, 5 min) — unblocks the reply classifier so you can verify the AI path end-to-end with a fake reply via REST before spending real money on Smartlead.

4. **Run Phase 0.6 sandbox** (`PLAN.md:794`) — provision **1 burner domain + 2 mailboxes** through Zapmail, OAuth into Smartlead, send 1 test email to a personal Gmail. Confirm:
   - Raw MIME has correct `List-Unsubscribe` headers (resolves blocker B13)
   - `EMAIL_SENT` webhook fires with verified HMAC signature
   - Reply triggers `EMAIL_REPLIED` webhook within expected latency

   **Do NOT bulk-provision 4 domains until this single-domain smoke runs clean.**

5. **Get NMLS footer from Lazer compliance** before any live send. Residential mortgage = regulated; CAN-SPAM violation = real penalty. Plug into the campaign template footer.

6. **Request FUB X-System-Key** by email to `support@followupboss.com` — request a system key for `lazer-lending-crm`. Do this early since it takes 1–2 days.

7. **Deploy frontend** when ready — repo is wired for any host that handles Vite (Vercel/Netlify/Cloudflare Pages). Update `SITE_URL` env var to the deployed URL.

8. **Warmup wall** — even with everything provisioned, expect **14–30 days of Smartlead warmup** before live cold sends. Mailboxes sit in `warmup_state='warming'`; flip to `'live'` only after warmup network has run. Week 1 of live = 10/day cap per mailbox (stepped ramp); week 2+ = configured cap (default 30/day).

---

## 5. Repo orientation

```
.
├── HANDOFF.md                    ← you are here
├── README.md                     ← project intro
├── CLAUDE.local.md               ← Claude Code session handoff (gitignored; per-machine)
├── docs/
│   ├── OVERVIEW.md               Connect CRM scaffold architecture
│   ├── (per-entity docs: leads.md, deals.md, ...)
│   └── lazer-lending/            ← all Lazer design + ops docs
│       ├── README.md             docs index
│       ├── PRD.md                canonical outcome spec
│       ├── PLAN.md               1100-line implementation plan (v3)
│       ├── BRIEF-email-architecture.md  D1–D10 email decisions
│       ├── CREDENTIALS.md        per-vendor signup instructions
│       ├── VENDOR-CONTRACTS.md   auth + rate limits + gotchas per vendor
│       ├── BLOCKED-AWAITING-CLIENT.md  all 16 blockers w/ status
│       ├── COMPLIANCE.md         CAN-SPAM, NMLS, CFPB retention
│       ├── EMAIL-FLOW.md         outbound + inbound pipeline diagrams
│       ├── OPS-RUNBOOK.md        incident response, vendor breakage
│       ├── CONNECT-CRM-AUDIT-DELTA.md  what already exists vs gets built
│       ├── WARMUP-CAPABILITY-MAP.md    per-mailbox warmup state machine
│       ├── incidents/            postmortems
│       └── _archive/             historical v2.5-era docs (not authoritative)
├── src/                          React frontend (Vite + TS + Tailwind + shadcn)
├── supabase/
│   ├── migrations/               10 SQL migrations applied
│   └── functions/                34 Edge Functions deployed
├── mcp-server/                   MCP server exposing CRM tools via API key
└── scripts/
    ├── fub-onboarding-check.ts   run once FUB_API_KEY is set
    └── fub-register-webhooks.ts  one-time webhook registration
```

---

## 6. Working with this codebase

### Live Supabase commands

```bash
# Push a vendor key to deployed Edge Functions
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-... --project-ref cmubrsnhsxbrqxsjhxnx

# Pull latest schema after migrations
supabase db pull --linked

# Deploy a single Edge Function
supabase functions deploy <function-name> --project-ref cmubrsnhsxbrqxsjhxnx

# Apply new migration
supabase db push --linked    # no Docker required
```

### Test the deployed pipeline without sending real mail

```bash
# Send a fake reply directly into the DB via REST → triggers classify-reply
SR=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env | cut -d= -f2-)
curl -X POST "https://cmubrsnhsxbrqxsjhxnx.supabase.co/rest/v1/replies" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR" \
  -H "Content-Type: application/json" \
  -d '{"lead_id":"<uuid>","subject":"Re: question","body":"interested, tell me more"}'
```

### Cleanup test data (preserves auth + profiles)

```bash
for tbl in pool_memberships mailboxes domains sending_pools leads; do
  curl -sS -X DELETE "https://cmubrsnhsxbrqxsjhxnx.supabase.co/rest/v1/$tbl" \
    -H "apikey: $SR" -H "Authorization: Bearer $SR" \
    -G --data-urlencode "id=neq.00000000-0000-0000-0000-000000000000"
done
```

---

## 7. Push rules

- **Never push to GitHub without explicit approval.** Always show diff + ask first.
- Branch from `main`. Default is squash-merge.
- The repo is **public** at `github.com/omdiidi/lazer-lending-crm` — don't commit secrets. `.env` is gitignored; double-check before any `git add`.

---

## 8. Open questions (decide with Omid / Lazer before live launch)

- **Burner domain names** — suggested seeds in `VENDOR-CONTRACTS.md:286`. Lazer signs off on final names.
- **Initial 4 vs 6 domains** — 4 covers 300/day target; 6 needed for 500/day path.
- **DNS aggregator for DMARC reports** — Cloudflare free tier recommended; needs Lazer DNS access.
- **Resend transactional domain verification** — `notify.lazerlending.com` DNS records need to be added at Lazer's DNS provider.
- **Reply forward email** — `team@lazerlending.com` is current default; confirm or set per-campaign override.

---

## 9. Who to ask

- **Project context, decisions:** Omid (IntegrateAPI)
- **Lazer business questions, NMLS, compliance:** Nick Pardon (IntegrateAPI) → Lazer stakeholder
- **AI-assisted dev continuation:** Read `CLAUDE.local.md` (Seq 4) — has full Claude Code session state, decision log D15–D24, and what-we-tried history.
- **GitHub:** `omdiidi/lazer-lending-crm` issues / PRs

Good luck.
