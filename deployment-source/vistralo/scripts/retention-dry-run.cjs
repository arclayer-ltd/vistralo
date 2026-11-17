'use strict';
// What the 3-month retention rule would delete, and when, if the switch went on now. READ-ONLY: it signs in like
// the worker, reads project rows and lists storage, and writes and deletes nothing.
//
//   node scripts/retention-dry-run.cjs                 summary: counts by month, file counts and sizes
//   node scripts/retention-dry-run.cjs --details       also one line per project: ID and dates, never names
//   node scripts/retention-dry-run.cjs --no-files      skip the storage listing
//   node scripts/retention-dry-run.cjs --grace-start 2026-12-01T00:00:00Z   when the switch would go on (default now)
//
// Needs VISTRALO_SUPABASE_URL, VISTRALO_SUPABASE_PUBLISHABLE_KEY, VISTRALO_ADMIN_EMAIL, VISTRALO_ADMIN_PASSWORD, as the
// worker does. On the worker host: set -a; . /etc/vistralo-worker.env; set +a; node scripts/retention-dry-run.cjs
const { expiresAt, RETENTION_MONTHS } = require('../src/retention.cjs');

const DAY = 86400000;
const BUCKET = 'vistralo-media';

function parseArgs(argv) {
  const options = { details: false, files: true, graceStart: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--details') options.details = true;
    else if (arg === '--no-files') options.files = false;
    else if (arg === '--grace-start') {
      const value = argv[++i];
      if (!value || Number.isNaN(Date.parse(value))) throw Error('--grace-start needs an ISO time, for example 2026-12-01T00:00:00Z');
      options.graceStart = new Date(value).toISOString();
    } else throw Error(`Unknown option ${arg}`);
  }
  return options;
}

const monthOf = (time) => new Date(time).toISOString().slice(0, 7);
const day = (time) => new Date(time).toISOString().slice(0, 10);
const bump = (map, key, by = 1) => { map[key] = (map[key] || 0) + by; };
const sorted = (map) => Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));

/**
 * rows: { id, owner_id, created_at, retainFrom?, trashed? }. files: Map of project ID → { files, bytes } (optional).
 * Two answers: "strict", every project 3 months from when it was made, and "grace", projects made before
 * graceStart counting from graceStart, which is what the migration does once the switch is on.
 */
function summarise(rows, { now = Date.now(), graceStart = new Date(now).toISOString(), files = null, orphans = null } = {}) {
  const summary = {
    now: new Date(now).toISOString(), graceStart, months: RETENTION_MONTHS,
    projects: rows.length, trashed: 0, copies: 0, unreadable: 0,
    createdByMonth: {},
    strict: { dueNow: 0, dueNowTrashed: 0, dueWithin30Days: 0, byMonth: {}, dueNowFiles: 0, dueNowBytes: 0 },
    grace: { dueNow: 0, byMonth: {}, first: null },
    storage: files ? { files: 0, bytes: 0, byStrictMonth: {}, orphanFolders: orphans ? orphans.folders : 0, orphanFiles: orphans ? orphans.files : 0, orphanBytes: orphans ? orphans.bytes : 0 } : null,
    details: [],
  };
  for (const row of rows) {
    const project = { created: row.created_at, retainFrom: row.retainFrom };
    const strict = expiresAt(project, null);
    const grace = expiresAt(project, { graceStart });
    if (strict === null || grace === null) { summary.unreadable += 1; continue; }
    const trashed = row.trashed === true || row.trashed === 'true';
    if (trashed) summary.trashed += 1;
    if (typeof row.retainFrom === 'string' && row.retainFrom) summary.copies += 1;
    bump(summary.createdByMonth, monthOf(Date.parse(row.created_at)));
    const held = files && files.get(row.id) || { files: 0, bytes: 0 };
    if (strict <= now) {
      summary.strict.dueNow += 1;
      if (trashed) summary.strict.dueNowTrashed += 1;
      summary.strict.dueNowFiles += held.files;
      summary.strict.dueNowBytes += held.bytes;
    } else {
      if (strict - now <= 30 * DAY) summary.strict.dueWithin30Days += 1;
      bump(summary.strict.byMonth, monthOf(strict));
    }
    if (grace <= now) summary.grace.dueNow += 1;
    bump(summary.grace.byMonth, monthOf(grace));
    if (summary.grace.first === null || grace < summary.grace.first) summary.grace.first = grace;
    if (summary.storage) {
      summary.storage.files += held.files;
      summary.storage.bytes += held.bytes;
      const key = strict <= now ? 'due now' : monthOf(strict);
      const slot = summary.storage.byStrictMonth[key] || (summary.storage.byStrictMonth[key] = { files: 0, bytes: 0 });
      slot.files += held.files;
      slot.bytes += held.bytes;
    }
    summary.details.push({ id: row.id, created: row.created_at, strict: new Date(strict).toISOString(), grace: new Date(grace).toISOString(), trashed, files: held.files, bytes: held.bytes });
  }
  summary.createdByMonth = sorted(summary.createdByMonth);
  summary.strict.byMonth = sorted(summary.strict.byMonth);
  summary.grace.byMonth = sorted(summary.grace.byMonth);
  if (summary.grace.first !== null) summary.grace.first = new Date(summary.grace.first).toISOString();
  if (summary.storage) summary.storage.byStrictMonth = sorted(summary.storage.byStrictMonth);
  summary.details.sort((a, b) => a.strict.localeCompare(b.strict) || a.id.localeCompare(b.id));
  return summary;
}

const size = (bytes) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

