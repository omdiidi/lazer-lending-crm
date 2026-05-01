# Data Model

> All TypeScript entity types, their relationships, enums, and the mock data that seeds them.

**Status:** Active
**Last Updated:** 2026-03-22
**Related Docs:** [OVERVIEW.md](./OVERVIEW.md) | [state-management.md](./state-management.md)

---

## Overview

The CRM's data model is defined in a single types file (`src/types/crm.ts`) and seeded by a single mock data file (`src/data/mockData.ts`). The **Lead** entity is the central node — Deals, Activities, Emails, Suggestions, and Campaigns all reference it. There is no backend schema or database; these types define the entire shape of the application's data.

**Database:** These types now map to real PostgreSQL tables in Supabase. Database columns use snake_case; TypeScript uses camelCase. See [schema.md](./schema.md) for full column definitions, constraints, and RLS policies.

---

## File Map

| File | Purpose |
|------|---------|
| `src/types/crm.ts` | All TypeScript interfaces and type aliases |
| `src/data/mockData.ts` | Mock data arrays for all entities + credentials |

---

## Entity Reference

### User

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;       // 'admin' | 'employee'
  avatar?: string;      // Optional avatar URL (unused in mock data)
  emailPrefix?: string;  // CRM outbound email prefix (editable in Settings)
}
```

**Relationships:** Referenced by Lead.assignedTo, Activity.userId, Deal.assignedTo, EmailSequence.createdBy, Campaign.sentBy

### Lead

```typescript
interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  company: string;
  companySize: string;     // e.g., "51-200", "1001-5000"
  industry: string;
  location: string;
  status: LeadStatus;      // 'cold' | 'lukewarm' | 'warm' | 'dead'
  assignedTo: string;      // User.id
  createdAt: string;       // ISO datetime
  lastContactedAt: string | null;
  notes: string;
  tags: string[];
  linkedinUrl?: string;
  emailStatus: 'verified' | 'likely_to_engage' | 'guessed' | 'extrapolated' | 'unverified' | 'invalid';
}
```

**Relationships:** Central entity. Referenced by Activity.leadId, Deal.leadId, EmailMessage.leadId, AISuggestion.leadId, Campaign.recipientIds[]

### Activity

```typescript
interface Activity {
  id: string;
  leadId: string;          // Lead.id
  userId: string;          // User.id (who performed the action)
  type: ActivityType;      // 'call' | 'email_sent' | 'email_received' | 'note' | 'status_change' | 'meeting'
  description: string;
  timestamp: string;       // ISO datetime
  metadata?: Record<string, string>;  // Optional key-value pairs
}
```

### EmailMessage

```typescript
interface EmailMessage {
  id: string;
  leadId?: string;         // Lead.id (optional — some emails have no lead)
  from: string;            // Email address
  to: string;              // Email address
  subject: string;
  body: string;
  sentAt: string;          // ISO datetime
  read: boolean;
  direction: 'inbound' | 'outbound';
  threadId?: string;       // Groups emails into threads
  replyToId?: string;      // Links to parent email in thread
}
```

### Deal

```typescript
interface Deal {
  id: string;
  leadId: string;          // Lead.id
  title: string;
  value: number;           // Dollar amount
  stage: DealStage;        // 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost'
  assignedTo: string;      // User.id
  createdAt: string;       // ISO datetime
  updatedAt: string;       // ISO datetime
}
```

### EmailSequence

```typescript
interface EmailSequence {
  id: string;
  name: string;
  steps: SequenceStep[];
  createdBy: string;       // User.id
  active: boolean;
}

interface SequenceStep {
  id: string;
  order: number;
  subject: string;
  body: string;
  delayDays: number;       // Days to wait before sending
}
```

### AISuggestion

```typescript
interface AISuggestion {
  id: string;
  leadId: string;          // Lead.id
  suggestion: string;      // Human-readable action item
  priority: 'high' | 'medium' | 'low';
  createdAt: string;       // ISO datetime
  dismissed: boolean;
}
```

### Campaign

```typescript
interface Campaign {
  id: string;
  subject: string;
  body: string;
  recipientIds: string[];  // Lead.id[]
  sentAt: string;          // ISO datetime
  sentBy: string;          // User.id
}
```

---

## Enum / Union Types

| Type | Values |
|------|--------|
| `UserRole` | `'admin'` \| `'employee'` |
| `LeadStatus` | `'cold'` \| `'lukewarm'` \| `'warm'` \| `'dead'` |
| `DealStage` | `'new'` \| `'contacted'` \| `'qualified'` \| `'proposal'` \| `'negotiation'` \| `'closed_won'` \| `'closed_lost'` |
| `ActivityType` | `'call'` \| `'email_sent'` \| `'email_received'` \| `'note'` \| `'status_change'` \| `'meeting'` |

---

## Entity Relationship Diagram

```
User
 ├──< Lead.assignedTo
 ├──< Activity.userId
 ├──< Deal.assignedTo
 ├──< EmailSequence.createdBy
 └──< Campaign.sentBy

