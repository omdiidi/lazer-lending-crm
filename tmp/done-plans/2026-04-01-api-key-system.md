# Plan: CRM API Key System + Edge Function REST API + MCP HTTP Client Rewrite

## Why
The MCP server currently uses a Supabase service role key + direct Resend calls, bypassing business logic entirely (warmup tracking, unsubscribe handling, soft deletes, email threading). An agent writing directly to the DB can diverge from what the UI expects. The goal is a single `CRM_API_KEY` that routes all agent actions through the same edge functions the UI relies on — full parity, one key.

## Context

### Existing auth pattern (edge functions)
`send-email/index.ts` manually validates JWTs:
```typescript
const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
const { data: { user } } = await supabaseAdmin.auth.getUser(jwt)
if (!user) return new Response('Unauthorized', { status: 401 })
```
We'll replace this with a shared `resolveUser()` that accepts either a JWT or a `crm_`-prefixed API key.

### Existing token pattern (invites)
`invites` table stores `token` (unique random string), `used` bool, `expires_at`. API keys follow the same shape but store a SHA-256 hash instead of plaintext, and track `last_used_at`.

### MCP bugs to fix in this pass
1. `deals.ts` uses hard `.delete()` — frontend soft-deletes via `deleted_at`
2. `templates.ts` uses hard `.delete()` — same issue
3. `apollo.ts` double-logs `apollo_usage` — MCP inserts a row AND the edge function inserts one
4. `send-email.ts` calls Resend directly — bypasses warmup tracking, unsubscribe link injection, and `writeAlert` error handling

### Settings page structure
`src/pages/SettingsPage.tsx` has four sections: Profile, Team Management (admin), Domain Warmup (admin), Integrations. We add "API Keys" as a fifth section (all roles).

### Key frontend patterns
- Direct Supabase calls for reads: `supabase.from('table').select()`
- Edge function calls via fetch with `Authorization: Bearer ${session.access_token}`
- `supabase` client from `@/lib/supabase`; `session` from `AuthContext`

## Architecture Overview

```
Before:
  MCP → Supabase (service role, bypasses RLS) + Resend (direct)
  Frontend → Supabase (user JWT, RLS enforced)

After:
  MCP → CRM Edge Functions (API key) → Supabase + Resend
  Frontend → Supabase (user JWT) + Edge Functions (JWT)

Both callers hit the same code paths.
Page refresh shows agent changes because agent writes to same DB frontend reads.
```

### API Key Design
- Format: `crm_` + 32 random alphanumeric chars (e.g. `crm_xK9mP2qNrT...`)
- Storage: SHA-256 hash only — plaintext never persisted
- Preview: `crm_...N3p2` (last 4 chars) — shown in UI list
- Generation: server-side edge function, returns plaintext **once**
- Revocation: direct Supabase delete from frontend (RLS-protected)

### New Edge Functions (8)
One per resource, HTTP method + query params route to the action:

| Function | Handles |
|---|---|
| `generate-api-key` | JWT auth only — creates key, returns plaintext once |
| `api-leads` | list, get, create, update, soft-delete, search, bulk-import, lead-emails |
| `api-emails` | list, get, thread, mark-read, soft-delete, list-threads |
| `api-campaigns` | list, get, create, launch, pause, resume, edit, enroll, stats, sequence |
| `api-deals` | list, get, create, update, soft-delete |
| `api-activities` | timeline, create |
| `api-templates` | list, create, soft-delete |

Plus two existing functions updated to accept API key auth:
- `send-email` — replace manual JWT check with `resolveUser()`
- `apollo-search` — add `resolveUser()` at top, fix double-log

### MCP Becomes a Thin HTTP Client
`client.ts` exports a `CRMClient` with `get/post/patch/delete` fetch helpers.
All 8 tool files call `crm.get(...)` / `crm.post(...)` instead of Supabase queries.
Two env vars replace four: `CRM_API_URL` + `CRM_API_KEY`.
Remove `@supabase/supabase-js` from `mcp-server/package.json`.

## Files Being Changed

