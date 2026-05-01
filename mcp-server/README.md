# Connect CRM MCP Server

A local MCP (Model Context Protocol) server that gives Claude Code agents full access to Connect CRM functionality — lead management, email outreach, campaign creation, Apollo search, pipeline management, and more.

## What It Does

The MCP server runs locally on your machine and exposes 38 CRM tools to any Claude Code agent. The agent can:

- Search, create, and manage leads
- Compose and reply to emails (with proper threading)
- Create and launch email campaigns
- Search Apollo for prospects
- Manage deals and pipeline stages
- View activity timelines
- Create email templates

All operations are **per-user scoped** — each user only accesses their own data, same as the CRM UI.

## How It Connects to the Live CRM

The MCP server connects directly to the **same Supabase database** as the hosted CRM web app. There is no sync layer — both read and write to the same source of truth.

```
Hosted CRM (Netlify)  ──→  Supabase DB  ←──  MCP Server (your machine)
     (browser)              (single              (Claude Code)
                             database)
```

- **Create a lead via MCP** → it appears instantly in the web app
- **Send an email from the web app** → `list-emails` in the MCP returns it
- **Campaign enrollments created via MCP** → the campaign scheduler (pg_cron) picks them up and sends automatically

No additional hosting or infrastructure is needed. The MCP server runs locally as a Node.js process that starts when Claude Code launches and stops when it exits.

## Requirements

- Node.js 18+
- npm
- A Connect CRM account (Supabase project)

## Keys You Need

| Key | Where to get it | What it does |
|-----|----------------|--------------|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API | Your project URL (not a secret) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → Service Role Key | Full DB access (keep this secret!) |
| `CRM_USER_EMAIL` | Your CRM login email (e.g., `nick@integrateapi.ai`) | Determines which user's data you access |
| `RESEND_API_KEY` | Resend Dashboard → API Keys | Required for sending emails via MCP tools |

## Setup

### 1. Build the MCP server

```bash
cd mcp-server
npm install
npm run build
```

### 2. Add to your Claude Code config

Add this to your `.mcp.json` (in the project directory or `~/.claude/.mcp.json` for global access):

```json
{
  "mcpServers": {
    "connect-crm": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/connect-crm/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "eyJhbGci...",
        "CRM_USER_EMAIL": "you@integrateapi.ai",
        "RESEND_API_KEY": "re_..."
      }
    }
  }
}
```

**Important:** Use the absolute path to `dist/index.js`, not a relative path.

### 3. Restart Claude Code

The MCP server loads at startup. After adding the config, restart your Claude Code session. You should see the CRM tools available.

## Verify It Works

Ask Claude Code:

> "List my leads in the CRM"

It should call `list-leads` and return your leads. If it doesn't work, check:

- **"No profile found"** — Your `CRM_USER_EMAIL` doesn't match any profile in the CRM. Check the email is correct.
- **"Invalid API key"** — Your `SUPABASE_SERVICE_ROLE_KEY` is wrong. Get the correct one from Supabase Dashboard → Settings → API.
- **"Missing required env vars"** — One of the 4 env vars is missing from your `.mcp.json`.
- **Tools don't appear** — Make sure you ran `npm run build` and the path to `dist/index.js` is absolute and correct.

## Available Tools (38)

### Leads (8)
| Tool | Description |
|------|-------------|
| `list-leads` | List leads with optional status/search filter |
| `get-lead` | Get a single lead by ID |
| `create-lead` | Create a new lead |
| `update-lead` | Update lead fields |
| `delete-lead` | Soft-delete a lead |
| `search-leads` | Search by name, company, or email |
| `import-leads` | Bulk import leads |
| `list-lead-emails` | Get all emails for a specific lead |

### Email (8)
| Tool | Description |
|------|-------------|
| `list-emails` | List inbox/sent/all emails |
| `get-email` | Get a single email |
| `get-thread` | Get all emails in a thread |
| `list-threads` | List email threads |
| `mark-email-read` | Mark email read/unread |
| `delete-email` | Soft-delete an email |
| `compose-email` | Send a new email |
| `reply-to-email` | Reply to an email thread (with proper threading headers) |

### Campaigns (10)
| Tool | Description |
|------|-------------|
| `list-campaigns` | List campaigns |
| `get-campaign` | Get campaign details |
| `create-campaign` | Create a new campaign |
| `launch-campaign` | Launch or schedule a campaign |
| `pause-campaign` | Pause an active campaign |
| `resume-campaign` | Resume a paused campaign |
| `edit-campaign-content` | Edit subject/body of active campaign |
| `enroll-leads` | Add leads to a campaign |
| `get-campaign-stats` | Get campaign analytics |
| `create-sequence` | Create a drip sequence |

### Deals (5)
| Tool | Description |
|------|-------------|
| `list-deals` | List pipeline deals |
| `get-deal` | Get deal details |
| `create-deal` | Create a new deal |
| `update-deal` | Update deal stage/value |
| `delete-deal` | Delete a deal |

### Activities (2)
| Tool | Description |
|------|-------------|
| `get-lead-timeline` | Get combined activity + email timeline for a lead |
| `create-activity` | Log an activity (call, note, meeting, etc.) |

### Apollo (2)
| Tool | Description |
|------|-------------|
| `search-apollo` | Search for people (uses credits!) |
| `search-apollo-companies` | Search for companies (uses credits!) |

### Templates (3)
| Tool | Description |
|------|-------------|
| `list-templates` | List email templates |
| `create-template` | Create a template |
| `delete-template` | Delete a template |

## User Scoping

- **Regular users** see only their own leads, emails, campaigns, deals, and activities
- **Admin users** see everything (same as the CRM UI)
- Scoping is enforced in the MCP server logic — the agent cannot bypass it

## Credit Warnings

- `search-apollo` and `search-apollo-companies` consume Apollo credits (1 per enriched contact)
- `compose-email` and `reply-to-email` send real emails via Resend
- The agent is warned in tool descriptions, but be mindful of usage
