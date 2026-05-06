/**
 * FUB Onboarding Check — one-off Deno script
 *
 * Calls Follow Up Boss read-only endpoints to verify:
 *   1. API key + X-System-Key are valid
 *   2. Stages list — operator confirms FUB_DEFAULT_STAGE_NAME matches a real stage
 *   3. Pipelines list — confirm target pipeline
 *   4. Custom fields — capture machine names to avoid display-name mismatch (P5)
 *
 * Run: deno run --allow-net --allow-env scripts/fub-onboarding-check.ts
 *
 * Required env vars (set in shell or .env before running):
 *   FUB_API_KEY
 *   FUB_X_SYSTEM        (default: lazer-lending-crm)
 *   FUB_X_SYSTEM_KEY    (issued by FUB support)
 *   FUB_DEFAULT_STAGE_NAME   (the stage you intend to use — we check it exists)
 *
 * VENDOR-CONTRACTS.md reference: §4 Gotchas P5, P9.
 */

// ---------------------------------------------------------------------------
// Auth helpers
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
const TARGET_STAGE_NAME = Deno.env.get('FUB_DEFAULT_STAGE_NAME') ?? '';

const BASE_URL = 'https://api.followupboss.com';
const AUTH_HEADER = 'Basic ' + btoa(`${FUB_API_KEY}:`);

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fubGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: AUTH_HEADER,
      'X-System': FUB_X_SYSTEM,
      'X-System-Key': FUB_X_SYSTEM_KEY,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`FUB API error ${res.status} for ${path}: ${body.slice(0, 300)}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Pretty-print helpers
// ---------------------------------------------------------------------------

function section(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(` ${title}`);
  console.log('='.repeat(60));
}

function row(label: string, value: unknown) {
  console.log(`  ${label.padEnd(28)} ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('\nFollow Up Boss Onboarding Check');
console.log(`Account: X-System = ${FUB_X_SYSTEM}`);
console.log(`Target stage: ${TARGET_STAGE_NAME || '(not set — FUB_DEFAULT_STAGE_NAME not configured)'}`);

try {
  // ---- Stages ----
  section('Stages (GET /v1/stages)');
  const stagesData = await fubGet('/v1/stages') as { stages?: Array<{ id: number; name: string; pipelineId: number }> };
  const stages = stagesData.stages ?? [];

  if (stages.length === 0) {
    console.log('  No stages returned — check API key scope');
  } else {
    console.log(`  Found ${stages.length} stages:`);
    for (const s of stages) {
      const isTarget = s.name === TARGET_STAGE_NAME;
      console.log(`    [${s.id}] "${s.name}" (pipeline: ${s.pipelineId})${isTarget ? '  <-- TARGET STAGE FOUND' : ''}`);
    }
    if (TARGET_STAGE_NAME && !stages.find(s => s.name === TARGET_STAGE_NAME)) {
      console.warn(`\n  WARNING: Target stage "${TARGET_STAGE_NAME}" NOT found in FUB.`);
      console.warn('  FUB pushes will silently use the wrong stage. Update FUB_DEFAULT_STAGE_NAME.');
    }
  }

  // ---- Pipelines ----
  section('Pipelines (GET /v1/pipelines)');
  const pipelinesData = await fubGet('/v1/pipelines') as { pipelines?: Array<{ id: number; name: string }> };
  const pipelines = pipelinesData.pipelines ?? [];

  if (pipelines.length === 0) {
    console.log('  No pipelines returned');
  } else {
    console.log(`  Found ${pipelines.length} pipelines:`);
    for (const p of pipelines) {
      row(`[${p.id}]`, p.name);
    }
  }

  // ---- Custom Fields ----
  section('Custom Fields (GET /v1/customFields)');
  const fieldsData = await fubGet('/v1/customFields') as {
    customFields?: Array<{ id: number; label: string; name: string; type: string }>
  };
  const fields = fieldsData.customFields ?? [];

  if (fields.length === 0) {
    console.log('  No custom fields defined');
  } else {
    console.log(`  Found ${fields.length} custom fields:`);
    console.log('  (IMPORTANT: use machine name, not label, when setting values — P5)');
    for (const f of fields) {
      console.log(`    label="${f.label}"  machine_name="${f.name}"  type=${f.type}`);
    }
  }

  // ---- Summary ----
  section('Summary');
  console.log('  API key:       VALID (requests succeeded)');
  console.log('  X-System-Key:  VALID (non-empty, used in auth)');
  console.log(`  Stages found:  ${stages.length}`);
  console.log(`  Pipelines:     ${pipelines.length}`);
  console.log(`  Custom fields: ${fields.length}`);
  if (TARGET_STAGE_NAME && stages.find(s => s.name === TARGET_STAGE_NAME)) {
    console.log(`  Target stage "${TARGET_STAGE_NAME}": CONFIRMED`);
  }
  console.log('\n  Next steps:');
  console.log('  1. Confirm FUB_DEFAULT_STAGE_NAME matches a stage name above.');
  console.log('  2. If using per-campaign stage overrides, note the exact stage names.');
  console.log('  3. Note any custom field machine names you intend to populate.');
  console.log('  4. Run scripts/fub-register-webhooks.ts to register the webhook.\n');

} catch (err) {
  console.error('\nFailed:', err instanceof Error ? err.message : String(err));
  Deno.exit(1);
}
