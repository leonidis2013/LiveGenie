'use strict';
/**
 * Rooms: a photo of a room (the sanctuary, the booth, the stage) with the gear in it highlighted, each piece in its
 * own four-cornered spot. A card with a quantity (two speakers on one card) can be placed once per piece: PA-L, PA-R.
 * Stage plots: named top-down drawings of the stage (people, instruments, mics, wedges, power), sharing one stage outline.
 */
const RackCore = require('../public/rackcore');
const Auth = require('./auth');

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const parse = (v, d) => { try { return JSON.parse(v); } catch (e) { return d; } };

/** The tag of one piece of a card: its own tag (unit_tags), the run its number implies (MIC-2, MIC-3), or "name #2". */
function pieceTag(card, unit) {
  const tags = parse(card.unit_tags, []) || [];
  unit = Math.max(0, Number(unit) || 0);
  if (Array.isArray(tags) && tags[unit]) return String(tags[unit]);
  if (!unit) return card.name;
  const m = /^(.*\D)(\d+)$/.exec(String(card.name || '').trim());
  return m ? m[1] + (Number(m[2]) + unit) : card.name + ' #' + (unit + 1);
}
/** One spot, cleaned like a rack spot (four corners, inside the photo), or null. */
const cleanSpot = (v) => (v && typeof v === 'object' ? RackCore.cleanSpots({ g1: v }).g1 || null : null);

