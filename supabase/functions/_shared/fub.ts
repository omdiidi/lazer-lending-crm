/**
 * Follow Up Boss API client — Deno-compatible, used by Edge Functions.
 *
 * Authentication:
 *   HTTP Basic Auth: username = FUB_API_KEY, password = '' (blank).
 *   Required headers on every request:
 *     X-System: FUB_X_SYSTEM env var (e.g. 'lazer-lending-crm')
 *     X-System-Key: FUB_X_SYSTEM_KEY env var
 *
 * CRITICAL: Use POST /v1/events for all lead pushes.
 * NEVER use POST /v1/people — it bypasses automations and creates duplicates.
 * Source: VENDOR-CONTRACTS.md §4, FUB Lead Provider Integration Guide.
 *
 * Rate limits (with valid X-System-Key):
 *   notes: 10/10s  ← binding constraint; enforced by token bucket in addNote.
 *   events POST: unlimited
 *   global: 250/10s
 *
 * Typed errors:
 *   FubRateLimited(retryAfterMs)
 *   FubAuthError(message)
 *   FubArchived  — HTTP 204 = FUB silently suppressed the lead (log + alert, not a success)
 *
 * Sandbox verification items:
 *   F1: Confirm `occurredAt` >24h in past disables automations (P4 in VENDOR-CONTRACTS).
 *   F2: Confirm stage string (not ID) maps correctly via GET /v1/stages.
 *   F3: Confirm `X-System-Key` is issued by FUB support (not self-generated).
 */

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class FubRateLimited extends Error {
  readonly retryAfterMs: number
  constructor(retryAfterMs: number) {
    super(`FUB rate limited — retry after ${retryAfterMs}ms`)
    this.name = 'FubRateLimited'
    this.retryAfterMs = retryAfterMs
  }
}

export class FubAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FubAuthError'
  }
}

export class FubArchived extends Error {
  constructor() {
    super('FUB archived/ignored the lead push (HTTP 204 — suppression rule matched)')
    this.name = 'FubArchived'
  }
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export interface FubEmailEntry {
  type: 'work' | 'home' | 'other';
  value: string;
}

export interface FubPhoneEntry {
  type: 'work' | 'mobile' | 'home' | 'other';
  value: string;
}

export interface FubEventPayload {
  source: string;
  type: string;
  occurredAt?: string; // ISO-8601; MUST NOT be >24h in the past (P4)
  message?: string;
  uri?: string;
  person: {
    firstName?: string;
    lastName?: string;
    emails: FubEmailEntry[];
    phones?: FubPhoneEntry[];
    stage?: string; // Stage NAME (string), not ID (P9)
    tags?: string[];
  };
}

export interface FubEventResponse {
  /** HTTP status of the underlying push */
  status: 200 | 201 | 204;
  /** FUB person ID — set on 200 (updated) and 201 (created) */
  person_id?: number;
  /** FUB event ID from the response body */
  event_id?: number;
}

export interface FubStage {
  id: number;
  name: string;
  pipelineId: number;
}

export interface FubPipeline {
  id: number;
  name: string;
}

export interface FubCustomField {
  id: number;
  label: string;
  name: string; // machine name
  type: string;
}

export interface FubNotePayload {
  personId: number;
  subject: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Token bucket for notes rate limiting (10/10s)
// ---------------------------------------------------------------------------

class TokenBucket {
  private tokens: number
  private readonly maxTokens: number
  private readonly refillRateMs: number  // ms per token
  private lastRefill: number

  constructor(maxTokens: number, windowMs: number) {
    this.maxTokens = maxTokens
    this.tokens = maxTokens
    this.refillRateMs = windowMs / maxTokens
    this.lastRefill = Date.now()
  }

  /** Wait until a token is available, then consume it. */
  async consume(): Promise<void> {
    // Refill tokens based on elapsed time
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const refilled = Math.floor(elapsed / this.refillRateMs)
    if (refilled > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + refilled)
      this.lastRefill = now
    }

    if (this.tokens > 0) {
      this.tokens--
      return
    }

    // Wait for next token
    const waitMs = this.refillRateMs - (Date.now() - this.lastRefill)
    await new Promise(r => setTimeout(r, Math.max(0, waitMs)))
    this.tokens = Math.max(0, this.tokens - 1)
  }
}

// ---------------------------------------------------------------------------
// FubClient
// ---------------------------------------------------------------------------

export class FubClient {
  private readonly baseUrl: string
  private readonly authHeader: string
  private readonly systemHeader: string
  private readonly systemKeyHeader: string
  private readonly notesBucket: TokenBucket

