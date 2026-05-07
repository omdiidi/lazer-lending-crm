# Credentials Checklist

Every API key the Lazer Lending CRM needs, what each one does, and where to get it. Paste values into your local `.env` (gitignored). For Edge Functions, also push them up via:

```bash
supabase secrets set KEY=value --project-ref cmubrsnhsxbrqxsjhxnx
```

---

## ✅ Already configured (Supabase project `cmubrsnhsxbrqxsjhxnx`)

These were pulled directly from the dashboard during initial setup and are already in `.env`:

- `VITE_SUPABASE_URL` / `SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PROJECT_REF`

Skip — nothing to do here.

---

## 🔑 Vendor credentials (you provision these)

### 1. Smartlead — cold-sending campaign engine

`SMARTLEAD_API_KEY`, `SMARTLEAD_WEBHOOK_SIGNING_SECRET`

- **What it does:** Smartlead is the campaign engine that actually sends every cold email. We enroll leads into Smartlead campaigns and it dispatches via your warmed Workspace mailboxes. The webhook secret validates events (EMAIL_SENT / EMAIL_REPLIED / etc.) coming back to us.
- **Where to get it:** https://app.smartlead.ai → Settings → API → "Create API Key". Webhook signing secret is shown when you register the events webhook (Smartlead → Settings → Webhooks).
- **Format:** API key is a UUID-style string. Webhook secret is an arbitrary string (treat as a password).
- **Plan needed:** Smartlead **Pro** — $78/mo annual or $94/mo monthly. Free tier won't work (no API access).

### 2. Zapmail — Workspace mailbox provisioning

*No env var — managed entirely through their dashboard.*

- **What it does:** Provisions real Google Workspace mailboxes on your burner domains. We don't call their API at v1; you set up mailboxes in their UI and add credentials to Smartlead manually. Tracked in `mailboxes` table by hand for v1.
- **Where to get it:** https://zapmail.ai → sign up → connect Cloudflare DNS account → buy domains through them or BYO.
- **Plan needed:** Starter ($39/mo, 10 mailboxes) or Growth ($99/mo, 30 mailboxes).
- **What you give the CRM:** Just the SMTP/IMAP app passwords from the Workspace mailboxes — entered through the Mailboxes UI page, not env vars.

### 3. Follow Up Boss — qualified lead push target

`FUB_API_KEY`, `FUB_X_SYSTEM_KEY`

- **What it does:** When a reply gets classified as "warm interested", we POST to FUB's `/v1/events` API so the lead lands in their existing pipeline. `X-System-Key` is required to register us as a known integration (without it our rate limit halves).
- **Where to get it:**
  - API key: FUB → Admin → API. Generate one labeled "Lazer Lending CRM".
  - X-System-Key: email FUB support (`support@followupboss.com`) and request a system key for `lazer-lending-crm`. Takes 1–2 days to approve.
- **Format:** API key is a long base64-ish string. System key is a short opaque string.
- **Plan needed:** Whatever Lazer's existing FUB plan is — they already use FUB so no new account needed.

### 4. Resend — transactional notifications

`RESEND_API_KEY`

- **What it does:** Sends "you got a new reply, click here" notifications to the Lazer team when our classifier flags a reply as warm. **Never** used for cold sends (their AUP forbids cold mail). Sends from `notify.lazerlending.com` only.
- **Where to get it:** https://resend.com → API Keys → Create. Add the `notify.lazerlending.com` domain on the Domains page and verify DNS records.
- **Format:** `re_` prefix, then random hex.
- **Plan needed:** Free tier (3,000 emails/month) covers v1 by a wide margin.

### 5. ZeroBounce — email validation

`ZEROBOUNCE_API_KEY`

- **What it does:** Validates lead email addresses on upload (CSV) and re-validates periodically. Catches typos, role addresses, hard-bounce risks before we waste sending reputation on them.
- **Where to get it:** https://zerobounce.net → API → Create Key.
- **Format:** Long alphanumeric string.
- **Plan needed:** Pay-as-you-go — buy a credit block. 10,000 credits = ~$129. v1 burn rate is ~$5–25/mo.

### 6. Anthropic — reply classifier (👈 your side question)

`ANTHROPIC_API_KEY`, `CLASSIFIER_MODEL=claude-sonnet-4-6`

