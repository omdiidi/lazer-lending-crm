# Resend AUP, RFC 8058, and Gmail/Outlook 2026 Enforcement Research

**Date:** 2026-05-04
**Researcher:** Claude Sonnet 4.6 (technical research agent)
**Scope:** Three interlocking compliance topics for the Lazer Lending CRM cold-email architecture.
**Architecture reminder:** Cold sending = Smartlead Pro on burner-domain Workspace mailboxes. Resend = transactional only on `notify.lazerlending.com`.

---

## Section 1: Resend Acceptable Use Policy — Transactional-Only Use

### 1.1 Cold Email: Still Prohibited as of May 2026

Resend's AUP (https://resend.com/legal/acceptable-use) explicitly prohibits:

> "sending mass, non-personalized, unsolicited messages without prior consent"

The AUP requires that "all mail should be sent to recipients who gave you approval (opt-in) to send to them." This is unchanged from prior published versions. Our architecture is compliant: no cold sends leave Resend. Cold volume flows exclusively through Smartlead.

**Confidence: High** — sourced from the live AUP page.

### 1.2 AUP Thresholds for Transactional Senders

Resend's AUP states exact numeric thresholds:

| Signal | Threshold | Consequence |
|--------|-----------|-------------|
| Complaint rate | Must stay **below 0.08%** | Account shutdown without warning |
| Bounce rate | Must stay **below 4%** | Account shutdown without warning |

Source: https://resend.com/legal/acceptable-use

**Important implication for our architecture:** Resend's 0.08% complaint ceiling is stricter than Gmail's 0.1% recommendation and far stricter than our Smartlead watchdog's 0.1% per-mailbox threshold. Our Resend sends are internal alerts and ops emails to known recipients (the Lazer team), so complaints are a non-issue. But this number must be flagged in the ops runbook in case the Resend domain is ever used for any other purpose.

### 1.3 Is `notify.lazerlending.com` Acceptable?

Yes, with high confidence. Resend's documentation explicitly recommends subdomain sending:

> Resend recommends sending emails from a subdomain (notifications.acme.com) instead of your root/apex domain (acme.com).

Source: https://resend.com/docs/knowledge-base/is-it-better-to-send-emails-from-a-subdomain-or-the-root-domain

`notify.lazerlending.com` is a consumer-facing financial services brand's subdomain. It carries no cold-sending history. Resend's AUP risk comes from the sending behavior (unsolicited bulk), not the domain brand. Transactional system alerts sent from this subdomain to internal team addresses are fully within AUP scope.

**Confidence: High.**

### 1.4 Forwarded Hostile Reply Bodies in Internal Alerts — Is That "Cold Mail"?

The Resend AUP prohibits *sending to* recipients who did not opt in. Our alert flow is:

1. Prospect sends a hostile reply to a Smartlead-managed Workspace mailbox.
2. Smartlead webhook fires.
3. Our edge function forwards the classified reply to the assigned Lazer team member's email via Resend.

The recipient of the Resend message is an **internal Lazer employee**, not the prospect. The message is a system notification, not a solicitation. This is textbook transactional mail (system event → notification to a known internal user). The fact that the body quotes a hostile external message is irrelevant to AUP classification.

**Verdict: Permitted. Not cold mail. Confidence: High.**

The one edge case to avoid: never put the prospect's email address in the Resend "To:" field. Route all Resend sends to internal addresses only. Smartlead handles direct communication with prospects.

### 1.5 Free Tier Limits and Fit for 300-500/day Cold Operations

| Plan | Monthly emails | Daily cap | Domains | $/mo |
|------|---------------|-----------|---------|------|
| Free | 3,000 | 100/day | 1 | $0 |
| Pro (50K) | 50,000 | None | 10 | $20 |
| Pro (100K) | 100,000 | None | 10 | $35 |

Source: https://resend.com/pricing

**Volume math for our Resend use case (internal alerts only):**

A 300-500/day cold operation generates Resend sends only for:
- Reply notifications to team members
- Watchdog pause alerts
- Daily/weekly ops digest
- Bounce cascade notifications
- Password resets and system alerts

Conservative estimate: 10-50 Resend sends/day for a 500/day cold operation. That is well inside the free tier's 100/day hard cap and 3,000/month ceiling. **Free tier covers v1 comfortably.** The upgrade trigger is if Lazer adds customer-facing transactional emails (e.g., lead confirmation emails) through the same account.

