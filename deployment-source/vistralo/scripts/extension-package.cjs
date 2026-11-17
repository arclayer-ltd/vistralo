'use strict';
// Packs the built extension into a zip, reads a zip back, and checks a release zip before it goes
// to the Chrome Web Store. build-extension.cjs runs the check on every release build, and
// tests/extension-release.test.cjs runs it on purpose-made bad zips.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const APP = 'https://app.vistralo.com';
const APP_MATCH = `${APP}/*`;

/** What a release may ask for. Adding a permission is a decision: change this list and store/LISTING.md together. */
const RELEASE_PERMISSIONS = ['activeTab', 'offscreen', 'scripting', 'storage', 'tabCapture', 'unlimitedStorage'];
const RELEASE_OPTIONAL_HOSTS = ['http://*/*', 'https://*/*'];
const RELEASE_CSP = "script-src 'self'; object-src 'self'";

/** Files a release may contain, by extension. Anything else (source, maps, keys, notes) is refused. */
const ALLOWED = new Set(['.js', '.html', '.css', '.png', '.svg', '.woff2', '.txt']);

/** Text that must never ship: local and demo targets, source maps, eval and remotely loaded code. */
const FORBIDDEN_TEXT = [
  [/sourceMappingURL/, 'a source map reference'],
  [/127\.0\.0\.1|localhost|\[::1\]/, 'a local address'],
  [/#demo\/|"demo\/"|demo\/import/, 'the demo hand-over'],
  [/\beval\s*\(|new Function\s*\(/, 'eval or new Function'],
  [/<script[^>]+src\s*=\s*["']?(https?:)?\/\//i, 'a script loaded from another host'],
  [/import\s*\(\s*["'`]https?:/, 'a module imported from another host'],
  [/\bdebugger\b/, 'a debugger statement'],
  [/BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20,}|service_role/, 'something that looks like a secret'],
];

/** A zip of the folder (deflate, fixed dates so the same input gives the same archive). */
function zip(dir, file) {
  const files = [];
  const walk = (d) => {
    for (const item of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, item.name);
      if (item.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  writeZip(file, files.map((full) => ({ name: path.relative(dir, full).split(path.sep).join('/'), data: fs.readFileSync(full) })));
}

/** Writes entries ({ name, data }) to a zip file. */
function writeZip(file, entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const { name: entryName, data } of entries) {
    const name = Buffer.from(entryName);
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, ...central, end]));
}

/** Reads every entry of a zip from its central directory: [{ name, data }]. Stored and deflated entries only. */
function readZip(file) {
  const buf = fs.readFileSync(file);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error(`${file} is not a zip.`);
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`${file} has a broken central directory.`);
    const method = buf.readUInt16LE(at + 10);
    const packedSize = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const packed = buf.subarray(dataAt, dataAt + packedSize);
    if (method !== 0 && method !== 8) throw new Error(`${name} uses zip method ${method}, which this reader does not handle.`);
    entries.push({ name, data: method === 8 ? zlib.inflateRawSync(packed) : Buffer.from(packed) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const validVersion = (v) => typeof v === 'string' && /^\d+(\.\d+){0,3}$/.test(v) && v.split('.').every((p) => Number(p) <= 65535 && !/^0\d/.test(p));
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * Everything wrong with a release zip, as sentences; an empty list means it may be uploaded.
 * `expectedVersion`, when given, is the version the zip's name promises.
 */
function releaseProblems(file, { expectedVersion } = {}) {
  const problems = [];
  const entries = readZip(file);
  const names = new Set(entries.map((e) => e.name));
  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) return ['manifest.json is not at the root of the zip.'];
  let m;
  try {
    m = JSON.parse(manifestEntry.data.toString('utf8'));
  } catch {
    return ['manifest.json is not valid JSON.'];
  }

  // The package itself.
  if (fs.statSync(file).size > 50 * 1024 * 1024) problems.push('The zip is larger than 50 MB.');
  for (const { name } of entries) {
    if (name === 'manifest.json') continue;
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) problems.push(`${name} has an unsafe path.`);
    if (!ALLOWED.has(path.posix.extname(name).toLowerCase())) problems.push(`${name} is not a file type a release ships.`);
    if (/(^|\/)(\.|__MACOSX|node_modules\/|src\/|dev-key|README)/i.test(name)) problems.push(`${name} does not belong in a release.`);
  }
  for (const { name, data } of entries) {
    if (!/\.(js|html|css|json)$/.test(name)) continue;
    const text = data.toString('utf8');
    for (const [pattern, what] of FORBIDDEN_TEXT) if (pattern.test(text)) problems.push(`${name} contains ${what}.`);
  }

  // The manifest.
  if (m.manifest_version !== 3) problems.push('manifest_version must be 3.');
  if (!validVersion(m.version)) problems.push(`version "${m.version}" is not a valid Chrome extension version.`);
  if (expectedVersion && m.version !== expectedVersion) problems.push(`The zip is named for ${expectedVersion} but its manifest says ${m.version}.`);
  if ('key' in m) problems.push('The manifest has a "key"; the store assigns the id, and only dev builds carry one.');
  if ('update_url' in m) problems.push('The manifest has an "update_url"; the store sets its own.');
  if (typeof m.name !== 'string' || !m.name || m.name.length > 75) problems.push('name must be 1 to 75 characters.');
  if (m.short_name && m.short_name.length > 12) problems.push('short_name must be at most 12 characters.');
  if (typeof m.description !== 'string' || !m.description || m.description.length > 132) problems.push('description must be 1 to 132 characters.');
  if (m.homepage_url !== 'https://vistralo.com') problems.push('homepage_url must be https://vistralo.com.');
  if (!/^\d+$/.test(m.minimum_chrome_version || '') || Number(m.minimum_chrome_version) < 116)
    problems.push('minimum_chrome_version must be 116 or later (runtime.getContexts and tabCapture from a service worker).');
  for (const size of ['16', '32', '48', '128']) if (!m.icons || !names.has(m.icons[size])) problems.push(`The ${size}px icon is missing.`);
  if (!sameSet(m.permissions, RELEASE_PERMISSIONS)) problems.push(`permissions must be exactly ${RELEASE_PERMISSIONS.join(', ')}; found ${JSON.stringify(m.permissions)}.`);
  if (m.host_permissions && m.host_permissions.length) problems.push('A release asks for no host permissions at install; all-sites access stays optional.');
  if (!sameSet(m.optional_host_permissions, RELEASE_OPTIONAL_HOSTS)) problems.push('optional_host_permissions must stay http://*/* and https://*/*.');
  if (m.optional_permissions && m.optional_permissions.length) problems.push('optional_permissions is not expected in a release.');
  if (m.externally_connectable) problems.push('externally_connectable is not expected; the app talks to the extension through the bridge content script.');
  if (m.content_security_policy?.extension_pages !== RELEASE_CSP) problems.push(`The extension pages' CSP must be "${RELEASE_CSP}".`);
  if (m.content_security_policy?.sandbox) problems.push('No sandboxed pages are expected.');
  const scripts = m.content_scripts || [];
  if (scripts.length !== 1 || !sameSet(scripts[0].matches, [APP_MATCH]) || !sameSet(scripts[0].js, ['bridge.js']))
    problems.push(`The only content script is bridge.js on ${APP_MATCH}.`);
  const handoff = (m.web_accessible_resources || []).find((r) => r.resources?.includes('handoff.html'));
  if (!handoff || !sameSet(handoff.matches, [APP_MATCH])) problems.push(`handoff.html may be framed only by ${APP_MATCH}.`);

  // Every file the manifest names is in the zip.
  const referenced = [
    m.background?.service_worker,
    m.action?.default_popup,
    ...Object.values(m.action?.default_icon || {}),
    ...Object.values(m.icons || {}),
    ...scripts.flatMap((s) => [...(s.js || []), ...(s.css || [])]),
    ...(m.web_accessible_resources || []).flatMap((r) => r.resources || []),
  ].filter(Boolean);
  for (const name of referenced) if (!names.has(name)) problems.push(`The manifest names ${name}, which is not in the zip.`);
  // Every page's own scripts and styles are in the zip too.
  for (const { name, data } of entries) {
    if (!name.endsWith('.html')) continue;
    for (const [, ref] of data.toString('utf8').matchAll(/(?:src|href)="([^"#?:]+)"/g)) {
      const resolved = path.posix.join(path.posix.dirname(name), ref);
      if (!names.has(resolved)) problems.push(`${name} loads ${ref}, which is not in the zip.`);
    }
  }
  return problems;
}

module.exports = { zip, writeZip, readZip, releaseProblems, RELEASE_PERMISSIONS };