function create(db, { UserError, audit, uploadExists, getSetting, setSetting }) {
  const seeTech = (user) => Auth.atLeast(user, 'admin');

  const entriesOf = (roomIds, user) => {
    if (!roomIds.length) return [];
    return db.prepare('SELECT g.id, g.room_id, g.device_id, g.unit, g.spot, g.ord, d.name, d.make, d.model, d.kind, d.qty, d.unit_tags, d.notes, d.tech_only FROM room_gear g JOIN devices d ON d.id = g.device_id WHERE g.room_id IN (' + roomIds.map(() => '?').join(',') + ')' + (user && !seeTech(user) ? ' AND d.tech_only = 0' : '') + ' ORDER BY g.ord, g.id')
      .all(...roomIds).map((r) => ({ id: r.id, room_id: r.room_id, device_id: r.device_id, unit: r.unit, tag: pieceTag(r, r.unit), name: r.name, make: r.make || '', model: r.model || '', kind: r.kind || '', qty: r.qty || 1, note: String(r.notes || '').split('\n').map((x) => x.replace(/[#*_`>]/g, '').trim()).find(Boolean) || '', spot: cleanSpot(parse(r.spot, null)) }));
  };
  const toRoom = (r) => ({ id: r.id, name: r.name, photo: r.photo || '', notes: r.notes || '', updated_at: r.updated_at });

  /** Every room with its gear (small: a handful of rooms), so any page can find a card's spot. */
  function list(user) {
    const rooms = db.prepare('SELECT * FROM rooms ORDER BY name COLLATE NOCASE').all().map(toRoom);
    const all = entriesOf(rooms.map((r) => r.id), user);
    return rooms.map((r) => ({ ...r, gear: all.filter((g) => g.room_id === r.id) }));
  }
  function get(id, user) {
    const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(id));
    if (!r) throw new UserError('Room not found', 404);
    return { room: { ...toRoom(r), gear: entriesOf([r.id], user) } };
  }
  function fields(data, cur) {
    const name = str(data.name !== undefined ? data.name : cur && cur.name, 60);
    if (!name) throw new UserError('Give the room a name, like Sanctuary');
    const clash = db.prepare('SELECT id FROM rooms WHERE name = ? COLLATE NOCASE').get(name);
    if (clash && (!cur || clash.id !== cur.id)) throw new UserError('There is already a room called ' + name);
    const photo = data.photo !== undefined ? str(data.photo, 40) : cur ? cur.photo || '' : '';
    if (photo && uploadExists && !uploadExists(photo)) throw new UserError('That photo is missing; add it again');
    return { name, photo: photo || null, notes: String(data.notes !== undefined ? data.notes : (cur && cur.notes) || '').slice(0, 2000) };
  }
  function add(data, user) {
    const f = fields(data || {});
    const now = Date.now();
    const r = db.prepare('INSERT INTO rooms (name, photo, notes, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(f.name, f.photo, f.notes, user.id, user.id, now, now);
    audit(user, 'room.create', f.name, '');
    return Number(r.lastInsertRowid);
  }
  function edit(id, data, user) {
    const cur = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Room not found', 404);
    const f = fields(data || {}, cur);
    db.prepare('UPDATE rooms SET name = ?, photo = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(f.name, f.photo, f.notes, user.id, Date.now(), cur.id);
    if (data && data.spots && typeof data.spots === 'object') {
      // spots keyed by entry: { g12: {x,y,w,h,q} }
      const set = db.prepare('UPDATE room_gear SET spot = ? WHERE id = ? AND room_id = ?');
      for (const [k, v] of Object.entries(data.spots)) { const m = /^g(\d+)$/.exec(k); if (m) { const sp = cleanSpot(v); set.run(sp ? JSON.stringify(sp) : '', Number(m[1]), cur.id); } }
    }
    audit(user, 'room.edit', f.name, '');
  }
  function remove(id, user) {
    const cur = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Room not found', 404);
    db.prepare('DELETE FROM rooms WHERE id = ?').run(cur.id);   // its gear list goes with it; the cards stay
    audit(user, 'room.delete', cur.name, '');
  }
  /**
   * The gear in a room, in one go: [{ id (an entry already there, kept with its spot), device_id, unit, spot }].
   * Entries not listed come out of the room. A piece can only be in a room once.
   */
  function setGear(id, list, user) {
    const cur = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Room not found', 404);
    const want = (Array.isArray(list) ? list : []).slice(0, 300).map((g, k) => {
      const d = db.prepare('SELECT id, name, qty, unit_tags FROM devices WHERE id = ?').get(Number(g && g.device_id));
      if (!d) throw new UserError('A piece of gear in this room is not in the Gear Locker any more');
      const unit = Math.max(0, Math.min(Math.max(1, d.qty || 1) - 1, Math.floor(Number(g.unit) || 0)));
      return { id: Number(g.id) || null, device_id: d.id, unit, spot: g.spot !== undefined ? cleanSpot(g.spot) : undefined, ord: k, name: pieceTag(d, unit) };
    });
    const seen = new Set();
    for (const w of want) { const k = w.device_id + ':' + w.unit; if (seen.has(k)) throw new UserError(w.name + ' is in this room twice'); seen.add(k); }
    db.exec('BEGIN');
    try {
      const have = new Map(db.prepare('SELECT id, spot FROM room_gear WHERE room_id = ?').all(cur.id).map((r) => [r.id, r]));
      const keep = new Set();
      for (const w of want) {
        if (w.id && have.has(w.id)) {
          keep.add(w.id);
          db.prepare('UPDATE room_gear SET device_id = ?, unit = ?, ord = ?' + (w.spot !== undefined ? ', spot = ?' : '') + ' WHERE id = ?').run(...[w.device_id, w.unit, w.ord].concat(w.spot !== undefined ? [w.spot ? JSON.stringify(w.spot) : ''] : [], [w.id]));
        } else {
          const r = db.prepare('INSERT INTO room_gear (room_id, device_id, unit, spot, ord) VALUES (?, ?, ?, ?, ?)').run(cur.id, w.device_id, w.unit, w.spot ? JSON.stringify(w.spot) : '', w.ord);
          keep.add(Number(r.lastInsertRowid));
        }
      }
      for (const hid of have.keys()) if (!keep.has(hid)) db.prepare('DELETE FROM room_gear WHERE id = ?').run(hid);
      db.prepare('UPDATE rooms SET updated_by = ?, updated_at = ? WHERE id = ?').run(user.id, Date.now(), cur.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(user, 'room.gear', cur.name, want.length + ' pieces');
    return get(cur.id, user);
  }

  // ---------- stage plots ----------
  const OUTLINE = { w: 32, d: 18, tw: 0, td: 0, label: 'Downstage · Audience' };
  /** The stage everyone's plots sit on: width and depth in feet, an optional thrust (apron) out front, and a front label. */
  function cleanOutline(o) {
    o = o && typeof o === 'object' ? o : {};
    const n = (v, a, b, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(a, Math.min(b, Math.round(x * 2) / 2)) : d; };
    const w = n(o.w, 6, 200, OUTLINE.w), d = n(o.d, 4, 120, OUTLINE.d);
    return { w, d, tw: n(o.tw, 0, w, 0), td: n(o.td, 0, 60, 0), label: str(o.label !== undefined ? o.label : OUTLINE.label, 60) };
  }
  const outline = () => cleanOutline(parse(getSetting('stage_outline', ''), {}));
  function setOutline(o, user) { const c = cleanOutline(o); setSetting('stage_outline', JSON.stringify(c)); audit(user, 'plot.outline', c.w + '×' + c.d + ' ft', ''); return c; }

  const ITEM_TYPES = ['gear', 'person', 'drums', 'keys', 'gtramp', 'bassamp', 'acoustic', 'stand', 'riser', 'choir', 'pulpit', 'chair', 'table', 'text', 'power', 'stagebox', 'snake', 'netdrop'];
  /** A plot drawing: items placed in feet from the stage's upstage-left corner, turned in 15° steps. */
  function cleanDoc(doc) {
    doc = doc && typeof doc === 'object' ? doc : {};
    const seen = new Set();
    const num = (v, a, b, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(a, Math.min(b, Math.round(x * 100) / 100)) : d; };
    const items = (Array.isArray(doc.items) ? doc.items : []).slice(0, 500).map((it) => {
      if (!it || !ITEM_TYPES.includes(it.t)) return null;
      let id = str(it.id, 16).replace(/[^a-z0-9]/gi, '');
      if (!id || seen.has(id)) id = 'p' + Math.random().toString(36).slice(2, 9);
      seen.add(id);
      const out = { id, t: it.t, x: num(it.x, -100, 300, 0), y: num(it.y, -100, 200, 0), r: ((Math.round((Number(it.r) || 0) / 15) * 15) % 360 + 360) % 360 };
      if (it.w != null) out.w = num(it.w, 0.5, 200, 4);
      if (it.h != null) out.h = num(it.h, 0.5, 120, 4);
      if (it.label) out.label = str(it.label, 60);
      if (it.notes) out.notes = String(it.notes).slice(0, 500);
      if (it.gear) out.gear = str(it.gear, 40);
      if (it.stand) out.stand = str(it.stand, 30);
      if (it.on) out.on = str(it.on, 16);
      if (it.room && Number(it.room.id)) { const sp = cleanSpot(it.room.spot); out.room = { id: Number(it.room.id), spot: sp }; }
      return out;
    }).filter(Boolean);
    // a link to an item that is not there any more goes
    const ids = new Set(items.map((x) => x.id));
    items.forEach((x) => { if (x.on && (!ids.has(x.on) || x.on === x.id)) delete x.on; });
    return { items };
  }
  const toPlot = (r) => ({ id: r.id, name: r.name, notes: r.notes || '', doc: cleanDoc(parse(r.doc, {})), updated_at: r.updated_at, updated_by: r.by_name || '' });
  function plots() {
    return db.prepare('SELECT p.*, u.name AS by_name FROM plots p LEFT JOIN users u ON u.id = p.updated_by ORDER BY p.name COLLATE NOCASE').all()
      .map((r) => { const p = toPlot(r); return { id: p.id, name: p.name, notes: p.notes, updated_at: p.updated_at, updated_by: p.updated_by, items: p.doc.items.length, gear: p.doc.items.filter((x) => x.t === 'gear').length }; });
  }
  function plot(id) {
    const r = db.prepare('SELECT p.*, u.name AS by_name FROM plots p LEFT JOIN users u ON u.id = p.updated_by WHERE p.id = ?').get(Number(id));
    if (!r) throw new UserError('Stage plot not found', 404);
    return { plot: toPlot(r), outline: outline() };
  }
  function plotName(data, cur) {
    const name = str(data.name !== undefined ? data.name : cur && cur.name, 80);
    if (!name) throw new UserError('Give the stage plot a name, like Sunday worship band');
    const clash = db.prepare('SELECT id FROM plots WHERE name = ? COLLATE NOCASE').get(name);
    if (clash && (!cur || clash.id !== cur.id)) throw new UserError('There is already a stage plot called ' + name);
    return name;
  }
  function addPlot(data, user) {
    data = data || {};
    const name = plotName(data);
    let doc = { items: [] };
    if (data.copy) { const src = db.prepare('SELECT doc FROM plots WHERE id = ?').get(Number(data.copy)); if (src) doc = cleanDoc(parse(src.doc, {})); }
    const now = Date.now();
    const r = db.prepare('INSERT INTO plots (name, notes, doc, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, String(data.notes || '').slice(0, 2000), JSON.stringify(doc), user.id, user.id, now, now);
    audit(user, 'plot.create', name, '');
    return Number(r.lastInsertRowid);
  }
  function editPlot(id, data, user) {
    const cur = db.prepare('SELECT * FROM plots WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Stage plot not found', 404);
    data = data || {};
    const name = plotName(data, cur);
    const notes = data.notes !== undefined ? String(data.notes).slice(0, 2000) : cur.notes;
    const doc = data.doc !== undefined ? JSON.stringify(cleanDoc(data.doc)) : cur.doc;
    if (doc.length > 2 * 1024 * 1024) throw new UserError('That stage plot is too big to save');
    db.prepare('UPDATE plots SET name = ?, notes = ?, doc = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(name, notes, doc, user.id, Date.now(), cur.id);
    if (data.doc === undefined || name !== cur.name) audit(user, 'plot.edit', name, '');
    return plot(cur.id);
  }
  function removePlot(id, user) {
    const cur = db.prepare('SELECT * FROM plots WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Stage plot not found', 404);
    db.prepare('DELETE FROM plots WHERE id = ?').run(cur.id);
    audit(user, 'plot.delete', cur.name, '');
  }

  return { list, get, add, edit, remove, setGear, outline, setOutline, cleanOutline, cleanDoc, plots, plot, addPlot, editPlot, removePlot, pieceTag, ITEM_TYPES };
}

module.exports = { create, pieceTag };
