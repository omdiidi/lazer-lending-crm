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

### 1. OpenRouter — single key for every AI feature

`OPENROUTER_API_KEY`

- **What it does:** Powers **all** LLM calls in the app via one API:
  - **Reply classifier** (`classify-reply` Edge Function) → `anthropic/claude-sonnet-4.6` for the ~30% of replies that survive the keyword pre-filter and need real reasoning (OOO vs negative, neutral vs positive).
  - **Campaign content** (`campaign-ai`) → `deepseek/deepseek-v3.2`.
  - **Email templates** (`generate-template`) → `openai/gpt-4.1-mini`.
  - **Lead assignment heuristics** (`assign-leads-ai`) → `deepseek/deepseek-v3.2`.
  - **Todo enhancement** (`todo-ai-enhance`) → `inception/mercury-coder-small-beta` (Mercury, very cheap, low-level task).
- **Why one provider:** You set up one billing relationship and the routing layer picks the right model per task. PII is regex-stripped before any call.
- **Where to get it:** https://openrouter.ai → Keys → Create. Add credits via Stripe.
- **Format:** `sk-or-v1-...`
- **Cost:** Pay-as-you-go credits. Realistic v1 burn: $5–20/mo total across all features (classifier dominates at ~$5–15/mo, the rest are rounding).

### 2. Smartlead — cold-sending campaign engine

`SMARTLEAD_API_KEY`, `SMARTLEAD_WEBHOOK_SIGNING_SECRET`

- **What it does:** Smartlead is the campaign engine that actually sends every cold email. We enroll leads into Smartlead campaigns and it dispatches via your warmed Workspace mailboxes. The webhook secret validates events (EMAIL_SENT / EMAIL_REPLIED / etc.) coming back to us.
- **Where to get it:** https://app.smartlead.ai → Settings → API → "Create API Key". Webhook signing secret is shown when you register the events webhook (Smartlead → Settings → Webhooks).
- **Format:** API key is a UUID-style string. Webhook secret is an arbitrary string (treat as a password).
- **Plan needed:** Smartlead **Pro** — $78/mo annual or $94/mo monthly. Free tier won't work (no API access).

### 3. Zapmail — Workspace mailbox provisioning

*No env var — managed entirely through their dashboard.*

- **What it does:** Provisions real Google Workspace mailboxes on your burner domains. We don't call their API at v1; you set up mailboxes in their UI and add credentials to Smartlead manually. Tracked in `mailboxes` table by hand for v1.
- **Where to get it:** https://zapmail.ai → sign up → connect Cloudflare DNS account → buy domains through them or BYO.
- **Plan needed:** Starter ($39/mo, 10 mailboxes) or Growth ($99/mo, 30 mailboxes).
- **What you give the CRM:** Just the SMTP/IMAP app passwords from the Workspace mailboxes — entered through the Mailboxes UI page, not env vars.

### 4. Follow Up Boss — qualified lead push target

`FUB_API_KEY`, `FUB_X_SYSTEM_KEY`

- **What it does:** When a reply gets classified as "warm interested", we POST to FUB's `/v1/events` API so the lead lands in their existing pipeline. `X-System-Key` is required to register us as a known integration (without it our rate limit halves).
- **Where to get it:**
  - API key: FUB → Admin → API. Generate one labeled "Lazer Lending CRM".
  - X-System-Key: email FUB support (`support@followupboss.com`) and request a system key for `lazer-lending-crm`. Takes 1–2 days to approve.
- **Format:** API key is a long base64-ish string. System key is a short opaque string.
- **Plan needed:** Whatever Lazer's existing FUB plan is — they already use FUB so no new account needed.

### 5. Resend — transactional notifications

`RESEND_API_KEY`

- **What it does:** Sends "you got a new reply, click here" notifications to the Lazer team when our classifier flags a reply as warm. **Never** used for cold sends (their AUP forbids cold mail). Sends from `notify.lazerlending.com` only.
- **Where to get it:** https://resend.com → API Keys → Create. Add the `notify.lazerlending.com` domain on the Domains page and verify DNS records.
- **Format:** `re_` prefix, then random hex.
- **Plan needed:** Free tier (3,000 emails/month) covers v1 by a wide margin.

### 6. ZeroBounce — email validation

`ZEROBOUNCE_API_KEY`

- **What it does:** Validates lead email addresses on upload (CSV) and re-validates periodically. Catches typos, role addresses, hard-bounce risks before we waste sending reputation on them.
- **Where to get it:** https://zerobounce.net → API → Create Key.
- **Format:** Long alphanumeric string.
- **Plan needed:** Pay-as-you-go — buy a credit block. 10,000 credits = ~$129. v1 burn rate is ~$5–25/mo.

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
- `CLASSIFIER_PROVIDER=openrouter` — leave as `openrouter`.
- `CLASSIFIER_MODEL=anthropic/claude-sonnet-4.6` — bump to whatever the latest Sonnet is on OR.

---

## ❌ Removed from Lazer scope

- **Apollo** (`APOLLO_API_KEY`) — Apollo lead sourcing isn't a Lazer selling point; leads enter via CSV upload + ZeroBounce validation. The Lead Generator page is hidden from the sidebar. The `apollo-search` Edge Function stays deployed because we extended its ZeroBounce code path for `validate-upload` to reuse, but the Apollo-search side will 401 silently without a key — that's expected.
- **Direct Anthropic** (`ANTHROPIC_API_KEY`) — replaced by OpenRouter. The classifier still uses Sonnet, just routed through OpenRouter so you have one billing relationship for every AI feature.

---

## Order to provision (recommended)

1. **OpenRouter** (5 min, $5 credit to start) — unblocks the classifier + every other AI feature.
2. **Resend** (15 min, free) — unblocks team-reply notifications. DNS verify takes ~10 min.
3. **ZeroBounce** ($5–10 credit block) — unblocks lead upload validation.
4. **Smartlead Pro** ($78/mo) — the big one. Without this, no cold sends happen.
5. **Zapmail** ($39–99/mo) — provisions the actual mailboxes Smartlead sends through.
6. **FUB** — request `X-System-Key` first (1–2 day SLA), then drop in the API key.

After each one is set, run `supabase secrets set <KEY>=<value> --project-ref cmubrsnhsxbrqxsjhxnx` so the deployed Edge Functions pick it up.
