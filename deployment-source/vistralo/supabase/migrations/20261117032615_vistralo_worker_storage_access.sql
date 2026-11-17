-- Applied to production on 17 November 2026 (version 20261117032615).
--
-- The capture worker signs in as the administrator, but storage only lets a user read and write their own
-- folder ({owner}/{project}/...). Without these policies the worker could not download another owner's source
-- or save their film, and it could not replace the live capture preview it rewrites every 1.5 s, since no
-- UPDATE policy existed.

create policy media_worker_read on storage.objects for select to authenticated
  using (
    bucket_id = 'vistralo-media'
    and exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin')
  );

-- Only into a live project's own folder: {owner}/{project}/... where that owner owns that project.
create policy media_worker_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'vistralo-media'
    and exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin')
    and exists (
      select 1 from public.vistralo_projects p
      where p.id::text = (storage.foldername(name))[2]
        and p.owner_id::text = (storage.foldername(name))[1]
        and coalesce(p.document ->> 'trashed', 'false') = 'false'
    )
  );

-- Replacing an object is limited to the live capture preview; finished files are never overwritten.
create policy media_worker_preview_update on storage.objects for update to authenticated
  using (
    bucket_id = 'vistralo-media'
    and name like '%/live/preview.jpg'
    and exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin')
  )
  with check (
    bucket_id = 'vistralo-media'
    and name like '%/live/preview.jpg'
    and exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin')
  );
