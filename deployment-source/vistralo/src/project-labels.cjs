'use strict';
// What a project is called and which picture stands for it, when its owner has not said.
// Shared by the web app (bundled), the worker and the backfill script, so all three agree.
// Everything here is pure: no network, no paid calls, only data the project already holds.

const MAX_NAME = 120;
const clip = (text, max = MAX_NAME) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
};

/** "mercury.com", or "mercury.com/pricing" when the address names a page. */
function siteName(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return ''; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  const host = parsed.hostname.replace(/^www\./, '');
  if (!host) return '';
  let first = '';
  try { first = decodeURIComponent(parsed.pathname.split('/').filter(Boolean)[0] || ''); } catch { first = ''; }
  // A first path part that is an id, a locale or a file says nothing a person would recognise.
  const useful = first && first.length <= 32 && !/^[a-z]{2}(-[a-z]{2})?$/i.test(first) && !/^[\d-]+$/.test(first) &&
    !/^[0-9a-f-]{16,}$/i.test(first) && !/\.(html?|php|aspx?)$/i.test(first);
  return clip(useful ? `${host}/${first}` : host);
}

// Labels a browser gives a capture that are addresses, not names: Chrome's "screen:0:0",
// "window:1234:0" and "web-contents-media-stream://…", and the like.
const MACHINE_LABEL = /^(screen|window|tab|web-contents-media-stream|desktop)[:\s][\w:/.-]*$/i;
const EMPTY_TITLE = /^(new tab|untitled|about:blank|loading\.*|blank page|start page|home|google chrome|chrome|firefox|safari|microsoft edge|entire screen|screen \d+|built-in display)$/i;
const BROWSER_SUFFIX = /\s+[-–—|]\s+(google chrome|chromium|mozilla firefox|firefox|microsoft edge|safari|brave|opera|arc|vivaldi)(\s+\w+)?$/i;

/** A page or window title tidied into a name, or "" when it says nothing. */
function pageTitle(raw) {
  let title = String(raw || '').replace(/[\u0000-\u001f\u200b-\u200f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title || MACHINE_LABEL.test(title)) return '';
  for (let i = 0; i < 2; i++) title = title.replace(BROWSER_SUFFIX, '').trim();
  // Unread counts and recording dots: "(3) Inbox", "● Pricing".
  title = title.replace(/^(\(\d+\+?\)|\[\d+\+?\]|[●•◉⦿🔴]+)\s*/u, '').trim();
  if (!title || EMPTY_TITLE.test(title)) return '';
  // A tab with no title shows its address; name it by its site.
  if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(title) && !/\s/.test(title)) {
    const site = siteName(/^https?:/i.test(title) ? title : `https://${title}`);
    if (site) return site;
  }
  if (!/[\p{L}\p{N}]/u.test(title)) return '';
  return clip(title);
}

// File names cameras, recorders and operating systems make up, which say nothing about the content.
// "Screen Recording 2026-10-08 at 09.12.44", "IMG_4021", "untitled (2)", "video-final".
const MEANINGLESS_FILE = /^(screen ?recording|screencast|screen ?shot|screenshot|recording|capture|video|movie|clip|untitled|image|img|vid|mvi|dsc|pxl|gopr|rec|output|final|export|new|test|copy)?([\s\dTZ:._()-]|\b(at|am|pm|copy|final)\b)*$/i;

/** A file's own name, tidied ("Q3_onboarding-demo.mp4" is "Q3 onboarding demo"), or "". */
function fileTitle(fileName) {
  const stem = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.[^.]{1,5}$/, '')
    .replace(/[_]+/g, ' ').replace(/(?<=\S)-(?=\S)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stem || MEANINGLESS_FILE.test(stem) || !/[\p{L}]/u.test(stem)) return '';
  return clip(stem);
}

const KINDS = { section: 'section', 'talk-through': 'talk-through', walkthrough: 'walkthrough', video: 'video', screenshots: 'screenshots' };

/**
 * The name a new project gets when the person did not type one, from what was recorded and at no
 * cost: the recorded tab's title, the website, the uploaded file's own name. The date is shown on
 * the card already, so it is never part of the name.
 */
function automaticName({ flow, source, url, title, fileName, shotNames = [], shots = 0, spoken = false } = {}) {
  const site = url ? siteName(url) : '';
  const page = pageTitle(title);
  if (source === 'web') return site || 'Untitled visual brief';
  if (flow === 'narrate-screenshots') {
    const named = shotNames.map(fileTitle).find(Boolean);
    const count = `${shots} ${shots === 1 ? 'screenshot' : 'screenshots'}`;
    if (site) return clip(`${site}, ${count}`);
    if (named) return clip(shots > 1 ? `${named} and ${shots - 1} more` : named);
    return count;
  }
  if (source === 'upload') return fileTitle(fileName) || page || site || `Untitled ${KINDS.video}`;
  const kind = flow === 'section' ? KINDS.section : spoken || flow === 'talk-through' ? KINDS['talk-through'] : KINDS.walkthrough;
  return page || site || `Untitled ${kind}`;
}

// Names Vistralo made before titles came from the recording: "Talk-through, Nov 15, 4:10 PM",
// "Walkthrough, 13 Oct, 18:10", "6 screenshots, Nov 2, 9:00 AM", "Screen recording 2026-09-27T13-31-22-370Z",
// and the "Untitled …" fallbacks. Anything else was typed by a person, or is already descriptive.
const DATED_KIND = /^(walkthrough|talk-through|section|video|recording|screen recording|\d+ screenshots?)[,·\s]+[^,]{1,24}?\d{1,2}[^,]{0,16},\s*\d{1,2}[:.]\d{2}(\s?[ap]\.?m\.?)?$/i;
const STAMPED = /^(screen recording|screenshots) \d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/i;
const UNTITLED = /^untitled( (project|walkthrough|talk-through|section|video|screenshots|visual brief))?$/i;
const COUNTED = /^\d+ screenshots?$/i;
function isAutomaticName(name) {
  const value = String(name || '').trim();
  return !value || DATED_KIND.test(value) || STAMPED.test(value) || UNTITLED.test(value) || COUNTED.test(value);
}

