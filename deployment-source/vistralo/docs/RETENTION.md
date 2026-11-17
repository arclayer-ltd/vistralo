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

## Copies on the processing server

The worker makes films on its own server (BrainStorm Network VPS, Los Angeles). While a job runs it keeps a working copy of that project's files there: the source video, frames, build evidence and outputs, in a folder named by a local project ID under `VISTRALO_CLOUD_DATA_ROOT`, plus a row in that folder's `projects.sqlite`. **The copy lasts only while the job runs.** When the job ends, whether it finished, failed or was cancelled, the worker deletes the folder and the row (`withWorkCopy` in `src/work-copies.cjs`). What the job keeps is in Storage, and the 3-month rule above deletes that.

If the worker is killed in the middle of a job, its copy is left behind. So each time the worker starts, it also deletes copies nobody has touched for over a day. Only folders named like a project ID, directly in the data root, are ever deleted. The worker key (`worker-key.pem`), `projects.sqlite` and anything else in the root are never touched. `tests/work-copies.test.cjs` checks all of this.

Workers deployed before 17 November 2026 never deleted anything, so the server still holds a copy of every job they ran. `scripts/clear-work-copies.cjs` clears them. It only lists what it would delete (how many, how big) unless you add `--yes`.

### Deploying this (owner)

On the worker host:

1. **Copy the files** to `/opt/vistralo-worker`, at the same paths as in `deployment-source/vistralo/`:
   - `scripts/local-admin-worker.cjs`
   - `scripts/clear-work-copies.cjs`
   - `src/work-copies.cjs`
   - `src/retention.cjs` and `src/retention-sweep.cjs` (the worker needs them too; copying them again is harmless)
2. **Restart the worker:**
   ```bash
   systemctl restart vistralo-worker
   ```
   At start it deletes copies older than a day and logs `Removed N of N old working copies (size)`.
3. **Dry run** to see what is left:
   ```bash
   cd /opt/vistralo-worker && set -a && . /etc/vistralo-worker.env && set +a && node scripts/clear-work-copies.cjs
   ```
4. **Clear them** with the same command plus `--yes`:
   ```bash
   cd /opt/vistralo-worker && set -a && . /etc/vistralo-worker.env && set +a && node scripts/clear-work-copies.cjs --yes
   ```
   By default it skips copies touched in the last 24 hours, so it can never delete the copy of a job that is running. Copies the old worker made in the last day are skipped too. To clear those, wait until no job is running (the dashboard shows none processing) and run it with `--older-than 1 --yes`, which only skips copies from the last hour.

### Checking it

- `journalctl -u vistralo-worker -n 100` should show `Capture worker signed in` and no `Working copy clear-up skipped`.
- After a job ends, list the data root: `set -a && . /etc/vistralo-worker.env && set +a && ls "$VISTRALO_CLOUD_DATA_ROOT"`. Between jobs it should hold only `worker-key.pem` and `projects.sqlite` (with its `-wal` and `-shm` files), and no folders named like `1b2c3d4e-....`.
- `journalctl -u vistralo-worker | grep "Could not remove the working copy"` lists any copy the worker failed to delete, with the reason. The next start-up clears it.

## The processing server's log

The worker writes its log to the systemd journal on the processing server (`journalctl -u vistralo-worker`). The log is kept for **up to 1 month**, once the owner adds the setting below.

**What it logs:** job IDs and kinds (`Claimed render 6f1c…`, `Finished …`, `Cancelled …`), error messages when a job or step fails, counts and sizes from the clear-ups, and, for each project the retention sweep deletes, its ID, owner ID and dates. It never logs recording contents, scripts, keys or passwords. Some error messages can repeat part of what went wrong:
- A website that fails to load can put its address in the message, including any query string, cut at 120 characters (`Build read failed (the page did not load: … at https://…)`, and `Job failed …`).
- An FFmpeg failure adds the last lines FFmpeg printed. That is usually just the error, but it can include tags stored in an uploaded video file, such as its title.
- Each line also has the time it was written.

### Capping the log at 1 month (owner)

On the worker host, as root:

1. **Add a journald setting:**
   ```bash
   mkdir -p /etc/systemd/journald.conf.d && printf '[Journal]\nMaxRetentionSec=2week\nMaxFileSec=1week\n' > /etc/systemd/journald.conf.d/vistralo.conf && systemctl restart systemd-journald
   ```
   journald deletes whole journal files, and only once the newest line in a file is older than `MaxRetentionSec`. With files of at most a week (`MaxFileSec`), the oldest line kept is about 2 to 4 weeks old, so never more than a month. `MaxRetentionSec=1month` on its own would not be enough: the default file length is also a month, so lines could stay for about 2 months. This applies to the whole journal on the host, not only the worker.
2. **Trim what is already there**, once:
   ```bash
   journalctl --rotate && journalctl --vacuum-time=2weeks
   ```
3. **If rsyslog is installed**, it copies every journal line into `/var/log/syslog`, which has its own rotation. Check with `systemctl is-active rsyslog`. If it says `active`, stop it from copying the worker's lines (other services are not affected):
   ```bash
   printf ':programname, isequal, "vistralo-worker" stop\n' > /etc/rsyslog.d/10-vistralo-worker.conf && systemctl restart rsyslog
   ```
   Older copies already in `/var/log/syslog*` go when logrotate removes those files. `grep -l vistralo-worker /var/log/syslog*` shows which still hold any.

### Checking it

- `systemd-analyze cat-config systemd/journald.conf | grep -A3 vistralo` shows the setting is loaded.
- `journalctl -u vistralo-worker --no-pager -o short-iso | head -1` shows the oldest worker line kept. A few weeks after step 1 it should never be more than a month old.
- `journalctl --disk-usage` shows how much the journal holds.

## What the app shows

When the switch is on, each card and the project page say **"Deleted on 17 Feb 2027"**. In the last 7 days the card turns amber with a warning sign ("Deleted in 4 days", "Deleted tomorrow"). The project page then shows a warning box under the title. Past the date, until the next sweep, it says "Being deleted". The demo workspace shows the rule as if the switch were on. There is no email: the app has no email sending of its own (Supabase Auth sends only sign-in mail). A reminder email a week ahead is a follow-up.

## Turning it on (owner)

1. **Apply the migration** `20261117120000_vistralo_project_retention.sql` to project `yyiikuzhgxdgrthntzyr`. On its own this changes nothing: the switch is off. (Done 17 November 2026, version 20261117121611.)
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
