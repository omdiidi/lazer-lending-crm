# Plan: Dual-Domain Email Setup

## Goal

Set up `integrateapi.ai` as a second verified domain in Resend. Campaigns send from `mail.integrateapi.ai` (reputation isolation), compose/reply sends from `integrateapi.ai` (clean domain). Profile stores an `email_prefix` instead of a full email address — the system derives both addresses at send time.

## Why

- Spam reputation isolation: if cold outreach domain gets flagged, natural email keeps working
- Cleaner recipient experience: `Reply-To` on campaigns routes replies to the root domain
- Simpler user config: users type a prefix once, get both addresses

## What

- Add `integrateapi.ai` domain in Resend (MCP) with sending + receiving
- Add DNS records in Cloudflare (MCP) for DKIM, SPF, MX
- Rename `profiles.sending_email` → `profiles.email_prefix` (DB migration)
- Update `send-email` to derive `{prefix}@integrateapi.ai` for compose/reply
- Update `process-campaigns` to derive `{prefix}@mail.integrateapi.ai` for campaigns + add `Reply-To: {prefix}@integrateapi.ai` header
- Update SettingsPage to show prefix input with preview of both derived addresses
- Update signup-with-token to extract prefix from invite email

### Success Criteria

- [ ] `integrateapi.ai` verified in Resend (sending + receiving)
- [ ] Compose/reply emails send from `{prefix}@integrateapi.ai`
- [ ] Campaign emails send from `{prefix}@mail.integrateapi.ai` with `Reply-To: {prefix}@integrateapi.ai`
- [ ] Inbound emails on both domains arrive in CRM inbox
- [ ] Settings shows prefix input with preview of both addresses
- [ ] Existing emails/threads/campaigns unaffected

## All Needed Context

### Documentation & References

```yaml
- file: supabase/functions/send-email/index.ts
  why: Lines 46-60 — fetches profile.sending_email, uses as From address. Must change to email_prefix + derive full address.

- file: supabase/functions/process-campaigns/index.ts
  why: Lines 150-158, 272-273, 443-445, 480 — fetches profile.sending_email for campaign From. Must change to email_prefix + derive mail. address + add Reply-To header.

- file: supabase/functions/signup-with-token/index.ts
  why: Lines 53-63 — sets sending_email from invite.email on signup. Must extract prefix instead.

- file: src/pages/SettingsPage.tsx
  why: Lines 24, 130-136, 92 — sending email input field + save handler. Must become prefix input.

- file: src/lib/api/profiles.ts
  why: Lines 29-39 — updateProfile maps sendingEmail → sending_email. Must change to emailPrefix → email_prefix.

- file: src/types/crm.ts
  why: Line 9 — User type has sendingEmail. Must rename to emailPrefix.

- file: src/contexts/AuthContext.tsx
  why: Loads profile via getProfile, toCamelCase transforms sending_email → sendingEmail. Will auto-transform email_prefix → emailPrefix.
```

### Domain Constants

Both edge functions need these hardcoded domain constants:

```typescript
const EMAIL_DOMAIN = 'integrateapi.ai'
const CAMPAIGN_DOMAIN = 'mail.integrateapi.ai'
```

### Files Being Changed

```
supabase/functions/send-email/index.ts              ← MODIFIED (email_prefix + derive address)
supabase/functions/process-campaigns/index.ts        ← MODIFIED (campaign domain + Reply-To)
supabase/functions/signup-with-token/index.ts        ← MODIFIED (extract prefix from invite email)
src/pages/SettingsPage.tsx                           ← MODIFIED (prefix input + preview)
src/pages/OutreachPage.tsx                           ← MODIFIED (sendingEmail → emailPrefix, derive address)
src/pages/CampaignBuilderPage.tsx                    ← MODIFIED (sendingEmail → emailPrefix, show mail. domain in preview)
src/lib/api/profiles.ts                              ← MODIFIED (sendingEmail → emailPrefix)
src/hooks/use-profiles.ts                            ← MODIFIED (sendingEmail → emailPrefix in type)
src/types/crm.ts                                     ← MODIFIED (User type rename)
src/types/database.ts                                ← MODIFIED (sending_email → email_prefix)
DB migration                                         ← NEW (rename column)
```

## Implementation Blueprint

### Tasks (in implementation order)

#### Task 0: Infrastructure — Resend domain + Cloudflare DNS

**Via MCP tools (not code changes):**

