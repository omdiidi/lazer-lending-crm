import { supabase } from '@/lib/supabase';

export interface EmailAttachment {
  id: string;
  emailId: string;
  filename: string;
  contentType: string;
  fileSize: number;
  storagePath: string;
  createdAt: string;
}

export async function getEmailAttachments(emailId: string): Promise<EmailAttachment[]> {
  const { data, error } = await supabase
    .from('email_attachments')
    .select('*')
    .eq('email_id', emailId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    emailId: row.email_id,
    filename: row.filename,
    contentType: row.content_type,
    fileSize: row.file_size,
    storagePath: row.storage_path,
    createdAt: row.created_at,
  }));
}

export async function uploadAttachment(file: File): Promise<{
  storagePath: string; filename: string; contentType: string; size: number;
}> {
  const storagePath = `outbound-drafts/${Date.now()}-${file.name}`;
  const { error } = await supabase.storage
    .from('email-attachments')
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return { storagePath, filename: file.name, contentType: file.type, size: file.size };
}

export async function getSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('email-attachments')
    .createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}
