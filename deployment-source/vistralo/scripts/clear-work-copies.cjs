#!/usr/bin/env node
'use strict';
// Clears the working copies older workers left on the processing server. By default it only lists them:
//
//   node scripts/clear-work-copies.cjs              list what would be removed (count and size), remove nothing
//   node scripts/clear-work-copies.cjs --yes        remove them
//   --root <folder>     the data root (default: VISTRALO_CLOUD_DATA_ROOT)
//   --older-than <h>    only copies untouched for more than this many hours (default 24, so a job running now is
//                       never touched)
//
// Only folders named like a project ID directly inside the root, and their rows in projects.sqlite, are removed.
// The worker key (worker-key.pem), the store file itself and anything else in the root are never touched.
// See docs/RETENTION.md.
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../src/core.cjs');
const { findLeftovers, clearLeftovers, formatBytes } = require('../src/work-copies.cjs');

function parseArgs(argv, env = process.env) {
  const options = { root: env.VISTRALO_CLOUD_DATA_ROOT || '', hours: 24, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--root') options.root = argv[++i] || '';
    else if (arg === '--older-than') options.hours = Number(argv[++i]);
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!options.root) throw new Error('Set VISTRALO_CLOUD_DATA_ROOT or pass --root <folder>');
  if (!path.isAbsolute(options.root)) throw new Error('The data root must be an absolute path');
  if (!Number.isFinite(options.hours) || options.hours < 1) throw new Error('--older-than must be at least 1 hour');
  return options;
}

function run(argv, { env = process.env, out = console, now = Date.now() } = {}) {
  const options = parseArgs(argv, env);
  // Never create a store in a mistyped folder: the root must already hold the worker's store.
  if (!fs.existsSync(path.join(options.root, 'projects.sqlite'))) throw new Error(`No worker store at ${options.root}`);
  // recover:false: opening the store must not change the state of a job the running worker holds.
  const store = new Store(options.root, { recover: false });
  try {
    const olderThanMs = options.hours * 3600000;
    const items = findLeftovers(store, { olderThanMs, now });
    const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
    out.log(`${items.length} working ${items.length === 1 ? 'copy' : 'copies'} older than ${options.hours} h in ${options.root}, ${formatBytes(bytes)} in all`);
    for (const item of items) out.log(`  ${item.id}  ${new Date(item.touched).toISOString().slice(0, 16).replace('T', ' ')}  ${formatBytes(item.bytes)}${item.folder ? '' : '  (store row only)'}`);
    if (!options.yes) {
      if (items.length) out.log('Dry run: nothing was removed. Run again with --yes to remove these.');
      return { found: items.length, removed: 0, bytes, failed: [] };
    }
    const result = clearLeftovers(store, { olderThanMs, now }, out);
    out.log(`Removed ${result.removed} of ${result.found}, ${formatBytes(result.bytes)} freed${result.failed.length ? `; ${result.failed.length} failed (see above)` : ''}`);
    return result;
  } finally {
    store.close();
  }
}

if (require.main === module) {
  try {
    const result = run(process.argv.slice(2));
    if (result.failed.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, run };
