const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface LeadSummary {
  id: string
  name: string
  company: string
  status: string
  industry: string
  assignedTo: string  // employee name or "Unassigned"
}

interface ProfileSummary {
  id: string
  name: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

function buildSystemPrompt(leads: LeadSummary[], profiles: ProfileSummary[]): string {
  const leadsTable = leads
    .map(l => `| ${l.id} | ${l.name} | ${l.company} | ${l.status} | ${l.industry} | ${l.assignedTo} |`)
    .join('\n')

  const employeeList = profiles.map(p => `- ${p.id}: ${p.name}`).join('\n')

  return `You are an AI lead assignment assistant for a sales CRM. Your job is to help admins assign leads to team members based on natural language instructions.

AVAILABLE LEADS (capped at 500 most recent):
| ID | Name | Company | Status | Industry | Currently Assigned To |
|---|---|---|---|---|---|
${leadsTable}

AVAILABLE EMPLOYEES:
${employeeList}

RULES:
- When the user wants to assign leads, set action to "assign", populate matchedLeadIds with the matching lead IDs from the table above, and set targetUserId/targetUserName to the matching employee.
- When the user is asking a question or chatting (not assigning), set action to "message" with an empty matchedLeadIds array and empty targetUserId.
- Only use lead IDs and employee IDs from the lists above — never invent IDs.
- matchedLeadIds: Only include leads that match ALL specified criteria. If criteria are ambiguous, err on the side of fewer matches and explain in responseMessage.
- confirmationMessage: A clear one-sentence summary, e.g. "Assign 14 cold SaaS leads to Sarah?"
- responseMessage: Always provide a helpful message explaining what you found or did.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OpenRouter API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { prompt, leads, profiles, chatHistory } = await req.json()

    // Server-side safety cap
    const cappedLeads: LeadSummary[] = (leads || []).slice(0, 500)

    const systemPrompt = buildSystemPrompt(cappedLeads, profiles || [])

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(chatHistory || []).map((m: ChatMessage) => ({
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
            name: 'assignment_result',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['assign', 'message'] },
                matchedLeadIds: { type: 'array', items: { type: 'string' } },
                targetUserId: { type: 'string' },
                targetUserName: { type: 'string' },
                matchCount: { type: 'number' },
                confirmationMessage: { type: 'string' },
                responseMessage: { type: 'string' },
              },
              required: ['action', 'matchedLeadIds', 'targetUserId', 'targetUserName', 'matchCount', 'confirmationMessage', 'responseMessage'],
              additionalProperties: false,
            },
          },
        },
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('OpenRouter error:', response.status, errorBody)
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

    return new Response(JSON.stringify(content), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('assign-leads-ai error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
