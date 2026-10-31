/*
 * System map: Signal flow (from patch lists and cable runs), Network (from each
 * device's "Plugged into"), and the VLAN registry. Pan by dragging, zoom with the
 * wheel or a pinch, tap a box for details. Editors can drag boxes and save the layout.
 */
'use strict';

const CAT_COLOR = { audio: '#2ec4b6', video: '#4c8dff', lighting: '#f2c94c', network: '#b07cff', computer: '#ef7b4c', power: '#ef4c4c', other: '#8a96a5' };
const NW = 172, NH = 50, GX = 96, GY = 22;

async function viewMap(tab) {
  const data = await get('/api/map');
  await loadDevices();
  tab = tab || 'signal';
  if (!data.tech && tab !== 'signal') tab = 'signal';
  setTitle(tab === 'vlans' ? 'VLANs' : 'System map');
  const tabs = [['signal', 'Signal flow']].concat(data.tech ? [['network', 'Network'], ['vlans', 'VLANs']] : []);
  app.innerHTML = `<div class="crumbs"><a href="#/">Home</a><span>/</span></div>
    <div class="bar"><div class="grow"><h1 class="title" style="font-size:22px;letter-spacing:.06em;margin:4px 0 2px">SYSTEM MAP</h1>
      <div class="note">${tab === 'signal' ? 'Drawn from the stage patch (and any older patch lists): every cable between two devices with a device card becomes an arrow.' : tab === 'network' ? 'Drawn from “Plugged into” on each device card. Colours are VLANs.' : 'Every VLAN, its subnet, and the devices in it.'}</div></div>
      <div class="seg" id="mtabs">${tabs.map((t) => '<button data-t="' + t[0] + '"' + (t[0] === tab ? ' class="on"' : '') + '>' + t[1] + '</button>').join('')}</div></div>
    <div id="mbody"></div>`;
  $$('#mtabs button').forEach((b) => b.addEventListener('click', () => { location.hash = '#/map/' + b.dataset.t; }));
  if (tab === 'vlans') return viewVlans($('#mbody'));
  drawMap($('#mbody'), data, tab);
}

function layered(ids, edges) {
  const out = new Map(ids.map((id) => [id, []])), inc = new Map(ids.map((id) => [id, []]));
  edges.forEach((e) => { if (out.has(e.from) && out.has(e.to)) { out.get(e.from).push(e.to); inc.get(e.to).push(e.from); } });
  const layer = new Map();
  const indeg = new Map(ids.map((id) => [id, inc.get(id).length]));
  let queue = ids.filter((id) => !indeg.get(id));
  queue.forEach((id) => layer.set(id, 0));
  const seen = new Set();
  while (queue.length || seen.size < ids.length) {
    if (!queue.length) {                                  // a loop: start again from the first unplaced box
      const id = ids.find((x) => !seen.has(x) && !queue.includes(x));
      if (id === undefined) break;
      layer.set(id, Math.max(0, ...inc.get(id).map((p) => (layer.has(p) ? layer.get(p) + 1 : 0))));
      queue.push(id);
    }
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of out.get(id)) {
      layer.set(c, Math.max(layer.get(c) || 0, layer.get(id) + 1));
      indeg.set(c, indeg.get(c) - 1);
      if (indeg.get(c) <= 0 && !seen.has(c)) queue.push(c);
    }
  }
  const cols = [];
  ids.forEach((id) => { const l = layer.get(id) || 0; (cols[l] = cols[l] || []).push(id); });
  const yIdx = new Map();
  cols.forEach((col, l) => {
    if (l) col.sort((a, b) => avg(inc.get(a)) - avg(inc.get(b)));
    col.forEach((id, i) => yIdx.set(id, i));
    function avg(ps) { const v = ps.filter((p) => yIdx.has(p)).map((p) => yIdx.get(p)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 999; }
  });
  const pos = new Map();
  cols.forEach((col, l) => col.forEach((id, i) => pos.set(id, [l * (NW + GX), i * (NH + GY)])));
  // centre each parent on its children where there is room
  for (let l = cols.length - 2; l >= 0; l--) {
    let floor = -Infinity;
    for (const id of cols[l]) {
      const kids = out.get(id).filter((c) => (layer.get(c) || 0) === l + 1);
      let y = kids.length ? kids.reduce((s, c) => s + pos.get(c)[1], 0) / kids.length : pos.get(id)[1];
      y = Math.max(y, floor);
      pos.get(id)[1] = y;
      floor = y + NH + GY;
    }
  }
  return pos;
}

