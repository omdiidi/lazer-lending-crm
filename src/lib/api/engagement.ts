import { supabase } from '@/lib/supabase';

export interface LeadEngagement {
  leadId: string;
  score: number;
  opens: number;
  clicks: number;
  replies: number;
}

export async function getTopEngagedLeads(limit = 10): Promise<LeadEngagement[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: outbound } = await supabase
    .from('emails')
    .select('lead_id, opened_at, clicked_at')
    .eq('direction', 'outbound')
    .not('lead_id', 'is', null)
    .gte('sent_at', ninetyDaysAgo);

  const { data: inbound } = await supabase
    .from('emails')
    .select('lead_id')
    .eq('direction', 'inbound')
    .not('lead_id', 'is', null)
    .gte('sent_at', ninetyDaysAgo);

  const scores = new Map<string, { opens: number; clicks: number; replies: number }>();

  for (const e of outbound || []) {
    if (!e.lead_id) continue;
    const current = scores.get(e.lead_id) || { opens: 0, clicks: 0, replies: 0 };
    if (e.opened_at) current.opens++;
    if (e.clicked_at) current.clicks++;
    scores.set(e.lead_id, current);
  }

  for (const e of inbound || []) {
    if (!e.lead_id) continue;
    const current = scores.get(e.lead_id) || { opens: 0, clicks: 0, replies: 0 };
    current.replies++;
    scores.set(e.lead_id, current);
  }

  return Array.from(scores.entries())
    .map(([leadId, s]) => ({
      leadId,
      score: s.opens * 1 + s.clicks * 3 + s.replies * 5,
      ...s,
    }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
