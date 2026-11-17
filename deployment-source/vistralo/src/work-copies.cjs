'use strict';
// The worker copies a project's files to its own disk only while it makes a film from them. Every job gets a new
// local project (a folder named by its ID under VISTRALO_CLOUD_DATA_ROOT, plus a row in projects.sqlite). These
// helpers remove that copy when the job ends, and clear copies an older worker left behind.
//
// Only folders named like a project ID, directly inside the data root, are ever removed. The worker key
// (worker-key.pem), the store (projects.sqlite and its -wal/-shm files) and anything else in the root are never
// touched. See docs/RETENTION.md.
const fs = require('node:fs');
const path = require('node:path');
const { within, assert } = require('./core.cjs');

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = 86400000;

// The folder for one local project, checked to be a direct child of the root that is not a link.
function workCopyPath(root, pid) {
  assert(typeof pid === 'string' && PROJECT_ID.test(pid), 'Invalid project ID');
  const base = fs.realpathSync(root);
  const target = within(base, pid);
  assert(path.dirname(target) === base && path.basename(target) === pid, 'Path is not a project folder');
  return target;
}

function sizeOf(target) {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const item = stack.pop();
    let stat;
    try { stat = fs.lstatSync(item); } catch { continue; }
    if (stat.isDirectory()) {
      let names = [];
      try { names = fs.readdirSync(item); } catch { /* unreadable: count what we can */ }
      for (const name of names) stack.push(path.join(item, name));
    } else total += stat.size;
  }
  return total;
}

function forgetRows(store, pid) {
  store.db.prepare('DELETE FROM events WHERE project=?').run(pid);
  store.db.prepare('DELETE FROM jobs WHERE project=?').run(pid);
  store.db.prepare('DELETE FROM projects WHERE id=?').run(pid);
}

// Removes one local project: its folder and its rows. A folder that is already gone is fine.
function removeWorkCopy(store, pid) {
  const target = workCopyPath(store.root, pid);
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Project folder is not a plain folder');
    // rmSync does not follow links inside the folder; it removes the link itself.
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
  forgetRows(store, pid);
}

// Makes a local project, runs the job's work in it and removes it however the work ends: finished, failed or
// cancelled. The work's result or error passes through unchanged. A failed clean-up is logged, not thrown, so it
// never hides the job's own outcome; the start-up clear-up removes what is left.
async function withWorkCopy(store, name, mode, work, log = console) {
  const native = store.create(name, mode);
  try {
    return await work(native, store.dir(native.id));
  } finally {
    try { removeWorkCopy(store, native.id); }
    catch (error) { log.error('Could not remove the working copy', native.id, String(error.message || error).slice(0, 300)); }
  }
}

// Lists local projects whose last change is older than olderThanMs: folders named like a project ID and store rows
// without a folder. The last change is the later of the folder's modified time and the row's updated time.
function findLeftovers(store, { olderThanMs = DAY, now = Date.now() } = {}) {
  const base = fs.realpathSync(store.root);
  const rows = new Map(store.db.prepare('SELECT id, updated FROM projects').all().map((r) => [r.id, Date.parse(r.updated) || 0]));
  const found = new Map();
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!PROJECT_ID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const folder = path.join(base, entry.name);
    const touched = Math.max(fs.lstatSync(folder).mtimeMs, rows.get(entry.name) || 0);
    found.set(entry.name, { id: entry.name, folder, touched, bytes: null });
  }
  for (const [pid, updated] of rows) {
    if (!found.has(pid) && PROJECT_ID.test(pid)) found.set(pid, { id: pid, folder: null, touched: updated, bytes: 0 });
  }
  const cutoff = now - olderThanMs;
  return [...found.values()]
    .filter((item) => item.touched < cutoff)
    .map((item) => ({ ...item, bytes: item.folder ? sizeOf(item.folder) : 0 }))
    .sort((a, b) => a.touched - b.touched);
}

// Removes what findLeftovers lists. One failure never stops the rest.
function clearLeftovers(store, options = {}, log = console) {
  const items = findLeftovers(store, options);
  let removed = 0, bytes = 0;
  const failed = [];
  for (const item of items) {
    try { removeWorkCopy(store, item.id); removed += 1; bytes += item.bytes; }
    catch (error) { failed.push(item.id); log.error('Could not remove the working copy', item.id, String(error.message || error).slice(0, 300)); }
  }
  return { found: items.length, removed, bytes, failed };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes, unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}

module.exports = { PROJECT_ID, DAY, workCopyPath, removeWorkCopy, withWorkCopy, findLeftovers, clearLeftovers, sizeOf, formatBytes };
