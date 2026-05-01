**Lazer Lending CRM**

Product Requirements Document

**Owner:** Nick Pardon  **Company:** IntegrateAPI (build)  **Client:** Lazer Lending  **Status:** Draft v1

# **1\. Overview**

Lazer Lending needs a dedicated cold outreach CRM. This is a second CRM built specifically for running high-volume cold email campaigns, capturing replies, qualifying them, and piping warm leads into their main CRM (Follow Up Boss).

The build is based on Connect CRM, an existing project in my GitHub. Most of what this document describes extends or hardens what already exists in Connect CRM. The goal is to ship a Lazer-branded, Lazer-configured instance with significantly more robust deliverability, reply handling, and FUB integration than the base Connect CRM offers.

# **2\. Problem Statement**

Lazer runs cold outreach as their primary lead generation channel. They need a tool that does three things well:

1. Send cold campaigns at scale without torching their domain.

2. Capture, classify, and route replies to the right team member.

3. Push only qualified warm leads into Follow Up Boss, not every reply.

Off-the-shelf cold outreach tools either don't integrate with FUB the way Lazer wants, don't give enough control over domain and subdomain rotation, or aren't built to protect deliverability aggressively. Connect CRM covers the foundation. This project closes the gaps.

# **3\. Goals and Success Criteria**

## **v1 Ship Criteria**

* Lazer can warm 3 subdomains on lazerlending.com through a multi-week warmup process.

* Lazer can send a 100-email campaign from a warmed subdomain via Resend.

* Replies are captured and classified (positive, neutral, OOO, unsubscribe, negative).

* Positive replies auto-forward to a Lazer team email (configurable).

* Only qualified replies push to Follow Up Boss, with duplicate protection.

* Manual subdomain rotation works from a single button.

* ZeroBounce validates lists on upload and re-validates stale contacts before sending.

## **v2 Add-Ons**

* Seed inbox spam placement testing per campaign launch.

* Torched-root domain detection with automated alert and new-root onboarding flow.

* Automatic subdomain rotation triggered by spam placement or bounce thresholds.

## **Non-Goals**

* Not building a full Gmail/Outlook mailbox rotation stack. Sending is through Resend on rotating subdomains of a single root.

* Not building warmup from scratch if an integration gets us there faster. Build-vs-buy decision is open.

* Not designing for 10,000+ sends per day. Target ceiling is \~1,000/day.

# **4\. Volume Targets**

* Starting volume: \~100 sends per day.

* Target ceiling: \~1,000 sends per day.

* Subdomain pool at target: 3 to 5 warmed subdomains, hard-capped at 300/day each to leave reputation headroom.

# **5\. Core Features**

## **5.1 Subdomain Rotation**

All sending happens on rotating subdomains of lazerlending.com. Examples: mail.lazerlending.com, send.lazerlending.com, go.lazerlending.com.

* User can rotate the active sending subdomain with a one-click button.

* Each subdomain tracked individually: warmup state, daily send volume, reputation signals, cooldown status.

* Settings panel shows the full subdomain pool and lets the user add, remove, pause, or resume each.

* System knows subdomain rotation on a shared root only gives partial isolation. Root-level reputation is monitored separately (see 5.5).

## **5.2 Warmup**

Connect CRM has warmup logic built in. This project hardens it significantly. Any new subdomain must complete warmup before live campaigns can send from it.

Capabilities expected in the hardened warmup system:

* A real warmup network (not sending into a void). Real inbox delivery to Gmail, Outlook, Yahoo.

* Daily ramp schedule (e.g., day 1: 5 sends, day 2: 10, scaling to target over 2-4 weeks).

* Simulated engagement: opens, replies, marking as important, moving out of spam.

* Spam recovery actions if warmup mail lands in spam.

* Per-subdomain warmup state tracking with a hard block against live sending before the subdomain is ready.

* Ongoing low-volume warmup traffic even after a subdomain goes live, to maintain reputation.

Build-vs-buy: open decision. Building all of the above well is non-trivial. Integrating an external warmup service (Mailreach, Warmy, etc.) against each subdomain may be the faster and more reliable path. Claude Code will review Connect CRM's existing warmup implementation and propose a recommendation.

## **5.3 Email Validation (ZeroBounce)**

ZeroBounce gates contacts in two places:

* At list upload: bulk validate, drop invalids, disposables, catch-all fails, spam traps.

