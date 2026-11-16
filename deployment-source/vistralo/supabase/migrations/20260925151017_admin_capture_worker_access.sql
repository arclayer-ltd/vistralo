-- Recorded from production, where it was applied on 25 September 2026 as version 20260925151017.
-- The capture worker signs in as an administrator: it heartbeats, claims and updates jobs, and reads and
-- updates every owner's projects. Already applied; kept here so the repository matches the live schema.
grant insert, update on public.vistralo_runtime to authenticated;
create policy runtime_admin_write on public.vistralo_runtime for all to authenticated using (exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin')) with check (exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin'));
grant update on public.vistralo_jobs to authenticated;
create policy jobs_admin_update on public.vistralo_jobs for update to authenticated using (exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin')) with check (exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin'));
create policy projects_admin_read on public.vistralo_projects for select to authenticated using (exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin'));
create policy projects_admin_update on public.vistralo_projects for update to authenticated using (exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin')) with check (exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin'));
create or replace function public.vistralo_claim_next_job() returns setof public.vistralo_jobs language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.vistralo_accounts where user_id = auth.uid() and role = 'admin') then
    raise exception 'Admin access is required';
  end if;
  return query update public.vistralo_jobs set state = 'processing', started_at = now() where id = (select id from public.vistralo_jobs where state = 'queued' order by created_at for update skip locked limit 1) returning *;
end;
$$;
revoke all on function public.vistralo_claim_next_job() from public, anon;
grant execute on function public.vistralo_claim_next_job() to authenticated;
