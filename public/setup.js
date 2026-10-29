/*
 * Guided equipment setup: console → stage boxes → other gear → review.
 * Creates device cards (with input and output counts) and a "Stage patch" page with
 * a Snake inputs and a Snake outputs list for every stage box, ready to assign.
 */
'use strict';

const GEAR = {
  consoles: [
    { model: 'SQ-5', make: 'Allen & Heath', inputs: 16, outputs: 12, link: 'SLink' },
    { model: 'SQ-6', make: 'Allen & Heath', inputs: 24, outputs: 14, link: 'SLink' },
    { model: 'SQ-7', make: 'Allen & Heath', inputs: 32, outputs: 16, link: 'SLink' },
    { model: 'X32', make: 'Behringer', inputs: 32, outputs: 16, link: 'AES50' },
    { model: 'X32 Rack', make: 'Behringer', inputs: 16, outputs: 8, link: 'AES50' },
    { model: 'M32', make: 'Midas', inputs: 32, outputs: 16, link: 'AES50' },
    { model: 'TF5', make: 'Yamaha', inputs: 32, outputs: 16, link: 'Dante' }
  ],
  boxes: [
    { model: 'AR2412', make: 'Allen & Heath', inputs: 24, outputs: 12, link: 'SLink' },
    { model: 'AR84', make: 'Allen & Heath', inputs: 8, outputs: 4, link: 'SLink' },
    { model: 'AB168', make: 'Allen & Heath', inputs: 16, outputs: 8, link: 'SLink' },
    { model: 'DX168', make: 'Allen & Heath', inputs: 16, outputs: 8, link: 'SLink' },
    { model: 'S16', make: 'Behringer', inputs: 16, outputs: 8, link: 'AES50' },
    { model: 'S32', make: 'Behringer', inputs: 32, outputs: 16, link: 'AES50' },
    { model: 'DL16', make: 'Midas', inputs: 16, outputs: 8, link: 'AES50' },
    { model: 'DL32', make: 'Midas', inputs: 32, outputs: 16, link: 'AES50' },
    { model: 'Tio1608-D', make: 'Yamaha', inputs: 16, outputs: 8, link: 'Dante' }
  ],
  other: [
    { group: 'Wireless', qty: true, items: Blk.RF_GEAR.receivers.filter((g) => ['SLX-D4D', 'ULX-D4D', 'ULX-D4Q', 'QLXD4', 'AD4Q', 'EW-DX EM 2'].includes(g.name)) },
    { group: 'Speaker processor', items: [{ name: 'DriveRack PA2', make: 'dbx', model: 'DriveRack PA2' }, { name: 'DriveRack VENU360', make: 'dbx', model: 'DriveRack VENU360' }] },
    { group: 'Amplifiers', items: [{ name: 'Crown XLi 2500', make: 'Crown', model: 'XLi 2500' }, { name: 'Crown XLS 2502', make: 'Crown', model: 'XLS 2502' }] },
    { group: 'Speakers', items: [{ name: 'JBL CBT 70J-1', make: 'JBL', model: 'CBT 70J-1' }, { name: 'Yamaha DXS12mkII', make: 'Yamaha', model: 'DXS12mkII' }] },
    { group: 'In-ears', qty: true, items: Blk.RF_GEAR.iem }
  ]
};
const GROUP_ROLE = { Wireless: 'wireless', 'Speaker processor': 'processor', Amplifiers: 'amp', Speakers: 'speaker', 'In-ears': 'iem' };
/** Device names for several of the same unit: SLX-D4D, SLX-D4D #2, SLX-D4D #3. */
const unitNames = (o) => Array.from({ length: Math.max(1, Number(o.qty) || 1) }, (_, i) => (i ? o.name + ' #' + (i + 1) : o.name));

