import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface SystemAlert {
  id: string
  type: string
  source: string
  message: string
  details: Record<string, unknown>
  resolved: boolean
  created_at: string
}

export function useAlerts() {
  const queryClient = useQueryClient()

  const { data: alerts = [] } = useQuery<SystemAlert[]>({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data } = await supabase.from('system_alerts')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false })
      return data || []
    },
  })

  useEffect(() => {
    const channel = supabase.channel('system-alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_alerts' }, () => {
        queryClient.invalidateQueries({ queryKey: ['alerts'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('system_alerts').update({ resolved: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  })

  return { alerts, dismissAlert: dismissMutation.mutate }
}
