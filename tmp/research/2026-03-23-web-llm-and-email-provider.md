---
date: 2026-03-23T11:30:00-04:00
topic: "Chinese LLM on OpenRouter + Email Service Provider for CRM"
tags: [research, web, openrouter, llm, deepseek, qwen, resend, email, campaigns]
status: complete
sources_count: 40+
last_updated: 2026-03-23
---

# Research: Chinese LLM on OpenRouter + Email Service Provider

## Research Questions
1. Which Chinese LLM on OpenRouter is best for a CRM campaign AI assistant?
2. Which email service provider can handle bulk campaigns + Gmail-clone inbox (send + receive)?

---

## Part 1: Chinese LLM on OpenRouter

### Recommendation: `deepseek/deepseek-v3.2`

**Why:**
- Full structured output support (`response_format` with JSON schema, `tools`, `tool_choice` with `literal_required`)
- 163,840 token context window
- $0.26 input / $0.38 output per million tokens — negligible for CRM use
- V3.2 was specifically trained on agentic task synthesis (improved tool-use/JSON compliance over V3)
- Supports reasoning toggle (`reasoning: { enabled: true/false }`)
- Multiple providers on OpenRouter for high uptime

**Runner-up:** `qwen/qwen-2.5-72b-instruct` — cheapest at $0.12/$0.39 per million tokens, but smaller 32K context window

### Pricing Comparison

| Model | Input $/M | Output $/M | Context | JSON Schema | Tools |
|-------|-----------|------------|---------|-------------|-------|
| `deepseek/deepseek-v3.2` | $0.26 | $0.38 | 163,840 | Yes | Yes |
| `qwen/qwen-2.5-72b-instruct` | $0.12 | $0.39 | 32,768 | Yes | Yes |
| `qwen/qwen-plus-2025-07-28` | $0.26 | $0.78 | 1,000,000 | Yes | Yes |
| `deepseek/deepseek-r1` | $0.70 | $2.50 | 64,000 | No | Yes |
| `z-ai/glm-4.7` | $0.39 | $1.75 | 202,752 | Yes | Yes |

### API Call Format

```
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
```

Model ID: `deepseek/deepseek-v3.2`

Supports `response_format: { type: "json_schema", json_schema: { ... } }` for enforced structured output. Use `plugins: [{ "id": "openrouter#response-healing" }]` as safety net for JSON repair.

---

## Part 2: Email Service Provider

### Recommendation: Resend (Pro plan, $20/month)

**Why Resend wins for this CRM:**

1. **Official Supabase Edge Functions integration** — maintained guide + example repo (`resend/resend-supabase-edge-functions-example`). No other provider has this.
2. **Inbound email webhooks** — launched Nov 2025, works on all plans including Pro. Fires `email.received` to your Edge Function endpoint.
3. **Threading support** — documented `In-Reply-To` + `References` header API, maps directly to existing `thread_id`/`reply_to_id` columns.
4. **Batch API** — 100 emails per call, 5 calls/second. Handles campaigns up to ~2,000 recipients without special config.
5. **Cold outreach allowed** — permits sales emails with CAN-SPAM compliance (unsubscribe link required). Most competitors (Mailgun, Postmark, SendGrid) prohibit cold outreach.
6. **Clean JSON REST API** — native Deno/TypeScript SDK, Bearer token auth. No FormData encoding.

### Provider Comparison

| Criteria | Resend | Mailgun | Postmark | SendGrid | Amazon SES |
|----------|--------|---------|----------|----------|------------|
| Price (50k/mo) | $20/mo | $35/mo | $15/mo (10k only) | $19.95/mo | ~$5/mo |
| Free tier | 3k/mo, 100/day | 100/day trial | 100/mo | 60-day trial | 3k/mo (12mo) |
| Bulk campaigns | Yes (Batch API) | Yes | Yes (separate stream) | Yes | Yes |
| Inbound webhooks | Yes (all plans) | Yes (1 route free) | Pro+ only | Yes | SNS (complex) |
| Threading headers | Documented | Yes | Yes | Yes | Yes |
| Open/click tracking | Yes | Yes | Yes | Yes | Via SNS |
| Cold outreach | Allowed | Prohibited | Prohibited | Prohibited | Allowed |
| Supabase guide | Official | Official (verbose) | None | None | None |
| Setup complexity | Very low | Medium | Medium | Medium | High |

### Why NOT Gmail API?
- Rate limits kill campaigns: 2.5 emails/sec, 500/day (Gmail) or 2,000/day (Workspace)
- Requires full OAuth 2.0 flow, token management, Google Cloud Pub/Sub for push notifications
- Sends from user's personal address, not branded `@integrateapi.ai`
- Google may suspend API access for bulk marketing use

### Schema Additions Needed for Resend

New columns on `emails` table:
- `provider_message_id` (text) — RFC 2822 Message-ID for threading
- `provider_email_id` (text) — Resend's internal UUID (for fetching inbound body)
- `opened_at` (timestamptz) — from `email.opened` webhook
- `clicked_at` (timestamptz) — from `email.clicked` webhook
- `bounced_at` (timestamptz) — from `email.bounced` webhook

### Architecture: How Inbound Email Works

```
1. MX record on integrateapi.ai → Resend receiving servers
2. Resend processes inbound → fires POST to Edge Function (email.received)
3. Edge Function:
   a. Receives webhook payload (from, to, subject, email_id)
   b. Fetches body via GET api.resend.com/emails/received/<email_id>
   c. Matches lead by from address
   d. Determines thread_id from In-Reply-To header
   e. Inserts into emails table (direction: 'inbound', read: false)
   f. Optionally inserts activity (type: 'email_received')
4. React frontend picks up via React Query refetch or Supabase Realtime
```

---

## Sources

### OpenRouter / LLM
- https://openrouter.ai/deepseek/deepseek-v3.2
- https://openrouter.ai/qwen/qwen-2.5-72b-instruct
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://openrouter.ai/docs/guides/features/plugins/response-healing
- https://llm-stats.com/models/compare/deepseek-v3-vs-qwen3-235b-a22b

### Email Providers
- https://resend.com/pricing
- https://resend.com/docs/send-with-supabase-edge-functions
- https://resend.com/docs/dashboard/receiving/introduction
- https://resend.com/docs/dashboard/receiving/reply-to-emails
- https://resend.com/legal/acceptable-use
- https://github.com/resend/resend-supabase-edge-functions-example
- https://www.mailgun.com/pricing/
- https://postmarkapp.com/pricing
- https://sendgrid.com/en-us/pricing
- https://aws.amazon.com/ses/pricing/
