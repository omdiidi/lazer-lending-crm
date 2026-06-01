create table if not exists public.lazer_settings (
  id             boolean primary key default true,
  constraint     single_row check (id = true),
  compliance_footer_template  text    not null default '[FOOTER PLACEHOLDER — NOT FOR PRODUCTION]',
  footer_enabled              boolean not null default false,
  updated_at     timestamptz not null default now()
);

insert into public.lazer_settings (id) values (true)
  on conflict (id) do nothing;

alter table public.lazer_settings enable row level security;
create policy "admin_manage_settings" on public.lazer_settings
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
create policy "employee_read_settings" on public.lazer_settings
  for select using (
    exists (select 1 from public.profiles where id = auth.uid())
  );
