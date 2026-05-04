# Warmup Capability Map

**Date:** 2026-05-01
**Version:** v1 (skeleton; finalized in Phase 0.3 vendor smoke-tests)
**Purpose.** Map PRD §5.2 warmup expectations to Smartlead's bundled warmup. This document closes the gap between "we built warmup" (PRD intent) and "we used Smartlead's bundled warmup" (plan reality), so Lazer can verify the original PRD outcomes are still satisfied.

PRD §5.2 was written before the architecture replaced subdomain warmup with burner-domain pools. The capability map below treats "subdomain" expectations as "per-mailbox" / "per-burner-domain" expectations — same operational meaning, different inventory shape. The architectural shift is captured in `PRD-AMENDMENT.md` and `BRIEF-email-architecture.md`.

## Mapping table

| PRD §5.2 expectation | Smartlead capability | Verification source | Coverage |
|---|---|---|---|
| Real warmup network — real inbox delivery to Gmail, Outlook, Yahoo (not sending into a void) | Smartlead Auto-warmup network of real mailboxes that exchange warmup mail | https://www.smartlead.ai/features/email-warmup ; https://helpcenter.smartlead.ai/en/articles/57-email-warm-up | ✓ Full |
| Daily ramp schedule (e.g., day 1: 5 sends, day 2: 10, scaling to target over 2–4 weeks) | Smartlead per-mailbox warmup config: `daily_ramp_value`, `total_warmup_per_day`, configurable ramp curve | https://helpcenter.smartlead.ai/en/articles/57-email-warm-up ; Smartlead API "Update warmup details" endpoint at https://api.smartlead.ai/ | ✓ Full |
| Simulated engagement: opens, replies, marking as important, moving out of spam | Smartlead Auto-warmup includes opens, replies, "important" marking, and spam-folder rescue | https://www.smartlead.ai/features/email-warmup ; https://helpcenter.smartlead.ai/en/articles/57-email-warm-up | ⚠ Partial — "marking as important" and "moving out of spam" are advertised; verify behavior in Phase 0.3 smoke-test (see procedure below). If genuinely missing, document in `PRD-AMENDMENT.md` |
| Spam recovery actions if warmup mail lands in spam | Smartlead's bundled warmup performs automated spam-folder retrieval ("auto move spam to inbox") | https://helpcenter.smartlead.ai/en/articles/57-email-warm-up | ⚠ Partial — verify behavior in Phase 0.3 by deliberately seeding a warmup recipient that scores low; confirm Smartlead's network rescues it from spam. If not, gap goes to `PRD-AMENDMENT.md` |
| Per-subdomain warmup state tracking with hard block against live sending before subdomain is ready | CRM-side state machine (`mailbox.warmup_state` ∈ {`provisioning`, `dns_pending`, `oauth_pending`, `verifying`, `warming`, `ready`}) gates `claimSendSlot`; Smartlead surfaces `warmup_status` and per-mailbox warmup metrics via API for the CRM to consume | `PLAN.md` §Domain & Mailbox State Machines + Smartlead API "Get mailboxes" endpoint at https://api.smartlead.ai/ | ✓ Full (hard block enforced CRM-side; Smartlead state is a signal, not the gate) |
| Ongoing low-volume warmup traffic after going live, to maintain reputation | Smartlead Auto-warmup runs continuously even on live mailboxes (configurable per-mailbox; recommended on indefinitely) | https://helpcenter.smartlead.ai/en/articles/57-email-warm-up | ✓ Full |

## Items requiring Phase 0.3 verification

For each `⚠ Partial` row above, run a Phase 0.3 smoke-test:

1. Provision one fresh Smartlead-managed mailbox via Mailforge. Connect to Smartlead. Enable Auto-warmup with default config.
2. Let it run for 7 days at default warmup volume.
3. Inspect:
   - The Smartlead warmup dashboard for the mailbox (counts of opens, replies, "marked important," spam-rescue events).
   - The Smartlead API response for `GET /campaigns/<id>/warmup-stats` — confirm engagement signals are reported.
   - A sample of warmup recipient mailboxes (Smartlead does not expose recipient inboxes directly, so this is observed via Smartlead's reported metrics, not user-side verification).
4. Document actual behavior in this file (replace ⚠ with ✓ or ✗).
5. If a Smartlead capability is genuinely missing (✗), document the gap in `PRD-AMENDMENT.md` and discuss with Lazer whether to:
   - (a) Accept the deviation (sign off the gap as commercially acceptable).
   - (b) Build a CRM-side compensator (e.g., custom engagement traffic from a small pool of CRM-controlled inboxes — high effort, fragile).
   - (c) Integrate a third-party warmup tool (Mailreach, Warmy, Lemwarm) on top of Smartlead. This adds $20–50/mailbox/mo and complicates the architecture; only justified if Smartlead's coverage is materially short.

## What this document is NOT

- Not a Smartlead reseller pitch. The PRD outcomes are the contract; Smartlead is the implementation choice.
- Not a Smartlead user manual. See Smartlead's docs for product details.
- Not a final mapping. This is a working document until Phase 0.3 verifications complete and the ⚠ rows resolve.

## Cross-references

- PRD original expectations: `PRD.md` §5.2
- Architecture rationale for using Smartlead's bundled warmup: `BRIEF-email-architecture.md` §Decision D2
- PRD amendment capturing the "subdomain → burner domain" semantic shift: `PRD-AMENDMENT.md`
- Smartlead reliability and AUP context: `tmp/research/2026-05-01-feasibility-validation.md` §Q1
