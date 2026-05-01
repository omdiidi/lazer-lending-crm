import { corsHeaders } from '../_shared/cors.ts'
import { writeAlert } from '../_shared/alerts.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface LeadSummary {
  id: string
  firstName: string
  lastName: string
  company: string
  industry: string
  status: string
  jobTitle: string
  location: string
}

function buildSystemPrompt(leads: LeadSummary[], industries: string[]): string {
  const leadsTable = leads
    .map(l => `| ${l.id} | ${l.firstName} ${l.lastName} | ${l.company} | ${l.industry} | ${l.status} | ${l.jobTitle} | ${l.location} |`)
    .join('\n')

  return `You are an AI campaign assistant for IntegrateAPI, a sales CRM. Your job is to help users create email campaigns by:

1. Understanding their campaign intent from natural language
2. Selecting the right leads from their CRM based on filters (status, industry, location, job title, etc.)
3. Generating a professional email subject and body

AVAILABLE LEADS:
| ID | Name | Company | Industry | Status | Title | Location |
|---|---|---|---|---|---|---|
${leadsTable}

AVAILABLE FILTERS:
- Status: cold, lukewarm, warm, dead
- Industries: ${industries.join(', ')}

MERGE FIELDS (use these in the email subject and body — they get replaced per-recipient):
- {{firstName}} — recipient's first name
- {{company}} — recipient's company name

RULES:
- matchedLeadIds: Return an array of lead IDs from the table above that match the user's criteria. If the user wants ALL leads or doesn't specify filters, return an EMPTY array [] (the frontend interprets [] as "select all").
- subject: Concise (under 80 chars), professional. Include {{firstName}} when appropriate.
- body: 3-5 sentences, professional but conversational. Always include {{firstName}} and {{company}}.
- statusFilter: The status you filtered by. Empty string "" if no status filter applied.
- industryFilter: The industry you filtered by. Empty string "" if no industry filter applied.
- explanation: 1-2 sentences describing what you did, e.g. "Selected 12 cold SaaS leads and drafted an outreach email about your API integration platform."
- For follow-up messages (e.g. "make it shorter", "add warm leads too"), adjust your previous response based on the conversation history.
- Never invent lead IDs — only use IDs from the AVAILABLE LEADS table.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OpenRouter API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { prompt, leads, industries, chatHistory } = await req.json()

    const systemPrompt = buildSystemPrompt(leads, industries)

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(chatHistory || []).map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: prompt },
    ]

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'IntegrateAPI CRM',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v3.2',
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'campaign_result',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                matchedLeadIds: { type: 'array', items: { type: 'string' } },
                subject: { type: 'string' },
                body: { type: 'string' },
                statusFilter: { type: 'string' },
                industryFilter: { type: 'string' },
                explanation: { type: 'string' },
              },
              required: ['matchedLeadIds', 'subject', 'body', 'statusFilter', 'industryFilter', 'explanation'],
              additionalProperties: false,
            },
          },
        },
        temperature: 0.4,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('OpenRouter error:', response.status, errorBody)
      await writeAlert(supabaseAdmin, {
        type: 'error', source: 'openrouter',
        message: `Campaign AI targeting failed (HTTP ${response.status}).`,
        details: { status: response.status, error: errorBody },
      })
      return new Response(
        JSON.stringify({ error: `LLM request failed (${response.status})` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const data = await response.json()

    if (!data.choices?.length || !data.choices[0].message?.content) {
      return new Response(
        JSON.stringify({ error: 'No response from LLM' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const content = JSON.parse(data.choices[0].message.content)

    if (data?.error) throw new Error(data.error)

    return new Response(JSON.stringify(content), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('campaign-ai error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
