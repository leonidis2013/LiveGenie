/*
 * Everything LiveGenie reads and writes: spaces, pages (with full history),
 * search, users, pictures and the audit log. Who may see what is decided here,
 * so the web API cannot leak a Tech only page by accident.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { tx } = require('./db');
const Blocks = require('./blocks');
const Auth = require('./auth');
const Schedule = require('./schedule');

class UserError extends Error {
  constructor(message, status = 400, extra) { super(message); this.status = status; this.extra = extra; }
}

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_IMAGE = 15 * 1024 * 1024;

function create(db, dataDir) {
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const seeTech = (user) => Auth.atLeast(user, 'admin');
  // users do not see admins-only spaces, or pages marked hidden by an older version (Tech only)
  const visibleSql = (user) => 'p.deleted_at IS NULL' + (seeTech(user) ? '' : ' AND p.tech_only = 0 AND p.space_id NOT IN (SELECT id FROM spaces WHERE admin_only = 1)');

  function audit(user, action, target, detail) {
    db.prepare('INSERT INTO audit_log (at, user_id, user_name, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(Date.now(), user ? user.id : null, user ? user.name : '', action, String(target || ''), String(detail || '').slice(0, 1000));
  }

  // ---------- spaces ----------
  function spaces(user) {
    return db.prepare(`SELECT s.id, s.slug, s.name, s.blurb, s.color, s.admin_only, s.sort,
        (SELECT COUNT(*) FROM pages p WHERE p.space_id = s.id AND ${visibleSql(user)}) AS pages
      FROM spaces s ${seeTech(user) ? '' : 'WHERE s.admin_only = 0'} ORDER BY s.sort, s.name`).all().map((r) => ({ ...r, admin_only: !!r.admin_only }));
  }

  function spaceBySlug(slug) {
    const r = db.prepare('SELECT id, slug, name, blurb, color, admin_only FROM spaces WHERE slug = ?').get(String(slug || ''));
    return r ? { ...r, admin_only: !!r.admin_only } : null;
  }

  // ---------- pages ----------
  const LIST_COLS = `p.id, p.title, p.tech_only, p.pinned, p.updated_at, p.version,
      s.slug AS space, s.name AS space_name, u.name AS updated_by`;
  const LIST_FROM = 'FROM pages p JOIN spaces s ON s.id = p.space_id LEFT JOIN users u ON u.id = p.updated_by';
  const row = (r) => r && ({ ...r, tech_only: !!r.tech_only, pinned: !!r.pinned });

  function pagesIn(slug, user) {
    const sp = spaceBySlug(slug);
    if (!sp || (sp.admin_only && !seeTech(user))) throw new UserError('No such space', 404);
    const pages = db.prepare(`SELECT ${LIST_COLS} ${LIST_FROM} WHERE p.space_id = ? AND ${visibleSql(user)} ORDER BY p.pinned DESC, p.title COLLATE NOCASE`).all(sp.id).map(row);
    const hidden = seeTech(user) ? 0 : db.prepare('SELECT COUNT(*) n FROM pages WHERE space_id = ? AND deleted_at IS NULL AND tech_only = 1').get(sp.id).n;
    return { space: sp, pages, hidden };
  }

  function home(user) {
    // each space with its newest page, for the home page
    const latest = db.prepare(`SELECT ${LIST_COLS} ${LIST_FROM} WHERE s.slug = ? AND ${visibleSql(user)} ORDER BY p.updated_at DESC LIMIT 1`);
    return {
      spaces: spaces(user).map((sp) => { const l = latest.get(sp.slug); return { ...sp, latest: l ? { id: l.id, title: l.title, updated_at: l.updated_at } : null }; }),
      pinned: db.prepare(`SELECT ${LIST_COLS} ${LIST_FROM} WHERE p.pinned = 1 AND ${visibleSql(user)} ORDER BY p.title COLLATE NOCASE LIMIT 24`).all().map(row),
      recent: db.prepare(`SELECT ${LIST_COLS} ${LIST_FROM} WHERE ${visibleSql(user)} ORDER BY p.updated_at DESC LIMIT 12`).all().map(row)
    };
  }

  function getPage(id, user) {
    const r = db.prepare(`SELECT p.*, s.slug AS space, s.name AS space_name, u.name AS updated_by_name, c.name AS created_by_name
        FROM pages p JOIN spaces s ON s.id = p.space_id
        LEFT JOIN users u ON u.id = p.updated_by LEFT JOIN users c ON c.id = p.created_by
        WHERE p.id = ? AND ${visibleSql(user)}`).get(Number(id));
    if (!r) return null;
    return {
      id: r.id, title: r.title, space: r.space, space_name: r.space_name,
      blocks: JSON.parse(r.blocks), tech_only: !!r.tech_only, pinned: !!r.pinned,
      version: r.version, created_at: r.created_at, created_by: r.created_by_name,
      updated_at: r.updated_at, updated_by: r.updated_by_name
    };
  }

  function checkInput(data) {
    const title = String(data.title || '').trim().slice(0, 200);
    if (!title) throw new UserError('Give the page a title');
    const sp = spaceBySlug(data.space);
    if (!sp) throw new UserError('Pick a space for the page');
    const c = Blocks.clean(data.blocks || []);
    if (c.error) throw new UserError(c.error);
    for (const id of Blocks.uploadsIn(c.blocks)) {
      if (!db.prepare('SELECT 1 FROM uploads WHERE id = ?').get(id)) throw new UserError('A picture on this page is missing; add it again');
    }
    return { title, space_id: sp.id, blocks: c.blocks, tech_only: data.tech_only ? 1 : 0, pinned: data.pinned ? 1 : 0 };
  }

  function index(id, title, blocks) {
    db.prepare('DELETE FROM pages_fts WHERE rowid = ?').run(id);
    db.prepare('INSERT INTO pages_fts (rowid, title, body) VALUES (?, ?, ?)').run(id, title, Blocks.plainText(blocks));
  }

  function snapshot(id, version, p, user, note) {
    db.prepare(`INSERT INTO page_versions (page_id, version, title, blocks, tech_only, space_id, saved_by, saved_at, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, version, p.title, JSON.stringify(p.blocks), p.tech_only, p.space_id, user.id, Date.now(), note || '');
  }

  function createPage(data, user) {
    const p = checkInput(data);
    return tx(db, () => {
      const now = Date.now();
      const r = db.prepare(`INSERT INTO pages (space_id, title, blocks, tech_only, pinned, version, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(p.space_id, p.title, JSON.stringify(p.blocks), p.tech_only, p.pinned, user.id, user.id, now, now);
      const id = Number(r.lastInsertRowid);
      snapshot(id, 1, p, user, 'Created');
      index(id, p.title, p.blocks);
      audit(user, 'page.create', id, p.title);
      return id;
    });
  }

  function updatePage(id, data, user, note) {
    const cur = db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL').get(Number(id));
    if (!cur) throw new UserError('That page no longer exists', 404);
    if (data.baseVersion !== undefined && Number(data.baseVersion) !== cur.version) {
      const by = cur.updated_by ? (db.prepare('SELECT name FROM users WHERE id = ?').get(cur.updated_by) || {}).name : '';
      throw new UserError('Someone else saved this page while you were editing' + (by ? ' (' + by + ')' : '') + '. Copy your changes, reload the page and edit again.', 409);
    }
    const p = checkInput(data);
    return tx(db, () => {
      const v = cur.version + 1;
      db.prepare(`UPDATE pages SET space_id = ?, title = ?, blocks = ?, tech_only = ?, pinned = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
        .run(p.space_id, p.title, JSON.stringify(p.blocks), p.tech_only, p.pinned, v, user.id, Date.now(), cur.id);
      snapshot(cur.id, v, p, user, note || '');
      index(cur.id, p.title, p.blocks);
      audit(user, 'page.edit', cur.id, p.title + ' (v' + v + ')');
      return v;
    });
  }

  function deletePage(id, user) {
    const cur = db.prepare('SELECT id, title FROM pages WHERE id = ? AND deleted_at IS NULL').get(Number(id));
    if (!cur) throw new UserError('That page no longer exists', 404);
    tx(db, () => {
      db.prepare('UPDATE pages SET deleted_at = ?, updated_by = ? WHERE id = ?').run(Date.now(), user.id, cur.id);
      db.prepare('DELETE FROM pages_fts WHERE rowid = ?').run(cur.id);
      audit(user, 'page.delete', cur.id, cur.title);
    });
  }

  function trash() {
    return db.prepare(`SELECT p.id, p.title, p.deleted_at, s.name AS space_name, u.name AS deleted_by
      FROM pages p JOIN spaces s ON s.id = p.space_id LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC LIMIT 200`).all().map((r) => ({ ...r }));
  }

  function undelete(id, user) {
    const cur = db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NOT NULL').get(Number(id));
    if (!cur) throw new UserError('That page is not in the trash', 404);
    tx(db, () => {
      db.prepare('UPDATE pages SET deleted_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?').run(user.id, Date.now(), cur.id);
      index(cur.id, cur.title, JSON.parse(cur.blocks));
      audit(user, 'page.undelete', cur.id, cur.title);
    });
  }

  function versions(id, user) {
    if (!getPage(id, user)) throw new UserError('No such page', 404);
    return db.prepare(`SELECT v.version, v.title, v.saved_at, v.note, u.name AS saved_by
      FROM page_versions v LEFT JOIN users u ON u.id = v.saved_by WHERE v.page_id = ? ORDER BY v.version DESC`).all(Number(id)).map((r) => ({ ...r }));
  }

  function version(id, v, user) {
    if (!getPage(id, user)) throw new UserError('No such page', 404);
    const r = db.prepare(`SELECT v.*, u.name AS saved_by_name, s.slug AS space FROM page_versions v
      JOIN spaces s ON s.id = v.space_id LEFT JOIN users u ON u.id = v.saved_by WHERE v.page_id = ? AND v.version = ?`).get(Number(id), Number(v));
    if (!r) throw new UserError('No such version', 404);
    return { version: r.version, title: r.title, blocks: JSON.parse(r.blocks), tech_only: !!r.tech_only, space: r.space, saved_at: r.saved_at, saved_by: r.saved_by_name, note: r.note };
  }

  function restoreVersion(id, v, user) {
    const old = version(id, v, user);
    const cur = getPage(id, user);
    const missing = Blocks.uploadsIn(old.blocks).filter((u) => !db.prepare('SELECT 1 FROM uploads WHERE id = ?').get(u));
    const blocks = old.blocks.filter((b) => b.type !== 'image' || !missing.includes(b.upload));
    return updatePage(id, { title: old.title, space: old.space, blocks, tech_only: old.tech_only, pinned: cur.pinned }, user, 'Restored version ' + v);
  }

  // ---------- search ----------
  function search(q, user, limit = 30) {
    const words = String(q || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (!words.length) return [];
    const match = words.slice(0, 12).map((w) => '"' + w + '"*').join(' ');
    return db.prepare(`SELECT p.id, p.title, p.tech_only, s.slug AS space, s.name AS space_name, p.updated_at,
        snippet(pages_fts, 1, '\u0001', '\u0002', '…', 14) AS snip
      FROM pages_fts JOIN pages p ON p.id = pages_fts.rowid JOIN spaces s ON s.id = p.space_id
      WHERE pages_fts MATCH ? AND ${visibleSql(user)}
      ORDER BY bm25(pages_fts, 8.0, 1.0) LIMIT ?`).all(match, limit).map((r) => ({ ...r, tech_only: !!r.tech_only }));
  }

  // ---------- users ----------
  function users() {
    return db.prepare('SELECT id, name, role, created_at, locked_until FROM users ORDER BY name COLLATE NOCASE').all().map((r) => ({ ...r, role: Auth.fromDb(r.role), locked: r.locked_until > Date.now() }));
  }

  function checkUser(data, isNew) {
    const out = {};
    if (isNew || data.name !== undefined) {
      out.name = String(data.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!out.name) throw new UserError('Enter a name');
    }
    if (isNew || data.role !== undefined) {
      const role = Auth.normalRole(data.role);
      if (!role) throw new UserError('Pick a role');
      out.role = Auth.toDb(role);
    }
    if (isNew || (data.pin !== undefined && data.pin !== '')) {
      if (!Auth.validPin(data.pin)) throw new UserError('The PIN must be 4 to 8 digits');
      out.pin_hash = Auth.hashPin(data.pin);
    }
    return out;
  }

  function adminCount(exceptId) {
    return db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND id != ?").get(exceptId || 0).n;
  }

  function createUser(data, by) {
    const u = checkUser(data, true);
    if (db.prepare('SELECT 1 FROM users WHERE name = ?').get(u.name)) throw new UserError('Someone already has that name');
    const r = db.prepare('INSERT INTO users (name, role, pin_hash, created_at) VALUES (?, ?, ?, ?)').run(u.name, u.role, u.pin_hash, Date.now());
    audit(by, 'user.create', u.name, Auth.fromDb(u.role));
    return Number(r.lastInsertRowid);
  }

  function updateUser(id, data, by) {
    const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('No such user', 404);
    const u = checkUser(data, false);
    if (u.name && u.name.toLowerCase() !== cur.name.toLowerCase() && db.prepare('SELECT 1 FROM users WHERE name = ?').get(u.name)) throw new UserError('Someone already has that name');
    if (u.role && u.role !== 'admin' && cur.role === 'admin' && adminCount(cur.id) === 0) throw new UserError('LiveGenie needs at least one admin');
    db.prepare(`UPDATE users SET name = ?, role = ?, pin_hash = ?, failed = CASE WHEN ? THEN 0 ELSE failed END,
      locked_until = CASE WHEN ? THEN 0 ELSE locked_until END WHERE id = ?`)
      .run(u.name || cur.name, u.role || cur.role, u.pin_hash || cur.pin_hash, u.pin_hash ? 1 : 0, (u.pin_hash || data.unlock) ? 1 : 0, cur.id);
    audit(by, 'user.edit', u.name || cur.name, [u.role ? 'role ' + Auth.fromDb(u.role) : '', u.pin_hash ? 'PIN changed' : '', data.unlock ? 'unlocked' : ''].filter(Boolean).join(', '));
    return { pinChanged: !!u.pin_hash, roleChanged: !!u.role && u.role !== cur.role };
  }

  function deleteUser(id, by) {
    const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('No such user', 404);
    if (cur.id === by.id) throw new UserError('You cannot remove yourself');
    if (cur.role === 'admin' && adminCount(cur.id) === 0) throw new UserError('LiveGenie needs at least one admin');
    db.prepare('DELETE FROM users WHERE id = ?').run(cur.id);
    audit(by, 'user.delete', cur.name, '');
  }

  // ---------- pictures ----------
  function saveUpload(buf, mime, user, dims) {
    const ext = IMAGE_TYPES[String(mime || '').split(';')[0].trim().toLowerCase()];
    if (!ext) throw new UserError('Pictures must be JPEG, PNG, WebP or GIF', 415);
    if (!buf.length) throw new UserError('The picture is empty');
    if (buf.length > MAX_IMAGE) throw new UserError('That picture is too large (15 MB at most)', 413);
    // the same picture again (the rack photo for the third time): keep the one we have
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const same = db.prepare('SELECT id, width, height, file FROM uploads WHERE sha256 = ?').get(sha);
    if (same && fs.existsSync(path.join(uploadsDir, same.file))) return { id: same.id, width: same.width, height: same.height, reused: true };
    // pictures from before fingerprints: check the ones the same size
    for (const r of db.prepare('SELECT id, file, width, height FROM uploads WHERE sha256 IS NULL AND bytes = ?').all(buf.length)) {
      try {
        const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(uploadsDir, r.file))).digest('hex');
        db.prepare('UPDATE uploads SET sha256 = ? WHERE id = ?').run(h, r.id);
        if (h === sha) return { id: r.id, width: r.width, height: r.height, reused: true };
      } catch (e) { /* the file is gone; ignore it */ }
    }
    const id = crypto.randomBytes(12).toString('hex');
    const file = id + '.' + ext;
    fs.writeFileSync(path.join(uploadsDir, file), buf);
    const w = Number(dims && dims.w) || null, h = Number(dims && dims.h) || null;
    db.prepare('INSERT INTO uploads (id, file, mime, bytes, width, height, uploaded_by, uploaded_at, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, file, mime, buf.length, w, h, user.id, Date.now(), sha);
    return { id, width: w, height: h };
  }

  /**
   * Where each picture is used: pages (and their older versions and the trash), Gear Locker photos, racks, the church logo.
   * A picture listed here is never removed as unused.
   */
  function uploadUses() {
    const uses = new Map();
    const add = (id, what) => { if (!id) return; if (!uses.has(id)) uses.set(id, []); const l = uses.get(id); if (!l.includes(what) && l.length < 20) l.push(what); };
    const blocksOf = (v) => { try { return JSON.parse(v || '[]'); } catch (e) { return []; } };
    for (const p of db.prepare('SELECT id, title, blocks, deleted_at FROM pages').all()) for (const u of Blocks.uploadsIn(blocksOf(p.blocks))) add(u, (p.deleted_at ? 'Trash: ' : 'Page: ') + p.title);
    for (const v of db.prepare('SELECT p.title, v.blocks FROM page_versions v JOIN pages p ON p.id = v.page_id').all()) for (const u of Blocks.uploadsIn(blocksOf(v.blocks))) add(u, 'Earlier version of ' + v.title);
    for (const d of db.prepare('SELECT name, photo FROM devices WHERE photo IS NOT NULL AND photo != \'\'').all()) add(d.photo, 'Gear: ' + d.name);
    try { for (const r of db.prepare('SELECT name, photo FROM racks WHERE photo IS NOT NULL').all()) add(r.photo, 'Rack: ' + r.name); } catch (e) { /* before racks */ }
    try { for (const r of db.prepare('SELECT name, photo FROM rooms WHERE photo IS NOT NULL').all()) add(r.photo, 'Room: ' + r.name); } catch (e) { /* before rooms */ }
    add(getSetting('org_logo', ''), 'Church logo');
    return uses;
  }
  /** Every picture, newest first, with its size and where it is used. */
  function uploads() {
    const uses = uploadUses();
    return db.prepare('SELECT u.id, u.mime, u.bytes, u.width, u.height, u.uploaded_at, us.name AS uploaded_by FROM uploads u LEFT JOIN users us ON us.id = u.uploaded_by ORDER BY u.uploaded_at DESC').all()
      .map((r) => ({ ...r, uses: uses.get(r.id) || [] }));
  }
  /** How much space pictures and documents take. */
  function storage() {
    const list = uploads();
    const files = db.prepare('SELECT f.id, f.name, f.bytes, d.name AS device FROM files f LEFT JOIN devices d ON d.id = f.device_id ORDER BY f.bytes DESC').all();
    const unused = list.filter((u) => !u.uses.length);
    return {
      pictures: { count: list.length, bytes: list.reduce((n, u) => n + u.bytes, 0) },
      files: { count: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) },
      unused: { count: unused.length, bytes: unused.reduce((n, u) => n + u.bytes, 0), list: unused.slice(0, 200) },
      biggest: list.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 12),
      biggestFiles: files.slice(0, 8)
    };
  }
  /** Remove pictures nothing uses (checked again right now). ids: only these, if given. */
  function removeUnused(ids, user) {
    const uses = uploadUses();
    const only = Array.isArray(ids) ? new Set(ids.map(String)) : null;
    let n = 0, bytes = 0;
    for (const r of db.prepare('SELECT id, file, bytes FROM uploads').all()) {
      if (uses.has(r.id) || (only && !only.has(r.id))) continue;
      db.prepare('DELETE FROM uploads WHERE id = ?').run(r.id);
      try { fs.rmSync(path.join(uploadsDir, r.file), { force: true }); } catch (e) { /* already gone */ }
      n++; bytes += r.bytes;
    }
    audit(user, 'uploads.clean', 'Unused pictures', n + ' removed');
    return { removed: n, bytes };
  }

  function upload(id) {
    if (!/^[a-f0-9]{24}$/.test(String(id || ''))) return null;
    const r = db.prepare('SELECT * FROM uploads WHERE id = ?').get(id);
    if (!r) return null;
    return { path: path.join(uploadsDir, r.file), mime: r.mime, bytes: r.bytes };
  }

  // ---------- shared checklists ----------
  const q = {
    reset: db.prepare('SELECT at, by_name FROM checklist_resets WHERE page_id = ? AND block_id = ?'),
    ticks: db.prepare('SELECT item, by_name, at FROM checklist_ticks WHERE page_id = ? AND block_id = ? AND at >= ?'),
    tick: db.prepare('INSERT OR REPLACE INTO checklist_ticks (page_id, block_id, item, by_name, at) VALUES (?, ?, ?, ?, ?)'),
    untick: db.prepare('DELETE FROM checklist_ticks WHERE page_id = ? AND block_id = ? AND item = ?'),
    doReset: db.prepare('INSERT OR REPLACE INTO checklist_resets (page_id, block_id, at, by_name) VALUES (?, ?, ?, ?)'),
    dropOld: db.prepare('DELETE FROM checklist_ticks WHERE page_id = ? AND block_id = ? AND at < ?'),
    noticed: db.prepare('SELECT 1 FROM checklist_notices WHERE page_id = ? AND block_id = ? AND run_start = ?'),
    notice: db.prepare('INSERT OR REPLACE INTO checklist_notices (page_id, block_id, run_start, sent_at, result) VALUES (?, ?, ?, ?, ?)')
  };

  function checklistInfo(pageId, b, now = Date.now()) {
    const reset = q.reset.get(pageId, b.id);
    const st = Schedule.status(b.schedule || [], now, reset ? reset.at : 0);
    const done = new Map(q.ticks.all(pageId, b.id, st.runStart).map((t) => [t.item, t]));
    const items = b.items.map((text) => {
      const t = done.get(text);
      return t ? { text, done: true, by: t.by_name, at: t.at } : { text, done: false };
    });
    const left = items.filter((i) => !i.done).length;
    return {
      id: b.id, title: b.title, total: items.length, left, items,
      runStart: st.runStart, dueAt: st.dueAt, nextReset: st.nextReset,
      active: st.active,
      overdue: !!(st.active && st.dueAt && now >= st.dueAt && left > 0),
      activeUntil: st.activeUntil,
      schedule: (b.schedule || []).map(Schedule.describe),
      lastReset: reset ? { at: reset.at, by: reset.by_name } : null
    };
  }

  function findChecklist(pageId, blockId, user) {
    if (Number(pageId) === 0) {
      // a to do list (they all live on the To do page, "page 0")
      const r = db.prepare('SELECT * FROM todo_lists WHERE id = ?').get(String(blockId));
      if (!r) throw new UserError('That to do list was removed. Reload.', 409);
      return { page: { id: 0, title: r.grp || 'To do' }, b: listOf(r) };
    }
    const page = getPage(pageId, user);
    if (!page) throw new UserError('Page not found', 404);
    const b = page.blocks.find((x) => x.type === 'checklist' && x.id === blockId);
    if (!b) throw new UserError('That checklist was changed. Reload the page.', 409);
    return { page, b };
  }

  function checklists(pageId, user) {
    const page = getPage(pageId, user);
    if (!page) throw new UserError('Page not found', 404);
    return page.blocks.filter((b) => b.type === 'checklist').map((b) => checklistInfo(page.id, b));
  }

  /** Keep a record of this run (the ticks table only holds the current run): the checklist log is made from it. */
  const runPut = db.prepare(`INSERT INTO checklist_runs (page_id, block_id, run_start, title, total, done, items, first_at, last_at, completed_at, completed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(page_id, block_id, run_start) DO UPDATE SET title = excluded.title, total = excluded.total, done = excluded.done,
    items = excluded.items, first_at = excluded.first_at, last_at = excluded.last_at, completed_at = excluded.completed_at, completed_by = excluded.completed_by`);
  const runDrop = db.prepare('DELETE FROM checklist_runs WHERE page_id = ? AND block_id = ? AND run_start = ?');
  function recordRun(pageId, b, info) {
    const done = info.items.filter((i) => i.done);
    if (!done.length) { runDrop.run(pageId, b.id, info.runStart); return; }
    const ats = done.map((i) => i.at), last = Math.max(...ats);
    const complete = info.total > 0 && info.left === 0;
    const lastBy = complete ? (done.find((i) => i.at === last) || {}).by || '' : '';
    runPut.run(pageId, b.id, info.runStart, b.title || '', info.total, done.length, JSON.stringify(done.map((i) => ({ text: i.text, by: i.by, at: i.at }))),
      Math.min(...ats), last, complete ? last : null, lastBy);
  }

  function tick(pageId, blockId, item, isDone, user) {
    const { page, b } = findChecklist(pageId, blockId, user);
    if (!b.items.includes(item)) throw new UserError('That step was changed. Reload the page.', 409);
    if (isDone) q.tick.run(page.id, b.id, item, user ? user.name : 'Guest', Date.now());
    else q.untick.run(page.id, b.id, item);
    const info = checklistInfo(page.id, b);
    try { recordRun(page.id, b, info); } catch (e) { /* the log is a nice-to-have */ }
    return info;
  }

  function resetChecklist(pageId, blockId, user) {
    const { page, b } = findChecklist(pageId, blockId, user);
    const now = Date.now();
    q.doReset.run(page.id, b.id, now, user.name);
    q.dropOld.run(page.id, b.id, now);
    audit(user, 'checklist.reset', page.id, (b.title || 'Checklist') + ' on ' + page.title);
    return checklistInfo(page.id, b, now + 1);
  }

  /**
   * The To do list: scheduled checklists whose run is active and not finished, overdue ones first.
   * user = who is asking (Tech only pages are left out for volunteers and viewers).
   */
  const listOf = (r) => ({ type: 'checklist', id: r.id, title: r.title, items: JSON.parse(r.items || '[]'), schedule: JSON.parse(r.schedule || '[]'), group: r.grp, ord: r.ord });
  /** What shows on To do right now (the home strip, the count, overdue notices). */
  function todo(user, now = Date.now()) {
    // to do lists (page 0), and any checklist still on a page (one restored from the trash)
    const sources = db.prepare('SELECT * FROM todo_lists ORDER BY ord').all().map((r) => ({ page_id: 0, page_title: r.grp || 'To do', b: listOf(r) }));
    if (user) db.prepare(`SELECT p.id, p.title, p.blocks FROM pages p WHERE ${visibleSql(user)} AND p.blocks LIKE '%"checklist"%'`).all()
      .forEach((r) => JSON.parse(r.blocks).forEach((b) => { if (b.type === 'checklist' && b.id) sources.push({ page_id: r.id, page_title: r.title, b }); }));
    const out = [];
    for (const { page_id, page_title, b } of sources) {
      if (!(b.items || []).length) continue;
      const scheduled = !!(b.schedule || []).length;
      const info = checklistInfo(page_id, b, now);
      if (scheduled ? !info.active : !(info.left > 0 && info.left < info.total)) continue;
      const doneAt = info.items.reduce((m, i) => (i.done && i.at > m ? i.at : m), 0);
      const lastBy = (info.items.find((i) => i.done && i.at === doneAt) || {}).by || '';
      out.push({ page_id, page_title, block_id: b.id, title: b.title || 'Checklist', left: info.left, total: info.total, scheduled, lastAt: doneAt || null, lastBy,
        complete: info.total > 0 && info.left === 0, completedAt: info.left === 0 ? doneAt : null, completedBy: info.left === 0 ? lastBy : '',
        dueAt: info.dueAt, overdue: info.overdue, runStart: info.runStart, activeUntil: info.activeUntil,
        items_left: info.items.filter((i) => !i.done).map((i) => i.text) });
    }
    // overdue first, then open ones by due time, finished ones last
    return out.sort((a, b) => (b.overdue - a.overdue) || (a.complete - b.complete) || ((a.dueAt || Infinity) - (b.dueAt || Infinity)) || a.title.localeCompare(b.title));
  }
  const overdue = (user, now) => todo(user, now).filter((t) => t.overdue);

  // ---------- to do lists: one place (the To do page), in groups ----------
  const groupsSetting = () => { try { return JSON.parse(getSetting('todo_groups', '[]')).filter((x) => typeof x === 'string'); } catch (e) { return []; } };
  /** Every to do list in its group (groups in the admin's order), each with where it is right now. */
  function todoLists(now = Date.now()) {
    const rows = db.prepare('SELECT * FROM todo_lists ORDER BY ord, created_at').all();
    const order = groupsSetting();
    rows.forEach((r) => { if (!order.includes(r.grp)) order.push(r.grp); });
    return order.map((name) => ({
      name,
      lists: rows.filter((r) => r.grp === name).map((r) => {
        const b = listOf(r), info = checklistInfo(0, b, now);
        const doneAt = info.items.reduce((m, i) => (i.done && i.at > m ? i.at : m), 0);
        return { ...info, group: r.grp, schedule: b.schedule, scheduleText: info.schedule, items: info.items, steps: b.items,
          lastAt: doneAt || null, lastBy: (info.items.find((i) => i.done && i.at === doneAt) || {}).by || '' };
      })
    }));
  }
  function checkList(data) {
    const title = String(data.title || '').trim().slice(0, 200);
    if (!title) throw new UserError('Give the list a title');
    const items = [...new Set((Array.isArray(data.items) ? data.items : []).map((x) => String(x || '').trim().slice(0, 300)).filter(Boolean))].slice(0, 200);
    if (!items.length) throw new UserError('A list needs at least one step');
    const sc = Schedule.clean(data.schedule || []);
    if (sc.error) throw new UserError(sc.error);
    const grp = String(data.group || '').trim().slice(0, 80);
    return { title, items, schedule: sc.schedule, grp };
  }
  function addList(data, user) {
    const d = checkList(data);
    const id = require('crypto').randomBytes(4).toString('hex');
    const ord = (db.prepare('SELECT MAX(ord) m FROM todo_lists').get().m || 0) + 1;
    const now = Date.now();
    db.prepare('INSERT INTO todo_lists (id, grp, title, items, schedule, ord, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, d.grp, d.title, JSON.stringify(d.items), JSON.stringify(d.schedule), ord, user.id, now, now);
    const g = groupsSetting(); if (!g.includes(d.grp)) { g.push(d.grp); setSetting('todo_groups', JSON.stringify(g)); }
    audit(user, 'todo.create', d.title, d.grp);
    return id;
  }
  function editList(id, data, user) {
    const cur = db.prepare('SELECT * FROM todo_lists WHERE id = ?').get(String(id));
    if (!cur) throw new UserError('That to do list was removed', 404);
    const d = checkList({ title: cur.title, items: JSON.parse(cur.items), schedule: JSON.parse(cur.schedule), group: cur.grp, ...data });
    db.prepare('UPDATE todo_lists SET grp = ?, title = ?, items = ?, schedule = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(d.grp, d.title, JSON.stringify(d.items), JSON.stringify(d.schedule), user.id, Date.now(), cur.id);
    const g = groupsSetting(); if (!g.includes(d.grp)) { g.push(d.grp); setSetting('todo_groups', JSON.stringify(g)); }
    audit(user, 'todo.edit', d.title, d.grp);
  }
  function removeList(id, user) {
    const cur = db.prepare('SELECT title FROM todo_lists WHERE id = ?').get(String(id));
    if (!cur) throw new UserError('That to do list was removed', 404);
    db.prepare('DELETE FROM todo_lists WHERE id = ?').run(String(id));
    for (const t of ['checklist_ticks', 'checklist_resets', 'checklist_notices']) db.prepare('DELETE FROM ' + t + ' WHERE page_id = 0 AND block_id = ?').run(String(id));
    audit(user, 'todo.delete', cur.title, '');
  }
  /** Groups in order (renames move their lists; a removed group's lists go to the first group); lists in order. */
  function arrangeTodo(data, user) {
    const names = [...new Set((Array.isArray(data.groups) ? data.groups : groupsSetting()).map((x) => String(x || '').trim().slice(0, 80)))].slice(0, 60);
    for (const [from, to] of Object.entries(data.renames || {})) db.prepare('UPDATE todo_lists SET grp = ? WHERE grp = ?').run(String(to).trim().slice(0, 80), String(from));
    const keep = new Set(names);
    const home = names[0] != null ? names[0] : '';
    db.prepare('SELECT DISTINCT grp FROM todo_lists').all().forEach((r) => { if (!keep.has(r.grp)) db.prepare('UPDATE todo_lists SET grp = ? WHERE grp = ?').run(home, r.grp); });
    if (!names.length && db.prepare('SELECT 1 FROM todo_lists').get()) names.push('');
    setSetting('todo_groups', JSON.stringify(names));
    if (Array.isArray(data.order)) data.order.forEach((id, i) => db.prepare('UPDATE todo_lists SET ord = ? WHERE id = ?').run(i + 1, String(id)));
    if (data.move && data.move.id) db.prepare('UPDATE todo_lists SET grp = ? WHERE id = ?').run(String(data.move.group || '').slice(0, 80), String(data.move.id));
    audit(user, 'todo.arrange', names.join(', '), '');
    return names;
  }

  const wasNoticed = (n) => !!q.noticed.get(n.page_id, n.block_id, n.runStart);
  const markNoticed = (n, result) => q.notice.run(n.page_id, n.block_id, n.runStart, Date.now(), String(result || '').slice(0, 300));

  // ---------- settings ----------
  function getSetting(key, fallback = '') {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return r ? r.value : fallback;
  }
  function setSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  }

  // ---------- misc ----------
  function activity(limit = 100) {
    return db.prepare('SELECT at, user_name, action, target, detail FROM audit_log ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({ ...r }));
  }

  function stats() {
    return {
      pages: db.prepare('SELECT COUNT(*) n FROM pages WHERE deleted_at IS NULL').get().n,
      pictures: db.prepare('SELECT COUNT(*) n FROM uploads').get().n,
      users: db.prepare('SELECT COUNT(*) n FROM users').get().n
    };
  }

  return {
    audit, spaces, spaceBySlug, pagesIn, home, getPage, createPage, updatePage, deletePage, trash, undelete,
    versions, version, restoreVersion, search, users, createUser, updateUser, deleteUser, saveUpload, upload, uploads, uploadUses, storage, removeUnused, activity, stats,
    checklists, tick, resetChecklist, todo, todoLists, addList, editList, removeList, arrangeTodo, overdue, wasNoticed, markNoticed, getSetting, setSetting
  };
}

module.exports = { create, UserError, MAX_IMAGE };
