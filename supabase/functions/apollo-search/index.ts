import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { writeAlert } from '../_shared/alerts.ts'
import { resolveUser } from '../_shared/auth.ts'

const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// --- Types ---

interface ApolloFilters {
  person_titles: string[]
  person_locations: string[]
  organization_num_employees_ranges: string[]
  q_keywords: string
  person_seniorities: string[]
}

interface LeadResult {
  firstName: string
  lastName: string
  email: string
  emailStatus: string
  phone: string
  jobTitle: string
  company: string
  companySize: string
  industry: string
  location: string
  timezone: string | null
  apolloId: string | null
  status: string
  assignedTo: string
  lastContactedAt: null
  notes: string
  tags: string[]
  linkedinUrl?: string
}

// --- Helper Functions ---

function mapEmployeeCount(count: number | null | undefined): string {
  if (!count) return ''
  if (count <= 10) return '1-10'
  if (count <= 50) return '11-50'
  if (count <= 200) return '51-200'
  if (count <= 500) return '201-500'
  if (count <= 1000) return '501-1000'
  if (count <= 5000) return '1001-5000'
  if (count <= 10000) return '5001-10000'
  return '10001+'
}

function scoreLead(lead: LeadResult): number {
  let score = 0
  if (lead.email && lead.emailStatus === 'verified') score += 40
  else if (lead.email && lead.emailStatus === 'likely_to_engage') score += 40
  if (lead.phone) score += 30
  if (lead.linkedinUrl) score += 15
  if (lead.firstName && lead.lastName) score += 15
  return score
}

async function parsePromptWithLLM(prompt: string, apiKey: string, supabaseAdmin: ReturnType<typeof createClient>): Promise<ApolloFilters> {
  const systemPrompt = `You are a search filter extraction assistant. Given a natural language description of an ideal customer profile, extract structured search filters for the Apollo.io People Search API.

AVAILABLE FILTERS:
- person_titles: Array of job title keywords (e.g., ["CTO", "VP Engineering", "Director of Sales"])
- person_locations: Array of locations (e.g., ["California, US", "Austin, TX", "New York, US"])
- organization_num_employees_ranges: Array of company size brackets. Valid values: "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"
- q_keywords: Free-text keywords to search across profiles (e.g., "SaaS B2B")
- person_seniorities: Array of seniority levels. Valid values: "c_suite", "founder", "owner", "partner", "vp", "director", "manager", "senior", "entry"

RULES:
- Extract as many filters as the prompt implies. Leave arrays empty [] if the prompt doesn't mention that filter.
- For company size, map descriptions to brackets: "small" → ["1-10", "11-50"], "medium" → ["51-200", "201-500"], "large" → ["501-1000", "1001-5000", "5001-10000", "10001+"], "50-200 employees" → ["51-200"]
- For seniority, infer from titles: "CTO" → "c_suite", "VP" → "vp", "Director" → "director", etc.
- q_keywords should capture industry or topic terms not covered by other filters (e.g., "SaaS", "fintech", "healthcare")
- Be generous with title variations — "CTO" should also include "Chief Technology Officer"
- If q_keywords is empty string, that's fine.`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'IntegrateAPI CRM',
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-v3.2',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'apollo_filters',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              person_titles: { type: 'array', items: { type: 'string' } },
              person_locations: { type: 'array', items: { type: 'string' } },
              organization_num_employees_ranges: { type: 'array', items: { type: 'string' } },
              q_keywords: { type: 'string' },
              person_seniorities: { type: 'array', items: { type: 'string' } },
            },
            required: ['person_titles', 'person_locations', 'organization_num_employees_ranges', 'q_keywords', 'person_seniorities'],
            additionalProperties: false,
          },
        },
      },
      temperature: 0.2,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('OpenRouter LLM error:', response.status, errorBody)
    await writeAlert(supabaseAdmin, {
      type: 'error', source: 'openrouter',
      message: `Apollo search AI parsing failed (HTTP ${response.status}).`,
      details: { status: response.status, error: errorBody },
    })
    throw new Error(`LLM parsing failed (${response.status})`)
  }

  const data = await response.json()
  if (!data.choices?.length || !data.choices[0].message?.content) {
    throw new Error('No LLM response')
  }

  return JSON.parse(data.choices[0].message.content)
}

