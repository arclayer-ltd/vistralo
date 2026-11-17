'use strict';
// Which picture stands for a project, which old names may be replaced, and what the backfill would change.
const test = require('node:test');
const assert = require('node:assert/strict');
const labels = require('../src/project-labels.cjs');
const { planProject, describe, parseArgs } = require('../scripts/backfill-titles-posters.cjs');

const flat = (value, n = 576) => new Array(n).fill(value);
const busy = (n = 576) => Array.from({ length: n }, (_, i) => (i * 37) % 256);

test('a frame that is near-black, near-white or one flat colour is not used as a poster', () => {
  assert.equal(labels.usableFrame(labels.lumaStats(flat(0))), false, 'black: the moment before a tab is picked');
  assert.equal(labels.usableFrame(labels.lumaStats(flat(6))), false, 'nearly black');
  assert.equal(labels.usableFrame(labels.lumaStats(flat(252))), false, 'a white page loading');
  assert.equal(labels.usableFrame(labels.lumaStats(flat(128))), false, 'one flat colour, like a count-in card');
  // A dark count-in: a flat field with a small numeral in it.
  const countIn = flat(20); for (let i = 200; i < 212; i++) countIn[i] = 240;
  assert.equal(labels.usableFrame(labels.lumaStats(countIn)), false, 'a count-in numeral on a dark field');
  assert.equal(labels.usableFrame(labels.lumaStats(busy())), true, 'a real screen');
  const rgba = []; for (const value of busy(64)) rgba.push(value, value, value, 255);
  assert.deepEqual(labels.rgbaLuma(rgba).map(Math.round), busy(64));
});

test('poster times start a fifth of the way in and stay within roughly 10–30% before going further', () => {
  const times = labels.posterTimes(100);
  assert.equal(times[0], 20);
  assert.deepEqual(times.slice(0, 5), [20, 15, 25, 10, 30]);
  assert.ok(times.every((t) => t > 0 && t < 100));
  assert.ok(!times.includes(0), 'never the first frame');
  // Short clips keep at least half a second in, and never ask past the end.
  assert.ok(labels.posterTimes(2).every((t) => t >= 0.4 && t <= 1.9));
  assert.deepEqual(labels.posterTimes(0), [0.5, 2, 5], 'an unknown length still avoids the first frame');
  assert.equal(new Set(labels.posterTimes(0.3).map(String)).size, labels.posterTimes(0.3).length, 'no time is tried twice');
});

test('the first usable frame wins; when all are blank the one with the most on it does', () => {
  const samples = [
    { time: 20, mean: 4, spread: 1 },
    { time: 15, mean: 120, spread: 2 },
    { time: 25, mean: 140, spread: 40 },
    { time: 10, mean: 150, spread: 60 },
  ];
  assert.equal(labels.chooseFrame(samples).time, 25);
  assert.equal(labels.chooseFrame(samples.slice(0, 2)).time, 15);
  assert.equal(labels.chooseFrame([]), null);
});

test('only names Vistralo made are replaced', () => {
  for (const name of ['Talk-through, Nov 15, 4:10 PM', 'Walkthrough, Nov 13, 11:28 PM', 'Section, Nov 15, 1:33 AM',
    'Talk-through, Nov 15, 4:10 PM', 'Walkthrough, 13 Oct, 18:10', 'Video, Nov 2, 9:02 AM', '6 screenshots, Nov 2, 9:00 AM',
    'Screen recording 2026-09-27T13-31-22-370Z', 'Untitled walkthrough', 'Untitled project', '6 screenshots', ''])
    assert.equal(labels.isAutomaticName(name), true, name);
  for (const name of ['Onboarding for Acme', 'Pricing – Mercury', 'mercury.com design review', 'Walkthrough of checkout', 'Section 3 retake', 'Q3 board video'])
    assert.equal(labels.isAutomaticName(name), false, name);
  // The saved flag wins over the pattern either way.
  assert.equal(labels.nameIsOwners({ name: 'Walkthrough, Nov 13, 11:28 PM', data: { autoName: false } }), true, 'renamed to look automatic, but typed');
  assert.equal(labels.nameIsOwners({ name: 'Pricing – Mercury', data: { autoName: true } }), false);
});

