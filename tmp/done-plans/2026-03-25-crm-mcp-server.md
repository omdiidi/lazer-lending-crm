# Plan: Connect CRM MCP Server

## Goal

Build a local MCP server package that exposes Connect CRM tools to Claude Code agents. Per-user scoped, same business logic as the UI, no direct DB access for the agent. Runs locally via stdio transport.

## Why

- Enable other Claude Code agents to manage leads, send emails, run campaigns, search Apollo
- Controlled access — agent sees tools, not raw SQL
- Per-user scoping — same data boundaries as the UI

## What

A new `mcp-server/` directory in the repo containing a standalone Node.js MCP server. Uses `@modelcontextprotocol/sdk` for the MCP protocol and `@supabase/supabase-js` for DB access. Published as `@connect-crm/mcp-server` (or run directly via `npx`).

### Success Criteria

- [ ] MCP server starts via stdio and registers all tools
- [ ] Per-user scoping via `CRM_USER_EMAIL` env var
- [ ] Tools for leads, emails, campaigns, Apollo, deals, activities
- [ ] Agent can search leads, compose emails, create campaigns end-to-end
- [ ] Adding to `.mcp.json` gives Claude Code instant access to all tools

## Files Being Changed

```
mcp-server/                          ← NEW (entire directory)
  package.json                       ← NEW
  tsconfig.json                      ← NEW
  src/
    index.ts                         ← NEW (entry point, server setup)
    client.ts                        ← NEW (Supabase client + user init)
    tools/
      leads.ts                       ← NEW (8 tools)
      emails.ts                      ← NEW (6 tools)
      send-email.ts                  ← NEW (2 tools)
      campaigns.ts                   ← NEW (10 tools)
      deals.ts                       ← NEW (5 tools)
      activities.ts                  ← NEW (3 tools)
      apollo.ts                      ← NEW (2 tools)
      templates.ts                   ← NEW (3 tools)
```

## Architecture Overview

```
┌─────────────────┐     stdio      ┌──────────────────────┐     HTTPS     ┌───────────┐
│  Claude Code    │ ◄────────────► │  CRM MCP Server      │ ◄──────────► │  Supabase │
│  (other agent)  │   tool calls   │  (Node.js process)   │   service    │  Database │
└─────────────────┘                │                      │   role key   └───────────┘
                                   │  - Per-user scoping   │
                                   │  - Input validation   │
                                   │  - Business logic     │
                                   └──────────────────────┘
```

**Startup flow:**
1. Read env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRM_USER_EMAIL`
2. Create Supabase admin client (service role)
3. Look up user by email → get `userId`, `role`, `emailPrefix`
4. Register all tools
5. Connect via stdio transport

**Tool pattern:** Each tool file exports a `register(server, ctx)` function where `ctx` has `supabase`, `userId`, `userRole`, `emailPrefix`. Tools use `ctx.supabase` for DB operations and `ctx.userId` for scoping.

**User scoping:** Every query adds `.eq('assigned_to', ctx.userId)` for leads or `.eq('user_id', ctx.userId)` for emails. Admin users can optionally bypass scoping.

## Tasks

### Task 1: Create `mcp-server/package.json`

```json
{
  "name": "@connect-crm/mcp-server",
  "version": "0.1.0",
  "description": "MCP server for Connect CRM",
  "type": "module",
  "bin": {
    "connect-crm-mcp": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "@supabase/supabase-js": "^2.49.4",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0"
  }
}
```

### Task 2: Create `mcp-server/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

### Task 3: Create `mcp-server/src/client.ts` — Supabase client + user context

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export interface CRMContext {
  supabase: SupabaseClient
  userId: string
  userRole: 'admin' | 'employee'
  emailPrefix: string
  userName: string
}

export async function initContext(): Promise<CRMContext> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const email = process.env.CRM_USER_EMAIL

  const resendKey = process.env.RESEND_API_KEY

  if (!url || !key || !email || !resendKey) {
    throw new Error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRM_USER_EMAIL, RESEND_API_KEY')
  }

  const supabase = createClient(url, key)

  // Look up user by email prefix, fallback to auth email
  const prefix = email.split('@')[0]
  let { data: profile } = await supabase
    .from('profiles')
    .select('id, name, role, email_prefix')
    .eq('email_prefix', prefix)
    .maybeSingle()

  if (!profile) {
    // Fallback: try matching by auth email
    const { data: fallback } = await supabase
      .from('profiles')
      .select('id, name, role, email_prefix')
      .eq('email', email)
      .maybeSingle()
    profile = fallback
  }

  if (!profile) {
    throw new Error(`No profile found for email: ${email}`)
  }

  return {
    supabase,
    userId: profile.id,
    userRole: profile.role,
    emailPrefix: profile.email_prefix,
    userName: profile.name,
  }
}
```

### Task 4: Create `mcp-server/src/index.ts` — Entry point

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { initContext } from './client.js'
import { registerLeadTools } from './tools/leads.js'
import { registerEmailTools } from './tools/emails.js'
import { registerSendEmailTools } from './tools/send-email.js'
import { registerCampaignTools } from './tools/campaigns.js'
import { registerDealTools } from './tools/deals.js'
import { registerActivityTools } from './tools/activities.js'
import { registerApolloTools } from './tools/apollo.js'
import { registerTemplateTools } from './tools/templates.js'

async function main() {
  const ctx = await initContext()

  const server = new McpServer({
    name: 'connect-crm',
    version: '0.1.0',
  })

  // Register all tool groups
  registerLeadTools(server, ctx)
  registerEmailTools(server, ctx)
  registerSendEmailTools(server, ctx)
  registerCampaignTools(server, ctx)
  registerDealTools(server, ctx)
  registerActivityTools(server, ctx)
  registerApolloTools(server, ctx)
  registerTemplateTools(server, ctx)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
```