1. `mcp__resend__create-domain` — create `integrateapi.ai` with `sending: "enabled"`, `receiving: "enabled"`, `region: "us-east-1"`
2. Read the DNS records from the response
3. Add each DNS record in Cloudflare via MCP (DKIM TXT, SPF MX, SPF TXT, Receiving MX)
4. `mcp__resend__verify-domain` — trigger verification
5. Confirm domain status is `verified`

#### Task 1: DB migration — rename column

```sql
ALTER TABLE profiles RENAME COLUMN sending_email TO email_prefix;

-- Strip existing full emails to just the prefix (everything before @)
UPDATE profiles
SET email_prefix = split_part(email_prefix, '@', 1)
WHERE email_prefix IS NOT NULL AND email_prefix LIKE '%@%';
```

#### Task 2: MODIFY `src/types/crm.ts`

Line 9: rename `sendingEmail?: string` → `emailPrefix?: string`

#### Task 3: MODIFY `src/types/database.ts`

Find all 3 occurrences of `sending_email` in the profiles table types (Row, Insert, Update) and rename to `email_prefix`.

#### Task 4: MODIFY `src/lib/api/profiles.ts`

Line 29: change `sendingEmail` → `emailPrefix` in the Partial<Pick<...>> type
Line 35: change mapping from `sending_email: updates.sendingEmail` → `email_prefix: updates.emailPrefix`

#### Task 4b: MODIFY `src/hooks/use-profiles.ts`

Lines 15 and 33: change `'sendingEmail'` → `'emailPrefix'` in the `Partial<Pick<User, ...>>` type.

#### Task 5: MODIFY `src/pages/SettingsPage.tsx`

**State** (line 24):
```typescript
// Before:
const [editSendingEmail, setEditSendingEmail] = useState(user?.sendingEmail || '')
// After:
const [editPrefix, setEditPrefix] = useState(user?.emailPrefix || '')
```

**Save handler** (line 92):
```typescript
// Before:
await updateProfile(user.id, { name: editName, sendingEmail: editSendingEmail })
// After:
await updateProfile(user.id, { name: editName, emailPrefix: editPrefix })
```

**Input field** (lines 130-136): Replace with prefix input + preview:
```tsx
<div className="space-y-2">
  <Label className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email Prefix</Label>
  <div className="flex items-center gap-2">
    <Input
      placeholder="e.g., nick"
      value={editPrefix}
      onChange={e => setEditPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
      className="max-w-[200px]"
    />
    <span className="text-sm text-muted-foreground">@integrateapi.ai</span>
  </div>
  {editPrefix && (
    <div className="text-xs text-muted-foreground space-y-0.5">
      <p>Compose & replies: <span className="text-foreground">{editPrefix}@integrateapi.ai</span></p>
      <p>Campaign sends: <span className="text-foreground">{editPrefix}@mail.integrateapi.ai</span></p>
    </div>
  )}
</div>
```

Note: The `onChange` handler sanitizes input to lowercase alphanumeric + dots/hyphens/underscores.

#### Task 6: MODIFY `supabase/functions/send-email/index.ts`

**Constants** (add at top, after imports):
```typescript
const EMAIL_DOMAIN = 'integrateapi.ai'
```

**Profile fetch** (line 48): change `sending_email` → `email_prefix`
```typescript
.select('email_prefix, name')
```

**Validation** (line 52): change to check `email_prefix`
```typescript
if (!profile?.email_prefix) {
  // ... 403 error unchanged
}
```

**From address derivation** (line 59):
```typescript
// Before:
const validFrom = profile.sending_email
// After:
const validFrom = `${profile.email_prefix}@${EMAIL_DOMAIN}`
```

No other changes needed — `validFrom` is used throughout the rest of the function.

#### Task 7: MODIFY `supabase/functions/process-campaigns/index.ts`

**Constants** (add at top, after imports):
```typescript
const EMAIL_DOMAIN = 'integrateapi.ai'
const CAMPAIGN_DOMAIN = 'mail.integrateapi.ai'
```

**Bulk campaign path — profile fetch** (line 151):
```typescript
.select('name, email_prefix')
```

**Validation** (line 155):
```typescript
if (!profile?.email_prefix) {
  console.error(`Campaign ${campaign.id}: sender has no email_prefix`)
  continue
}
```

**Bulk campaign — Resend payload** (line 273):
```typescript
// Before:
from: `${profile.name} <${profile.sending_email}>`,
// After:
from: `${profile.name} <${profile.email_prefix}@${CAMPAIGN_DOMAIN}>`,
headers: { 'Reply-To': `${profile.name} <${profile.email_prefix}@${EMAIL_DOMAIN}>` },
```