```
connect-crm/
├── supabase/
│   ├── migrations/
│   │   └── 20260401000000_add_api_keys.sql              ← NEW
│   └── functions/
│       ├── _shared/
│       │   └── auth.ts                                  ← NEW
│       ├── send-email/index.ts                          ← MODIFIED (resolveUser)
│       ├── apollo-search/index.ts                       ← MODIFIED (resolveUser, fix double-log)
│       ├── generate-api-key/
│       │   └── index.ts                                 ← NEW
│       ├── api-leads/
│       │   └── index.ts                                 ← NEW
│       ├── api-emails/
│       │   └── index.ts                                 ← NEW
│       ├── api-campaigns/
│       │   └── index.ts                                 ← NEW
│       ├── api-deals/
│       │   └── index.ts                                 ← NEW
│       ├── api-activities/
│       │   └── index.ts                                 ← NEW
│       └── api-templates/
│           └── index.ts                                 ← NEW
├── src/
│   ├── lib/api/
│   │   └── api-keys.ts                                  ← NEW
│   └── pages/
│       └── SettingsPage.tsx                             ← MODIFIED (API Keys tab)
└── mcp-server/
    ├── src/
    │   ├── client.ts                                    ← MODIFIED (CRMClient replaces CRMContext)
    │   ├── index.ts                                     ← MODIFIED (CRMClient passed to tools)
    │   └── tools/
    │       ├── leads.ts                                 ← MODIFIED
    │       ├── emails.ts                                ← MODIFIED
    │       ├── send-email.ts                            ← MODIFIED
    │       ├── campaigns.ts                             ← MODIFIED
    │       ├── deals.ts                                 ← MODIFIED (+ soft delete fix)
    │       ├── activities.ts                            ← MODIFIED
    │       ├── apollo.ts                                ← MODIFIED (+ double-log fix)
    │       └── templates.ts                             ← MODIFIED (+ soft delete fix)
    └── package.json                                     ← MODIFIED (remove @supabase/supabase-js)
```

## Key Pseudocode

### 1. DB Migration — `20260401000000_add_api_keys.sql`

```sql
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_preview text NOT NULL,        -- "crm_...N3p2"
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz            -- NULL = never expires
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Users see only their own keys
CREATE POLICY "api_keys_select" ON api_keys
  FOR SELECT USING (user_id = auth.uid());

-- Users can revoke their own keys
CREATE POLICY "api_keys_delete" ON api_keys
  FOR DELETE USING (user_id = auth.uid());

-- No direct client INSERT — generation is server-side only
```

### 2. Shared Auth Middleware — `_shared/auth.ts`

```typescript
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface UserContext {
  id: string
  name: string
  role: 'admin' | 'employee'
  emailPrefix: string | null   // null = not configured; callers that need it should check
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// jwtOnly = true prevents API keys from being used (used by generate-api-key itself)
export async function resolveUser(
  authHeader: string | null,
  supabaseAdmin: SupabaseClient,
  jwtOnly = false
): Promise<UserContext> {
  if (!authHeader) throw new Error('Missing Authorization header')
  const token = authHeader.replace('Bearer ', '')

  let profileId: string

  if (!jwtOnly && token.startsWith('crm_')) {
    const hash = await sha256(token)
    const { data: apiKey } = await supabaseAdmin
      .from('api_keys')
      .select('user_id, expires_at')
      .eq('key_hash', hash)
      .maybeSingle()

    if (!apiKey) throw new Error('Invalid API key')
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) throw new Error('API key expired')

    // fire-and-forget — don't await
    supabaseAdmin.from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('key_hash', hash)

    profileId = apiKey.user_id
  } else {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) throw new Error('Invalid session')
    profileId = user.id
  }

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, role, email_prefix')
    .eq('id', profileId)
    .single()

  if (error || !profile) throw new Error('Profile not found')

  return {
    id: profile.id,
    name: profile.name,
    role: profile.role as 'admin' | 'employee',
    emailPrefix: profile.email_prefix ?? null,
  }
}
```

### 3. Resource Edge Function Pattern — `api-leads/index.ts`