/** Network view: a tidy tree. Each switch sits level with the middle of what is plugged into it, in port order. */
function treeLayout(ids, edges) {
  const kids = new Map(ids.map((id) => [id, []]));
  const hasParent = new Set();
  edges.forEach((e) => { if (kids.has(e.from) && kids.has(e.to)) { kids.get(e.from).push(e); hasParent.add(e.to); } });
  const pos = new Map();
  let y = 0;
  const walk = (id, depth, seen) => {
    if (seen.has(id)) return; seen.add(id);
    const ch = kids.get(id).slice().sort((a, b) => String(a.port || '~').localeCompare(String(b.port || '~'), undefined, { numeric: true })).map((e) => e.to).filter((c) => !seen.has(c));
    if (!ch.length) { pos.set(id, [depth * (NW + GX), y]); y += NH + GY; return; }
    ch.forEach((c) => walk(c, depth + 1, seen));
    const ys = ch.filter((c) => pos.has(c)).map((c) => pos.get(c)[1]);
    pos.set(id, [depth * (NW + GX), (Math.min(...ys) + Math.max(...ys)) / 2]);
  };
  const seen = new Set();
  ids.filter((id) => !hasParent.has(id)).forEach((r) => { walk(r, 0, seen); y += GY; });
  ids.forEach((id) => { if (!pos.has(id)) walk(id, 0, seen); });
  return pos;
}

