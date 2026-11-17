-- Projects are deleted 3 months after they are made, with every file they stored.
-- Applied to production on 17 November 2026 (version 20261117121611) with the switch off.
--
-- Applying this migration deletes nothing: the switch (vistralo_retention.enabled) starts false, and while it is
-- false no function here returns a project and no policy here allows a delete. See docs/RETENTION.md for how to
-- turn it on. src/retention.cjs holds the same rule for the web app and the dry-run report;
-- tests/retention.test.cjs keeps the two in step.
--
-- Who deletes: the capture worker (scripts/local-admin-worker.cjs) sweeps once an hour. Storage files can only be
-- removed through the Storage API (storage.objects has the protect_objects_delete trigger), so a database-only job
-- could not delete them; the worker already signs in as the administrator and talks to Storage. The functions below
-- decide what is due, so a bug in the worker cannot delete a project that is not.

-- One row of settings. Only the service role (SQL editor, migrations) can change it.
-- grace_start: projects made before it count their 3 months from it. Required before the switch can go on.
create table public.vistralo_retention (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  grace_start timestamptz,
  updated_at timestamptz not null default now(),
  constraint vistralo_retention_grace_set check (not enabled or grace_start is not null)
);
insert into public.vistralo_retention default values;
alter table public.vistralo_retention enable row level security;
revoke all on public.vistralo_retention from anon, authenticated, public;
grant select on public.vistralo_retention to authenticated;
grant all on public.vistralo_retention to service_role;
-- The app reads it to show each project's deletion date.
create policy retention_read on public.vistralo_retention for select to authenticated using (true);

-- One line per deleted project: identifiers, dates and a file count. Never names or contents.
create table public.vistralo_retention_log (
  project_id uuid primary key,
  owner_id uuid not null,
  project_created_at timestamptz not null,
  expired_at timestamptz not null,
  files_removed integer not null check (files_removed >= 0),
  deleted_at timestamptz not null default now()
);
alter table public.vistralo_retention_log enable row level security;
revoke all on public.vistralo_retention_log from anon, authenticated, public;
grant select on public.vistralo_retention_log to authenticated;
grant all on public.vistralo_retention_log to service_role;
create policy retention_log_admin_read on public.vistralo_retention_log for select to authenticated
  using (exists (select 1 from public.vistralo_accounts a where a.user_id = (select auth.uid()) and a.role = 'admin'));

-- A project's clock cannot be wound back: created_at is fixed once the row exists, and a new row cannot claim a
-- time in the future. (Owners may update their own rows, so without this they could push the date out.)
create function public.vistralo_keep_created_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := least(coalesce(new.created_at, now()), now());
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
create trigger vistralo_projects_keep_created_at before insert or update of created_at on public.vistralo_projects
  for each row execute function public.vistralo_keep_created_at();

-- When the clock started: created_at, or a duplicate's document.retainFrom (its original's) when that is earlier.
-- retainFrom is ignored unless it is an ISO time, and it can only make the date earlier.
create function public.vistralo_retained_from(p_created timestamptz, p_document jsonb) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  copied text := p_document ->> 'retainFrom';
  earlier timestamptz;
begin
  if copied ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then
    begin
      earlier := copied::timestamptz;
    exception when others then
      earlier := null;
    end;
  end if;
  return least(p_created, earlier);
end;
$$;

