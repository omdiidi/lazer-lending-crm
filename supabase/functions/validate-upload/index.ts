/**
 * validate-upload Edge Function
 *
 * Accepts a CSV upload of lead emails, submits it to ZeroBounce's async bulk
 * file API, and returns a file_id. The frontend polls validate-upload-status
 * (or ZeroBounce calls a return_url webhook) to check completion.
 *
 * On completion (handled separately or via a follow-up POST to this same
 * function with action='finalize'), the function downloads the result CSV,
 * applies mapToDispatcherPolicy per row, inserts valid leads, and writes
 * hard-drop sub-statuses to unsubscribes.
 *
 * Request bodies:
 *   action='submit': { action, csv_base64, email_column_index? } → { file_id }
 *   action='status': { action, file_id }                         → { status, percent_complete }
 *   action='finalize': { action, file_id, campaign_id? }         → { total, valid, suppressed, by_substatus }
 */

import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { writeAlert } from '../_shared/alerts.ts'
import { mapToDispatcherPolicy, type ZeroBounceResult } from '../_shared/zerobounce.ts'
import { resolveUser } from '../_shared/auth.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const ZB_BULK_BASE = 'https://bulkapi.zerobounce.net/v2'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeEmail(email: string): string {
  // Full normalise (Gmail dot-insensitivity + plus-tag strip) lives in src/lib/email-normalize.ts.
  // Here we apply the safe server-side subset: lowercase + trim + strip plus-tags.
  const trimmed = email.toLowerCase().trim()
  const atIdx = trimmed.indexOf('@')
  if (atIdx === -1) return trimmed
  const local = trimmed.slice(0, atIdx).replace(/\+.*$/, '')
  const domain = trimmed.slice(atIdx)
  return local + domain
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// action: submit
// ---------------------------------------------------------------------------

async function handleSubmit(
  csvBase64: string,
  emailColumnIndex: number,
  apiKey: string,
): Promise<Response> {
  // Decode base64 CSV
  const csvBytes = Uint8Array.from(atob(csvBase64), c => c.charCodeAt(0))
  const csvBlob = new Blob([csvBytes], { type: 'text/csv' })

  const formData = new FormData()
  formData.append('api_key', apiKey)
  formData.append('file', csvBlob, 'leads.csv')
  formData.append('email_address_column', String(emailColumnIndex + 1)) // ZB is 1-indexed
  formData.append('has_header_row', 'true')
  formData.append('remove_duplicate', 'true')

  const res = await fetch(`${ZB_BULK_BASE}/sendfile`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const errText = await res.text()
    return json({ success: false, error: `ZeroBounce sendfile failed (${res.status}): ${errText.slice(0, 200)}` }, 502)
  }

  const data = await res.json() as { file_id?: string; message?: string }
  if (!data.file_id) {
    return json({ success: false, error: data.message ?? 'No file_id in ZeroBounce response' }, 502)
  }

  return json({ success: true, file_id: data.file_id })
}

// ---------------------------------------------------------------------------
// action: status
// ---------------------------------------------------------------------------

async function handleStatus(fileId: string, apiKey: string): Promise<Response> {
  const res = await fetch(
    `${ZB_BULK_BASE}/getfile?api_key=${apiKey}&file_id=${fileId}&status=true`,
  )
  if (!res.ok) {
    const errText = await res.text()
    return json({ success: false, error: `ZeroBounce status failed: ${errText.slice(0, 200)}` }, 502)
  }
  const data = await res.json() as { file_status?: string; percent_complete?: string | number }
  return json({
    success: true,
    status: data.file_status,
    percent_complete: data.percent_complete,
    complete: data.file_status === 'Complete',
  })
}

// ---------------------------------------------------------------------------
// action: finalize
// Parses the completed ZB result CSV, writes valid leads and suppressions.
// ---------------------------------------------------------------------------

interface FinalizeResult {
  total: number
  valid: number
  suppressed: number
  by_substatus: Record<string, number>
}

