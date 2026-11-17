'use strict';
// The four create actions, their locked steps, and the rule that saving never starts paid AI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {buildSync} = require('esbuild');

function load(entry) {
  const bundled = buildSync({entryPoints:[path.join(__dirname, '../web', entry)], bundle:true, write:false, platform:'browser', format:'cjs'}).outputFiles[0].text;
  const module = {exports:{}};
  vm.runInNewContext(bundled, {module, exports:module.exports, URL, Intl, Date});
  return module.exports;
}
// The bundle runs in its own realm, so its arrays are compared as plain data.
const plain = value => JSON.parse(JSON.stringify(value));
const read = file => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
const flows = load('features/create-flows.ts');
const utils = load('features/flow-utils.ts');

test('there are four ways to start, named by what the person does, each with a kind for cards and filters', () => {
  assert.deepEqual(plain(flows.createFlows.map(item => item.label)), ['Record your screen', 'Record a website', 'Upload a video', 'Add images']);
  assert.deepEqual(plain(flows.createFlows.map(item => item.kind)), ['Screen recording', 'Website', 'Video', 'Images']);
  assert.deepEqual(plain(flows.createFlows.map(item => item.key)), ['R', 'W', 'U', 'I'], 'the menu letters stay the same');
  for (const item of flows.createFlows) assert.equal(flows.flowSteps[item.flow].at(-1), 'Save', `${item.label} ends by saving`);
  assert.deepEqual(plain(flows.flowSteps.website), ['Address', 'Options', 'Save']);
});

test('old flow names, which the Chrome extension and remembered choices may still use, open the flow they became', () => {
  assert.equal(flows.startFlow('ai-walkthrough'), 'screen');
  assert.equal(flows.startFlow('talk-through'), 'screen');
  assert.equal(flows.startFlow('section'), 'screen');
  assert.equal(flows.startFlow('narrate-video'), 'video');
  assert.equal(flows.startFlow('narrate-screenshots'), 'images');
  assert.equal(flows.startFlow('website'), 'website');
  assert.equal(flows.flowFor('talk-through').label, 'Record your screen');
  assert.equal(flows.flowFor('narrate-video').source, 'upload');
});

test('the website step stays locked until a public http(s) address is typed, and says why kindly', () => {
  assert.equal(utils.websiteProblem(''), '', 'an empty field is not an error yet');
  for (const ok of ['example.com', 'https://example.com/pricing', 'http://www.example.com'])
    assert.equal(utils.websiteProblem(ok), '', ok);
  assert.match(utils.websiteProblem('localhost:3000'), /public website/);
  assert.match(utils.websiteProblem('ftp://example.com'), /HTTP or HTTPS/);
  assert.match(utils.websiteProblem('https://user:pass@example.com'), /without a username or password/);
  assert.match(utils.websiteProblem('not a site'), /public website|website address/);
});

test('a project says what it was made from, including image videos saved before they were marked', () => {
  assert.equal(utils.projectKind({source:'screen'}), 'screen');
  assert.equal(utils.projectKind({source:'web'}), 'website');
  assert.equal(utils.projectKind({source:'upload', name:'Onboarding demo'}), 'video');
  assert.equal(utils.projectKind({source:'upload', name:'Anything', data:{origin:'images'}}), 'images');
  assert.equal(utils.projectKind({source:'upload', name:'6 screenshots'}), 'images');
  assert.equal(utils.projectKind({source:'upload', name:'Screenshots 2026-09-27T13-31-22-370Z'}), 'images');
  assert.equal(utils.projectKind({source:'upload', name:'Screenshot tips'}), 'video', 'a typed name is not guessed from');
  assert.deepEqual(plain(utils.namingData({origin:'images', autoName:true})), {origin:'images', autoName:true});
  assert.equal(utils.namingData({origin:'other'}).origin, undefined, 'only the known marker is stored');
});

test('the AI walkthrough estimate is priced like the worker prices it, and is shown before anything starts', () => {
  assert.equal(utils.aiWalkthroughEstimate(undefined), null);
  assert.equal(utils.aiWalkthroughEstimate(0), null);
  const minute = utils.aiWalkthroughEstimate(60);
  assert.equal(minute.screens, 10);
  assert.equal(minute.script, 0.18, 'ten cents plus 0.8 cents a screen');
  assert.equal(minute.voice, 0.1, 'at least a cent a screen');
  assert.equal(minute.total, 0.28);
  const long = utils.aiWalkthroughEstimate(3600);
  assert.equal(long.screens, 60, 'the worker explains at most 60 screens');
  assert.ok(long.total < 1.3);
  for (const seconds of [5, 30, 90, 272, 600]) {
    const e = utils.aiWalkthroughEstimate(seconds);
    assert.equal(e.total, Math.round((e.script + e.voice) * 100) / 100);
    assert.ok(e.script >= 0.1 && e.voice >= 0.01);
  }
});

test('saving a recording, video, images or a website starts no paid AI; only an explicit request does', () => {
  const cloud = read('cloud.ts');
  assert.match(cloud, /const voiceover=options\.voice==='ai';/, 'an upload queues narration only when AI is asked for by name');
  assert.match(cloud, /if\(options\.voice==='ai'\)await this\.guard\('jobs'\);/);
  const save = read('features/create/useSaveProject.ts');
  assert.equal(/voice:\s*"ai"|\("ai" as const\)/.test(save), false, 'the create flows never ask for an AI voice');
  assert.match(save, /narrate: false/, 'recording a website drafts no paid script');
  assert.match(save, /voice: source === "screen" && spoken \? \("microphone" as const\) : \("original" as const\)/);
  // The on-demand action always goes through the script review, so nothing is voiced unread.
  assert.match(read('features/project/AiWalkthroughDialog.tsx'), /adapter\.rpc\("voiceover", \{ id: project\.id, review: true \}\)/);
});
