# Connect CRM MCP Server — Agent Setup Instructions

This document is for AI agents (Claude Code) to follow when helping a user set up the Connect CRM MCP server. Follow each step sequentially. Do not skip steps.

---

## Step 1: Check Prerequisites

Ask the user:

> "Do you have Node.js 18+ installed? Run `node --version` to check."

**If version is 18+:** Proceed.
**If not installed or below 18:** Tell the user:
> "You need Node.js 18 or higher. Install it from https://nodejs.org/ and then come back."

Stop here until resolved.

---

## Step 2: Locate the MCP Server

Ask the user:

> "Where is the connect-crm repository on your machine? I need the absolute path (e.g., `/Users/you/projects/connect-crm`)."

**Verify the path exists:**
```bash
ls <path>/mcp-server/package.json
```

**If file exists:** Continue.
**If not found:** Tell the user:
> "I can't find the MCP server at that path. Make sure you've cloned the connect-crm repo and the `mcp-server/` directory exists inside it."

Stop here until resolved.

---

## Step 3: Build the MCP Server

Run:
```bash
cd <path>/mcp-server && npm install && npm run build
```

**If build succeeds (no errors):** Continue.
**If build fails:** Show the user the error output and tell them:
> "The MCP server failed to build. This usually means a dependency issue. Try deleting `node_modules` and `package-lock.json` in the mcp-server directory, then run `npm install && npm run build` again."

Stop here until resolved.

---

## Step 4: Collect Required Keys

Tell the user:

> "I need 4 pieces of information to configure the MCP server. I'll walk you through each one."

### 4a: Supabase URL

Ask:
> "What is your Supabase project URL? You can find this in the Supabase Dashboard under Settings → API. It looks like `https://abcdefghij.supabase.co`."

**Validate:** Must start with `https://` and end with `.supabase.co`.
**If invalid:**
> "That doesn't look like a Supabase URL. It should be in the format `https://your-project-ref.supabase.co`. Check your Supabase Dashboard → Settings → API → Project URL."

### 4b: Supabase Service Role Key

Ask:
> "What is your Supabase service role key? Find it in Supabase Dashboard → Settings → API → under 'Project API keys' → the `service_role` key (NOT the `anon` key). It starts with `eyJhbGci...`"

**Validate:** Must start with `eyJ`.
**If invalid:**
> "That doesn't look like a service role key. Make sure you're copying the `service_role` key, not the `anon` key. It's a long JWT that starts with `eyJ`."

**Security warning:**
> "Important: This key has full database access. Never share it publicly or commit it to version control. It stays only in your local `.mcp.json` file."

### 4c: CRM User Email

Ask:
> "What email do you use to log into the Connect CRM? (e.g., `nick@integrateapi.ai`)"

**Validate:** Must contain `@`.
**If invalid:**
> "That doesn't look like an email address. Please provide the email you use to sign into the CRM."

### 4d: Resend API Key

Ask:
> "What is your Resend API key? Find it in the Resend Dashboard (resend.com) → API Keys. It starts with `re_`."

**Validate:** Must start with `re_`.
**If invalid:**
> "That doesn't look like a Resend API key. It should start with `re_`. Check your Resend Dashboard → API Keys."

---

## Step 5: Confirm Configuration

Show the user a summary (mask sensitive keys):

> "Here's your configuration:
>
> - **Supabase URL:** `<url>`
> - **Service Role Key:** `eyJ...` (masked for security)
> - **CRM User Email:** `<email>`
> - **Resend API Key:** `re_...` (masked for security)
> - **MCP Server Path:** `<path>/mcp-server/dist/index.js`
>
> Does this look correct? (yes/no)"

**If no:** Go back to the relevant step and re-collect.
**If yes:** Proceed.

---

## Step 6: Write the MCP Configuration

Determine where to write the config:

Ask:
> "Do you want the CRM MCP server available in all your projects (global) or just this one?
> - **Global:** I'll add it to `~/.claude/.mcp.json`
> - **This project only:** I'll add it to `.mcp.json` in the current directory"

**Then write the config.** If the file already exists, merge into the existing `mcpServers` object. Do NOT overwrite other MCP servers.

The entry to add:

```json
"connect-crm": {
  "type": "stdio",
  "command": "node",
  "args": ["<absolute-path>/mcp-server/dist/index.js"],
  "env": {
    "SUPABASE_URL": "<url>",
    "SUPABASE_SERVICE_ROLE_KEY": "<key>",
    "CRM_USER_EMAIL": "<email>",
    "RESEND_API_KEY": "<resend-key>"
  }
}
```

**After writing, confirm:**
> "Configuration saved. The MCP server will be available after you restart Claude Code."

---

## Step 7: Verify Setup

Tell the user:
> "Please restart Claude Code now (Cmd+Shift+P → 'Reload Window' or close and reopen). Then come back and I'll verify the connection."

After restart, test by calling:
```
list-leads with limit: 1
```

**If it returns leads:**
> "The Connect CRM MCP server is working! You now have access to 38 CRM tools. Try asking me to:
> - List your leads
> - Check your email inbox
> - Search Apollo for prospects
> - Create a campaign"

**If it fails with "No profile found":**
> "The email `<email>` doesn't match any profile in the CRM. Double-check your login email. You may need to ask your CRM admin to verify your account."

**If it fails with "Invalid API key":**
> "The Supabase service role key is incorrect. Go to Supabase Dashboard → Settings → API and copy the `service_role` key again. Make sure you're copying the full key."

**If it fails with "Missing required env vars":**
> "One or more environment variables are missing from the configuration. Let me check the `.mcp.json` file..."

Then read the `.mcp.json` and identify which var is missing.

**If tools don't appear at all:**
> "The MCP server isn't loading. Let me check:
> 1. Is the path correct? Run: `ls <path>/mcp-server/dist/index.js`
> 2. Was it built? Run: `cd <path>/mcp-server && npm run build`
> 3. Is the `.mcp.json` entry correct? Let me read it..."

---

## Troubleshooting Reference

| Error | Cause | Fix |
|-------|-------|-----|
| "No profile found for email: X" | `CRM_USER_EMAIL` doesn't match any profile | Check the email matches your CRM login |
| "Invalid API key" | Wrong Supabase key | Use the `service_role` key, not `anon` |
| "Missing required env vars" | Env var not set in `.mcp.json` | Check all 4 vars are present |
| "ENOENT: no such file" | Wrong path to `dist/index.js` | Use absolute path, ensure `npm run build` was run |
| "Cannot find module" | Dependencies not installed | Run `cd mcp-server && npm install && npm run build` |
| Tools don't appear | MCP server not in config or not restarted | Check `.mcp.json` and restart Claude Code |
| "fetch failed" / network error | Can't reach Supabase | Check internet connection and `SUPABASE_URL` |
