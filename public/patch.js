/*
 * The stage patch: one drawing for the whole system, read left to right like a signal-flow poster.
 *   Columns: Sources → Stage I/O → Network → Mix → Amps · TX → Speakers · IEMs.
 *   Overview: gear as cards (a group like "Drums" folds into one card), parallel cables bundled.
 *   Sockets: every card opens up to its numbered sockets and each cable runs socket to socket.
 * Click any card or cable and its whole signal path lights up. Editors add gear from the right pane
 * (their device library, or the catalog) and drag cables between sockets. The input, output, wireless,
 * in-ear and cable lists, and the PDF, are all made from the drawing.
 * Uses helpers from app.js (get, call, esc, icon, can, modal, toast, S) and devices.js (DEV, loadDevices).
 */
'use strict';

const PatchView = (() => {
  const P = PatchCore;
  const CW = 198, CWS = 236, GX = 72, NETW = 70, TOP = 62, GAP = 10, OVH = 56, HEAD = 44, ROW = 17;
  const KIND_STYLE = { xlr: 'Analog · XLR', link: 'Digital snake', dante: 'Dante · Cat6', aes: 'AES3', speaker: 'Speaker · NL4', wiem: 'Wired IEM', rf: 'Wireless · RF' };
  const SHORT_MAKE = { 'allen & heath': 'A&H', 'phenyx pro': 'Phenyx', sennheiser: 'Sennheiser' };
  const makeTag = (m) => SHORT_MAKE[String(m || '').toLowerCase()] || m;
  const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; };
  const key = (v) => String(v || '').trim().toLowerCase();

  // ================= layout =================
  function layout(doc, mode) {
    const ix = P.index(doc);
    const usedOut = (g) => g.outs.some((_, j) => (ix.from.get(g.id + ':' + j) || []).length || (g.feeds || {})[j]);
    const sockets = mode === 'sockets';
    const cards = [];
    const gear = doc.gear.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    // receivers get their own column when they plug into a stage box; otherwise they are stage I/O themselves
    const rxToBox = doc.gear.some((g) => g.kind === 'receiver' && g.outs.some((_, j) => (ix.from.get(g.id + ':' + j) || []).some((c) => { const b = ix.G.get(c.b); return b && b.kind === 'stagebox'; })));
    const colFor = (g) => (g.col != null ? g.col : g.kind === 'receiver' && !rxToBox ? 2 : P.colOf(g));
    const PRI = { console: 0, computer: 2 };
    for (const g of gear) {
      if (g.kind === 'network') continue;
      if (g.kind === 'stagebox') {
        cards.push({ id: g.id + ':in', g, side: 'in', col: colFor(g) });
        if (sockets || usedOut(g)) cards.push({ id: g.id + ':out', g, side: 'out', col: 4, pri: 1 });   // its outputs sit under the console that feeds them
      } else cards.push({ id: g.id + ':all', g, side: 'all', col: colFor(g), pri: PRI[g.kind] != null ? PRI[g.kind] : 2 });
    }
    cards.sort((p, q) => (p.col === 4 && q.col === 4 ? (p.pri || 0) - (q.pri || 0) : 0));
    // overview: a group of sources (or of speakers, IEM packs) folds into one card
    let list = cards;
    if (!sockets) {
      const fold = new Map();
      cards.forEach((c) => { if ((c.col === 0 || c.col === 6) && c.g.group) { const k = c.col + ':' + key(c.g.group); if (!fold.has(k)) fold.set(k, []); fold.get(k).push(c); } });
      list = [];
      const done = new Set();
      cards.forEach((c) => {
        const k = c.g.group ? c.col + ':' + key(c.g.group) : null;
        const grp = k && fold.get(k);
        if (grp && grp.length > 1) {
          if (done.has(k)) return;
          done.add(k);
          list.push({ id: 'agg:' + k, agg: grp.map((x) => x.g), g: grp[0].g, side: 'all', col: c.col, group: grp[0].g.group });
        } else list.push(c);
      });
    }
    // columns in use, and where they sit
    const hasNet = doc.gear.some((g) => g.kind === 'network');
    const colsUsed = new Set(list.map((c) => c.col)); if (hasNet) colsUsed.add(3);
    [0, 2, 4, 6].forEach((cx) => colsUsed.add(cx));      // keep the main columns so the poster always reads the same way
    const cw = sockets ? CWS : CW;
    const colX = [], colN = [];
    let x = 14, n = 0;
    for (let cx = 0; cx < P.COLS.length; cx++) {
      if (!colsUsed.has(cx)) { colX[cx] = null; continue; }
      colX[cx] = x; colN[cx] = String(++n).padStart(2, '0');
      x += (cx === 3 ? NETW : cw) + GX;
    }
    const W = x - GX + 14;
    // stack each column: groups stay together, in the order they were added
    const heights = (c) => {
      if (!sockets) return OVH;
      const rows = c.side === 'in' ? c.g.ins.length : c.side === 'out' ? c.g.outs.length : Math.max(c.g.ins.length, c.g.outs.length);
      return HEAD + Math.max(1, rows) * ROW + 8;
    };
    let H = TOP;
    const labels = [];
    for (let cx = 0; cx < P.COLS.length; cx++) {
      const inCol = list.filter((c) => c.col === cx);
      const order = [], seen = new Set();
      inCol.forEach((c) => {
        const gk = c.agg ? 'agg:' + c.id : c.g.group ? 'grp:' + key(c.g.group) : 'one:' + c.id;
        if (seen.has(gk)) return; seen.add(gk);
        order.push(...inCol.filter((d) => (d.agg ? 'agg:' + d.id : d.g.group ? 'grp:' + key(d.g.group) : 'one:' + d.id) === gk));
      });
      let y = TOP, lastGroup = null;
      order.forEach((c) => {
        const gname = c.agg ? null : c.g.group || null;
        if (gname && key(gname) !== lastGroup) { y += 6; labels.push({ x: colX[cx], y: y + 10, text: gname }); y += 18; }
        else if (!gname && lastGroup) y += 8;
        lastGroup = gname ? key(gname) : null;
        c.x = colX[cx]; c.y = y; c.w = cw; c.h = heights(c);
        y += c.h + GAP;
      });
      H = Math.max(H, y);
    }
    const net = hasNet ? { x: colX[3] + NETW / 2, top: TOP, bottom: Math.max(H, TOP + 200), gear: doc.gear.filter((g) => g.kind === 'network') } : null;
    return { cards: list, colX, colN, W, H: Math.max(H, TOP + 120), net, mode, ix, labels };
  }

  /** Which card shows a gear's output end or input end of a cable. */
  function cardFinder(L) {
    const by = new Map();
    L.cards.forEach((c) => { if (c.agg) c.agg.forEach((g) => by.set(g.id + ':agg', c)); else by.set(c.id, c); });
    return (gid, end) => by.get(gid + ':agg') || by.get(gid + ':' + (end === 'out' ? 'out' : 'in')) || by.get(gid + ':all') || by.get(gid + ':in') || null;
  }

  /** Visual lines: cables (bundled in the overview) and the links between stage boxes, consoles and the network. */
  function edges(doc, L) {
    const find = cardFinder(L), G = L.ix.G, list = [];
    const sockets = L.mode === 'sockets';
    const bundles = new Map();
    for (const c of doc.cables) {
      const a = G.get(c.a), b = G.get(c.b);
      if (!a || !b) continue;
      if (c.ap === 'link' || c.bp === 'link') {
        // links: stage box ⇄ console draws as the inputs going in and the outputs coming back
        const [x, y] = a.kind === 'console' ? [b, a] : [a, b];
        if (y.kind === 'network' || x.kind === 'network') {
          const other = x.kind === 'network' ? y : x;
          [find(other.id, 'in'), other.kind === 'stagebox' ? L.cards.find((k) => k.id === other.id + ':out') : null].filter(Boolean)
            .forEach((card) => list.push({ id: 'n' + c.id + card.id, cables: [c.id], kind: c.kind, bus: true, card, label: c.label || 'Dante' }));
          continue;
        }
        const inCard = find(x.id, 'in'), conCard = find(y.id, 'in'), outCard = L.cards.find((k) => k.id === x.id + ':out');
        const nIn = x.ins.filter((_, i) => L.ix.into.get(x.id + ':' + i)).length;
        const linkName = c.label || (c.kind === 'dante' ? 'Dante' : 'Link');
        if (inCard && conCard) list.push({ id: 'l' + c.id, cables: [c.id], kind: c.kind, from: inCard, to: conCard, fromLink: true, toLink: true, label: linkName + (x.kind === 'stagebox' ? ' · ' + nIn + ' in' : ''), trunk: true });
        if (outCard && conCard) {
          const nOut = x.outs.filter((_, j) => (L.ix.from.get(x.id + ':' + j) || []).length || (x.feeds || {})[j]).length;
          list.push({ id: 'k' + c.id, cables: [c.id], kind: c.kind, from: conCard, to: outCard, fromLink: true, toLink: true, label: linkName + ' · ' + nOut + ' out', trunk: true });
        }
        continue;
      }
      const fa = find(a.id, 'out'), fb = find(b.id, 'in');
      if (!fa || !fb || fa === fb) continue;
      if (sockets) { list.push({ id: 'c' + c.id, cables: [c.id], kind: c.kind, from: fa, to: fb, ap: c.ap, bp: c.bp, label: c.kind === 'rf' ? (a.freq || c.label || '') : c.label || '' }); continue; }
      const k = fa.id + '>' + fb.id + '|' + c.kind;
      if (!bundles.has(k)) bundles.set(k, { id: 'b' + k, cables: [], kind: c.kind, from: fa, to: fb, labels: new Set() });
      const e = bundles.get(k);
      e.cables.push(c.id);
      const lab = c.kind === 'rf' ? (a.freq || c.label || '') : (c.label || '');
      if (lab) e.labels.add(lab);
    }
    bundles.forEach((e) => {
      const n = e.cables.length;
      const one = e.labels.size === 1 ? [...e.labels][0] : '';
      if (e.kind === 'rf') e.label = (n === 1 && one ? one + ' MHz' : 'RF') + (n > 1 ? ' · ' + n : '');
      else e.label = n > 1 ? n + ' ch' : one;
      e.trunk = n > 3;
      list.push(e);
    });
    return list;
  }

  // ================= drawing =================
  function cardSub(doc, L, c) {
    const g = c.g, ix = L.ix;
    if (c.agg) {
      const targets = new Map();
      c.agg.forEach((x) => x.outs.forEach((_, j) => (ix.from.get(x.id + ':' + j) || []).forEach((cb) => { const t = ix.G.get(cb.b); if (t) targets.set(t.name, (targets.get(t.name) || 0) + 1); })));
      c.agg.forEach((x) => x.ins.forEach((_, i) => { const cb = ix.into.get(x.id + ':' + i); if (cb) { const t = ix.G.get(cb.a); if (t) targets.set('← ' + t.name, (targets.get('← ' + t.name) || 0) + 1); } }));
      return [...targets].map(([n, k]) => k + ' → ' + n).join(' · ').replace(/→ ← /g, '← ') || c.agg.map((x) => x.use || x.name).join(', ');
    }
    const usedIns = g.ins.filter((_, i) => ix.into.get(g.id + ':' + i)).length;
    const usedOuts = g.outs.filter((_, j) => (ix.from.get(g.id + ':' + j) || []).length || (g.feeds || {})[j]).length;
    switch (g.kind) {
      case 'mic': case 'di': case 'source': return [g.use, g.model].filter(Boolean).join(' · ');
      case 'txmic': return [g.use, g.capsule, g.freq].filter(Boolean).join(' · ');
      case 'receiver': return [g.model, usedIns + ' of ' + g.ins.length + ' ch used'].filter(Boolean).join(' · ');
      case 'stagebox': return c.side === 'out' ? usedOuts + ' of ' + g.outs.length + ' out used' : usedIns + ' of ' + g.ins.length + ' in used' + (g.start && g.start > 1 ? ' · ch ' + g.start + '+' : '');
      case 'console': return [g.model, usedIns ? usedIns + ' local in' : '', usedOuts ? usedOuts + ' local out' : ''].filter(Boolean).join(' · ');
      case 'iemtx': { const ie = P.inears(doc).find((x) => x.tx.id === g.id); return [g.mode, ie && ie.mix, g.freq].filter(Boolean).join(' · '); }
      case 'bodypack': return [g.use, g.phones].filter(Boolean).join(' · ');
      default: return [g.use, g.model].filter(Boolean).join(' · ');
    }
  }

  /** What is on a socket, as a few words. */
  function socketText(doc, L, g, side, i) {
    const ix = L.ix;
    if (side === 'in') {
      const c = ix.into.get(g.id + ':' + i);
      if (!c) return '';
      const a = ix.G.get(c.a);
      const u = P.upstream(doc, ix, g.id, i);
      return (u.source && u.source !== a.name ? u.source + ' · ' : '') + a.name + (a.outs.length > 1 ? ' ' + a.outs[c.ap] : '');
    }
    const to = (ix.from.get(g.id + ':' + i) || []).map((c) => { const b = ix.G.get(c.b); return b ? b.name + (b.ins.length > 1 ? ' ' + b.ins[c.bp] : '') : ''; }).filter(Boolean);
    const mix = (g.feeds || {})[i];
    return [mix, to.join(', ')].filter(Boolean).join(' → ');
  }

  function sockY(c, i) { return c.y + HEAD + i * ROW + ROW / 2; }

  function svgFor(doc, L, E, opts) {
    const sockets = L.mode === 'sockets';
    const defs = '<defs>' + Object.entries(P.CATS).map(([k, v]) => '<linearGradient id="pg-' + k + '" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="' + v.color + '" stop-opacity=".42"/><stop offset=".55" stop-color="' + v.color + '" stop-opacity=".08"/><stop offset="1" stop-color="' + v.color + '" stop-opacity="0"/></linearGradient>').join('') +
      '<linearGradient id="pg-bus" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b6cff"/><stop offset="1" stop-color="#4c8dff"/></linearGradient>' +
      Object.keys(KIND_STYLE).map((k) => '<marker id="pa-' + k + '" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" class="pa pa-' + k + '"/></marker>').join('') + '</defs>';
    // column headings, like chevrons
    let heads = '';
    L.colX.forEach((x, cx) => {
      if (x == null) return;
      const w = cx === 3 ? NETW : (sockets ? CWS : CW);
      heads += cx === 3
        ? '<g class="phd"><text x="' + (x + w / 2) + '" y="24" text-anchor="middle" class="n">' + L.colN[cx] + '</text><text x="' + (x + w / 2) + '" y="40" text-anchor="middle">' + P.COLS[cx].title.toUpperCase() + '</text></g>'
        : '<g class="phd"><path d="M' + x + ' 8h' + (w + 6) + 'l12 18l-12 18h-' + (w + 6) + 'z"/><text x="' + (x + 12) + '" y="31" class="n">' + L.colN[cx] + '</text><text x="' + (x + 38) + '" y="31">' + P.COLS[cx].title.toUpperCase() + '</text></g>';
    });
    // the network bus
    let bus = '';
    if (L.net) bus = '<g class="pbus" data-g="' + L.net.gear.map((g) => g.id).join(',') + '"><rect x="' + (L.net.x - 15) + '" y="' + L.net.top + '" width="30" height="' + (L.net.bottom - L.net.top) + '" rx="15" fill="url(#pg-bus)"/>' +
      '<text transform="translate(' + (L.net.x + 5) + ',' + ((L.net.top + L.net.bottom) / 2) + ') rotate(-90)" text-anchor="middle">' + esc(L.net.gear.map((g) => g.name).join(' · ').toUpperCase()) + '</text></g>';
    // lines
    const outSlots = new Map(), inSlots = new Map();
    if (!sockets) {
      E.forEach((e) => { if (e.bus) return; if (!outSlots.has(e.from.id)) outSlots.set(e.from.id, []); outSlots.get(e.from.id).push(e); if (!inSlots.has(e.to.id)) inSlots.set(e.to.id, []); inSlots.get(e.to.id).push(e); });
      outSlots.forEach((l) => l.sort((p, q) => (p.to.y - q.to.y) || (p.to.x - q.to.x)));
      inSlots.forEach((l) => l.sort((p, q) => (p.from.y - q.from.y) || (p.from.x - q.from.x)));
    }
    const slotY = (card, listMap, e) => {
      const l = listMap.get(card.id) || [e], i = l.indexOf(e), n = l.length;
      const span = Math.min(card.h - 18, n * 9);
      return card.y + card.h / 2 + (n > 1 ? -span / 2 + (span * i) / (n - 1) : 0);
    };
    let lines = '', labels = '';
    E.forEach((e) => {
      let x1, y1, x2, y2;
      if (e.bus) {
        const card = e.card, left = card.x + card.w < L.net.x;
        x1 = left ? card.x + card.w : card.x; y1 = card.y + (sockets ? 22 : card.h / 2);
        x2 = left ? L.net.x - 15 : L.net.x + 15; y2 = y1;
        lines += '<g class="pe pe-' + e.kind + '" data-c="' + e.cables.join(',') + '"><path class="hit" d="M' + x1 + ' ' + y1 + 'H' + x2 + '"/><path class="ln" d="M' + x1 + ' ' + y1 + 'H' + x2 + '"/><circle class="bdot" cx="' + x2 + '" cy="' + y2 + '" r="4"/></g>';
        return;
      }
      if (sockets && !e.fromLink && e.ap != null) { x1 = e.from.x + e.from.w; y1 = sockY(e.from, e.ap); }
      else if (e.fromLink && sockets) { x1 = e.from.x + e.from.w; y1 = e.from.y + 22; }
      else { x1 = e.from.x + e.from.w; y1 = slotY(e.from, outSlots, e); }
      if (sockets && !e.toLink && e.bp != null) { x2 = e.to.x; y2 = sockY(e.to, e.bp); }
      else if (e.toLink && sockets) { x2 = e.to.x; y2 = e.to.y + 22; }
      else { x2 = e.to.x; y2 = slotY(e.to, inSlots, e); }
      if (e.from.col === e.to.col && e.from !== e.to) {
        const top = e.from.y < e.to.y ? e.from : e.to, bot = top === e.from ? e.to : e.from;
        const xm = top.x + top.w * 0.72, ya = top.y + top.h, yb = bot.y;
        const d2 = 'M' + xm + ' ' + ya + 'V' + (yb - 2);
        lines += '<g class="pe pe-' + e.kind + (e.trunk ? ' trunk' : '') + '" data-c="' + e.cables.join(',') + '"><path class="hit" d="' + d2 + '"/><path class="ln" d="' + d2 + '" marker-end="url(#pa-' + e.kind + ')"/></g>';
        if (e.label) labels += '<text class="pl pl-' + e.kind + '" x="' + (xm + 8) + '" y="' + ((ya + yb) / 2 + 4) + '">' + esc(cut(e.label, 22)) + '</text>';
        return;
      }
      const back = x2 < x1 + 20;
      const dx = back ? 70 : Math.max(30, (x2 - x1) / 2);
      const d = 'M' + x1 + ' ' + y1 + 'C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + (x2 - 2) + ' ' + y2;
      lines += '<g class="pe pe-' + e.kind + (e.trunk ? ' trunk' : '') + '" data-c="' + e.cables.join(',') + '"><path class="hit" d="' + d + '"/><path class="ln" d="' + d + '" marker-end="url(#pa-' + e.kind + ')"/></g>';
      if (e.label) {
        const mx = back ? x2 - 24 : x1 + Math.min(70, (x2 - x1) * 0.32), my = back ? (y1 + y2) / 2 - 6 : 0.78 * y1 + 0.22 * y2 - 6;
        labels += '<text class="pl pl-' + e.kind + '" x="' + mx + '" y="' + my + '" text-anchor="' + (back ? 'middle' : 'start') + '">' + esc(cut(e.label, 22)) + '</text>';
      }
    });
    // group labels
    const glabels = L.labels ? '' : '';
    // cards
    let cards = '';
    L.cards.forEach((c) => {
      const g = c.g, cat = (P.KINDS[g.kind] || P.KINDS.other).cat;
      const ids = c.agg ? c.agg.map((x) => x.id) : [g.id];
      const name = c.agg ? c.group + ' ×' + c.agg.length : g.name + (c.side === 'out' ? ' · outputs' : '');
      const sub = cardSub(doc, L, c);
      const chars = Math.floor(c.w / 7.3);
      cards += '<g class="pcard cat-' + cat + '" data-card="' + esc(c.id) + '" data-g="' + ids.join(',') + '">' +
        '<rect class="cbg" x="' + c.x + '" y="' + c.y + '" width="' + c.w + '" height="' + c.h + '" rx="9"/>' +
        '<rect class="cgl" x="' + c.x + '" y="' + c.y + '" width="' + c.w + '" height="' + c.h + '" rx="9" fill="url(#pg-' + cat + ')"/>' +
        '<rect class="cbd" x="' + c.x + '" y="' + c.y + '" width="' + c.w + '" height="' + c.h + '" rx="9"/>' +
        '<text class="ct" x="' + (c.x + 12) + '" y="' + (c.y + 21) + '">' + esc(cut(name, g.make && !c.agg ? chars - Math.min(10, makeTag(g.make).length) - 3 : chars)) + '</text>' +
        '<text class="cs" x="' + (c.x + 12) + '" y="' + (c.y + 38) + '">' + esc(cut(sub, chars + 3)) + '</text>' +
        (g.make && !c.agg ? (() => { const m = cut(makeTag(g.make).toUpperCase(), 10), mw = m.length * 6 + 12; return '<g class="mk"><rect x="' + (c.x + c.w - 10 - mw) + '" y="' + (c.y + 9) + '" width="' + mw + '" height="16" rx="4"/><text x="' + (c.x + c.w - 10 - mw / 2) + '" y="' + (c.y + 20.5) + '" text-anchor="middle">' + esc(m) + '</text></g>'; })() : '') +
        '<title>' + esc(name + (sub ? ' · ' + sub : '')) + '</title>';
      if (sockets) {
        const rows = c.side === 'in' ? g.ins.map((p, i) => ({ i, l: p })) : [];
        cards += '<line class="csep" x1="' + c.x + '" x2="' + (c.x + c.w) + '" y1="' + (c.y + HEAD - 3) + '" y2="' + (c.y + HEAD - 3) + '"/>';
        const showIn = c.side !== 'out', showOut = c.side !== 'in';
        const half = showIn && showOut ? c.w / 2 : c.w;
        if (showIn) g.ins.forEach((p, i) => {
          const y = sockY(c, i), t = socketText(doc, L, g, 'in', i);
          cards += '<g class="sk in' + (t ? ' used' : '') + '" data-g="' + g.id + '" data-p="' + i + '"><circle class="hitc" cx="' + c.x + '" cy="' + y + '" r="9"/><circle class="dot" cx="' + c.x + '" cy="' + y + '" r="4.5"/><text x="' + (c.x + 10) + '" y="' + (y + 4) + '"><tspan class="pn">' + esc(p) + '</tspan>' + (t ? ' ' + esc(cut(t, Math.floor((half - 18) / 6.2) - p.length)) : '') + '</text><title>' + esc(g.name + ' ' + p + (t ? ': ' + t : ' (free)')) + '</title></g>';
        });
        if (showOut) g.outs.forEach((p, j) => {
          const y = sockY(c, j), t = socketText(doc, L, g, 'out', j);
          cards += '<g class="sk out' + (t ? ' used' : '') + '" data-g="' + g.id + '" data-p="' + j + '"><circle class="hitc" cx="' + (c.x + c.w) + '" cy="' + y + '" r="9"/><circle class="dot" cx="' + (c.x + c.w) + '" cy="' + y + '" r="4.5"/><text x="' + (c.x + c.w - 10) + '" y="' + (y + 4) + '" text-anchor="end">' + (t ? esc(cut(t, Math.floor((half - 18) / 6.2) - p.length)) + ' ' : '') + '<tspan class="pn">' + esc(p) + '</tspan></text><title>' + esc(g.name + ' ' + p + (t ? ': ' + t : ' (free)')) + '</title></g>';
        });
        if (P.KINDS[g.kind].link) {
          if (c.side !== 'out') cards += '<rect class="ldot" data-g="' + g.id + '" x="' + (c.x + c.w - 5) + '" y="' + (c.y + 17) + '" width="10" height="10" rx="2" transform="rotate(45 ' + (c.x + c.w) + ' ' + (c.y + 22) + ')"><title>Link: drag to the console or network</title></rect>';
          if (g.kind === 'console' || c.side === 'out') cards += '<rect class="ldot" data-g="' + g.id + '" x="' + (c.x - 5) + '" y="' + (c.y + 17) + '" width="10" height="10" rx="2" transform="rotate(45 ' + c.x + ' ' + (c.y + 22) + ')"><title>Link</title></rect>';
        }
        void rows;
      } else if (opts.edit && !c.agg) {
        if (g.outs.length || P.KINDS[g.kind].link) cards += '<circle class="hand" data-card="' + esc(c.id) + '" data-g="' + g.id + '" cx="' + (c.x + c.w) + '" cy="' + (c.y + c.h / 2) + '" r="6"><title>Drag to another card to connect</title></circle>';
      }
      cards += '</g>';
    });
    const grp = L.cards.length ? '' : '';
    void glabels; void grp;
    const gl = (L.labels || []).map((t) => '<text class="pgl" x="' + t.x + '" y="' + t.y + '">' + esc(t.text.toUpperCase()) + '</text>').join('');
    // the key
    const ky = L.H + 26;
    let keyHtml = '<g class="pkey"><text class="kh" x="14" y="' + ky + '">KEY</text>';
    Object.entries(P.CATS).forEach(([k, v], i) => { const x = 14 + (i % 4) * 150, y = ky + 22 + Math.floor(i / 4) * 22; keyHtml += '<rect x="' + x + '" y="' + (y - 11) + '" width="16" height="14" rx="3" fill="' + v.color + '" opacity=".75"/><text x="' + (x + 24) + '" y="' + y + '">' + esc(v.label) + '</text>'; });
    Object.entries(KIND_STYLE).forEach(([k, v], i) => { const x = 14 + (i % 4) * 150, y = ky + 78 + Math.floor(i / 4) * 22; keyHtml += '<g class="pe pe-' + k + '"><path class="ln" d="M' + x + ' ' + (y - 4) + 'h28" marker-end="url(#pa-' + k + ')"/></g><text x="' + (x + 36) + '" y="' + y + '">' + esc(v) + '</text>'; });
    keyHtml += '</g>';
    const totalH = ky + 130;
    return { svg: defs + heads + bus + '<g class="pes">' + lines + '</g>' + labels + gl + cards + keyHtml, W: Math.max(L.W, 620), H: totalH };
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
  const ch = (r) => String(r.ch);
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
        return tr([r.via.id, ...u.chain.map((g) => g.id)], ['<b>' + ch(r) + '</b>', esc(u.source || (r.used ? '' : '—')), esc(u.mic || ''), wl, esc(r.via.kind === 'console' ? r.port : r.via.name + ' ' + r.port), esc(r.console.name)]);
      }), 'No inputs yet. Draw a mic or receiver to a stage box or the console.') + (spare && !opts.spares && !opts.noSpare ? '<div class="note" style="margin-top:6px">' + spare + ' spare stage box input' + (spare === 1 ? '' : 's') + ' not listed.</div>' : '');
    }
    if (report === 'outputs') {
      const rows = P.outputs(doc).filter((r) => match(r.console.name, r.socket.name, r.mix, r.chain));
      return T([['Mix'], ['Socket'], ['Goes to']], rows.map((r) => tr([r.socket.id, ...r.dest.map((d) => d.g.id)], ['<b>' + esc(r.mix || '—') + '</b>', esc(r.socket.kind === 'console' ? r.socket.name + ' ' + r.port : r.socket.name + ' ' + r.port), esc(r.chain || '—')])), 'No outputs yet. Pick a mix on a console or stage box output and draw where it goes.');
    }
    if (report === 'wireless') {
      const rows = P.wireless(doc).filter((r) => match(r.tx.name, r.tx.use, r.rx && r.rx.name));
      return T([['Person / use'], ['Transmitter'], ['Capsule'], ['Frequency'], ['Receiver'], ['Console input']], rows.map((r) => tr([r.tx.id, r.rx && r.rx.id], [esc(r.tx.use || ''), esc(r.tx.name), esc(r.tx.capsule || ''), esc(r.tx.freq ? r.tx.freq + ' MHz' : ''), esc(r.rx ? r.rx.name + ' ' + r.rxch : '—'), esc(r.land && r.land.console ? r.land.console.name + ' ' + r.land.ch + ' (' + r.land.via + ')' : r.land ? r.land.via : '')])), 'No wireless mics yet.');
    }
    if (report === 'iem') {
      const rows = P.inears(doc).filter((r) => match(r.tx.name, r.mix, ...r.packs.map((p) => p.use)));
      return T([['Transmitter'], ['Mode'], ['Frequency'], ['Mix'], ['Fed from'], ['Packs']], rows.map((r) => tr([r.tx.id, ...r.packs.map((p) => p.id)], ['<b>' + esc(r.tx.name) + '</b>', esc(r.tx.mode || ''), esc(r.tx.freq ? r.tx.freq + ' MHz' : ''), esc(r.mix || '—'), esc(r.feeds.filter(Boolean).map((x) => x.from.name + ' ' + x.socket).join(', ')), esc(r.packs.map((p) => p.use ? p.use + ' (' + p.name + ')' : p.name).join(', '))])), 'No in-ear transmitters yet.');
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
      doc: data.doc, version: data.version, mode: 'overview', edit: false, sel: null, selCable: null, selSocket: null,
      undo: [], redo: [], tf: null, report: 'inputs', saving: false, dirtySave: false, pending: null, spares: false
    };
    const canEdit = data.canEdit;
    const wide = () => matchMedia('(min-width: 1024px)').matches;
    app.innerHTML = `<div class="patchv">
      <div class="printhead"><img src="/icons/livegenie-glyph.svg" alt=""><div><b>LiveGenie</b><span>Rolling Hills Community Church · Stage patch</span></div><div class="pm">Version ${st.version}<br>Printed ${esc(new Date().toLocaleString())}</div></div>
      <div class="crumbs"><a href="#/">Home</a><span>/</span></div>
      <div class="bar pbar"><div class="grow"><div class="ptitle" id="ptl"></div></div>
        <div class="seg" id="pmode"><button data-m="overview" class="on">Overview</button><button data-m="sockets">Sockets</button></div>
        ${canEdit ? '<button class="btn" id="pedit">' + icon('edit') + '<span>Edit</span></button>' : ''}
        <button class="btn ghost" id="ppdf" title="Export PDF">${icon('pdf')}<span class="hide-sm">PDF</span></button>
        ${canEdit ? '<button class="btn ghost" id="phist" title="Versions">' + icon('clock') + '<span class="hide-sm">History</span></button>' : ''}</div>
      <div class="ptools hide" id="ptools"><button class="ghost" id="pun" title="Undo (Ctrl+Z)">↶ Undo</button><button class="ghost" id="pre" title="Redo">↷ Redo</button><span class="note" id="psave"></span><span class="grow"></span><span class="note phint">Drag from a socket or a card's ● to another to connect. Delete removes what is selected.</span></div>
      <div class="pmain"><div class="pcanvas" id="pcv"><svg id="psvg"><g id="pvp"></g><path id="ptmp" class="ptmp" d=""/></svg>
        <div class="pzoom"><button id="pzi" title="Zoom in">+</button><button id="pzo" title="Zoom out">−</button><button id="pzf" title="Fit">⤢</button></div>
        <button class="fab padd hide" id="padd" aria-label="Add equipment">${icon('plus')}</button></div>
        <aside class="ppane" id="ppane"></aside></div>
      <div class="pchecks" id="pchk"></div>
      <div class="preports card"><div class="seg" id="prt">${REPORTS.map((r) => '<button data-r="' + r[0] + '"' + (r[0] === st.report ? ' class="on"' : '') + '>' + r[1] + '</button>').join('')}</div>
        <label class="tog" id="pspl" style="margin-left:auto"><input type="checkbox" id="psp"> Spare inputs</label>
        <div id="prbody"></div><div class="printonly" id="prall"></div></div>
    </div>`;
    const svg = $('#psvg'), vp = $('#pvp'), cv = $('#pcv');
    let L, E;

    // ---------- painting ----------
    function paintTitle() {
      const d = st.doc;
      $('#ptl').innerHTML = '<div class="pkicker">STAGE PATCH</div><h1 class="title">' + esc(d.title) + '</h1>' + (d.subtitle ? '<div class="note">' + esc(d.subtitle) + '</div>' : '<div class="note">Read it left to right. Click any piece of gear or cable to follow its signal.</div>') +
        (st.edit ? '<button class="linkbtn" id="ptedit">Edit title</button>' : '');
      const te = $('#ptedit'); if (te) te.addEventListener('click', titleDialog);
    }
    function paint(keepView) {
      L = layout(st.doc, st.mode);
      E = edges(st.doc, L);
      const s = svgFor(st.doc, L, E, { edit: st.edit });
      svg.dataset.w = s.W; svg.dataset.h = s.H;
      vp.innerHTML = s.svg;
      svg.classList.toggle('editing', st.edit);
      if (!keepView || !st.tf) fit(); else apply();
      highlight();
      paintChecks(); paintReport();
    }
    function paintChecks() {
      const list = P.checks(st.doc);
      $('#pchk').innerHTML = list.length ? list.map((c, i) => '<button class="pchk ' + c.level + '" data-i="' + i + '">' + icon(c.level === 'note' ? 'info' : 'warn') + '<span>' + esc(c.text) + '</span></button>').join('') : '';
      $$('#pchk [data-i]').forEach((b) => b.addEventListener('click', () => { const c = list[Number(b.dataset.i)]; select({ gear: c.gear }); }));
    }
    function paintReport() {
      $('#prbody').innerHTML = reportHtml(st.doc, st.report, '', { spares: st.spares });
      $('#pspl').classList.toggle('hide', st.report !== 'inputs');
      $('#prall').innerHTML = REPORTS.map((r) => '<h2>' + r[1] + '</h2>' + reportHtml(st.doc, r[0], '', { noSpare: true })).join('');
      $$('#prbody tr[data-gs]').forEach((tr) => tr.addEventListener('click', () => { select({ gear: [...new Set(tr.dataset.gs.split(',').filter(Boolean))] }); cv.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
    }

    // ---------- selection and highlighting ----------
    function select(s) {
      st.sel = s && s.gear ? s.gear : null; st.selCable = s && s.cable ? s.cable : null; st.selSocket = s && s.socket ? s.socket : null;
      highlight(); paintPane();
      if (!wide() && (st.sel || st.selCable)) sheet();
    }
    function highlight() {
      const on = st.sel || st.selCable || st.selSocket;
      svg.classList.toggle('dim', !!on && !st.edit);     // while editing, the rest stays bright to wire to
      if (!on) { $$('.on', vp).forEach((x) => x.classList.remove('on')); return; }
      const t = trace(st.doc, L.ix, st.selCable ? { cable: st.doc.cables.find((c) => c.id === st.selCable) } : st.selSocket ? { socket: st.selSocket } : { gear: st.sel });
      $$('.pcard', vp).forEach((el) => el.classList.toggle('on', el.dataset.g.split(',').some((id) => t.gear.has(id))));
      $$('.pcard', vp).forEach((el) => el.classList.toggle('sel', !!st.sel && el.dataset.g.split(',').some((id) => st.sel.includes(id))));
      $$('.pe', vp).forEach((el) => { if (el.dataset.c) el.classList.toggle('on', el.dataset.c.split(',').some((id) => t.cables.has(id))); });
      $$('.sk', vp).forEach((el) => el.classList.toggle('on', !!st.selSocket && el.dataset.g === st.selSocket.g && Number(el.dataset.p) === st.selSocket.p && el.classList.contains(st.selSocket.side)));
      const bus = $('.pbus', vp); if (bus) bus.classList.toggle('on', bus.dataset.g.split(',').some((id) => t.gear.has(id)));
    }

    // ---------- pan and zoom ----------
    function apply() { vp.setAttribute('transform', 'translate(' + st.tf.x + ',' + st.tf.y + ') scale(' + st.tf.k + ')'); $('#ptmp').setAttribute('transform', vp.getAttribute('transform')); }
    function fit() {
      const W = Number(svg.dataset.w), H = Number(svg.dataset.h);
      const r0 = cv.getBoundingClientRect();
      // readable first: shrink to fit the width, but not so far that the text gets too small (pan for the rest)
      const k = Math.max(wide() ? 0.72 : 0.58, Math.min(1.1, (r0.width - 20) / W));
      // the canvas grows to the drawing, up to the screen
      const maxH = window.innerHeight - (wide() ? 150 : 210);
      cv.style.height = Math.round(Math.max(360, Math.min(maxH, H * k + 24))) + 'px';
      const r = cv.getBoundingClientRect();
      st.tf = { k, x: Math.max(10, (r.width - W * k) / 2), y: 10 };
      apply();
    }
    /** Slide the drawing so a piece of gear is in view. */
    function focusGear(id) {
      const c = L.cards.find((x) => x.g.id === id || (x.agg && x.agg.some((g) => g.id === id)));
      if (!c) return;
      const r = cv.getBoundingClientRect(), k = st.tf.k;
      const sx = st.tf.x + c.x * k, sy = st.tf.y + c.y * k;
      if (sx > 20 && sx + c.w * k < r.width - 20 && sy > 20 && sy + c.h * k < r.height - 20) return;
      st.tf.x = Math.min(10, r.width * 0.3 - c.x * k); st.tf.y = Math.min(10, r.height * 0.45 - c.y * k); apply();
    }
    const world = (cx, cy) => { const r = svg.getBoundingClientRect(); return { x: (cx - r.left - st.tf.x) / st.tf.k, y: (cy - r.top - st.tf.y) / st.tf.k }; };
    function zoomAt(f, cx, cy) {
      const r = svg.getBoundingClientRect(); const px = cx - r.left, py = cy - r.top;
      const k = Math.max(0.2, Math.min(3, st.tf.k * f));
      st.tf.x = px - (px - st.tf.x) * (k / st.tf.k); st.tf.y = py - (py - st.tf.y) * (k / st.tf.k); st.tf.k = k; apply();
    }
    svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
    $('#pzi').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2); });
    $('#pzo').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(0.8, r.left + r.width / 2, r.top + r.height / 2); });
    $('#pzf').addEventListener('click', fit);

    // pointer: pan, pinch, tap to select, drag to connect
    const pts = new Map();
    let gesture = null;
    svg.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [p, q] = [...pts.values()]; gesture = { pinch: true, d: Math.hypot(p.x - q.x, p.y - q.y), k: st.tf.k }; return; }
      const t = e.target;
      const src = st.edit && (t.closest('.sk.out') || t.closest('.hand') || t.closest('.ldot'));
      if (src) {
        e.preventDefault();
        svg.setPointerCapture(e.pointerId);
        const gid = src.dataset.g, isLink = src.classList.contains('ldot'), isHand = src.classList.contains('hand');
        const w = world(e.clientX, e.clientY);
        gesture = { connect: true, gid, port: isLink ? 'link' : isHand ? null : Number(src.dataset.p), x0: w.x, y0: w.y, sx: e.clientX, sy: e.clientY, moved: false };
        return;
      }
      gesture = { pan: true, sx: e.clientX, sy: e.clientY, x: st.tf.x, y: st.tf.y, moved: false, target: t };
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
      if (gesture.connect) {
        if (Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 4) gesture.moved = true;
        // near an edge: the drawing slides along so you can reach sockets off screen
        const r = svg.getBoundingClientRect(), edge = 36, step = 14;
        let dx = 0, dy = 0;
        if (e.clientX < r.left + edge) dx = step; else if (e.clientX > r.right - edge) dx = -step;
        if (e.clientY < r.top + edge) dy = step; else if (e.clientY > r.bottom - edge) dy = -step;
        if (dx || dy) { st.tf.x += dx; st.tf.y += dy; apply(); }
        const w = world(e.clientX, e.clientY);
        $('#ptmp').setAttribute('d', 'M' + gesture.x0 + ' ' + gesture.y0 + 'C' + (gesture.x0 + 60) + ' ' + gesture.y0 + ' ' + (w.x - 60) + ' ' + w.y + ' ' + w.x + ' ' + w.y);
        return;
      }
      if (gesture.pan) {
        const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
        if (Math.hypot(dx, dy) > 4) gesture.moved = true;
        if (gesture.moved) { st.tf.x = gesture.x + dx; st.tf.y = gesture.y + dy; apply(); }
      }
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      const g = gesture;
      if (!g || pts.size) { if (!pts.size) gesture = null; return; }
      gesture = null;
      if (g.connect) {
        $('#ptmp').setAttribute('d', '');
        if (!g.moved) { st.pending = { gid: g.gid, port: g.port }; toast('Now tap where it goes'); markPending(); return; }
        dropOn(document.elementFromPoint(e.clientX, e.clientY), g.gid, g.port);
        return;
      }
      if (g.pan && !g.moved) tap(g.target);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); gesture = null; $('#ptmp').setAttribute('d', ''); });

    function markPending() { $$('.pending', vp).forEach((x) => x.classList.remove('pending')); if (st.pending) $$('[data-g="' + st.pending.gid + '"].pcard, .pcard[data-g="' + st.pending.gid + '"]', vp).forEach((x) => x.classList.add('pending')); }
    function tap(t) {
      if (st.pending && st.edit) { const p = st.pending; st.pending = null; markPending(); dropOn(t, p.gid, p.port); return; }
      const sk = t.closest('.sk'), card = t.closest('.pcard'), edge = t.closest('.pe'), bus = t.closest('.pbus');
      if (sk) return select({ gear: [sk.dataset.g], socket: { g: sk.dataset.g, p: Number(sk.dataset.p), side: sk.classList.contains('in') ? 'in' : 'out' } });
      if (card) return select({ gear: card.dataset.g.split(',') });
      if (edge && edge.dataset.c) return select({ cable: edge.dataset.c.split(',')[0] });
      if (bus) return select({ gear: bus.dataset.g.split(',') });
      select(null);
    }

    // ---------- connecting ----------
    function dropOn(el, gid, port) {
      if (!el) return;
      const a = st.doc.gear.find((g) => g.id === gid);
      const sk = el.closest && el.closest('.sk.in'), card = el.closest && el.closest('.pcard'), ld = el.closest && el.closest('.ldot'), bus = el.closest && el.closest('.pbus');
      const targetId = sk ? sk.dataset.g : ld ? ld.dataset.g : bus ? bus.dataset.g.split(',')[0] : card && !card.dataset.card.startsWith('agg:') ? card.dataset.g : null;
      const b = st.doc.gear.find((g) => g.id === targetId);
      if (!a || !b || a === b) return;
      const pair = [a.kind, b.kind].sort().join('+');
      const linky = port == null && (a.kind === 'network' || b.kind === 'network' || pair === 'console+stagebox' || pair === 'computer+console');
      if (port === 'link' || ld || bus || linky) {
        if (!P.KINDS[a.kind].link || !P.KINDS[b.kind].link) return toast(b.name + ' has no link socket', 'bad');
        change(() => { const c = P.connect(st.doc, a, 'link', b, 'link', { label: linkLabel(a, b) }); return c; }, 'Linked ' + a.name + ' and ' + b.name);
        return;
      }
      if (sk && port != null) { change(() => P.connect(st.doc, a, port, b, Number(sk.dataset.p)), a.name + ' ' + a.outs[port] + ' → ' + b.name + ' ' + b.ins[Number(sk.dataset.p)]); return; }
      connectDialog(a, b, port);
    }
    function linkLabel(a, b) {
      const it = P.CATALOG.flatMap((g) => g.items).find((x) => (x.model === a.model || x.model === b.model) && x.link);
      return it ? it.link : '';
    }
    function connectDialog(a, b, port) {
      if (!a.outs.length) return toast(a.name + ' has no outputs', 'bad');
      if (!b.ins.length) return toast(b.name + ' has no inputs', 'bad');
      const ix = P.index(st.doc);
      const freeOut = port != null ? port : Math.max(0, a.outs.findIndex((_, j) => !(ix.from.get(a.id + ':' + j) || []).length));
      const firstFree = Math.max(0, b.ins.findIndex((_, i) => !ix.into.get(b.id + ':' + i)));
      const opt = (list, sel, taken) => list.map((p, i) => '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + esc(p) + (taken(i) ? ' (in use)' : '') + '</option>').join('');
      modal('<h3>Connect ' + esc(a.name) + ' to ' + esc(b.name) + '</h3><p>Pick the sockets. For several in a row (a drum mic snake, both sides of a stereo feed), set how many.</p><form id="pcf">' +
        '<div class="two"><div><label>From</label><select id="pcf_a">' + opt(a.outs, freeOut, (j) => (ix.from.get(a.id + ':' + j) || []).length) + '</select></div>' +
        '<div><label>To</label><select id="pcf_b">' + opt(b.ins, firstFree, (i) => ix.into.get(b.id + ':' + i)) + '</select></div></div>' +
        '<div class="two"><div><label>How many</label><input id="pcf_n" type="number" min="1" max="' + Math.min(a.outs.length, b.ins.length) + '" value="' + (a.outs.length > 1 && b.ins.length > 1 && a.kind !== 'receiver' ? Math.min(a.outs.length, 2) === 2 && /L|R/.test(a.outs.join()) ? 2 : 1 : 1) + '"></div>' +
        '<div><label>Cable</label><select id="pcf_k">' + Object.entries(KIND_STYLE).map(([k, v]) => '<option value="' + k + '"' + (k === P.guessCable(a, 0, b, 0) ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></div></div>' +
        '<label>Cable label <span class="note">(optional, e.g. C12)</span></label><input id="pcf_l">' +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Connect</button></div></form>', (w, close) => {
        $('#pcf', w).addEventListener('submit', (e) => {
          e.preventDefault();
          const ao = Number($('#pcf_a', w).value), bi = Number($('#pcf_b', w).value), n = Math.max(1, Number($('#pcf_n', w).value) || 1);
          const kind = $('#pcf_k', w).value, label = $('#pcf_l', w).value.trim();
          close();
          change(() => { for (let i = 0; i < n && ao + i < a.outs.length && bi + i < b.ins.length; i++) P.connect(st.doc, a, ao + i, b, bi + i, { kind, label: n > 1 && label ? label + '.' + (i + 1) : label }); }, n > 1 ? n + ' cables' : 'Connected');
        });
      });
    }

    // ---------- changes, undo, saving ----------
    function change(fn, msg, keepPane) {
      st.undo.push(JSON.stringify(st.doc)); if (st.undo.length > 120) st.undo.shift();
      st.redo = [];
      const r = fn();
      paint(true);
      if (!keepPane) paintPane();
      if (msg) toast(msg);
      queueSave();
      return r;
    }
    function undo() { if (!st.undo.length) return; st.redo.push(JSON.stringify(st.doc)); st.doc = JSON.parse(st.undo.pop()); paint(true); paintPane(); queueSave(); }
    function redo() { if (!st.redo.length) return; st.undo.push(JSON.stringify(st.doc)); st.doc = JSON.parse(st.redo.pop()); paint(true); paintPane(); queueSave(); }
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
        if (e.status === 409) { toast(e.message, 'bad'); const d = await get('/api/patch'); st.doc = d.doc; st.version = d.version; st.undo = []; st.redo = []; S.dirty = false; paint(true); paintPane(); $('#psave').textContent = 'Reloaded'; }
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
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selCable) { e.preventDefault(); const id = st.selCable; st.selCable = null; change(() => { st.doc.cables = st.doc.cables.filter((c) => c.id !== id); }, 'Cable removed'); }
        else if (st.sel && st.sel.length === 1) { e.preventDefault(); removeGear(st.sel[0]); }
      } else if (e.key === 'Escape') { st.pending = null; markPending(); select(null); }
    });

    // ---------- the right pane ----------
    function paintPane(host) {
      if (!host) { [$('#ppane'), $('#psh')].filter(Boolean).forEach((h) => paintPane(h)); return; }
      host.classList.remove('empty');
      const g = st.sel && st.sel.length === 1 ? st.doc.gear.find((x) => x.id === st.sel[0]) : null;
      const cab = st.selCable ? st.doc.cables.find((c) => c.id === st.selCable) : null;
      const addBtn = () => { if (!st.edit || host.id === 'psh') return; const bt = document.createElement('button'); bt.className = 'btn paddbtn'; bt.innerHTML = icon('plus') + 'Add equipment'; bt.addEventListener('click', () => select(null)); host.prepend(bt); };
      if (cab) { cablePane(host, cab); return addBtn(); }
      if (g) { gearPane(host, g); return addBtn(); }
      if (st.sel && st.sel.length > 1) {
        const list = st.sel.map((id) => st.doc.gear.find((x) => x.id === id)).filter(Boolean);
        host.innerHTML = '<div class="pph"><button class="ghost pback" id="pbk2" title="Back">' + icon('x') + '</button><b>' + list.length + ' pieces of gear</b></div><div class="plist2">' + list.map((x) => '<button class="prow" data-pick="' + x.id + '"><b>' + esc(x.name) + '</b><span>' + esc([x.use, x.model].filter(Boolean).join(' · ')) + '</span></button>').join('') + '</div>';
        $$('[data-pick]', host).forEach((b) => b.addEventListener('click', () => select({ gear: [b.dataset.pick] })));
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
      host.innerHTML = '<div class="pph"><b>Add equipment</b></div><input type="search" id="pfind" placeholder="Find gear: SM58, AR2412, PSM…" class="pfind">' +
        (devs.length ? '<div class="pcat"><div class="pch">Your devices</div><div class="pitems">' + devs.map((d) => '<button class="pitem" data-dev="' + d.id + '"><b>' + esc(d.name) + '</b><span>' + esc([d.make, d.model].filter(Boolean).join(' ')) + '</span></button>').join('') + '</div></div>' : '') +
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

    function catalogFor(name) { const k = key(name); return P.CATALOG.flatMap((g) => g.items).find((it) => k && (k === key(it.model) || k.startsWith(key(it.model)) || k.includes(key(it.model)))); }
    function addDevice(d) {
      const it = catalogFor(d.model) || catalogFor(d.name) || { kind: d.inputs && d.outputs ? 'other' : d.outputs ? 'receiver' : 'other', make: d.make, model: d.model };
      const item = { ...it, name: d.name, make: d.make || it.make, model: d.model || it.model, device_id: d.id };
      if (d.inputs) item.nin = d.inputs; if (d.outputs) item.nout = d.outputs;
      if (it.kind === 'receiver' && d.outputs) item.nin = d.outputs;
      const g = change(() => P.addGear(st.doc, item), 'Added ' + d.name);
      select({ gear: [g.id] });
      focusGear(g.id);
    }
    async function addItem(it) {
      const k = P.KINDS[it.kind];
      const name = P.uniqueName(st.doc, it.model);
      let device_id = null;
      if (k.card) {
        // big gear gets a device card so the rest of LiveGenie (pages, map, IP lists) knows it
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
      const g = change(() => P.addGear(st.doc, { ...it, name, device_id }), 'Added ' + name);
      select({ gear: [g.id] });
      focusGear(g.id);
    }

    function gearPane(host, g0) {
      const gid = g0.id;
      const live = () => st.doc.gear.find((x) => x.id === gid);
      const g = g0;
      const k = P.KINDS[g.kind];
      const ix = P.index(st.doc);
      const ro = !st.edit;
      const fld = (f, label, val, extra) => '<label>' + label + '<input data-f="' + f + '" value="' + esc(val == null ? '' : val) + '"' + (ro ? ' disabled' : '') + (extra || '') + '></label>';
      const consoleMixes = () => { const cons = st.doc.gear.filter((x) => x.kind === 'console'); const list = [...new Set(cons.flatMap((c) => c.mixes || P.DEFAULT_MIXES))]; return list.length ? list : P.DEFAULT_MIXES; };
      const allOuts = () => st.doc.gear.filter((x) => x.id !== g.id && x.outs.length).map((x) => '<optgroup label="' + esc(x.name) + '">' + x.outs.map((p, j) => '<option value="' + x.id + ':' + j + '">' + esc(x.name + ' ' + p) + '</option>').join('') + '</optgroup>').join('');
      const allIns = () => st.doc.gear.filter((x) => x.id !== g.id && x.ins.length).map((x) => '<optgroup label="' + esc(x.name) + '">' + x.ins.map((p, i) => '<option value="' + x.id + ':' + i + '"' + (ix.into.get(x.id + ':' + i) ? ' class="taken"' : '') + '>' + esc(x.name + ' ' + p) + (ix.into.get(x.id + ':' + i) ? ' (in use)' : '') + '</option>').join('') + '</optgroup>').join('');
      const facts = [['Used for', g.use], ['Make', g.make], ['Model', g.model], ['Capsule', g.capsule], ['Frequency', g.freq && g.freq + ' MHz'], ['Mode', g.mode], ['Earphones', g.phones],
        ['Console inputs', g.kind === 'stagebox' ? (g.start || 1) + ' to ' + ((g.start || 1) + g.ins.length - 1) : ''], ['Section', g.group], ['Notes', g.notes]].filter((f) => f[1]);
      let html = '<div class="pph"><button class="ghost pback" id="pbk" title="Back">' + icon('x') + '</button><span class="pkind cat-' + k.cat + '">' + esc(k.label) + '</span></div>' +
        (ro ? '<h3 class="pname">' + esc(g.name) + '</h3><div class="pfacts">' + facts.map((f) => '<div><span>' + f[0] + '</span><b>' + esc(f[1]) + '</b></div>').join('') + '</div>' : '<div class="pform">' + fld('name', 'Name', g.name) +
        (k.fields.includes('use') ? fld('use', g.kind === 'bodypack' || g.kind === 'txmic' ? 'Person / used for' : 'Used for', g.use, ' placeholder="Kick, Pastor, Keys L"') : '') +
        fld('make', 'Make', g.make) + (k.fields.includes('model') ? fld('model', 'Model', g.model) : '') +
        (k.fields.includes('capsule') ? fld('capsule', 'Capsule', g.capsule, ' placeholder="Beta 58A, TL47"') : '') +
        (k.fields.includes('freq') ? fld('freq', 'Frequency (MHz)', g.freq, ' inputmode="decimal" placeholder="524.125"') : '') +
        (k.fields.includes('mode') ? '<label>Mode<select data-f="mode"' + (ro ? ' disabled' : '') + '><option' + (g.mode !== 'Mono' ? ' selected' : '') + '>Stereo</option><option' + (g.mode === 'Mono' ? ' selected' : '') + '>Mono</option></select></label>' : '') +
        (k.fields.includes('phones') ? fld('phones', 'Earphones', g.phones) : '') +
        (k.fields.includes('start') ? fld('start', 'Console input for In 1', g.start || 1, ' type="number" min="1"') : '') +
        (k.fields.includes('localstart') ? fld('localstart', 'Channel for local In 1', g.localstart || 1, ' type="number" min="1"') : '') +
        (k.fields.includes('mixes') ? '<label>Mixes <span class="note">(comma between)</span><textarea data-f="mixes" rows="2"' + (ro ? ' disabled' : '') + '>' + esc((g.mixes || P.DEFAULT_MIXES).join(', ')) + '</textarea></label>' : '') +
        (k.counts === 'both' ? '<div class="two">' + fld('nin', 'Inputs', g.ins.length, ' type="number" min="0" max="128"') + fld('nout', 'Outputs', g.outs.length, ' type="number" min="0" max="128"') + '</div>' : '') +
        (k.counts === 'ch' ? fld('nch', g.kind === 'amp' ? 'Channels' : 'Channels', g.ins.length, ' type="number" min="1" max="' + (g.kind === 'amp' ? 4 : 16) + '"') : '') +
        (k.counts === 'outs' ? fld('nout', 'Outputs', g.outs.length, ' type="number" min="1" max="' + (g.kind === 'di' ? 2 : 16) + '"') : '') +
        fld('group', 'Section', g.group, ' placeholder="Drums, Wireless, Band IEMs" list="pgrp"') + '<datalist id="pgrp">' + [...new Set(st.doc.gear.map((x) => x.group).filter(Boolean))].map((x) => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
        '<label>Column<select data-f="col"' + (ro ? ' disabled' : '') + '><option value="">Automatic (' + esc(P.COLS[k.col].title) + ')</option>' + P.COLS.map((c, i) => '<option value="' + i + '"' + (g.col === i ? ' selected' : '') + '>' + c.n + ' ' + esc(c.title) + '</option>').join('') + '</select></label>' +
        '<label>Notes<textarea data-f="notes" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(g.notes || '') + '</textarea></label></div>');
      // device card
      const dev = g.device_id && typeof DEV !== 'undefined' && DEV.list ? DEV.list.find((d) => d.id === g.device_id) : null;
      html += '<div class="pdev">' + (dev ? '<a class="btn abtn" href="#/d/' + dev.id + '">' + icon('box') + 'Device card: ' + esc(dev.name) + '</a>' : st.edit && k.card ? '<button class="btn" id="pmkdev">' + icon('box') + 'Make a device card</button>' : '') + '</div>';
      // sockets
      const feedable = g.kind === 'console' || g.kind === 'stagebox';
      if (g.ins.length || g.outs.length || k.link) {
        html += '<details class="psocks"' + (g.ins.length + g.outs.length <= 12 ? ' open' : '') + '><summary>Sockets · ' + g.ins.length + ' in, ' + g.outs.length + ' out</summary>';
        if (k.link) {
          const ls = (ix.links.get(g.id) || []);
          html += '<div class="psk"><b>Link</b><span>' + (ls.map(({ c, other }) => esc((ix.G.get(other) || {}).name || '') + (c.label ? ' (' + esc(c.label) + ')' : '') + (st.edit ? ' <button class="ghost xs" data-unlink="' + c.id + '">' + icon('x') + '</button>' : '')).join(', ') || '<span class="note">not linked</span>') + '</span>' +
            (st.edit ? '<select data-link><option value="">Link to…</option>' + st.doc.gear.filter((x) => x.id !== g.id && P.KINDS[x.kind].link).map((x) => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('') + '</select>' : '') + '</div>';
        }
        g.ins.forEach((p, i) => {
          const c = ix.into.get(g.id + ':' + i);
          const a = c && ix.G.get(c.a);
          const extra = g.kind === 'stagebox' ? ' <span class="note">→ ch ' + ((g.start || 1) + i) + '</span>' : g.kind === 'console' ? ' <span class="note">ch ' + ((g.localstart || 1) + i) + '</span>' : '';
          html += '<div class="psk"><b>' + esc(p) + extra + '</b><span>' + (a ? esc(a.name + ' ' + a.outs[c.ap]) + (a.use ? ' <span class="note">' + esc(a.use) + '</span>' : '') : '<span class="note">free</span>') + '</span>' +
            (st.edit ? '<select data-in="' + i + '"><option value="">' + (a ? 'Change…' : 'Connect from…') + '</option>' + (a ? '<option value="-">Disconnect</option>' : '') + allOuts() + '</select>' : '') + '</div>';
        });
        g.outs.forEach((p, j) => {
          const cs = ix.from.get(g.id + ':' + j) || [];
          html += '<div class="psk"><b>' + esc(p) + '</b><span>' + (feedable ? (st.edit ? '<select class="feed" data-feed="' + j + '"><option value="">No mix</option>' + consoleMixes().map((m) => '<option' + ((g.feeds || {})[j] === m ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + ((g.feeds || {})[j] && !consoleMixes().includes(g.feeds[j]) ? '<option selected>' + esc(g.feeds[j]) + '</option>' : '') + '</select> ' : (g.feeds || {})[j] ? '<b>' + esc(g.feeds[j]) + '</b> ' : '') : '') +
            (cs.map((c) => { const b = ix.G.get(c.b); return '→ ' + esc(b.name + ' ' + b.ins[c.bp]) + (st.edit ? ' <button class="ghost xs" data-cut="' + c.id + '" title="Disconnect">' + icon('x') + '</button>' : ''); }).join('<br>') || (feedable && st.edit ? '' : '<span class="note">free</span>')) + '</span>' +
            (st.edit ? '<select data-out="' + j + '"><option value="">Connect to…</option>' + allIns() + '</select>' : '') + '</div>';
        });
        html += '</details>';
      }
      if (st.edit) html += '<div class="pacts"><button class="ghost" id="pup">' + icon('up') + 'Up</button><button class="ghost" id="pdn">' + icon('down') + 'Down</button><span class="grow"></span><button class="ghost danger" id="pdel">' + icon('trash') + 'Remove</button></div>';
      host.innerHTML = html;
      $('#pbk', host).addEventListener('click', () => { select(null); const m = host.closest('.modal'); if (m) m.remove(); });
      if (!st.edit) return;
      $$('[data-f]', host).forEach((inp) => inp.addEventListener('change', () => {
        const f = inp.dataset.f, v = inp.value;
        const g = live(); if (!g) return;
        change(() => {
          if (f === 'nin') P.resize(st.doc, g, Math.max(0, Number(v) || 0), g.outs.length);
          else if (f === 'nout') P.resize(st.doc, g, g.ins.length, Math.max(0, Number(v) || 0));
          else if (f === 'nch') P.resize(st.doc, g, Math.max(1, Number(v) || 1), Math.max(1, Number(v) || 1));
          else if (f === 'mode') { g.mode = v; P.resize(st.doc, g, null, null); }
          else if (f === 'mixes') g.mixes = v.split(',').map((x) => x.trim()).filter(Boolean);
          else if (f === 'col') { if (v === '') delete g.col; else g.col = Number(v); }
          else if (f === 'start' || f === 'localstart') g[f] = Math.max(1, Number(v) || 1);
          else if (f === 'name') g.name = v.trim() || g.name;
          else { if (v.trim()) g[f] = v.trim(); else delete g[f]; }
        }, null, !['nin', 'nout', 'nch', 'mode'].includes(f));
      }));
      $$('[data-in]', host).forEach((sel) => sel.addEventListener('change', () => {
        const i = Number(sel.dataset.in), v = sel.value; if (!v) return;
        if (v === '-') return change(() => { st.doc.cables = st.doc.cables.filter((c) => !(c.b === gid && c.bp === i)); }, 'Disconnected');
        const [aid, ap] = v.split(':'); const a = st.doc.gear.find((x) => x.id === aid);
        change(() => P.connect(st.doc, a, Number(ap), live(), i), 'Connected');
      }));
      $$('[data-out]', host).forEach((sel) => sel.addEventListener('change', () => {
        const j = Number(sel.dataset.out), v = sel.value; if (!v) return;
        const [bid, bp] = v.split(':'); const b = st.doc.gear.find((x) => x.id === bid);
        change(() => P.connect(st.doc, live(), j, b, Number(bp)), 'Connected');
      }));
      $$('[data-feed]', host).forEach((sel) => sel.addEventListener('change', () => { const j = Number(sel.dataset.feed); change(() => { const g = live(); g.feeds = g.feeds || {}; if (sel.value) g.feeds[j] = sel.value; else delete g.feeds[j]; }, null, true); }));
      $$('[data-cut]', host).forEach((b) => b.addEventListener('click', () => change(() => { st.doc.cables = st.doc.cables.filter((c) => c.id !== b.dataset.cut); }, 'Disconnected')));
      $$('[data-unlink]', host).forEach((b) => b.addEventListener('click', () => change(() => { st.doc.cables = st.doc.cables.filter((c) => c.id !== b.dataset.unlink); }, 'Unlinked')));
      const lk = $('[data-link]', host);
      if (lk) lk.addEventListener('change', () => { const b = st.doc.gear.find((x) => x.id === lk.value); if (b) change(() => P.connect(st.doc, live(), 'link', b, 'link', { label: linkLabel(live(), b) }), 'Linked'); });
      const md = $('#pmkdev', host);
      if (md) md.addEventListener('click', async () => {
        try {
          await loadDevices();
          const ex = DEV.list.find((d) => key(d.name) === key(g.name));
          const id = ex ? ex.id : (await call('POST', '/api/devices', { name: g.name, category: 'audio', make: g.make || '', model: g.model || '', inputs: g.ins.length, outputs: g.outs.length })).id;
          if (typeof forgetDevices === 'function') forgetDevices(); await loadDevices(true);
          change(() => { live().device_id = id; }, 'Device card ready');
        } catch (e) { toast(e.message, 'bad'); }
      });
      $('#pdel', host).addEventListener('click', () => removeGear(gid));
      const move = (dir) => change(() => {
        const g = live();
        const col = P.colOf(g);
        const same = st.doc.gear.filter((x) => P.colOf(x) === col).sort((p, q) => (p.order || 0) - (q.order || 0));
        const i = same.indexOf(g), j = i + dir;
        if (j < 0 || j >= same.length) return;
        const t = same[j].order; same[j].order = g.order; g.order = t;
        if (same[j].order === g.order) g.order += dir;
      }, null, true);
      $('#pup', host).addEventListener('click', () => move(-1));
      $('#pdn', host).addEventListener('click', () => move(1));
    }
    function removeGear(id) {
      const g = st.doc.gear.find((x) => x.id === id);
      if (!g) return;
      const n = st.doc.cables.filter((c) => c.a === id || c.b === id).length;
      st.sel = null;
      change(() => P.removeGear(st.doc, id), 'Removed ' + g.name + (n ? ' and its ' + n + ' cable' + (n === 1 ? '' : 's') : '') + '. Undo brings it back.');
      const m = document.querySelector('.modal.psheet'); if (m) m.remove();
    }
    function cablePane(host, c) {
      const a = st.doc.gear.find((g) => g.id === c.a), b = st.doc.gear.find((g) => g.id === c.b);
      const ro = !st.edit;
      host.innerHTML = '<div class="pph"><button class="ghost pback" id="pbk">' + icon('x') + '</button><span class="pkind">Cable</span></div>' +
        '<p class="pcab"><b>' + esc(a.name + (c.ap === 'link' ? '' : ' ' + a.outs[c.ap])) + '</b><br>→ <b>' + esc(b.name + (c.bp === 'link' ? '' : ' ' + b.ins[c.bp])) + '</b></p><div class="pform">' +
        '<label>Type<select data-c="kind"' + (ro ? ' disabled' : '') + '>' + Object.entries(KIND_STYLE).map(([k, v]) => '<option value="' + k + '"' + (c.kind === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label>' +
        '<label>' + (c.ap === 'link' ? 'Link name (SLink, AES50, Dante)' : 'Label') + '<input data-c="label" value="' + esc(c.label || '') + '"' + (ro ? ' disabled' : '') + '></label>' +
        '<label>Length<input data-c="length" value="' + esc(c.length || '') + '" placeholder="25 ft"' + (ro ? ' disabled' : '') + '></label>' +
        '<label>Notes<textarea data-c="notes" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(c.notes || '') + '</textarea></label></div>' +
        (st.edit ? '<div class="pacts"><span class="grow"></span><button class="ghost danger" id="pcdel">' + icon('trash') + 'Remove cable</button></div>' : '');
      $('#pbk', host).addEventListener('click', () => { select(null); const m = host.closest('.modal'); if (m) m.remove(); });
      if (!st.edit) return;
      $$('[data-c]', host).forEach((inp) => inp.addEventListener('change', () => change(() => { const cc = st.doc.cables.find((x) => x.id === c.id); if (inp.value.trim()) cc[inp.dataset.c] = inp.value.trim(); else delete cc[inp.dataset.c]; }, null, true)));
      $('#pcdel', host).addEventListener('click', () => { st.selCable = null; change(() => { st.doc.cables = st.doc.cables.filter((x) => x.id !== c.id); }, 'Cable removed'); const m = document.querySelector('.modal.psheet'); if (m) m.remove(); });
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
    $$('#pmode button').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.m; $$('#pmode button').forEach((x) => x.classList.toggle('on', x === b)); paint(false); }));
    $$('#prt button').forEach((b) => b.addEventListener('click', () => { st.report = b.dataset.r; $$('#prt button').forEach((x) => x.classList.toggle('on', x === b)); paintReport(); }));
    $('#psp').addEventListener('change', (e) => { st.spares = e.target.checked; paintReport(); });
    const pe = $('#pedit');
    const setEdit = (on) => {
      st.edit = on;
      document.body.classList.toggle('patchedit', on);
      if (pe) { pe.classList.toggle('primary', on); pe.querySelector('span').textContent = on ? 'Done' : 'Edit'; }
      $('#ptools').classList.toggle('hide', !on);
      $('#padd').classList.toggle('hide', !on);
      if (on && st.mode === 'overview' && wide()) { st.mode = 'sockets'; $$('#pmode button').forEach((x) => x.classList.toggle('on', x.dataset.m === 'sockets')); }
      paintTitle(); paint(false); paintPane();
    };
    if (pe) pe.addEventListener('click', () => setEdit(!st.edit));
    $('#pun').addEventListener('click', undo); $('#pre').addEventListener('click', redo);
    $('#padd').addEventListener('click', () => sheet(true));
    $('#ppdf').addEventListener('click', () => {
      select(null);
      const before = st.tf; const W = Number(svg.dataset.w), H = Number(svg.dataset.h);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); vp.removeAttribute('transform'); svg.classList.add('printing');
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
          try { const r = await call('POST', '/api/patch/versions/' + b.dataset.rv + '/restore'); st.doc = r.doc; st.version = r.version; st.undo = []; st.redo = []; close(); paint(true); paintPane(); toast('Restored version ' + b.dataset.rv, 'ok'); }
          catch (e) { toast(e.message, 'bad'); }
        }));
      });
    });

    paintTitle();
    paint(false);
    paintPane();
    if (qs && qs.get('g')) { select({ gear: [qs.get('g')] }); focusGear(qs.get('g')); }
    if (qs && qs.get('edit') && canEdit) setEdit(true);
    window.addEventListener('resize', function rs() { if (!svg.isConnected) return window.removeEventListener('resize', rs); });
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

  return { view, reportHtml, blockHtml, wireBlocks, REPORTS, layout, edges, trace, load };
})();
