# COMPLIANCE.md — Lazer Lending CRM

**Source of truth for federal + state compliance posture.**
**Audience:** any future engineer, attorney, or Claude Code session.
**Status:** authoritative as of 2026-05-01. Supersedes any compliance language elsewhere in the repo.
**Cross-references:** [PLAN.md](./PLAN.md), [PRD.md](./PRD.md), [BRIEF-email-architecture.md](./BRIEF-email-architecture.md), and the underlying research at `tmp/research/2026-05-01-feasibility-validation.md` § Question 3.

---

## §1 Executive summary

Sending 100–300 cold residential mortgage solicitations per day without prior opt-in is federally legal under CAN-SPAM, but it triggers a layered regulatory stack — federal (CAN-SPAM, Reg Z, Reg N / MAP Rule, ECOA / Reg B, FCRA, SAFE Act / NMLS), state lending-advertising rules, and state anti-spam statutes — that demands a per-state-customized footer, defensible list provenance, and live operational controls. The Lazer Lending CRM must enforce these as system invariants. Compliance is not a setting; it is a launch gate.

**Top risk: California Business & Professions Code § 17529.5.** $1,000 per email strict-liability private right of action. $1M-per-incident cap. Plus attorney's fees. No proof of harm, no scienter, no reliance required. CAN-SPAM does not preempt it. Pacific Trial Attorneys and similar plaintiff firms send § 17529.5 demand letters at scale. California courts treat SPF / DKIM / DMARC failures as evidence of "deceptive header" — meaning any authentication failure on a California-addressed message is potential statutory exposure.

**Secondary risk: state AG redlining investigations on demographically skewed cold lists.** Reg B § 1002.4 prohibits redlining-by-marketing extended to the pre-application stage. The Fairway Independent Mortgage settlement (October 2024, $8.9M) turned on direct-mail concentration in majority-white neighborhoods — the same fact pattern applies to cold email lists from data brokers using ZIP-code or demographic-proxy filters. CFPB enforcement in 2025 has shifted toward intentional discrimination over disparate-impact theories; state AGs in California, New York, Illinois, Massachusetts, and Maryland are filling the gap with independent fair-lending enforcement.

**Mandatory pre-launch posture (non-negotiable):**

1. California mortgage-compliance counsel retained before the first production send. § 17529.5 exposure alone justifies this. See §10.
2. Every send produces a perfect SPF + DKIM + DMARC pass. Any auth failure on a California-addressed message is statutory § 17529.5 evidence. See §4.
3. Per-state compliance footer engine in production with at least 10 state variants (CA, NY, FL, NJ, TX, MA, MD, IL, AZ, CT) plus the federal floor. Implemented per Phase 1 Task 1.0c. See §8.
4. CCPA right-to-delete flow operational across all tables holding cold-list prospect data. The GLBA exemption from CCPA is data-level, not entity-level — pre-application prospect records are NOT GLBA-covered. Implemented per Phase 1 Task 1.0b. See §7.
5. Suppression list + 10-business-day opt-out honor + functioning unsubscribe URL on every send. See §2.
6. Reg N 24-month retention plus Reg B 25-month retention of selection criteria. See §2 and §6.
7. NMLS unique identifier in every cold email per SAFE Act and per state-specific lending-advertising rules. See §2 and §3.

**Hard launch gate (per [PLAN.md](./PLAN.md) § Phase 1 acceptance):** no production sends until List-Unsub headers are verified by raw-MIME inspection, DMARC RUA reports are flowing, the Wilson-lower-bound watchdog is tested, the per-state footer engine has `legal_approved=true` for each template, the suppression seed is imported, and authentication / RBAC is functional. Compliance counsel sign-off is required on copy and footers before each new campaign template.

---

## §2 Federal compliance

### CAN-SPAM Act (15 U.S.C. § 7701 et seq.)

CAN-SPAM is the federal floor for commercial email. It does not require opt-in; it does require honest sender identification, a working opt-out, and a valid physical address.

