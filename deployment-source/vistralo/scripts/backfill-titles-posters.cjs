'use strict';
// Names and posters for projects made before titles came from the recording.
//
// It uses only what each project already holds: its website address, the tab title or file
// name saved with it, the first screen its script names, a website's evidence stills and a
// script's screen stills. With --video-posters it also draws a poster from the stored video
// with ffmpeg. It never calls a paid service, never queues a job and never renames a project
// whose name a person typed.
//
// Dry run (the default): reads every project and prints what would change. Nothing is written.
//   node scripts/backfill-titles-posters.cjs
//   node scripts/backfill-titles-posters.cjs --video-posters        # also list videos it would draw from
// Apply the printed changes:
//   node scripts/backfill-titles-posters.cjs --apply [--video-posters]
// Other options: --only=names|posters, --owner=<user id>, --project=<project id>, --limit=<n>.
//
// It signs in like the worker, with VISTRALO_SUPABASE_URL, VISTRALO_SUPABASE_PUBLISHABLE_KEY,
// VISTRALO_ADMIN_EMAIL and VISTRALO_ADMIN_PASSWORD from the environment or the .env beside
// package.json. Posters drawn from video need ffmpeg and ffprobe on PATH.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { improvedName, storedStills, posterTimes, chooseFrame, lumaStats, usableFrame } = require('../src/project-labels.cjs');

const SAMPLE_WIDTH = 32, SAMPLE_HEIGHT = 18;

/**
 * What the backfill would change about one project, from its stored document alone.
 * { name?: string, thumbnail?: { from: 'still', file } | { from: 'video', file } }; empty when nothing.
 */
function planProject(row, { only, videoPosters = false } = {}) {
  const doc = { ...row.document, id: row.id };
  const plan = {};
  if (!doc || doc.trashed) return plan;
  if (only !== 'posters') {
    const name = improvedName(doc);
    if (name) plan.name = name;
  }
  if (only !== 'names' && !doc.thumbnail) {
    const files = (doc.data && doc.data.files) || {};
    const still = storedStills(doc).find((file) => files[file]);
    if (still) plan.thumbnail = { from: 'still', file: still };
    else if (videoPosters && doc.type === 'walkthrough' && typeof doc.video === 'string' && files[doc.video] &&
      doc.video.split('/')[1] === doc.id && !['uploading', 'queued', 'processing'].includes(doc.status))
      plan.thumbnail = { from: 'video', file: doc.video };
  }
  return plan;
}

/** The printed preview: one line per project that changes. */
function describe(row, plan) {
  const short = row.id.slice(0, 8);
  const parts = [];
  if (plan.name) parts.push(`name: ${JSON.stringify(row.document.name)} -> ${JSON.stringify(plan.name)}`);
  if (plan.thumbnail) parts.push(plan.thumbnail.from === 'still'
    ? `poster: use stored still ${path.posix.basename(plan.thumbnail.file)}`
    : 'poster: draw a frame from the video (10-30% in, skipping blank frames)');
  return `${short}  ${(row.document.type || '').padEnd(11)} ${parts.join('; ')}`;
}

function parseArgs(argv) {
  const options = { apply: false, videoPosters: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--video-posters') options.videoPosters = true;
    else if (arg.startsWith('--only=')) options.only = arg.slice(7);
    else if (arg.startsWith('--owner=')) options.owner = arg.slice(8);
    else if (arg.startsWith('--project=')) options.project = arg.slice(10);
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.slice(8));
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option ${arg}. Use --help.`);
  }
  if (options.only && !['names', 'posters'].includes(options.only)) throw new Error('--only is names or posters');
  return options;
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/.test(name) || process.env[name]) continue;
    process.env[name] = trimmed.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

function capture(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-2000); });
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${exe} failed (${code}). ${err}`))));
  });
}