async function viewGearSetup() {
  if (!can('editor')) { app.innerHTML = '<div class="card empty">Editors and admins can run the guided setup.</div>'; if (!S.state.user) signInDialog(() => route()); return; }
  setTitle('Guided setup');
  const have = await loadDevices(true);
  const st = {
    step: 0,
    console: { model: 'SQ-5', make: 'Allen & Heath', name: 'SQ-5', location: 'FOH', ip: '', inputs: 16, outputs: 12 },
    boxes: [],
    other: [],
    page: true, cables: true
  };
  const existingConsole = have.find((d) => GEAR.consoles.some((c) => c.model.toLowerCase() === String(d.model || d.name).toLowerCase()));
  if (existingConsole) Object.assign(st.console, { name: existingConsole.name, model: existingConsole.model || existingConsole.name, make: existingConsole.make, location: existingConsole.location || 'FOH', inputs: existingConsole.inputs || st.console.inputs, outputs: existingConsole.outputs || st.console.outputs });
  const STEPS = ['Console', 'Stage boxes', 'Other gear', 'Review'];
  const known = (name) => have.find((d) => d.name.toLowerCase() === String(name || '').trim().toLowerCase());
  const linkFor = () => (GEAR.consoles.find((c) => c.model === st.console.model) || {}).link || 'SLink';

  function addBox(model) {
    const g = GEAR.boxes.find((x) => x.model === model) || { model: model || '', make: '', inputs: 16, outputs: 8, link: linkFor() };
    const same = st.boxes.filter((b) => b.model === g.model).length;
    const start = st.boxes.reduce((n, b) => Math.max(n, Number(b.start) + Number(b.inputs)), 1);
    st.boxes.push({ model: g.model, make: g.make, name: g.model + (same ? ' #' + (same + 1) : ''), location: same ? 'Stage right' : 'Stage', link: g.link || linkFor(), inputs: g.inputs, outputs: g.outputs, start });
  }

  function render() {
    const sv = (o, k) => esc(o[k] == null ? '' : o[k]);
    let body = '';
    if (st.step === 0) {
      body = `<p class="note">Start with the mixing console. The model fills in its inputs and outputs; change anything that is different on yours.</p>
        <div class="gform">
          <label>Model<select data-c="model">${GEAR.consoles.map((c) => '<option' + (c.model === st.console.model ? ' selected' : '') + '>' + c.model + '</option>').join('')}<option value=""${GEAR.consoles.some((c) => c.model === st.console.model) ? '' : ' selected'}>Other…</option></select></label>
          <label>Name<input data-c="name" value="${sv(st.console, 'name')}"></label>
          <label>Make<input data-c="make" value="${sv(st.console, 'make')}"></label>
          <label>Location<input data-c="location" value="${sv(st.console, 'location')}" placeholder="FOH"></label>
          <label>Local inputs<input data-c="inputs" type="number" min="0" value="${sv(st.console, 'inputs')}"></label>
          <label>Local outputs<input data-c="outputs" type="number" min="0" value="${sv(st.console, 'outputs')}"></label>
          <label>IP address<input data-c="ip" class="mono" inputmode="decimal" value="${sv(st.console, 'ip')}" placeholder="optional"></label>
        </div>${known(st.console.name) ? '<p class="note">A card called ' + esc(st.console.name) + ' already exists; it will be kept and its input and output counts filled in if missing.</p>' : ''}`;
    } else if (st.step === 1) {
      body = `<p class="note">Add each stage box. LiveGenie makes one row per stage box input and output, already wired to the ${esc(st.console.name)} over the link, so later you only assign what plugs in.</p>
        ${st.boxes.map((b, i) => `<div class="gbox" data-i="${i}"><div class="gbh"><b>Stage box ${i + 1}</b><button type="button" class="ghost danger" data-rm="${i}">${icon('x')}</button></div><div class="gform">
          <label>Model<select data-b="model">${GEAR.boxes.map((g) => '<option' + (g.model === b.model ? ' selected' : '') + '>' + g.model + '</option>').join('')}<option value=""${GEAR.boxes.some((g) => g.model === b.model) ? '' : ' selected'}>Other…</option></select></label>
          <label>Name<input data-b="name" value="${sv(b, 'name')}"></label>
          <label>Location<input data-b="location" value="${sv(b, 'location')}"></label>
          <label>Link to console<input data-b="link" value="${sv(b, 'link')}"></label>
          <label>Inputs<input data-b="inputs" type="number" min="0" max="128" value="${sv(b, 'inputs')}"></label>
          <label>Outputs<input data-b="outputs" type="number" min="0" max="128" value="${sv(b, 'outputs')}"></label>
          <label>Console input for box input 1<input data-b="start" type="number" min="1" value="${sv(b, 'start')}"></label>
        </div></div>`).join('') || '<div class="card empty" style="padding:20px">No stage boxes yet.</div>'}
        <div class="adder"><span class="note">Add</span>${GEAR.boxes.slice(0, 5).map((g) => '<button type="button" class="btn" data-add="' + g.model + '">' + icon('plus') + g.model + '</button>').join('')}<button type="button" class="btn" data-add="">${icon('plus')}Other</button></div>
        <p class="note">No stage box? Skip this step: everything plugs straight into the console.</p>`;
    } else if (st.step === 2) {
      body = '<p class="note">Tick the rest of the gear you have. Each becomes a device card you can add a photo, IP and notes to later.</p>' +
        GEAR.other.map((g) => '<div class="ggroup"><b>' + g.group + '</b><div class="gchips">' + g.items.map((it) => {
          const sel = st.other.find((o) => o.name === it.name), on = !!sel;
          const sub = it.ch ? it.ch + ' ch' : it.tx > 1 ? it.tx + ' transmitters' : '';
          return '<label class="tog' + (on ? ' on' : '') + '"><input type="checkbox" data-o="' + esc(it.name) + '" data-g="' + esc(g.group) + '"' + (on ? ' checked' : '') + '>' + esc(it.name) +
            (sub ? ' <span class="note">' + sub + '</span>' : '') + (known(it.name) ? ' <span class="note">(have)</span>' : '') +
            (g.qty && on ? '<span class="qty">×<input type="number" min="1" max="16" data-q="' + esc(it.name) + '" value="' + (sel.qty || 1) + '" aria-label="How many ' + esc(it.name) + '"></span>' : '') + '</label>';
        }).join('') + '</div></div>').join('') +
        '<div class="ggroup"><b>Something else</b><div class="gform" style="grid-template-columns:2fr 1fr auto"><input id="gname" placeholder="Name, e.g. Crown XLi 1500"><select id="ggrp">' + GEAR.other.map((g) => '<option>' + g.group + '</option>').join('') + '</select><button type="button" class="btn" id="gadd">' + icon('plus') + 'Add</button></div>' +
        (st.other.filter((o) => o.custom).length ? '<div class="gchips" style="margin-top:6px">' + st.other.filter((o) => o.custom).map((o) => '<span class="chip">' + esc(o.name) + ' <button type="button" class="ghost" data-orm="' + esc(o.name) + '" style="padding:0 2px">' + icon('x') + '</button></span>').join('') + '</div>' : '') + '</div>';
    } else {
      const cards = [st.console.name, ...st.boxes.map((b) => b.name), ...st.other.flatMap((o) => (o.role === 'wireless' || o.role === 'iem' ? unitNames(o) : [o.name]))];
      const rx = st.other.filter((o) => o.role === 'wireless'), iem = st.other.filter((o) => o.role === 'iem');
      const rxCh = rx.reduce((n, o) => n + (o.ch || 1) * (Number(o.qty) || 1), 0), iemTx = iem.reduce((n, o) => n + (o.tx || 1) * (Number(o.qty) || 1), 0);
      const lists = [...st.boxes.map((b) => esc(b.name) + ': ' + b.inputs + ' inputs, ' + b.outputs + ' outputs'), rxCh ? 'Wireless mics: ' + rxCh + ' receiver channels' : '', iemTx ? 'In-ears: ' + iemTx + ' transmitter' + (iemTx === 1 ? '' : 's') : ''].filter(Boolean);
      const fresh = cards.filter((n) => !known(n)), kept = cards.filter((n) => known(n));
      const proc = st.other.filter((o) => o.role === 'processor'), amps = st.other.filter((o) => o.role === 'amp'), spk = st.other.filter((o) => o.role === 'speaker');
      body = `<div class="card" style="margin:0 0 12px"><h2>Device cards</h2>
          ${fresh.length ? '<p>New: ' + fresh.map((n) => '<span class="chip">' + esc(n) + '</span>').join(' ') + '</p>' : ''}
          ${kept.length ? '<p class="note">Already have: ' + kept.map(esc).join(', ') + ' (kept, input and output counts filled in if missing)</p>' : ''}</div>
        <label class="tog ${st.page ? 'on' : ''} gopt"><input type="checkbox" data-opt="page"${st.page ? ' checked' : ''}><span><b>Stage patch page</b><br><span class="note">${lists.length ? lists.join(' · ') + ', ready to assign' : 'Add a stage box, wireless or in-ears to get patch lists'}</span></span></label>
        <label class="tog ${st.cables ? 'on' : ''} gopt"><input type="checkbox" data-opt="cables"${st.cables ? ' checked' : ''}${proc.length || amps.length ? '' : ' disabled'}><span><b>Main PA cable runs</b><br><span class="note">${proc.length || amps.length ? 'A starting list: ' + esc([st.console.name, ...proc.map((x) => x.name), ...amps.map((x) => x.name), ...spk.map((x) => x.name)].join(' → ')) + '. Check it against your rack.' : 'Tick a speaker processor or amplifier to get this'}</span></span></label>`;
    }
    app.innerHTML = `<div class="ed gsetup"><div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/devices">Devices</a><span>/</span><span>Guided setup</span></div>
      <h1 class="title" style="font-size:22px;margin:6px 0 10px">Guided equipment setup</h1>
      <div class="gsteps">${STEPS.map((t, i) => '<button type="button" data-step="' + i + '" class="' + (i === st.step ? 'on' : i < st.step ? 'done' : '') + '"><i>' + (i + 1) + '</i>' + t + '</button>').join('')}</div>
      <div class="card">${body}</div>
      <div class="edbar"><span class="note grow"></span>${st.step ? '<button type="button" id="gback">Back</button>' : '<button type="button" id="gcancel">Cancel</button>'}<button class="primary" id="gnext">${st.step === 3 ? 'Create' : 'Next'}</button></div></div>`;
    wire();
  }

  function wire() {
    $$('[data-step]').forEach((x) => x.addEventListener('click', () => { st.step = Number(x.dataset.step); render(); }));
    const back = $('#gback'); if (back) back.addEventListener('click', () => { st.step--; render(); });
    const cancel = $('#gcancel'); if (cancel) cancel.addEventListener('click', () => { location.hash = '#/devices'; });
    $('#gnext').addEventListener('click', () => { if (st.step < 3) { if (st.step === 0 && !st.console.name.trim()) return toast('Give the console a name', 'bad'); st.step++; render(); } else create(); });
    $$('[data-c]').forEach((x) => x.addEventListener(x.tagName === 'SELECT' ? 'change' : 'input', () => {
      const k = x.dataset.c;
      if (k === 'model') {
        const g = GEAR.consoles.find((c) => c.model === x.value);
        if (g) Object.assign(st.console, { model: g.model, make: g.make, inputs: g.inputs, outputs: g.outputs, name: g.model });
        else st.console.model = '';
        st.boxes.forEach((b) => { if (!b.linkTouched) b.link = linkFor(); });
        render(); return;
      }
      st.console[k] = x.value;
    }));
    $$('.gbox').forEach((el) => {
      const b = st.boxes[Number(el.dataset.i)];
      el.querySelectorAll('[data-b]').forEach((x) => x.addEventListener(x.tagName === 'SELECT' ? 'change' : 'input', () => {
        const k = x.dataset.b;
        if (k === 'model') {
          const g = GEAR.boxes.find((y) => y.model === x.value);
          if (g) Object.assign(b, { model: g.model, make: g.make, inputs: g.inputs, outputs: g.outputs, name: g.model, link: g.link });
          render(); return;
        }
        if (k === 'link') b.linkTouched = true;
        b[k] = x.value;
      }));
    });
    $$('[data-rm]').forEach((x) => x.addEventListener('click', () => { st.boxes.splice(Number(x.dataset.rm), 1); render(); }));
    $$('[data-add]').forEach((x) => x.addEventListener('click', () => { addBox(x.dataset.add); render(); }));
    $$('[data-o]').forEach((x) => x.addEventListener('change', () => {
      const all = GEAR.other.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));
      const it = all.find((y) => y.name === x.dataset.o);
      st.other = st.other.filter((o) => o.name !== it.name);
      if (x.checked) st.other.push({ ...it, role: GROUP_ROLE[it.group], qty: 1 });
      if (GEAR.other.find((g) => g.group === it.group).qty) render(); else x.closest('.tog').classList.toggle('on', x.checked);
    }));
    $$('[data-q]').forEach((x) => {
      x.addEventListener('click', (e) => e.stopPropagation());
      x.addEventListener('input', () => { const o = st.other.find((y) => y.name === x.dataset.q); if (o) o.qty = Math.max(1, Math.min(16, Number(x.value) || 1)); });
    });
    const ga = $('#gadd');
    if (ga) ga.addEventListener('click', () => {
      const name = $('#gname').value.trim();
      if (!name) return;
      st.other.push({ name, model: '', make: '', role: GROUP_ROLE[$('#ggrp').value], custom: true });
      render();
    });
    $$('[data-orm]').forEach((x) => x.addEventListener('click', () => { st.other = st.other.filter((o) => o.name !== x.dataset.orm); render(); }));
    $$('[data-opt]').forEach((x) => x.addEventListener('change', () => { st[x.dataset.opt] = x.checked; x.closest('.tog').classList.toggle('on', x.checked); }));
  }

  async function upsert(d) {
    const ex = known(d.name);
    if (!ex) return (await call('POST', '/api/devices', d)).id;
    if ((!ex.inputs && d.inputs) || (!ex.outputs && d.outputs)) {
      const full = (await get('/api/devices/' + ex.id)).device;
      await call('PUT', '/api/devices/' + ex.id, { ...full, inputs: full.inputs || d.inputs, outputs: full.outputs || d.outputs });
    }
    return ex.id;
  }

  async function create() {
    const btn = $('#gnext'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const c = st.console;
      await upsert({ name: c.name.trim(), category: 'audio', make: c.make, model: c.model || c.name, location: c.location, ip: c.ip.trim(), inputs: Number(c.inputs) || 0, outputs: Number(c.outputs) || 0 });
      for (const b of st.boxes) await upsert({ name: b.name.trim(), category: 'audio', make: b.make, model: b.model || b.name, location: b.location, inputs: Number(b.inputs) || 0, outputs: Number(b.outputs) || 0, notes: 'Connected to the ' + c.name + ' over ' + b.link + '.' });
      for (const o of st.other) {
        if (o.role === 'wireless') for (const n of unitNames(o)) await upsert({ name: n, category: 'audio', make: o.make, model: o.model, outputs: o.ch || 0, notes: o.ch ? o.ch + '-channel wireless receiver.' : '' });
        else if (o.role === 'iem') for (const n of unitNames(o)) await upsert({ name: n, category: 'audio', make: o.make, model: o.model, inputs: (o.tx || 1) * 2, notes: 'In-ear transmitter' + (o.tx > 1 ? ' (' + o.tx + ' transmitters)' : '') + '.' });
        else await upsert({ name: o.name, category: 'audio', make: o.make, model: o.model });
      }
      const blocks = [];
      if (st.page && st.boxes.length) {
        for (const b of st.boxes) {
          const P = Blk.PRESETS.snake, Q = Blk.PRESETS.snakeout;
          const ins = [], outs = [];
          for (let i = 1; i <= Number(b.inputs); i++) ins.push([String(Number(b.start) + i - 1), '', '', b.name, String(i), b.link, c.name, '']);
          for (let i = 1; i <= Number(b.outputs); i++) outs.push(['', c.name, b.link, b.name, String(i), '', '']);
          if (ins.length) blocks.push({ type: 'patch', preset: 'snake', title: b.name + ' inputs', columns: P.columns, trace: P.trace, roles: P.roles, assign: P.assign, rows: ins });
          if (outs.length) blocks.push({ type: 'patch', preset: 'snakeout', title: b.name + ' outputs', columns: Q.columns, trace: Q.trace, roles: Q.roles, assign: Q.assign, rows: outs });
        }
      }
      if (st.page) {
        const W = Blk.PRESETS.wireless, I = Blk.PRESETS.iem;
        const rx = [];
        st.other.filter((o) => o.role === 'wireless').forEach((o) => unitNames(o).forEach((n) => { for (let ch = 1; ch <= (o.ch || 1); ch++) rx.push(['', '', '', '', '', n, String(ch), '', '', c.name, '']); }));
        if (rx.length) blocks.push({ type: 'patch', preset: 'wireless', title: 'Wireless mics', columns: W.columns, trace: W.trace, roles: W.roles, assign: W.assign, rows: rx });
        const tx = [];
        st.other.filter((o) => o.role === 'iem').forEach((o) => unitNames(o).forEach((n) => { for (let t = 1; t <= (o.tx || 1); t++) tx.push(['', c.name, '', '', '', (o.tx || 1) > 1 ? n + ' ' + String.fromCharCode(64 + t) : n, 'Stereo', '', '', '', '', '']); }));
        if (tx.length) blocks.push({ type: 'patch', preset: 'iem', title: 'In-ears', columns: I.columns, trace: I.trace, roles: I.roles, assign: I.assign, rows: tx });
      }
      const proc = st.other.filter((o) => o.role === 'processor'), amps = st.other.filter((o) => o.role === 'amp'), spk = st.other.filter((o) => o.role === 'speaker');
      if (st.cables && (proc.length || amps.length)) {
        const rows = [];
        let n = 1;
        const L = () => 'C' + n++;
        const first = proc[0] || null;
        if (first) rows.push([L(), c.name, first.name, 'XLR', '', '']);
        amps.forEach((a) => rows.push([L(), first ? first.name : c.name, a.name, 'XLR', '', '']));
        spk.forEach((sp, i) => rows.push([L(), amps.length ? amps[i % amps.length].name : (first ? first.name : c.name), sp.name, 'Speakon', '', '']));
        blocks.push({ type: 'text', md: 'Starting point from the guided setup. Check each run against the rack and fix labels, lengths and routes.' });
        blocks.push({ type: 'patch', preset: 'cable', title: 'Main PA', columns: Blk.PRESETS.cable.columns, trace: Blk.PRESETS.cable.trace, rows });
      }
      forgetDevices();
      if (blocks.length) {
        blocks.unshift({ type: 'text', md: 'Made by the guided setup. Tap **Edit**, then a list\'s **Draw** button, and drag from a source to the stage box to assign it to the next free input. Or type sources into the table. In **Wireless mics**, fill in who uses each receiver channel, the capsule, transmitter and frequency, and where the receiver plugs in. In **In-ears**, fill in the mix, outputs, bodypack and who wears it.' });
        const r = await call('POST', '/api/pages', { title: 'Stage patch', space: 'audio', blocks });
        toast('Setup done', 'ok');
        location.hash = '#/p/' + r.id;
      } else { toast('Device cards ready', 'ok'); location.hash = '#/devices'; }
    } catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.textContent = 'Create'; }
  }

  if (!st.boxes.length) addBox('AR2412');
  render();
}
