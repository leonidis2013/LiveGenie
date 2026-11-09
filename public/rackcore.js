/**
 * Racks: the rules for what fits where (front of the rack), where each spot sits on the rack photo, and power.
 * Shared by the server (checks every save) and the Racks page. Works in Node for the tests.
 *
 * U numbers count from the top of the rack: U1 is the top unit. A piece of gear takes rack_h units from rack_u down.
 * side: '' full width, 'L' or 'R' a half-width unit (two side by side in one U). Gear on a shelf has no U of its own.
 * Rack items (not Gear Locker cards): blank panel, vent, shelf, drawer. A shelf holds gear.
 * rails: the four inside corners of the rails on the photo, as fractions of the picture: { tl, tr, bl, br } each { x, y }.
 */
(function (root) {
  /** Rack-only pieces (not Gear Locker cards). custom: anything else, named by you. */
  const ITEM_TYPES = { blank: 'Blank panel', vent: 'Vent panel', shelf: 'Shelf', drawer: 'Drawer', patch: 'Network patch panel', patchaudio: 'Audio patch panel', patchav: 'AV patch panel', cable: 'Cable manager', custom: 'Custom item' };
  const MAX_UNITS = 60;
  const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : null; };

  /** Every unit a thing takes, as "U:side" cells. Full width takes both halves. */
  function cells(u, h, side) {
    const out = [];
    for (let k = 0; k < h; k++) {
      if (side === 'L' || side === 'R') out.push((u + k) + side);
      else { out.push((u + k) + 'L'); out.push((u + k) + 'R'); }
    }
    return out;
  }

  /**
   * Check a whole rack. items: rack items; gear: [{ id, name, rack_u, rack_h, rack_side, shelf_id }].
   * Returns a list of problems (empty when it all fits). Each problem is a sentence.
   */
  function problems(units, items, gear) {
    const bad = [];
    const taken = new Map();   // cell → name of what is there
    const put = (name, u, h, side) => {
      if (!(u >= 1) || !(h >= 1)) { bad.push(name + ' needs a U position'); return; }
      if (u + h - 1 > units) { bad.push(name + ' runs past the bottom of the rack (U' + u + (h > 1 ? '–' + (u + h - 1) : '') + ' in a ' + units + 'U rack)'); return; }
      for (const c of cells(u, h, side)) {
        if (taken.has(c)) { bad.push(name + ' overlaps ' + taken.get(c) + ' at U' + parseInt(c, 10)); return; }
      }
      cells(u, h, side).forEach((c) => taken.set(c, name));
    };
    const shelves = new Set();
    for (const it of items || []) {
      put(it.label || ITEM_TYPES[it.type] || 'A panel', it.u, it.h, '');
      if (it.type === 'shelf') shelves.add(it.id);
    }
    for (const g of gear || []) {
      if (g.shelf_id) { if (!shelves.has(g.shelf_id)) bad.push(g.name + ' is on a shelf that is not in this rack'); continue; }
      put(g.name, g.rack_u, g.rack_h || 1, g.rack_side || '');
    }
    return bad;
  }

  /** How many units are used (full or half) and free. */
  function usage(units, items, gear) {
    const taken = new Set();
    for (const it of items || []) if (it.u >= 1) cells(it.u, it.h || 1, '').forEach((c) => taken.add(parseInt(c, 10)));
    for (const g of gear || []) if (!g.shelf_id && g.rack_u >= 1) cells(g.rack_u, g.rack_h || 1, g.rack_side || '').forEach((c) => taken.add(parseInt(c, 10)));
    const used = [...taken].filter((u) => u >= 1 && u <= units).length;
    return { used, free: Math.max(0, units - used) };
  }

  /** Free runs of units from the top: [{ u, h }]. */
  function gaps(units, items, gear) {
    const busy = new Set();
    for (const it of items || []) if (it.u >= 1) for (let k = 0; k < (it.h || 1); k++) busy.add(it.u + k);
    for (const g of gear || []) if (!g.shelf_id && g.rack_u >= 1) for (let k = 0; k < (g.rack_h || 1); k++) busy.add(g.rack_u + k);
    const out = [];
    let start = null;
    for (let u = 1; u <= units + 1; u++) {
      if (u <= units && !busy.has(u)) { if (start == null) start = u; }
      else if (start != null) { out.push({ u: start, h: u - start }); start = null; }
    }
    return out;
  }

  /** The default lining up: the rails fill the middle of the photo. */
  const DEFAULT_RAILS = { tl: { x: 0.1, y: 0.1 }, tr: { x: 0.9, y: 0.1 }, bl: { x: 0.1, y: 0.9 }, br: { x: 0.9, y: 0.9 } };
  function cleanRails(r) {
    const f = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 10000) / 10000)) : d; };
    const out = {};
    for (const k of ['tl', 'tr', 'bl', 'br']) out[k] = { x: f(r && r[k] && r[k].x, DEFAULT_RAILS[k].x), y: f(r && r[k] && r[k].y, DEFAULT_RAILS[k].y) };
    return out;
  }
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  /** A point inside the rails: across 0 (left rail) → 1 (right rail), down 0 (top of U1) → 1 (bottom of the last U). */
  function at(rails, across, down) {
    const r = cleanRails(rails);
    return lerp(lerp(r.tl, r.tr, across), lerp(r.bl, r.br, across), down);
  }
  /** Where a spot sits on the photo, as a box in fractions of the picture (photos taken at an angle give a slanted rack; the box holds it). */
  /**
   * Spots moved by hand on the photo: { g12: {x,y,w,h, q?}, … } as fractions of the photo. q: the four corners
   * (top left, top right, bottom right, bottom left) when the spot is skewed to follow a photo taken at an angle;
   * x/y/w/h is then the box around them.
   */
  const n01 = (x) => Math.max(0, Math.min(1, Math.round((Number(x) || 0) * 10000) / 10000));
  /** The box around four corners. */
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const boundsOf = (q) => { const xs = q.map((p) => p.x), ys = q.map((p) => p.y); const x = Math.min(...xs), y = Math.min(...ys); return { x: r4(x), y: r4(y), w: r4(Math.max(...xs) - x), h: r4(Math.max(...ys) - y) }; };
  /** A spot's four corners: its own, or its box's. */
  const quadOf = (b) => (b.q && b.q.length === 4 ? b.q : [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }]);
  function cleanSpots(o) {
    const out = {};
    for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {})) {
      if (!/^[gi][\w-]{1,24}$/.test(k) || !v) continue;
      let b;
      if (Array.isArray(v.q) && v.q.length === 4 && v.q.every((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))) {
        const q = v.q.map((p) => ({ x: n01(p.x), y: n01(p.y) }));
        b = { ...boundsOf(q), q };
      } else b = { x: n01(v.x), y: n01(v.y), w: n01(v.w), h: n01(v.h) };
      if (b.w < 0.005 || b.h < 0.005) continue;
      out[k] = b;
      if (Object.keys(out).length >= 400) break;
    }
    return out;
  }

  function region(rails, units, u, h, side) {
    const a0 = side === 'R' ? 0.5 : 0, a1 = side === 'L' ? 0.5 : 1;
    const d0 = (u - 1) / units, d1 = (u - 1 + (h || 1)) / units;
    // the four corners follow the rails, so a rack photographed at an angle gives slanted spots
    const q = [at(rails, a0, d0), at(rails, a1, d0), at(rails, a1, d1), at(rails, a0, d1)];
    const b = boundsOf(q);
    return { x: b.x, y: b.y, w: Math.max(0.005, b.w), h: Math.max(0.005, b.h), q };
  }

  /** Power: per power strip / PDU, what is plugged into each outlet and the total draw. gear rows carry power_pdu, power_outlet, power_w, qty. */
  function power(pdus, gear) {
    return (pdus || []).map((p) => {
      const plugs = (gear || []).filter((g) => g.power_pdu === p.id && g.id !== p.id);
      const watts = plugs.reduce((s, g) => s + (Number(g.power_w) || 0) * Math.max(1, g.qty || 1), 0);
      const max = Number(p.power_max) || 0;
      return { id: p.id, name: p.name, model: p.model || '', outlets: p.outputs || 0, max, watts, over: !!max && watts > max, plugs: plugs.map((g) => ({ id: g.id, name: g.name, model: g.model || '', outlet: g.power_outlet || null, watts: Number(g.power_w) || 0 })) };
    });
  }

  const api = { ITEM_TYPES, MAX_UNITS, int, cells, problems, usage, gaps, DEFAULT_RAILS, cleanRails, cleanSpots, boundsOf, quadOf, at, region, power };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RackCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