All 6 resource functions follow this shape. Only the query logic differs.

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveUser } from '../_shared/auth.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  let user
  try {
    user = await resolveUser(req.headers.get('Authorization'), supabaseAdmin)
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 401, headers: corsHeaders })
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const method = req.method

  try {
    if (method === 'GET' && !id) {
      // LIST — applies role filter, optional status/q params
      const status = url.searchParams.get('status')
      const q = url.searchParams.get('q')
      let query = supabaseAdmin.from('leads')
        .select('*').is('deleted_at', null).order('created_at', { ascending: false })
      if (user.role !== 'admin') query = query.eq('assigned_to', user.id)
      if (status) query = query.eq('status', status)
      if (q) query = query.or(
        `first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%`
      )
      const { data, error } = await query
      if (error) throw error
      return json(data)
    }

    if (method === 'GET' && id) {
      // GET single
      const { data, error } = await supabaseAdmin.from('leads').select('*').eq('id', id).single()
      if (error) throw error
      return json(data)
    }

    if (method === 'POST') {
      const body = await req.json()
      if (Array.isArray(body)) {
        // BULK IMPORT
        const rows = body.map((l: Record<string, unknown>) => ({ ...l, assigned_to: user.id }))
        const { data, error } = await supabaseAdmin.from('leads').insert(rows).select()
        if (error) throw error
        return json(data, 201)
      }
      // CREATE single
      const { data, error } = await supabaseAdmin.from('leads')
        .insert({ ...body, assigned_to: user.id }).select().single()
      if (error) throw error
      return json(data, 201)
    }

    if (method === 'PATCH' && id) {
      // UPDATE
      const body = await req.json()
      const { data, error } = await supabaseAdmin.from('leads')
        .update(body).eq('id', id).select().single()
      if (error) throw error
      return json(data)
    }

    if (method === 'DELETE' && id) {
      // SOFT DELETE
      const { error } = await supabaseAdmin.from('leads')
        .update({ deleted_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      return json({ success: true })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders })
  }
})
```

**`api-leads` specific routes summary:**
- `GET /api-leads` — list (+ `?status=`, `?q=`)
- `GET /api-leads?id=xxx` — get single
- `GET /api-leads?leadId=xxx` — list emails for lead (switch on `url.searchParams.has('leadId')`)
- `POST /api-leads` — create single (object) or bulk import (array)
- `PATCH /api-leads?id=xxx` — update
- `DELETE /api-leads?id=xxx` — soft delete

**`api-emails` routes:**
- `GET /api-emails` — list (+ `?folder=inbox|sent|all`)
- `GET /api-emails?id=xxx` — get single
- `GET /api-emails?threadId=xxx` — get full thread
- `GET /api-emails?threads=1` — list thread summaries
- `PATCH /api-emails?id=xxx` — mark read/unread (`{ read: bool }`)
- `DELETE /api-emails?id=xxx` — soft delete

**`api-campaigns` routes:**
- `GET /api-campaigns` — list (+ `?status=`)
- `GET /api-campaigns?id=xxx` — get with enrollment counts
- `GET /api-campaigns?stats=xxx` — enrollment + email engagement stats
- `POST /api-campaigns` — create (draft)
- `POST /api-campaigns?action=launch&id=xxx` — set active/scheduled
- `POST /api-campaigns?action=pause&id=xxx` — set paused
- `POST /api-campaigns?action=resume&id=xxx` — set active
- `POST /api-campaigns?action=enroll&id=xxx` — body: `{ leadIds: string[] }`
- `POST /api-campaigns?action=sequence` — create sequence with steps
- `PATCH /api-campaigns?id=xxx` — edit subject/body

**`api-deals` routes:**
- `GET /api-deals` — list (+ `?stage=`)
- `GET /api-deals?id=xxx` — get single
- `POST /api-deals` — create
- `PATCH /api-deals?id=xxx` — update stage/value/title
- `DELETE /api-deals?id=xxx` — soft delete (set `deleted_at`)

**`api-activities` routes:**
- `GET /api-activities?leadId=xxx` — timeline (merged activities + emails)
- `POST /api-activities` — create activity

**`api-templates` routes:**
- `GET /api-templates` — list
- `POST /api-templates` — create
- `DELETE /api-templates?id=xxx` — soft delete (set `deleted_at`)

### 4. `generate-api-key/index.ts`

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveUser } from '../_shared/auth.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  let user
  try {
    // jwtOnly = true — agents cannot self-issue keys
    user = await resolveUser(req.headers.get('Authorization'), supabaseAdmin, true)
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 401, headers: corsHeaders })
  }

  const { name } = await req.json()
  if (!name?.trim()) {
    return new Response(JSON.stringify({ error: 'name is required' }), { status: 400, headers: corsHeaders })
  }

  // Generate key server-side
  const randomBytes = new Uint8Array(24)
  crypto.getRandomValues(randomBytes)
  // base64url, trimmed to 32 chars
  const random = btoa(String.fromCharCode(...randomBytes))
    .replace(/\+/g, 'A').replace(/\//g, 'B').replace(/=/g, '').slice(0, 32)
  const key = `crm_${random}`

  const hash = await sha256(key)
  const preview = `crm_...${key.slice(-4)}`

  const { error } = await supabaseAdmin.from('api_keys').insert({
    user_id: user.id,
    name: name.trim(),
    key_hash: hash,
    key_preview: preview,
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
  }

  // Plaintext key returned ONCE — never stored
  return new Response(JSON.stringify({ key }), {
    status: 201,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
```

