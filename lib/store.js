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

  const seeTech = (user) => Auth.atLeast(user, 'editor');
  const visibleSql = (user) => 'p.deleted_at IS NULL' + (seeTech(user) ? '' : ' AND p.tech_only = 0');

  function audit(user, action, target, detail) {
    db.prepare('INSERT INTO audit_log (at, user_id, user_name, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(Date.now(), user ? user.id : null, user ? user.name : '', action, String(target || ''), String(detail || '').slice(0, 1000));
  }

  // ---------- spaces ----------
  function spaces(user) {
    return db.prepare(`SELECT s.id, s.slug, s.name, s.blurb,
        (SELECT COUNT(*) FROM pages p WHERE p.space_id = s.id AND ${visibleSql(user)}) AS pages
      FROM spaces s ORDER BY s.sort, s.name`).all().map((r) => ({ ...r }));
  }

  function spaceBySlug(slug) {
    return db.prepare('SELECT id, slug, name, blurb FROM spaces WHERE slug = ?').get(String(slug || '')) || null;
  }

  // ---------- pages ----------
  const LIST_COLS = `p.id, p.title, p.tech_only, p.pinned, p.updated_at, p.version,
      s.slug AS space, s.name AS space_name, u.name AS updated_by`;
  const LIST_FROM = 'FROM pages p JOIN spaces s ON s.id = p.space_id LEFT JOIN users u ON u.id = p.updated_by';
  const row = (r) => r && ({ ...r, tech_only: !!r.tech_only, pinned: !!r.pinned });

  function pagesIn(slug, user) {
    const sp = spaceBySlug(slug);
    if (!sp) throw new UserError('No such space', 404);
    const pages = db.prepare(`SELECT ${LIST_COLS} ${LIST_FROM} WHERE p.space_id = ? AND ${visibleSql(user)} ORDER BY p.pinned DESC, p.title COLLATE NOCASE`).all(sp.id).map(row);
    const hidden = seeTech(user) ? 0 : db.prepare('SELECT COUNT(*) n FROM pages WHERE space_id = ? AND deleted_at IS NULL AND tech_only = 1').get(sp.id).n;
    return { space: sp, pages, hidden };
  }

  function home(user) {
    return {
      spaces: spaces(user),
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
    return db.prepare('SELECT id, name, role, created_at, locked_until FROM users ORDER BY name COLLATE NOCASE').all().map((r) => ({ ...r, locked: r.locked_until > Date.now() }));
  }

  function checkUser(data, isNew) {
    const out = {};
    if (isNew || data.name !== undefined) {
      out.name = String(data.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!out.name) throw new UserError('Enter a name');
    }
    if (isNew || data.role !== undefined) {
      if (!Auth.ROLES.includes(data.role)) throw new UserError('Pick a role');
      out.role = data.role;
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
    audit(by, 'user.create', u.name, u.role);
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
    audit(by, 'user.edit', u.name || cur.name, [u.role ? 'role ' + u.role : '', u.pin_hash ? 'PIN changed' : '', data.unlock ? 'unlocked' : ''].filter(Boolean).join(', '));
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
    const id = crypto.randomBytes(12).toString('hex');
    const file = id + '.' + ext;
    fs.writeFileSync(path.join(uploadsDir, file), buf);
    const w = Number(dims && dims.w) || null, h = Number(dims && dims.h) || null;
    db.prepare('INSERT INTO uploads (id, file, mime, bytes, width, height, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, file, mime, buf.length, w, h, user.id, Date.now());
    return { id, width: w, height: h };
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

  function tick(pageId, blockId, item, isDone, user) {
    const { page, b } = findChecklist(pageId, blockId, user);
    if (!b.items.includes(item)) throw new UserError('That step was changed. Reload the page.', 409);
    if (isDone) q.tick.run(page.id, b.id, item, user ? user.name : 'Guest', Date.now());
    else q.untick.run(page.id, b.id, item);
    return checklistInfo(page.id, b);
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
  function todo(user, now = Date.now()) {
    const rows = db.prepare(`SELECT p.id, p.title, p.blocks FROM pages p WHERE ${visibleSql(user)} AND p.blocks LIKE '%"reset":"%'`).all();
    const out = [];
    for (const r of rows) {
      for (const b of JSON.parse(r.blocks)) {
        if (b.type !== 'checklist' || !b.id || !(b.schedule || []).length) continue;
        const info = checklistInfo(r.id, b, now);
        if (!info.active) continue;
        const doneAt = info.items.reduce((m, i) => (i.done && i.at > m ? i.at : m), 0);
        const lastBy = (info.items.find((i) => i.done && i.at === doneAt) || {}).by || '';
        out.push({ page_id: r.id, page_title: r.title, block_id: b.id, title: b.title || 'Checklist', left: info.left, total: info.total,
          complete: info.total > 0 && info.left === 0, completedAt: info.left === 0 ? doneAt : null, completedBy: info.left === 0 ? lastBy : '',
          dueAt: info.dueAt, overdue: info.overdue, runStart: info.runStart, activeUntil: info.activeUntil,
          items_left: info.items.filter((i) => !i.done).map((i) => i.text) });
      }
    }
    // overdue first, then open ones by due time, finished ones last
    return out.sort((a, b) => (b.overdue - a.overdue) || (a.complete - b.complete) || ((a.dueAt || Infinity) - (b.dueAt || Infinity)) || a.title.localeCompare(b.title));
  }
  const overdue = (user, now) => todo(user, now).filter((t) => t.overdue);

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
    versions, version, restoreVersion, search, users, createUser, updateUser, deleteUser, saveUpload, upload, activity, stats,
    checklists, tick, resetChecklist, todo, overdue, wasNoticed, markNoticed, getSetting, setSetting
  };
}

module.exports = { create, UserError, MAX_IMAGE };
