import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/sending-pools';

export function useSendingPools() {
  const queryClient = useQueryClient();

  const { data: pools = [], isLoading, error } = useQuery({
    queryKey: ['sending-pools'],
    queryFn: api.getSendingPools,
  });

  const createPoolMutation = useMutation({
    mutationFn: (name: string) => api.createSendingPool(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sending-pools'] }),
  });

  const addMailboxMutation = useMutation({
    mutationFn: ({ poolId, mailboxId }: { poolId: string; mailboxId: string }) =>
      api.addMailboxToPool(poolId, mailboxId),
    onSuccess: (_data, { poolId }) => {
      queryClient.invalidateQueries({ queryKey: ['sending-pools'] });
      queryClient.invalidateQueries({ queryKey: ['pool-mailboxes', poolId] });
    },
  });

  const removeMailboxMutation = useMutation({
    mutationFn: ({ poolId, mailboxId }: { poolId: string; mailboxId: string }) =>
      api.removeMailboxFromPool(poolId, mailboxId),
    onSuccess: (_data, { poolId }) => {
      queryClient.invalidateQueries({ queryKey: ['sending-pools'] });
      queryClient.invalidateQueries({ queryKey: ['pool-mailboxes', poolId] });
    },
  });

  return {
    pools,
    isLoading,
    error,
    createPool: (name: string) => createPoolMutation.mutate(name),
    createPoolAsync: (name: string) => createPoolMutation.mutateAsync(name),
    isCreating: createPoolMutation.isPending,
    addMailboxToPool: (poolId: string, mailboxId: string) =>
      addMailboxMutation.mutate({ poolId, mailboxId }),
    removeMailboxFromPool: (poolId: string, mailboxId: string) =>
      removeMailboxMutation.mutate({ poolId, mailboxId }),
  };
}