function drawMap(host, data, view) {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const vColor = new Map(data.vlans.map((v) => [v.vid, v.color]));
  const edges = view === 'signal' ? data.sigLinks : data.netLinks;
  const inGraph = new Set();
  edges.forEach((e) => { inGraph.add(e.from); inGraph.add(e.to); });
  const ids = data.nodes.filter((n) => inGraph.has(n.id)).sort((a, b) => a.name.localeCompare(b.name)).map((n) => n.id);
  const tray = view === 'network' ? data.nodes.filter((n) => !inGraph.has(n.id) && (n.ips.length || n.category === 'network')) : [];
  const editable = can('editor');
  if (!ids.length) {
    host.innerHTML = '<div class="card empty" style="text-align:left;max-width:720px">' + (view === 'signal'
      ? '<b>Nothing to draw yet.</b><p>The signal map draws an arrow for every cable on the <a href="#/patch">stage patch</a> between two pieces of gear that have device cards (the SQ-5, the AR2412, the DriveRack PA2). Big gear added to the stage patch from its catalog gets a device card by itself; for other gear, open it on the stage patch and choose <b>Make a device card</b>.</p>'
      : '<b>No network links yet.</b><p>Open a device card, choose Edit, and set <b>Plugged into</b> (the switch or router it connects to) and the port. Start with the switches: USW-16-PoE into the UDM Pro, the FOH switch into the USW-16-PoE, and so on.</p>') +
      '<p><a href="#/patch">Open the stage patch</a> · <a href="#/devices">Open the device library</a></p></div>' + trayHtml(tray);
    return;
  }
  const saved = (data.layouts && data.layouts[view]) || {};
  const auto = view === 'network' ? treeLayout(ids, edges) : layered(ids, edges);
  const pos = new Map(ids.map((id) => [id, saved[id] ? saved[id].slice() : auto.get(id).slice()]));
  const st = { k: 1, x: 20, y: 20, sel: null, vlan: null, edit: false, dirty: false };
  host.innerHTML = `<div class="mtools">
      <input type="search" id="mfind" placeholder="Find a device" list="mlist"><datalist id="mlist">${ids.map((id) => '<option value="' + esc(byId.get(id).name) + '">').join('')}</datalist>
      ${view === 'network' && data.vlans.length ? '<div class="vchips"><button class="vchip on" data-v="">All</button>' + data.vlans.map((v) => '<button class="vchip" data-v="' + v.vid + '"><i style="background:' + esc(v.color) + '"></i>' + v.vid + ' ' + esc(v.name) + '</button>').join('') + '</div>' : ''}
      <span class="grow"></span>
      <button class="btn ghost" id="mfit" title="Fit to screen">Fit</button>
      ${editable ? '<button class="btn ghost" id="medit">Arrange</button><button class="btn hide" id="mauto">Auto layout</button><button class="primary hide" id="msave">Save layout</button>' : ''}
      <button class="btn ghost" id="mpdf" title="Export PDF">${icon('pdf')}<span class="hide-sm">PDF</span></button></div>
    <div class="mapwrap"><svg id="msvg" role="img" aria-label="System map"><defs><marker id="marr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="marr"/></marker></defs><g id="mvp"><g id="medges"></g><g id="mnodes"></g></g></svg>
      <div class="mside hide" id="mside"></div><div class="mhint note">${editable ? 'Drag to move around, scroll or pinch to zoom, tap a box for details. Arrange lets you drag boxes.' : 'Drag to move around, scroll or pinch to zoom, tap a box for details.'}</div></div>
    ${view === 'signal' ? '<div class="mlegend">' + Object.keys(CAT_COLOR).filter((c) => ids.some((id) => byId.get(id).category === c)).map((c) => '<span><i style="background:' + CAT_COLOR[c] + '"></i>' + CAT[c] + '</span>').join('') + '</div>' : ''}
    ${trayHtml(tray)}`;
  const svg = $('#msvg'), vp = $('#mvp'), gE = $('#medges'), gN = $('#mnodes');
  const color = (n) => view === 'network' ? (vColor.get(n.vlans[0]) || 'var(--faint)') : (CAT_COLOR[n.category] || CAT_COLOR.other);
  const sub = (n) => view === 'network' ? (n.ips[0] || n.model || CAT[n.category]) : (n.model || n.location || CAT[n.category]);
  const cut = (s, k) => (String(s).length > k ? String(s).slice(0, k - 1) + '…' : String(s));

  function edgePath(e) {
    const [x1, y1] = pos.get(e.from), [x2, y2] = pos.get(e.to);
    const sx = x1 + NW, sy = y1 + NH / 2, ex = x2, ey = y2 + NH / 2;
    if (view === 'network' && ex > sx + 20) { const mx = sx + Math.min(GX / 2, (ex - sx) / 2); return 'M' + sx + ' ' + sy + 'H' + mx + 'V' + ey + 'H' + ex; }
    if (ex < sx + 10) {                                       // goes backwards: loop round underneath
      const low = Math.max(y1, y2) + NH + 18;
      return 'M' + sx + ' ' + sy + 'C' + (sx + 50) + ' ' + sy + ' ' + (sx + 50) + ' ' + low + ' ' + (sx) + ' ' + low + 'L' + (ex) + ' ' + low + 'C' + (ex - 50) + ' ' + low + ' ' + (ex - 50) + ' ' + ey + ' ' + ex + ' ' + ey;
    }
    const mx = (ex - sx) / 2;
    return 'M' + sx + ' ' + sy + 'C' + (sx + mx) + ' ' + sy + ' ' + (ex - mx) + ' ' + ey + ' ' + ex + ' ' + ey;
  }
  function drawEdges() {
    gE.innerHTML = edges.filter((e) => pos.has(e.from) && pos.has(e.to)).map((e, i) => {
      const [x2, y2] = pos.get(e.to), [x1, y1] = pos.get(e.from);
      const lab = view === 'network' ? (e.port ? 'port ' + e.port : '') : (e.count > 1 ? '×' + e.count : '');
      const lx = view === 'network' ? x2 - 6 : (x1 + NW + x2) / 2, ly = view === 'network' ? y2 + NH / 2 - 6 : (y1 + y2) / 2 + NH / 2 - 6;
      return '<g class="me ' + view + '" data-i="' + i + '" data-from="' + e.from + '" data-to="' + e.to + '"><path class="hit" d="' + edgePath(e) + '"/><path class="ln" d="' + edgePath(e) + '"' + (view === 'signal' ? ' marker-end="url(#marr)"' : '') + '/>' +
        (lab ? '<text x="' + lx + '" y="' + ly + '" text-anchor="' + (view === 'network' ? 'end' : 'middle') + '">' + esc(lab) + '</text>' : '') + '</g>';
    }).join('');
  }
  function drawNodes() {
    gN.innerHTML = ids.map((id) => {
      const n = byId.get(id), [x, y] = pos.get(id);
      return '<g class="mn" data-id="' + id + '" transform="translate(' + x + ' ' + y + ')"><title>' + esc(n.name) + '</title><rect width="' + NW + '" height="' + NH + '" rx="9"/>' +
        '<rect class="band" width="6" height="' + NH + '" rx="3" style="fill:' + color(n) + '"/>' +
        '<text class="n1" x="16" y="21">' + esc(cut(n.name, 20)) + '</text><text class="n2" x="16" y="38">' + esc(cut(sub(n), 24)) + '</text>' +
        (view === 'network' && n.vlans.length > 1 ? n.vlans.slice(1, 4).map((v, i) => '<circle cx="' + (NW - 12 - i * 11) + '" cy="12" r="4" style="fill:' + (vColor.get(v) || 'var(--faint)') + '"/>').join('') : '') + '</g>';
    }).join('');
  }
  const apply = () => vp.setAttribute('transform', 'translate(' + st.x + ' ' + st.y + ') scale(' + st.k + ')');
  function fit() {
    const xs = [...pos.values()];
    const minX = Math.min(...xs.map((p) => p[0])) - 20, minY = Math.min(...xs.map((p) => p[1])) - 20;
    const maxX = Math.max(...xs.map((p) => p[0])) + NW + 20, maxY = Math.max(...xs.map((p) => p[1])) + NH + 40;
    const r = svg.getBoundingClientRect();
    st.k = Math.min(1.25, Math.max(0.2, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
    st.x = (r.width - (maxX - minX) * st.k) / 2 - minX * st.k;
    st.y = (r.height - (maxY - minY) * st.k) / 2 - minY * st.k;
    apply();
  }
  function highlight() {
    const sel = st.sel, vlan = st.vlan;
    const near = new Set();
    if (sel) { near.add(sel); edges.forEach((e) => { if (e.from === sel) near.add(e.to); if (e.to === sel) near.add(e.from); }); }
    svg.classList.toggle('dim', !!(sel || vlan));
    $$('.mn', gN).forEach((g) => {
      const n = byId.get(Number(g.dataset.id));
      const on = sel ? near.has(n.id) : vlan ? n.vlans.includes(vlan) : true;
      g.classList.toggle('on', on); g.classList.toggle('sel', n.id === sel);
    });
    $$('.me', gE).forEach((g) => {
      const f = Number(g.dataset.from), t = Number(g.dataset.to);
      g.classList.toggle('on', sel ? (f === sel || t === sel) : vlan ? byId.get(f).vlans.includes(vlan) && byId.get(t).vlans.includes(vlan) : false);
    });
  }
  function side(id) {
    const box = $('#mside');
    if (!id) { box.classList.add('hide'); return; }
    const n = byId.get(id);
    const ins = edges.filter((e) => e.to === id), outs = edges.filter((e) => e.from === id);
    const name = (x) => '<a href="#" data-go="' + x + '">' + esc(byId.get(x).name) + '</a>';
    let rows = '';
    if (view === 'network') {
      const up = ins[0];
      rows += up ? '<div class="sr"><span>Plugged into</span><div>' + name(up.from) + (up.port ? ' · port ' + esc(up.port) : '') + '</div></div>' : '';
      if (outs.length) rows += '<div class="sr"><span>Connected here</span><div>' + outs.sort((a, b) => String(a.port).localeCompare(String(b.port), undefined, { numeric: true })).map((e) => '<div>' + (e.port ? '<span class="mono">' + esc(e.port) + '</span> ' : '') + name(e.to) + '</div>').join('') + '</div></div>';
    } else {
      if (ins.length) rows += '<div class="sr"><span>Signal from</span><div>' + ins.map((e) => '<div>' + name(e.from) + (e.count > 1 ? ' <span class="note">×' + e.count + '</span>' : '') + '</div>').join('') + '</div></div>';
      if (outs.length) rows += '<div class="sr"><span>Signal to</span><div>' + outs.map((e) => '<div>' + name(e.to) + (e.count > 1 ? ' <span class="note">×' + e.count + '</span>' : '') + '<div class="note">' + e.rows.slice(0, 3).map(esc).join('<br>') + '</div></div>').join('') + '</div></div>';
      const pages = new Map(); [...ins, ...outs].forEach((e) => e.pages.forEach((p) => pages.set(p.page_id + p.block, p)));
      if (pages.size) rows += '<div class="sr"><span>From</span><div>' + [...pages.values()].map((p) => '<div><a href="' + (p.page_id === 'patch' ? '#/patch' : '#/p/' + p.page_id + '?c=' + esc(p.block)) + '">' + esc(p.title) + '</a> <span class="note">' + esc(p.label) + '</span></div>').join('') + '</div></div>';
    }
    box.innerHTML = '<button class="ghost mx" aria-label="Close">' + icon('x') + '</button><div class="mh">' + devThumb(n, 40) + '<div><b>' + esc(n.name) + '</b><span>' + esc([n.make, n.model].filter(Boolean).join(' ') || CAT[n.category]) + '</span></div></div>' +
      (n.location ? '<div class="sr"><span>Location</span><div>' + esc(n.location) + '</div></div>' : '') +
      (n.ips.length ? '<div class="sr"><span>IP</span><div>' + n.ips.map((ip) => '<a class="mono" href="http://' + esc(ip) + '" target="_blank" rel="noopener">' + esc(ip) + '</a>').join('<br>') + '</div></div>' : '') +
      (n.vlans.length ? '<div class="sr"><span>VLAN</span><div>' + n.vlans.map((v) => { const x = data.vlans.find((y) => y.vid === v); return '<span class="chip"><i class="sw" style="background:' + esc(vColor.get(v)) + '"></i>' + v + (x ? ' ' + esc(x.name) : '') + '</span>'; }).join(' ') + '</div></div>' : '') +
      rows + '<a class="btn primary" style="margin-top:10px;justify-content:center" href="#/d/' + id + '">Open device card</a>';
    box.classList.remove('hide');
    box.querySelector('.mx').addEventListener('click', () => { st.sel = null; highlight(); side(null); });
    box.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); select(Number(a.dataset.go), true); }));
  }
  function select(id, center) {
    st.sel = id; highlight(); side(id);
    const phone = window.innerWidth <= 720;
    if (id && (center || phone)) {
      const r = svg.getBoundingClientRect(), [x, y] = pos.get(id);
      if (phone && st.k < 0.8) st.k = 0.8;
      st.x = r.width / 2 - (x + NW / 2) * st.k; st.y = r.height * (phone ? 0.22 : 0.5) - (y + NH / 2) * st.k; apply();
    }
  }

  drawEdges(); drawNodes(); fit(); highlight();

  // ---- pan, zoom, pinch, drag ----
  const pts = new Map();
  let drag = null, pinch = null, moved = false;
  const toWorld = (cx, cy) => { const r = svg.getBoundingClientRect(); return [(cx - r.left - st.x) / st.k, (cy - r.top - st.y) / st.k]; };
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: st.k, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, x: st.x, y: st.y };
      drag = null; return;
    }
    const g = e.target.closest('.mn');
    if (g && st.edit) { const id = Number(g.dataset.id); const [wx, wy] = toWorld(e.clientX, e.clientY); drag = { node: id, dx: wx - pos.get(id)[0], dy: wy - pos.get(id)[1] }; }
    else drag = { pan: true, sx: e.clientX, sy: e.clientY, x: st.x, y: st.y, node: g ? Number(g.dataset.id) : null };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const k = Math.min(3, Math.max(0.15, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
      const r = svg.getBoundingClientRect(), mx = pinch.mx - r.left, my = pinch.my - r.top;
      st.x = mx - (mx - pinch.x) * k / pinch.k; st.y = my - (my - pinch.y) * k / pinch.k; st.k = k; apply(); moved = true; return;
    }
    if (!drag) return;
    if (drag.pan) {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) moved = true;
      st.x = drag.x + e.clientX - drag.sx; st.y = drag.y + e.clientY - drag.sy; apply();
    } else {
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      pos.set(drag.node, [Math.round((wx - drag.dx) / 8) * 8, Math.round((wy - drag.dy) / 8) * 8]);
      const g = gN.querySelector('[data-id="' + drag.node + '"]');
      g.setAttribute('transform', 'translate(' + pos.get(drag.node)[0] + ' ' + pos.get(drag.node)[1] + ')');
      drawEdges(); highlight(); moved = true; st.dirty = true;
    }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (drag && !moved) {
      const id = drag.node;
      if (id) select(st.sel === id ? null : id); else if (st.sel) select(null);
    }
    drag = null;
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.min(3, Math.max(0.15, st.k * Math.exp(-e.deltaY * 0.0015)));
    st.x = mx - (mx - st.x) * k / st.k; st.y = my - (my - st.y) * k / st.k; st.k = k; apply();
  }, { passive: false });

  $('#mfit').addEventListener('click', fit);
  $('#mfind').addEventListener('change', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const n = ids.map((id) => byId.get(id)).find((x) => x.name.toLowerCase() === q) || ids.map((id) => byId.get(id)).find((x) => x.name.toLowerCase().includes(q));
    if (n) select(n.id, true); else toast('No device by that name on this map');
  });
  $$('.vchip').forEach((b) => b.addEventListener('click', () => {
    st.vlan = b.dataset.v ? Number(b.dataset.v) : null; st.sel = null; side(null);
    $$('.vchip').forEach((x) => x.classList.toggle('on', x === b)); highlight();
  }));
  $('#mpdf').addEventListener('click', () => { fit(); exportPdf('System map - ' + (view === 'signal' ? 'Signal flow' : 'Network')); });
  if (editable) {
    const setEdit = (on) => {
      st.edit = on;
      svg.classList.toggle('editing', on);
      $('#medit').classList.toggle('hide', on); $('#mauto').classList.toggle('hide', !on); $('#msave').classList.toggle('hide', !on);
    };
    $('#medit').addEventListener('click', () => setEdit(true));
    $('#mauto').addEventListener('click', () => { ids.forEach((id) => pos.set(id, auto.get(id).slice())); drawEdges(); drawNodes(); highlight(); fit(); st.dirty = true; st.auto = true; });
    $('#msave').addEventListener('click', async () => {
      const positions = {};
      if (!st.auto || ids.some((id) => pos.get(id)[0] !== auto.get(id)[0] || pos.get(id)[1] !== auto.get(id)[1])) ids.forEach((id) => { positions[id] = pos.get(id); });
      try { await call('PUT', '/api/map/layout/' + view, { positions }); toast(Object.keys(positions).length ? 'Layout saved for everyone' : 'Back to automatic layout', 'ok'); setEdit(false); st.dirty = false; st.auto = false; }
      catch (err) { toast(err.message, 'bad'); }
    });
  }
  const ro = new ResizeObserver(() => { if (!host.isConnected) ro.disconnect(); });
  ro.observe(svg);
}

