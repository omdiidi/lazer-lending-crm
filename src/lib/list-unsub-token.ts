/**
 * List-Unsubscribe HMAC token helpers.
 *
 * Uses Web Crypto API (crypto.subtle) which is available in both:
 *   - Deno Edge Functions (native)
 *   - Vite/browser bundles (via globalThis.crypto in modern browsers)
 *   - Vitest with jsdom (polyfilled)
 *
 * Token format: base64url(json_payload) + '.' + base64url(hmac_sha256_sig)
 *
 * Payload: { lead_id, campaign_id, mailbox_id, email, expiry_unix }
 *
 * Token TTL: configurable via LIST_UNSUB_TOKEN_TTL_DAYS (default 1825 = 5 years).
 * Tokens are stateless — no DB row required. Re-submits are idempotent because the
 * unsubscribe endpoint uses upsert semantics.
 *
 * IMPORTANT: If LIST_UNSUB_TOKEN_SECRET is rotated, outstanding links break (CAN-SPAM
 * violation). Before rotating: batch-sign all outstanding tokens with the new secret OR
 * insert legacy UUID rows for them. See PLAN.md §1.10 token rotation note.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnsubTokenPayload {
  lead_id: string
  campaign_id: string
  mailbox_id: string
  email: string
  /** Unix timestamp (seconds) after which the token is invalid. */
  expiry_unix: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function base64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlDecode(str: string): Uint8Array {
  // Pad to multiple of 4
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '===='.slice((str.length % 4) || 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const keyBytes = new TextEncoder().encode(secret)
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sign a payload and return a compact token string.
 *
 * @param payload  Unsubscribe context (lead, campaign, mailbox, expiry)
 * @param secret   Value of LIST_UNSUB_TOKEN_SECRET env var
 * @returns        token string — safe to embed in URLs and List-Unsubscribe headers
 */
export async function signUnsubToken(
  payload: UnsubTokenPayload,
  secret: string,
): Promise<string> {
  const payloadJson = JSON.stringify(payload)
  const payloadB64 = base64urlEncode(new TextEncoder().encode(payloadJson))

  const key = await importHmacKey(secret)
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64))

  return `${payloadB64}.${base64urlEncode(new Uint8Array(sigBytes))}`
}

/**
 * Verify a token and return the parsed payload.
 *
 * Returns null if:
 *   - Token is malformed / missing the dot separator
 *   - HMAC signature does not match
 *
 * NOTE: does NOT check expiry_unix — callers must check this themselves,
 * because expired tokens should still be idempotently accepted (the lead
 * was already supposed to be unsubscribed via the original link click).
 * Only hard-reject expired tokens if the link is being used to opt *back in*.
 */
export async function verifyUnsubToken(
  token: string,
  secret: string,
): Promise<UnsubTokenPayload | null> {
  const dotIdx = token.lastIndexOf('.')
  if (dotIdx === -1) return null

  const payloadB64 = token.slice(0, dotIdx)
  const sigB64 = token.slice(dotIdx + 1)

  try {
    const sigBytes = base64urlDecode(sigB64)
    const key = await importHmacKey(secret)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(payloadB64),
    )
    if (!valid) return null

    const payloadBytes = base64urlDecode(payloadB64)
    const payloadJson = new TextDecoder().decode(payloadBytes)
    return JSON.parse(payloadJson) as UnsubTokenPayload
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Token generation helper (for use in send-email / process-campaigns)
// ---------------------------------------------------------------------------

const DEFAULT_TTL_DAYS = 1825 // 5 years

/**
 * Build a signed unsubscribe URL for embedding in cold email bodies
 * and List-Unsubscribe headers.
 *
 * Only used for the Smartlead (cold) campaign path. The Resend transactional
 * path keeps the existing UUID pattern.
 *
 * @param params    Lead + campaign context
 * @param siteUrl   SITE_URL env var value
 * @param secret    LIST_UNSUB_TOKEN_SECRET env var value
 * @returns         Full https URL including ?t= token query param
 */
export async function buildUnsubUrl(
  params: Omit<UnsubTokenPayload, 'expiry_unix'>,
  siteUrl: string,
  secret: string,
  ttlDays = DEFAULT_TTL_DAYS,
): Promise<string> {
  const expiryUnix = Math.floor(Date.now() / 1000) + ttlDays * 86400
  const payload: UnsubTokenPayload = { ...params, expiry_unix: expiryUnix }
  const token = await signUnsubToken(payload, secret)
  return `${siteUrl.replace(/\/$/, '')}/api/list-unsubscribe?t=${encodeURIComponent(token)}`
}
