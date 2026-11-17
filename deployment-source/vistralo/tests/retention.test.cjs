'use strict';
// Projects are deleted 3 months after they are made: the rule, the worker's sweep, the dry-run report and the
// text the app shows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const rule = require('../src/retention.cjs');
const { sweepExpired } = require('../src/retention-sweep.cjs');
const { summarise, describe, parseArgs } = require('../scripts/retention-dry-run.cjs');

const iso = (time) => new Date(time).toISOString();
const DAY = 86400000;
const ON = { enabled: true, graceStart: null };
const MIGRATION = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261117120000_vistralo_project_retention.sql'), 'utf8');

test('a project is deleted 3 calendar months (UTC) after it was made, clamped to the month end like Postgres', () => {
  const at = (created) => iso(rule.expiresAt({ created }));
  assert.equal(at('2026-11-17T10:30:00.000Z'), '2027-02-17T10:30:00.000Z');
  assert.equal(at('2026-11-30T00:00:00.000Z'), '2027-02-28T00:00:00.000Z', '30 November has no 30 February');
  assert.equal(at('2027-11-30T23:59:59.000Z'), '2028-02-29T23:59:59.000Z', 'leap year');
  assert.equal(at('2026-08-31T12:00:00.000Z'), '2026-11-30T12:00:00.000Z');
  assert.equal(at('2026-10-05T08:00:00+06:00'), '2027-01-05T02:00:00.000Z', 'counted in UTC');
  assert.equal(rule.RETENTION_MONTHS, 3);
  assert.equal(rule.expiresAt({}), null, 'no date, no deletion');
  assert.equal(rule.expiresAt({ created: 'not a date' }), null);
});

test('editing, re-recording, sharing, opening or trashing a project does not move its date', () => {
  const made = { created: '2026-10-01T09:00:00.000Z' };
  const touched = { ...made, updated: '2026-12-20T09:00:00.000Z', eventAt: '2026-12-20T09:00:00.000Z', lastOpened: '2026-12-21T09:00:00.000Z', trashed: true, trashedAt: '2026-12-01T00:00:00.000Z', video: 'o/p/job9/new-take.mp4' };
  assert.equal(rule.expiresAt(touched), rule.expiresAt(made));
  assert.equal(iso(rule.expiresAt(touched)), '2027-01-01T09:00:00.000Z');
});

