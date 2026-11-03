/*
 * The stage patch: one drawing for the whole system. Shared by the server and the browser.
 *
 * A patch is { title, subtitle, gear: [...], cables: [...] }.
 *   gear   { id, kind, name, make, model, device_id, group, use, person, capsule, freq, mode, phones,
 *            localstart, mixes, x, y, open, order, notes, ins: [names], outs: [names], feeds: { outIndex: mix },
 *            chmap: { inIndex: console channel } (stage boxes: which console channel each input lands on, set by hand) }
 *   x, y  where the card sits in the drawing (missing: placed automatically); open: card shows every socket
 *   cable  { id, a, ap, b, bp, kind, label, length, notes, port }
 *          from gear a output ap (index, or 'link') to gear b input bp (index, or 'link');
 *          a network cable: ap = bp = 'net', b is the switch, port = the switch port it plugs into (1, 2…)
 * Everything else (input list, output list, wireless, in-ears, cable list, checks) is worked out from it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PatchCore = factory();
})(this, function () {
  'use strict';

  // columns, left to right; the drawing numbers the ones in use (01, 02, …)
  // where Tidy puts each kind, left to right (the signal flow)
  const COLS = [
    { title: 'Sources' }, { title: 'Wireless' }, { title: 'Stage I/O' }, { title: 'Network' },
    { title: 'Mix' }, { title: 'Processing' }, { title: 'Amps · IEM' }, { title: 'Speakers · monitors' }
  ];
  const CATS = {
    source: { label: 'Sources', color: '#2ec4b6' }, io: { label: 'Stage I/O', color: '#4c8dff' }, computer: { label: 'Computers', color: '#8b6cff' },
    console: { label: 'Consoles', color: '#c45cf2' }, iem: { label: 'IEM gear', color: '#ec6aa8' }, pa: { label: 'PA · amps · speakers', color: '#ef8a3c' },
    net: { label: 'Network', color: '#6f6cf6' }
  };
  const CABLES = {
    xlr: { label: 'Analog · XLR' }, link: { label: 'Digital snake · SLink, AES50' }, dante: { label: 'Dante · Cat6' }, aes: { label: 'AES3 · 110 Ω' },
    speaker: { label: 'Speaker · NL4' }, wiem: { label: 'Wired IEM' }, rf: { label: 'Wireless · RF' }, net: { label: 'Network · Cat6' }
  };
  const nums = (prefix, k) => Array.from({ length: Math.max(0, Math.min(128, Number(k) || 0)) }, (_, i) => prefix + (i + 1));
  const DEFAULT_MIXES = ['LR', 'Mix 1', 'Mix 2', 'Mix 3', 'Mix 4', 'Mix 5', 'Mix 6', 'Mix 7', 'Mix 8', 'Mix 9', 'Mix 10', 'Mix 11', 'Mix 12'];

  /*
   * Kinds of gear. col = column it sits in; cat = card colour; ports(g) = default sockets; fields = what it asks for;
   * pass = how a signal gets through it (for tracing): 'same' (input n to output n), 'all' (any input to every output), 'rf' (inputs to its radio link).
   * card: big gear that gets a card in the Gear Locker.
   */
  const KINDS = {
    mic: { label: 'Mic', col: 0, cat: 'source', ports: () => ({ ins: [], outs: ['Out'] }), fields: ['use', 'person', 'model'], counts: false },
    di: { label: 'DI', col: 0, cat: 'source', ports: (g) => ({ ins: [], outs: g.nout === 2 ? ['L', 'R'] : ['Out'] }), fields: ['use', 'person', 'model'], counts: 'outs' },
    source: { label: 'Line source', col: 0, cat: 'source', ports: (g) => ({ ins: [], outs: g.nout === 1 ? ['Out'] : ['L', 'R'].concat(nums('Out ', (g.nout || 2) - 2).map((x, i) => 'Out ' + (i + 3))) }), fields: ['use', 'person', 'model'], counts: 'outs' },
    txmic: { label: 'Wireless mic', col: 0, cat: 'source', ports: () => ({ ins: [], outs: ['RF'] }), fields: ['use', 'person', 'txtype', 'model', 'capsule', 'freq'], counts: false, member: 'receiver' },
    receiver: { label: 'Wireless receiver', col: 1, cat: 'io', ports: (g) => ({ ins: nums('Ch ', g.nin || 2), outs: nums('Out ', g.nin || 2) }), fields: ['model'], counts: 'ch', pass: 'same', card: true },
    stagebox: { label: 'Stage box', col: 2, cat: 'io', ports: (g) => ({ ins: nums('In ', g.nin || 16), outs: nums('Out ', g.nout || 8) }), fields: ['model'], counts: 'both', link: true, card: true },
    network: { label: 'Network switch', col: 3, cat: 'net', ports: () => ({ ins: [], outs: [] }), fields: ['model'], counts: 'ports', link: true, card: true },
    console: { label: 'Console', col: 4, cat: 'console', ports: (g) => ({ ins: nums('In ', g.nin || 16), outs: nums('Out ', g.nout || 12) }), fields: ['model', 'localstart', 'mixes'], counts: 'both', link: true, card: true },
    computer: { label: 'Computer · recorder', col: 4, cat: 'computer', ports: (g) => ({ ins: nums('In ', g.nin || 2), outs: nums('Out ', g.nout || 2) }), fields: ['model', 'use'], counts: 'both', link: true },
    processor: { label: 'Speaker processor', col: 5, cat: 'pa', ports: (g) => ({ ins: g.nin === 1 ? ['In'] : Array.from({ length: Math.min(8, g.nin || 2) }, (_, i) => 'In ' + 'ABCDEFGH'[i]), outs: nums('Out ', g.nout || 6) }), fields: ['model'], counts: 'both', pass: 'all', card: true },
    amp: { label: 'Amplifier', col: 6, cat: 'pa', ports: (g) => { const c = ['Ch A', 'Ch B', 'Ch C', 'Ch D'].slice(0, g.nin || 2); return { ins: c, outs: c.slice() }; }, fields: ['model'], counts: 'ch', pass: 'same', card: true },
    iemtx: { label: 'IEM transmitter', col: 6, cat: 'iem', ports: (g) => ({ ins: g.mode === 'Mono' ? ['In'] : ['L', 'R'], outs: ['RF'] }), fields: ['model', 'mode', 'freq'], counts: false, pass: 'rf', card: true },
    headamp: { label: 'Wired IEM amp', col: 6, cat: 'iem', ports: (g) => ({ ins: ['L', 'R'], outs: ['Phones'] }), fields: ['use', 'person', 'model'], counts: false, pass: 'all' },
    speaker: { label: 'Speaker', col: 7, cat: 'pa', ports: () => ({ ins: ['In'], outs: [] }), fields: ['model'], counts: false },
    wedge: { label: 'Wedge', col: 7, cat: 'pa', ports: () => ({ ins: ['In'], outs: [] }), fields: ['use', 'person', 'model'], counts: false },
    bodypack: { label: 'IEM pack', col: 7, cat: 'iem', ports: () => ({ ins: ['RF'], outs: [] }), fields: ['use', 'person', 'model', 'phones'], counts: false, member: 'iemtx' },
    other: { label: 'Other', col: 4, cat: 'computer', ports: (g) => ({ ins: nums('In ', g.nin == null ? 1 : g.nin), outs: nums('Out ', g.nout == null ? 1 : g.nout) }), fields: ['model', 'use'], counts: 'both', pass: 'all' }
  };
  const FIELD_LABELS = { use: 'Used for', person: 'Who uses it', txtype: 'Transmitter type', capmake: 'Capsule make', model: 'Model', capsule: 'Capsule', freq: 'Frequency', mode: 'Mode', phones: 'Earphones', start: 'Console input for In 1', localstart: 'Channel for local In 1', mixes: 'Mixes' };

  /**
   * The signal stage each kind sits in, left to right: sources, stage I/O, console, processing, amps, outputs.
   * Network gear (switches, computers) has its own lane ('net').
   */
  const STAGES = ['Sources', 'Stage I/O', 'Console', 'Processing', 'Amps', 'Outputs'];
  const STAGE_OF = { mic: 0, di: 0, source: 0, txmic: 0, receiver: 0, stagebox: 1, console: 2, processor: 3, other: 3, amp: 4, headamp: 4, speaker: 5, wedge: 5, iemtx: 5, bodypack: 5, network: 'net', computer: 'net' };
  const stageOf = (g) => (STAGE_OF[g && g.kind] != null ? STAGE_OF[g.kind] : 3);

  /** Kinds in the order the "New gear" form offers them. Makes and models come from the team's own list (it starts empty). */
  const KIND_ORDER = ['console', 'stagebox', 'receiver', 'txmic', 'mic', 'di', 'source', 'iemtx', 'bodypack', 'headamp', 'processor', 'amp', 'speaker', 'wedge', 'network', 'computer', 'other'];

  const str = (v, n) => String(v == null ? '' : v).slice(0, n || 200);
  const key = (v) => String(v || '').trim().toLowerCase();
  /** Names compared the way people read them: case, spaces, dashes and dots do not count (same as Tags.norm). */
  const tagKey = (s) => String(s || '').toLowerCase().replace(/[\s\-_.·/]+/g, '');

  /** Make the sockets for a gear from its kind and counts. */
  function portsFor(g) {
    const k = KINDS[g.kind] || KINDS.other;
    return k.ports(g);
  }

  /** A clean, valid patch (the server stores only this). */
  function clean(doc) {
    doc = doc && typeof doc === 'object' ? doc : {};
    const out = { title: str(doc.title || 'Signal flow, mic to speaker', 120), subtitle: str(doc.subtitle, 400), gear: [], cables: [] };
    const ids = new Set();
    for (const g0 of Array.isArray(doc.gear) ? doc.gear.slice(0, 600) : []) {
      if (!g0 || !KINDS[g0.kind]) continue;
      let id = str(g0.id, 24).replace(/[^\w-]/g, '');
      if (!id || ids.has(id)) id = 'g' + Math.random().toString(36).slice(2, 9);
      ids.add(id);
      const g = { id, kind: g0.kind, name: str(g0.name, 80).trim() || KINDS[g0.kind].label };
      for (const f of ['make', 'model', 'group', 'use', 'person', 'txtype', 'capsule', 'capmake', 'freq', 'mode', 'phones', 'notes']) if (g0[f] != null && String(g0[f]).trim()) g[f] = str(g0[f], f === 'notes' ? 1000 : 80).trim();
      if (Number.isInteger(Number(g0.device_id)) && Number(g0.device_id) > 0) g.device_id = Number(g0.device_id);
      if (Number(g0.localstart) >= 1) g.localstart = Math.min(512, Math.floor(Number(g0.localstart)));
      if (g0.kind === 'stagebox' && Number(g0.start) >= 1 && !(g0.chmap && Object.keys(g0.chmap).length)) g._start = Math.min(512, Math.floor(Number(g0.start)));   // older drawings: becomes a channel map below
      for (const f of ['x', 'y']) if (g0[f] != null && g0[f] !== '' && Number.isFinite(Number(g0[f]))) g[f] = Math.round(Math.max(-20000, Math.min(20000, Number(g0[f]))));
      if (g0.open) g.open = true;
      // a wireless mic or pack kept as a spare (drawn greyed, not counted as in use), and a wireless system shown folded
      if (g0.spare && (g0.kind === 'txmic' || g0.kind === 'bodypack')) g.spare = true;
      if (g0.wlshut && (g0.kind === 'receiver' || g0.kind === 'iemtx')) g.wlshut = true;
      // the console channel this source is on: its name and colour on the desk (WMIC-1, Kyle; Red)
      if (str(g0.chname, 32).trim()) g.chname = str(g0.chname, 32).trim();
      if (str(g0.chcolor, 24).trim()) g.chcolor = str(g0.chcolor, 24).trim();
      // a console: how long a channel name can be, and the colours it has (set when it was added)
      if (Number(g0.namelen) >= 1) g.namelen = Math.min(64, Math.floor(Number(g0.namelen)));
      if (g0.kind === 'network') g.nports = Math.max(1, Math.min(128, Math.floor(Number(g0.nports)) || 8));
      if (Array.isArray(g0.colors)) { const c = g0.colors.map((x) => str(x, 24).trim()).filter(Boolean).slice(0, 32); if (c.length) g.colors = c; }
      g.order = Number.isFinite(Number(g0.order)) ? Number(g0.order) : 0;
      if (Array.isArray(g0.mixes)) g.mixes = g0.mixes.map((x) => str(x, 40).trim()).filter(Boolean).slice(0, 96);
      g.ins = (Array.isArray(g0.ins) ? g0.ins : portsFor(g0).ins).slice(0, 128).map((x) => str(x, 24));
      g.outs = (Array.isArray(g0.outs) ? g0.outs : portsFor(g0).outs).slice(0, 128).map((x) => str(x, 24));
      g.feeds = {};
      if (g0.feeds && typeof g0.feeds === 'object') for (const [k, v] of Object.entries(g0.feeds)) if (Number(k) >= 0 && Number(k) < g.outs.length && String(v || '').trim()) g.feeds[Number(k)] = str(v, 40).trim();
      if (g.kind === 'stagebox') {
        g.chmap = {};
        if (g0.chmap && typeof g0.chmap === 'object') for (const [k, v] of Object.entries(g0.chmap)) if (Number(k) >= 0 && Number(k) < g.ins.length && Number(v) >= 1) g.chmap[Number(k)] = Math.min(512, Math.floor(Number(v)));
      }
      out.gear.push(g);
    }
    const byId = new Map(out.gear.map((g) => [g.id, g]));
    const cids = new Set();
    const taken = new Set(), netUsed = new Set();
    for (const c0 of Array.isArray(doc.cables) ? doc.cables.slice(0, 3000) : []) {
      if (!c0) continue;
      let a = byId.get(c0.a), b = byId.get(c0.b);
      if (!a || !b || a === b) continue;
      if (c0.ap === 'net' || c0.bp === 'net') {
        // a network cable: from a piece of gear's network socket to a switch port (the switch is always b)
        if (a.kind === 'network' && b.kind !== 'network') [a, b] = [b, a];
        if (b.kind !== 'network') continue;
        const port = Number(c0.port) >= 1 && Number(c0.port) <= (b.nports || 8) ? Math.floor(Number(c0.port)) : null;
        if (netUsed.has(a.id) || (port && netUsed.has(b.id + ':' + port))) continue;
        netUsed.add(a.id); if (port) netUsed.add(b.id + ':' + port);
        let nid = str(c0.id, 24).replace(/[^\w-]/g, '');
        if (!nid || cids.has(nid)) nid = 'c' + Math.random().toString(36).slice(2, 9);
        cids.add(nid);
        const nc = { id: nid, a: a.id, ap: 'net', b: b.id, bp: 'net', kind: 'net' };
        if (port) nc.port = port;
        for (const f of ['label', 'length', 'notes']) if (c0[f] != null && String(c0[f]).trim()) nc[f] = str(c0[f], f === 'notes' ? 500 : 60).trim();
        out.cables.push(nc);
        continue;
      }
      const ap = c0.ap === 'link' ? 'link' : Number(c0.ap), bp = c0.bp === 'link' ? 'link' : Number(c0.bp);
      if (ap === 'link' ? !(KINDS[a.kind].link) : !(ap >= 0 && ap < a.outs.length)) continue;
      if (bp === 'link' ? !(KINDS[b.kind].link) : !(bp >= 0 && bp < b.ins.length)) continue;
      const slot = b.id + ':' + bp;
      // an input socket takes one cable; a spare wireless mic can sit on a receiver channel next to the live one
      const spareRf = a.spare && (c0.kind === 'rf' || b.kind === 'receiver');
      if (bp !== 'link' && taken.has(slot) && !spareRf) continue;
      if (!spareRf) taken.add(slot);
      let id = str(c0.id, 24).replace(/[^\w-]/g, '');
      if (!id || cids.has(id)) id = 'c' + Math.random().toString(36).slice(2, 9);
      cids.add(id);
      const c = { id, a: a.id, ap, b: b.id, bp, kind: CABLES[c0.kind] && c0.kind !== 'net' ? c0.kind : guessCable(a, ap, b, bp) };
      for (const f of ['label', 'length', 'notes']) if (c0[f] != null && String(c0[f]).trim()) c[f] = str(c0[f], f === 'notes' ? 500 : 60).trim();
      out.cables.push(c);
    }
    // an older stage box said "In 1 is console input N": its used inputs keep their channels, the rest stay free to assign
    for (const g of out.gear) if (g._start) {
      g.ins.forEach((_, i) => { if (out.cables.some((c) => c.b === g.id && c.bp === i)) g.chmap[i] = g._start + i; });
      delete g._start;
    }
    return out;
  }

  /** The cable type a new connection most likely is. */
  function guessCable(a, ap, b, bp) {
    if (ap === 'link' || bp === 'link') return (a.kind === 'network' || b.kind === 'network') ? 'dante' : 'link';
    if (a.kind === 'txmic' || a.kind === 'iemtx') return 'rf';
    if (a.kind === 'amp' && (b.kind === 'speaker' || b.kind === 'wedge')) return 'speaker';
    if (a.kind === 'headamp') return 'wiem';
    return 'xlr';
  }

  // ---------- building ----------
  function uid(p) { return p + Math.random().toString(36).slice(2, 9); }
  function uniqueName(doc, base) {
    const taken = new Set(doc.gear.map((g) => key(g.name)));
    if (!taken.has(key(base))) return base;
    for (let i = 2; ; i++) if (!taken.has(key(base + ' #' + i))) return base + ' #' + i;
  }
  /** Add a piece of gear made from a catalog item or plain fields. */
  function addGear(doc, item) {
    const kind = KINDS[item.kind] ? item.kind : 'other';
    const g = { id: uid('g'), kind, name: uniqueName(doc, String(item.name || item.model || KINDS[kind].label).trim()) };
    for (const f of ['make', 'model', 'group', 'use', 'person', 'txtype', 'capsule', 'capmake', 'freq', 'mode', 'phones', 'notes', 'localstart', 'device_id', 'x', 'y', 'chname', 'chcolor', 'namelen']) if (item[f] != null && item[f] !== '') g[f] = item[f];
    if (Array.isArray(item.colors) && item.colors.length) g.colors = item.colors.slice();
    if (item.spare && (kind === 'txmic' || kind === 'bodypack')) g.spare = true;
    if (kind === 'console') g.mixes = (item.mixes || DEFAULT_MIXES).slice();
    if (kind === 'iemtx' && !g.mode) g.mode = 'Stereo';
    if (kind === 'network') g.nports = Math.max(1, Math.min(128, Math.floor(Number(item.nports)) || 8));
    const p = portsFor({ ...g, nin: item.nin, nout: item.nout });
    g.ins = item.ins || p.ins; g.outs = item.outs || p.outs; g.feeds = {};
    // a stage box's inputs reach console channels only when someone assigns them (start: assign the whole box from that channel)
    if (kind === 'stagebox') { g.chmap = {}; if (Number(item.start) >= 1) g.ins.forEach((_, i) => { g.chmap[i] = Number(item.start) + i; }); }
    g.order = doc.gear.reduce((m, x) => Math.max(m, x.order || 0), 0) + 1;
    doc.gear.push(g);
    return g;
  }
  /** Change how many sockets a gear has; cables on sockets that go away are removed. */
  function resize(doc, g, nin, nout) {
    const p = portsFor({ ...g, nin, nout });
    g.ins = p.ins; g.outs = p.outs;
    doc.cables = doc.cables.filter((c) => !((c.b === g.id && c.bp !== 'link' && c.bp >= g.ins.length) || (c.a === g.id && c.ap !== 'link' && c.ap >= g.outs.length)));
    for (const k of Object.keys(g.feeds || {})) if (Number(k) >= g.outs.length) delete g.feeds[k];
    for (const k of Object.keys(g.chmap || {})) if (Number(k) >= g.ins.length) delete g.chmap[k];
  }
  /** Removing gear also removes the mics or packs that live inside it (a receiver's handhelds, a transmitter's packs). */
  function removeGear(doc, id) {
    const gone = new Set([id, ...members(doc, doc.gear.find((g) => g.id === id)).map((m) => m.g.id)]);
    doc.gear = doc.gear.filter((g) => !gone.has(g.id));
    doc.cables = doc.cables.filter((c) => !gone.has(c.a) && !gone.has(c.b));
  }

  // ---------- wireless systems ----------
  /**
   * A wireless system is one card: a receiver with the mics on its channels, or an IEM transmitter with its packs.
   * The radio link is an rf cable underneath; members are not drawn as cards of their own.
   */
  function members(doc, host) {
    if (!host) return [];
    const G = gearBy(doc);
    if (host.kind === 'receiver') return doc.cables.filter((c) => c.b === host.id && c.kind === 'rf').map((c) => ({ g: G.get(c.a), port: c.bp, cable: c })).filter((m) => m.g && m.g.kind === 'txmic').sort((p, q) => p.port - q.port);
    if (host.kind === 'iemtx') return doc.cables.filter((c) => c.a === host.id && c.kind === 'rf').map((c) => ({ g: G.get(c.b), port: 0, cable: c })).filter((m) => m.g && m.g.kind === 'bodypack');
    return [];
  }
  /** The receiver or transmitter a mic or pack lives in (null when it stands on its own). */
  function hostOf(doc, g) {
    if (!g || !KINDS[g.kind].member) return null;
    const c = g.kind === 'txmic' ? doc.cables.find((x) => x.a === g.id && x.kind === 'rf') : doc.cables.find((x) => x.b === g.id && x.kind === 'rf');
    if (!c) return null;
    const h = doc.gear.find((x) => x.id === (g.kind === 'txmic' ? c.b : c.a));
    return h && h.kind === KINDS[g.kind].member ? h : null;
  }
  /** Put a new handheld or bodypack on a receiver channel (the first free one, or ch), or a new pack on an IEM transmitter. */
  function addMember(doc, host, item, ch) {
    if (host.kind === 'receiver') {
      const used = new Set(members(doc, host).filter((m) => !m.g.spare).map((m) => m.port));
      const port = ch != null ? ch : host.ins.findIndex((_, i) => !used.has(i));
      if (port < 0) return null;
      const g = addGear(doc, { kind: 'txmic', model: 'Handheld', ...item, name: item.name || (item.person ? item.person + ' mic' : host.name + ' ' + host.ins[port] + ' mic') });
      connect(doc, g, 0, host, port, { kind: 'rf' });
      return g;
    }
    if (host.kind === 'iemtx') {
      const g = addGear(doc, { kind: 'bodypack', model: 'IEM pack', ...item, name: item.name || (item.person ? item.person + ' pack' : host.name + ' pack') });
      connect(doc, host, 0, g, 0, { kind: 'rf' });
      return g;
    }
    return null;
  }

  // ---------- stage box channels ----------
  /** Assign stage box inputs from..to (indexes) to console channels starting at first. */
  function assignChannels(sb, from, to, first) {
    sb.chmap = sb.chmap || {};
    for (let i = from; i <= to && i < sb.ins.length; i++) {
      if (first == null) delete sb.chmap[i];
      else sb.chmap[i] = first + (i - from);
    }
  }
  const chanOf = (sb, i) => (sb.chmap && sb.chmap[i] != null ? sb.chmap[i] : null);
  /** Connect an output (or link) to an input (or link). An input takes one cable: an old one there is replaced. */
  function connect(doc, a, ap, b, bp, extra) {
    if (!a || !b || a === b) return null;
    // an input takes one cable (a spare wireless mic shares its channel with the live one)
    const G0 = new Map(doc.gear.map((g) => [g.id, g]));
    if (bp !== 'link') doc.cables = doc.cables.filter((c) => !(c.b === b.id && c.bp === bp && !(a.spare || (G0.get(c.a) || {}).spare)));
    else doc.cables = doc.cables.filter((c) => !(c.a === a.id && c.b === b.id && c.ap === 'link' && c.bp === 'link'));
    const c = { id: uid('c'), a: a.id, ap, b: b.id, bp, kind: (extra && extra.kind) || guessCable(a, ap, b, bp) };
    if (extra) for (const f of ['label', 'length', 'notes']) if (extra[f]) c[f] = extra[f];
    doc.cables.push(c);
    return c;
  }
  /** A network cable from gear's network socket to a switch port (port 1, 2…; null = not set). One per gear, one per port. */
  function connectNet(doc, g, sw, port) {
    if (!g || !sw || g === sw) return null;
    if (g.kind === 'network' && sw.kind !== 'network') [g, sw] = [sw, g];
    if (sw.kind !== 'network') return null;
    doc.cables = doc.cables.filter((c) => !(c.ap === 'net' && (c.a === g.id || (port && c.b === sw.id && c.port === port))));
    const c = { id: uid('c'), a: g.id, ap: 'net', b: sw.id, bp: 'net', kind: 'net' };
    if (port) c.port = port;
    doc.cables.push(c);
    return c;
  }
  /** The network cable on a piece of gear's network socket (it plugs into a switch). */
  const netOf = (doc, g) => doc.cables.find((c) => c.ap === 'net' && c.a === g.id) || null;
  const gearBy = (doc) => new Map(doc.gear.map((g) => [g.id, g]));
  const findGear = (doc, name) => doc.gear.find((g) => key(g.name) === key(name));
  const freeIn = (doc, g, from) => { for (let i = from || 0; i < g.ins.length; i++) if (!doc.cables.some((c) => c.b === g.id && c.bp === i)) return i; return -1; };

  // ---------- tracing ----------
  function index(doc) {
    const G = gearBy(doc);
    const into = new Map(), from = new Map(), links = new Map();
    for (const c of doc.cables) {
      if (c.ap === 'net') continue;          // network cables carry no audio
      if (c.ap === 'link' || c.bp === 'link') {
        if (!links.has(c.a)) links.set(c.a, []); if (!links.has(c.b)) links.set(c.b, []);
        links.get(c.a).push({ c, other: c.b }); links.get(c.b).push({ c, other: c.a });
        continue;
      }
      // a spare on a receiver channel never stands in for the live mic
      const ik = c.b + ':' + c.bp, cur = into.get(ik);
      if (!cur || ((G.get(cur.a) || {}).spare && !(G.get(c.a) || {}).spare)) into.set(ik, c);
      const k = c.a + ':' + c.ap;
      if (!from.has(k)) from.set(k, []);
      from.get(k).push(c);
    }
    /** The consoles a stage box (or computer) reaches over links, directly or through a Dante network. */
    const consolesOf = (id) => {
      const seen = new Set([id]), out = [];
      const walk = (x) => (links.get(x) || []).forEach(({ other }) => {
        if (seen.has(other)) return; seen.add(other);
        const g = G.get(other); if (!g) return;
        if (g.kind === 'console') out.push(g);
        else if (g.kind === 'network') walk(other);
      });
      walk(id);
      return out;
    };
    const linkName = (a, b) => {
      const l = (links.get(a) || []).find((x) => x.other === b) || (links.get(a) || []).find((x) => G.get(x.other) && G.get(x.other).kind === 'network');
      return l ? (l.c.label || CABLES[l.c.kind].label.split(' · ')[0]) : '';
    };
    return { G, into, from, links, consolesOf, linkName };
  }

  /** What feeds an input socket, walked back to where the sound starts. */
  function upstream(doc, ix, gid, inp) {
    const r = { chain: [] };
    let c = ix.into.get(gid + ':' + inp), guard = 0;
    while (c && guard++ < 12) {
      const g = ix.G.get(c.a);
      if (!g) break;
      r.chain.unshift(g);
      if (g.kind === 'receiver') { r.receiver = g; r.rxch = g.ins[c.ap] || ''; c = ix.into.get(g.id + ':' + c.ap); continue; }
      if (g.kind === 'txmic') { r.tx = g; r.src = g; r.source = g.use || ''; r.person = g.person || ''; r.mic = g.name; r.capsule = g.capsule || ''; r.freq = g.freq || ''; break; }
      if (g.kind === 'mic' || g.kind === 'di' || g.kind === 'source') { r.source = g.use || (g.kind === 'source' ? g.name : ''); r.mic = (g.model && g.model !== g.name ? g.model : g.name) + (g.outs.length > 1 ? ' ' + g.outs[c.ap] : ''); r.model = g.model || ''; r.person = g.person || ''; r.src = g; break; }
      if (g.kind === 'amp' || g.kind === 'processor' || g.kind === 'other' || g.kind === 'computer') { r.source = r.source || g.name; r.mic = r.mic || g.name; break; }
      break;
    }
    return r;
  }

  /** Everything a socket feeds, followed through processors and amps to the speakers or IEM packs. */
  function downstream(doc, ix, gid, outp, depth) {
    if ((depth || 0) > 8) return [];
    const res = [];
    for (const c of ix.from.get(gid + ':' + outp) || []) {
      const g = ix.G.get(c.b);
      if (!g) continue;
      const k = KINDS[g.kind];
      let next = [];
      if (k.pass === 'same' && g.outs[c.bp] != null) next = downstream(doc, ix, g.id, c.bp, (depth || 0) + 1);
      else if (k.pass === 'all' || k.pass === 'rf') next = g.outs.flatMap((_, j) => downstream(doc, ix, g.id, j, (depth || 0) + 1));
      res.push({ g, port: g.ins[c.bp], cable: c, next });
    }
    return res;
  }
  const chainText = (list) => list.map((d) => d.g.name + (d.next.length ? ' → ' + (d.next.length > 1 ? '(' + chainText(d.next) + ')' : chainText(d.next)) : '')).join(', ');

  // ---------- the lists ----------
  /** Input list: every console channel, with what is on it. */
  function inputs(doc) {
    const ix = index(doc), rows = [];
    for (const con of doc.gear.filter((g) => g.kind === 'console')) {
      for (const sb of doc.gear.filter((g) => g.kind === 'stagebox' && ix.consolesOf(g.id).includes(con))) {
        sb.ins.forEach((p, i) => {
          const u = upstream(doc, ix, sb.id, i);
          rows.push({ console: con, ch: chanOf(sb, i), via: sb, port: p, link: ix.linkName(sb.id, con.id), up: u, used: !!u.chain.length });
        });
      }
      const ls = con.localstart || 1;
      con.ins.forEach((p, i) => {
        const u = upstream(doc, ix, con.id, i);
        if (u.chain.length) rows.push({ console: con, ch: ls + i, via: con, port: 'Local ' + p, link: '', up: u, used: true });
      });
    }
    rows.sort((a, b) => a.console.name.localeCompare(b.console.name) || (a.ch == null) - (b.ch == null) || (a.ch || 0) - (b.ch || 0));
    return rows;
  }
  /** Output list: every console output socket and stage box output, with its mix and where it ends up. */
  function outputs(doc) {
    const ix = index(doc), rows = [];
    for (const con of doc.gear.filter((g) => g.kind === 'console')) {
      const sockets = [{ g: con, local: true }].concat(doc.gear.filter((g) => g.kind === 'stagebox' && ix.consolesOf(g.id).includes(con)).map((g) => ({ g })));
      for (const s of sockets) s.g.outs.forEach((p, j) => {
        const dest = downstream(doc, ix, s.g.id, j);
        const mix = (s.g.feeds || {})[j] || '';
        if (dest.length || mix) rows.push({ console: con, socket: s.g, port: (s.local ? 'Local ' : '') + p, mix, dest, chain: chainText(dest) });
      });
    }
    return rows;
  }
  function channelFor(doc, ix, gid, outp) {
    // a receiver output: where it lands (stage box input → console channel, or a console input)
    for (const c of ix.from.get(gid + ':' + outp) || []) {
      const g = ix.G.get(c.b);
      if (!g) continue;
      if (g.kind === 'console') return { console: g, ch: (g.localstart || 1) + c.bp, via: 'Local ' + g.ins[c.bp] };
      if (g.kind === 'stagebox') { const con = ix.consolesOf(g.id)[0]; return { console: con, ch: con ? chanOf(g, c.bp) : null, via: g.name + ' ' + g.ins[c.bp] }; }
    }
    return null;
  }
  function wireless(doc) {
    const ix = index(doc);
    return doc.gear.filter((g) => g.kind === 'txmic').map((tx) => {
      const c = (ix.from.get(tx.id + ':0') || [])[0];
      const rx = c ? ix.G.get(c.b) : null;
      const land = rx ? channelFor(doc, ix, rx.id, c.bp) : null;
      return { tx, rx, rxch: rx ? rx.ins[c.bp] : '', land };
    });
  }
  function inears(doc) {
    const ix = index(doc);
    return doc.gear.filter((g) => g.kind === 'iemtx' || g.kind === 'headamp').map((tx) => {
      const feeds = tx.ins.map((p, i) => {
        const c = ix.into.get(tx.id + ':' + i);
        if (!c) return null;
        const src = ix.G.get(c.a);
        return { port: p, from: src, socket: src ? src.outs[c.ap] : '', mix: src && src.feeds ? src.feeds[c.ap] || '' : '' };
      });
      const packs = downstream(doc, ix, tx.id, 0).map((d) => d.g);
      return { tx, feeds, mix: [...new Set(feeds.filter(Boolean).map((f) => f.mix).filter(Boolean))].join(' / '), packs };
    });
  }
  /** The console channels a source lands on (a stereo DI lands on two). */
  function landing(doc, g) { return inputs(doc).filter((r) => r.used && r.up.src && r.up.src.id === g.id); }
  /** Suggested channel names: who uses it, what it is for, or numbered by type (WMIC-1, MIC-2, DI-1, LINE-1). */
  const PREFIX = { txmic: 'WMIC', mic: 'MIC', di: 'DI', source: 'LINE' };
  function suggestNames(doc, con, how) {
    const rows = inputs(doc).filter((r) => r.used && r.up.src && r.console.id === con.id);
    const count = {};
    const out = new Map();
    rows.forEach((r) => {
      const s = r.up.src;
      let n = '';
      if (how === 'person') n = s.person || s.use || '';
      else if (how === 'use') n = s.use || s.person || '';
      else { const p = PREFIX[s.kind] || 'CH'; if (!out.has(s.id)) { count[p] = (count[p] || 0) + 1; n = p + '-' + count[p]; } else return; }
      if (!out.has(s.id) && n) out.set(s.id, con.namelen ? n.slice(0, con.namelen) : n);
    });
    return out;
  }

  function cableList(doc) {
    const G = gearBy(doc);
    return doc.cables.map((c) => {
      const a = G.get(c.a), b = G.get(c.b);
      if (c.ap === 'net') return { c, a, b, from: a.name + ' network', to: b.name + (c.port ? ' port ' + c.port : '') };
      return { c, a, b, from: a.name + (c.ap === 'link' ? '' : ' ' + a.outs[c.ap]), to: b.name + (c.bp === 'link' ? '' : ' ' + b.ins[c.bp]) };
    });
  }

  // ---------- radio frequencies ----------
  /** A frequency in MHz from what was typed ("518.2", "518.200 MHz"), or null. */
  const mhz = (v) => { const m = /(\d{2,4}(?:\.\d+)?)/.exec(String(v || '')); return m ? Number(m[1]) : null; };
  /** The 6 MHz TV channel band a frequency is in: same band, same colour dot on the drawing. */
  const band = (f) => (f == null ? null : Math.floor(f / 6));
  const bandColor = (f) => { const b = band(f); return b == null ? '' : 'hsl(' + ((b * 67) % 360) + ',72%,52%)'; };
  /**
   * Every transmitter on the air: wireless mics (each on its own frequency) and in-ear transmitters (their packs listen on the same one).
   * Two on one frequency are a clash; closer than 0.4 MHz is a warning. A spare is not on the air with the live mic on its channel,
   * and a pack is expected to match its own transmitter.
   */
  const CLOSE = 0.4;
  function rfChecks(doc) {
    const out = [], G = gearBy(doc);
    const on = [];
    for (const g of doc.gear) {
      const f = mhz(g.freq);
      if (f == null) continue;
      if (g.kind === 'txmic') { const h = hostOf(doc, g); const m = h ? members(doc, h).find((x) => x.g.id === g.id) : null; on.push({ g, f, grp: h && m ? 'rx:' + h.id + ':' + m.port : 'tx:' + g.id, spare: !!g.spare }); }
      else if (g.kind === 'iemtx') on.push({ g, f, grp: 'iem:' + g.id });
      else if (g.kind === 'bodypack') { const h = hostOf(doc, g); on.push({ g, f, grp: h ? 'iem:' + h.id : 'pk:' + g.id, pack: true }); }
    }
    const fmt = (f) => String(Math.round(f * 1000) / 1000);
    const seen = new Set();
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
      const a = on[i], b = on[j];
      if (a.grp === b.grp) continue;                              // a spare and the live mic on one channel; a pack and its transmitter
      if (a.pack && b.pack && a.grp === b.grp) continue;
      const d = Math.abs(a.f - b.f);
      if (d >= CLOSE - 1e-6) continue;
      const k = [a.g.id, b.g.id].sort().join('|'); if (seen.has(k)) continue; seen.add(k);
      if (d < 0.0005) out.push({ level: 'bad', text: a.g.name + ' and ' + b.g.name + ' are both on ' + fmt(a.f) + ' MHz', gear: [a.g.id, b.g.id], rf: true });
      else out.push({ level: 'warn', text: a.g.name + ' (' + fmt(a.f) + ') and ' + b.g.name + ' (' + fmt(b.f) + ' MHz) are only ' + fmt(d) + ' MHz apart; keep at least ' + CLOSE + ' MHz', gear: [a.g.id, b.g.id], rf: true });
    }
    // a pack set to a different frequency from its transmitter will not hear it
    for (const p of on.filter((x) => x.pack)) {
      const h = hostOf(doc, p.g), hf = h ? mhz(h.freq) : null;
      if (hf != null && Math.abs(hf - p.f) >= 0.0005) out.push({ level: 'warn', text: p.g.name + ' is set to ' + fmt(p.f) + ' MHz but ' + h.name + ' sends on ' + fmt(hf) + ' MHz', gear: [p.g.id, h.id], rf: true });
    }
    return out;
  }

  /** Things that look wrong. */
  function checks(doc) {
    const out = [];
    const ix = index(doc);
    out.push(...rfChecks(doc));
    // a cable name is printed on the cable: two cables with one name get mixed up
    const cn = new Map();
    doc.cables.filter((c) => c.kind !== 'rf' && c.label).forEach((c) => { const k = tagKey(c.label); if (!cn.has(k)) cn.set(k, []); cn.get(k).push(c); });
    for (const [, list] of cn) if (list.length > 1) { const G = gearBy(doc); out.push({ level: 'warn', text: list.length + ' cables are named ' + list[0].label + '. Give each its own name (Auto label numbers them).', gear: [...new Set(list.flatMap((c) => [c.a, c.b]))].filter((id) => G.has(id)), cables: list.map((c) => c.id) }); }
    const names = new Map();
    doc.gear.forEach((g) => { const k = tagKey(g.name); if (!names.has(k)) names.set(k, []); names.get(k).push(g); });
    for (const [, list] of names) if (list.length > 1) {
      const same = list.every((g) => g.name === list[0].name);
      out.push({ level: 'warn', text: same ? list.length + ' pieces of gear are called ' + list[0].name + '. Give each its own tag name (Auto label numbers them).' : list.map((g) => '“' + g.name + '”').join(' and ') + ' look like the same name. If they are the same gear, remove one; if not, give each its own tag name.', gear: list.map((g) => g.id) });
    }
    doc.cables.filter((c) => c.ap === 'net' && !c.port).forEach((c) => { const a = gearBy(doc).get(c.a), b = gearBy(doc).get(c.b); if (a && b) out.push({ level: 'note', text: a.name + ' plugs into ' + b.name + ': which port? Set it on the cable.', gear: [a.id, b.id] }); });
    const chans = new Map();
    const ins = inputs(doc);
    ins.filter((r) => r.used && r.ch != null).forEach((r) => { const k = r.console.id + ':' + r.ch; if (!chans.has(k)) chans.set(k, []); chans.get(k).push(r); });
    for (const [, list] of chans) if (list.length > 1) out.push({ level: 'bad', text: list[0].console.name + ' input ' + list[0].ch + ' gets ' + list.map((r) => r.via.name + ' ' + r.port).join(' and ') + '. Assign one of them another channel.', gear: list.map((r) => r.via.id) });
    // channel names and colours that the console cannot take
    ins.filter((r) => r.used && r.up.src).forEach((r) => {
      const s = r.up.src, con = r.console;
      if (s.chname && con.namelen && s.chname.length > con.namelen) out.push({ level: 'warn', text: con.name + ' ch ' + (r.ch == null ? '?' : r.ch) + ': "' + s.chname + '" is ' + s.chname.length + ' letters; the ' + con.name + ' shows ' + con.namelen + '.', gear: [s.id] });
      if (s.chcolor && con.colors && !con.colors.some((c) => key(c) === key(s.chcolor))) out.push({ level: 'warn', text: con.name + ' ch ' + (r.ch == null ? '?' : r.ch) + ': ' + s.chcolor + ' is not one of the ' + con.name + "'s colours.", gear: [s.id] });
    });
    ins.filter((r) => r.used && r.ch == null).forEach((r) => out.push({ level: 'warn', text: r.via.name + ' ' + r.port + (r.up.source ? ' (' + r.up.source + ')' : '') + ' is not on a ' + r.console.name + ' channel yet. Assign it on the stage box.', gear: [r.via.id] }));
    doc.gear.filter((g) => g.kind === 'stagebox' && !ix.consolesOf(g.id).length).forEach((g) => out.push({ level: 'warn', text: g.name + ' is not linked to a console. Draw its link to the console.', gear: [g.id] }));
    doc.gear.filter((g) => g.kind === 'txmic' && !(ix.from.get(g.id + ':0') || []).length).forEach((g) => out.push({ level: 'note', text: g.name + ' is not on a receiver channel yet.', gear: [g.id] }));
    doc.gear.filter((g) => g.kind === 'bodypack' && !ix.into.get(g.id + ':0')).forEach((g) => out.push({ level: 'note', text: g.name + ' is not paired with an IEM transmitter yet.', gear: [g.id] }));
    return out;
  }

  /** Short text for search and the device "used on" list. */
  function searchText(g) { return [g.name, g.use, g.person, g.chname, g.model, g.make, g.capsule, g.freq, g.group, g.phones, g.notes].filter(Boolean).join(' '); }

  return { COLS, CATS, CABLES, KINDS, KIND_ORDER, FIELD_LABELS, DEFAULT_MIXES, STAGES, STAGE_OF, stageOf, tagKey, clean, portsFor, addGear, resize, removeGear, connect, connectNet, netOf, members, hostOf, addMember, assignChannels, chanOf, landing, suggestNames, guessCable, findGear, freeIn, uniqueName, index, upstream, downstream, chainText, inputs, outputs, wireless, inears, cableList, checks, rfChecks, mhz, band, bandColor, searchText, colOf: (g) => (KINDS[g.kind] || KINDS.other).col };
});
