'use strict';
// The worker keeps a project's files on its own disk only while a job runs: the copy is removed when the job
// finishes, fails or is cancelled, and old copies can be cleared. The worker key and the store always survive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/core.cjs');
const { loadKeyPair } = require('../scripts/worker-secrets.cjs');
const { workCopyPath, removeWorkCopy, withWorkCopy, findLeftovers, clearLeftovers, formatBytes } = require('../src/work-copies.cjs');
const script = require('../scripts/clear-work-copies.cjs');

const HOUR = 3600000;
const quiet = { log() {}, error() {} };

// A data root laid out like the worker's: the key pair, the store and an unrelated file.
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vistralo-work-'));
  const keys = loadKeyPair(root);
  const keyText = fs.readFileSync(path.join(root, 'worker-key.pem'), 'utf8');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'keep me');
  const store = new Store(root);
  return { root, store, keys, keyText };
}

function rowsFor(store, pid) {
  const count = (sql) => store.db.prepare(sql).get(pid).n;
  return {
    projects: count('SELECT count(*) AS n FROM projects WHERE id=?'),
    jobs: count('SELECT count(*) AS n FROM jobs WHERE project=?'),
    events: count('SELECT count(*) AS n FROM events WHERE project=?'),
  };
}

// What a job writes: a source video, frames and an output, plus a local job row like Providers reserves.
function fillLikeAJob(store, native, nativeRoot) {
  fs.writeFileSync(path.join(nativeRoot, 'cloud-source.webm'), Buffer.alloc(2048));
  fs.mkdirSync(path.join(nativeRoot, 'evidence', 'session-1'), { recursive: true });
  fs.writeFileSync(path.join(nativeRoot, 'evidence', 'session-1', 'frame-001.png'), Buffer.alloc(512));
  fs.writeFileSync(path.join(nativeRoot, 'build-evidence.json'), '{}');
  store.reserve(native.id, 'narrate', 'fingerprint-' + native.id);
}

function assertRootIntact({ root, store, keyText }) {
  assert.ok(fs.existsSync(root), 'the data root survives');
  assert.equal(fs.readFileSync(path.join(root, 'worker-key.pem'), 'utf8'), keyText, 'the worker key survives unchanged');
  assert.ok(fs.existsSync(path.join(root, 'projects.sqlite')), 'the store survives');
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'keep me', 'other files in the root survive');
  // The store still works for the next job.
  const next = store.create('Next job', 'record');
  assert.ok(fs.existsSync(store.dir(next.id)));
  // The next start loads the same key rather than making a new one.
  const again = loadKeyPair(root);
  assert.equal(again.privateKey.export({ type: 'pkcs8', format: 'pem' }), keyText);
}

test('a finished job leaves no copy behind, and its result passes through', async () => {
  const ctx = setup();
  let seen;
  const result = await withWorkCopy(ctx.store, 'Demo', 'record', async (native, nativeRoot) => {
    seen = { id: native.id, root: nativeRoot };
    assert.equal(nativeRoot, ctx.store.dir(native.id));
    fillLikeAJob(ctx.store, native, nativeRoot);
    assert.deepEqual(rowsFor(ctx.store, native.id).projects, 1);
    return { video: 'owner/project/job/output.mp4' };
  }, quiet);
  assert.deepEqual(result, { video: 'owner/project/job/output.mp4' });
  assert.equal(fs.existsSync(seen.root), false, 'the job folder is gone');
  assert.deepEqual(rowsFor(ctx.store, seen.id), { projects: 0, jobs: 0, events: 0 }, 'its store rows are gone');
  assertRootIntact(ctx);
  ctx.store.close();
});

test('a failed job leaves no copy behind, and its error passes through unchanged', async () => {
  const ctx = setup();
  let seen;
  const failure = new Error('Source contains no video');
  await assert.rejects(withWorkCopy(ctx.store, 'Demo', 'walkthrough', async (native, nativeRoot) => {
    seen = { id: native.id, root: nativeRoot };
    fillLikeAJob(ctx.store, native, nativeRoot);
    throw failure;
  }, quiet), (error) => error === failure);
  assert.equal(fs.existsSync(seen.root), false);
  assert.deepEqual(rowsFor(ctx.store, seen.id), { projects: 0, jobs: 0, events: 0 });
  assertRootIntact(ctx);
  ctx.store.close();
});

