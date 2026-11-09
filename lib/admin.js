/*
 * The admin side of LiveGenie: spaces (made and named by the admin), church name and logo,
 * manuals and other documents on device cards, problem reports from users, the checklist log,
 * and resetting LiveGenie to a clean state (after an automatic backup).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COLORS = ['#2ec4b6', '#4c8dff', '#f2c94c', '#8b6cff', '#3ecf6e', '#ef8a3c', '#ec6aa8', '#ef4c4c', '#8a96a5'];
const MAX_FILE = 60 * 1024 * 1024;
const DOC_TYPES = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/plain': 'txt',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip', 'application/octet-stream': 'bin'
};
const EXT_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip' };

function create(db, { UserError, audit, dataDir, getSetting, setSetting }) {
  const uploadsDir = path.join(dataDir, 'uploads');

  // ---------- spaces ----------
  const slugify = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'space';
  function uniqueSlug(name, exceptId) {
    const base = slugify(name);
    let slug = base;
    for (let i = 2; db.prepare('SELECT 1 FROM spaces WHERE slug = ? AND id != ?').get(slug, exceptId || 0); i++) slug = base + '-' + i;
    return slug;
  }
  function checkSpace(d) {
    const name = String(d.name || '').trim().slice(0, 60);
    if (!name) throw new UserError('Give the space a name');
    const color = /^#[0-9a-f]{6}$/i.test(String(d.color || '')) ? d.color : null;
    return { name, blurb: String(d.blurb || '').trim().slice(0, 200), color, admin_only: d.admin_only ? 1 : 0 };
  }
  function spaceBy(slug) {
    const s = db.prepare('SELECT * FROM spaces WHERE slug = ?').get(String(slug || ''));
    if (!s) throw new UserError('No such space', 404);
    return s;
  }
  function addSpace(d, user) {
    const s = checkSpace(d);
    if (db.prepare('SELECT 1 FROM spaces WHERE name = ? COLLATE NOCASE').get(s.name)) throw new UserError('There is already a space called ' + s.name);
    const used = db.prepare('SELECT color FROM spaces').all().map((r) => r.color);
    const color = s.color || COLORS.find((c) => !used.includes(c)) || COLORS[0];
    const sort = (db.prepare('SELECT MAX(sort) m FROM spaces').get().m || 0) + 1;
    const slug = uniqueSlug(s.name);
    db.prepare('INSERT INTO spaces (slug, name, blurb, sort, color, admin_only) VALUES (?, ?, ?, ?, ?, ?)').run(slug, s.name, s.blurb, sort, color, s.admin_only);
    audit(user, 'space.create', s.name, s.admin_only ? 'admins only' : '');
    return slug;
  }
  function editSpace(slug, d, user) {
    const cur = spaceBy(slug);
    const s = checkSpace({ ...cur, ...d, admin_only: d.admin_only !== undefined ? d.admin_only : cur.admin_only });
    if (db.prepare('SELECT 1 FROM spaces WHERE name = ? COLLATE NOCASE AND id != ?').get(s.name, cur.id)) throw new UserError('There is already a space called ' + s.name);
    db.prepare('UPDATE spaces SET name = ?, blurb = ?, color = ?, admin_only = ? WHERE id = ?').run(s.name, s.blurb, s.color || cur.color, s.admin_only, cur.id);
    audit(user, 'space.edit', s.name, s.admin_only ? 'admins only' : 'everyone');
    return cur.slug;
  }
  function orderSpaces(slugs, user) {
    const put = db.prepare('UPDATE spaces SET sort = ? WHERE slug = ?');
    (Array.isArray(slugs) ? slugs : []).forEach((sl, i) => put.run(i + 1, String(sl)));
    audit(user, 'space.order', '', '');
  }
  /** Remove a space. Its pages (and any in the trash) move to another space first, or there must be none. */
  function removeSpace(slug, moveTo, user) {
    const cur = spaceBy(slug);
    const n = db.prepare('SELECT COUNT(*) n FROM pages WHERE space_id = ?').get(cur.id).n;
    if (n) {
      if (!moveTo) throw new UserError('This space has ' + n + ' page' + (n === 1 ? '' : 's') + ' (counting the trash). Pick a space to move ' + (n === 1 ? 'it' : 'them') + ' to.', 409, { pages: n });
      const to = spaceBy(moveTo);
      if (to.id === cur.id) throw new UserError('Pick a different space');
      db.prepare('UPDATE pages SET space_id = ? WHERE space_id = ?').run(to.id, cur.id);
      db.prepare('UPDATE page_versions SET space_id = ? WHERE space_id = ?').run(to.id, cur.id);
    }
    db.prepare('UPDATE page_versions SET space_id = (SELECT space_id FROM pages WHERE pages.id = page_versions.page_id) WHERE space_id = ?').run(cur.id);
    db.prepare('DELETE FROM spaces WHERE id = ?').run(cur.id);
    audit(user, 'space.delete', cur.name, n ? n + ' pages moved to ' + moveTo : '');
  }

  // ---------- church name and logo ----------
  function org() { return { name: getSetting('org_name', ''), logo: getSetting('org_logo', '') }; }
  function setOrg(d, user) {
    if (d.name !== undefined) setSetting('org_name', String(d.name || '').trim().slice(0, 80));
    if (d.logo !== undefined) {
      const id = String(d.logo || '');
      if (id && !db.prepare('SELECT 1 FROM uploads WHERE id = ?').get(id)) throw new UserError('That picture is missing; upload it again');
      setSetting('org_logo', id);
    }
    audit(user, 'org.edit', getSetting('org_name', ''), '');
    return org();
  }

  // ---------- manuals and documents on device cards ----------
  function addFile(deviceId, buf, mime, fileName, user) {
    if (!db.prepare('SELECT 1 FROM devices WHERE id = ?').get(Number(deviceId))) throw new UserError('No such device', 404);
    if (!buf.length) throw new UserError('The file is empty');
    if (buf.length > MAX_FILE) throw new UserError('That file is too large (60 MB at most)', 413);
    let name = String(fileName || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 140) || 'Document';
    const extOf = (n) => (/\.([a-z0-9]{1,5})$/i.exec(n) || [])[1];
    let type = String(mime || '').split(';')[0].trim().toLowerCase();
    if (!DOC_TYPES[type] || type === 'application/octet-stream') type = EXT_TYPES[(extOf(name) || '').toLowerCase()] || type;
    const ext = DOC_TYPES[type];
    if (!ext || ext === 'bin') throw new UserError('Upload a PDF, picture, text, Word, Excel or zip file', 415);
    if (type === 'application/pdf' && buf.slice(0, 5).toString('latin1') !== '%PDF-') throw new UserError('That does not look like a PDF', 415);
    if (!extOf(name)) name += '.' + ext;
    const id = crypto.randomBytes(12).toString('hex');
    const file = 'doc-' + id + '.' + ext;
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, file), buf);
    db.prepare('INSERT INTO files (id, device_id, name, file, mime, bytes, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, Number(deviceId), name, file, type, buf.length, user.id, Date.now());
    const dev = db.prepare('SELECT name FROM devices WHERE id = ?').get(Number(deviceId));
    audit(user, 'file.upload', dev.name, name);
    return { id, name, mime: type, bytes: buf.length };
  }
  function filesFor(deviceId) {
    return db.prepare('SELECT f.id, f.name, f.mime, f.bytes, f.uploaded_at, u.name AS uploaded_by FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.device_id = ? ORDER BY f.name COLLATE NOCASE').all(Number(deviceId));
  }
  /**
   * Manuals a card can use without its own copy: the card it is set to share with ("same manuals as"), and other cards
   * of the same make and model. [{ from: {id, name, model}, why: 'chosen'|'model', files, manual_url }]
   */
  function sharedFiles(deviceId) {
    const d = db.prepare('SELECT id, make, model, manual_from FROM devices WHERE id = ?').get(Number(deviceId));
    if (!d) return [];
    const out = [], seen = new Set([d.id]);
    const add = (row, why) => { if (!row || seen.has(row.id)) return; seen.add(row.id); const files = filesFor(row.id); if (files.length || row.manual_url) out.push({ from: { id: row.id, name: row.name, model: row.model || '' }, why, files, manual_url: row.manual_url || '' }); };
    if (d.manual_from) add(db.prepare('SELECT id, name, model, manual_url FROM devices WHERE id = ?').get(d.manual_from), 'chosen');
    if (d.make && d.model) db.prepare('SELECT id, name, model, manual_url FROM devices WHERE id != ? AND make = ? COLLATE NOCASE AND model = ? COLLATE NOCASE ORDER BY name').all(d.id, d.make, d.model).forEach((r) => add(r, 'model'));
    return out;
  }
  /** How many manuals each card can see through sharing (for the Gear Locker list and Gear check). */
  function sharedCounts() {
    const own = fileCounts(), out = new Map();
    const devs = db.prepare('SELECT id, make, model, manual_from FROM devices').all();
    const byModel = new Map();
    devs.forEach((d) => { if (d.make && d.model) { const k = d.make.toLowerCase() + '|' + d.model.toLowerCase(); byModel.set(k, (byModel.get(k) || 0) + (own.get(d.id) || 0)); } });
    devs.forEach((d) => {
      let n = d.make && d.model ? (byModel.get(d.make.toLowerCase() + '|' + d.model.toLowerCase()) || 0) - (own.get(d.id) || 0) : 0;
      if (d.manual_from) n += own.get(d.manual_from) || 0;
      if (n) out.set(d.id, n);
    });
    return out;
  }
  function fileCounts() {
    const out = new Map();
    db.prepare('SELECT device_id, COUNT(*) n FROM files GROUP BY device_id').all().forEach((r) => out.set(r.device_id, r.n));
    return out;
  }
  function file(id) {
    const r = db.prepare('SELECT * FROM files WHERE id = ?').get(String(id || ''));
    if (!r) return null;
    return { ...r, path: path.join(uploadsDir, r.file) };
  }
  function removeFile(id, user) {
    const r = file(id);
    if (!r) throw new UserError('That file is already gone', 404);
    db.prepare('DELETE FROM files WHERE id = ?').run(r.id);
    fs.rmSync(r.path, { force: true });
    audit(user, 'file.delete', r.name, '');
  }

  // ---------- problem reports ----------
  function report(d, user) {
    const text = String(d.text || '').trim().slice(0, 2000);
    if (!text) throw new UserError('Say what is wrong');
    const page = d.page_id ? db.prepare('SELECT id, title FROM pages WHERE id = ? AND deleted_at IS NULL').get(Number(d.page_id)) : null;
    const dev = d.device_id ? db.prepare('SELECT id, name FROM devices WHERE id = ?').get(Number(d.device_id)) : null;
    const where = String(d.where || '').trim().slice(0, 200) || (dev ? dev.name : page ? page.title : '');
    const r = db.prepare('INSERT INTO problems (text, where_text, page_id, device_id, gear, created_by, created_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(text, where, page ? page.id : null, dev ? dev.id : null, String(d.gear || '').slice(0, 40), user.id, user.name, Date.now());
    audit(user, 'problem.report', where, text.slice(0, 200));
    return { id: Number(r.lastInsertRowid), text, where, by: user.name };
  }
  function problems(status) {
    const st = status === 'resolved' ? 'resolved' : status === 'all' ? null : 'open';
    return db.prepare('SELECT * FROM problems' + (st ? ' WHERE status = ?' : '') + ' ORDER BY ' + (st === 'resolved' ? 'resolved_at' : 'created_at') + ' DESC LIMIT 300').all(...(st ? [st] : []));
  }
  const problemCount = () => db.prepare("SELECT COUNT(*) n FROM problems WHERE status = 'open'").get().n;
  function updateProblem(id, d, user) {
    const cur = db.prepare('SELECT * FROM problems WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('No such problem report', 404);
    const status = d.status === 'resolved' ? 'resolved' : d.status === 'open' ? 'open' : cur.status;
    const note = d.note !== undefined ? String(d.note || '').trim().slice(0, 1000) : cur.note;
    db.prepare('UPDATE problems SET status = ?, note = ?, resolved_name = ?, resolved_at = ? WHERE id = ?')
      .run(status, note, status === 'resolved' ? user.name : '', status === 'resolved' ? (cur.resolved_at || Date.now()) : null, cur.id);
    if (status !== cur.status) audit(user, status === 'resolved' ? 'problem.resolve' : 'problem.reopen', cur.where_text, cur.text.slice(0, 120));
    return db.prepare('SELECT * FROM problems WHERE id = ?').get(cur.id);
  }

  // ---------- the checklist log ----------
  /** Every run of every checklist, newest first: who did it, when, how long it took, what was left. */
  function checklistLog(opts = {}) {
    // a run belongs to a to do list (page 0) or, from before 0.20, to a checklist on a page
    const rows = db.prepare(`SELECT r.*, COALESCE(p.title, t.grp, 'To do') AS page_title, COALESCE(p.blocks, CASE WHEN t.id IS NULL THEN '[]' ELSE json_array(json_object('id', t.id, 'title', t.title, 'items', json(t.items))) END) AS blocks
      FROM checklist_runs r LEFT JOIN pages p ON p.id = r.page_id AND r.page_id != 0 LEFT JOIN todo_lists t ON r.page_id = 0 AND t.id = r.block_id
      WHERE ((p.id IS NOT NULL AND p.deleted_at IS NULL) OR t.id IS NOT NULL) ${opts.page != null && opts.page !== '' ? 'AND r.page_id = ? AND r.block_id = ?' : ''} ORDER BY r.run_start DESC LIMIT ?`)
      .all(...(opts.page != null && opts.page !== '' ? [Number(opts.page), String(opts.block || '')] : []), Math.min(500, Number(opts.limit) || 200));
    // a run is over once a newer run of the same checklist exists
    const newest = new Map();
    db.prepare('SELECT page_id, block_id, MAX(run_start) m FROM checklist_runs GROUP BY page_id, block_id').all().forEach((r) => newest.set(r.page_id + ':' + r.block_id, r.m));
    return rows.map((r) => {
      const items = JSON.parse(r.items || '[]');
      const blk = (JSON.parse(r.blocks || '[]').find((b) => b.id === r.block_id) || {});
      const doneSet = new Set(items.map((i) => i.text));
      const missed = (blk.items || []).filter((t) => !doneSet.has(t));
      const over = newest.get(r.page_id + ':' + r.block_id) !== r.run_start;
      return { page_id: r.page_id, page_title: r.page_title, block_id: r.block_id, title: r.title || blk.title || 'Checklist', run_start: r.run_start,
        total: r.total, done: r.done, first_at: r.first_at, last_at: r.last_at, completed_at: r.completed_at, completed_by: r.completed_by,
        people: [...new Set(items.map((i) => i.by).filter(Boolean))], missed: r.completed_at ? [] : missed, over, items };
    });
  }
  function checklistsLogged() {
    return db.prepare(`SELECT DISTINCT r.page_id, r.block_id, COALESCE(t.title, r.title) AS title, COALESCE(p.title, t.grp, 'To do') AS page_title FROM checklist_runs r
      LEFT JOIN pages p ON p.id = r.page_id AND r.page_id != 0 LEFT JOIN todo_lists t ON r.page_id = 0 AND t.id = r.block_id
      WHERE (p.id IS NOT NULL AND p.deleted_at IS NULL) OR t.id IS NOT NULL ORDER BY page_title, title`).all();
  }

  // ---------- reset ----------
  /**
   * mode 'content': pages, spaces, devices, stage patch, IP lists, VLANs, pictures, documents, problems,
   *                 checklist history; people, sign-ins and settings stay.
   * mode 'factory': everything; LiveGenie starts again at the first-run setup.
   * The backups folder is never touched (the caller makes a backup first).
   */
  function reset(mode) {
    const keepLogo = mode === 'content' ? getSetting('org_logo', '') : '';
    const files = db.prepare('SELECT file FROM uploads' + (keepLogo ? ' WHERE id != ?' : '')).all(...(keepLogo ? [keepLogo] : [])).map((r) => r.file)
      .concat(db.prepare('SELECT file FROM files').all().map((r) => r.file));
    db.exec('BEGIN');
    try {
      db.exec(`DELETE FROM checklist_ticks; DELETE FROM checklist_resets; DELETE FROM checklist_notices; DELETE FROM checklist_runs;
        DELETE FROM problems; DELETE FROM files; DELETE FROM page_versions; DELETE FROM pages_fts; DELETE FROM pages; DELETE FROM spaces;
        UPDATE devices SET uplink_id = NULL; DELETE FROM devices; DELETE FROM racks; DELETE FROM vlans; DELETE FROM patch; DELETE FROM patch_versions;`);
      if (keepLogo) db.prepare('DELETE FROM uploads WHERE id != ?').run(keepLogo); else db.exec('DELETE FROM uploads');
      db.exec("DELETE FROM todo_lists; DELETE FROM settings WHERE key IN ('map_layouts', 'todo_groups')");
      if (mode === 'factory') db.exec('DELETE FROM sessions; DELETE FROM users; DELETE FROM settings; DELETE FROM audit_log;');
      // nothing left to convert or seed: keep those one-time jobs from running again
      setSetting('patch_converted_v1', String(Date.now()));
      setSetting('training_audio_v1', 'reset');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    for (const f of files) fs.rmSync(path.join(uploadsDir, f), { force: true });
    db.exec('VACUUM');
  }

  return { COLORS, addSpace, editSpace, orderSpaces, removeSpace, org, setOrg, addFile, filesFor, fileCounts, sharedFiles, sharedCounts, file, removeFile,
    report, problems, problemCount, updateProblem, checklistLog, checklistsLogged, reset };
}

module.exports = { create, MAX_FILE };
