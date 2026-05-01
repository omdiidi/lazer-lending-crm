# Plan: Email User Isolation

## Goal

Add per-user email isolation so each user only sees their own emails. Admins get an additional "All Emails" tab to see everything. Currently all logged-in users see all emails.

## Why

- Any logged-in user can see every email in the system — no user scoping
- RLS policy only checks `auth.uid() IS NOT NULL`
- `emails` table has no `user_id` column

## What

- Add `user_id` column to `emails` table
- Tighten RLS to `user_id = auth.uid()` (admins bypass via `is_admin()`)
- Set `user_id` on every email insert path (send-email, process-campaigns, email-events)
- Backfill existing emails
- Add admin-only "All Emails" tab on OutreachPage

### Success Criteria

- [ ] Each user only sees emails they sent or received
- [ ] Both domains (integrateapi.ai + mail.integrateapi.ai) map to the same user
- [ ] Admin sees "All Emails" tab with every email across users
- [ ] Non-admin does NOT see "All Emails" tab
- [ ] Inbound emails correctly assigned to the right user
- [ ] Campaign emails assigned to the campaign sender
- [ ] Existing emails backfilled with correct user_id

## Files Being Changed

```
supabase/functions/send-email/index.ts          ← MODIFIED (add user_id to insert)
supabase/functions/process-campaigns/index.ts    ← MODIFIED (add user_id to inserts)
supabase/functions/email-events/index.ts         ← MODIFIED (lookup user_id from to address)
src/pages/OutreachPage.tsx                       ← MODIFIED (add All Emails admin tab)
src/types/database.ts                            ← MODIFIED (add user_id to emails types)
DB migration (via SQL)                           ← NEW (add column, backfill, RLS)
```

## Architecture Overview

**Ownership model:** Every email gets a `user_id` = the user who sent it (outbound) or the user it was sent to (inbound). Since each user has two addresses (`{prefix}@integrateapi.ai` and `{prefix}@mail.integrateapi.ai`), ownership is determined by matching the email prefix against `profiles.email_prefix`, NOT by exact address match.

**RLS:** The existing `is_admin()` function (already used on leads, activities, etc.) provides the admin bypass pattern. SELECT policy: `user_id = auth.uid() OR is_admin()`. But the admin "All Emails" tab needs all emails — so the RLS just needs to allow admins to see everything.

**Inbound lookup:** `email-events` receives a `to` address like `nick@mail.integrateapi.ai`. Extract the prefix (`nick`), look up `profiles.email_prefix = 'nick'` → get the user's `id`. Set as `user_id`.

## Tasks

### Task 1: DB migration — add column, backfill, update RLS

```sql
-- Add user_id column
ALTER TABLE emails ADD COLUMN user_id uuid REFERENCES auth.users(id);

-- Backfill: match outbound emails by from address prefix
UPDATE emails e
SET user_id = p.id
FROM profiles p
WHERE e.direction = 'outbound'
  AND e.user_id IS NULL
  AND split_part(e."from", '@', 1) = p.email_prefix;

-- Backfill: match inbound emails by to address prefix
UPDATE emails e
SET user_id = p.id
FROM profiles p
WHERE e.direction = 'inbound'
  AND e.user_id IS NULL
  AND split_part(e."to", '@', 1) = p.email_prefix;

-- Backfill: match campaign emails by campaign.sent_by
UPDATE emails e
SET user_id = c.sent_by
FROM campaigns c
WHERE e.campaign_id = c.id
  AND e.direction = 'outbound'
  AND e.user_id IS NULL;

-- Drop old RLS policies
DROP POLICY IF EXISTS emails_select ON emails;
DROP POLICY IF EXISTS emails_insert ON emails;
DROP POLICY IF EXISTS emails_update ON emails;

-- New RLS policies
CREATE POLICY emails_select ON emails FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY emails_insert ON emails FOR INSERT
  WITH CHECK (user_id = auth.uid() OR is_admin());

CREATE POLICY emails_update ON emails FOR UPDATE
  USING (user_id = auth.uid() OR is_admin())
  WITH CHECK (auth.uid() IS NOT NULL);
```

### Task 2: MODIFY `src/types/database.ts`

Add `user_id` to the emails Row, Insert, and Update types:
- Row: `user_id: string | null`
- Insert: `user_id?: string | null`
- Update: `user_id?: string | null`

