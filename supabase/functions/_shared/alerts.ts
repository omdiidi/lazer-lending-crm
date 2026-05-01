import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function writeAlert(
  supabaseAdmin: ReturnType<typeof createClient>,
  alert: { type: 'error' | 'warning'; source: string; message: string; details?: Record<string, unknown> }
) {
  try {
    // Dedup: skip if same source+message has unresolved alert within 5 minutes
    const { data: existing } = await supabaseAdmin
      .from('system_alerts')
      .select('id')
      .eq('source', alert.source)
      .eq('message', alert.message)
      .eq('resolved', false)
      .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .limit(1)

    if (existing && existing.length > 0) return

    // Service role bypasses RLS — no INSERT policy needed for authenticated users
    await supabaseAdmin.from('system_alerts').insert({
      type: alert.type,
      source: alert.source,
      message: alert.message,
      details: alert.details || {},
    })
  } catch (e) {
    console.error('Failed to write alert:', e)
  }
}