test('a cancelled job leaves no copy behind, even mid-write', async () => {
  const ctx = setup();
  const controller = new AbortController();
  let seen;
  // The worker's checkCancelled throws this once the owner cancels.
  const checkCancelled = () => { if (controller.signal.aborted) throw Error('Cancelled by the owner'); };
  await assert.rejects(withWorkCopy(ctx.store, 'Demo', 'record', async (native, nativeRoot) => {
    seen = { id: native.id, root: nativeRoot };
    fillLikeAJob(ctx.store, native, nativeRoot);
    const stream = fs.createWriteStream(path.join(nativeRoot, 'render.mp4'));
    stream.write(Buffer.alloc(4096));
    controller.abort();
    await new Promise((resolve) => stream.end(resolve));
    checkCancelled();
  }, quiet), /Cancelled by the owner/);
  assert.equal(fs.existsSync(seen.root), false);
  assert.deepEqual(rowsFor(ctx.store, seen.id), { projects: 0, jobs: 0, events: 0 });
  assertRootIntact(ctx);
  ctx.store.close();
});

test('removing one job copy leaves other jobs alone', async () => {
  const ctx = setup();
  const other = ctx.store.create('Other job', 'record');
  fs.writeFileSync(path.join(ctx.store.dir(other.id), 'source.webm'), 'x');
  await withWorkCopy(ctx.store, 'Demo', 'record', async () => 'done', quiet);
  assert.ok(fs.existsSync(path.join(ctx.store.dir(other.id), 'source.webm')));
  assert.equal(rowsFor(ctx.store, other.id).projects, 1);
  ctx.store.close();
});

test('a clean-up failure is logged and never hides the job result', async () => {
  const ctx = setup();
  const errors = [];
  const original = ctx.store.db;
  const result = await withWorkCopy(ctx.store, 'Demo', 'record', async () => {
    // Break the store so removing the rows throws.
    ctx.store.db = { prepare() { throw new Error('database is locked'); } };
    return 'kept';
  }, { error: (...args) => errors.push(args.join(' ')) });
  ctx.store.db = original;
  assert.equal(result, 'kept');
  assert.match(errors[0], /Could not remove the working copy .*database is locked/);
  ctx.store.close();
});

test('only a project folder directly inside the root can be removed', () => {
  const ctx = setup();
  for (const bad of ['', '..', '.', 'worker-key.pem', 'projects.sqlite', '../outside', '/etc', 'C:\\Windows',
    '00000000-0000-0000-0000-00000000000', 'AAAAAAAA-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000/..',
    '00000000-0000-0000-0000-000000000000\\..', null, undefined, 42]) {
    assert.throws(() => workCopyPath(ctx.root, bad), /Invalid project ID/, String(bad));
    assert.throws(() => removeWorkCopy(ctx.store, bad), /Invalid project ID/, String(bad));
  }
  assert.equal(workCopyPath(ctx.root, '00000000-0000-0000-0000-000000000000'), path.join(fs.realpathSync(ctx.root), '00000000-0000-0000-0000-000000000000'));
  assertRootIntact(ctx);
  ctx.store.close();
});

test('links are never followed: not as the project folder, not inside it', () => {
  const ctx = setup();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vistralo-outside-'));
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'do not delete');
  // A project folder that is really a link to somewhere else is refused.
  const linkedId = '11111111-1111-4111-8111-111111111111';
  fs.symlinkSync(outside, path.join(ctx.root, linkedId), 'junction');
  assert.throws(() => removeWorkCopy(ctx.store, linkedId), /escapes|plain folder/);
  assert.ok(fs.existsSync(path.join(outside, 'precious.txt')));
  // A link inside a real project folder is removed as a link; what it points to stays.
  const native = ctx.store.create('Demo', 'record');
  fs.symlinkSync(outside, path.join(ctx.store.dir(native.id), 'link'), 'junction');
  removeWorkCopy(ctx.store, native.id);
  assert.equal(fs.existsSync(ctx.store.dir(native.id)), false);
  assert.ok(fs.existsSync(path.join(outside, 'precious.txt')));
  // The clear-up skips the linked folder entirely.
  assert.deepEqual(findLeftovers(ctx.store, { olderThanMs: 0, now: Date.now() + HOUR }).map((item) => item.id).includes(linkedId), false);
  fs.unlinkSync(path.join(ctx.root, linkedId));
  ctx.store.close();
});

// Ages a project's folder and row so it looks untouched since `at`.
function age(store, pid, at) {
  store.db.prepare('UPDATE projects SET updated=? WHERE id=?').run(new Date(at).toISOString(), pid);
  const folder = store.dir(pid);
  if (fs.existsSync(folder)) fs.utimesSync(folder, new Date(at), new Date(at));
}

