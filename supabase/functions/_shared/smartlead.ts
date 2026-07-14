/**
 * Smartlead API client — Deno-compatible, used by Edge Functions.
 *
 * All requests authenticate via `?api_key=` query param.
 * Retries on 429 with Retry-After header or exponential backoff.
 * Throws typed errors: SmartleadRateLimited, SmartleadAuthError, SmartleadServerError.
 *
 * Sandbox-verification items (need real Smartlead account — Phase 0.6):
 *   S1: Exact response shape of addLeadToCampaign (per-lead id extraction path).
 *   S2: markLeadReplied endpoint + payload — documented as PATCH lead-category; verify.
 *   S3: connectMailbox payload shape (account_id vs email_account_id field name).
 *   S4: activateCampaign status string ('ACTIVE' vs 'active').
 */

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class SmartleadRateLimited extends Error {
  readonly retryAfterMs: number
  constructor(retryAfterMs: number) {
    super(`Smartlead rate limited — retry after ${retryAfterMs}ms`)
    this.name = 'SmartleadRateLimited'
    this.retryAfterMs = retryAfterMs
  }
}

export class SmartleadAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SmartleadAuthError'
  }
}

export class SmartleadServerError extends Error {
  readonly status: number
  constructor(status: number, body: string) {
    super(`Smartlead server error ${status}: ${body.slice(0, 200)}`)
    this.name = 'SmartleadServerError'
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Wire types — minimal, matching the endpoints we actually call.
// Sandbox-verify field names (S1, S2, S3) against real responses.
// ---------------------------------------------------------------------------

export interface SmartleadCampaign {
  id: number
  name: string
  status: string
}

/**
 * Response of POST /campaigns/{id}/leads — verified against the live API
 * 2026-07-14 (S1 resolved): counts only, NO per-lead ids. Resolve the
 * Smartlead lead id afterwards via getLeadByEmail().
 */
export interface SmartleadAddLeadResult {
  ok?: boolean
  upload_count?: number
  total_leads?: number
  block_count?: number
  duplicate_count?: number
  invalid_email_count?: number
  invalid_emails?: string[]
  already_added_to_campaign?: number
  unsubscribed_leads?: string[]
  is_lead_limit_exhausted?: boolean
}

/** Shape of GET /leads/?email= — verified 2026-07-14. id is a numeric string. */
export interface SmartleadLeadRecord {
  id: string | number
  email: string
  first_name?: string | null
  last_name?: string | null
}

export interface SmartleadSchedule {
  timezone: string
  days_of_the_week: number[]
  start_hour: string
  end_hour: string
  min_time_btw_emails: number
  max_new_leads_per_day: number
  schedule_start_time: string
}

export interface SmartleadSequenceStep {
  seq_number: number
  subject: string
  email_body: string
  delay_in_days: number
}

export interface SmartleadConnectMailboxPayload {
  /** Smartlead's email-account ID. S3: verify field is `email_account_id` not `account_id`. */
  email_account_id: number
  max_email_per_day: number
}

export interface SmartleadLeadPayload {
  first_name?: string
  last_name?: string
  email: string
  company_name?: string
  phone_number?: string
  custom_fields?: Record<string, string>
}

// ---------------------------------------------------------------------------
// SmartleadClient
// ---------------------------------------------------------------------------

export class SmartleadClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  isMock = false

  constructor() {
    const apiKey = Deno.env.get('SMARTLEAD_API_KEY')
    const baseUrl = Deno.env.get('SMARTLEAD_BASE_URL') ?? 'https://server.smartlead.ai'
    this.apiKey = apiKey ?? ''
    this.baseUrl = baseUrl.replace(/\/$/, '')

    // Mock/sandbox mode is opt-in via SMARTLEAD_SANDBOX=true, or forced when no
    // usable key is configured (missing, or a leftover .env.example placeholder).
    // This replaces the previous hardcoded-hash fallback, which silently reverted
    // to mock for one specific (expired) key — a foot-gun once a real key is live.
    const sandboxFlag = (Deno.env.get('SMARTLEAD_SANDBOX') ?? '').toLowerCase() === 'true'
    const keyUnusable = !apiKey || apiKey.startsWith('your_')

    if (sandboxFlag || keyUnusable) {
      this.isMock = true
      const reason = sandboxFlag ? 'SMARTLEAD_SANDBOX=true' : 'no usable SMARTLEAD_API_KEY'
      console.log(`SmartleadClient running in MOCK/SANDBOX mode (${reason})`)
    }
  }

  /**
   * Retained for call sites that await it; mock status is now fully resolved in
   * the constructor, so this is a no-op kept for backwards compatibility.
   */
  private async ensureMockStatus(): Promise<void> {}

  async checkMockStatus(): Promise<boolean> {
    return this.isMock
  }

  // -------------------------------------------------------------------------
  // Internal: authenticated fetch with retry-on-429
  // -------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<T> {
    if (this.isMock) {
      throw new Error('Should not invoke raw request in mock mode')
    }
    const url = `${this.baseUrl}${path}${path.includes('?') ? '&' : '?'}api_key=${this.apiKey}`
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (res.status === 401 || res.status === 403) {
      const text = await res.text()
      throw new SmartleadAuthError(`Smartlead auth failed (${res.status}): ${text.slice(0, 200)}`)
    }

    if (res.status === 429) {
      const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '0', 10)
      const backoffMs = retryAfterSec > 0
        ? retryAfterSec * 1000
        : Math.min(1000 * 2 ** attempt, 32_000) // exponential, cap 32s
      if (attempt >= 4) throw new SmartleadRateLimited(backoffMs)
      await new Promise(r => setTimeout(r, backoffMs))
      return this.request<T>(method, path, body, attempt + 1)
    }