### 5. Updated `send-email/index.ts` (auth section only)

Replace the manual JWT block (lines 24, 40-60) with:

```typescript
import { resolveUser } from '../_shared/auth.ts'

// Replace existing auth + profile lookup with:
let user
try {
  user = await resolveUser(req.headers.get('Authorization'), supabaseAdmin)
} catch (e) {
  return new Response(JSON.stringify({ error: e.message }), { status: 401, headers: corsHeaders })
}

if (!user.emailPrefix) {
  return new Response(JSON.stringify({ error: 'Email prefix not configured' }), { status: 403, headers: corsHeaders })
}

// Replace `authUser.id` with `user.id`, `emailPrefix` with `user.emailPrefix`, `userName` with `user.name`
```

### 6. Updated `apollo-search/index.ts` (auth section)

Move auth to the top (before pipeline), replace with `resolveUser`, remove end-of-function auth block, remove the `apollo_usage` insert (edge function keeps its own log; MCP no longer double-inserts):

```typescript
// TOP of handler (before pipeline):
let user
try {
  user = await resolveUser(req.headers.get('Authorization'), supabaseAdmin)
} catch (e) {
  return new Response(JSON.stringify({ error: e.message }), { status: 401, headers: corsHeaders })
}

// Remove lines 410-426 (old auth + usage log block)
// Keep the apollo_usage insert in the edge function only
// Log: user_id = user.id
```

### 7. MCP `client.ts` — full rewrite

```typescript
export interface CRMClient {
  get(path: string, params?: Record<string, string>): Promise<unknown>
  post(path: string, body?: unknown): Promise<unknown>
  patch(path: string, body?: unknown): Promise<unknown>
  del(path: string): Promise<unknown>
}

export function initClient(): CRMClient {
  const baseUrl = process.env.CRM_API_URL?.replace(/\/$/, '')
  const apiKey = process.env.CRM_API_KEY

  if (!baseUrl || !apiKey) {
    throw new Error('Missing required env vars: CRM_API_URL, CRM_API_KEY')
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  async function request(url: string, init: RequestInit): Promise<unknown> {
    const res = await fetch(url, { ...init, headers })
    const text = await res.text()
    if (!res.ok) throw new Error(`CRM API error ${res.status}: ${text}`)
    return text ? JSON.parse(text) : null
  }

  return {
    get: (path, params) => {
      const url = new URL(`${baseUrl}/${path}`)
      if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
      return request(url.toString(), { method: 'GET' })
    },
    post: (path, body) => request(`${baseUrl}/${path}`, {
      method: 'POST', body: JSON.stringify(body ?? {})
    }),
    patch: (path, body) => request(`${baseUrl}/${path}`, {
      method: 'PATCH', body: JSON.stringify(body ?? {})
    }),
    del: (path) => request(`${baseUrl}/${path}`, { method: 'DELETE' }),
  }
}
```

### 8. MCP `index.ts` — updated signature