function trayHtml(tray) {
  if (!tray.length) return '';
  return '<div class="section" style="margin-top:14px"><h2>Not on the network map yet</h2><p class="note" style="margin:-4px 0 8px">These have an IP but no “Plugged into”. Open a card, choose Edit, and pick the switch it connects to.</p><div class="dgrid">' +
    tray.map((d) => '<a class="dcard" href="#/d/' + d.id + '/edit">' + devThumb(d, 36) + '<div class="t"><b>' + esc(d.name) + '</b><span class="mono">' + esc(d.ips.join(', ')) + '</span></div></a>').join('') + '</div></div>';
}

// ================= VLANs =================
async function viewVlans(host) {
  const d = await get('/api/vlans');
  const pct = (a, b) => (b ? Math.min(100, Math.round(100 * a / b)) : 0);
  host.innerHTML = `<div class="bar"><div class="grow"></div>
      ${d.suggestions.length ? '<button class="btn" id="vimp">Create from IP lists (' + d.suggestions.length + ')</button>' : ''}
      <button class="primary btn" id="vnew">${icon('plus')}New VLAN</button></div>
    ${d.vlans.length ? '<div class="vgrid">' + d.vlans.map((v) => `<div class="vcard" style="--vc:${esc(v.color)}">
      <div class="vh"><b>VLAN ${v.vid}</b><span class="vn">${esc(v.name)}</span><span class="grow"></span><button class="ghost" data-ve="${v.id}" title="Edit">${icon('edit')}</button></div>
      ${v.purpose ? '<div class="note">' + esc(v.purpose) + '</div>' : ''}
      <div class="vf">${v.cidr ? '<span>Subnet</span><b class="mono">' + esc(v.cidr) + '</b>' : ''}${v.gateway ? '<span>Gateway</span><b class="mono">' + esc(v.gateway) + '</b>' : ''}
        ${v.dhcp_start ? '<span>DHCP</span><b class="mono">' + esc(v.dhcp_start) + ' – ' + esc(v.dhcp_end) + '</b>' : ''}</div>
      ${v.hosts ? '<div class="vbar"><i style="width:' + pct(v.used, v.hosts) + '%"></i><em style="left:' + pct(v.used, v.hosts) + '%;width:' + pct(v.dhcp, v.hosts) + '%"></em></div><div class="note">' + v.used + ' static · ' + (v.dhcp ? v.dhcp + ' DHCP · ' : '') + Math.max(0, v.hosts - v.used - v.dhcp) + ' free of ' + v.hosts + '</div>' : ''}
      <div class="vdev">${v.devices.length ? v.devices.map((x) => '<a class="chip" href="#/d/' + x.id + '">' + esc(x.name) + ' <span class="mono">' + esc(x.ips[0] || '') + '</span></a>').join('') : '<span class="note">No device cards in this VLAN yet</span>'}</div>
    </div>`).join('') + '</div>' : '<div class="card empty">No VLANs yet. Add the ones on your UDM Pro: Office, AVL, Guest, IoT.' + (d.suggestions.length ? ' Or create them from the networks in your IP lists.' : '') + '</div>'}`;
  $('#vnew').addEventListener('click', () => vlanDialog(null, d));
  const imp = $('#vimp');
  if (imp) imp.addEventListener('click', () => {
    modal('<h3>Create VLANs from IP lists</h3><p>These networks are in your IP lists but not in the VLAN list yet.</p><div class="implist">' + d.suggestions.map((s, i) => '<label class="tog on"><input type="checkbox" data-i="' + i + '" checked><span><b>VLAN ' + s.vid + ' ' + esc(s.name) + '</b> <span class="note">' + esc([s.cidr, s.from].filter(Boolean).join(' · ')) + '</span></span></label>').join('') +
      '</div><div class="acts"><button type="button" data-close>Cancel</button><button class="primary" id="viok">Create</button></div>', (w, close) => {
      w.querySelector('#viok').addEventListener('click', async () => {
        const vids = Array.from(w.querySelectorAll('input:checked')).map((x) => d.suggestions[Number(x.dataset.i)].vid);
        try { const r = await call('POST', '/api/vlans/import', { vids }); close(); toast(r.made + ' VLAN' + (r.made === 1 ? '' : 's') + ' created', 'ok'); viewVlans(host); } catch (e) { toast(e.message, 'bad'); }
      });
    });
  });
  $$('[data-ve]', host).forEach((b) => b.addEventListener('click', () => vlanDialog(d.vlans.find((v) => v.id === Number(b.dataset.ve)), d)));
  function vlanDialog(v, all) {
    const x = v || { vid: '', name: '', cidr: '', gateway: '', color: all.colors[all.vlans.length % all.colors.length], purpose: '', dhcp_start: '', dhcp_end: '' };
    const f = (k, label, ph, cls) => '<label for="v_' + k + '">' + label + '</label><input id="v_' + k + '" value="' + esc(x[k]) + '" placeholder="' + esc(ph) + '"' + (cls ? ' class="' + cls + '" autocapitalize="off" inputmode="decimal"' : '') + '>';
    modal('<h3>' + (v ? 'Edit VLAN ' + v.vid : 'New VLAN') + '</h3><form id="vf"><div class="two">' + f('vid', 'VLAN ID', '20', 'mono') + '<div>' + f('name', 'Name', 'AVL') + '</div></div>' +
      f('cidr', 'Subnet', '10.10.20.0/24', 'mono') + '<div class="two"><div>' + f('gateway', 'Gateway', '10.10.20.1', 'mono') + '</div><div><label>Colour</label><div class="swatches">' + all.colors.map((c) => '<button type="button" class="sw' + (c === x.color ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join('') + '</div></div></div>' +
      '<div class="two"><div>' + f('dhcp_start', 'DHCP from', '10.10.20.100', 'mono') + '</div><div>' + f('dhcp_end', 'DHCP to', '10.10.20.199', 'mono') + '</div></div>' +
      f('purpose', 'What it is for', 'NDI, SQ-5, Companion, lighting control') +
      '<div class="err" id="ve"></div><div class="acts">' + (v ? '<button type="button" class="danger" id="vdel" style="margin-right:auto">Delete</button>' : '') + '<button type="button" data-close>Cancel</button><button class="primary">' + (v ? 'Save' : 'Add VLAN') + '</button></div></form>', (w, close) => {
      let colorPick = x.color;
      w.querySelectorAll('.sw').forEach((s) => s.addEventListener('click', () => { colorPick = s.dataset.c; w.querySelectorAll('.sw').forEach((o) => o.classList.toggle('on', o === s)); }));
      w.querySelector('#vf').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = { color: colorPick };
        ['vid', 'name', 'cidr', 'gateway', 'dhcp_start', 'dhcp_end', 'purpose'].forEach((k) => { body[k] = w.querySelector('#v_' + k).value.trim(); });
        try { if (v) await call('PUT', '/api/vlans/' + v.id, body); else await call('POST', '/api/vlans', body); close(); toast(v ? 'Saved' : 'VLAN added', 'ok'); VLAN_CACHE.list = null; viewVlans(host); }
        catch (err) { w.querySelector('#ve').textContent = err.message; }
      });
      const del = w.querySelector('#vdel');
      if (del) del.addEventListener('click', async () => {
        close();
        if (!await confirmBox('Delete VLAN ' + v.vid + '?', 'Devices and IP lists stay as they are; only the VLAN record goes.', 'Delete', true)) return;
        try { await call('DELETE', '/api/vlans/' + v.id); VLAN_CACHE.list = null; viewVlans(host); } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }
}

const VLAN_CACHE = { list: null };
async function vlanList() {
  if (!can('editor')) return [];
  if (!VLAN_CACHE.list) { try { VLAN_CACHE.list = (await get('/api/vlans')).vlans; } catch (e) { VLAN_CACHE.list = []; } }
  return VLAN_CACHE.list;
}
