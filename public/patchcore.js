/*
 * The stage patch: one drawing for the whole system. Shared by the server and the browser.
 *
 * A patch is { title, subtitle, gear: [...], cables: [...] }.
 *   gear   { id, kind, name, make, model, device_id, group, use, capsule, freq, mode, phones,
 *            start, localstart, mixes, col, order, notes, ins: [names], outs: [names], feeds: { outIndex: mix } }
 *   cable  { id, a, ap, b, bp, kind, label, length, notes }
 *          from gear a output ap (index, or 'link') to gear b input bp (index, or 'link')
 * Everything else (input list, output list, wireless, in-ears, cable list, checks) is worked out from it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PatchCore = factory();
})(this, function () {
  'use strict';

  // columns, left to right; the drawing numbers the ones in use (01, 02, …)
  const COLS = [
    { title: 'Sources' }, { title: 'Wireless RX' }, { title: 'Stage I/O' }, { title: 'Network' },
    { title: 'Mix' }, { title: 'Amps · TX' }, { title: 'Speakers · IEMs' }
  ];
  const CATS = {
    source: { label: 'Sources', color: '#2ec4b6' }, io: { label: 'Stage I/O', color: '#4c8dff' }, computer: { label: 'Computers', color: '#8b6cff' },
    console: { label: 'Consoles', color: '#c45cf2' }, iem: { label: 'IEM gear', color: '#ec6aa8' }, pa: { label: 'PA · amps · speakers', color: '#ef8a3c' },
    net: { label: 'Network', color: '#6f6cf6' }
  };
  const CABLES = {
    xlr: { label: 'Analog · XLR' }, link: { label: 'Digital snake · SLink, AES50' }, dante: { label: 'Dante · Cat6' }, aes: { label: 'AES3 · 110 Ω' },
    speaker: { label: 'Speaker · NL4' }, wiem: { label: 'Wired IEM' }, rf: { label: 'Wireless · RF' }
  };
  const nums = (prefix, k) => Array.from({ length: Math.max(0, Math.min(128, Number(k) || 0)) }, (_, i) => prefix + (i + 1));
  const DEFAULT_MIXES = ['LR', 'Mix 1', 'Mix 2', 'Mix 3', 'Mix 4', 'Mix 5', 'Mix 6', 'Mix 7', 'Mix 8', 'Mix 9', 'Mix 10', 'Mix 11', 'Mix 12'];

  /*
   * Kinds of gear. col = column it sits in; cat = card colour; ports(g) = default sockets; fields = what it asks for;
   * pass = how a signal gets through it (for tracing): 'same' (input n to output n), 'all' (any input to every output), 'rf' (inputs to its radio link).
   * card: big gear that gets a device card in the device library.
   */
  const KINDS = {
    mic: { label: 'Mic', col: 0, cat: 'source', ports: () => ({ ins: [], outs: ['Out'] }), fields: ['use', 'model'], counts: false },
    di: { label: 'DI', col: 0, cat: 'source', ports: (g) => ({ ins: [], outs: g.nout === 2 ? ['L', 'R'] : ['Out'] }), fields: ['use', 'model'], counts: 'outs' },
    source: { label: 'Line source', col: 0, cat: 'source', ports: (g) => ({ ins: [], outs: g.nout === 1 ? ['Out'] : ['L', 'R'].concat(nums('Out ', (g.nout || 2) - 2).map((x, i) => 'Out ' + (i + 3))) }), fields: ['use', 'model'], counts: 'outs' },
    txmic: { label: 'Wireless mic', col: 0, cat: 'source', ports: () => ({ ins: [], outs: ['RF'] }), fields: ['use', 'model', 'capsule', 'freq'], counts: false },
    receiver: { label: 'Wireless receiver', col: 1, cat: 'io', ports: (g) => ({ ins: nums('Ch ', g.nin || 2), outs: nums('Out ', g.nin || 2) }), fields: ['model'], counts: 'ch', pass: 'same', card: true },
    stagebox: { label: 'Stage box', col: 2, cat: 'io', ports: (g) => ({ ins: nums('In ', g.nin || 16), outs: nums('Out ', g.nout || 8) }), fields: ['model', 'start'], counts: 'both', link: true, card: true },
    network: { label: 'Dante network', col: 3, cat: 'net', ports: () => ({ ins: [], outs: [] }), fields: [], counts: false, link: true },
    console: { label: 'Console', col: 4, cat: 'console', ports: (g) => ({ ins: nums('In ', g.nin || 16), outs: nums('Out ', g.nout || 12) }), fields: ['model', 'localstart', 'mixes'], counts: 'both', link: true, card: true },
    computer: { label: 'Computer · recorder', col: 4, cat: 'computer', ports: (g) => ({ ins: nums('In ', g.nin || 2), outs: nums('Out ', g.nout || 2) }), fields: ['model', 'use'], counts: 'both', link: true },
    processor: { label: 'Speaker processor', col: 5, cat: 'pa', ports: (g) => ({ ins: g.nin === 1 ? ['In'] : Array.from({ length: Math.min(8, g.nin || 2) }, (_, i) => 'In ' + 'ABCDEFGH'[i]), outs: nums('Out ', g.nout || 6) }), fields: ['model'], counts: 'both', pass: 'all', card: true },
    amp: { label: 'Amplifier', col: 5, cat: 'pa', ports: (g) => { const c = ['Ch A', 'Ch B', 'Ch C', 'Ch D'].slice(0, g.nin || 2); return { ins: c, outs: c.slice() }; }, fields: ['model'], counts: 'ch', pass: 'same', card: true },
    iemtx: { label: 'IEM transmitter', col: 5, cat: 'iem', ports: (g) => ({ ins: g.mode === 'Mono' ? ['In'] : ['L', 'R'], outs: ['RF'] }), fields: ['model', 'mode', 'freq'], counts: false, pass: 'rf', card: true },
    headamp: { label: 'Wired IEM amp', col: 5, cat: 'iem', ports: (g) => ({ ins: ['L', 'R'], outs: ['Phones'] }), fields: ['model', 'use'], counts: false, pass: 'all' },
    speaker: { label: 'Speaker', col: 6, cat: 'pa', ports: () => ({ ins: ['In'], outs: [] }), fields: ['model'], counts: false },
    wedge: { label: 'Wedge', col: 6, cat: 'pa', ports: () => ({ ins: ['In'], outs: [] }), fields: ['use', 'model'], counts: false },
    bodypack: { label: 'IEM pack', col: 6, cat: 'iem', ports: () => ({ ins: ['RF'], outs: [] }), fields: ['use', 'model', 'phones'], counts: false },
    other: { label: 'Other', col: 4, cat: 'computer', ports: (g) => ({ ins: nums('In ', g.nin == null ? 1 : g.nin), outs: nums('Out ', g.nout == null ? 1 : g.nout) }), fields: ['model', 'use'], counts: 'both', pass: 'all' }
  };
  const FIELD_LABELS = { use: 'Used for', model: 'Model', capsule: 'Capsule', freq: 'Frequency', mode: 'Mode', phones: 'Earphones', start: 'Console input for In 1', localstart: 'Channel for local In 1', mixes: 'Mixes' };

  /*
   * The catalog in the right pane: common gear with the right sockets already set.
   * nin / nout are socket counts; card gear also gets a device card.
   */
  const CATALOG = [
    { group: 'Consoles', items: [
      { kind: 'console', make: 'Allen & Heath', model: 'SQ-5', nin: 16, nout: 12, link: 'SLink' }, { kind: 'console', make: 'Allen & Heath', model: 'SQ-6', nin: 24, nout: 14, link: 'SLink' },
      { kind: 'console', make: 'Allen & Heath', model: 'SQ-7', nin: 32, nout: 16, link: 'SLink' }, { kind: 'console', make: 'Behringer', model: 'X32', nin: 32, nout: 16, link: 'AES50' },
      { kind: 'console', make: 'Midas', model: 'M32', nin: 32, nout: 16, link: 'AES50' }, { kind: 'console', make: 'Yamaha', model: 'TF5', nin: 32, nout: 16, link: 'Dante' },
      { kind: 'console', make: 'Yamaha', model: 'DM7', nin: 0, nout: 8, link: 'Dante' }, { kind: 'console', make: '', model: 'Console', nin: 16, nout: 8 }] },
    { group: 'Stage boxes', items: [
      { kind: 'stagebox', make: 'Allen & Heath', model: 'AR2412', nin: 24, nout: 12, link: 'SLink' }, { kind: 'stagebox', make: 'Allen & Heath', model: 'AR84', nin: 8, nout: 4, link: 'SLink' },
      { kind: 'stagebox', make: 'Allen & Heath', model: 'AB168', nin: 16, nout: 8, link: 'SLink' }, { kind: 'stagebox', make: 'Allen & Heath', model: 'DX168', nin: 16, nout: 8, link: 'SLink' },
      { kind: 'stagebox', make: 'Behringer', model: 'S16', nin: 16, nout: 8, link: 'AES50' }, { kind: 'stagebox', make: 'Behringer', model: 'S32', nin: 32, nout: 16, link: 'AES50' },
      { kind: 'stagebox', make: 'Midas', model: 'DL16', nin: 16, nout: 8, link: 'AES50' }, { kind: 'stagebox', make: 'Midas', model: 'DL32', nin: 32, nout: 16, link: 'AES50' },
      { kind: 'stagebox', make: 'Yamaha', model: 'Rio3224-D3', nin: 32, nout: 24, link: 'Dante' }, { kind: 'stagebox', make: 'Yamaha', model: 'Rio1608-D2', nin: 16, nout: 8, link: 'Dante' },
      { kind: 'stagebox', make: 'Yamaha', model: 'Tio1608-D', nin: 16, nout: 8, link: 'Dante' }] },
    { group: 'Wireless', items: [
      { kind: 'receiver', make: 'Shure', model: 'SLX-D4D', nin: 2 }, { kind: 'receiver', make: 'Shure', model: 'SLX-D4', nin: 1 }, { kind: 'receiver', make: 'Shure', model: 'ULX-D4D', nin: 2 },
      { kind: 'receiver', make: 'Shure', model: 'ULX-D4Q', nin: 4 }, { kind: 'receiver', make: 'Shure', model: 'QLXD4', nin: 1 }, { kind: 'receiver', make: 'Shure', model: 'AD4Q', nin: 4 },
      { kind: 'receiver', make: 'Sennheiser', model: 'EW-DX EM 2', nin: 2 },
      { kind: 'txmic', make: 'Shure', model: 'Handheld', capsule: 'Beta 58A' }, { kind: 'txmic', make: 'Shure', model: 'Bodypack', capsule: 'Lav' },
      { kind: 'txmic', make: '', model: 'Headset', capsule: 'Headset' }] },
    { group: 'In-ears', items: [
      { kind: 'iemtx', make: 'Shure', model: 'PSM300', mode: 'Stereo' }, { kind: 'iemtx', make: 'Shure', model: 'PSM900', mode: 'Stereo' },
      { kind: 'iemtx', make: 'Phenyx Pro', model: 'PTM-10', mode: 'Stereo' }, { kind: 'iemtx', make: 'Sennheiser', model: 'EW IEM G4', mode: 'Stereo' },
      { kind: 'bodypack', make: '', model: 'IEM pack' }, { kind: 'headamp', make: '', model: 'Wired IEM amp' }] },
    { group: 'Mics and DIs', items: [
      { kind: 'mic', make: 'Shure', model: 'SM58' }, { kind: 'mic', make: 'Shure', model: 'Beta 58A' }, { kind: 'mic', make: 'Shure', model: 'SM57' },
      { kind: 'mic', make: 'Shure', model: 'Beta 91A' }, { kind: 'mic', make: 'Shure', model: 'Beta 52A' }, { kind: 'mic', make: 'Shure', model: 'KSM137' },
      { kind: 'mic', make: '', model: 'Mic' }, { kind: 'di', make: '', model: 'DI', nout: 1 }, { kind: 'di', make: '', model: 'Stereo DI', nout: 2 },
      { kind: 'source', make: '', model: 'Keys', nout: 2 }, { kind: 'source', make: '', model: 'Playback', nout: 2 }] },
    { group: 'PA and processing', items: [
      { kind: 'processor', make: 'dbx', model: 'DriveRack PA2', nin: 2, nout: 6 }, { kind: 'processor', make: 'dbx', model: 'DriveRack VENU360', nin: 3, nout: 6 },
      { kind: 'amp', make: 'Crown', model: 'XLi 2500', nin: 2 }, { kind: 'amp', make: 'Crown', model: 'XLS 2502', nin: 2 }, { kind: 'amp', make: '', model: 'Amplifier', nin: 2 },
      { kind: 'speaker', make: 'JBL', model: 'CBT 70J-1' }, { kind: 'speaker', make: 'Yamaha', model: 'DXS12mkII' }, { kind: 'speaker', make: '', model: 'Speaker' },
      { kind: 'wedge', make: '', model: 'Wedge' }] },
    { group: 'Other', items: [
      { kind: 'network', make: '', model: 'Dante network' }, { kind: 'computer', make: '', model: 'Computer', nin: 2, nout: 2 }, { kind: 'other', make: '', model: 'Other', nin: 1, nout: 1 }] }
  ];

  const str = (v, n) => String(v == null ? '' : v).slice(0, n || 200);
  const key = (v) => String(v || '').trim().toLowerCase();

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
      for (const f of ['make', 'model', 'group', 'use', 'capsule', 'freq', 'mode', 'phones', 'notes']) if (g0[f] != null && String(g0[f]).trim()) g[f] = str(g0[f], f === 'notes' ? 1000 : 80).trim();
      if (Number.isInteger(Number(g0.device_id)) && Number(g0.device_id) > 0) g.device_id = Number(g0.device_id);
      for (const f of ['start', 'localstart']) if (Number(g0[f]) >= 1) g[f] = Math.min(512, Math.floor(Number(g0[f])));
      if (Number.isInteger(Number(g0.col)) && g0.col !== null && g0.col !== '' && Number(g0.col) >= 0 && Number(g0.col) < COLS.length) g.col = Number(g0.col);
      g.order = Number.isFinite(Number(g0.order)) ? Number(g0.order) : 0;
      if (Array.isArray(g0.mixes)) g.mixes = g0.mixes.map((x) => str(x, 40).trim()).filter(Boolean).slice(0, 96);
      g.ins = (Array.isArray(g0.ins) ? g0.ins : portsFor(g0).ins).slice(0, 128).map((x) => str(x, 24));
      g.outs = (Array.isArray(g0.outs) ? g0.outs : portsFor(g0).outs).slice(0, 128).map((x) => str(x, 24));
      g.feeds = {};
      if (g0.feeds && typeof g0.feeds === 'object') for (const [k, v] of Object.entries(g0.feeds)) if (Number(k) >= 0 && Number(k) < g.outs.length && String(v || '').trim()) g.feeds[Number(k)] = str(v, 40).trim();
      out.gear.push(g);
    }
    const byId = new Map(out.gear.map((g) => [g.id, g]));
    const cids = new Set();
    const taken = new Set();
    for (const c0 of Array.isArray(doc.cables) ? doc.cables.slice(0, 3000) : []) {
      if (!c0) continue;
      const a = byId.get(c0.a), b = byId.get(c0.b);
      if (!a || !b || a === b) continue;
      const ap = c0.ap === 'link' ? 'link' : Number(c0.ap), bp = c0.bp === 'link' ? 'link' : Number(c0.bp);
      if (ap === 'link' ? !(KINDS[a.kind].link) : !(ap >= 0 && ap < a.outs.length)) continue;
      if (bp === 'link' ? !(KINDS[b.kind].link) : !(bp >= 0 && bp < b.ins.length)) continue;
      const slot = b.id + ':' + bp;
      if (bp !== 'link' && taken.has(slot)) continue;        // an input socket takes one cable
      taken.add(slot);
      let id = str(c0.id, 24).replace(/[^\w-]/g, '');
      if (!id || cids.has(id)) id = 'c' + Math.random().toString(36).slice(2, 9);
      cids.add(id);
      const c = { id, a: a.id, ap, b: b.id, bp, kind: CABLES[c0.kind] ? c0.kind : guessCable(a, ap, b, bp) };
      for (const f of ['label', 'length', 'notes']) if (c0[f] != null && String(c0[f]).trim()) c[f] = str(c0[f], f === 'notes' ? 500 : 60).trim();
      out.cables.push(c);
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
    for (const f of ['make', 'model', 'group', 'use', 'capsule', 'freq', 'mode', 'phones', 'notes', 'start', 'localstart', 'device_id', 'col']) if (item[f] != null && item[f] !== '') g[f] = item[f];
    if (kind === 'console') g.mixes = (item.mixes || DEFAULT_MIXES).slice();
    if (kind === 'stagebox' && !g.start) g.start = 1;
    if (kind === 'iemtx' && !g.mode) g.mode = 'Stereo';
    const p = portsFor({ ...g, nin: item.nin, nout: item.nout });
    g.ins = item.ins || p.ins; g.outs = item.outs || p.outs; g.feeds = {};
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
  }
  function removeGear(doc, id) {
    doc.gear = doc.gear.filter((g) => g.id !== id);
    doc.cables = doc.cables.filter((c) => c.a !== id && c.b !== id);
  }
  /** Connect an output (or link) to an input (or link). An input takes one cable: an old one there is replaced. */
  function connect(doc, a, ap, b, bp, extra) {
    if (!a || !b || a === b) return null;
    if (bp !== 'link') doc.cables = doc.cables.filter((c) => !(c.b === b.id && c.bp === bp));
    else doc.cables = doc.cables.filter((c) => !(c.a === a.id && c.b === b.id && c.ap === 'link' && c.bp === 'link'));
    const c = { id: uid('c'), a: a.id, ap, b: b.id, bp, kind: (extra && extra.kind) || guessCable(a, ap, b, bp) };
    if (extra) for (const f of ['label', 'length', 'notes']) if (extra[f]) c[f] = extra[f];
    doc.cables.push(c);
    return c;
  }
  const gearBy = (doc) => new Map(doc.gear.map((g) => [g.id, g]));
  const findGear = (doc, name) => doc.gear.find((g) => key(g.name) === key(name));
  const freeIn = (doc, g, from) => { for (let i = from || 0; i < g.ins.length; i++) if (!doc.cables.some((c) => c.b === g.id && c.bp === i)) return i; return -1; };

  // ---------- tracing ----------
  function index(doc) {
    const G = gearBy(doc);
    const into = new Map(), from = new Map(), links = new Map();
    for (const c of doc.cables) {
      if (c.ap === 'link' || c.bp === 'link') {
        if (!links.has(c.a)) links.set(c.a, []); if (!links.has(c.b)) links.set(c.b, []);
        links.get(c.a).push({ c, other: c.b }); links.get(c.b).push({ c, other: c.a });
        continue;
      }
      into.set(c.b + ':' + c.bp, c);
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
      if (g.kind === 'txmic') { r.tx = g; r.source = g.use || ''; r.mic = g.name; r.capsule = g.capsule || ''; r.freq = g.freq || ''; break; }
      if (g.kind === 'mic' || g.kind === 'di' || g.kind === 'source') { r.source = g.use || (g.kind === 'source' ? g.name : ''); r.mic = (g.model && g.model !== g.name ? g.model : g.name) + (g.outs.length > 1 ? ' ' + g.outs[c.ap] : ''); r.model = g.model || ''; break; }
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
        const start = sb.start || 1;
        sb.ins.forEach((p, i) => {
          const u = upstream(doc, ix, sb.id, i);
          rows.push({ console: con, ch: start + i, via: sb, port: p, link: ix.linkName(sb.id, con.id), up: u, used: !!u.chain.length });
        });
      }
      const ls = con.localstart || 1;
      con.ins.forEach((p, i) => {
        const u = upstream(doc, ix, con.id, i);
        if (u.chain.length) rows.push({ console: con, ch: ls + i, via: con, port: 'Local ' + p, link: '', up: u, used: true });
      });
    }
    rows.sort((a, b) => a.console.name.localeCompare(b.console.name) || a.ch - b.ch);
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
      if (g.kind === 'stagebox') { const con = ix.consolesOf(g.id)[0]; return { console: con, ch: con ? (g.start || 1) + c.bp : null, via: g.name + ' ' + g.ins[c.bp] }; }
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
  function cableList(doc) {
    const G = gearBy(doc);
    return doc.cables.map((c) => {
      const a = G.get(c.a), b = G.get(c.b);
      return { c, a, b, from: a.name + (c.ap === 'link' ? '' : ' ' + a.outs[c.ap]), to: b.name + (c.bp === 'link' ? '' : ' ' + b.ins[c.bp]) };
    });
  }

  /** Things that look wrong. */
  function checks(doc) {
    const out = [];
    const ix = index(doc);
    const fq = new Map();
    doc.gear.filter((g) => (g.kind === 'txmic' || g.kind === 'iemtx') && g.freq).forEach((g) => {
      const m = /(\d+(?:\.\d+)?)/.exec(g.freq); const k = m ? String(Number(m[1])) : key(g.freq);
      if (!fq.has(k)) fq.set(k, []); fq.get(k).push(g);
    });
    for (const [k, list] of fq) if (list.length > 1) out.push({ level: 'bad', text: list.map((g) => g.name).join(' and ') + ' are both on ' + k + ' MHz', gear: list.map((g) => g.id) });
    const names = new Map();
    doc.gear.forEach((g) => { const k = key(g.name); if (!names.has(k)) names.set(k, []); names.get(k).push(g); });
    for (const [, list] of names) if (list.length > 1) out.push({ level: 'warn', text: list.length + ' pieces of gear are called ' + list[0].name + '. Rename one (' + list[0].name + ' #2).', gear: list.map((g) => g.id) });
    const chans = new Map();
    inputs(doc).filter((r) => r.used).forEach((r) => { const k = r.console.id + ':' + r.ch; if (!chans.has(k)) chans.set(k, []); chans.get(k).push(r); });
    for (const [, list] of chans) if (list.length > 1) out.push({ level: 'bad', text: list[0].console.name + ' input ' + list[0].ch + ' gets ' + list.map((r) => r.via.name + ' ' + r.port).join(' and ') + '. Change a stage box\'s first console input.', gear: list.map((r) => r.via.id) });
    doc.gear.filter((g) => g.kind === 'stagebox' && !ix.consolesOf(g.id).length).forEach((g) => out.push({ level: 'warn', text: g.name + ' is not linked to a console. Draw its link to the console.', gear: [g.id] }));
    doc.gear.filter((g) => g.kind === 'txmic' && !(ix.from.get(g.id + ':0') || []).length).forEach((g) => out.push({ level: 'note', text: g.name + ' is not on a receiver channel yet.', gear: [g.id] }));
    return out;
  }

  /** Short text for search and the device "used on" list. */
  function searchText(g) { return [g.name, g.use, g.model, g.make, g.capsule, g.freq, g.group, g.phones, g.notes].filter(Boolean).join(' '); }

  return { COLS, CATS, CABLES, KINDS, CATALOG, FIELD_LABELS, DEFAULT_MIXES, clean, portsFor, addGear, resize, removeGear, connect, guessCable, findGear, freeIn, uniqueName, index, upstream, downstream, chainText, inputs, outputs, wireless, inears, cableList, checks, searchText, colOf: (g) => (g.col != null ? g.col : (KINDS[g.kind] || KINDS.other).col) };
});
