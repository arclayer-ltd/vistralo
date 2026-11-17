# Project retention: deleted 3 months after they are made

Every project, with every file it stored, is deleted automatically 3 months after the project was created, for every account. People can download what they want to keep before then. The privacy draft (`docs/legal/PRIVACY-DRAFT.md`) says the same.

The switch ships **off**. While it is off nothing is deleted and the app shows no dates.

## The rule

- **The clock starts when the project is made:** the row's `created_at`, counted in UTC calendar months. A project made on 30 November is deleted on 28 February. A trigger stops anyone moving `created_at` later.
- **Nothing extends it.** Re-recording, editing, renaming, sharing, opening, restoring from Trash and new jobs all leave the date where it is.
- **Trash does not shorten it.** A project in Trash is deleted on the same date as one outside it. Owners can still empty Trash sooner.
- **A duplicate keeps its original's date.** It copies the media, so the copy stores `document.retainFrom`, which can only make the date earlier. This stops duplicating from becoming a way to keep a recording forever.
- **Grace for existing projects.** Projects made before the switch went on count their 3 months from `grace_start`. The switch cannot be turned on until `grace_start` is set.

The rule lives in `src/retention.cjs` (for the app and the dry run) and in SQL in `supabase/migrations/20261117120000_vistralo_project_retention.sql`. The SQL copy is the one that decides what gets deleted. `tests/retention.test.cjs` keeps the two in step.

## How deletion runs

The worker (`scripts/local-admin-worker.cjs`, using `src/retention-sweep.cjs`) sweeps once when it starts and then once an hour, between jobs. For each due project, oldest first, it:

1. asks `vistralo_retention_files(project)` for every stored object under `{owner}/{project}/`, including files the document no longer lists,
2. removes them through the Storage API, 100 at a time,
3. calls `vistralo_retention_finish(project, removed)`. This refuses while any object is left. When none are left it writes a line to `vistralo_retention_log` (IDs, dates and a file count, never names or contents) and then deletes the row. The project's jobs and share links go with it.

A failure at any step leaves that project's row, and so whatever files are left, for the next sweep. One failure never stops the other projects. The worker's journal logs each deletion and each retry (`journalctl -u vistralo-worker | grep Retention`).

The database decides what is due, not the worker. The worker's storage delete policy (`media_retention_delete`) and all three functions allow nothing unless the switch is on, the caller is the administrator and the project is past its date.

Why the worker and not pg_cron or an edge function: Storage objects can only be deleted through the Storage API, because `storage.objects` has the `protect_objects_delete` trigger. A pg_cron job would need `pg_net` and a service key in the database, and neither extension is installed. A scheduled edge function would need both of those as well, plus a new function and secret to deploy. The worker already runs all the time, already signs in as the administrator and already talks to Storage.

## What the app shows

When the switch is on, each card and the project page say **"Deleted on 17 Feb 2027"**. In the last 7 days the card turns amber with a warning sign ("Deleted in 4 days", "Deleted tomorrow"). The project page then shows a warning box under the title. Past the date, until the next sweep, it says "Being deleted". The demo workspace shows the rule as if the switch were on. There is no email: the app has no email sending of its own (Supabase Auth sends only sign-in mail). A reminder email a week ahead is a follow-up.

## Turning it on (owner)

1. **Apply the migration** `20261117120000_vistralo_project_retention.sql` to project `yyiikuzhgxdgrthntzyr`. On its own this changes nothing: the switch is off.
2. **Deploy the web app** by merging the PR. It works before or after the migration: without the table, it shows no dates.
3. **Deploy the worker** by copying `scripts/local-admin-worker.cjs`, `src/retention.cjs` and `src/retention-sweep.cjs` to `/opt/vistralo-worker` and running `systemctl restart vistralo-worker`. With the switch off, each sweep finds nothing.
4. **Run the dry run again** on the worker host, and check the numbers:
   ```bash
   cd /opt/vistralo-worker && set -a && . /etc/vistralo-worker.env && set +a && node scripts/retention-dry-run.cjs
   ```
5. **Publish the privacy notice and flip the switch on the same day**, in the SQL editor:
   ```sql
   update public.vistralo_retention set enabled = true, grace_start = now(), updated_at = now();
   ```
   With `grace_start = now()`, no project is deleted for 3 months. The first deletions happen exactly 3 months later.
6. **Kill switch:** `update public.vistralo_retention set enabled = false, updated_at = now();` stops all deletion at the next sweep, without a deploy. Leave `grace_start` as it is when turning it back on.