/** Whether the owner may have chosen this name. Only names Vistralo made itself are ever replaced. */
function nameIsOwners(project) {
  const flag = project && project.data && project.data.autoName;
  if (flag === true) return false;
  if (flag === false) return true;
  return !isAutomaticName(project && project.name);
}

// Stop labels that describe the script rather than the screen.
const GENERIC_STOP = /^(design system|closing|outro|intro(duction)?|opening|overview|summary|screen \d+|stop \d+|untitled)$/i;
/** The first screen a walkthrough script names, from the reviewed draft or the voiced film. */
function scriptLabel(data) {
  const lists = [data && data.walkthroughDraft && data.walkthroughDraft.stops, data && data.scriptParts];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const stop of list) {
      const label = clip(stop && stop.label, 80);
      if (label && !GENERIC_STOP.test(label)) return label;
    }
  }
  return '';
}

/**
 * A better name for a project Vistralo named itself, from data it already holds, or null when
 * there is nothing better or the owner chose the name. Never returns a name for an owner's title.
 */
function improvedName(project) {
  if (!project || nameIsOwners(project)) return null;
  const data = project.data || {};
  const site = project.url ? siteName(project.url) : '';
  const label = scriptLabel(data);
  const page = pageTitle(data.pageTitle);
  const file = fileTitle(data.sourceName);
  let next = '';
  if (project.type === 'brief' || project.source === 'web') next = site;
  else if (project.source === 'upload') next = file || (label && site ? `${site}: ${label}` : label) || page || site;
  else next = page || (label && site ? `${site}: ${label}` : label) || site;
  next = clip(next);
  return next && next !== project.name ? next : null;
}

// ---------------------------------------------------------------------------------------------
// Picture choice

/** Brightness and contrast of a small greyscale sample (luma values 0–255). */
function lumaStats(luma) {
  let sum = 0, squares = 0;
  const count = luma.length || 1;
  for (let i = 0; i < luma.length; i++) { sum += luma[i]; squares += luma[i] * luma[i]; }
  const mean = sum / count;
  // Coverage: the share of the picture that differs from its most common tone, so a lone numeral
  // on a flat field (a count-in) has contrast but almost no coverage.
  const sorted = Array.from(luma).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  let off = 0;
  for (let i = 0; i < luma.length; i++) if (Math.abs(luma[i] - median) > 24) off++;
  return { mean, spread: Math.sqrt(Math.max(0, squares / count - mean * mean)), coverage: off / count };
}
/** RGBA pixels (canvas ImageData) to luma. */
function rgbaLuma(pixels) {
  const out = new Array(Math.floor(pixels.length / 4));
  for (let i = 0, j = 0; i + 3 < pixels.length; i += 4, j++) out[j] = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
  return out;
}
/**
 * A frame worth showing: not near-black (the moment before a tab is picked), not near-white, and
 * not one flat colour (a countdown or a blank page loading). Spread is the luma's standard deviation.
 */
function usableFrame({ mean, spread, coverage = 1 }) {
  return mean >= 16 && mean <= 245 && spread >= 8 && coverage >= 0.05;
}
/**
 * Times to try for a poster, best first: the opening seconds are often black or a count-in, so
 * look from roughly 10–30% in, starting at a fifth of the way, then further in if those are blank.
 */
function posterTimes(duration) {
  if (!(duration > 0)) return [0.5, 2, 5];
  const end = Math.max(0, duration - 0.1);
  const at = (fraction) => Math.min(end, Math.max(Math.min(0.5, end), duration * fraction));
  const seen = new Set();
  return [0.2, 0.15, 0.25, 0.1, 0.3, 0.4, 0.5, 0.65].map(at).filter((t) => {
    const key = t.toFixed(2);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/**
 * The sample to use, from [{time, mean, spread}] in the order they were tried: the first usable one,
 * or, when every one is blank, the one with the most going on.
 */
function chooseFrame(samples) {
  const list = (samples || []).filter((s) => s && Number.isFinite(s.mean) && Number.isFinite(s.spread));
  if (!list.length) return null;
  return list.find(usableFrame) || list.reduce((best, s) => (s.spread > best.spread ? s : best));
}
/**
 * A still the project already holds that can stand for it, best first: a website's first
 * evidence frame (the top of its page), or the screen a fifth of the way through a script.
 */
function storedStills(project) {
  const data = (project && project.data) || {};
  const own = (file) => typeof file === 'string' && file.split('/')[1] === project.id && !file.includes('..') && /\.(png|jpe?g|webp)$/i.test(file);
  const evidence = Array.isArray(data.analysisEvidence) ? data.analysisEvidence.filter(own) : [];
  const stops = data.walkthroughDraft && Array.isArray(data.walkthroughDraft.stops)
    ? data.walkthroughDraft.stops.map((stop) => stop && stop.frame).filter(own) : [];
  const fromScript = stops.length ? [stops[Math.min(stops.length - 1, Math.floor(stops.length * 0.2))], ...stops] : [];
  return [...new Set([...evidence, ...fromScript])];
}

module.exports = {
  MAX_NAME, siteName, pageTitle, fileTitle, automaticName, isAutomaticName, nameIsOwners, scriptLabel, improvedName,
  lumaStats, rgbaLuma, usableFrame, posterTimes, chooseFrame, storedStills,
};
