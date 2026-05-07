/**
 * React Query hook for the `replies` table with Realtime subscription.
 *
 * Realtime subscription listens for INSERT events on the replies table,
 * filtered by RLS (only campaigns the current user has access to).
 *
 * Mutation methods:
 *   - reclassify: update classification + auto-trigger fub-push if positive
 *   - manualPush: trigger FUB push for a selected positive reply
 */

import { useEffect } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import * as api from '@/lib/api/replies';
import type { Reply, ReplyClassification, GetRepliesOptions } from '@/lib/api/replies';

export type { Reply, ReplyClassification };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseRepliesReturn {
  replies: Reply[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  reclassify: (id: string, classification: ReplyClassification) => Promise<void>;
  manualPush: (replyId: string) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Fetch + subscribe to replies.
 *
 * @param options - Filters forwarded to getReplies. Stable reference required
 *   (use useMemo or pass literal for simple cases) to avoid infinite re-renders.
 */
export function useReplies(options: GetRepliesOptions = {}): UseRepliesReturn {
  const queryClient = useQueryClient();

  // Stable cache key from options
  const queryKey = ['replies', JSON.stringify(options)] as const;

  const {
    data: replies = [],
    isLoading,
    error,
    isFetching,
  }: UseQueryResult<Reply[], Error> = useQuery({
    queryKey,
    queryFn: () => api.getReplies(options),
    staleTime: 30_000,   // 30s — Realtime handles live updates
  });

  // ---- Realtime subscription (INSERT events on replies table) ----
  useEffect(() => {
    const channel = supabase
      .channel(`replies-realtime-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'replies',
          // Filter by campaign_id if specified — reduces noise for multi-campaign operators
          ...(options.campaignId
            ? { filter: `campaign_id=eq.${options.campaignId}` }
            : {}),
        },
        () => {
          // Invalidate so the query re-fetches — don't optimistically insert
          // (reply rows are complex + we want classifier state from DB)
          queryClient.invalidateQueries({ queryKey: ['replies'] });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'replies',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['replies'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, options.campaignId]);

  // ---- Mutations ----

  const reclassifyMutation = useMutation({
    mutationFn: ({ id, classification }: { id: string; classification: ReplyClassification }) =>
      api.reclassifyReply(id, classification),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replies'] });
    },
  });

  const manualPushMutation = useMutation({
    mutationFn: (replyId: string) => api.manualPushToFub(replyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replies'] });
    },
  });

  return {
    replies,
    isLoading,
    isFetching,
    error: error as Error | null,
    reclassify: (id, classification) =>
      reclassifyMutation.mutateAsync({ id, classification }),
    manualPush: (replyId) => manualPushMutation.mutateAsync(replyId),
  };
}

// ---------------------------------------------------------------------------
// Single reply hook (for detail pane)
// ---------------------------------------------------------------------------

export function useReply(id: string | null): {
  reply: Reply | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { data: reply = null, isLoading, error } = useQuery({
    queryKey: ['replies', id],
    queryFn: () => (id ? api.getReply(id) : null),
    enabled: !!id,
    staleTime: 30_000,
  });

  return { reply, isLoading, error: error as Error | null };
}