test('the clear-up removes copies untouched for over a day and keeps recent ones, the key and the store', () => {
  const ctx = setup();
  const now = Date.now();
  const old = ctx.store.create('Old job', 'record');
  fs.writeFileSync(path.join(ctx.store.dir(old.id), 'source.webm'), Buffer.alloc(3000));
  age(ctx.store, old.id, now - 30 * HOUR);
  const rowOnly = ctx.store.create('Folder already gone', 'record');
  fs.rmSync(ctx.store.dir(rowOnly.id), { recursive: true });
  age(ctx.store, rowOnly.id, now - 48 * HOUR);
  const folderOnlyId = '22222222-2222-4222-8222-222222222222';
  fs.mkdirSync(path.join(ctx.root, folderOnlyId));
  fs.utimesSync(path.join(ctx.root, folderOnlyId), new Date(now - 72 * HOUR), new Date(now - 72 * HOUR));
  const recent = ctx.store.create('Running job', 'record');
  fs.writeFileSync(path.join(ctx.store.dir(recent.id), 'source.webm'), 'x');
  age(ctx.store, recent.id, now - 2 * HOUR);

  const found = findLeftovers(ctx.store, { now });
  assert.deepEqual(found.map((item) => item.id), [folderOnlyId, rowOnly.id, old.id], 'oldest first, recent one left out');
  assert.equal(found.find((item) => item.id === old.id).bytes, 3000);

  const result = clearLeftovers(ctx.store, { now }, quiet);
  assert.equal(result.found, 3);
  assert.equal(result.removed, 3);
  assert.deepEqual(result.failed, []);
  assert.equal(fs.existsSync(ctx.store.dir(old.id)), false);
  assert.equal(fs.existsSync(path.join(ctx.root, folderOnlyId)), false);
  assert.deepEqual(rowsFor(ctx.store, old.id), { projects: 0, jobs: 0, events: 0 });
  assert.deepEqual(rowsFor(ctx.store, rowOnly.id), { projects: 0, jobs: 0, events: 0 });
  assert.ok(fs.existsSync(path.join(ctx.store.dir(recent.id), 'source.webm')), 'a recent copy is kept');
  assertRootIntact(ctx);
  ctx.store.close();
});

test('the clear-up script lists by default and removes only with --yes', () => {
  const ctx = setup();
  const now = Date.now();
  const old = ctx.store.create('Old job', 'record');
  fs.writeFileSync(path.join(ctx.store.dir(old.id), 'source.webm'), Buffer.alloc(5000));
  age(ctx.store, old.id, now - 30 * HOUR);
  ctx.store.close();
  const lines = [];
  const out = { log: (line) => lines.push(line), error: (...args) => lines.push(args.join(' ')) };

  const dry = script.run([], { env: { VISTRALO_CLOUD_DATA_ROOT: ctx.root }, out, now });
  assert.equal(dry.found, 1);
  assert.equal(dry.removed, 0);
  assert.match(lines[0], /^1 working copy older than 24 h in .*, 4\.\d KB in all$/);
  assert.ok(lines.some((line) => line.includes(old.id)));
  assert.match(lines.at(-1), /Dry run: nothing was removed/);
  assert.ok(fs.existsSync(path.join(ctx.root, old.id, 'source.webm')), 'the dry run removes nothing');

  lines.length = 0;
  const done = script.run(['--root', ctx.root, '--yes'], { env: {}, out, now });
  assert.equal(done.removed, 1);
  assert.match(lines.at(-1), /^Removed 1 of 1, 4\.\d KB freed$/);
  assert.equal(fs.existsSync(path.join(ctx.root, old.id)), false);
  const store = new Store(ctx.root, { recover: false });
  assertRootIntact({ ...ctx, store });
  store.close();
});

test('the clear-up script refuses a wrong root or bad options', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'vistralo-empty-'));
  assert.throws(() => script.run([], { env: { VISTRALO_CLOUD_DATA_ROOT: empty }, out: quiet }), /No worker store/);
  assert.deepEqual(fs.readdirSync(empty), [], 'no store is created in a mistyped folder');
  assert.throws(() => script.parseArgs([], {}), /VISTRALO_CLOUD_DATA_ROOT/);
  assert.throws(() => script.parseArgs(['--root', 'relative/path'], {}), /absolute/);
  assert.throws(() => script.parseArgs(['--root', empty, '--older-than', '0'], {}), /at least 1 hour/);
  assert.throws(() => script.parseArgs(['--root', empty, '--all'], {}), /Unknown option --all/);
  assert.deepEqual(script.parseArgs(['--older-than', '48', '--yes'], { VISTRALO_CLOUD_DATA_ROOT: empty }), { root: empty, hours: 48, yes: true });
});

test('sizes read plainly', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 ** 3), '5.0 GB');
});

test('the worker runs every job inside withWorkCopy and clears old copies at start-up', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../scripts/local-admin-worker.cjs'), 'utf8');
  assert.match(worker, /await withWorkCopy\(service\.store, p\.name, mode, async \(native, nativeRoot\) =>/);
  assert.doesNotMatch(worker, /service\.store\.create\(/, 'no job makes a local project outside withWorkCopy');
  assert.match(worker, /clearLeftovers\(service\.store\)/);
  // The clear-up runs before the job loop starts.
  assert.ok(worker.indexOf('clearLeftovers(service.store)') < worker.indexOf('while (!stopped)'));
});
