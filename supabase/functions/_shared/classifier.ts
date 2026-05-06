/**
 * Deno-side LLM classifier with circuit breaker.
 *
 * Implements `classifyReplyWithCircuit` per PLAN.md pseudocode (cycle 4 fix:
 * `new Date(circuit.open_at).getTime()` for safe timestamp comparison — avoids
 * NaN comparison when `open_at` is a Postgres ISO string).
 *
 * Provider abstraction:
 *   CLASSIFIER_PROVIDER = 'anthropic' (default) | 'openai-enterprise'
 *   CLASSIFIER_API_KEY   = provider API key
 *   CLASSIFIER_MODEL     = model name (default 'claude-sonnet-4-6' for Anthropic)
 *
 * Circuit breaker state is stored in the `classifier_circuit` table:
 *   { id: 'singleton', open_at: timestamp | null, failure_count: number, last_failure_at: timestamp | null }
 *
 * On 3 consecutive failures → circuit opens for 5 minutes.
 * On success → failure_count resets.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClassificationLabel = 'positive' | 'neutral' | 'ooo' | 'unsubscribe' | 'negative';

export interface Classification {
  label: ClassificationLabel;
  confidence: number;     // 0–1
  rationale: string;      // 1-sentence explanation from LLM
  language?: string;      // ISO 639-1 if detected
}

export interface ReplyForClassification {
  id: string;
  subject: string;
  body_text: string;
  from_email?: string;
  from_name?: string;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a reply classifier for a residential mortgage cold-outreach CRM.

Classify the prospect's reply intent into exactly ONE of these categories:
- positive: the prospect is interested, wants to learn more, or wants to connect
- neutral: the reply is ambiguous, asks a question without clear interest, or needs human judgment
- ooo: the reply is an out-of-office / vacation auto-responder
- unsubscribe: the prospect explicitly wants to stop receiving emails or be removed
- negative: the prospect is not interested, hostile, or asks not to be contacted

Rules:
1. If in doubt between positive and neutral, choose neutral.
2. If in doubt between negative and unsubscribe, choose unsubscribe (compliance priority).
3. Auto-responders that say "I'll be in touch" are ooo, not positive.
4. Questions like "who are you?" without expressed interest are neutral.

Respond with ONLY a JSON object in this exact shape:
{
  "label": "<one of: positive|neutral|ooo|unsubscribe|negative>",
  "confidence": <float 0.0 to 1.0>,
  "rationale": "<one sentence explaining the classification>",
  "language": "<ISO 639-1 code of the reply language, e.g. en, es, fr>"
}`;

// ---------------------------------------------------------------------------
// LLM call — Anthropic
// ---------------------------------------------------------------------------

async function callAnthropic(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<Classification> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      // Anthropic structured output: use tool_use to guarantee JSON schema.
      // If tool_use is unavailable for the model, fall back to text parsing.
      tools: [
        {
          name: 'classify_reply',
          description: 'Output the reply classification as structured JSON',
          input_schema: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                enum: ['positive', 'neutral', 'ooo', 'unsubscribe', 'negative'],
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              rationale: { type: 'string' },
              language: { type: 'string' },
            },
            required: ['label', 'confidence', 'rationale'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'classify_reply' },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = await res.json()

  // Prefer tool_use block (structured output path)
  const toolBlock = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (toolBlock?.input) {
    return toolBlock.input as Classification
  }

  // Fallback: parse JSON from text content
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')
  if (textBlock?.text) {
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as Classification
  }

  throw new Error('Anthropic response did not contain usable classification output')
}

// ---------------------------------------------------------------------------
// LLM call — OpenAI Enterprise
// ---------------------------------------------------------------------------

async function callOpenAI(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<Classification> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      // OpenAI Enterprise / GPT-4+ supports response_format JSON schema
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'classify_reply',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                enum: ['positive', 'neutral', 'ooo', 'unsubscribe', 'negative'],
              },
              confidence: { type: 'number' },
              rationale: { type: 'string' },
              language: { type: 'string' },
            },
            required: ['label', 'confidence', 'rationale', 'language'],
            additionalProperties: false,
          },
        },
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenAI returned empty content')

  return JSON.parse(content) as Classification
}

// ---------------------------------------------------------------------------
// Core classifier (no circuit breaker — circuit breaker wraps this)
// ---------------------------------------------------------------------------

/**
 * Call the configured LLM provider with a timeout of 5 seconds.
 * Body should already be PII-redacted and truncated by the caller.
 */