/** Counts only: no project names, owners or contents, so it can go in a pull request. */
function describe(summary, { details = false } = {}) {
  const lines = [];
  const table = (map, render = (n) => String(n)) => Object.entries(map).map(([key, value]) => `  ${key}  ${render(value)}`);
  lines.push(`Retention dry run at ${summary.now} (read-only). Rule: deleted ${summary.months} months after the project was made.`);
  lines.push(`Projects: ${summary.projects} (${summary.trashed} in Trash, ${summary.copies} duplicates carrying their original's date${summary.unreadable ? `, ${summary.unreadable} with no readable date, never deleted` : ''})`);
  lines.push('', 'Made, by month:', ...table(summary.createdByMonth));
  lines.push('', `A. Counting from when each project was made (no grace period):`);
  lines.push(`  Deleted at the first sweep: ${summary.strict.dueNow} (${summary.strict.dueNowTrashed} of them in Trash)${summary.storage ? `, ${summary.strict.dueNowFiles} files, ${size(summary.strict.dueNowBytes)}` : ''}`);
  lines.push(`  Then within 30 days: ${summary.strict.dueWithin30Days}`);
  lines.push('  Later, by month of deletion:', ...table(summary.strict.byMonth).map((line) => '  ' + line));
  lines.push('', `B. With a grace period: projects made before ${summary.graceStart} count from then (what the migration does):`);
  lines.push(`  Deleted at the first sweep: ${summary.grace.dueNow}. First deletion: ${summary.grace.first || 'none'}`);
  lines.push('  By month of deletion:', ...table(summary.grace.byMonth).map((line) => '  ' + line));
  if (summary.storage) {
    lines.push('', `Storage: ${summary.storage.files} files, ${size(summary.storage.bytes)} in project folders. By month of deletion under A:`);
    lines.push(...table(summary.storage.byStrictMonth, (v) => `${v.files} files, ${size(v.bytes)}`));
    lines.push(`Folders with no project row (left behind earlier, not touched by the sweep): ${summary.storage.orphanFolders}, ${summary.storage.orphanFiles} files, ${size(summary.storage.orphanBytes)}`);
  }
  if (details) {
    lines.push('', 'Per project (ID, made, deleted under A, deleted under B, Trash, files):');
    for (const d of summary.details) lines.push(`  ${d.id}  ${day(Date.parse(d.created))}  ${day(Date.parse(d.strict))}  ${day(Date.parse(d.grace))}  ${d.trashed ? 'trash' : '-'}  ${d.files}`);
  }
  return lines.join('\n');
}

// Every file under a folder, a page at a time. Folders come back with no id.
async function walk(bucket, prefix, into) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw Error(`Could not list ${prefix || 'the bucket'}: ${error.message}`);
    for (const entry of data || []) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) into.push({ name, bytes: Number(entry.metadata && entry.metadata.size) || 0 });
      else await walk(bucket, name, into);
    }
    if (!data || data.length < 1000) return;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { createClient } = require('@supabase/supabase-js');
  const env = process.env;
  for (const name of ['VISTRALO_SUPABASE_URL', 'VISTRALO_SUPABASE_PUBLISHABLE_KEY', 'VISTRALO_ADMIN_EMAIL', 'VISTRALO_ADMIN_PASSWORD']) {
    if (!env[name]) throw Error(`${name} is not set`);
  }
  const db = createClient(env.VISTRALO_SUPABASE_URL, env.VISTRALO_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const signed = await db.auth.signInWithPassword({ email: env.VISTRALO_ADMIN_EMAIL, password: env.VISTRALO_ADMIN_PASSWORD });
  if (signed.error) throw Error(`Sign-in failed: ${signed.error.message}`);
  try {
    const switchRow = await db.from('vistralo_retention').select('enabled,grace_start').maybeSingle();
    console.log(switchRow.error ? 'Switch: not installed yet (the retention migration has not been applied).' : `Switch: ${switchRow.data && switchRow.data.enabled ? `ON, grace from ${switchRow.data.grace_start}` : 'off'}`);
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('vistralo_projects')
        .select('id,owner_id,created_at,retainFrom:document->>retainFrom,trashed:document->trashed')
        .order('created_at').order('id').range(from, from + 999);
      if (error) throw Error(`Could not read projects: ${error.message}`);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    let files = null, orphans = null;
    if (options.files) {
      const bucket = db.storage.from(BUCKET);
      const known = new Set(rows.map((r) => `${r.owner_id}/${r.id}`));
      const all = [];
      await walk(bucket, '', all);
      files = new Map();
      orphans = { folders: 0, files: 0, bytes: 0 };
      const orphanFolders = new Set();
      for (const file of all) {
        const [owner, project] = file.name.split('/');
        if (known.has(`${owner}/${project}`)) {
          const slot = files.get(project) || { files: 0, bytes: 0 };
          slot.files += 1; slot.bytes += file.bytes;
          files.set(project, slot);
        } else {
          orphanFolders.add(`${owner}/${project}`);
          orphans.files += 1; orphans.bytes += file.bytes;
        }
      }
      orphans.folders = orphanFolders.size;
    }
    const summary = summarise(rows, { now: Date.now(), graceStart: options.graceStart || new Date().toISOString(), files, orphans });
    console.log(describe(summary, { details: options.details }));
  } finally {
    // Never sign out here: Supabase signs out every session by default, which would end the running worker's too.
  }
}

if (require.main === module) {
  main().catch((error) => { console.error('Dry run failed:', error.message || error); process.exitCode = 1; });
}

module.exports = { parseArgs, summarise, describe };
