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
    output: { title: 'Output patch', columns: ['Out', 'Destination', 'Type', 'Notes'], trace: [0, 1] },
    cable: { title: 'Cable runs', columns: ['Label', 'From', 'To', 'Type', 'Length', 'Route'], trace: [1, 0, 2] },
    custom: { title: 'Patch list', columns: ['Column 1', 'Column 2', 'Column 3'], trace: [0, 1, 2] }
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
  function traceSvg(b) {
    const cols = (b.trace || []).filter((i) => i < b.columns.length);
    if (cols.length < 2) return '';
    const colW = 150, gapX = 54, padX = 8, top = 46, nodeH = 32, gapY = 10;
    const nodes = cols.map(() => new Map());
    const paths = [];
    b.rows.forEach((row, ri) => {
      const pts = [];
      cols.forEach((ci, k) => {
        const v = String(row[ci] || '').trim();
        if (!v) return;
        let n = nodes[k].get(v.toLowerCase());
        if (!n) { n = { label: isNum(v) ? b.columns[ci] + ' ' + v : v, i: nodes[k].size, rows: [] }; nodes[k].set(v.toLowerCase(), n); }
        n.rows.push(ri);
        pts.push([k, n]);
      });
      paths.push(pts);
    });
    const maxN = Math.max(1, ...nodes.map((m) => m.size));
    const W = padX * 2 + cols.length * colW + (cols.length - 1) * gapX;
    const H = top + maxN * (nodeH + gapY) + 6;
    const cx = (k) => padX + k * (colW + gapX);
    const cy = (n) => top + n.i * (nodeH + gapY);
    const cut = (s) => s.length > 19 ? s.slice(0, 18) + '…' : s;
    let edges = '';
    paths.forEach((pts, ri) => {
      for (let j = 1; j < pts.length; j++) {
        const [k1, a] = pts[j - 1], [k2, z] = pts[j];
        const x1 = cx(k1) + colW, y1 = cy(a) + nodeH / 2, x2 = cx(k2), y2 = cy(z) + nodeH / 2, mx = (x2 - x1) / 2;
        edges += '<path class="te" data-r="' + ri + '" d="M' + x1 + ' ' + y1 + 'C' + (x1 + mx) + ' ' + y1 + ' ' + (x2 - mx) + ' ' + y2 + ' ' + x2 + ' ' + y2 + '"/>';
      }
    });
    let boxes = '';
    nodes.forEach((m, k) => m.forEach((n) => {
      boxes += '<g class="tn" data-rows="' + n.rows.join(',') + '"><title>' + esc(n.label) + ' · ' + n.rows.length + ' connection' + (n.rows.length === 1 ? '' : 's') + '</title>' +
        '<rect x="' + cx(k) + '" y="' + cy(n) + '" width="' + colW + '" height="' + nodeH + '" rx="7"/><text x="' + (cx(k) + 10) + '" y="' + (cy(n) + nodeH / 2 + 4.5) + '">' + esc(cut(n.label)) + '</text>' +
        (n.rows.length > 1 ? '<text class="cnt" x="' + (cx(k) + colW - 9) + '" y="' + (cy(n) + nodeH / 2 + 4) + '" text-anchor="end">' + n.rows.length + '</text>' : '') + '</g>';
    }));
    const heads = cols.map((ci, k) => '<text class="th" x="' + (cx(k) + 2) + '" y="22">' + esc(b.columns[ci].toUpperCase()) + '</text>' +
      (k ? '<path class="ta" d="M' + (cx(k) - gapX / 2 - 6) + ' 17l6 0m-3 -3l3 3l-3 3"/>' : '')).join('');
    return '<svg class="trace" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Wire trace">' + heads + '<g class="tes">' + edges + '</g>' + boxes + '</svg>';
  }

  function chainText(b, ri) {
    const cols = (b.trace || []).filter((i) => i < b.columns.length);
    return cols.map((ci) => { const v = String(b.rows[ri][ci] || '').trim(); return v ? (isNum(v) ? b.columns[ci] + ' ' + v : v) : null; }).filter(Boolean).join(' → ');
  }

  function patchView(b) {
    const title = b.title || (PRESETS[b.preset] || PRESETS.custom).title;
    const svg = traceSvg(b);
    const table = b.rows.length
      ? '<div class="tscroll"><table class="grid"><thead><tr>' + b.columns.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
        b.rows.map((r, ri) => '<tr data-r="' + ri + '">' + b.columns.map((_, ci) => '<td>' + esc(r[ci] || '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'
      : '<div class="note">No rows yet.</div>';
    return '<div class="patch blockbox" data-pid="' + esc(b.id || '') + '"><div class="ph"><b>' + esc(title) + '</b><span class="note">' + b.rows.length + ' row' + (b.rows.length === 1 ? '' : 's') + '</span>' +
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
        svg.querySelectorAll('.te').forEach((p) => p.classList.toggle('on', set.has(Number(p.dataset.r))));
        svg.querySelectorAll('.tn').forEach((g) => g.classList.toggle('on', g.dataset.rows.split(',').some((r) => set.has(Number(r)))));
        if (!info) return;
        if (!set.size) { info.textContent = 'Tap a box or a line to follow it.'; return; }
        const lines = rows.slice(0, 8).map((r) => '<div>' + esc(chainText(b, r)) + '</div>').join('') + (rows.length > 8 ? '<div>and ' + (rows.length - 8) + ' more</div>' : '');
        info.innerHTML = (label ? '<b>' + esc(label) + '</b> · ' + rows.length + ' connection' + (rows.length === 1 ? '' : 's') : '') + lines;
      };
      let current = '';
      el.querySelectorAll('.pv button').forEach((x) => x.addEventListener('click', () => show(x.dataset.v)));
      el.querySelectorAll('.pt tr[data-r]').forEach((tr) => tr.addEventListener('click', () => {
        if (!svg) return;
        show('trace'); current = 'r' + tr.dataset.r; highlight([Number(tr.dataset.r)]);
      }));
      if (svg) svg.addEventListener('click', (e) => {
        const g = e.target.closest('.tn'), p = e.target.closest('.te');
        let key = '', rows = [], label = '';
        if (g) { key = 'n' + g.dataset.rows; rows = g.dataset.rows.split(',').map(Number); label = g.querySelector('title').textContent.split(' · ')[0]; }
        else if (p) { key = 'r' + p.dataset.r; rows = [Number(p.dataset.r)]; }
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
    const ensureBlank = () => { if (!b.rows.length || b.rows[b.rows.length - 1].some((v) => String(v || '').trim())) b.rows.push(b.columns.map(() => '')); };
    const paint = (focus) => {
      const traceTxt = b.trace.filter((i) => i < b.columns.length).map((i) => b.columns[i] || '?').join(' → ') || 'not set';
      const top = '<div class="prow"><input class="full grow" data-f="title" placeholder="' + esc((PRESETS[b.preset] || PRESETS.custom).title) + '" value="' + esc(b.title || '') + '">' +
        '<select data-preset aria-label="Layout">' + Object.keys(PRESETS).map((k) => '<option value="' + k + '"' + (k === b.preset ? ' selected' : '') + '>' + PRESETS[k].title + ' layout</option>').join('') + '</select>' +
        '<div class="seg pmode"><button type="button" data-pm="table"' + (b._view !== 'draw' ? ' class="on"' : '') + '>Table</button><button type="button" data-pm="draw"' + (b._view === 'draw' ? ' class="on"' : '') + '>Draw</button></div></div>';
      if (b._view === 'draw') {
        b.rows = b.rows.filter((r) => r.some((v) => String(v || '').trim()));
        host.innerHTML = top + '<div class="pdhelp note">Drag from the dot on a box to another box to connect them, or tap the dot and then the box. Tap a line or box to edit it. Everything you draw is a row in the table.</div>' +
          '<div class="tscroll pdscroll"><div class="pdraw"></div></div><div class="pdpanel"></div>' +
          '<div class="adder" style="padding:8px 0 4px"><span class="note grow">Wire trace: ' + esc(traceTxt) + '</span><button type="button" class="btn" data-trace>Trace path</button></div>';
        wireTop();
        host.querySelector('[data-trace]').addEventListener('click', () => traceDialog());
        drawPatch(host.querySelector('.pdraw'), host.querySelector('.pdpanel'), b, dirty, traceDialog);
        return;
      }
      ensureBlank();
      host.innerHTML = top + '<div class="tscroll"><table class="gedit"><thead><tr><th class="rn">#</th>' +
        b.columns.map((c, ci) => '<th><div class="colh"><input data-col="' + ci + '" value="' + esc(c) + '" aria-label="Column name"><button type="button" class="ghost" data-cdel="' + ci + '" title="Remove column">' + icon('x') + '</button></div></th>').join('') +
        '<th class="rt"><button type="button" class="ghost" data-cadd title="Add column">' + icon('plus') + '</button></th></tr></thead><tbody>' +
        b.rows.map((r, ri) => '<tr><td class="rn">' + (ri + 1) + '</td>' + b.columns.map((_, ci) => '<td><input data-r="' + ri + '" data-c="' + ci + '" value="' + esc(r[ci] || '') + '"></td>').join('') +
          '<td class="rt"><button type="button" class="ghost" data-rup="' + ri + '" title="Move up"' + (ri ? '' : ' disabled') + '>' + icon('up') + '</button><button type="button" class="ghost" data-rdel="' + ri + '" title="Remove row">' + icon('x') + '</button></td></tr>').join('') +
        '</tbody></table></div>' +
        '<div class="adder" style="padding:8px 0 4px"><button type="button" class="btn" data-radd>' + icon('plus') + 'Row</button><button type="button" class="btn" data-paste>Paste rows</button>' +
        '<span class="note grow">Wire trace: ' + esc(traceTxt) + '</span><button type="button" class="btn" data-trace>Trace path</button></div>' +
        '<div class="mdhelp">Enter moves down a row. Paste rows straight from a spreadsheet.</div>';
      wireTop();
      host.querySelectorAll('[data-col]').forEach((f) => f.addEventListener('input', () => { b.columns[Number(f.dataset.col)] = f.value; dirty(); }));
      host.querySelectorAll('input[data-r]').forEach((f) => f.addEventListener('input', () => {
        b.rows[Number(f.dataset.r)][Number(f.dataset.c)] = f.value; dirty();
        if (Number(f.dataset.r) === b.rows.length - 1 && f.value) { b.rows.push(b.columns.map(() => '')); appendRow(); }
      }));
      gridKeys(host.querySelector('.gedit'), (c) => { b.rows.push(b.columns.map(() => '')); paint({ r: b.rows.length - 1, c }); });
      host.querySelector('[data-cadd]').addEventListener('click', () => {
        if (b.columns.length >= 12) return toast('A patch list can have up to 12 columns');
        b.columns.push('Column ' + (b.columns.length + 1)); b.rows.forEach((r) => r.push('')); dirty(); paint();
        const inputs = host.querySelectorAll('[data-col]'); inputs[inputs.length - 1].select();
      });
      host.querySelectorAll('[data-cdel]').forEach((x) => x.addEventListener('click', async () => {
        const ci = Number(x.dataset.cdel);
        if (b.columns.length <= 1) return toast('A patch list needs at least one column');
        if (b.rows.some((r) => String(r[ci] || '').trim()) && !await confirmBox('Remove the ' + (b.columns[ci] || 'column') + ' column?', 'Everything typed in it is removed too.', 'Remove', true)) return;
        b.columns.splice(ci, 1); b.rows.forEach((r) => r.splice(ci, 1));
        b.trace = b.trace.filter((i) => i !== ci).map((i) => i > ci ? i - 1 : i);
        dirty(); paint();
      }));
      host.querySelectorAll('[data-rdel]').forEach((x) => x.addEventListener('click', () => { b.rows.splice(Number(x.dataset.rdel), 1); dirty(); paint(); }));
      host.querySelectorAll('[data-rup]').forEach((x) => x.addEventListener('click', () => {
        const i = Number(x.dataset.rup); [b.rows[i - 1], b.rows[i]] = [b.rows[i], b.rows[i - 1]]; dirty(); paint();
      }));
      host.querySelector('[data-radd]').addEventListener('click', () => { b.rows.push(b.columns.map(() => '')); paint({ r: b.rows.length - 2 < 0 ? 0 : b.rows.length - 2, c: '0' }); });
      host.querySelector('[data-paste]').addEventListener('click', () => pasteRows());
      host.querySelector('[data-trace]').addEventListener('click', () => traceDialog());
      if (focus) { const f = host.querySelector('input[data-r="' + focus.r + '"][data-c="' + focus.c + '"]'); if (f) f.focus(); }
    };
    function wireTop() {
      host.querySelector('[data-f=title]').addEventListener('input', (e) => { b.title = e.target.value; dirty(); });
      host.querySelectorAll('[data-pm]').forEach((x) => x.addEventListener('click', () => { b._view = x.dataset.pm; paint(); }));
      host.querySelector('[data-preset]').addEventListener('change', async (e) => {
        const k = e.target.value;
        const has = b.rows.some((r) => r.some((v) => String(v || '').trim()));
        if (has && !await confirmBox('Use the ' + PRESETS[k].title + ' columns?', 'Column names change to ' + PRESETS[k].columns.join(', ') + '. Your rows stay, matched by position.', 'Change columns')) { e.target.value = b.preset; return; }
        b.preset = k; b.columns = PRESETS[k].columns.slice(); b.trace = PRESETS[k].trace.slice();
        b.rows = b.rows.map((r) => b.columns.map((_, i) => r[i] || ''));
        dirty(); paint();
      });
    }
    function appendRow() {
      const tb = host.querySelector('.gedit tbody');
      const ri = b.rows.length - 1;
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="rn">' + (ri + 1) + '</td>' + b.columns.map((_, ci) => '<td><input data-r="' + ri + '" data-c="' + ci + '"></td>').join('') +
        '<td class="rt"><button type="button" class="ghost" data-rup="' + ri + '" title="Move up">' + icon('up') + '</button><button type="button" class="ghost" data-rdel="' + ri + '" title="Remove row">' + icon('x') + '</button></td>';
      tb.appendChild(tr);
      tr.querySelectorAll('input[data-r]').forEach((f) => f.addEventListener('input', () => {
        b.rows[Number(f.dataset.r)][Number(f.dataset.c)] = f.value; dirty();
        if (Number(f.dataset.r) === b.rows.length - 1 && f.value) { b.rows.push(b.columns.map(() => '')); appendRow(); }
      }));
      tr.querySelector('[data-rdel]').addEventListener('click', () => { b.rows.splice(ri, 1); dirty(); paint(); });
      tr.querySelector('[data-rup]').addEventListener('click', () => { [b.rows[ri - 1], b.rows[ri]] = [b.rows[ri], b.rows[ri - 1]]; dirty(); paint(); });
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
    function traceDialog() {
      let order = b.trace.filter((i) => i < b.columns.length);
      b.columns.forEach((_, i) => { if (!order.includes(i)) order.push(i); });
      let on = new Set(b.trace);
      modal('<h3>Wire trace path</h3><p>Pick the columns a signal passes through, in order from where it starts to where it ends. Notes-type columns usually stay off.</p><div id="tl" class="tlist"></div>' +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary" id="tok">Save</button></div>', (w, close) => {
        const tl = w.querySelector('#tl');
        const draw = () => {
          tl.innerHTML = order.map((ci, k) => '<div class="tli"><label class="tog' + (on.has(ci) ? ' on' : '') + '"><input type="checkbox" data-ci="' + ci + '"' + (on.has(ci) ? ' checked' : '') + '>' + esc(b.columns[ci] || 'Column ' + (ci + 1)) + '</label>' +
            '<span class="grow"></span><button type="button" class="ghost" data-up="' + k + '"' + (k ? '' : ' disabled') + '>' + icon('up') + '</button><button type="button" class="ghost" data-down="' + k + '"' + (k < order.length - 1 ? '' : ' disabled') + '>' + icon('down') + '</button></div>').join('');
          tl.querySelectorAll('[data-ci]').forEach((x) => x.addEventListener('change', () => { const ci = Number(x.dataset.ci); if (x.checked) on.add(ci); else on.delete(ci); draw(); }));
          tl.querySelectorAll('[data-up]').forEach((x) => x.addEventListener('click', () => { const k = Number(x.dataset.up); [order[k - 1], order[k]] = [order[k], order[k - 1]]; draw(); }));
          tl.querySelectorAll('[data-down]').forEach((x) => x.addEventListener('click', () => { const k = Number(x.dataset.down); [order[k + 1], order[k]] = [order[k], order[k + 1]]; draw(); }));
        };
        draw();
        w.querySelector('#tok').addEventListener('click', () => {
          const t = order.filter((ci) => on.has(ci));
          if (t.length === 1) return toast('Pick at least two columns, or none to turn the trace off', 'bad');
          b.trace = t; close(); dirty(); paint();
        });
      });
    }
    paint();
  }

  /*
   * Draw mode for a patch list. The drawing and the table are the same rows:
   * boxes are the values in each wire-trace column, a line is two of them on one row.
   */
  function drawPatch(area, panel, b, dirty, openTrace) {
    const cols = (b.trace || []).filter((i) => i < b.columns.length);
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
        const present = [];
        cols.forEach((ci, k) => {
          const v = String(r[ci] || '').trim();
          if (!v) return;
          const kk = key(v);
          if (!nodes[k].has(kk)) nodes[k].set(kk, { k, key: kk, label: v, rows: [], i: nodes[k].size });
          nodes[k].get(kk).rows.push(ri);
          present.push({ k, key: kk });
        });
        for (let j = 1; j < present.length; j++) edges.push({ r: ri, a: present[j - 1], z: present[j] });
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
      ri = b.rows.findIndex((r) => key(r[ca]) === a.key && !String(r[cz] || '').trim() && between(r) && cols.slice(z.k + 1).every((ci) => !String(r[ci] || '').trim()));
      if (ri < 0) ri = b.rows.findIndex((r) => key(r[cz]) === z.key && !String(r[ca] || '').trim() && between(r) && cols.slice(0, a.k).every((ci) => !String(r[ci] || '').trim()));
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

    function draw() {
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
        '<svg class="pdw" width="' + W + '" height="' + H + '"><g>' + edges.map((e) => '<g class="pw' + (isSelW(e) ? ' sel' : '') + '" data-r="' + e.r + '" data-a="' + e.a.k + '" data-z="' + e.z.k + '"><path class="hit" d="' + path(e) + '"/><path class="ln" d="' + path(e) + '"/></g>').join('') +
        '</g><path class="tmp" d=""/></svg>' +
        nodes.map((m, k) => [...m.values()].map((n) => '<div class="pn' + (isSelN(n) ? ' sel' : '') + (pending && pending.k === n.k && pending.key === n.key ? ' pend' : '') + '" data-k="' + k + '" data-key="' + esc(n.key) + '" style="left:' + cx(k) + 'px;top:' + cy(n.i) + 'px;width:' + CW + 'px;height:' + NH + 'px">' +
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
        panel.innerHTML = '<div class="pdp"><div class="pdph"><b>' + esc(b.columns[ci]) + '</b><span class="note">' + n.rows.length + ' row' + (n.rows.length === 1 ? '' : 's') + '</span></div>' +
          '<div class="pdf"><label>Name<input data-rename value="' + esc(n.label) + '" list="' + dlId + '"></label></div>' +
          '<div class="acts" style="justify-content:flex-start;margin-top:8px"><button type="button" class="btn" data-from>Connect from here</button><button type="button" class="btn danger" data-ndel>Remove box</button></div></div>';
        const inp = panel.querySelector('[data-rename]');
        inp.addEventListener('change', () => {
          const v = inp.value.trim();
          if (!v) return;
          b.rows.forEach((r) => { if (key(r[ci]) === sel.key) r[ci] = v; });
          sel = { type: 'node', k: sel.k, key: key(v) }; tidy(); dirty(); draw();
        });
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

  return { render, wire, editChecklist, editPatch, editIplist, PRESETS, describe, analyze, ipInt, traceSvg };
})();
