# Brief: Dual-Domain Email Setup

## Why
Isolate campaign/cold outreach reputation on `mail.integrateapi.ai` so if it gets spam-flagged, the root domain `integrateapi.ai` is unaffected. Natural emails and replies should come from the cleaner root domain.

## Context
- Resend is the email provider. Currently only `mail.integrateapi.ai` is verified (sending + receiving enabled).
- Resend Pro is now active ($20/mo) — supports up to 10 domains, no daily send limit.
- Cloudflare manages DNS for `integrateapi.ai`. MCP server configured in `.mcp.json`.
- No existing email service on the root domain — MX records are free to use.
- Inbound webhook (`email-events` edge function) is account-wide — works for all Resend domains automatically.
- Email threading uses `In-Reply-To` / `References` headers (Message-IDs), NOT sender domain. Thread integrity is safe.

### Key files:
- `supabase/functions/process-campaigns/index.ts` — campaign batch sends from `mail.integrateapi.ai`
- `supabase/functions/send-email/index.ts` — compose/reply sends, uses `profile.sending_email`
- `supabase/functions/email-events/index.ts` — inbound webhook handler (no changes needed)
- `src/pages/SettingsPage.tsx` — where users set their `sending_email`

### Current DNS for mail.integrateapi.ai:
- DKIM: `resend._domainkey.mail` TXT record (verified)
- SPF: `send.mail` MX + TXT records (verified)
- Receiving: `mail` MX → `inbound-smtp.us-east-1.amazonaws.com` (verified)

## Decisions
- **Campaigns send from `mail.integrateapi.ai`** — reputation isolation for cold outreach
- **Compose/reply sends from `integrateapi.ai`** — clean domain for natural conversation
- **Campaign emails set `Reply-To: {user}@integrateapi.ai`** — replies route to root domain, no visible domain switch for the recipient
- **Both domains feed the same CRM inbox** — Resend webhook is account-wide
- **Profile stores `email_prefix` (e.g. `nick`) instead of full email** — Settings field is just a username input, not a full email address
- **System derives both addresses from the prefix at send time:**
  - Compose/reply: `{prefix}@integrateapi.ai`
  - Campaigns: `{prefix}@mail.integrateapi.ai` with `Reply-To: {prefix}@integrateapi.ai`
- **DB migration**: rename `profiles.sending_email` → `profiles.email_prefix` (text), strip existing values to just the prefix
- **SettingsPage**: change input from full email to just prefix, show preview of both derived addresses

## Rejected Alternatives
- **Subtle mid-thread domain switch (changing From address)** — rejected because recipients see two different senders, some clients show "on behalf of" warnings, and spam filters can flag it as phishing
- **Single domain for everything** — rejected because one spam flag takes down all email
- **Subdomain like `reply.integrateapi.ai`** — unnecessary since no existing email service on root domain

## Backwards Compatibility (must preserve)
- **`mail.integrateapi.ai` stays fully active** — not replacing, only adding a second domain. All existing DNS records untouched.
- **Existing emails in DB** — stored with `from: mail.integrateapi.ai`. Display unchanged. No migration needed.
- **Existing campaign enrollments (Utah Senior campaign)** — already `status: 'sent'` from `mail.integrateapi.ai`. Replies to those emails still arrive at `mail.` domain → Resend webhook → CRM inbox. Works as-is.
- **Existing threads** — if user replies to an old `mail.` thread from `integrateapi.ai`, threading stays intact via `In-Reply-To` headers. Recipient sees different From but thread is continuous.
- **Old campaigns without Reply-To header** — replies go to `mail.` like before. No breakage. Only new campaigns get the `Reply-To` header.
- **No data migration** — no emails, threads, or activities need updating. This is purely additive.

## Direction
Add `integrateapi.ai` as a second verified domain in Resend with sending + receiving. Add DNS records via Cloudflare MCP. Then update `process-campaigns` to set `Reply-To` header on campaign emails, and update `send-email` to use `integrateapi.ai` for compose/reply. Profile sending_email updates to the root domain.
