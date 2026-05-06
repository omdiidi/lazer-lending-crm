/**
 * ZeroBounce shared helpers — Deno-compatible.
 *
 * Provides:
 *   validateSingleEmail(email, opts) — single-email validation with activity_data
 *   mapToDispatcherPolicy(zbResult)  — sub-status → dispatch policy
 *
 * Sub-status policy table implemented per VENDOR-CONTRACTS.md §3.
 * Any sub-status not explicitly listed falls through to 'allow_warn' for safety.
 */

// ---------------------------------------------------------------------------
// ZeroBounce API response types
// ---------------------------------------------------------------------------

export interface ZeroBounceResult {
  /** 'valid' | 'invalid' | 'catch-all' | 'unknown' | 'spamtrap' | 'abuse' | 'do_not_mail' */
  status: string
  /** Sub-status — see policy table below. */
  sub_status: string
  /** 0–10 email quality score (activity_data=true adds recency signal). */
  score?: number
  /** Days since last inbox activity; -1 = no data. */
  active_in_days?: number
  /** Typo correction suggestion e.g. 'gmail.com' for 'gmial.com'. */
  did_you_mean?: string
  /** The normalised email address as returned by ZB. */
  address?: string
}

// ---------------------------------------------------------------------------
// Dispatcher policy
// ---------------------------------------------------------------------------

export type DispatchAction = 'allow' | 'allow_warn' | 'drop' | 'retry' | 'manual_review'

export interface DispatcherPolicy {
  action: DispatchAction
  reason: string
  /** Populated when action='drop'. Written to unsubscribes.reason. */
  suppression_reason?: 'zerobounce' | 'hard_bounce'
}

/**
 * Maps a ZeroBounce result to a dispatcher policy.
 *
 * Policy table (per VENDOR-CONTRACTS.md §3):
 *
 * status         sub_status               action        suppression_reason
 * ----------     ----------------------   ----------    ------------------
 * valid          (any)                    allow
 * catch-all      (any)                    allow_warn
 * unknown        greylisted               retry         (re-check 24-48h)
 * unknown        (other)                  allow_warn
 * invalid        mailbox_not_found        drop          zerobounce
 * invalid        disposable               drop          zerobounce
 * invalid        syntax_error             drop          zerobounce
 * invalid        mail_server_does_not_exist drop        zerobounce
 * invalid        possible_typo            manual_review
 * invalid        (other)                  drop          zerobounce
 * spamtrap       (any)                    drop          zerobounce
 * abuse          (any)                    drop          zerobounce
 * do_not_mail    role_based               drop          zerobounce
 * do_not_mail    (any)                    drop          zerobounce
 */
export function mapToDispatcherPolicy(zb: ZeroBounceResult): DispatcherPolicy {
  const { status, sub_status } = zb
  const sub = (sub_status ?? '').toLowerCase()

  // Always-drop categories — hard suppression
  if (status === 'spamtrap') {
    return { action: 'drop', reason: 'spamtrap', suppression_reason: 'zerobounce' }
  }
  if (status === 'abuse') {
    return { action: 'drop', reason: 'abuse_mailbox', suppression_reason: 'zerobounce' }
  }
  if (status === 'do_not_mail') {
    return { action: 'drop', reason: `do_not_mail:${sub}`, suppression_reason: 'zerobounce' }
  }

  if (status === 'invalid') {
    if (sub === 'possible_typo') {
      return { action: 'manual_review', reason: 'possible_typo_review' }
    }
    return {
      action: 'drop',
      reason: `invalid:${sub || 'unknown'}`,
      suppression_reason: 'zerobounce',
    }
  }

  if (status === 'unknown') {
    if (sub === 'greylisted') {
      return { action: 'retry', reason: 'greylisted_retry_24_48h' }
    }
    return { action: 'allow_warn', reason: `unknown:${sub || 'unresolvable'}` }
  }

  if (status === 'catch-all') {
    return { action: 'allow_warn', reason: 'catch_all_unverifiable' }
  }

  if (status === 'valid') {
    return { action: 'allow', reason: 'valid' }
  }

  // Unrecognised status — allow with warning so we don't silently drop
  return { action: 'allow_warn', reason: `unknown_status:${status}` }
}

// ---------------------------------------------------------------------------
// Single-email validation
// ---------------------------------------------------------------------------

export async function validateSingleEmail(
  email: string,
  opts: { apiKey: string },
): Promise<ZeroBounceResult> {
  const url = `https://api.zerobounce.net/v2/validate?api_key=${opts.apiKey}&email=${encodeURIComponent(email)}&activity_data=true`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`ZeroBounce validation failed (HTTP ${res.status})`)
  }
  return res.json() as Promise<ZeroBounceResult>
}