async function handleFinalize(
  fileId: string,
  apiKey: string,
  campaignId: string | undefined,
): Promise<Response> {
  // Download completed result file
  const res = await fetch(`${ZB_BULK_BASE}/getfile?api_key=${apiKey}&file_id=${fileId}`)
  if (!res.ok) {
    const errText = await res.text()
    return json({ success: false, error: `ZeroBounce getfile failed: ${errText.slice(0, 200)}` }, 502)
  }

  const csvText = await res.text()
  const rows = csvText.split('\n')
  if (rows.length < 2) {
    return json({ success: false, error: 'Empty or malformed result CSV from ZeroBounce' }, 502)
  }

  // Parse header row to find column indices. ZeroBounce's bulk result file keeps
  // the ORIGINAL email column header (e.g. "email") and appends validation columns
  // named "ZB Status", "ZB Sub Status", etc. — not "Email Address"/"ZeroBounce
  // Status". Accept every known spelling so recovery works regardless of source.
  const headers = rows[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''))
  const findIdx = (candidates: string[]) =>
    headers.findIndex(h => candidates.includes(h))

  let emailIdx          = findIdx(['email address', 'email', 'email_address', 'emailaddress'])
  const statusIdx       = findIdx(['zb status', 'zerobounce status', 'status'])
  const subStatusIdx    = findIdx(['zb sub status', 'sub status', 'zerobounce sub status', 'substatus'])
  const scoreIdx        = findIdx(['zb score', 'email score', 'score'])
  const activeInDaysIdx = findIdx(['zb active in days', 'active in days'])

  // Fallback: if no email header matched, detect the column that holds an address
  // by scanning the first data row for an "@".
  if (emailIdx === -1 && rows.length > 1) {
    const firstCols = rows[1].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    emailIdx = firstCols.findIndex(c => c.includes('@'))
  }

  if (emailIdx === -1) {
    return json({
      success: false,
      error: `ZeroBounce result CSV: could not locate an email column. Headers seen: ${headers.join(' | ')}`,
    }, 502)
  }

  const stats: FinalizeResult = { total: 0, valid: 0, suppressed: 0, by_substatus: {} }
  // `token` is NOT NULL + UNIQUE on unsubscribes (legacy unsub-link column). ZeroBounce
  // suppressions have no link token, so mint a unique random one per row.
  const suppressions: Array<{ email: string; email_normalized: string; reason: string; source_event_id: string; token: string }> = []
  const validLeadEmails: Array<{
    email: string
    email_normalized: string
    zerobounce_substatus: string
    zerobounce_score: number | null
    active_in_days: number | null
    last_validated_at: string
  }> = []

  const now = new Date().toISOString()

  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i].trim()
    if (!raw) continue

    const cols = raw.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const email = cols[emailIdx]?.toLowerCase().trim()
    if (!email) continue

    const zbResult: ZeroBounceResult = {
      status:       cols[statusIdx]      ?? 'unknown',
      sub_status:   cols[subStatusIdx]   ?? '',
      score:        scoreIdx        !== -1 ? parseInt(cols[scoreIdx], 10) || undefined : undefined,
      active_in_days: activeInDaysIdx !== -1 ? parseInt(cols[activeInDaysIdx], 10) || undefined : undefined,
    }

    const policy = mapToDispatcherPolicy(zbResult)
    const sub = zbResult.sub_status || 'none'

    stats.total++
    stats.by_substatus[sub] = (stats.by_substatus[sub] ?? 0) + 1

    if (policy.action === 'drop') {
      stats.suppressed++
      suppressions.push({
        email,
        email_normalized: normalizeEmail(email),
        reason:           'zerobounce',
        source_event_id:  `zb:upload:${zbResult.status}:${sub}`,
        token:            crypto.randomUUID(),
      })
    } else {
      stats.valid++
      validLeadEmails.push({
        email,
        email_normalized:    normalizeEmail(email),
        zerobounce_substatus: zbResult.sub_status,
        zerobounce_score:    zbResult.score ?? null,
        active_in_days:      zbResult.active_in_days ?? null,
        last_validated_at:   now,
      })
    }
  }

  // Batch-insert suppressions (ignore duplicates via ON CONFLICT)
  if (suppressions.length > 0) {
    // Insert in batches of 500 to avoid payload limits
    for (let i = 0; i < suppressions.length; i += 500) {
      const batch = suppressions.slice(i, i + 500)
      const { error } = await supabaseAdmin.from('unsubscribes').insert(batch)
      if (error && error.code !== '23505') {
        console.error('Failed to insert ZB suppressions batch:', error)
        await writeAlert(supabaseAdmin, {
          type: 'error',
          source: 'validate-upload',
          message: `Failed to write ${batch.length} ZeroBounce suppressions`,
          details: { error: error.message, file_id: fileId },
        })
      }
    }
  }

  // Upsert valid leads' ZB fields onto existing lead rows (matched by email_normalized).
  // We update only — we do NOT auto-create leads from a raw file upload; that's a
  // separate step where the operator reviews and confirms the import.
  if (validLeadEmails.length > 0) {
    for (let i = 0; i < validLeadEmails.length; i += 500) {
      const batch = validLeadEmails.slice(i, i + 500)
      const norms = batch.map(l => l.email_normalized)
      const { error } = await supabaseAdmin
        .from('leads')
        .update({
          last_validated_at: now,
          // Per-row updates would require individual queries; here we set the
          // validation timestamp for all matched leads. Sub-status + score differ per lead;
          // for the batch path we write them per-email in a follow-up upsert.
        })
        .in('email_normalized', norms)

      if (error) {
        console.error('Failed to update lead validation timestamps:', error)
      }

      // Write per-lead ZB detail
      for (const ld of batch) {
        const { error: perErr } = await supabaseAdmin
          .from('leads')
          .update({
            zerobounce_substatus: ld.zerobounce_substatus,
            zerobounce_score:     ld.zerobounce_score,
            active_in_days:       ld.active_in_days,
            last_validated_at:    ld.last_validated_at,
          })
          .eq('email_normalized', ld.email_normalized)

        if (perErr && perErr.code !== 'PGRST116') { // PGRST116 = no rows (not yet imported)
          console.error('Failed to update lead ZB detail:', perErr)
        }
      }
    }
  }

  return json({ success: true, ...stats })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ZEROBOUNCE_API_KEY = Deno.env.get('ZEROBOUNCE_API_KEY')
    if (!ZEROBOUNCE_API_KEY) {
      return json({ success: false, error: 'ZEROBOUNCE_API_KEY not configured' }, 500)
    }

    const authHeader = req.headers.get('Authorization')
    try {
      await resolveUser(authHeader, supabaseAdmin)
    } catch (e) {
      return json({ success: false, error: (e as Error).message }, 401)
    }

    const body = await req.json() as {
      action: 'submit' | 'status' | 'finalize'
      csv_base64?: string
      email_column_index?: number
      file_id?: string
      campaign_id?: string
    }

    switch (body.action) {
      case 'submit':
        if (!body.csv_base64) return json({ success: false, error: 'csv_base64 required' }, 400)
        return handleSubmit(body.csv_base64, body.email_column_index ?? 0, ZEROBOUNCE_API_KEY)

      case 'status':
        if (!body.file_id) return json({ success: false, error: 'file_id required' }, 400)
        return handleStatus(body.file_id, ZEROBOUNCE_API_KEY)

      case 'finalize':
        if (!body.file_id) return json({ success: false, error: 'file_id required' }, 400)
        return handleFinalize(body.file_id, ZEROBOUNCE_API_KEY, body.campaign_id)

      default:
        return json({ success: false, error: `Unknown action: ${(body as { action?: string }).action}` }, 400)
    }
  } catch (err) {
    console.error('validate-upload error:', err)
    return json({ success: false, error: (err as Error).message ?? 'Internal server error' }, 500)
  }
})