* Just-in-time before campaign send: re-validate any contact that hasn't been checked in over 60 days. Email validity decays over time.

* Activity score: use ZeroBounce activity data to prioritize sends to recently active addresses.

## **5.4 Spam Placement Checking**

Before each campaign blasts to the real list, the system sends a test copy to a set of seed inboxes that Lazer owns across Gmail, Outlook, and Yahoo. Then it checks where each test landed.

* Seed inbox list is configurable in settings.

* Check placement 2-3 minutes after send: inbox, promotions, or spam.

* If spam placement on 2 or more seeds: pause the campaign automatically, email Lazer's configured main address, recommend rotating to a different subdomain.

## **5.5 Torched Root Domain Detection**

When the entire lazerlending.com root is compromised, rotating subdomains won't save the situation. The system needs to recognize this state and tell Lazer to buy a new root domain.

Proposed trigger conditions (open for refinement):

* 3 or more subdomains on the same root show spam placement within the same 7-day window.

* Root-wide bounce rate exceeds 5% in any 7-day window.

* DMARC aggregate reports show persistent authentication failures.

* Any subdomain appears on a major blacklist (Spamhaus, SORBS, Barracuda).

On trigger:

* Pause all active campaigns.

* Surface a prominent warning banner in the CRM.

* Email Lazer's main address with the situation and required action.

* Provide a settings flow to input a new root domain and rebuild the subdomain pool under it.

* Keep a history log of burned roots for reference.

## **5.6 Reply Handling**

Every reply to any sending subdomain is captured, classified, and routed.

* Classification: positive interested, neutral, out-of-office, unsubscribe, negative.

* Classifier runs on each inbound reply. Likely an LLM call with a structured output.

* Auto-forward to a Lazer team email. Destination is a configurable field in settings.

* Per-campaign overrides so different campaigns can route replies to different team members.

## **5.7 Follow Up Boss Integration**

FUB is Lazer's main CRM. Only qualified warm leads go there.

* Only push to FUB after a positive reply. Do not dump every reply into FUB.

* Dedup check against FUB before pushing. No duplicate contacts.

* Configurable default pipeline and stage in FUB via settings.

* Open question: how do we handle neutral replies and OOO replies? Default assumption is neutral requires human tag before pushing, OOO never pushes. Final rule is TBD.

## **5.8 Sending Infrastructure**

* All sends go through Resend.

* Each subdomain is registered in Resend with its own DKIM, SPF, and DMARC records.

* The send layer abstracts subdomain selection away from the campaign builder.

* Per-subdomain throttling and daily caps enforced at the app level, not just the Resend level.

* Reply-to routing consolidates to monitored inboxes regardless of sending subdomain.

## **5.9 Settings Panel**

Single place where the user configures all operational knobs:

* Subdomain pool: list, status, daily cap, last used, warmup state.

* Current root domain, with ability to swap roots if the current is torched.

* Reply forwarding email (default and per-campaign overrides).

* FUB API connection, default pipeline, default stage.

* Seed inbox list for spam placement checks.

* Spam alert notification email (where torched-root and spam-hit alerts go).

* ZeroBounce API connection.

* Warmup target volumes per subdomain.

* Resend API connection.

# **6\. Phasing**

Exact phasing depends on what Claude Code finds in the Connect CRM audit. Preliminary plan:

## **Phase 0: Audit and Foundation**

* Pull Connect CRM, inventory what exists, flag gaps.

* Provision 3-5 subdomains on lazerlending.com with DKIM, SPF, DMARC.

* Register each with Resend and verify.

## **Phase 1: Send Layer**

* Subdomain pool UI: add, remove, pause, set caps.

* Rotation button that swaps active subdomain globally or per campaign.

* ZeroBounce at list upload and just-in-time before send.

* Bounce webhook handler and auto-suppression.

## **Phase 2: Warmup Hardening**

* Review Connect CRM's existing warmup, close gaps (or integrate external service).

* Per-subdomain warmup state and hard block on live sending until warm.

* Ongoing warmup traffic after going live.

## **Phase 3: Reply Handling and FUB**

* Inbound reply capture across all subdomains.

* Reply classifier.

* Auto-forward to configurable team email.

* FUB push on positive reply, with dedup check.

## **Phase 4: Spam Placement Monitoring**

* Seed inbox network setup.

* Per-campaign test send and placement check.

* Auto-pause and alert on spam hits.

