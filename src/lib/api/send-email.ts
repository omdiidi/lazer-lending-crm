import { supabase } from '@/lib/supabase';

interface AttachmentRef {
  storagePath: string;
  filename: string;
  contentType: string;
  size: number;
}

interface SendEmailRequest {
  leadId?: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  replyToId?: string;
  attachments?: AttachmentRef[];
}

interface SendEmailResponse {
  emails: unknown[];
  count: number;
  failedCount: number;
}

export async function sendEmail(email: SendEmailRequest): Promise<SendEmailResponse> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) throw new Error('Not authenticated');

  const { data, error } = await supabase.functions.invoke('send-email', {
    body: { emails: [email] },
    headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as SendEmailResponse;
}

export async function sendBulkEmails(emails: SendEmailRequest[], campaignId?: string): Promise<SendEmailResponse> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) throw new Error('Not authenticated');

  const { data, error } = await supabase.functions.invoke('send-email', {
    body: { emails, campaignId: campaignId ?? null },
    headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as SendEmailResponse;
}