```typescript
import { initClient } from './client.js'
import type { CRMClient } from './client.js'

async function main() {
  const crm = initClient()   // throws early if env vars missing

  const server = new McpServer({ name: 'connect-crm', version: '0.1.0' })

  registerLeadTools(server, crm)
  registerEmailTools(server, crm)
  registerSendEmailTools(server, crm)
  registerCampaignTools(server, crm)
  registerDealTools(server, crm)
  registerActivityTools(server, crm)
  registerApolloTools(server, crm)
  registerTemplateTools(server, crm)

  await server.connect(new StdioServerTransport())
}
```

Each `register*` function signature changes from `(server, ctx: CRMContext)` to `(server, crm: CRMClient)`.

### 9. MCP tool rewrite pattern (representative — `leads.ts`)

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CRMClient } from '../client.js'

export function registerLeadTools(server: McpServer, crm: CRMClient) {
  server.tool('list-leads', { status: z.string().optional(), search: z.string().optional() },
    async ({ status, search }) => {
      const params: Record<string, string> = {}
      if (status) params.status = status
      if (search) params.q = search
      const data = await crm.get('api-leads', params)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool('get-lead', { id: z.string() },
    async ({ id }) => {
      const data = await crm.get('api-leads', { id })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool('create-lead', { /* existing schema */ },
    async (input) => {
      const data = await crm.post('api-leads', toSnakeCase(input))
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool('update-lead', { id: z.string(), /* rest of schema */ },
    async ({ id, ...updates }) => {
      const data = await crm.patch(`api-leads?id=${id}`, toSnakeCase(updates))
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool('delete-lead', { id: z.string() },
    async ({ id }) => {
      await crm.del(`api-leads?id=${id}`)
      return { content: [{ type: 'text', text: 'Lead deleted.' }] }
    }
  )

  // ... same pattern for remaining tools
}
```

**`send-email.ts` MCP tool** — routes through `send-email` edge function (not Resend directly):
```typescript
server.tool('compose-email', { to, subject, body, leadId },
  async (input) => {
    const data = await crm.post('send-email', { to, subject, body, leadId })
    return { content: [{ type: 'text', text: `Email sent. ID: ${data.id}` }] }
  }
)

server.tool('reply-to-email', { threadId, replyToId, to, subject, body },
  async (input) => {
    const data = await crm.post('send-email', { threadId, replyToId, to, subject, body })
    return { content: [{ type: 'text', text: `Reply sent. ID: ${data.id}` }] }
  }
)
```

**`apollo.ts` MCP tool** — calls `apollo-search` via HTTP, no local `apollo_usage` insert:
```typescript
server.tool('search-apollo', { prompt: z.string(), perPage: z.number().optional() },
  async ({ prompt, perPage }) => {
    const data = await crm.post('apollo-search', { prompt, perPage: perPage ?? 10 })
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)
```

### 10. Settings API Keys tab — `SettingsPage.tsx`

```tsx
// New state
const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
const [generateOpen, setGenerateOpen] = useState(false)
const [newKeyName, setNewKeyName] = useState('')
const [generatedKey, setGeneratedKey] = useState<string | null>(null)
const [generatingKey, setGeneratingKey] = useState(false)

// Load on mount
useEffect(() => {
  loadApiKeys()
}, [])

const loadApiKeys = async () => {
  const { data } = await supabase
    .from('api_keys')
    .select('id, name, key_preview, created_at, last_used_at')
    .order('created_at', { ascending: false })
  setApiKeys(data ?? [])
}

const handleGenerateKey = async () => {
  setGeneratingKey(true)
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-api-key`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: newKeyName }),
    })
    const { key } = await res.json()
    setGeneratedKey(key)
    await loadApiKeys()
  } finally {
    setGeneratingKey(false)
  }
}

const handleRevokeKey = async (id: string) => {
  await supabase.from('api_keys').delete().eq('id', id)
  setApiKeys(prev => prev.filter(k => k.id !== id))
}
```

UI structure for the API Keys card:
- Header: "API Keys" + "Generate Key" button
- Empty state: "No API keys yet. Generate one to connect an agent."
- Key list: name, `key_preview`, created date, last used ("Never" if null), Revoke button
- Generate dialog: name input → submit → success state shows key in a monospace input with Copy button + warning "Store this key — it won't be shown again"
- On dialog close after viewing key: `setGeneratedKey(null)`, `setNewKeyName('')`

### 11. `src/lib/api/api-keys.ts`

```typescript
import { supabase } from '@/lib/supabase'

export interface ApiKey {
  id: string
  name: string
  keyPreview: string
  createdAt: string
  lastUsedAt: string | null
}

export async function getApiKeys(): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, key_preview, created_at, last_used_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(row => ({
    id: row.id,
    name: row.name,
    keyPreview: row.key_preview,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }))
}

export async function revokeApiKey(id: string): Promise<void> {
  const { error } = await supabase.from('api_keys').delete().eq('id', id)
  if (error) throw error
}
```

## Tasks (in order)

1. **DB migration** — Write `20260401000000_add_api_keys.sql`; apply via `mcp__supabase__apply_migration`
2. **`_shared/auth.ts`** — New shared auth middleware with `resolveUser()`
3. **`generate-api-key/index.ts`** — New edge function, JWT-only, server-side key generation
4. **`api-leads/index.ts`** — New resource function: list, get, create, update, soft-delete, search, import, lead-emails
5. **`api-emails/index.ts`** — New resource function: list, get, thread, mark-read, soft-delete, list-threads
6. **`api-campaigns/index.ts`** — New resource function: all campaign operations + sequence creation
7. **`api-deals/index.ts`** — New resource function: full CRUD with soft delete
8. **`api-activities/index.ts`** — New resource function: timeline + create
9. **`api-templates/index.ts`** — New resource function: list, create, soft delete
10. **Update `send-email/index.ts`** — Replace manual JWT auth with `resolveUser()`
11. **Update `apollo-search/index.ts`** — Add `resolveUser()` at top, remove end-of-function auth block, remove redundant `apollo_usage` insert
12. **`src/lib/api/api-keys.ts`** — New helper module with `getApiKeys` and `revokeApiKey`
13. **`src/pages/SettingsPage.tsx`** — Add API Keys tab/card with generate dialog and key list
14. **`mcp-server/src/client.ts`** — Full rewrite: `CRMClient` interface + `initClient()` fetch helper
15. **`mcp-server/src/index.ts`** — Update to use `CRMClient`, update `register*` call signatures
16. **`mcp-server/src/tools/leads.ts`** — Rewrite using HTTP calls
17. **`mcp-server/src/tools/emails.ts`** — Rewrite using HTTP calls
18. **`mcp-server/src/tools/send-email.ts`** — Rewrite to call `send-email` edge function (not Resend directly)
19. **`mcp-server/src/tools/campaigns.ts`** — Rewrite using HTTP calls
20. **`mcp-server/src/tools/deals.ts`** — Rewrite using HTTP calls + fix hard delete bug
21. **`mcp-server/src/tools/activities.ts`** — Rewrite using HTTP calls
22. **`mcp-server/src/tools/apollo.ts`** — Rewrite using HTTP calls + remove double apollo_usage insert
23. **`mcp-server/src/tools/templates.ts`** — Rewrite using HTTP calls + fix hard delete bug
24. **`mcp-server/package.json`** — Remove `@supabase/supabase-js` dependency

## Deprecated Code to Remove

- `CRMContext` interface in `mcp-server/src/client.ts` (replaced by `CRMClient`)
- `initContext()` function in `mcp-server/src/client.ts`
- All direct Supabase/Resend logic from all 8 MCP tool files
- MCP env vars `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRM_USER_EMAIL`, `RESEND_API_KEY` — replace with `CRM_API_URL`, `CRM_API_KEY`

## Confidence Score: 8/10

High confidence because:
- Auth pattern is a straightforward extension of existing JWT approach
- Resource edge functions mirror queries already in `src/lib/api/`
- MCP rewrite is mechanical — same tool names/schemas, just different implementation

Risk areas:
- `api-campaigns` is the most complex function (10 operations, sequence creation is multi-table)
- `send-email` edge function auth swap must not break existing frontend calls
