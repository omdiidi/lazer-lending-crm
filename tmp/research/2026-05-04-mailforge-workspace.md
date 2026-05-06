# Mailforge.ai & Google Workspace Cold Email Infrastructure Research

**Date:** 2026-05-04
**Scope:** Cold email send pool for Lazer Lending CRM — 10–17 mailboxes, 4–6 burner domains, 300–500/day v1 throughput via Smartlead.

---

## Executive Summary

Mailforge is **not a Google Workspace reseller**. It is a shared SMTP/IMAP infrastructure provider that runs its own proprietary mail servers. This is a material architectural difference from what the project plan assumed. Mailboxes are IMAP/SMTP credentials, not real GWS accounts; they cannot use "Sign in with Google" OAuth flows. Inbox placement benchmarks show 63% average for Mailforge vs 82% for real Google Workspace — a 19-point gap that compounds at mortgage lending lead quality expectations. Maildoso (quarterly SMTP) includes free domains and has better-rated deliverability but quarterly-only billing. Zapmail and Litemail offer real pre-warmed GWS/M365 on dedicated tenants with OAuth and API but cost $3.00–3.50/mailbox. For 10–17 mailboxes and 300–500/day, the plan's assumption of "$1.67/mailbox from Mailforge" should be revised: the real Mailforge price at this scale is **$3.00/mailbox/month** (minimum 10 slots). The $1.67 figure is a volume-tier estimate that does not apply at fewer than ~200 mailboxes.

---

## Section 1 — Pricing: Current as of May 2026

### Mailforge