## **Phase 5: Torched Root Detection and Auto Rotation**

* Trigger conditions and detection logic.

* Torched-root alert flow and new-root onboarding.

* Automatic subdomain rotation triggered by spam or bounce thresholds.

* Cooldown logic so burned subdomains rest before reuse.

# **7\. Open Questions**

4. What happens with neutral replies in FUB? Human-in-the-loop tag required, or different rule?

5. Build warmup in-house or integrate external warmup service?

6. Does Lazer already own candidate domains for the torched-root fallback, or do we buy fresh roots on trigger?

7. Who owns the seed inbox network? Lazer or the build team?

8. Are there specific Lazer compliance requirements beyond CAN-SPAM (state-level lending disclosures, licensing language in footers)?

9. What's the preferred rotation strategy: global rotation across all campaigns, or per-campaign subdomain assignment?

# **8\. Risks and Mitigations**

### **Resend policy on cold outreach**

Resend's acceptable use policy is not ideal for cold outreach. Volume and complaint thresholds could trigger suspension. Mitigation: aggressive deliverability hygiene (ZeroBounce, warmup, spam placement checks, torched-root detection). Acknowledged and accepted for v1.

### **Shared root reputation**

Subdomain rotation on a shared root only gives partial isolation. If the root is burned, all subdomains suffer. Mitigation: torched-root detection and new-root onboarding flow.

### **Warmup complexity**

Building a robust warmup network in-house is a significant effort. If Connect CRM's existing implementation falls short, the pragmatic path is external integration. Decision deferred pending Claude Code's audit.

### **FUB duplicate contacts**

Pushing without dedup creates a mess in Lazer's main CRM. Mitigation: required dedup check before any FUB push, with a clear resolution policy when a match is found.

# **Appendix A: Claude Code Build Prompt**

The following prompt is what gets handed to Claude Code to kick off the build. It's intentionally written in plain English, leaves room for discussion, and instructs Claude Code to ask questions, push back on decisions, and propose superior approaches.

## **Lazer Lending CRM \- Build Prompt**

### **Context**

We're building a second CRM for a company called Lazer Lending. This is a cold outreach stack. The primary use case is sending cold email campaigns at scale, capturing replies, qualifying them, and piping warm leads into the team's main CRM (Follow Up Boss).

This project is based on Connect CRM, which is an existing project of mine on my GitHub. Before doing anything, pull the Connect CRM repo and study it thoroughly. Understand the current architecture, the data models, the campaign system, the warmup logic that already exists, the sending layer, and the UI. Most of what we're building extends or hardens what's already there. Do not start building anything until you've read through the Connect CRM codebase and asked me clarifying questions about anything ambiguous.

### **How I want you to work**

Question me. Be critical of my decisions and ideas. If something I'm asking for is suboptimal, weird, redundant, or going to cause problems later, push back and tell me. Suggest better approaches when you see them. Don't just execute. Reason out loud, flag tradeoffs, and ask before making meaningful architectural decisions.

If you encounter a fork in the road where two paths are reasonable, stop and ask. If you see something in Connect CRM that conflicts with what I'm describing, point it out. If I'm asking you to reinvent something that already exists in the codebase or in a well-known service, tell me.

Always look for superior ways to solve a problem. If you've thought of three approaches and the one I asked for is the third best, say so and explain why.

### **What we're building**

**Core premise**

Lazer Lending sends cold outreach via Resend on rotating subdomains of lazerlending.com. When prospects reply, replies get classified, forwarded to the right Lazer team member, and positive replies get pushed into Follow Up Boss as warm leads. The system needs to protect domain reputation aggressively and warn Lazer the moment something starts going wrong.

**Subdomain rotation**

Sending happens from rotating subdomains on the lazerlending.com root. Things like mail.lazerlending.com, send.lazerlending.com, go.lazerlending.com. The user should be able to rotate the active sending subdomain with a single button click.

We'll start with a small pool of subdomains (probably 3-5) and grow as needed. Each subdomain needs to be tracked individually for its warmup state, daily send volume, reputation signals, and cooldown status.

I know subdomain rotation on a shared root only gives partial isolation. The root domain reputation still matters. That's why the torched-root flag below is important.

**Warmup, done well**

Connect CRM has warmup built in already, but I want it significantly more robust. The goal is that any new subdomain we add goes through a real, multi-week warmup before it's allowed to send live campaigns.