test('a better name comes from what the project holds, and never replaces the owner\'s', () => {
  const draft = { walkthroughDraft: { stops: [{ label: 'Design system' }, { label: 'Pricing plans' }, { label: 'Checkout' }] } };
  assert.equal(labels.scriptLabel(draft), 'Pricing plans', 'a label about the script, not a screen, is skipped');
  assert.equal(labels.scriptLabel({ scriptParts: [{ label: null }, { label: 'Team settings' }] }), 'Team settings');
  assert.equal(labels.improvedName({ name: 'Walkthrough, Nov 13, 11:28 PM', type: 'walkthrough', source: 'screen', data: draft }), 'Pricing plans');
  assert.equal(labels.improvedName({ name: 'Talk-through, Nov 15, 4:10 PM', type: 'walkthrough', source: 'screen', url: 'https://www.mercury.com/', data: draft }), 'mercury.com: Pricing plans');
  assert.equal(labels.improvedName({ name: 'Untitled talk-through', source: 'screen', data: { autoName: true, pageTitle: 'Inbox (3) - Gmail - Google Chrome' } }), 'Inbox (3) - Gmail');
  assert.equal(labels.improvedName({ name: 'Untitled video', source: 'upload', data: { autoName: true, sourceName: 'launch_recap.mp4' } }), 'launch recap');
  assert.equal(labels.improvedName({ name: 'Untitled visual brief', type: 'brief', source: 'web', url: 'https://acme.test/', data: { autoName: true } }), 'acme.test');
  assert.equal(labels.improvedName({ name: 'My pricing tour', source: 'screen', data: draft }), null, 'typed by the owner');
  assert.equal(labels.improvedName({ name: 'Walkthrough, Nov 13, 11:28 PM', source: 'screen', data: { ...draft, autoName: false } }), null);
  assert.equal(labels.improvedName({ name: 'Section, Nov 15, 1:33 AM', source: 'screen', data: {} }), null, 'nothing better is known');
});

test('stored stills: a website\'s first evidence frame, or a screen a fifth of the way through the script', () => {
  const id = 'p1';
  const brief = { id, data: { analysisEvidence: [`o/${id}/j/frames/a.png`, `o/${id}/j/frames/b.png`, `o/other/j/x.png`, `o/${id}/../x.png`] } };
  assert.deepEqual(labels.storedStills(brief), [`o/${id}/j/frames/a.png`, `o/${id}/j/frames/b.png`], 'only this project\'s own stills');
  const stops = Array.from({ length: 10 }, (_, i) => ({ frame: `o/${id}/j/evidence/frame-${i}.jpg` }));
  assert.equal(labels.storedStills({ id, data: { walkthroughDraft: { stops } } })[0], `o/${id}/j/evidence/frame-2.jpg`);
});

test('the backfill plans a name and a poster from stored data only, and says what it would do', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const frame = `owner/${id}/job/evidence/frame-01.jpg`;
  const row = { id, document: { name: 'Walkthrough, Nov 13, 11:28 PM', type: 'walkthrough', source: 'screen', status: 'draft', video: `owner/${id}/v.webm`,
    data: { files: { [frame]: { size: 1 }, [`owner/${id}/v.webm`]: { size: 2 } }, walkthroughDraft: { stops: [{ label: 'Billing page', frame }] } } } };
  const plan = planProject(row);
  assert.deepEqual(plan, { name: 'Billing page', thumbnail: { from: 'still', file: frame } });
  assert.match(describe(row, plan), /name: "Walkthrough, Nov 13, 11:28 PM" -> "Billing page"; poster: use stored still frame-01\.jpg/);
  assert.deepEqual(planProject(row, { only: 'names' }), { name: 'Billing page' });
  assert.deepEqual(planProject(row, { only: 'posters' }), { thumbnail: { from: 'still', file: frame } });
  // A still that is not in the project's file list is not used.
  const missing = structuredClone(row); delete missing.document.data.files[frame];
  assert.deepEqual(planProject(missing), { name: 'Billing page' });
  assert.deepEqual(planProject(missing, { videoPosters: true }).thumbnail, { from: 'video', file: `owner/${id}/v.webm` });
  // A project with a poster, in Trash, or named by its owner is left as it is.
  assert.deepEqual(planProject({ id, document: { ...row.document, thumbnail: 'x', name: 'Mine' } }), {});
  assert.deepEqual(planProject({ id, document: { ...row.document, trashed: true } }), {});
  // A video still uploading is not drawn from.
  assert.equal(planProject({ id, document: { ...missing.document, status: 'uploading' } }, { videoPosters: true }).thumbnail, undefined);
  assert.deepEqual(parseArgs([]), { apply: false, videoPosters: false }, 'a dry run unless --apply is given');
  assert.throws(() => parseArgs(['--aply']), /Unknown option/);
});