  constructor() {
    const apiKey = Deno.env.get('FUB_API_KEY')
    const xSystem = Deno.env.get('FUB_X_SYSTEM') ?? 'lazer-lending-crm'
    const xSystemKey = Deno.env.get('FUB_X_SYSTEM_KEY')

    if (!apiKey) throw new Error('FUB_API_KEY env var not set')
    if (!xSystemKey) throw new Error('FUB_X_SYSTEM_KEY env var not set — register with FUB support (B_FUB_SETUP blocker)')

    // HTTP Basic Auth: username=apiKey, password='' (blank)
    this.authHeader = 'Basic ' + btoa(`${apiKey}:`)
    this.systemHeader = xSystem
    this.systemKeyHeader = xSystemKey
    this.baseUrl = 'https://api.followupboss.com'

    // Notes rate limit: 10 requests per 10-second window
    this.notesBucket = new TokenBucket(10, 10_000)
  }

  // -------------------------------------------------------------------------
  // Internal: authenticated fetch with retry-on-429
  // -------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<{ status: number; data: T | null }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        'X-System': this.systemHeader,
        'X-System-Key': this.systemKeyHeader,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (res.status === 401 || res.status === 403) {
      const text = await res.text()
      throw new FubAuthError(`FUB auth failed (${res.status}): ${text.slice(0, 200)}`)
    }

    if (res.status === 429) {
      const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '0', 10)
      const backoffMs = retryAfterSec > 0
        ? retryAfterSec * 1000
        : Math.min(1_000 * 2 ** attempt, 32_000)
      if (attempt >= 4) throw new FubRateLimited(backoffMs)
      await new Promise(r => setTimeout(r, backoffMs))
      return this.request<T>(method, path, body, attempt + 1)
    }

    // 204 = silently archived/ignored by FUB
    if (res.status === 204) {
      return { status: 204, data: null }
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`FUB API error ${res.status}: ${text.slice(0, 300)}`)
    }

    const data = res.headers.get('content-type')?.includes('application/json')
      ? (await res.json() as T)
      : null

    return { status: res.status as 200 | 201, data }
  }

  // -------------------------------------------------------------------------
  // pushEvent — POST /v1/events
  // -------------------------------------------------------------------------

  /**
   * Push a lead event to FUB.
   *
   * IMPORTANT: Use this, never POST /v1/people.
   *
   * Response:
   *   201 → new person created (person_id from response body)
   *   200 → existing person updated (person_id from response body)
   *   204 → FUB archived/ignored — throws FubArchived
   *
   * occurredAt MUST NOT be >24h in the past or FUB treats it as historical
   * and does not fire automations (P4 — set occurredAt = notified_at, not received_at).
   */
  async pushEvent(payload: FubEventPayload): Promise<FubEventResponse> {
    const { status, data } = await this.request<{
      id?: number;
      personId?: number;
      person?: { id?: number };
    }>('POST', '/v1/events', payload)

    if (status === 204) {
      throw new FubArchived()
    }

    // Response shape varies — normalize
    const personId = data?.personId ?? data?.person?.id ?? undefined
    const eventId = data?.id ?? undefined

    return {
      status: status as 200 | 201,
      person_id: personId,
      event_id: eventId,
    }
  }

  // -------------------------------------------------------------------------
  // Lookup helpers (for onboarding-check script)
  // -------------------------------------------------------------------------

  async getStages(): Promise<FubStage[]> {
    const { data } = await this.request<{ stages: FubStage[] }>('GET', '/v1/stages')
    return data?.stages ?? []
  }

  async getPipelines(): Promise<FubPipeline[]> {
    const { data } = await this.request<{ pipelines: FubPipeline[] }>('GET', '/v1/pipelines')
    return data?.pipelines ?? []
  }

  async getCustomFields(): Promise<FubCustomField[]> {
    const { data } = await this.request<{ customFields: FubCustomField[] }>('GET', '/v1/customFields')
    return data?.customFields ?? []
  }

  // -------------------------------------------------------------------------
  // addNote — POST /v1/notes (rate-limited: 10/10s)
  // -------------------------------------------------------------------------

  /**
   * Attach a note to a FUB person.
   *
   * Do NOT include raw reply body — PII and retention policy.
   * Pass: classification summary + confidence + first sentence (redacted, ~100 chars) + CRM link.
   */
  async addNote(payload: FubNotePayload): Promise<void> {
    // Consume a token (blocks if rate limited)
    await this.notesBucket.consume()

    await this.request<unknown>('POST', '/v1/notes', {
      personId: payload.personId,
      subject: payload.subject,
      body: payload.body,
    })
  }
}