function deriveTimezone(city: string, state: string, country: string): string | null {
  const parts = [city, state, country].map(s => (s || '').trim().toLowerCase())
  const stateToken = parts[1]
  const countryToken = parts[2]

  const usTimezones: Record<string, string> = {
    'california': 'America/Los_Angeles', 'washington': 'America/Los_Angeles',
    'oregon': 'America/Los_Angeles', 'nevada': 'America/Los_Angeles',
    'texas': 'America/Chicago', 'illinois': 'America/Chicago',
    'minnesota': 'America/Chicago', 'wisconsin': 'America/Chicago',
    'missouri': 'America/Chicago', 'iowa': 'America/Chicago',
    'louisiana': 'America/Chicago', 'oklahoma': 'America/Chicago',
    'tennessee': 'America/Chicago', 'kansas': 'America/Chicago',
    'nebraska': 'America/Chicago', 'north dakota': 'America/Chicago',
    'south dakota': 'America/Chicago',
    'new york': 'America/New_York', 'florida': 'America/New_York',
    'georgia': 'America/New_York', 'north carolina': 'America/New_York',
    'south carolina': 'America/New_York', 'virginia': 'America/New_York',
    'west virginia': 'America/New_York', 'massachusetts': 'America/New_York',
    'pennsylvania': 'America/New_York', 'new jersey': 'America/New_York',
    'connecticut': 'America/New_York', 'maryland': 'America/New_York',
    'ohio': 'America/New_York', 'michigan': 'America/New_York',
    'indiana': 'America/New_York', 'maine': 'America/New_York',
    'vermont': 'America/New_York', 'new hampshire': 'America/New_York',
    'rhode island': 'America/New_York', 'delaware': 'America/New_York',
    'district of columbia': 'America/New_York', 'dc': 'America/New_York',
    'colorado': 'America/Denver', 'utah': 'America/Denver',
    'arizona': 'America/Denver', 'new mexico': 'America/Denver',
    'montana': 'America/Denver', 'wyoming': 'America/Denver', 'idaho': 'America/Denver',
    'hawaii': 'Pacific/Honolulu', 'alaska': 'America/Anchorage',
  }

  for (const [st, tz] of Object.entries(usTimezones)) {
    if (stateToken === st || stateToken.includes(st)) return tz
  }

  const countryTimezones: Record<string, string> = {
    'united kingdom': 'Europe/London', 'uk': 'Europe/London', 'england': 'Europe/London',
    'germany': 'Europe/Berlin', 'france': 'Europe/Paris', 'spain': 'Europe/Madrid',
    'italy': 'Europe/Rome', 'netherlands': 'Europe/Amsterdam',
    'india': 'Asia/Kolkata', 'australia': 'Australia/Sydney',
    'japan': 'Asia/Tokyo', 'china': 'Asia/Shanghai',
    'canada': 'America/Toronto', 'brazil': 'America/Sao_Paulo',
    'mexico': 'America/Mexico_City', 'israel': 'Asia/Jerusalem',
    'singapore': 'Asia/Singapore', 'south korea': 'Asia/Seoul',
    'united arab emirates': 'Asia/Dubai', 'sweden': 'Europe/Stockholm',
    'switzerland': 'Europe/Zurich', 'ireland': 'Europe/Dublin',
  }

  for (const [c, tz] of Object.entries(countryTimezones)) {
    if (countryToken.includes(c)) return tz
  }

  return null
}