    if (!res.ok) {
      const text = await res.text()
      throw new SmartleadServerError(res.status, text)
    }

    return res.json() as Promise<T>
  }

  // -------------------------------------------------------------------------
  // Campaign management
  // -------------------------------------------------------------------------

  /** Create a new Smartlead campaign. Returns the created campaign object. */
  async createCampaign(name: string): Promise<SmartleadCampaign> {
    await this.ensureMockStatus()
    if (this.isMock) {
      const mockId = Math.floor(Math.random() * 1000000)
      console.log(`[MOCK] createCampaign: name="${name}" -> id=${mockId}`)
      return { id: mockId, name, status: 'draft' }
    }
    return this.request<SmartleadCampaign>('POST', '/api/v1/campaigns/create', { name })
  }

  /**
   * Add a sequence step to a campaign.
   * S2 note: verify whether step_number is `seq_number` or `step_number`.
   */
  async addSequenceStep(campaignId: number, step: SmartleadSequenceStep): Promise<void> {
    await this.ensureMockStatus()
    if (this.isMock) {
      console.log(`[MOCK] addSequenceStep: campaignId=${campaignId}, step=${step.seq_number}`)
      return
    }
    await this.request<unknown>('POST', `/api/v1/campaigns/${campaignId}/sequences`, step)
  }

  /**
   * Connect a mailbox (email account) to a campaign.
   * S3: The field name may be `account_id` in some SL versions — verify against sandbox.
   */
  async connectMailbox(campaignId: number, payload: SmartleadConnectMailboxPayload): Promise<void> {
    await this.ensureMockStatus()
    if (this.isMock) {
      console.log(`[MOCK] connectMailbox: campaignId=${campaignId}, mailbox=${payload.email_account_id}`)
      return
    }
    await this.request<unknown>('POST', `/api/v1/campaigns/${campaignId}/email-accounts`, payload)
  }

  /**
   * Bulk-add leads to a campaign. Verified 2026-07-14 (S1): the body field is
   * `lead_list` (`leads` is rejected with 400), and the response carries counts
   * only — no per-lead ids. Callers resolve ids via getLeadByEmail().
   */
  async addLeadToCampaign(
    campaignId: number,
    lead: SmartleadLeadPayload,
  ): Promise<SmartleadAddLeadResult> {
    await this.ensureMockStatus()
    if (this.isMock) {
      console.log(`[MOCK] addLeadToCampaign: campaignId=${campaignId}, email=${lead.email}`)
      return { ok: true, upload_count: 1, total_leads: 1 }
    }
    return this.request<SmartleadAddLeadResult>(
      'POST',
      `/api/v1/campaigns/${campaignId}/leads`,
      { lead_list: [lead] },
    )
  }

  /**
   * Fetch a lead (with its Smartlead id) by email. Verified 2026-07-14: returns
   * the lead record, or an empty/id-less body when unknown → null.
   */
  async getLeadByEmail(email: string): Promise<SmartleadLeadRecord | null> {
    await this.ensureMockStatus()
    if (this.isMock) {
      const mockLeadId = Math.floor(Math.random() * 1000000)
      console.log(`[MOCK] getLeadByEmail: ${email} -> ${mockLeadId}`)
      return { id: mockLeadId, email }
    }
    const rec = await this.request<SmartleadLeadRecord | null>(
      'GET',
      `/api/v1/leads/?email=${encodeURIComponent(email)}`,
    )
    return rec && rec.id != null ? rec : null
  }

  /**
   * Set the campaign send schedule. Smartlead refuses to START a campaign with
   * no schedule ("Cron Exp value is empty!" — verified 2026-07-14), so this must
   * run before activateCampaign. Defaults: Mon–Fri 9:00–17:00, 10 min between
   * emails, 20 new leads/day (matches the week-1 warmup cap). Timezone from
   * SMARTLEAD_SCHEDULE_TIMEZONE (default America/Denver).
   */
  async setCampaignSchedule(
    campaignId: number,
    overrides: Partial<SmartleadSchedule> = {},
  ): Promise<void> {
    await this.ensureMockStatus()
    const schedule: SmartleadSchedule = {
      timezone: Deno.env.get('SMARTLEAD_SCHEDULE_TIMEZONE') ?? 'America/Denver',
      days_of_the_week: [1, 2, 3, 4, 5],
      start_hour: '09:00',
      end_hour: '17:00',
      min_time_btw_emails: 10,
      max_new_leads_per_day: 20,
      schedule_start_time: new Date().toISOString(),
      ...overrides,
    }
    if (this.isMock) {
      console.log(`[MOCK] setCampaignSchedule: campaignId=${campaignId}`)
      return
    }
    await this.request<unknown>('POST', `/api/v1/campaigns/${campaignId}/schedule`, schedule)
  }

  /**
   * Activate a campaign. Verified 2026-07-14 (S4): the endpoint is
   * POST /campaigns/{id}/status with status 'START' (PATCH → 404; values are
   * START / PAUSED / STOPPED). Requires a schedule to be set first.
   */
  async activateCampaign(campaignId: number): Promise<void> {
    await this.ensureMockStatus()
    if (this.isMock) {
      console.log(`[MOCK] activateCampaign: campaignId=${campaignId}`)
      return
    }
    await this.request<unknown>('POST', `/api/v1/campaigns/${campaignId}/status`, {
      status: 'START',
    })
  }

  /**
   * Mark a lead as replied, stopping autonomous sequence progression.
   * S2: Verify exact endpoint + category field value. The documented path is
   * PATCH /api/v1/campaigns/{id}/leads/{lead_id} with body {category: 'replied'}.
   * Some Smartlead API versions use lead_category instead of category.
   */
  async markLeadReplied(campaignId: number, smartleadLeadId: number): Promise<void> {
    await this.ensureMockStatus()
    if (this.isMock) {
      console.log(`[MOCK] markLeadReplied: campaignId=${campaignId}, leadId=${smartleadLeadId}`)
      return
    }
    await this.request<unknown>(
      'PATCH',
      `/api/v1/campaigns/${campaignId}/leads/${smartleadLeadId}`,
      { category: 'replied' },
    )
  }

  /** Pull per-date analytics for a campaign. Used by the daily reconcile job. */
  async getCampaignAnalytics(
    campaignId: number,
    startDate: string,
    endDate: string,
  ): Promise<unknown> {
    await this.ensureMockStatus()
    if (this.isMock) {
      return {
        total_leads: 10,
        sent: 5,
        opened: 2,
        replied: 1,
        bounced: 0,
      }
    }
    return this.request<unknown>(
      'GET',
      `/api/v1/campaigns/${campaignId}/analytics-by-date?start_date=${startDate}&end_date=${endDate}`,
    )
  }

  /**
   * Pull warmup stats for a connected email account.
   * Used by the mailbox-watchdog to surface warmup progress in the UI.
   */
  async getMailboxWarmupStats(accountId: number): Promise<unknown> {
    await this.ensureMockStatus()
    if (this.isMock) {
      return {
        total_sends: 25,
        warmup_sends: 15,
        inbox_placement: 100,
        spam_placement: 0,
      }
    }
    return this.request<unknown>('GET', `/api/v1/email-accounts/${accountId}/warmup-stats`)
  }
}
