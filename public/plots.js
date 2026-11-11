/* LiveGenie: stage plots. Named top-down drawings of the stage ("Sunday worship band", "Christmas program"), all on
 * one stage outline. Gear comes from the stage patch (mics, wireless mics, DIs, wedges, IEM packs, stage boxes) and is
 * labelled from it live: "MIC-3 · Piano L · Ch 4", "WEDGE-1 · Mix 2". People, instruments, risers, power and snake
 * drops are drawn on top. Everyone can look and print; admins arrange. The PDF has the drawing, the inputs on it and
 * the monitor mixes. */

const PlotView = (() => {
  const P = PatchCore;
  const S_FT = 30;   // drawing units per foot
  const GRID = 0.5;  // snap, in feet
  /** What can go on a plot that is not from the patch: label, size in feet, group. resize: the size can be changed. */
  const TYPES = {
    person: { label: 'Person', w: 2, h: 2, group: 'people' },
    drums: { label: 'Drum kit', w: 6, h: 5, group: 'people' },
    keys: { label: 'Keys', w: 5, h: 1.8, group: 'people' },
    gtramp: { label: 'Guitar amp', w: 2.2, h: 1.2, group: 'people' },
    bassamp: { label: 'Bass amp', w: 2.4, h: 1.8, group: 'people' },
    acoustic: { label: 'Acoustic guitar', w: 1.4, h: 3.4, group: 'people' },
    stand: { label: 'Music stand', w: 1.8, h: 0.8, group: 'people' },
    riser: { label: 'Riser', w: 8, h: 6, group: 'people', resize: true },
    choir: { label: 'Choir', w: 16, h: 5, group: 'people', resize: true },
    pulpit: { label: 'Pulpit', w: 3, h: 2, group: 'people' },
    chair: { label: 'Chair', w: 1.6, h: 1.6, group: 'people' },
    table: { label: 'Table', w: 6, h: 2.5, group: 'people', resize: true },
    text: { label: 'Text label', w: 4, h: 1, group: 'people' },
    power: { label: 'Power drop', w: 1.4, h: 1.4, group: 'drops' },
    stagebox: { label: 'Stage box', w: 2.2, h: 1.4, group: 'drops' },
    snake: { label: 'Snake drop', w: 1.4, h: 1.4, group: 'drops' },
    netdrop: { label: 'Network drop', w: 1.4, h: 1.4, group: 'drops' }
  };
  /** Patch gear that goes on a stage plot, how it is drawn and its size in feet. */
  const GEAR = {
    mic: { w: 1.4, h: 1.4, group: 'Mics', cat: 'source' }, txmic: { w: 1.4, h: 1.4, group: 'Wireless mics', cat: 'source' },
    di: { w: 1.4, h: 1, group: 'DIs and sources', cat: 'source' }, source: { w: 1.8, h: 1.1, group: 'DIs and sources', cat: 'source' },
    wedge: { w: 2.4, h: 1.6, group: 'Wedges and speakers', cat: 'pa' }, speaker: { w: 2, h: 1.6, group: 'Wedges and speakers', cat: 'pa' },
    bodypack: { w: 1.2, h: 1.4, group: 'IEM packs', cat: 'iem' }, stagebox: { w: 2.6, h: 1.6, group: 'Stage boxes', cat: 'io' }
  };
  const GEAR_ORDER = ['Mics', 'Wireless mics', 'DIs and sources', 'Wedges and speakers', 'IEM packs', 'Stage boxes'];
  const STANDS = ['', 'Tall boom', 'Short boom', 'Straight stand', 'Desk stand', 'Clip / on the instrument', 'Kick mic', 'Handheld, no stand', 'Headset / lav'];
  const COLOR = { source: '#2ec4b6', io: '#4c8dff', pa: '#ef8a3c', iem: '#ec6aa8', people: '#8a95a3', drops: '#d9a21b', net: '#6f6cf6' };

  // ================= the list of plots =================
  async function list() {
    setTitle('Stage plots');
    const { plots, outline } = await get('/api/plots');
    const when = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    app.innerHTML = `<div class="page plots">
      <div class="crumbs"><a href="#/">Home</a><span>/</span></div>
      <div class="bar"><div class="grow"><h1 class="title" style="font-size:22px;letter-spacing:.06em;margin:4px 0 2px">STAGE PLOTS</h1>
        <div class="note">Where everyone and everything sits on the ${esc(outline.w)} × ${esc(outline.d)} ft stage, with the mics, wedges and in-ears from the stage patch.</div></div>
        ${can('admin') ? '<button class="btn" id="plOut">' + icon('edit') + 'Stage outline</button><button class="primary btn" id="plNew">' + icon('plus') + 'New stage plot</button>' : ''}</div>
      <div class="list plrows">${plots.length ? plots.map((p) => '<a class="row" href="#/plots/' + p.id + '"><div class="plico">' + icon('stage') + '</div><div class="t"><b>' + esc(p.name) + '</b><span>' +
        esc([p.items + ' item' + (p.items === 1 ? '' : 's'), p.gear ? p.gear + ' from the patch' : '', 'changed ' + when(p.updated_at) + (p.updated_by ? ' by ' + p.updated_by : '')].filter(Boolean).join(' · ')) + '</span>' +
        (p.notes ? '<span class="note">' + esc(p.notes.split('\n')[0].slice(0, 140)) + '</span>' : '') + '</div></a>').join('')
        : '<div class="card empty">No stage plots yet.' + (can('admin') ? ' Make one for each kind of service (Sunday worship band, Christmas program, Kids), then place the band, the mics and the wedges.' : '') + '</div>'}</div></div>`;
    const nb = $('#plNew'); if (nb) nb.addEventListener('click', () => details(null, plots));
    const ob = $('#plOut'); if (ob) ob.addEventListener('click', () => outlineDialog(outline, () => route()));
  }

  /** New plot (optionally a copy of another), or rename it / change its notes / delete it. */
  function details(pl, plots) {
    modal('<h3>' + (pl ? 'Stage plot details' : 'New stage plot') + '</h3><form id="plf"><label>Name</label><input id="pln" value="' + esc(pl ? pl.name : '') + '" placeholder="Like Sunday worship band" maxlength="80">' +
      '<label>Notes</label><textarea id="plt" rows="3" placeholder="Who it is for, anything the team should know">' + esc(pl ? pl.notes : '') + '</textarea>' +
      (!pl && plots && plots.length ? '<label>Start from</label><select id="plc"><option value="">An empty stage</option>' + plots.map((p) => '<option value="' + p.id + '">A copy of ' + esc(p.name) + '</option>').join('') + '</select>' : '') +
      '<div class="acts">' + (pl ? '<button type="button" class="ghost danger" id="pldel">Delete stage plot</button><span class="grow"></span>' : '') + '<button type="button" data-close>Cancel</button><button class="primary">' + (pl ? 'Save' : 'Make the stage plot') + '</button></div></form>', (w, close) => {
      $('#plf', w).addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = { name: $('#pln', w).value, notes: $('#plt', w).value };
        try {
          if (pl) { const r = await call('PUT', '/api/plots/' + pl.id, body); close(); toast('Saved', 'ok'); if (pl.onSaved) pl.onSaved(r.plot); else route(); }
          else { const c = $('#plc', w); if (c && c.value) body.copy = Number(c.value); const r = await call('POST', '/api/plots', body); close(); location.hash = '#/plots/' + r.id + '/edit'; }
        } catch (err) { toast(err.message, 'bad'); }
      });
      const del = $('#pldel', w);
      if (del) del.addEventListener('click', async () => {
        if (!await confirmBox('Delete ' + pl.name + '?', 'The stage plot goes. The stage patch and the Gear Locker do not change.', 'Delete', true)) return;
        try { await call('DELETE', '/api/plots/' + pl.id); close(); toast('Stage plot deleted', 'ok'); location.hash = '#/plots'; } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  /** The stage every plot sits on: width and depth in feet, an optional thrust, and what the front edge is called. */
  function outlineDialog(o, done) {
    modal('<h3>Stage outline</h3><p class="note">Every stage plot is drawn on this stage. Sizes in feet, measured from the back wall (upstage) to the front edge (downstage).</p><form id="olf">' +
      '<div class="two"><label>Width (ft)<input type="number" id="olw" min="6" max="200" step="0.5" value="' + o.w + '"></label><label>Depth (ft)<input type="number" id="old" min="4" max="120" step="0.5" value="' + o.d + '"></label></div>' +
      '<div class="two"><label>Thrust width (ft)<input type="number" id="oltw" min="0" max="200" step="0.5" value="' + o.tw + '"></label><label>Thrust depth (ft)<input type="number" id="oltd" min="0" max="60" step="0.5" value="' + o.td + '"></label></div>' +
      '<p class="note" style="margin-top:0">A thrust (apron) sticks out from the middle of the front edge. Leave it at 0 for none.</p>' +
      '<label>Front edge label</label><input id="oll" maxlength="60" value="' + esc(o.label) + '" placeholder="Downstage · Audience">' +
      '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>', (w, close) => {
      $('#olf', w).addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const r = await call('PUT', '/api/plots/outline', { w: Number($('#olw', w).value), d: Number($('#old', w).value), tw: Number($('#oltw', w).value), td: Number($('#oltd', w).value), label: $('#oll', w).value });
          close(); toast('Stage outline saved', 'ok'); done(r.outline);
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  // ================= what the patch says about each piece of gear =================
  /** Labels from the stage patch: tag, who/what, channel or mix, model, stage box input. Built once per paint. */
  function patchInfo(doc) {
    const G = new Map(doc.gear.map((g) => [g.id, g]));
    const info = new Map();
    let ins = [], outs = [], iem = [], rev = '';
    try { ins = P.inputs(doc); } catch (e) { ins = []; }
    try { outs = P.outputs(doc); } catch (e) { outs = []; }
    try { iem = P.inears(doc); } catch (e) { iem = []; }
    const has = (list, id) => list.some((d) => (d.g && d.g.id === id) || has(d.next || [], id));
    for (const g of doc.gear) {
      if (!GEAR[g.kind]) continue;
      const it = { g, chs: [], sb: [], mix: '', model: g.model || '' };
      if (['mic', 'txmic', 'di', 'source'].includes(g.kind)) {
        ins.filter((r) => r.used && r.up.src && r.up.src.id === g.id).forEach((r) => {
          if (r.ch != null) it.chs.push(r.ch);
          if (r.via && r.via.kind === 'stagebox') it.sb.push(r.via.name + ' ' + r.port); else if (r.via) it.sb.push(r.port);
          if (r.up.receiver) it.rx = r.up.receiver.name + ' ' + (r.up.rxch || '');
        });
      }
      if (g.kind === 'wedge' || g.kind === 'speaker') {
        const o = outs.find((r) => has(r.dest || [], g.id));
        if (o) it.mix = o.mix || o.port;
      }
      if (g.kind === 'bodypack') {
        const r = iem.find((x) => (x.packs || []).some((p) => p && p.id === g.id) || P.members(doc, x.tx).some((m) => m.g.id === g.id));
        if (r) { it.mix = r.mix || ''; it.tx = r.tx.name; }
      }
      if (g.kind === 'stagebox') it.ports = (g.ins || []).length + ' in · ' + (g.outs || []).length + ' out';
      info.set(g.id, it);
    }
    return { G, info, rev };
  }
  /** Two lines under a piece of patch gear: its tag, then who or what it is for and its channel or mix. */
  function gearLines(g, it, short) {
    const who = g.person && g.use ? g.person + ' · ' + g.use : g.person || g.use || '';
    let where = '';
    if (it) {
      if (it.chs.length) where = 'Ch ' + it.chs.join(', ');
      else if (it.mix) where = it.mix;
      else if (g.kind === 'stagebox') where = g.model || '';
    }
    // on the drawing: "MIC-2 · Ch 3" over "Piano (Left)" (who it is for is written on the person it is on)
    if (short) return [[g.name, where].filter(Boolean).join(' · '), short === 'on' ? g.use || '' : who];
    return [g.name, [who, where].filter(Boolean).join(' · ')];
  }

  // ================= drawing =================
  const f = (n) => Math.round(n * 10) / 10;
  /** An item's icon, centred on 0,0, in drawing units (no rotation, no label). */
  function iconSvg(t, kind, w, h) {
    const W = w * S_FT, H = h * S_FT, x0 = -W / 2, y0 = -H / 2;
    const R = (x, y, ww, hh, rx, cls) => '<rect class="' + (cls || 'pls') + '" x="' + f(x) + '" y="' + f(y) + '" width="' + f(ww) + '" height="' + f(hh) + '" rx="' + (rx || 0) + '"/>';
    const C = (cx, cy, r, cls) => '<circle class="' + (cls || 'pls') + '" cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r) + '"/>';
    const L = (d, cls) => '<path class="' + (cls || 'pll') + '" d="' + d + '"/>';
    const T = (s, y, cls) => '<text class="' + (cls || 'plin') + '" x="0" y="' + f(y || 4) + '" text-anchor="middle">' + s + '</text>';
    if (t === 'gear') {
      if (kind === 'mic') return C(0, 0, W * 0.24) + L('M0 ' + f(W * 0.24) + 'V' + f(H / 2)) + L('M' + f(-W * 0.3) + ' ' + f(H / 2) + 'H' + f(W * 0.3));
      if (kind === 'txmic') return C(0, 0, W * 0.3) + C(0, 0, W * 0.12, 'plk') + L('M' + f(W * 0.21) + ' ' + f(-W * 0.21) + 'L' + f(W * 0.45) + ' ' + f(-W * 0.45));
      if (kind === 'di') return R(x0, y0, W, H, 4) + T('DI', 4);
      if (kind === 'source') return R(x0, y0, W, H, 4) + T('LINE', 4);
      if (kind === 'wedge') return '<path class="pls" d="M' + f(x0) + ' ' + f(y0) + 'H' + f(-x0) + 'L' + f(-x0 - W * 0.12) + ' ' + f(-y0) + 'H' + f(x0 + W * 0.12) + 'Z"/>' + L('M' + f(x0 + W * 0.18) + ' ' + f(y0 + H * 0.35) + 'H' + f(-x0 - W * 0.18));
      if (kind === 'speaker') return R(x0, y0, W, H, 3) + C(0, H * 0.08, H * 0.28, 'plk');
      if (kind === 'bodypack') return R(x0, y0, W, H, 6) + C(0, -H * 0.15, W * 0.18, 'plk') + L('M' + f(-W * 0.2) + ' ' + f(H * 0.25) + 'H' + f(W * 0.2));
      if (kind === 'stagebox') return R(x0, y0, W, H, 3) + T('SB', 5);
      return R(x0, y0, W, H, 4);
    }
    switch (t) {
      case 'person': return C(0, -H * 0.12, W * 0.2) + '<path class="pls" d="M' + f(-W * 0.42) + ' ' + f(H * 0.42) + 'Q0 ' + f(-H * 0.02) + ' ' + f(W * 0.42) + ' ' + f(H * 0.42) + 'Z"/>';
      case 'drums': return C(0, H * 0.12, H * 0.22) + C(-W * 0.24, -H * 0.14, H * 0.13) + C(W * 0.02, -H * 0.24, H * 0.12) + C(W * 0.28, H * 0.12, H * 0.16) + C(-W * 0.32, H * 0.22, H * 0.11) +
        C(-W * 0.4, -H * 0.36, H * 0.12, 'plcy') + C(W * 0.38, -H * 0.34, H * 0.13, 'plcy') + C(W * 0.42, H * 0.38, H * 0.1, 'plcy');
      case 'keys': return R(x0, y0, W, H, 3) + Array.from({ length: 13 }, (_, k) => L('M' + f(x0 + (k + 1) * W / 14) + ' ' + f(y0 + H * 0.35) + 'V' + f(-y0 - 2), 'plk2')).join('') + L('M' + f(x0) + ' ' + f(y0 + H * 0.35) + 'H' + f(-x0));
      case 'gtramp': return R(x0, y0, W, H, 3) + R(x0 + W * 0.12, y0 + H * 0.22, W * 0.76, H * 0.56, 2, 'plgr');
      case 'bassamp': return R(x0, y0, W, H, 3) + C(0, 0, Math.min(W, H) * 0.32, 'plk');
      case 'acoustic': return '<path class="pls" d="M0 ' + f(-H / 2) + 'V' + f(-H * 0.12) + 'M' + f(-W * 0.38) + ' ' + f(H * 0.18) + 'a' + f(W * 0.38) + ' ' + f(H * 0.3) + ' 0 1 0 ' + f(W * 0.76) + ' 0a' + f(W * 0.3) + ' ' + f(H * 0.2) + ' 0 0 0 ' + f(-W * 0.76) + ' 0Z"/>' + L('M0 ' + f(-H / 2) + 'V' + f(-H * 0.05)) + C(0, H * 0.14, W * 0.12, 'plk');
      case 'stand': return L('M' + f(x0) + ' ' + f(y0) + 'H' + f(-x0) + 'L' + f(-x0 - W * 0.15) + ' ' + f(-y0) + 'H' + f(x0 + W * 0.15) + 'Z', 'pls');
      case 'riser': return R(x0, y0, W, H, 2, 'plriser') + T('RISER', 4, 'plbig');
      case 'choir': {
        const rows = Math.max(1, Math.min(4, Math.round(h / 1.8))), cols = Math.max(2, Math.round(w / 2));
        let s = R(x0, y0, W, H, 8, 'plriser');
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) s += C(x0 + (c + 0.5 + (r % 2 ? 0.25 : 0)) * W / cols - (r % 2 ? W / cols / 4 : 0), y0 + (r + 0.5) * H / rows, Math.min(W / cols, H / rows) * 0.26, 'plk');
        return s;
      }
      case 'pulpit': return '<path class="pls" d="M' + f(x0) + ' ' + f(y0 + H * 0.25) + 'L' + f(x0 + W * 0.15) + ' ' + f(y0) + 'H' + f(-x0 - W * 0.15) + 'L' + f(-x0) + ' ' + f(y0 + H * 0.25) + 'V' + f(-y0) + 'H' + f(x0) + 'Z"/>';
      case 'chair': return R(x0, y0 + H * 0.2, W, H * 0.8, 4) + R(x0, y0, W, H * 0.22, 3);
      case 'table': return R(x0, y0, W, H, 3);
      case 'text': return '';
      case 'power': return R(x0, y0, W, H, 4, 'pls pldrop') + '<path class="plbolt" d="M' + f(W * 0.06) + ' ' + f(-H * 0.36) + 'L' + f(-W * 0.18) + ' ' + f(H * 0.04) + 'H' + f(W * 0.02) + 'L' + f(-W * 0.06) + ' ' + f(H * 0.36) + 'L' + f(W * 0.2) + ' ' + f(-H * 0.06) + 'H' + f(0) + 'Z"/>';
      case 'stagebox': return R(x0, y0, W, H, 3, 'pls pldrop') + T('SB', 5);
      case 'snake': return C(0, 0, W * 0.42, 'pls pldrop') + T('S', 5);
      case 'netdrop': return R(x0, y0, W, H, 4, 'pls pldrop') + L('M' + f(-W * 0.22) + ' ' + f(H * 0.18) + 'V' + f(-H * 0.05) + 'H' + f(W * 0.22) + 'V' + f(H * 0.18) + 'M0 ' + f(-H * 0.05) + 'V' + f(-H * 0.28));
    }
    return R(x0, y0, W, H, 4);
  }
  /** Size in feet of an item (resizable ones keep their own). */
  function sizeOf(it, g) {
    if (it.t === 'gear') { const k = GEAR[g ? g.kind : 'mic'] || GEAR.mic; return { w: k.w, h: k.h }; }
    const T0 = TYPES[it.t] || TYPES.table;
    return { w: T0.resize && it.w ? it.w : T0.w, h: T0.resize && it.h ? it.h : T0.h };
  }
  /** The colour family of an item, for its outline. */
  function catOf(it, g) { if (it.t === 'gear') return g ? (GEAR[g.kind] || {}).cat || 'io' : 'gone'; return TYPES[it.t] && TYPES[it.t].group === 'drops' ? 'drops' : 'people'; }
  /** The label under an item: up to two lines. */
  function linesOf(it, PI, items, draw) {
    if (it.t === 'gear') {
      const g = PI.G.get(it.gear);
      if (!g) return [it.label || 'Gone', 'not on the patch'];
      if (draw) { const ls = gearLines(g, PI.info.get(g.id), it.on ? 'on' : true); if (it.label) ls[1] = it.label; return ls.filter(Boolean); }
      const ls = gearLines(g, PI.info.get(g.id));
      const on = it.on && items.find((x) => x.id === it.on);
      if (on) ls[1] = [ls[1], 'on ' + (labelOf(on, PI, items) || TYPES[on.t].label)].filter(Boolean).join(' · ');
      if (it.label) ls[1] = [it.label, ls[1]].filter(Boolean).join(' · ');
      return ls.filter(Boolean);
    }
    if (it.t === 'text') return [it.label || 'Text'];
    const T0 = TYPES[it.t];
    if (it.t === 'person') return [it.label || 'Person'];
    if (it.t === 'riser' || it.t === 'choir' || it.t === 'table') return [it.label || T0.label, f(it.w || T0.w) + ' × ' + f(it.h || T0.h) + ' ft'];
    return [it.label || T0.label];
  }
  const labelOf = (it, PI, items) => (it.t === 'gear' ? (PI.G.get(it.gear) || {}).name : linesOf(it, PI, items)[0]);

  /** The whole drawing: the stage, its grid and measurements, then every item. forPrint: light, no grid handles. */
  function drawingSvg(o, items, PI, opts = {}) {
    const W = o.w * S_FT, D = o.d * S_FT, TW = o.tw * S_FT, TD = o.td * S_FT;
    const tx = (W - TW) / 2;
    let s = '';
    // the stage (and its thrust), a grid every foot (bolder every 5), the measurements and the sides
    const shape = 'M0 0H' + W + 'V' + D + (TW && TD ? 'H' + f(tx + TW) + 'V' + f(D + TD) + 'H' + f(tx) + 'V' + D : '') + 'H0Z';
    s += '<path class="plstage" d="' + shape + '"/>';
    const cid = 'plclip' + (opts.print ? 'p' : '');
    s += '<clipPath id="' + cid + '"><path d="' + shape + '"/></clipPath><g clip-path="url(#' + cid + ')" class="plgrid">';
    for (let x = 1; x < o.w + 0.01; x++) s += '<path class="' + (x % 5 ? 'g1' : 'g5') + '" d="M' + x * S_FT + ' 0V' + f(D + TD) + '"/>';
    for (let y = 1; y < o.d + o.td + 0.01; y++) s += '<path class="' + (y % 5 ? 'g1' : 'g5') + '" d="M0 ' + y * S_FT + 'H' + W + '"/>';
    s += '</g><path class="plstage plrim" d="' + shape + '"/>';
    s += '<text class="pldim" x="' + W / 2 + '" y="-14" text-anchor="middle">' + o.w + ' ft · Upstage</text>';
    s += '<text class="pldim" x="-14" y="' + D / 2 + '" text-anchor="middle" transform="rotate(-90 -14 ' + D / 2 + ')">' + o.d + ' ft</text>';
    s += '<text class="plside" x="14" y="' + (D - 12) + '">Stage right</text><text class="plside" x="' + (W - 14) + '" y="' + (D - 12) + '" text-anchor="end">Stage left</text>';
    s += '<text class="plfront" x="' + W / 2 + '" y="' + f(D + TD + 30) + '" text-anchor="middle">' + esc(o.label || 'Downstage · Audience') + '</text>';
    // items: big things first (risers, choir) so people and mics sit on top of them
    const order = (it) => (['riser', 'choir', 'table'].includes(it.t) ? 0 : it.t === 'gear' ? 2 : 1);
    const sorted = items.slice().sort((a, b) => order(a) - order(b));
    const labels = [];
    for (const it of sorted) {
      const g = it.t === 'gear' ? PI.G.get(it.gear) : null;
      const sz = sizeOf(it, g), cat = catOf(it, g);
      const cx = it.x * S_FT, cy = it.y * S_FT;
      const sel = opts.sel && opts.sel.includes(it.id);
      const hw = sz.w * S_FT / 2 + 4, hh = sz.h * S_FT / 2 + 4;
      s += '<g class="pli c-' + cat + ' t-' + it.t + (g ? ' k-' + g.kind : '') + (sel ? ' sel' : '') + (opts.hi && opts.hi.has(it.id) ? ' on' : '') + '" data-i="' + it.id + '" transform="translate(' + f(cx) + ' ' + f(cy) + ')' + (it.r ? ' rotate(' + it.r + ')' : '') + '" style="--c:' + (COLOR[cat] || '#d24b4b') + '">' +
        '<rect class="plhit" x="' + f(-hw) + '" y="' + f(-hh) + '" width="' + f(hw * 2) + '" height="' + f(hh * 2) + '" rx="6"/>' + iconSvg(it.t, g && g.kind, sz.w, sz.h) +
        (sel ? '<rect class="plsel" x="' + f(-hw) + '" y="' + f(-hh) + '" width="' + f(hw * 2) + '" height="' + f(hh * 2) + '" rx="6"/>' + (TYPES[it.t] && TYPES[it.t].resize && opts.edit && opts.sel.length === 1 ? '<circle class="plgrip" data-grip="' + it.id + '" cx="' + f(hw) + '" cy="' + f(hh) + '" r="7"/>' : '') : '') + '</g>';
      // the label stays upright: under the item, inside the top of a riser, choir or table, or (a text item) the item itself
      const ls = linesOf(it, PI, items, true);
      const ext = it.r % 180 === 90 ? sz.w : sz.h;
      const area = ['riser', 'choir', 'table'].includes(it.t) && !(it.r % 180);
      const ly = it.t === 'text' ? cy + 5 : area ? cy - ext * S_FT / 2 + 15 : cy + ext * S_FT / 2 + 13;
      const wd = Math.max(...ls.map((l, k) => l.length * (k ? 5.4 : it.t === 'text' ? 8 : 6.4))) + 6;
      labels.push({ it, cat, ls, x: cx, y: ly, w: wd, h: ls.length * 12 + 2, fixed: area || it.t === 'text', on: opts.hi && opts.hi.has(it.id) });
    }
    // labels never sit on top of each other: one that would is moved down a line or two (or up, if that is clearer)
    const placedL = [];
    const hit = (L, y) => placedL.some((o) => Math.abs(o.x - L.x) * 2 < (o.w + L.w) && y - 11 < o.y - 11 + o.h && o.y - 11 < y - 11 + L.h);
    labels.sort((a, b) => a.y - b.y || a.x - b.x).forEach((L) => {
      if (!L.fixed) { const base = L.y; for (const dy of [0, 12, 24, -12, 36, 48]) { if (!hit(L, base + dy)) { L.y = base + dy; break; } } }
      placedL.push(L);
    });
    s += '<g class="pllabs">' + labels.map((L) => '<text class="pllab' + (L.it.t === 'text' ? ' pltext' : '') + (L.cat === 'gone' ? ' plgone' : '') + (L.it.t === 'gear' ? ' plgear' : '') + (L.on ? ' on' : '') + '" data-i="' + L.it.id + '" x="' + f(L.x) + '" y="' + f(L.y) + '" text-anchor="middle">' + L.ls.map((l, k) => '<tspan x="' + f(L.x) + '"' + (k ? ' dy="12" class="pll2"' : '') + '>' + esc(l) + '</tspan>').join('') + '</text>').join('') + '</g>';
    return s;
  }
  /** The box round the stage (and anything placed off it), in drawing units. */
  function boundsOf(o, items) {
    let x0 = -40, y0 = -40, x1 = o.w * S_FT + 30, y1 = (o.d + o.td) * S_FT + 46;
    for (const it of items) { const px = it.x * S_FT, py = it.y * S_FT; x0 = Math.min(x0, px - 60); x1 = Math.max(x1, px + 60); y0 = Math.min(y0, py - 60); y1 = Math.max(y1, py + 70); }
    return { x0, y0, x1, y1 };
  }

  // ================= a plot =================
  async function view(id, mode) {
    let data, pdata;
    try { [data, pdata] = await Promise.all([get('/api/plots/' + id), get('/api/patch').catch(() => null), loadDevices(true)]); }
    catch (e) { if (e.status === 404) { app.innerHTML = '<div class="card empty"><b>That stage plot is not here any more.</b><div style="margin-top:12px"><a class="btn" href="#/plots">Stage plots</a></div></div>'; return; } throw e; }
    const canEdit = can('admin');
    const st = {
      plot: data.plot, o: data.outline, doc: data.plot.doc, patch: (pdata && pdata.doc) || { gear: [], cables: [] }, rev: (pdata && pdata.rev) || '', draft: !!(pdata && pdata.draft),
      edit: canEdit && mode === 'edit', sel: [], undo: [], redo: [], tf: null, snap: true, selTool: false, space: false, userView: false, add: 'patch'
    };
    try { st.snap = localStorage.getItem('lg-plsnap') !== '0'; } catch (e) { /* private mode */ }
    setTitle(st.plot.name);
    let PI = patchInfo(st.patch);
    app.innerHTML = `<div class="page plotv${st.edit ? ' editing' : ''}">
      <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/plots">Stage plots</a></div>
      <div class="bar"><div class="grow"><div class="ptitle"><span class="pkick">STAGE PLOT</span><h1 class="title" id="pltl">${esc(st.plot.name)}</h1>
        <div class="note" id="plsub"></div></div></div>
        ${st.edit ? '<button class="btn" id="plDet">' + icon('edit') + 'Details</button><button class="btn" id="plOut">' + icon('grid') + 'Stage outline</button><button class="btn primary" id="plDone">' + icon('check') + 'Done</button>'
          : (canEdit ? '<a class="btn primary" href="#/plots/' + st.plot.id + '/edit">' + icon('edit') + 'Edit</a>' : '') + '<button class="btn" id="plFit">' + icon('grid') + 'Fit</button><button class="btn" id="plPdf">' + icon('pdf') + 'PDF</button>'}</div>
      ${st.edit ? '<div class="pltools"><button class="btn sm" id="plUndo">' + icon('restore') + 'Undo</button><button class="btn sm" id="plRedo">Redo</button><span class="rksep"></span>' +
        '<button class="btn sm" id="plSelT" aria-pressed="false">' + icon('check') + 'Select</button><button class="btn sm" id="plRotL" title="Turn left 15° (Shift+R)">⟲ 15°</button><button class="btn sm" id="plRotR" title="Turn right 15° (R)">⟳ 15°</button><button class="btn sm ghost danger" id="plDel">' + icon('trash') + 'Delete</button>' +
        '<label class="tog"><input type="checkbox" id="plSnap"' + (st.snap ? ' checked' : '') + '><span>Snap</span></label><span class="note" id="plst"></span><span class="grow"></span><span class="note plhint hide-sm">Drag empty space to box-select · space-drag or two fingers to pan · R turns</span></div>' : ''}
      ${st.plot.notes && !st.edit ? '<div class="doc rknotes">' + md(st.plot.notes) + '</div>' : ''}
      <div class="plmain"><div class="plcanvas" id="plcv"><svg id="plsvg" class="plsvg"><g id="plvp"></g><rect id="plmq" class="plmq hide"/></svg>
        <div class="pzoom"><button id="plzi" aria-label="Zoom in">+</button><button id="plzo" aria-label="Zoom out">−</button><button id="plzf" aria-label="Fit">⤢</button></div>
        <div class="plkey" id="plkey"></div></div>
        <aside class="plpane" id="plpane"></aside></div>
    </div>`;
    const svg = $('#plsvg'), vp = $('#plvp'), cv = $('#plcv');

    // ---------- saving: as you go, a moment after the last change ----------
    let saveT = null, saving = Promise.resolve();
    const saveNote = (t) => { const n = $('#plst'); if (n) n.textContent = t; };
    function queueSave() {
      if (!st.edit) return;
      S.dirty = true; saveNote('Saving…');
      clearTimeout(saveT);
      saveT = setTimeout(flush, 700);
    }
    function flush() {
      clearTimeout(saveT);
      if (!S.dirty) return saving;
      const doc = JSON.parse(JSON.stringify(st.doc));
      saving = saving.then(async () => {
        try { const r = await call('PUT', '/api/plots/' + st.plot.id, { doc }); st.plot = r.plot; S.dirty = false; saveNote('Saved'); paintSub(); }
        catch (e) { toast(e.message, 'bad'); saveNote('Not saved'); }
      });
      return saving;
    }
    window.addEventListener('hashchange', function gone() { window.removeEventListener('hashchange', gone); if (S.dirty) flush(); });
    function change(fn) {
      st.undo.push(JSON.stringify(st.doc)); if (st.undo.length > 100) st.undo.shift();
      st.redo = [];
      fn();
      paint(); paintPane(); queueSave();
    }
    function undo() { if (!st.undo.length) return; st.redo.push(JSON.stringify(st.doc)); st.doc = JSON.parse(st.undo.pop()); st.sel = st.sel.filter((id) => itemOf(id)); paint(); paintPane(); queueSave(); }
    function redo() { if (!st.redo.length) return; st.undo.push(JSON.stringify(st.doc)); st.doc = JSON.parse(st.redo.pop()); st.sel = st.sel.filter((id) => itemOf(id)); paint(); paintPane(); queueSave(); }
    const itemOf = (id) => st.doc.items.find((x) => x.id === id);
    const uid = () => 'p' + Math.random().toString(36).slice(2, 9);
    const snapV = (v) => (st.snap ? Math.round(v / GRID) * GRID : Math.round(v * 100) / 100);

    function paintSub() {
      const when = new Date(st.plot.updated_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const gone = st.doc.items.filter((x) => x.t === 'gear' && !PI.G.has(x.gear)).length;
      $('#plsub').innerHTML = esc(st.o.w + ' × ' + st.o.d + ' ft stage · ' + st.doc.items.length + ' item' + (st.doc.items.length === 1 ? '' : 's') + ' · changed ' + when + (st.plot.updated_by ? ' by ' + st.plot.updated_by : '')) +
        (gone ? ' · <span class="plwarn">' + gone + ' not on the stage patch any more</span>' : '');
    }

    // ---------- paint ----------
    let hi = new Set();
    function paint() {
      PI = patchInfo(st.patch);
      vp.innerHTML = drawingSvg(st.o, st.doc.items, PI, { sel: st.sel, edit: st.edit, hi });
      svg.classList.toggle('dim', !st.edit && st.sel.length > 0);
      paintKey(); paintSub();
    }
    function paintKey() {
      const used = new Set(st.doc.items.map((it) => catOf(it, it.t === 'gear' ? PI.G.get(it.gear) : null)));
      const names = { source: 'Inputs: mics, DIs', pa: 'Wedges and speakers', iem: 'In-ear packs', io: 'Stage boxes', people: 'People and instruments', drops: 'Power and drops', gone: 'Not on the patch' };
      $('#plkey').innerHTML = Object.keys(names).filter((k) => used.has(k)).map((k) => '<span><i style="background:' + (COLOR[k] || '#d24b4b') + '"></i>' + names[k] + '</span>').join('');
    }

    // ---------- pan and zoom ----------
    function apply() { vp.setAttribute('transform', 'translate(' + f(st.tf.x) + ',' + f(st.tf.y) + ') scale(' + st.tf.k + ')'); $('#plmq').setAttribute('transform', 'translate(' + f(st.tf.x) + ',' + f(st.tf.y) + ') scale(' + st.tf.k + ')'); }
    function fit(box) {
      const b = box || boundsOf(st.o, st.doc.items);
      // the canvas is as tall as the stage needs at this width (no taller than the window)
      const bw = b.x1 - b.x0, bh = b.y1 - b.y0, cw = cv.getBoundingClientRect().width || 600;
      cv.style.height = Math.round(Math.max(320, Math.min(window.innerHeight - (matchMedia('(min-width: 900px)').matches ? 170 : 150), (cw - 58) * bh / bw + 70))) + 'px';
      const r = cv.getBoundingClientRect();
      const keyH = ($('#plkey', cv).getBoundingClientRect().height || 0) + 10;
      const M = 14, w = r.width - M * 2 - 44, h = r.height - M * 2 - keyH;
      const k = Math.max(0.1, Math.min(3, w / (b.x1 - b.x0), h / (b.y1 - b.y0)));
      st.tf = { k, x: M + (w - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: M + Math.max(0, (h - (b.y1 - b.y0) * k) / 2) - b.y0 * k };
      st.userView = false; apply();
    }
    const world = (cx, cy) => { const r = svg.getBoundingClientRect(); return { x: (cx - r.left - st.tf.x) / st.tf.k, y: (cy - r.top - st.tf.y) / st.tf.k }; };
    function zoomAt(fac, cx, cy) {
      st.userView = true;
      const r = svg.getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
      const k = Math.max(0.1, Math.min(5, st.tf.k * fac));
      st.tf.x = px - (px - st.tf.x) * (k / st.tf.k); st.tf.y = py - (py - st.tf.y) * (k / st.tf.k); st.tf.k = k; apply();
    }
    svg.addEventListener('wheel', (e) => { e.preventDefault(); if (e.ctrlKey || e.metaKey || !e.deltaX) zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); else { st.userView = true; st.tf.x -= e.deltaX; st.tf.y -= e.deltaY; apply(); } }, { passive: false });
    $('#plzi').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2); });
    $('#plzo').addEventListener('click', () => { const r = svg.getBoundingClientRect(); zoomAt(0.8, r.left + r.width / 2, r.top + r.height / 2); });
    $('#plzf').addEventListener('click', () => fit());
    const pf = $('#plFit'); if (pf) pf.addEventListener('click', () => fit());
    let rsz = null;
    window.addEventListener('resize', function onResize() { if (!svg.isConnected) return window.removeEventListener('resize', onResize); clearTimeout(rsz); rsz = setTimeout(() => { if (svg.isConnected && !st.userView && !document.body.classList.contains('printreport')) fit(); }, 200); });

    // ---------- selecting ----------
    function select(ids, add) {
      ids = (ids || []).filter((id) => itemOf(id));
      st.sel = add ? [...new Set(st.sel.concat(ids))] : ids;
      // in view mode, what is picked lights up with whatever sits on it (a mic on a person)
      hi = new Set();
      if (!st.edit) st.sel.forEach((id) => { hi.add(id); st.doc.items.forEach((x) => { if (x.on === id) hi.add(x.id); }); const it = itemOf(id); if (it && it.on) hi.add(it.on); });
      paint(); paintPane();
    }

    // ---------- pointer: pan, pinch, tap, drag items, box select, resize ----------
    const pts = new Map();
    let gesture = null;
    const isTouch = (e) => e.pointerType === 'touch';
    window.addEventListener('keydown', function kd(e) { if (!svg.isConnected) return window.removeEventListener('keydown', kd); onKey(e); });
    window.addEventListener('keyup', function ku(e) { if (!svg.isConnected) return window.removeEventListener('keyup', ku); if (e.code === 'Space') { st.space = false; cv.classList.remove('panning'); } });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    svg.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [p, q] = [...pts.values()]; gesture = { pinch: true, d: Math.hypot(p.x - q.x, p.y - q.y), k: st.tf.k, mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 }; return; }
      const t = e.target;
      const panBtn = e.button === 1 || e.button === 2 || (st.space && !isTouch(e));
      const itEl = t.closest('.pli'), grip = t.closest('[data-grip]'), lab = t.closest('.pllab');
      const iid = grip ? grip.dataset.grip : itEl ? itEl.dataset.i : lab ? lab.dataset.i : null;
      svg.setPointerCapture(e.pointerId);
      if (panBtn) { e.preventDefault(); gesture = { pan: true, sx: e.clientX, sy: e.clientY, x: st.tf.x, y: st.tf.y, moved: true }; return; }
      if (st.edit && grip) {
        e.preventDefault();
        const it = itemOf(iid);
        gesture = { resize: true, it, w0: it.w || TYPES[it.t].w, h0: it.h || TYPES[it.t].h, p: world(e.clientX, e.clientY), before: JSON.stringify(st.doc) };
        return;
      }
      if (st.edit && iid) {
        e.preventDefault();
        if (e.shiftKey || e.ctrlKey || e.metaKey) { select(st.sel.includes(iid) ? st.sel.filter((x) => x !== iid) : st.sel.concat([iid])); gesture = null; return; }
        if (!st.sel.includes(iid)) select([iid]);
        // the selection moves together, and whatever sits on a moved item (a mic on a person) comes along
        const ids = new Set(st.sel);
        st.doc.items.forEach((x) => { if (x.on && ids.has(x.on)) ids.add(x.id); });
        gesture = { move: true, ids: [...ids], start: st.doc.items.filter((x) => ids.has(x.id)).map((x) => ({ id: x.id, x: x.x, y: x.y })), p: world(e.clientX, e.clientY), lead: itemOf(iid), moved: false, before: JSON.stringify(st.doc) };
        return;
      }
      if (st.edit && !iid && (!isTouch(e) || st.selTool)) {
        e.preventDefault();
        gesture = { marquee: true, p: world(e.clientX, e.clientY), add: e.shiftKey || e.ctrlKey || e.metaKey, moved: false };
        return;
      }
      gesture = { pan: true, sx: e.clientX, sy: e.clientY, x: st.tf.x, y: st.tf.y, moved: false, tap: iid };
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture) return;
      if (gesture.pinch && pts.size === 2) {
        const [p, q] = [...pts.values()];
        const d = Math.hypot(p.x - q.x, p.y - q.y), mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        zoomAt((gesture.k * d / gesture.d) / st.tf.k, mx, my);
        st.tf.x += mx - gesture.mx; st.tf.y += my - gesture.my; gesture.mx = mx; gesture.my = my; apply();
        return;
      }
      if (gesture.pan) {
        const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) gesture.moved = true;
        if (gesture.moved) { st.userView = true; st.tf.x = gesture.x + dx; st.tf.y = gesture.y + dy; apply(); cv.classList.add('panning'); }
        return;
      }
      const w = world(e.clientX, e.clientY);
      if (gesture.move) {
        let dx = (w.x - gesture.p.x) / S_FT, dy = (w.y - gesture.p.y) / S_FT;
        if (!gesture.moved && Math.hypot(dx, dy) * S_FT * st.tf.k < 3) return;
        gesture.moved = true;
        // snap the item you hold to the grid; the rest keep their places relative to it
        const lead = gesture.start.find((x) => x.id === gesture.lead.id);
        const nx = snapV(lead.x + dx), ny = snapV(lead.y + dy);
        dx = nx - lead.x; dy = ny - lead.y;
        gesture.start.forEach((s0) => { const it = itemOf(s0.id); if (it) { it.x = Math.round((s0.x + dx) * 100) / 100; it.y = Math.round((s0.y + dy) * 100) / 100; } });
        paint();
        return;
      }
      if (gesture.resize) {
        const it = gesture.it, a = -(it.r || 0) * Math.PI / 180;
        const dx0 = (w.x - gesture.p.x) / S_FT, dy0 = (w.y - gesture.p.y) / S_FT;
        const dx = dx0 * Math.cos(a) - dy0 * Math.sin(a), dy = dx0 * Math.sin(a) + dy0 * Math.cos(a);
        it.w = Math.max(1, snapV(gesture.w0 + dx * 2)); it.h = Math.max(1, snapV(gesture.h0 + dy * 2));
        paint(); return;
      }
      if (gesture.marquee) {
        gesture.moved = true;
        const x0 = Math.min(gesture.p.x, w.x), y0 = Math.min(gesture.p.y, w.y);
        const mq = $('#plmq'); mq.classList.remove('hide');
        mq.setAttribute('x', f(x0)); mq.setAttribute('y', f(y0)); mq.setAttribute('width', f(Math.abs(w.x - gesture.p.x))); mq.setAttribute('height', f(Math.abs(w.y - gesture.p.y)));
        gesture.box = { x0, y0, x1: Math.max(gesture.p.x, w.x), y1: Math.max(gesture.p.y, w.y) };
      }
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      cv.classList.remove('panning');
      const g = gesture; if (pts.size) return;
      gesture = null;
      if (!g) return;
      if ((g.move || g.resize) && (g.moved || g.resize)) {
        st.undo.push(g.before); st.redo = [];
        paintPane(); queueSave();
        return;
      }
      if (g.marquee) {
        $('#plmq').classList.add('hide');
        if (!g.moved || !g.box) { select([]); return; }
        const b = g.box;
        const ids = st.doc.items.filter((it) => { const x = it.x * S_FT, y = it.y * S_FT; return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; }).map((x) => x.id);
        select(ids, g.add);
        return;
      }
      if (g.pan && !g.moved) select(g.tap ? [g.tap] : []);
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    // drop something from the pane onto the drawing
    svg.addEventListener('dragover', (e) => { if (st.edit) e.preventDefault(); });
    svg.addEventListener('drop', (e) => {
      if (!st.edit) return;
      e.preventDefault();
      const v = e.dataTransfer.getData('text/plain'); if (!v) return;
      const w = world(e.clientX, e.clientY);
      addItem(v, w.x / S_FT, w.y / S_FT);
    });

    function onKey(e) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') || document.querySelector('.modal')) return;
      if (e.code === 'Space' && st.edit) { st.space = true; cv.classList.add('panning'); e.preventDefault(); return; }
      if (e.key === 'Escape') { select([]); return; }
      if (!st.edit) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); select(st.doc.items.map((x) => x.id)); return; }
      if (!st.sel.length) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); return; }
      if (e.key.toLowerCase() === 'r' && !mod) { e.preventDefault(); rotate(e.shiftKey ? -15 : 15); return; }
      const step = e.shiftKey ? 2 : GRID, dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (dir) { e.preventDefault(); change(() => st.sel.forEach((id) => { const it = itemOf(id); it.x = Math.round((it.x + dir[0] * step) * 100) / 100; it.y = Math.round((it.y + dir[1] * step) * 100) / 100; })); }
    }
    function rotate(deg) { if (!st.sel.length) return; change(() => st.sel.forEach((id) => { const it = itemOf(id); it.r = (((it.r || 0) + deg) % 360 + 360) % 360; })); }
    function removeSel() {
      if (!st.sel.length) return;
      const ids = new Set(st.sel);
      change(() => { st.doc.items = st.doc.items.filter((x) => !ids.has(x.id)); st.doc.items.forEach((x) => { if (x.on && ids.has(x.on)) delete x.on; }); st.sel = []; });
      toast(ids.size + ' removed from the plot. Undo brings ' + (ids.size === 1 ? 'it' : 'them') + ' back.');
    }

    /** Add a type ("person", "gear:g12") at a spot in feet (or the middle of the view). */
    function addItem(v, x, y) {
      const tapped = x == null;
      if (tapped) { const r = svg.getBoundingClientRect(); const w = world(r.left + r.width * 0.45, r.top + r.height * 0.45); x = w.x / S_FT; y = w.y / S_FT; }
      x = Math.max(-4, Math.min(st.o.w + 4, snapV(x))); y = Math.max(-4, Math.min(st.o.d + st.o.td + 4, snapV(y)));
      // tapped in, not dropped: a spot already taken moves the new one along a little, so they do not pile up
      for (let k = 0; tapped && k < 12 && st.doc.items.some((o) => Math.abs(o.x - x) < 1 && Math.abs(o.y - y) < 1); k++) { x += 1.5; y += k % 2 ? 0 : 1; }
      const it = { id: uid(), x, y, r: 0 };
      if (v.startsWith('gear:')) {
        const gid = v.slice(5);
        if (st.doc.items.some((a) => a.gear === gid)) { select([st.doc.items.find((a) => a.gear === gid).id]); toast('Already on the plot: it is selected'); return; }
        it.t = 'gear'; it.gear = gid;
        const g = PI.G.get(gid);
        if (g && (g.kind === 'mic' || g.kind === 'di')) it.stand = g.kind === 'mic' ? 'Tall boom' : '';
      } else {
        if (!TYPES[v]) return;
        it.t = v;
        if (TYPES[v].resize) { it.w = TYPES[v].w; it.h = TYPES[v].h; }
      }
      change(() => st.doc.items.push(it));
      select([it.id]);
    }

    // ---------- the side pane ----------
    function paintPane() {
      const host = $('#plpane');
      const items = st.doc.items;
      if (st.sel.length > 1) {
        host.innerHTML = '<div class="pph"><b>' + st.sel.length + ' selected</b><button class="ghost pback" id="plpx">' + icon('x') + '</button></div>' +
          (st.edit ? '<div class="plrow"><button class="btn sm" data-rot="-15">⟲ 15°</button><button class="btn sm" data-rot="15">⟳ 15°</button><button class="btn sm ghost danger" id="plrm">' + icon('trash') + 'Remove</button></div><p class="note">Drag any of them to move them together. Arrow keys nudge.</p>' : '') +
          '<div class="pllist">' + st.sel.map((id) => itemOf(id)).filter(Boolean).map((it) => '<button class="plli" data-pick="' + it.id + '">' + esc(linesOf(it, PI, items).join(' · ')) + '</button>').join('') + '</div>';
        wirePane(host);
        return;
      }
      if (st.sel.length === 1) return paintItem(host, itemOf(st.sel[0]));
      if (st.edit) return paintAdd(host);
      // view mode, nothing picked: what is on the plot
      const gone = items.filter((x) => x.t === 'gear' && !PI.G.has(x.gear));
      const ins = items.filter((x) => x.t === 'gear' && PI.G.has(x.gear) && GEAR[PI.G.get(x.gear).kind].cat === 'source');
      const mons = items.filter((x) => x.t === 'gear' && PI.G.has(x.gear) && ['pa', 'iem'].includes(GEAR[PI.G.get(x.gear).kind].cat));
      const row = (it) => '<button class="plli" data-pick="' + it.id + '">' + esc(linesOf(it, PI, items).join(' · ')) + '</button>';
      host.innerHTML = '<div class="pph"><b>On this plot</b></div><p class="note">Tap anything on the stage to see what it is, its channel and where it is in the room.</p>' +
        (gone.length ? '<div class="plgonebox"><b>' + icon('warn') + gone.length + ' not on the stage patch any more</b>' + gone.map(row).join('') + '</div>' : '') +
        (ins.length ? '<div class="pch">Inputs</div><div class="pllist">' + ins.sort((a, b) => chKey(a) - chKey(b)).map(row).join('') + '</div>' : '') +
        (mons.length ? '<div class="pch">Monitors</div><div class="pllist">' + mons.map(row).join('') + '</div>' : '') +
        (!items.length ? '<div class="card empty" style="padding:14px">Nothing on this stage plot yet.' + (canEdit ? ' Tap Edit to place the band, the mics and the wedges.' : '') + '</div>' : '');
      wirePane(host);
    }
    const chKey = (it) => { const i = PI.info.get(it.gear); return i && i.chs.length ? i.chs[0] : 9999; };
    function wirePane(host) {
      $$('[data-pick]', host).forEach((b) => b.addEventListener('click', () => { select([b.dataset.pick]); }));
      $$('[data-rot]', host).forEach((b) => b.addEventListener('click', () => rotate(Number(b.dataset.rot))));
      const rm = $('#plrm', host); if (rm) rm.addEventListener('click', removeSel);
      const px = $('#plpx', host); if (px) px.addEventListener('click', () => select([]));
    }

    /** Edit mode, nothing picked: add from the patch, people and instruments, power and drops. */
    function paintAdd(host) {
      const placed = new Set(st.doc.items.filter((x) => x.t === 'gear').map((x) => x.gear));
      const tabs = [['patch', 'From the patch'], ['people', 'People · instruments'], ['drops', 'Power · drops']];
      let body = '';
      if (st.add === 'patch') {
        const groups = {};
        st.patch.gear.filter((g) => GEAR[g.kind]).forEach((g) => { const k = GEAR[g.kind].group; (groups[k] = groups[k] || []).push(g); });
        const all = Object.values(groups).flat();
        body = all.length ? '<p class="note">Drag onto the stage, or tap to drop it in the middle. Labels come from the stage patch and stay up to date.</p>' + GEAR_ORDER.filter((k) => groups[k]).map((k) => {
          const list = groups[k].slice().sort((a, b) => (placed.has(a.id) - placed.has(b.id)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
          const left = list.filter((g) => !placed.has(g.id)).length;
          return '<div class="pch">' + esc(k) + ' <span class="note">' + (left ? left + ' to place' : 'all placed') + '</span></div><div class="plcands">' + list.map((g) => {
            const ls = gearLines(g, PI.info.get(g.id));
            return '<button class="rkcand' + (placed.has(g.id) ? ' done' : '') + '" draggable="true" data-add="gear:' + esc(g.id) + '"><b>' + esc(ls[0]) + (placed.has(g.id) ? ' ✓' : '') + '</b><span>' + esc(ls[1] || P.KINDS[g.kind].label) + '</span></button>';
          }).join('') + '</div>';
        }).join('') : '<div class="card empty" style="padding:14px">The stage patch has no mics, DIs, wedges or IEM packs yet. People, instruments and drops can still go on the plot.</div>';
      } else {
        const want = st.add;
        body = '<p class="note">Drag onto the stage, or tap to drop it in the middle.</p><div class="pltypes">' + Object.entries(TYPES).filter(([, v]) => v.group === want).map(([k, v]) => {
          const sz = { w: v.w, h: v.h }, sc = 34 / Math.max(sz.w, sz.h) / S_FT;
          return '<button class="pltype" draggable="true" data-add="' + k + '"><svg viewBox="-20 -20 40 40" class="plsvg plico2" style="--c:' + (want === 'drops' ? COLOR.drops : COLOR.people) + '"><g class="pli" transform="scale(' + f(sc * 1.0) + ')">' + (k === 'text' ? '<text class="plin" x="0" y="8" text-anchor="middle" style="font-size:' + f(26 / sc / 1.2) + 'px">Aa</text>' : iconSvg(k, null, sz.w, sz.h)) + '</g></svg><span>' + esc(v.label) + '</span></button>';
        }).join('') + '</div>' + (want === 'drops' && st.patch.gear.some((g) => g.kind === 'stagebox') ? '<p class="note">Stage boxes from the patch are under <b>From the patch</b>, labelled with their name and model.</p>' : '');
      }
      host.innerHTML = '<div class="pph"><b>Add to the plot</b></div><div class="segs pltabs">' + tabs.map(([k, l]) => '<button class="' + (st.add === k ? 'on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>' + body;
      $$('[data-tab]', host).forEach((b) => b.addEventListener('click', () => { st.add = b.dataset.tab; paintPane(); }));
      $$('[data-add]', host).forEach((b) => {
        b.addEventListener('click', () => addItem(b.dataset.add));
        b.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', b.dataset.add));
      });
    }

    /** One item: what it is, its label, where it is in the room, and (editing) its settings. */
    function paintItem(host, it) {
      if (!it) { st.sel = []; return paintPane(); }
      const g = it.t === 'gear' ? PI.G.get(it.gear) : null;
      const inf = g ? PI.info.get(g.id) : null;
      const dev = g && g.device_id ? (DEV.list || []).find((d) => d.id === g.device_id) : null;
      const T0 = TYPES[it.t];
      const kindName = it.t === 'gear' ? (g ? P.KINDS[g.kind].label : 'Not on the patch') : T0.label;
      const ro = !st.edit;
      const fld = (k, l, v, extra) => '<label>' + l + '<input data-f="' + k + '" value="' + esc(v == null ? '' : v) + '"' + (ro ? ' disabled' : '') + (extra || '') + '></label>';
      const facts = [];
      if (g) {
        if (g.person) facts.push(['Who', g.person]);
        if (g.use) facts.push(['For', g.use]);
        if (inf && inf.chs.length) facts.push(['Console channel', inf.chs.join(', ')]);
        if (inf && inf.sb.length) facts.push(['Plugs into', inf.sb.join(', ')]);
        if (inf && inf.rx) facts.push(['Receiver', inf.rx]);
        if (inf && inf.mix) facts.push(['Mix', inf.mix]);
        if (inf && inf.tx) facts.push(['Transmitter', inf.tx]);
        if (inf && inf.ports) facts.push(['Sockets', inf.ports]);
        if (g.model || g.make) facts.push(['Model', [g.make, g.model].filter(Boolean).join(' ')]);
        if (g.capsule) facts.push(['Capsule', g.capsule]);
        if (g.freq) facts.push(['Frequency', g.freq + ' MHz']);
      }
      const others = st.doc.items.filter((x) => x.id !== it.id && x.t !== 'gear' && !['text', 'power', 'snake', 'netdrop', 'stagebox'].includes(x.t));
      const rooms = (ROOMS.list || []).filter((r) => r.photo);
      let html = '<div class="pph"><button class="ghost pback" id="plpx" title="Back">' + icon('x') + '</button><span class="pkind">' + esc(kindName) + '</span></div>' +
        '<h3 class="plh">' + esc(linesOf(it, PI, st.doc.items)[0]) + '</h3>' + (it.t === 'gear' && !g ? '<p class="plwarn">' + icon('warn') + 'This was taken off the stage patch. Remove it here, or put it back on the patch.</p>' : '') +
        (facts.length ? '<dl class="plfacts">' + facts.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' : '') +
        (g ? '<div class="plrow"><a class="btn sm" href="#/patch?g=' + encodeURIComponent(g.id) + '">' + icon('grid') + 'On the stage patch</a>' + (dev ? '<a class="btn sm" href="#/d/' + dev.id + '">' + icon('box') + 'Gear card</a>' : '') + '</div>' : '');
      // its settings (looking, not editing: just what is set)
      if (!st.edit) {
        const on = it.on && itemOf(it.on);
        const rest = [['Label', it.t === 'gear' ? it.label : ''], ['Stand', it.stand], ['On or with', on ? linesOf(on, PI, st.doc.items)[0] : ''], ['Size', T0 && T0.resize ? f(it.w || T0.w) + ' × ' + f(it.h || T0.h) + ' ft' : ''], ['Notes', it.notes]].filter((x) => x[1]);
        if (rest.length) html += '<dl class="plfacts">' + rest.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>';
      } else {
        html += '<div class="plform">' +
          (it.t === 'gear' ? fld('label', 'Extra label', it.label, ' placeholder="Shows before the channel, like Kick in"') : fld('label', it.t === 'person' ? 'Name or role' : 'Label', it.label, ' placeholder="' + esc(it.t === 'person' ? 'Kyle, Vocals 1, Pastor' : T0.label) + '"')) +
          (g && ['mic', 'txmic', 'di'].includes(g.kind) ? '<label>Stand<select data-f="stand"' + (ro ? ' disabled' : '') + '>' + STANDS.map((s) => '<option value="' + esc(s) + '"' + ((it.stand || '') === s ? ' selected' : '') + '>' + esc(s || 'Not set') + '</option>').join('') + '</select></label>' : '') +
          (it.t === 'gear' || ['acoustic', 'keys', 'gtramp', 'bassamp', 'stand', 'chair', 'pulpit'].includes(it.t) ? '<label>On or with<select data-f="on"' + (ro ? ' disabled' : '') + '><option value="">Nothing</option>' + others.filter((x) => x.id !== it.id).map((x) => '<option value="' + x.id + '"' + (it.on === x.id ? ' selected' : '') + '>' + esc(linesOf(x, PI, st.doc.items)[0] + (x.t === 'person' ? '' : ' (' + TYPES[x.t].label.toLowerCase() + ')')) + '</option>').join('') + '</select><span class="note">It moves with that, and says so on its label.</span></label>' : '') +
          (T0 && T0.resize ? '<div class="two">' + fld('w', 'Width (ft)', it.w || T0.w, ' type="number" min="1" max="200" step="0.5"') + fld('h', 'Depth (ft)', it.h || T0.h, ' type="number" min="1" max="120" step="0.5"') + '</div>' : '') +
          '<label>Notes<textarea data-f="notes" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(it.notes || '') + '</textarea></label>' +
          (st.edit ? '<div class="plrow"><button class="btn sm" data-rot="-15">⟲ 15°</button><button class="btn sm" data-rot="15">⟳ 15°</button><span class="note">' + (it.r || 0) + '°</span><span class="grow"></span><button class="btn sm ghost danger" id="plrm">' + icon('trash') + 'Remove</button></div>' : '') + '</div>';
      }
      // where it is in the room: the gear card's spot, or (for the rest) a spot of its own on a room photo
      html += '<div id="plphoto"></div>';
      if (it.t !== 'gear' && st.edit && rooms.length) html += '<div class="plroom"><div class="pch">In a room photo</div><div class="plrow"><select id="plrsel"><option value="">Not shown in a room</option>' + rooms.map((r) => '<option value="' + r.id + '"' + (it.room && it.room.id === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select><button class="btn sm" id="plrspot"' + (it.room ? '' : ' disabled') + '>Place on the photo</button></div></div>';
      host.innerHTML = html;
      wirePane(host);
      $('#plpx', host).addEventListener('click', () => select([]));
      if (st.edit) {
        $$('[data-f]', host).forEach((el) => el.addEventListener('change', () => {
          const k = el.dataset.f;
          change(() => {
            let v = el.value;
            if (k === 'w' || k === 'h') { v = Math.max(1, Number(v) || T0[k]); it[k] = v; return; }
            if (v) it[k] = v; else delete it[k];
          });
        }));
        const rs = $('#plrsel', host);
        if (rs) {
          rs.addEventListener('change', () => change(() => { if (rs.value) it.room = { id: Number(rs.value), spot: (it.room && it.room.id === Number(rs.value) && it.room.spot) || null }; else delete it.room; }));
          $('#plrspot', host).addEventListener('click', () => {
            const room = rooms.find((r) => r.id === (it.room && it.room.id)); if (!room) return;
            const name = linesOf(it, PI, st.doc.items)[0];
            const spots = it.room.spot ? { g1: it.room.spot } : {};
            adjustSpots({ photo: room.photo, rails: RackCore.cleanRails({}), units: 0, spots }, [{ key: 'g1', name, title: name, sub: TYPES[it.t].label, grid: () => roomDefaultSpot(0) }],
              async (out) => { change(() => { it.room = { id: room.id, spot: out.g1 || roomDefaultSpot(0) }; }); }, { free: true, title: 'Where is it in the ' + room.name + '?', note: 'Drag the spot onto it in the photo, then drag its corners to fit.' });
          });
        }
      }
      // the photo: a gear card's own photo or spot, or this item's spot on a room photo
      const ph = $('#plphoto', host);
      const show = (pic, title) => {
        if (!pic || !ph.isConnected) return;
        ph.innerHTML = '<div class="pch">' + esc(title) + '</div><div class="pphimg">' + marksView(pic.photo, pic.marks, pic.card) + '</div><div class="note">Tap the photo to see it full screen.</div>';
        ph.classList.add('pphoto');
        wireMarksView(ph); photoLightbox(ph, pic.photo, pic.marks, pic.card);
      };
      if (dev && typeof gearPicture === 'function') gearPicture(dev).then((pic) => show(pic, pic && pic.room ? 'Where it is in the ' + pic.room.name : pic && pic.rack ? 'Where it is in ' + pic.rack.name : 'Photo'));
      else if (it.room && it.room.spot) loadRooms().then((rs) => { const room = rs.find((r) => r.id === it.room.id); if (room && room.photo) { const name = linesOf(it, PI, st.doc.items)[0]; show({ photo: room.photo, marks: [{ ...it.room.spot, color: 'blue', tag: name, label: name, note: it.notes || '' }], card: { location: room.name } }, 'Where it is in the ' + room.name); } });
    }

    // ---------- the toolbar ----------
    if (st.edit) {
      $('#plUndo').addEventListener('click', undo);
      $('#plRedo').addEventListener('click', redo);
      $('#plRotL').addEventListener('click', () => rotate(-15));
      $('#plRotR').addEventListener('click', () => rotate(15));
      $('#plDel').addEventListener('click', removeSel);
      $('#plSelT').addEventListener('click', () => { st.selTool = !st.selTool; $('#plSelT').classList.toggle('on', st.selTool); $('#plSelT').setAttribute('aria-pressed', String(st.selTool)); });
      $('#plSnap').addEventListener('change', (e) => { st.snap = e.target.checked; try { localStorage.setItem('lg-plsnap', st.snap ? '1' : '0'); } catch (er) { /* private mode */ } });
      $('#plDone').addEventListener('click', async () => { await flush(); location.hash = '#/plots/' + st.plot.id; });
      $('#plDet').addEventListener('click', () => details({ ...st.plot, onSaved: (p) => { st.plot = { ...st.plot, name: p.name, notes: p.notes }; $('#pltl').textContent = p.name; setTitle(p.name); paintSub(); } }));
      $('#plOut').addEventListener('click', () => outlineDialog(st.o, (o) => { st.o = o; paint(); fit(); }));
    } else {
      $('#plPdf').addEventListener('click', () => printPlot());
    }

    // ---------- the PDF: a title page, the drawing (landscape) with its key, the inputs on it and the monitor mixes ----------
    let printing = false;
    function dropReport() { const old = document.getElementById('preport'); if (old) old.remove(); document.body.classList.remove('printreport'); }
    function printPlot() {
      if (printing) return;
      printing = true;
      try {
        dropReport();
        const org = (S.state && S.state.org) || {}, me = (S.state && S.state.user && S.state.user.name) || '';
        const today = new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
        const patchRev = st.rev ? 'Rev ' + st.rev + (st.draft ? ' (draft)' : '') : 'Draft (not published yet)';
        const items = st.doc.items;
        const T = (heads, rows, empty) => rows.length ? '<table class="rt"><thead><tr>' + heads.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + (c == null || c === '' ? '<span class="rd">—</span>' : c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>' : '<p class="rnone">' + empty + '</p>';
        const onName = (it) => { const on = it.on && itemOf(it.on); return on ? linesOf(on, PI, items)[0] : ''; };
        const gearItems = items.filter((x) => x.t === 'gear' && PI.G.has(x.gear));
        const ins = gearItems.filter((x) => GEAR[PI.G.get(x.gear).kind].cat === 'source').sort((a, b) => chKey(a) - chKey(b));
        const inRows = ins.map((it) => { const g = PI.G.get(it.gear), inf = PI.info.get(g.id) || { chs: [], sb: [] };
          return [inf.chs.length ? '<b>' + inf.chs.join(', ') + '</b>' : '', '<b>' + esc(g.name) + '</b>', esc([g.person, g.use, it.label].filter(Boolean).join(' · ')), esc([g.model || P.KINDS[g.kind].label, g.capsule].filter(Boolean).join(' · ')), esc(it.stand || ''), esc(inf.sb.join(', ') + (inf.rx ? (inf.sb.length ? ' · ' : '') + 'via ' + inf.rx : '')), esc(onName(it))]; });
        const mons = gearItems.filter((x) => ['pa', 'iem'].includes(GEAR[PI.G.get(x.gear).kind].cat));
        const monRows = mons.map((it) => { const g = PI.G.get(it.gear), inf = PI.info.get(g.id) || {};
          return ['<b>' + esc(g.name) + '</b>', esc(P.KINDS[g.kind].label), esc(inf.mix || ''), esc([g.person, g.use, it.label].filter(Boolean).join(' · ') || onName(it)), esc([g.model, inf.tx ? 'from ' + inf.tx : ''].filter(Boolean).join(' · '))]; });
        const drops = items.filter((x) => TYPES[x.t] && TYPES[x.t].group === 'drops').concat(gearItems.filter((x) => PI.G.get(x.gear).kind === 'stagebox'));
        const dropRows = drops.map((it) => [esc(it.t === 'gear' ? 'Stage box' : TYPES[it.t].label), '<b>' + esc(linesOf(it, PI, items).join(' · ')) + '</b>', esc(it.notes || '')]);
        const people = items.filter((x) => TYPES[x.t] && TYPES[x.t].group === 'people' && x.t !== 'text');
        const pplRows = people.map((it) => [esc(TYPES[it.t].label), '<b>' + esc(linesOf(it, PI, items)[0]) + '</b>', esc(items.filter((x) => x.on === it.id).map((x) => linesOf(x, PI, items)[0]).join(', ')), esc(it.notes || '')]);
        const gone = items.filter((x) => x.t === 'gear' && !PI.G.has(x.gear));
        const used = new Set(items.map((it) => catOf(it, it.t === 'gear' ? PI.G.get(it.gear) : null)));
        const names = { source: 'Inputs: mics, DIs', pa: 'Wedges and speakers', iem: 'In-ear packs', io: 'Stage boxes', people: 'People and instruments', drops: 'Power and drops', gone: 'Not on the patch' };
        const key = '<div class="rkey">' + Object.keys(names).filter((k) => used.has(k)).map((k) => '<span><i style="background:' + (COLOR[k] || '#d24b4b') + '"></i>' + names[k] + '</span>').join('') + '<span>Grid: 1 ft squares, bolder every 5 ft</span></div>';
        const head = [org.name, st.plot.name, 'Stage plot'].filter(Boolean).join(' · ');
        const css = '@page { @top-left { content: "' + head.replace(/["\\]/g, '') + '"; font: 9px system-ui, sans-serif; color: #4d5866; } @bottom-left { content: "Printed ' + today.replace(/["\\]/g, '') + '"; font: 9px system-ui, sans-serif; color: #4d5866; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9px system-ui, sans-serif; color: #4d5866; } }' +
          '@page :first { @top-left { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }';
        const secs = [['Stage plot', ''], ['Inputs on this plot', T(['Ch', 'Tag', 'Who / what', 'Mic or DI', 'Stand', 'Plugs into', 'On'], inRows, 'No mics or DIs on this plot.') + '<p class="rs">Only the inputs placed on this stage plot are listed, in channel order. The full input list is in the stage patch report.</p>'],
          ['Monitors', T(['Tag', 'Kind', 'Mix', 'Who', 'Model'], monRows, 'No wedges or in-ear packs on this plot.')]];
        if (pplRows.length) secs.push(['People and instruments', T(['What', 'Name', 'Mics and gear on it', 'Notes'], pplRows, '')]);
        if (dropRows.length) secs.push(['Power and drops', T(['What', 'Label', 'Notes'], dropRows, '')]);
        if (gone.length) secs.push(['Not on the stage patch', '<p>' + gone.map((x) => esc(x.label || 'An item')).join(', ') + ' ' + (gone.length === 1 ? 'is' : 'are') + ' on this plot but no longer on the stage patch.</p>']);
        const box = document.createElement('div');
        box.id = 'preport'; box.className = 'plreport';
        box.innerHTML = '<style>' + css + '</style>' +
          '<section class="rcover">' + (org.logo ? '<img class="rlogo" src="/api/org/logo" alt="">' : '<img class="rlogo" src="/icons/livegenie-mark.svg" alt="">') +
            (org.name ? '<div class="rorg">' + esc(org.name) + '</div>' : '') + '<div class="rkick">Stage plot</div><h1>' + esc(st.plot.name) + '</h1>' + (st.plot.notes ? '<p class="rsub">' + esc(st.plot.notes.split('\n')[0]) + '</p>' : '') +
            '<dl class="rmeta"><dt>Date</dt><dd>' + esc(today) + '</dd><dt>Stage patch</dt><dd>' + esc(patchRev) + '</dd>' + (me ? '<dt>Prepared by</dt><dd>' + esc(me) + '</dd>' : '') +
            '<dt>Stage</dt><dd>' + st.o.w + ' × ' + st.o.d + ' ft' + (st.o.tw && st.o.td ? ' with a ' + st.o.tw + ' × ' + st.o.td + ' ft thrust' : '') + '</dd>' +
            '<dt>Contents</dt><dd>' + ins.length + ' input' + (ins.length === 1 ? '' : 's') + ' · ' + mons.length + ' monitor' + (mons.length === 1 ? '' : 's') + ' · ' + people.length + ' people and instruments</dd></dl>' +
            '<div class="rfoot">Made with LiveGenie</div></section>' +
          '<section class="rdraw"><h2>1. ' + esc(st.plot.name) + '</h2><div class="rsvg" id="rsvg"></div>' + key + '</section>' +
          secs.slice(1).map((x, k) => '<section class="rsec' + (k % 2 ? ' rjoin' : '') + '"><h2>' + (k + 2) + '. ' + esc(x[0]) + '</h2>' + x[1] + '</section>').join('');
        // a still copy of the drawing, framed to the stage
        const b = boundsOf(st.o, items);
        const copy = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        copy.setAttribute('class', 'plsvg plprint');
        copy.setAttribute('viewBox', b.x0 + ' ' + b.y0 + ' ' + (b.x1 - b.x0) + ' ' + (b.y1 - b.y0));
        copy.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        copy.innerHTML = drawingSvg(st.o, items, PI, { sel: [], print: true });
        $('#rsvg', box).appendChild(copy);
        document.body.appendChild(box); document.body.classList.add('printreport');
        const started = Date.now();
        const after = () => { if (Date.now() - started < 2500) return; window.removeEventListener('afterprint', after); dropReport(); };
        window.addEventListener('afterprint', after);
        window.addEventListener('hashchange', function gone2() { window.removeEventListener('hashchange', gone2); window.removeEventListener('afterprint', after); dropReport(); });
        exportPdf(st.plot.name + ' Stage Plot', st.rev || '');
      } catch (e) { dropReport(); toast('Could not make the PDF: ' + e.message, 'bad'); }
      setTimeout(() => { printing = false; }, 3000);
    }

    loadRooms().catch(() => []).then(() => { if (st.sel.length) paintPane(); });
    paint(); paintPane();
    requestAnimationFrame(() => { if (svg.isConnected) fit(); });
    st.printPlot = printPlot;
    return st;
  }

  return { list, view, TYPES, GEAR, iconSvg, drawingSvg, patchInfo };
})();