// --- Main Handler ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate environment
    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY')
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
    const ZEROBOUNCE_API_KEY = Deno.env.get('ZEROBOUNCE_API_KEY')

    if (!APOLLO_API_KEY || !OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Required API keys not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { prompt, perPage = 25 } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Prompt is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    let user
    try {
      user = await resolveUser(req.headers.get('Authorization'), supabaseAdmin)
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Step 1: LLM parsing — extract Apollo filters from natural language
    console.log('Step 1: Parsing prompt with LLM...')
    const filters = await parsePromptWithLLM(prompt, OPENROUTER_API_KEY, supabaseAdmin)
    console.log('Filters extracted:', JSON.stringify(filters))

    // Step 2: Apollo People Search (0 credits)
    console.log('Step 2: Searching Apollo...')
    const searchBody: Record<string, unknown> = {
      per_page: Math.min(perPage, 100),
      page: 1,
    }
    // Only include non-empty filters
    if (filters.person_titles.length > 0) searchBody.person_titles = filters.person_titles
    if (filters.person_locations.length > 0) searchBody.person_locations = filters.person_locations
    if (filters.organization_num_employees_ranges.length > 0) searchBody.organization_num_employees_ranges = filters.organization_num_employees_ranges
    if (filters.q_keywords) searchBody.q_keywords = filters.q_keywords
    if (filters.person_seniorities.length > 0) searchBody.person_seniorities = filters.person_seniorities

    const searchRes = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: { 'X-Api-Key': APOLLO_API_KEY, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify(searchBody),
    })

    if (!searchRes.ok) {
      const searchError = await searchRes.text()
      console.error('Apollo search error:', searchRes.status, searchError)
      await writeAlert(supabaseAdmin, {
        type: 'error', source: 'apollo',
        message: `Apollo search failed (HTTP ${searchRes.status}). Lead search is temporarily unavailable.`,
        details: { status: searchRes.status, error: searchError },
      })
      return new Response(
        JSON.stringify({ error: `Apollo search failed (${searchRes.status})` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const searchData = await searchRes.json()
    const people = searchData.people || []
    const totalFound = searchData.pagination?.total_entries || 0
    console.log(`Found ${totalFound} total, ${people.length} returned`)

    if (people.length === 0) {
      return new Response(JSON.stringify({
        leads: [],
        totalFound: 0,
        creditsUsed: 0,
        filtersUsed: filters,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Step 3: Bulk enrichment in batches of 10 (1 credit per person)
    console.log('Step 3: Enriching contacts...')
    const enriched: Record<string, unknown>[] = []
    const ids = people.map((p: { id: string }) => ({ id: p.id }))

    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10)
      const enrichRes = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
        method: 'POST',
        headers: { 'X-Api-Key': APOLLO_API_KEY, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        body: JSON.stringify({
          details: batch,
          reveal_personal_emails: false,
          reveal_phone_number: true,
          webhook_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/apollo-phone-webhook`,
        }),
      })

      if (!enrichRes.ok) {
        console.error('Apollo enrichment batch failed:', enrichRes.status, await enrichRes.text())
        await writeAlert(supabaseAdmin, {
          type: 'warning', source: 'apollo',
          message: `Apollo enrichment batch failed (HTTP ${enrichRes.status}). Some contacts may be missing data.`,
          details: { status: enrichRes.status },
        })
        continue // Skip failed batch, don't crash the whole request
      }

      const enrichData = await enrichRes.json()
      enriched.push(...(enrichData.matches || []))

      // Small delay between batches to avoid 429s
      if (i + 10 < ids.length) await new Promise(r => setTimeout(r, 200))
    }

    console.log(`Enriched ${enriched.length} contacts`)

    // Step 3.5: Normalize Apollo email_status values (spaces → underscores)
    for (const person of enriched) {
      if ((person as Record<string, unknown>).email_status === 'likely to engage') {
        (person as Record<string, unknown>).email_status = 'likely_to_engage'
      }
    }

    // Step 4: ZeroBounce validation (concurrent, cap at 5 in-flight)
    if (ZEROBOUNCE_API_KEY) {
      const toValidate = enriched.filter((p: Record<string, unknown>) =>
        p.email && ['verified', 'likely_to_engage'].includes(p.email_status as string)
      )
      console.log(`Step 4: Validating ${toValidate.length} emails with ZeroBounce...`)

      for (let i = 0; i < toValidate.length; i += 5) {
        const batch = toValidate.slice(i, i + 5)
        await Promise.all(batch.map(async (person: Record<string, unknown>) => {
          try {
            const zbRes = await fetch(
              `https://api.zerobounce.net/v2/validate?api_key=${ZEROBOUNCE_API_KEY}&email=${encodeURIComponent(person.email as string)}`
            )
            if (zbRes.ok) {
              const zbData = await zbRes.json()
              if (zbData.status === 'invalid') {
                person.email_status = 'invalid'
              }
            }
          } catch {
            // ZeroBounce failure is non-fatal — keep Apollo's status
          }
        }))
      }
    } else {
      console.log('Step 4: ZeroBounce API key not set, skipping validation')
    }

    // Step 4.5: Filter invalid emails
    // - Invalid email + no phone → drop entirely
    // - Invalid email + has phone → keep but strip email
    // - No email + no phone → drop entirely
    for (const person of enriched) {
      const p = person as Record<string, unknown>
      const hasPhone = !!(p.phone_numbers as Array<{ sanitized_number?: string }> | undefined)?.[0]?.sanitized_number
      if (p.email_status === 'invalid') {
        if (hasPhone) {
          p.email = ''  // Strip invalid email, keep phone-only lead
        } else {
          p._drop = true  // Mark for removal — no valid contact method
        }
      }
    }
    const validContacts = enriched.filter((p: Record<string, unknown>) => !p._drop)
    console.log(`After invalid filter: ${validContacts.length} of ${enriched.length} kept`)

    // Step 5: Score and transform to Lead format
    console.log('Step 5: Scoring and transforming...')
    const leads: LeadResult[] = validContacts
      .filter((p: Record<string, unknown>) => p.email || (p.phone_numbers as Array<{ sanitized_number?: string }> | undefined)?.[0]?.sanitized_number)
      .map((person: Record<string, unknown>) => {
        const org = person.organization as Record<string, unknown> | undefined
        const phoneNumbers = person.phone_numbers as Array<{ sanitized_number?: string }> | undefined

        return {
          firstName: (person.first_name as string) || '',
          lastName: (person.last_name as string) || '',
          email: (person.email as string) || '',
          emailStatus: (person.email as string) ? ((person.email_status as string) || 'unverified') : 'invalid',
          phone: phoneNumbers?.[0]?.sanitized_number || '',
          jobTitle: (person.title as string) || '',
          company: (org?.name as string) || '',
          companySize: mapEmployeeCount(org?.estimated_num_employees as number | undefined),
          industry: (org?.industry as string) || '',
          location: [person.city, person.state, person.country].filter(Boolean).join(', '),
          timezone: deriveTimezone(
            (person.city as string) || '',
            (person.state as string) || '',
            (person.country as string) || ''
          ),
          apolloId: (person.id as string) || null,
          status: 'cold' as const,
          assignedTo: '',
          lastContactedAt: null,
          notes: `Generated from: "${prompt}"`,
          tags: ['apollo', 'generated'],
          linkedinUrl: (person.linkedin_url as string) || undefined,
        }
      })

    // Score, sort, and strip score
    const scoredLeads = leads
      .map(lead => ({ ...lead, _score: scoreLead(lead) }))
      .sort((a, b) => b._score - a._score)
      .map(({ _score, ...lead }) => lead)

    console.log(`Returning ${scoredLeads.length} leads`)

    // Step 6: Log usage
    try {
      await supabaseAdmin.from('apollo_usage').insert({
        user_id: user.id,
        action: 'search_and_enrich',
        credits_used: enriched.length,
        search_count: people.length,
        enrichment_count: enriched.length,
        results_returned: scoredLeads.length,
        prompt,
      })
    } catch (logErr) {
      console.error('Failed to log usage (non-fatal):', logErr)
    }

    return new Response(JSON.stringify({
      leads: scoredLeads,
      totalFound,
      creditsUsed: enriched.length,
      filtersUsed: filters,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('apollo-search error:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
