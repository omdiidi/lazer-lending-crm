import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/mailboxes';
import { supabase } from '@/lib/supabase';
import type { PausedReason } from '@/types/lazer';

export function useMailboxes() {
  const queryClient = useQueryClient();

  const { data: mailboxes = [], isLoading, error } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: api.getMailboxes,
  });

  // Realtime subscription — live status updates without manual refresh
  useEffect(() => {
    const channel = supabase
      .channel(`mailboxes-realtime-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mailboxes' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const pauseMailboxMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: PausedReason }) =>
      api.pauseMailbox(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mailboxes'] }),
  });

  const resumeMailboxMutation = useMutation({
    mutationFn: (id: string) => api.resumeMailbox(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mailboxes'] }),
  });

  return {
    mailboxes,
    isLoading,
    error,
    pauseMailbox: (id: string, reason: PausedReason) =>
      pauseMailboxMutation.mutate({ id, reason }),
    isPausing: pauseMailboxMutation.isPending,
    resumeMailbox: (id: string) => resumeMailboxMutation.mutate(id),
    isResuming: resumeMailboxMutation.isPending,
  };
}