Source: [mailforge.ai/pricing](https://www.mailforge.ai/pricing), [woodpecker.co/blog/mailforge-pricing](https://woodpecker.co/blog/mailforge-pricing/)

| Item | Cost |
|---|---|
| Mailbox slots (monthly billing) | $3.00/mailbox/month |
| Mailbox slots (annual billing) | $3.00/mailbox/month minus 2-months-free discount (~$2.50 effective) |
| .com domains | $14.00/year each |
| SSL & Domain Masking add-on | $2.00/month or $6.00/year per domain |
| Expert consulting | $500 for two 1:1 sessions (optional) |
| Minimum purchase | 10 mailbox slots |
| Warmup | NOT included; requires separate tool (e.g., Warmforge ~$30–50/month) |
| Setup fees | None |

**Lazer scenario math (13 mailboxes, 5 domains, annual billing):**

| Component | Cost |
|---|---|
| 13 mailbox slots × $2.50 (annual effective) | $32.50/month |
| 5 × $14/year domains | $5.83/month |
| SSL masking 5 domains × $0.50/month | $2.50/month |
| Warmup tool (separate) | ~$30–50/month |
| **Total** | **~$71–91/month** |

**Comparison to Google Workspace Business Starter retail ($7/seat/month):**
- 13 GWS seats = $91/month (does not include domain registration or DNS tools)
- Mailforge is comparable in raw mailbox cost but eliminates GWS overhead and DNS setup friction
- However, Mailforge is NOT real GWS — deliverability trade-off is significant (see Section 3)

**The "$1.67/mailbox" figure from the project plan** is a volume estimate cited in secondary comparisons for 200+ mailbox operations. At 10–17 mailboxes, the real price is $3.00/mailbox/month. **This is a budget assumption correction.**

Sources: [mailforge.ai/pricing](https://www.mailforge.ai/pricing), [woodpecker.co/blog/mailforge-pricing](https://woodpecker.co/blog/mailforge-pricing/), [prospeo.io Mailforge review](https://prospeo.io/s/mailforge-pricing-reviews-pros-and-cons)

---

## Section 2 — Provisioning Lifecycle

Source: [mailforge.ai](https://www.mailforge.ai/), [skywork.ai Mailforge hands-on](https://skywork.ai/skypage/en/Mailforge-Review-(2025)-My-Hands-On-Test-of-This-Cold-Email-Infrastructure-AI/1976556110033776640)

### API vs UI-Only

**Mailforge does not expose a documented public API for programmatic mailbox provisioning** at this time. The official homepage references a helpdesk but provides no API documentation links. The provisioning flow is UI-based. There is a reference to API/webhook support in aggregate tool comparisons, but no Mailforge help-center API docs have been located.

**Implication for Lazer CRM:** Automated domain/mailbox provisioning via code (the plan's `domains` + `mailboxes` state machine) cannot call a Mailforge API directly. Provisioning would be a manual UI step, with credentials then exported via CSV and imported into Smartlead and the CRM database. This is a gap in the original plan assumption.

**[unverified]** Whether Mailforge plans to release a provisioning API. No public roadmap found.

### DNS Auto-Configuration

Mailforge auto-configures: SPF, DKIM, DMARC, and custom tracking domain records. This is confirmed by both the official site and multiple third-party reviews. Users do not need to touch DNS panels manually.

Propagation time: not explicitly documented. Setup is described as "ready in under 10 minutes" for the Mailforge-side configuration, but DNS propagation itself (globally) typically takes 15 minutes to 48 hours depending on TTL and registrar.

### Lifecycle Hooks / Webhooks

No evidence of Mailforge sending webhooks on DNS propagation or mailbox-ready events. The plan's assumption of "lifecycle webhooks from Mailforge" should be flagged as **[unverified / likely unsupported]**. The CRM's domain state machine (`provisioning → dns_pending → oauth_pending → verifying → ready`) will likely need to poll or rely on manual state advances for the Mailforge lane.

### Smartlead Integration Method

**Confirmed as CSV export of IMAP/SMTP credentials, not OAuth.** From hands-on testing: "I set up my infrastructure in Mailforge, exported the CSV, and imported it directly into Smartlead." ([skywork.ai review](https://skywork.ai/skypage/en/Mailforge-Review-(2025)-My-Hands-On-Test-of-This-Cold-Email-Infrastructure-AI/1976556110033776640))

Mailforge uses SMTP/IMAP — there is no Google OAuth flow because these are not GWS accounts. The `oauth_pending` state in the CRM domain state machine does not apply to Mailforge mailboxes.

### Provisioning Timeline (End-to-End)

| Step | Time |
|---|---|
| Add domain + specify mailbox count in Mailforge UI | ~5 minutes |
| Mailforge auto-configures DNS on its own nameservers | Immediate if domain points to Mailforge NS |
| DNS propagation (if transferring/pointing external domain) | 15 min – 48 hours |
| Mailbox credentials available for CSV export | After DNS propagation confirms |
| Import CSV into Smartlead | ~5 minutes |
| Warmup period before live sends | 14–30 days minimum |
| **Total to first live send** | **~14–31 days** |

Sources: [mailforge.ai](https://www.mailforge.ai/), [skywork.ai review](https://skywork.ai/skypage/en/Mailforge-Review-(2025)-My-Hands-On-Test-of-This-Cold-Email-Infrastructure-AI/1976556110033776640), [prospeo.io review](https://prospeo.io/s/mailforge-pricing-reviews-pros-and-cons)

---

## Section 3 — Tenant / Workspace Org Model

Source: [inboxkit.com Mailforge review](https://www.inboxkit.com/learn/mailforge-review), [mailforge.ai homepage](https://www.mailforge.ai/)

### Critical Finding: Mailforge is NOT a Google Workspace Reseller

Mailforge's own homepage states: "Unlike Gmail or Outlook, Mailforge was created specifically for cold outreach" and describes itself as a "distributed email infrastructure tool" that "leverages a shared IP pool, distributing your mailbox accounts among millions of businesses."

This is confirmed by InboxKit's independent review: "Mailforge does not provision real Google Workspace or Microsoft 365 accounts. It creates accounts on shared sending infrastructure where multiple customers share the same IP addresses."

**Mailforge has no stated Google Workspace reseller relationship.** It is an independent SMTP infrastructure provider, not an authorized GWS channel partner.

### Shared Tenant Blast Radius

Because all Mailforge customers share IP address pools:
- One bad actor sending high-bounce or high-complaint campaigns degrades reputation for all mailboxes on those IPs
- You have no visibility into or control over co-tenants
- InboxKit measured: **63% inbox placement (Mailforge) vs 82% (real Google Workspace)** — a 19-point gap
- Spam rate: 23% on Mailforge vs 8% on real GWS
- Variability is high: 54–72% inbox range vs stable 80%+ on GWS

**For a mortgage lending cold campaign**, where lead quality depends on landing in the primary inbox (not spam), this deliverability gap is material. A 23% spam rate means roughly 1 in 4 emails never gets seen.

**[unverified]** Whether Mailforge has ever lost shared-IP ranges due to mass abuse events or had infrastructure-wide blacklistings. No documented incidents found in public forums, but the risk is structural.

Sources: [inboxkit.com](https://www.inboxkit.com/learn/mailforge-review), [mailforge.ai](https://www.mailforge.ai/), [prospeo.io](https://prospeo.io/s/mailforge-pricing-reviews-pros-and-cons)

---

## Section 4 — OAuth into Smartlead / Cold-Mail Orchestrators

Source: [helpcenter.smartlead.ai](https://helpcenter.smartlead.ai/en/articles/4-connect-gmail-with-smtp), [skywork.ai](https://skywork.ai/skypage/en/Mailforge-Review-(2025)-My-Hands-On-Test-of-This-Cold-Email-Infrastructure-AI/1976556110033776640)

### Integration Method

**Mailforge: IMAP/SMTP credentials only. No OAuth.**

The integration workflow is:
1. Export CSV from Mailforge dashboard (contains IMAP server, SMTP server, username, password per mailbox)
2. Import CSV into Smartlead's "Add Email Accounts" bulk import flow
3. Smartlead connects via standard IMAP (receive/replies) and SMTP (send)

There is no "Sign in with Google" OAuth consent screen because these are not GWS accounts. Smartlead's Gmail OAuth flow (which requires Google's Connected Apps approval) is irrelevant here.

### Consent Screen / Domain Mismatch Risk

Not applicable — no OAuth, no Google consent screen, no domain verification requirement at the Google level. Mailforge uses its own SMTP infrastructure with custom domain pointing.

### IMAP vs App Passwords

Google's deprecation of "Less Secure App" access (IMAP Basic Auth removed October 2023 for GWS) does not affect Mailforge because Mailforge is not GWS. Mailforge SMTP/IMAP uses its own authentication.

### Reply Capture

Smartlead's reply webhook will work: Smartlead monitors the connected IMAP mailboxes and fires the reply webhook when it detects an inbound message. This is the same mechanism regardless of GWS vs Mailforge.

Sources: [helpcenter.smartlead.ai](https://helpcenter.smartlead.ai/en/articles/4-connect-gmail-with-smtp), [skywork.ai review](https://skywork.ai/skypage/en/Mailforge-Review-(2025)-My-Hands-On-Test-of-This-Cold-Email-Infrastructure-AI/1976556110033776640)

---

## Section 5 — Failure and Rollback States

Source: [prospeo.io Mailforge review](https://prospeo.io/s/mailforge-pricing-reviews-pros-and-cons), [inboxkit.com](https://www.inboxkit.com/learn/mailforge-review)

### DNS Propagation Failure

**[unverified]** No documented Mailforge support process for DNS propagation failures. If a domain's NS records are not pointing to Mailforge's infrastructure, the mailbox simply doesn't function. Customer must re-check registrar settings. No automated detection or alert was documented.

### Google Domain Rejection

Not applicable — Mailforge is not a Google product. Google cannot "reject" a burner domain registered through Mailforge. However, Google's spam filters can blacklist the IP ranges that Mailforge uses, which would silently tank inbox placement without any explicit rejection notice.

### Mailbox Flagging

If a Mailforge mailbox is flagged by receiving ISPs for spam:
- The shared IP pool means other Mailforge users on the same IPs are collaterally affected
- Mailforge's documented response is "self-healing" via IP rotation — **[unverified]** whether this happens automatically or requires manual support ticket
- One Reddit report documented "500 sends with zero responses" and ~50% Gmail spam placement on Mailforge before the sender discovered the shared IP contamination

### Refund / Replacement Policy

Mailforge has no publicly documented refund policy. Trustpilot reviews mention "charges continuing after attempted cancellation, requiring direct support contact to resolve." No formal SLA or replacement guarantee was found.

**G2 rating:** 4.7/5 (81 reviews) — predominantly positive on setup ease and support responsiveness.
**Trustpilot:** 4.1/5 (15 reviews) — some billing friction complaints.

Sources: [prospeo.io](https://prospeo.io/s/mailforge-pricing-reviews-pros-and-cons), [inboxkit.com](https://www.inboxkit.com/learn/mailforge-review)

---

## Section 6 — Risks, Track Record, and Comparison

Source: [prospeo.io Google Workspace cold email](https://prospeo.io/s/google-workspace-cold-email), [salesforge.ai infrastructure tools](https://www.salesforge.ai/blog/cold-email-infrastructure-tools), [inboxkit.com](https://www.inboxkit.com/learn/mailforge-review)

### Has Mailforge Lost Google Reseller Status?

**Not applicable and not a relevant risk** — Mailforge is not a GWS reseller and never has been. The risk of losing GWS reseller status applies only to providers like Zapmail and Litemail who are actual GWS resellers.

### Mass Deplatforming / Sudden Price Changes

**No documented mass deplatforming of Mailforge.** Mailforge runs its own SMTP infrastructure, so a Google enforcement action against GWS-based providers does not affect Mailforge. However, major email blacklisting orgs (Spamhaus, Microsoft SNDS) can blacklist Mailforge IP ranges, which would affect all tenants.

**[unverified]** No confirmed reports of Mailforge-wide IP range blacklistings causing mass customer disruption. The risk exists structurally but has not been documented as an incident.

### Google Workspace Crackdowns (Late 2025)

This is the most significant contextual risk. Multiple sources confirm Google began cracking down on cold-email GWS accounts throughout late 2025:
- Entire tenants locked, not just individual inboxes
- Triggers included: high-volume sending patterns, shared tracking pixels, connections to known cold email platforms (Instantly, Smartlead, Zapmail)
- Workspace-level isolation (one domain per workspace) is the standard mitigation used by real GWS providers

**This crackdown does NOT directly affect Mailforge** because Mailforge is not GWS. However, it does affect the alternative providers (Zapmail, Litemail) that offer real GWS mailboxes.

### Deliverability Comparison

| Provider | Avg Inbox Rate | Avg Spam Rate | Infrastructure | Source |
|---|---|---|---|---|
| Real Google Workspace | ~82% | ~8% | Dedicated GWS tenant | [inboxkit.com](https://www.inboxkit.com/learn/mailforge-review) |
| Maildoso | Best-rated among shared-IP | ~15% est. | Shared SMTP + heavy IP rotation | [gmass.co](https://www.gmass.co/blog/best-cold-email-infrastructure/) |
| Mailforge | ~63% | ~23% | Shared SMTP (not GWS) | [inboxkit.com](https://www.inboxkit.com/learn/mailforge-review) |
| Mailscale | 95–100% claimed (warmup only) | Not disclosed | Shared SMTP | [salesforge.ai](https://www.salesforge.ai/blog/cold-email-infrastructure-tools) |

### Operator Reports

- G2: "Easy setup" repeated by multiple reviewers; support responsiveness praised — [prospeo.io](https://prospeo.io/s/mailforge-pricing-reviews-pros-and-cons)
- Reddit: One documented case of "500 sends, zero responses, 50% Gmail spam placement" — attributed to shared IP contamination — [prospeo.io](https://prospeo.io/s/mailforge-pricing-reviews-pros-and-cons)
- Trustpilot: Cancellation friction (charges after cancellation) — [prospeo.io](https://prospeo.io/s/mailforge-pricing-reviews-pros-and-cons)

---

## Section 7 — Burner Domain Registration

Source: [mailforge.ai/pricing](https://www.mailforge.ai/pricing), [woodpecker.co/blog/mailforge-pricing](https://woodpecker.co/blog/mailforge-pricing/), [skywork.ai](https://skywork.ai/skypage/en/Mailforge-Review-(2025)-My-Hands-On-Test-of-This-Cold-Email-Infrastructure-AI/1976556110033776640)

### Does Mailforge Include Domain Registration?

**No free domain inclusion.** Domains are purchased as an add-on at $14.00/year per .com domain within the Mailforge platform. Mailforge does handle the registration (registrar not disclosed), and DNS is auto-configured when the domain is bought through Mailforge.

This is the simplest path: buy the domain inside Mailforge, and DNS (SPF, DKIM, DMARC, MX) is auto-configured without any manual panel work.

### Registering Separately (Cloudflare, Porkbun, Namecheap)

Integration friction if using an external registrar:
1. Register domain at Cloudflare/Porkbun/Namecheap
2. Point domain nameservers to Mailforge's NS records (or add Mailforge's DNS records manually at the registrar)
3. Mailforge then manages the mail-specific records

The Mailforge platform supports "Domain Transferring" and adding externally registered domains. Specific friction level (NS delegation vs individual record import) is **[unverified]** from official documentation.

**Recommendation for Lazer:** Buy .com burner domains directly through Mailforge ($14/year) to eliminate DNS integration friction and ensure auto-configuration. For domains that need Cloudflare proxy features (CDN, DDoS protection), the integration path would require pointing NS to Mailforge first, which removes Cloudflare proxy capability. Since burner domains are send-only (no web traffic), this is not a limitation.

**Domain naming for Lazer-affiliated burners** (e.g., `lazer-loans.com`, `getlazerlending.com`, `lazermortgage.com`): availability check should be done at registration time. $14/year per domain through Mailforge vs $9–12/year at Cloudflare/Porkbun — modest premium for integrated DNS management.

Sources: [mailforge.ai/pricing](https://www.mailforge.ai/pricing), [woodpecker.co/blog/mailforge-pricing](https://woodpecker.co/blog/mailforge-pricing/)

---

## Section 8 — Google Workspace-Specific Gotchas for Cold Mail in 2026

Source: [prospeo.io Google Workspace cold email](https://prospeo.io/s/google-workspace-cold-email), [litemail.ai warmup guide](https://litemail.ai/blog/google-workspace-pre-warmed-inboxes-b2b-cold-email), [smartlead.ai warmup guide](https://www.smartlead.ai/blog/email-warm-up-guide)

**Note:** This section covers GWS-specific issues, which are directly relevant if the project switches from Mailforge to a real GWS provider (Zapmail, Litemail). If staying on Mailforge (shared SMTP), the Google-specific policies do not apply at the infrastructure level but do apply to what Google's filters do to inbound mail from Mailforge IPs.

### Google's Stance on Bulk Sending from Workspace (2026)

- Google does not ban cold email from GWS but enforces strict compliance requirements
- Late 2025: Google began locking entire GWS tenants, not just individual mailboxes, for high-volume cold sending without proper authentication
- Triggers: high-volume patterns, shared tracking pixels, OAuth connections to Instantly/Smartlead/Zapmail (the platform connections themselves flagged accounts)
- Workspace-level isolation (one domain = one GWS org) is now the standard defense; providers that put multiple domains in one org are high-risk

### Postmaster Tools

- Google Postmaster Tools is a monitoring best practice, not a strict requirement
- Must be set up on every sending domain for real-time spam rate and domain reputation visibility
- Complaint thresholds (from verified source): maintain below **0.10%** spam rate; **0.30%** is the hard ceiling before automatic action
- These thresholds apply to what Gmail recipients mark as spam — they govern GWS account health regardless of whether you use Mailforge or a real GWS account

### IMAP/App Passwords vs OAuth (for real GWS accounts)

- Google deprecated Basic Auth (IMAP with username/password) for consumer Gmail and most GWS tenants by October 2023
- For real GWS mailboxes in 2026: OAuth 2.0 is required for Smartlead connection; app passwords may still work on some GWS admin configurations
- For Mailforge: not applicable (Mailforge is its own SMTP, not GWS)
- For Zapmail/Litemail (real GWS): OAuth is the correct connection method; they market this explicitly

### Warmup: Smartlead + GWS Compatibility

- Smartlead's built-in warmup network uses peer-to-peer engagement (real inboxes exchanging warm emails)
- This warmup pattern is compatible with GWS mailboxes
- Google may flag accounts connecting to known warmup/sequencer platforms (Smartlead, Instantly) — this was one of the late-2025 suspension triggers
- Standard mitigation: use separate warmup-specific credentials, or ensure warmup traffic looks organic (random timing, varied subjects, real reply behavior)
- Minimum warmup period before cold sends: **14 days absolute minimum; 30 days recommended** per industry consensus

Sources: [prospeo.io](https://prospeo.io/s/google-workspace-cold-email), [smartlead.ai warmup guide](https://www.smartlead.ai/blog/email-warm-up-guide), [litemail.ai](https://litemail.ai/blog/google-workspace-pre-warmed-inboxes-b2b-cold-email)

---

## Side-by-Side Provider Comparison

Sources: [mailforge.ai/pricing](https://www.mailforge.ai/pricing), [maildoso.ai/pricing](https://maildoso.ai/pricing), [salesforge.ai comparison](https://www.salesforge.ai/blog/cold-email-infrastructure-tools), [inboxkit.com](https://www.inboxkit.com/learn/mailforge-review), [outreachalmanac.com Zapmail](https://outreachalmanac.com/tools/zapmail/)

| Attribute | Mailforge | Maildoso | Mailscale | Direct GWS Retail | Zapmail (real GWS) |
|---|---|---|---|---|---|
| **Infrastructure type** | Shared SMTP (not GWS) | Shared SMTP + GWS combo tiers | Shared SMTP | Real Google Workspace | Real GWS, dedicated tenant per domain |
| **Price / mailbox (small scale)** | $3.00/mo | $2.50–3.10/mo (SMTP); combo $3.00/mo | $2.38–5.27/mo (tiered) | $7.00/mo | $3.00–3.50/mo |
| **Domain registration included?** | No ($14/year add-on) | Quarterly plans only (8–100 domains free); monthly plans need separate purchase at $12/year | $10–15/year (buy inside platform) | No (separate registrar) | No ($13/year add-on) |
| **Auto DNS (SPF, DKIM, DMARC)** | Yes | Yes | Yes | Manual (Google Admin) | Yes |
| **Billing frequency** | Monthly or annual | Monthly or quarterly | Monthly (tiered) | Monthly | Monthly or annual |
| **Minimum purchase** | 10 mailbox slots | 30 SMTP mailboxes (monthly) | 20 inboxes (~$99 tier) | 1 seat | 10 mailboxes ($39/mo Starter) |
| **Warmup included** | No (separate tool needed) | No (separate) | Yes (built-in) | No | Yes (pre-warmed at delivery) |
| **Smartlead integration** | CSV export → IMAP/SMTP import | CSV export → IMAP/SMTP import | CSV export → IMAP/SMTP | OAuth or App Password | OAuth (preferred); IMAP/SMTP also supported |
| **API for provisioning** | Not documented / likely UI-only | Not documented | Not documented | Google Admin API (complex) | Yes (documented) |
| **Lifecycle webhooks** | Not documented | Not documented | Not documented | No native webhooks | Not confirmed |
| **Deliverability (inbox rate)** | ~63% avg, high variability | Best-rated among shared-IP; ~75–80% est. | 95–100% claimed (warmup window only) | ~82% avg | ~80–85% est. (real GWS) |
| **Spam rate** | ~23% | ~15% est. | Not disclosed | ~8% | ~10% est. |
| **Tenant isolation** | Shared IP pool (all customers) | Shared IP + rotation | Shared IP pool | Dedicated GWS org | Dedicated GWS org per domain |
| **Blast radius if flagged** | Platform-wide IP reputation risk | Platform-wide but rotation mitigates | Platform-wide | Isolated to your org | Isolated to your domain-level workspace |
| **GWS crackdown risk (late 2025)** | Not affected (not GWS) | SMTP tier not affected; GWS combo tier affected | Not affected | High if multi-domain in one org | Medium (dedicated tenant mitigates) |
| **Refund policy** | Not documented | 30-day money-back guarantee | 14-day refund if <95% inbox (warmup) | Google standard | Not documented |
| **Track record** | G2 4.7/5; no mass suspension events found | Generally positive; quarterly billing friction | Positive reviews, newer entrant | Google's own infrastructure | Newer entrant; OAuth disconnect reports |
| **Cost (13 mailboxes, 5 domains, annual)** | ~$41/month + warmup tool | ~$75/month SMTP (30 mbx min) | ~$99/month (20 mbx tier) | ~$91/month | ~$65/month ($39 plan + extras) |

---

## Implementation Recommendations for Lazer Lending CRM

### Revised Recommendation: Consider Maildoso or Zapmail Over Mailforge

Given the research findings, the Lazer Lending use case (residential mortgage cold outreach — regulated industry, lead quality sensitive) should weight deliverability more heavily than raw cost. The 19-point inbox placement gap (63% Mailforge vs 82% real GWS) translates directly to fewer visible prospects and lower reply rates.

**Option A — Maildoso SMTP (lowest cost, proven):**
- 30 SMTP mailboxes/month = $75/month, includes IP rotation and self-healing
- Add $12/domain/year separately (5 domains = $5/month)
- Warmup: Smartlead's built-in warmup covers this
- Total: ~$80/month for 30 mailboxes (more than 13 needed; pay for headroom)
- Risk: still shared IP; no API provisioning; quarterly-billing option removes monthly flexibility

**Option B — Zapmail real GWS (best deliverability, API provisioning):**
- Starter $39/month for 10 mailboxes; Growth $99/month for 30 mailboxes
- Real Google Workspace, dedicated tenant per domain — near-zero blast radius
- API for programmatic provisioning — enables the CRM's domain state machine
- Pre-warmed at delivery; OAuth connection to Smartlead
- Add $13/domain/year (5 domains = $5.42/month)
- Total: $44–104/month depending on tier
- Risk: real GWS means subject to Google's late-2025 crackdown policies; requires complaint rate <0.10%

**Option C — Keep Mailforge (plan as-is, accept deliverability trade-off):**
- ~$41/month for 13 mailboxes + 5 domains (annual billing) + $30–50/month warmup tool
- Lowest cost
- IMAP/SMTP only — no OAuth, no API — manual provisioning steps only
- 63% inbox placement; 23% spam rate — acceptable if volume compensates
- The CRM's `oauth_pending` state does not apply; state machine needs adjustment

**Recommendation for Lazer v1:** Given the regulated-industry (mortgage lending) context and the emphasis on lead quality over raw volume, **Maildoso SMTP (Option A) or Zapmail (Option B) are preferable to Mailforge**. If budget is the primary constraint, Maildoso at $75/month is the best price-to-deliverability ratio with 30 included mailboxes (giving room to scale to 500/day with 17 active sending mailboxes).

---

## Potential Issues and Mitigations

| Issue | Severity | Mitigation |
|---|---|---|
| Mailforge $1.67/mailbox figure in plan is wrong for our scale | High | Correct budget to $3.00/mailbox; update PLAN.md cost floor |
| Mailforge has no public provisioning API | High | Manual CSV export workflow; CRM state machine needs manual-gate step, not automated Mailforge API call |
| Mailforge lifecycle webhooks do not exist | High | DNS propagation and mailbox-ready status must be polled or manually advanced in CRM |
| `oauth_pending` state in CRM domain state machine irrelevant for Mailforge | Medium | Remove or rename to `credentials_pending` for IMAP/SMTP providers |
| Mailforge warmup NOT included | Medium | Budget $30–50/month for Warmforge or use Smartlead's built-in warmup (verify Smartlead plan tier includes warmup) |
| Shared IP contamination tanking inbox placement | High | Switch to Maildoso or Zapmail; or accept and compensate with higher send volume + aggressive list validation |
| Google late-2025 crackdown on Smartlead-connected GWS accounts | High (if using real GWS) | Use workspace-level isolation (one domain per org); keep complaint rate below 0.10%; configure Postmaster Tools |
| Quarterly-only billing on Maildoso | Low | Commit to quarterly; treat as a sunk cost; switch providers if deliverability drops |
| No refund/replacement SLA from Mailforge | Medium | Maintain a spare mailbox slot buffer; rotate to replacement mailbox within 60 seconds per plan |

---

## Gaps and Limitations in This Research

1. **Mailforge provisioning API:** No public API documentation found. **[unverified]** Whether a private/partner API exists. Contact Mailforge sales to confirm before building the CRM provisioning flow.
2. **Mailforge lifecycle webhooks:** No documentation found. **[unverified]** — assume not supported until confirmed otherwise.
3. **Mailforge reseller status with Google:** Confirmed NOT a GWS reseller. The earlier plan language "Mailforge (Google Workspace bulk reseller)" is inaccurate and should be corrected.
4. **Maildoso GWS combo plan deliverability:** No independent inbox-placement benchmark found for Maildoso's GWS combo plans specifically (the $90/month 15+15 plan). The isolated-tenant claim needs independent verification.
5. **Zapmail suspension track record:** Newer entrant; limited long-term data. OAuth disconnect reports mentioned but not quantified.
6. **Smartlead warmup compatibility with shared SMTP:** Smartlead's warmup works best with real-mailbox-to-real-mailbox signals. Shared SMTP warmup effectiveness on Mailforge's infrastructure is not independently benchmarked.

---

## Version Information

- Mailforge pricing verified at [mailforge.ai/pricing](https://www.mailforge.ai/pricing) — May 2026
- Maildoso pricing verified at [maildoso.ai/pricing](https://maildoso.ai/pricing) — May 2026
- Google Workspace retail: $7/seat/month Business Starter ([workspace.google.com/pricing](https://workspace.google.com/pricing))
- Google sender guidelines (complaint thresholds) effective November 2025 enforcement: 0.10% target, 0.30% ceiling
- Zapmail pricing from [outreachalmanac.com/tools/zapmail](https://outreachalmanac.com/tools/zapmail/) — 2026 review

---

## Sources

- [Mailforge Pricing](https://www.mailforge.ai/pricing)
- [Mailforge Homepage](https://www.mailforge.ai/)
- [Woodpecker: Mailforge Pricing 2026](https://woodpecker.co/blog/mailforge-pricing/)
- [Prospeo: Mailforge Pricing, Reviews, Pros & Cons](https://prospeo.io/s/mailforge-pricing-reviews-pros-and-cons)
- [InboxKit: Mailforge Review 2026 — Shared IPs at Scale](https://www.inboxkit.com/learn/mailforge-review)
- [Skywork: Mailforge Hands-On Review 2025](https://skywork.ai/skypage/en/Mailforge-Review-(2025)-My-Hands-On-Test-of-This-Cold-Email-Infrastructure-AI/1976556110033776640)
- [Maildoso Pricing](https://maildoso.ai/pricing)
- [Maildeck: Cold Email Infrastructure Cost 2026 — 11 Providers](https://maildeck.co/blog/cold-email-infrastructure-cost-2026)
- [Salesforge: 5 Most Popular Cold Email Infrastructure Tools 2026](https://www.salesforge.ai/blog/cold-email-infrastructure-tools)
- [GMass: Best Cold Email Infrastructure Hands-On](https://www.gmass.co/blog/best-cold-email-infrastructure/)
- [Prospeo: Google Workspace Cold Email 2026](https://prospeo.io/s/google-workspace-cold-email)
- [Outreach Almanac: Zapmail Review 2026](https://outreachalmanac.com/tools/zapmail/)
- [Litemail: GWS Pre-Warmed Inboxes for B2B Cold Email 2026](https://litemail.ai/blog/google-workspace-pre-warmed-inboxes-b2b-cold-email)
- [Smartlead: Email Warmup Guide](https://www.smartlead.ai/blog/email-warm-up-guide)
- [Smartlead Helpcenter: Connect Gmail With SMTP](https://helpcenter.smartlead.ai/en/articles/4-connect-gmail-with-smtp)
- [Inframail: Cold Email Infrastructure Costs — 7 Platforms Compared](https://inframail.io/blog-detail/cold-email-infrastructure-costs-7-platforms-compared-2025)
