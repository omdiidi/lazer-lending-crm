-- Expand leads RLS so employees can also see and claim unassigned leads (assigned_to IS NULL).
-- Admins retain full access as before.

-- Drop existing policies
drop policy if exists "leads_select" on leads;
drop policy if exists "leads_update" on leads;
drop policy if exists "leads_insert" on leads;
drop policy if exists "leads_delete" on leads;

-- SELECT: admins see all; employees see their own + unassigned
create policy "leads_select" on leads
  for select using (
    is_admin()
    or (assigned_to = auth.uid())
    or (assigned_to is null)
  );

-- INSERT: admins and employees can create leads
create policy "leads_insert" on leads
  for insert with check (
    is_admin() or auth.uid() is not null
  );

-- UPDATE: employees can touch their own leads AND unassigned leads,
-- but WITH CHECK ensures the row ends up assigned to themselves (self-assign only).
-- Admins can assign to anyone.
create policy "leads_update" on leads
  for update
  using (
    is_admin()
    or (assigned_to = auth.uid())
    or (assigned_to is null)
  )
  with check (
    is_admin()
    or (assigned_to = auth.uid())
  );

-- DELETE: admins only (soft-delete via deleted_at is preferred, but guard hard deletes)
create policy "leads_delete" on leads
  for delete using (is_admin());
