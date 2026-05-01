import { supabase } from '@/lib/supabase';

export interface LeadSummary {
  id: string;
  name: string;
  company: string;
  status: string;
  industry: string;
  assignedTo: string;
}

export interface ProfileSummary {
  id: string;
  name: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssignLeadsRequest {
  prompt: string;
  leads: LeadSummary[];
  profiles: ProfileSummary[];
  chatHistory: ChatMessage[];
}

export interface AssignLeadsResponse {
  action: 'assign' | 'message';
  matchedLeadIds: string[];
  targetUserId: string;
  targetUserName: string;
  matchCount: number;
  confirmationMessage: string;
  responseMessage: string;
}

export async function assignLeadsAI(request: AssignLeadsRequest): Promise<AssignLeadsResponse> {
  const { data, error } = await supabase.functions.invoke('assign-leads-ai', {
    body: request,
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as AssignLeadsResponse;
}
