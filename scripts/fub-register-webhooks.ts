/**
 * FUB Webhook Registration — one-off Deno script
 *
 * Registers Follow Up Boss outbound webhooks so FUB can push events
 * back to our `fub-events` Edge Function.
 *
 * Events registered:
 *   - peopleStageUpdated (most useful — feeds classifier improvement loop)
 *   - peopleCreated (low-priority audit)
 *
 * Run: deno run --allow-net --allow-env scripts/fub-register-webhooks.ts
 *
 * Required env vars:
 *   FUB_API_KEY
 *   FUB_X_SYSTEM          (default: lazer-lending-crm)
 *   FUB_X_SYSTEM_KEY      (issued by FUB support)
 *   FUB_EVENTS_ENDPOINT   (e.g. https://your-project.supabase.co/functions/v1/fub-events)
 *
 * IMPORTANT: FUB limits 2 webhooks per event type per system (P6).
 * Running this script twice will fail on the third registration.
 * Check existing webhooks first via GET /v1/webhooks.
 *
 * VENDOR-CONTRACTS.md reference: §4 — Webhooks back from FUB.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    Deno.exit(1);
  }
  return value;
}

const FUB_API_KEY = getRequiredEnv('FUB_API_KEY');
const FUB_X_SYSTEM = Deno.env.get('FUB_X_SYSTEM') ?? 'lazer-lending-crm';
const FUB_X_SYSTEM_KEY = getRequiredEnv('FUB_X_SYSTEM_KEY');
const EVENTS_ENDPOINT = getRequiredEnv('FUB_EVENTS_ENDPOINT');

const BASE_URL = 'https://api.followupboss.com';
const AUTH_HEADER = 'Basic ' + btoa(`${FUB_API_KEY}:`);

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fubRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: AUTH_HEADER,
      'X-System': FUB_X_SYSTEM,
      'X-System-Key': FUB_X_SYSTEM_KEY,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`FUB API error ${res.status} for ${method} ${path}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('\nFUB Webhook Registration');
console.log(`Endpoint: ${EVENTS_ENDPOINT}`);
console.log(`System: ${FUB_X_SYSTEM}`);

// ---- Check existing webhooks ----
console.log('\nChecking existing webhooks...');
const existing = await fubRequest('GET', '/v1/webhooks') as {
  webhooks?: Array<{ id: number; event: string; url: string }>
};
const existingWebhooks = existing.webhooks ?? [];

if (existingWebhooks.length > 0) {
  console.log(`Found ${existingWebhooks.length} existing webhook(s):`);
  for (const wh of existingWebhooks) {
    console.log(`  [${wh.id}] ${wh.event} → ${wh.url}`);
  }
}

// ---- Register webhooks ----
const eventsToRegister = [
  { event: 'peopleStageUpdated', description: 'Stage update (classifier feedback loop)' },
  { event: 'peopleCreated', description: 'Person created (audit log)' },
];

for (const { event, description } of eventsToRegister) {
  // Check if already registered (FUB P6: max 2 per event per system)
  const alreadyRegistered = existingWebhooks.filter(wh => wh.event === event);
  if (alreadyRegistered.length >= 2) {
    console.warn(`\nWARNING: Already have ${alreadyRegistered.length} webhook(s) for ${event} (max 2).`);
    console.warn('  Remove one before registering another. Skipping.');
    continue;
  }

  console.log(`\nRegistering ${event} (${description})...`);
  try {
    const result = await fubRequest('POST', '/v1/webhooks', {
      event,
      url: EVENTS_ENDPOINT,
    }) as { id?: number; event?: string; url?: string };

    console.log(`  Registered: id=${result.id} event=${result.event} url=${result.url}`);
  } catch (err) {
    console.error(`  Failed to register ${event}:`, err instanceof Error ? err.message : String(err));
  }
}

console.log('\nDone. Verify webhooks at: https://app.followupboss.com/2/settings/api\n');
