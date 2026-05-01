import { supabase } from '@/lib/supabase'

export interface ApiKey {
  id: string
  name: string
  keyPreview: string
  createdAt: string
  lastUsedAt: string | null
}

export async function getApiKeys(): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, key_preview, created_at, last_used_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(row => ({
    id: row.id,
    name: row.name,
    keyPreview: row.key_preview,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }))
}

export async function revokeApiKey(id: string): Promise<void> {
  const { error } = await supabase.from('api_keys').delete().eq('id', id)
  if (error) throw error
}
