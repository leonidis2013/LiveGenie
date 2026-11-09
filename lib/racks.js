'use strict';
/**
 * Racks: a front elevation of each rack, its photo lined up to the rails, the gear in it (from the Gear Locker),
 * rack-only panels (blank, vent, shelf, drawer) and power (which outlet of which power strip each piece plugs into).
 * Every save is checked: nothing overlaps, nothing runs past the bottom, one plug per outlet.
 */
const RackCore = require('../public/rackcore');
const Auth = require('./auth');

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function create(db, { UserError, audit, uploadExists }) {
  const seeTech = (user) => Auth.atLeast(user, 'admin');
  const parse = (v, d) => { try { return JSON.parse(v); } catch (e) { return d; } };
  const toRack = (r) => r && { id: r.id, name: r.name, units: r.units, photo: r.photo || '', rails: RackCore.cleanRails(parse(r.rails, {})), spots: RackCore.cleanSpots(parse(r.spots, {})), items: cleanItems(parse(r.items, []), r.units), location: r.location || '', notes: r.notes || '', updated_at: r.updated_at };

  /** Rack-only panels: { id, type, u, h, label }. */
  function cleanItems(list, units) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).slice(0, 120).map((it) => {
      if (!it || !RackCore.ITEM_TYPES[it.type]) return null;
      let id = str(it.id, 16).replace(/[^a-z0-9]/gi, '');
      if (!id || seen.has(id)) id = 'i' + Math.random().toString(36).slice(2, 9);
      seen.add(id);
      return { id, type: it.type, u: Math.max(1, Math.min(units || 60, RackCore.int(it.u) || 1)), h: Math.max(1, Math.min(units || 60, RackCore.int(it.h) || 1)), label: str(it.label, 60) };
    }).filter(Boolean);
  }

  /** The gear in a rack (on it or on its shelves), as the checks see it. */
  const gearIn = (id, user) => db.prepare('SELECT id, name, model, make, kind, qty, photo, notes, tech_only, rack_u, rack_h, rack_side, shelf_id, power_w, power_pdu, power_outlet, power_max, outputs FROM devices WHERE rack_id = ?' + (user && !seeTech(user) ? ' AND tech_only = 0' : '')).all(Number(id));

  function check(rack, items, gear) {
    const bad = RackCore.problems(rack.units, items, gear);
    if (bad.length) throw new UserError(bad[0]);
  }

  function list(user) {
    return db.prepare('SELECT * FROM racks ORDER BY name COLLATE NOCASE').all().map((r) => {
      const rk = toRack(r), gear = gearIn(r.id, user);
      const pdus = gear.filter((g) => g.kind === 'power');
      const pw = RackCore.power(pdus, db.prepare('SELECT id, name, model, qty, power_w, power_pdu, power_outlet FROM devices WHERE power_pdu IS NOT NULL').all());
      return { ...rk, gear: gear.length, ...RackCore.usage(rk.units, rk.items, gear), watts: pw.reduce((s, p) => s + p.watts, 0) };
    });
  }

  function get(id, user) {
    const r = db.prepare('SELECT * FROM racks WHERE id = ?').get(Number(id));
    if (!r) throw new UserError('Rack not found', 404);
    const rk = toRack(r);
    const gear = gearIn(r.id, user);
    const pdus = gear.filter((g) => g.kind === 'power');
    const plugged = db.prepare('SELECT id, name, model, qty, power_w, power_pdu, power_outlet FROM devices WHERE power_pdu IS NOT NULL' + (seeTech(user) ? '' : ' AND tech_only = 0')).all();
    return { rack: rk, gear: gear.map((g) => ({ ...g, tech_only: !!g.tech_only })), power: RackCore.power(pdus, plugged), ...RackCore.usage(rk.units, rk.items, gear), gaps: RackCore.gaps(rk.units, rk.items, gear) };
  }

  function fields(data, cur) {
    const name = str(data.name !== undefined ? data.name : cur && cur.name, 60);
    if (!name) throw new UserError('Give the rack a name, like Rack AV-102');
    const units = data.units !== undefined ? RackCore.int(data.units) : cur ? cur.units : 12;
    if (!(units >= 1 && units <= RackCore.MAX_UNITS)) throw new UserError('A rack is 1 to ' + RackCore.MAX_UNITS + ' U');
    let photo = data.photo !== undefined ? str(data.photo, 40) : cur ? cur.photo || '' : '';
    if (photo && uploadExists && !uploadExists(photo)) throw new UserError('That photo is missing; add it again');
    const clash = db.prepare('SELECT id FROM racks WHERE name = ? COLLATE NOCASE').get(name);
    if (clash && (!cur || clash.id !== cur.id)) throw new UserError('There is already a rack called ' + name);
    return {
      name, units, photo: photo || null,
      rails: JSON.stringify(RackCore.cleanRails(data.rails !== undefined ? data.rails : cur ? parse(cur.rails, {}) : {})),
      spots: JSON.stringify(RackCore.cleanSpots(data.spots !== undefined ? data.spots : cur ? parse(cur.spots, {}) : {})),
      location: str(data.location !== undefined ? data.location : cur && cur.location, 80),
      notes: String(data.notes !== undefined ? data.notes : (cur && cur.notes) || '').slice(0, 2000)
    };
  }

  function add(data, user) {
    const f = fields(data || {});
    const now = Date.now();
    const r = db.prepare('INSERT INTO racks (name, units, photo, rails, items, location, notes, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.name, f.units, f.photo, f.rails, '[]', f.location, f.notes, user.id, user.id, now, now);
    audit(user, 'rack.create', f.name, f.units + 'U');
    return Number(r.lastInsertRowid);
  }

  function edit(id, data, user) {
    const cur = db.prepare('SELECT * FROM racks WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Rack not found', 404);
    const f = fields(data || {}, cur);
    // a smaller rack must still hold what is in it
    if (f.units !== cur.units) check({ units: f.units }, cleanItems(parse(cur.items, []), f.units), gearIn(cur.id));
    db.prepare('UPDATE racks SET name = ?, units = ?, photo = ?, rails = ?, spots = ?, location = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(f.name, f.units, f.photo, f.rails, f.spots, f.location, f.notes, user.id, Date.now(), cur.id);
    audit(user, 'rack.edit', f.name, '');
  }

  function remove(id, user) {
    const cur = db.prepare('SELECT * FROM racks WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Rack not found', 404);
    db.exec('BEGIN');
    try {
      db.prepare("UPDATE devices SET rack_id = NULL, rack_u = NULL, rack_h = 1, rack_side = '', shelf_id = '' WHERE rack_id = ?").run(cur.id);
      db.prepare('DELETE FROM racks WHERE id = ?').run(cur.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(user, 'rack.delete', cur.name, '');
  }

  /**
   * Set the whole rack in one go: its panels, and where each piece of gear sits.
   * gear: [{ id, u, h, side, shelf }]. Gear that was in this rack and is not listed comes out of it.
   */
  function layout(id, body, user) {
    const cur = db.prepare('SELECT * FROM racks WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Rack not found', 404);
    const items = cleanItems(body && body.items, cur.units);
    const want = (Array.isArray(body && body.gear) ? body.gear : []).slice(0, 200).map((g) => {
      const d = db.prepare('SELECT id, name FROM devices WHERE id = ?').get(Number(g && g.id));
      if (!d) throw new UserError('A piece of gear in this layout is not in the Gear Locker any more');
      const shelf = str(g.shelf, 16);
      return { id: d.id, name: d.name, rack_u: shelf ? null : RackCore.int(g.u), rack_h: shelf ? 0 : Math.max(1, Math.min(cur.units, RackCore.int(g.h) || 1)), rack_side: shelf ? '' : (g.side === 'L' || g.side === 'R' ? g.side : ''), shelf_id: shelf };
    });
    if (new Set(want.map((g) => g.id)).size !== want.length) throw new UserError('A piece of gear is in the layout twice');
    // gear in another rack moves here; nothing else in this rack is touched
    check(cur, items, want);
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE racks SET items = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(items), user.id, Date.now(), cur.id);
      const keep = new Set(want.map((g) => g.id));
      for (const g of gearIn(cur.id)) if (!keep.has(g.id)) db.prepare("UPDATE devices SET rack_id = NULL, rack_u = NULL, rack_h = 1, rack_side = '', shelf_id = '' WHERE id = ?").run(g.id);
      for (const g of want) db.prepare('UPDATE devices SET rack_id = ?, rack_u = ?, rack_h = ?, rack_side = ?, shelf_id = ?, updated_at = ? WHERE id = ?').run(cur.id, g.rack_u, g.rack_h, g.rack_side, g.shelf_id, Date.now(), g.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(user, 'rack.layout', cur.name, want.length + ' pieces of gear, ' + items.length + ' panels');
    return get(cur.id, user);
  }

  /**
   * Power for the gear in a rack: plugs [{ id, pdu, outlet, watts }]. One plug per outlet; the outlet must exist on that strip.
   * The strip may be in any rack (or none).
   */
  function setPower(id, plugs, user) {
    const cur = db.prepare('SELECT * FROM racks WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Rack not found', 404);
    const rows = (Array.isArray(plugs) ? plugs : []).slice(0, 300).map((p) => ({ id: Number(p && p.id), pdu: p && p.pdu ? Number(p.pdu) : null, outlet: p && p.pdu ? RackCore.int(p.outlet) : null, watts: p && p.watts !== undefined && p.watts !== '' && p.watts !== null ? RackCore.int(p.watts) : undefined }));
    db.exec('BEGIN');
    try {
      for (const p of rows) {
        if (!db.prepare('SELECT 1 FROM devices WHERE id = ?').get(p.id)) throw new UserError('A piece of gear is not in the Gear Locker any more');
        if (p.watts !== undefined) db.prepare('UPDATE devices SET power_w = ? WHERE id = ?').run(p.watts != null && p.watts >= 0 ? Math.min(100000, p.watts) : null, p.id);
        db.prepare('UPDATE devices SET power_pdu = ?, power_outlet = ? WHERE id = ?').run(p.pdu, p.pdu ? p.outlet : null, p.id);
      }
      checkPower(rows.map((p) => p.id));
      db.prepare('UPDATE racks SET updated_by = ?, updated_at = ? WHERE id = ?').run(user.id, Date.now(), cur.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(user, 'rack.power', cur.name, rows.length + ' plugs');
    return get(cur.id, user);
  }

  /**
   * Plugs: an outlet holds one plug, and it must be on a power strip. touched: the cards a save changed; only their
   * plugs (and plugs into them, when they are strips) are checked, so an old bad row elsewhere never blocks a save.
   */
  function checkPower(touched) {
    const t = touched && touched.length ? new Set(touched.map(Number)) : null;
    const rows = db.prepare('SELECT d.id, d.name, d.power_pdu, d.power_outlet, p.name AS pname, p.kind AS pkind, p.outputs AS pouts FROM devices d LEFT JOIN devices p ON p.id = d.power_pdu WHERE d.power_pdu IS NOT NULL').all();
    // the plugs this save is about: the touched cards' own, and every plug into a touched power strip
    const mine = (d) => !t || t.has(d.id) || t.has(d.power_pdu);
    const seen = new Map();
    for (const d of rows) {
      const k = d.power_pdu + ':' + d.power_outlet;
      if (mine(d)) {
        if (d.power_pdu === d.id) throw new UserError(d.name + ' cannot plug into itself');
        if (!d.pname) throw new UserError(d.name + ' is plugged into a power strip that is not in the Gear Locker');
        if (d.pkind !== 'power') throw new UserError(d.pname + ' is not a power strip or PDU (set What is it? to Power on its card)');
        if (!(d.power_outlet >= 1)) throw new UserError('Pick the outlet ' + d.name + ' plugs into');
        if (d.pouts && d.power_outlet > d.pouts) throw new UserError(d.pname + ' has ' + d.pouts + ' outlets; there is no outlet ' + d.power_outlet);
      }
      if (seen.has(k)) { const o = seen.get(k); if (mine(d) || mine(o)) throw new UserError(o.name + ' and ' + d.name + ' are both on ' + (d.pname || 'a strip') + ' outlet ' + d.power_outlet); }
      seen.set(k, d);
    }
  }

  /** Check one card's rack spot as the Gear Locker form sets it (the rest of its rack as it is now). */
  function checkSpot(deviceId, spot) {
    if (!spot.rack_id) return;
    const cur = db.prepare('SELECT * FROM racks WHERE id = ?').get(Number(spot.rack_id));
    if (!cur) throw new UserError('That rack is not there any more');
    const items = cleanItems(parse(cur.items, []), cur.units);
    const others = gearIn(cur.id).filter((g) => g.id !== Number(deviceId));
    check(cur, items, others.concat([{ id: deviceId, name: spot.name || 'This gear', rack_u: spot.rack_u, rack_h: spot.rack_h, rack_side: spot.rack_side, shelf_id: spot.shelf_id }]));
  }

  return { list, get, add, edit, remove, layout, setPower, checkPower, checkSpot, cleanItems };
}

module.exports = { create };
