import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { writeAlert } from '../_shared/alerts.ts'

// ---- Helper functions (copied from apollo-search) ----

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

function scoreLead(lead: Record<string, unknown>): number {
  let score = 0
  if (lead.email && (lead.emailStatus === 'verified' || lead.emailStatus === 'likely_to_engage')) score += 40
  if (lead.phone) score += 30
  if (lead.linkedinUrl) score += 15
  if (lead.firstName && lead.lastName) score += 15
  return score
}

function deriveTimezone(city: string, state: string, country: string): string | null {
  const parts = [city, state, country].map(s => (s || '').trim().toLowerCase())
  const stateToken = parts[1]
  const countryToken = parts[2]

  const usTimezones: Record<string, string> = {
    'california': 'America/Los_Angeles', 'washington': 'America/Los_Angeles',
    'oregon': 'America/Los_Angeles', 'nevada': 'America/Los_Angeles',
    'texas': 'America/Chicago', 'illinois': 'America/Chicago',
    'new york': 'America/New_York', 'florida': 'America/New_York',
    'georgia': 'America/New_York', 'pennsylvania': 'America/New_York',
    'ohio': 'America/New_York', 'michigan': 'America/New_York',
    'colorado': 'America/Denver', 'utah': 'America/Denver',
    'arizona': 'America/Denver',
  }

  for (const [st, tz] of Object.entries(usTimezones)) {
    if (stateToken === st || stateToken.includes(st)) return tz
  }

  const countryTimezones: Record<string, string> = {
    'united kingdom': 'Europe/London', 'germany': 'Europe/Berlin',
    'india': 'Asia/Kolkata', 'australia': 'Australia/Sydney',
    'japan': 'Asia/Tokyo', 'canada': 'America/Toronto',
  }

  for (const [c, tz] of Object.entries(countryTimezones)) {
    if (countryToken.includes(c)) return tz
  }

  return null
}

// ---- Apollo Search Pipeline (inlined) ----