test('a duplicate keeps its original\'s date; retainFrom can only make the date earlier', () => {
  const original = { created: '2026-09-10T00:00:00.000Z' };
  const copy = { created: '2026-12-01T00:00:00.000Z', retainFrom: rule.retainFromForCopy(original) };
  assert.equal(copy.retainFrom, '2026-09-10T00:00:00.000Z');
  assert.equal(iso(rule.expiresAt(copy)), '2026-12-10T00:00:00.000Z');
  const copyOfCopy = { created: '2027-01-01T00:00:00.000Z', retainFrom: rule.retainFromForCopy(copy) };
  assert.equal(copyOfCopy.retainFrom, original.created, 'a copy of a copy still counts from the first');
  const made = '2026-11-01T00:00:00.000Z', own = iso(rule.expiresAt({ created: made }));
  for (const retainFrom of ['2027-06-01T00:00:00.000Z', 'epoch', 'yesterday', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-10-01', 42, null]) {
    assert.equal(iso(rule.expiresAt({ created: made, retainFrom })), own, `${retainFrom} is ignored`);
  }
  assert.equal(iso(rule.expiresAt({ created: made, retainFrom: '2026-10-01T00:00+06:00' })), '2026-12-30T18:00:00.000Z', 'an offset ISO time counts, in UTC');
});

test('projects made before the switch went on count from that day', () => {
  const grace = { enabled: true, graceStart: '2026-11-20T00:00:00.000Z' };
  assert.equal(iso(rule.expiresAt({ created: '2026-09-01T00:00:00.000Z' }, grace)), '2027-02-20T00:00:00.000Z');
  assert.equal(iso(rule.expiresAt({ created: '2026-12-05T00:00:00.000Z' }, grace)), '2027-03-05T00:00:00.000Z', 'newer projects keep their own date');
  assert.equal(iso(rule.expiresAt({ created: '2026-09-01T00:00:00.000Z' }, { grace_start: '2026-11-20T00:00:00Z' })), '2027-02-20T00:00:00.000Z', 'the column name works too');
});

test('the app shows nothing while the switch is off, a date before the last week, then a warning, then due', () => {
  const p = { created: '2026-11-17T12:00:00.000Z' };
  const at = Date.parse('2027-02-17T12:00:00.000Z');
  assert.equal(rule.deletionNotice(p, null, at - 30 * DAY), null);
  assert.equal(rule.deletionNotice(p, { enabled: false, graceStart: null }, at - 30 * DAY), null);
  assert.deepEqual(rule.deletionNotice(p, ON, at - 30 * DAY), { at, daysLeft: 30, due: false, soon: false });
  assert.equal(rule.deletionNotice(p, ON, at - 7 * DAY - 1).soon, false);
  assert.deepEqual(rule.deletionNotice(p, ON, at - 7 * DAY), { at, daysLeft: 7, due: false, soon: true });
  assert.deepEqual(rule.deletionNotice(p, ON, at - 3 * DAY + 3600000), { at, daysLeft: 3, due: false, soon: true });
  assert.deepEqual(rule.deletionNotice(p, ON, at + 1), { at, daysLeft: 0, due: true, soon: true });
});

test('the SQL copy of the rule says the same thing and ships switched off', () => {
  assert.match(MIGRATION, /enabled boolean not null default false/);
  assert.match(MIGRATION, /check \(not enabled or grace_start is not null\)/, 'the switch cannot go on without a grace date');
  assert.equal((MIGRATION.match(/interval '(\d+) months'/g) || []).length, 1);
  assert.equal(Number(/interval '(\d+) months'/.exec(MIGRATION)[1]), rule.RETENTION_MONTHS);
  assert.match(MIGRATION, /at time zone 'UTC'\) \+ interval '3 months'\) at time zone 'UTC'/, 'counted in UTC, as the JavaScript copy does');
  const jsIso = /const ISO = \/(.+)\/;/.exec(fs.readFileSync(path.join(__dirname, '../src/retention.cjs'), 'utf8'))[1];
  assert.ok(MIGRATION.includes(`copied ~ '${jsIso}'`), 'both copies accept the same retainFrom shape');
  for (const name of ['vistralo_retention_due', 'vistralo_retention_files', 'vistralo_retention_finish']) {
    const body = MIGRATION.slice(MIGRATION.indexOf(`create function public.${name}(`));
    assert.match(body.slice(0, body.indexOf('$$;')), /role = 'admin'|vistralo_retention_is_due/, `${name} is for the administrator only`);
  }
  assert.match(MIGRATION, /remaining > 0 then\s+raise exception/, 'finish refuses while files remain');
  assert.match(MIGRATION, /on storage\.objects for delete to authenticated[\s\S]*vistralo_retention_is_due/, 'storage deletes only for due projects');
});

// A database and bucket that do what the migration's functions do, with failures on demand.
function fakes({ enabled = true, projects, objects, failRemove = new Set(), failFinish = new Set() }) {
  const calls = [];
  const store = new Set(objects);
  const db = {
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'vistralo_retention_due') return { data: enabled ? projects.slice(0, args.p_limit) : [], error: null };
      const project = projects.find((p) => p.project_id === args.p_project);
      const prefix = `${project.owner_id}/${project.project_id}/`;
      if (name === 'vistralo_retention_files') return { data: [...store].filter((n) => n.startsWith(prefix)).concat('someone/else/file.mp4'), error: null };
      if (name === 'vistralo_retention_finish') {
        const left = [...store].filter((n) => n.startsWith(prefix)).length;
        if (failFinish.has(args.p_project)) return { data: null, error: { message: 'connection reset' } };
        if (left) return { data: null, error: { message: `${left} files of project ${args.p_project} are still stored` } };
        return { data: true, error: null };
      }
      throw Error('unexpected ' + name);
    },
  };
  const bucket = {
    async remove(names) {
      calls.push(['remove', names]);
      if (names.some((n) => failRemove.has(n))) return { data: null, error: { message: 'Storage is unavailable' } };
      const gone = names.filter((n) => store.delete(n)).map((name) => ({ name }));
      return { data: gone, error: null };
    },
  };
  return { db, bucket, calls, store };
}

test('the sweep deletes nothing while the switch is off', async () => {
  const { db, bucket, calls, store } = fakes({ enabled: false, projects: [{ project_id: 'p1', owner_id: 'o' }], objects: ['o/p1/a.webm'] });
  const report = await sweepExpired({ db, bucket, log: () => {} });
  assert.deepEqual(report, { due: 0, deleted: [], failed: [] });
  assert.deepEqual(calls.map((c) => c[0]), ['vistralo_retention_due']);
  assert.equal(store.size, 1);
});