-- 3 calendar months in UTC (the 31st of a shorter month becomes its last day). Older projects start at grace_start.
create function public.vistralo_expires_at(p_created timestamptz, p_document jsonb, p_grace timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select ((greatest(public.vistralo_retained_from(p_created, p_document), p_grace) at time zone 'UTC') + interval '3 months') at time zone 'UTC';
$$;

-- True only for the administrator, only while the switch is on, and only for a project past its date whose files
-- live in {owner}/{project}/. Text arguments, so a storage policy can pass folder names that are not UUIDs.
create function public.vistralo_retention_is_due(p_owner text, p_project text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.vistralo_accounts a where a.user_id = auth.uid() and a.role = 'admin')
    and exists (
      select 1 from public.vistralo_projects p cross join public.vistralo_retention r
      where p.id::text = p_project and p.owner_id::text = p_owner and r.enabled
        and public.vistralo_expires_at(p.created_at, p.document, r.grace_start) <= now()
    );
$$;

-- The projects past their date, oldest first. Empty while the switch is off.
create function public.vistralo_retention_due(p_limit integer default 100)
returns table (project_id uuid, owner_id uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.vistralo_accounts a where a.user_id = auth.uid() and a.role = 'admin') then
    raise exception 'Admin access is required';
  end if;
  return query
    select p.id, p.owner_id, p.created_at, e.due_at
    from public.vistralo_projects p
    cross join public.vistralo_retention r
    cross join lateral (select public.vistralo_expires_at(p.created_at, p.document, r.grace_start) as due_at) e
    where r.enabled and e.due_at <= now()
    order by e.due_at, p.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- Every stored file of a due project, including ones its document no longer lists.
create function public.vistralo_retention_files(p_project uuid) returns setof text
language plpgsql stable security definer set search_path = '' as $$
declare
  prefix text;
begin
  select p.owner_id::text || '/' || p.id::text || '/' into prefix
  from public.vistralo_projects p
  where p.id = p_project and public.vistralo_retention_is_due(p.owner_id::text, p.id::text);
  if prefix is null then
    raise exception 'Project % is not due for deletion', p_project;
  end if;
  return query select o.name from storage.objects o where o.bucket_id = 'vistralo-media' and o.name like prefix || '%' order by o.name;
end;
$$;

-- The last step, once its files are gone: refuses while any file remains, so a partial failure leaves the
-- project in place for the next sweep. Logs the deletion, then deletes the row (its jobs and share links go with it).
create function public.vistralo_retention_finish(p_project uuid, p_files_removed integer) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  target public.vistralo_projects;
  due_at timestamptz;
  prefix text;
  remaining integer;
begin
  if not exists (select 1 from public.vistralo_accounts a where a.user_id = auth.uid() and a.role = 'admin') then
    raise exception 'Admin access is required';
  end if;
  select * into target from public.vistralo_projects p where p.id = p_project for update;
  if not found then
    return false;
  end if;
  select public.vistralo_expires_at(target.created_at, target.document, r.grace_start) into due_at
  from public.vistralo_retention r where r.enabled;
  if due_at is null or due_at > now() then
    raise exception 'Project % is not due for deletion', p_project;
  end if;
  prefix := target.owner_id::text || '/' || target.id::text || '/';
  select count(*) into remaining from storage.objects o where o.bucket_id = 'vistralo-media' and o.name like prefix || '%';
  if remaining > 0 then
    raise exception '% files of project % are still stored', remaining, p_project;
  end if;
  insert into public.vistralo_retention_log (project_id, owner_id, project_created_at, expired_at, files_removed)
    values (target.id, target.owner_id, target.created_at, due_at, greatest(coalesce(p_files_removed, 0), 0))
    on conflict (project_id) do nothing;
  delete from public.vistralo_projects where id = p_project;
  return true;
end;
$$;

revoke all on function public.vistralo_keep_created_at() from public, anon, authenticated;
revoke all on function public.vistralo_retained_from(timestamptz, jsonb) from public, anon;
revoke all on function public.vistralo_expires_at(timestamptz, jsonb, timestamptz) from public, anon;
revoke all on function public.vistralo_retention_is_due(text, text) from public, anon;
revoke all on function public.vistralo_retention_due(integer) from public, anon;
revoke all on function public.vistralo_retention_files(uuid) from public, anon;
revoke all on function public.vistralo_retention_finish(uuid, integer) from public, anon;
grant execute on function public.vistralo_retained_from(timestamptz, jsonb) to authenticated, service_role;
grant execute on function public.vistralo_expires_at(timestamptz, jsonb, timestamptz) to authenticated, service_role;
grant execute on function public.vistralo_retention_is_due(text, text) to authenticated;
grant execute on function public.vistralo_retention_due(integer) to authenticated;
grant execute on function public.vistralo_retention_files(uuid) to authenticated;
grant execute on function public.vistralo_retention_finish(uuid, integer) to authenticated;

-- The worker may remove another owner's files only when that project is due.
create policy media_retention_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'vistralo-media'
    and public.vistralo_retention_is_due((storage.foldername(name))[1], (storage.foldername(name))[2])
  );
