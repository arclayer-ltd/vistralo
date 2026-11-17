'use strict';
// When a project is deleted. One rule for the web app (which shows the date), the dry-run report and the
// tests; supabase/migrations/20261117120000_vistralo_project_retention.sql holds the same rule in SQL, and
// that copy is the one the deletion sweep obeys.
//
// - A project is deleted RETENTION_MONTHS calendar months (UTC) after it was made: the row's created_at.
// - Re-recording, editing, renaming, sharing or opening it does not move that date.
// - Trash does not shorten it, and restoring from Trash does not extend it.
// - A duplicate keeps its original's date (document.retainFrom). retainFrom can only make the date earlier,
//   so an owner editing their own document cannot keep a project longer.
// - Projects made before the switch was turned on count from that day (grace_start), so nobody loses work
//   the day it goes live.

const RETENTION_MONTHS = 3;
const WARNING_DAYS = 7;
const DAY = 86400000;
// The shape the SQL copy accepts too; anything else is ignored rather than guessed at.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function toTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== 'string' || !value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

// A copied date is honoured only when it is a real day: JavaScript rolls 30 February into March, Postgres refuses it.
function copiedTime(value) {
  if (typeof value !== 'string' || !ISO.test(value)) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return m >= 1 && m <= 12 && d >= 1 && d <= days ? time : null;
}

/** Calendar months in UTC; the 31st of a shorter month becomes its last day, as Postgres does. */
function addMonthsUTC(time, months) {
  const at = new Date(time);
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(at.getUTCDate(), last), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds());
}

/** The moment a project's clock started: when it was made, or its original's, whichever is earlier. */
function retainedFrom(project) {
  const created = toTime(project && (project.created ?? project.created_at));
  const copied = copiedTime(project && project.retainFrom);
  if (created === null) return copied;
  return copied === null ? created : Math.min(created, copied);
}

/** When the project is deleted (ms since epoch), counting from grace_start for older projects. */
function expiresAt(project, settings) {
  const from = retainedFrom(project);
  if (from === null) return null;
  const grace = toTime(settings && (settings.graceStart ?? settings.grace_start));
  return addMonthsUTC(grace === null ? from : Math.max(from, grace), RETENTION_MONTHS);
}

/**
 * What the app shows. Null while the switch is off: nothing is deleted then, so no date is promised.
 * daysLeft counts whole days to the deletion moment, rounded up; due means the sweep will take it next.
 */
function deletionNotice(project, settings, now = Date.now()) {
  if (!settings || settings.enabled !== true) return null;
  const at = expiresAt(project, settings);
  if (at === null) return null;
  const left = at - now;
  const daysLeft = Math.max(0, Math.ceil(left / DAY));
  return { at, daysLeft, due: left <= 0, soon: left <= WARNING_DAYS * DAY };
}

/** A copy made now keeps the original's clock. */
function retainFromForCopy(original) {
  const from = retainedFrom(original);
  return from === null ? undefined : new Date(from).toISOString();
}

module.exports = { RETENTION_MONTHS, WARNING_DAYS, addMonthsUTC, retainedFrom, expiresAt, deletionNotice, retainFromForCopy };
