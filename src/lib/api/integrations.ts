/**
 * Integration status — reads which vendor secrets are configured on the backend
 * (via the check-integrations Edge Function). Booleans only; no secret values.
 *
 * Degrades gracefully: returns null if the function isn't reachable/deployed yet,
 * so the Settings panel can fall back to "not configured" without erroring.
 */

import { supabase } from '@/lib/supabase';

export interface IntegrationStatus {
  smartlead: boolean;
  smartlead_webhook: boolean;
  zerobounce: boolean;
  resend: boolean;
  fub: boolean;
  fub_system_key: boolean;
  openrouter: boolean;
  list_unsub_secret: boolean;
}

export async function getIntegrationStatus(): Promise<IntegrationStatus | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-integrations`,
      { headers: { Authorization: `Bearer ${session.access_token}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.configured ?? null) as IntegrationStatus | null;
  } catch {
    return null;
  }
}
