/**
 * API client for the `validate-upload` Edge Function (ZeroBounce bulk validation).
 *
 * Three-step async flow:
 *   1. submit   — POST the CSV (base64) + email column index → returns a ZeroBounce file_id
 *   2. status   — poll until { complete: true }
 *   3. finalize — download the result, write suppressions for bad emails, stamp ZB
 *                 fields onto existing lead rows, return aggregate stats
 *
 * IMPORTANT: validate-upload is update-only — it does NOT create leads. Import the
 * leads first (so rows exist, matched by email_normalized), THEN run validation.
 *
 * Each call forwards the user's JWT (the Edge Function authorizes via resolveUser).
 * Mirrors the session+fetch pattern in src/lib/api/domains.ts.
 */

import { supabase } from '@/lib/supabase';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-upload`;

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

/** Error thrown when the Edge Function responds with success:false (e.g. ZeroBounce not configured). */
export class ValidateUploadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ValidateUploadError';
    this.status = status;
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new ValidateUploadError(
      data?.error ?? `validate-upload failed (HTTP ${res.status})`,
      res.status,
    );
  }
  return data as T;
}

export interface SubmitResult {
  success: true;
  file_id: string;
}

export interface StatusResult {
  success: true;
  status?: string;
  percent_complete?: string | number;
  complete: boolean;
}

export interface FinalizeResult {
  success: true;
  total: number;
  valid: number;
  suppressed: number;
  by_substatus: Record<string, number>;
}

/** Submit a base64-encoded CSV for bulk validation. emailColumnIndex is 0-based. */
export function submitValidation(
  csvBase64: string,
  emailColumnIndex: number,
): Promise<SubmitResult> {
  return call<SubmitResult>({
    action: 'submit',
    csv_base64: csvBase64,
    email_column_index: emailColumnIndex,
  });
}

/** Poll the validation job status. */
export function getValidationStatus(fileId: string): Promise<StatusResult> {
  return call<StatusResult>({ action: 'status', file_id: fileId });
}

/** Finalize: parse results, suppress bad emails, stamp ZB data onto existing leads. */
export function finalizeValidation(
  fileId: string,
  campaignId?: string,
): Promise<FinalizeResult> {
  return call<FinalizeResult>({
    action: 'finalize',
    file_id: fileId,
    ...(campaignId ? { campaign_id: campaignId } : {}),
  });
}

/**
 * Convenience: poll status until complete (or timeout), then finalize.
 * Calls onProgress with the percent string/number on each poll tick.
 */
export async function pollThenFinalize(
  fileId: string,
  opts: {
    onProgress?: (percent: string | number | undefined) => void;
    intervalMs?: number;
    maxAttempts?: number;
    campaignId?: string;
  } = {},
): Promise<FinalizeResult> {
  const intervalMs = opts.intervalMs ?? 3000;
  const maxAttempts = opts.maxAttempts ?? 60; // ~3 min at 3s

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await getValidationStatus(fileId);
    opts.onProgress?.(status.percent_complete);
    if (status.complete) {
      return finalizeValidation(fileId, opts.campaignId);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new ValidateUploadError('Validation timed out — check ZeroBounce dashboard.', 408);
}
