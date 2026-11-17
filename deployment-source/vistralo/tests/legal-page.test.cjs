'use strict';
// The published privacy policy (/privacy) is built from docs/legal/PRIVACY.md. These checks keep the
// page publishable: every placeholder filled, the facts the Chrome Web Store and the owner rely on
// present, and the build refusing anything the converter would render wrongly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render, page } = require('../scripts/legal-page.cjs');

const root = path.join(__dirname, '..');
const policy = fs.readFileSync(path.join(root, 'docs/legal/PRIVACY.md'), 'utf8');

test('the privacy policy renders and names the operator, contact and retention', () => {
  const { title, html } = render(policy);
  assert.equal(title, 'Vistralo privacy policy');
  for (const fact of ['Rezan Ferdous', 'Enayetpur, Sirajganj, Bangladesh', 'mailto:hello@arclayer.co', '3 months after the project is made', 'Nobody at Vistralo watches your recordings', 'Singapore', 'Limited Use', 'https://developer.chrome.com/docs/webstore/program-policies/limited-use']) {
    assert.ok(html.includes(fact), `missing: ${fact}`);
  }
  for (const stale of ['Dynamix', 'Dhaka', 'contact@vistralo.com', '{{', 'DRAFT']) assert.ok(!html.includes(stale), `still says: ${stale}`);
});

test('the page is a complete, script-free document with a canonical address', () => {
  const html = page({ markdown: policy, path: '/privacy', description: 'd' });
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes('<link rel="canonical" href="https://app.vistralo.com/privacy">'));
  assert.ok(html.includes('name="viewport"'));
  assert.ok(!/<script/i.test(html));
  assert.ok(!/noindex/.test(html));
});

test('the build refuses what the converter cannot render', () => {
  assert.throws(() => render('# T\n\nEffective {{DATE}}'), /placeholder/);
  assert.throws(() => render('# T\n\n| a | b |\n| - | - |'), /table/);
  assert.throws(() => render('# T\n\n<b>x</b>'), /raw HTML/);
  assert.throws(() => render('No title here'), /no "# " title/);
  assert.throws(() => render('# T\n\nText\n- item'), /not separated/);
});

test('inline formatting: links, bare addresses and bold, with text escaped', () => {
  const { html } = render('# T\n\n**Bold** see [the policy](https://example.com/a) or https://example.com/b, and <not a tag> & "quotes".'.replace('<not a tag>', 'a < b'));
  assert.ok(html.includes('<strong>Bold</strong>'));
  assert.ok(html.includes('<a href="https://example.com/a">the policy</a>'));
  assert.ok(html.includes('<a href="https://example.com/b">https://example.com/b</a>,'));
  assert.ok(html.includes('a &lt; b &amp; &quot;quotes&quot;'));
});

test('Vercel serves /privacy, and the cloud build copies the page', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(vercel.rewrites.some((r) => r.source === '/privacy' && r.destination === '/privacy.html'));
  const cloud = fs.readFileSync(path.join(root, 'scripts/build-cloud.cjs'), 'utf8');
  assert.ok(cloud.includes("'privacy.html'") && cloud.includes("'legal.css'"));
});

test('the store listing points at the published policy', () => {
  const listing = fs.readFileSync(path.join(root, 'extension/store/LISTING.md'), 'utf8');
  assert.ok(!listing.includes('{{PRIVACY_POLICY_URL}}'));
  assert.ok(listing.includes('Privacy policy: https://app.vistralo.com/privacy'));
});