test('the sweep removes every file in batches, then the row, and logs what it removed', async () => {
  const objects = Array.from({ length: 5 }, (_, i) => `o/p1/job/${i}.jpg`).concat('o/p2/src.webm', 'o/p3/keep.mp4');
  const projects = [
    { project_id: 'p1', owner_id: 'o', created_at: '2026-08-01T00:00:00Z', expires_at: '2026-11-01T00:00:00Z' },
    { project_id: 'p2', owner_id: 'o', created_at: '2026-08-02T00:00:00Z', expires_at: '2026-11-02T00:00:00Z' },
  ];
  const { db, bucket, calls, store } = fakes({ projects, objects });
  const lines = [];
  const report = await sweepExpired({ db, bucket, log: (line) => lines.push(line), batch: 2 });
  assert.deepEqual(report.deleted, [{ id: 'p1', owner: 'o', files: 5 }, { id: 'p2', owner: 'o', files: 1 }]);
  assert.deepEqual(report.failed, []);
  assert.deepEqual([...store], ['o/p3/keep.mp4'], 'a project that is not due keeps its files');
  assert.deepEqual(calls.filter((c) => c[0] === 'remove').map((c) => c[1].length), [2, 2, 1, 1]);
  assert.ok(!calls.some((c) => c[0] === 'remove' && c[1].includes('someone/else/file.mp4')), 'a file outside the project folder is never sent for removal');
  assert.deepEqual(calls.filter((c) => c[0] === 'vistralo_retention_finish').map((c) => c[1]), [{ p_project: 'p1', p_files_removed: 5 }, { p_project: 'p2', p_files_removed: 1 }]);
  assert.match(lines[0], /deleted project p1 \(owner o, made 2026-08-01T00:00:00Z, due 2026-11-01T00:00:00Z\), 5 of 5 files removed/);
  assert.match(lines.at(-1), /2 deleted, 0 left for the next sweep/);
});

test('a partial failure leaves that project for the next sweep and does not stop the others', async () => {
  const objects = ['o/p1/a.jpg', 'o/p1/b.jpg', 'o/p1/c.jpg', 'o/p2/src.webm', 'o/p3/src.webm'];
  const projects = ['p1', 'p2', 'p3'].map((id) => ({ project_id: id, owner_id: 'o' }));
  const run = fakes({ projects, objects, failRemove: new Set(['o/p1/c.jpg']), failFinish: new Set(['p2']) });
  const lines = [];
  const first = await sweepExpired({ db: run.db, bucket: run.bucket, log: (line) => lines.push(line), batch: 2 });
  assert.deepEqual(first.deleted.map((d) => d.id), ['p3']);
  assert.deepEqual(first.failed.map((f) => [f.id, f.files]), [['p1', 2], ['p2', 1]]);
  assert.match(first.failed[0].error, /Storage is unavailable/);
  assert.match(first.failed[1].error, /connection reset/);
  assert.ok(!run.calls.some((c) => c[0] === 'vistralo_retention_finish' && c[1].p_project === 'p1'), 'the row is not deleted while a file may remain');
  assert.ok(lines.some((line) => /could not delete project p1 yet \(2 files removed so far\).*next sweep/.test(line)));
  assert.deepEqual([...run.store], ['o/p1/c.jpg']);

  // The database refuses to finish while a file remains, even if the worker asks.
  const stubborn = fakes({ projects: [{ project_id: 'p1', owner_id: 'o' }], objects: ['o/p1/a.jpg'] });
  stubborn.bucket.remove = async (names) => ({ data: [], error: null });
  const refused = await sweepExpired({ db: stubborn.db, bucket: stubborn.bucket, log: () => {} });
  assert.match(refused.failed[0].error, /still stored/);

  // The next sweep, with storage back, finishes what is left.
  const retry = fakes({ projects: projects.slice(0, 2), objects: [...run.store] });
  const second = await sweepExpired({ db: retry.db, bucket: retry.bucket, log: () => {} });
  assert.deepEqual(second.deleted.map((d) => [d.id, d.files]), [['p1', 1], ['p2', 0]]);
  assert.equal(retry.store.size, 0);
});

test('a sweep that cannot ask the database (migration not applied) throws for the worker to log', async () => {
  const db = { rpc: async () => ({ data: null, error: { message: 'Could not find the function public.vistralo_retention_due' } }) };
  await assert.rejects(sweepExpired({ db, bucket: {}, log: () => {} }), /Could not find the function/);
});

