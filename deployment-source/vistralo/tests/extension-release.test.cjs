'use strict';
// The Chrome Web Store zip: the real release build passes its check, and each thing a release
// must not contain makes the check fail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readZip, writeZip, releaseProblems } = require('../scripts/extension-package.cjs');

const root = path.join(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8')).version;
const build = (target) =>
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-extension.cjs')], {
    env: { ...process.env, VISTRALO_EXTENSION_TARGET: target, VISTRALO_EXTENSION_APP_ORIGIN: '', VISTRALO_EXTENSION_DEMO: '' },
    stdio: 'pipe',
  });
const zipOf = (target) => path.join(root, 'extension-dist', `vistralo-extension-${version}-${target}.zip`);

let release;
let dir;
test.before(() => {
  build('release');
  release = readZip(zipOf('release'));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vistralo-release-'));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Writes the release with one change and returns the check's findings. */
function changed(change) {
  const entries = release.map((e) => ({ name: e.name, data: Buffer.from(e.data) }));
  const manifest = entries.find((e) => e.name === 'manifest.json');
  const m = JSON.parse(manifest.data.toString('utf8'));
  const result = change(entries, m) || entries;
  manifest.data = Buffer.from(JSON.stringify(m));
  const file = path.join(dir, `case-${Math.random().toString(16).slice(2)}.zip`);
  writeZip(file, result);
  return releaseProblems(file).join('\n');
}
const edit = (entries, name, fn) => {
  const e = entries.find((x) => x.name === name);
  e.data = Buffer.from(fn(e.data.toString('utf8')));
};

test('the release build passes its own check and targets app.vistralo.com', () => {
  assert.deepEqual(releaseProblems(zipOf('release'), { expectedVersion: version }), []);
  const m = JSON.parse(release.find((e) => e.name === 'manifest.json').data.toString('utf8'));
  assert.deepEqual(m.content_scripts[0].matches, ['https://app.vistralo.com/*']);
  assert.equal(m.key, undefined);
  assert.ok(m.description.length <= 132);
  const names = release.map((e) => e.name);
  assert.ok(!names.some((n) => /\.(ts|map)$|dev-key|README/.test(n)), names.join(', '));
  assert.match(release.find((e) => e.name === 'background.js').data.toString('utf8'), /https:\/\/app\.vistralo\.com/);
});

test('a dev build is refused as a release: it carries the fixed id', () => {
  build('dev');
  assert.match(releaseProblems(zipOf('dev')).join('\n'), /"key"/);
});

test('the check refuses what a release must not ship', () => {
  const cases = [
    ['a manifest key', (_, m) => void (m.key = 'abc'), /"key"/],
    ['an update URL', (_, m) => void (m.update_url = 'https://example.com/u.xml'), /update_url/],
    ['an extra permission', (_, m) => void m.permissions.push('tabs'), /permissions must be exactly/],
    ['a missing permission', (_, m) => void (m.permissions = m.permissions.filter((p) => p !== 'offscreen')), /permissions must be exactly/],
    ['all sites at install', (_, m) => void (m.host_permissions = ['https://*/*']), /no host permissions at install/],
    ['the bridge on every site', (_, m) => void (m.content_scripts[0].matches = ['https://*/*']), /only content script/],
    ['a looser CSP', (_, m) => void (m.content_security_policy.extension_pages = "script-src 'self' 'unsafe-eval'"), /CSP/],
    ['a long description', (_, m) => void (m.description = 'x'.repeat(133)), /description/],
    ['no homepage', (_, m) => void delete m.homepage_url, /homepage_url/],
    ['an old Chrome', (_, m) => void (m.minimum_chrome_version = '110'), /minimum_chrome_version/],
    ['a bad version', (_, m) => void (m.version = '1.0.0-beta'), /not a valid Chrome extension version/],
    ['a missing icon', (entries) => entries.filter((e) => e.name !== 'icons/icon-128.png'), /128px icon is missing/],
    ['a source map', (entries) => [...entries, { name: 'background.js.map', data: Buffer.from('{}') }], /not a file type/],
    ['TypeScript source', (entries) => [...entries, { name: 'src/background.ts', data: Buffer.from('') }], /not a file type|does not belong/],
    ['the dev key', (entries) => [...entries, { name: 'dev-key.txt', data: Buffer.from('') }], /does not belong/],
    ['a dotfile', (entries) => [...entries, { name: '.env.txt', data: Buffer.from('') }], /does not belong/],
    ['a source map comment', (entries) => void edit(entries, 'popup.js', (s) => s + '\n//# sourceMappingURL=popup.js.map'), /source map/],
    ['a local app', (entries) => void edit(entries, 'background.js', (s) => s.replace('https://app.vistralo.com', 'http://127.0.0.1:4387')), /local address/],
    ['the demo hand-over', (entries) => void edit(entries, 'background.js', (s) => s + ';var u="/#demo/import/x"'), /demo/],
    ['eval', (entries) => void edit(entries, 'popup.js', (s) => s + ';eval("1")'), /eval/],
    ['a remote script', (entries) => void edit(entries, 'popup.html', (s) => s.replace('</head>', '<script src="https://cdn.example.com/x.js"></script></head>')), /another host/],
    ['a page script left out of the zip', (entries) => entries.filter((e) => e.name !== 'welcome.js'), /welcome\.html loads welcome\.js/],
  ];
  for (const [name, change, expected] of cases) assert.match(changed(change), expected, name);
});

test('a zip without a manifest at its root is refused', () => {
  const file = path.join(dir, 'nested.zip');
  writeZip(file, release.map((e) => ({ name: `vistralo/${e.name}`, data: e.data })));
  assert.deepEqual(releaseProblems(file), ['manifest.json is not at the root of the zip.']);
});
