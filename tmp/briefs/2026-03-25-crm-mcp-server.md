# Brief: Connect CRM MCP Server

## Why
Enable other Claude Code agents to programmatically access CRM functionality — lead management, email outreach, campaign creation, Apollo search — without direct DB access. The MCP server acts as a controlled middle layer with the same business logic as the UI.

## Context
- CRM is a Supabase + React app with Edge Functions for email/campaigns
- Existing MCP pattern: Resend, Supabase, Apollo, Netlify all run as local stdio MCP servers in `.mcp.json`
- Supabase service role key provides full DB access — MCP server uses this internally
- UI uses React Query + Supabase realtime — reactive to any DB changes regardless of source
- Campaign processing runs via pg_cron — picks up any enrollments regardless of how they were created
- Apollo integration exists in the codebase for lead search + enrichment
- Per-user scoping needed: each user only accesses their own data, same as UI RLS boundaries
- `profiles.email_prefix` maps users to their email addresses

## Decisions
- **Local MCP server (stdio transport)** — runs on user's machine, no hosting needed
- **Per-user scoping via `CRM_USER_EMAIL` env var** — MCP server looks up user by email on startup, scopes all operations to that user's ID
- **Same business logic as UI** — tools validate inputs, enforce required fields, respect the same constraints as the frontend
- **Service role key for internal DB access** — MCP server uses it, but tools enforce per-user scoping so the agent can't access other users' data
- **Full CRM tool coverage** — leads, emails, campaigns, sequences, Apollo search/enrichment, pipeline/deals, activities

### Tool categories to expose:
1. **Leads** — search, create, update, delete, import, filter by status/tags
2. **Email** — compose, reply, list inbox, list sent, get thread
3. **Campaigns** — create, launch, pause, resume, edit content, enroll leads, get stats
4. **Sequences** — create drip sequences, add steps
5. **Apollo** — search people, search companies, enrich leads
6. **Pipeline** — create/update deals, move stages
7. **Activities** — log activities, get lead timeline

### User config (`.mcp.json`):
```json
{
  "connect-crm": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@connect-crm/mcp-server"],
    "env": {
      "SUPABASE_URL": "https://onthjkzdgsfvmgyhrorw.supabase.co",
      "SUPABASE_SERVICE_ROLE_KEY": "...",
      "CRM_USER_EMAIL": "nick@integrateapi.ai"
    }
  }
}
```

## Rejected Alternatives
- **Direct DB access for the agent** — no guardrails, risk of data mismatches and bypassed validation
- **Hosted REST API** — unnecessary infrastructure for agent-to-CRM communication; MCP is purpose-built for this
- **Shared service role without user scoping** — any agent could access all users' data

## Direction
Build a local MCP server package (`@connect-crm/mcp-server`) that exposes CRM tools over stdio. Uses Supabase service role internally but scopes all operations to the configured user via `CRM_USER_EMAIL`. Covers leads, emails, campaigns, Apollo, pipeline, and activities — same operations as the UI with the same validation. No hosting required.