Read what exists in Connect CRM first. Then tell me what's missing compared to what a strong warmup system should do, and propose how to close those gaps. Things I care about: a real warmup network (not sending into a void), gradual daily volume ramp, simulated engagement signals like opens and replies, recovery actions if a warmup email lands in spam, per-subdomain warmup state tracking, a hard block preventing un-warmed subdomains from sending real campaigns, and ongoing low-volume warmup traffic even after a subdomain goes live.

Be careful with this part. Warmup is the difference between a working system and a torched domain. If you think the right call is to integrate an external warmup service rather than build it ourselves, say so and make the case.

**Email validation with ZeroBounce**

Use ZeroBounce in two places. First, at list upload. Bulk validate everything coming in, drop invalids, disposables, spam traps, and anything else clearly bad. Second, just-in-time before adding a contact to a new campaign if they haven't been validated recently (email validity decays over time, so re-validate stale contacts). Use ZeroBounce's activity scoring where it helps us prioritize.

**Spam placement checking**

Before each campaign goes out to the real list, the system should send a copy to a set of seed inboxes that we own across major providers (Gmail, Outlook, Yahoo). Then check where each test landed. Inbox, promotions, spam. If the placement is bad on multiple seeds, pause the campaign automatically, alert Lazer's main email address, and recommend rotating to a different subdomain.

The seed inbox list should be configurable in settings.

**Torched root domain detection**

The system needs to recognize when the entire root domain (not just one subdomain) is in trouble, because at that point rotating subdomains won't save us. We need a new root. Define clear trigger conditions for this flag. I'd suggest things like multiple subdomains showing spam placement in a short window, root-wide bounce rate spiking, the domain showing up on major blacklists, or DMARC aggregate reports indicating abuse. Propose better triggers if you have them.

When triggered, the system should pause all campaigns, surface a prominent warning in the CRM, email Lazer's main address with the situation, and give them a flow to input a new root domain and rebuild the subdomain pool under it. Keep a history of burned roots.

**Reply handling**

Every reply to any sending subdomain needs to be captured and classified. Classify into something like positive interested, neutral, out-of-office, unsubscribe, negative. Use the classification to drive what happens next.

Auto-forward replies to a Lazer team email. The destination email should be a configurable field in settings. The user picks where replies go. Allow per-campaign overrides so different campaigns can route to different team members.

**Follow Up Boss integration**

Only push contacts into Follow Up Boss after they've responded to a campaign. And only if the reply is positive or interested. Don't dump every reply into FUB. Check FUB for duplicates before pushing so we don't create dupes.

Confirm with me what should happen with neutral replies and out-of-office replies. I haven't decided. Push back if you think the rule should be different.

**Sending infrastructure**

Send through Resend. Each subdomain is registered in Resend with its own authentication records. The send layer needs to know which subdomain is currently active, throttle sends per subdomain, respect daily caps, and abstract this away from the campaign builder so users don't have to think about it.

Volume target: starting at around 100 sends per day, scaling up to roughly 1000 per day. Design with that ceiling in mind. We don't need infrastructure for 50k/day.

I know Resend's policies on cold outreach are not ideal. Don't worry about that for now. If you have strong concerns flag them once and move on.

**Settings panel**

The user should be able to configure all the operational knobs in one place. At minimum: the subdomain pool with status and daily caps, the reply forwarding email, the FUB API connection and default pipeline, the seed inbox list, the spam-alert notification email, the ZeroBounce connection, warmup target volumes, and the current root domain (with the ability to swap to a new root if the current one gets torched).

### **Phasing**

Don't try to build everything at once. Propose a phasing plan after you've read Connect CRM and we've talked through the open questions. My instinct is foundation and sending layer first, then warmup hardening, then reply handling and FUB sync, then spam monitoring, then torched-root detection. But I want your take on the right order based on what already exists in the codebase.

### **Before you start**

Pull the Connect CRM repo. Read it. Then come back with:

10. A summary of what Connect CRM currently does that's relevant here.

11. What already exists that we can use as-is.

12. What exists but needs to be hardened or reworked.

13. What needs to be built from scratch.

14. Anything in the codebase that conflicts with or complicates what I've described above.

15. Your top 5-10 questions for me before we proceed.

16. Anything you think I'm wrong about or should reconsider.

Don't write code yet. Don't make architectural decisions unilaterally. Ask first, propose second, build third.