async function runApolloSearch(
  filters: Record<string, unknown>,
  perPage: number,
  apolloApiKey: string,
  zeroBounceApiKey: string | undefined,
  supabaseAdmin?: ReturnType<typeof createClient>,
  requirePhone = false,
) {
  // Step 1: Apollo People Search (0 credits)
  const searchPerPage = requirePhone ? Math.min((perPage || 25) * 3, 100) : Math.min(perPage, 100)
  const searchBody: Record<string, unknown> = { per_page: searchPerPage, page: 1 }
  const titles = filters.person_titles as string[]
  const locations = filters.person_locations as string[]
  const empRanges = filters.organization_num_employees_ranges as string[]
  const keywords = filters.q_keywords as string
  const seniorities = filters.person_seniorities as string[]

  if (titles?.length > 0) searchBody.person_titles = titles
  if (locations?.length > 0) searchBody.person_locations = locations
  if (empRanges?.length > 0) searchBody.organization_num_employees_ranges = empRanges
  if (keywords) searchBody.q_keywords = keywords
  if (seniorities?.length > 0) searchBody.person_seniorities = seniorities

  const searchRes = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
    method: 'POST',
    headers: { 'X-Api-Key': apolloApiKey, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify(searchBody),
  })

  if (!searchRes.ok) {
    if (supabaseAdmin) {
      await writeAlert(supabaseAdmin, {
        type: 'error',
        source: 'apollo',
        message: `Apollo search failed (HTTP ${searchRes.status}). Lead search is temporarily unavailable.`,
        details: { status: searchRes.status },
      })
    }
    return { leads: [], totalFound: 0, creditsUsed: 0, skippedDuplicates: 0 }
  }

  const searchData = await searchRes.json()
  const people = searchData.people || []
  const totalFound = searchData.pagination?.total_entries || 0

  if (people.length === 0) return { leads: [], totalFound: 0, creditsUsed: 0, skippedDuplicates: 0 }

  // Phone filter: only keep people with confirmed phone numbers
  let filteredPeople = people
  if (requirePhone) {
    filteredPeople = people.filter((p: { has_direct_phone?: string }) => p.has_direct_phone === 'Yes')
    console.log(`Phone filter: ${filteredPeople.length} of ${people.length} have confirmed phones`)

    // Fallback: paginate if not enough phone-qualified results
    if (filteredPeople.length < perPage) {
      let page = 2
      const maxPages = 4
      while (filteredPeople.length < perPage && page <= maxPages) {
        const moreRes = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
          method: 'POST',
          headers: { 'X-Api-Key': apolloApiKey, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({ ...searchBody, per_page: 50, page }),
        })
        if (!moreRes.ok) break
        const moreData = await moreRes.json()
        const morePeople = moreData.people || []
        if (morePeople.length === 0) break
        filteredPeople.push(...morePeople.filter((p: { has_direct_phone?: string }) => p.has_direct_phone === 'Yes'))
        page++
      }
      filteredPeople = filteredPeople.slice(0, perPage)
    }

    if (filteredPeople.length === 0) {
      return { leads: [], totalFound, creditsUsed: 0, skippedDuplicates: 0 }
    }
  }

  // Pre-enrichment dedup: check which Apollo person IDs already exist in CRM
  const apolloPersonIds = filteredPeople.map((p: { id: string }) => p.id)
  let existingApolloIds = new Set<string>()

  if (supabaseAdmin && apolloPersonIds.length > 0) {
    const { data: existingByApolloId } = await supabaseAdmin
      .from('leads')
      .select('apollo_id')
      .in('apollo_id', apolloPersonIds)
      .not('apollo_id', 'is', null)

    existingApolloIds = new Set((existingByApolloId || []).map((r: { apollo_id: string }) => r.apollo_id))
    console.log(`Dedup: ${existingApolloIds.size} of ${filteredPeople.length} already in CRM by apollo_id`)
  }

  // Only enrich people NOT already in CRM
  const newPeople = filteredPeople.filter((p: { id: string }) => !existingApolloIds.has(p.id))
  const skippedCount = filteredPeople.length - newPeople.length

  if (newPeople.length === 0) {
    return { leads: [], totalFound, creditsUsed: 0, skippedDuplicates: skippedCount }
  }

  // Step 2: Bulk enrichment in batches of 10
  const enriched: Record<string, unknown>[] = []
  const ids = newPeople.map((p: { id: string }) => ({ id: p.id }))

  const SITE_URL = Deno.env.get('SUPABASE_URL') || ''

  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10)
    const enrichRes = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
      method: 'POST',
      headers: { 'X-Api-Key': apolloApiKey, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({
        details: batch,
        reveal_personal_emails: false,
        reveal_phone_number: true,
        webhook_url: `${SITE_URL}/functions/v1/apollo-phone-webhook`,
      }),
    })
    if (!enrichRes.ok) {
      if (supabaseAdmin) {
        await writeAlert(supabaseAdmin, {
          type: 'warning',
          source: 'apollo',
          message: `Apollo enrichment batch failed (HTTP ${enrichRes.status}). Some contacts may be missing data.`,
          details: { status: enrichRes.status },
        })
      }
      continue
    }
    const enrichData = await enrichRes.json()
    enriched.push(...(enrichData.matches || []))
    if (i + 10 < ids.length) await new Promise(r => setTimeout(r, 200))
  }

  // Normalize email_status
  for (const person of enriched) {
    if ((person as Record<string, unknown>).email_status === 'likely to engage') {
      (person as Record<string, unknown>).email_status = 'likely_to_engage'
    }
  }

  // Step 3: ZeroBounce validation
  if (zeroBounceApiKey) {
    const toValidate = enriched.filter((p: Record<string, unknown>) =>
      p.email && ['verified', 'likely_to_engage'].includes(p.email_status as string)
    )
    for (let i = 0; i < toValidate.length; i += 5) {
      const batch = toValidate.slice(i, i + 5)
      await Promise.all(batch.map(async (person: Record<string, unknown>) => {
        try {
          const zbRes = await fetch(
            `https://api.zerobounce.net/v2/validate?api_key=${zeroBounceApiKey}&email=${encodeURIComponent(person.email as string)}`
          )
          if (zbRes.ok) {
            const zbData = await zbRes.json()
            if (zbData.status === 'invalid') person.email_status = 'invalid'
          }
        } catch { /* non-fatal */ }
      }))
    }
  }

  // Step 3.5: Check phone_reveals buffer for phones from prior searches
  if (supabaseAdmin) {
    const enrichedApolloIds = enriched
      .map((p: Record<string, unknown>) => p.id as string)
      .filter(Boolean)

    if (enrichedApolloIds.length > 0) {
      const { data: reveals } = await supabaseAdmin
        .from('phone_reveals')
        .select('apollo_id, phone')
        .in('apollo_id', enrichedApolloIds)

      if (reveals && reveals.length > 0) {
        const phoneMap = new Map(reveals.map((r: { apollo_id: string; phone: string }) => [r.apollo_id, r.phone]))
        for (const person of enriched) {
          const p = person as Record<string, unknown>
          const bufferedPhone = phoneMap.get(p.id as string)
          if (bufferedPhone && !((p.phone_numbers as Array<{sanitized_number?: string}> | undefined)?.[0]?.sanitized_number)) {
            p.phone_numbers = [{ sanitized_number: bufferedPhone }]
          }
        }
        console.log(`Phone buffer: merged ${reveals.length} phones from prior searches`)
      }
    }
  }

  // Step 4: Filter invalid + transform
  for (const person of enriched) {
    const p = person as Record<string, unknown>
    const hasPhone = !!(p.phone_numbers as Array<{ sanitized_number?: string }> | undefined)?.[0]?.sanitized_number
    if (p.email_status === 'invalid') {
      if (hasPhone) { p.email = '' } else { p._drop = true }
    }
  }

  const validContacts = enriched.filter((p: Record<string, unknown>) => !p._drop)

  const leads = validContacts
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
        timezone: deriveTimezone((person.city as string) || '', (person.state as string) || '', (person.country as string) || ''),
        status: 'cold',
        assignedTo: '',
        lastContactedAt: null,
        notes: '',
        tags: ['apollo', 'generated'],
        linkedinUrl: (person.linkedin_url as string) || undefined,
        apolloId: (person.id as string) || null,
      }
    })

  const scored = leads
    .map(lead => ({ ...lead, _score: scoreLead(lead as unknown as Record<string, unknown>) }))
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...lead }) => lead)

  // Post-enrichment dedup: check emails against existing leads
  if (supabaseAdmin && scored.length > 0) {
    const enrichedEmails = scored.map(l => l.email).filter(Boolean)
    if (enrichedEmails.length > 0) {
      const { data: existingByEmail } = await supabaseAdmin
        .from('leads')
        .select('email')
        .in('email', enrichedEmails)

      const existingEmails = new Set((existingByEmail || []).map((r: { email: string }) => r.email))

      for (const lead of scored) {
        ;(lead as Record<string, unknown>).isDuplicate = existingEmails.has(lead.email as string)
      }
    }
  }

  return { leads: scored, totalFound, creditsUsed: enriched.length, skippedDuplicates: skippedCount }
}