export async function classifyReply(
  reply: ReplyForClassification,
  redactedBody: string,
): Promise<Classification> {
  const provider = Deno.env.get('CLASSIFIER_PROVIDER') ?? 'anthropic'
  const apiKey = Deno.env.get('CLASSIFIER_API_KEY')
  const model = Deno.env.get('CLASSIFIER_MODEL') ?? 'claude-sonnet-4-6'

  if (!apiKey) throw new Error('CLASSIFIER_API_KEY env var not set')

  const prompt = `Subject: ${reply.subject ?? '(no subject)'}
Body (redacted, truncated to 200 chars): ${redactedBody}`

  // 5-second timeout using AbortController + race
  const timeoutMs = 5_000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let result: Classification
    if (provider === 'openai-enterprise') {
      result = await callOpenAI(prompt, model, apiKey)
    } else {
      result = await callAnthropic(prompt, model, apiKey)
    }
    clearTimeout(timeoutId)
    return result
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : String(err)
    if (controller.signal.aborted || msg.includes('AbortError')) {
      throw new Error(`LLM classifier timed out after ${timeoutMs}ms`)
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Circuit breaker wrapper
// ---------------------------------------------------------------------------

const CIRCUIT_OPEN_MS = 5 * 60 * 1000      // 5 minutes
const FAILURE_THRESHOLD = 3                  // open after 3 consecutive failures

/**
 * Classify with circuit breaker.
 *
 * Circuit state is persisted in `classifier_circuit` (single-row singleton).
 * On LLM timeout / error → increment failure count; open circuit at threshold.
 * On success → reset failure count.
 * While circuit is open → skip LLM, mark reply requires_human_review.
 *
 * @param supabaseAdmin - Service-role Supabase client (bypasses RLS)
 * @param reply - Reply row from DB
 * @param redactedBody - PII-redacted + truncated body text
 */
export async function classifyReplyWithCircuit(
  supabaseAdmin: ReturnType<typeof createClient>,
  reply: ReplyForClassification,
  redactedBody: string,
): Promise<Classification | null> {
  // --- Load circuit state ---
  const { data: circuitRow } = await supabaseAdmin
    .from('classifier_circuit')
    .select('open_at, failure_count, last_failure_at')
    .eq('id', 'singleton')
    .maybeSingle()

  const circuit = circuitRow ?? { open_at: null, failure_count: 0, last_failure_at: null }

  // --- Check if circuit is open ---
  if (circuit.open_at) {
    // Cycle 4 fix: use `new Date(circuit.open_at).getTime()` to avoid NaN comparison
    const openedAt = new Date(circuit.open_at).getTime()
    const elapsedMs = Date.now() - openedAt
    if (elapsedMs < CIRCUIT_OPEN_MS) {
      // Circuit open — skip LLM, mark for human review
      await supabaseAdmin
        .from('replies')
        .update({ requires_human_review: true, classifier_error: 'circuit_open' })
        .eq('id', reply.id)
      console.warn(`[classifier] Circuit open (${Math.round(elapsedMs / 1000)}s elapsed) — skipping LLM for reply ${reply.id}`)
      return null
    }
    // Circuit has expired — allow one attempt (half-open state)
    console.info('[classifier] Circuit expired — attempting half-open probe')
  }

  // --- Attempt classification ---
  try {
    const result = await classifyReply(reply, redactedBody)

    // Success: reset circuit
    if (circuit.failure_count > 0) {
      await supabaseAdmin
        .from('classifier_circuit')
        .upsert({ id: 'singleton', open_at: null, failure_count: 0, last_failure_at: null })
    }

    return result
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error('[classifier] LLM call failed:', errorMsg)

    // Increment failure count
    const newFailureCount = (circuit.failure_count ?? 0) + 1
    const shouldOpen = newFailureCount >= FAILURE_THRESHOLD

    await supabaseAdmin
      .from('classifier_circuit')
      .upsert({
        id: 'singleton',
        open_at: shouldOpen ? new Date().toISOString() : circuit.open_at,
        failure_count: newFailureCount,
        last_failure_at: new Date().toISOString(),
      })

    if (shouldOpen) {
      console.error('[classifier] Circuit opened after', newFailureCount, 'failures')
      // Alert ops via system_alerts
      try {
        await supabaseAdmin.from('system_alerts').insert({
          type: 'error',
          source: 'classifier-circuit',
          message: 'LLM classifier circuit opened — all replies going to human review',
          details: { failure_count: newFailureCount, last_error: errorMsg },
        })
      } catch (_alertErr) { /* non-fatal */ }
    }

    // Mark reply for human review
    await supabaseAdmin
      .from('replies')
      .update({ requires_human_review: true, classifier_error: errorMsg.slice(0, 500) })
      .eq('id', reply.id)

    return null
  }
}
