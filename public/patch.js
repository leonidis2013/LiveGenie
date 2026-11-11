/*
 * The stage patch: one drawing for the whole system.
 *   Cards sit wherever you put them (Auto-arrange lays everything out once, by signal flow).
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
  /** A wireless system's mini-cards: MINI wide, RFG of radio line between them and the receiver or transmitter; WLH the label over the box. */
  const MINI = 150, RFG = 70, SIDE = MINI + RFG, WLH = 24;
  const GRID = 10, CW = 300, HEAD = 50, ROW = 20, FOOT = 10, COLGAP = 100, VGAP = 30, LINKY = 30, CY = 35;   // CY: the socket on a one-socket card, on its second line
  const KIND_STYLE = { xlr: 'Analog · XLR', link: 'Digital snake', dante: 'Dante · Cat6', usb: 'USB · Thunderbolt', aes: 'AES3', speaker: 'Speaker · NL4', wiem: 'Wired IEM', rf: 'Wireless · RF', net: 'Network · Cat6' };
  /** A short tag for a make: initials for "X & Y" names, the first word of a long one. */
  const makeTag = (m) => { m = String(m || '').trim(); if (/ & /.test(m)) return m.split(/\s*&\s*/).map((w) => w[0] || '').join('&'); return m.length > 10 ? m.split(/\s+/)[0] : m; };
  let CHW = 7;   // average width of a letter on a card (11.5 px text), for shortening names so they never run into each other
  /** Text size on the drawing (each viewer picks theirs): letters get bigger, cards keep their size, so long names shorten sooner. */
  const TEXT_SIZES = [1, 1.15, 1.3];
  let TS = 1;
  const setTextSize = (n) => { TS = TEXT_SIZES.includes(n) ? n : 1; CHW = 7 * TS; };
  const cut = (s, n) => { s = String(s || ''); return n < 2 ? '' : s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; };
  const key = (v) => String(v || '').trim().toLowerCase();
  const snap = (v) => Math.round(v / GRID) * GRID;
  const who = (g) => [g.person, g.use].filter(Boolean).join(' · ');
  /** A console colour name as a colour on screen (Red, Lt Blue, Magenta, Off…). */
  const COLOR_CSS = { red: '#ef4444', green: '#22c55e', yellow: '#eab308', blue: '#3b82f6', 'light blue': '#38bdf8', 'lt blue': '#38bdf8', cyan: '#06b6d4', purple: '#a855f7', magenta: '#d946ef', pink: '#ec4899', orange: '#f97316', white: '#e5e7eb', black: '#111827', grey: '#9ca3af', gray: '#9ca3af', brown: '#92400e', off: 'transparent' };
  const colorCss = (c) => COLOR_CSS[key(c)] || COLOR_CSS[key(c).replace(/^(dark|light|lt|dk)\s*/, '')] || '#9ca3af';
  const SRC_KINDS = ['mic', 'di', 'source', 'txmic'];
  /** "RX-1 (SLXD4D)": a tag name with its model, for lists and pickers. */
  const tm = (g) => (typeof Tags !== 'undefined' ? Tags.withModel(g.name, g.model) : g.name);
  /** The Gear Locker card behind a piece of gear (null when it has none, or the list is not loaded). */
  const devOf = (g) => (g && g.device_id && typeof DEV !== 'undefined' && DEV.list ? DEV.list.find((d) => d.id === g.device_id) || null : null);
  /** Gear with a network socket: switches and computers, anything ticked "On the network" in the Gear Locker, or already cabled. */
  /** Gear that takes a network cable: big gear always does (a console, stage box, receiver…); anything else once its card says it is on the network. */
  const NET_KINDS = ['network', 'computer', 'console', 'stagebox', 'processor', 'amp', 'receiver', 'iemtx'];
  // a block linked to a Gear Locker card follows its "On the network" tick; a block with no card goes by its kind.
  // A network cable already drawn keeps its socket, so nothing is left hanging.
  const hasNet = (doc, g) => {
    if (g.kind === 'network' || P.netOf(doc, g)) return true;
    const d = devOf(g);
    return d ? !!d.networked : NET_KINDS.includes(g.kind);
  };

  // ================= cards =================
  /** Gear drawn as cards: everything except mics and packs that live inside a wireless system. */
  function cardGear(doc) {
    const hosted = new Set();
    doc.gear.forEach((g) => { if (P.KINDS[g.kind].member && P.hostOf(doc, g)) hosted.add(g.id); });
    return doc.gear.filter((g) => !hosted.has(g.id));
  }

  /** Lay out one card: which rows it shows, where each socket sits (relative to the card), how tall it is. */
  function cardModel(doc, ix, g, edit) {
    const k = P.KINDS[g.kind];
    const usedIn = (i) => !!ix.into.get(g.id + ':' + i);
    const usedOut = (j) => !!((ix.from.get(g.id + ':' + j) || []).length || (g.feeds || {})[j]);
    const mem = P.members(doc, g);
    const live = mem.filter((m) => !m.g.spare), spares = mem.filter((m) => m.g.spare);
    const memAt = new Map(live.map((m) => [m.port, m]));
    const sys = g.kind === 'receiver' || g.kind === 'iemtx', shut = sys && !!g.wlshut;
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
      // spare mics: a row each under the channels, shown greyed beside the receiver
      if (g.kind === 'receiver' && !shut) spares.forEach((m) => rows.push({ spare: m }));
    } else {
      // the radio link of a wireless mic, transmitter or pack is shown by where it sits, not by a socket
      const ins = g.kind === 'bodypack' ? [] : g.ins.map((_, i) => i).filter((i) => open || usedIn(i));
      // a stage box lists its inputs in console channel order (In 8 on Ch 1 comes first), so the drawing reads by channel
      if (g.kind === 'stagebox') { const ch = (i) => { const v = P.chanOf(g, i); return v == null ? 1e9 : v; }; ins.sort((a, b) => ch(a) - ch(b) || a - b); }
      const outs = g.kind === 'iemtx' || g.kind === 'txmic' ? [] : g.outs.map((_, j) => j).filter((j) => open || usedOut(j));
      freeIn = g.ins.length - ins.length; freeOut = g.outs.length - outs.length;
      for (let r = 0; r < Math.max(ins.length, outs.length); r++) rows.push({ in: ins[r] != null ? ins[r] : null, out: outs[r] != null ? outs[r] : null });
    }
    // an IEM transmitter lists its packs (and, while editing, a row to add one)
    if (g.kind === 'iemtx' && !shut) { mem.forEach((m) => rows.push({ pack: m })); if (edit) rows.push({ addpack: true }); }
    // a network switch: its ports (the ones in use, or all of them when open)
    const portY = {};
    if (g.kind === 'network') {
      const used = new Map(doc.cables.filter((c) => c.ap === 'net' && c.b === g.id && c.port).map((c) => [c.port, c]));
      const n = g.nports || 8, showAll = !!g.open || n <= 8;
      for (let p = 1; p <= n; p++) { if (showAll || used.has(p)) rows.push({ port: p, cable: used.get(p) || null }); else freeIn++; }
    }
    // a network socket on anything that is on the network
    const net = hasNet(doc, g);
    if (net) rows.push({ net: true });
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
    if ((!small || g.kind === 'network') && (freeIn || freeOut || (g.open && g.kind !== 'network') || (g.kind === 'network' && g.open && (g.nports || 8) > 8))) rows.push({ more: true, freeIn, freeOut, ports: g.kind === 'network' });
    let netY = null;
    // a card with a single socket (a mic, a DI, a speaker) keeps it on its second line: no extra row, a much shorter card
    const compact = rows.length === 1 && (rows[0].in != null) !== (rows[0].out != null) && !rows[0].member && !sys && !k.link && !['console', 'stagebox', 'network', 'computer', 'interface'].includes(g.kind);
    rows.forEach((r, n) => { const y = compact ? CY : HEAD + n * ROW + ROW / 2; if (r.in != null && !r.pack) inY[r.in] = y; if (r.out != null) outY[r.out] = y; if (r.port) portY[r.port] = y; if (r.net) netY = y; });
    const h = compact ? HEAD : HEAD + rows.length * ROW + (rows.length ? FOOT : 0);
    const side = sys && !shut ? (g.kind === 'receiver' ? 'left' : 'right') : null;
    return { g, k, rows, inY, outY, portY, netY, w: CW, h: compact ? HEAD : Math.max(HEAD + FOOT, h), compact, mem, live, spares, link: !!k.link, small, sys, shut, side, ox: side === 'left' ? -SIDE - 8 : -8, ow: CW + (side ? SIDE : 0) + 16 };
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
      ranked.forEach(({ g }) => { const o = outer(models.get(g.id), { x: 0, y: 0 }); pos.set(g.id, { x, y: y - o.y }); y = snap(y + o.h + VGAP); });
      x += CW + COLGAP;
    }
    return pos;
  }
  /**
   * Auto-arrange: a one-time layout of the whole drawing in the order sound travels, left to right:
   * sources (mics, receivers) → stage I/O → console → processing → amps → outputs (speakers, wedges, in-ears).
   * A card never leaves its stage; cables only decide the order within a stage (each card near what it connects to,
   * a few passes to untangle). Loops (a stage box that feeds the console and is fed by it) do not matter.
   * Network gear (switches, computers) gets a lane under the signal flow; gear with no cables goes in a
   * "Not connected" row along the bottom.
   */
  /**
   * Auto-arrange, one time (undoable). Reads like a stage plot, left to right:
   *   inputs (sources, then stage boxes) → console → each thing the console feeds, in its own band.
   * Each output branch (in-ears, a sub off the stage box, processor → amps → speakers…) starts right next to the console
   * and is stacked under the one before, so the drawing stays compact instead of one long line.
   * Network gear sits in a lane underneath; gear with no cables goes in a "Not connected" row at the bottom.
   */
  function autoArrange(doc) {
    const ix = P.index(doc);
    const list = cardGear(doc);
    const models = new Map(list.map((g) => [g.id, cardModel(doc, ix, g)]));
    const ids = [...models.keys()];
    const cardIdOf = (id) => { const g = ix.G.get(id); const h = g && P.hostOf(doc, g); return h ? h.id : id; };
    const nb = new Map(ids.map((id) => [id, new Set()]));
    const down = new Map(ids.map((id) => [id, []]));          // signal a → b, with the output socket it leaves from
    const wired = new Set();
    for (const c of doc.cables) {
      if (c.ap === 'net') continue;
      const a = cardIdOf(c.a), b = cardIdOf(c.b);
      if (a === b || !nb.has(a) || !nb.has(b)) continue;      // a mic inside its receiver
      nb.get(a).add(b); nb.get(b).add(a); wired.add(a); wired.add(b);
      down.get(a).push({ to: b, port: typeof c.ap === 'number' ? c.ap : -1 });
    }
    doc.cables.filter((c) => c.ap === 'net').forEach((c) => { wired.add(cardIdOf(c.a)); wired.add(cardIdOf(c.b)); });
    const g = (id) => models.get(id).g;
    const stage = (id) => P.stageOf(g(id));
    const kindRank = (id) => P.KIND_ORDER.indexOf(g(id).kind);
    const loose = ids.filter((id) => !wired.has(id));
    const netIds = ids.filter((id) => wired.has(id) && stage(id) === 'net');
    const flow = ids.filter((id) => wired.has(id) && stage(id) !== 'net');
    const STEP = CW + COLGAP + 20;
    const out = new Map();
    const box = (id, p) => outer(models.get(id), p || { x: 0, y: 0 });

    // ---- input side: sources | stage I/O | console
    const inSide = flow.filter((id) => stage(id) <= 2);
    const outSide = flow.filter((id) => stage(id) > 2);
    const hasSrc = inSide.some((id) => stage(id) === 0), hasBox = inSide.some((id) => stage(id) === 1);
    const colIn = (id) => (stage(id) === 0 ? 0 : stage(id) === 1 ? (hasSrc ? 1 : 0) : (hasSrc ? 1 : 0) + (hasBox ? 1 : 0));
    const CON = inSide.length ? Math.max(...inSide.map(colIn)) : 0;
    const inCols = []; inSide.forEach((id) => { (inCols[colIn(id)] = inCols[colIn(id)] || []).push(id); });
    for (let k = 0; k < inCols.length; k++) inCols[k] = inCols[k] || [];
    // the console channel each card ends up on (its lowest): the order the input side reads in, top to bottom.
    // Every card along the way counts (a mic, its receiver, a DI, the stage box); a second console's channels come after the first's.
    const chKey = new Map();
    try {
      const cons = doc.gear.filter((x) => x.kind === 'console').map((x) => x.id);
      P.inputs(doc).forEach((r) => {
        if (!r.used || r.ch == null || r.pc) return;
        const k = cons.indexOf(r.console.id) * 1000 + r.ch;
        const mark = (id) => { const cid = cardIdOf(id); if (models.has(cid) && !(chKey.get(cid) <= k)) chKey.set(cid, k); };
        r.up.chain.forEach((x) => mark(x.id));
        if (r.via && r.via.kind === 'stagebox') mark(r.via.id);
      });
    } catch (e) { /* a drawing that cannot be traced still arranges */ }
    const chOf = (id) => (chKey.has(id) ? chKey.get(id) : Infinity);
    inCols.forEach((col) => col.sort((a, b) => chOf(a) - chOf(b) || kindRank(a) - kindRank(b) || (g(a).order || 0) - (g(b).order || 0)));
    // order: next to what each card connects to in the column beside it (a few sweeps)
    const rank = new Map(); inCols.forEach((col) => col.forEach((id, k) => rank.set(id, k)));
    const ciOf = new Map(); inCols.forEach((col, k) => col.forEach((id) => ciOf.set(id, k)));
    for (let sweep = 0; sweep < 6; sweep++) {
      const right = sweep % 2 === 0;
      const seq = right ? inCols.map((_, k) => inCols.length - 1 - k) : inCols.map((_, k) => k);
      seq.forEach((k) => {
        const col = inCols[k];
        const key = new Map(col.map((id, n) => {
          const l = [...nb.get(id)].filter((x) => ciOf.has(x) && (right ? ciOf.get(x) > k : ciOf.get(x) < k)).map((x) => rank.get(x));
          return [id, l.length ? l.reduce((s1, v) => s1 + v, 0) / l.length : n];
        }));
        col.sort((a, b) => chOf(a) - chOf(b) || key.get(a) - key.get(b) || rank.get(a) - rank.get(b));
        col.forEach((id, n) => rank.set(id, n));
      });
    }
    // sockets: where a cable meets a card (its row), so cards can line up with the socket they plug into
    const sockY = (id, side, port) => { const m = models.get(id); if (typeof port !== 'number' || port < 0) return LINKY; const v = side === 'in' ? m.inY[port] : m.outY[port]; return v == null ? HEAD : v; };
    const wires = [];
    for (const c of doc.cables) {
      if (c.ap === 'net') continue;
      const a = cardIdOf(c.a), b = cardIdOf(c.b);
      if (a === b || !nb.has(a) || !nb.has(b)) continue;
      // a mic in a wireless system plugs in through its receiver's card: the header row
      wires.push({ a, ap: a === c.a ? c.ap : 'link', b, bp: b === c.b ? c.bp : 'link' });
    }
    /** Where each card in column k wants to be: next to the socket rows it connects to in the columns already placed (right of it). */
    const targets = (id, k) => {
      const t = [];
      wires.forEach((w) => {
        if (w.a === id && ciOf.get(w.b) > k && out.has(w.b)) t.push({ at: out.get(w.b).y + sockY(w.b, 'in', w.bp), own: sockY(id, 'out', w.ap) });
        else if (w.b === id && ciOf.get(w.a) > k && out.has(w.a)) t.push({ at: out.get(w.a).y + sockY(w.a, 'out', w.ap), own: sockY(id, 'in', w.bp) });
      });
      return t;
    };
    // room between columns for every cable to have its own lane (a stage box with 14 mics needs more than a pair of cables)
    const colX = [0];
    for (let k = 0; k < inCols.length - 1; k++) {
      const n = wires.filter((w) => { const a = ciOf.get(w.a), b = ciOf.get(w.b); return a != null && b != null && Math.min(a, b) <= k && Math.max(a, b) > k; }).length;
      colX.push(colX[k] + CW + snap(Math.max(STEP - CW, (n + 4) * GRID)));
    }
    const conX = colX[CON] || 0;
    // the console column first (top), then each column to its left lines up with what it feeds
    const stack = (col, k, wantOf) => {
      let y = 0;
      col.forEach((id) => {
        const o = box(id);
        const want = wantOf ? wantOf(id) : null;
        const yy = snap(Math.max(y - o.y, want == null ? -Infinity : want));
        out.set(id, { x: colX[k] || 0, y: yy });
        y = snap(yy + o.y + o.h + VGAP);
      });
    };
    if (inCols[CON]) stack(inCols[CON], CON);
    for (let k = CON - 1; k >= 0; k--) {
      // order by the mean height of the sockets each card plugs into (a wireless system counts as one block: its outputs),
      // then line each card's first cable up with its socket: cables run nearly straight and never cross inside a column
      const key = new Map(inCols[k].map((id) => { const t = targets(id, k); return [id, t.length ? t.reduce((s1, x) => s1 + x.at, 0) / t.length : Infinity]; }));
      // by console channel first (the user reads the input side in channel order); socket height breaks ties and places cards with no channel
      inCols[k].sort((a, b) => chOf(a) - chOf(b) || key.get(a) - key.get(b) || rank.get(a) - rank.get(b));
      inCols[k].forEach((id, n) => rank.set(id, n));
      stack(inCols[k], k, (id) => { const t = targets(id, k); return t.length ? Math.min(...t.map((x) => x.at - x.own)) : null; });
    }

    // ---- output side: how far each card is from the console (the stage box's outputs count as the console's)
    const roots = inSide.filter((id) => stage(id) >= 1);
    const depth = new Map();
    const q = [];
    roots.forEach((r) => down.get(r).forEach((e) => { if (outSide.includes(e.to)) { if (!depth.has(e.to)) { depth.set(e.to, 1); q.push(e.to); } } }));
    for (let n = 0; n < q.length && n < 2000; n++) {
      const id = q[n];
      down.get(id).forEach((e) => { if (outSide.includes(e.to) && (depth.get(e.to) || 0) < depth.get(id) + 1 && depth.get(id) < 12) { depth.set(e.to, depth.get(id) + 1); q.push(e.to); } });
    }
    outSide.forEach((id) => { if (!depth.has(id)) depth.set(id, 1); });
    // branches: groups of output gear joined to each other; ordered by the console output that feeds them
    const seen = new Set(), branches = [];
    outSide.forEach((id) => {
      if (seen.has(id)) return;
      const part = [], st0 = [id]; seen.add(id);
      while (st0.length) { const x = st0.pop(); part.push(x); nb.get(x).forEach((y) => { if (outSide.includes(y) && !seen.has(y)) { seen.add(y); st0.push(y); } }); }
      const feeds = [];
      part.forEach((x) => roots.forEach((r) => down.get(r).forEach((e) => { if (e.to === x) feeds.push((stage(r) === 2 ? 0 : 1000) + (e.port < 0 ? 999 : e.port)); })));
      branches.push({ part, key: feeds.length ? Math.min(...feeds) : 1e6 });
    });
    branches.sort((a, b) => a.key - b.key);
    let bandY = 0;
    branches.forEach((br) => {
      const cols = new Map();
      br.part.forEach((id) => { const k = depth.get(id); if (!cols.has(k)) cols.set(k, []); cols.get(k).push(id); });
      const ks = [...cols.keys()].sort((a, b) => a - b);
      let bottom = bandY;
      ks.forEach((k) => {
        const col = cols.get(k);
        // in feed order: the output socket that feeds it (the console's Out 1 before Out 11), lined up with that socket
        const feedBy = (id) => wires.filter((w) => w.b === id && out.has(w.a) && (!depth.has(w.a) || depth.get(w.a) < k)).map((w) => ({ at: out.get(w.a).y + sockY(w.a, 'out', w.ap), own: sockY(id, 'in', w.bp) }));
        const key = (id) => { const f = feedBy(id); if (f.length) return Math.min(...f.map((x) => x.at)); const ps = [...nb.get(id)].filter((x) => out.has(x)).map((x) => out.get(x).y); return ps.length ? Math.min(...ps) : 0; };
        col.sort((a, b) => key(a) - key(b) || kindRank(a) - kindRank(b));
        let y = bandY;
        col.forEach((id) => {
          const o = box(id);
          const f = feedBy(id);
          const ps = [...nb.get(id)].filter((x) => out.has(x) && depth.has(x) && depth.get(x) < k).map((x) => out.get(x).y);
          const want = f.length ? Math.min(...f.map((x) => x.at - x.own)) : ps.length ? Math.min(...ps) : bandY;
          const yy = snap(Math.max(y - o.y, want));
          out.set(id, { x: conX + k * STEP, y: yy });
          y = snap(yy + o.y + o.h + VGAP);
          bottom = Math.max(bottom, yy + o.y + o.h);
        });
      });
      bandY = snap(bottom + VGAP + 20);
    });

    const bottom = () => Math.max(0, ...[...out.entries()].map(([id, p]) => { const o = box(id, p); return o.y + o.h; }));
    // a row of cards from x0, wrapping
    const row = (list2, y0, x0, perRow) => {
      let x = x0, y = y0, h = 0, n = 0;
      list2.forEach((id) => {
        const o = box(id);
        if (n && n % perRow === 0) { x = x0; y = snap(y + h + VGAP); h = 0; }
        out.set(id, { x: snap(x - o.x), y: snap(y - o.y) }); x += Math.max(STEP, snap(o.w + COLGAP)); h = Math.max(h, o.h); n++;
      });
      return list2.length ? y + h : y0;
    };
    const width = Math.max(3, CON + 1 + Math.max(0, ...outSide.map((id) => depth.get(id))));
    if (netIds.length) row(netIds.sort((a, b) => kindRank(a) - kindRank(b)), snap(bottom() + 90), conX, Math.max(2, width - CON));
    if (loose.length) {
      const order = (id) => { const s0 = stage(id); return s0 === 'net' ? 6 : s0; };
      row(loose.sort((a, b) => order(a) - order(b) || kindRank(a) - kindRank(b) || (g(a).order || 0) - (g(b).order || 0)), snap((out.size ? bottom() : 0) + (out.size ? 110 : 0)), 0, width);
    }
    return out;
  }
  /** The space a card takes, with its wireless system box (mini-cards to the left of a receiver, to the right of an in-ear transmitter). */
  const outer = (m, p) => { p = p || m.g; return m.sys ? { x: p.x + m.ox, y: p.y - WLH, w: m.ow, h: m.h + WLH + 6 } : { x: p.x, y: p.y, w: m.w, h: m.h }; };
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
  function place(doc, edit) {
    const ix = P.index(doc);
    const models = new Map(cardGear(doc).map((g) => [g.id, cardModel(doc, ix, g, edit)]));
    const missing = [...models.values()].filter((m) => m.g.x == null || m.g.y == null);
    if (missing.length) {
      const tidy = tidyPositions(doc, ix, models);
      if (missing.length === models.size) missing.forEach((m) => { const p = tidy.get(m.g.id); m.g.x = p.x; m.g.y = p.y; });
      else {
        const placed = [...models.values()].filter((m) => m.g.x != null && m.g.y != null).map((m) => outer(m));
        // its Tidy column, next to cards of the same kind if there are some
        missing.forEach((m) => {
          const same = [...models.values()].find((o) => o !== m && o.g.x != null && P.colOf(o.g) === P.colOf(m.g));
          const tp = tidy.get(m.g.id);
          const o = outer(m, { x: 0, y: 0 });
          const p = freeSpot(placed, o.w, o.h, (same ? same.g.x : tp.x) + o.x, (same ? same.g.y : tp.y) + o.y);
          m.g.x = p.x - o.x; m.g.y = p.y - o.y; placed.push(outer(m));
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
          // a cell another cable runs along costs more (lines spread apart); crossing one costs a little (fewer crossings)
          let cost = 1 + (nd !== d ? 5 : 0) + (nd & 1 ? usedV[m] : usedH[m]) * 3 + ((nd & 1 ? usedH[m] : usedV[m]) ? 3 : 0);
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
      if (c.ap === 'net') {
        if (ma.netY == null) continue;
        const L = ix.audioBy.get(c.id);
        list.push({ id: c.id, c, net: true, ma, mb, kind: 'net', label: L ? (c.label ? c.label + ' · Dante ' + L.chin + '/' + L.chout : P.audioLabel(L)) : c.label || '' });
        continue;
      }
      if (c.ap === 'link' || c.bp === 'link') {
        const a = ma.g, b = mb.g;
        const sb = a.kind === 'stagebox' ? a : b.kind === 'stagebox' ? b : null;
        let label = c.label || (c.kind === 'dante' ? 'Dante' : 'Link');
        const L = ix.audioBy.get(c.id);
        if (L) label = c.label ? c.label + ' · ' + P.audioLabel(L).replace(/^(USB|TB) · /, '') : P.audioLabel(L);
        else if (sb) {
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
    if (e.net) {
      // out of the gear's network socket (right side) into the switch port (left side)
      const py = e.c.port && e.mb.portY[e.c.port] != null ? e.mb.portY[e.c.port] : LINKY;
      return { s: { x: A.x + CW, y: A.y + e.ma.netY }, sd: [1, 0], e: { x: B.x, y: B.y + py }, ed: [-1, 0] };
    }
    if (e.link) {
      const right = A.x + CW / 2 <= B.x + CW / 2;
      return { s: { x: right ? A.x + CW : A.x, y: A.y + LINKY }, sd: [right ? 1 : -1, 0], e: { x: right ? B.x : B.x + CW, y: B.y + LINKY }, ed: [right ? -1 : 1, 0] };
    }
    return { s: { x: A.x + CW, y: A.y + e.ma.outY[e.c.ap] }, sd: [1, 0], e: { x: B.x, y: B.y + e.mb.inY[e.c.bp] }, ed: [-1, 0] };
  }

  /** Route every cable. cache: earlier routes, reused for cables whose ends did not move (keep = ids that may be reused). */
  function routeAll(E, models, pos, cache, keep) {
    const rects = [...models.values()].map((m) => outer(m, pos(m.g)));
    if (!rects.length) return new Map();
    const b = { x0: Math.min(...rects.map((r) => r.x)) - 160, y0: Math.min(...rects.map((r) => r.y)) - 120, x1: Math.max(...rects.map((r) => r.x + r.w)) + 160, y1: Math.max(...rects.map((r) => r.y + r.h)) + 120 };
    const R = makeRouter(rects, b);
    const out = new Map();
    // links first (they are the thick ones), then the rest from top to bottom
    // a fan of cables into one column of sockets crosses itself unless each cable keeps to its own lane: cables that
    // climb to their socket go from the lowest up, cables that drop go from the highest down
    const ySpan = (e) => { const en = ends(e, pos); return { sy: en.s.y, ty: en.e.y }; };
    const sk = new Map(E.map((e) => { const { sy, ty } = ySpan(e); return [e.id, ty <= sy ? -sy : 100000 + sy]; }));
    const order = E.slice().sort((p, q) => (!!q.link - !!p.link) || sk.get(p.id) - sk.get(q.id));
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
      if (g.kind === 'console' && c) { const u = P.upstream(doc, ix, g.id, i); if (u.src && u.src.chname) t = u.src.chname + ' ← ' + t; }
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
      case 'receiver': return [g.model, m.shut ? m.live.length + ' mic' + (m.live.length === 1 ? '' : 's') + (m.spares.length ? ' + ' + m.spares.length + ' spare' : '') : m.live.length + ' of ' + g.ins.length + ' ch in use'].filter(Boolean).join(' · ');
      case 'stagebox': return usedIns + ' of ' + g.ins.length + ' in · ' + usedOuts + ' of ' + g.outs.length + ' out';
      case 'console': return [g.model, usedIns ? usedIns + ' local in' : '', usedOuts ? usedOuts + ' local out' : ''].filter(Boolean).join(' · ');
      case 'iemtx': { const ie = P.inears(doc).find((x) => x.tx.id === g.id); return [g.mode, ie && ie.mix, g.freq && g.freq + ' MHz', m.shut ? m.live.length + ' pack' + (m.live.length === 1 ? '' : 's') : ''].filter(Boolean).join(' · '); }
      case 'bodypack': return [who(g), g.phones].filter(Boolean).join(' · ');
      case 'computer': return [(g.software || []).join(', ') || g.model, g.use].filter(Boolean).join(' · ');
      case 'interface': return [g.model, g.ins.length + ' in · ' + g.outs.length + ' out'].filter(Boolean).join(' · ');
      default: return [who(g), g.model].filter(Boolean).join(' · ');
    }
  }

  function defs() {
    return '<defs>' + Object.entries(P.CATS).map(([k, v]) => '<linearGradient id="pg-' + k + '" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="' + v.color + '" stop-opacity=".36"/><stop offset=".55" stop-color="' + v.color + '" stop-opacity=".07"/><stop offset="1" stop-color="' + v.color + '" stop-opacity="0"/></linearGradient>').join('') +
      Object.keys(KIND_STYLE).map((k) => '<marker id="pa-' + k + '" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" class="pa pa-' + k + '"/></marker>').join('') +
      '<pattern id="pgrid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1.1" class="gdot"/></pattern></defs>';
  }

  /** The key's sample for wireless systems: a dashed box with a radio line. */
  const WL_KEY = '<svg width="30" height="12" class="wkey"><rect x="1" y="1" width="28" height="10" rx="3"/><path d="M6 6h18"/></svg>';
  /** The dashed box round a wireless system, with its label and the fold toggle. */
  function sysBox(doc, m, p) {
    if (!m.sys) return '';
    const g = m.g, o = outer(m, p);
    const n = m.live.length, sp = m.spares.length;
    const t = tm(g) + ' · ' + (g.kind === 'receiver' ? n + ' of ' + g.ins.length + ' in use' : n + ' pack' + (n === 1 ? '' : 's')) + (sp ? ' · ' + sp + ' spare' : '');
    return '<g class="wbox"><rect class="wb" x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" rx="14"/>' +
      '<text class="wl" x="' + (o.x + 12) + '" y="' + (o.y + 15) + '">' + esc(cut(t, Math.floor((o.w - 60) / CHW))) + '</text>' +
      '<g class="wlt" data-wl="' + g.id + '"><rect x="' + (o.x + o.w - 34) + '" y="' + (o.y + 3) + '" width="26" height="16" rx="5"/><text x="' + (o.x + o.w - 21) + '" y="' + (o.y + 15) + '" text-anchor="middle">' + (m.shut ? '▸' : '▾') + '</text><title>' + (m.shut ? 'Show the ' + (g.kind === 'receiver' ? 'mics' : 'packs') : 'Fold to just the ' + (g.kind === 'receiver' ? 'receiver' : 'transmitter')) + '</title></g></g>';
  }
  /** A mic or pack inside a wireless system: a small card, and its radio line (antenna, frequency, band dot) to the receiver or transmitter. */
  function mini(doc, m, g, mx, ry, side, spare) {
    const host = m.g, fq = P.mhz(g.freq) != null ? g.freq : (g.kind === 'bodypack' ? host.freq : '');
    const f = P.mhz(fq);
    const mix = g.kind === 'bodypack' ? ((P.inears(doc).find((x) => x.tx.id === host.id) || {}).mix || '') : '';
    const t = [g.name, g.person || g.use, mix].filter(Boolean).join(' · ');
    // the radio line: from the mini-card to the card edge
    const lx1 = side === 'left' ? mx + MINI : mx - RFG, lx2 = side === 'left' ? mx + SIDE : mx;
    const ax = side === 'left' ? mx + MINI + 6 : lx1 + 6;
    let s = '<g class="wrf' + (spare ? ' spare' : '') + '"><path class="wln" d="M' + lx1 + ' ' + ry + 'H' + lx2 + '"/>' +
      '<path class="wan" d="M' + ax + ' ' + (ry - 8) + 'v8M' + (ax - 4) + ' ' + (ry - 8) + 'l4 4 4-4"/>' +
      (f != null ? '<circle class="wbd" cx="' + ((lx1 + lx2) / 2 + 22) + '" cy="' + (ry - 7) + '" r="3.5" fill="' + P.bandColor(f) + '"><title>TV channel band ' + P.band(f) * 6 + '–' + (P.band(f) * 6 + 6) + ' MHz</title></circle><text class="wfq" x="' + ((lx1 + lx2) / 2 + 14) + '" y="' + (ry - 4) + '" text-anchor="end">' + esc(String(fq).replace(/\s*mhz/i, '')) + '</text>' : '') + '</g>';
    s += '<g class="crow mem wmini' + (spare ? ' spare' : '') + '" data-mem="' + g.id + '"><rect class="mbg" x="' + mx + '" y="' + (ry - 9) + '" width="' + MINI + '" height="18" rx="5"/>' +
      '<text x="' + (mx + 8) + '" y="' + (ry + 4) + '">' + esc(cut(t, Math.floor((MINI - (spare ? 52 : 16)) / CHW))) + '</text>' +
      (spare ? '<text class="wsp" x="' + (mx + MINI - 6) + '" y="' + (ry + 4) + '" text-anchor="end">SPARE</text>' : '') +
      '<title>' + esc([tm(g), g.person || g.use, mix, g.capsule, fq && fq + ' MHz', spare ? 'spare' : ''].filter(Boolean).join(' · ')) + '</title></g>';
    return s;
  }
  /**
   * What each cable does, for its name (Tags.cableName): 'in' when it ends on a stage box or console input (at: the box's letter,
   * L / M for a console's local inputs; input: the socket number; back: how many cables further up the chain), 'lnk' for SLink, Dante
   * and other digital links, 'net' for network, 'spk' for amp to speaker, 'out' for the rest. Returns Map cable id → info.
   */
  function cableInfos(doc) {
    const ix = P.index(doc), G = ix.G, out = new Map();
    const byPos = (a, b) => (a.x || 0) - (b.x || 0) || (a.y || 0) - (b.y || 0) || (a.order || 0) - (b.order || 0);
    // stage box letters: from the tag (SB-A → A), else A, B, C… in drawing order
    const letter = new Map(), usedL = new Set();
    const boxes = doc.gear.filter((g) => g.kind === 'stagebox').sort(byPos);
    boxes.forEach((g) => { const m = /^SB[\s-]?([A-Z])\b/i.exec(g.name || ''); if (m) { letter.set(g.id, m[1].toUpperCase()); usedL.add(m[1].toUpperCase()); } });
    let li = 0;
    boxes.forEach((g) => { if (letter.has(g.id)) return; while (usedL.has(String.fromCharCode(65 + li)) || 'LM'.includes(String.fromCharCode(65 + li))) li++; const L = String.fromCharCode(65 + li); letter.set(g.id, L); usedL.add(L); });
    // a console's local inputs: L for the first, M for the second…
    doc.gear.filter((g) => g.kind === 'console').sort(byPos).forEach((g, i) => letter.set(g.id, String.fromCharCode(76 + i)));
    const DIGITAL = ['link', 'dante', 'aes'];
    for (const c of doc.cables) {
      if (c.kind === 'rf') continue;
      const a = G.get(c.a), b = G.get(c.b);
      if (!a || !b) continue;
      if (c.ap === 'net') { out.set(c.id, { type: 'net' }); continue; }
      if (c.kind === 'usb') { out.set(c.id, { type: 'usb' }); continue; }
      if (c.ap === 'link' || c.bp === 'link' || DIGITAL.includes(c.kind)) { out.set(c.id, { type: 'lnk' }); continue; }
      // follow the signal down to a stage box or console input
      let cur = c, back = 0, info = null;
      for (let n = 0; n < 8 && cur; n++) {
        const B = G.get(cur.b);
        if (!B) break;
        if ((B.kind === 'stagebox' || B.kind === 'console') && cur.bp !== 'link') { info = { type: 'in', at: letter.get(B.id), input: Number(cur.bp) + 1, back }; break; }
        const k = P.KINDS[B.kind] || {};
        if (B.kind === 'amp' || B.kind === 'processor' || B.kind === 'speaker' || B.kind === 'wedge' || B.kind === 'iemtx' || B.kind === 'headamp') break;
        const nexts = k.pass === 'same' ? (ix.from.get(B.id + ':' + cur.bp) || []) : B.outs.flatMap((_, j) => ix.from.get(B.id + ':' + j) || []);
        cur = nexts[0]; back++;
      }
      if (info) { out.set(c.id, info); continue; }
      out.set(c.id, { type: a.kind === 'amp' && (b.kind === 'speaker' || b.kind === 'wedge') ? 'spk' : 'out' });
    }
    return out;
  }
  function cardSvg(doc, ix, m, p, opts) {
    const g = m.g, cat = (P.KINDS[g.kind] || P.KINDS.other).cat;
    const x = p.x, y = p.y, w = m.w, h = m.h;
    const sub = cardSub(doc, ix, m);
    const chars = Math.floor(w / (8.6 * TS));
    const mk = g.make ? cut(makeTag(g.make).toUpperCase(), 10) : '';
    let s = '<g class="pcard cat-' + cat + (m.sys ? ' wsys' : '') + '" data-g="' + g.id + '"' + (m.mem.length ? ' data-m="' + m.mem.map((x) => x.g.id).join(',') + '"' : '') + '>' + sysBox(doc, m, p) +
      '<rect class="cbg" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10"/>' +
      '<rect class="cgl" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="url(#pg-' + cat + ')"/>' +
      '<rect class="cbd" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10"/>' +
      '<rect class="cdrag" x="' + x + '" y="' + y + '" width="' + w + '" height="' + HEAD + '" rx="10"/>' +
      '<text class="ct" x="' + (x + 12) + '" y="' + (y + 22) + '">' + esc(cut(g.name, chars - (mk ? mk.length + 3 : 0))) + '</text>' +
      '<text class="cs" x="' + (x + 12) + '" y="' + (y + 39) + '">' + esc(cut(sub, m.compact ? Math.floor(chars / 2) : chars + 3)) + '</text>' +
      (mk ? (() => { const mw = mk.length * 6 + 12; return '<g class="mk"><rect x="' + (x + w - 12 - mw) + '" y="' + (y + 10) + '" width="' + mw + '" height="16" rx="4"/><text x="' + (x + w - 12 - mw / 2) + '" y="' + (y + 21.5) + '" text-anchor="middle">' + esc(mk) + '</text></g>'; })() : '') +
      '<title>' + esc(g.name + (sub ? ' · ' + sub : '')) + '</title>';
    if (m.rows.length && !m.compact) s += '<line class="csep" x1="' + x + '" x2="' + (x + w) + '" y1="' + (y + HEAD - 2) + '" y2="' + (y + HEAD - 2) + '"/>';
    const half = w / 2;
    m.rows.forEach((r, n) => {
      const ry = m.compact ? y + CY : y + HEAD + n * ROW + ROW / 2;
      if (r.more) {
        const t = r.freeIn || r.freeOut ? '+ ' + [r.freeIn ? r.freeIn + (r.ports ? ' free port' + (r.freeIn === 1 ? '' : 's') : ' free in') : '', r.freeOut ? r.freeOut + ' free out' : ''].filter(Boolean).join(' · ') + '  ▾' : 'Show used only  ▴';
        s += '<g class="cmore" data-open="' + g.id + '"><rect x="' + (x + 6) + '" y="' + (ry - 9) + '" width="' + (w - 12) + '" height="18" rx="5"/><text x="' + (x + w / 2) + '" y="' + (ry + 4) + '" text-anchor="middle">' + esc(t) + '</text></g>';
        return;
      }
      if (r.head) { s += '<text class="chd" x="' + (x + 12) + '" y="' + (ry + 4) + '">' + esc(r.head.toUpperCase()) + '</text>'; return; }
      if (r.slink) {
        const sl = r.slink, u = P.upstream(doc, ix, sl.sb.id, sl.i);
        const nm = u.src && u.src.chname ? u.src.chname : '';
        const t = (nm ? nm + ' ← ' : '← ') + sl.sb.name + ' ' + sl.sb.ins[sl.i] + (!nm && u.source ? ' · ' + u.source : !nm && u.mic ? ' · ' + u.mic : '');
        s += '<g class="crow slk' + (sl.used ? ' used' : '') + '" data-g="' + sl.sb.id + '">' + (u.src && u.src.chcolor ? '<rect class="chc" x="' + (x + 6) + '" y="' + (ry - 6) + '" width="3" height="12" rx="1.5" fill="' + colorCss(u.src.chcolor) + '"/>' : '') + '<text x="' + (x + 12) + '" y="' + (ry + 4) + '"><tspan class="pn">Ch ' + sl.ch + '</tspan> ' + esc(cut(t, Math.floor((w - 60) / CHW))) + '</text></g>';
        return;
      }
      if (r.pack) {
        // a pack on an in-ear transmitter: a mini-card on the right, "IEM-1 · Kyle · Mix 3", the frequency on its radio line
        const pg = r.pack.g;
        s += '<text class="crx" x="' + (x + w - 12) + '" y="' + (ry + 4) + '" text-anchor="end">' + (pg.spare ? 'Spare pack' : 'Pack') + '</text>';
        s += mini(doc, m, pg, x + w + RFG, ry, 'right', pg.spare);
        return;
      }
      if (r.addpack) {
        s += '<g class="cadd wslot" data-addpk="' + g.id + '"><rect x="' + (x + w + RFG) + '" y="' + (ry - 9) + '" width="' + MINI + '" height="18" rx="5"/><text x="' + (x + w + RFG + 10) + '" y="' + (ry + 4) + '">+ pack</text><title>Add a pack to ' + esc(g.name) + '</title></g>';
        return;
      }
      if (r.port) {
        // a switch port, and what plugs into it
        const c = r.cable, a = c && ix.G.get(c.a);
        s += '<g class="sk in netp' + (c ? ' used' : '') + '" data-g="' + g.id + '" data-net="' + r.port + '"><rect class="hitc" x="' + (x - 9) + '" y="' + (ry - 9) + '" width="18" height="18"/><rect class="dot" x="' + (x - 4.5) + '" y="' + (ry - 4.5) + '" width="9" height="9" rx="2"/><text x="' + (x + 10) + '" y="' + (ry + 4) + '"><tspan class="pn">Port ' + r.port + '</tspan>' + (a ? ' ' + esc(cut(a.name, Math.floor((w - 70) / CHW))) : '') + '</text><title>' + esc(g.name + ' port ' + r.port + (a ? ': ' + a.name : ' (free)')) + '</title></g>';
        return;
      }
      if (r.net) {
        // the network socket: where it plugs in (switch and port)
        const c = P.netOf(doc, g), b = c && ix.G.get(c.b);
        const t = b ? b.name + (c.port ? ' port ' + c.port : '') : '';
        s += '<g class="sk out netp' + (c ? ' used' : '') + '" data-g="' + g.id + '" data-p="net"><rect class="hitc" x="' + (x + w - 9) + '" y="' + (ry - 9) + '" width="18" height="18"/><rect class="dot" x="' + (x + w - 4.5) + '" y="' + (ry - 4.5) + '" width="9" height="9" rx="2"/><text x="' + (x + w - 10) + '" y="' + (ry + 4) + '" text-anchor="end">' + (t ? esc(cut(t, Math.floor((w - 60) / CHW))) + ' ' : '') + '<tspan class="pn">Net</tspan></text><title>' + esc(g.name + ' network' + (t ? ': ' + t : ': drag to a switch')) + '</title></g>';
        return;
      }
      if (r.spare) {
        // a spare mic: greyed, beside the receiver, with the channel it sits on
        const sg = r.spare.g;
        s += '<text class="chd" x="' + (x + 12) + '" y="' + (ry + 4) + '">SPARE · ' + esc(g.ins[r.spare.port] || '') + '</text>';
        if (m.side) s += mini(doc, m, sg, x - SIDE, ry, 'left', true);
        return;
      }
      if (r.member || (g.kind === 'receiver' && m.side && r.in != null)) {
        // a receiver channel: its name in the card, its mic as a mini-card on the left (or a slot to add one)
        const tg = r.member && r.member.g;
        s += '<text class="crx" x="' + (x + 12) + '" y="' + (ry + 4) + '"><tspan class="pn">' + esc(g.ins[r.in]) + '</tspan>' + (tg && !m.side ? ' ' + esc(cut(tm(tg), 18)) : '') + '</text>';
        if (m.side && tg) s += mini(doc, m, tg, x - SIDE, ry, 'left');
        else if (m.side && opts.edit) s += '<g class="cadd wslot" data-addtx="' + g.id + ':' + r.in + '"><rect x="' + (x - SIDE) + '" y="' + (ry - 9) + '" width="' + MINI + '" height="18" rx="5"/><text x="' + (x - SIDE + 10) + '" y="' + (ry + 4) + '">+ mic</text><title>Put a wireless mic on ' + esc(g.ins[r.in]) + '</title></g>';
      } else if (r.member) {
        const tg = r.member.g;
        s += '<text class="crx" x="' + (x + 12) + '" y="' + (ry + 4) + '"><tspan class="pn">' + esc(g.ins[r.in]) + '</tspan> ' + esc(cut(tm(tg), 18)) + '</text>';
      } else if (r.in != null) {
        const t = socketText(doc, ix, g, 'in', r.in);
        const used = !!ix.into.get(g.id + ':' + r.in);
        const room = r.out != null ? half - 24 : w - 34;
        const label = m.compact
          ? '<text x="' + (x + w - 12) + '" y="' + (ry + 4) + '" text-anchor="end">' + (t ? '← ' + esc(cut(t, Math.floor((half - 20) / CHW))) : '<tspan class="pn">' + esc(g.ins[r.in]) + '</tspan>') + '</text>'
          : '<text x="' + (x + 10) + '" y="' + (ry + 4) + '"><tspan class="pn">' + esc(g.ins[r.in]) + '</tspan>' + (t ? ' ' + esc(cut(t, Math.floor(room / CHW) - g.ins[r.in].length)) : '') + '</text>';
        s += '<g class="sk in' + (used ? ' used' : '') + '" data-g="' + g.id + '" data-p="' + r.in + '"><circle class="hitc" cx="' + x + '" cy="' + ry + '" r="9"/><circle class="dot" cx="' + x + '" cy="' + ry + '" r="4.5"/>' + label + '<title>' + esc(g.name + ' ' + g.ins[r.in] + (t ? ': ' + t : ' (free)')) + '</title></g>';
        // an empty receiver channel: a clear way to put a transmitter on it
        if (g.kind === 'receiver' && opts.edit && !used) s += '<g class="cadd" data-addtx="' + g.id + ':' + r.in + '"><rect x="' + (x + 50) + '" y="' + (ry - 9) + '" width="' + (half - 30) + '" height="18" rx="5"/><text x="' + (x + 58) + '" y="' + (ry + 4) + '">+ transmitter</text><title>Put a transmitter (and its capsule) on ' + esc(g.ins[r.in]) + '</title></g>';
      }
      if (r.out != null) {
        const t = socketText(doc, ix, g, 'out', r.out);
        const used = !!((ix.from.get(g.id + ':' + r.out) || []).length);
        const room = m.compact ? half - 20 : r.in != null ? (r.member ? half - 54 : half - 24) : w - 34;
        s += '<g class="sk out' + (used || (g.feeds || {})[r.out] ? ' used' : '') + '" data-g="' + g.id + '" data-p="' + r.out + '"><circle class="hitc" cx="' + (x + w) + '" cy="' + ry + '" r="9"/><circle class="dot" cx="' + (x + w) + '" cy="' + ry + '" r="4.5"/><text x="' + (x + w - 10) + '" y="' + (ry + 4) + '" text-anchor="end">' + (m.compact && t ? esc(cut(t, Math.floor(room / CHW))) + ' →' : (t && room > 30 ? esc(cut(t, Math.floor(room / CHW) - g.outs[r.out].length)) + ' ' : '') + '<tspan class="pn">' + esc(g.outs[r.out]) + '</tspan>') + '</text><title>' + esc(g.name + ' ' + g.outs[r.out] + (t ? ': ' + t : ' (free)')) + '</title></g>';
      }
    });
    if (m.link) {
      s += '<rect class="ldot" data-g="' + g.id + '" x="' + (x + w - 5) + '" y="' + (y + LINKY - 5) + '" width="10" height="10" rx="2" transform="rotate(45 ' + (x + w) + ' ' + (y + LINKY) + ')"><title>' + (g.kind === 'computer' || g.kind === 'interface' ? 'USB / Thunderbolt / Dante: drag to ' + (g.kind === 'computer' ? 'an audio interface, a console or a network switch' : 'a computer') : 'Link (SLink, AES50, Dante): drag to a console, stage box or network') + '</title></rect>';
      s += '<rect class="ldot" data-g="' + g.id + '" x="' + (x - 5) + '" y="' + (y + LINKY - 5) + '" width="10" height="10" rx="2" transform="rotate(45 ' + x + ' ' + (y + LINKY) + ')"><title>Link</title></rect>';
    }
    const hy = m.compact ? y + 12 : y + HEAD - 2;
    if (opts.edit) s += '<g class="hand" data-g="' + g.id + '"><circle cx="' + (x + w - 2) + '" cy="' + hy + '" r="9"/><path d="M' + (x + w - 6) + ' ' + hy + 'h8M' + (x + w - 1) + ' ' + (hy - 4) + 'l4 4-4 4"/><title>Drag onto another card to connect</title></g>';
    return s + '</g>';
  }

  /**
   * Build the whole drawing. view: { doc, edit, drag: {ids:Set, dx, dy} | null, cache }
   * Returns { svg, bbox, routes, models, ix, E }.
   */
  function draw(doc, view) {
    const { ix, models } = place(doc, view.edit);
    const drag = view.drag;
    const pos = (g) => (drag && drag.ids.has(g.id) ? { x: g.x + drag.dx, y: g.y + drag.dy } : { x: g.x, y: g.y });
    const E = edges(doc, ix, models);
    const keep = drag ? (e) => !drag.ids.has(e.ma.g.id) && !drag.ids.has(e.mb.g.id) : null;
    const routes = routeAll(E, models, pos, view.cache, keep);
    // lines, with hops over the vertical runs of lines drawn before them
    let lines = '', labels = '';
    const verts = [];
    const order = E.slice().sort((p, q) => (!!q.link - !!p.link));
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
        if (best && best.len > 40) {
          // a label never runs past its line: a link shows its full count, its name, or nothing
          const fit = Math.floor((best.len - 16) / CHW);
          const t = e.link ? (e.label.length <= fit ? e.label : e.label.split(' · ')[0].length <= fit ? e.label.split(' · ')[0] : '') : cut(e.label, Math.max(4, fit));
          if (!t) return;
          const mx = e.link ? (best.a.x + best.b.x) / 2 : Math.min(best.a.x, best.b.x) + 14;
          labels += '<text class="pl pl-' + e.kind + '" x="' + mx + '" y="' + (best.a.y - 5) + '"' + (e.link ? ' text-anchor="middle"' : '') + '>' + esc(t) + '</text>';
        }
      }
    });
    let cards = '';
    const all = [...models.values()];
    all.forEach((m) => { cards += cardSvg(doc, ix, m, pos(m.g), view); });
    const rects = all.map((m) => outer(m, pos(m.g)));
    const bbox = rects.length ? { x0: Math.min(...rects.map((r) => r.x)) - 30, y0: Math.min(...rects.map((r) => r.y)) - 30, x1: Math.max(...rects.map((r) => r.x + r.w)) + 30, y1: Math.max(...rects.map((r) => r.y + r.h)) + 30 } : { x0: 0, y0: 0, x1: 640, y1: 320 };
    // what the key lists: only the colours and cable kinds this drawing has
    const key = { cats: [...new Set(all.map((m) => (P.KINDS[m.g.kind] || P.KINDS.other).cat))], kinds: [...new Set(E.map((e) => e.kind))], wireless: all.some((m) => m.sys) };
    // gear with no cables, laid along the bottom by Auto-arrange: a label over that row
    const wiredIds = new Set();
    doc.cables.forEach((c) => { const ga = ix.G.get(c.a), gb = ix.G.get(c.b); const ha = ga && P.hostOf(doc, ga), hb = gb && P.hostOf(doc, gb); const a = ha ? ha.id : c.a, b = hb ? hb.id : c.b; if (a !== b) { wiredIds.add(a); wiredIds.add(b); } });
    const loose = all.filter((m) => !wiredIds.has(m.g.id)), tied = all.filter((m) => wiredIds.has(m.g.id));
    let shelf = '';
    if (loose.length && tied.length) {
      const top = Math.min(...loose.map((m) => pos(m.g).y)), low = Math.max(...tied.map((m) => pos(m.g).y + m.h));
      if (top > low) shelf = '<text class="pshelf" x="' + Math.min(...loose.map((m) => pos(m.g).x)) + '" y="' + (top - 14) + '">NOT CONNECTED</text>';
    }
    bbox.y1 += 40;    // room for the key along the bottom of the view
    const empty = !all.length ? '<text class="pempty" x="320" y="150" text-anchor="middle">' + (view.edit ? 'Add equipment from the right, or right-click here.' : 'Nothing on the stage patch yet.') + '</text>' : '';
    const grid = view.edit ? '<rect class="pgridbg" x="' + (bbox.x0 - 4000) + '" y="' + (bbox.y0 - 4000) + '" width="' + (bbox.x1 - bbox.x0 + 8000) + '" height="' + (bbox.y1 - bbox.y0 + 8000) + '" fill="url(#pgrid)"/>' : '';
    return { svg: defs() + grid + shelf + '<g class="pes">' + lines + '</g>' + labels + cards + empty + '<g id="pguides"></g>', bbox, routes, models, ix, E, key };
  }

  // ================= following a signal =================
  /** Everything one gear (or one socket, or one cable) is connected to, upstream and downstream. */
  function trace(doc, ix, start) {
    const gear = new Set(), cables = new Set();
    const linkCables = (gid) => (ix.links.get(gid) || []);
    const toConsole = (sb) => linkCables(sb.id).forEach(({ c, other }) => { cables.add(c.id); const o = ix.G.get(other); if (o) { gear.add(o.id); if (o.kind === 'network') linkCables(o.id).forEach((l2) => { const g2 = ix.G.get(l2.other); if (g2 && g2.kind === 'console') { cables.add(l2.c.id); gear.add(g2.id); } }); } });
    // through a computer: over USB or Dante, its route, and back out (an interface output, or a console channel)
    const pcMark = (steps, depth) => steps.forEach((x) => {
      cables.add(x.L.c.id); gear.add(x.comp.id);
      if (x.to) { cables.add(x.to.c.id); if (x.at) { gear.add(x.at.g.id); if (x.at.out != null) down(x.at.g, x.at.out, depth + 1); } }
      pcMark(x.next, depth + 1);
    });
    const fwd = (g, ch, depth) => { if (depth < 12) pcMark(P.pcForward(doc, ix, g, ch), depth); };
    /** Where a console channel comes from, walked back (a stage box input, a local input, a computer's return). */
    const upChan = (con, ch, depth) => {
      if (depth > 12) return;
      for (const sb of doc.gear.filter((x) => x.kind === 'stagebox' && ix.consolesOf(x.id).includes(con))) { const i = sb.ins.findIndex((_, k) => P.chanOf(sb, k) === ch); if (i >= 0 && ix.into.get(sb.id + ':' + i)) { gear.add(sb.id); toConsole(sb); up(sb, i, depth + 1); return; } }
      const i = ch - (con.localstart || 1);
      if (i >= 0 && i < con.ins.length && ix.into.get(con.id + ':' + i)) return up(con, i, depth + 1);
      for (const L of ix.audioAt.get(con.id) || []) if (L.c.ret && ch >= L.c.ret && ch < L.c.ret + L.chout) back(L, ch - L.c.ret + 1, depth + 1);
    };
    const back = (L, ch, depth) => {
      const b = P.pcBack(doc, ix, L, ch, 0); if (!b || depth > 12) return;
      cables.add(L.c.id); gear.add(L.comp.id);
      if (!b.from) return;
      cables.add(b.from.c.id);
      const e = b.from.end; if (!e) return;
      gear.add(e.id);
      if (e.kind === 'console') upChan(e, b.ch + (b.from.c.snd || 1) - 1, depth + 1); else up(e, b.ch - 1, depth + 1);
    };
    const down = (g, j, depth) => {
      if (depth > 12) return;
      for (const c of ix.from.get(g.id + ':' + j) || []) {
        cables.add(c.id);
        const b = ix.G.get(c.b); if (!b) continue;
        gear.add(b.id);
        const k = P.KINDS[b.kind];
        if (b.kind === 'interface') fwd(b, c.bp + 1, depth + 1);
        if (b.kind === 'stagebox') { const n = P.chanOf(b, c.bp); if (n != null) ix.consolesOf(b.id).forEach((con) => fwd(con, n, depth + 1)); fwd(b, c.bp + 1, depth + 1); }
        if (b.kind === 'console') fwd(b, (b.localstart || 1) + c.bp, depth + 1);
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
      if (a.kind === 'interface') (ix.audioAt.get(a.id) || []).forEach((L) => { if (c.ap + 1 <= L.chout) back(L, c.ap + 1, depth + 1); });
      if (a.kind === 'stagebox') toConsole(a);
      else if (k.pass === 'same') up(a, c.ap, depth + 1);
      else if (k.pass === 'all' || k.pass === 'rf') a.ins.forEach((_, ii) => up(a, ii, depth + 1));
    };
    const whole = (g) => {
      gear.add(g.id);
      g.ins.forEach((_, i) => up(g, i, 0));
      g.outs.forEach((_, j) => down(g, j, 0));
      if (P.KINDS[g.kind].link) linkCables(g.id).forEach(({ c, other }) => { cables.add(c.id); gear.add(other); });
      // its network cable (or, for a switch, what plugs into it)
      doc.cables.forEach((c) => { if (c.ap === 'net' && (c.a === g.id || c.b === g.id)) { cables.add(c.id); gear.add(c.a === g.id ? c.b : c.a); } });
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
      return T([['Ch', 1], ['Name', 1], ['Source'], ['Mic / DI'], ['Wireless'], ['Stage box'], ['Console']], used.map((r) => {
        const u = r.up;
        const wl = u.tx ? esc([u.capsule, u.freq && u.freq + ' MHz', u.receiver && u.receiver.name + ' ' + u.rxch].filter(Boolean).join(' · ')) : '';
        const src = u.src;
        const nm = src && (src.chname || src.chcolor) ? '<span class="chn">' + (src.chcolor ? '<i style="background:' + colorCss(src.chcolor) + '" title="' + esc(src.chcolor) + '"></i>' : '') + esc(src.chname || '') + '</span>' : '';
        return tr([r.via.id, ...u.chain.map((g) => g.id)], ['<b>' + ch(r) + '</b>', nm, esc([u.source, u.person].filter(Boolean).join(' · ') || (r.used ? '' : '—')), esc(u.mic || ''), wl, esc(r.via.kind === 'console' ? r.port : r.via.name + ' ' + r.port), esc(r.console.name)]);
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
      // with several names a cable is listed when both ends are among them
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
    await Promise.all([loadDevices(true), GearModels.load()]);
    const st = {
      doc: data.doc, version: data.version, rev: data.rev || '', draft: !!data.draft, edit: false, sel: [], selCable: null, selSocket: null,
      undo: [], redo: [], tf: null, report: 'inputs', saving: false, dirtySave: false, pending: null, spares: false,
      snap: true, cache: null, drag: null, placeAt: null
    };
    try { st.snap = localStorage.getItem('lg-psnap') !== '0'; } catch (e) { /* private mode */ }
    try { setTextSize(Number(localStorage.getItem('lg-ptext')) || 1); } catch (e) { setTextSize(1); }
    const canEdit = data.canEdit;
    const wide = () => matchMedia('(min-width: 1024px)').matches;
    app.innerHTML = `<div class="patchv">
      <div class="printhead"><img src="/icons/livegenie-glyph.svg" alt=""><div><b>LiveGenie</b><span>${esc(((S.state && S.state.org && S.state.org.name) ? S.state.org.name + ' · ' : '') + 'Stage patch')}</span></div><div class="pm">Version ${st.version}<br>Printed ${esc(new Date().toLocaleString())}</div></div>
      <div class="crumbs"><a href="#/">Home</a><span>/</span></div>
      <div class="bar pbar"><div class="grow"><div class="ptitle" id="ptl"></div></div>
        ${canEdit ? '<button class="btn" id="pedit">' + icon('edit') + '<span>Edit</span></button>' : ''}
        <button class="btn ghost" id="pfitb" title="Fit the whole drawing on screen (F)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Fit</span></button>
        <button class="btn ghost" id="ppdf" title="Export PDF">${icon('pdf')}<span class="hide-sm">PDF</span></button>
        ${canEdit ? '<button class="btn ghost" id="phist" title="Revisions">' + icon('clock') + '<span class="hide-sm">History</span></button>' : ''}</div>
      <div class="ptools hide" id="ptools">
        <button class="ghost" id="pun" title="Undo (Ctrl+Z)">↶ Undo</button><button class="ghost" id="pre" title="Redo">↷ Redo</button>
        <span class="tsep"></span>
        <button class="ghost" id="paddb" title="Show the equipment list">${icon('plus')}Add equipment</button>
        <button class="ghost" id="plabels" title="Tag names for the gear and a number for each cable, with a preview">${icon('edit')}Auto label</button>
        <button class="ghost" id="pselt" aria-pressed="false" title="Select: drag a box around cards to pick several, then drag one to move them all (Shift-drag works too)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/></svg>Select</button>
        <button class="ghost" id="ptidy" title="Lay the whole drawing out once by signal flow (undo puts it back)">${icon('list')}Auto-arrange</button>
        <label class="tog sm" title="Cards snap to the grid and line up with each other. Hold Alt to place freely."><input type="checkbox" id="psnap"${st.snap ? ' checked' : ''}> Snap</label>
        <span class="palign hide" id="palign"><span class="tsep"></span>
          <button class="ghost" data-al="left" title="Line up left edges">⇤ Left</button><button class="ghost" data-al="top" title="Line up top edges">⤒ Top</button>
          <button class="ghost" data-al="center" title="Line up centres">↔ Centre</button><button class="ghost" data-al="vdist" title="Space evenly, top to bottom">⇕ Space</button><button class="ghost" data-al="hdist" title="Space evenly, left to right">⇔ Space</button></span>
        <span class="note" id="psave"></span><span class="grow"></span>
        <span class="note phint">Drag a card to move it · drag the background to pick several (Shift-click adds, Ctrl+A all) · space-drag, right-drag or scroll to pan · drag <b>→</b> onto a card to connect</span></div>
      <div class="pmain"><div class="pcanvas" id="pcv"><svg id="psvg"><g id="pvp"></g><path id="ptmp" class="ptmp" d=""/><rect id="pmq" class="pmq" x="0" y="0" width="0" height="0"/></svg>
        <div class="pzoom"><button id="pzi" aria-label="Zoom in" data-tip="Zoom in">+</button><button id="pzo" aria-label="Zoom out" data-tip="Zoom out">−</button><button id="pzf" aria-label="Fit" data-tip="Fit">⤢</button><button id="pzt" class="pzt" aria-label="Text size" data-tip="Text size">Aa</button></div>
        <div class="pkey hide" id="pkey"></div>
        <div class="pselchip hide" id="pselchip"></div>
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
      $('#ptl').innerHTML = '<div class="pkicker">STAGE PATCH <span class="prev" id="prev">' + revChip() + '</span></div><h1 class="title">' + esc(d.title) + '</h1>' + (d.subtitle ? '<div class="note">' + esc(d.subtitle) + '</div>' : '<div class="note">Click any piece of gear or cable to follow its signal.</div>') +
        (st.edit ? '<button class="linkbtn" id="ptedit">Edit title</button>' : '');
      const te = $('#ptedit'); if (te) te.addEventListener('click', titleDialog);
    }
    /** "Rev 1.1.0" and a Draft chip when there are changes since it was published. */
    function revChip() {
      return (st.rev ? '<span class="rchip">Rev ' + esc(st.rev) + '</span>' : '<span class="rchip none">Not published yet</span>') + (st.draft && st.rev ? '<span class="rchip draft">Draft</span>' : '');
    }
    const paintRev = () => { const el = $('#prev'); if (el) el.innerHTML = revChip(); };
    function paintKey() {
      const el = $('#pkey'); if (!el) return;
      const cats = Object.entries(P.CATS).filter(([k]) => D.key.cats.includes(k));
      const kinds = Object.entries(KIND_STYLE).filter(([k]) => D.key.kinds.includes(k));
      const wl = D.key.wireless;
      el.classList.toggle('hide', !cats.length && !kinds.length && !wl);
      if (!cats.length && !kinds.length && !wl) { el.innerHTML = ''; return; }
      let shut = !wide(); try { const v = localStorage.getItem('lg-pkey'); if (v) shut = v === 'shut'; } catch (e) { /* private mode */ }
      el.classList.toggle('shut', shut);
      el.innerHTML = '<button type="button" class="pkt" id="pkt" aria-expanded="' + !shut + '">Key ' + (shut ? '▸' : '▾') + '</button><div class="pki">' +
        cats.map(([, v]) => '<span class="kc"><i style="background:' + v.color + '"></i>' + esc(v.label) + '</span>').join('') +
        kinds.map(([k, v]) => '<span class="kk"><svg width="30" height="10"><g class="pe pe-' + k + '"><path class="ln" d="M1 5h27"/></g></svg>' + esc(v) + '</span>').join('') + (wl ? '<span class="kk">' + WL_KEY + 'Wireless system · RF</span>' : '') + '</div>';
      $('#pkt', el).addEventListener('click', () => { try { localStorage.setItem('lg-pkey', el.classList.contains('shut') ? 'open' : 'shut'); } catch (e) { /* private mode */ } paintKey(); });
    }
    /** Aa: Normal → Large → Larger → Normal. */
    const paintTextSize = () => { svg.style.setProperty('--pts', String(TS)); const b = $('#pzt'); if (b) { b.dataset.tip = 'Text size: ' + ['Normal', 'Large', 'Larger'][TEXT_SIZES.indexOf(TS)]; b.classList.toggle('on', TS > 1); } };
    function paintDrawing() {
      paintTextSize();
      D = draw(st.doc, { edit: st.edit, drag: st.drag, cache: st.cache });
      st.cache = D.routes;
      vp.innerHTML = D.svg;
      if (!st.drag) paintKey();
      svg.classList.toggle('editing', st.edit);
      highlight();
    }
    function paint(keepView) {
      paintDrawing();
      if (!keepView || !st.tf) fit(); else apply();
      paintChecks(); paintReport();
    }
    /** More blocks on the drawing than the Gear Locker card has (its quantity). */
    function qtyChecks(doc) {
      const by = new Map();
      doc.gear.forEach((g) => { if (g.device_id) { if (!by.has(g.device_id)) by.set(g.device_id, []); by.get(g.device_id).push(g); } });
      const out = [];
      by.forEach((gs, id) => {
        const d = devCard(id); if (!d) return;
        const q = typeof qtyOf === 'function' ? qtyOf(d) : 1;
        if (gs.length > q) out.push({ level: 'warn', text: Tags.withModel(d.name, d.model) + ': ' + gs.length + ' on the drawing, ' + q + ' in the Gear Locker. Raise its quantity, or remove one.', gear: gs.map((g) => g.id) });
      });
      // the drawing and the Gear Locker disagree
      doc.gear.forEach((g) => {
        if (g.wrong_card) out.push({ level: 'warn', text: g.name + ' was linked to ' + g.wrong_card + ', which is a different kind of gear, so it was unlinked. Link it to its own card (Gear card in its details).', gear: [g.id] });
        if (g.lost_card) out.push({ level: 'warn', text: g.name + '\'s Gear Locker card was removed. Link it to another card, or remove the block.', gear: [g.id] });
        const d = g.device_id && devCard(g.device_id);
        if (d && !(typeof qtyOf === 'function' && qtyOf(d) > 1) && d.name && Tags.norm(String(g.name).replace(/\s+#\d+$/, '')) !== Tags.norm(d.name)) out.push({ level: 'warn', text: g.name + ' is called ' + d.name + ' in the Gear Locker. Open the stage patch again to bring them in line, or rename one.', gear: [g.id] });
        if (d && (g.kind === 'txmic' || g.kind === 'bodypack')) { const h = P.hostOf(doc, g); if (h && h.device_id && d.pair_id && d.pair_id !== h.device_id) out.push({ level: 'warn', text: g.name + ' is on ' + h.name + ' here, but paired with another ' + (g.kind === 'txmic' ? 'receiver' : 'transmitter') + ' in the Gear Locker.', gear: [g.id] }); }
      });
      return out;
    }
    function paintChecks() {
      const list = P.checks(st.doc).concat(qtyChecks(st.doc));
      // a network cable on gear whose Gear Locker card is not ticked "On the network"
      st.doc.cables.filter((c) => c.ap === 'net').forEach((c) => { const g = gearOf(c.a), dev = devOf(g); if (g && dev && !dev.networked && g.kind !== 'network' && g.kind !== 'computer') list.push({ level: 'warn', text: g.name + ' has a network cable, but its Gear Locker card is not ticked “On the network”. Tick it, or remove the cable.', gear: [g.id] }); });
      // a list, worst first: tap one to see it on the drawing
      const rank = { bad: 0, warn: 1, note: 2 };
      const order = list.map((c, i) => ({ c, i })).sort((p, q) => rank[p.c.level] - rank[q.c.level]);
      $('#pchk').innerHTML = list.length ? '<div class="pchkh">' + icon('warn') + list.length + ' thing' + (list.length === 1 ? '' : 's') + ' to check</div><ul class="pchkl">' + order.map(({ c, i }) => '<li><button class="pchk ' + c.level + '" data-i="' + i + '">' + icon(c.level === 'note' ? 'info' : 'warn') + '<span>' + esc(c.text) + '</span><em>Show</em></button></li>').join('') + '</ul>' : '';
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
    function paintAlign() {
      const many = st.edit && st.sel.length > 1;
      $('#palign').classList.toggle('hide', !many);
      const chip = $('#pselchip'); if (!chip) return;
      chip.classList.toggle('hide', !many);
      if (!many) { chip.innerHTML = ''; return; }
      chip.innerHTML = '<b>' + st.sel.length + ' selected</b><button type="button" class="ghost" id="psc_al" aria-expanded="false">Align ▾</button><button type="button" class="ghost" id="psc_fit">Fit selection</button><button type="button" class="ghost danger" id="psc_rm">Remove</button><button type="button" class="ghost" id="psc_cl">Clear</button>' +
        '<div class="pscal hide" id="psc_menu">' + [['left', '⇤ Left edges'], ['top', '⤒ Top edges'], ['center', '↔ Centres'], ['vdist', '⇕ Space evenly'], ['hdist', '⇔ Space across']].map(([k, l]) => '<button type="button" data-al3="' + k + '">' + l + '</button>').join('') + '</div>';
      $('#psc_al', chip).addEventListener('click', () => { const m = $('#psc_menu', chip); m.classList.toggle('hide'); $('#psc_al', chip).setAttribute('aria-expanded', String(!m.classList.contains('hide'))); });
      $$('[data-al3]', chip).forEach((b) => b.addEventListener('click', () => align(b.dataset.al3)));
      $('#psc_rm', chip).addEventListener('click', removeSelection);
      $('#psc_fit', chip).addEventListener('click', () => fit(selBox()));
      $('#psc_cl', chip).addEventListener('click', () => select(null));
    }
    /** Remove every selected card (one undo step), after asking. */
    async function removeSelection() {
      const ids = st.sel.filter((id) => gearOf(id));
      if (!ids.length) return;
      if (!await confirmBox('Remove ' + ids.length + ' pieces of gear?', 'They come off the stage patch with their cables (and the mics or packs inside them). Undo brings them back.', 'Remove', true)) return;
      st.sel = [];
      change(() => ids.forEach((id) => P.removeGear(st.doc, id)), 'Removed ' + ids.length + ' pieces of gear. Undo brings them back.');
      paintAlign();
    }
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
    /**
     * Fit: the whole drawing (or a box, like the selection) in view with a margin, clear of the key along the bottom,
     * the zoom buttons, and the details pane when it floats over the drawing.
     */
    function fit(box) {
      const b0 = box && box.x0 != null ? box : D.bbox;
      cv.style.height = Math.round(Math.max(460, window.innerHeight - (wide() ? 190 : 230))) + 'px';
      const r = cv.getBoundingClientRect();
      const key = $('#pkey'), keyH = key && !key.classList.contains('hide') ? key.getBoundingClientRect().height + 12 : 0;
      const pane = $('#ppane'), pr = pane && getComputedStyle(pane).position === 'absolute' && pane.offsetParent ? pane.getBoundingClientRect() : null;
      const paneW = pr && pr.width && pr.left < r.right && pr.right > r.left ? r.right - pr.left + 8 : 0;
      const M = 16, left = M, top = M, right = r.width - M - Math.max(48, paneW), bottom = r.height - M - keyH;
      const W = Math.max(40, b0.x1 - b0.x0), H = Math.max(40, b0.y1 - b0.y0);
      const k = Math.max(0.05, Math.min(1.15, (right - left) / W, (bottom - top) / H));
      st.tf = { k, x: left + ((right - left) - W * k) / 2 - b0.x0 * k, y: top + Math.max(0, ((bottom - top) - H * k) / 2) - b0.y0 * k };
      st.userView = false;
      apply();
    }
    /** The box round the selected cards (for Fit selection). */
    function selBox() {
      const ms = st.sel.map((id) => D.models.get(cardOf(id))).filter(Boolean);
      if (!ms.length) return null;
      const rs = ms.map((m) => outer(m));
      return { x0: Math.min(...rs.map((r) => r.x)) - 30, y0: Math.min(...rs.map((r) => r.y)) - 30, x1: Math.max(...rs.map((r) => r.x + r.w)) + 30, y1: Math.max(...rs.map((r) => r.y + r.h)) + 30 };
    }
    function focusGear(id) {
      const m = D && D.models.get(cardOf(id));
      if (!m) return;
      const r = cv.getBoundingClientRect(), k = st.tf.k;
      const sx = st.tf.x + m.g.x * k, sy = st.tf.y + m.g.y * k;
      if (sx > 20 && sx + m.w * k < r.width - 20 && sy > 20 && sy + Math.min(m.h, 200) * k < r.height - 20) return;
      st.tf.x = r.width * 0.3 - m.g.x * k; st.tf.y = r.height * 0.3 - m.g.y * k; apply();
    }
    /** Zoom so one piece of gear (its card) fills most of the view: readable on a phone. */
    function zoomTo(id) {
      const m = D && D.models.get(cardOf(id));
      if (!m) return;
      const r = cv.getBoundingClientRect();
      const k = Math.max(0.4, Math.min(1.4, (r.width * 0.86) / m.w, (r.height * 0.55) / Math.max(80, m.h)));
      st.tf.k = k; st.tf.x = (r.width - m.w * k) / 2 - m.g.x * k; st.tf.y = Math.max(12, r.height * 0.12) - m.g.y * k;
      st.userView = true; apply();
    }
    const world = (cx, cy) => { const r = svg.getBoundingClientRect(); return { x: (cx - r.left - st.tf.x) / st.tf.k, y: (cy - r.top - st.tf.y) / st.tf.k }; };
    function zoomAt(f, cx, cy) {
      st.userView = true;
      const r = svg.getBoundingClientRect(); const px = cx - r.left, py = cy - r.top;
      const k = Math.max(0.05, Math.min(3, st.tf.k * f));
      st.tf.x = px - (px - st.tf.x) * (k / st.tf.k); st.tf.y = py - (py - st.tf.y) * (k / st.tf.k); st.tf.k = k; apply();
    }
    svg.addEventListener('wheel', (e) => { e.preventDefault(); if (e.ctrlKey || e.metaKey || !e.deltaX) zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); else { st.userView = true; st.tf.x -= e.deltaX; st.tf.y -= e.deltaY; apply(); } }, { passive: false });
    // double-click (or double-tap) the empty drawing: fit
    svg.addEventListener('dblclick', (e) => { if (!e.target.closest('.pcard') && !e.target.closest('.pe')) { e.preventDefault(); fit(); } });
    // rotate the phone or resize the window: fit again, unless someone has panned or zoomed since
    let rsz = null;
    window.addEventListener('resize', function onResize() { if (!svg.isConnected) return window.removeEventListener('resize', onResize); clearTimeout(rsz); rsz = setTimeout(() => { if (D && !st.userView && !st.drag && !document.body.classList.contains('printreport') && cv.getBoundingClientRect().width > 0) fit(); }, 200); });
    $('#pzi').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2); });
    $('#pzo').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(0.8, r.left + r.width / 2, r.top + r.height / 2); });
    $('#pzf').addEventListener('click', () => fit());
    $('#pzt').addEventListener('click', () => {
      setTextSize(TEXT_SIZES[(TEXT_SIZES.indexOf(TS) + 1) % TEXT_SIZES.length]);
      try { localStorage.setItem('lg-ptext', String(TS)); } catch (e) { /* private mode */ }
      st.cache = null; paintDrawing(); apply();
      toast('Text size: ' + ['Normal', 'Large', 'Larger'][TEXT_SIZES.indexOf(TS)]);
    });

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
      // editing with a mouse: a drag on the empty drawing picks a box of cards, so the view pans with
      // space + drag, the middle or right button, the scroll wheel, or two fingers
      if ((e.button === 1 || e.button === 2) && !isTouch(e)) {
        if (!st.edit && e.button === 2) return;
        e.preventDefault(); svg.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        gesture = { pan: true, sx: e.clientX, sy: e.clientY, x: st.tf.x, y: st.tf.y, moved: false, target: e.target, right: e.button === 2, middle: e.button === 1 };
        return;
      }
      if (st.space && !isTouch(e)) { e.preventDefault(); svg.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); gesture = { pan: true, sx: e.clientX, sy: e.clientY, x: st.tf.x, y: st.tf.y, moved: false, target: e.target, spacePan: true }; return; }
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
          const isNet = src.dataset.p === 'net';
          if (!isHand && !isLink) { const m = D.models.get(src.dataset.g); x0 = m.g.x + m.w; y0 = m.g.y + (isNet ? m.netY : m.outY[Number(src.dataset.p)]); }
          gesture = { connect: true, gid: src.dataset.g, port: isLink ? 'link' : isHand ? null : isNet ? 'net' : Number(src.dataset.p), x0, y0, sx: e.clientX, sy: e.clientY, moved: false };
          return;
        }
        const card = t.closest('.pcard');
        if (card && !t.closest('.cmore') && !t.closest('.wlt') && !t.closest('.sk.in')) {
          e.preventDefault(); svg.setPointerCapture(e.pointerId);
          const id = card.dataset.g;
          const ids = st.sel.includes(id) && st.sel.length > 1 ? new Set(st.sel.filter((x) => D.models.has(x))) : new Set([id]);
          gesture = { move: true, id, ids, sx: e.clientX, sy: e.clientY, w0, moved: false, target: t, shift: e.shiftKey || e.ctrlKey || e.metaKey };
          return;
        }
        if (!card && (e.shiftKey || st.selTool || (!isTouch(e) && !t.closest('.pe')))) { e.preventDefault(); svg.setPointerCapture(e.pointerId); clearTimeout(longTimer); gesture = { marquee: true, w0, sx: e.clientX, sy: e.clientY, moved: false, target: t, add: e.shiftKey || e.ctrlKey || e.metaKey }; return; }
      }
      gesture = { pan: true, sx: e.clientX, sy: e.clientY, x: st.tf.x, y: st.tf.y, moved: false, target: t, shift: e.shiftKey || e.ctrlKey || e.metaKey };
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
      if (gesture.pan) { st.userView = true; st.tf.x = gesture.x + e.clientX - gesture.sx; st.tf.y = gesture.y + e.clientY - gesture.sy; apply(); }
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
        if (g.box) {
          // every card the box touches; Shift or Ctrl adds to what was picked
          const ids = [...D.models.values()].filter((m) => { const o = outer(m); return o.x < g.box.x1 && o.x + o.w > g.box.x0 && o.y < g.box.y1 && o.y + o.h > g.box.y0; }).map((m) => m.g.id);
          select({ gear: g.add ? [...new Set(st.sel.concat(ids))] : ids }, { noSheet: true });
        } else if (!g.add) tap(g.target, false);
        return;
      }
      if (g.right) { if (g.moved) st.rpanAt = Date.now(); else menuAt(g.target, e.clientX, e.clientY); return; }
      if ((g.middle || g.spacePan) && !g.moved) return;
      if (g.pan && !g.moved) {
        // a double tap on the empty drawing fits it
        const empty = !(g.target.closest && (g.target.closest('.pcard') || g.target.closest('.pe')));
        if (isTouch(e) && empty && Date.now() - (st.lastTap || 0) < 320) { st.lastTap = 0; fit(); return; }
        st.lastTap = isTouch(e) && empty ? Date.now() : 0;
        tap(g.target, g.shift);
      }
    };
    const snapOr = (v) => Math.round(v);
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', (e) => { clearTimeout(longTimer); pts.delete(e.pointerId); gesture = null; $('#ptmp').setAttribute('d', ''); if (st.drag) { st.drag = null; paintDrawing(); } });
    svg.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // editing: the right button pans when dragged, and opens the menu when it is let go without moving
      if (gesture && gesture.right) return;
      if (st.edit && Date.now() - (st.rpanAt || 0) < 500) return;
      gesture = null; pts.clear(); menuAt(e.target, e.clientX, e.clientY);
    });
    // hold space to pan with the mouse while editing
    const spaceKey = (e) => {
      if (!svg.isConnected) { document.removeEventListener('keydown', spaceKey); document.removeEventListener('keyup', spaceKey); return; }
      if (e.code !== 'Space' || /input|textarea|select|button/i.test(e.target.tagName) || document.querySelector('.modal')) return;
      e.preventDefault();
      st.space = e.type === 'keydown'; svg.classList.toggle('spacepan', st.space);
    };
    document.addEventListener('keydown', spaceKey); document.addEventListener('keyup', spaceKey);
    window.addEventListener('blur', () => { st.space = false; svg.classList.remove('spacepan'); });

    function markPending() { $$('.pending', vp).forEach((x) => x.classList.remove('pending')); if (st.pending) $$('.pcard[data-g="' + st.pending.gid + '"]', vp).forEach((x) => x.classList.add('pending')); }
    function tap(t, shift) {
      if (st.pending && st.edit) { const p = st.pending; st.pending = null; markPending(); dropOn(t, p.gid, p.port); return; }
      const addtx = t.closest('.cadd');
      if (addtx && st.edit && addtx.dataset.addpk) { memberDialog(gearOf(addtx.dataset.addpk)); return; }
      if (addtx && st.edit) { const [hid, ch] = addtx.dataset.addtx.split(':'); memberDialog(gearOf(hid), null, Number(ch)); return; }
      const more = t.closest('.cmore');
      const wlt = t.closest('.wlt');
      if (wlt) { const g = gearOf(wlt.dataset.wl); const flip = () => { g.wlshut = !g.wlshut; if (!g.wlshut) delete g.wlshut; }; if (st.edit) change(flip, null, true); else { flip(); st.cache = null; paintDrawing(); if (canEdit) queueSave(); } return; }
      if (more) { const g = gearOf(more.dataset.open); if (st.edit) change(() => { g.open = !g.open; if (!g.open) delete g.open; }, null, true); else { g.open = !g.open; if (!g.open) delete g.open; st.cache = null; paintDrawing(); } return; }
      const sk = t.closest('.sk'), card = t.closest('.pcard'), edge = t.closest('.pe'), mem = t.closest('.crow.mem'), slk = t.closest('.crow.slk');
      if (mem && shift && st.edit && card) { const id = card.dataset.g; const s2 = st.sel.includes(id) ? st.sel.filter((x) => x !== id) : st.sel.concat(id); return select({ gear: s2 }, { noSheet: true }); }
      if (mem) return select({ gear: [mem.dataset.mem] });
      if (slk) return select({ gear: [slk.dataset.g] });
      if (sk && (sk.dataset.net || sk.dataset.p === 'net')) {
        const c = sk.dataset.net ? st.doc.cables.find((x) => x.ap === 'net' && x.b === sk.dataset.g && x.port === Number(sk.dataset.net)) : P.netOf(st.doc, gearOf(sk.dataset.g));
        return c ? select({ cable: c.id }) : select({ gear: [sk.dataset.g] });
      }
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
          if (g.kind === 'iemtx') it('Add an in-ear pack', () => memberDialog(g));
          if (!host && g.kind !== 'network' && hasNet(st.doc, g)) { const sws = st.doc.gear.filter((x) => x.kind === 'network'); if (sws.length) it('Plug into a switch…', () => netDialog(g, sws[0], null)); }
          if (g.kind === 'stagebox') it('Assign console channels…', () => channelDialog(g));
          if (g.kind === 'console') it('Channel names and colours…', () => namesDialog(g));
          const m = D.models.get(g.id);
          if (m && !m.small) it(g.open ? 'Show used sockets only' : 'Show every socket', () => change(() => { g.open = !g.open; if (!g.open) delete g.open; }, null, true));
          if (host) it('Take out of ' + host.name, () => takeOut(g, host));
          else it('Duplicate', () => duplicate(g));
          sep();
          it(host ? 'Remove ' + (g.kind === 'txmic' ? 'mic' : 'pack') : 'Remove', () => removeGear(g.id), { danger: true });
        } else {
          const dev = g.device_id && typeof DEV !== 'undefined' && DEV.list ? DEV.list.find((d) => d.id === g.device_id) : null;
          if (dev) it('Open its gear card', () => { location.hash = '#/d/' + dev.id; });
          it('Report a problem', () => reportProblem(g.name, { gear: g.id, device_id: g.device_id || undefined, model: g.model || undefined }));
        }
      } else if (edge && edge.dataset.c) {
        const c = st.doc.cables.find((x) => x.id === edge.dataset.c);
        select({ cable: c.id }, { noSheet: true });
        const a = gearOf(c.a), b = gearOf(c.b);
        items.push({ title: (c.label ? c.label + ': ' : '') + a.name + ' → ' + b.name });
        it('Follow its signal', () => select({ cable: c.id }));
        if (st.edit) {
          sep();
          Object.entries(KIND_STYLE).filter(([k]) => c.ap === 'net' ? false : c.ap === 'link' ? (k === 'link' || k === 'dante') : (k !== 'link' && k !== 'dante' && k !== 'net')).forEach(([k, v]) => it(v, () => change(() => { st.doc.cables.find((x) => x.id === c.id).kind = k; }, null, true), { check: c.kind === k }));
          sep();
          it('Tag name and length…', () => { select({ cable: c.id }); if (!wide()) sheet(); });
          it('Remove cable', () => { st.selCable = null; change(() => { st.doc.cables = st.doc.cables.filter((x) => x.id !== c.id); }, 'Cable removed'); }, { danger: true });
        }
      } else {
        if (st.edit) {
          it('Add equipment here', () => { st.placeAt = { x: snap(w.x), y: snap(w.y) }; st.adding = true; select(null); if (!wide()) sheet(true); else { const f = $('#pfind'); if (f) f.focus(); } toast('Pick the gear from the list'); });
          it('Auto-arrange everything', tidy);
          it('Select all', () => select({ gear: [...D.models.keys()] }, { noSheet: true }));
          it('Snap to grid', () => { st.snap = !st.snap; $('#psnap').checked = st.snap; saveSnap(); }, { check: st.snap });
          sep();
        }
        it('Fit the drawing (F)', () => fit());
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
      // a network cable: gear's network socket to a switch port
      if (port === 'net' || (sk && sk.dataset.net)) {
        const sw = b.kind === 'network' ? b : a.kind === 'network' && port !== 'net' ? a : null, g = sw === b ? a : b;
        if (!sw) return toast('Plug it into a network switch (add one from Add equipment)', 'bad');
        if (!hasNet(st.doc, g)) return toast(g.name + ' is not on the network. Tick “On the network” on its Gear Locker card first.', 'bad');
        return netDialog(g, sw, sk && sk.dataset.net ? Number(sk.dataset.net) : null);
      }
      if (port == null && ((b.kind === 'network' && a.kind !== 'network' && hasNet(st.doc, a)) || (a.kind === 'network' && b.kind !== 'network' && hasNet(st.doc, b)))) {
        const sw = b.kind === 'network' ? b : a;
        return netDialog(sw === b ? a : b, sw, null);
      }
      if (port === 'link' || ld) {
        // a switch takes network cables (with a port), not links
        if (a.kind === 'network' || b.kind === 'network') { const sw = b.kind === 'network' ? b : a, g = sw === b ? a : b; if (g.kind !== 'network') return netDialog(g, sw, null); }
        if (!P.KINDS[a.kind].link || !P.KINDS[b.kind].link) return toast(b.name + ' has no link socket', 'bad');
        return picker(a, b, { linkOnly: true });
      }
      if (sk && port != null && !mem) { change(() => P.connect(st.doc, a, port, b, Number(sk.dataset.p)), a.name + ' ' + a.outs[port] + ' → ' + b.name + ' ' + b.ins[Number(sk.dataset.p)]); return; }
      picker(a, b, { port, toIn: sk ? Number(sk.dataset.p) : null });
    }
    /** Plug gear into a switch: which port. Fills in "Plugged into" on its Gear Locker card. */
    function netDialog(g, sw, port) {
      const taken = new Map(st.doc.cables.filter((c) => c.ap === 'net' && c.b === sw.id && c.port && c.a !== g.id).map((c) => [c.port, gearOf(c.a)]));
      const cur = P.netOf(st.doc, g);
      let pick = port || (cur && cur.b === sw.id && cur.port) || 0;
      if (!pick) for (let n = 1; n <= (sw.nports || 8); n++) if (!taken.has(n)) { pick = n; break; }
      const opts = Array.from({ length: sw.nports || 8 }, (_, i) => i + 1).map((n) => '<option value="' + n + '"' + (n === pick ? ' selected' : '') + '>Port ' + n + (taken.has(n) ? ' · ' + esc(taken.get(n).name) + ' (replaces it)' : '') + '</option>').join('');
      modal('<h3>Plug ' + esc(tm(g)) + ' into ' + esc(tm(sw)) + '</h3><form id="pnf"><label>Port</label><select id="pn_port"><option value="">Not sure yet</option>' + opts + '</select>' +
        '<p class="note">' + (g.device_id && sw.device_id ? 'Its Gear Locker card gets “Plugged into ' + esc(sw.name) + '” too, so the network map matches.' : 'Add both to the Gear Locker and the network map shows it too.') + '</p>' +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Connect</button></div></form>', (w, close) => {
        $('#pnf', w).addEventListener('submit', (e) => {
          e.preventDefault(); const n = Number($('#pn_port', w).value) || null; close();
          change(() => P.connectNet(st.doc, gearOf(g.id), gearOf(sw.id), n), g.name + ' → ' + sw.name + (n ? ' port ' + n : ''));
        });
      });
    }
    /** Change a Gear Locker card: the whole card from the server with these fields changed. */
    async function putDevice(id, fields) {
      const d = (await get('/api/devices/' + id)).device;
      await call('PUT', '/api/devices/' + id, { ...d, ...fields });
      if (typeof forgetDevices === 'function') forgetDevices();
      await loadDevices(true);
    }
    /** Network cables drawn or removed here go to "Plugged into" on the Gear Locker cards (and back). */
    function syncNet(before, after) {
      const sig = (doc) => new Map(doc.cables.filter((c) => c.ap === 'net').map((c) => [c.a, c]));
      const A = sig(before), B = sig(after);
      const G = new Map(after.gear.concat(before.gear).map((g) => [g.id, g]));
      const jobs = [];
      B.forEach((c, gid) => {
        const o = A.get(gid);
        if (o && o.b === c.b && o.port === c.port) return;
        const g = G.get(gid), sw = G.get(c.b);
        if (g && sw && g.device_id && sw.device_id && !shared(g.device_id)) jobs.push([g.device_id, { networked: true, uplink_id: sw.device_id, uplink_port: c.port ? String(c.port) : '' }]);
      });
      A.forEach((c, gid) => {
        if (B.has(gid)) return;
        const g = G.get(gid), sw = G.get(c.b), dev = devOf(g);
        if (g && sw && dev && sw.device_id && g.device_id && !shared(g.device_id)) jobs.push([g.device_id, { uplink_id: null, uplink_port: '', _only: sw.device_id }]);
      });
      if (!jobs.length || !canEdit) return;
      (async () => {
        for (const [id, f] of jobs) {
          try {
            if (f._only) { const d = (await get('/api/devices/' + id)).device; if (d.uplink_id !== f._only) continue; delete f._only; }
            await putDevice(id, f);
          } catch (e) { toast('Gear Locker not updated: ' + e.message, 'bad'); }
        }
      })();
    }
    /**
     * What the Gear Locker knows, brought onto the drawing once when it opens: wireless mics and packs paired with a
     * receiver or transmitter that is here, and "Plugged into" between gear and a switch that are both here.
     */
    async function syncFromLocker() {
      if (typeof DEV === 'undefined' || !DEV.list) return;
      const doc = st.doc, notes = [];
      let n = 0;
      // the drawing numbers a repeated name "WMIC-2 #2"; that counts as the same name
      const bare = (x) => String(x || '').replace(/\s+#\d+$/, '');
      const same = (x, y) => (typeof Tags !== 'undefined' ? Tags.norm(bare(x)) === Tags.norm(bare(y)) : bare(x).toLowerCase() === bare(y).toLowerCase());
      // tidy up copies an earlier sync made: a wireless mic or pack drawn twice (one linked to its Gear Locker card, one not)
      for (const g of doc.gear.filter((x) => (x.kind === 'txmic' || x.kind === 'bodypack') && x.device_id)) {
        const twin = doc.gear.find((o) => o !== g && o.kind === g.kind && (o.device_id === g.device_id || (!o.device_id && same(o.name, g.name))));
        if (!twin) continue;
        // keep the one that is on a channel or wired up; it takes over the Gear Locker link
        const keepG = P.hostOf(doc, g) && !P.hostOf(doc, twin) ? g : twin, drop = keepG === g ? twin : g;
        keepG.device_id = g.device_id;
        doc.cables = doc.cables.filter((c) => c.a !== drop.id && c.b !== drop.id);
        doc.gear = doc.gear.filter((x) => x !== drop);
        n++;
      }
      // ---- the Gear Locker wins for linked blocks: the card's name, frequency, capsule and type; a block linked to a card of
      // another kind (a card deleted and its number reused, or changed) is unlinked and flagged in the checks
      const byId = new Map(DEV.list.map((d) => [d.id, d]));
      const renamed = [], moved = [], unpaired = [], pushUp = [];
      for (const g of doc.gear.filter((x) => x.device_id)) {
        const dev = byId.get(g.device_id);
        if (!dev) { if (DEV.list.length) { g.lost_card = true; delete g.device_id; n++; } continue; }
        if (dev.kind && dev.kind !== 'other' && g.kind !== 'other' && dev.kind !== g.kind) { g.wrong_card = dev.name + ' (' + (dev.kind || 'other') + ')'; delete g.device_id; n++; continue; }
        if (g.wrong_card) { delete g.wrong_card; n++; }
        if (!shared(dev.id) && dev.name && bare(g.name) !== dev.name) { renamed.push(g.name + ' → ' + dev.name); g.name = P.uniqueName ? P.uniqueName({ ...doc, gear: doc.gear.filter((x) => x !== g) }, dev.name) : dev.name; n++; }
        if (g.kind === 'txmic' || g.kind === 'bodypack') {
          // the card's value wins; a value only on the drawing (from before cards kept it) goes up to the card
          for (const f of ['freq', 'txtype', 'capsule']) {
            if ((dev[f] || '') === (g[f] || '')) continue;
            if (dev[f]) { g[f] = dev[f]; n++; } else if (g[f] && canEdit && !shared(dev.id)) pushUp.push([dev.id, f === 'capsule' ? { capsule: g[f], capsule_id: '', capsule_typed: true } : { [f]: g[f] }]);
          }
        }
      }
      // pairing: a mic or pack sits on the receiver or transmitter its card is paired with
      const rfOff = (g, h) => { doc.cables = doc.cables.filter((c) => !(c.kind === 'rf' && ((c.a === g.id && c.b === h.id) || (c.a === h.id && c.b === g.id)))); };
      for (const g of doc.gear.filter((x) => (x.kind === 'txmic' || x.kind === 'bodypack') && x.device_id)) {
        const dev = byId.get(g.device_id); if (!dev) continue;
        const H = P.hostOf(doc, g);
        const want = dev.pair_id ? doc.gear.find((x) => x.device_id === dev.pair_id && (x.kind === 'receiver' || x.kind === 'iemtx')) : null;
        if (H && want && H === want) continue;
        if (H && !dev.pair_id && H.device_id) {
          // unpaired in the Gear Locker: off its receiver; gone if nothing else is wired to it
          rfOff(g, H);
          if (!doc.cables.some((c) => c.a === g.id || c.b === g.id)) doc.gear = doc.gear.filter((x) => x !== g);
          else { g.x = (H.x || 0) - 340; g.y = H.y || 0; }
          unpaired.push(g.name); n++; continue;
        }
        if (want && H !== want) {
          if (H) rfOff(g, H);
          if (want.kind === 'iemtx') { P.connect(doc, want, 0, g, 0, { kind: 'rf' }); moved.push(g.name + ' → ' + want.name); n++; continue; }
          const usedCh = new Set(P.members(doc, want).map((m) => m.port)), ch = want.ins.findIndex((_, i) => !usedCh.has(i));
          if (ch < 0) { notes.push(dev.name); continue; }
          P.connect(doc, g, 0, want, ch, { kind: 'rf' }); delete g.x; delete g.y; moved.push(g.name + ' → ' + want.name); n++;
        }
      }
      // network: a card plugged into another port (or switch) in the Gear Locker moves its cable here
      for (const c of doc.cables.filter((x) => x.ap === 'net')) {
        const g = doc.gear.find((x) => x.id === c.a), dev = g && g.device_id && byId.get(g.device_id);
        if (!dev || shared(dev.id) || !dev.uplink_id) continue;
        const sw = doc.gear.find((x) => x.kind === 'network' && x.device_id === dev.uplink_id);
        const port = parseInt(dev.uplink_port, 10) || null;
        if (sw && (sw.id !== c.b || (port && port !== c.port))) {
          if (port && doc.cables.some((o) => o !== c && o.ap === 'net' && o.b === sw.id && o.port === port)) continue;
          c.b = sw.id; if (port) c.port = port; n++;
        }
      }
      const said = [];
      if (renamed.length) said.push('renamed ' + renamed.join(', '));
      if (moved.length) said.push('moved ' + moved.join(', '));
      if (unpaired.length) said.push(unpaired.join(', ') + ' unpaired');
      if (said.length) toast('From the Gear Locker: ' + said.join('; '));
      if (pushUp.length) (async () => { for (const [id, f] of pushUp) { try { await putDevice(id, f); } catch (e) { /* shown next time */ } } })();

      for (const host of doc.gear.filter((g) => (g.kind === 'receiver' || g.kind === 'iemtx') && g.device_id)) {
        const want = host.kind === 'receiver' ? 'txmic' : 'bodypack';
        for (const dev of DEV.list.filter((d) => d.pair_id === host.device_id && d.kind === want)) {
          // already drawn: linked to this card, or the same name not yet linked to any card
          let ex = doc.gear.find((g) => g.device_id === dev.id);
          if (!ex) { ex = doc.gear.find((g) => g.kind === want && !g.device_id && same(g.name, dev.name)); if (ex) { ex.device_id = dev.id; n++; } }
          if (ex) {
            if (P.hostOf(doc, ex)) continue;
            if (host.kind === 'iemtx') { P.connect(doc, host, 0, ex, 0, { kind: 'rf' }); n++; continue; }
            const usedCh = new Set(P.members(doc, host).map((m) => m.port)), ch = host.ins.findIndex((_, i) => !usedCh.has(i));
            if (ch < 0) { notes.push(dev.name); continue; }
            P.connect(doc, ex, 0, host, ch, { kind: 'rf' }); delete ex.x; delete ex.y; n++;
            continue;
          }
          const item = { name: dev.name, make: dev.make || undefined, model: dev.model || undefined, txtype: dev.txtype || undefined, freq: dev.freq || undefined, capsule: dev.capsule || undefined, device_id: dev.id };
          Object.keys(item).forEach((k) => { if (item[k] == null) delete item[k]; });
          const g = P.addMember(doc, host, item, null);
          if (g) n++; else notes.push(dev.name);   // every channel taken: say so, but never draw a loose copy
        }
      }
      // network: the Gear Locker's "Plugged into" as cables
      if (doc.gear.some((g) => g.kind === 'network' && g.device_id)) {
        try {
          const links = (DEV.list || []).filter((d) => d.uplink_id).map((d) => ({ from: d.uplink_id, to: d.id, port: d.uplink_port }));
          for (const l of links) {
            const sw = doc.gear.find((g) => g.kind === 'network' && g.device_id === l.from);
            if (shared(l.to)) continue;   // a card for several: each unit is plugged in on the drawing
            const g = doc.gear.find((x) => x.device_id === l.to && !P.hostOf(doc, x));
            if (!sw || !g || g === sw || P.netOf(doc, g)) continue;
            const port = parseInt(l.port, 10) || null;
            if (port && st.doc.cables.some((c) => c.ap === 'net' && c.b === sw.id && c.port === port)) continue;
            if (port && port > (sw.nports || 8)) sw.nports = Math.min(128, port);
            P.connectNet(doc, g, sw, port); n++;
          }
        } catch (e) { /* no map for this user */ }
      }
      if (notes.length) toast(notes.join(', ') + (notes.length === 1 ? ' is' : ' are') + ' paired in the Gear Locker, but every channel of ' + (notes.length === 1 ? 'its' : 'their') + ' receiver is taken, so ' + (notes.length === 1 ? 'it is' : 'they are') + ' not on the drawing. Free a channel or mark one as a spare.');
      if (n && canEdit) queueSave();
      return n;
    }
    function linkLabel(a, b) {
      const it = [a, b].map((g) => GearModels.find(g.model, g.kind)).find((m) => m && m.link);
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
      // a computer and an interface or console: a USB or Thunderbolt cable with its channel counts
      if (P.usbOk(a, 'link', b, 'link') && (opts.linkOnly || !wire)) return usbDialog(a, b);
      if (!wire && !linkable) return toast(!a.outs.length ? a.name + ' has no outputs' : b.name + ' has no inputs', 'bad');
      // mic onto a receiver, pack onto a transmitter: a member of the wireless system
      if (a.kind === 'txmic' && b.kind === 'receiver') return memberDialog(b, a);
      if (a.kind === 'iemtx' && b.kind === 'bodypack') { change(() => P.connect(st.doc, a, 0, b, 0, { kind: 'rf' }), b.name + ' paired with ' + a.name); pairInLocker(b, a); return; }
      const freeOut = opts.port != null ? opts.port : Math.max(0, a.outs.findIndex((_, j) => !(ix.from.get(a.id + ':' + j) || []).length));
      const firstFree = opts.toIn != null ? opts.toIn : Math.max(0, b.ins.findIndex((_, i) => !ix.into.get(b.id + ':' + i)));
      const opt = (list, sel, taken) => list.map((p, i) => '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + esc(p) + (taken(i) ? ' •' : '') + '</option>').join('');
      const stereo = a.outs.length > 1 && b.ins.length > 1 && /^(L|R)$/.test(a.outs[freeOut] || '') ? 2 : 1;
      let html = '<h3>Connect ' + esc(tm(a)) + ' → ' + esc(tm(b)) + '</h3><form id="pcf">';
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
          '<div class="two"><div><label>Cables in a row</label><input id="pcf_n" type="number" min="1" max="' + Math.min(a.outs.length, b.ins.length) + '" value="' + stereo + '"><span class="note">1 = just this cable. 8 connects the next 8 outputs to the next 8 inputs in order (a snake, both sides of a stereo feed).</span></div>' +
          '<div><label>Cable</label><select id="pcf_k">' + Object.entries(KIND_STYLE).filter(([k]) => k !== 'link' && k !== 'net').map(([k, v]) => '<option value="' + k + '"' + (k === P.guessCable(a, 0, b, 0) ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></div></div>' +
          '<label>Cable tag name <span class="note">(optional; Auto label in the toolbar numbers them all at once)</span></label><input id="pcf_l"><p class="note">• already in use: connecting replaces what is there.</p>';
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
    /** A computer to an audio interface or console: USB or Thunderbolt, how many channels each way, where the returns land. */
    function usbDialog(a, b) {
      const comp = a.kind === 'computer' ? a : b, end = comp === a ? b : a;
      const old = st.doc.cables.find((c) => c.kind === 'usb' && ((c.a === a.id && c.b === b.id) || (c.a === b.id && c.b === a.id)));
      const din = old ? old.chin : end.kind === 'interface' ? end.ins.length : end.usbch || 2, dout = old ? old.chout : end.kind === 'interface' ? end.outs.length : end.usbch || 2;
      const con = end.kind === 'console' ? end : null;
      modal('<h3>' + esc(tm(comp)) + ' ⇄ ' + esc(tm(end)) + '</h3><form id="puf">' +
        '<label>Cable</label><select id="pu_t">' + P.USB_TYPES.map((t) => '<option' + ((old && old.usbtype) === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
        '<div class="two"><div><label>Channels to ' + esc(comp.name) + '</label><input id="pu_i" type="number" min="0" max="256" value="' + (din == null ? 2 : din) + '"></div><div><label>Channels from ' + esc(comp.name) + '</label><input id="pu_o" type="number" min="0" max="256" value="' + (dout == null ? 2 : dout) + '"></div></div>' +
        (con ? '<div class="two"><div><label>USB 1 carries ' + esc(con.name) + ' channel</label><input id="pu_s" type="number" min="1" max="512" value="' + ((old && old.snd) || 1) + '"></div><div><label>Returns land on channel</label><input id="pu_r" type="number" min="1" max="512" placeholder="not set" value="' + ((old && old.ret) || '') + '"></div></div><p class="note">USB 1, 2… back from the computer land on console channels from this one (e.g. 33 on an SQ-5).</p>' : '') +
        '<p class="note">Then say what the computer does with the audio under Routes on ' + esc(comp.name) + '.</p>' +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">' + (old ? 'Save' : 'Connect') + '</button></div></form>', (w, close) => {
        $('#puf', w).addEventListener('submit', (e) => {
          e.preventDefault();
          const f = { kind: 'usb', usbtype: $('#pu_t', w).value, chin: Math.max(0, Number($('#pu_i', w).value) || 0), chout: Math.max(0, Number($('#pu_o', w).value) || 0) };
          if (con) { f.snd = Math.max(1, Number($('#pu_s', w).value) || 1); if (Number($('#pu_r', w).value) >= 1) f.ret = Number($('#pu_r', w).value); }
          close();
          change(() => {
            const cur = old && st.doc.cables.find((c) => c.id === old.id);
            if (cur) { Object.assign(cur, f); if (!f.ret) delete cur.ret; if (f.snd === 1) delete cur.snd; return; }
            P.connect(st.doc, gearOf(comp.id), 'link', gearOf(end.id), 'link', f);
          }, (old ? 'Saved ' : '') + comp.name + ' ⇄ ' + end.name + ' · ' + f.chin + ' in / ' + f.chout + ' out');
        });
      });
    }
    /** Put a mic on a receiver channel (a new one, or one that stands on its own), or add a pack to an IEM transmitter. */
    /**
     * A wireless channel: the transmitter on it (handheld, bodypack…, its model) and the capsule or mic it carries,
     * who uses it, its frequency. Or an IEM pack on an in-ear transmitter. New models go on your list.
     */
    const TX_TYPES = ['Handheld', 'Bodypack', 'Headset', 'Lavalier', 'Instrument', 'Other'];
    function memberDialog(host, existing, chPick) {
      const rx = host.kind === 'receiver';
      const used = new Set(P.members(st.doc, host).map((m) => m.port));
      const free = host.ins.map((p, i) => i).filter((i) => !used.has(i));
      if (rx && !free.length) return toast('Every channel on ' + host.name + ' has a transmitter. Take one out first.', 'bad');
      const people = peopleList();
      const want = rx ? 'txmic' : 'bodypack';
      // wireless mics or packs in the Gear Locker that are not on the drawing yet
      const onDoc = new Set(st.doc.gear.map((g) => g.device_id).filter(Boolean));
      const locker = ((typeof DEV !== 'undefined' && DEV.list) || []).filter((d) => d.kind === want && !onDoc.has(d.id))
        .sort((a, b) => (b.pair_id === host.device_id) - (a.pair_id === host.device_id) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      const dl = (id, kinds) => '<datalist id="' + id + '">' + GearModels.all().filter((m) => kinds.includes(m.kind)).map((m) => '<option value="' + esc(m.model) + '">' + esc(m.make || '') + '</option>').join('') + '</datalist>';
      const pairedTo = (d) => { const h = d.pair_id && DEV.list.find((x) => x.id === d.pair_id); return h ? (d.pair_id === host.device_id ? ' · paired with this one' : ' · paired with ' + h.name) : ''; };
      modal('<h3>' + (existing ? 'Put ' + esc(tm(existing)) + ' on ' + esc(tm(host)) : rx ? 'Add a wireless mic to ' + esc(tm(host)) : 'Add an in-ear pack to ' + esc(tm(host))) + '</h3><form id="pmf">' +
        (rx ? '<label>Receiver channel</label><select id="pm_ch">' + free.map((i) => '<option value="' + i + '"' + (i === chPick ? ' selected' : '') + '>' + esc(host.ins[i]) + '</option>').join('') + '</select>' : '') +
        (existing ? '' : (locker.length ? '<label>From the Gear Locker</label><select id="pm_dev"><option value="">New ' + (rx ? 'wireless mic' : 'pack') + '…</option>' + locker.map((d) => '<option value="' + d.id + '">' + esc(Tags.withModel(d.name, d.model) + pairedTo(d)) + '</option>').join('') + '</select>' : '') +
          '<div id="pm_new"><label>Tag name</label><div class="tagrow"><input id="pm_n" placeholder="' + (rx ? 'WMIC-1' : 'IEM-1') + '"><button type="button" class="btn sm" id="pm_auto">Auto label</button></div>' +
          (rx
          ? '<fieldset class="pmset"><legend>Transmitter</legend><div class="three"><div><label>Type</label><select id="pm_t">' + TX_TYPES.map((t) => '<option>' + t + '</option>').join('') + '</select></div>' +
              '<div><label>Make</label><input id="pm_mk" list="pm_mks" value="' + esc(host.make || '') + '"></div><div><label>Model</label><input id="pm_m" list="pm_tx" placeholder="Transmitter model"></div></div>' +
              '<label>Frequency (MHz)</label><input id="pm_f" inputmode="decimal" placeholder="000.000"></fieldset>' +
            '<fieldset class="pmset"><legend>Capsule or mic</legend><div class="two"><div><label>Make</label><input id="pm_cmk" list="pm_mks"></div><div><label>Model</label><input id="pm_c" list="pm_cap" placeholder="Capsule, lav or headset mic"></div></div></fieldset>'
          : '<div class="two"><div><label>Make</label><input id="pm_mk" list="pm_mks" value="' + esc(host.make || '') + '"></div><div><label>Pack model</label><input id="pm_m" list="pm_pk" placeholder="Pack model"></div></div><label>Earphones</label><input id="pm_e" placeholder="Earphones">') +
          '</div><div class="two"><div><label>Who uses it</label><input id="pm_p" list="pmppl" placeholder="Name"></div><div><label>Used for</label><input id="pm_u" placeholder="' + (rx ? 'What it picks up' : 'Whose mix') + '"></div></div>' +
          '<datalist id="pmppl">' + people.map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist>' + dl('pm_tx', ['txmic']) + dl('pm_cap', ['capsule', 'mic']) + dl('pm_pk', ['bodypack']) +
          '<datalist id="pm_mks">' + GearModels.makes().map((m) => '<option value="' + esc(m) + '">').join('') + '</datalist>' +
          (host.device_id ? '<p class="note">It gets its own Gear Locker card, paired with ' + esc(host.name) + '.</p>' : '')) +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">' + (existing ? 'Put it on' : 'Add') + '</button></div></form>', (w, close) => {
        w.classList.add('mwide');
        const pm = $('#pm_m', w);
        // picking a transmitter model you added before fills in its type
        if (pm && rx) pm.addEventListener('change', () => { const m = GearModels.find(pm.value, 'txmic'); if (m) { if (m.make) $('#pm_mk', w).value = m.make; if (m.capsule && TX_TYPES.includes(m.capsule)) $('#pm_t', w).value = m.capsule; } });
        const pc = $('#pm_c', w); if (pc) pc.addEventListener('change', () => { const m = GearModels.find(pc.value, 'capsule') || GearModels.find(pc.value, 'mic'); if (m && m.make) $('#pm_cmk', w).value = m.make; });
        const pd = $('#pm_dev', w); if (pd) pd.addEventListener('change', () => $('#pm_new', w).classList.toggle('hide', !!pd.value));
        const pa = $('#pm_auto', w);
        if (pa) pa.addEventListener('click', () => { $('#pm_n', w).value = Tags.suggest(want, allNames(), { person: $('#pm_p', w).value.trim() }); });
        setTimeout(() => { const f = $('#pm_dev', w) || $('#pm_n', w) || $('#pm_ch', w); if (f) f.focus(); }, 40);
        $('#pmf', w).addEventListener('submit', async (e) => {
          e.preventDefault();
          const ch = rx ? Number($('#pm_ch', w).value) : null;
          const v = (id) => { const x = $(id, w); return x ? x.value.trim() : ''; };
          close();
          if (existing) {
            change(() => { const ex = gearOf(existing.id); if (rx) P.connect(st.doc, ex, 0, gearOf(host.id), ch, { kind: 'rf' }); else P.connect(st.doc, gearOf(host.id), 0, ex, 0, { kind: 'rf' }); delete ex.x; delete ex.y; }, existing.name + ' is on ' + host.name + (rx ? ' ' + host.ins[ch] : ''));
            pairInLocker(existing, host);
            return;
          }
          const picked = pd && pd.value ? DEV.list.find((d) => d.id === Number(pd.value)) : null;
          let item;
          if (picked) item = { name: picked.name, make: picked.make, model: picked.model, txtype: picked.txtype, freq: picked.freq, capsule: picked.capsule, device_id: picked.id, person: v('#pm_p'), use: v('#pm_u') };
          else {
            item = rx ? { name: v('#pm_n'), person: v('#pm_p'), use: v('#pm_u'), txtype: v('#pm_t'), make: v('#pm_mk'), model: v('#pm_m'), capsule: v('#pm_c'), capmake: v('#pm_cmk'), freq: v('#pm_f') }
              : { name: v('#pm_n'), person: v('#pm_p'), use: v('#pm_u'), make: v('#pm_mk'), model: v('#pm_m') || 'IEM pack', phones: v('#pm_e') };
            if (rx) {
              if (!item.model) item.model = item.txtype || 'Transmitter';
              GearModels.add([v('#pm_m') ? { kind: 'txmic', make: item.make, model: item.model, capsule: item.txtype } : null, item.capsule ? { kind: 'capsule', make: item.capmake, model: item.capsule } : null].filter(Boolean));
            } else if (v('#pm_m')) GearModels.add([{ kind: 'bodypack', make: item.make, model: item.model }]);
          }
          Object.keys(item).forEach((k) => { if (item[k] == null || item[k] === '') delete item[k]; });
          if (!item.name) item.name = Tags.suggest(want, allNames(), { person: item.person });
          const g = change(() => P.addMember(st.doc, gearOf(host.id), item, ch), (rx ? 'Wireless mic added to ' + host.name + ' ' + host.ins[ch] : 'Pack added to ' + host.name));
          if (!g) return;
          select({ gear: [g.id] }, { noSheet: true });
          if (picked) pairInLocker(g, host);
          else if (host.device_id && canEdit) {
            // its own Gear Locker card, paired with the receiver or transmitter
            try {
              const r = await call('POST', '/api/devices', { name: g.name, kind: want, category: 'audio', make: g.make || '', model: g.model || '', txtype: g.txtype || '', freq: g.freq || '', capsule: g.capsule || '', capsule_typed: !!g.capsule, capsule_id: '', pair_id: host.device_id });
              const x = gearOf(g.id); if (x) { x.device_id = r.id; queueSave(); }
              if (typeof forgetDevices === 'function') forgetDevices(); await loadDevices(true); paintPane();
            } catch (err) { toast('Not added to the Gear Locker: ' + err.message, 'bad'); }
          }
        });
      });
    }
    /** Every tag name on the drawing (for Auto label). */
    const allNames = (skip) => st.doc.gear.filter((g) => g.id !== skip).map((g) => g.name);
    /** A mic or pack put on a receiver or transmitter here is paired with it in the Gear Locker too. */
    async function pairInLocker(g, host) {
      const dev = devOf(gearOf(g.id) || g);
      if (!dev || !host.device_id || dev.pair_id === host.device_id || !canEdit) return;
      try { await putDevice(dev.id, { pair_id: host.device_id }); } catch (e) { toast('Gear Locker not updated: ' + e.message, 'bad'); }
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
        w.classList.add('mwide');
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
    /**
     * Every channel on a console with its name and colour, the way the desk will show them.
     * Fill names from who uses it, what it is for, or numbered by type (WMIC-1, MIC-1, DI-1); download as a list.
     */
    function namesDialog(con) {
      const rows = P.inputs(st.doc).filter((r) => r.console.id === con.id && r.used && r.up.src);
      const seen = new Set();
      const list = rows.filter((r) => { if (seen.has(r.up.src.id + ':' + r.ch)) return false; seen.add(r.up.src.id + ':' + r.ch); return true; });
      const pal = con.colors || null, len = con.namelen || 0;
      const ro = !st.edit;
      const colorSel = (r) => pal ? '<select data-cc="' + r.up.src.id + '"' + (ro ? ' disabled' : '') + '><option value="">—</option>' + pal.map((c) => '<option' + (key(c) === key(r.up.src.chcolor) ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' : '<input data-cc="' + r.up.src.id + '" value="' + esc(r.up.src.chcolor || '') + '" placeholder="Red"' + (ro ? ' disabled' : '') + '>';
      modal('<h3>' + esc(con.name) + ' channel names</h3><p class="note">' + (len ? 'Names up to ' + len + ' letters' : 'Set the most letters a name can have on the console card, so names fit the desk') + (pal ? ' · colours: ' + esc(pal.join(', ')) : ' · no colour list set on the console yet') + '.</p>' +
        (ro ? '' : '<div class="pkbox"><span class="note">Fill empty names from</span> <button type="button" class="btn sm" data-fill="person">Who uses it</button><button type="button" class="btn sm" data-fill="use">Used for</button><button type="button" class="btn sm" data-fill="type">Numbered (WMIC-1, MIC-1, DI-1)</button> <label class="tog sm"><input type="checkbox" id="pn_all"> Replace all</label></div>') +
        (list.length ? '<div class="pnames"><div class="pnh"><span>Ch</span><span>Source</span><span>Name</span><span>Colour</span></div>' + list.map((r) => '<div class="pnr"><b>' + (r.ch == null ? '—' : r.ch) + '</b><span class="note">' + esc(cut([r.up.source, r.up.person, r.up.mic].filter(Boolean).join(' · ') || r.via.name + ' ' + r.port, 34)) + '</span>' +
          '<span class="pnn"><i class="sw" data-sw="' + r.up.src.id + '" style="background:' + (r.up.src.chcolor ? colorCss(r.up.src.chcolor) : 'transparent') + '"></i><input data-cn="' + r.up.src.id + '" value="' + esc(r.up.src.chname || '') + '"' + (len ? ' maxlength="' + len + '"' : '') + (ro ? ' disabled' : '') + '></span>' + colorSel(r) + '</div>').join('') + '</div>'
          : '<p class="note">Nothing is on a ' + esc(con.name) + ' channel yet.</p>') +
        '<div class="acts"><button type="button" class="ghost" id="pn_csv">' + icon('download') + 'Download list</button><span class="grow"></span><button type="button" data-close>' + (ro ? 'Close' : 'Cancel') + '</button>' + (ro ? '' : '<button class="primary" id="pn_ok">Save</button>') + '</div>', (w, close) => {
        w.classList.add('mwide');
        $$('[data-cc]', w).forEach((x) => x.addEventListener('change', () => { const sw = $('[data-sw="' + x.dataset.cc + '"]', w); if (sw) sw.style.background = x.value ? colorCss(x.value) : 'transparent'; }));
        $$('[data-fill]', w).forEach((b) => b.addEventListener('click', () => {
          const sug = P.suggestNames(st.doc, con, b.dataset.fill), all = $('#pn_all', w).checked;
          sug.forEach((n, id) => { const inp = $('[data-cn="' + id + '"]', w); if (inp && (all || !inp.value.trim())) inp.value = n; });
        }));
        $('#pn_csv', w).addEventListener('click', () => {
          const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
          const lines = [['Channel', 'Name', 'Colour', 'Source', 'Who', 'Mic / DI', 'Socket'].map(q).join(',')].concat(list.map((r) => {
            const id = r.up.src.id, n = $('[data-cn="' + id + '"]', w), c = $('[data-cc="' + id + '"]', w);
            return [r.ch, n ? n.value : r.up.src.chname, c ? c.value : r.up.src.chcolor, r.up.source, r.up.person, r.up.mic, r.via.kind === 'console' ? r.port : r.via.name + ' ' + r.port].map(q).join(',');
          }));
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
          a.download = con.name.replace(/[^\w-]+/g, '_') + '-channels.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        });
        const ok = $('#pn_ok', w);
        if (ok) ok.addEventListener('click', () => {
          const vals = list.map((r) => ({ id: r.up.src.id, n: ($('[data-cn="' + r.up.src.id + '"]', w) || {}).value, c: ($('[data-cc="' + r.up.src.id + '"]', w) || {}).value }));
          close();
          change(() => vals.forEach((v) => { const g = gearOf(v.id); if (!g) return; const n = String(v.n || '').trim(), c = String(v.c || '').trim(); if (n) g.chname = n; else delete g.chname; if (c) g.chcolor = c; else delete g.chcolor; }), 'Channel names saved');
        });
      });
    }
    /**
     * Auto label: tag names for the gear (RX-1, WMIC-1 Kyle, SB-A, FOH SQ-5, PA-AMP1…) and one number for each cable
     * (C-001, C-002… in signal order, the same at both ends). A preview with a tick on each; nothing changes until Apply.
     * Ticked to start with: only gear and cables that still have their default name (the model, the type, or none).
     */
    const isDefaultName = (g) => {
      const n = P.tagKey(String(g.name || '').replace(/\s*#\d+$/, ''));
      const k = P.KINDS[g.kind] || P.KINDS.other;
      const plain = [k.label, g.model, (g.make || '') + ' ' + (g.model || ''), 'Handheld', 'Transmitter', 'IEM pack', 'Pack'].filter(Boolean).map(P.tagKey);
      return !n || plain.includes(n) || /(mic|pack)$/.test(n) && (g.kind === 'txmic' || g.kind === 'bodypack') && !/^(wmic|iem)/.test(n);
    };
    function autoLabelDialog() {
      const ix = P.index(st.doc);
      // drawing order: wired gear stage by stage (left to right, top to bottom), then gear with no cables
      const wired = new Set();
      st.doc.cables.forEach((c) => { const ga = gearOf(c.a), gb = gearOf(c.b); const a = (P.hostOf(st.doc, ga) || ga).id, b = (P.hostOf(st.doc, gb) || gb).id; if (a !== b) { wired.add(a); wired.add(b); } });
      const pos = (g) => { const h = P.hostOf(st.doc, g) || g; return { l: wired.has(h.id) ? 0 : 1, s: P.stageOf(h) === 'net' ? 6 : P.stageOf(h), x: h.x || 0, y: h.y || 0, m: h === g ? -1 : (P.members(st.doc, h).find((m) => m.g.id === g.id) || { port: 0 }).port }; };
      const gearOrder = st.doc.gear.slice().sort((a, b) => { const p = pos(a), q = pos(b); return p.l - q.l || p.s - q.s || p.x - q.x || p.y - q.y || p.m - q.m; });
      const infos = cableInfos(st.doc);
      const cabOrder = st.doc.cables.filter((c) => c.kind !== 'rf' && infos.has(c.id)).sort((c1, c2) => {
        const a1 = gearOf(c1.a), a2 = gearOf(c2.a), p = pos(a1), q = pos(a2);
        return p.s - q.s || p.y - q.y || p.x - q.x || String(c1.ap).localeCompare(String(c2.ap), undefined, { numeric: true }) || (gearOf(c1.b).y || 0) - (gearOf(c2.b).y || 0);
      });
      const tick = new Map(gearOrder.map((g) => [g.id, isDefaultName(g)]));
      const tickC = new Map(cabOrder.map((c) => [c.id, !c.label]));
      const spot = new Map();      // speakers: a position instead of a number
      const compute = () => {
        const taken = gearOrder.filter((g) => !tick.get(g.id)).map((g) => g.name), out = new Map();
        gearOrder.forEach((g) => { if (!tick.get(g.id)) return; const n = Tags.suggest(g.kind, taken, { person: g.kind === 'txmic' || g.kind === 'bodypack' ? g.person : '', model: g.model, position: spot.get(g.id) || '' }); taken.push(n); out.set(g.id, n); });
        const ct = cabOrder.filter((c) => !tickC.get(c.id)).map((c) => c.label || ''), outC = new Map();
        cabOrder.forEach((c) => { if (!tickC.get(c.id)) return; const n = Tags.cableName(infos.get(c.id), ct); ct.push(n); outC.set(c.id, n); });
        return { g: out, c: outC };
      };
      const cabText = (c) => { const r = P.cableList({ gear: st.doc.gear, cables: [c] })[0]; return r ? r.from + ' → ' + r.to : ''; };
      modal('<h3>Auto label</h3><p class="note">Tag names for your gear, and one name for each cable that says what it does (IN-A03 plugs into stage box A input 3; SPK, OUT, LNK and NET are numbered), printed the same at both ends. Untick anything that keeps its own name. Undo puts the old names back.</p><form id="alf">' +
        '<div class="alh"><b>Gear</b><span class="grow"></span><button type="button" class="linkbtn" data-all="g1">All</button> · <button type="button" class="linkbtn" data-all="g0">None</button></div><div class="allist" id="al_g"></div>' +
        '<label class="tog sm"><input type="checkbox" id="al_dev" checked> Also rename their Gear Locker cards <span class="note">(not cards with a quantity: their units are named on the drawing)</span></label>' +
        '<div class="alh"><b>Cables</b><span class="grow"></span><button type="button" class="linkbtn" data-all="c1">All</button> · <button type="button" class="linkbtn" data-all="c0">None</button></div><div class="allist" id="al_c"></div>' +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary" id="al_ok">Apply</button></div></form>', (w, close) => {
        w.classList.add('mwide');
        const paintL = () => {
          const r = compute();
          $('#al_g', w).innerHTML = gearOrder.map((g) => {
            const on = tick.get(g.id), h = P.hostOf(st.doc, g);
            const sp = (g.kind === 'speaker' || g.kind === 'wedge') && on ? '<select class="alsp" data-sp="' + g.id + '"><option value="">Numbered</option>' + Tags.POSITIONS.map((p) => '<option' + (spot.get(g.id) === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select>' : '';
            return '<label class="alr' + (on ? ' on' : '') + '"><input type="checkbox" data-tg="' + g.id + '"' + (on ? ' checked' : '') + '><span class="alo">' + esc(g.name) + (h ? ' <em>in ' + esc(h.name) + '</em>' : '') + '</span><span class="aln">' + (on ? '→ <b class="mono">' + esc(r.g.get(g.id)) + '</b>' : '<span class="note">keeps its name</span>') + '</span>' + sp + '</label>';
          }).join('') || '<p class="note">No gear yet.</p>';
          $('#al_c', w).innerHTML = cabOrder.map((c) => {
            const on = tickC.get(c.id);
            return '<label class="alr' + (on ? ' on' : '') + '"><input type="checkbox" data-tc="' + c.id + '"' + (on ? ' checked' : '') + '><span class="alo">' + esc(cabText(c)) + (c.label && !on ? ' <b class="mono">' + esc(c.label) + '</b>' : '') + '</span><span class="aln">' + (on ? '→ <b class="mono">' + esc(r.c.get(c.id)) + '</b>' : '<span class="note">keeps ' + (c.label ? 'its name' : 'no name') + '</span>') + '</span></label>';
          }).join('') || '<p class="note">No cables yet.</p>';
          $$('[data-tg]', w).forEach((x) => x.addEventListener('change', () => { tick.set(x.dataset.tg, x.checked); paintL(); }));
          $$('[data-tc]', w).forEach((x) => x.addEventListener('change', () => { tickC.set(x.dataset.tc, x.checked); paintL(); }));
          $$('[data-sp]', w).forEach((x) => { x.addEventListener('click', (e) => e.preventDefault()); x.addEventListener('change', () => { if (x.value) spot.set(x.dataset.sp, x.value); else spot.delete(x.dataset.sp); paintL(); }); });
          const n = r.g.size + r.c.size;
          $('#al_ok', w).textContent = n ? 'Apply ' + n + ' name' + (n === 1 ? '' : 's') : 'Nothing to change';
          $('#al_ok', w).disabled = !n;
        };
        $$('[data-all]', w).forEach((b) => b.addEventListener('click', () => { const v = b.dataset.all[1] === '1'; if (b.dataset.all[0] === 'g') gearOrder.forEach((g) => tick.set(g.id, v)); else cabOrder.forEach((c) => tickC.set(c.id, v)); paintL(); }));
        paintL();
        $('#alf', w).addEventListener('submit', async (e) => {
          e.preventDefault();
          const r = compute(), dev = $('#al_dev', w).checked;
          close();
          const renamed = [];
          change(() => {
            r.g.forEach((n, id) => { const g = gearOf(id); if (g && g.name !== n) { g.name = n; if (g.device_id && !shared(g.device_id)) renamed.push([g.device_id, n]); } });
            r.c.forEach((n, id) => { const c = st.doc.cables.find((x) => x.id === id); if (c) c.label = n; });
          }, (r.g.size ? r.g.size + ' tag name' + (r.g.size === 1 ? '' : 's') : '') + (r.g.size && r.c.size ? ' and ' : '') + (r.c.size ? r.c.size + ' cable' + (r.c.size === 1 ? '' : 's') : '') + ' labelled. Undo puts them back.');
          if (dev && renamed.length && canEdit) {
            let bad = 0;
            for (const [id, n] of renamed) { try { await putDevice(id, { name: n }); } catch (err) { bad++; } }
            if (bad) toast(bad + ' Gear Locker card' + (bad === 1 ? ' was' : 's were') + ' not renamed (the name is already used there).', 'bad');
          }
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
    /** Auto-arrange: one time, the whole drawing laid out by signal flow. Undo puts it back. */
    function tidy() {
      change(() => { const pos = autoArrange(st.doc); st.doc.gear.forEach((g) => { const p = pos.get(g.id); if (p) { g.x = p.x; g.y = p.y; } }); }, 'Arranged by signal flow. Undo puts it back.');
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
      const before = JSON.stringify(st.doc);
      st.undo.push(before); if (st.undo.length > 120) st.undo.shift();
      st.redo = [];
      const r = fn();
      syncNet(JSON.parse(before), st.doc);
      st.cache = null;
      paint(true);
      if (!keepPane) paintPane();
      if (msg) toast(msg);
      queueSave();
      return r;
    }
    function undo() { if (!st.undo.length) return; const b = st.doc; st.redo.push(JSON.stringify(st.doc)); st.doc = JSON.parse(st.undo.pop()); syncNet(b, st.doc); st.cache = null; paint(true); paintPane(); queueSave(); }
    function redo() { if (!st.redo.length) return; const b = st.doc; st.undo.push(JSON.stringify(st.doc)); st.doc = JSON.parse(st.redo.pop()); syncNet(b, st.doc); st.cache = null; paint(true); paintPane(); queueSave(); }
    let saveTimer = null;
    /** The save status by the title; the page may have been left while a save was on its way. */
    function saveNote(t) { const el = $('#psave'); if (el) el.textContent = t; }
    function queueSave() { saveNote('Saving…'); S.dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 700); }
    async function save() {
      if (st.saving) { st.dirtySave = true; return; }
      st.saving = true;
      try {
        const r = await call('PUT', '/api/patch', { doc: st.doc, baseVersion: st.version });
        st.version = r.version;
        if (!st.draft) { st.draft = true; paintRev(); }
        saveNote('Saved'); S.dirty = false;
      } catch (e) {
        if (e.status === 409) { toast(e.message, 'bad'); const d = await get('/api/patch'); st.doc = d.doc; st.version = d.version; st.undo = []; st.redo = []; S.dirty = false; st.cache = null; paint(true); paintPane(); saveNote('Reloaded'); }
        else { saveNote('Not saved: ' + e.message); }
      }
      st.saving = false;
      if (st.dirtySave) { st.dirtySave = false; save(); }
    }
    /** Wait for any pending autosave, so publishing marks what is on screen. */
    async function flush() {
      if (saveTimer && S.dirty) { clearTimeout(saveTimer); saveTimer = null; await save(); }
      for (let i = 0; i < 100 && st.saving; i++) await new Promise((r) => setTimeout(r, 100));
    }
    const bumpRev = (rev, level) => {
      const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(rev || ''));
      if (!m) return '1.0.0';
      const [M, n, q] = m.slice(1).map(Number);
      return level === 'major' ? (M + 1) + '.0.0' : level === 'minor' ? M + '.' + (n + 1) + '.0' : M + '.' + n + '.' + (q + 1);
    };
    /** Done with changes: publish them as the next revision (patch, minor or major), or keep them as a draft. */
    function publishDialog() {
      const lv = [['patch', 'Patch', 'Small fixes: a renamed cable, a moved card'], ['minor', 'Minor', 'Setup changes: gear added or re-patched'], ['major', 'Major', 'A new layout, like a special service']];
      const first = !st.rev;
      modal('<h3>Publish this revision?</h3><p>' + (first ? 'The stage patch has not been published yet. Its first revision is 1.0.0.' : 'Changes since Rev ' + esc(st.rev) + '. Publishing gives them a number for the PDF and the history.') + '</p>' +
        '<form id="pubf">' + (first ? '' : '<div class="publv">' + lv.map((l, i) => '<label class="publ"><input type="radio" name="lv" value="' + l[0] + '"' + (i === 0 ? ' checked' : '') + '><span><b>' + l[1] + ' · ' + bumpRev(st.rev, l[0]) + '</b><em>' + l[2] + '</em></span></label>').join('') + '</div>') +
        '<label>Note <span class="note">(optional)</span></label><input id="pubn" maxlength="200" placeholder="What changed, like “Added choir mics”">' +
        '<div class="acts"><button type="button" data-close>Keep as draft</button><button class="primary" id="pubb">Publish Rev ' + bumpRev(st.rev, 'patch') + '</button></div></form>', (w, close) => {
        const lvOf = () => { const r = $('input[name=lv]:checked', w); return r ? r.value : 'patch'; };
        $$('input[name=lv]', w).forEach((r) => r.addEventListener('change', () => { $('#pubb', w).textContent = 'Publish Rev ' + bumpRev(st.rev, lvOf()); }));
        $('#pubf', w).addEventListener('submit', async (e) => {
          e.preventDefault();
          const b = $('#pubb', w); b.disabled = true;
          try {
            await flush();
            const r = await call('POST', '/api/patch/publish', { level: lvOf(), note: $('#pubn', w).value.trim() });
            st.rev = r.rev; st.draft = false; paintRev(); close(); toast('Published Rev ' + r.rev, 'ok');
          } catch (err) { toast(err.message, 'bad'); b.disabled = false; }
        });
      });
    }
    document.addEventListener('keydown', function keys(e) {
      if (!svg.isConnected) return document.removeEventListener('keydown', keys);
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !/input|textarea|select/i.test(e.target.tagName) && !document.querySelector('.modal')) { e.preventDefault(); fit(e.shiftKey && st.sel.length ? selBox() : null); return; }
      if (!st.edit || /input|textarea|select/i.test(e.target.tagName) || document.querySelector('.modal')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); select({ gear: [...D.models.keys()] }, { noSheet: true }); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selCable) { e.preventDefault(); const id = st.selCable; st.selCable = null; change(() => { st.doc.cables = st.doc.cables.filter((c) => c.id !== id); }, 'Cable removed'); }
        else if (st.sel.length === 1) { e.preventDefault(); removeGear(st.sel[0]); }
        else if (st.sel.length > 1) { e.preventDefault(); removeSelection(); }
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
      // on a computer the pane shows only when something is picked, or while adding equipment
      if (host.id === 'ppane') $('.pmain').classList.toggle('nopane', st.edit && !st.sel.length && !st.selCable && !st.adding);
      const g = st.sel.length === 1 ? gearOf(st.sel[0]) : null;
      const cab = st.selCable ? st.doc.cables.find((c) => c.id === st.selCable) : null;
      const addBtn = () => { if (!st.edit || host.id === 'psh') return; const bt = document.createElement('button'); bt.className = 'btn paddbtn'; bt.innerHTML = icon('plus') + 'Add equipment'; bt.addEventListener('click', () => { st.adding = true; select(null); }); host.prepend(bt); };
      if (cab) { cablePane(host, cab); return addBtn(); }
      if (g) { gearPane(host, g); return addBtn(); }
      if (st.sel.length > 1) {
        const list = st.sel.map(gearOf).filter(Boolean);
        host.innerHTML = '<div class="pph"><button class="ghost pback" id="pbk2" title="Back">' + icon('x') + '</button><b>' + list.length + ' pieces of gear</b></div>' +
          (st.edit ? '<p class="note">Drag one to move them all, or line them up:</p><div class="palign2">' + [['left', '⇤ Left edges'], ['top', '⤒ Top edges'], ['center', '↔ Centres'], ['vdist', '⇕ Space evenly'], ['hdist', '⇔ Space across']].map(([k, l]) => '<button class="btn" data-al2="' + k + '">' + l + '</button>').join('') + '</div>' : '') +
          '<div class="plist2">' + list.map((x) => '<button class="prow" data-pick="' + x.id + '"><b>' + esc(tm(x)) + '</b><span>' + esc([who(x), x.model].filter(Boolean).join(' · ')) + '</span></button>').join('') + '</div>';
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

    /*
     * Adding equipment. No built-in catalog: the "New gear" form takes a type, make and model (and its sockets),
     * adds it to the drawing and remembers the model, so the list below grows with the team's own gear.
     */
    const NEWF = {
      console: [['nin', 'Local inputs', 16], ['nout', 'Local outputs', 12], ['link', 'Link to stage boxes', 'SLink'], ['namelen', 'Channel name: most letters', ''], ['colors', 'Channel colours (comma between)', '']],
      stagebox: [['nin', 'Inputs', 16], ['nout', 'Outputs', 8], ['link', 'Link to the console', 'SLink']],
      receiver: [['nin', 'Channels', 2]], amp: [['nin', 'Channels', 2]],
      processor: [['nin', 'Inputs', 2], ['nout', 'Outputs', 6]], source: [['nout', 'Outputs', 2]],
      computer: [['software', 'Software (comma between)', '']], interface: [['nin', 'Inputs', 2], ['nout', 'Outputs', 2]], other: [['nin', 'Inputs', 1], ['nout', 'Outputs', 1]],
      di: [['nout', 'Outputs (1 mono, 2 stereo)', 1]], txmic: [['capsule', 'Capsule', '']], iemtx: [['mode', 'Mode', 'Stereo']], network: [['nports', 'Ports', 8]]
    };
    /*
     * Add equipment: find first (your list and the Gear Locker), then Gear Locker cards not on the drawing yet,
     * grouped by type, then your models; "New gear" (folded) for something you have not added before.
     */
    function addPane(host) {
      const onPatch = new Set(((typeof DEV !== 'undefined' && DEV.list) || []).filter((d) => unitsOf(d.id) >= (typeof qtyOf === 'function' ? qtyOf(d) : 1)).map((d) => d.id));
      const devs = ((typeof DEV !== 'undefined' && DEV.list) || []).filter((d) => !onPatch.has(d.id) && d.kind !== 'power' && d.kind !== 'capsule' && (['audio', 'network', 'computer'].includes(d.category) || P.KINDS[d.kind]));
      const pre = st.prefill || {};
      const kind = pre.kind || st.newKind || 'mic';
      const models = GearModels.all().filter((m) => m.kind !== 'capsule' && m.kind !== 'power');   // capsules go in mics, power strips in racks: not blocks on the drawing
      const typeOf = (k) => (P.KINDS[k] ? P.KINDS[k].label : 'Not sorted yet');
      const order = (k) => { const i = P.KIND_ORDER.indexOf(k); return i < 0 ? 99 : i; };
      const group = (list, kindOf) => { const m = new Map(); list.forEach((x) => { const k = kindOf(x) || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return [...m.entries()].sort((a, b) => order(a[0]) - order(b[0])); };
      const devGroups = group(devs.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), (d) => d.kind || (GearModels.find(d.model) || {}).kind);
      const modGroups = group(models.slice().sort((a, b) => (a.make + a.model).localeCompare(b.make + b.model)), (m) => m.kind);
      const fields = (NEWF[kind] || []).map(([f, label, def]) => {
        const v = pre[f] != null ? pre[f] : def;
        if (f === 'mode') return '<label>' + label + '<select data-nf="mode"><option>Stereo</option><option' + (v === 'Mono' ? ' selected' : '') + '>Mono</option></select></label>';
        if (f === 'software') return '<label class="wide">' + label + '<input data-nf="software" value="' + esc(Array.isArray(v) ? v.join(', ') : v || '') + '" placeholder="LiveProfessor, OBS, ProPresenter"><span class="note">' + P.SOFTWARE.join(' · ') + '</span></label>';
        const num = ['nin', 'nout', 'namelen', 'nports'].includes(f);
        return '<label' + (f === 'colors' ? ' class="wide"' : '') + '>' + label + '<input data-nf="' + f + '"' + (num ? ' type="number" min="0" max="128"' : '') + ' value="' + esc(Array.isArray(v) ? v.join(', ') : v) + '"' + (f === 'colors' ? ' placeholder="Red, Green, Yellow, Blue, Purple, Cyan, White"' : f === 'namelen' ? ' placeholder="no limit"' : '') + '></label>';
      }).join('');
      const openNew = !!pre.kind || !!pre.model || (!devs.length && !models.length);
      host.innerHTML = '<div class="pph"><b>Add equipment</b>' + (host.id === 'ppane' ? '<button class="ghost pback" id="pclose" title="Close" style="margin-left:auto">' + icon('x') + '</button>' : '') + '</div>' + (st.placeAt ? '<p class="note">It goes where you right-clicked.</p>' : '') +
        '<input type="search" id="pfind" placeholder="Find in your list and Gear Locker" class="pfind" autocomplete="off">' +
        '<p class="note pnone hide" id="pnone">Nothing matches. Add it as new gear below.</p>' +
        (devGroups.length ? '<div class="psec"><div class="psech">In the Gear Locker, not on the drawing yet</div>' + devGroups.map(([k, l]) => '<div class="pcat"><div class="pch">' + esc(typeOf(k)) + '</div><div class="pitems">' + l.map((d) => { const q = typeof qtyOf === 'function' ? qtyOf(d) : 1, u = unitsOf(d.id);
          return '<button class="pitem cat-' + ((P.KINDS[k] || P.KINDS.other).cat) + '" data-dev="' + d.id + '"><b>' + esc(Tags.withModel(d.name, d.model)) + (q > 1 ? ' ×' + q : '') + '</b><span>' + esc((q > 1 ? u + ' of ' + q + ' placed · ' : '') + ([d.make, d.location].filter(Boolean).join(' · ') || 'Gear Locker')) + '</span></button>'; }).join('') + '</div></div>').join('') + '</div>' : '') +
        (modGroups.length ? '<div class="psec"><div class="psech">Your models</div>' + modGroups.map(([k, l]) => '<div class="pcat"><div class="pch">' + esc(typeOf(k)) + '</div><div class="pitems">' + l.map((m) => '<div class="pitemw"><button class="pitem cat-' + (P.KINDS[k] || P.KINDS.other).cat + '" data-mod="' + esc(GearModels.keyOf(m)) + '"><b>' + esc(m.model) + '</b><span>' + esc([m.make, m.nin != null && k !== 'receiver' && k !== 'amp' ? m.nin + ' in' : '', m.nout ? m.nout + ' out' : '', (k === 'receiver' || k === 'amp') && m.nin ? m.nin + ' ch' : '', m.link].filter(Boolean).join(' · ')) + '</span></button><button type="button" class="pforget2" data-forget="' + esc(GearModels.keyOf(m)) + '" title="Take off your list">' + icon('x') + '</button></div>').join('') + '</div></div>').join('') + '</div>'
          : '<p class="note pempty2">Your list is empty. Each make and model you add as new gear is kept here, so next time it is one tap.</p>') +
        '<details class="pnewd" id="pnewd"' + (openNew ? ' open' : '') + '><summary>' + icon('plus') + 'New gear' + (pre.device_id ? ' · from the Gear Locker' : '') + '</summary>' +
        '<form class="pnew" id="pnew">' +
        '<label>Type<select id="pn_k">' + P.KIND_ORDER.map((k) => '<option value="' + k + '"' + (k === kind ? ' selected' : '') + '>' + esc(P.KINDS[k].label) + '</option>').join('') + '</select></label>' +
        '<label>Make<input id="pn_mk" list="pn_mks" value="' + esc(pre.make || '') + '" placeholder="Manufacturer" autocomplete="off"></label>' +
        '<label>Model<input id="pn_md" list="pn_mds" value="' + esc(pre.model || '') + '" placeholder="Model number" autocomplete="off" required></label>' +
        '<label>Tag name<span class="tagrow"><input id="pn_tag" value="' + esc(pre.name || '') + '" placeholder="Leave empty to use the model"><button type="button" class="btn sm" id="pn_auto">Auto label</button></span></label>' +
        (pre.device_id ? '' : '<label>How many?<input id="pn_n" type="number" min="1" max="24" value="1" inputmode="numeric"></label>') +
        '<datalist id="pn_mks">' + GearModels.makes().map((m) => '<option value="' + esc(m) + '">').join('') + '</datalist>' +
        '<datalist id="pn_mds">' + models.filter((m) => m.kind === kind).map((m) => '<option value="' + esc(m.model) + '">' + esc(m.make || '') + '</option>').join('') + '</datalist>' +
        (fields ? '<div class="pnf">' + fields + '</div>' : '') +
        '<button class="primary pnadd">' + icon('plus') + 'Add to the drawing</button>' + (pre.device_id ? '<button type="button" class="ghost pnadd" id="pn_x">Cancel</button>' : '') +
        '<p class="note">The make and model are saved to your list for next time.</p></form></details>';
      const pcl = $('#pclose', host); if (pcl) pcl.addEventListener('click', () => { st.adding = false; st.prefill = null; paintPane(); });
      const find = $('#pfind', host);
      find.addEventListener('input', () => {
        const q = key(find.value);
        $$('.pitem', host).forEach((b) => (b.closest('.pitemw') || b).classList.toggle('hide', !!q && !key(b.textContent).includes(q)));
        $$('.pcat', host).forEach((c) => c.classList.toggle('hide', !!q && !c.querySelector('.pitem:not(.hide)') && !c.querySelector('.pitemw:not(.hide) .pitem')));
        $$('.psec', host).forEach((c) => c.classList.toggle('hide', !!q && !c.querySelector('.pcat:not(.hide)')));
        const none = !!q && !host.querySelector('.psec:not(.hide)');
        $('#pnone', host).classList.toggle('hide', !none);
        if (none) { $('#pnewd', host).open = true; if (!$('#pn_md', host).value) $('#pn_md', host).value = find.value.trim(); }
      });
      $('#pn_k', host).addEventListener('change', (e) => { st.newKind = e.target.value; st.prefill = { ...(st.prefill || {}), kind: e.target.value, make: $('#pn_mk', host).value, model: $('#pn_md', host).value, name: $('#pn_tag', host).value }; addPane(host); });
      $('#pn_md', host).addEventListener('change', () => { const m = GearModels.find($('#pn_md', host).value, $('#pn_k', host).value); if (m && m.make && !$('#pn_mk', host).value) $('#pn_mk', host).value = m.make; });
      let autoTag = false;
      $('#pn_auto', host).addEventListener('click', () => { $('#pn_tag', host).value = Tags.suggest($('#pn_k', host).value, allNames(), { model: $('#pn_md', host).value.trim() }); autoTag = true; });
      $('#pn_tag', host).addEventListener('input', () => { autoTag = false; });
      const px = $('#pn_x', host); if (px) px.addEventListener('click', () => { st.prefill = null; addPane(host); });
      $('#pnew', host).addEventListener('submit', async (e) => {
        e.preventDefault();
        const k = $('#pn_k', host).value, make = $('#pn_mk', host).value.trim(), model = $('#pn_md', host).value.trim();
        if (!model) return toast('Type the model', 'bad');
        const m = { kind: k, make, model };
        $$('[data-nf]', host).forEach((x) => {
          const f = x.dataset.nf, v = x.value.trim();
          if (['nin', 'nout', 'namelen', 'nports'].includes(f)) { if (v !== '') m[f] = Math.max(0, Math.min(128, Number(v) || 0)); }
          else if (f === 'colors' || f === 'software') { const c = v.split(',').map((y) => y.trim()).filter(Boolean); if (c.length) m[f] = c; }
          else if (v) m[f] = v;
        });
        const tag = $('#pn_tag', host).value.trim(), n = Math.max(1, Math.min(24, Number(($('#pn_n', host) || {}).value) || 1));
        const p0 = st.prefill; st.prefill = null; st.newKind = k;
        const toList = { ...m }; delete toList.nports; delete toList.software;
        await GearModels.add([toList]);
        if (p0 && p0.device_id) { placeItem({ ...m, name: tag || p0.name, device_id: p0.device_id }, tag || p0.name); return; }
        for (let i = 0; i < n; i++) {
          const name = i === 0 ? tag : autoTag ? Tags.suggest(k, allNames(), { model }) : tag ? P.uniqueName(st.doc, tag) : '';
          await addItem({ ...m }, name);
        }
      });
      $$('[data-mod]', host).forEach((b) => b.addEventListener('click', () => { const m = GearModels.all().find((x) => GearModels.keyOf(x) === b.dataset.mod); if (m) addItem({ ...m }); }));
      $$('[data-forget]', host).forEach((b) => b.addEventListener('click', async () => {
        const m = GearModels.all().find((x) => GearModels.keyOf(x) === b.dataset.forget); if (!m) return;
        try { await GearModels.remove(m); toast((m.make ? m.make + ' ' : '') + m.model + ' taken off your list'); addPane(host); } catch (e) { toast(e.message, 'bad'); }
      }));
      $$('[data-dev]', host).forEach((b) => b.addEventListener('click', () => { const d = DEV.list.find((x) => x.id === Number(b.dataset.dev)); addDevice(d, host); }));
      if (st.prefill) setTimeout(() => { const f = $('#pn_k', host); if (f) f.focus(); }, 30);
      else if (wide()) setTimeout(() => { if (document.activeElement === document.body) find.focus(); }, 30);
    }
    /** Where new gear goes: where you right-clicked, else the middle of what you can see, in a free spot. */
    function newSpot(item) {
      const r = cv.getBoundingClientRect();
      const c = st.placeAt || world(r.left + r.width * 0.42, r.top + r.height * 0.3);
      st.placeAt = null;
      const rects = D ? [...D.models.values()].map((m) => outer(m)) : [];
      const h = HEAD + Math.min(6, (item.nin || 1)) * ROW + FOOT;
      return freeSpot(rects, CW, h, c.x, c.y);
    }
    /** How many blocks on the drawing stand for this Gear Locker card, and how many it has (its quantity). */
    function devCard(id) { return ((typeof DEV !== 'undefined' && DEV.list) || []).find((d) => d.id === id); }
    function unitsOf(id) { return st.doc.gear.filter((g) => g.device_id === id).length; }
    function shared(id) { const d = devCard(id); return !!d && typeof qtyOf === 'function' && qtyOf(d) > 1; }
    /** A card from the Gear Locker: its model from your list when it is there, else the New gear form asks what it is.
     *  A card with a quantity is placed once per unit, each its own block with its own tag (SPK-1, SPK-2). */
    function addDevice(d, host) {
      const m = GearModels.find(d.model) || GearModels.find(d.name);
      if (!m && !(d.kind && P.KINDS[d.kind])) {
        st.prefill = { make: d.make, model: d.model || d.name, name: d.name, device_id: d.id, nin: d.inputs || undefined, nout: d.outputs || undefined };
        if (host) addPane(host); else paintPane();
        toast('What type of gear is ' + d.name + '? Pick it in the form.');
        return;
      }
      const item = { ...(m || { kind: d.kind }), name: d.name, make: d.make || (m && m.make), model: d.model || (m && m.model), device_id: d.id };
      if (Array.isArray(d.software) && d.software.length) item.software = d.software.slice();
      if (d.kind === 'interface' && !m) { if (d.inputs) item.nin = d.inputs; if (d.outputs) item.nout = d.outputs; }
      if (d.kind && P.KINDS[d.kind]) item.kind = d.kind;
      if (typeof qtyOf === 'function' && qtyOf(d) > 1) {
        const taken = st.doc.gear.map((g) => g.name).concat(((typeof DEV !== 'undefined' && DEV.list) || []).filter((x) => x.id !== d.id).flatMap((x) => Tags.namesOf(x)));
        // a card named as a range (MIC-2–3) gives its units those names, in order; otherwise the next free tag
        const own = d.unit_tags && d.unit_tags.length ? d.unit_tags : Tags.namesOf({ name: d.name, qty: qtyOf(d) }), used = new Set(st.doc.gear.map((g) => Tags.norm(g.name)));
        const next = own.length > 1 ? own.find((x) => !used.has(Tags.norm(x))) : null;
        item.name = next || Tags.suggest(item.kind || 'other', taken.filter((x) => x !== d.name), { model: item.model });
      }
      if (!m && d.inputs) item.nin = d.inputs; if (!m && d.outputs) item.nout = d.outputs;
      if (item.kind === 'network') item.nports = Math.max(d.inputs || 0, d.outputs || 0) || 8;
      if (item.kind === 'txmic') Object.assign(item, { txtype: d.txtype || undefined, freq: d.freq || undefined, capsule: d.capsule || undefined });
      placeItem(item, item.name);
      // a receiver or in-ear transmitter: its mics and packs from the Gear Locker come with it
      if (item.kind === 'receiver' || item.kind === 'iemtx') syncFromLocker().then((k) => { if (k) { st.cache = null; paint(true); paintPane(); } });
    }
    function placeItem(item, name) {
      Object.assign(item, newSpot(item));
      const g = change(() => P.addGear(st.doc, item), 'Added ' + name);
      select({ gear: [g.id] }, { noSheet: true }); closeSheet();
      focusGear(g.id);
    }
    async function addItem(it, tag) {
      const k = P.KINDS[it.kind];
      const name = P.uniqueName(st.doc, tag || it.model);
      let device_id = null;
      if (k.card) {
        // big gear gets a card in the Gear Locker so the rest of LiveGenie (pages, map, IP lists) knows it
        await loadDevices();
        const ex = (DEV.list || []).find((d) => key(d.name) === key(name));
        if (ex) device_id = ex.id;
        else {
          try {
            const r = await call('POST', '/api/devices', { name, kind: it.kind, category: it.kind === 'network' || it.kind === 'computer' ? it.kind : 'audio', software: it.software || [], make: it.make || '', model: it.model, inputs: it.kind === 'receiver' ? 0 : it.kind === 'network' ? it.nports || 8 : it.nin || 0, outputs: it.kind === 'receiver' ? it.nin || 0 : it.nout || 0, ...(it.kind === 'network' || it.kind === 'computer' ? { networked: true } : {}) });
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
      const allOuts = () => st.doc.gear.filter((x) => x.id !== g.id && x.outs.length && x.kind !== 'txmic' && x.kind !== 'iemtx').map((x) => '<optgroup label="' + esc(tm(x)) + '">' + x.outs.map((p, j) => '<option value="' + x.id + ':' + j + '">' + esc(x.name + ' ' + p) + '</option>').join('') + '</optgroup>').join('');
      const allIns = () => st.doc.gear.filter((x) => x.id !== g.id && x.ins.length && x.kind !== 'bodypack').map((x) => '<optgroup label="' + esc(tm(x)) + '">' + x.ins.map((p, i) => '<option value="' + x.id + ':' + i + '"' + (ix.into.get(x.id + ':' + i) ? ' class="taken"' : '') + '>' + esc(x.name + ' ' + p) + (ix.into.get(x.id + ':' + i) ? ' (in use)' : '') + '</option>').join('') + '</optgroup>').join('');
      const mem = P.members(st.doc, g);
      const facts = [['Who uses it', g.person], ['Used for', g.use], ['Make', g.make], ['Model', g.model], ['Capsule', g.capsule], ['Frequency', g.freq && g.freq + ' MHz'], ['Mode', g.mode], ['Earphones', g.phones],
        ['In', host2 ? host2.name + (g.kind === 'txmic' ? ' ' + host2.ins[(st.doc.cables.find((c) => c.a === g.id && c.kind === 'rf') || {}).bp] : '') : ''], ['Section', g.group], ['Notes', g.notes]].filter((f) => f[1]);
      let html = '<div class="pph"><button class="ghost pback" id="pbk" title="Back">' + icon('x') + '</button><span class="pkind cat-' + k.cat + '">' + esc(k.label) + '</span>' + (host2 ? '<button class="linkbtn" id="phost">in ' + esc(host2.name) + '</button>' : '') + '</div>' +
        (ro ? '<h3 class="pname">' + esc(g.name) + '</h3><div class="pfacts">' + facts.map((f) => '<div><span>' + f[0] + '</span><b>' + esc(f[1]) + '</b></div>').join('') + '</div>' : '<div class="pform">' +
        '<label>Tag name<span class="tagrow"><input data-f="name" value="' + esc(g.name) + '"><button type="button" class="btn sm" id="pautotag" title="Suggest a tag name (RX-1, WMIC-1, PA-AMP1…)">Auto label</button></span></label>' +
        (g.device_id ? (shared(g.device_id) ? '<p class="note pdevren">One of ' + qtyOf(devCard(g.device_id)) + ' on the Gear Locker card ' + esc(devCard(g.device_id).name) + ': its tag here is for this one only.</p>' : '<label class="tog sm pdevren"><input type="checkbox" id="pdevren" checked> Rename its Gear Locker card too</label>') : '') +
        (k.fields.includes('person') ? fld('person', 'Who uses it', g.person, ' list="pppl" placeholder="Name"') + '<datalist id="pppl">' + peopleList().map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist>' : '') +
        (k.fields.includes('use') ? fld('use', 'Used for', g.use, ' placeholder="Kick, Pastor, Keys L"') : '') +
        (k.fields.includes('txtype') ? '<label>Transmitter type<select data-f="txtype"><option value="">—</option>' + TX_TYPES.map((t) => '<option' + (t === g.txtype ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' : '') +
        fld('make', g.kind === 'txmic' ? 'Transmitter make' : 'Make', g.make) + (k.fields.includes('model') ? fld('model', g.kind === 'txmic' ? 'Transmitter model' : 'Model', g.model) : '') +
        (k.fields.includes('capsule') ? fld('capmake', 'Capsule make', g.capmake) + fld('capsule', 'Capsule or mic', g.capsule, ' placeholder="Capsule model"') : '') +
        (k.fields.includes('freq') ? fld('freq', 'Frequency (MHz)', g.freq, ' inputmode="decimal" placeholder="000.000"') : '') +
        (g.kind === 'txmic' || g.kind === 'bodypack' ? '<label class="tog sm"><input type="checkbox" data-f="spare"' + (g.spare ? ' checked' : '') + '> Spare <span class="note">kept ready, not counted as in use</span></label>' : '') +
        (k.fields.includes('mode') ? '<label>Mode<select data-f="mode"' + (ro ? ' disabled' : '') + '><option' + (g.mode !== 'Mono' ? ' selected' : '') + '>Stereo</option><option' + (g.mode === 'Mono' ? ' selected' : '') + '>Mono</option></select></label>' : '') +
        (k.fields.includes('phones') ? fld('phones', 'Earphones', g.phones) : '') +
        (k.fields.includes('localstart') ? fld('localstart', 'Channel for local In 1', g.localstart || 1, ' type="number" min="1"') : '') +
        (g.kind === 'console' ? '<div class="two">' + fld('namelen', 'Channel name: most letters', g.namelen || '', ' type="number" min="0" max="64" placeholder="no limit"') + fld('colors', 'Channel colours (comma between)', (g.colors || []).join(', '), ' placeholder="Red, Green, Yellow, Blue"') + '</div>' + fld('usbch', 'USB audio channels <span class="note">(USB-B to a computer; blank if none)</span>', g.usbch || '', ' type="number" min="0" max="256" placeholder="none"') : '') +
        (k.fields.includes('mixes') ? '<label>Mixes <span class="note">(comma between)</span><textarea data-f="mixes" rows="2"' + (ro ? ' disabled' : '') + '>' + esc((g.mixes || P.DEFAULT_MIXES).join(', ')) + '</textarea></label>' : '') +
        (k.counts === 'both' ? '<div class="two">' + fld('nin', 'Inputs', g.ins.length, ' type="number" min="0" max="128"') + fld('nout', 'Outputs', g.outs.length, ' type="number" min="0" max="128"') + '</div>' : '') +
        (k.counts === 'ch' ? fld('nch', 'Channels', g.ins.length, ' type="number" min="1" max="' + (g.kind === 'amp' ? 4 : 16) + '"') : '') +
        (k.counts === 'outs' ? fld('nout', 'Outputs', g.outs.length, ' type="number" min="1" max="' + (g.kind === 'di' ? 2 : 16) + '"') : '') +
        (k.counts === 'ports' ? fld('nports', 'Ports', g.nports || 8, ' type="number" min="1" max="128"') : '') +
        fld('group', 'Section', g.group, ' placeholder="Drums, Wireless, Band IEMs" list="pgrp"') + '<datalist id="pgrp">' + [...new Set(st.doc.gear.map((x) => x.group).filter(Boolean))].map((x) => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
        '<label>Notes<textarea data-f="notes" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(g.notes || '') + '</textarea></label></div>');
      // the Gear Locker card
      const dev = g.device_id && typeof DEV !== 'undefined' && DEV.list ? DEV.list.find((d) => d.id === g.device_id) : null;
      html += '<div class="pdev">' + (dev ? '<a class="btn abtn" href="#/d/' + dev.id + '">' + icon('box') + 'Gear card: ' + esc(Tags.withModel(dev.name, dev.model)) + '</a>' : st.edit && k.card ? '<button class="btn" id="pmkdev">' + icon('box') + 'Add to the Gear Locker</button>' : '') +
        (dev && dev.files ? '<a class="btn abtn" href="#/d/' + dev.id + '">' + icon('pdf') + dev.files + ' manual' + (dev.files === 1 ? '' : 's') + '</a>' : '') +
        (!st.edit ? '<button class="btn ghost" id="prep">' + icon('alert') + 'Report a problem</button>' : '') + '</div>';
      // its photo (with its highlights), or where it sits in its rack's photo: filled in once loaded
      if (dev && typeof gearPicture === 'function') html += '<div class="pphoto hide" id="pphoto"></div>';
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
      if (SRC_KINDS.includes(g.kind)) {
        // the console channel it lands on: name and colour on the desk
        const land = P.landing(st.doc, g);
        const con = land.length ? land[0].console : st.doc.gear.find((x) => x.kind === 'console');
        const pal = con && con.colors ? con.colors : null;
        // and on through computers: over USB or Dante, their routes, and back
        const via = [];
        land.forEach((r) => { if (r.ch != null) { const t = P.forwardText(P.pcForward(st.doc, ix, r.console, r.ch)); if (t) via.push(t); } });
        g.outs.forEach((_, j) => (ix.from.get(g.id + ':' + j) || []).forEach((c) => { const b = ix.G.get(c.b); if (b && b.kind === 'interface') { const t = P.forwardText(P.pcForward(st.doc, ix, b, c.bp + 1)); via.push(b.name + ' ' + b.ins[c.bp] + (t ? ' → ' + t : ' (not on a computer yet)')); } }));
        html += '<div class="pmem"><div class="pch">On the console</div><p class="note">' + (land.length ? esc(con.name) + ' ' + land.map((r) => 'ch ' + (r.ch == null ? '(not assigned)' : r.ch)).join(', ') : via.length ? 'Not on a console channel: it goes to a computer.' : 'Not on a console channel yet.') + '</p>' +
          (via.length ? '<div class="pch">Through computers</div>' + via.map((t) => '<p class="note pvia">' + esc(t) + '</p>').join('') : '') +
          (ro ? (g.chname || g.chcolor ? '<p class="chn big">' + (g.chcolor ? '<i style="background:' + colorCss(g.chcolor) + '"></i>' : '') + esc(g.chname || '') + (g.chcolor ? ' <span class="note">' + esc(g.chcolor) + '</span>' : '') + '</p>' : '')
            : '<div class="pform two"><label>Channel name' + (con && con.namelen ? ' <span class="note">(' + con.namelen + ' letters)</span>' : '') + '<input data-f="chname" value="' + esc(g.chname || '') + '"' + (con && con.namelen ? ' maxlength="' + con.namelen + '"' : '') + ' placeholder="' + esc(cut((g.person || g.use || 'WMIC-1'), con && con.namelen ? con.namelen : 12)) + '"></label>' +
              '<label>Colour' + (pal ? '<select data-f="chcolor"><option value="">None</option>' + pal.map((c) => '<option' + (key(c) === key(g.chcolor) ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + (g.chcolor && !pal.some((c) => key(c) === key(g.chcolor)) ? '<option selected>' + esc(g.chcolor) + '</option>' : '') + '</select>' : '<input data-f="chcolor" value="' + esc(g.chcolor || '') + '" placeholder="Red">') + '</label></div>') + '</div>';
      }
      if (g.kind === 'console') {
        html += '<div class="pmem"><div class="pch">Channel names</div><p class="note">' + (g.namelen ? 'Up to ' + g.namelen + ' letters' : 'No length limit set') + ' · ' + (g.colors ? g.colors.length + ' colours: ' + esc(g.colors.join(', ')) : 'no colours set') + '</p>' +
          '<button class="btn" id="pnames">' + icon('edit') + (st.edit ? 'Channel names and colours' : 'Channel list') + '</button></div>';
        const rows = P.inputs(st.doc).filter((r) => r.console.id === g.id && r.via.kind === 'stagebox' && r.ch != null && r.used);
        if (rows.length) html += '<div class="pmem"><div class="pch">Over the link</div>' + rows.map((r) => '<div class="psk"><b>Ch ' + r.ch + '</b><span>' + esc(r.via.name + ' ' + r.port) + (r.up.source ? ' <span class="note">' + esc(r.up.source) + '</span>' : '') + '</span></div>').join('') + '</div>';
      }
      if (g.kind === 'computer' || g.kind === 'interface') html += computerHtml(g, ix, ro);
      // sockets
      const feedable = g.kind === 'console' || g.kind === 'stagebox';
      if ((g.ins.length || g.outs.length || k.link) && !host2) {
        html += '<details class="psocks"' + (g.ins.length + g.outs.length <= 12 ? ' open' : '') + '><summary>Sockets · ' + g.ins.length + ' in, ' + g.outs.length + ' out</summary>';
        if (st.edit && g.ins.length + g.outs.length > 4) html += '<label class="tog sm"><input type="checkbox" data-f="open"' + (g.open ? ' checked' : '') + '> Show every socket on the card</label>';
        if (k.link) {
          const ls = (ix.links.get(g.id) || []);
          html += '<div class="psk"><b>Link</b><span>' + (ls.map(({ c, other }) => esc((ix.G.get(other) || {}).name || '') + (c.label ? ' (' + esc(c.label) + ')' : '') + (st.edit ? ' <button class="ghost xs" data-unlink="' + c.id + '">' + icon('x') + '</button>' : '')).join(', ') || '<span class="note">not linked</span>') + '</span>' +
            (st.edit ? '<select data-link><option value="">Link to…</option>' + st.doc.gear.filter((x) => x.id !== g.id && P.KINDS[x.kind].link).map((x) => '<option value="' + x.id + '">' + esc(tm(x)) + '</option>').join('') + '</select>' : '') + '</div>';
          }
          if (hasNet(st.doc, g) && g.kind !== 'network') {
            const nc = P.netOf(st.doc, g), sw = nc && gearOf(nc.b), sws = st.doc.gear.filter((x) => x.kind === 'network' && x.id !== g.id);
            html += '<div class="psk"><b>Network</b><span>' + (sw ? esc(sw.name + (nc.port ? ' port ' + nc.port : '')) + (st.edit ? ' <button class="ghost xs" data-cut="' + nc.id + '" title="Unplug">' + icon('x') + '</button>' : '') : '<span class="note">not plugged in</span>') + '</span>' +
              (st.edit && sws.length ? '<select data-netto><option value="">Plug into…</option>' + sws.map((x) => '<option value="' + x.id + '">' + esc(tm(x)) + '</option>').join('') + '</select>' : '') + '</div>';
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
      const php = $('#pphoto', host);
      if (php) gearPicture(dev).then((pic) => {
        if (!pic || !php.isConnected) return;
        php.innerHTML = '<div class="pch">' + (pic.rack ? 'Where it is in ' + esc(pic.rack.name) : pic.room ? 'Where it is in the ' + esc(pic.room.name) : 'Photo') + '</div><div class="pphimg">' + marksView(pic.photo, pic.marks, pic.card) + '</div><div class="note">Tap the photo to see it full screen.</div>';
        php.classList.remove('hide');
        wireMarksView(php); photoLightbox(php, pic.photo, pic.marks, pic.card);
      });
      $('#pbk', host).addEventListener('click', () => { select(null); const m = host.closest('.modal'); if (m) m.remove(); });
      const ph2 = $('#phost', host); if (ph2) ph2.addEventListener('click', () => select({ gear: [host2.id] }));
      $$('[data-sel]', host).forEach((b) => b.addEventListener('click', () => select({ gear: [b.dataset.sel] })));
      const pr = $('#prep', host); if (pr) pr.addEventListener('click', () => reportProblem(g.name, { gear: g.id, device_id: g.device_id || undefined, model: g.model || undefined }));
      const pn = $('#pnames', host); if (pn) pn.addEventListener('click', () => namesDialog(live()));
      if (!st.edit) return;
      $$('[data-addm]', host).forEach((b) => b.addEventListener('click', () => {
        if (g.kind === 'iemtx') return memberDialog(live());
        // one way to add a mic: the dialog, which also makes (or picks) its Gear Locker card
        memberDialog(live(), null, Number(b.dataset.addm));
      }));
      const pc = $('#pchan', host); if (pc) pc.addEventListener('click', () => channelDialog(live()));
      if (g.kind === 'computer' || g.kind === 'interface') computerWire(host, gid);
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
          else if (f === 'spare') { if (inp.checked) g.spare = true; else delete g.spare; }
          else if (f === 'localstart') g[f] = Math.max(1, Number(v) || 1);
          else if (f === 'usbch') { if (Number(v) >= 1) g.usbch = Math.min(256, Math.floor(Number(v))); else delete g.usbch; }
          else if (f === 'namelen') { if (Number(v) >= 1) g.namelen = Math.min(64, Math.floor(Number(v))); else delete g.namelen; }
          else if (f === 'colors') { const c = v.split(',').map((x) => x.trim()).filter(Boolean); if (c.length) g.colors = c; else delete g.colors; }
          else if (f === 'nports') { g.nports = Math.max(1, Math.min(128, Math.floor(Number(v)) || 8)); st.doc.cables = st.doc.cables.filter((c) => !(c.ap === 'net' && c.b === g.id && c.port > g.nports)); }
          else if (f === 'name') g.name = v.trim() || g.name;
          else { if (v.trim()) g[f] = v.trim(); else delete g[f]; }
        }, null, !['nin', 'nout', 'nch', 'mode', 'nports', 'spare'].includes(f));
        // a new tag name goes to its Gear Locker card too (when ticked)
        if (f === 'name' && g.device_id && v.trim() && canEdit && !shared(g.device_id)) { const rn = $('#pdevren', host); if (!rn || rn.checked) putDevice(g.device_id, { name: v.trim() }).catch((e) => toast('Gear Locker card not renamed: ' + e.message, 'bad')); }
        // a wireless mic's or pack's frequency, type and capsule live on its Gear Locker card too
        if (['freq', 'txtype', 'capsule'].includes(f) && g.device_id && canEdit && !shared(g.device_id) && (g.kind === 'txmic' || g.kind === 'bodypack')) {
          const ch = { [f]: v.trim() };
          if (f === 'capsule') Object.assign(ch, { capsule_id: '', capsule_typed: true });
          putDevice(g.device_id, ch).catch((e) => toast('Gear Locker card not updated: ' + e.message, 'bad'));
        }
      }));
      const pat = $('#pautotag', host);
      if (pat) pat.addEventListener('click', () => {
        const g = live(); const inp = $('[data-f=name]', host);
        inp.value = Tags.suggest(g.kind, allNames(g.id), { person: g.kind === 'txmic' || g.kind === 'bodypack' ? g.person : '', model: g.model });
        inp.dispatchEvent(new Event('change'));
      });
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
      const nt = $('[data-netto]', host); if (nt) nt.addEventListener('change', () => { const sw = gearOf(nt.value); if (sw) netDialog(live(), sw, null); });
      const lk = $('[data-link]', host);
      if (lk) lk.addEventListener('change', () => { const b = gearOf(lk.value); if (b) picker(live(), b, { linkOnly: !(b.kind === 'console' || b.kind === 'stagebox') }); });
      const md = $('#pmkdev', host);
      if (md) md.addEventListener('click', async () => {
        try {
          await loadDevices();
          const ex = DEV.list.find((d) => key(d.name) === key(g.name));
          const id = ex ? ex.id : (await call('POST', '/api/devices', { name: g.name, kind: g.kind, category: g.kind === 'computer' || g.kind === 'network' ? g.kind : 'audio', software: g.software || [], make: g.make || '', model: g.model || '', inputs: g.ins.length, outputs: g.outs.length })).id;
          if (typeof forgetDevices === 'function') forgetDevices(); await loadDevices(true);
          change(() => { live().device_id = id; }, 'Added to the Gear Locker');
        } catch (e) { toast(e.message, 'bad'); }
      });
      $('#pdel', host).addEventListener('click', () => removeGear(gid));
      const pd = $('#pdup', host); if (pd) pd.addEventListener('click', () => duplicate(live()));
      const po = $('#pout', host); if (po) po.addEventListener('click', () => takeOut(live(), host2));
    }
    /** A mic or pack out of its receiver or transmitter; asks whether the Gear Locker should forget the pairing too. */
    function takeOut(g, host) {
      change(() => { st.doc.cables = st.doc.cables.filter((c) => !((c.a === g.id || c.b === g.id) && c.kind === 'rf')); const x = gearOf(g.id); delete x.x; delete x.y; }, g.name + ' is on its own now');
      askUnpair(g, host);
    }
    async function askUnpair(g, host) {
      const dev = devOf(g);
      if (!dev || !host || !host.device_id || dev.pair_id !== host.device_id || !canEdit) return;
      if (!await confirmBox('Unpair in the Gear Locker too?', esc(dev.name) + ' is paired with ' + esc(host.name) + ' on its Gear Locker card. Unpair it there as well?', 'Unpair')) return;
      try { await putDevice(dev.id, { pair_id: null }); toast(dev.name + ' unpaired in the Gear Locker'); } catch (e) { toast(e.message, 'bad'); }
    }
    function removeGear(id) {
      const g = gearOf(id);
      if (!g) return;
      const host0 = P.hostOf(st.doc, g);
      if (host0) setTimeout(() => askUnpair(g, host0), 300);
      const mem = P.members(st.doc, g);
      const n = st.doc.cables.filter((c) => (c.a === id || c.b === id) && c.kind !== 'rf').length;
      st.sel = [];
      change(() => P.removeGear(st.doc, id), 'Removed ' + g.name + (mem.length ? ' with its ' + mem.length + (g.kind === 'receiver' ? ' mic' : ' pack') + (mem.length === 1 ? '' : 's') : '') + (n ? ' and ' + n + ' cable' + (n === 1 ? '' : 's') : '') + '. Undo brings it back.');
      closeSheet();
    }
    /** A computer's software, its audio links (USB, Dante) and routes; an interface's link to its computer. */
    function computerHtml(g, ix, ro) {
      const chip = (t, i) => '<span class="swchip">' + esc(t) + (ro ? '' : '<button type="button" class="ghost xs" data-swx="' + i + '" title="Remove">' + icon('x') + '</button>') + '</span>';
      let h = '';
      if (g.kind === 'computer') {
        const sw = g.software || [];
        h += '<div class="pmem"><div class="pch">Software</div><div class="swchips">' + (sw.map(chip).join('') || '<span class="note">None listed yet.</span>') + '</div>' +
          (ro ? '' : '<form class="swadd" id="pswf"><input id="pswi" list="pswl" placeholder="Add: LiveProfessor, OBS…"><datalist id="pswl">' + P.SOFTWARE.filter((x) => !sw.includes(x)).map((x) => '<option value="' + esc(x) + '">').join('') + '</datalist><button class="btn sm">Add</button></form>') + '</div>';
      }
      const links = g.kind === 'computer' ? ix.audio.get(g.id) || [] : ix.audioAt.get(g.id) || [];
      h += '<div class="pmem"><div class="pch">Audio links</div>' + (links.map((L) => '<div class="psk"><b>' + esc(L.how) + '</b><span><button class="linkbtn" data-selc="' + L.c.id + '">' + esc(P.audioLabel(L)) + '</button> <span class="note">' + esc(g.kind === 'computer' ? (L.end ? '⇄ ' + L.end.name : 'Dante to: not set') : '⇄ ' + L.comp.name) + '</span></span></div>').join('') ||
        '<p class="note">' + (g.kind === 'computer' ? 'Not connected yet. Drag its ◆ link onto an audio interface or console for USB, or plug it into a switch and set its Dante channels.' : 'Not connected to a computer yet. Drag its ◆ link onto a computer.') + '</p>') + '</div>';
      if (g.kind !== 'computer') return h;
      // routes: link channels in, through an app, out on a link (or ending in the app)
      const rs = g.routes || [];
      const linkOpt = (sel, none) => (none ? '<option value="">' + none + '</option>' : '') + links.map((L) => '<option value="' + L.c.id + '"' + (sel === L.c.id ? ' selected' : '') + '>' + esc(L.how + (L.end ? ' · ' + L.end.name : '')) + '</option>').join('');
      const apps = [...new Set((g.software || []).concat(rs.map((r) => r.app).filter(Boolean)))];
      h += '<div class="pmem"><div class="pch">Routes</div>';
      if (ro || !links.length) h += rs.map((r) => '<div class="psk pfull"><span>' + esc(P.routeText(ix, r)) + '</span></div>').join('') || '<p class="note">' + (links.length ? 'No routes: audio to it ends here (recorded or streamed).' : 'Connect it first, then add routes.') + '</p>';
      else {
        h += rs.map((r, i) => '<div class="proute" data-r="' + i + '">' +
          '<div class="prr"><span class="note">From</span><select data-rf="fc">' + linkOpt(r.fc) + '</select></div>' +
          '<div class="prr"><span class="note">Channels</span><input data-rf="fs" type="number" min="1" value="' + r.fs + '"><span>–</span><input data-rf="fe" type="number" min="1" value="' + r.fe + '"></div>' +
          '<div class="prr"><span class="note">Through</span><input data-rf="app" list="pswapps" value="' + esc(r.app || '') + '" placeholder="App"></div>' +
          '<div class="prr"><span class="note">To</span><select data-rf="tc">' + linkOpt(r.tc || '', 'Ends here (recorded / streamed)') + '</select></div>' +
          '<div class="prr">' + (r.tc ? '<span class="note">Channels</span><input data-rf="ts" type="number" min="1" value="' + (r.ts || 1) + '"><span class="note">–' + ((r.ts || 1) + r.fe - r.fs) + '</span>' : '') +
          '<span class="grow"></span><button type="button" class="ghost xs" data-rx="' + i + '" title="Remove route">' + icon('trash') + 'Remove</button></div>' +
          '<div class="note prt">' + esc(P.routeText(ix, r)) + '</div></div>').join('') +
          '<datalist id="pswapps">' + apps.map((x) => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
          '<button class="btn" id="praddr">' + icon('plus') + 'Add a route</button>';
      }
      h += '</div>';
      return h;
    }
    function computerWire(host, gid) {
      $$('[data-selc]', host).forEach((b) => b.addEventListener('click', () => select({ cable: b.dataset.selc })));
      if (!st.edit) return;
      const g = () => gearOf(gid);
      // the software list lives on its Gear Locker card too
      const syncSw = () => { const x = g(); if (x && x.device_id && canEdit && !shared(x.device_id)) putDevice(x.device_id, { software: x.software || [] }).catch((e) => toast('Gear Locker card not updated: ' + e.message, 'bad')); };
      $$('[data-swx]', host).forEach((b) => b.addEventListener('click', () => { change(() => { const x = g(); x.software.splice(Number(b.dataset.swx), 1); if (!x.software.length) delete x.software; }); syncSw(); }));
      const f = $('#pswf', host);
      if (f) f.addEventListener('submit', (e) => {
        e.preventDefault(); const v = $('#pswi', host).value.trim(); if (!v) return;
        change(() => { const x = g(); x.software = [...new Set((x.software || []).concat(v))]; }, v + ' added'); syncSw();
      });
      const add = $('#praddr', host);
      if (add) add.addEventListener('click', () => change(() => {
        const x = g(), ix = P.index(st.doc), L = (ix.audio.get(gid) || [])[0];
        if (!L) return;
        x.routes = (x.routes || []).concat({ fc: L.c.id, fs: 1, fe: Math.min(2, Math.max(1, L.chin)), app: (x.software || [])[0] || '', tc: L.c.id, ts: 1 });
      }));
      $$('[data-rx]', host).forEach((b) => b.addEventListener('click', () => change(() => { const x = g(); x.routes.splice(Number(b.dataset.rx), 1); if (!x.routes.length) delete x.routes; })));
      $$('.proute', host).forEach((row) => $$('[data-rf]', row).forEach((inp) => inp.addEventListener('change', () => change(() => {
        const x = g(), r = x.routes[Number(row.dataset.r)]; if (!r) return;
        const k = inp.dataset.rf, v = inp.value.trim();
        if (k === 'fc') r.fc = v;
        else if (k === 'tc') { if (v) { r.tc = v; r.ts = r.ts || 1; } else { delete r.tc; delete r.ts; } }
        else if (k === 'app') { if (v) r.app = v; else delete r.app; if (v && !(x.software || []).includes(v)) { x.software = (x.software || []).concat(v); setTimeout(syncSw, 0); } }
        else { const n = Math.max(1, Math.floor(Number(v)) || 1); r[k] = n; if (k === 'fs' && r.fe < n) r.fe = n; if (k === 'fe' && r.fs > n) r.fs = n; }
      }))));
    }
    function cablePane(host, c) {
      const a = gearOf(c.a), b = gearOf(c.b);
      const ro = !st.edit;
      const net = c.ap === 'net', link = c.ap === 'link';
      const usbable = link && P.usbOk(a, 'link', b, 'link'), usb = c.kind === 'usb';
      const kinds = Object.entries(KIND_STYLE).filter(([k]) => net ? k === 'net' : link ? (k === 'link' || k === 'dante' || (k === 'usb' && usbable)) : (k !== 'net' && k !== 'link' && k !== 'usb'));
      // a computer's audio on this cable: USB, a Dante link, or Dante over its network cable (a virtual soundcard)
      const comp = a.kind === 'computer' ? a : b.kind === 'computer' ? b : null;
      const audio = comp && (usb || (link && c.kind === 'dante') || (net && a.kind === 'computer'));
      const ixa = P.index(st.doc), AL = ixa.audioBy.get(c.id);
      const endG = AL ? AL.end : comp && !net ? (comp === a ? b : a) : null;
      const num = (f, label, val, ph) => '<label>' + label + '<input data-c="' + f + '" type="number" min="' + (f === 'chin' || f === 'chout' ? 0 : 1) + '" max="512" value="' + (val == null ? '' : val) + '"' + (ph ? ' placeholder="' + ph + '"' : '') + (ro ? ' disabled' : '') + '></label>';
      let audioHtml = '';
      if (audio) {
        audioHtml = '<div class="pch">' + (usb ? 'Audio over ' + (c.usbtype || 'USB') : 'Dante channels') + '</div>' +
          '<div class="two">' + num('chin', 'Channels to ' + esc(comp.name), c.chin != null ? c.chin : usb ? 2 : '', usb ? '' : '0') + num('chout', 'Channels from ' + esc(comp.name), c.chout != null ? c.chout : usb ? 2 : '', usb ? '' : '0') + '</div>' +
          (usb ? '<label>Connection<select data-c="usbtype"' + (ro ? ' disabled' : '') + '>' + P.USB_TYPES.map((t) => '<option' + ((c.usbtype || 'USB') === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' : '');
        if (net) {
          const cands = st.doc.gear.filter((x) => x.kind === 'console' || x.kind === 'stagebox');
          const auto = P.danteCandidates(st.doc, ixa.G, ixa.links, c, comp);
          audioHtml += '<label>Dante to<select data-c="dto"' + (ro ? ' disabled' : '') + '><option value="">' + (auto.length === 1 || auto.filter((x) => x.kind === 'console').length === 1 ? 'On this network: ' + esc((auto.find((x) => x.kind === 'console') || auto[0]).name) : 'Pick one…') + '</option>' + cands.map((x) => '<option value="' + x.id + '"' + (c.dto === x.id ? ' selected' : '') + '>' + esc(tm(x)) + '</option>').join('') + '</select></label>';
        }
        if (endG && endG.kind === 'console') audioHtml += '<div class="two">' + num('snd', (AL ? AL.how : 'USB') + ' 1 carries channel', c.snd || 1) + num('ret', 'Returns land on channel', c.ret, 'not set') + '</div><p class="note">Channels back from ' + esc(comp.name) + ' land on ' + esc(endG.name) + ' channels from this one.</p>';
        else if (endG) audioHtml += '<p class="note">' + (AL ? AL.how : 'USB') + ' 1, 2… to ' + esc(comp.name) + ' are ' + esc(endG.name) + ' In 1, 2…; channels back play on its Out 1, 2…</p>';
      }
      host.innerHTML = '<div class="pph"><button class="ghost pback" id="pbk">' + icon('x') + '</button><span class="pkind">' + (usb ? (c.usbtype || 'USB') + ' cable' : link ? 'Link' : net ? 'Network cable' : 'Cable') + '</span></div>' +
        '<p class="pcab"><b>' + esc(tm(a) + (link || net ? (net ? ' · network' : '') : ' ' + a.outs[c.ap])) + '</b><br>→ <b>' + esc(tm(b) + (link ? '' : net ? (c.port ? ' · port ' + c.port : '') : ' ' + b.ins[c.bp])) + '</b></p><div class="pform">' +
        (kinds.length > 1 ? '<label>Type<select data-c="kind"' + (ro ? ' disabled' : '') + '>' + kinds.map(([k, v]) => '<option value="' + k + '"' + (c.kind === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label>' : '') +
        (net ? '<label>Switch port<select data-c="port"' + (ro ? ' disabled' : '') + '><option value="">Not set</option>' + Array.from({ length: b.nports || 8 }, (_, i) => i + 1).map((n) => { const o = st.doc.cables.find((x) => x.ap === 'net' && x.b === b.id && x.port === n && x.id !== c.id); return '<option value="' + n + '"' + (c.port === n ? ' selected' : '') + (o ? ' disabled' : '') + '>Port ' + n + (o ? ' · ' + esc(gearOf(o.a).name) : '') + '</option>'; }).join('') + '</select></label>' : '') +
        (link && !usb ? '<label>Link name (SLink, AES50, Dante)<input data-c="label" value="' + esc(c.label || '') + '"' + (ro ? ' disabled' : '') + '></label>'
          : '<label>Tag name<span class="tagrow"><input data-c="label" value="' + esc(c.label || '') + '" placeholder="C-001"' + (ro ? ' disabled' : '') + '>' + (ro ? '' : '<button type="button" class="btn sm" id="pcauto" title="The next free cable number">Auto label</button>') + '</span></label>') +
        '<label>Length<input data-c="length" value="' + esc(c.length || '') + '" placeholder="25 ft"' + (ro ? ' disabled' : '') + '></label>' +
        '<label>Notes<textarea data-c="notes" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(c.notes || '') + '</textarea></label>' + audioHtml + '</div>' +
        (comp && audio ? '<button class="btn" id="pcomp">' + icon('list') + 'Routes on ' + esc(comp.name) + '</button>' : '') +
        (st.edit && link && (a.kind === 'stagebox' || b.kind === 'stagebox') ? '<button class="btn" id="pchan2">' + icon('list') + 'Assign console channels</button>' : '') +
        (st.edit ? '<div class="pacts"><span class="grow"></span><button class="ghost danger" id="pcdel">' + icon('trash') + 'Remove ' + (link ? 'link' : 'cable') + '</button></div>' : '');
      $('#pbk', host).addEventListener('click', () => { select(null); const m = host.closest('.modal'); if (m) m.remove(); });
      const pcm = $('#pcomp', host); if (pcm) pcm.addEventListener('click', () => select({ gear: [comp.id] }));
      if (!st.edit) return;
      const pc = $('#pchan2', host); if (pc) pc.addEventListener('click', () => channelDialog(a.kind === 'stagebox' ? a : b));
      $$('[data-c]', host).forEach((inp) => inp.addEventListener('change', () => change(() => {
        const cc = st.doc.cables.find((x) => x.id === c.id); const f = inp.dataset.c;
        if (f === 'port') { if (Number(inp.value)) cc.port = Number(inp.value); else delete cc.port; return; }
        if (['chin', 'chout', 'ret', 'snd'].includes(f)) { const n = Math.floor(Number(inp.value)); if (inp.value.trim() !== '' && n >= (f === 'chin' || f === 'chout' ? 0 : 1) && !(f === 'snd' && n === 1)) cc[f] = Math.min(512, n); else delete cc[f]; return; }
        if (inp.value.trim()) cc[f] = inp.value.trim(); else delete cc[f];
      }, null, !['kind', 'dto', 'usbtype'].includes(inp.dataset.c))));
      const au = $('#pcauto', host);
      if (au) au.addEventListener('click', () => { const inp = $('[data-c=label]', host); inp.value = Tags.cableName(cableInfos(st.doc).get(c.id) || { type: 'out' }, st.doc.cables.filter((x) => x.id !== c.id).map((x) => x.label || '')); inp.dispatchEvent(new Event('change')); });
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
    $('#pfitb').addEventListener('click', () => fit());
    const selT = $('#pselt');
    selT.addEventListener('click', () => { st.selTool = !st.selTool; selT.classList.toggle('on', st.selTool); selT.setAttribute('aria-pressed', String(st.selTool)); svg.classList.toggle('selecting', st.selTool); toast(st.selTool ? 'Drag a box around the cards to pick them' : 'Back to moving around'); });
    $('#plabels').addEventListener('click', autoLabelDialog);
    $('#paddb').addEventListener('click', () => { if (!wide()) return sheet(true); st.adding = !st.adding || !!st.sel.length; select(null); });
    $$('[data-al]').forEach((b) => b.addEventListener('click', () => align(b.dataset.al)));
    const pe = $('#pedit');
    const setEdit = (on) => {
      st.edit = on;
      if (!on && st.selTool) { st.selTool = false; selT.classList.remove('on'); selT.setAttribute('aria-pressed', 'false'); svg.classList.remove('selecting'); }
      document.body.classList.toggle('patchedit', on);
      if (pe) { pe.classList.toggle('primary', on); pe.querySelector('span').textContent = on ? 'Done' : 'Edit'; }
      $('#ptools').classList.toggle('hide', !on);
      $('#padd').classList.toggle('hide', !on);
      paintTitle(); paint(true); paintPane(); paintAlign();
    };
    if (pe) pe.addEventListener('click', async () => {
      const leaving = st.edit;
      setEdit(!st.edit);
      if (leaving) { await flush(); if (st.draft) publishDialog(); }
    });
    $('#pun').addEventListener('click', undo); $('#pre').addEventListener('click', redo);
    $('#padd').addEventListener('click', () => sheet(true));
    // ---------- the PDF: a report with a title page, contents, the drawing (landscape) and the lists ----------
    /** The report as HTML. The drawing itself is the live SVG, moved into its page while printing. */
    /** A cable style's colour and dashes, read from the drawing's own CSS (the report's key sits outside the drawing). */
    function lineStyle(k) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'pe pe-' + k); g.innerHTML = '<path class="ln" d="M0 0h1"/>';
      vp.appendChild(g);
      const cs = getComputedStyle(g.firstChild);
      const out = 'stroke:' + cs.stroke + ';stroke-width:' + (parseFloat(cs.strokeWidth) || 2) + 'px;stroke-dasharray:' + (cs.strokeDasharray || 'none');
      g.remove();
      return out;
    }
    function reportDoc() {
      const doc = st.doc, org = (S.state && S.state.org) || {}, me = (S.state && S.state.user && S.state.user.name) || '';
      const tm = (g) => (g ? (typeof Tags !== 'undefined' ? Tags.withModel(g.name, g.model) : g.name) : '');
      const today = new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
      const rev = st.rev ? 'Revision ' + st.rev + (st.draft ? ' (draft)' : '') : 'Draft (not published yet)';
      const T = (heads, rows, empty) => rows.length ? '<table class="rt"><thead><tr>' + heads.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + (c == null || c === '' ? '<span class="rd">—</span>' : c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>' : '<p class="rnone">' + empty + '</p>';
      const sections = [];
      const add = (id, title, html, cls) => sections.push({ id, title, html, cls });
      const G = new Map(doc.gear.map((g) => [g.id, g]));
      const net = (g) => {
        const dev = devOf(g);
        const c = doc.cables.find((x) => x.ap === 'net' && x.a === g.id);
        const sw = c ? G.get(c.b) : dev && dev.uplink_id ? (DEV.list || []).find((d) => d.id === dev.uplink_id) : null;
        const port = c ? c.port : dev && dev.uplink_port;
        const ips = dev ? (dev.ips || []) : [];
        if (!ips.length && !sw) return '';
        return (ips.length ? '<span class="mono">' + ips.map(esc).join('<br>') + '</span>' : '') + (sw ? '<div class="rs">into ' + esc(sw.name) + (port ? ' port ' + esc(port) : '') + '</div>' : '');
      };
      // microphones
      const spareTag = (g) => (g.spare ? ' <span class="rspare">Spare</span>' : '');
      const dotOf = (f) => { const n = P.mhz(f); return n == null ? '' : '<i class="rband" style="background:' + P.bandColor(n) + '"></i>'; };
      const wl = P.wireless(doc).sort((p, q) => !!p.tx.spare - !!q.tx.spare).map((r) => [
        '<b>' + esc(r.tx.name) + '</b>' + spareTag(r.tx), esc(r.tx.model || ''), r.rx ? esc(tm(r.rx)) + ' · ' + esc(r.rxch) : '', esc(r.tx.capsule || ''), r.tx.freq ? dotOf(r.tx.freq) + esc(r.tx.freq) + ' MHz' : '',
        esc([r.tx.person, r.tx.use].filter(Boolean).join(' · ')), r.land && r.land.console ? esc(r.land.console.name) + ' ch ' + r.land.ch + '<div class="rs">' + esc(r.land.via) + '</div>' : r.land ? esc(r.land.via) : '']);
      const wired = doc.gear.filter((g) => ['mic', 'di', 'source'].includes(g.kind)).map((g) => {
        const l = P.landing(doc, g);
        return ['<b>' + esc(g.name) + '</b>', esc(g.model || P.KINDS[g.kind].label), esc([g.person, g.use].filter(Boolean).join(' · ')),
          esc(l.map((r) => r.via.kind === 'console' ? r.port : r.via.name + ' ' + r.port).join(', ')), esc(l.map((r) => (r.console ? r.console.name + ' ' : '') + (r.ch == null ? '' : 'ch ' + r.ch)).join(', ')), esc(g.chname || '')];
      });
      // receivers are listed here (not again under Equipment), with where they live and their network
      const rxRows = doc.gear.filter((g) => g.kind === 'receiver').map((g) => { const dev = devOf(g), used = P.members(doc, g).filter((m) => !m.g.spare).length;
        return ['<b>' + esc(g.name) + '</b>', esc([g.make || (dev && dev.make), g.model || (dev && dev.model)].filter(Boolean).join(' ')), esc((dev && dev.location) || ''), used + ' of ' + g.ins.length, net(g)]; });
      add('mics', 'Microphones', (rxRows.length ? '<h3>Wireless receivers</h3>' + T(['Tag', 'Make and model', 'Location', 'Channels in use', 'Network'], rxRows, '') : '') + '<h3>Wireless mics</h3>' + T(['Tag', 'Model', 'Receiver', 'Capsule', 'Frequency', 'Person / use', 'Console input'], wl, 'No wireless mics.') +
        '<h3>Wired mics, DIs and sources</h3>' + T(['Tag', 'Model', 'Person / use', 'Stage box input', 'Console channel', 'Channel name'], wired, 'No wired mics or DIs.'));
      // in-ears
      const ie = P.inears(doc).map((r) => {
        const packs = (P.members(doc, r.tx).map((m) => m.g).concat(r.packs || [])).filter((g, k, a) => g && a.indexOf(g) === k);
        const dev = devOf(r.tx);
        return ['<b>' + esc(tm(r.tx)) + '</b>' + (dev && dev.location ? '<div class="rs">' + esc(dev.location) + '</div>' : ''), esc(r.tx.mode || ''), r.tx.freq ? dotOf(r.tx.freq) + esc(r.tx.freq) + ' MHz' : '', esc(r.mix || ''), esc(r.feeds.filter(Boolean).map((x) => x.from.name + ' ' + x.socket).join(', ')),
          packs.map((g) => esc([tm(g), g.person || g.use, g.freq && g.freq + ' MHz'].filter(Boolean).join(' · ')) + spareTag(g)).join('<br>'), net(r.tx)];
      });
      if (ie.length) add('iem', 'In-ear monitors', T(['Transmitter', 'Mode', 'Frequency', 'Mix', 'Fed from', 'Packs', 'Network'], ie, ''));
      // equipment by group
      const ix = P.index(doc);
      const names = (ids) => [...new Set(ids)].map((id) => G.get(id)).filter(Boolean).map((g) => esc(g.name));
      const conn = (g) => {
        const ins = doc.cables.filter((c) => c.b === g.id && c.kind !== 'rf' && c.ap !== 'net').map((c) => c.a);
        const outs = doc.cables.filter((c) => c.a === g.id && c.kind !== 'rf' && c.ap !== 'net').map((c) => c.b);
        const parts = [];
        if (ins.length) parts.push('From ' + names(ins).join(', '));
        if (outs.length) parts.push('To ' + names(outs).join(', '));
        const m = P.members(doc, g); if (m.length) parts.push(m.length + (g.kind === 'receiver' ? ' wireless mic' : ' pack') + (m.length === 1 ? '' : 's'));
        return parts.join('<br>');
      };
      // wireless receivers and in-ear transmitters have their own sections above, so they are not listed again here
      const GROUPS = [['Console', ['console']], ['Stage I/O', ['stagebox']], ['Headphone amps', ['headamp']], ['Processing', ['processor']], ['Amplifiers', ['amp']], ['Speakers and monitors', ['speaker', 'wedge']], ['Network', ['network']], ['Other', ['other']]];
      const eq = GROUPS.map(([title, kinds]) => {
        const list = doc.gear.filter((g) => kinds.includes(g.kind));
        if (!list.length) return '';
        // units of one Gear Locker card (a card with a quantity) are one row: SPK-1, SPK-2 · Qty 2
        const rows = [], byDev = new Map();
        list.forEach((g) => { if (g.device_id) { if (!byDev.has(g.device_id)) { byDev.set(g.device_id, []); rows.push(byDev.get(g.device_id)); } byDev.get(g.device_id).push(g); } else rows.push([g]); });
        return '<h3>' + title + '</h3>' + T(['Tag', 'Qty', 'Make', 'Model', 'Location', 'Connections', 'Network'], rows.map((gs) => { const g = gs[0], dev = devOf(g);
          return [gs.map((x) => '<b>' + esc(x.name) + '</b>').join(', '), String(gs.length), esc(g.make || (dev && dev.make) || ''), esc(g.model || (dev && dev.model) || ''), esc((dev && dev.location) || ''), gs.map((x) => conn(x)).filter(Boolean).join('<br>'), gs.map((x) => net(x)).filter(Boolean).join('<br>')]; }), '');
      }).join('');
      add('gear', 'Equipment', eq || '<p class="rnone">No equipment yet.</p>');
      // computers and audio interfaces: software, audio links with channel counts, routes
      const pcs = P.computers(doc);
      if (pcs.length) {
        const rows = pcs.map((x) => { const dev = devOf(x.g);
          return ['<b>' + esc(tm(x.g)) + '</b><div class="rs">' + esc(P.KINDS[x.g.kind].label) + ((dev && dev.location) ? ' · ' + esc(dev.location) : '') + '</div>', esc(x.software.join(', ')),
            x.links.map((l) => esc(l.text) + ' <span class="rs">⇄ ' + esc(l.to || 'Dante: not set') + '</span>').join('<br>'), x.routes.map(esc).join('<br>') || (x.g.kind === 'computer' && x.links.length ? '<span class="rs">No routes: audio ends here</span>' : ''), net(x.g)]; });
        add('pcs', 'Computers and interfaces', T(['Tag', 'Software', 'Audio links', 'Routes', 'Network'], rows, ''));
      }
      // cables
      const cl = P.cableList(doc).filter((r) => r.a && r.b && r.c.kind !== 'rf').sort((p, q) => String(p.c.label || '~').localeCompare(String(q.c.label || '~'), undefined, { numeric: true }))
        .map((r) => ['<b>' + esc(r.c.label || '') + '</b>', esc(r.from), esc(r.to), esc(KIND_STYLE[r.c.kind] || r.c.kind || ''), esc(r.c.length || '')]);
      add('cables', 'Cables', T(['Name', 'From', 'To', 'Type', 'Length'], cl, 'No cables.'));
      // things to check (frequencies first)
      const ck = P.checks(doc).concat(qtyChecks(doc)).sort((p, q) => !!q.rf - !!p.rf || ({ bad: 0, warn: 1, note: 2 }[p.level] - { bad: 0, warn: 1, note: 2 }[q.level]));
      if (ck.length) add('checks', 'Things to check', T(['', 'What'], ck.map((c) => ['<span class="rlv ' + c.level + '">' + (c.level === 'bad' ? 'Clash' : c.level === 'warn' ? 'Check' : 'Note') + '</span>', esc(c.text)]), ''));
      // the key for the drawing page
      const cats = Object.entries(P.CATS).filter(([k]) => D.key.cats.includes(k));
      const kinds = Object.entries(KIND_STYLE).filter(([k]) => D.key.kinds.includes(k));
      const key = cats.length || kinds.length || D.key.wireless ? '<div class="rkey">' + cats.map(([, v]) => '<span><i style="background:' + v.color + '"></i>' + esc(v.label) + '</span>').join('') +
        kinds.map(([k, v]) => '<span><svg width="30" height="10"><path d="M1 5h27" fill="none" style="' + lineStyle(k) + '"/></svg>' + esc(v) + '</span>').join('') +
        (D.key.wireless ? '<span><svg width="30" height="12"><rect x="1" y="1" width="28" height="10" rx="3" fill="none" stroke="#8a95a3" stroke-dasharray="3 2"/><path d="M6 6h18" stroke="#c0398b" stroke-dasharray="3 2"/></svg>Wireless system · RF</span>' : '') + '</div>' : '';
      const all = [{ id: 'drawing', title: 'Signal flow drawing' }].concat(sections);
      const head = [org.name, doc.title || 'Stage patch', st.rev ? 'Rev ' + st.rev + (st.draft ? ' draft' : '') : 'Draft'].filter(Boolean).join(' · ');
      const css = '@page { @top-left { content: "' + head.replace(/["\\]/g, '') + '"; font: 9px system-ui, sans-serif; color: #4d5866; } @bottom-left { content: "Printed ' + today.replace(/["\\]/g, '') + '"; font: 9px system-ui, sans-serif; color: #4d5866; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9px system-ui, sans-serif; color: #4d5866; } }' +
        '@page :first { @top-left { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }';
      return '<style>' + css + '</style>' +
        '<section class="rcover">' + (org.logo ? '<img class="rlogo" src="/api/org/logo" alt="">' : '<img class="rlogo" src="/icons/livegenie-mark.svg" alt="">') +
          (org.name ? '<div class="rorg">' + esc(org.name) + '</div>' : '') + '<div class="rkick">Stage patch</div><h1>' + esc(doc.title || 'Stage patch') + '</h1>' + (doc.subtitle ? '<p class="rsub">' + esc(doc.subtitle) + '</p>' : '') +
          '<dl class="rmeta"><dt>Revision</dt><dd>' + esc(rev) + '</dd><dt>Date</dt><dd>' + esc(today) + '</dd>' + (me ? '<dt>Prepared by</dt><dd>' + esc(me) + '</dd>' : '') + (st.revNote ? '<dt>Notes</dt><dd>' + esc(st.revNote) + '</dd>' : '') +
          '<dt>Contents</dt><dd>' + doc.gear.length + ' pieces of gear · ' + doc.cables.filter((c) => c.kind !== 'rf').length + ' cables</dd></dl>' +
          '<div class="rfoot">Made with LiveGenie</div></section>' +
        '<section class="rtoc"><h2>Contents</h2><ol>' + all.map((x) => '<li><span>' + esc(x.title) + '</span></li>').join('') + '</ol></section>' +
        '<section class="rdraw"><h2>1. Signal flow drawing</h2><div class="rsvg" id="rsvg"></div>' + key + '</section>' +
        sections.map((x, k) => '<section class="rsec"><h2>' + (k + 2) + '. ' + esc(x.title) + '</h2>' + x.html + '</section>').join('');
    }
    // The PDF: a print-only report built from a still copy of the drawing (the live one is never moved or refitted,
    // which kept phones busy redrawing while the print sheet was open). Tapping PDF again while one is open does nothing.
    function dropReport() {
      const old = document.getElementById('preport'); if (old) old.remove();
      document.body.classList.remove('printreport');
      st.printing = false;
    }
    $('#ppdf').addEventListener('click', async () => {
      if (st.printing) return;
      st.printing = true;
      try {
        select(null);
        dropReport(); st.printing = true;
        // the note of the published revision, for the title page
        if (st.rev && st.revNote === undefined) { try { const v = (await get('/api/patch/versions')).versions.find((x) => x.rev === st.rev); st.revNote = v ? v.note || '' : ''; } catch (e) { st.revNote = ''; } }
        const box = document.createElement('div');
        box.id = 'preport'; box.innerHTML = reportDoc();
        // a still copy of the drawing, framed to the whole of it, without the grid, handles and hit areas
        const b = D.bbox, copy = svg.cloneNode(true);
        copy.classList.add('printing');   // keeps id psvg: the drawing's look hangs on it (the live one comes first in the page)
        copy.setAttribute('viewBox', b.x0 + ' ' + b.y0 + ' ' + (b.x1 - b.x0) + ' ' + (b.y1 - b.y0));
        copy.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        const cvp = copy.querySelector('#pvp'); if (cvp) { cvp.removeAttribute('transform'); cvp.removeAttribute('id'); }
        copy.querySelectorAll('[id]').forEach((el) => { if (!/^(ar|mk|pat|grad|clip)/i.test(el.id)) el.removeAttribute('id'); });
        copy.querySelectorAll('.pgridbg, .hand, .mkh, #ptmp, #pmq, .ptmp, .pmq, .cadd, .pguide').forEach((el) => el.remove());
        $('#rsvg', box).appendChild(copy);
        document.body.appendChild(box); document.body.classList.add('printreport');
        const started = Date.now();
        // done printing: tidy up. Some phones say "done" the moment the print sheet opens, so that early signal is ignored;
        // the copy is hidden on screen anyway and goes when you leave the page or make the next PDF.
        const after = () => { if (Date.now() - started < 2500) return; window.removeEventListener('afterprint', after); dropReport(); };
        window.addEventListener('afterprint', after);
        window.addEventListener('hashchange', function gone() { window.removeEventListener('hashchange', gone); window.removeEventListener('afterprint', after); dropReport(); });
        exportPdf((st.doc.title || 'Stage Patch') + (st.rev ? '' : ' Draft'), st.rev ? st.rev + (st.draft ? ' draft' : '') : '');
      } catch (e) { dropReport(); toast('Could not make the PDF: ' + e.message, 'bad'); return; }
      // the button works again shortly after the print sheet opens (the report stays until it is replaced or you leave)
      setTimeout(() => { st.printing = false; }, 3000);
    });
    const ph = $('#phist');
    if (ph) ph.addEventListener('click', async () => {
      await flush();
      const v = (await get('/api/patch/versions')).versions;
      const pub = v.filter((x) => x.kind !== 'auto');
      const top = v[0] && v[0].kind === 'auto' ? v[0] : null;
      const autos = v.filter((x) => x.kind === 'auto' && x !== top);
      const who = (x) => esc(ago(x.saved_at)) + (x.saved_by ? ' · ' + esc(x.saved_by) : '');
      const row = (x, title, cur) => '<div class="rrow' + (cur ? ' cur' : '') + '"><div class="rt"><b>' + title + '</b><span>' + (x.note && x.kind !== 'auto' ? esc(x.note) + ' · ' : x.note ? esc(x.note) + ' · ' : '') + who(x) + '</span></div>' +
        (cur ? '<span class="chip ok">Current</span>' : '<button class="btn sm" data-rv="' + x.version + '" data-rl="' + esc(x.rev ? 'Rev ' + x.rev : 'that save') + '">' + icon('restore') + 'Restore</button>') + '</div>';
      const curV = st.version;
      modal('<h3>Stage patch revisions</h3><p>Published revisions are kept for good. Changes in between are a draft until you publish them (tap Done after editing). Restoring brings one back as a new draft; nothing is lost.</p><div class="rlist">' +
        (top ? row(top, 'Draft' + (st.rev ? ' after Rev ' + esc(st.rev) : ''), top.version === curV) : '') +
        (pub.length ? pub.map((x) => row(x, 'Rev ' + esc(x.rev), x.version === curV)).join('') : '<div class="note" style="padding:8px 2px">Nothing published yet.</div>') +
        (autos.length ? '<details class="rautos"><summary>Show ' + autos.length + ' autosave' + (autos.length === 1 ? '' : 's') + '</summary>' + autos.map((x) => row(x, 'Autosave', x.version === curV)).join('') + '</details>' : '') +
        '</div><div class="acts">' + (st.draft ? '<button id="rpub">Publish…</button>' : '') + '<button class="primary" data-close>Close</button></div>', (w, close) => {
        const pb = $('#rpub', w); if (pb) pb.addEventListener('click', () => { close(); publishDialog(); });
        $$('[data-rv]', w).forEach((b) => b.addEventListener('click', async () => {
          try { const r = await call('POST', '/api/patch/versions/' + b.dataset.rv + '/restore'); st.doc = r.doc; st.version = r.version; st.draft = true; st.undo = []; st.redo = []; st.cache = null; close(); paint(true); paintPane(); paintTitle(); toast('Restored ' + b.dataset.rl + ' as a new draft', 'ok'); }
          catch (e) { toast(e.message, 'bad'); }
        }));
      });
    });

    // the team's names, for tagging who uses a mic or pack
    if (canEdit && !S.people) get('/api/users').then((r) => { S.people = (r.users || []).map((u) => u.name); }).catch(() => { S.people = []; });

    paintTitle();
    if (await syncFromLocker()) st.cache = null;
    paint(false);
    paintPane();
    if (qs && qs.get('g')) {
      // from "Used on › Stage patch": on a phone, zoom in on that gear and open its details; on a computer, select it
      const narrow = window.innerWidth < 700;
      if (narrow) zoomTo(qs.get('g'));
      select({ gear: [qs.get('g')] }, narrow ? {} : { noSheet: true });
      if (!narrow) focusGear(qs.get('g'));
    }
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
