/*
 * The stage patch: one drawing for the whole system (gear and cables), stored as one document
 * with every saved version kept (the newest 200). See public/patchcore.js for what is in it.
 */
'use strict';

const PatchCore = require('../public/patchcore');

const KEEP = 200;

function create(db, { UserError, audit }) {
  const row = () => db.prepare('SELECT p.doc, p.version, p.updated_at, u.name AS updated_by FROM patch p LEFT JOIN users u ON u.id = p.updated_by WHERE p.id = 1').get();

  function get() {
    const r = row();
    if (!r) return { doc: PatchCore.clean({}), version: 0, updated_at: 0, updated_by: '' };
    return { doc: JSON.parse(r.doc), version: r.version, updated_at: r.updated_at, updated_by: r.updated_by || '' };
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
      db.prepare('INSERT INTO patch_versions (version, doc, saved_by, saved_at, note) VALUES (?, ?, ?, ?, ?)').run(v, json, by, now, String(note || '').slice(0, 200));
      db.prepare('DELETE FROM patch_versions WHERE version <= ?').run(v - KEEP);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    // one activity line per few minutes of editing, not one per click
    const last = db.prepare("SELECT at FROM audit_log WHERE action = 'patch.edit' AND user_id IS ? ORDER BY id DESC LIMIT 1").get(by);
    if (!last || now - last.at > 10 * 60000 || note) audit(user, 'patch.edit', 'Stage patch', note || 'version ' + v);
    return { version: v, doc: clean };
  }

  function versions() {
    return db.prepare('SELECT v.version, v.saved_at, v.note, u.name AS saved_by, length(v.doc) AS bytes FROM patch_versions v LEFT JOIN users u ON u.id = v.saved_by ORDER BY v.version DESC LIMIT 100').all();
  }
  function version(v) {
    const r = db.prepare('SELECT doc FROM patch_versions WHERE version = ?').get(Number(v));
    if (!r) throw new UserError('That version is no longer kept', 404);
    return JSON.parse(r.doc);
  }
  function restore(v, user) { return save(version(v), user, null, 'Restored version ' + v); }

  /** Gear on the patch matching a search. */
  function search(q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return get().doc.gear.filter((g) => { const t = PatchCore.searchText(g).toLowerCase(); return words.every((w) => t.includes(w)); })
      .slice(0, 12).map((g) => ({ id: g.id, name: g.name, kind: PatchCore.KINDS[g.kind].label, use: g.use || '', model: g.model || '', freq: g.freq || '' }));
  }
  /** Device ids that appear on the patch. */
  function deviceIds() { return new Set(get().doc.gear.map((g) => g.device_id).filter(Boolean)); }

  return { get, save, versions, version, restore, search, deviceIds };
}

module.exports = { create };
