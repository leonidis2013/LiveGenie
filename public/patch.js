/*
 * The stage patch: one drawing for the whole system.
 *   Cards sit wherever you put them (Tidy lines them up left to right, in signal-flow order).
 *   A card shows the sockets in use and folds the rest into "+ 22 free"; open it to see every socket.
 *   A wireless system is one card: a receiver with the mics on its channels, a transmitter with its packs.
 *   Cables run at right angles around the cards, with a small hop where two cross.
 * Click any card or cable and its whole signal path lights up. Editors drag cards, drag from one card to
 * another to connect (a picker asks which sockets), and right-click for the menu. The input, output,
 * wireless, in-ear and cable lists, and the PDF, are all made from the drawing.
 * Uses helpers from app.js (get, call, esc, icon, can, modal, toast, S) and devices.js (DEV, loadDevices).
 */
'use strict';

const PatchView = (() => {
  const P = PatchCore;
  // every measure is a multiple of the 10 px grid, so sockets sit on grid lines and cables run straight into them
  const GRID = 10, CW = 240, HEAD = 50, ROW = 20, FOOT = 10, COLGAP = 100, VGAP = 30, LINKY = 30;
  const KIND_STYLE = { xlr: 'Analog · XLR', link: 'Digital snake', dante: 'Dante · Cat6', aes: 'AES3', speaker: 'Speaker · NL4', wiem: 'Wired IEM', rf: 'Wireless · RF' };
  const SHORT_MAKE = { 'allen & heath': 'A&H', 'phenyx pro': 'Phenyx', sennheiser: 'Sennheiser' };
  const makeTag = (m) => SHORT_MAKE[String(m || '').toLowerCase()] || m;
  const cut = (s, n) => { s = String(s || ''); return n < 2 ? '' : s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; };
  const key = (v) => String(v || '').trim().toLowerCase();
  const snap = (v) => Math.round(v / GRID) * GRID;
  const who = (g) => [g.person, g.use].filter(Boolean).join(' · ');

  // ================= cards =================
  /** Gear drawn as cards: everything except mics and packs that live inside a wireless system. */
  function cardGear(doc) {
    const hosted = new Set();
    doc.gear.forEach((g) => { if (P.KINDS[g.kind].member && P.hostOf(doc, g)) hosted.add(g.id); });
    return doc.gear.filter((g) => !hosted.has(g.id));
  }

  /** Lay out one card: which rows it shows, where each socket sits (relative to the card), how tall it is. */
  function cardModel(doc, ix, g) {
    const k = P.KINDS[g.kind];
    const usedIn = (i) => !!ix.into.get(g.id + ':' + i);
    const usedOut = (j) => !!((ix.from.get(g.id + ':' + j) || []).length || (g.feeds || {})[j]);
    const mem = P.members(doc, g);
    const memAt = new Map(mem.map((m) => [m.port, m]));
    const small = g.ins.length + g.outs.length <= 4;
    const open = small || !!g.open;
    const rows = [], inY = {}, outY = {};
    let freeIn = 0, freeOut = 0;
    if (g.kind === 'receiver' || g.kind === 'amp') {
      // one row per channel: in and out side by side
      g.ins.forEach((_, i) => {
        const show = open || usedIn(i) || usedOut(i) || memAt.has(i);
        if (!show) { freeIn++; return; }
        rows.push({ in: i, out: i < g.outs.length ? i : null, member: memAt.get(i) || null });
      });
    } else {
      const ins = g.ins.map((_, i) => i).filter((i) => open || usedIn(i));
      const outs = g.outs.map((_, j) => j).filter((j) => open || usedOut(j));
      freeIn = g.ins.length - ins.length; freeOut = g.outs.length - outs.length;
      for (let r = 0; r < Math.max(ins.length, outs.length); r++) rows.push({ in: ins[r] != null ? ins[r] : null, out: outs[r] != null ? outs[r] : null });
    }
    // an IEM transmitter lists its packs
    if (g.kind === 'iemtx') mem.forEach((m) => rows.push({ pack: m }));
    // a console lists the stage box channels that reach it over its links
    let slink = [];
    if (g.kind === 'console') {
      doc.gear.filter((sb) => sb.kind === 'stagebox' && ix.consolesOf(sb.id).includes(g)).forEach((sb) => {
        sb.ins.forEach((_, i) => {
          const ch = P.chanOf(sb, i), used = !!ix.into.get(sb.id + ':' + i);
          if (ch != null && (used || open)) slink.push({ ch, sb, i, used });
        });
      });
      slink.sort((a, b) => a.ch - b.ch);
      if (slink.length) { rows.push({ head: (ix.linkName(slink[0].sb.id, g.id) || 'Link') + ' channels' }); slink.forEach((s) => rows.push({ slink: s })); }
    }
    if (!small && (freeIn || freeOut || g.open)) rows.push({ more: true, freeIn, freeOut });
    rows.forEach((r, n) => { const y = HEAD + n * ROW + ROW / 2; if (r.in != null && !r.pack) inY[r.in] = y; if (r.out != null) outY[r.out] = y; });
    const h = HEAD + rows.length * ROW + (rows.length ? FOOT : 0);
    return { g, k, rows, inY, outY, w: CW, h: Math.max(HEAD + FOOT, h), mem, link: !!k.link, small };
  }

  // ================= placing cards =================
  /** Tidy: columns left to right in signal-flow order, each sorted to follow what feeds it. */
  function tidyPositions(doc, ix, models) {
    const list = cardGear(doc);
    const cols = new Map();
    list.forEach((g) => { const c = P.colOf(g); if (!cols.has(c)) cols.set(c, []); cols.get(c).push(g); });
    const pos = new Map();
    let x = 0;
    const keys = [...cols.keys()].sort((a, b) => a - b);
    for (const c of keys) {
      const col = cols.get(c);
      // follow the cards that feed this one (their average height), so cables cross less
      const feedY = (g) => {
        const ys = [];
        g.ins.forEach((_, i) => { const cb = ix.into.get(g.id + ':' + i); if (cb && pos.has(cb.a)) ys.push(pos.get(cb.a).y); });
        (ix.links.get(g.id) || []).forEach(({ other }) => { if (pos.has(other)) ys.push(pos.get(other).y); });
        return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : null;
      };
      const ranked = col.map((g, n) => ({ g, n, f: feedY(g) }));
      ranked.sort((a, b) => (a.f == null) - (b.f == null) || (a.f || 0) - (b.f || 0) || (a.g.order || 0) - (b.g.order || 0) || a.n - b.n);
      let y = 0;
      ranked.forEach(({ g }) => { pos.set(g.id, { x, y }); y = snap(y + models.get(g.id).h + VGAP); });
      x += CW + COLGAP;
    }
    return pos;
  }
  const overlaps = (a, b, m) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
  /** A free spot near (x, y): slide down until the card does not sit on another. */
  function freeSpot(rects, w, h, x, y) {
    x = snap(x); y = snap(y);
    for (let n = 0; n < 400; n++) {
      const me = { x, y, w, h };
      const hit = rects.find((r) => overlaps(me, r, 20));
      if (!hit) return { x, y };
      y = snap(hit.y + hit.h + VGAP);
    }
    return { x, y };
  }
  /** Give every card a place: missing places come from Tidy (all of them on a new drawing). */
  function place(doc) {
    const ix = P.index(doc);
    const models = new Map(cardGear(doc).map((g) => [g.id, cardModel(doc, ix, g)]));
    const missing = [...models.values()].filter((m) => m.g.x == null || m.g.y == null);
    if (missing.length) {
      const tidy = tidyPositions(doc, ix, models);
      if (missing.length === models.size) missing.forEach((m) => { const p = tidy.get(m.g.id); m.g.x = p.x; m.g.y = p.y; });
      else {
        const placed = [...models.values()].filter((m) => m.g.x != null && m.g.y != null).map((m) => ({ x: m.g.x, y: m.g.y, w: m.w, h: m.h }));
        // its Tidy column, next to cards of the same kind if there are some
        missing.forEach((m) => {
          const same = [...models.values()].find((o) => o !== m && o.g.x != null && P.colOf(o.g) === P.colOf(m.g));
          const tp = tidy.get(m.g.id);
          const p = freeSpot(placed, m.w, m.h, same ? same.g.x : tp.x, same ? same.g.y : tp.y);
          m.g.x = p.x; m.g.y = p.y; placed.push({ x: p.x, y: p.y, w: m.w, h: m.h });
        });
      }
    }
    return { ix, models };
  }

  // ================= routing =================
  /** A* on the 10 px grid around the cards: right angles, few turns, lines spread apart, never through a card. */
  function makeRouter(rects, bounds) {
    const x0 = snap(bounds.x0), y0 = snap(bounds.y0);
    const W = Math.ceil((bounds.x1 - x0) / GRID) + 1, H = Math.ceil((bounds.y1 - y0) / GRID) + 1;
    const N = W * H;
    const blocked = new Uint8Array(N), usedH = new Uint8Array(N), usedV = new Uint8Array(N);
    rects.forEach((r) => {
      const ax = Math.max(0, Math.ceil((r.x - x0) / GRID)), bx = Math.min(W - 1, Math.floor((r.x + r.w - x0) / GRID));
      const ay = Math.max(0, Math.ceil((r.y - y0) / GRID)), by = Math.min(H - 1, Math.floor((r.y + r.h - y0) / GRID));
      for (let yy = ay; yy <= by; yy++) for (let xx = ax; xx <= bx; xx++) blocked[yy * W + xx] = 1;
    });
    const node = (x, y) => { const cx = Math.round((x - x0) / GRID), cy = Math.round((y - y0) / GRID); return cx < 0 || cy < 0 || cx >= W || cy >= H ? -1 : cy * W + cx; };
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    const dirOf = (dx, dy) => (dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 2 : 3);
    // a small binary heap
    let heap = [], hk = [];
    const push = (v, f) => { heap.push(v); hk.push(f); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [hk[p], hk[i]] = [hk[i], hk[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const lv = heap.pop(), lk = hk.pop(); if (heap.length) { heap[0] = lv; hk[0] = lk; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && hk[l] < hk[m]) m = l; if (r < heap.length && hk[r] < hk[m]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; [hk[m], hk[i]] = [hk[i], hk[m]]; i = m; } } return top; };
    const gs = new Float32Array(N * 4), from = new Int32Array(N * 4), stamp = new Uint32Array(N * 4);
    let gen = 0;
    /** s, e: socket points; sd, ed: the way the cable leaves s and comes into e ([1,0] right, [-1,0] left). */
    function route(s, sd, e, ed) {
      const sa = { x: s.x + sd[0] * GRID, y: s.y }, ea = { x: e.x + ed[0] * GRID, y: e.y };
      const sn = node(sa.x, sa.y), en = node(ea.x, ea.y);
      if (sn < 0 || en < 0) return null;
      gen++; heap = []; hk = [];
      const ex = en % W, ey = (en / W) | 0;
      const h = (n) => Math.abs((n % W) - ex) + Math.abs(((n / W) | 0) - ey);
      const s0 = sn * 4 + dirOf(sd[0], 0);
      gs[s0] = 0; from[s0] = -1; stamp[s0] = gen; push(s0, h(sn));
      const wantEnd = dirOf(-ed[0], 0);   // arriving at the end node heading into the socket
      let found = -1, it = 0;
      while (heap.length && it++ < 260000) {
        if (found >= 0 && hk[0] > gs[found] + 8) break;
        const st = pop(), n = st >> 2, d = st & 3;
        if (n === en) { if (found < 0 || gs[st] + (d === wantEnd ? 0 : 6) < gs[found] + ((found & 3) === wantEnd ? 0 : 6)) found = st; if (d === wantEnd) break; continue; }
        const g0 = gs[st];
        const cx = n % W, cy = (n / W) | 0;
        for (let nd = 0; nd < 4; nd++) {
          if (nd === ((d + 2) & 3)) continue;
          const nx = cx + DX[nd], ny = cy + DY[nd];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const m = ny * W + nx;
          if (blocked[m] && m !== en) continue;
          let cost = 1 + (nd !== d ? 5 : 0) + (nd & 1 ? usedV[m] : usedH[m]) * 3;
          if (m === en && nd !== wantEnd) cost += 6;
          const ns = m * 4 + nd, ng = g0 + cost;
          if (stamp[ns] === gen && gs[ns] <= ng) continue;
          stamp[ns] = gen; gs[ns] = ng; from[ns] = st;
          push(ns, ng + h(m));
        }
      }
      if (found < 0) return null;
      const cells = [];
      for (let st = found; st >= 0; st = from[st]) cells.push(st >> 2);
      cells.reverse();
      const pts = [{ x: s.x, y: s.y }];
      cells.forEach((n) => pts.push({ x: x0 + (n % W) * GRID, y: y0 + ((n / W) | 0) * GRID }));
      pts.push({ x: e.x, y: e.y });
      // the cells this cable uses: the next one keeps a little away
      for (let i = 1; i < cells.length; i++) { const a = cells[i - 1], b = cells[i]; if (Math.abs(a - b) === 1) { usedH[a]++; usedH[b]++; } else { usedV[a]++; usedV[b]++; } }
      return simplify(pts);
    }
    return { route };
  }
  function simplify(pts) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) continue;
      out.push(b);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /** The line for a routed cable: rounded corners, and a small hop over vertical lines drawn before it. */
  function pathD(pts, verticals) {
    const R = 6, HOP = 5;
    let d = 'M' + pts[0].x + ' ' + pts[0].y;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      // where this segment ends: short of the corner, so the corner can curve
      let ex = b.x, ey = b.y;
      if (c) {
        const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y), r = Math.min(R, l1 / 2, l2 / 2);
        ex = b.x - Math.sign(b.x - a.x) * r; ey = b.y - Math.sign(b.y - a.y) * r;
      }
      if (a.y === b.y && verticals && verticals.length) {
        // hops along a horizontal run
        const dir = Math.sign(b.x - a.x) || 1;
        const lo = Math.min(a.x, ex) + 8, hi = Math.max(a.x, ex) - 8;
        const xs = verticals.filter((v) => v.x > lo && v.x < hi && a.y > Math.min(v.y1, v.y2) + 2 && a.y < Math.max(v.y1, v.y2) - 2).map((v) => v.x);
        xs.sort((p, q) => (p - q) * dir);
        let last = -Infinity;
        xs.forEach((x) => { if (Math.abs(x - last) < 12) return; last = x; d += 'L' + (x - dir * HOP) + ' ' + a.y + 'a' + HOP + ' ' + HOP + ' 0 0 ' + (dir > 0 ? 1 : 0) + ' ' + (2 * dir * HOP) + ' 0'; });
      }
      d += 'L' + ex + ' ' + ey;
      if (c) {
        const l2 = Math.hypot(c.x - b.x, c.y - b.y), l1 = Math.hypot(b.x - a.x, b.y - a.y), r = Math.min(R, l1 / 2, l2 / 2);
        d += 'Q' + b.x + ' ' + b.y + ' ' + (b.x + Math.sign(c.x - b.x) * r) + ' ' + (b.y + Math.sign(c.y - b.y) * r);
      }
    }
    return d;
  }

  // ================= the drawing =================
  /** The lines to draw: cables (not the radio links inside a wireless system) and links between boxes and consoles. */
  function edges(doc, ix, models) {
    const list = [];
    for (const c of doc.cables) {
      const ma = models.get(c.a), mb = models.get(c.b);
      if (!ma || !mb) continue;           // a member's radio link stays inside its card
      if (c.ap === 'link' || c.bp === 'link') {
        const a = ma.g, b = mb.g;
        const sb = a.kind === 'stagebox' ? a : b.kind === 'stagebox' ? b : null;
        let label = c.label || (c.kind === 'dante' ? 'Dante' : 'Link');
        if (sb) {
          const nIn = sb.ins.filter((_, i) => ix.into.get(sb.id + ':' + i)).length;
          const nOut = sb.outs.filter((_, j) => (ix.from.get(sb.id + ':' + j) || []).length || (sb.feeds || {})[j]).length;
          label += ' · ' + nIn + ' in · ' + nOut + ' out';
        }
        list.push({ id: c.id, c, link: true, ma, mb, kind: c.kind, label });
        continue;
      }
      if (ma.outY[c.ap] == null || mb.inY[c.bp] == null) continue;
      const a = ma.g;
      list.push({ id: c.id, c, ma, mb, kind: c.kind, label: c.kind === 'rf' ? (a.freq ? a.freq + ' MHz' : c.label || '') : c.label || '' });
    }
    return list;
  }
  /** Where a cable starts and ends, and which way it leaves and arrives. */
  function ends(e, pos) {
    const A = pos(e.ma.g), B = pos(e.mb.g);
    if (e.link) {
      const right = A.x + CW / 2 <= B.x + CW / 2;
      return { s: { x: right ? A.x + CW : A.x, y: A.y + LINKY }, sd: [right ? 1 : -1, 0], e: { x: right ? B.x : B.x + CW, y: B.y + LINKY }, ed: [right ? -1 : 1, 0] };
    }
    return { s: { x: A.x + CW, y: A.y + e.ma.outY[e.c.ap] }, sd: [1, 0], e: { x: B.x, y: B.y + e.mb.inY[e.c.bp] }, ed: [-1, 0] };
  }

  /** Route every cable. cache: earlier routes, reused for cables whose ends did not move (keep = ids that may be reused). */
  function routeAll(E, models, pos, cache, keep) {
    const rects = [...models.values()].map((m) => { const p = pos(m.g); return { x: p.x, y: p.y, w: m.w, h: m.h }; });
    if (!rects.length) return new Map();
    const b = { x0: Math.min(...rects.map((r) => r.x)) - 160, y0: Math.min(...rects.map((r) => r.y)) - 120, x1: Math.max(...rects.map((r) => r.x + r.w)) + 160, y1: Math.max(...rects.map((r) => r.y + r.h)) + 120 };
    const R = makeRouter(rects, b);
    const out = new Map();
    // links first (they are the thick ones), then the rest from top to bottom
    const order = E.slice().sort((p, q) => (q.link - p.link) || (pos(p.ma.g).y + (p.ma.outY[p.c.ap] || 0)) - (pos(q.ma.g).y + (q.ma.outY[q.c.ap] || 0)));
    for (const e of order) {
      const en = ends(e, pos);
      const sig = [en.s.x, en.s.y, en.e.x, en.e.y].join(',');
      const old = cache && cache.get(e.id);
      if (old && keep && keep(e) && old.sig === sig) { out.set(e.id, old); continue; }
      const pts = R.route(en.s, en.sd, en.e, en.ed);
      out.set(e.id, { sig, pts: pts || fallback(en) });
    }
    return out;
  }
  function fallback(en) { const mx = snap((en.s.x + en.e.x) / 2); return [en.s, { x: mx, y: en.s.y }, { x: mx, y: en.e.y }, en.e]; }

  /** What one socket shows next to its name. */
  function socketText(doc, ix, g, side, i) {
    if (side === 'in') {
      const c = ix.into.get(g.id + ':' + i);
      let t = '';
      if (c) {
        const a = ix.G.get(c.a);
        const u = P.upstream(doc, ix, g.id, i);
        t = (u.source && u.source !== a.name ? u.source + ' · ' : '') + a.name + (a.outs.length > 1 ? ' ' + a.outs[c.ap] : '');
      }
      if (g.kind === 'stagebox') { const ch = P.chanOf(g, i); if (ch != null) t = (t ? t + ' ' : '') + '→ Ch ' + ch; else if (c) t += ' · no ch'; }
      return t;
    }
    const to = (ix.from.get(g.id + ':' + i) || []).map((c) => { const b = ix.G.get(c.b); return b ? b.name + (b.ins.length > 1 ? ' ' + b.ins[c.bp] : '') : ''; }).filter(Boolean);
    const mix = (g.feeds || {})[i];
    return [mix, to.join(', ')].filter(Boolean).join(' → ');
  }
  function cardSub(doc, ix, m) {
    const g = m.g;
    const usedIns = g.ins.filter((_, i) => ix.into.get(g.id + ':' + i)).length;
    const usedOuts = g.outs.filter((_, j) => (ix.from.get(g.id + ':' + j) || []).length || (g.feeds || {})[j]).length;
    switch (g.kind) {
      case 'mic': case 'di': case 'source': case 'wedge': return [who(g), g.model].filter(Boolean).join(' · ');
      case 'txmic': return [who(g), g.capsule, g.freq && g.freq + ' MHz'].filter(Boolean).join(' · ');
      case 'receiver': return [g.model, m.mem.length + ' of ' + g.ins.length + ' ch in use'].filter(Boolean).join(' · ');
      case 'stagebox': return usedIns + ' of ' + g.ins.length + ' in · ' + usedOuts + ' of ' + g.outs.length + ' out';
      case 'console': return [g.model, usedIns ? usedIns + ' local in' : '', usedOuts ? usedOuts + ' local out' : ''].filter(Boolean).join(' · ');
      case 'iemtx': { const ie = P.inears(doc).find((x) => x.tx.id === g.id); return [g.mode, ie && ie.mix, g.freq && g.freq + ' MHz'].filter(Boolean).join(' · '); }
      case 'bodypack': return [who(g), g.phones].filter(Boolean).join(' · ');
      default: return [who(g), g.model].filter(Boolean).join(' · ');
    }
  }

  function defs() {
    return '<defs>' + Object.entries(P.CATS).map(([k, v]) => '<linearGradient id="pg-' + k + '" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="' + v.color + '" stop-opacity=".36"/><stop offset=".55" stop-color="' + v.color + '" stop-opacity=".07"/><stop offset="1" stop-color="' + v.color + '" stop-opacity="0"/></linearGradient>').join('') +
      Object.keys(KIND_STYLE).map((k) => '<marker id="pa-' + k + '" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" class="pa pa-' + k + '"/></marker>').join('') +
      '<pattern id="pgrid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1.1" class="gdot"/></pattern></defs>';
  }

  function cardSvg(doc, ix, m, p, opts) {
    const g = m.g, cat = (P.KINDS[g.kind] || P.KINDS.other).cat;
    const x = p.x, y = p.y, w = m.w, h = m.h;
    const sub = cardSub(doc, ix, m);
    const chars = Math.floor(w / 7.4);
    const mk = g.make ? cut(makeTag(g.make).toUpperCase(), 10) : '';
    let s = '<g class="pcard cat-' + cat + '" data-g="' + g.id + '"' + (m.mem.length ? ' data-m="' + m.mem.map((x) => x.g.id).join(',') + '"' : '') + '>' +
      '<rect class="cbg" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10"/>' +
      '<rect class="cgl" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="url(#pg-' + cat + ')"/>' +
      '<rect class="cbd" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10"/>' +
      '<rect class="cdrag" x="' + x + '" y="' + y + '" width="' + w + '" height="' + HEAD + '" rx="10"/>' +
      '<text class="ct" x="' + (x + 12) + '" y="' + (y + 22) + '">' + esc(cut(g.name, chars - (mk ? mk.length + 3 : 0))) + '</text>' +
      '<text class="cs" x="' + (x + 12) + '" y="' + (y + 39) + '">' + esc(cut(sub, chars + 3)) + '</text>' +
      (mk ? (() => { const mw = mk.length * 6 + 12; return '<g class="mk"><rect x="' + (x + w - 12 - mw) + '" y="' + (y + 10) + '" width="' + mw + '" height="16" rx="4"/><text x="' + (x + w - 12 - mw / 2) + '" y="' + (y + 21.5) + '" text-anchor="middle">' + esc(mk) + '</text></g>'; })() : '') +
      '<title>' + esc(g.name + (sub ? ' · ' + sub : '')) + '</title>';
    if (m.rows.length) s += '<line class="csep" x1="' + x + '" x2="' + (x + w) + '" y1="' + (y + HEAD - 2) + '" y2="' + (y + HEAD - 2) + '"/>';
    const half = w / 2;
    m.rows.forEach((r, n) => {
      const ry = y + HEAD + n * ROW + ROW / 2;
      if (r.more) {
        const t = r.freeIn || r.freeOut ? '+ ' + [r.freeIn ? r.freeIn + ' free in' : '', r.freeOut ? r.freeOut + ' free out' : ''].filter(Boolean).join(' · ') + '  ▾' : 'Show used only  ▴';
        s += '<g class="cmore" data-open="' + g.id + '"><rect x="' + (x + 6) + '" y="' + (ry - 9) + '" width="' + (w - 12) + '" height="18" rx="5"/><text x="' + (x + w / 2) + '" y="' + (ry + 4) + '" text-anchor="middle">' + esc(t) + '</text></g>';
        return;
      }
      if (r.head) { s += '<text class="chd" x="' + (x + 12) + '" y="' + (ry + 4) + '">' + esc(r.head.toUpperCase()) + '</text>'; return; }
      if (r.slink) {
        const sl = r.slink, u = P.upstream(doc, ix, sl.sb.id, sl.i);
        const t = sl.sb.name + ' ' + sl.sb.ins[sl.i] + (u.source ? ' · ' + u.source : u.mic ? ' · ' + u.mic : '');
        s += '<g class="crow slk' + (sl.used ? ' used' : '') + '" data-g="' + sl.sb.id + '"><text x="' + (x + 12) + '" y="' + (ry + 4) + '"><tspan class="pn">Ch ' + sl.ch + '</tspan> ← ' + esc(cut(t, Math.floor((w - 60) / 6.1))) + '</text></g>';
        return;
      }
      if (r.pack) {
        const pg = r.pack.g;
        s += '<g class="crow mem" data-mem="' + pg.id + '"><rect class="mbg" x="' + (x + 6) + '" y="' + (ry - 9) + '" width="' + (w - 12) + '" height="18" rx="5"/><text x="' + (x + 14) + '" y="' + (ry + 4) + '"><tspan class="pn">Pack</tspan> ' + esc(cut([pg.person || pg.use || pg.name, pg.person && pg.use ? pg.use : '', pg.phones].filter(Boolean).join(' · '), Math.floor((w - 50) / 6.1))) + '</text><title>' + esc(pg.name) + '</title></g>';
        return;
      }
      if (r.member) {
        // a receiver channel with its mic
        const tg = r.member.g;
        const t = [tg.person || tg.use || tg.name, tg.capsule || tg.model, tg.freq].filter(Boolean).join(' · ');
        s += '<g class="crow mem" data-mem="' + tg.id + '"><rect class="mbg" x="' + (x + 6) + '" y="' + (ry - 9) + '" width="' + (half + 30) + '" height="18" rx="5"/><text x="' + (x + 12) + '" y="' + (ry + 4) + '"><tspan class="pn">' + esc(g.ins[r.in]) + '</tspan> ' + esc(cut(t, Math.floor((half + 6) / 6.1) - g.ins[r.in].length)) + '</text><title>' + esc(tg.name + (t ? ': ' + t : '')) + '</title></g>';
      } else if (r.in != null) {
        const t = socketText(doc, ix, g, 'in', r.in);
        const used = !!ix.into.get(g.id + ':' + r.in);
        const room = r.out != null ? half - 18 : w - 30;
        s += '<g class="sk in' + (used ? ' used' : '') + '" data-g="' + g.id + '" data-p="' + r.in + '"><circle class="hitc" cx="' + x + '" cy="' + ry + '" r="9"/><circle class="dot" cx="' + x + '" cy="' + ry + '" r="4.5"/><text x="' + (x + 10) + '" y="' + (ry + 4) + '"><tspan class="pn">' + esc(g.ins[r.in]) + '</tspan>' + (t ? ' ' + esc(cut(t, Math.floor(room / 6.1) - g.ins[r.in].length)) : '') + '</text><title>' + esc(g.name + ' ' + g.ins[r.in] + (t ? ': ' + t : ' (free)')) + '</title></g>';
      }
      if (r.out != null) {
        const t = socketText(doc, ix, g, 'out', r.out);
        const used = !!((ix.from.get(g.id + ':' + r.out) || []).length);
        const room = r.in != null ? (r.member ? half - 50 : half - 18) : w - 30;
        s += '<g class="sk out' + (used || (g.feeds || {})[r.out] ? ' used' : '') + '" data-g="' + g.id + '" data-p="' + r.out + '"><circle class="hitc" cx="' + (x + w) + '" cy="' + ry + '" r="9"/><circle class="dot" cx="' + (x + w) + '" cy="' + ry + '" r="4.5"/><text x="' + (x + w - 10) + '" y="' + (ry + 4) + '" text-anchor="end">' + (t && room > 30 ? esc(cut(t, Math.floor(room / 6.1) - g.outs[r.out].length)) + ' ' : '') + '<tspan class="pn">' + esc(g.outs[r.out]) + '</tspan></text><title>' + esc(g.name + ' ' + g.outs[r.out] + (t ? ': ' + t : ' (free)')) + '</title></g>';
      }
    });
    if (m.link) {
      s += '<rect class="ldot" data-g="' + g.id + '" x="' + (x + w - 5) + '" y="' + (y + LINKY - 5) + '" width="10" height="10" rx="2" transform="rotate(45 ' + (x + w) + ' ' + (y + LINKY) + ')"><title>Link (SLink, AES50, Dante): drag to a console, stage box or network</title></rect>';
      s += '<rect class="ldot" data-g="' + g.id + '" x="' + (x - 5) + '" y="' + (y + LINKY - 5) + '" width="10" height="10" rx="2" transform="rotate(45 ' + x + ' ' + (y + LINKY) + ')"><title>Link</title></rect>';
    }
    if (opts.edit) s += '<g class="hand" data-g="' + g.id + '"><circle cx="' + (x + w - 2) + '" cy="' + (y + HEAD - 2) + '" r="9"/><path d="M' + (x + w - 6) + ' ' + (y + HEAD - 2) + 'h8M' + (x + w - 1) + ' ' + (y + HEAD - 6) + 'l4 4-4 4"/><title>Drag onto another card to connect</title></g>';
    return s + '</g>';
  }

  /**
   * Build the whole drawing. view: { doc, edit, drag: {ids:Set, dx, dy} | null, cache }
   * Returns { svg, bbox, routes, models, ix, E }.
   */
  function draw(doc, view) {
    const { ix, models } = place(doc);
    const drag = view.drag;
    const pos = (g) => (drag && drag.ids.has(g.id) ? { x: g.x + drag.dx, y: g.y + drag.dy } : { x: g.x, y: g.y });
    const E = edges(doc, ix, models);
    const keep = drag ? (e) => !drag.ids.has(e.ma.g.id) && !drag.ids.has(e.mb.g.id) : null;
    const routes = routeAll(E, models, pos, view.cache, keep);
    // lines, with hops over the vertical runs of lines drawn before them
    let lines = '', labels = '';
    const verts = [];
    const order = E.slice().sort((p, q) => (q.link - p.link));
    order.forEach((e) => {
      const r = routes.get(e.id); if (!r) return;
      const pts = r.pts;
      const d = pathD(pts, e.link ? null : verts);
      for (let i = 1; i < pts.length; i++) if (pts[i].x === pts[i - 1].x) verts.push({ x: pts[i].x, y1: pts[i - 1].y, y2: pts[i].y });
      lines += '<g class="pe pe-' + e.kind + (e.link ? ' trunk' : '') + '" data-c="' + e.id + '"><path class="hit" d="' + d + '"/><path class="ln" d="' + d + '"' + (e.link ? '' : ' marker-end="url(#pa-' + e.kind + ')"') + '/></g>';
      if (e.label) {
        // on the longest straight run
        let best = null;
        for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y); if (a.y === b.y && (!best || len > best.len)) best = { a, b, len }; }
        if (best && (best.len > 50 || e.link)) {
          const t = e.link ? e.label : cut(e.label, Math.max(4, Math.floor((best.len - 16) / 6.4)));
          const mx = e.link ? (best.a.x + best.b.x) / 2 : Math.min(best.a.x, best.b.x) + 14;
          labels += '<text class="pl pl-' + e.kind + '" x="' + mx + '" y="' + (best.a.y - 5) + '"' + (e.link ? ' text-anchor="middle"' : '') + '>' + esc(t) + '</text>';
        }
      }
    });
    let cards = '';
    const all = [...models.values()];
    all.forEach((m) => { cards += cardSvg(doc, ix, m, pos(m.g), view); });
    const rects = all.map((m) => { const p = pos(m.g); return { x: p.x, y: p.y, w: m.w, h: m.h }; });
    const bbox = rects.length ? { x0: Math.min(...rects.map((r) => r.x)) - 30, y0: Math.min(...rects.map((r) => r.y)) - 30, x1: Math.max(...rects.map((r) => r.x + r.w)) + 30, y1: Math.max(...rects.map((r) => r.y + r.h)) + 30 } : { x0: 0, y0: 0, x1: 640, y1: 320 };
    // the key, under the drawing
    const ky = bbox.y1 + 26, kx = bbox.x0 + 4;
    let keyHtml = '<g class="pkey"><text class="kh" x="' + kx + '" y="' + ky + '">KEY</text>';
    Object.entries(P.CATS).forEach(([, v], i) => { const x = kx + (i % 4) * 150, y = ky + 22 + Math.floor(i / 4) * 22; keyHtml += '<rect x="' + x + '" y="' + (y - 11) + '" width="16" height="14" rx="3" fill="' + v.color + '" opacity=".75"/><text x="' + (x + 24) + '" y="' + y + '">' + esc(v.label) + '</text>'; });
    Object.entries(KIND_STYLE).forEach(([k, v], i) => { const x = kx + (i % 4) * 150, y = ky + 78 + Math.floor(i / 4) * 22; keyHtml += '<g class="pe pe-' + k + '"><path class="ln" d="M' + x + ' ' + (y - 4) + 'h28" marker-end="url(#pa-' + k + ')"/></g><text x="' + (x + 36) + '" y="' + y + '">' + esc(v) + '</text>'; });
    keyHtml += '</g>';
    bbox.y1 = ky + 110; bbox.x1 = Math.max(bbox.x1, kx + 600);
    const empty = !all.length ? '<text class="pempty" x="320" y="150" text-anchor="middle">' + (view.edit ? 'Add equipment from the right, or right-click here.' : 'Nothing on the stage patch yet.') + '</text>' : '';
    const grid = view.edit ? '<rect class="pgridbg" x="' + (bbox.x0 - 4000) + '" y="' + (bbox.y0 - 4000) + '" width="' + (bbox.x1 - bbox.x0 + 8000) + '" height="' + (bbox.y1 - bbox.y0 + 8000) + '" fill="url(#pgrid)"/>' : '';
    return { svg: defs() + grid + '<g class="pes">' + lines + '</g>' + labels + cards + keyHtml + empty + '<g id="pguides"></g>', bbox, routes, models, ix, E };
  }

  // ================= following a signal =================
  /** Everything one gear (or one socket, or one cable) is connected to, upstream and downstream. */
  function trace(doc, ix, start) {
    const gear = new Set(), cables = new Set();
    const linkCables = (gid) => (ix.links.get(gid) || []);
    const toConsole = (sb) => linkCables(sb.id).forEach(({ c, other }) => { cables.add(c.id); const o = ix.G.get(other); if (o) { gear.add(o.id); if (o.kind === 'network') linkCables(o.id).forEach((l2) => { const g2 = ix.G.get(l2.other); if (g2 && g2.kind === 'console') { cables.add(l2.c.id); gear.add(g2.id); } }); } });
    const down = (g, j, depth) => {
      if (depth > 12) return;
      for (const c of ix.from.get(g.id + ':' + j) || []) {
        cables.add(c.id);
        const b = ix.G.get(c.b); if (!b) continue;
        gear.add(b.id);
        const k = P.KINDS[b.kind];
        if (b.kind === 'stagebox') toConsole(b);
        else if (k.pass === 'same') down(b, c.bp, depth + 1);
        else if (k.pass === 'all' || k.pass === 'rf') b.outs.forEach((_, jj) => down(b, jj, depth + 1));
      }
    };
    const up = (g, i, depth) => {
      if (depth > 12) return;
      const c = ix.into.get(g.id + ':' + i); if (!c) return;
      cables.add(c.id);
      const a = ix.G.get(c.a); if (!a) return;
      gear.add(a.id);
      const k = P.KINDS[a.kind];
      if (a.kind === 'stagebox') toConsole(a);
      else if (k.pass === 'same') up(a, c.ap, depth + 1);
      else if (k.pass === 'all' || k.pass === 'rf') a.ins.forEach((_, ii) => up(a, ii, depth + 1));
    };
    const whole = (g) => {
      gear.add(g.id);
      g.ins.forEach((_, i) => up(g, i, 0));
      g.outs.forEach((_, j) => down(g, j, 0));
      if (P.KINDS[g.kind].link) linkCables(g.id).forEach(({ c, other }) => { cables.add(c.id); gear.add(other); });
    };
    if (start.cable) {
      const c = start.cable;
      cables.add(c.id);
      const a = ix.G.get(c.a), b = ix.G.get(c.b);
      if (a) gear.add(a.id); if (b) gear.add(b.id);
      if (c.ap === 'link' || c.bp === 'link') return { gear, cables };
      if (a) { const k = P.KINDS[a.kind]; if (k.pass === 'same') up(a, c.ap, 0); else if (k.pass === 'all' || k.pass === 'rf') a.ins.forEach((_, i) => up(a, i, 0)); if (a.kind === 'stagebox') toConsole(a); }
      if (b) { const k = P.KINDS[b.kind]; if (b.kind === 'stagebox') toConsole(b); else if (k.pass === 'same') down(b, c.bp, 0); else if (k.pass === 'all' || k.pass === 'rf') b.outs.forEach((_, j) => down(b, j, 0)); }
    } else if (start.socket) {
      const g = ix.G.get(start.socket.g);
      gear.add(g.id);
      if (start.socket.side === 'in') { up(g, start.socket.p, 0); if (g.kind === 'stagebox') toConsole(g); else if (P.KINDS[g.kind].pass === 'same') down(g, start.socket.p, 0); }
      else { down(g, start.socket.p, 0); if (P.KINDS[g.kind].pass === 'same') up(g, start.socket.p, 0); if (g.kind === 'stagebox') toConsole(g); }
    } else (start.gear || []).forEach((id) => { const g = ix.G.get(id); if (g) whole(g); });
    return { gear, cables };
  }

  // ================= the lists =================
  const ch = (r) => (r.ch == null ? '—' : String(r.ch));
  function reportHtml(doc, report, filter, opts = {}) {
    const terms = String(filter || '').split(',').map(key).filter(Boolean);
    const hit = (n) => terms.some((t) => key(n).includes(t));
    const match = (...names) => !terms.length || names.some(hit);
    const T = (heads, rows, empty) => rows.length
      ? '<div class="tscroll"><table class="grid prep"><thead><tr>' + heads.map((h) => '<th' + (h[1] ? ' class="nw"' : '') + '>' + h[0] + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
      : '<div class="note" style="padding:10px 2px">' + empty + '</div>';
    const tr = (gids, cells) => '<tr data-gs="' + gids.filter(Boolean).join(',') + '">' + cells.map((c) => '<td>' + c + '</td>').join('') + '</tr>';
    if (report === 'inputs') {
      const all = P.inputs(doc).filter((r) => match(r.console.name, r.via.name, r.up.source, r.up.mic));
      const used = all.filter((r) => r.used || opts.spares);
      const spare = all.length - all.filter((r) => r.used).length;
      return T([['Ch', 1], ['Source'], ['Mic / DI'], ['Wireless'], ['Stage box'], ['Console']], used.map((r) => {
        const u = r.up;
        const wl = u.tx ? esc([u.capsule, u.freq && u.freq + ' MHz', u.receiver && u.receiver.name + ' ' + u.rxch].filter(Boolean).join(' · ')) : '';
        return tr([r.via.id, ...u.chain.map((g) => g.id)], ['<b>' + ch(r) + '</b>', esc([u.source, u.person].filter(Boolean).join(' · ') || (r.used ? '' : '—')), esc(u.mic || ''), wl, esc(r.via.kind === 'console' ? r.port : r.via.name + ' ' + r.port), esc(r.console.name)]);
      }), 'No inputs yet. Draw a mic or receiver to a stage box or the console.') + (spare && !opts.spares && !opts.noSpare ? '<div class="note" style="margin-top:6px">' + spare + ' spare stage box input' + (spare === 1 ? '' : 's') + ' not listed.</div>' : '');
    }
    if (report === 'outputs') {
      const rows = P.outputs(doc).filter((r) => match(r.console.name, r.socket.name, r.mix, r.chain));
      return T([['Mix'], ['Socket'], ['Goes to']], rows.map((r) => tr([r.socket.id, ...r.dest.map((d) => d.g.id)], ['<b>' + esc(r.mix || '—') + '</b>', esc(r.socket.kind === 'console' ? r.socket.name + ' ' + r.port : r.socket.name + ' ' + r.port), esc(r.chain || '—')])), 'No outputs yet. Pick a mix on a console or stage box output and draw where it goes.');
    }
    if (report === 'wireless') {
      const rows = P.wireless(doc).filter((r) => match(r.tx.name, r.tx.use, r.rx && r.rx.name));
      return T([['Person'], ['Used for'], ['Transmitter'], ['Capsule'], ['Frequency'], ['Receiver'], ['Console input']], rows.map((r) => tr([r.tx.id, r.rx && r.rx.id], [esc(r.tx.person || ''), esc(r.tx.use || ''), esc(r.tx.name), esc(r.tx.capsule || ''), esc(r.tx.freq ? r.tx.freq + ' MHz' : ''), esc(r.rx ? r.rx.name + ' ' + r.rxch : '—'), esc(r.land && r.land.console ? r.land.console.name + ' ' + r.land.ch + ' (' + r.land.via + ')' : r.land ? r.land.via : '')])), 'No wireless mics yet.');
    }
    if (report === 'iem') {
      const rows = P.inears(doc).filter((r) => match(r.tx.name, r.mix, ...r.packs.map((p) => p.use)));
      return T([['Transmitter'], ['Mode'], ['Frequency'], ['Mix'], ['Fed from'], ['Packs']], rows.map((r) => tr([r.tx.id, ...r.packs.map((p) => p.id)], ['<b>' + esc(r.tx.name) + '</b>', esc(r.tx.mode || ''), esc(r.tx.freq ? r.tx.freq + ' MHz' : ''), esc(r.mix || '—'), esc(r.feeds.filter(Boolean).map((x) => x.from.name + ' ' + x.socket).join(', ')), esc(r.packs.map((p) => [p.person, p.use].filter(Boolean).join(' · ') || p.name).join(', '))])), 'No in-ear transmitters yet.');
    }
    if (report === 'cables') {
      // with several names (SQ-5, DriveRack PA2, Crown XLi 2500) a cable is listed when both ends are among them
      const rows = P.cableList(doc).filter((r) => !terms.length || (terms.length > 1 ? hit(r.a.name) && hit(r.b.name) : match(r.a.name, r.b.name, r.c.label)));
      return T([['Label'], ['From'], ['To'], ['Type'], ['Length']], rows.map((r) => tr([r.a.id, r.b.id], [esc(r.c.label || ''), esc(r.from), esc(r.to), esc(KIND_STYLE[r.c.kind] || r.c.kind), esc(r.c.length || '')])), 'No cables yet.');
    }
    return '';
  }
  const REPORTS = [['inputs', 'Inputs'], ['outputs', 'Outputs'], ['wireless', 'Wireless'], ['iem', 'In-ears'], ['cables', 'Cables']];


  // ================= the page =================
  async function view(qs) {
    setTitle('Stage patch');
    let data = await get('/api/patch');
    await loadDevices();
    const st = {
      doc: data.doc, version: data.version, edit: false, sel: [], selCable: null, selSocket: null,
      undo: [], redo: [], tf: null, report: 'inputs', saving: false, dirtySave: false, pending: null, spares: false,
      snap: true, cache: null, drag: null, placeAt: null
    };
    try { st.snap = localStorage.getItem('lg-psnap') !== '0'; } catch (e) { /* private mode */ }
    const canEdit = data.canEdit;
    const wide = () => matchMedia('(min-width: 1024px)').matches;
    app.innerHTML = `<div class="patchv">
      <div class="printhead"><img src="/icons/livegenie-glyph.svg" alt=""><div><b>LiveGenie</b><span>${esc(((S.state && S.state.org && S.state.org.name) ? S.state.org.name + ' · ' : '') + 'Stage patch')}</span></div><div class="pm">Version ${st.version}<br>Printed ${esc(new Date().toLocaleString())}</div></div>
      <div class="crumbs"><a href="#/">Home</a><span>/</span></div>
      <div class="bar pbar"><div class="grow"><div class="ptitle" id="ptl"></div></div>
        ${canEdit ? '<button class="btn" id="pedit">' + icon('edit') + '<span>Edit</span></button>' : ''}
        <button class="btn ghost" id="ppdf" title="Export PDF">${icon('pdf')}<span class="hide-sm">PDF</span></button>
        ${canEdit ? '<button class="btn ghost" id="phist" title="Versions">' + icon('clock') + '<span class="hide-sm">History</span></button>' : ''}</div>
      <div class="ptools hide" id="ptools">
        <button class="ghost" id="pun" title="Undo (Ctrl+Z)">↶ Undo</button><button class="ghost" id="pre" title="Redo">↷ Redo</button>
        <span class="tsep"></span>
        <button class="ghost" id="ptidy" title="Line everything up left to right">${icon('list')}Tidy</button>
        <label class="tog sm" title="Cards snap to the grid and line up with each other. Hold Alt to place freely."><input type="checkbox" id="psnap"${st.snap ? ' checked' : ''}> Snap</label>
        <span class="palign hide" id="palign"><span class="tsep"></span>
          <button class="ghost" data-al="left" title="Line up left edges">⇤ Left</button><button class="ghost" data-al="top" title="Line up top edges">⤒ Top</button>
          <button class="ghost" data-al="center" title="Line up centres">↔ Centre</button><button class="ghost" data-al="vdist" title="Space evenly, top to bottom">⇕ Space</button><button class="ghost" data-al="hdist" title="Space evenly, left to right">⇔ Space</button></span>
        <span class="note" id="psave"></span><span class="grow"></span>
        <span class="note phint">Drag a card to move it · drag its <b>→</b> onto another card to connect · right-click for more</span></div>
      <div class="pmain"><div class="pcanvas" id="pcv"><svg id="psvg"><g id="pvp"></g><path id="ptmp" class="ptmp" d=""/><rect id="pmq" class="pmq" x="0" y="0" width="0" height="0"/></svg>
        <div class="pzoom"><button id="pzi" title="Zoom in">+</button><button id="pzo" title="Zoom out">−</button><button id="pzf" title="Fit">⤢</button></div>
        <button class="fab padd hide" id="padd" aria-label="Add equipment">${icon('plus')}</button></div>
        <aside class="ppane" id="ppane"></aside></div>
      <div class="pchecks" id="pchk"></div>
      <div class="preports card"><div class="seg" id="prt">${REPORTS.map((r) => '<button data-r="' + r[0] + '"' + (r[0] === st.report ? ' class="on"' : '') + '>' + r[1] + '</button>').join('')}</div>
        <label class="tog" id="pspl" style="margin-left:auto"><input type="checkbox" id="psp"> Spare inputs</label>
        <div id="prbody"></div><div class="printonly" id="prall"></div></div>
    </div>`;
    const svg = $('#psvg'), vp = $('#pvp'), cv = $('#pcv');
    let D = null;   // the last drawing

    // ---------- painting ----------
    function paintTitle() {
      const d = st.doc;
      $('#ptl').innerHTML = '<div class="pkicker">STAGE PATCH</div><h1 class="title">' + esc(d.title) + '</h1>' + (d.subtitle ? '<div class="note">' + esc(d.subtitle) + '</div>' : '<div class="note">Click any piece of gear or cable to follow its signal.</div>') +
        (st.edit ? '<button class="linkbtn" id="ptedit">Edit title</button>' : '');
      const te = $('#ptedit'); if (te) te.addEventListener('click', titleDialog);
    }
    function paintDrawing() {
      D = draw(st.doc, { edit: st.edit, drag: st.drag, cache: st.cache });
      st.cache = D.routes;
      vp.innerHTML = D.svg;
      svg.classList.toggle('editing', st.edit);
      highlight();
    }
    function paint(keepView) {
      paintDrawing();
      if (!keepView || !st.tf) fit(); else apply();
      paintChecks(); paintReport();
    }
    function paintChecks() {
      const list = P.checks(st.doc);
      $('#pchk').innerHTML = list.length ? list.map((c, i) => '<button class="pchk ' + c.level + '" data-i="' + i + '">' + icon(c.level === 'note' ? 'info' : 'warn') + '<span>' + esc(c.text) + '</span></button>').join('') : '';
      $$('#pchk [data-i]').forEach((b) => b.addEventListener('click', () => { const c = list[Number(b.dataset.i)]; select({ gear: c.gear }); focusGear(c.gear[0]); }));
    }
    function paintReport() {
      $('#prbody').innerHTML = reportHtml(st.doc, st.report, '', { spares: st.spares });
      $('#pspl').classList.toggle('hide', st.report !== 'inputs');
      $('#prall').innerHTML = REPORTS.map((r) => '<h2>' + r[1] + '</h2>' + reportHtml(st.doc, r[0], '', { noSpare: true })).join('');
      $$('#prbody tr[data-gs]').forEach((tr) => tr.addEventListener('click', () => { const ids = [...new Set(tr.dataset.gs.split(',').filter(Boolean))]; select({ gear: ids }); focusGear(ids[0]); cv.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
    }
    const gearOf = (id) => st.doc.gear.find((g) => g.id === id);
    /** The card a gear shows on (a mic inside a receiver shows on the receiver). */
    const cardOf = (id) => { const g = gearOf(id); const h = g && P.hostOf(st.doc, g); return h ? h.id : id; };

    // ---------- selection and highlighting ----------
    function select(s, opts = {}) {
      st.sel = s && s.gear ? s.gear.slice() : []; st.selCable = s && s.cable ? s.cable : null; st.selSocket = s && s.socket ? s.socket : null;
      highlight(); paintPane(); paintAlign();
      if (!wide() && !opts.noSheet && (st.sel.length === 1 || st.selCable)) sheet();
    }
    function paintAlign() { $('#palign').classList.toggle('hide', !(st.edit && st.sel.length > 1)); }
    function highlight() {
      if (!D) return;
      const on = st.sel.length || st.selCable || st.selSocket;
      svg.classList.toggle('dim', !!on && !st.edit);     // while editing, the rest stays bright to wire to
      $$('.on, .sel', vp).forEach((x) => x.classList.remove('on', 'sel'));
      if (!on) return;
      const t = trace(st.doc, D.ix, st.selCable ? { cable: st.doc.cables.find((c) => c.id === st.selCable) } : st.selSocket ? { socket: st.selSocket } : { gear: st.sel });
      $$('.pcard', vp).forEach((el) => {
        const ids = [el.dataset.g].concat(el.dataset.m ? el.dataset.m.split(',') : []);
        el.classList.toggle('on', ids.some((id) => t.gear.has(id)));
        el.classList.toggle('sel', st.sel.includes(el.dataset.g));
      });
      $$('.crow.mem', vp).forEach((el) => { el.classList.toggle('on', t.gear.has(el.dataset.mem)); el.classList.toggle('sel', st.sel.includes(el.dataset.mem)); });
      $$('.pe', vp).forEach((el) => { if (el.dataset.c) el.classList.toggle('on', t.cables.has(el.dataset.c)); });
      $$('.sk', vp).forEach((el) => el.classList.toggle('on', !!st.selSocket && el.dataset.g === st.selSocket.g && Number(el.dataset.p) === st.selSocket.p && el.classList.contains(st.selSocket.side)));
    }

    // ---------- pan and zoom ----------
    function apply() { const t = 'translate(' + st.tf.x + ',' + st.tf.y + ') scale(' + st.tf.k + ')'; vp.setAttribute('transform', t); $('#ptmp').setAttribute('transform', t); $('#pmq').setAttribute('transform', t); }
    function fit() {
      const b = D.bbox, W = b.x1 - b.x0, H = b.y1 - b.y0;
      const r0 = cv.getBoundingClientRect();
      // readable first: shrink to fit the width, but not so far the text gets too small (pan for the rest)
      const k = Math.max(wide() ? 0.6 : 0.4, Math.min(1.1, (r0.width - 20) / W));
      const maxH = window.innerHeight - (wide() ? 150 : 210);
      cv.style.height = Math.round(Math.max(380, Math.min(maxH, H * k + 24))) + 'px';
      const r = cv.getBoundingClientRect();
      st.tf = { k, x: Math.max(10, (r.width - W * k) / 2) - b.x0 * k, y: 10 - b.y0 * k };
      apply();
    }
    function focusGear(id) {
      const m = D && D.models.get(cardOf(id));
      if (!m) return;
      const r = cv.getBoundingClientRect(), k = st.tf.k;
      const sx = st.tf.x + m.g.x * k, sy = st.tf.y + m.g.y * k;
      if (sx > 20 && sx + m.w * k < r.width - 20 && sy > 20 && sy + Math.min(m.h, 200) * k < r.height - 20) return;
      st.tf.x = r.width * 0.3 - m.g.x * k; st.tf.y = r.height * 0.3 - m.g.y * k; apply();
    }
    const world = (cx, cy) => { const r = svg.getBoundingClientRect(); return { x: (cx - r.left - st.tf.x) / st.tf.k, y: (cy - r.top - st.tf.y) / st.tf.k }; };
    function zoomAt(f, cx, cy) {
      const r = svg.getBoundingClientRect(); const px = cx - r.left, py = cy - r.top;
      const k = Math.max(0.2, Math.min(3, st.tf.k * f));
      st.tf.x = px - (px - st.tf.x) * (k / st.tf.k); st.tf.y = py - (py - st.tf.y) * (k / st.tf.k); st.tf.k = k; apply();
    }
    svg.addEventListener('wheel', (e) => { e.preventDefault(); if (e.ctrlKey || e.metaKey || !e.deltaX) zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); else { st.tf.x -= e.deltaX; st.tf.y -= e.deltaY; apply(); } }, { passive: false });
    $('#pzi').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2); });
    $('#pzo').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(0.8, r.left + r.width / 2, r.top + r.height / 2); });
    $('#pzf').addEventListener('click', fit);

    // ---------- moving cards: grid, smart guides ----------
    function guidesFor(ids, dx, dy, free) {
      // the moving group's box
      const mv = [...ids].map((id) => D.models.get(id)).filter(Boolean);
      if (!mv.length) return { dx, dy, lines: [] };
      const box = { x0: Math.min(...mv.map((m) => m.g.x)) + dx, y0: Math.min(...mv.map((m) => m.g.y)) + dy, x1: Math.max(...mv.map((m) => m.g.x + m.w)) + dx, y1: Math.max(...mv.map((m) => m.g.y + m.h)) + dy };
      if (free || !st.snap) return { dx, dy, lines: [] };
      const others = [...D.models.values()].filter((m) => !ids.has(m.g.id));
      const tol = 7 / st.tf.k;
      const xs = [box.x0, (box.x0 + box.x1) / 2, box.x1], ys = [box.y0, (box.y0 + box.y1) / 2, box.y1];
      let bx = null, by = null;
      others.forEach((o) => {
        const ox = [o.g.x, o.g.x + o.w / 2, o.g.x + o.w], oy = [o.g.y, o.g.y + o.h / 2, o.g.y + o.h];
        xs.forEach((v, i) => ox.forEach((w, j) => { if ((i === j || (i !== 1 && j !== 1)) && Math.abs(v - w) < tol && (!bx || Math.abs(v - w) < Math.abs(bx.d))) bx = { d: w - v, at: w, o }; }));
        ys.forEach((v, i) => oy.forEach((w, j) => { if ((i === j || (i !== 1 && j !== 1)) && Math.abs(v - w) < tol && (!by || Math.abs(v - w) < Math.abs(by.d))) by = { d: w - v, at: w, o }; }));
      });
      const lines = [];
      if (bx) { dx += bx.d; lines.push({ x1: bx.at, y1: Math.min(box.y0 + (by ? by.d : 0), bx.o.g.y) - 14, x2: bx.at, y2: Math.max(box.y1 + (by ? by.d : 0), bx.o.g.y + bx.o.h) + 14 }); }
      else { const g0 = mv[0].g; dx = snap(g0.x + dx) - g0.x; }
      if (by) { dy += by.d; lines.push({ x1: Math.min(box.x0 + dx - (bx ? 0 : 0), by.o.g.x) - 14, y1: by.at, x2: Math.max(box.x1 + dx, by.o.g.x + by.o.w) + 14, y2: by.at }); }
      else { const g0 = mv[0].g; dy = snap(g0.y + dy) - g0.y; }
      return { dx, dy, lines };
    }
    function paintGuides(lines) {
      const gl = $('#pguides', vp); if (!gl) return;
      gl.innerHTML = lines.map((l) => '<line class="pguide" x1="' + l.x1 + '" y1="' + l.y1 + '" x2="' + l.x2 + '" y2="' + l.y2 + '"/>').join('');
    }
    let rafPending = false;
    function dragFrame() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; if (!st.drag) return; paintDrawing(); paintGuides(st.drag.lines || []); }); }

    // ---------- pointer: pan, pinch, tap, move, connect, select a box ----------
    const pts = new Map();
    let gesture = null, longTimer = null;
    const isTouch = (e) => e.pointerType === 'touch';
    svg.addEventListener('pointerdown', (e) => {
      closeMenu();
      if (e.button === 2) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      clearTimeout(longTimer);
      if (pts.size === 2) { const [p, q] = [...pts.values()]; gesture = { pinch: true, d: Math.hypot(p.x - q.x, p.y - q.y), k: st.tf.k }; return; }
      const t = e.target;
      const w0 = world(e.clientX, e.clientY);
      // a long press on a phone opens the menu
      if (isTouch(e)) longTimer = setTimeout(() => { if (gesture && !gesture.moved) { const g = gesture; gesture = null; pts.clear(); if (g.drag) { st.drag = null; } menuAt(t, e.clientX, e.clientY); } }, 560);
      if (st.edit) {
        const src = t.closest('.sk.out') || t.closest('.hand') || t.closest('.ldot');
        if (src) {
          e.preventDefault(); svg.setPointerCapture(e.pointerId);
          const isLink = src.classList.contains('ldot'), isHand = src.classList.contains('hand');
          let x0 = w0.x, y0 = w0.y;
          if (!isHand && !isLink) { const m = D.models.get(src.dataset.g); x0 = m.g.x + m.w; y0 = m.g.y + m.outY[Number(src.dataset.p)]; }
          gesture = { connect: true, gid: src.dataset.g, port: isLink ? 'link' : isHand ? null : Number(src.dataset.p), x0, y0, sx: e.clientX, sy: e.clientY, moved: false };
          return;
        }
        const card = t.closest('.pcard');
        if (card && !t.closest('.cmore') && !t.closest('.sk.in')) {
          e.preventDefault(); svg.setPointerCapture(e.pointerId);
          const id = card.dataset.g;
          const ids = st.sel.includes(id) && st.sel.length > 1 ? new Set(st.sel.filter((x) => D.models.has(x))) : new Set([id]);
          gesture = { move: true, id, ids, sx: e.clientX, sy: e.clientY, w0, moved: false, target: t, shift: e.shiftKey };
          return;
        }
        if (!card && e.shiftKey) { e.preventDefault(); svg.setPointerCapture(e.pointerId); gesture = { marquee: true, w0, sx: e.clientX, sy: e.clientY, moved: false }; return; }
      }
      gesture = { pan: true, sx: e.clientX, sy: e.clientY, x: st.tf.x, y: st.tf.y, moved: false, target: t, shift: e.shiftKey };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture) return;
      if (gesture.pinch && pts.size === 2) {
        const [p, q] = [...pts.values()]; const d = Math.hypot(p.x - q.x, p.y - q.y);
        zoomAt((gesture.k * d / gesture.d) / st.tf.k, (p.x + q.x) / 2, (p.y + q.y) / 2); return;
      }
      const far = Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 4;
      if (far && !gesture.moved) { gesture.moved = true; clearTimeout(longTimer); }
      if (!gesture.moved) return;
      const edgePan = () => {
        const r = svg.getBoundingClientRect(), edge = 36, step = 12;
        let dx = 0, dy = 0;
        if (e.clientX < r.left + edge) dx = step; else if (e.clientX > r.right - edge) dx = -step;
        if (e.clientY < r.top + edge) dy = step; else if (e.clientY > r.bottom - edge) dy = -step;
        if (dx || dy) { st.tf.x += dx; st.tf.y += dy; apply(); }
      };
      if (gesture.connect) {
        edgePan();
        const w = world(e.clientX, e.clientY);
        $('#ptmp').setAttribute('d', 'M' + gesture.x0 + ' ' + gesture.y0 + 'H' + ((gesture.x0 + w.x) / 2) + 'V' + w.y + 'H' + w.x);
        const over = document.elementFromPoint(e.clientX, e.clientY);
        const oc = over && over.closest && over.closest('.pcard');
        $$('.pcard.target', vp).forEach((x) => x.classList.remove('target'));
        if (oc && oc.dataset.g !== gesture.gid) oc.classList.add('target');
        return;
      }
      if (gesture.move) {
        edgePan();
        const w = world(e.clientX, e.clientY);
        if (!st.drag) { st.dragUndo = JSON.stringify(st.doc); st.sel = st.sel.includes(gesture.id) ? st.sel : [gesture.id]; }
        const r = guidesFor(gesture.ids, w.x - gesture.w0.x, w.y - gesture.w0.y, e.altKey);
        st.drag = { ids: gesture.ids, dx: r.dx, dy: r.dy, lines: r.lines };
        dragFrame();
        return;
      }
      if (gesture.marquee) {
        const w = world(e.clientX, e.clientY), mq = $('#pmq');
        const x = Math.min(w.x, gesture.w0.x), y = Math.min(w.y, gesture.w0.y);
        mq.setAttribute('x', x); mq.setAttribute('y', y); mq.setAttribute('width', Math.abs(w.x - gesture.w0.x)); mq.setAttribute('height', Math.abs(w.y - gesture.w0.y));
        gesture.box = { x0: x, y0: y, x1: x + Math.abs(w.x - gesture.w0.x), y1: y + Math.abs(w.y - gesture.w0.y) };
        return;
      }
      if (gesture.pan) { st.tf.x = gesture.x + e.clientX - gesture.sx; st.tf.y = gesture.y + e.clientY - gesture.sy; apply(); }
    });
    const end = (e) => {
      clearTimeout(longTimer);
      pts.delete(e.pointerId);
      const g = gesture;
      if (!g || pts.size) { if (!pts.size) gesture = null; return; }
      gesture = null;
      $$('.pcard.target', vp).forEach((x) => x.classList.remove('target'));
      if (g.connect) {
        $('#ptmp').setAttribute('d', '');
        if (!g.moved) { st.pending = { gid: g.gid, port: g.port }; toast('Now tap the card or socket it goes to'); markPending(); return; }
        dropOn(document.elementFromPoint(e.clientX, e.clientY), g.gid, g.port);
        return;
      }
      if (g.move) {
        if (!g.moved || !st.drag) { tap(g.target, g.shift); return; }
        const d = st.drag; st.drag = null;
        if (d.dx || d.dy) {
          st.undo.push(st.dragUndo); if (st.undo.length > 120) st.undo.shift(); st.redo = [];
          d.ids.forEach((id) => { const x = gearOf(id); x.x = snapOr(x.x + d.dx); x.y = snapOr(x.y + d.dy); });
          st.cache = null; paintDrawing(); queueSave();
        } else paintDrawing();
        return;
      }
      if (g.marquee) {
        $('#pmq').setAttribute('width', 0); $('#pmq').setAttribute('height', 0);
        if (g.box) { const ids = [...D.models.values()].filter((m) => m.g.x < g.box.x1 && m.g.x + m.w > g.box.x0 && m.g.y < g.box.y1 && m.g.y + m.h > g.box.y0).map((m) => m.g.id); select({ gear: ids }, { noSheet: true }); }
        return;
      }
      if (g.pan && !g.moved) tap(g.target, g.shift);
    };
    const snapOr = (v) => Math.round(v);
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', (e) => { clearTimeout(longTimer); pts.delete(e.pointerId); gesture = null; $('#ptmp').setAttribute('d', ''); if (st.drag) { st.drag = null; paintDrawing(); } });
    svg.addEventListener('contextmenu', (e) => { e.preventDefault(); gesture = null; pts.clear(); menuAt(e.target, e.clientX, e.clientY); });

    function markPending() { $$('.pending', vp).forEach((x) => x.classList.remove('pending')); if (st.pending) $$('.pcard[data-g="' + st.pending.gid + '"]', vp).forEach((x) => x.classList.add('pending')); }
    function tap(t, shift) {
      if (st.pending && st.edit) { const p = st.pending; st.pending = null; markPending(); dropOn(t, p.gid, p.port); return; }
      const more = t.closest('.cmore');
      if (more) { const g = gearOf(more.dataset.open); if (st.edit) change(() => { g.open = !g.open; if (!g.open) delete g.open; }, null, true); else { g.open = !g.open; if (!g.open) delete g.open; st.cache = null; paintDrawing(); } return; }
      const sk = t.closest('.sk'), card = t.closest('.pcard'), edge = t.closest('.pe'), mem = t.closest('.crow.mem'), slk = t.closest('.crow.slk');
      if (mem) return select({ gear: [mem.dataset.mem] });
      if (slk) return select({ gear: [slk.dataset.g] });
      if (sk) return select({ gear: [sk.dataset.g], socket: { g: sk.dataset.g, p: Number(sk.dataset.p), side: sk.classList.contains('in') ? 'in' : 'out' } });
      if (card) {
        if (shift && st.edit) { const id = card.dataset.g; const s = st.sel.includes(id) ? st.sel.filter((x) => x !== id) : st.sel.concat(id); return select({ gear: s }, { noSheet: true }); }
        return select({ gear: [card.dataset.g] });
      }
      if (edge && edge.dataset.c) return select({ cable: edge.dataset.c });
      select(null);
    }

    // ---------- the right-click menu ----------
    function closeMenu() { $$('.pmenu').forEach((m) => m.remove()); }
    function menuAt(t, cx, cy) {
      closeMenu();
      const w = world(cx, cy);
      const mem = t.closest && t.closest('.crow.mem'), card = t.closest && t.closest('.pcard'), edge = t.closest && t.closest('.pe');
      const items = [];
      const it = (label, fn, opt = {}) => items.push({ label, fn, ...opt });
      const sep = () => items.push({ sep: true });
      if (mem || card) {
        const g = gearOf(mem ? mem.dataset.mem : card.dataset.g);
        const host = P.hostOf(st.doc, g);
        if (!st.sel.includes(g.id)) select({ gear: [g.id] }, { noSheet: true });
        items.push({ title: g.name });
        it('Follow its signal', () => select({ gear: [g.id] }));
        if (st.edit) {
          it('Edit details', () => { select({ gear: [g.id] }); if (!wide()) sheet(); });
          if (P.KINDS[g.kind].fields.includes('person')) it('Tag a person…', () => personDialog(g));
          if (!host) it('Connect to…', () => { st.pending = { gid: g.id, port: null }; markPending(); toast('Now tap the card it goes to'); });
          if (g.kind === 'receiver') it('Add a mic to a channel', () => memberDialog(g));
          if (g.kind === 'iemtx') it('Add an IEM pack', () => memberDialog(g));
          if (g.kind === 'stagebox') it('Assign console channels…', () => channelDialog(g));
          const m = D.models.get(g.id);
          if (m && !m.small) it(g.open ? 'Show used sockets only' : 'Show every socket', () => change(() => { g.open = !g.open; if (!g.open) delete g.open; }, null, true));
          if (host) it('Take out of ' + host.name, () => change(() => { st.doc.cables = st.doc.cables.filter((c) => !((c.a === g.id || c.b === g.id) && c.kind === 'rf')); delete g.x; delete g.y; }, g.name + ' is on its own now'));
          else it('Duplicate', () => duplicate(g));
          sep();
          it(host ? 'Remove ' + (g.kind === 'txmic' ? 'mic' : 'pack') : 'Remove', () => removeGear(g.id), { danger: true });
        } else {
          const dev = g.device_id && typeof DEV !== 'undefined' && DEV.list ? DEV.list.find((d) => d.id === g.device_id) : null;
          if (dev) it('Open its gear card', () => { location.hash = '#/d/' + dev.id; });
          it('Report a problem', () => reportProblem(g.name + (g.use ? ' (' + g.use + ')' : ''), { gear: g.id, device_id: g.device_id || undefined }));
        }
      } else if (edge && edge.dataset.c) {
        const c = st.doc.cables.find((x) => x.id === edge.dataset.c);
        select({ cable: c.id }, { noSheet: true });
        const a = gearOf(c.a), b = gearOf(c.b);
        items.push({ title: a.name + ' → ' + b.name });
        it('Follow its signal', () => select({ cable: c.id }));
        if (st.edit) {
          sep();
          Object.entries(KIND_STYLE).filter(([k]) => (c.ap === 'link') === (k === 'link' || k === 'dante')).forEach(([k, v]) => it(v, () => change(() => { st.doc.cables.find((x) => x.id === c.id).kind = k; }, null, true), { check: c.kind === k }));
          sep();
          it('Label and length…', () => { select({ cable: c.id }); if (!wide()) sheet(); });
          it('Remove cable', () => { st.selCable = null; change(() => { st.doc.cables = st.doc.cables.filter((x) => x.id !== c.id); }, 'Cable removed'); }, { danger: true });
        }
      } else {
        if (st.edit) {
          it('Add equipment here', () => { st.placeAt = { x: snap(w.x), y: snap(w.y) }; select(null); if (!wide()) sheet(true); else { const f = $('#pfind'); if (f) f.focus(); } toast('Pick the gear from the list'); });
          it('Tidy up', tidy);
          it('Select all', () => select({ gear: [...D.models.keys()] }, { noSheet: true }));
          it('Snap to grid', () => { st.snap = !st.snap; $('#psnap').checked = st.snap; saveSnap(); }, { check: st.snap });
          sep();
        }
        it('Zoom to fit', fit);
        it('Export PDF', () => $('#ppdf').click());
      }
      const m = document.createElement('div');
      m.className = 'pmenu';
      m.innerHTML = items.map((x, i) => x.sep ? '<hr>' : x.title ? '<div class="pmt">' + esc(cut(x.title, 34)) + '</div>' : '<button type="button" data-i="' + i + '" class="' + (x.danger ? 'danger' : '') + '">' + (x.check != null ? '<span class="ck">' + (x.check ? '✓' : '') + '</span>' : '') + esc(x.label) + '</button>').join('');
      document.body.appendChild(m);
      const r = m.getBoundingClientRect();
      m.style.left = Math.max(8, Math.min(cx, window.innerWidth - r.width - 8)) + 'px';
      m.style.top = Math.max(8, Math.min(cy, window.innerHeight - r.height - 8)) + 'px';
      $$('[data-i]', m).forEach((b) => b.addEventListener('click', () => { closeMenu(); items[Number(b.dataset.i)].fn(); }));
      setTimeout(() => {
        const away = (ev) => { if (!m.contains(ev.target)) { closeMenu(); off(); } };
        const esc2 = (ev) => { if (ev.key === 'Escape') { closeMenu(); off(); } };
        const off = () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc2); window.removeEventListener('scroll', away2, true); };
        const away2 = () => { closeMenu(); off(); };
        document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc2); window.addEventListener('scroll', away2, true);
      }, 0);
    }

    // ---------- connecting ----------
    function dropOn(el, gid, port) {
      if (!el) return;
      const a = gearOf(gid);
      const sk = el.closest && el.closest('.sk.in'), card = el.closest && el.closest('.pcard'), ld = el.closest && el.closest('.ldot'), mem = el.closest && el.closest('.crow.mem');
      const targetId = sk ? sk.dataset.g : ld ? ld.dataset.g : card ? card.dataset.g : null;
      const b = gearOf(targetId);
      if (!a || !b || a === b) return;
      if (port === 'link' || ld) {
        if (!P.KINDS[a.kind].link || !P.KINDS[b.kind].link) return toast(b.name + ' has no link socket', 'bad');
        return picker(a, b, { linkOnly: true });
      }
      if (sk && port != null && !mem) { change(() => P.connect(st.doc, a, port, b, Number(sk.dataset.p)), a.name + ' ' + a.outs[port] + ' → ' + b.name + ' ' + b.ins[Number(sk.dataset.p)]); return; }
      picker(a, b, { port, toIn: sk ? Number(sk.dataset.p) : null });
    }
    function linkLabel(a, b) {
      const it = P.CATALOG.flatMap((g) => g.items).find((x) => (x.model === a.model || x.model === b.model) && x.link);
      return it ? it.link : (a.kind === 'network' || b.kind === 'network' ? 'Dante' : '');
    }
    const linked = (a, b) => st.doc.cables.some((c) => c.ap === 'link' && ((c.a === a.id && c.b === b.id) || (c.a === b.id && c.b === a.id)));
    /** First console channel nobody uses yet. */
    function freeChannel(con) {
      const used = new Set(P.inputs(st.doc).filter((r) => r.console.id === con.id && r.ch != null && (r.used || r.via.kind === 'stagebox')).map((r) => r.ch));
      for (let c = 1; c < 512; c++) if (!used.has(c)) return c;
      return 1;
    }
    /**
     * Card to card: one dialog that offers what makes sense between the two.
     *   stage box ⇄ console: link them, and (if you want) assign box inputs to console channels
     *   mic → receiver: put it on a channel; IEM transmitter → pack: pair it
     *   anything else: from which output to which input, how many in a row, cable type and label
     */
    function picker(a, b, opts = {}) {
      // the natural direction: whoever has outputs feeds whoever has inputs
      if (!opts.linkOnly && opts.port == null && !a.outs.length && b.outs.length && a.ins.length) [a, b] = [b, a];
      const linkable = P.KINDS[a.kind].link && P.KINDS[b.kind].link;
      const sb = a.kind === 'stagebox' && b.kind === 'console' ? a : b.kind === 'stagebox' && a.kind === 'console' ? b : null;
      const con = sb ? (sb === a ? b : a) : null;
      const ix = P.index(st.doc);
      const wire = !opts.linkOnly && a.outs.length && b.ins.length && !(sb && opts.port == null);
      if (!wire && !linkable) return toast(!a.outs.length ? a.name + ' has no outputs' : b.name + ' has no inputs', 'bad');
      // mic onto a receiver, pack onto a transmitter: a member of the wireless system
      if (a.kind === 'txmic' && b.kind === 'receiver') return memberDialog(b, a);
      if (a.kind === 'iemtx' && b.kind === 'bodypack') { change(() => P.connect(st.doc, a, 0, b, 0, { kind: 'rf' }), b.name + ' paired with ' + a.name); return; }
      const freeOut = opts.port != null ? opts.port : Math.max(0, a.outs.findIndex((_, j) => !(ix.from.get(a.id + ':' + j) || []).length));
      const firstFree = opts.toIn != null ? opts.toIn : Math.max(0, b.ins.findIndex((_, i) => !ix.into.get(b.id + ':' + i)));
      const opt = (list, sel, taken) => list.map((p, i) => '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + esc(p) + (taken(i) ? ' •' : '') + '</option>').join('');
      const stereo = a.outs.length > 1 && b.ins.length > 1 && /^(L|R)$/.test(a.outs[freeOut] || '') ? 2 : 1;
      let html = '<h3>Connect ' + esc(a.name) + ' → ' + esc(b.name) + '</h3><form id="pcf">';
      if (linkable && (opts.linkOnly || sb || a.kind === 'network' || b.kind === 'network')) {
        html += '<label class="tog pk"><input type="checkbox" id="pcf_lk"' + (linked(a, b) ? ' checked disabled' : ' checked') + '> <span><b>' + (linked(a, b) ? 'Linked' : 'Link them') + '</b> with <input id="pcf_ln" class="inl" value="' + esc(linkLabel(a, b) || 'Link') + '"' + (linked(a, b) ? ' disabled' : '') + '></span></label>';
      }
      if (sb) {
        const used = sb.ins.map((_, i) => i).filter((i) => ix.into.get(sb.id + ':' + i));
        const lo = used.length ? used[0] : 0, hi = used.length ? used[used.length - 1] : sb.ins.length - 1;
        html += '<div class="pkbox"><label class="tog pk"><input type="checkbox" id="pcf_ch"> <span><b>Assign console channels</b> <span class="note">(you can also do this later on the stage box)</span></span></label>' +
          '<div class="three"><div><label>' + esc(sb.name) + ' from</label><select id="pcf_cf">' + opt(sb.ins, lo, (i) => ix.into.get(sb.id + ':' + i)) + '</select></div>' +
          '<div><label>to</label><select id="pcf_ct">' + opt(sb.ins, hi, (i) => ix.into.get(sb.id + ':' + i)) + '</select></div>' +
          '<div><label>→ ' + esc(con.name) + ' channel</label><input id="pcf_c1" type="number" min="1" max="512" value="' + freeChannel(con) + '"></div></div></div>';
      }
      if (wire) {
        html += '<div class="two"><div><label>From</label><select id="pcf_a">' + opt(a.outs, freeOut, (j) => (ix.from.get(a.id + ':' + j) || []).length) + '</select></div>' +
          '<div><label>To</label><select id="pcf_b">' + opt(b.ins, firstFree, (i) => ix.into.get(b.id + ':' + i)) + '</select></div></div>' +
          '<div class="two"><div><label>How many in a row</label><input id="pcf_n" type="number" min="1" max="' + Math.min(a.outs.length, b.ins.length) + '" value="' + stereo + '"></div>' +
          '<div><label>Cable</label><select id="pcf_k">' + Object.entries(KIND_STYLE).filter(([k]) => k !== 'link').map(([k, v]) => '<option value="' + k + '"' + (k === P.guessCable(a, 0, b, 0) ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></div></div>' +
          '<label>Cable label <span class="note">(optional, e.g. C12)</span></label><input id="pcf_l"><p class="note">• already in use: connecting replaces what is there.</p>';
      }
      html += '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Connect</button></div></form>';
      modal(html, (w, close) => {
        const chk = $('#pcf_ch', w);
        if (chk) { const sync = () => $$('#pcf_cf, #pcf_ct, #pcf_c1', w).forEach((x) => { x.disabled = !chk.checked; }); chk.addEventListener('change', sync); sync(); }
        $('#pcf', w).addEventListener('submit', (e) => {
          e.preventDefault();
          const lk = $('#pcf_lk', w), doLink = lk && lk.checked && !lk.disabled, lname = $('#pcf_ln', w) ? $('#pcf_ln', w).value.trim() : '';
          const doCh = chk && chk.checked;
          const cf = doCh ? Number($('#pcf_cf', w).value) : 0, ct = doCh ? Number($('#pcf_ct', w).value) : 0, c1 = doCh ? Math.max(1, Number($('#pcf_c1', w).value) || 1) : 0;
          const ao = wire ? Number($('#pcf_a', w).value) : 0, bi = wire ? Number($('#pcf_b', w).value) : 0, n = wire ? Math.max(1, Number($('#pcf_n', w).value) || 1) : 0;
          const kind = wire ? $('#pcf_k', w).value : '', label = wire ? $('#pcf_l', w).value.trim() : '';
          close();
          const msg = [];
          change(() => {
            if (doLink) { P.connect(st.doc, a, 'link', b, 'link', { label: lname }); msg.push('Linked'); }
            if (doCh) { const box = gearOf(sb.id); P.assignChannels(box, Math.min(cf, ct), Math.max(cf, ct), c1); msg.push(sb.ins[Math.min(cf, ct)] + '–' + sb.ins[Math.max(cf, ct)] + ' → ch ' + c1 + '–' + (c1 + Math.abs(ct - cf))); }
            if (wire) { for (let i = 0; i < n && ao + i < a.outs.length && bi + i < b.ins.length; i++) P.connect(st.doc, a, ao + i, b, bi + i, { kind, label: n > 1 && label ? label + '.' + (i + 1) : label }); msg.push(n > 1 ? n + ' cables' : 'Connected'); }
          }, msg.join(' · ') || null);
        });
      });
    }
    /** Put a mic on a receiver channel (a new one, or one that stands on its own), or add a pack to an IEM transmitter. */
    function memberDialog(host, existing) {
      const rx = host.kind === 'receiver';
      const used = new Set(P.members(st.doc, host).map((m) => m.port));
      const free = host.ins.map((p, i) => i).filter((i) => !used.has(i));
      if (rx && !free.length) return toast('Every channel on ' + host.name + ' has a mic. Take one out first.', 'bad');
      const people = peopleList();
      modal('<h3>' + (existing ? 'Put ' + esc(existing.name) + ' on ' + esc(host.name) : rx ? 'Add a mic to ' + esc(host.name) : 'Add an IEM pack to ' + esc(host.name)) + '</h3><form id="pmf">' +
        (rx ? '<label>Channel</label><select id="pm_ch">' + free.map((i) => '<option value="' + i + '">' + esc(host.ins[i]) + '</option>').join('') + '</select>' : '') +
        (existing ? '' : '<div class="two"><div><label>Who uses it</label><input id="pm_p" list="pmppl" placeholder="Sarah"></div><div><label>Used for</label><input id="pm_u" placeholder="' + (rx ? 'Lead vocal' : 'Drums') + '"></div></div>' +
          '<datalist id="pmppl">' + people.map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist>' +
          (rx ? '<div class="two"><div><label>Type</label><select id="pm_m"><option>Handheld</option><option>Bodypack</option><option>Headset</option><option>Lav</option></select></div><div><label>Capsule</label><input id="pm_c" placeholder="Beta 58A"></div></div><label>Frequency (MHz)</label><input id="pm_f" inputmode="decimal" placeholder="524.125">'
            : '<div class="two"><div><label>Pack model</label><input id="pm_m" placeholder="P3R"></div><div><label>Earphones</label><input id="pm_e" placeholder="SE215"></div></div>')) +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">' + (existing ? 'Put it on' : 'Add') + '</button></div></form>', (w, close) => {
        const pi = $('#pm_p', w); if (pi) setTimeout(() => pi.focus(), 40);
        $('#pmf', w).addEventListener('submit', (e) => {
          e.preventDefault();
          const ch = rx ? Number($('#pm_ch', w).value) : null;
          const v = (id) => { const x = $(id, w); return x ? x.value.trim() : ''; };
          close();
          if (existing) { change(() => { P.connect(st.doc, gearOf(existing.id), 0, gearOf(host.id), ch, { kind: 'rf' }); delete gearOf(existing.id).x; }, existing.name + ' is on ' + host.name + ' ' + host.ins[ch]); return; }
          const item = rx ? { person: v('#pm_p'), use: v('#pm_u'), model: v('#pm_m'), capsule: v('#pm_c'), freq: v('#pm_f') } : { person: v('#pm_p'), use: v('#pm_u'), model: v('#pm_m') || 'IEM pack', phones: v('#pm_e') };
          Object.keys(item).forEach((k) => { if (!item[k]) delete item[k]; });
          const g = change(() => P.addMember(st.doc, gearOf(host.id), item, ch), rx ? 'Mic added to ' + host.name : 'Pack added to ' + host.name);
          if (g) select({ gear: [g.id] }, { noSheet: true });
        });
      });
    }
    /** The names already tagged on the drawing, and the team's names. */
    function peopleList() {
      const set = new Set(st.doc.gear.map((g) => g.person).filter(Boolean));
      (S.people || []).forEach((p) => set.add(p));
      return [...set].sort((a, b) => a.localeCompare(b));
    }
    function personDialog(g) {
      modal('<h3>Who uses ' + esc(g.name) + '?</h3><form id="ppf"><label>Person</label><input id="pp_p" list="ppppl" value="' + esc(g.person || '') + '" placeholder="Sarah"><datalist id="ppppl">' + peopleList().map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist>' +
        '<label>Used for</label><input id="pp_u" value="' + esc(g.use || '') + '" placeholder="Lead vocal, Drums, Pastor">' +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>', (w, close) => {
        setTimeout(() => $('#pp_p', w).focus(), 40);
        $('#ppf', w).addEventListener('submit', (e) => {
          e.preventDefault(); const p = $('#pp_p', w).value.trim(), u = $('#pp_u', w).value.trim(); close();
          change(() => { const x = gearOf(g.id); if (p) x.person = p; else delete x.person; if (u) x.use = u; else delete x.use; }, p ? 'Tagged ' + p : null);
        });
      });
    }
    /** Which console channel each stage box input lands on. */
    function channelDialog(sb) {
      const ix = P.index(st.doc);
      const con = ix.consolesOf(sb.id)[0];
      modal('<h3>' + esc(sb.name) + ': console channels</h3><p class="note">' + (con ? 'Which ' + esc(con.name) + ' channel each input lands on. Leave a box empty for an input you do not use.' : 'Link ' + esc(sb.name) + ' to a console first; you can still fill these in.') + '</p>' +
        '<div class="pkbox"><div class="three"><div><label>From</label><select id="pc_f">' + sb.ins.map((p, i) => '<option value="' + i + '">' + esc(p) + '</option>').join('') + '</select></div><div><label>to</label><select id="pc_t">' + sb.ins.map((p, i) => '<option value="' + i + '"' + (i === sb.ins.length - 1 ? ' selected' : '') + '>' + esc(p) + '</option>').join('') + '</select></div>' +
        '<div><label>first channel</label><input id="pc_1" type="number" min="1" value="' + (con ? freeChannel(con) : 1) + '"></div></div><div class="acts" style="justify-content:flex-start;margin-top:6px"><button type="button" class="btn" id="pc_go">Fill in</button><button type="button" class="ghost" id="pc_clr">Clear these</button></div></div>' +
        '<form id="pcm"><div class="pchgrid">' + sb.ins.map((p, i) => { const u = P.upstream(st.doc, ix, sb.id, i); return '<label class="' + (u.chain.length ? 'used' : '') + '"><span><b>' + esc(p) + '</b> ' + esc(cut(u.source || u.mic || '', 18)) + '</span><input type="number" min="1" max="512" data-i="' + i + '" value="' + (P.chanOf(sb, i) || '') + '" placeholder="—"></label>'; }).join('') + '</div>' +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>', (w, close) => {
        $('#pc_go', w).addEventListener('click', () => { const f = Number($('#pc_f', w).value), t = Number($('#pc_t', w).value), c1 = Math.max(1, Number($('#pc_1', w).value) || 1); for (let i = Math.min(f, t); i <= Math.max(f, t); i++) $('[data-i="' + i + '"]', w).value = c1 + i - Math.min(f, t); });
        $('#pc_clr', w).addEventListener('click', () => { const f = Number($('#pc_f', w).value), t = Number($('#pc_t', w).value); for (let i = Math.min(f, t); i <= Math.max(f, t); i++) $('[data-i="' + i + '"]', w).value = ''; });
        $('#pcm', w).addEventListener('submit', (e) => {
          e.preventDefault();
          const map = {}; $$('[data-i]', w).forEach((inp) => { const v = Number(inp.value); if (v >= 1) map[Number(inp.dataset.i)] = Math.floor(v); });
          close();
          change(() => { gearOf(sb.id).chmap = map; }, 'Channels saved');
        });
      });
    }
    function duplicate(g) {
      const copy = change(() => {
        const c = P.addGear(st.doc, { ...g, id: undefined, name: g.name, nin: g.ins.length, nout: g.outs.length, ins: g.ins.slice(), outs: g.outs.slice(), device_id: undefined, x: g.x + 30, y: g.y + 30 });
        c.ins = g.ins.slice(); c.outs = g.outs.slice();
        return c;
      }, 'Duplicated ' + g.name);
      select({ gear: [copy.id] }, { noSheet: true });
    }
    function tidy() {
      change(() => { st.doc.gear.forEach((g) => { delete g.x; delete g.y; }); }, 'Tidied up');
      fit();
    }
    function align(how) {
      const ms = st.sel.map((id) => D.models.get(id)).filter(Boolean);
      if (ms.length < 2) return;
      change(() => {
        const L = ms.map((m) => ({ m, g: gearOf(m.g.id) }));
        if (how === 'left') { const x = Math.min(...L.map((o) => o.g.x)); L.forEach((o) => { o.g.x = x; }); }
        if (how === 'top') { const y = Math.min(...L.map((o) => o.g.y)); L.forEach((o) => { o.g.y = y; }); }
        if (how === 'center') { const c = snap(L.reduce((s, o) => s + o.g.x + o.m.w / 2, 0) / L.length); L.forEach((o) => { o.g.x = snap(c - o.m.w / 2); }); }
        if (how === 'vdist') {
          L.sort((p, q) => p.g.y - q.g.y);
          const total = L.reduce((s, o) => s + o.m.h, 0), span = L[L.length - 1].g.y + L[L.length - 1].m.h - L[0].g.y;
          const gap = Math.max(VGAP, (span - total) / (L.length - 1));
          let y = L[0].g.y; L.forEach((o) => { o.g.y = snap(y); y += o.m.h + gap; });
        }
        if (how === 'hdist') {
          L.sort((p, q) => p.g.x - q.g.x);
          const span = L[L.length - 1].g.x - L[0].g.x, gap = Math.max(CW + 40, span / (L.length - 1));
          L.forEach((o, i) => { o.g.x = snap(L[0].g.x + i * gap); });
        }
      }, null, true);
    }

    // ---------- changes, undo, saving ----------
    function change(fn, msg, keepPane) {
      st.undo.push(JSON.stringify(st.doc)); if (st.undo.length > 120) st.undo.shift();
      st.redo = [];
      const r = fn();
      st.cache = null;
      paint(true);
      if (!keepPane) paintPane();
      if (msg) toast(msg);
      queueSave();
      return r;
    }
    function undo() { if (!st.undo.length) return; st.redo.push(JSON.stringify(st.doc)); st.doc = JSON.parse(st.undo.pop()); st.cache = null; paint(true); paintPane(); queueSave(); }
    function redo() { if (!st.redo.length) return; st.undo.push(JSON.stringify(st.doc)); st.doc = JSON.parse(st.redo.pop()); st.cache = null; paint(true); paintPane(); queueSave(); }
    let saveTimer = null;
    function queueSave() { $('#psave').textContent = 'Saving…'; S.dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 700); }
    async function save() {
      if (st.saving) { st.dirtySave = true; return; }
      st.saving = true;
      try {
        const r = await call('PUT', '/api/patch', { doc: st.doc, baseVersion: st.version });
        st.version = r.version;
        $('#psave').textContent = 'Saved'; S.dirty = false;
      } catch (e) {
        if (e.status === 409) { toast(e.message, 'bad'); const d = await get('/api/patch'); st.doc = d.doc; st.version = d.version; st.undo = []; st.redo = []; S.dirty = false; st.cache = null; paint(true); paintPane(); $('#psave').textContent = 'Reloaded'; }
        else { $('#psave').textContent = 'Not saved: ' + e.message; }
      }
      st.saving = false;
      if (st.dirtySave) { st.dirtySave = false; save(); }
    }
    document.addEventListener('keydown', function keys(e) {
      if (!svg.isConnected) return document.removeEventListener('keydown', keys);
      if (!st.edit || /input|textarea|select/i.test(e.target.tagName) || document.querySelector('.modal')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); select({ gear: [...D.models.keys()] }, { noSheet: true }); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selCable) { e.preventDefault(); const id = st.selCable; st.selCable = null; change(() => { st.doc.cables = st.doc.cables.filter((c) => c.id !== id); }, 'Cable removed'); }
        else if (st.sel.length === 1) { e.preventDefault(); removeGear(st.sel[0]); }
      } else if (e.key.startsWith('Arrow') && st.sel.length) {
        // nudge
        e.preventDefault();
        const d = e.shiftKey ? 50 : GRID, dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        change(() => st.sel.forEach((id) => { const g = gearOf(id); if (g && g.x != null) { g.x += dx; g.y += dy; } }), null, true);
      } else if (e.key === 'Escape') { st.pending = null; markPending(); closeMenu(); select(null); }
    });

    // ---------- the right pane ----------
    function paintPane(host) {
      if (!host) { [$('#ppane'), $('#psh')].filter(Boolean).forEach((h) => paintPane(h)); return; }
      host.classList.remove('empty');
      const g = st.sel.length === 1 ? gearOf(st.sel[0]) : null;
      const cab = st.selCable ? st.doc.cables.find((c) => c.id === st.selCable) : null;
      const addBtn = () => { if (!st.edit || host.id === 'psh') return; const bt = document.createElement('button'); bt.className = 'btn paddbtn'; bt.innerHTML = icon('plus') + 'Add equipment'; bt.addEventListener('click', () => select(null)); host.prepend(bt); };
      if (cab) { cablePane(host, cab); return addBtn(); }
      if (g) { gearPane(host, g); return addBtn(); }
      if (st.sel.length > 1) {
        const list = st.sel.map(gearOf).filter(Boolean);
        host.innerHTML = '<div class="pph"><button class="ghost pback" id="pbk2" title="Back">' + icon('x') + '</button><b>' + list.length + ' pieces of gear</b></div>' +
          (st.edit ? '<p class="note">Drag one to move them all, or line them up:</p><div class="palign2">' + [['left', '⇤ Left edges'], ['top', '⤒ Top edges'], ['center', '↔ Centres'], ['vdist', '⇕ Space evenly'], ['hdist', '⇔ Space across']].map(([k, l]) => '<button class="btn" data-al2="' + k + '">' + l + '</button>').join('') + '</div>' : '') +
          '<div class="plist2">' + list.map((x) => '<button class="prow" data-pick="' + x.id + '"><b>' + esc(x.name) + '</b><span>' + esc([who(x), x.model].filter(Boolean).join(' · ')) + '</span></button>').join('') + '</div>';
        $$('[data-pick]', host).forEach((b) => b.addEventListener('click', () => select({ gear: [b.dataset.pick] })));
        $$('[data-al2]', host).forEach((b) => b.addEventListener('click', () => align(b.dataset.al2)));
        $('#pbk2', host).addEventListener('click', () => { select(null); const m = host.closest('.modal'); if (m) m.remove(); });
        return addBtn();
      }
      if (st.edit) return addPane(host);
      host.classList.toggle('empty', host.id === 'ppane');
      host.innerHTML = '<div class="pph"><b>Follow a signal</b></div><p class="note">Tap any piece of gear, socket or cable and everything it connects to lights up, from the mic to the speaker. Tap the background to clear.</p>' +
        '<p class="note">' + st.doc.gear.length + ' pieces of gear, ' + st.doc.cables.length + ' cables.' + (canEdit ? ' Tap <b>Edit</b> to add gear and draw cables.' : '') + '</p>';
    }

    function addPane(host) {
      const onPatch = new Set(st.doc.gear.map((g) => g.device_id).filter(Boolean));
      const devs = ((typeof DEV !== 'undefined' && DEV.list) || []).filter((d) => !onPatch.has(d.id) && d.category === 'audio');
      host.innerHTML = '<div class="pph"><b>Add equipment</b></div>' + (st.placeAt ? '<p class="note">It goes where you right-clicked.</p>' : '') + '<input type="search" id="pfind" placeholder="Find gear: SM58, AR2412, PSM…" class="pfind">' +
        (devs.length ? '<div class="pcat"><div class="pch">From your Gear Locker</div><div class="pitems">' + devs.map((d) => '<button class="pitem" data-dev="' + d.id + '"><b>' + esc(d.name) + '</b><span>' + esc([d.make, d.model].filter(Boolean).join(' ')) + '</span></button>').join('') + '</div></div>' : '') +
        P.CATALOG.map((grp, gi) => '<div class="pcat"><div class="pch">' + esc(grp.group) + '</div><div class="pitems">' + grp.items.map((it, ii) => '<button class="pitem cat-' + P.KINDS[it.kind].cat + '" data-cat="' + gi + ':' + ii + '"><b>' + esc(it.model) + '</b><span>' + esc([it.make, P.KINDS[it.kind].label].filter(Boolean).join(' · ')) + '</span></button>').join('') + '</div></div>').join('');
      const find = $('#pfind', host);
      find.addEventListener('input', () => {
        const q = key(find.value);
        $$('.pitem', host).forEach((b) => b.classList.toggle('hide', !!q && !key(b.textContent).includes(q)));
        $$('.pcat', host).forEach((c) => c.classList.toggle('hide', !!q && !c.querySelector('.pitem:not(.hide)')));
      });
      $$('[data-cat]', host).forEach((b) => b.addEventListener('click', () => { const [gi, ii] = b.dataset.cat.split(':').map(Number); addItem({ ...P.CATALOG[gi].items[ii] }); }));
      $$('[data-dev]', host).forEach((b) => b.addEventListener('click', () => { const d = DEV.list.find((x) => x.id === Number(b.dataset.dev)); addDevice(d); }));
    }
    /** Where new gear goes: where you right-clicked, else the middle of what you can see, in a free spot. */
    function newSpot(item) {
      const r = cv.getBoundingClientRect();
      const c = st.placeAt || world(r.left + r.width * 0.42, r.top + r.height * 0.3);
      st.placeAt = null;
      const rects = D ? [...D.models.values()].map((m) => ({ x: m.g.x, y: m.g.y, w: m.w, h: m.h })) : [];
      const h = HEAD + Math.min(6, (item.nin || 1)) * ROW + FOOT;
      return freeSpot(rects, CW, h, c.x, c.y);
    }
    function catalogFor(name) { const k = key(name); return P.CATALOG.flatMap((g) => g.items).find((it) => k && (k === key(it.model) || k.startsWith(key(it.model)) || k.includes(key(it.model)))); }
    function addDevice(d) {
      const it = catalogFor(d.model) || catalogFor(d.name) || { kind: d.inputs && d.outputs ? 'other' : d.outputs ? 'receiver' : 'other', make: d.make, model: d.model };
      const item = { ...it, name: d.name, make: d.make || it.make, model: d.model || it.model, device_id: d.id };
      if (d.inputs) item.nin = d.inputs; if (d.outputs) item.nout = d.outputs;
      if (it.kind === 'receiver' && d.outputs) item.nin = d.outputs;
      Object.assign(item, newSpot(item));
      const g = change(() => P.addGear(st.doc, item), 'Added ' + d.name);
      select({ gear: [g.id] }, { noSheet: true }); closeSheet();
      focusGear(g.id);
    }
    async function addItem(it) {
      const k = P.KINDS[it.kind];
      // a mic or pack goes into the selected wireless system if one is picked
      const name = P.uniqueName(st.doc, it.model);
      let device_id = null;
      if (k.card) {
        // big gear gets a card in the Gear Locker so the rest of LiveGenie (pages, map, IP lists) knows it
        await loadDevices();
        const ex = (DEV.list || []).find((d) => key(d.name) === key(name));
        if (ex) device_id = ex.id;
        else {
          try {
            const r = await call('POST', '/api/devices', { name, category: 'audio', make: it.make || '', model: it.model, inputs: it.kind === 'receiver' ? 0 : it.nin || 0, outputs: it.kind === 'receiver' ? it.nin || 0 : it.nout || 0 });
            device_id = r.id; if (typeof forgetDevices === 'function') forgetDevices(); await loadDevices(true);
          } catch (e) { /* the drawing still works without a card */ }
        }
      }
      const spot = newSpot(it);
      const g = change(() => P.addGear(st.doc, { ...it, name, device_id, ...spot }), 'Added ' + name);
      select({ gear: [g.id] }, { noSheet: true }); closeSheet();
      focusGear(g.id);
    }
    function closeSheet() { const m = document.querySelector('.modal.psheet'); if (m) m.remove(); }

    function gearPane(host, g0) {
      const gid = g0.id;
      const live = () => gearOf(gid);
      const g = g0;
      const k = P.KINDS[g.kind];
      const ix = P.index(st.doc);
      const ro = !st.edit;
      const host2 = P.hostOf(st.doc, g);
      const fld = (f, label, val, extra) => '<label>' + label + '<input data-f="' + f + '" value="' + esc(val == null ? '' : val) + '"' + (ro ? ' disabled' : '') + (extra || '') + '></label>';
      const consoleMixes = () => { const cons = st.doc.gear.filter((x) => x.kind === 'console'); const list = [...new Set(cons.flatMap((c) => c.mixes || P.DEFAULT_MIXES))]; return list.length ? list : P.DEFAULT_MIXES; };
      const allOuts = () => st.doc.gear.filter((x) => x.id !== g.id && x.outs.length).map((x) => '<optgroup label="' + esc(x.name) + '">' + x.outs.map((p, j) => '<option value="' + x.id + ':' + j + '">' + esc(x.name + ' ' + p) + '</option>').join('') + '</optgroup>').join('');
      const allIns = () => st.doc.gear.filter((x) => x.id !== g.id && x.ins.length).map((x) => '<optgroup label="' + esc(x.name) + '">' + x.ins.map((p, i) => '<option value="' + x.id + ':' + i + '"' + (ix.into.get(x.id + ':' + i) ? ' class="taken"' : '') + '>' + esc(x.name + ' ' + p) + (ix.into.get(x.id + ':' + i) ? ' (in use)' : '') + '</option>').join('') + '</optgroup>').join('');
      const mem = P.members(st.doc, g);
      const facts = [['Who uses it', g.person], ['Used for', g.use], ['Make', g.make], ['Model', g.model], ['Capsule', g.capsule], ['Frequency', g.freq && g.freq + ' MHz'], ['Mode', g.mode], ['Earphones', g.phones],
        ['In', host2 ? host2.name + (g.kind === 'txmic' ? ' ' + host2.ins[(st.doc.cables.find((c) => c.a === g.id && c.kind === 'rf') || {}).bp] : '') : ''], ['Section', g.group], ['Notes', g.notes]].filter((f) => f[1]);
      let html = '<div class="pph"><button class="ghost pback" id="pbk" title="Back">' + icon('x') + '</button><span class="pkind cat-' + k.cat + '">' + esc(k.label) + '</span>' + (host2 ? '<button class="linkbtn" id="phost">in ' + esc(host2.name) + '</button>' : '') + '</div>' +
        (ro ? '<h3 class="pname">' + esc(g.name) + '</h3><div class="pfacts">' + facts.map((f) => '<div><span>' + f[0] + '</span><b>' + esc(f[1]) + '</b></div>').join('') + '</div>' : '<div class="pform">' + fld('name', 'Name', g.name) +
        (k.fields.includes('person') ? fld('person', 'Who uses it', g.person, ' list="pppl" placeholder="Sarah"') + '<datalist id="pppl">' + peopleList().map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist>' : '') +
        (k.fields.includes('use') ? fld('use', 'Used for', g.use, ' placeholder="Kick, Pastor, Keys L"') : '') +
        fld('make', 'Make', g.make) + (k.fields.includes('model') ? fld('model', 'Model', g.model) : '') +
        (k.fields.includes('capsule') ? fld('capsule', 'Capsule', g.capsule, ' placeholder="Beta 58A, TL47"') : '') +
        (k.fields.includes('freq') ? fld('freq', 'Frequency (MHz)', g.freq, ' inputmode="decimal" placeholder="524.125"') : '') +
        (k.fields.includes('mode') ? '<label>Mode<select data-f="mode"' + (ro ? ' disabled' : '') + '><option' + (g.mode !== 'Mono' ? ' selected' : '') + '>Stereo</option><option' + (g.mode === 'Mono' ? ' selected' : '') + '>Mono</option></select></label>' : '') +
        (k.fields.includes('phones') ? fld('phones', 'Earphones', g.phones) : '') +
        (k.fields.includes('localstart') ? fld('localstart', 'Channel for local In 1', g.localstart || 1, ' type="number" min="1"') : '') +
        (k.fields.includes('mixes') ? '<label>Mixes <span class="note">(comma between)</span><textarea data-f="mixes" rows="2"' + (ro ? ' disabled' : '') + '>' + esc((g.mixes || P.DEFAULT_MIXES).join(', ')) + '</textarea></label>' : '') +
        (k.counts === 'both' ? '<div class="two">' + fld('nin', 'Inputs', g.ins.length, ' type="number" min="0" max="128"') + fld('nout', 'Outputs', g.outs.length, ' type="number" min="0" max="128"') + '</div>' : '') +
        (k.counts === 'ch' ? fld('nch', 'Channels', g.ins.length, ' type="number" min="1" max="' + (g.kind === 'amp' ? 4 : 16) + '"') : '') +
        (k.counts === 'outs' ? fld('nout', 'Outputs', g.outs.length, ' type="number" min="1" max="' + (g.kind === 'di' ? 2 : 16) + '"') : '') +
        fld('group', 'Section', g.group, ' placeholder="Drums, Wireless, Band IEMs" list="pgrp"') + '<datalist id="pgrp">' + [...new Set(st.doc.gear.map((x) => x.group).filter(Boolean))].map((x) => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
        '<label>Notes<textarea data-f="notes" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(g.notes || '') + '</textarea></label></div>');
      // the Gear Locker card
      const dev = g.device_id && typeof DEV !== 'undefined' && DEV.list ? DEV.list.find((d) => d.id === g.device_id) : null;
      html += '<div class="pdev">' + (dev ? '<a class="btn abtn" href="#/d/' + dev.id + '">' + icon('box') + 'Gear card: ' + esc(dev.name) + '</a>' : st.edit && k.card ? '<button class="btn" id="pmkdev">' + icon('box') + 'Add to the Gear Locker</button>' : '') +
        (dev && dev.files ? '<a class="btn abtn" href="#/d/' + dev.id + '">' + icon('pdf') + dev.files + ' manual' + (dev.files === 1 ? '' : 's') + '</a>' : '') +
        (!st.edit ? '<button class="btn ghost" id="prep">' + icon('alert') + 'Report a problem</button>' : '') + '</div>';
      // a wireless system: its mics or packs
      if (g.kind === 'receiver' || g.kind === 'iemtx') {
        html += '<div class="pmem"><div class="pch">' + (g.kind === 'receiver' ? 'Mics on its channels' : 'Packs') + '</div>';
        if (g.kind === 'receiver') g.ins.forEach((p, i) => {
          const m = mem.find((x) => x.port === i);
          html += '<div class="psk"><b>' + esc(p) + '</b><span>' + (m ? '<button class="linkbtn" data-sel="' + m.g.id + '">' + esc(m.g.person || m.g.use || m.g.name) + '</button> <span class="note">' + esc([m.g.capsule || m.g.model, m.g.freq && m.g.freq + ' MHz'].filter(Boolean).join(' · ')) + '</span>' : '<span class="note">no mic</span>') + '</span>' +
            (st.edit && !m ? '<button class="ghost xs" data-addm="' + i + '">' + icon('plus') + 'Mic</button>' : '') + '</div>';
        });
        else {
          html += mem.map((m) => '<div class="psk"><b>Pack</b><span><button class="linkbtn" data-sel="' + m.g.id + '">' + esc(m.g.person || m.g.use || m.g.name) + '</button> <span class="note">' + esc([m.g.use && m.g.person ? m.g.use : '', m.g.phones].filter(Boolean).join(' · ')) + '</span></span></div>').join('') || '<p class="note">No packs yet.</p>';
          if (st.edit) html += '<button class="btn" data-addm="">' + icon('plus') + 'Add a pack</button>';
        }
        html += '</div>';
      }
      // a stage box: which console channel each input lands on
      if (g.kind === 'stagebox') {
        const con = ix.consolesOf(g.id)[0];
        const mapped = g.ins.filter((_, i) => P.chanOf(g, i) != null).length;
        html += '<div class="pmem"><div class="pch">Console channels</div><p class="note">' + (mapped ? mapped + ' of ' + g.ins.length + ' inputs assigned' + (con ? ' to ' + esc(con.name) : '') : 'No inputs assigned to console channels yet.') + '</p>' +
          (st.edit ? '<button class="btn" id="pchan">' + icon('list') + 'Assign console channels</button>' : '') + '</div>';
      }
      if (g.kind === 'console') {
        const rows = P.inputs(st.doc).filter((r) => r.console.id === g.id && r.via.kind === 'stagebox' && r.ch != null && r.used);
        if (rows.length) html += '<div class="pmem"><div class="pch">Over the link</div>' + rows.map((r) => '<div class="psk"><b>Ch ' + r.ch + '</b><span>' + esc(r.via.name + ' ' + r.port) + (r.up.source ? ' <span class="note">' + esc(r.up.source) + '</span>' : '') + '</span></div>').join('') + '</div>';
      }
      // sockets
      const feedable = g.kind === 'console' || g.kind === 'stagebox';
      if ((g.ins.length || g.outs.length || k.link) && !host2) {
        html += '<details class="psocks"' + (g.ins.length + g.outs.length <= 12 ? ' open' : '') + '><summary>Sockets · ' + g.ins.length + ' in, ' + g.outs.length + ' out</summary>';
        if (st.edit && g.ins.length + g.outs.length > 4) html += '<label class="tog sm"><input type="checkbox" data-f="open"' + (g.open ? ' checked' : '') + '> Show every socket on the card</label>';
        if (k.link) {
          const ls = (ix.links.get(g.id) || []);
          html += '<div class="psk"><b>Link</b><span>' + (ls.map(({ c, other }) => esc((ix.G.get(other) || {}).name || '') + (c.label ? ' (' + esc(c.label) + ')' : '') + (st.edit ? ' <button class="ghost xs" data-unlink="' + c.id + '">' + icon('x') + '</button>' : '')).join(', ') || '<span class="note">not linked</span>') + '</span>' +
            (st.edit ? '<select data-link><option value="">Link to…</option>' + st.doc.gear.filter((x) => x.id !== g.id && P.KINDS[x.kind].link).map((x) => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('') + '</select>' : '') + '</div>';
        }
        if (g.kind !== 'receiver') g.ins.forEach((p, i) => {
          const c = ix.into.get(g.id + ':' + i);
          const a = c && ix.G.get(c.a);
          const extra = g.kind === 'stagebox' ? ' <span class="note">' + (P.chanOf(g, i) != null ? '→ ch ' + P.chanOf(g, i) : 'no ch') + '</span>' : g.kind === 'console' ? ' <span class="note">ch ' + ((g.localstart || 1) + i) + '</span>' : '';
          html += '<div class="psk"><b>' + esc(p) + extra + '</b><span>' + (a ? esc(a.name + ' ' + a.outs[c.ap]) + (who(a) ? ' <span class="note">' + esc(who(a)) + '</span>' : '') : '<span class="note">free</span>') + '</span>' +
            (st.edit ? '<select data-in="' + i + '"><option value="">' + (a ? 'Change…' : 'Connect from…') + '</option>' + (a ? '<option value="-">Disconnect</option>' : '') + allOuts() + '</select>' : '') + '</div>';
        });
        g.outs.forEach((p, j) => {
          const cs = ix.from.get(g.id + ':' + j) || [];
          html += '<div class="psk"><b>' + esc(p) + '</b><span>' + (feedable ? (st.edit ? '<select class="feed" data-feed="' + j + '"><option value="">No mix</option>' + consoleMixes().map((m) => '<option' + ((g.feeds || {})[j] === m ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + ((g.feeds || {})[j] && !consoleMixes().includes(g.feeds[j]) ? '<option selected>' + esc(g.feeds[j]) + '</option>' : '') + '</select> ' : (g.feeds || {})[j] ? '<b>' + esc(g.feeds[j]) + '</b> ' : '') : '') +
            (cs.filter((c) => c.kind !== 'rf' || !P.KINDS[(ix.G.get(c.b) || {}).kind || 'other'].member).map((c) => { const b = ix.G.get(c.b); return '→ ' + esc(b.name + ' ' + b.ins[c.bp]) + (st.edit ? ' <button class="ghost xs" data-cut="' + c.id + '" title="Disconnect">' + icon('x') + '</button>' : ''); }).join('<br>') || (feedable && st.edit ? '' : '<span class="note">free</span>')) + '</span>' +
            (st.edit ? '<select data-out="' + j + '"><option value="">Connect to…</option>' + allIns() + '</select>' : '') + '</div>';
        });
        html += '</details>';
      }
      if (st.edit) html += '<div class="pacts">' + (host2 ? '<button class="ghost" id="pout">Take out of ' + esc(host2.name) + '</button>' : '<button class="ghost" id="pdup">' + icon('plus') + 'Duplicate</button>') + '<span class="grow"></span><button class="ghost danger" id="pdel">' + icon('trash') + 'Remove</button></div>';
      host.innerHTML = html;
      $('#pbk', host).addEventListener('click', () => { select(null); const m = host.closest('.modal'); if (m) m.remove(); });
      const ph2 = $('#phost', host); if (ph2) ph2.addEventListener('click', () => select({ gear: [host2.id] }));
      $$('[data-sel]', host).forEach((b) => b.addEventListener('click', () => select({ gear: [b.dataset.sel] })));
      const pr = $('#prep', host); if (pr) pr.addEventListener('click', () => reportProblem(g.name + (g.use ? ' (' + g.use + ')' : ''), { gear: g.id, device_id: g.device_id || undefined }));
      if (!st.edit) return;
      $$('[data-addm]', host).forEach((b) => b.addEventListener('click', () => {
        if (g.kind === 'iemtx') return memberDialog(live());
        const i = Number(b.dataset.addm);
        change(() => P.addMember(st.doc, live(), {}, i), 'Mic added to ' + g.name + ' ' + g.ins[i]);
        const m = P.members(st.doc, live()).find((x) => x.port === i); if (m) { select({ gear: [m.g.id] }); toast('Now tag who uses it'); }
      }));
      const pc = $('#pchan', host); if (pc) pc.addEventListener('click', () => channelDialog(live()));
      $$('[data-f]', host).forEach((inp) => inp.addEventListener('change', () => {
        const f = inp.dataset.f, v = inp.value;
        const g = live(); if (!g) return;
        change(() => {
          if (f === 'nin') P.resize(st.doc, g, Math.max(0, Number(v) || 0), g.outs.length);
          else if (f === 'nout') P.resize(st.doc, g, g.ins.length, Math.max(0, Number(v) || 0));
          else if (f === 'nch') P.resize(st.doc, g, Math.max(1, Number(v) || 1), Math.max(1, Number(v) || 1));
          else if (f === 'mode') { g.mode = v; P.resize(st.doc, g, null, null); }
          else if (f === 'mixes') g.mixes = v.split(',').map((x) => x.trim()).filter(Boolean);
          else if (f === 'open') { if (inp.checked) g.open = true; else delete g.open; }
          else if (f === 'localstart') g[f] = Math.max(1, Number(v) || 1);
          else if (f === 'name') g.name = v.trim() || g.name;
          else { if (v.trim()) g[f] = v.trim(); else delete g[f]; }
        }, null, !['nin', 'nout', 'nch', 'mode'].includes(f));
      }));
      $$('[data-in]', host).forEach((sel) => sel.addEventListener('change', () => {
        const i = Number(sel.dataset.in), v = sel.value; if (!v) return;
        if (v === '-') return change(() => { st.doc.cables = st.doc.cables.filter((c) => !(c.b === gid && c.bp === i)); }, 'Disconnected');
        const [aid, ap] = v.split(':'); const a = gearOf(aid);
        change(() => P.connect(st.doc, a, Number(ap), live(), i), 'Connected');
      }));
      $$('[data-out]', host).forEach((sel) => sel.addEventListener('change', () => {
        const j = Number(sel.dataset.out), v = sel.value; if (!v) return;
        const [bid, bp] = v.split(':'); const b = gearOf(bid);
        change(() => P.connect(st.doc, live(), j, b, Number(bp)), 'Connected');
      }));
      $$('[data-feed]', host).forEach((sel) => sel.addEventListener('change', () => { const j = Number(sel.dataset.feed); change(() => { const g = live(); g.feeds = g.feeds || {}; if (sel.value) g.feeds[j] = sel.value; else delete g.feeds[j]; }, null, true); }));
      $$('[data-cut]', host).forEach((b) => b.addEventListener('click', () => change(() => { st.doc.cables = st.doc.cables.filter((c) => c.id !== b.dataset.cut); }, 'Disconnected')));
      $$('[data-unlink]', host).forEach((b) => b.addEventListener('click', () => change(() => { st.doc.cables = st.doc.cables.filter((c) => c.id !== b.dataset.unlink); }, 'Unlinked')));
      const lk = $('[data-link]', host);
      if (lk) lk.addEventListener('change', () => { const b = gearOf(lk.value); if (b) picker(live(), b, { linkOnly: !(b.kind === 'console' || b.kind === 'stagebox') }); });
      const md = $('#pmkdev', host);
      if (md) md.addEventListener('click', async () => {
        try {
          await loadDevices();
          const ex = DEV.list.find((d) => key(d.name) === key(g.name));
          const id = ex ? ex.id : (await call('POST', '/api/devices', { name: g.name, category: 'audio', make: g.make || '', model: g.model || '', inputs: g.ins.length, outputs: g.outs.length })).id;
          if (typeof forgetDevices === 'function') forgetDevices(); await loadDevices(true);
          change(() => { live().device_id = id; }, 'Added to the Gear Locker');
        } catch (e) { toast(e.message, 'bad'); }
      });
      $('#pdel', host).addEventListener('click', () => removeGear(gid));
      const pd = $('#pdup', host); if (pd) pd.addEventListener('click', () => duplicate(live()));
      const po = $('#pout', host); if (po) po.addEventListener('click', () => change(() => { st.doc.cables = st.doc.cables.filter((c) => !((c.a === gid || c.b === gid) && c.kind === 'rf')); }, g.name + ' is on its own now'));
    }
    function removeGear(id) {
      const g = gearOf(id);
      if (!g) return;
      const mem = P.members(st.doc, g);
      const n = st.doc.cables.filter((c) => (c.a === id || c.b === id) && c.kind !== 'rf').length;
      st.sel = [];
      change(() => P.removeGear(st.doc, id), 'Removed ' + g.name + (mem.length ? ' with its ' + mem.length + (g.kind === 'receiver' ? ' mic' : ' pack') + (mem.length === 1 ? '' : 's') : '') + (n ? ' and ' + n + ' cable' + (n === 1 ? '' : 's') : '') + '. Undo brings it back.');
      closeSheet();
    }
    function cablePane(host, c) {
      const a = gearOf(c.a), b = gearOf(c.b);
      const ro = !st.edit;
      host.innerHTML = '<div class="pph"><button class="ghost pback" id="pbk">' + icon('x') + '</button><span class="pkind">' + (c.ap === 'link' ? 'Link' : 'Cable') + '</span></div>' +
        '<p class="pcab"><b>' + esc(a.name + (c.ap === 'link' ? '' : ' ' + a.outs[c.ap])) + '</b><br>→ <b>' + esc(b.name + (c.bp === 'link' ? '' : ' ' + b.ins[c.bp])) + '</b></p><div class="pform">' +
        '<label>Type<select data-c="kind"' + (ro ? ' disabled' : '') + '>' + Object.entries(KIND_STYLE).map(([k, v]) => '<option value="' + k + '"' + (c.kind === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label>' +
        '<label>' + (c.ap === 'link' ? 'Link name (SLink, AES50, Dante)' : 'Label') + '<input data-c="label" value="' + esc(c.label || '') + '"' + (ro ? ' disabled' : '') + '></label>' +
        '<label>Length<input data-c="length" value="' + esc(c.length || '') + '" placeholder="25 ft"' + (ro ? ' disabled' : '') + '></label>' +
        '<label>Notes<textarea data-c="notes" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(c.notes || '') + '</textarea></label></div>' +
        (st.edit && c.ap === 'link' && (a.kind === 'stagebox' || b.kind === 'stagebox') ? '<button class="btn" id="pchan2">' + icon('list') + 'Assign console channels</button>' : '') +
        (st.edit ? '<div class="pacts"><span class="grow"></span><button class="ghost danger" id="pcdel">' + icon('trash') + 'Remove ' + (c.ap === 'link' ? 'link' : 'cable') + '</button></div>' : '');
      $('#pbk', host).addEventListener('click', () => { select(null); const m = host.closest('.modal'); if (m) m.remove(); });
      if (!st.edit) return;
      const pc = $('#pchan2', host); if (pc) pc.addEventListener('click', () => channelDialog(a.kind === 'stagebox' ? a : b));
      $$('[data-c]', host).forEach((inp) => inp.addEventListener('change', () => change(() => { const cc = st.doc.cables.find((x) => x.id === c.id); if (inp.value.trim()) cc[inp.dataset.c] = inp.value.trim(); else delete cc[inp.dataset.c]; }, null, true)));
      $('#pcdel', host).addEventListener('click', () => { st.selCable = null; change(() => { st.doc.cables = st.doc.cables.filter((x) => x.id !== c.id); }, 'Cable removed'); closeSheet(); });
    }
    /** Phone: details and quick edits slide up from the bottom. */
    function sheet(addMode) {
      document.querySelectorAll('.modal.psheet').forEach((m) => m.remove());
      modal('<div class="ppane insheet" id="psh"></div>', (w) => {
        w.classList.add('psheet');
        // the tap that opened it must not also close it (its mouse events land on the backdrop)
        w.dataset.locked = '1'; setTimeout(() => { delete w.dataset.locked; }, 450);
        const host = $('#psh', w);
        if (addMode) addPane(host); else paintPane(host);
      });
    }
    function titleDialog() {
      modal('<h3>Title</h3><form id="ptf"><label>Title</label><input id="ptt" value="' + esc(st.doc.title) + '"><label>Line under it</label><textarea id="pts" rows="3">' + esc(st.doc.subtitle || '') + '</textarea><div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>', (w, close) => {
        $('#ptf', w).addEventListener('submit', (e) => { e.preventDefault(); close(); change(() => { st.doc.title = $('#ptt', w).value.trim() || st.doc.title; st.doc.subtitle = $('#pts', w).value.trim(); }); paintTitle(); });
      });
    }

    // ---------- the bar ----------
    $$('#prt button').forEach((b) => b.addEventListener('click', () => { st.report = b.dataset.r; $$('#prt button').forEach((x) => x.classList.toggle('on', x === b)); paintReport(); }));
    $('#psp').addEventListener('change', (e) => { st.spares = e.target.checked; paintReport(); });
    const saveSnap = () => { try { localStorage.setItem('lg-psnap', st.snap ? '1' : '0'); } catch (e) { /* private mode */ } };
    $('#psnap').addEventListener('change', (e) => { st.snap = e.target.checked; saveSnap(); });
    $('#ptidy').addEventListener('click', tidy);
    $$('[data-al]').forEach((b) => b.addEventListener('click', () => align(b.dataset.al)));
    const pe = $('#pedit');
    const setEdit = (on) => {
      st.edit = on;
      document.body.classList.toggle('patchedit', on);
      if (pe) { pe.classList.toggle('primary', on); pe.querySelector('span').textContent = on ? 'Done' : 'Edit'; }
      $('#ptools').classList.toggle('hide', !on);
      $('#padd').classList.toggle('hide', !on);
      paintTitle(); paint(true); paintPane(); paintAlign();
    };
    if (pe) pe.addEventListener('click', () => setEdit(!st.edit));
    $('#pun').addEventListener('click', undo); $('#pre').addEventListener('click', redo);
    $('#padd').addEventListener('click', () => sheet(true));
    $('#ppdf').addEventListener('click', () => {
      select(null);
      const before = st.tf; const b = D.bbox;
      svg.setAttribute('viewBox', b.x0 + ' ' + b.y0 + ' ' + (b.x1 - b.x0) + ' ' + (b.y1 - b.y0)); vp.removeAttribute('transform'); svg.classList.add('printing');
      const after = () => { svg.removeAttribute('viewBox'); svg.classList.remove('printing'); st.tf = before; apply(); window.removeEventListener('afterprint', after); };
      window.addEventListener('afterprint', after);
      exportPdf(st.doc.title);
      setTimeout(after, 60000);
    });
    const ph = $('#phist');
    if (ph) ph.addEventListener('click', async () => {
      const v = await get('/api/patch/versions');
      modal('<h3>Stage patch versions</h3><p>Every save is kept (the newest 200). Restoring makes it the current version; nothing is lost.</p><div class="plist2" style="max-height:50vh;overflow:auto">' +
        v.versions.map((x) => '<div class="prow"><b>Version ' + x.version + '</b><span>' + esc(ago(x.saved_at)) + (x.saved_by ? ' · ' + esc(x.saved_by) : '') + (x.note ? ' · ' + esc(x.note) : '') + '</span>' + (x.version !== st.version ? '<button class="btn" data-rv="' + x.version + '">' + icon('restore') + 'Restore</button>' : '<span class="chip ok">Current</span>') + '</div>').join('') +
        '</div><div class="acts"><button class="primary" data-close>Close</button></div>', (w, close) => {
        $$('[data-rv]', w).forEach((b) => b.addEventListener('click', async () => {
          try { const r = await call('POST', '/api/patch/versions/' + b.dataset.rv + '/restore'); st.doc = r.doc; st.version = r.version; st.undo = []; st.redo = []; st.cache = null; close(); paint(true); paintPane(); toast('Restored version ' + b.dataset.rv, 'ok'); }
          catch (e) { toast(e.message, 'bad'); }
        }));
      });
    });

    // the team's names, for tagging who uses a mic or pack
    if (canEdit && !S.people) get('/api/users').then((r) => { S.people = (r.users || []).map((u) => u.name); }).catch(() => { S.people = []; });

    paintTitle();
    paint(false);
    paintPane();
    if (qs && qs.get('g')) { select({ gear: [qs.get('g')] }, { noSheet: true }); focusGear(qs.get('g')); }
    if (qs && qs.get('edit') && canEdit) setEdit(true);
  }

  // ================= a list on a page =================
  let cache = null;
  async function load(force) { if (!cache || force || Date.now() - cache.at > 15000) cache = { at: Date.now(), p: get('/api/patch') }; return (await cache.p).doc; }
  function blockHtml(b) {
    const title = b.title || (REPORTS.find((r) => r[0] === b.report) || REPORTS[0])[1];
    return '<div class="patchrep blockbox" data-prep="' + esc(b.report) + '" data-pf="' + esc(b.filter || '') + '"><div class="ph"><b>' + esc(title) + '</b>' + (b.filter ? '<span class="note">' + esc(b.filter) + '</span>' : '') +
      '<a class="note" href="#/patch" style="margin-left:auto">From the stage patch ›</a></div><div class="prb"><span class="note">Loading…</span></div></div>';
  }
  async function wireBlocks(root) {
    const els = $$('.patchrep', root);
    if (!els.length) return;
    try {
      const doc = await load();
      els.forEach((el) => {
        el.querySelector('.prb').innerHTML = reportHtml(doc, el.dataset.prep, el.dataset.pf);
        el.querySelectorAll('tr[data-gs]').forEach((tr) => { tr.style.cursor = 'pointer'; tr.addEventListener('click', () => { location.hash = '#/patch?g=' + encodeURIComponent(tr.dataset.gs.split(',')[0]); }); });
      });
    } catch (e) { els.forEach((el) => { el.querySelector('.prb').innerHTML = '<span class="note">' + esc(e.message) + '</span>'; }); }
  }

  return { view, reportHtml, blockHtml, wireBlocks, REPORTS, draw, place, cardModel, trace, load };
})();