// ---- Main Handler ----

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY')
    const ZEROBOUNCE_API_KEY = Deno.env.get('ZEROBOUNCE_API_KEY')

    if (!OPENROUTER_API_KEY || !APOLLO_API_KEY) {
      return new Response(JSON.stringify({ error: 'API keys not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { message, chatHistory, perPage, requirePhone } = await req.json()
    const phoneFilter = requirePhone === true

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const systemPrompt = `You are an intelligent lead generation assistant for IntegrateAPI CRM. You help users find business contacts via Apollo.io.

CRITICAL RULES:
- You must NEVER set shouldSearch to true on the FIRST message from the user. ALWAYS confirm first.
- shouldSearch can ONLY be true when the user has EXPLICITLY confirmed (said "yes", "go ahead", "proceed", "search", "do it", etc.)
- If the user's first message is a search request, you MUST respond with a confirmation — NEVER search immediately.

YOUR BEHAVIOR:
1. When the user describes who they're looking for (FIRST MESSAGE), you MUST:
   - Parse their request into filters
   - Show what you understood in a clear summary
   - Ask if they want to narrow by region/location if none was specified
   - Ask if they want to narrow by company size if none was specified
   - Estimate credits: ~${(perPage || 25) * 2} credits for ${perPage || 25} leads
   - Ask "Shall I proceed with this search?"
   - Set shouldSearch to FALSE
   - Include actions: [{"label":"Yes, search","prompt":"yes, proceed with the search"},{"label":"Modify search","prompt":"I want to change the search criteria"}]

2. ONLY when the user explicitly confirms (says "yes", "go ahead", "search", "proceed", "do it", clicks the Yes button), THEN set shouldSearch to true with the filters.

3. For vague requests missing key details (no industry, no title, no location), ask specific clarifying questions before even showing a confirmation.

4. After results are shown to the user and they ask for refinements, adjust filters and confirm again before searching.

RESPONSE FORMAT (always valid JSON):
{
  "response": "Your message to the user",
  "actions": [{"label": "Button text", "prompt": "What gets sent when clicked"}],
  "shouldSearch": false,
  "filters": {
    "person_titles": [],
    "person_locations": [],
    "organization_num_employees_ranges": [],
    "q_keywords": "",
    "person_seniorities": []
  }
}

FILTER RULES:
- person_titles: job title keywords (be generous — "CTO" → also "Chief Technology Officer")
- person_locations: "City, State" or "City, Country" format
- organization_num_employees_ranges: "1-10","11-50","51-200","201-500","501-1000","1001-5000","5001-10000","10001+"
- q_keywords: industry/topic terms
- person_seniorities: "c_suite","founder","owner","partner","vp","director","manager","senior","entry"
- Always return filters as an object with arrays (never null). Use shouldSearch to indicate if they're actionable.

PHONE FILTER:
The user has ${phoneFilter ? 'ENABLED' : 'DISABLED'} the "Require phone" filter.${phoneFilter ? '\nWhen confirming a search, mention that results will only include contacts with verified phone numbers on file. Adjust your credit estimate — not all search results will have phones, so actual enrichment count may be lower than requested.' : ''}`

    const llmMessages = [
      { role: 'system', content: systemPrompt },
      ...(chatHistory || []).map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: message },
    ]

    const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'IntegrateAPI CRM',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4.1-mini',
        messages: llmMessages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'lead_gen_response',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                response: { type: 'string' },
                actions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      prompt: { type: 'string' },
                    },
                    required: ['label', 'prompt'],
                    additionalProperties: false,
                  },
                },
                shouldSearch: { type: 'boolean' },
                filters: {
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
              required: ['response', 'actions', 'shouldSearch', 'filters'],
              additionalProperties: false,
            },
          },
        },
        temperature: 0.4,
      }),
    })

    if (!llmRes.ok) {
      const err = await llmRes.text()
      console.error('LLM error:', llmRes.status, err)
      await writeAlert(supabaseAdmin, {
        type: 'error',
        source: 'openrouter',
        message: `Lead generator AI failed (HTTP ${llmRes.status}). The conversational assistant is temporarily unavailable.`,
        details: { status: llmRes.status, error: err },
      })
      return new Response(JSON.stringify({ error: 'AI conversation failed' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const llmData = await llmRes.json()
    if (!llmData.choices?.length || !llmData.choices[0].message?.content) {
      return new Response(JSON.stringify({ error: 'No AI response' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const parsed = JSON.parse(llmData.choices[0].message.content)

    // If LLM says to search, run Apollo pipeline inline
    if (parsed.shouldSearch) {
      console.log('Running Apollo search with filters:', JSON.stringify(parsed.filters))

      const searchResults = await runApolloSearch(
        parsed.filters,
        perPage || 25,
        APOLLO_API_KEY,
        ZEROBOUNCE_API_KEY,
        supabaseAdmin,
        phoneFilter,
      )

      // Log usage
      try {
        const jwt = authHeader.replace('Bearer ', '')
        const { data: { user } } = await supabaseAdmin.auth.getUser(jwt)
        if (user) {
          await supabaseAdmin.from('apollo_usage').insert({
            user_id: user.id,
            action: 'search_and_enrich',
            credits_used: searchResults.creditsUsed,
            search_count: searchResults.leads.length,
            enrichment_count: searchResults.creditsUsed,
            results_returned: searchResults.leads.length,
            prompt: message,
          })
        }
      } catch (logErr) { console.error('Usage logging failed:', logErr) }

      // Generate follow-up based on results
      let followUpResponse: string
      let followUpActions: { label: string; prompt: string }[] = []

      if (searchResults.leads.length > 0) {
        const dupCount = searchResults.leads.filter((l: Record<string, unknown>) => l.isDuplicate).length
        const newCount = searchResults.leads.length - dupCount
        followUpResponse = `Found ${newCount} new contacts${dupCount > 0 ? ` and ${dupCount} already in your CRM` : ''} (${searchResults.creditsUsed} credits used${searchResults.skippedDuplicates > 0 ? `, ${searchResults.skippedDuplicates} duplicates skipped` : ''}). Here are the results:`
        followUpActions = [
          { label: 'Also check Director-level roles', prompt: 'Also search for Director-level roles with similar criteria' },
          { label: 'Expand to nearby locations', prompt: 'Expand the search to nearby cities and states' },
          { label: 'Narrow by company size', prompt: 'I want to narrow results by company size' },
        ]
      } else {
        followUpResponse = `No matching contacts found. Apollo's database is strongest for tech and B2B companies. Would you like to try a broader search?`
        followUpActions = [
          { label: 'Broader industry terms', prompt: 'Try broader industry keywords and related industries' },
          { label: 'Wider location', prompt: 'Expand to the entire state or region' },
          { label: 'Different titles', prompt: 'Try related job titles and seniority levels' },
        ]
      }

      return new Response(JSON.stringify({
        response: followUpResponse,
        actions: followUpActions,
        leads: searchResults.leads,
        filters: parsed.filters,
        creditsUsed: searchResults.creditsUsed,
        totalFound: searchResults.totalFound,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // No search — just conversation
    return new Response(JSON.stringify({
      response: parsed.response,
      actions: parsed.actions || [],
      leads: [],
      filters: parsed.filters,
      creditsUsed: 0,
      totalFound: 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('lead-gen-chat error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