### Task 3: MODIFY `supabase/functions/send-email/index.ts`

**Single send insert** (~line 135): Add `user_id: authUser.id` to the email insert object.

**Batch send insert** (~line 198): Add `user_id: authUser.id` to each row in the batch insert.

`authUser` is already available from line 40: `const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt)`

### Task 4: MODIFY `supabase/functions/process-campaigns/index.ts`

**Bulk campaign email insert** (~line 301): Add `user_id: campaign.sent_by` to each emailRow.

**Drip email insert** (~line 493): Add `user_id: campaign.sent_by` to the insert object.

`campaign.sent_by` is already available from the campaign query.

### Task 5: MODIFY `supabase/functions/email-events/index.ts`

When inserting an inbound email, look up the user by matching the `to` address prefix:

**Before the insert** (~line 245), add a user lookup:
```typescript
// Extract prefix from to address and find user
const toPrefix = toEmail.split('@')[0]
const { data: toProfile } = await supabaseAdmin
  .from('profiles')
  .select('id')
  .eq('email_prefix', toPrefix)
  .maybeSingle()
const emailUserId = toProfile?.id || null
```

**In the insert** (~line 245-257): Add `user_id: emailUserId` to the insert object.

Note: `toEmail` is already parsed from the webhook payload earlier in the function. The `supabaseAdmin` client is already available (service role, bypasses RLS).

### Task 6: MODIFY `src/pages/OutreachPage.tsx`

**Add "All Emails" tab for admins:**

The user's role is available via `useAuth()` (line 48). Add:

Destructure `isAdmin` from `useAuth()` (already computed in AuthContext). Change line 48 from `const { user } = useAuth()` to `const { user, isAdmin } = useAuth()`. Do NOT add a local `const isAdmin` — use the hook value.

In the TabsList (~line 269-274), add conditionally:
```tsx
{isAdmin && <TabsTrigger value="all-emails">All Emails</TabsTrigger>}
```

For the "All Emails" tab content, the existing `emails` data from `useEmails()` will automatically be user-scoped by RLS. The admin tab needs ALL emails. Two approaches:

**Query approach:** Add a `userId` parameter to `getEmails()` so it filters at the DB level:

```typescript
// src/lib/api/emails.ts
export async function getEmails(userId?: string) {
  let query = supabase.from('emails').select('*').is('deleted_at', null).order('sent_at', { ascending: false })
  if (userId) query = query.eq('user_id', userId)
  const { data, error } = await query
  // ...
}
```

- **Inbox/Sent tabs**: call `getEmails(user.id)` — only the user's emails
- **All Emails admin tab**: call `getEmails()` — no user filter, RLS allows admin to see all

This keeps queries fast at the DB level instead of fetching everything and filtering client-side.

**In `useEmails` hook:** Add `userId` parameter, pass to `getEmails`. The OutreachPage will call `useEmails(user.id)` for the personal inbox. For the admin "All Emails" tab, use a separate `useEmails()` call (no userId) or a second query.

Simplest: use two separate queries in OutreachPage:
```typescript
const { emails: myEmails } = useEmails(user?.id)  // personal inbox
const { emails: allEmails } = useAllEmails()       // admin tab only, lazy-loaded
```

Or simpler: one `useEmails` with a `userId` param that changes based on the active tab:
```typescript
const showAll = isAdmin && tab === 'all-emails'
const { emails } = useEmails(showAll ? undefined : user?.id)
```

Use the single-query approach — less code, queryKey includes the userId so cache is separate.

**For the "All Emails" tab content:** Render the same thread list layout but with all emails. Show the sender's from address alongside each thread so the admin knows whose conversation it is.

### Task 7: Deploy edge functions

```bash
supabase functions deploy send-email --no-verify-jwt
supabase functions deploy process-campaigns --no-verify-jwt
supabase functions deploy email-events --no-verify-jwt
```

### Task 8: Verify backfill

```sql
SELECT user_id IS NOT NULL as has_user, count(*)
FROM emails GROUP BY 1;
-- Should show all or nearly all emails have a user_id
```

## Validation

```bash
npx tsc --noEmit
```

After deploy, test:
1. Log in as Nick — should only see Nick's emails in inbox
2. Log in as Omid — should only see Omid's emails (likely none)
3. Admin should see "All Emails" tab with everything

## Confidence: 9/10
