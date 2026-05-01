import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface UserContext {
  id: string
  name: string
  role: 'admin' | 'employee'
  emailPrefix: string | null
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// jwtOnly = true prevents API keys from being accepted (used by generate-api-key itself)
export async function resolveUser(
  authHeader: string | null,
  supabaseAdmin: SupabaseClient,
  jwtOnly = false
): Promise<UserContext> {
  if (!authHeader) throw new Error('Missing Authorization header')
  const token = authHeader.replace('Bearer ', '')

  let profileId: string

  if (!jwtOnly && token.startsWith('crm_')) {
    const hash = await sha256(token)
    const { data: apiKey } = await supabaseAdmin
      .from('api_keys')
      .select('user_id, expires_at')
      .eq('key_hash', hash)
      .maybeSingle()

    if (!apiKey) throw new Error('Invalid API key')
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) throw new Error('API key expired')

    // fire-and-forget — do not await
    supabaseAdmin
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('key_hash', hash)

    profileId = apiKey.user_id
  } else {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) throw new Error('Invalid session')
    profileId = user.id
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, name, role, email_prefix')
    .eq('id', profileId)
    .single()

  if (profileError || !profile) throw new Error('Profile not found')

  return {
    id: profile.id,
    name: profile.name,
    role: profile.role as 'admin' | 'employee',
    emailPrefix: profile.email_prefix ?? null,
  }
}