- **What it does:** **Used only by the `classify-reply` Edge Function.** Inbound replies first run through a fast keyword multi-label scan (handles ~70% — clear "interested" / "not interested" / "unsubscribe" / "out of office" cases). Only the ambiguous ~30% — replies that hit multiple labels or none — get sent to Claude Sonnet 4.6 for a single classification call. Output is one of: `warm_interested`, `not_interested`, `oop`, `referral`, `complaint`, `human_review_needed`. We strip PII (SSN/CC/ITIN regex) before sending. **No-train DPA is required** — Anthropic's commercial DPA covers this.
- **Where to get it:** https://console.anthropic.com → API Keys → Create.
- **Format:** `sk-ant-api03-...`
- **Plan needed:** Pay-as-you-go. Realistic v1 cost: $5–15/mo (only ~30% of ~50 replies/day hit the LLM, ~$0.003 per call on Sonnet).

### 7. Apollo — lead enrichment *(inherited from Connect CRM)*

`APOLLO_API_KEY`

- **What it does:** Powers the Lead Generator page — search Apollo's database for prospects matching ICP filters (industry, title, location, company size). Optional for cold outreach if you're uploading your own CSVs.
- **Where to get it:** https://app.apollo.io → Settings → Integrations → API. Plan determines API quota.
- **Format:** Long alphanumeric.
- **Plan needed:** Apollo Basic+ ($49/mo) or whatever Lazer prefers. Skip if not using Apollo for sourcing.

### 8. OpenRouter — campaign template AI *(inherited from Connect CRM)*

`OPENROUTER_API_KEY`

- **What it does:** Generates campaign step copy in the Campaign Builder ("write me a follow-up step 2 for a mortgage cold campaign"). Optional — humans can write copy directly.
- **Where to get it:** https://openrouter.ai → Keys → Create.
- **Format:** `sk-or-v1-...`
- **Plan needed:** Pay-as-you-go credits. ~$5 covers many template generations.

---

## 🛠 Generated locally (no signup needed)

### `LIST_UNSUB_TOKEN_SECRET`

- **What it does:** Signs RFC-8058 List-Unsubscribe URLs with HMAC. Lets us validate one-click unsubscribes statelessly without a DB lookup.
- **Generate:** `openssl rand -hex 32`
- **Rotate carefully** — old emails in inboxes will have tokens signed with the previous secret; either keep verifying both during a rotation window, or accept that one-click unsubs from old emails fall back to the legacy UUID lookup.

### `LIST_UNSUB_TOKEN_TTL_DAYS=1825`

- **What it does:** How long unsubscribe tokens stay valid. Default 1825 days (5 years) — long enough that old emails still honor unsubscribe.
- **Just use the default.**

---

## 📋 Lazer-specific config (no API keys, just decisions)

These are environment values, not credentials. Set once and rarely touch:

- `RESEND_TRANSACTIONAL_DOMAIN=notify.lazerlending.com` — where team notifications come from. Must match what you verify in Resend.
- `RESEND_CAMPAIGN_DOMAIN=` — leave blank; defaults to `mail.<RESEND_TRANSACTIONAL_DOMAIN>`.
- `FUB_DEFAULT_SOURCE_LABEL=Cold Email CRM` — what shows up in FUB as the lead source.
- `FUB_DEFAULT_STAGE_NAME=Cold Lead` — which FUB stage warm replies land in. **Confirm this stage exists in Lazer's FUB account first** (run `scripts/fub-onboarding-check.ts` once `FUB_API_KEY` is set).
- `DEFAULT_REPLY_FORWARD_EMAIL=team@lazerlending.com` — fallback team notification address. Per-campaign override available via `campaigns.team_email`.
- `SITE_URL=http://localhost:5173` — set to `https://crm.lazerlending.com` once deployed.
- `DMARC_RUA_PROVIDER=cloudflare` — DMARC report aggregator. Cloudflare's free tier is fine.
- `CLASSIFIER_LLM_PROVIDER=anthropic` — leave as `anthropic` unless you swap providers.

---

## Order to provision (recommended)

1. **Anthropic** (5 min, $0 to start) — unblocks the classifier.
2. **Resend** (15 min, free) — unblocks team-reply notifications. DNS verify takes ~10 min.
3. **ZeroBounce** ($5–10 credit block) — unblocks lead upload validation.
4. **Smartlead Pro** ($78/mo) — the big one. Without this, no cold sends happen.
5. **Zapmail** ($39–99/mo) — provisions the actual mailboxes Smartlead sends through.
6. **FUB** — request `X-System-Key` first (1–2 day SLA), then drop in the API key.
7. **Apollo / OpenRouter** — only if you want lead sourcing or AI-generated step copy.

After each one is set, run `supabase secrets set <KEY>=<value> --project-ref cmubrsnhsxbrqxsjhxnx` so the deployed Edge Functions pick it up.
