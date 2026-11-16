'use strict';
// Which keys a narration job runs on: Pro and Studio fall back to Vistralo's own keys; Free brings its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { includedPlans, includedKeys, chooseKeys, FREE_MESSAGE, UNAVAILABLE_MESSAGE } = require('../src/included-ai.cjs');

const HOUSE = { openai: 'house-openai', voiceId: 'marin', cap: 1 };
const OWN = { openai: 'own-openai', voiceId: 'nova', cap: 2.5 };

test('the plans that include AI narration come from the plan table', () => {
  assert.deepEqual([...includedPlans({})].sort(), ['pro', 'studio']);
  const table = JSON.parse(fs.readFileSync(path.join(__dirname, '../web/billing/plans.json'), 'utf8'));
  for (const plan of table.plans) assert.equal(typeof plan.aiIncluded, 'boolean', plan.id + ' says whether AI is included');
  // The override is how Free is added later without editing the file.
  assert.deepEqual([...includedPlans({ VISTRALO_INCLUDED_AI_PLANS: 'free, pro,studio' })], ['free', 'pro', 'studio']);
  // A worker without the table refuses to start rather than guess.
  assert.throws(() => includedPlans({}, path.join(os.tmpdir(), 'no-such-plans.json')), /plan table is missing/);
});

test('the included keys are read from their own variables, not the old shared ones', () => {
  assert.deepEqual(includedKeys({ OPENAI_API_KEY: 'x', HEYGEN_API_KEY: 'y' }), { openai: '', voiceId: '', cap: 1 });
  assert.deepEqual(
    includedKeys({ VISTRALO_INCLUDED_OPENAI_API_KEY: ' a ', VISTRALO_INCLUDED_HEYGEN_API_KEY: 'b', VISTRALO_INCLUDED_VOICE: 'coral', VISTRALO_INCLUDED_COST_CAP_USD: '3' }),
    { openai: 'a', voiceId: 'coral', cap: 3 },
  );
  assert.equal(includedKeys({ VISTRALO_INCLUDED_COST_CAP_USD: 'nonsense' }).cap, 1);
});

test('a paid plan with no keys of its own runs on the included keys and voice, within the included cap', () => {
  const settings = chooseKeys({ own: {}, included: true, house: HOUSE });
  assert.equal(settings.openai, 'house-openai');
  assert.equal(settings.voiceId, 'marin');
  assert.equal(settings.cap, 1);
  assert.deepEqual(settings.sources, { openai: 'included' });
  assert.doesNotThrow(() => settings.need('openai'));
});

test('a customer cannot raise spending on the included keys, but can lower it', () => {
  assert.equal(chooseKeys({ own: { cap: 50 }, included: true, house: HOUSE }).cap, 1);
  assert.equal(chooseKeys({ own: { cap: 0.25 }, included: true, house: HOUSE }).cap, 0.25);
  assert.equal(chooseKeys({ own: { voiceId: 'chosen' }, included: true, house: HOUSE }).voiceId, 'chosen');
});

test('a customer\'s own saved keys always win, with their own cap', () => {
  const settings = chooseKeys({ own: OWN, included: true, house: HOUSE });
  assert.equal(settings.openai, 'own-openai');
  assert.equal(settings.voiceId, 'nova');
  assert.equal(settings.cap, 2.5);
  assert.deepEqual(settings.sources, { openai: 'own' });
  // Their own key without a chosen voice uses the default voice, not the included one.
  assert.equal(chooseKeys({ own: { openai: 'own-openai' }, included: true, house: HOUSE }).voiceId, '');
});

test('the Free plan never touches the included keys and is told to bring its own', () => {
  const none = chooseKeys({ own: {}, included: false, house: HOUSE });
  assert.equal(none.openai, '');
  assert.throws(() => none.need('openai'), (error) => error.message === FREE_MESSAGE);
  assert.match(FREE_MESSAGE, /Settings, under AI narration/);
  const own = chooseKeys({ own: OWN, included: false, house: HOUSE });
  assert.equal(own.openai, 'own-openai');
  assert.equal(own.voiceId, 'nova');
  assert.equal(own.cap, 2.5);
  assert.doesNotMatch(FREE_MESSAGE, /HeyGen/);
});

test('a paid plan whose included keys are missing on the worker gets a message that is not about its own keys', () => {
  const settings = chooseKeys({ own: {}, included: true, house: { openai: '', voiceId: '', cap: 1 } });
  assert.throws(() => settings.need('openai'), (error) => error.message === UNAVAILABLE_MESSAGE);
});

test('the worker uses the rule, no longer reads the shared OPENAI_API_KEY, and has no HeyGen left', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../scripts/local-admin-worker.cjs'), 'utf8');
  assert.match(worker, /chooseKeys\(/);
  assert.doesNotMatch(worker, /fromEnv\('(OPENAI_API_KEY|HEYGEN_API_KEY|HEYGEN_VOICE_ID)'\)/);
  assert.doesNotMatch(worker, /assert\(settings\.(openai|heygen)/);
  assert.doesNotMatch(worker, /heygen/i);
});
