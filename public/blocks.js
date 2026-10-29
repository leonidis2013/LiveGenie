/*
 * LiveGenie page blocks that do more than show text:
 *   checklist  shared ticks, auto reset schedule, due times
 *   patch      patch lists and cable runs, with a wire trace drawing
 *   iplist     static IP lists with duplicate and subnet checks
 * Each has a view (render + wire) and an editor. Uses helpers from app.js.
 */
'use strict';

const Blk = (() => {
  const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const PRESETS = {
    input: { title: 'Input patch', columns: ['Ch', 'Source', 'Mic / DI', 'Stand', 'Stage box', 'Notes'], trace: [1, 2, 4, 0] },
    snake: { title: 'Snake inputs', columns: ['Input', 'Source', 'Mic / DI', 'Stage box', 'Box input', 'Link', 'Console', 'Notes'], trace: [1, 2, 4, 3, 5, 6, 0], roles: { 3: 'shared', 4: 'label', 5: 'label', 6: 'shared' }, assign: [1, 2] },
    snakeout: { title: 'Snake outputs', columns: ['Mix', 'Console', 'Link', 'Stage box', 'Box output', 'Destination', 'Notes'], trace: [0, 1, 2, 3, 4, 5], roles: { 1: 'shared', 2: 'label', 3: 'shared', 4: 'label' }, assign: [0, 5] },
    wireless: { title: 'Wireless mics', columns: ['Input', 'Person / use', 'Capsule', 'Transmitter', 'Frequency', 'Receiver', 'Rx ch', 'Stage box', 'Box input', 'Console', 'Notes'], trace: [1, 2, 3, 4, 6, 5, 8, 7, 9, 0], roles: { 2: 'label', 4: 'rf', 5: 'shared', 6: 'label', 7: 'shared', 8: 'label', 9: 'shared' }, assign: [1, 2, 3] },
    iem: { title: 'In-ears', columns: ['Mix', 'Console', 'Console out', 'Stage box', 'Box output', 'Transmitter', 'Mode', 'Frequency', 'Bodypack', 'Earphones', 'Person', 'Notes'], trace: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], roles: { 1: 'shared', 2: 'label', 3: 'shared', 4: 'label', 6: 'label', 7: 'rf', 9: 'label' }, assign: [0, 10] },
    output: { title: 'Output patch', columns: ['Out', 'Destination', 'Type', 'Notes'], trace: [0, 1] },
    cable: { title: 'Cable runs', columns: ['Label', 'From', 'To', 'Type', 'Length', 'Route'], trace: [1, 0, 2] },
    custom: { title: 'Patch list', columns: ['Column 1', 'Column 2', 'Column 3'], trace: [0, 1, 2] }
  };
  /** Wireless receivers (channels per unit) and in-ear transmitters (transmitters per unit), for the setup dialogs and the guided setup. */
  const RF_GEAR = {
    receivers: [
      { name: 'SLX-D4D', make: 'Shure', model: 'SLX-D4D', ch: 2 }, { name: 'SLX-D4', make: 'Shure', model: 'SLX-D4', ch: 1 },
      { name: 'ULX-D4D', make: 'Shure', model: 'ULX-D4D', ch: 2 }, { name: 'ULX-D4Q', make: 'Shure', model: 'ULX-D4Q', ch: 4 },
      { name: 'QLXD4', make: 'Shure', model: 'QLXD4', ch: 1 }, { name: 'AD4D', make: 'Shure', model: 'AD4D', ch: 2 }, { name: 'AD4Q', make: 'Shure', model: 'AD4Q', ch: 4 },
      { name: 'EW-D EM', make: 'Sennheiser', model: 'EW-D EM', ch: 1 }, { name: 'EW-DX EM 2', make: 'Sennheiser', model: 'EW-DX EM 2', ch: 2 }, { name: 'EW-DX EM 4', make: 'Sennheiser', model: 'EW-DX EM 4', ch: 4 }
    ],
    iem: [
      { name: 'PSM300', make: 'Shure', model: 'P3T', tx: 1 }, { name: 'PSM900', make: 'Shure', model: 'P9T', tx: 1 }, { name: 'PSM1000', make: 'Shure', model: 'P10T', tx: 2 },
      { name: 'EW IEM G4', make: 'Sennheiser', model: 'SR IEM G4', tx: 1 }, { name: 'Phenyx Pro PTM-10', make: 'Phenyx Pro', model: 'PTM-10', tx: 1 }
    ]
  };
  const IP_FIELDS = [['ip', 'IP address'], ['device', 'Device'], ['mac', 'MAC'], ['location', 'Location'], ['notes', 'Notes']];

  const tm = (t) => {
    const d = new Date(t), now = new Date();
    const same = d.toDateString() === now.toDateString();
    return same ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  };
  const hhmm12 = (s) => { const [h, m] = s.split(':').map(Number); return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM'); };
  const describe = (r) => (r.day === 'daily' ? 'Every day' : DAY_NAMES[r.day]) + ' at ' + hhmm12(r.reset) + (r.due ? ', done by ' + hhmm12(r.due) : '');

  // ================= checklist =================
  function checklistShell(b, live) {
    const items = b.items.map((t) => '<label><input type="checkbox" data-item="' + esc(t) + '"' + (live ? '' : ' disabled') + '><span class="it">' + inline(t) + '</span></label>').join('');
    return '<div class="check" data-cid="' + esc(b.id || '') + '" id="c-' + esc(b.id || '') + '"><div class="ch"><b>' + esc(b.title || 'Checklist') + '</b><span class="prog">0 / ' + b.items.length + '</span></div>' +
      '<div class="cmeta">' + ((b.schedule || []).length ? '<span class="note">Resets ' + esc(b.schedule.map(describe).join(' · ')) + '</span>' : '') + '</div>' +
      '<div class="bar2"><i></i></div><div class="citems">' + (items || '<div class="note" style="padding:8px">No steps yet.</div>') + '</div><div class="cfoot"></div></div>';
  }

  function fillChecklist(el, info) {
    const done = info.total - info.left;
    el.querySelector('.prog').textContent = done + ' / ' + info.total;
    el.querySelector('.bar2 i').style.width = (info.total ? 100 * done / info.total : 0) + '%';
    el.classList.toggle('overdue', !!info.overdue);
    el.classList.toggle('complete', info.total > 0 && info.left === 0);
    let chip = '';
    if (info.total && !info.left) chip = '<span class="chip ok">Done</span>';
    else if (info.overdue) chip = '<span class="chip bad">Overdue · was due ' + esc(tm(info.dueAt)) + '</span>';
    else if (info.active && info.dueAt) chip = '<span class="chip acc">Due ' + esc(tm(info.dueAt)) + '</span>';
    else if (info.active && info.left) chip = '<span class="chip acc">To do today</span>';
    el.querySelector('.cmeta').innerHTML = chip + (info.schedule.length ? '<span class="note">Resets ' + esc(info.schedule.join(' · ')) + '</span>' : '');
    el.querySelector('.citems').innerHTML = info.items.map((i) => '<label class="' + (i.done ? 'done' : '') + '"><input type="checkbox" data-item="' + esc(i.text) + '"' + (i.done ? ' checked' : '') + '>' +
      '<span class="it">' + inline(i.text) + '</span>' + (i.done ? '<span class="by">' + esc(i.by || '') + ' · ' + esc(tm(i.at)) + '</span>' : '') + '</label>').join('') || '<div class="note" style="padding:8px">No steps yet.</div>';
    const parts = [];
    if (info.nextReset) parts.push('Next reset ' + tm(info.nextReset));
    if (info.lastReset && info.lastReset.at >= info.runStart) parts.push('Reset by ' + info.lastReset.by + ' ' + ago(info.lastReset.at));
    el.querySelector('.cfoot').innerHTML = '<span class="note">' + esc(parts.join(' · ')) + '</span>' +
      (S.state.user ? '<button class="ghost reset">Reset now</button>' : '');
    if (typeof linkDevices === 'function') linkDevices(el.querySelector('.citems'));
  }

  function wireChecklists(root, pageId) {
    const els = Array.from(root.querySelectorAll('.check[data-cid]')).filter((e) => e.dataset.cid);
    if (!els.length) return;
    let busy = 0, timer = null;
    const byId = (id) => els.find((e) => e.dataset.cid === id);
    const load = async () => {
      if (!root.isConnected) { clearInterval(timer); return; }
      if (busy || document.hidden) return;
      try {
        const d = await get('/api/pages/' + pageId + '/checklists');
        if (busy) return;
        d.checklists.forEach((c) => { const el = byId(c.id); if (el) fillChecklist(el, c); });
      } catch (e) { /* offline banner handles it */ }
    };
    els.forEach((el) => {
      el.addEventListener('change', async (e) => {
        const box = e.target.closest('input[data-item]');
        if (!box) return;
        box.closest('label').classList.toggle('done', box.checked);
        busy++;
        try {
          const r = await call('POST', '/api/pages/' + pageId + '/checklists/' + el.dataset.cid + '/tick', { item: box.dataset.item, done: box.checked });
          fillChecklist(el, r.checklist);
        } catch (err) {
          box.checked = !box.checked;
          box.closest('label').classList.toggle('done', box.checked);
          toast(err.message, 'bad');
          if (err.status === 409) load();
        } finally { busy--; }
      });
      el.addEventListener('click', async (e) => {
        if (!e.target.closest('.reset')) return;
        if (!await confirmBox('Reset this checklist?', 'All ticks are cleared for everyone. Use this to start the checklist over.', 'Reset')) return;
        busy++;
        try { const r = await call('POST', '/api/pages/' + pageId + '/checklists/' + el.dataset.cid + '/reset'); fillChecklist(el, r.checklist); toast('Checklist reset', 'ok'); }
        catch (err) { toast(err.message, 'bad'); }
        finally { busy--; }
      });
    });
    load();
    timer = setInterval(load, 15000);
  }

  // ================= IP addresses =================
  function ipInt(s) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || '').trim());
    if (!m) return null;
    const p = m.slice(1).map(Number);
    if (p.some((n) => n > 255)) return null;
    return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
  }
  const intIp = (n) => [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');
  function subnet(cidr) {
    const m = /^([\d.]+)\/(\d+)$/.exec(String(cidr || '').trim());
    if (!m) return null;
    const base = ipInt(m[1]), prefix = Number(m[2]);
    if (base === null || prefix < 8 || prefix > 30) return null;
    const size = 2 ** (32 - prefix);
    const net = Math.floor(base / size) * size;
    return { net, bcast: net + size - 1, first: net + 1, last: net + size - 2, prefix, text: intIp(net) + '/' + prefix };
  }
  function analyze(b) {
    const sn = subnet(b.net && b.net.cidr);
    const count = new Map();
    b.rows.forEach((r) => { const n = ipInt(r.ip); if (n !== null) count.set(n, (count.get(n) || 0) + 1); });
    const gw = ipInt(b.net && b.net.gateway);
    const rowState = b.rows.map((r) => {
      const ip = String(r.ip || '').trim();
      if (!ip) return { cls: '', msg: '' };
      const n = ipInt(ip);
      if (n === null) return { cls: 'bad', msg: 'Not an IP address' };
      if (count.get(n) > 1) return { cls: 'bad', msg: 'Used more than once' };
      if (sn && (n < sn.first || n > sn.last)) return { cls: 'warn', msg: (n === sn.net ? 'Network address' : n === sn.bcast ? 'Broadcast address' : 'Outside ' + sn.text) };
      if (gw !== null && n === gw) return { cls: 'warn', msg: 'Same as the gateway' };
      return { cls: '', msg: '' };
    });
    const used = new Set();
    if (sn) {
      count.forEach((_, n) => { if (n >= sn.first && n <= sn.last) used.add(n); });
      if (gw !== null && gw >= sn.first && gw <= sn.last) used.add(gw);
    }
    const hosts = sn ? sn.last - sn.first + 1 : 0;
    return { sn, rowState, used, free: sn ? hosts - used.size : null, hosts, problems: rowState.filter((s) => s.cls === 'bad').length };
  }
  function nextFree(b, from) {
    const a = analyze(b);
    if (!a.sn) return null;
    for (let n = Math.max(a.sn.first, from || 0); n <= a.sn.last; n++) if (!a.used.has(n)) return intIp(n);
    return null;
  }

  function ipView(b) {
    const a = analyze(b);
    const n = b.net || {};
    const chips = [n.name ? '<b>' + esc(n.name) + '</b>' : '', n.vlan ? '<span class="chip">VLAN ' + esc(n.vlan) + '</span>' : '',
      n.cidr ? '<span class="chip mono">' + esc(n.cidr) + '</span>' : '', n.gateway ? '<span class="chip">Gateway <span class="mono">' + esc(n.gateway) + '</span></span>' : ''].filter(Boolean).join('');
    const stats = a.sn ? b.rows.filter((r) => r.ip).length + ' listed · ' + a.free + ' of ' + a.hosts + ' free' : b.rows.length + ' listed';
    const rows = b.rows.map((r, i) => {
      const st = a.rowState[i];
      const ipn = ipInt(r.ip);
      const ipCell = ipn !== null ? '<a class="mono" href="http://' + esc(r.ip) + '" target="_blank" rel="noopener">' + esc(r.ip) + '</a>' : '<span class="mono">' + esc(r.ip) + '</span>';
      return '<tr class="' + st.cls + '" data-q="' + esc(Object.values(r).join(' ').toLowerCase()) + '"><td>' + ipCell + (st.msg ? '<span class="flag ' + st.cls + '">' + esc(st.msg) + '</span>' : '') + '</td><td>' + esc(r.device) + '</td><td class="mono">' + esc(r.mac) + '</td><td>' + esc(r.location) + '</td><td>' + esc(r.notes) + '</td></tr>';
    }).join('');
    return '<div class="iplist blockbox" data-ipid="' + esc(b.id || '') + '"><div class="ph"><b>' + esc(b.title || 'IP list') + '</b><span class="note">' + esc(stats) + '</span></div>' +
      (chips ? '<div class="netline">' + chips + '</div>' : '') +
      (a.problems ? '<div class="locknote">' + a.problems + ' address' + (a.problems === 1 ? ' has' : 'es have') + ' a problem (marked in red).</div>' : '') +
      (b.rows.length > 12 ? '<input class="ipq" type="search" placeholder="Filter by IP, device or location">' : '') +
      (b.rows.length ? '<div class="tscroll"><table class="grid"><thead><tr>' + IP_FIELDS.map((f) => '<th>' + f[1] + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="note">No addresses yet.</div>') + '</div>';
  }

  // ================= patch lists and the wire trace =================
  const isNum = (v) => /^\d+[a-z]?$/i.test(v);

  // ---- column roles: box (default), shared (stage box, console), label (port or link on the line) ----
  const roleOf = (b, ci) => (b.roles && b.roles[ci]) || 'box';
  const traceCols = (b) => (b.trace || []).filter((i) => i < b.columns.length);
  // 'rf' is a label too (a wireless frequency): written on a dashed line and checked across the whole list
  const onLine = (b, ci) => { const r = roleOf(b, ci); return r === 'label' || r === 'rf'; };
  const laneCols = (b) => traceCols(b).filter((ci) => !onLine(b, ci));
  const keyOf = (v) => String(v || '').trim().toLowerCase();
  /** A spare stage-box input or output: nothing assigned to it yet. */
  function isSpare(b, r) {
    const as = (b.assign || []).filter((ci) => ci < b.columns.length);
    return as.length > 0 && as.every((ci) => !String(r[ci] || '').trim());
  }
  /** Labels between two lanes on one row, e.g. "1" (stage box input) or "SLink". */
  function labelsBetween(b, r, ciA, ciZ) {
    const t = traceCols(b);
    const pa = t.indexOf(ciA), pz = t.indexOf(ciZ);
    return t.slice(pa + 1, pz).filter((ci) => onLine(b, ci)).map((ci) => String(r[ci] || '').trim()).filter(Boolean);
  }
  /** True when the line between two lanes is a wireless hop (a frequency is filled in, or the transmitter-receiver gap). */
  function rfBetween(b, r, ciA, ciZ) {
    const t = traceCols(b);
    return t.slice(t.indexOf(ciA) + 1, t.indexOf(ciZ)).some((ci) => roleOf(b, ci) === 'rf');
  }
  /** The frequency (or frequencies) written on a wireless hop, and the other labels (ports) on it. */
  function splitRf(b, r, ciA, ciZ) {
    const t = traceCols(b), between = t.slice(t.indexOf(ciA) + 1, t.indexOf(ciZ));
    const val = (ci) => String(r[ci] || '').trim();
    const lab = between.filter((ci) => roleOf(b, ci) === 'label' && val(ci));
    return { freq: between.filter((ci) => roleOf(b, ci) === 'rf').map(val).filter(Boolean).join(' · '), ports: lab.map(val).join(' · '),
      named: lab.map((ci) => (isNum(val(ci)) ? b.columns[ci] + ' ' : '') + val(ci)).join(' · ') };
  }
  /** A frequency as a comparable key: "524.125 MHz", "524.125" and "524.1250" are the same. */
  const freqKey = (v) => { const m = /(\d+(?:\.\d+)?)/.exec(String(v || '')); return m ? String(Number(m[1])) : keyOf(v); };

  /*
   * Names used more than once in a patch list.
   *   double patch  rows agree on everything upstream (one source sent to several places): fine
   *   clash         rows disagree upstream (two different things land on one name, port or channel)
   *   ok            a clash someone marked as intended
   * Shared gear (stage box, console) is never flagged; its ports are: input 3 of the AR2412 can only take one source.
   * Cable runs only check the cable Label column: devices naturally appear on many cables.
   * Returns cells: Map "row:col" -> { kind, rows }, plus counts and the clash groups.
   */
  function dupInfo(b) {
    const cells = new Map();
    const groups = [];
    const okSet = new Set(b.ok || []);
    const t = traceCols(b);
    const upstream = (p) => t.slice(0, p).filter((ci) => roleOf(b, ci) === 'box');
    const check = [];
    if (b.preset === 'cable') check.push({ ci: 0, up: [], cable: true });
    else t.forEach((ci, p) => {
      const role = roleOf(b, ci);
      if (role === 'box') check.push({ ci, up: upstream(p) });
      // a wireless frequency: two different transmitters on one frequency clash, whichever receiver they are on
      if (role === 'rf') check.push({ ci, up: upstream(p), rf: true });
      if (role === 'label') {
        // a port: a label right before a shared box, coming from a normal box (or nothing)
        const next = t.slice(p + 1).find((x) => !onLine(b, x));
        const prev = t.slice(0, p).reverse().find((x) => !onLine(b, x));
        if (next !== undefined && roleOf(b, next) === 'shared' && (prev === undefined || roleOf(b, prev) !== 'shared')) check.push({ ci, up: upstream(p), on: next });
        else if (prev !== undefined && roleOf(b, prev) === 'shared' && (next === undefined || roleOf(b, next) !== 'shared')) check.push({ ci, up: upstream(p), on: prev, out: true, down: next });
      }
    });
    for (const { ci, up, on, cable, out, down, rf } of check) {
      const by = new Map();
      b.rows.forEach((r, ri) => {
        if (isSpare(b, r)) return;
        const k = rf ? (String(r[ci] || '').trim() ? freqKey(r[ci]) : '') : keyOf(r[ci]);
        if (!k) return;
        const kk = on === undefined ? k : k + '@' + keyOf(r[on]);
        if (!by.has(kk)) by.set(kk, []);
        by.get(kk).push(ri);
      });
      for (const [k, rows] of by) {
        if (rows.length < 2) continue;
        // one output socket feeding two destinations is a clash, not a double patch;
        // the same socket to the same place on several rows (two bodypacks on one IEM transmitter) is one cable
        const sameDown = out && down !== undefined && new Set(rows.map((ri) => keyOf(b.rows[ri][down]))).size === 1 && keyOf(b.rows[rows[0]][down]);
        let fanOut = !cable && (!out || !!sameDown);
        if (fanOut) for (const u of up) { if (new Set(rows.map((ri) => keyOf(b.rows[ri][u])).filter(Boolean)).size > 1) { fanOut = false; break; } }
        const okKey = ci + ':' + k;
        const kind = fanOut ? 'double' : okSet.has(okKey) ? 'ok' : 'clash';
        rows.forEach((ri) => cells.set(ri + ':' + ci, { kind, rows, ci, key: k }));
        const r0 = b.rows[rows[0]];
        groups.push({ kind, ci, key: k, label: String(r0[ci]).trim() + (on !== undefined ? ' on ' + String(r0[on]).trim() : ''), rows });
      }
    }
    // a double patch shows up in several columns (mix, transmitter, frequency): count it once per set of rows
    const doubles = new Set(groups.filter((g) => g.kind === 'double').map((g) => g.rows.join(','))).size;
    return { cells, groups, clashes: groups.filter((g) => g.kind === 'clash').length, doubles };
  }
  const dupTitle = (d, b) => {
    const others = d.rows.map((r) => r + 1).join(', ');
    return d.kind === 'double' ? 'Double patch: same source on rows ' + others
      : d.kind === 'ok' ? 'Used on rows ' + others + ' (marked as intended)'
      : roleOf(b, d.ci) === 'rf' ? 'Same frequency on rows ' + others + ' for different transmitters. They will interfere: give one a new frequency, or mark it as intended.'
      : 'Used on rows ' + others + ' by different ' + (b.preset === 'cable' ? 'cables' : 'sources') + '. Rename one, or mark it as intended.';
  };

  /*
   * The wire trace drawing. Lanes are the box and shared columns; label columns
   * (ports, links) are written on the lines. Shared gear (a stage box, a console) is
   * drawn tall with one numbered socket per line, and identical lines between two
   * pieces of shared gear are bundled into one thick trunk (the SLink or Cat5 run).
   */
  function traceSvg(b) {
    // lanes nobody uses (no stage box on an in-ear list) are left out of the drawing
    const used = b.rows.filter((r) => !isSpare(b, r));
    const lanes = laneCols(b).filter((ci) => !used.length || used.some((r) => String(r[ci] || '').trim()));
    if (lanes.length < 2) return '';
    const dups = dupInfo(b);
    const hasRf = traceCols(b).some((ci) => roleOf(b, ci) === 'rf');
    const colW = 150, gapX = hasRf ? 124 : 70, padX = 8, top = 46, nodeH = 32, gapY = 12, slot = 18;
    const nodes = lanes.map(() => new Map());
    const bundles = new Map();
    b.rows.forEach((row, ri) => {
      if (isSpare(b, row)) return;
      const pts = [];
      lanes.forEach((ci, k) => {
        const v = String(row[ci] || '').trim();
        if (!v) return;
        let n = nodes[k].get(keyOf(v));
        if (!n) {
          n = { k, label: isNum(v) ? b.columns[ci] + ' ' + v : v, rows: [], dup: '', shared: roleOf(b, ci) === 'shared', ins: [], outs: [] };
          nodes[k].set(keyOf(v), n);
        }
        n.rows.push(ri);
        const d = dups.cells.get(ri + ':' + ci);
        if (d && (d.kind === 'clash' || !n.dup)) n.dup = d.kind;
        pts.push([k, n, ci]);
      });
      for (let j = 1; j < pts.length; j++) {
        const [k1, a, c1] = pts[j - 1], [k2, z, c2] = pts[j];
        const label = labelsBetween(b, row, c1, c2).join(' · ');
        const id = k1 + ':' + keyOf(a.label) + '>' + k2 + ':' + keyOf(z.label) + '|' + keyOf(label);   // the same wire on several rows (a double patch) is drawn once
        if (!bundles.has(id)) {
          const rf = rfBetween(b, row, c1, c2), sp = rf ? splitRf(b, row, c1, c2) : null;
          const t = traceCols(b), rfCi = rf ? t.slice(t.indexOf(c1) + 1, t.indexOf(c2)).find((ci) => roleOf(b, ci) === 'rf') : undefined;
          const fd = rfCi !== undefined ? dups.cells.get(ri + ':' + rfCi) : null;
          const e = { a, z, label, rows: [], rf, freq: sp ? sp.freq : '', port: sp ? sp.ports : label, named: sp ? sp.named : label, clash: !!fd && fd.kind === 'clash' };
          bundles.set(id, e); a.outs.push(e); z.ins.push(e);
        }
        bundles.get(id).rows.push(ri);
      }
    });
    // sizes and positions
    const allNodes = nodes.map((m) => [...m.values()]);
    allNodes.flat().forEach((n) => {
      const ports = n.shared ? Math.max(n.ins.length, n.outs.length) : 0;
      n.h = n.shared && ports > 1 ? 28 + ports * slot : nodeH;
    });
    allNodes.forEach((list) => { let y = top; list.forEach((n) => { n.y = y; y += n.h + gapY; }); });
    // order sockets by where the line comes from / goes to, so lines do not cross
    allNodes.flat().forEach((n) => {
      n.ins.sort((p, q) => p.a.y - q.a.y || p.rows[0] - q.rows[0]);
      n.outs.sort((p, q) => p.z.y - q.z.y || p.rows[0] - q.rows[0]);
    });
    const cx = (k) => padX + k * (colW + gapX);
    const sockY = (n, list, e) => {
      if (!n.shared || list.length < 2) return n.y + n.h / 2;
      return n.y + 28 + list.indexOf(e) * slot + slot / 2 - 2;
    };
    const W = padX * 2 + lanes.length * colW + (lanes.length - 1) * gapX;
    const H = Math.max(...allNodes.map((l) => (l.length ? l[l.length - 1].y + l[l.length - 1].h : top))) + 10;
    const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    let edges = '', socks = '';
    const rfSeen = new Set();
    bundles.forEach((e) => {
      const x1 = cx(e.a.k) + colW, y1 = sockY(e.a, e.a.outs, e), x2 = cx(e.z.k), y2 = sockY(e.z, e.z.ins, e), mx = (x2 - x1) / 2;
      const trunk = e.rows.length > 1 && e.a.shared && e.z.shared;
      const d = 'M' + x1 + ' ' + y1 + 'C' + (x1 + mx) + ' ' + y1 + ' ' + (x2 - mx) + ' ' + y2 + ' ' + x2 + ' ' + y2;
      edges += '<path class="te' + (trunk ? ' trunk' : '') + (e.rf ? ' rf' : '') + (e.clash ? ' bad' : '') + '" data-r="' + e.rows.join(',') + '" d="' + d + '"' + (trunk ? ' style="stroke-width:' + Math.min(10, 3 + e.rows.length * 0.35) + 'px"' : '') + '/>';
      if (e.rf) {
        // a radio hop: the frequency at the transmitter end of the dashed line (once, even when it feeds several bodypacks);
        // a receiver channel goes on the receiver's socket, anything else (Stereo / Mono) rides along with the frequency
        const onSock = e.port && e.z.shared && e.z.ins.length > 1;
        const txt = [e.freq ? '⌁ ' + e.freq : '', onSock ? '' : e.named].filter(Boolean).join(' · ');
        const seen = e.a.k + ':' + keyOf(e.a.label) + '|' + txt;
        if (txt && !rfSeen.has(seen)) { rfSeen.add(seen); edges += '<text class="tl rft' + (e.clash ? ' bad' : '') + '" x="' + (x1 + 6) + '" y="' + (y1 - 6) + '">' + esc(cut(txt, 24)) + '</text>'; }
        if (onSock) socks += '<text class="sock" x="' + (x2 + 7) + '" y="' + (y2 + 4) + '">' + esc(cut(e.port, 6)) + '</text>';
      } else if (trunk) edges += '<text class="tl" x="' + ((x1 + x2) / 2) + '" y="' + (((y1 + y2) / 2) - 8) + '" text-anchor="middle">' + esc(cut((e.label || 'Link') + ' · ' + e.rows.length + ' ch', 26)) + '</text>';
      else if (e.label && e.z.shared && e.z.ins.length > 1) socks += '<text class="sock" x="' + (x2 + 7) + '" y="' + (y2 + 4) + '">' + esc(cut(e.label, 6)) + '</text>';
      else if (e.label && e.a.shared && e.a.outs.length > 1) socks += '<text class="sock" x="' + (x1 - 7) + '" y="' + (y1 + 4) + '" text-anchor="end">' + esc(cut(e.label, 6)) + '</text>';
      else if (e.label) edges += '<text class="tl" x="' + (x2 - 6) + '" y="' + (y2 - 5) + '" text-anchor="end">' + esc(cut(e.label, e.rf ? 22 : 14)) + '</text>';
    });
    let boxes = '';
    allNodes.flat().forEach((n) => {
      const x = cx(n.k), tall = n.h > nodeH;
      boxes += '<g class="tn' + (n.shared ? ' shared' : '') + (n.dup === 'clash' ? ' clash' : '') + '" data-rows="' + n.rows.join(',') + '"><title>' + esc(n.label) + ' · ' + n.rows.length + ' connection' + (n.rows.length === 1 ? '' : 's') + '</title>' +
        '<rect x="' + x + '" y="' + n.y + '" width="' + colW + '" height="' + n.h + '" rx="7"/>' +
        '<text class="' + (tall ? 'nm' : '') + '" x="' + (x + 10) + '" y="' + (tall ? n.y + 19 : n.y + nodeH / 2 + 4.5) + '">' + esc(cut(n.label, 19)) + '</text>' +
        (tall ? '<line class="sep" x1="' + x + '" x2="' + (x + colW) + '" y1="' + (n.y + 27) + '" y2="' + (n.y + 27) + '"/>' : '') +
        (!tall && n.rows.length > 1 ? '<text class="cnt" x="' + (x + colW - 9) + '" y="' + (n.y + nodeH / 2 + 4) + '" text-anchor="end">' + (n.dup === 'clash' ? '! ' : n.dup === 'double' ? '⇉ ' : '') + n.rows.length + '</text>' : '') +
        (tall ? '<text class="cnt" x="' + (x + colW - 9) + '" y="' + (n.y + 19) + '" text-anchor="end">' + n.rows.length + '</text>' : '') + '</g>';
    });
    const heads = lanes.map((ci, k) => '<text class="th" x="' + (cx(k) + 2) + '" y="22">' + esc(b.columns[ci].toUpperCase()) + '</text>' +
      (k ? '<path class="ta" d="M' + (cx(k) - gapX / 2 - 6) + ' 17l6 0m-3 -3l3 3l-3 3"/>' : '')).join('');
    return '<svg class="trace" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Wire trace">' + heads + '<g class="tes">' + edges + '</g>' + boxes + socks + '</svg>';
  }

  function chainText(b, ri) {
    const r = b.rows[ri];
    return traceCols(b).map((ci) => {
      const v = String(r[ci] || '').trim();
      if (!v) return null;
      if (roleOf(b, ci) === 'rf') return '(⌁ ' + v + ')';
      if (roleOf(b, ci) === 'label') return '(' + (isNum(v) ? b.columns[ci].toLowerCase() + ' ' + v : v) + ')';
      return isNum(v) ? b.columns[ci] + ' ' + v : v;
    }).filter(Boolean).join(' → ').replace(/ → \(/g, ' (').replace(/\) → /g, ') → ');
  }

  /**
   * How a patch table is laid out: gear or labels that are the same on every row (AR2412, SLink, SQ-5)
   * fold into one "Every row" line, and number columns (Input, Box input) are narrow.
   */
  function tableLayout(b) {
    const filled = b.rows.filter((r) => r.some((v) => String(v || '').trim()));
    const same = (ci) => { const vals = new Set(filled.map((r) => String(r[ci] || '').trim())); return filled.length > 1 && vals.size === 1 && !vals.has(''); };
    const fold = b.columns.map((_, ci) => roleOf(b, ci) !== 'box' && same(ci));
    const vis = b.columns.map((_, ci) => ci).filter((ci) => !fold[ci]);
    const narrow = b.columns.map((c, ci) => /^(#|ch|in|input|out|output|box input|box output|console out|rx ch|mode|port|no\.?|length|stand)$/i.test(String(c).trim()) ||
      (filled.some((r) => String(r[ci] || '').trim()) && filled.every((r) => !String(r[ci] || '').trim() || /^\d+[a-z]?$/i.test(String(r[ci]).trim()))));
    const shared = b.columns.map((c, ci) => (fold[ci] ? { ci, name: c, value: String(filled[0][ci]).trim() } : null)).filter(Boolean);
    return { vis, narrow, shared };
  }

  const spareWord = (b) => ({ snakeout: 'outputs', wireless: 'receiver channels', iem: 'in-ear rows' })[b.preset] || 'inputs';

  function patchView(b) {
    const title = b.title || (PRESETS[b.preset] || PRESETS.custom).title;
    const svg = traceSvg(b);
    const dups = dupInfo(b);
    const L = tableLayout(b);
    const cell = (ri, ci, v) => {
      const d = dups.cells.get(ri + ':' + ci);
      return d ? '<td class="dup ' + d.kind + '" title="' + esc(dupTitle(d, b)) + '">' + esc(v) + '<i class="dupmark">' + (d.kind === 'double' ? '⇉' : d.kind === 'ok' ? '✓' : '!') + '</i></td>' : '<td>' + esc(v) + '</td>';
    };
    const table = b.rows.length
      ? (L.shared.length ? '<div class="pshared"><span class="note">Every row</span>' + L.shared.map((x) => '<span class="chip">' + esc(x.name) + ' <b>' + esc(x.value) + '</b></span>').join('') + '</div>' : '') +
        '<div class="tscroll"><table class="grid"><thead><tr>' + L.vis.map((ci) => '<th' + (L.narrow[ci] ? ' class="nw"' : '') + '>' + esc(b.columns[ci]) + '</th>').join('') + '</tr></thead><tbody>' +
        b.rows.map((r, ri) => '<tr data-r="' + ri + '"' + (isSpare(b, r) ? ' class="spare"' : '') + '>' + L.vis.map((ci) => cell(ri, ci, r[ci] || '')).join('') + '</tr>').join('') + '</tbody></table></div>' +
        (b.rows.some((r) => isSpare(b, r)) ? '<button type="button" class="ghost sparebtn">' + b.rows.filter((r) => isSpare(b, r)).length + ' spare ' + spareWord(b) + ' · show</button>' : '')
      : '<div class="note">No rows yet.</div>';
    return '<div class="patch blockbox" data-pid="' + esc(b.id || '') + '"><div class="ph"><b>' + esc(title) + '</b><span class="note">' + b.rows.length + ' row' + (b.rows.length === 1 ? '' : 's') + '</span>' +
      (dups.clashes ? '<span class="chip warn" title="' + esc(dups.groups.filter((g) => g.kind === 'clash').map((g) => g.label).join(', ')) + '">' + dups.clashes + ' used twice</span>' : '') +
      (dups.doubles ? '<span class="chip" title="' + esc(dups.groups.filter((g) => g.kind === 'double').map((g) => g.label).join(', ')) + '">' + dups.doubles + (b.preset === 'iem' ? ' shared mix' + (dups.doubles === 1 ? '' : 'es') : ' double patch' + (dups.doubles === 1 ? '' : 'es')) + '</span>' : '') +
      (svg && b.rows.length ? '<div class="seg pv"><button data-v="table" class="on">Table</button><button data-v="trace">Trace</button></div>' : '') + '</div>' +
      '<div class="pt">' + table + '</div>' +
      (svg && b.rows.length ? '<div class="ptr hide"><div class="tscroll">' + svg + '</div><div class="note trinfo">Tap a box or a line to follow it.</div></div>' : '') + '</div>';
  }

  function wirePatch(root, blocks) {
    root.querySelectorAll('.patch[data-pid]').forEach((el) => {
      const b = blocks.find((x) => x.type === 'patch' && x.id === el.dataset.pid);
      if (!b) return;
      const svg = el.querySelector('svg.trace');
      const info = el.querySelector('.trinfo');
      const show = (v) => {
        el.querySelectorAll('.pv button').forEach((x) => x.classList.toggle('on', x.dataset.v === v));
        el.querySelector('.pt').classList.toggle('hide', v === 'trace');
        const tr = el.querySelector('.ptr'); if (tr) tr.classList.toggle('hide', v !== 'trace');
        el.classList.toggle('tracing', v === 'trace');
      };
      const highlight = (rows, label) => {
        if (!svg) return;
        const set = new Set(rows);
        svg.classList.toggle('hl', set.size > 0);
        svg.querySelectorAll('.te').forEach((p) => p.classList.toggle('on', p.dataset.r.split(',').some((r) => set.has(Number(r)))));
        svg.querySelectorAll('.tn').forEach((g) => g.classList.toggle('on', g.dataset.rows.split(',').some((r) => set.has(Number(r)))));
        if (!info) return;
        if (!set.size) { info.textContent = 'Tap a box or a line to follow it.'; return; }
        const lines = rows.slice(0, 8).map((r) => '<div>' + esc(chainText(b, r)) + '</div>').join('') + (rows.length > 8 ? '<div>and ' + (rows.length - 8) + ' more</div>' : '');
        info.innerHTML = (label ? '<b>' + esc(label) + '</b> · ' + rows.length + ' connection' + (rows.length === 1 ? '' : 's') : '') + lines;
      };
      let current = '';
      el.querySelectorAll('.pv button').forEach((x) => x.addEventListener('click', () => show(x.dataset.v)));
      const spb = el.querySelector('.sparebtn');
      if (spb) spb.addEventListener('click', () => { const on = el.classList.toggle('showspare'); spb.textContent = spb.textContent.replace(/ · (show|hide)$/, on ? ' · hide' : ' · show'); });
      el.querySelectorAll('.pt tr[data-r]').forEach((tr) => tr.addEventListener('click', () => {
        if (!svg) return;
        show('trace'); current = 'r' + tr.dataset.r; highlight([Number(tr.dataset.r)]);
      }));
      if (svg) svg.addEventListener('click', (e) => {
        const g = e.target.closest('.tn'), p = e.target.closest('.te');
        let key = '', rows = [], label = '';
        if (g) { key = 'n' + g.dataset.rows; rows = g.dataset.rows.split(',').map(Number); label = g.querySelector('title').textContent.split(' · ')[0]; }
        else if (p) { key = 'r' + p.dataset.r; rows = p.dataset.r.split(',').map(Number); }
        if (!key || key === current) { current = ''; highlight([]); return; }
        current = key; highlight(rows, label);
      });
    });
    root.querySelectorAll('.iplist .ipq').forEach((q) => q.addEventListener('input', () => {
      const v = q.value.trim().toLowerCase();
      q.closest('.iplist').querySelectorAll('tbody tr').forEach((tr) => tr.classList.toggle('hide', !!v && !tr.dataset.q.includes(v)));
    }));
  }

  // ================= editors =================
  function gridKeys(table, onEnterLast) {
    table.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || !e.target.dataset.r) return;
      e.preventDefault();
      const r = Number(e.target.dataset.r), c = e.target.dataset.c;
      const next = table.querySelector('input[data-r="' + (r + 1) + '"][data-c="' + c + '"]');
      if (next) next.focus(); else onEnterLast(c);
    });
  }

  function editChecklist(host, b, dirty) {
    if (!Array.isArray(b.schedule)) b.schedule = [];
    host.innerHTML = '<input class="full" data-f="title" placeholder="Checklist name, e.g. Sunday startup" value="' + esc(b.title) + '">' +
      '<textarea data-f="_items" rows="6" placeholder="One step per line">' + esc(b._items !== undefined ? b._items : (b.items || []).join('\n')) + '</textarea>' +
      '<div class="mdhelp">One step per line. Everyone sees the same ticks, with who ticked each step.</div>' +
      '<div class="sched"><div class="sh"><b>Auto reset</b><span class="note">At each reset the checklist starts empty and shows on everyone’s To do list until it is done or the day ends. Past the done-by time it turns red.</span></div><div class="srows"></div>' +
      '<button type="button" class="btn" data-sadd>' + icon('plus') + 'Add reset time</button></div>';
    host.querySelectorAll('[data-f]').forEach((f) => f.addEventListener('input', () => { b[f.dataset.f] = f.value; dirty(); }));
    const rowsEl = host.querySelector('.srows');
    const paint = () => {
      rowsEl.innerHTML = b.schedule.map((r, i) => '<div class="srow" data-i="' + i + '"><select data-k="day" aria-label="Day"><option value="daily"' + (r.day === 'daily' ? ' selected' : '') + '>Every day</option>' +
        DAY_NAMES.map((d, j) => '<option value="' + j + '"' + (r.day === j ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>' +
        '<label>Reset <input type="time" data-k="reset" value="' + esc(r.reset) + '" required></label>' +
        '<label>Done by <input type="time" data-k="due" value="' + esc(r.due) + '"></label>' +
        '<button type="button" class="ghost" data-sdel title="Remove">' + icon('x') + '</button><div class="note sdesc">' + esc(describe(r)) + '</div></div>').join('') ||
        '<div class="note" style="padding:4px 0 8px">No schedule: the checklist only resets when someone taps Reset now.</div>';
      rowsEl.querySelectorAll('.srow').forEach((row) => {
        const r = b.schedule[Number(row.dataset.i)];
        row.querySelectorAll('[data-k]').forEach((f) => f.addEventListener('change', () => {
          r[f.dataset.k] = f.dataset.k === 'day' ? (f.value === 'daily' ? 'daily' : Number(f.value)) : f.value;
          if (!r.reset) r.reset = '06:00';
          row.querySelector('.sdesc').textContent = describe(r);
          dirty();
        }));
        row.querySelector('[data-sdel]').addEventListener('click', () => { b.schedule.splice(Number(row.dataset.i), 1); dirty(); paint(); });
      });
    };
    host.querySelector('[data-sadd]').addEventListener('click', () => {
      const lastRow = b.schedule[b.schedule.length - 1];
      b.schedule.push(lastRow ? { ...lastRow, day: lastRow.day === 'daily' ? 'daily' : (lastRow.day + 3) % 7 } : { day: 0, reset: '06:00', due: '09:00' });
      dirty(); paint();
    });
    paint();
  }

  function editPatch(host, b, dirty) {
    if (!Array.isArray(b.columns) || !b.columns.length) b.columns = PRESETS[b.preset || 'custom'].columns.slice();
    if (!Array.isArray(b.rows)) b.rows = [];
    if (!Array.isArray(b.trace)) b.trace = (PRESETS[b.preset] || PRESETS.custom).trace.filter((i) => i < b.columns.length);
    if (!b.roles || typeof b.roles !== 'object') b.roles = { ...((PRESETS[b.preset] || {}).roles || {}) };
    if (!Array.isArray(b.assign)) b.assign = ((PRESETS[b.preset] || {}).assign || []).slice();
    const isSnake = () => ['snake', 'snakeout', 'wireless', 'iem'].includes(b.preset);   // lists made from gear first, then assigned
    const ensureBlank = () => { if (!b.rows.length || b.rows[b.rows.length - 1].some((v) => String(v || '').trim())) b.rows.push(b.columns.map(() => '')); };
    const paint = (focus) => {
      const traceTxt = b.trace.filter((i) => i < b.columns.length).map((i) => (onLine(b, i) ? '(' + (b.columns[i] || '?') + ')' : b.columns[i] || '?')).join(' → ') || 'not set';
      const setupBtn = isSnake() ? '<button type="button" class="btn primary" data-setup>' + icon('grid') + ({ snake: 'Set up stage box inputs', snakeout: 'Set up stage box outputs', wireless: 'Add a wireless receiver', iem: 'Add in-ear transmitters' })[b.preset] + '</button>' : '';
      const spare = b.rows.filter((r) => r.some((v) => String(v || '').trim()) && isSpare(b, r)).length;
      const top = '<div class="prow"><input class="full grow" data-f="title" placeholder="' + esc((PRESETS[b.preset] || PRESETS.custom).title) + '" value="' + esc(b.title || '') + '">' +
        '<select data-preset aria-label="Layout">' + Object.keys(PRESETS).map((k) => '<option value="' + k + '"' + (k === b.preset ? ' selected' : '') + '>' + PRESETS[k].title + ' layout</option>').join('') + '</select>' +
        '<div class="seg pmode"><button type="button" data-pm="table"' + (b._view !== 'draw' ? ' class="on"' : '') + '>Table</button><button type="button" data-pm="draw"' + (b._view === 'draw' ? ' class="on"' : '') + '>Draw</button></div></div>';
      if (b._view === 'draw') {
        b.rows = b.rows.filter((r) => r.some((v) => String(v || '').trim()));
        host.innerHTML = top + '<div class="pdhelp note">Drag from the dot on a box to another box to connect them, or tap the dot and then the box. Tap a line or box to edit it. Everything you draw is a row in the table.</div>' +
          '<div class="tscroll pdscroll"><div class="pdraw"></div></div><div class="pdpanel"></div>' +
          '<div class="adder" style="padding:8px 0 4px">' + setupBtn + '<span class="note grow">Wire trace: ' + esc(traceTxt) + (spare ? ' · ' + spare + ' spare' : '') + '</span><button type="button" class="btn" data-trace>Trace path</button></div>';
        wireTop();
        host.querySelector('[data-trace]').addEventListener('click', () => traceDialog());
        drawPatch(host.querySelector('.pdraw'), host.querySelector('.pdpanel'), b, dirty, traceDialog);
        return;
      }
      ensureBlank();
      const L = tableLayout(b);
      const devNames = typeof DEV !== 'undefined' && DEV.list ? DEV.list.map((d) => d.name) : [];
      const dl = (ci) => 'pdl-' + (b.id || 'new') + '-' + ci;
      const lists = L.vis.map((ci) => {
        const vals = new Set(b.rows.map((r) => String(r[ci] || '').trim()).filter(Boolean));
        if (!onLine(b, ci) && !L.narrow[ci]) devNames.forEach((n) => vals.add(n));
        return '<datalist id="' + dl(ci) + '">' + [...vals].sort().slice(0, 400).map((v) => '<option value="' + esc(v) + '">').join('') + '</datalist>';
      }).join('');
      const showSpare = b._spares !== false;
      const assign = new Set(b.assign || []);
      host.innerHTML = top + (L.shared.length ? '<div class="pshared"><span class="note">Every row</span>' + L.shared.map((x) => '<span class="chip">' + esc(x.name) + ' <b>' + esc(x.value) + '</b></span>').join('') + '<button type="button" class="ghost" data-shchg>Change</button></div>' : '') +
        lists + '<div class="tscroll"><table class="gedit pgrid' + (showSpare ? '' : ' nospare') + '"><thead><tr>' +
        L.vis.map((ci) => '<th class="' + (L.narrow[ci] ? 'nw' : '') + '">' + esc(b.columns[ci]) + '</th>').join('') + '<th class="rt"></th></tr></thead><tbody>' +
        b.rows.map((r, ri) => {
          const sp = isSpare(b, r) && r.some((v) => String(v || '').trim());
          return '<tr class="' + (sp ? 'spare' : '') + '">' + L.vis.map((ci) => '<td class="' + (L.narrow[ci] ? 'nw' : '') + '"><input data-r="' + ri + '" data-c="' + ci + '" value="' + esc(r[ci] || '') + '" list="' + dl(ci) + '" autocomplete="off"' +
            (sp && assign.has(ci) ? ' placeholder="spare"' : '') + '></td>').join('') +
            '<td class="rt"><button type="button" class="ghost rmb" data-rmenu="' + ri + '" title="Row options" aria-label="Row options">⋯</button></td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<div class="adder" style="padding:8px 0 4px">' + setupBtn + (isSnake() ? '' : '<button type="button" class="btn" data-radd>' + icon('plus') + 'Row</button>') +
        '<button type="button" class="btn ghost" data-paste>Paste rows</button><button type="button" class="btn ghost" data-cols>Columns</button>' +
        (spare ? '<button type="button" class="btn ghost" data-spares>' + (showSpare ? 'Hide' : 'Show') + ' ' + spare + ' spare</button>' : '') +
        '<span class="note grow">Wire trace: ' + esc(traceTxt) + '</span><button type="button" class="btn ghost" data-trace>Trace path</button></div>' +
        '<div class="mdhelp">Enter moves down. Names suggest themselves from this list and the device library. ⋯ on a row: duplicate it for a double patch, ' + (isSnake() ? 'make it spare' : 'insert a row') + ', move or delete it.</div>';
      wireTop();
      markDups();
      host.querySelectorAll('input[data-r]').forEach((f) => f.addEventListener('input', () => {
        const ri = Number(f.dataset.r);
        b.rows[ri][Number(f.dataset.c)] = f.value; dirty(); markDups();
        if (ri === b.rows.length - 1 && f.value) { prefill(ri); b.rows.push(b.columns.map(() => '')); paint({ r: ri, c: f.dataset.c, keep: f.selectionStart }); }
      }));
      gridKeys(host.querySelector('.gedit'), (c) => { b.rows.push(b.columns.map(() => '')); paint({ r: b.rows.length - 1, c }); });
      const sh = host.querySelector('[data-shchg]'); if (sh) sh.addEventListener('click', () => sharedDialog(L));
      host.querySelectorAll('[data-rmenu]').forEach((x) => x.addEventListener('click', () => rowMenu(Number(x.dataset.rmenu), x)));
      const ra = host.querySelector('[data-radd]'); if (ra) ra.addEventListener('click', () => { const r = b.rows.length - 1; paint({ r, c: String(L.vis[0]) }); });
      host.querySelector('[data-paste]').addEventListener('click', () => pasteRows());
      host.querySelector('[data-cols]').addEventListener('click', () => columnsDialog());
      host.querySelector('[data-trace]').addEventListener('click', () => traceDialog());
      const spb = host.querySelector('[data-spares]'); if (spb) spb.addEventListener('click', () => { b._spares = !showSpare; paint(); });
      if (focus) {
        const f = host.querySelector('input[data-r="' + focus.r + '"][data-c="' + focus.c + '"]');
        if (f) { f.focus(); if (focus.keep !== undefined) try { f.setSelectionRange(focus.keep, focus.keep); } catch (e) { /* not a text field */ } }
      }
    };
    /** Colour cells that repeat, with a list of clashes and a Mark as intended switch. */
    function markDups() {
      const d = dupInfo(b);
      host.querySelectorAll('input[data-r]').forEach((f) => {
        const x = d.cells.get(f.dataset.r + ':' + f.dataset.c);
        f.classList.toggle('dclash', !!x && x.kind === 'clash');
        f.classList.toggle('ddouble', !!x && x.kind === 'double');
        f.classList.toggle('dok', !!x && x.kind === 'ok');
        f.title = x ? dupTitle(x, b) : '';
      });
      let box = host.querySelector('.dupbox');
      const clashes = d.groups.filter((g) => g.kind !== 'double');
      if (!clashes.length) { if (box) box.remove(); return; }
      if (!box) { box = document.createElement('div'); box.className = 'dupbox'; const at = host.querySelector('.tscroll'); if (at) at.after(box); else return; }
      const named = clashes.filter((g) => roleOf(b, g.ci) !== 'rf'), freqs = clashes.length - named.length;
      box.innerHTML = (named.length ? '<b>Used more than once by different ' + (b.preset === 'cable' ? 'cables' : 'sources') + '</b><span class="note"> Rename one (for example “' + esc(named[0].label) + ' #2”), or mark it as intended. One source sent to several places is a double patch and is not listed.</span>' : '') +
        (freqs ? '<b' + (named.length ? ' style="display:block;margin-top:6px"' : '') + '>Same frequency on different transmitters</b><span class="note"> They will interfere. Give one a new frequency (run a scan on the receiver), or mark it as intended if they are never on at the same time.</span>' : '') +
        clashes.map((g) => '<label class="tog' + (g.kind === 'ok' ? ' on' : '') + '"><input type="checkbox" data-okk="' + esc(g.ci + ':' + g.key) + '"' + (g.kind === 'ok' ? ' checked' : '') + '><span><b>' + esc(g.label) + '</b> <span class="note">' + esc(b.columns[g.ci]) + ', rows ' + g.rows.map((r) => r + 1).join(', ') + '</span> · intended</span></label>').join('');
      box.querySelectorAll('[data-okk]').forEach((x) => x.addEventListener('change', () => {
        b.ok = (b.ok || []).filter((k) => k !== x.dataset.okk);
        if (x.checked) b.ok.push(x.dataset.okk);
        dirty(); markDups();
      }));
    }
    function wireTop() {
      host.querySelector('[data-f=title]').addEventListener('input', (e) => { b.title = e.target.value; dirty(); });
      host.querySelectorAll('[data-pm]').forEach((x) => x.addEventListener('click', () => { b._view = x.dataset.pm; paint(); }));
      const sb = host.querySelector('[data-setup]'); if (sb) sb.addEventListener('click', () => setupDialog());
      host.querySelector('[data-preset]').addEventListener('change', async (e) => {
        const k = e.target.value;
        const has = b.rows.some((r) => r.some((v) => String(v || '').trim()));
        if (has && !await confirmBox('Use the ' + PRESETS[k].title + ' layout?', 'Columns become ' + PRESETS[k].columns.join(', ') + '. Your rows stay: columns with the same name keep their contents (Ch and Input count as the same).', 'Change layout')) { e.target.value = b.preset; return; }
        // carry each old column into the new column with the same name; anything unmatched goes into Notes
        const norm = (c) => { const x = String(c || '').toLowerCase().replace(/[^a-z]/g, ''); return { ch: 'input', channel: 'input', in: 'input', mic: 'micdi', di: 'micdi', box: 'stagebox', stageboxinput: 'boxinput', port: 'boxinput', desk: 'console', mixer: 'console', out: 'mix', output: 'mix' }[x] || x; };
        const oldCols = b.columns.slice(), newCols = PRESETS[k].columns.slice();
        const map = newCols.map((c) => oldCols.findIndex((o) => norm(o) === norm(c)));
        const notesAt = newCols.findIndex((c) => norm(c) === 'notes');
        b.rows = b.rows.map((r) => {
          const nr = newCols.map((_, i) => (map[i] >= 0 ? r[map[i]] || '' : ''));
          const lost = oldCols.map((c, oi) => (!map.includes(oi) && String(r[oi] || '').trim() ? c + ': ' + r[oi] : '')).filter(Boolean);
          if (lost.length && notesAt >= 0) nr[notesAt] = [nr[notesAt], ...lost].filter(Boolean).join('; ');
          return nr;
        });
        b.preset = k; b.columns = newCols; b.trace = PRESETS[k].trace.slice();
        b.roles = { ...(PRESETS[k].roles || {}) }; b.assign = (PRESETS[k].assign || []).slice(); b.ok = [];
        dirty(); paint();
      });
    }
    function pasteRows() {
      modal('<h3>Paste rows</h3><p>Copy rows from Excel, Numbers or Google Sheets and paste them here. Columns are matched left to right: ' + esc(b.columns.join(', ')) + '.</p>' +
        '<textarea id="pr" rows="8" style="font:13px ui-monospace,monospace" placeholder="1\tPastor lav\tSLX-D\t\tSB1-1"></textarea><label class="tog" style="margin-top:10px"><input type="checkbox" id="ph"> The first row is column names</label>' +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary" id="pok">Add rows</button></div>', (w, close) => {
        w.querySelector('#pok').addEventListener('click', () => {
          const lines = w.querySelector('#pr').value.replace(/\r/g, '').split('\n').filter((l) => l.trim());
          if (!lines.length) return close();
          const split = (l) => l.includes('\t') ? l.split('\t') : l.split(/\s*[,;]\s*/);
          let rows = lines.map(split);
          if (w.querySelector('#ph').checked) {
            const head = rows.shift().map((h) => h.trim());
            head.forEach((h, i) => { if (h && i < 12) { if (i < b.columns.length) b.columns[i] = h; else { b.columns.push(h); b.rows.forEach((r) => r.push('')); } } });
          }
          const wide = Math.min(12, Math.max(b.columns.length, ...rows.map((r) => r.length)));
          while (b.columns.length < wide) { b.columns.push('Column ' + (b.columns.length + 1)); b.rows.forEach((r) => r.push('')); }
          b.rows = b.rows.filter((r) => r.some((v) => String(v || '').trim()));
          rows.forEach((r) => b.rows.push(b.columns.map((_, i) => String(r[i] || '').trim())));
          close(); dirty(); paint(); toast(rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' added', 'ok');
        });
      });
    }
    /** Change gear every row shares (the stage box, link or console) in one go. */
    function sharedDialog(L) {
      modal('<h3>Every row</h3><p>These are the same on every row, so they are shown once above the table. A change here applies to all rows.</p><form id="shf">' +
        L.shared.map((x) => '<label for="sh' + x.ci + '">' + esc(x.name) + '</label><input id="sh' + x.ci + '" data-ci="' + x.ci + '" value="' + esc(x.value) + '">').join('') +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>', (w, close) => {
        w.querySelector('#shf').addEventListener('submit', (e) => {
          e.preventDefault();
          w.querySelectorAll('[data-ci]').forEach((x) => {
            const ci = Number(x.dataset.ci), v = x.value.trim();
            if (!v) return;
            b.rows.forEach((r) => { if (r.some((c) => String(c || '').trim())) r[ci] = v; });
          });
          close(); dirty(); paint();
        });
      });
    }

    /** The ⋯ menu on a row. */
    function rowMenu(ri, anchor) {
      document.querySelectorAll('.rmenu').forEach((m) => m.remove());
      const m = document.createElement('div');
      m.className = 'rmenu';
      const endCol = traceCols(b)[traceCols(b).length - 1];
      const items = [['dup', b.preset === 'iem' ? 'Duplicate (another listener on this mix)' : 'Duplicate (double patch)'], isSnake() ? ['spare', 'Make spare'] : null, b.preset === 'iem' || !isSnake() ? ['ins', 'Insert row below'] : null, ['up', 'Move up'], ['down', 'Move down'], ['del', 'Delete row']].filter(Boolean);
      m.innerHTML = items.map((x) => '<button type="button" data-a="' + x[0] + '"' + ((x[0] === 'up' && !ri) || (x[0] === 'down' && ri >= b.rows.length - 2) ? ' disabled' : '') + (x[0] === 'del' ? ' class="danger"' : '') + '>' + x[1] + '</button>').join('');
      document.body.appendChild(m);
      const r = anchor.getBoundingClientRect();
      m.style.top = (r.bottom + window.scrollY + 4) + 'px';
      m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
      const off = (e) => { if (!m.contains(e.target) && e.target !== anchor) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
      setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
      m.addEventListener('click', (e) => {
        const a = e.target.closest('button'); if (!a) return;
        m.remove(); document.removeEventListener('pointerdown', off, true);
        const row = b.rows[ri];
        if (a.dataset.a === 'dup') {
          const copy = row.slice();
          if (endCol !== undefined) copy[endCol] = '';
          b.rows.splice(ri + 1, 0, copy); dirty(); paint({ r: ri + 1, c: String(endCol !== undefined ? endCol : 0) });
          toast('Copied. Type where the second copy goes' + (endCol !== undefined ? ' (' + b.columns[endCol] + ')' : '') + '.');
        } else if (a.dataset.a === 'spare') { (b.assign || []).forEach((ci) => { row[ci] = ''; }); dirty(); paint(); }
        else if (a.dataset.a === 'ins') { b.rows.splice(ri + 1, 0, b.columns.map(() => '')); prefill(ri + 1); dirty(); paint({ r: ri + 1, c: String(tableLayout(b).vis[0]) }); }
        else if (a.dataset.a === 'up' && ri > 0) { [b.rows[ri - 1], b.rows[ri]] = [b.rows[ri], b.rows[ri - 1]]; dirty(); paint(); }
        else if (a.dataset.a === 'down' && ri < b.rows.length - 1) { [b.rows[ri + 1], b.rows[ri]] = [b.rows[ri], b.rows[ri + 1]]; dirty(); paint(); }
        else if (a.dataset.a === 'del') { b.rows.splice(ri, 1); dirty(); paint(); }
      });
    }

    /** Rename, add and remove columns (kept out of the table so the table stays clean). */
    function columnsDialog() {
      const roleName = { box: 'Box', shared: 'Shared gear', label: 'Label on line', rf: 'Wireless link' };
      modal('<h3>Columns</h3><p>Rename, add or remove columns. How each column draws is set under Trace path.</p><div id="cl" class="tlist"></div>' +
        '<div class="acts" style="justify-content:space-between"><button type="button" class="btn" id="cadd">' + icon('plus') + 'Add column</button><button type="button" class="primary" data-close>Done</button></div>', (w) => {
        const cl = w.querySelector('#cl');
        const draw = () => {
          cl.innerHTML = b.columns.map((c, ci) => '<div class="tli"><input data-cn="' + ci + '" value="' + esc(c) + '" style="flex:1">' +
            '<span class="note" style="min-width:90px;text-align:right">' + (traceCols(b).includes(ci) ? roleName[roleOf(b, ci)] : 'Not traced') + '</span>' +
            '<button type="button" class="ghost danger" data-cx="' + ci + '" title="Remove">' + icon('x') + '</button></div>').join('');
          cl.querySelectorAll('[data-cn]').forEach((x) => x.addEventListener('input', () => { b.columns[Number(x.dataset.cn)] = x.value; dirty(); }));
          cl.querySelectorAll('[data-cx]').forEach((x) => x.addEventListener('click', async () => {
            const ci = Number(x.dataset.cx);
            if (b.columns.length <= 1) return toast('A patch list needs at least one column');
            if (b.rows.some((r) => String(r[ci] || '').trim()) && !await confirmBox('Remove the ' + (b.columns[ci] || 'column') + ' column?', 'Everything typed in it is removed too.', 'Remove', true)) return;
            b.columns.splice(ci, 1); b.rows.forEach((r) => r.splice(ci, 1));
            b.trace = b.trace.filter((i) => i !== ci).map((i) => i > ci ? i - 1 : i);
            const nr = {}; Object.entries(b.roles || {}).forEach(([k, v]) => { const n = Number(k); if (n !== ci) nr[n > ci ? n - 1 : n] = v; }); b.roles = nr;
            b.assign = (b.assign || []).filter((i) => i !== ci).map((i) => i > ci ? i - 1 : i);
            b.ok = [];
            dirty(); draw(); paint();
          }));
        };
        draw();
        w.querySelector('#cadd').addEventListener('click', () => {
          if (b.columns.length >= 12) return toast('A patch list can have up to 12 columns');
          b.columns.push('Column ' + (b.columns.length + 1)); b.rows.forEach((r) => r.push('')); dirty(); draw(); paint();
          const ins = cl.querySelectorAll('[data-cn]'); ins[ins.length - 1].select();
        });
        w.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) paint(); });
      });
    }

    /** A new row copies gear that every row shares (stage box, link, console) so you only type what changes. */
    function prefill(ri) {
      const r = b.rows[ri];
      b.columns.forEach((_, ci) => {
        if (roleOf(b, ci) === 'box' || String(r[ci] || '').trim()) return;
        const vals = new Set(b.rows.filter((x, i) => i !== ri).map((x) => String(x[ci] || '').trim()).filter(Boolean));
        if (vals.size === 1) {
          r[ci] = [...vals][0];
          const inp = host.querySelector('input[data-r="' + ri + '"][data-c="' + ci + '"]');
          if (inp) inp.value = r[ci];
        }
      });
    }

    /** Stage box setup: one row per stage box input (or output), already wired to the console. */
    function setupDialog() {
      if (b.preset === 'wireless') return wirelessDialog();
      if (b.preset === 'iem') return iemDialog();
      const out = b.preset === 'snakeout';
      const col = (name) => b.columns.findIndex((c) => keyOf(c) === keyOf(name));
      const C = out ? { mix: col('Mix'), console: col('Console'), link: col('Link'), box: col('Stage box'), port: col('Box output'), dest: col('Destination') }
        : { input: col('Input'), box: col('Stage box'), port: col('Box input'), link: col('Link'), console: col('Console') };
      if (Object.values(C).some((x) => x < 0)) return toast('This layout is missing a column. Switch to the ' + PRESETS[b.preset].title + ' layout again to reset it.', 'bad');
      const first = b.rows.find((r) => String(r[C.box] || '').trim()) || [];
      const devs = (typeof DEV !== 'undefined' && DEV.list) || [];
      const boxDev = devs.find((d) => keyOf(d.name) === keyOf(first[C.box]));
      const guess = (boxDev && (out ? boxDev.outputs : boxDev.inputs)) || (out ? 12 : 24);
      modal('<h3>' + (out ? 'Stage box outputs' : 'Stage box inputs') + '</h3><p>' + (out
        ? 'Makes one row per output on the stage box, fed from the console over the link. Then fill in the mix and where each output goes.'
        : 'Makes one row per input on the stage box, sent to the console over the link. Then fill in the source and mic for each input; empty ones stay as spares.') + ' Rows you already have are kept.</p>' +
        '<form id="sbf"><datalist id="sbdl">' + devs.map((d) => '<option value="' + esc(d.name) + '">').join('') + '</datalist>' +
        '<div class="two"><div><label for="sb_box">Stage box</label><input id="sb_box" list="sbdl" value="' + esc(first[C.box] || '') + '" placeholder="AR2412"></div>' +
        '<div><label for="sb_n">' + (out ? 'Outputs' : 'Inputs') + '</label><input id="sb_n" type="number" min="1" max="128" value="' + guess + '"></div></div>' +
        '<div class="two"><div><label for="sb_link">Link</label><input id="sb_link" value="' + esc(first[C.link] || 'SLink') + '" placeholder="SLink, Cat5e, Dante"></div>' +
        '<div><label for="sb_con">Console</label><input id="sb_con" list="sbdl" value="' + esc(first[C.console] || '') + '" placeholder="SQ-5"></div></div>' +
        (out ? '' : '<div class="two"><div><label for="sb_start">Console input for box input 1</label><input id="sb_start" type="number" min="1" max="256" value="1"></div><div></div></div>') +
        '<div class="err" id="sbe"></div><div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Make rows</button></div></form>', (w, close) => {
        const boxIn = w.querySelector('#sb_box');
        boxIn.addEventListener('change', () => {
          const d = devs.find((x) => keyOf(x.name) === keyOf(boxIn.value));
          const n = d && (out ? d.outputs : d.inputs);
          if (n) w.querySelector('#sb_n').value = n;
        });
        w.querySelector('#sbf').addEventListener('submit', (e) => {
          e.preventDefault();
          const box = boxIn.value.trim(), n = Number(w.querySelector('#sb_n').value), link = w.querySelector('#sb_link').value.trim(), con = w.querySelector('#sb_con').value.trim();
          const start = out ? 0 : Number(w.querySelector('#sb_start').value) || 1;
          if (!box || !con) { w.querySelector('#sbe').textContent = 'Enter the stage box and the console'; return; }
          if (!Number.isInteger(n) || n < 1 || n > 128) { w.querySelector('#sbe').textContent = 'Enter how many ' + (out ? 'outputs' : 'inputs') + ' (1 to 128)'; return; }
          b.rows = b.rows.filter((r) => r.some((v) => String(v || '').trim()));
          let added = 0;
          for (let i = 1; i <= n; i++) {
            let r = b.rows.find((x) => keyOf(x[C.box]) === keyOf(box) && keyOf(x[C.port]) === String(i));
            if (!r) { r = b.columns.map(() => ''); r[C.box] = box; r[C.port] = String(i); if (!out) r[C.input] = String(start + i - 1); b.rows.push(r); added++; }
            if (!String(r[C.link] || '').trim()) r[C.link] = link;
            if (!String(r[C.console] || '').trim()) r[C.console] = con;
          }
          const num = (v) => { const x = parseInt(v, 10); return Number.isNaN(x) ? 1e9 : x; };
          b.rows.sort((x, y) => keyOf(x[C.box]).localeCompare(keyOf(y[C.box])) || num(x[C.port]) - num(y[C.port]));
          close(); dirty(); paint();
          toast(added ? added + ' ' + (out ? 'output' : 'input') + (added === 1 ? '' : 's') + ' added for ' + box : 'All ' + n + ' were already there', 'ok');
        });
      });
    }

    // ---- wireless gear: shared helpers for the two dialogs below ----
    const colIx = (name) => b.columns.findIndex((c) => keyOf(c) === keyOf(name));
    const needCols = (C) => { if (Object.values(C).some((x) => x < 0)) { toast('This layout is missing a column. Switch to the ' + PRESETS[b.preset].title + ' layout again to reset it.', 'bad'); return false; } return true; };
    const rfDevs = () => (typeof DEV !== 'undefined' && DEV.list) || [];
    const catalogFor = (list, name) => { const k = keyOf(name); return list.find((g) => k && (k === keyOf(g.name) || k.startsWith(keyOf(g.name) + ' ') || k.startsWith(keyOf(g.model)))); };
    const optList = (id, extra) => '<datalist id="' + id + '">' + [...new Set([...rfDevs().map((d) => d.name), ...extra])].map((n) => '<option value="' + esc(n) + '">').join('') + '</datalist>';
    const numOr = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
    const sortRows = (by, port) => {
      const num = (v) => { const x = parseInt(v, 10); return Number.isNaN(x) ? 1e9 : x; };
      b.rows.sort((x, y) => (!String(x[by] || '').trim()) - (!String(y[by] || '').trim()) || keyOf(x[by]).localeCompare(keyOf(y[by]), undefined, { numeric: true }) || num(x[port]) - num(y[port]));
    };

    /** One row per channel of a wireless receiver, wired on to the stage box and console. Then assign a person, capsule and transmitter. */
    function wirelessDialog() {
      const C = { input: colIx('Input'), tx: colIx('Transmitter'), rx: colIx('Receiver'), ch: colIx('Rx ch'), box: colIx('Stage box'), port: colIx('Box input'), console: colIx('Console') };
      if (!needCols(C)) return;
      const last = b.rows.slice().reverse().find((r) => String(r[C.rx] || '').trim()) || [];
      modal('<h3>Add a wireless receiver</h3><p>Makes one row per receiver channel, wired on to the stage box and console. Then fill in who uses each one, the capsule, the transmitter and its frequency. Empty channels stay as spares. Rows you already have are kept.</p>' +
        '<form id="wf">' + optList('wfdl', RF_GEAR.receivers.map((g) => g.name)) +
        '<div class="two"><div><label for="w_rx">Receiver</label><input id="w_rx" list="wfdl" placeholder="SLX-D4D"></div>' +
        '<div><label for="w_n">Channels</label><input id="w_n" type="number" min="1" max="16" value="2"></div></div>' +
        '<div class="two"><div><label for="w_box">Plugs into stage box <span class="note">(optional)</span></label><input id="w_box" list="wfdl" value="' + esc(last[C.box] || '') + '" placeholder="AR2412"></div>' +
        '<div><label for="w_port">Box input for channel 1</label><input id="w_port" type="number" min="1" max="128" placeholder="optional"></div></div>' +
        '<div class="two"><div><label for="w_con">Console</label><input id="w_con" list="wfdl" value="' + esc(last[C.console] || '') + '" placeholder="SQ-5"></div>' +
        '<div><label for="w_in">Console input for channel 1</label><input id="w_in" type="number" min="1" max="256" placeholder="optional"></div></div>' +
        '<div class="err" id="we"></div><div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Make rows</button></div></form>', (w, close) => {
        const rxIn = w.querySelector('#w_rx');
        rxIn.addEventListener('change', () => {
          const d = rfDevs().find((x) => keyOf(x.name) === keyOf(rxIn.value));
          const g = catalogFor(RF_GEAR.receivers, rxIn.value) || (d && catalogFor(RF_GEAR.receivers, d.model));
          const n = (d && d.outputs) || (g && g.ch);
          if (n) w.querySelector('#w_n').value = n;
        });
        w.querySelector('#wf').addEventListener('submit', (e) => {
          e.preventDefault();
          const rx = rxIn.value.trim(), n = Number(w.querySelector('#w_n').value), box = w.querySelector('#w_box').value.trim(), con = w.querySelector('#w_con').value.trim();
          const port = numOr(w.querySelector('#w_port').value), input = numOr(w.querySelector('#w_in').value);
          if (!rx) { w.querySelector('#we').textContent = 'Enter the receiver, for example SLX-D4D'; return; }
          if (!Number.isInteger(n) || n < 1 || n > 16) { w.querySelector('#we').textContent = 'Enter how many channels it has (1 to 16)'; return; }
          b.rows = b.rows.filter((r) => r.some((v) => String(v || '').trim()));
          let added = 0;
          for (let i = 1; i <= n; i++) {
            let r = b.rows.find((x) => keyOf(x[C.rx]) === keyOf(rx) && keyOf(x[C.ch]) === String(i));
            if (!r) { r = b.columns.map(() => ''); r[C.rx] = rx; r[C.ch] = String(i); b.rows.push(r); added++; }
            const fill = (ci, v) => { if (v && !String(r[ci] || '').trim()) r[ci] = v; };
            fill(C.box, box); fill(C.port, port ? String(port + i - 1) : ''); fill(C.console, con); fill(C.input, input ? String(input + i - 1) : '');
          }
          sortRows(C.rx, C.ch);
          close(); dirty(); paint();
          toast(added ? added + ' channel' + (added === 1 ? '' : 's') + ' added for ' + rx : 'All ' + n + ' channels were already there', 'ok');
        });
      });
    }

    /** One row per in-ear transmitter, fed from the console (and stage box). Mono or stereo; stereo uses an output pair like 5/6. */
    function iemDialog() {
      const C = { mix: colIx('Mix'), console: colIx('Console'), out: colIx('Console out'), box: colIx('Stage box'), port: colIx('Box output'), tx: colIx('Transmitter'), mode: colIx('Mode') };
      if (!needCols(C)) return;
      const last = b.rows.slice().reverse().find((r) => String(r[C.tx] || '').trim()) || [];
      modal('<h3>Add in-ear transmitters</h3><p>Makes one row per transmitter, fed from the console. <b>Stereo</b> takes two outputs (5/6); <b>mono</b> takes one. Then fill in the mix, bodypack and who wears it. For a second person on the same mix, use ⋯ › Duplicate on the row. Rows you already have are kept.</p>' +
        '<form id="if">' + optList('ifdl', RF_GEAR.iem.map((g) => g.name)) +
        '<div class="two"><div><label for="i_tx">Transmitter</label><input id="i_tx" list="ifdl" placeholder="PSM300"></div>' +
        '<div><label for="i_n">How many</label><input id="i_n" type="number" min="1" max="16" value="1"></div></div>' +
        '<div class="two"><div><label for="i_mode">Mode</label><select id="i_mode"><option>Stereo</option><option>Mono</option></select></div>' +
        '<div><label for="i_con">Console</label><input id="i_con" list="ifdl" value="' + esc(last[C.console] || '') + '" placeholder="SQ-5"></div></div>' +
        '<div class="two"><div><label for="i_box">Through stage box <span class="note">(optional)</span></label><input id="i_box" list="ifdl" value="' + esc(last[C.box] || '') + '" placeholder="blank = console outputs"></div>' +
        '<div><label for="i_first">First output</label><input id="i_first" type="number" min="1" max="128" placeholder="optional"></div></div>' +
        '<p class="note" id="i_hint"></p>' +
        '<div class="err" id="ie"></div><div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Make rows</button></div></form>', (w, close) => {
        const txIn = w.querySelector('#i_tx'), mode = w.querySelector('#i_mode'), boxIn = w.querySelector('#i_box'), first = w.querySelector('#i_first'), nIn = w.querySelector('#i_n');
        const pairs = (n, start, stereo) => Array.from({ length: n }, (_, i) => (stereo ? (start + 2 * i) + '/' + (start + 2 * i + 1) : String(start + i)));
        const hint = () => {
          const n = Number(nIn.value) || 1, st = numOr(first.value), stereo = mode.value === 'Stereo';
          w.querySelector('#i_hint').textContent = st ? (boxIn.value.trim() ? boxIn.value.trim() + ' outputs ' : 'Console outputs ') + pairs(n, st, stereo).join(', ') : '';
        };
        [mode, boxIn, first, nIn].forEach((x) => x.addEventListener('input', hint));
        txIn.addEventListener('change', () => {
          const d = rfDevs().find((x) => keyOf(x.name) === keyOf(txIn.value));
          const g = catalogFor(RF_GEAR.iem, txIn.value) || (d && catalogFor(RF_GEAR.iem, d.model));
          if (g && g.tx > 1) nIn.value = g.tx;
          hint();
        });
        w.querySelector('#if').addEventListener('submit', (e) => {
          e.preventDefault();
          const tx = txIn.value.trim(), n = Number(nIn.value), con = w.querySelector('#i_con').value.trim(), box = boxIn.value.trim(), st = numOr(first.value), stereo = mode.value === 'Stereo';
          if (!tx) { w.querySelector('#ie').textContent = 'Enter the transmitter, for example PSM300'; return; }
          if (!Number.isInteger(n) || n < 1 || n > 16) { w.querySelector('#ie').textContent = 'Enter how many transmitters (1 to 16)'; return; }
          const outs = st ? pairs(n, st, stereo) : [];
          b.rows = b.rows.filter((r) => r.some((v) => String(v || '').trim()));
          let added = 0;
          for (let i = 1; i <= n; i++) {
            const name = n === 1 || i === 1 ? tx : tx + ' #' + i;
            const mine = b.rows.filter((x) => keyOf(x[C.tx]) === keyOf(name));
            if (!mine.length) { const r = b.columns.map(() => ''); r[C.tx] = name; b.rows.push(r); mine.push(r); added++; }
            for (const r of mine) {
              const fill = (ci, v) => { if (v && !String(r[ci] || '').trim()) r[ci] = v; };
              fill(C.mode, stereo ? 'Stereo' : 'Mono'); fill(C.console, con);
              if (box) { fill(C.box, box); fill(C.port, outs[i - 1] || ''); }
              else fill(C.out, outs[i - 1] || '');
            }
          }
          sortRows(C.tx, C.tx);
          close(); dirty(); paint();
          toast(added ? added + ' transmitter' + (added === 1 ? '' : 's') + ' added' : 'Those transmitters were already there', 'ok');
        });
      });
    }

    function traceDialog() {
      let order = b.trace.filter((i) => i < b.columns.length);
      b.columns.forEach((_, i) => { if (!order.includes(i)) order.push(i); });
      let on = new Set(b.trace);
      const roles = { ...(b.roles || {}) };
      modal('<h3>Wire trace path</h3><p>Pick the columns a signal passes through, in order from where it starts to where it ends. <b>Box</b>: each name comes from one place (a mic, a channel). <b>Shared gear</b>: many signals pass through it (a stage box, a console). <b>Label on line</b>: written on the wire, like a stage box input number or SLink. <b>Wireless link</b>: a frequency, drawn as a dashed radio hop and checked so no two transmitters share it.</p><div id="tl" class="tlist"></div>' +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary" id="tok">Save</button></div>', (w, close) => {
        const tl = w.querySelector('#tl');
        const draw = () => {
          tl.innerHTML = order.map((ci, k) => '<div class="tli"><label class="tog' + (on.has(ci) ? ' on' : '') + '"><input type="checkbox" data-ci="' + ci + '"' + (on.has(ci) ? ' checked' : '') + '>' + esc(b.columns[ci] || 'Column ' + (ci + 1)) + '</label>' +
            '<span class="grow"></span>' + (on.has(ci) ? '<select data-role="' + ci + '" aria-label="How it draws"><option value="box"' + (roles[ci] ? '' : ' selected') + '>Box</option><option value="shared"' + (roles[ci] === 'shared' ? ' selected' : '') + '>Shared gear</option><option value="label"' + (roles[ci] === 'label' ? ' selected' : '') + '>Label on line</option><option value="rf"' + (roles[ci] === 'rf' ? ' selected' : '') + '>Wireless link</option></select>' : '') + '<button type="button" class="ghost" data-up="' + k + '"' + (k ? '' : ' disabled') + '>' + icon('up') + '</button><button type="button" class="ghost" data-down="' + k + '"' + (k < order.length - 1 ? '' : ' disabled') + '>' + icon('down') + '</button></div>').join('');
          tl.querySelectorAll('[data-ci]').forEach((x) => x.addEventListener('change', () => { const ci = Number(x.dataset.ci); if (x.checked) on.add(ci); else on.delete(ci); draw(); }));
          tl.querySelectorAll('[data-role]').forEach((x) => x.addEventListener('change', () => { const ci = Number(x.dataset.role); if (x.value === 'box') delete roles[ci]; else roles[ci] = x.value; }));
          tl.querySelectorAll('[data-up]').forEach((x) => x.addEventListener('click', () => { const k = Number(x.dataset.up); [order[k - 1], order[k]] = [order[k], order[k - 1]]; draw(); }));
          tl.querySelectorAll('[data-down]').forEach((x) => x.addEventListener('click', () => { const k = Number(x.dataset.down); [order[k + 1], order[k]] = [order[k], order[k + 1]]; draw(); }));
        };
        draw();
        w.querySelector('#tok').addEventListener('click', () => {
          const t = order.filter((ci) => on.has(ci));
          if (t.filter((ci) => roles[ci] !== 'label' && roles[ci] !== 'rf').length === 1) return toast('Pick at least two columns that are boxes or shared gear', 'bad');
          b.trace = t;
          b.roles = {}; t.forEach((ci) => { if (roles[ci]) b.roles[ci] = roles[ci]; });
          close(); dirty(); paint();
        });
      });
    }
    paint();
    if (b._setup) { delete b._setup; setTimeout(setupDialog, 50); }
  }

  /*
   * Draw mode for a patch list. The drawing and the table are the same rows:
   * boxes are the values in each wire-trace column, a line is two of them on one row.
   */
  function drawPatch(area, panel, b, dirty, openTrace) {
    const cols = laneCols(b);                         // labels (ports, links) are written on the lines, not drawn as boxes
    if (cols.length < 2) {
      area.innerHTML = '<div class="note" style="padding:14px">Pick at least two columns for the wire trace first (for example Source → Stage box → Ch).</div>';
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn'; btn.textContent = 'Trace path'; btn.style.margin = '0 14px 14px';
      btn.addEventListener('click', openTrace); area.appendChild(btn);
      return;
    }
    const CW = 168, GX = 76, NH = 36, GY = 10, TOP = 34;
    const key = (v) => String(v || '').trim().toLowerCase();
    let sel = null, pending = null;
    if (typeof loadDevices === 'function') loadDevices().then(() => { const dl = area.querySelector('datalist'); if (dl && DEV.list) dl.innerHTML = DEV.list.map((d) => '<option value="' + esc(d.name) + '">').join(''); });
    const dlId = 'pdl-' + Math.random().toString(36).slice(2, 8);

    function model() {
      const nodes = cols.map(() => new Map());
      const edges = [];
      b.rows.forEach((r, ri) => {
        if (isSpare(b, r)) return;                    // spare stage box inputs wait in the table until something is connected
        const present = [];
        cols.forEach((ci, k) => {
          const v = String(r[ci] || '').trim();
          if (!v) return;
          const kk = key(v);
          if (!nodes[k].has(kk)) nodes[k].set(kk, { k, key: kk, label: v, rows: [], i: nodes[k].size });
          nodes[k].get(kk).rows.push(ri);
          present.push({ k, key: kk });
        });
        for (let j = 1; j < present.length; j++) edges.push({ r: ri, a: present[j - 1], z: present[j], label: labelsBetween(b, r, cols[present[j - 1].k], cols[present[j].k]).join(' · '), rf: rfBetween(b, r, cols[present[j - 1].k], cols[present[j].k]) });
      });
      return { nodes, edges };
    }
    const cx = (k) => k * (CW + GX);
    const cy = (i) => TOP + i * (NH + GY);

    function tidy() {
      // drop empty rows, and lone single-cell rows whose value already shows on another row
      b.rows = b.rows.filter((r) => r.some((v) => String(v || '').trim()));
      b.rows = b.rows.filter((r, ri) => {
        const filled = b.columns.map((_, ci) => ci).filter((ci) => String(r[ci] || '').trim());
        if (filled.length !== 1 || !cols.includes(filled[0])) return true;
        const ci = filled[0], v = key(r[ci]);
        return !b.rows.some((o, oi) => oi !== ri && key(o[ci]) === v && o.filter((x) => String(x || '').trim()).length > 1);
      });
    }

    function connect(a, z) {
      if (a.k === z.k) return toast('Connect boxes in different columns');
      if (a.k > z.k) [a, z] = [z, a];
      const ca = cols[a.k], cz = cols[z.k];
      const m = model();
      const la = m.nodes[a.k].get(a.key).label, lz = m.nodes[z.k].get(z.key).label;
      const between = (r) => cols.slice(a.k + 1, z.k).every((ci) => !String(r[ci] || '').trim());
      let ri = b.rows.findIndex((r) => key(r[ca]) === a.key && key(r[cz]) === z.key);
      if (ri >= 0) { toast('Those are already connected'); sel = { type: 'wire', r: ri, a, z }; return draw(); }
      // a spare stage box input or output comes first: connecting a source to the AR2412 takes its next free input
      ri = b.rows.findIndex((r) => isSpare(b, r) && between(r) && ((key(r[cz]) === z.key && !String(r[ca] || '').trim()) || (key(r[ca]) === a.key && !String(r[cz] || '').trim())));
      if (ri < 0) ri = b.rows.findIndex((r) => key(r[ca]) === a.key && !String(r[cz] || '').trim() && between(r) && cols.slice(z.k + 1).every((ci) => !String(r[ci] || '').trim()));
      if (ri < 0) ri = b.rows.findIndex((r) => key(r[cz]) === z.key && !String(r[ca] || '').trim() && between(r) && cols.slice(0, a.k).every((ci) => !String(r[ci] || '').trim()));
      if (ri >= 0 && isSpare(b, b.rows[ri])) { const port = labelsBetween(b, b.rows[ri], ca, cz)[0]; if (port) toast(la + ' is on ' + lz + ' ' + port.toLowerCase().replace(/^(\d)/, 'input $1') + '. Tap the line to change it.'); }
      if (ri < 0) {
        // extend a lone box row on either side, otherwise start a new row
        ri = b.rows.findIndex((r) => key(r[ca]) === a.key && r.filter((x) => String(x || '').trim()).length === 1);
        if (ri < 0) ri = b.rows.findIndex((r) => key(r[cz]) === z.key && r.filter((x) => String(x || '').trim()).length === 1);
      }
      if (ri < 0) { b.rows.push(b.columns.map(() => '')); ri = b.rows.length - 1; }
      b.rows[ri][ca] = la; b.rows[ri][cz] = lz;
      tidy();
      ri = b.rows.findIndex((r) => key(r[ca]) === a.key && key(r[cz]) === z.key);
      sel = { type: 'wire', r: ri, a, z };
      dirty(); draw();
    }

    function disconnect(ri, z) {
      const r = b.rows[ri];
      const after = b.columns.map(() => '');
      cols.forEach((ci, k) => { if (k >= z.k) { after[ci] = r[ci]; r[ci] = ''; } });
      b.rows.splice(ri + 1, 0, after);
      tidy(); sel = null; dirty(); draw();
    }

    let dups = dupInfo(b);
    const dupKind = (k, n) => { let kind = ''; n.rows.forEach((ri) => { const d = dups.cells.get(ri + ':' + cols[k]); if (d && (d.kind === 'clash' || !kind)) kind = d.kind; }); return kind; };
    function draw() {
      dups = dupInfo(b);
      const { nodes, edges } = model();
      const maxN = Math.max(1, ...nodes.map((n) => n.size)) + 1;
      const W = cols.length * CW + (cols.length - 1) * GX, H = cy(maxN) + 10;
      const path = (e) => {
        const na = nodes[e.a.k].get(e.a.key), nz = nodes[e.z.k].get(e.z.key);
        const x1 = cx(e.a.k) + CW, y1 = cy(na.i) + NH / 2, x2 = cx(e.z.k), y2 = cy(nz.i) + NH / 2, mx = (x2 - x1) / 2;
        return 'M' + x1 + ' ' + y1 + 'C' + (x1 + mx) + ' ' + y1 + ' ' + (x2 - mx) + ' ' + y2 + ' ' + x2 + ' ' + y2;
      };
      const isSelW = (e) => sel && sel.type === 'wire' && sel.r === e.r && sel.a.k === e.a.k && sel.z.k === e.z.k;
      const isSelN = (n) => sel && sel.type === 'node' && sel.k === n.k && sel.key === n.key;
      area.style.width = W + 'px'; area.style.height = H + 'px';
      area.innerHTML = '<datalist id="' + dlId + '">' + (typeof DEV !== 'undefined' && DEV.list ? DEV.list.map((d) => '<option value="' + esc(d.name) + '">').join('') : '') + '</datalist>' +
        cols.map((ci, k) => '<div class="pdh" style="left:' + cx(k) + 'px;width:' + CW + 'px">' + esc(b.columns[ci]) + '</div>').join('') +
        '<svg class="pdw" width="' + W + '" height="' + H + '"><g>' + edges.map((e) => {
          const nz = nodes[e.z.k].get(e.z.key);
          return '<g class="pw' + (isSelW(e) ? ' sel' : '') + '" data-r="' + e.r + '" data-a="' + e.a.k + '" data-z="' + e.z.k + '"><path class="hit" d="' + path(e) + '"/><path class="ln' + (e.rf ? ' rf' : '') + '" d="' + path(e) + '"/>' +
            (e.label ? '<text x="' + (cx(e.z.k) - 6) + '" y="' + (cy(nz.i) + NH / 2 - 5) + '" text-anchor="end">' + esc(e.label.length > 14 ? e.label.slice(0, 13) + '…' : e.label) + '</text>' : '') + '</g>';
        }).join('') +
        '</g><path class="tmp" d=""/></svg>' +
        nodes.map((m, k) => [...m.values()].map((n) => '<div class="pn' + (dupKind(k, n) ? ' d' + dupKind(k, n) : '') + (isSelN(n) ? ' sel' : '') + (pending && pending.k === n.k && pending.key === n.key ? ' pend' : '') + '" data-k="' + k + '" data-key="' + esc(n.key) + '" style="left:' + cx(k) + 'px;top:' + cy(n.i) + 'px;width:' + CW + 'px;height:' + NH + 'px">' +
          '<span class="pl">' + esc(n.label) + '</span>' + (n.rows.length > 1 ? '<em>' + n.rows.length + '</em>' : '') + '<b class="hd" title="Drag to connect" aria-label="Connect from ' + esc(n.label) + '"></b></div>').join('') +
          '<button type="button" class="padd" data-k="' + k + '" style="left:' + cx(k) + 'px;top:' + cy(m.size) + 'px;width:' + CW + 'px">+ Add ' + esc(b.columns[cols[k]]) + '</button>').join('');
      showPanel(nodes);
    }

    function showPanel(nodes) {
      if (!sel) { panel.innerHTML = ''; return; }
      if (sel.type === 'wire') {
        const r = b.rows[sel.r];
        if (!r) { sel = null; panel.innerHTML = ''; return; }
        panel.innerHTML = '<div class="pdp"><div class="pdph"><b>' + esc(r[cols[sel.a.k]] || '') + ' → ' + esc(r[cols[sel.z.k]] || '') + '</b><span class="note">Row ' + (sel.r + 1) + '</span></div>' +
          '<div class="pdf">' + b.columns.map((c, ci) => '<label>' + esc(c) + '<input data-ci="' + ci + '" value="' + esc(r[ci] || '') + '"' + (cols.includes(ci) ? ' list="' + dlId + '"' : '') + '></label>').join('') + '</div>' +
          '<div class="acts" style="justify-content:flex-start;margin-top:8px"><button type="button" class="btn" data-disc>Disconnect</button><button type="button" class="btn danger" data-rowdel>Delete row</button></div></div>';
        panel.querySelectorAll('[data-ci]').forEach((x) => x.addEventListener('change', () => {
          const ci = Number(x.dataset.ci), r = b.rows[sel.r];
          r[ci] = x.value.trim();
          if (cols[sel.a.k] === ci) sel.a.key = key(r[ci]);
          if (cols[sel.z.k] === ci) sel.z.key = key(r[ci]);
          tidy(); sel.r = b.rows.indexOf(r); if (sel.r < 0) sel = null; dirty(); draw();
        }));
        panel.querySelector('[data-disc]').addEventListener('click', () => disconnect(sel.r, sel.z));
        panel.querySelector('[data-rowdel]').addEventListener('click', () => { b.rows.splice(sel.r, 1); tidy(); sel = null; dirty(); draw(); });
      } else {
        const n = nodes[sel.k] && nodes[sel.k].get(sel.key);
        if (!n) { sel = null; panel.innerHTML = ''; return; }
        const ci = cols[sel.k];
        const dk = dupKind(sel.k, n), okKey = ci + ':' + sel.key;
        panel.innerHTML = '<div class="pdp"><div class="pdph"><b>' + esc(b.columns[ci]) + '</b><span class="note">' + n.rows.length + ' row' + (n.rows.length === 1 ? '' : 's') + '</span></div>' +
          (dk === 'double' ? '<div class="dupnote double">Double patch: the same source goes to ' + n.rows.length + ' places. That is fine.</div>' : '') +
          (dk === 'clash' || dk === 'ok' ? '<div class="dupnote ' + dk + '">' + (dk === 'clash' ? 'Used by ' + n.rows.length + ' different ' + (b.preset === 'cable' ? 'cables' : 'sources') + '. Rename one (for example “' + esc(n.label) + ' #2”) if they are separate, or mark it as intended.' : 'Used more than once, marked as intended.') +
            '<label class="tog' + (dk === 'ok' ? ' on' : '') + '" style="margin-top:6px"><input type="checkbox" data-ok' + (dk === 'ok' ? ' checked' : '') + '> Intended</label></div>' : '') +
          '<div class="pdf"><label>Name<input data-rename value="' + esc(n.label) + '" list="' + dlId + '"></label></div>' +
          '<div class="acts" style="justify-content:flex-start;margin-top:8px"><button type="button" class="btn" data-from>Connect from here</button><button type="button" class="btn danger" data-ndel>Remove box</button></div></div>';
        const inp = panel.querySelector('[data-rename]');
        inp.addEventListener('change', () => {
          const v = inp.value.trim();
          if (!v) return;
          b.rows.forEach((r) => { if (key(r[ci]) === sel.key) r[ci] = v; });
          sel = { type: 'node', k: sel.k, key: key(v) }; tidy(); dirty(); draw();
        });
        const okBox = panel.querySelector('[data-ok]');
        if (okBox) okBox.addEventListener('change', () => { b.ok = (b.ok || []).filter((k) => k !== okKey); if (okBox.checked) b.ok.push(okKey); dirty(); draw(); });
        panel.querySelector('[data-from]').addEventListener('click', () => { pending = { k: sel.k, key: sel.key }; toast('Now tap the box to connect to'); draw(); });
        panel.querySelector('[data-ndel]').addEventListener('click', () => {
          b.rows.forEach((r) => { if (key(r[ci]) === sel.key) r[ci] = ''; });
          tidy(); sel = null; dirty(); draw();
        });
      }
    }

    // ---- pointer: drag from a dot to a box, or tap dot then box ----
    let drag = null;
    const local = (e) => { const r = area.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    area.addEventListener('pointerdown', (e) => {
      const hd = e.target.closest('.hd');
      if (!hd) return;
      e.preventDefault();
      const pn = hd.closest('.pn');
      drag = { k: Number(pn.dataset.k), key: pn.dataset.key, moved: false, x0: e.clientX, y0: e.clientY };
      area.setPointerCapture(e.pointerId);
    });
    area.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 6) drag.moved = true;
      if (!drag.moved) return;
      const pn = area.querySelector('.pn[data-k="' + drag.k + '"][data-key="' + CSS.escape(drag.key) + '"]');
      const x1 = pn.offsetLeft + CW, y1 = pn.offsetTop + NH / 2;
      const [x2, y2] = local(e);
      area.querySelector('.tmp').setAttribute('d', 'M' + x1 + ' ' + y1 + 'C' + (x1 + 40) + ' ' + y1 + ' ' + (x2 - 40) + ' ' + y2 + ' ' + x2 + ' ' + y2);
      area.querySelectorAll('.pn.drop').forEach((x) => x.classList.remove('drop'));
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const tgt = over && over.closest && over.closest('.pn');
      if (tgt && Number(tgt.dataset.k) !== drag.k) tgt.classList.add('drop');
    });
    area.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      area.querySelector('.tmp').setAttribute('d', '');
      if (!d.moved) { pending = pending && pending.k === d.k && pending.key === d.key ? null : { k: d.k, key: d.key }; sel = null; draw(); return; }
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const tgt = over && over.closest && over.closest('.pn');
      if (tgt && area.contains(tgt)) connect({ k: d.k, key: d.key }, { k: Number(tgt.dataset.k), key: tgt.dataset.key });
      else draw();
    });
    area.addEventListener('click', (e) => {
      if (e.target.closest('.hd')) return;
      const pn = e.target.closest('.pn');
      if (pn) {
        const n = { k: Number(pn.dataset.k), key: pn.dataset.key };
        if (pending && !(pending.k === n.k && pending.key === n.key)) { const p = pending; pending = null; connect(p, n); return; }
        pending = null; sel = { type: 'node', k: n.k, key: n.key }; draw(); return;
      }
      const w = e.target.closest('.pw');
      if (w) {
        const ri = Number(w.dataset.r), r = b.rows[ri];
        sel = { type: 'wire', r: ri, a: { k: Number(w.dataset.a), key: key(r[cols[Number(w.dataset.a)]]) }, z: { k: Number(w.dataset.z), key: key(r[cols[Number(w.dataset.z)]]) } };
        pending = null; draw(); return;
      }
      const add = e.target.closest('.padd');
      if (add) {
        const k = Number(add.dataset.k);
        const inp = document.createElement('input');
        inp.className = 'padd-in'; inp.style.cssText = add.style.cssText; inp.setAttribute('list', dlId);
        inp.placeholder = b.columns[cols[k]] + ' name';
        add.replaceWith(inp); inp.focus();
        let finished = false;
        const done = (ok) => {
          if (finished) return; finished = true;
          const v = inp.value.trim();
          if (ok && v) {
            const m = model();
            if (m.nodes[k].has(key(v))) toast('That box is already there');
            else { const row = b.columns.map(() => ''); row[cols[k]] = v; b.rows.push(row); dirty(); }
            sel = { type: 'node', k, key: key(v) };
          }
          draw();
        };
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); done(true); } if (ev.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(true));
        return;
      }
      if (e.target === area || e.target.closest('svg')) { sel = null; pending = null; draw(); }
    });
    draw();
  }

  function editIplist(host, b, dirty) {
    if (!b.net) b.net = { name: '', vlan: '', cidr: '', gateway: '' };
    if (!Array.isArray(b.rows)) b.rows = [];
    const blank = () => ({ ip: '', device: '', mac: '', location: '', notes: '' });
    const ensureBlank = () => { const l = b.rows[b.rows.length - 1]; if (!l || Object.values(l).some((v) => String(v || '').trim())) b.rows.push(blank()); };
    const refresh = () => {
      const a = analyze(b);
      host.querySelectorAll('tbody tr').forEach((tr, i) => {
        const st = a.rowState[i] || { cls: '', msg: '' };
        const ip = tr.querySelector('input[data-c=ip]');
        ip.classList.toggle('bad', st.cls === 'bad'); ip.classList.toggle('warn', st.cls === 'warn');
        ip.title = st.msg;
        tr.querySelector('.ipmsg').textContent = st.msg;
      });
      const snOk = !!a.sn;
      const sEl = host.querySelector('.ipstats');
      sEl.textContent = snOk ? a.sn.text + ' · ' + a.used.size + ' used · ' + a.free + ' free' + (a.problems ? ' · ' + a.problems + ' problem' + (a.problems === 1 ? '' : 's') : '')
        : (b.net.cidr ? 'Enter the subnet like 10.10.20.0/24' : 'Add the subnet to check addresses and find free ones');
      sEl.classList.toggle('bad', !!b.net.cidr && !snOk);
      host.querySelectorAll('[data-needsn]').forEach((x) => { x.disabled = !snOk; });
    };
    const paint = (focus) => {
      ensureBlank();
      host.innerHTML = '<input class="full" data-f="title" placeholder="List name, e.g. AVL network" value="' + esc(b.title || '') + '">' +
        '<div class="vpick hide"><select data-vpick aria-label="Use a VLAN"><option value="">Fill in from a VLAN…</option></select></div>' +
        '<div class="netf"><label>Network<input data-n="name" placeholder="AVL" value="' + esc(b.net.name) + '"></label><label>VLAN<input data-n="vlan" placeholder="20" inputmode="numeric" value="' + esc(b.net.vlan) + '"></label>' +
        '<label>Subnet<input data-n="cidr" class="mono" placeholder="10.10.20.0/24" inputmode="decimal" autocapitalize="off" value="' + esc(b.net.cidr) + '"></label>' +
        '<label>Gateway<input data-n="gateway" class="mono" placeholder="10.10.20.1" inputmode="decimal" value="' + esc(b.net.gateway) + '"></label></div>' +
        '<div class="note ipstats"></div>' +
        '<div class="tscroll"><table class="gedit"><thead><tr>' + IP_FIELDS.map((f) => '<th>' + f[1] + '</th>').join('') + '<th class="rt"></th></tr></thead><tbody>' +
        b.rows.map((r, ri) => '<tr>' + IP_FIELDS.map((f) => '<td><input data-r="' + ri + '" data-c="' + f[0] + '" value="' + esc(r[f[0]] || '') + '"' +
          (f[0] === 'ip' || f[0] === 'mac' ? ' class="mono" autocapitalize="off" spellcheck="false"' : '') + (f[0] === 'ip' ? ' inputmode="decimal"' : '') + '>' + (f[0] === 'ip' ? '<div class="ipmsg"></div>' : '') + '</td>').join('') +
          '<td class="rt"><button type="button" class="ghost" data-rdel="' + ri + '" title="Remove">' + icon('x') + '</button></td></tr>').join('') +
        '</tbody></table></div>' +
        '<div class="adder" style="padding:8px 0 4px"><button type="button" class="btn" data-radd>' + icon('plus') + 'Row</button>' +
        '<button type="button" class="btn" data-next data-needsn>Next free IP</button><button type="button" class="btn" data-range data-needsn>Fill a range</button><button type="button" class="btn" data-sort>Sort by IP</button></div>';
      host.querySelector('[data-f=title]').addEventListener('input', (e) => { b.title = e.target.value; dirty(); });
      host.querySelectorAll('[data-n]').forEach((f) => f.addEventListener('input', () => { b.net[f.dataset.n] = f.value.trim(); dirty(); refresh(); }));
      if (typeof vlanList === 'function') vlanList().then((vl) => {
        const sel = host.querySelector('[data-vpick]');
        if (!sel || !vl.length) return;
        sel.innerHTML += vl.map((v) => '<option value="' + v.id + '">VLAN ' + v.vid + ' · ' + esc(v.name) + (v.cidr ? ' · ' + esc(v.cidr) : '') + '</option>').join('');
        sel.parentNode.classList.remove('hide');
        sel.addEventListener('change', () => {
          const v = vl.find((x) => String(x.id) === sel.value);
          if (!v) return;
          b.net = { name: v.name, vlan: String(v.vid), cidr: v.cidr, gateway: v.gateway };
          if (!b.title) b.title = v.name + ' network';
          dirty(); paint();
        });
      });
      host.querySelectorAll('input[data-r]').forEach((f) => f.addEventListener('input', () => {
        b.rows[Number(f.dataset.r)][f.dataset.c] = f.value; dirty();
        if (Number(f.dataset.r) === b.rows.length - 1 && f.value) { b.rows.push(blank()); paint({ r: f.dataset.r, c: f.dataset.c, keep: f.selectionStart }); return; }
        refresh();
      }));
      gridKeys(host.querySelector('.gedit'), (c) => { b.rows.push(blank()); paint({ r: b.rows.length - 1, c }); });
      host.querySelectorAll('[data-rdel]').forEach((x) => x.addEventListener('click', () => { b.rows.splice(Number(x.dataset.rdel), 1); dirty(); paint(); }));
      host.querySelector('[data-radd]').addEventListener('click', () => { const r = b.rows.length - 1; paint({ r, c: 'ip' }); });
      host.querySelector('[data-next]').addEventListener('click', () => {
        const ip = nextFree(b);
        if (!ip) return toast('No free addresses left in this subnet', 'bad');
        const at = b.rows.length - 1;
        b.rows[at] = { ...blank(), ip };
        dirty(); paint({ r: at, c: 'device' });
      });
      host.querySelector('[data-range]').addEventListener('click', () => rangeDialog());
      host.querySelector('[data-sort]').addEventListener('click', () => {
        const key = (r) => { const n = ipInt(r.ip); return n === null ? Infinity : n; };
        b.rows = b.rows.filter((r) => Object.values(r).some((v) => String(v || '').trim())).sort((x, y) => key(x) - key(y));
        dirty(); paint();
      });
      refresh();
      if (focus) {
        const f = host.querySelector('input[data-r="' + focus.r + '"][data-c="' + focus.c + '"]');
        if (f) { f.focus(); if (focus.keep !== undefined) try { f.setSelectionRange(focus.keep, focus.keep); } catch (e) { /* number inputs */ } }
      }
    };
    function rangeDialog() {
      const a = analyze(b);
      const pre = intIp(a.sn.net).split('.').slice(0, 3).join('.') + '.';
      modal('<h3>Fill a range</h3><p>Adds a row for every address in the range that is not listed yet, ready for device names. Subnet ' + esc(a.sn.text) + '.</p>' +
        '<form id="rf"><label for="rfrom">From</label><input id="rfrom" class="mono" inputmode="decimal" value="' + esc(pre + '10') + '">' +
        '<label for="rto">To</label><input id="rto" class="mono" inputmode="decimal" value="' + esc(pre + '50') + '"><div class="err" id="rerr"></div>' +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Add rows</button></div></form>', (w, close) => {
        w.querySelector('#rf').addEventListener('submit', (e) => {
          e.preventDefault();
          const fix = (v) => /^\d{1,3}$/.test(v.trim()) ? pre + v.trim() : v.trim();
          const from = ipInt(fix(w.querySelector('#rfrom').value)), to = ipInt(fix(w.querySelector('#rto').value));
          const err = (m) => { w.querySelector('#rerr').textContent = m; };
          if (from === null || to === null) return err('Enter two IP addresses (or just the last number, like 10 and 50)');
          if (to < from) return err('The range runs backwards');
          if (from < a.sn.first || to > a.sn.last) return err('Keep the range inside ' + intIp(a.sn.first) + ' – ' + intIp(a.sn.last));
          if (to - from > 255) return err('Fill at most 256 addresses at a time');
          const have = new Set(b.rows.map((r) => ipInt(r.ip)).filter((n) => n !== null));
          const gw = ipInt(b.net.gateway);
          b.rows = b.rows.filter((r) => Object.values(r).some((v) => String(v || '').trim()));
          let added = 0;
          for (let n = from; n <= to; n++) if (!have.has(n) && n !== gw) { b.rows.push({ ...blank(), ip: intIp(n) }); added++; }
          if (b.rows.length > 1024) { b.rows = b.rows.slice(0, 1024); toast('An IP list holds at most 1024 addresses', 'bad'); }
          const key = (r) => { const n = ipInt(r.ip); return n === null ? Infinity : n; };
          b.rows.sort((x, y) => key(x) - key(y));
          close(); dirty(); paint(); toast(added + ' address' + (added === 1 ? '' : 'es') + ' added', 'ok');
        });
      });
    }
    paint();
  }

  function render(b, live) {
    if (b.type === 'checklist') return checklistShell(b, live);
    if (b.type === 'patch') return patchView(b);
    if (b.type === 'iplist') return ipView(b);
    return '';
  }

  function wire(root, page, live) {
    if (live) wireChecklists(root, page.id);
    wirePatch(root, page.blocks);
    if (live && can('editor')) root.querySelectorAll('.patch[data-pid] .ph').forEach((ph) => {
      const a = document.createElement('a');
      a.className = 'btn ghost pdedit'; a.href = '#/p/' + page.id + '/edit?draw=' + ph.parentNode.dataset.pid; a.innerHTML = icon('edit') + 'Draw';
      ph.appendChild(a);
    });
  }

  return { render, wire, editChecklist, editPatch, editIplist, PRESETS, RF_GEAR, describe, analyze, ipInt, traceSvg, dupInfo, chainText };
})();
