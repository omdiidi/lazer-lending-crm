import { supabase } from '@/lib/supabase';

export interface LeadSummary {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  industry: string;
  status: string;
  jobTitle: string;
  location: string;
}

export interface CampaignAIRequest {
  prompt: string;
  leads: LeadSummary[];
  industries: string[];
  chatHistory: { role: 'user' | 'assistant'; content: string }[];
}

export interface CampaignAIResponse {
  matchedLeadIds: string[];
  subject: string;
  body: string;
  /** Empty string means no filter applied */
  statusFilter: string;
  /** Empty string means no filter applied */
  industryFilter: string;
  explanation: string;
}

export async function generateCampaignCopy(
  request: CampaignAIRequest,
): Promise<CampaignAIResponse> {
  const { data, error } = await supabase.functions.invoke('campaign-ai', {
    body: request,
  });

  if (error) throw error;
  return data as CampaignAIResponse;
}
