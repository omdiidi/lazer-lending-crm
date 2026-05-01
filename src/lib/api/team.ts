import { supabase } from '@/lib/supabase';

export async function createInvite(name: string, email: string, role: string) {
  const { data, error } = await supabase.functions.invoke('create-invite', {
    body: { name, email, role },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { token: string };
}

export async function signupWithToken(token: string, password: string) {
  const { data, error } = await supabase.functions.invoke('signup-with-token', {
    body: { token, password },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { success: boolean; email: string };
}

export async function deleteMember(userId: string) {
  const { data, error } = await supabase.functions.invoke('delete-member', {
    body: { userId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { success: boolean };
}
