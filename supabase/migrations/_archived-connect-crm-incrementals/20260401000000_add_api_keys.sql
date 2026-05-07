-- API Keys table for agent/MCP authentication
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_preview text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz
);

alter table api_keys enable row level security;

-- Users can only see their own keys
create policy "api_keys_select_own"
  on api_keys for select
  using (user_id = auth.uid());

-- Users can only delete their own keys
create policy "api_keys_delete_own"
  on api_keys for delete
  using (user_id = auth.uid());