### Task 5: Create `mcp-server/src/tools/leads.ts`

Tools to register:

1. **`list-leads`** — List all leads (scoped to user via `assigned_to`). Params: `{ status?: string, search?: string, limit?: number }`
2. **`get-lead`** — Get lead by ID. Params: `{ id: string }`
3. **`create-lead`** — Create a new lead. Params: `{ firstName, lastName, email, phone?, company, jobTitle?, industry?, location?, status?, tags? }`
4. **`update-lead`** — Update lead fields. Params: `{ id: string, ...updates }`
5. **`delete-lead`** — Soft delete. Params: `{ id: string }`
6. **`search-leads`** — Search by name/company/email. Params: `{ query: string, limit?: number }`
7. **`import-leads`** — Bulk create. Params: `{ leads: Array<{firstName, lastName, email, company, ...}> }`
8. **`list-lead-emails`** — Get emails for a specific lead. Params: `{ leadId: string }`

Each tool uses `ctx.supabase` with service role (bypasses RLS) but adds `.eq('assigned_to', ctx.userId)` for scoping. Admin users skip the scope filter.

**Pattern for all tools:**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CRMContext } from '../client.js'

export function registerLeadTools(server: McpServer, ctx: CRMContext) {
  server.tool(
    'list-leads',
    'List all leads assigned to you. Filter by status or search term.',
    {
      status: z.enum(['cold', 'lukewarm', 'warm', 'dead']).optional().describe('Filter by lead status'),
      search: z.string().optional().describe('Search by name, company, or email'),
      limit: z.number().optional().default(50).describe('Max results to return'),
    },
    async ({ status, search, limit }) => {
      let query = ctx.supabase
        .from('leads')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit ?? 50)

      // Per-user scoping (admin sees all)
      if (ctx.userRole !== 'admin') {
        query = query.eq('assigned_to', ctx.userId)
      }

      if (status) query = query.eq('status', status)
      if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,company.ilike.%${search}%,email.ilike.%${search}%`)

      const { data, error } = await query
      if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
  )

  // ... more tools following same pattern
}
```

### Task 6: Create `mcp-server/src/tools/emails.ts`

Tools:

1. **`list-emails`** — List emails (user-scoped). Params: `{ folder?: 'inbox' | 'sent' | 'all', limit?: number }`
2. **`get-email`** — Get email by ID. Params: `{ id: string }`
3. **`get-thread`** — Get all emails in a thread. Params: `{ threadId: string }`
4. **`mark-email-read`** — Mark email as read/unread. Params: `{ id: string, read?: boolean }`
5. **`delete-email`** — Soft delete. Params: `{ id: string }`
6. **`list-threads`** — List email threads grouped by threadId. Params: `{ limit?: number }`

Scoping: `.eq('user_id', ctx.userId)` on all queries. Admin bypasses.

### Task 7: Create `mcp-server/src/tools/send-email.ts`

Tools:

1. **`compose-email`** — Send a new email. Params: `{ to: string, subject: string, body: string, leadId?: string }`
   - Calls Supabase Edge Function `send-email` (same as the UI)
   - Sets `from` using `ctx.emailPrefix + '@integrateapi.ai'`

2. **`reply-to-email`** — Reply to an email thread. Params: `{ threadId: string, replyToId: string, body: string }`
   - Looks up the original email's `to`/`from` to determine recipient
   - Builds `In-Reply-To` and `References` headers from `provider_message_id` (same logic as `send-email/index.ts` lines 65-91)
   - Calls Resend API directly with threading headers

Implementation: invoke the Edge Function via `ctx.supabase.functions.invoke('send-email', { body: {...} })` with auth headers. Since we're using service role, we need to pass the user JWT or simulate the auth.

**Alternative approach:** Call the Resend API directly via fetch (same as the Edge Function does), then insert the email record. This avoids auth complexity.

**Simplest approach:** Insert directly into the DB and call Resend API, mirroring what `send-email/index.ts` does:

```typescript
// 1. Send via Resend
const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: `${ctx.userName} <${ctx.emailPrefix}@integrateapi.ai>`, to: [to], subject, text: body })
})
// 2. Insert email record
await ctx.supabase.from('emails').insert({ user_id: ctx.userId, from: `${ctx.emailPrefix}@integrateapi.ai`, to, subject, body, ... })
```

Add `RESEND_API_KEY` to required env vars.

### Task 8: Create `mcp-server/src/tools/campaigns.ts`

Tools:

1. **`list-campaigns`** — List campaigns. Params: `{ status?: string }`
2. **`get-campaign`** — Get campaign details + stats. Params: `{ id: string }`
3. **`create-campaign`** — Create a campaign. Params: `{ name, subject, body, recipientIds: string[], scheduledAt?, smartSend?, sendSpacing?, dailySendLimit? }`
4. **`launch-campaign`** — Set status to active/scheduled. Params: `{ id: string, scheduledAt?: string }`
5. **`pause-campaign`** — Pause. Params: `{ id: string }`
6. **`resume-campaign`** — Resume. Params: `{ id: string }`
7. **`edit-campaign-content`** — Update subject/body. Params: `{ id: string, subject?: string, body?: string }`
8. **`enroll-leads`** — Add leads to campaign. Params: `{ campaignId: string, leadIds: string[] }`
9. **`get-campaign-stats`** — Get analytics. Params: `{ id: string }`
10. **`create-sequence`** — Create drip sequence. Inserts into `campaign_sequences` then `campaign_steps` (following pattern in `campaigns.ts:81-105`). Params: `{ steps: Array<{subject, body, delayDays}> }`

Scoping: `.eq('sent_by', ctx.userId)` on queries. New campaigns set `sent_by: ctx.userId`.

### Task 9: Create `mcp-server/src/tools/deals.ts`

Tools:

1. **`list-deals`** — Params: `{ stage?: string }`
2. **`get-deal`** — Params: `{ id: string }`
3. **`create-deal`** — Params: `{ leadId, title, value, stage? }`
4. **`update-deal`** — Params: `{ id, stage?, value?, title? }`
5. **`delete-deal`** — Params: `{ id: string }`

Scoping: `.eq('assigned_to', ctx.userId)`.

### Task 10: Create `mcp-server/src/tools/activities.ts`

Tools:

1. **`get-lead-timeline`** — Get activities + emails for a lead (merged view). Params: `{ leadId: string }`
2. **`create-activity`** — Params: `{ leadId, type, description, metadata? }`

Scoping: `.eq('user_id', ctx.userId)`.

### Task 11: Create `mcp-server/src/tools/apollo.ts`

Tools:

1. **`search-apollo`** — Search for people. Description MUST include: "Uses Apollo credits (1 per enriched contact). Use sparingly." Params: `{ prompt: string, perPage?: number }`
   - Calls the `apollo-search` Edge Function via `ctx.supabase.functions.invoke`
   - Log usage to `apollo_usage` table directly since Edge Function JWT logging will fail with service role

2. **`search-apollo-companies`** — Search companies. Description MUST include credit warning. Params: `{ prompt: string, perPage?: number }`

### Task 12: Create `mcp-server/src/tools/templates.ts`

Tools:

1. **`list-templates`** — Params: `{}`
2. **`create-template`** — Params: `{ name, subject, body, tags? }`
3. **`delete-template`** — Params: `{ id: string }`

Scoping: `.eq('created_by', ctx.userId)`.

### Task 13: Build + test

```bash
cd mcp-server && npm install && npm run build
```

Test locally:
```bash
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CRM_USER_EMAIL=nick@integrateapi.ai node dist/index.js
```

### Task 14: Add to `.mcp.json` for testing

Add entry to the project's `.mcp.json` so it can be tested in the current Claude Code session:

```json
"connect-crm": {
  "type": "stdio",
  "command": "node",
  "args": ["mcp-server/dist/index.js"],
  "env": {
    "SUPABASE_URL": "https://onthjkzdgsfvmgyhrorw.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "...",
    "CRM_USER_EMAIL": "nick@integrateapi.ai",
    "RESEND_API_KEY": "..."
  }
}
```

## Known Gotchas

- **Snake_case vs camelCase:** Supabase returns snake_case. The MCP server should return the raw DB format (snake_case) — the agent doesn't need camelCase transforms.
- **Service role bypasses RLS:** We enforce scoping in the tool logic, not via RLS.
- **Edge Function invocation:** Service role can invoke Edge Functions, but some require JWT auth. For `send-email`, call Resend + insert directly instead.
- **Apollo credits:** `search-apollo` uses credits. The tool description should warn the agent about credit usage.

## Validation

```bash
cd mcp-server && npm run build    # TypeScript compilation
```

## Confidence: 8/10

The plan covers all tool categories. The main risk is the volume of tools — 39 total across 8 files. Each tool follows the same pattern, so implementation is repetitive but straightforward.
