/**
 * mailbox-cap-reset/index.ts
 * Task 1.16 — Hourly cron: reset today_enrolled_count and today_sent_count at mailbox-local midnight.
 *
 * Idempotency: only resets if last_reset_at < "today's midnight at the mailbox's local timezone".
 * Re-running within the same hour → no-op (the WHERE condition excludes already-reset mailboxes).
 *
 * The SQL condition:
 *   last_reset_at < date_trunc('day', now() AT TIME ZONE timezone) AT TIME ZONE timezone
 * means: last reset was before today's midnight in the mailbox's local time → needs reset.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { writeAlert } from '../_shared/alerts.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Atomic idempotent reset:
    // Reset both today_enrolled_count and today_sent_count to 0 for mailboxes where
    // last_reset_at is before "today's midnight in the mailbox's local timezone".
    //
    // The expression:
    //   date_trunc('day', now() AT TIME ZONE timezone) AT TIME ZONE timezone
    // converts UTC "now" to the mailbox's local timezone, truncates to midnight,
    // then converts THAT timestamp back to UTC for comparison with last_reset_at (stored as UTC).
    //
    // This means a Phoenix (UTC-7) mailbox resets at 07:00 UTC (midnight Phoenix time).
    // An ET (UTC-5) mailbox resets at 05:00 UTC.
    //
    // NULL last_reset_at (never reset before) always satisfies the condition.
    //
    // We use the Supabase RPC to run this as a single atomic UPDATE with RETURNING
    // so we can report how many mailboxes were reset.

    const { data, error } = await supabaseAdmin.rpc('reset_mailbox_daily_counts', {})

    if (error) {
      // Fallback: try direct Supabase table update with JS-side filtering.
      // This is less efficient but works if the RPC doesn't exist yet.
      console.warn('mailbox-cap-reset: reset_mailbox_daily_counts RPC not available, using fallback', error)

      const resetResult = await fallbackReset(supabaseAdmin)
      return new Response(
        JSON.stringify({
          success: true,
          mailboxesReset: resetResult.count,
          method: 'fallback',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const resetCount: number = data ?? 0
    console.log(`mailbox-cap-reset: reset ${resetCount} mailboxes`)

    return new Response(
      JSON.stringify({ success: true, mailboxesReset: resetCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('mailbox-cap-reset error', err)

    // Write a system alert — cap-reset failure means daily counts won't reset
    // which blocks enrollment at next cron tick
    try {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      await writeAlert(supabaseAdmin, {
        type: 'error',
        source: 'mailbox-cap-reset',
        message: 'Mailbox daily cap reset failed — enrollment may be blocked',
        details: { error: String(err) },
      })
    } catch {
      // ignore secondary failure
    }

    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ---------------------------------------------------------------------------
// Fallback reset: JS-side timezone filtering when the RPC is unavailable.
// Less efficient (fetches all mailboxes, filters in JS, batch-updates).
// This path only activates if reset_mailbox_daily_counts RPC doesn't exist.
// ---------------------------------------------------------------------------
async function fallbackReset(
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<{ count: number }> {
  // Fetch all non-retired mailboxes with their timezone and last_reset_at
  const { data: mailboxes, error: mbErr } = await supabaseAdmin
    .from('mailboxes')
    .select('id, timezone, last_reset_at, today_enrolled_count, today_sent_count')
    .not('warmup_state', 'eq', 'failed')

  if (mbErr || !mailboxes) {
    console.error('mailbox-cap-reset fallback: failed to fetch mailboxes', mbErr)
    return { count: 0 }
  }

  const now = new Date()
  const toReset: string[] = []

  for (const mb of mailboxes) {
    const tz = mb.timezone ?? 'America/Phoenix'

    // Compute "today's midnight" in the mailbox's local timezone as a UTC Date
    const localMidnightUTC = localMidnightAsUtc(now, tz)

    const lastReset = mb.last_reset_at ? new Date(mb.last_reset_at) : null

    // Reset if: never reset OR last reset was before today's local midnight
    if (!lastReset || lastReset < localMidnightUTC) {
      toReset.push(mb.id)
    }
  }

  if (toReset.length === 0) {
    console.log('mailbox-cap-reset fallback: no mailboxes need reset at this time')
    return { count: 0 }
  }

  // Batch update in chunks of 100
  const CHUNK = 100
  let totalReset = 0
  const now_iso = now.toISOString()

  for (let i = 0; i < toReset.length; i += CHUNK) {
    const chunk = toReset.slice(i, i + CHUNK)
    const { error: updateErr } = await supabaseAdmin
      .from('mailboxes')
      .update({
        today_enrolled_count: 0,
        today_sent_count: 0,
        last_reset_at: now_iso,
        updated_at: now_iso,
      })
      .in('id', chunk)

    if (updateErr) {
      console.error('mailbox-cap-reset fallback: batch update failed', updateErr)
    } else {
      totalReset += chunk.length
    }
  }

  console.log(`mailbox-cap-reset fallback: reset ${totalReset} mailboxes`)
  return { count: totalReset }
}

/**
 * Compute the UTC timestamp corresponding to "today's midnight" in the given IANA timezone.
 * E.g. for America/Phoenix (UTC-7), midnight = 07:00 UTC.
 */
function localMidnightAsUtc(utcNow: Date, timezone: string): Date {
  try {
    // Get the current local date string in the target timezone (YYYY-MM-DD)
    const localDateStr = utcNow.toLocaleDateString('en-CA', { timeZone: timezone })
    // "en-CA" gives ISO date format: YYYY-MM-DD
    // Parse as midnight in the target timezone by using Intl.DateTimeFormat offset
    // Simple approach: interpret localDateStr as local midnight, convert back to UTC
    const [year, month, day] = localDateStr.split('-').map(Number)

    // Create a date object at midnight in the target timezone via the formatter offset
    // We use the format trick: find the UTC offset at that local midnight
    const candidateUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))

    // Find the UTC offset by checking what local time this UTC corresponds to
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(candidateUtc)

    const localHour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0')
    const localMinute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0')

    // Adjust: if candidateUtc maps to localHour:localMinute != 00:00, correct
    // If localHour is 0 and localMinute is 0, candidateUtc IS the local midnight UTC
    // Otherwise, subtract the offset
    const offsetMs = (localHour * 60 + localMinute) * 60 * 1000
    const correctedMidnightUtc = new Date(candidateUtc.getTime() - offsetMs)

    return correctedMidnightUtc
  } catch {
    // Fallback: use UTC midnight if timezone parsing fails
    const d = new Date(utcNow)
    d.setUTCHours(0, 0, 0, 0)
    return d
  }
}
