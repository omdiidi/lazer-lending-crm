---
date: 2026-03-23T11:00:00-04:00
researcher: Claude
git_commit: 6d773b45923caaf817fa111ec16d68a8a8f188a6
branch: main
repository: connect-crm
topic: "What integrations/features can be wired up next, independent of Apollo?"
tags: [research, codebase, integrations, apollo, email, chatbots, campaigns]
status: complete
last_updated: 2026-03-23
last_updated_by: Claude
---

# Research: Integration Priorities — What to Wire Up Next

**Date**: 2026-03-23
**Git Commit**: 6d773b4
**Branch**: main

## Research Question
What connectors/functionality can be wired in? What's still mocked? What can be done in parallel before Apollo is finished?

## Summary

The app has a solid Supabase foundation (auth, 9 tables, RLS, React Query hooks). Three areas remain mocked/placeholder: **Apollo.io lead generation** (being handled), **email sending** (no real delivery), and **AI chatbots** (keyword matching, not LLM-powered). Several features can be built **completely independently** of Apollo.

## Current State — What's Real vs Still Mocked

| Feature | Status | Details |
|---------|--------|---------|
| Supabase Auth | Real ✅ | Login, session persistence, role-based access |
| CRM Data (Supabase) | Real ✅ | All 8 entities persisted via React Query hooks |
| RLS / Role Scoping | Real ✅ | Admin sees all, employee sees assigned-only |
| Lead Generator (Apollo) | Mocked ❌ | `fakeGeneratedLeads()` returns 5 hardcoded leads — **another agent handling** |
| Campaign AI Chat | Mocked ❌ | `parsePrompt()` in `CampaignAIChat.tsx` is keyword matching, not LLM |
| Email Sending | Mocked ❌ | Emails saved to DB but never actually delivered |
| Email Receiving | Mocked ❌ | No inbound email ingestion from real providers |
| Sequences Execution | Mocked ❌ | Read-only display, no scheduling/execution engine |
| Slack Integration | Placeholder ❌ | "Coming Soon" badge in Settings |
| Team Management | Placeholder ❌ | Add/delete buttons have no handlers |
| Profile Editing | Placeholder ❌ | Read-only fields |
| Deal Creation | Missing ❌ | No UI to create new deals |
| Realtime Subscriptions | Infra Ready, Not Wired ❌ | DB has realtime enabled on 4 tables, no client listeners |

## Features 100% Independent of Apollo

### 1. Campaign AI Chat → Wire to Claude API
- **Files**: `src/components/outreach/CampaignAIChat.tsx`
- **Current**: `parsePrompt()` (line 30-67) does regex keyword matching
- **To do**: Replace with Claude API call via Supabase Edge Function
- **Impact**: Makes the "AI" campaign creation actually intelligent
- **Complexity**: Medium — need edge function + frontend call

### 2. Email Sending via Resend/SendGrid
- **Files**: `src/pages/OutreachPage.tsx` (compose, reply, campaign send), `src/lib/api/emails.ts`
- **Current**: `addEmail()` saves to DB. No actual delivery.
- **To do**: Supabase Edge Function that calls Resend/SendGrid API, triggered after DB write
- **Impact**: Makes compose, reply, and campaigns actually send real emails
- **Complexity**: Medium — edge function + env config + trigger

### 3. Supabase Realtime Subscriptions
- **Infra**: Already enabled on `leads`, `deals`, `activities`, `emails` tables
- **Current**: No client-side listeners. Data refreshes only on mutation or manual refresh.
- **To do**: Add `supabase.channel().on()` listeners in React Query hooks to invalidate cache on DB changes
- **Impact**: Multi-user collaboration — changes from one user appear for others in real-time
- **Complexity**: Low — pattern is well-documented, add to existing hooks

### 4. Team Management CRUD (Settings)
- **Files**: `src/pages/SettingsPage.tsx`
- **Current**: Delete/add buttons have no onClick handlers (lines 67-68, 73)
- **To do**: Wire to Supabase admin API for user creation/deletion
- **Impact**: Admin can actually manage the team
- **Complexity**: Medium — need Supabase Admin API (service role key, edge function)

### 5. Deal Creation UI
- **Files**: `src/pages/PipelinePage.tsx`
- **Current**: Deals can only be moved between stages via drag-and-drop. No create UI.
- **API already exists**: `createDeal()` in `src/lib/api/deals.ts`
- **To do**: Add "New Deal" dialog with lead selector, title, value, stage
- **Impact**: Complete the deals CRUD cycle
- **Complexity**: Low — API exists, just need UI

### 6. Profile Editing
- **Files**: `src/pages/SettingsPage.tsx`
- **Current**: Name/email fields are `readOnly`
- **API already exists**: `updateProfile()` in `src/lib/api/profiles.ts`
- **To do**: Make fields editable, add save button
- **Impact**: Users can update their own profile
- **Complexity**: Low

## What Depends on Apollo

Only the **Lead Generator page** (`/generator`) depends on Apollo:
- `src/pages/LeadGeneratorPage.tsx` — `fakeGeneratedLeads()` needs to call Apollo API
- The Apollo MCP server is already configured in `.mcp.json`
- `.env.example` already has `APOLLO_API_KEY` placeholder

Everything else is independent.

## Recommended Priority Order

1. **Campaign AI → Claude API** — highest user-facing impact, the UI already exists
2. **Realtime subscriptions** — low effort, makes app feel professional
3. **Email sending (Resend)** — makes compose/campaigns actually work end-to-end
4. **Deal creation UI** — completes a major CRUD gap, API already exists
5. **Profile editing** — quick win, API exists
6. **Team management** — needs admin API, more involved

## Infrastructure Notes

- **MCP servers configured**: Supabase + Apollo (in `.mcp.json`)
- **Supabase project**: `onthjkzdgsfvmgyhrorw` (CRM, us-east-1, ACTIVE_HEALTHY)
- **No edge functions exist yet** — any server-side logic (email sending, AI proxy) needs edge functions
- **No CI/CD** — all deploys manual