**Bulk campaign — DB insert** (line 302):
```typescript
// Before:
from: profile.sending_email,
// After:
from: `${profile.email_prefix}@${CAMPAIGN_DOMAIN}`,
```

**Drip path — profile fetch** (line 444):
```typescript
.select('name, email_prefix')
```

**Drip validation** (line 445):
```typescript
if (!profile?.email_prefix) continue
```

**Drip — Resend payload** (line 480):
```typescript
// Before:
from: `${profile.name} <${profile.sending_email}>`,
// After:
from: `${profile.name} <${profile.email_prefix}@${CAMPAIGN_DOMAIN}>`,
headers: { 'Reply-To': `${profile.name} <${profile.email_prefix}@${EMAIL_DOMAIN}>` },
```

**Drip — DB insert** (line 493):
```typescript
// Before:
from: profile.sending_email,
// After:
from: `${profile.email_prefix}@${CAMPAIGN_DOMAIN}`,
```

#### Task 7b: MODIFY `src/pages/OutreachPage.tsx`

4 references to `sendingEmail` that must change:

- **Line 148**: `if (!user?.sendingEmail)` → `if (!user?.emailPrefix)`
- **Line 168**: `from: user.sendingEmail` → `` from: `${user.emailPrefix}@integrateapi.ai` ``
- **Line 199**: `if (!user?.sendingEmail)` → `if (!user?.emailPrefix)`
- **Line 206**: `from: user.sendingEmail` → `` from: `${user.emailPrefix}@integrateapi.ai` ``
- **Line 416** (thread display): `user?.sendingEmail ?? msg.from` → `msg.from` (always use the stored `from` address — it reflects the actual domain the email was sent from, whether `mail.` or root)

#### Task 7c: MODIFY `src/pages/CampaignBuilderPage.tsx`

4 references to `sendingEmail` that must change. Campaign preview should show the `mail.` domain since that's what actually sends:

- **Line 106**: `if (!user?.sendingEmail)` → `if (!user?.emailPrefix)`
- **Line 347**: `user?.sendingEmail || 'not set'` → `` user?.emailPrefix ? `${user.emailPrefix}@mail.integrateapi.ai` : 'not set' ``
- **Line 363**: `!user?.sendingEmail` → `!user?.emailPrefix`
- **Lines 399/466**: `user?.sendingEmail` → `` `${user?.emailPrefix}@mail.integrateapi.ai` `` (or wherever these are used in the preview)

#### Task 8: MODIFY `supabase/functions/signup-with-token/index.ts`

**Lines 53-63**: Extract prefix from invite email instead of storing full email:
```typescript
// Before:
.update({ sending_email: invite.email })
// After:
.update({ email_prefix: invite.email.split('@')[0] })
```

Both occurrences (primary at line 56, retry at line 62).

#### Task 9: Grep for any remaining `sendingEmail` or `sending_email` references

Search the entire codebase for any straggling references and update them. Known locations are covered in Tasks 2-8, but there may be references in:
- `src/contexts/AuthContext.tsx` — `toCamelCase` handles the transform automatically, but check if `sendingEmail` is referenced explicitly
- `src/hooks/use-profiles.ts` — mutation type references
- `docs/schema.md` — update column documentation

#### Task 10: Deploy edge functions

```bash
supabase functions deploy send-email --no-verify-jwt
supabase functions deploy process-campaigns --no-verify-jwt
supabase functions deploy signup-with-token --no-verify-jwt
```

#### Task 11: Verify migration

```sql
SELECT id, email_prefix FROM profiles;
-- Confirm all values are prefix-only (no @ symbols)
```

## Deprecated Code to Remove

- `profiles.sending_email` column → renamed to `email_prefix`
- All `sendingEmail` references in TypeScript types → renamed to `emailPrefix`
- Full email storage in profiles → replaced by prefix-only storage

## Validation Loop

```bash
npx tsc --noEmit          # TypeScript compilation
npx eslint src/           # Lint check
```

## Backwards Compatibility Notes

- `mail.integrateapi.ai` domain stays fully active — not removing, only adding
- Existing emails in DB have `from: 'nick@mail.integrateapi.ai'` — display unchanged, no migration
- Existing threads use `In-Reply-To` / `References` headers — sender domain doesn't affect threading
- Old campaign emails without `Reply-To` header — replies go to `mail.` domain as before
- Inbound webhook is account-wide — handles both domains automatically

## Confidence: 9/10