Lead (CENTRAL ENTITY)
 ├──< Activity.leadId
 ├──< Deal.leadId
 ├──< EmailMessage.leadId (optional)
 ├──< AISuggestion.leadId
 └──< Campaign.recipientIds[]

EmailMessage
 ├── threadId → groups into threads
 └── replyToId → links to parent message

EmailSequence
 └──< SequenceStep (nested array)
```

---

## Mock Data Inventory

### mockUsers (3 records)

| ID | Name | Email | Role |
|----|------|-------|------|
| `u1` | Sarah Chen | sarah@integrateapi.ai | admin |
| `u2` | Marcus Rivera | marcus@integrateapi.ai | employee |
| `u3` | Aisha Patel | aisha@integrateapi.ai | employee |

### mockCredentials (3 records)

| Email | Password | User ID |
|-------|----------|---------|
| sarah@integrateapi.ai | admin123 | u1 |
| marcus@integrateapi.ai | employee123 | u2 |
| aisha@integrateapi.ai | employee123 | u3 |

### mockLeads (22 records)
- Statuses: mix of cold, lukewarm, warm, dead
- Industries: 20+ unique (SaaS, Healthcare, Logistics, VC, AI/ML, Fintech, etc.)
- Assigned to: u2 and u3 only (no leads assigned to admin)
- Company sizes: range from "1-10" to "5001-10000"
- Locations: primarily US cities, one UK entry
- Date range: created Nov 2025 – Mar 2026

### mockActivities (15 records)
- Types: call, email_sent, email_received, note, status_change
- All linked to specific leads
- Timestamps: March 2026

### mockEmails (18 records)
- 8 threads (t1–t8)
- Direction: mix of inbound/outbound
- Threading via `threadId` and `replyToId` fields
- Topics: enterprise pricing, demos, integrations, compliance, SOC2, HIPAA, IoT
- Some emails have no associated lead (e.g., Apollo.io support email)

### mockDeals (10 records)
- Values: $12,000 – $72,000
- Stages: all 7 stages represented
- Assigned to: u2 and u3
- Created: Feb–Mar 2026

### mockSuggestions (8 records)
- Priorities: high, medium, low
- AI-generated action items (pre-written, not computed)
- All undismissed by default

### mockSequences (2 records)
- "Cold Outreach — SaaS CTOs" (3 steps, delays: 0/3/5 days)
- "Demo Follow-up Sequence" (2 steps, delays: 0/2 days)
- Support template variables: `{{firstName}}`, `{{company}}`

### mockCampaigns (2 records)
- "Introducing IntegrateAPI" (6 recipients, sent Mar 15)
- "Q1 Product Update" (7 recipients, sent Mar 20)

---

## Known Limitations & TODOs

- No `deletedAt` or soft-delete field on any entity
- No `updatedAt` on Lead (only `lastContactedAt`)
- `companySize` is a string, not a number range — inconsistent for filtering/sorting
- `EmailMessage.leadId` is optional — some emails float without a lead association
- No entity for "Contact" separate from "Lead"
- `Campaign` has no tracking fields (opens, clicks, bounces)
- `Deal` has no probability, expected close date, or loss reason

---

## Future Considerations

- When adding a database: these interfaces should map to database tables/collections. Consider adding `createdAt`/`updatedAt` to all entities.
- When adding an API: consider adding response wrappers (pagination, error types)
- `companySize` should become a structured type (min/max numbers) for proper filtering

---

## Changelog

| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-03-22 | Initial documentation created | — |
| 2026-03-22 | Types now backed by Supabase database tables | `src/types/database.ts` |
| 2026-03-23 | Added Lead.emailStatus and User.emailPrefix fields | `crm.ts` |