async function videoDuration(file, known) {
  if (known > 0) return known;
  const probe = JSON.parse(String(await capture('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', file])));
  const duration = Number(probe.format && probe.format.duration);
  if (duration > 0) return duration;
  // MediaRecorder WebM has no duration in its header; decoding to the end finds it.
  const progress = String(await capture('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-map', '0:v:0', '-f', 'null', '-progress', 'pipe:1', '-']));
  const marks = [...progress.matchAll(/out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = marks[marks.length - 1];
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
}

/** Downloads the video, picks a representative frame and returns it as a JPEG. */
async function drawPoster(bucket, doc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vistralo-poster-'));
  try {
    const local = path.join(dir, 'source' + path.extname(doc.video));
    const { data, error } = await bucket.createSignedUrl(doc.video, 3600);
    if (error) throw error;
    const response = await fetch(data.signedUrl);
    if (!response.ok || !response.body) throw new Error(`Could not download the video (HTTP ${response.status})`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(local));
    const known = Number(doc.duration) || Number(doc.data && doc.data.mediaInfo && doc.data.mediaInfo.duration) || 0;
    const duration = await videoDuration(local, known);
    const samples = [];
    for (const time of posterTimes(duration)) {
      const raw = await capture('ffmpeg', ['-hide_banner', '-nostdin', '-ss', time.toFixed(3), '-i', local, '-frames:v', '1',
        '-vf', `scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT},format=gray`, '-f', 'rawvideo', 'pipe:1']).catch(() => null);
      if (!raw || !raw.length) continue;
      const stats = lumaStats(raw);
      samples.push({ time, ...stats });
      if (usableFrame(stats)) break;
    }
    const chosen = chooseFrame(samples);
    if (!chosen) throw new Error('No frame could be read from the video');
    const out = path.join(dir, 'poster.jpg');
    await capture('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-ss', chosen.time.toFixed(3), '-i', local, '-frames:v', '1',
      '-vf', "scale='min(960,iw)':-2", '-q:v', '4', out]);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 19).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  loadEnvFile(path.join(__dirname, '..', '.env'));
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.VISTRALO_SUPABASE_URL, key = process.env.VISTRALO_SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.VISTRALO_ADMIN_EMAIL, password = process.env.VISTRALO_ADMIN_PASSWORD;
  if (!url || !key || !email || !password) throw new Error('Set VISTRALO_SUPABASE_URL, VISTRALO_SUPABASE_PUBLISHABLE_KEY, VISTRALO_ADMIN_EMAIL and VISTRALO_ADMIN_PASSWORD (the worker .env has them).');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: true } });
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const bucket = db.storage.from('vistralo-media');

  const rows = [];
  for (let from = 0; ; from += 500) {
    let query = db.from('vistralo_projects').select('id,owner_id,document,updated_at').order('created_at', { ascending: true }).range(from, from + 499);
    if (options.owner) query = query.eq('owner_id', options.owner);
    if (options.project) query = query.eq('id', options.project);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) break;
  }
  const planned = rows.map((row) => ({ row, plan: planProject(row, options) })).filter(({ plan }) => plan.name || plan.thumbnail);
  const work = options.limit > 0 ? planned.slice(0, options.limit) : planned;
  console.log(`${options.apply ? 'Applying' : 'Dry run.'} ${rows.length} projects read; ${planned.length} would change${work.length < planned.length ? `, ${work.length} in this run` : ''}.`);
  console.log(`  names: ${work.filter((w) => w.plan.name).length}, posters from stored stills: ${work.filter((w) => w.plan.thumbnail?.from === 'still').length}, posters from video: ${work.filter((w) => w.plan.thumbnail?.from === 'video').length}`);
  for (const { row, plan } of work) console.log(describe(row, plan));
  if (!options.apply) {
    console.log('\nNothing was written. Run again with --apply to make these changes.');
    return;
  }

  let done = 0, failed = 0;
  for (const { row, plan } of work) {
    try {
      let poster = null;
      if (plan.thumbnail?.from === 'video') {
        const image = await drawPoster(bucket, { ...row.document, id: row.id });
        poster = `${row.owner_id}/${row.id}/poster-${crypto.randomUUID()}.jpg`;
        const uploaded = await bucket.upload(poster, image, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
        if (uploaded.error) throw uploaded.error;
        plan.thumbnail.size = image.length;
      }
      // Re-read, so an edit made since the preview is never overwritten, and keep updated_at:
      // a new name or poster is not an edit and must not move the project to the top of the list.
      const latest = await db.from('vistralo_projects').select('document,updated_at').eq('id', row.id).single();
      if (latest.error) throw latest.error;
      const fresh = planProject({ id: row.id, document: latest.data.document }, { ...options, videoPosters: !!poster });
      const doc = { ...latest.data.document };
      if (plan.name && fresh.name === plan.name) doc.name = plan.name;
      if (poster && !doc.thumbnail) {
        doc.thumbnail = poster;
        doc.data = { ...doc.data, files: { ...(doc.data && doc.data.files), [poster]: { size: plan.thumbnail.size, mime: 'image/jpeg' } } };
      } else if (plan.thumbnail?.from === 'still' && fresh.thumbnail?.file === plan.thumbnail.file) doc.thumbnail = plan.thumbnail.file;
      const saved = await db.from('vistralo_projects').update({ document: doc }).eq('id', row.id).eq('updated_at', latest.data.updated_at).select('id');
      if (saved.error) throw saved.error;
      if (!saved.data.length) {
        if (poster) await bucket.remove([poster]);
        throw new Error('changed while the backfill ran; run it again');
      }
      if (poster && doc.thumbnail !== poster) await bucket.remove([poster]);
      done += 1;
      console.log(`updated ${row.id.slice(0, 8)}`);
    } catch (error) {
      failed += 1;
      console.error(`skipped ${row.id.slice(0, 8)}: ${String(error.message || error).slice(0, 300)}`);
    }
  }
  console.log(`\nDone: ${done} updated, ${failed} skipped.`);
  if (failed) process.exitCode = 1;
}

module.exports = { planProject, describe, parseArgs };
if (require.main === module) main().catch((error) => {
  console.error('Backfill stopped:', error.message || error);
  process.exitCode = 1;
});