- **§ 5(a)(1) sender identification — 15 U.S.C. § 7704** ([statute](https://www.law.cornell.edu/uscode/text/15/7704)). Header information is "materially misleading" only if (a) the originating address was obtained by fraud, or (b) the message was relayed to obscure its origin. Sending from `lazer-loans.com` with display name "Lazer Lending" does not violate § 5(a)(1) provided the domain is registered to or authorized by Lazer and no relay-masking is used. Burner-domain pooling per [BRIEF-email-architecture.md](./BRIEF-email-architecture.md) is permissible because each burner is registered to Lazer (or to IntegrateAPI with a written agency agreement — to be confirmed via Open Question OQ1 in [PLAN.md](./PLAN.md)).
- **§ 5(a)(3)–(5) mandatory content.** Every message must include: a functioning opt-out mechanism, a valid physical postal address, identification as an advertisement or solicitation, and a clear opt-out notice. The opt-out URL must remain live for at least 30 days after the send.
- **§ 7704(a)(4) opt-out honor window.** Opt-out requests must be honored within 10 business days. There has been no 2024 amendment narrowing this window.
- **Per-violation civil penalty: $53,088 as of January 2024** ([FTC compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)). Earlier internal docs that cite $51,744 are one inflation cycle stale.
- **No 2024 amendments to CAN-SPAM.** The last substantive FTC rule update was 2017 ([16 CFR Part 316](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-316)). The Google and Yahoo February 2024 sender requirements are platform policies, not statute.

System obligations to satisfy CAN-SPAM:

- `suppressions` table is the system-of-record for opt-outs. Inserts on (a) classified `unsubscribe` reply, (b) RFC 8058 one-click unsubscribe POST, (c) hard bounce, (d) manual operator action.
- `sends.opt_out_url_live_until` is at least `sends.sent_at + 30 days`.
- The suppression list must carry source-campaign and source-send references so opt-out proof is portable across domain rotations. Per Phase 1 Task 1.6 (suppression schema) and the audit's "suppression-list portable as proof" finding.
- 10-business-day honor is enforced by the dispatcher: any `claimSendSlot` execution must check suppression before reserving a mailbox slot. Per the `claimSendSlot` pseudocode in [PLAN.md](./PLAN.md).

### Regulation Z § 1026.24 — trigger terms

Reg Z applies to closed-end consumer credit advertising including cold email ([CFPB regulation](https://www.consumerfinance.gov/rules-policy/regulations/1026/24/)). If a cold email mentions any specific rate, monthly payment, down payment, term, or finance charge, the message must disclose the APR, all payment amounts, and any rate-change risk. A non-numeric pitch ("let's talk about refinancing your home") does not trigger Reg Z. Specificity activates the disclosure.

System obligation: the campaign editor flags any numeric pattern matching common rate, payment, or term shapes (regex on `\d+(\.\d+)?%`, `\$\d+`, `\d+ years`, `\d+\s*pts`) and requires `reg_z_disclosure=true` plus a footer block containing the APR + payment-history disclosure before the campaign can be marked `legal_approved=true`.

### Regulation N / MAP Rule (12 CFR Part 1014)

Reg N prohibits material misrepresentation in any commercial communication regarding mortgage credit ([eCFR](https://www.law.cornell.edu/cfr/text/12/part-1014)). 19 prohibited categories cover misrepresentations of interest rate, payment amount, fees, government affiliation, lender identity, type of mortgage, and similar material facts.

- **Record retention: 24 months from the date of last dissemination** (12 CFR § 1014.5). Every commercial communication including email body, footer, list-source records, and approval records must be preserved.
- **CFPB civil penalties: up to $1M per day for reckless violations.** 2023–2026 enforcement examples: RMK Financial (Feb 2023, $1M for MAP Rule + FTC Act violations); NewDay USA (Aug 2024, misleading marketing to veterans); Fairway Independent Mortgage (Oct 2024, $8.9M for redlining via direct-mail concentration).

System obligations:

- `sends`, `campaigns`, `campaign_steps`, `templates`, and `webhook_events` tables retain rows for at least 24 months. Soft-delete only; hard-delete is reserved for CCPA right-to-delete responses. Per Phase 1 Task 1.6 and the deletion audit-log requirement in §7.
- Every campaign template carries a `legal_approved_by`, `legal_approved_at`, and `legal_approval_notes` field. No campaign can leave `draft` state without `legal_approved=true`.

### FCRA + Homebuyers Privacy Protection Act (HBPPA)

The Homebuyers Privacy Protection Act became effective March 5, 2026 ([H.R. 2808](https://www.congress.gov/bill/119th-congress/house-bill/2808)). It is **narrowly scoped** — it restricts only consumer-reporting-agency-sold trigger leads (lists derived from credit-bureau mortgage inquiry triggers). It does NOT restrict cold email from commercial data-broker lists that are not derived from credit-bureau triggers.

System obligation: `lead.source` must capture data-broker identity and selection criteria. Lazer's procurement team must obtain a written representation from each data broker that the list is not derived from CRA prescreening triggers. If any lead's source is CRA prescreening, the FCRA prescreened-solicitation regime applies — 15 U.S.C. § 1681b plus 12 CFR § 1022.54: "firm offer of credit" obligation, mandatory short and long opt-out notices, and electronic-format proximity rules. This is captured in Open Question OQ-data-broker-source in [PLAN.md](./PLAN.md).

### FCRA prescreening — what the email looks like if the list IS CRA-sourced

If Lazer ever sends to a CRA-prescreening-derived list, the message body and footer must include both the "firm offer of credit" plus FCRA short notice (in the message body, with prominent placement) and the FCRA long notice with telephone-and-email opt-out elements. FCRA prescreened solicitations include the FCRA-mandated short-notice opt-out elements; the toll-free opt-out number provided by FCRA's central system is 1-888-5-OPT-OUT (888-567-8688) per 15 U.S.C. § 1681m(d)(2)(A)(ii) — verify currency with counsel. The notice must also include the consumer-reporting-agency identification. The electronic-format proximity rules require that the short notice precedes the long notice and that both appear before any solicitation content. The CRM must support an FCRA-mode footer template that swaps the entire footer assembly when `lead.source = 'cra_prescreen'` — this is a separate template family from the state-based footer engine in §8 and overrides it. Counsel review is required before any CRA-sourced campaign sends. Best posture for v1: avoid CRA-sourced lists entirely. This eliminates HBPPA exposure (post-March 2026) and FCRA prescreening exposure in one decision.

### SAFE Act / NMLS baseline

The SAFE Act and Regulation G require all federally-registered and state-licensed mortgage loan originators to include the NMLS unique identifier on "all advertisements and public communications" including email ([NCUA SAFE Act guidance](https://ncua.gov/regulation-supervision/manuals-guides/federal-consumer-financial-protection-guide/compliance-management/lending-regulations/secure-and-fair-enforcement-mortgage-licensing-act-safe-act-regulation-g)).

- **"Initial written communication" rule** ([CFPB SAFE Act exam procedures](https://files.consumerfinance.gov/f/201203_cfpb_update_SAFE_Act_Exam_Procedures.pdf)): cold email is an initial written communication and must include the MLO's NMLS unique identifier.
- **No NMLS-approved national template exists** ([Luthor compliance summary](https://www.luthor.ai/blog-post/nmls-advertising-requirements)). Each footer must be custom-assembled from the federal SAFE Act floor, the recipient state's advertising rules, and any Reg Z / Reg N obligations.

System obligation: company NMLS ID and per-MLO NMLS ID are required fields in `mailboxes` and `users`. Footer assembly fails closed if either is missing.

### Equal Housing Opportunity

The Equal Housing Opportunity logo or text statement is not a strict email mandate but is HUD examination evidence of fair-lending compliance ([ActiveComply EHO summary](https://www.activecomply.com/socialshield-features/equal-housing-logo-detection)). Omission is treated as a fair-lending posture flag in any examination.

System obligation: the EHO line is part of the federal floor footer (see §8). It is not optional.

---

## §3 State-by-state compliance table

The 10 states below cover the highest-volume residential mortgage markets and the highest-risk enforcement jurisdictions. The table is alphabetical. Each row identifies the controlling statute, the email-specific requirement, the penalty regime, and the citation. The per-state footer addition is detailed in §8.

| State | Statute | Requirement specific to email solicitation | Penalty | Source |
|---|---|---|---|---|
| **Arizona** | A.R.S. § 6-903 | NMLS unique identifier required (SAFE Act baseline). No additional Arizona-specific email rule found. | AZDFI civil fines, license action | [Arizona Revised Statutes](https://www.azleg.gov/arsDetail/?title=6) |
| **California** | Bus. & Prof. Code § 17529.5; Bus. & Prof. Code § 10140.6(b) and 10 CCR § 2773 (DRE-licensed brokers) | Strict-liability anti-spam statute (see §4). DRE license number required in first-point-of-contact materials. DFPI parallel obligation for DFPI-licensed lenders. | $1,000 per email strict liability + $1M cap + attorney's fees ($17529.5); license action ($10140.6) | [§ 17529.5](https://law.justia.com/codes/california/code-bpc/division-7/part-3/chapter-1/article-1-8/section-17529-5/), [§ 10140.6](https://law.justia.com/codes/california/code-bpc/division-4/chapter-3/article-2/section-10140-6/) |
| **Connecticut** | Conn. Gen. Stat. § 53-451 et seq. | Private right of action for false transmission information in commercial email. Anti-deception provisions survive CAN-SPAM preemption. | $500 per email + attorney's fees | [Conn. Gen. Stat. Title 53](https://www.cga.ct.gov/current/pub/title_53.htm) |
| **Florida** | Chapter 494, Fla. Stat. + Rule 69V-40, F.A.C. | NMLS ID + Florida Office of Financial Regulation license number required in advertising materials. **§ 501.059 (cited in earlier audit drafts) governs telephone and SMS, NOT email.** Mortgage email is governed by Chapter 494. | OFR license action; civil fines up to $10,000 per violation | [Chapter 494](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0400-0499/0494/0494.html), [Rule 69V-40](https://www.flrules.org/gateway/division.asp?DivID=234) |
| **Illinois** | 815 ILCS 511 (Electronic Mail Act) | AG enforcement; mirrors CAN-SPAM with additional injunction power. **No private right of action at $1k/email** (unlike California). | AG civil enforcement, injunction | [815 ILCS 511](https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=2068) |
| **Maryland** | Commercial Law § 14-3001 et seq. | Prohibits third-party domain misuse and false header information. Recipient private right of action for false transmission information. Anti-deception provisions survive CAN-SPAM preemption. | $500 per email + attorney's fees | [Md. Comm. Law § 14-3001](https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=14-3001) |
| **Massachusetts** | 209 CMR 42.00 | State license type and number required in all advertisements (e.g., "Massachusetts Mortgage Broker License #MB12345"). State license, NOT just NMLS ID. | Division of Banks license action | [209 CMR 42.00](https://www.mass.gov/regulations/209-CMR-4200-the-licensing-of-mortgage-lenders-and-mortgage-brokers) |
| **New Jersey** | N.J.S.A. 17:11C-72 | NMLS unique identifier required "in conspicuous manner" on **all solicitations and advertisements** including electronic communications. Clearest state-level email mandate of any covered state. | License action | [N.J.S.A. 17:11C-72](https://law.justia.com/codes/new-jersey/2023/title-17/chapter-11c/section-17-11c-72/) |
| **New York** | N.Y. Banking Law Article 12-D + 3 NYCRR Part 38.2 | "Registered Mortgage Broker — NYS Department of Financial Services" legend required on all advertisements, plus a New York office street address. **NY GBL § 369-aa (cited in earlier audit drafts) does not appear in current codification** — Banking Law Article 12-D is the controlling authority. | DFS license revocation, civil fines | [Banking Law Article 12-D](https://www.dfs.ny.gov/apps_and_licensing/mortgage_loan_originators), [3 NYCRR Part 38](https://govt.westlaw.com/nycrr/Browse/Home/NewYork/NewYorkCodesRulesandRegulations?guid=I2bf9f6c0b43411dda0a4e17826ebc834) |
| **Texas** | 7 TAC §§ 81.1 et seq. (effective January 1, 2025) | Company name plus NMLS ID in all correspondence. **Minimum 12-point font.** No obscuring graphics behind disclosure text. | Department of Savings and Mortgage Lending license action, civil fines | [7 TAC Chapter 81](https://texreg.sos.state.tx.us/public/readtac$ext.ViewTAC?tac_view=4&ti=7&pt=4&ch=81) |

State-by-state takeaways:

- **California is the only state in this set with a $1,000-per-email strict-liability private right of action.** Other anti-deception statutes (Maryland, Connecticut) carry $500-per-email private rights of action. Illinois has AG enforcement only.
- **New Jersey is the most explicit state-level email mandate** (N.J.S.A. 17:11C-72: https://law.justia.com/codes/new-jersey/2013/title-17/section-17-11c-72) — NMLS ID on every solicitation, conspicuous placement, no exceptions for "informal" communications.
- **Texas 7 TAC § 81.1 carries formatting specificity** (https://www.sml.texas.gov/wp-content/uploads/2024/11/2024MID-4-New-Rule-Update-Mortgage-Industry-Day-11-04-2024.pdf) — 12-point font minimum makes HTML email templates non-trivial; the per-state footer engine must enforce this in the rendered MIME output, not just the source HTML.
- **Massachusetts requires state license type and number in addition to NMLS ID** (209 CMR 42.00: https://www.mass.gov/regulations/209-CMR-4200-licensing-of-mortgage-lenders-and-mortgage-brokers). Generic NMLS-only footers fail in MA.
- **Florida and New York citations are corrections to earlier audit drafts.** See §11 of the underlying research at `tmp/research/2026-05-01-feasibility-validation.md` § Q3.

States not listed above (the other 40) still require the federal floor (CAN-SPAM + SAFE Act NMLS ID + Reg Z disclosures where applicable + EHO). Lazer's compliance counsel should confirm coverage scope as part of the licensing decision in OQ-state-licensing-scope.

### Anti-deception preemption survival

CAN-SPAM § 8(b)(1) preempts state laws that "expressly regulate the use of electronic mail to send commercial messages, except to the extent that any such statute, regulation, or rule prohibits falsity or deception in any portion of a commercial electronic mail message or information attached thereto." Every state statute in the table above has been drafted, amended, or interpreted to fit within this falsity-or-deception carve-out. The practical consequence is that anti-deception state law is enforceable in addition to CAN-SPAM, not in place of it. A single send into a five-state recipient pool can produce concurrent CAN-SPAM, California § 17529.5, Maryland § 14-3001, Connecticut § 53-451, and applicable state lending-advertising violations.

### Per-state state-licensing decision (OQ-state-licensing-scope)

Lazer must decide whether to seek state mortgage broker / lender licensure in all 50 states, in a regional subset, or only in the states where Lazer currently has a physical presence. The decision drives:

- Which states' lending-advertising rules apply to Lazer's footers (§3 table).
- Which states' license-disclosure requirements need to be present in the per-state footer engine (§8).
- The pacing of state-by-state coverage expansion in the campaign editor.

Counsel input on this decision is required pre-launch. The footer engine ships with the 10 states above; expansion to additional states requires counsel review of each state's specific advertising rule.

---

## §4 California § 17529.5 deep dive

California Business & Professions Code § 17529.5 is the highest-probability enforcement vector against the Lazer Lending CRM. It is a strict-liability anti-spam statute with a private right of action that is actively litigated by professional plaintiff firms.

### Statutory mechanics

- **$1,000 per email strict liability.** $1M-per-incident cap. Plus attorney's fees ([§ 17529.5 text](https://law.justia.com/codes/california/code-bpc/division-7/part-3/chapter-1/article-1-8/section-17529-5/)).
- **No proof of harm, no scienter, no reliance required.** A California recipient who can show that a covered email was sent to or from a California address is entitled to statutory damages.
- **CAN-SPAM does NOT preempt § 17529.5.** The federal preemption clause carves out state laws on falsity or deception, and § 17529.5 is anti-deception by design. This carve-out has been upheld in the Ninth Circuit and California state appellate courts.
- **Class actions are viable and actively litigated.** Pacific Trial Attorneys and similar plaintiff firms send § 17529.5 demand letters at scale ([Jeffer Mangels analysis](https://ada.jeffer.com/pacific-trial-attorneys-demand-letters-navigating-california-anti-spam-class-action-cases-under-business-professions-code-%C2%A7-17529-5/)).

### What California courts treat as a § 17529.5 violation

- **Authentication failure.** California courts treat SPF, DKIM, and DMARC failures as evidence of "deceptive header." Any auth failure on a California-addressed message is potential statutory exposure even when no other deception is alleged.
- **Misleading subject lines.** Subject lines that promise a specific outcome ("You're approved!", "Your rate is locked at 4.5%") without a basis are treated as deceptive.
- **From-name / from-domain mismatches that obscure sender identity.** The burner-domain architecture survives this analysis only because each burner is registered to or authorized by Lazer and the body identifies Lazer Lending as the sender. The from-name on every send must include a clear Lazer affiliation (see §8 footer template).

### Practical exposure math

At a 100/day send rate with a typical 5–15% California addressee fraction:

- 5–15 California recipients per day × $1,000 statutory damages = **$5,000–$15,000 per day in maximum theoretical exposure**.
- A 30-day class window: **$150,000–$450,000**.
- A 12-month window with a recurring fact pattern: into the seven figures, capped at $1M per incident.

The numbers are theoretical — courts apply the cap, defendants litigate the per-message theory, and not every recipient sues. But the order of magnitude justifies treating § 17529.5 as a launch-blocking risk, not a probabilistic one.

### Required mitigations

System invariants enforced before any California-addressed send:

1. **Perfect SPF + DKIM + DMARC pass on every send.** DMARC alignment in `pass` posture, not `none`. DKIM signature present, signed, and verified. Any failure in pre-send validation halts the send and routes to manual review. Per Phase 1 Task 1.12a (DMARC RUA flowing) in [PLAN.md](./PLAN.md).
2. **Conservative subject lines.** No outcome-promising language. The campaign editor flags subjects matching common deceptive patterns (`approved`, `guaranteed`, `locked`, `pre-qualified`, specific dollar amounts, specific rates) and requires manual override with `legal_approved=true`.
3. **CA-specific footer.** California recipients receive the federal floor footer plus the DRE license number (per BPC § 10140.6(b) and 10 CCR § 2773) and the DFPI license number (parallel obligation for DFPI-licensed lenders). Per the per-state footer engine (§8 and Phase 1 Task 1.0c).
4. **Per-recipient state lookup.** The footer engine reads `lead.address_state` and assembles dynamically. Missing or unknown state defaults to the most-restrictive footer (CA + NY + TX requirements stacked).
5. **California recipient flag + audit log.** Every send to a California address logs `compliance_jurisdiction='CA'` plus the resolved footer template version. Subpoena-ready.

Compliance counsel sign-off on every California-targeting campaign template is non-optional. See §10.

---

## §5 TCPA clarification

The Telephone Consumer Protection Act (TCPA) does NOT cover standalone email. It covers calls and texts only. Earlier audit drafts that flagged TCPA risk for cold email overstated the law.

The risk arises in **multi-channel sequences** — a cold email followed by a phone or SMS leg. The phone leg is independently TCPA-governed. Two TCPA points apply when Lazer adds phone follow-up to a sequence:

- **Post-FCC December 2023 "1:1 consent" rule.** Prior express written consent must name the specific lender, not blanket marketplace consent. A consent obtained via a lead-gen marketplace that names the marketplace (and not Lazer) is not valid TCPA consent for a Lazer call or SMS.
- **Recent mortgage TCPA cases (informational, not authority):**
  - *Andersen v. Nexa Mortgage* (CD Cal 2024) — dismissed.
  - *Sapan v. Shore Capital Mortgage* (CD Cal Aug 2024) — dismissed for insufficient agency allegation.
  - *Lamb v. Mortgage One* (ED Mich Feb 2026) — AI-voice cold-call class action, ongoing.
  - *US Mortgage Lenders TCPA settlement* — $244,800.

System scope: the v1 build is email-only. Phone and SMS are out of scope. If Lazer adds a phone leg in v2 or later, a separate TCPA review is required including consent capture, do-not-call list scrubbing (federal + state), and explicit 1:1 consent UX. This is captured as a future-scope guard, not a v1 requirement.

### Why "TCPA-by-extension" claims for email are wrong

Some compliance summaries assert that federal courts have "applied TCPA principles" to non-phone consumer financial product solicitations. This claim does not survive primary-source review. TCPA's scope is statutory and limited per its text to telephone calls and texts (47 U.S.C. § 227); courts have not extended it to standalone email. Multi-channel sequences mixing email and phone require independent TCPA analysis on the call leg. Email solicitations are governed by CAN-SPAM and state anti-spam statutes, not the TCPA. Earlier audit drafts that flagged TCPA risk for cold email conflated the multi-channel risk (email-then-call) with a single-channel risk that does not exist. Compliance counsel review on initial v1 launch should confirm this interpretation against any 2025–2026 case law developments, but the legal framework as of this writing is settled.

---

## §6 Reg B / ECOA fair-lending exposure

Equal Credit Opportunity Act and Reg B exposure on cold email is real and is the second-highest-probability enforcement risk after California § 17529.5.

### The 25-month retention rule

12 CFR § 1002.12 requires 25-month retention of all prescreened solicitation materials **including the criteria used to select recipients**. This is independent of and longer than the Reg N 24-month retention. Both apply.

System obligations:

- `lead.source` carries data-broker identity, list-acquisition date, and selection-criteria reference.
- `campaigns.targeting_criteria_snapshot` captures the exact filter applied to the source list (ZIP codes included, demographic filters, age brackets, homeowner status). Snapshot is immutable once a campaign sends its first message.
- `campaigns.geographic_coverage_map` records the state and ZIP-code distribution of the recipient set. Used in any disparate-impact analysis.
- All four artifacts retained 25 months minimum from the date of last dissemination.

### Reg B § 1002.4 — redlining-by-marketing

§ 1002.4 prohibits discouraging applicants on a prohibited basis. CFPB and state AGs have extended this to the pre-application stage — meaning marketing concentration patterns are reachable. The Fairway Independent Mortgage settlement (Oct 2024, $8.9M) turned on direct-mail concentration in majority-white areas. The same fact pattern applies to cold email lists from data brokers using ZIP-code or demographic-proxy filters.

### CFPB 2025 enforcement shift

CFPB enforcement in 2025 has emphasized intentional discrimination over disparate-impact theories. State AGs in California, New York, Illinois, Massachusetts, and Maryland have filled the gap with independent fair-lending enforcement. The state-AG vector is especially active for residential mortgage marketing because the data is discoverable in any consumer protection investigation.

### Required posture

Every artifact in the cold-email pipeline is potentially discoverable in a fair-lending investigation:

- The data broker contract Lazer signs to acquire the source list.
- The selection criteria Lazer applies to the broker list before importing.
- The ZIP-code and state distribution of the imported list.
- The campaign targeting filter that decides which leads receive which template.
- The send log showing which recipients actually received the message.
- The proxy-risk analysis Lazer performs on its broker list (does the filter correlate with race, ethnicity, national origin, sex, or familial status?).

Lazer must perform and document the proxy-risk analysis as part of every list import. The analysis is not optional and is a launch-gate item — see [PLAN.md](./PLAN.md) Phase 0 Task 0.5 (client kickoff) and the data-broker-source open question.

### Practical proxy-risk analysis checklist

For every imported list, Lazer's compliance officer (with counsel sign-off) produces a one-page memo addressing:

1. **Source.** Data broker name, contract date, contract reference. Broker representation that the list is not derived from CRA prescreening triggers (HBPPA carve-out check).
2. **Selection criteria as applied.** Exact filter: state(s), ZIP code list, age bracket, homeowner status, estimated income band, estimated home value band, mortgage status (current LTV, time since origination), credit-tier proxy if any.
3. **Geographic distribution.** ZIP-code-level recipient count. Heat map flag if any single ZIP exceeds 5% of the list and that ZIP is a Census-designated majority-minority area.
4. **Demographic-proxy review.** For each selection criterion: does the criterion correlate with race, ethnicity, national origin, sex, marital status, age, or familial status as protected under ECOA / Reg B?
5. **Disparate-impact baseline.** Census ACS data comparison: does the list's geographic distribution differ materially from the underlying population of the state(s) covered?
6. **Mitigation if disparate impact is detected.** Either re-import with broader criteria, document business necessity (with counsel sign-off), or skip the campaign.

The memo is retained alongside the list-import record for 25 months minimum. It is the single most defensible record Lazer can produce in any Reg B investigation.

---

## §7 CCPA right-to-delete

The audit's earlier guidance that GLBA exempts mortgage broker prospect records from CCPA was incorrect. The exemption is data-level, not entity-level — and pre-application prospect records fall outside the GLBA scope.

### The GLBA exemption is data-level, not entity-level

A mortgage broker is subject to GLBA, but not all of its data is GLBA-covered ([Greenberg Traurig analysis](https://www.gtlaw-dataprivacydish.com/2021/07/financial-institution-confusion-are-financial-institutions-fully-exempt-from-the-ccpa-cpra-vcdpa-and-cpa/)). GLBA's privacy requirements apply to nonpublic personal information of "consumers" — individuals who "obtain or have obtained" a financial product or service. A prospect who has never applied has not obtained anything and is not a GLBA "consumer" with respect to Lazer.

**Cold-list prospect records are likely NOT GLBA-covered and ARE subject to CCPA right-to-delete.** Once a prospect applies and submits NPI, that subset of their data becomes GLBA-covered. The CRM must distinguish the two states.

### CCPA mechanics

- **45-day response window** (extendable to 90 days with written notice). Cal. Civ. Code § 1798.105 (https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=1798.105.&lawCode=CIV).
- **Penalties:** $2,500 per unintentional violation, $7,500 per intentional violation, $7,500 for violations involving a minor's data. CPPA (California Privacy Protection Agency) can impose these administratively.

### System requirement (Phase 1 Task 1.0b)

The CCPA right-to-delete flow must locate and delete a recipient's data across all of:

- `leads`
- `sends`
- `replies`
- `conversations`
- `webhook_events`
- `audit_log` (preserve the deletion event itself; redact PII fields, retain non-PII fields)
- `suppressions` (special handling — see below)

**Suppression list special handling.** Deleting a suppression record would re-expose the recipient to future sends, which is a worse outcome for the recipient and a CAN-SPAM violation for Lazer. The CCPA flow must replace the suppression record's email address with a one-way HMAC of the address (using a stable system-wide salt) so future incoming email addresses can still be hashed and checked against the suppression list without retaining the cleartext address. This is a CCPA-compliant way to honor "deletion" while preserving the CAN-SPAM opt-out obligation. Compliance counsel should confirm the hash approach before launch.

**45-day SLA enforcement.** Each CCPA delete request creates a row in `ccpa_requests` with `received_at`, `due_at = received_at + 45 days`, and `completed_at`. A daily job alerts on rows with `due_at < now() AND completed_at IS NULL`. End-to-end test: a CCPA delete request submitted on day 0 results in deletion across all tables by day 45 with an audit-log entry preserved.

---

## §8 Default footer template + per-state additions

The footer is the single most-litigated element of a cold mortgage email. It must be assembled per recipient state, fail closed on missing inputs, and produce a verifiable raw-MIME output.

### Federal floor template

Every cold mortgage email — regardless of recipient state — includes:

```
[Company Legal Name] | NMLS# [Company NMLS ID]
[Individual MLO Name], NMLS# [Individual MLO ID]
[Physical street address of a licensed office]

This is an advertisement from a mortgage broker.
[If specific rate, payment, term, or finance-charge numbers appear above: insert Reg Z disclosure block — APR, all payment amounts, rate-change risk.]

Equal Housing Opportunity. [EHO logo or "Equal Housing Opportunity" text]

To unsubscribe, reply to this email or click here: [opt-out link]. We will honor your request within 10 business days.
Mailing address: [full physical address of a licensed office].
```

The footer engine layers per-state additions on top of this floor based on `lead.address_state`. Missing or unknown state defaults to the most-restrictive stack (CA + NY + TX).

### Per-state additions table

| Recipient state | Addition required | License-number format | Format / typography requirement | Source |
|---|---|---|---|---|
| **AZ** | None beyond federal floor | Company NMLS ID + MLO NMLS ID (federal) | Standard | A.R.S. § 6-903 |
| **CA** | DRE license number; DFPI license number if DFPI-licensed | "DRE License #XXXXXXXX" or "DFPI License #XXXX" | Visible in body or footer; first-point-of-contact | [BPC § 10140.6](https://law.justia.com/codes/california/code-bpc/division-4/chapter-3/article-2/section-10140-6/), 10 CCR § 2773 |
| **CT** | Connecticut state license | "Connecticut Mortgage Lender License #XXXXX" | Standard | Conn. Gen. Stat. § 53-451 et seq. |
| **FL** | Florida OFR license number | "FL OFR License #MLD-XXXX" | Standard | [Chapter 494, Fla. Stat.](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0400-0499/0494/0494.html) |
| **IL** | Illinois Residential Mortgage License | "Illinois Residential Mortgage Licensee #MB.XXXXX" | Standard | 815 ILCS 511 + IDFPR rules |
| **MA** | State license type AND number | "Massachusetts Mortgage Broker License #MB12345" or "Massachusetts Mortgage Lender License #ML12345" | Standard | [209 CMR 42.00](https://www.mass.gov/regulations/209-CMR-4200-the-licensing-of-mortgage-lenders-and-mortgage-brokers) |
| **MD** | Maryland license + private-right-of-action awareness | "Maryland Mortgage Lender License #XX-XXXX" | Standard | [Md. Comm. Law § 14-3001](https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=14-3001) |
| **NJ** | NMLS ID in conspicuous manner | Company NMLS ID + MLO NMLS ID, both prominent | "Conspicuous" — bolded or above-fold in footer | [N.J.S.A. 17:11C-72](https://law.justia.com/codes/new-jersey/2023/title-17/chapter-11c/section-17-11c-72/) |
| **NY** | "Registered Mortgage Broker — NYS Department of Financial Services" legend + NY office street address | Legend text + NMLS IDs + NY street address | Standard | [Banking Law Article 12-D](https://www.dfs.ny.gov/apps_and_licensing/mortgage_loan_originators), [3 NYCRR Part 38](https://govt.westlaw.com/nycrr/Browse/Home/NewYork/NewYorkCodesRulesandRegulations?guid=I2bf9f6c0b43411dda0a4e17826ebc834) |
| **TX** | Company name + NMLS ID, formatting strict | Company name + NMLS ID | **Minimum 12-point font, no obscuring graphics behind disclosure** | [7 TAC Chapter 81](https://texreg.sos.state.tx.us/public/readtac$ext.ViewTAC?tac_view=4&ti=7&pt=4&ch=81) (effective Jan 1, 2025) |

### Worked example — California recipient

Lazer sends to a recipient with `lead.address_state = 'CA'`. The footer engine assembles:

```
Lazer Lending LLC | NMLS# 1234567
Sam Smith, NMLS# 7654321
123 Main St., Suite 400, Phoenix, AZ 85001

This is an advertisement from a mortgage broker.

California DRE License #02123456
California DFPI License #60DBO-12345

Equal Housing Opportunity.

To unsubscribe, reply to this email or click here: https://lazer-loans.com/u/abc123
We will honor your request within 10 business days.
Mailing address: 123 Main St., Suite 400, Phoenix, AZ 85001.
```

The send is logged with `compliance_jurisdiction='CA'`, `footer_template_version='v1.3-ca'`, and the resolved footer hash is stored in `sends.footer_hash` for subpoena reproduction.

### System obligations (Phase 1 Task 1.0c)

- **Footer assembly is dynamic per recipient.** No static global footer.
- **Fail closed.** Missing company NMLS ID, missing MLO NMLS ID, missing physical address, or missing state-specific license number for a state in the table halts the send.
- **`legal_approved=true` per template per state.** Every footer template in production carries explicit compliance-counsel sign-off with `legal_approved_by`, `legal_approved_at`, and `legal_approval_notes`.
- **Raw-MIME verification at acceptance.** Phase 1 acceptance test: send to a test inbox per state (CA, NY, TX, NJ, FL) and inspect the raw MIME source. The state-specific addition must be present, the EHO line must be present, the unsub URL must be live, and the Texas test must measure at >= 12-point font in the rendered HTML.
- **Footer template versioning.** Every send records `sends.footer_template_version`. Bumps on any state-specific change. Subpoena-reproducible.
- **`COMPLIANCE_FOOTER_VERSION` env var.** Bumped on per-state footer template changes; logged in `audit_log` per send. Per [PLAN.md](./PLAN.md) env var schema.

---

## §9 Records needed for AG subpoena

Reg N 24-month retention plus Reg B 25-month retention plus state-specific record retention combine into the following minimum subpoena-readiness posture. The table lists the 10 records a state AG is most likely to demand in a residential mortgage cold-email investigation.

| # | Record demanded | Retention period | Current system support | Audit-log requirement |
|---|---|---|---|---|
| 1 | Complete sent log with timestamps, source IPs, message headers, raw MIME of representative sample | 24 months (Reg N) | `sends`, `webhook_events` | `sends.raw_mime_hash` for reproducibility |
| 2 | Source-list provenance — data-broker contract, selection criteria, list-acquisition date | 25 months (Reg B § 1002.12) | `leads.source`, `campaigns.targeting_criteria_snapshot` | Immutable snapshot at first send |
| 3 | Opt-out log + 10-business-day-honor evidence | 24 months (CAN-SPAM enforcement window) | `suppressions` with source-campaign and source-send refs | Per-suppression timestamp + source; honor-window check in dispatcher |
| 4 | Per-state license disclosure proof (footer present in headers/body) | 24 months (Reg N) | `sends.footer_template_version`, `sends.footer_hash` | Footer hash recoverable to plaintext via versioned template store |
| 5 | SPF / DKIM / DMARC config snapshots at time of send | 24 months (Reg N) | DNS snapshot per `domains.id` per quarter; DMARC RUA reports archived | DNS config diff log per domain |
| 6 | Prior-consent documents (if any consent was obtained) | 25 months minimum | `leads.consent_record_id` if applicable | Immutable consent-capture record |
| 7 | Campaign approval records (compliance-officer sign-off) | 25 months (Reg B) | `campaigns.legal_approved_by`, `legal_approved_at`, `legal_approval_notes` | Approval event written to `audit_log` |
| 8 | Bounce data + suppression confirmations | 24 months | `webhook_events` (bounce events), `suppressions` cascade entries | Bounce-cascade event in `audit_log` |
| 9 | Campaign-level templates + targeting criteria + total volume | 25 months (Reg B) | `campaign_steps`, `campaigns.targeting_criteria_snapshot`, send-count aggregates | Template-version diff log |
| 10 | FCRA prescreening compliance evidence (only if list is CRA-sourced) | 25 months | `leads.source = 'cra_prescreen'` triggers FCRA-mode footer + opt-out | Firm-offer-of-credit record per send |

**Indefinite retention exceptions.** Arkansas and Nevada require indefinite retention of advertising materials per state lending law. Lazer's posture should default to indefinite retention via soft-delete; hard-delete is reserved for CCPA right-to-delete responses (see §7).

**Subpoena response runbook.** Operations runbook ([OPS-RUNBOOK.md](./OPS-RUNBOOK.md), pending creation) carries the step-by-step procedure for producing the 10 records above within typical 30-day response windows.

---

## §10 Attorney engagement recommendation

California mortgage-compliance counsel retained pre-launch is non-optional. § 17529.5 strict-liability exposure alone justifies the engagement, independent of any other fact-specific risk. State-by-state license-disclosure penalties and ECOA cold-list exposure are also fact-specific and rapidly evolving.

### Suggested scope

The pre-launch engagement covers:

- Review of every cold-email template before first production send.
- Review of the per-state footer matrix (10 states minimum) and sign-off on each variant.
- Review of the data-broker procurement contract and the proxy-risk analysis on the imported list.
- Fair-lending list audit — geographic distribution, demographic-proxy review.
- Incident-response playbook — what to do if a § 17529.5 demand letter arrives, what to do if a state AG opens an investigation, what to do if the data broker is found to have used CRA prescreening triggers.
- Periodic review on a 6-month cadence and ad-hoc review for new campaign templates.

### Estimated cost

- **Initial review:** $5,000–$15,000 (range depends on scope and turnaround).
- **Ongoing retainer:** $1,000–$3,000 per month for periodic review, ad-hoc questions, and incident response.

Both line items are captured in [CHARGE-ABILITY.md](./CHARGE-ABILITY.md) (pending creation) as an unbudgeted client-side cost — IntegrateAPI does not absorb this; Lazer engages California counsel directly.

### Why this is non-negotiable

Three independent reasons:

1. **§ 17529.5 strict-liability exposure.** Even with perfect SPF / DKIM / DMARC, a single deceptive-subject-line allegation or a single misaligned authentication event on a California-addressed message creates statutory damages exposure. Counsel review of subject lines and authentication posture before each campaign template is the only defensible mitigation.
2. **State licensing disclosure variation.** The 10-state table in §3 covers only the highest-volume states. If Lazer wants 50-state coverage (Open Question OQ-state-licensing-scope), counsel must confirm each additional state's advertising rules. No automated source covers this; the regulatory landscape is too state-specific and too fast-moving.
3. **Fair-lending discoverability.** Every artifact captured for §9 subpoena readiness is also discoverable in a fair-lending investigation. A counsel-reviewed proxy-risk analysis on the data-broker list is the single most defensible record Lazer can produce in a Reg B investigation.

The engagement is a fixed line item in the v1 commercial structure. Ship date for first production send is gated on counsel sign-off.

### Counsel selection criteria

The engaged firm should satisfy all of the following:

- Active California bar admission and California consumer-protection / unfair-business-practice litigation experience (§ 17529.5 defense work specifically).
- Mortgage-vertical regulatory experience — CFPB, NMLS, state DRE / DFPI, NY DFS, MA Division of Banks, FL OFR, TX DSML.
- TCPA familiarity (for v2 multi-channel scope).
- Fair-lending / Reg B practice (redlining-by-marketing).
- Track record on cold-marketing matters; not exclusively inbound-leads or post-application practice.

Lazer's counsel selection happens during Phase 0 Task 0.5 (client kickoff). IntegrateAPI does not select Lazer's counsel. The retention agreement is between Lazer and the firm; IntegrateAPI receives counsel-approved templates and footers as inputs to the system.

---

## §11 Quick-reference compliance dashboard

The single-page reference. If a future engineer or operator needs one card to pin to the wall, this is it.

| Item | Threshold / value | Authority | Section |
|---|---|---|---|
| CAN-SPAM per-violation civil penalty | $53,088 | FTC Jan 2024 inflation adjustment | §2 |
| CAN-SPAM opt-out honor window | 10 business days | 15 U.S.C. § 7704(a)(4) | §2 |
| CAN-SPAM opt-out URL liveness floor | 30 days post-send | § 5(a) | §2 |
| Reg N record retention | 24 months from last dissemination | 12 CFR § 1014.5 | §2 |
| Reg B selection-criteria retention (prescreened) | 25 months | 12 CFR § 1002.12 | §6 |
| CFPB MAP Rule reckless-violation cap | $1M per day | 12 CFR Part 1014 | §2 |
| California § 17529.5 statutory damages | $1,000 per email; $1M per incident | Cal. Bus. & Prof. Code § 17529.5 | §4 |
| California typical recipient fraction (cold lists) | 5–15% | Empirical | §4 |
| Maryland § 14-3001 statutory damages | $500 per email + attorney's fees | Md. Comm. Law § 14-3001 | §3 |
| Connecticut § 53-451 statutory damages | $500 per email + attorney's fees | Conn. Gen. Stat. § 53-451 | §3 |
| CCPA delete-request response window | 45 days (extendable to 90) | Cal. Civ. Code § 1798.105 | §7 |
| CCPA penalty (intentional) | $7,500 per violation | CPPA enforcement | §7 |
| Texas footer minimum font | 12 point | 7 TAC § 81.1 (eff. Jan 1, 2025) | §3, §8 |
| HBPPA effective date | March 5, 2026 | H.R. 2808 | §2 |
| Gmail bulk-sender threshold | 5,000/day | Google Nov 2025 enforcement | §4 |
| Gmail complaint-rate ceiling | 0.3% | Google sender guidelines | §4 |
| Per-state footer variants in v1 | 10 minimum (CA, NY, FL, NJ, TX, MA, MD, IL, AZ, CT) | State lending advertising rules | §3, §8 |
| Compliance counsel initial review (Lazer cost) | $5,000–$15,000 | Market | §10 |
| Compliance counsel ongoing retainer (Lazer cost) | $1,000–$3,000 / mo | Market | §10 |

This dashboard is for orientation only. Authoritative thresholds and citations are in the body of this document.

---

## Appendix A — Source citations

All factual claims in this document are traceable to one of the following sources. The underlying research is at `tmp/research/2026-05-01-feasibility-validation.md` § Question 3.

- [15 U.S.C. § 7704 (CAN-SPAM)](https://www.law.cornell.edu/uscode/text/15/7704)
- [FTC CAN-SPAM Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [16 CFR Part 316 (CAN-SPAM regulations)](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-316)
- [12 CFR § 1026.24 (Reg Z trigger terms)](https://www.consumerfinance.gov/rules-policy/regulations/1026/24/)
- [12 CFR Part 1014 (Reg N / MAP Rule)](https://www.law.cornell.edu/cfr/text/12/part-1014)
- [HBPPA — H.R. 2808](https://www.congress.gov/bill/119th-congress/house-bill/2808)
- [SAFE Act / Reg G — NCUA](https://ncua.gov/regulation-supervision/manuals-guides/federal-consumer-financial-protection-guide/compliance-management/lending-regulations/secure-and-fair-enforcement-mortgage-licensing-act-safe-act-regulation-g)
- [CFPB SAFE Act Exam Procedures](https://files.consumerfinance.gov/f/201203_cfpb_update_SAFE_Act_Exam_Procedures.pdf)
- [Luthor — NMLS advertising requirements](https://www.luthor.ai/blog-post/nmls-advertising-requirements)
- [ActiveComply — EHO logo detection](https://www.activecomply.com/socialshield-features/equal-housing-logo-detection)
- [Cal. Bus. & Prof. Code § 17529.5](https://law.justia.com/codes/california/code-bpc/division-7/part-3/chapter-1/article-1-8/section-17529-5/)
- [Cal. Bus. & Prof. Code § 10140.6](https://law.justia.com/codes/california/code-bpc/division-4/chapter-3/article-2/section-10140-6/)
- [Pacific Trial Attorneys § 17529.5 demand letter analysis (Jeffer Mangels)](https://ada.jeffer.com/pacific-trial-attorneys-demand-letters-navigating-california-anti-spam-class-action-cases-under-business-professions-code-%C2%A7-17529-5/)
- [Florida Chapter 494, Fla. Stat.](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0400-0499/0494/0494.html)
- [Florida Rule 69V-40, F.A.C.](https://www.flrules.org/gateway/division.asp?DivID=234)
- [NY Banking Law Article 12-D — DFS](https://www.dfs.ny.gov/apps_and_licensing/mortgage_loan_originators)
- [3 NYCRR Part 38](https://govt.westlaw.com/nycrr/Browse/Home/NewYork/NewYorkCodesRulesandRegulations?guid=I2bf9f6c0b43411dda0a4e17826ebc834)
- [N.J.S.A. 17:11C-72](https://law.justia.com/codes/new-jersey/2023/title-17/chapter-11c/section-17-11c-72/)
- [Texas 7 TAC Chapter 81](https://texreg.sos.state.tx.us/public/readtac$ext.ViewTAC?tac_view=4&ti=7&pt=4&ch=81)
- [209 CMR 42.00 — Massachusetts Division of Banks](https://www.mass.gov/regulations/209-CMR-4200-the-licensing-of-mortgage-lenders-and-mortgage-brokers)
- [Md. Comm. Law § 14-3001](https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=14-3001)
- [815 ILCS 511 (Illinois Electronic Mail Act)](https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=2068)
- [Conn. Gen. Stat. Title 53](https://www.cga.ct.gov/current/pub/title_53.htm)
- [Arizona Revised Statutes Title 6](https://www.azleg.gov/arsDetail/?title=6)
- [Greenberg Traurig — GLBA / CCPA financial-institution analysis](https://www.gtlaw-dataprivacydish.com/2021/07/financial-institution-confusion-are-financial-institutions-fully-exempt-from-the-ccpa-cpra-vcdpa-and-cpa/)

---

## Appendix B — Audit corrections applied

This document corrects seven specific findings from the prior codex feasibility audit (`tmp/review-notes/2026-05-01-codex-feasibility-audit.md` § "Compliance & regulatory exposure"):

1. **Florida § 501.059 → Chapter 494 + Rule 69V-40.** § 501.059 governs telephone and SMS, not email. Mortgage email is governed by Chapter 494.
2. **NY GBL § 369-aa → NY Banking Law Article 12-D + 3 NYCRR Part 38.2.** § 369-aa does not appear in current NY codification.
3. **TCPA scope clarification.** TCPA covers calls and texts only; the risk applies to multi-channel sequences with phone follow-up, not standalone email. See §5.
4. **GLBA preemption of CCPA corrected.** GLBA exemption from CCPA is data-level, not entity-level. Pre-application prospect records are NOT GLBA-covered and ARE subject to CCPA right-to-delete. See §7.
5. **CAN-SPAM penalty $51,744 → $53,088.** Inflation adjustment as of January 2024.
6. **Sender-domain mismatch concern overstated.** Sending from `lazer-loans.com` for "Lazer Lending" is permissible if the domain is registered to or authorized by Lazer and no relay-masking is used. See §2.
7. **California § 17529.5 underweighted.** The audit prioritized federal CFPB enforcement; the higher-probability vector is the California $1,000-per-email private right of action. See §4.

---

## Appendix C — Cross-references to PLAN.md

The system obligations cited throughout this document map to the following Phase 1 tasks in [PLAN.md](./PLAN.md):

- **Task 1.0** (auth + RBAC) — gates campaign approval and CCPA delete-flow access.
- **Task 1.0a** (Connect CRM scaffold extension) — adds `lead.address_state`, `lead.source`, `campaigns.targeting_criteria_snapshot`, `campaigns.legal_approved_*`, `mailboxes.nmls_id`, `users.mlo_nmls_id`.
- **Task 1.0b** (CCPA right-to-delete flow) — implements §7 deletion machinery with 45-day SLA.
- **Task 1.0c** (per-state compliance footer engine) — implements §8 dynamic footer assembly with 10+ state variants.
- **Task 1.6** (suppression schema with portable proof) — implements §2 source-campaign and source-send references.
- **Task 1.9** (RFC 8058 List-Unsub headers) — implements §2 functioning opt-out plus the one-click unsubscribe required by Google November 2025 sender enforcement.
- **Task 1.11** (Wilson-lower-bound watchdog) — implements §1 and §4 launch-gate item.
- **Task 1.12a** (DMARC RUA aggregator) — implements §4 perfect-authentication mitigation.

The hard launch gate combining all of the above is the v1 ship criterion.