[UNVERIFIED: The free tier's 100/day cap could be a bottleneck if the system generates more than 100 internal alerts per day. This is unlikely in v1 but should be monitored via Resend dashboard events.]

### 1.6 Domain Setup: SPF, DKIM, DMARC for `notify.lazerlending.com`

**SPF and DKIM:** Resend generates and manages these automatically when you add and verify a domain. When you verify `notify.lazerlending.com` in the Resend dashboard, Resend provides DNS records (a CNAME or TXT for DKIM, and SPF includes Resend's sending IPs). Adding those records means SPF and DKIM pass automatically on all sends from that domain.

Source: https://resend.com/docs/dashboard/domains/dmarc and https://dmarc.wiki/resend

**DMARC:** You must add a separate `_dmarc.notify.lazerlending.com` TXT record manually (Resend does not auto-create DMARC). Steps:

```
TXT record: _dmarc.notify.lazerlending.com
Value:      v=DMARC1; p=none; rua=mailto:dmarc-reports@lazerlending.com; ruf=mailto:dmarc-forensics@lazerlending.com; fo=1;
```

Start at `p=none` to collect RUA/RUF reports without policy enforcement. After 14+ days of clean reports (all legitimate sends DKIM-aligning), advance to `p=quarantine`.

**Important note on subdomain inheritance:** If `lazerlending.com` root domain has its own DMARC record, `notify.lazerlending.com` inherits it unless an explicit subdomain record is present. Create the explicit `_dmarc.notify.lazerlending.com` record to decouple the subdomain policy from root domain policy. This lets you advance the subdomain independently.

Source: https://resend.com/blog/how-dmarc-applies-to-subdomains

**Recommended DNS checklist for `notify.lazerlending.com`:**
1. Add domain in Resend dashboard → copy the CNAME records Resend provides → add to DNS.
2. Add SPF: `notify.lazerlending.com TXT "v=spf1 include:amazonses.com ~all"` (Resend uses SES infrastructure; exact SPF record is provided by Resend dashboard — use that, not this example).
3. Resend dashboard will show green checkmarks when SPF + DKIM propagate.
4. Add `_dmarc.notify.lazerlending.com TXT "v=DMARC1; p=none; rua=..."` manually.
5. Set up Postmaster Tools for `notify.lazerlending.com` on day 1.

### 1.7 Resend Inbound Parse — Not Relevant to Our Flow

Resend does offer inbound email parsing (Inbound Parse). We are NOT using it. Cold reply handling flows through Smartlead's reply webhook exclusively. Smartlead delivers reply events as HTTP POST to our webhook endpoint. Resend Inbound Parse is architecturally irrelevant to this project.

**Confirmed: Resend Inbound Parse = not used. No action needed.**

---

## Section 2: RFC 8058 — One-Click List-Unsubscribe

### 2.1 Required Headers

RFC 8058 specifies two mandatory headers (source: https://www.rfc-editor.org/rfc/rfc8058.html):

**Header 1:** `List-Unsubscribe`
Must contain one HTTPS URI. May also include a `mailto:` URI as an additional alternative, but the HTTPS URI is mandatory and is what Gmail and Yahoo clients use for one-click processing. The `mailto:` variant is processed by legacy MUAs, not one-click clients. Both can coexist.

```
List-Unsubscribe: <https://unsub.example.com/u/TOKEN>, <mailto:unsub@example.com?subject=unsubscribe>
```

**Header 2:** `List-Unsubscribe-Post`
Must contain exactly this string:

```
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

**DKIM coverage (mandatory):** The message must carry a valid DKIM signature that covers at minimum the `List-Unsubscribe` and `List-Unsubscribe-Post` headers. This means: Smartlead must not add or modify these headers after DKIM signing. If Smartlead signs first then adds headers, they will be uncovered and the mechanism will be invalid. Verify in raw MIME that both headers appear in the `h=` tag of the DKIM signature.

Sources: https://www.rfc-editor.org/rfc/rfc8058.html, https://www.captaindns.com/en/blog/gmail-one-click-unsubscribe-rfc8058

### 2.2 POST Endpoint Requirements

The unsubscribe endpoint must:

1. **Accept POST, not GET.** GET requests from email clients doing link prefetching must NOT trigger an unsubscribe. Only a POST with body `List-Unsubscribe=One-Click` is a valid signal.
2. **No authentication required.** The RFC explicitly states: "POST request MUST NOT include cookies, HTTP authorization, or any other context information." No session cookies, no CSRF token, no JWT. The URL itself must encode all required identity.
3. **No redirect.** The RFC states: "MUST NOT return an HTTPS redirect." Redirected POSTs historically turn into GETs, breaking the mechanism.
4. **No captcha, no interstitial, no preference page.** The opt-out must complete in response to the single POST.
5. **Idempotent.** Gmail and other MUAs (and their prefetchers) may POST the same URL multiple times. The endpoint must process the first POST and silently succeed on subsequent identical POSTs. Do not return an error on double-POST — return 200.
6. **Fast response.** Return 200 immediately; do not make the HTTP response wait on downstream processing.

**HTTP status codes** (operator consensus — not specified in RFC):
- `200 OK` — success (first or repeated unsubscribe)
- `200 OK` — already unsubscribed (idempotent; do not use 4xx here, some clients treat that as failure and retry aggressively)
- [UNVERIFIED: Some implementations use 204 No Content; operator consensus appears to favor 200 with an empty or minimal body]

### 2.3 Token Design: Stateless HMAC vs Stored DB Token

**Option A: Stateless HMAC (our planned approach)**

Structure (as specified in our PLAN.md):
```
HMAC-SHA256(key=LIST_UNSUB_TOKEN_SECRET, data="{lead_id}:{campaign_id}:{mailbox_id}:{expiry_unix}")
```

URL format: `https://crm.lazerlending.com/unsub/{lead_id}/{campaign_id}/{mailbox_id}/{expiry_unix}/{hmac}`

Pros:
- Zero DB reads to validate the token — constant-time verification.
- No token store to keep in sync with email sends.
- Naturally encodes recipient + list identity (required by RFC 8058 §3).
- Works even if the DB row has been migrated or the lead ID changed (as long as parameters match).

Cons:
- Cannot be revoked before expiry without a blocklist table.
- If `LIST_UNSUB_TOKEN_SECRET` rotates, all outstanding tokens from old key become invalid.
- Expiry in the URL is visible to any URL scanner, though not sensitive information.

**Option B: Opaque DB Token**

Structure: UUID stored in `suppressions` or a dedicated `unsub_tokens` table, referencing (lead_id, campaign_id, mailbox_id).

Pros:
- Revocable on demand.
- No secret key dependency.

Cons:
- DB read on every POST (including prefetcher hits).
- Token table must be kept forever (or long enough) since old emails circulate.
- Under high prefetcher load, creates hot rows.

**Recommendation:** Our PLAN.md's stateless HMAC approach is correct for this scale. It eliminates the DB read on the hot path and aligns with the RFC's intent of encoding identity in the URL. Use a non-rotating secret (store in Vault / Supabase secret) and a long TTL (see §2.4).

Source: https://smtpedia.com/rfc-8058/ (URI must contain "enough information to identify the mail recipient and the list"), https://www.captaindns.com/en/blog/gmail-one-click-unsubscribe-rfc8058

### 2.4 Token TTL — How Long Should Unsubscribe Links Work?

**CAN-SPAM requirement:** The opt-out mechanism must remain functional for at least 30 days after the message was sent. Source: CAN-SPAM Act §7.

**Operator reality:** Recipients try old emails months or years later, especially in mortgage/lending where someone may revisit a cold email after deciding to refinance. If the link is expired, the experience is broken (they try to unsubscribe and see an error), which can result in a spam complaint instead.

**Operator consensus:** Use a much longer TTL than the 30-day minimum. Common practice is 1 year (365 days) to "forever" (no expiry). Given that our token encodes a `expiry_unix` field:

- **Recommended TTL: 2 years from send date.** This exceeds CAN-SPAM by 24x, handles the "I found this old email" case, and stays within a reasonable key-rotation window.
- If we rotate `LIST_UNSUB_TOKEN_SECRET`, invalidate it only after confirming all outstanding tokens under the old key are beyond reasonable circulation age (3+ years).

[UNVERIFIED: No authoritative source specifies a "correct" TTL beyond the CAN-SPAM 30-day floor. The 2-year recommendation is operator consensus derived from deliverability community practice, not a published standard.]

### 2.5 Verifying Headers in Raw MIME (Gmail)

To confirm emails carry correct headers before production launch (v1.SC3):

1. Send a test email from a Smartlead-connected warmed mailbox to a personal Gmail account.
2. In Gmail web client: open the email → three-dot menu → "Show original."
3. In the raw MIME view, search for:
   - `List-Unsubscribe:` — must be present, must start with `<https://`
   - `List-Unsubscribe-Post: List-Unsubscribe=One-Click` — must be exactly this string
   - The DKIM `h=` tag in the `DKIM-Signature:` header — must include `list-unsubscribe` and `list-unsubscribe-post`
4. Verify the HTTPS URL is reachable and correctly handles POST (use curl):
   ```
   curl -X POST "https://crm.lazerlending.com/unsub/{token}" \
        -d "List-Unsubscribe=One-Click" \
        -H "Content-Type: application/x-www-form-urlencoded"
   ```
   Expect: HTTP 200, no redirect.

Source: Operator practice; Gmail "Show original" is the canonical raw MIME viewer.

### 2.6 Body Link — Still Required Separately

RFC 8058 does NOT replace the body unsubscribe link. The RFC adds a machine-processable mechanism ON TOP of the human-visible body link. Both must be present:

- `List-Unsubscribe` + `List-Unsubscribe-Post` headers: for MUA one-click processing (Gmail, Yahoo, Outlook).
- Visible footer link in email body: for CAN-SPAM compliance and human readability.

The body link and the header URL can point to the same endpoint (which handles both GET display and POST processing) or different URLs. Simplest implementation: same URL, endpoint returns an HTML "you've been unsubscribed" page on GET, processes silently on POST.

Source: https://www.captaindns.com/en/blog/gmail-one-click-unsubscribe-rfc8058 — "Keep your footer unsubscribe link; the header mechanism doesn't replace it."

---

## Section 3: Gmail Postmaster + Outlook SNDS — 2026 Enforcement

### 3.1 Gmail — Post-November 2025 Enforcement State

**Bulk sender threshold:** 5,000 emails/day to Gmail/Google Workspace consumer accounts.

At 300-500/day across all mailboxes, we are below the Gmail bulk sender threshold for the cold flow. However, Smartlead's warmup network generates warmup sends from our mailboxes to seed inboxes, which may include Gmail addresses. The exact total send volume (cold + warmup) determines whether bulk sender rules apply per mailbox.

**Recommendation:** Treat all burner-domain mailboxes as if they are bulk senders and implement all requirements from day 1. The cost of compliance is negligible; the cost of non-compliance after November 2025 is SMTP rejection.

**Complaint rate ceiling:**

| Level | Rate | Action |
|-------|------|--------|
| Target | Below 0.10% | Inbox placement maintained |
| Warning | 0.10% - 0.30% | Deliverability degradation |
| Hard ceiling | At or above 0.30% | Delivery disruptions + loss of mitigation support |

As of November 2025, Gmail issues **temporary (421) and permanent (550 5.x.x) rejection codes** for non-compliant senders — not just spam-folder routing. This is a hard behavior change from the pre-November 2025 state.

Source: https://www.suped.com/blog/new-gmail-bulk-sender-compliance-updates-november-2025, https://powerdmarc.com/gmail-enforcement-email-rejection/

**DMARC requirement for bulk senders:** Minimum `p=none` with DMARC alignment. At `p=none`, Gmail does not reject non-aligned mail — but the DMARC record must exist and RUA reports must flow. Gmail confirmed this is a non-negotiable first step.

Source: https://support.google.com/a/answer/81126?hl=en

**SPF AND DKIM — both required, not either-or:**

As of the November 2025 enforcement wave, both SPF and DKIM must be set up. The November 2025 update clarified: "This is no longer an either/or situation." For DMARC alignment, the From: header domain must align with either the SPF domain OR the DKIM domain — but both authentication mechanisms must be present.

Source: https://www.suped.com/blog/new-gmail-bulk-sender-compliance-updates-november-2025

**PTR (reverse DNS) record:** Mandatory. The sending IP's PTR must resolve to a hostname, and that hostname's A/AAAA record must resolve back to the sending IP (FCrDNS). For Workspace/Gmail accounts used as mailboxes in Smartlead, this is handled by Google's infrastructure — Google's outbound IPs have valid PTR records. No action needed on our end for Workspace mailboxes. Relevant only if we ever send from our own IPs.

**One-click unsubscribe enforcement level:**

As of February 2024 (and continued into November 2025 enforcement), one-click unsubscribe is required for bulk senders' marketing and subscription messages. Non-compliance results in spam-folder routing, not hard rejection (as of the data available). However, given that Gmail is escalating enforcement in general, treat it as rejection-grade.

[UNVERIFIED: Whether Gmail has moved one-click unsubscribe non-compliance from spam-folder to 5xx rejection post-November 2025. The redsift.com comparison table (sourced in this research) states Google/Yahoo non-compliance = spam folder for unsubscribe specifically, while authentication non-compliance = 550 rejection.]

**Postmaster Tools — signals for burner domains:**

Postmaster Tools surfaces:
- Domain reputation (Bad / Low / Medium / High)
- Spam rate (% of your mail users mark as spam — calibrated to your Gmail volume, not absolute)
- Delivery errors (% of your mail rejected or deferred)
- Encryption (% of mail delivered over TLS)
- DKIM, SPF, DMARC success rates

Set up Postmaster Tools for each burner domain on day 1. The domain must receive a minimum volume of Gmail-destined mail before data populates (typically 1 month of consistent sends). This means warmup traffic to Gmail seed inboxes is valuable not just for reputation but for Postmaster data visibility.

Source: https://iterable.com/blog/everything-you-need-to-know-about-google-postmaster-tools-for-2025/

### 3.2 Outlook (Q1/Q2 2025 Enforcement)

**Bulk sender threshold:** 5,000+ emails/day to Microsoft consumer domains (outlook.com, hotmail.com, live.com, msn.com).

Same threshold as Gmail; same treatment applies — implement full requirements regardless.

**Enforcement timeline:**

| Date | Action |
|------|--------|
| Before May 5, 2025 | Education phase; violations routed to Junk |
| May 5, 2025 | Hard rejection begins; error `550; 5.7.515` |
| Present (May 2026) | Permanent rejection for non-compliant bulk senders |

Source: https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730

**Authentication requirements:**
- SPF: Mandatory
- DKIM: Mandatory
- DMARC: Mandatory at `p=none` minimum; alignment with either SPF or DKIM

**Key difference from Gmail:** Microsoft moved to **hard rejection (550 5.7.515)** before Gmail escalated to 5xx in November 2025. Microsoft's enforcement posture has been more aggressive throughout 2025.

Also note: "Safe Sender list won't be honored" — a prospect who whitelisted your domain in Outlook cannot override Microsoft's bulk-sender enforcement. This matters for reply tracking: if a prospect replies positively and tries to add us to their safe list, Microsoft still applies authentication checks to inbound mail from us.

**SNDS (Smart Network Data Services):**

Microsoft's SNDS tool (https://sendersupport.olc.protection.outlook.com/snds/) provides:
- Trap hit rate (seed spam-trap addresses Microsoft operates)
- Complaint rate from Hotmail/Outlook users
- IP-level reputation status (Green / Yellow / Red)

We must register our sending IPs in SNDS. For Workspace-based sending, Google's IPs send on our behalf — we cannot directly register those IPs. [UNVERIFIED: Whether SNDS registration applies to Workspace senders or is primarily for dedicated IP senders. If Workspace-based, Microsoft's spam filters work on the sending IP's existing reputation, which Google maintains. No action likely needed from our side.]

**JMRP (Junk Mail Reporting Program):**

Microsoft's feedback loop for complaint data. Complaints from Outlook users are reported back to the registered abuse mailbox. For Workspace senders, JMRP registration may not be available in the same way as for dedicated-IP senders. Check Smartlead's documentation to see if they aggregate Microsoft FBL data.

[UNVERIFIED: Whether JMRP is accessible to third-party ESP customers or only to IPs registered directly with Microsoft.]

### 3.3 Yahoo

**Bulk sender threshold:** 5,000+ emails/day.

Yahoo tracks closely with Gmail's requirements and announcement cadence (they coordinated the February 2024 announcement jointly). As of 2026:

| Requirement | Yahoo | Notes |
|-------------|-------|-------|
| SPF | Mandatory | Must pass |
| DKIM | Mandatory | Minimum 1024-bit key |
| DMARC | Mandatory | Minimum `p=none`; alignment required |
| Complaint threshold | Below 0.10% target; never reach 0.30% | Active CFL (Complaint Feedback Loop) required |
| One-click unsubscribe | Required for marketing/subscription | Non-compliance = spam folder |
| FCrDNS (PTR) | Mandatory | Same as Gmail |

Source: https://senders.yahooinc.com/best-practices/, https://redsift.com/guides/bulk-email-sender-requirements

Yahoo's Complaint Feedback Loop (CFL): Yahoo operates a feedback loop that sends complaint reports to a registered mailbox. Register at https://senders.yahooinc.com/. Complaint reports help us catch per-mailbox issues before the Wilson watchdog fires.

### 3.4 Cross-Provider Comparison Table

| Requirement | Gmail | Yahoo | Microsoft Outlook |
|------------|-------|-------|-------------------|
| SPF | Mandatory | Mandatory | Mandatory |
| DKIM | Mandatory | Mandatory | Mandatory |
| DMARC (p=none min) | Mandatory | Mandatory | Mandatory |
| DMARC alignment | SPF or DKIM | SPF or DKIM | SPF or DKIM |
| FCrDNS/PTR | Mandatory | Mandatory | Mandatory |
| One-click unsubscribe | Required (spam-folder if missing) | Required (spam-folder if missing) | Required (best practice; harder enforcement TBD) |
| Complaint ceiling | 0.30% (target < 0.10%) | 0.30% (target < 0.10%) | Not published (industry best practice) |
| Bounce rate ceiling | Not published (practical: < 4%) | Not published | Not published |
| Hard rejection on auth failure | Yes (550 5xx, since Nov 2025) | Yes | Yes (550 5.7.515, since May 2025) |
| Feedback loop | Postmaster Tools | Yahoo CFL | SNDS + JMRP |

Source: https://redsift.com/guides/bulk-email-sender-requirements

### 3.5 Implications for Burner-Domain Pool Architecture at 300-500/day

**Does our 0.1% complaint watchdog give enough buffer?**

Yes, with margin. Our Wilson lower-bound watchdog fires at >0.1% complaint rate. Gmail's hard ceiling is 0.30%; the practical target is <0.10%. Running the watchdog at 0.1% Wilson lower-bound with a floor of 10 attempted emails means we pause the mailbox before it approaches Gmail's enforcement threshold. This is the correct calibration.

The one risk: the Wilson lower-bound at small sample sizes (near the 10-attempt floor) will have wide confidence intervals. A single complaint in 10 sends = 10% raw rate, which Wilson lower-bound at 95% confidence would interpret as roughly 3-5% lower bound — still far above 0.1%, so the watchdog correctly fires. As volume grows, the lower-bound tightens. This is working as intended.

**Is `p=none` DMARC for the first 4-6 weeks per burner domain safe?**

Yes. `p=none` means the receiving mailbox provider receives RUA reports but takes no enforcement action on DMARC failures. Recipients do NOT enforce against `p=none` — their spam filters may still use DMARC alignment data as a signal, but the DMARC policy itself causes no rejections or quarantines during the monitoring phase.

The risk during `p=none` is that if a third party spoofs our burner domain, we cannot stop it via DMARC. For a burner domain with no brand value or inbound receiving, this is an acceptable risk for 4-6 weeks.

**Signal-based vs calendar-based DMARC ramp — which does the spec allow?**

Both. RFC 7489 (DMARC spec) does not mandate a timeline; it only defines the policy mechanics. Operator consensus (confirmed by dmarcreport.com research):

- **Calendar-based:** Minimum 2-4 weeks at `p=none` for new domains before advancing.
- **Signal-based:** Monitor RUA reports; advance to `p=quarantine` only when: (a) 95%+ of your own legitimate sends are DKIM-aligning, and (b) no unexpected sending sources appear in reports for 14 consecutive days.

Our planned ramp ("p=none 4-6 weeks → p=quarantine") combines both: calendar minimum of 4-6 weeks AND the 95% alignment signal requirement. This is consistent with operator best practice and the evidence from DMARC ramp literature.

Source: https://dmarcreport.com/blog/dmarc-enforcement-timeline-none-to-reject-roadmap/

**Should we advance to `p=reject` for burner domains?**

Not necessary for deliverability. `p=quarantine` is sufficient. Burner domains have short operational lifetimes (6-18 months of active use before rotation). The added anti-spoofing protection of `p=reject` is marginal for domains with no inbound mail stream. Reserve `p=reject` for `lazerlending.com` root domain and `notify.lazerlending.com`.

### 3.6 Burner Domain Warmup Patterns — What Gmail/Outlook Penalize

**Patterns now penalized (2025-2026):**

1. **Sudden high volume on a new domain.** A domain that sends 500 emails on day 3 will be flagged immediately. Google's filters detect the jump.

2. **Robotic consistency.** Sending exactly N emails at exactly 9:00 AM every day. Both Gmail and Microsoft track sending pattern variance. Human senders are inconsistent; bot senders are precise.

3. **Image-only emails during warmup.** Heavy HTML/image content during the warmup period signals marketing automation. Plain text only for weeks 1-2 is best practice.

4. **No plaintext MIME part.** All emails should include both `text/plain` and `text/html` MIME parts (multipart/alternative). Image-only or HTML-only sends fail spam heuristics on multiple older filters.

5. **Detecting automated warmup tool signatures.** Google's machine learning has been trained on warmup tool behavior. Cloud-infrastructure-based warmup openers generate detectable patterns (repetitive engagement, formulaic templates). This has reportedly led some operators to see deliverability degradation from aggressive warmup.

6. **Unicode obfuscation tricks.** Using lookalike Unicode characters to evade keyword filters (e.g., using Cyrillic characters that look like Latin letters) — flagged by modern content classifiers.

7. **ALL-CAPS subject lines.** Spam signal; not unique to warmup but affects all cold sends.

Sources: https://mailivery.io/blog/email-warmup-guide, https://litemail.ai/blog/does-email-warmup-work-2026

**What Smartlead's bundled warmup does:**

Smartlead's warmup runs on a peer-to-peer seed network where warmup emails are sent to real Workspace/Gmail/Outlook inboxes that automatically engage (open, reply, move from spam). The warmup schedule:

| Week | Daily warmup volume |
|------|---------------------|
| 1-2 | 5-20 emails/day |
| 3-4 | 20-40 emails/day |
| 5-6 | 40-80 emails/day (cold sends begin in small quantities here) |

Smartlead also offers "SmartDelivery" — a pre-send seed inbox test that routes your exact email through seed addresses at Gmail, Outlook, and Yahoo to report inbox vs spam placement before launch.

Smartlead's warmup continues running in parallel with live campaigns indefinitely. This is the correct pattern — warmup is not a one-time phase. Disabling it after launch is cited as a cause of deliverability erosion within 6-8 weeks.

Source: https://www.smartlead.ai/blog/email-deliverability-guide

[UNVERIFIED: Whether Smartlead's specific warmup seed network uses real human inboxes or partially automated openers on cloud infrastructure. Recent third-party testing (Postbox Services, cited in litemail.ai article) found that some warmup tools using automated cloud openers produced no measurable improvement. Smartlead's peer-to-peer network design is meant to avoid this, but independent verification of their current infrastructure quality is not available in this research pass.]

---

## Architecture Validation Summary

Our existing architecture decisions (D1-D16 from the brief) are validated by this research:

| Decision | Validation status |
|----------|------------------|
| Resend for transactional only on `notify.lazerlending.com` | Confirmed compliant |
| 0.08% complaint ceiling on Resend sends | Confirmed (matches AUP exactly) |
| Wilson lower-bound watchdog at 0.1% per mailbox | Confirmed appropriate buffer |
| `p=none` for 4-6 weeks → `p=quarantine` | Confirmed per operator consensus |
| Stateless HMAC for list-unsub tokens | Confirmed correct approach |
| Both List-Unsubscribe and List-Unsubscribe-Post headers | Confirmed RFC 8058 requirement |
| Body unsubscribe link retained alongside RFC 8058 headers | Confirmed required |
| Idempotent unsubscribe endpoint (no error on double-POST) | Confirmed; return 200 |
| No redirect from unsubscribe endpoint | Confirmed RFC 8058 hard requirement |
| SPF + DKIM both required (not either-or) | Confirmed as of Nov 2025 Gmail enforcement |
| Smartlead warmup runs permanently alongside campaigns | Confirmed best practice |
| Postmaster Tools set up on each burner domain day 1 | Confirmed required |

**One gap found:** Our PLAN.md does not explicitly specify that the DKIM signature's `h=` tag must cover `list-unsubscribe` and `list-unsubscribe-post`. This needs to be added as a verification checklist item in v1.SC3 (raw MIME inspection).

---

## Items Flagged for Human Verification Before v1 Launch

1. **JMRP registration accessibility for Workspace-based senders.** Need to confirm whether Microsoft's Junk Mail Reporting Program is registerable for senders using Google Workspace accounts via Smartlead (rather than dedicated IPs).

2. **SNDS registration for Workspace senders.** Confirm whether SNDS monitoring applies to our flow or only to dedicated-IP senders.

3. **One-click unsubscribe enforcement level at Gmail post-November 2025.** Current evidence suggests spam-folder (not 5xx) for unsubscribe non-compliance. Treat as rejection-grade in implementation anyway.

4. **Smartlead warmup seed network quality.** Verify whether Smartlead's warmup infrastructure uses genuine peer-to-peer real inboxes vs. partially automated cloud openers. This affects the credibility of the reputation signals generated.

5. **Resend AUP for forwarding hostile reply bodies.** Confirmed as permitted in this research (internal team recipients), but recommend running past Resend support once the account is provisioned for explicit acknowledgment.

6. **Token TTL of 2 years for list-unsub.** No authoritative source confirms this; it is operator consensus only. CAN-SPAM mandates 30 days minimum.

---

## Sources

- [Resend Acceptable Use Policy](https://resend.com/legal/acceptable-use)
- [Resend Pricing](https://resend.com/pricing)
- [Resend — Is it better to send from a subdomain?](https://resend.com/docs/knowledge-base/is-it-better-to-send-emails-from-a-subdomain-or-the-root-domain)
- [Resend — Implementing DMARC](https://resend.com/docs/dashboard/domains/dmarc)
- [Resend — How DMARC Applies to Subdomains](https://resend.com/blog/how-dmarc-applies-to-subdomains)
- [DMARC setup for Resend — dmarc.wiki](https://dmarc.wiki/resend)
- [RFC 8058 — rfc-editor.org (authoritative)](https://www.rfc-editor.org/rfc/rfc8058.html)
- [RFC 8058 — IETF datatracker](https://datatracker.ietf.org/doc/html/rfc8058)
- [Gmail one-click unsubscribe RFC 8058 — CaptainDNS](https://www.captaindns.com/en/blog/gmail-one-click-unsubscribe-rfc8058)
- [RFC 8058 — SMTPedia](https://smtpedia.com/rfc-8058/)
- [Gmail Email Sender Guidelines — Google Workspace Admin Help](https://support.google.com/a/answer/81126?hl=en)
- [Gmail Email Sender Guidelines FAQ](https://support.google.com/a/answer/14229414?hl=en)
- [Gmail November 2025 compliance updates — Suped](https://www.suped.com/blog/new-gmail-bulk-sender-compliance-updates-november-2025)
- [Gmail enforcement email rejection — PowerDMARC](https://powerdmarc.com/gmail-enforcement-email-rejection/)
- [Google's November 2025 DMARC Crackdown — Ironscales](https://ironscales.com/blog/googles-november-2025-dmarc-crackdown-what-security-and-marketing-leaders-need-to-know)
- [Gmail enforcement 2025 — PowerDMARC](https://powerdmarc.com/gmail-enforcement-email-rejection/)
- [Outlook New Requirements for High-Volume Senders — Microsoft TechCommunity (official)](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730)
- [Microsoft Outlook sender requirements 2025 — Mailgun](https://www.mailgun.com/blog/deliverability/microsoft-sender-requirements/)
- [Microsoft Outlook DMARC enforcement 2025 — dmarcwise](https://dmarcwise.io/blog/outlook-new-requirements-2025)
- [Yahoo Sender Hub — best practices (official)](https://senders.yahooinc.com/best-practices/)
- [2026 bulk sender requirements checklist — Redsift](https://redsift.com/guides/bulk-email-sender-requirements)
- [Gmail and Yahoo bulk sender requirements 2026 — emailwarmup.com](https://emailwarmup.com/blog/email-deliverability/gmail-and-yahoo-bulk-sender-requirements/)
- [Google Postmaster Tools 2025 — Iterable](https://iterable.com/blog/everything-you-need-to-know-about-google-postmaster-tools-for-2025/)
- [Google Postmaster Tools tutorial 2026 — Mailtrap](https://mailtrap.io/blog/google-postmaster-tools/)
- [DMARC enforcement timeline — DMARC Report](https://dmarcreport.com/blog/dmarc-enforcement-timeline-none-to-reject-roadmap/)
- [DMARC policy none to reject guide — DMARC Report](https://dmarcreport.com/blog/dmarc-policy-none-quarantine-reject-guide/)
- [Smartlead email deliverability guide](https://www.smartlead.ai/blog/email-deliverability-guide)
- [Smartlead email warmup guide](https://www.smartlead.ai/blog/email-warm-up-guide)
- [Email warmup best practices 2026 — Mailivery](https://mailivery.io/blog/email-warmup-guide)
- [Does email warmup work in 2026 — Litemail](https://litemail.ai/blog/does-email-warmup-work-2026)
