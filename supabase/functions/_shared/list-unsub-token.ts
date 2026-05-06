/**
 * List-Unsubscribe HMAC token helpers — Deno-compatible.
 * Canonical Deno copy for Edge Functions.
 *
 * The src/lib/list-unsub-token.ts file is the Vite-bundled version for
 * browser/Node usage. These files share the same logic; keep them in sync.
 *
 * Token format: base64url(json_payload) + '.' + base64url(hmac_sha256_sig)
 *
 * Uses Web Crypto API (crypto.subtle) — available natively in Deno.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnsubTokenPayload {
  lead_id: string
  campaign_id: string
  mailbox_id: string
  email: string
  /** Unix timestamp (seconds) after which the token is considered expired. */
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
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '===='.slice((str.length % 4) || 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function signUnsubToken(
  payload: UnsubTokenPayload,
  secret: string,
): Promise<string> {
  const payloadB64 = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  const key = await importHmacKey(secret)
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64))
  return `${payloadB64}.${base64urlEncode(new Uint8Array(sigBytes))}`
}

export async function verifyUnsubToken(
  token: string,
  secret: string,
): Promise<UnsubTokenPayload | null> {
  const dotIdx = token.lastIndexOf('.')
  if (dotIdx === -1) return null

  const payloadB64 = token.slice(0, dotIdx)
  const sigB64 = token.slice(dotIdx + 1)

  try {
    const key = await importHmacKey(secret)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlDecode(sigB64),
      new TextEncoder().encode(payloadB64),
    )
    if (!valid) return null

    const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64))
    return JSON.parse(payloadJson) as UnsubTokenPayload
  } catch {
    return null
  }
}

const DEFAULT_TTL_DAYS = 1825

export async function buildUnsubUrl(
  params: Omit<UnsubTokenPayload, 'expiry_unix'>,
  siteUrl: string,
  secret: string,
): Promise<string> {
  const ttlDays =
    parseInt(Deno.env.get('LIST_UNSUB_TOKEN_TTL_DAYS') ?? String(DEFAULT_TTL_DAYS), 10) ||
    DEFAULT_TTL_DAYS
  const expiryUnix = Math.floor(Date.now() / 1000) + ttlDays * 86400
  const token = await signUnsubToken({ ...params, expiry_unix: expiryUnix }, secret)
  return `${siteUrl.replace(/\/$/, '')}/api/list-unsubscribe?t=${encodeURIComponent(token)}`
}
