import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/emails';
import { supabase } from '@/lib/supabase';
import type { EmailMessage } from '@/types/crm';

export function useEmails(userId?: string) {
  const queryClient = useQueryClient();

  const { data: emails = [], isLoading, error, isFetching } = useQuery({
    queryKey: ['emails', userId],
    queryFn: () => api.getEmails(userId),
  });

  useEffect(() => {
    const channel = supabase
      .channel('emails-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emails' }, () => {
        queryClient.invalidateQueries({ queryKey: ['emails'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const addEmailMutation = useMutation({
    mutationFn: (email: Omit<EmailMessage, 'id'>) =>
      api.createEmail(email),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emails'] }),
  });

  const updateEmailMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<EmailMessage> }) =>
      api.updateEmail(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emails'] }),
  });

  const markEmailReadMutation = useMutation({
    mutationFn: ({ id, read }: { id: string; read?: boolean }) =>
      api.markEmailRead(id, read),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emails'] }),
  });

  return {
    emails,
    isLoading,
    isFetching,
    error,
    addEmail: (email: Omit<EmailMessage, 'id'>) =>
      addEmailMutation.mutate(email),
    addEmailAsync: (email: Omit<EmailMessage, 'id'>) =>
      addEmailMutation.mutateAsync(email),
    updateEmail: (id: string, updates: Partial<EmailMessage>) =>
      updateEmailMutation.mutate({ id, updates }),
    markEmailRead: (id: string, read?: boolean) =>
      markEmailReadMutation.mutate({ id, read }),
  };
}