test('the dry run counts by month and prints no names, under both answers', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');
  const rows = [
    { id: 'a', owner_id: 'o', created_at: '2026-09-10T00:00:00.000Z', trashed: false },
    { id: 'b', owner_id: 'o', created_at: '2026-08-01T00:00:00.000Z', trashed: true },
    { id: 'c', owner_id: 'o', created_at: '2026-11-16T00:00:00.000Z', retainFrom: '2026-08-15T00:00:00.000Z' },
    { id: 'd', owner_id: 'o', created_at: '2026-10-30T00:00:00.000Z' },
  ];
  const files = new Map([['a', { files: 2, bytes: 3 * 1024 ** 2 }], ['b', { files: 4, bytes: 1024 ** 3 }]]);
  const s = summarise(rows, { now, graceStart: iso(now), files, orphans: { folders: 1, files: 2, bytes: 10 } });
  assert.deepEqual(s.createdByMonth, { '2026-08': 1, '2026-09': 1, '2026-10': 1, '2026-11': 1 });
  assert.equal(s.strict.dueNow, 2, 'b (August) and c (a copy of an August project)');
  assert.equal(s.strict.dueNowTrashed, 1);
  assert.equal(s.strict.dueNowFiles, 4);
  assert.equal(s.strict.dueWithin30Days, 1, 'a, on 10 December');
  assert.deepEqual(s.strict.byMonth, { '2026-12': 1, '2027-01': 1 });
  assert.equal(s.grace.dueNow, 0);
  assert.deepEqual(s.grace.byMonth, { '2027-02': 4 });
  assert.equal(s.grace.first, '2027-02-17T12:00:00.000Z');
  assert.equal(s.storage.files, 6);
  assert.equal(s.copies, 1);
  const text = describe(s);
  assert.match(text, /Deleted at the first sweep: 2 \(1 of them in Trash\), 4 files, 1\.00 GB/);
  assert.match(text, /Folders with no project row.*: 1, 2 files/);
  assert.doesNotMatch(text, /2026-09-10|Per project/, 'the summary lists no projects');
  assert.match(describe(s, { details: true }), /Per project[\s\S]*\bb  2026-08-01  2026-11-01  2027-02-17  trash  4/);
  assert.deepEqual(parseArgs(['--details', '--no-files']), { details: true, files: false, graceStart: null });
  assert.equal(parseArgs(['--grace-start', '2026-12-01T00:00:00Z']).graceStart, '2026-12-01T00:00:00.000Z');
  assert.throws(() => parseArgs(['--delete']), /Unknown option/);
});

test('the dry run reads and never writes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/retention-dry-run.cjs'), 'utf8');
  assert.doesNotMatch(source, /\.(update|insert|upsert|delete|remove|move|copy|upload)\(|\.rpc\(|signOut\(\)/);
});

function web(entry) {
  const output = buildSync({ entryPoints: [path.join(__dirname, '../web/' + entry + '.ts')], bundle: true, write: false, platform: 'browser', format: 'cjs' }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, Intl, Date, console });
  return module.exports;
}

test('the app says "Deleted on" a date, then counts the last week\'s days, then "Being deleted"', () => {
  const { deletionText, projectDeletion, setRetention, retention } = web('retention');
  const at = new Date(2027, 1, 17, 15, 0).getTime();
  const project = { created: new Date(2026, 10, 17, 15, 0).toISOString() };
  assert.equal(projectDeletion(project, null), null);
  setRetention({ enabled: true, graceStart: null });
  assert.equal(retention().enabled, true);
  const text = (now) => deletionText(projectDeletion(project, retention(), now), 'en-GB', now);
  const far = text(at - 40 * DAY);
  assert.equal(far.label, 'Deleted on 17 Feb 2027');
  assert.match(far.detail, /deleted 3 months after they are made/);
  assert.equal(text(at - 5 * DAY).label, 'Deleted in 5 days');
  assert.match(text(at - 5 * DAY).detail, /^Deleted on 17 Feb 2027\. .*Download anything you want to keep now\.$/);
  assert.equal(text(new Date(2027, 1, 16, 9).getTime()).label, 'Deleted tomorrow');
  assert.equal(text(new Date(2027, 1, 17, 9).getTime()).label, 'Deleted today');
  assert.equal(text(at + 60000).label, 'Being deleted');
});

test('a duplicated demo project keeps its original\'s deletion date', async () => {
  const output = buildSync({ entryPoints: [path.join(__dirname, '../web/adapters.ts')], bundle: true, write: false, platform: 'browser', format: 'cjs' }).outputFiles[0].text;
  const storage = new Map(), module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, console, URL, Blob, File, DOMException, AbortController, Date, setTimeout, clearTimeout, Intl,
    crypto: require('node:crypto').webcrypto, window: {}, location: { origin: 'https://vistralo.example', pathname: '/' },
    localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    fetch: async () => { throw Error('offline'); },
  });
  const adapter = module.exports.createAdapter('demo');
  const original = (await adapter.list()).find((p) => !['processing', 'uploading', 'queued'].includes(p.status) && !p.trashed);
  const copy = await adapter.duplicate(original.id);
  assert.equal(copy.retainFrom, new Date(original.created).toISOString());
  assert.ok(Date.parse(copy.created) > Date.parse(copy.retainFrom));
});
