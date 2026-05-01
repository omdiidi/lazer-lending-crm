import { supabase } from '@/lib/supabase';
import type { Lead } from '@/types/crm';

export interface LeadGenChatResponse {
  response: string;
  actions: { label: string; prompt: string }[];
  leads: Lead[];
  filters: Record<string, unknown> | null;
  creditsUsed: number;
  totalFound: number;
}

export async function sendLeadGenMessage(
  message: string,
  chatHistory: { role: 'user' | 'assistant'; content: string }[],
  perPage?: number,
  requirePhone?: boolean,
): Promise<LeadGenChatResponse> {
  const { data, error } = await supabase.functions.invoke('lead-gen-chat', {
    body: { message, chatHistory, perPage, requirePhone },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as LeadGenChatResponse;
}
