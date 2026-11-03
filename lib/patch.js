/*
 * The stage patch: one drawing for the whole system (gear and cables), stored as one document
 * with every saved version kept (the newest 200). See public/patchcore.js for what is in it.
 */
'use strict';

const PatchCore = require('../public/patchcore');

const KEEP = 200;
/** Autosaves by the same person this close together are one draft in the history. */
const SESSION_MS = 30 * 60000;
const LEVELS = ['patch', 'minor', 'major'];
/** The next revision number: 1.2.3 → patch 1.2.4, minor 1.3.0, major 2.0.0. Nothing yet → 1.0.0. */
function bump(rev, level) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(rev || ''));
  if (!m) return '1.0.0';
  const [M, n, p] = m.slice(1).map(Number);
  return level === 'major' ? (M + 1) + '.0.0' : level === 'minor' ? M + '.' + (n + 1) + '.0' : M + '.' + n + '.' + (p + 1);
}

function create(db, { UserError, audit }) {
  const row = () => db.prepare('SELECT p.doc, p.version, p.rev, p.updated_at, u.name AS updated_by FROM patch p LEFT JOIN users u ON u.id = p.updated_by WHERE p.id = 1').get();

  function get() {
    const r = row();
    if (!r) return { doc: PatchCore.clean({}), version: 0, rev: '', draft: false, updated_at: 0, updated_by: '' };
    // a draft: saved since the last revision was published
    const top = db.prepare('SELECT kind FROM patch_versions ORDER BY version DESC LIMIT 1').get();
    return { doc: JSON.parse(r.doc), version: r.version, rev: r.rev || '', draft: !!(top && top.kind === 'auto'), updated_at: r.updated_at, updated_by: r.updated_by || '' };
  }

  /** Save a new version. baseVersion guards against two people saving over each other. */
  function save(doc, user, baseVersion, note) {
    const cur = get();
    if (baseVersion !== undefined && baseVersion !== null && Number(baseVersion) !== cur.version) {
      throw new UserError('Someone else' + (cur.updated_by ? ' (' + cur.updated_by + ')' : '') + ' changed the stage patch. It has been reloaded with their changes.', 409);
    }
    const clean = PatchCore.clean(doc);
    const json = JSON.stringify(clean);
    const v = cur.version + 1, now = Date.now(), by = user && user.id ? user.id : null;
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO patch (id, doc, version, updated_by, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, version = excluded.version, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
        .run(json, v, by, now);
      // keep one draft per editing session: the newest autosave by the same person, not yet published, is replaced
      const prev = db.prepare('SELECT version, saved_by, saved_at, kind, note FROM patch_versions ORDER BY version DESC LIMIT 1').get();
      if (!note && prev && prev.kind === 'auto' && !prev.note && prev.saved_by === by && now - prev.saved_at < SESSION_MS) db.prepare('DELETE FROM patch_versions WHERE version = ?').run(prev.version);
      db.prepare("INSERT INTO patch_versions (version, doc, saved_by, saved_at, note, kind) VALUES (?, ?, ?, ?, ?, 'auto')").run(v, json, by, now, String(note || '').slice(0, 200));
      // published revisions are kept for good; only old autosaves beyond the newest KEEP go
      db.prepare("DELETE FROM patch_versions WHERE kind = 'auto' AND version NOT IN (SELECT version FROM patch_versions ORDER BY version DESC LIMIT ?)").run(KEEP);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    // one activity line per few minutes of editing, not one per click
    const last = db.prepare("SELECT at FROM audit_log WHERE action = 'patch.edit' AND user_id IS ? ORDER BY id DESC LIMIT 1").get(by);
    if (!last || now - last.at > 10 * 60000 || note) audit(user, 'patch.edit', 'Stage patch', note || 'version ' + v);
    return { version: v, doc: clean };
  }

  function versions() {
    return db.prepare('SELECT v.version, v.saved_at, v.note, v.rev, v.kind, u.name AS saved_by, length(v.doc) AS bytes FROM patch_versions v LEFT JOIN users u ON u.id = v.saved_by ORDER BY v.version DESC LIMIT 200').all();
  }

  /**
   * Publish the drawing as a revision: patch (small fixes), minor (changes to the setup) or major (a new layout).
   * Marks the newest save with its number, like 1.2.0. Nothing new since the last revision: refused.
   */
  function publish(level, note, user) {
    if (!LEVELS.includes(level)) throw new UserError('Pick patch, minor or major');
    const top = db.prepare('SELECT version, kind FROM patch_versions ORDER BY version DESC LIMIT 1').get();
    if (!top) throw new UserError('Nothing to publish yet');
    if (top.kind !== 'auto') throw new UserError('No changes since revision ' + get().rev);
    const rev = bump(get().rev, level);
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE patch_versions SET rev = ?, kind = ?, note = ? WHERE version = ?').run(rev, level, String(note || '').slice(0, 200), top.version);
      db.prepare('UPDATE patch SET rev = ? WHERE id = 1').run(rev);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(user, 'patch.publish', 'Stage patch', 'Revision ' + rev + (note ? ': ' + note : ''));
    return { rev, version: top.version };
  }
  function version(v) {
    const r = db.prepare('SELECT doc FROM patch_versions WHERE version = ?').get(Number(v));
    if (!r) throw new UserError('That version is no longer kept', 404);
    return JSON.parse(r.doc);
  }
  function restore(v, user) {
    const r = db.prepare('SELECT rev FROM patch_versions WHERE version = ?').get(Number(v));
    return save(version(v), user, null, 'Restored ' + (r && r.rev ? 'revision ' + r.rev : 'a save from earlier'));
  }

  /** Gear on the patch matching a search. */
  function search(q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return get().doc.gear.filter((g) => { const t = PatchCore.searchText(g).toLowerCase(); return words.every((w) => t.includes(w)); })
      .slice(0, 12).map((g) => ({ id: g.id, name: g.name, kind: PatchCore.KINDS[g.kind].label, use: g.use || '', model: g.model || '', freq: g.freq || '' }));
  }
  /** Device ids that appear on the patch. */
  function deviceIds() { return new Set(get().doc.gear.map((g) => g.device_id).filter(Boolean)); }

  return { get, save, versions, version, restore, publish, search, deviceIds };
}

module.exports = { create, bump };
