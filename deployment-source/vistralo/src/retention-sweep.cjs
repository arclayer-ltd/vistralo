'use strict';
// The worker's hourly deletion of projects past their 3 months (see src/retention.cjs for the rule and
// supabase/migrations/20261117120000_vistralo_project_retention.sql for the functions it calls).
//
// For each due project: list every file under {owner}/{project}/, remove them in batches, then ask the database
// to finish, which refuses while any file remains. A failure at any step leaves the project row (and so its
// remaining files) for the next sweep; one project failing never stops the others. While the switch is off the
// database returns nothing, so this deletes nothing.

const BATCH = 100;

const unwrap = (result) => {
  if (result && result.error) throw Error(result.error.message || String(result.error));
  return result ? result.data : undefined;
};

async function sweepExpired({ db, bucket, log = console.log, limit = 100, batch = BATCH }) {
  const report = { due: 0, deleted: [], failed: [] };
  const due = unwrap(await db.rpc('vistralo_retention_due', { p_limit: limit })) || [];
  report.due = due.length;
  for (const project of due) {
    const id = project.project_id;
    let removed = 0;
    try {
      const files = (unwrap(await db.rpc('vistralo_retention_files', { p_project: id })) || [])
        .map((row) => (typeof row === 'string' ? row : row && (row.vistralo_retention_files || row.name)))
        .filter((name) => typeof name === 'string' && name.startsWith(`${project.owner_id}/${id}/`));
      for (let i = 0; i < files.length; i += batch) {
        const gone = unwrap(await bucket.remove(files.slice(i, i + batch))) || [];
        removed += gone.length;
      }
      const finished = unwrap(await db.rpc('vistralo_retention_finish', { p_project: id, p_files_removed: removed }));
      report.deleted.push({ id, owner: project.owner_id, files: removed });
      log(`Retention: deleted project ${id} (owner ${project.owner_id}, made ${project.created_at}, due ${project.expires_at}), ${removed} of ${files.length} files removed${finished === false ? '; the row was already gone' : ''}`);
    } catch (error) {
      const message = String((error && error.message) || error).slice(0, 300);
      report.failed.push({ id, error: message, files: removed });
      log(`Retention: could not delete project ${id} yet (${removed} files removed so far): ${message}. It stays for the next sweep.`);
    }
  }
  if (report.due) log(`Retention sweep: ${report.deleted.length} deleted, ${report.failed.length} left for the next sweep.`);
  return report;
}

module.exports = { sweepExpired, BATCH };
