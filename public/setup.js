/*
 * Guided equipment setup: console → stage boxes → other gear → review.
 * There is no built-in gear list: you type the make and model (or pick one you added before), and every new
 * one is remembered in your model list. It makes Gear Locker cards (with input and output counts) and puts
 * the gear on the stage patch drawing, each stage box linked to the console, ready to draw the mics in.
 */
'use strict';

/** The rest of the gear, by type: what each group adds to the drawing. */
const SETUP_GROUPS = [
  { role: 'wireless', kind: 'receiver', title: 'Wireless receivers', qty: true, count: ['nin', 'Channels', 2] },
  { role: 'iem', kind: 'iemtx', title: 'In-ear transmitters', qty: true },
  { role: 'processor', kind: 'processor', title: 'Speaker processors', count: ['nout', 'Outputs', 6] },
  { role: 'amp', kind: 'amp', title: 'Amplifiers', count: ['nin', 'Channels', 2] },
  { role: 'speaker', kind: 'speaker', title: 'Speakers' }
];
/** Device names for several of the same unit: Receiver, Receiver #2, Receiver #3. */
const unitNames = (o) => Array.from({ length: Math.max(1, Number(o.qty) || 1) }, (_, i) => (i ? o.name + ' #' + (i + 1) : o.name));
const nameFor = (m) => (['processor', 'amp', 'speaker'].includes(m.kind) && m.make && !m.model.toLowerCase().startsWith(m.make.toLowerCase()) ? m.make + ' ' + m.model : m.model);

async function viewGearSetup() {
  if (!can('admin')) { app.innerHTML = '<div class="card empty">Admins can run the guided setup.</div>'; if (!S.state.user) signInDialog(() => route()); return; }
  setTitle('Guided setup');
  const [have, models] = await Promise.all([loadDevices(true), GearModels.load(true)]);
  const ofKind = (k) => models.filter((m) => m.kind === k);
  const consoles = ofKind('console'), boxModels = ofKind('stagebox');
  const blankConsole = { model: '', make: '', name: '', location: 'FOH', ip: '', inputs: 16, outputs: 12, link: 'SLink', namelen: '', colors: '' };
  const fromModel = (m) => ({ model: m.model, make: m.make, name: m.model, inputs: m.nin != null ? m.nin : 16, outputs: m.nout != null ? m.nout : 12, link: m.link || 'SLink', namelen: m.namelen || '', colors: (m.colors || []).join(', ') });
  const st = { step: 0, console: { ...blankConsole, ...(consoles[0] ? fromModel(consoles[0]) : {}) }, boxes: [], other: [], page: true, cables: true, adding: {} };
  const existingConsole = have.find((d) => consoles.some((c) => c.model.toLowerCase() === String(d.model || d.name).toLowerCase()));
  if (existingConsole) Object.assign(st.console, { name: existingConsole.name, location: existingConsole.location || 'FOH', inputs: existingConsole.inputs || st.console.inputs, outputs: existingConsole.outputs || st.console.outputs });
  const STEPS = ['Console', 'Stage boxes', 'Other gear', 'Review'];
  const known = (name) => have.find((d) => d.name.toLowerCase() === String(name || '').trim().toLowerCase());

  function addBox(m) {
    const same = m ? st.boxes.filter((b) => b.model === m.model).length : 0;
    st.boxes.push(m
      ? { model: m.model, make: m.make, name: m.model + (same ? ' #' + (same + 1) : ''), location: same ? 'Stage right' : 'Stage', link: m.link || st.console.link || 'SLink', inputs: m.nin != null ? m.nin : 16, outputs: m.nout != null ? m.nout : 8 }
      : { model: '', make: '', name: '', location: 'Stage', link: st.console.link || 'SLink', inputs: 16, outputs: 8, fresh: true });
  }

  function render() {
    const sv = (o, k) => esc(o[k] == null ? '' : o[k]);
    let body = '';
    if (st.step === 0) {
      body = `<p class="note">Start with the mixing console. ${consoles.length ? 'Pick one you added before, or type a new make and model.' : 'Type its make and model: LiveGenie remembers it for next time.'}</p>
        ${consoles.length ? '<label class="gpick">From your list<select data-pick><option value="">New console…</option>' + consoles.map((c, i) => '<option value="' + i + '"' + (c.model === st.console.model && c.make === st.console.make ? ' selected' : '') + '>' + esc([c.make, c.model].filter(Boolean).join(' ')) + '</option>').join('') + '</select></label>' : ''}
        <div class="gform">
          <label>Make<input data-c="make" value="${sv(st.console, 'make')}" placeholder="Manufacturer" list="gmakes"></label>
          <label>Model<input data-c="model" value="${sv(st.console, 'model')}" placeholder="Model number"></label>
          <label>Name<input data-c="name" value="${sv(st.console, 'name')}" placeholder="${esc(st.console.model || 'FOH console')}"></label>
          <label>Location<input data-c="location" value="${sv(st.console, 'location')}" placeholder="FOH"></label>
          <label>Local inputs<input data-c="inputs" type="number" min="0" value="${sv(st.console, 'inputs')}"></label>
          <label>Local outputs<input data-c="outputs" type="number" min="0" value="${sv(st.console, 'outputs')}"></label>
          <label>Link to stage boxes<input data-c="link" value="${sv(st.console, 'link')}" placeholder="SLink, AES50, Dante"></label>
          <label>IP address<input data-c="ip" class="mono" inputmode="decimal" value="${sv(st.console, 'ip')}" placeholder="optional"></label>
          <label>Channel name: most letters<input data-c="namelen" type="number" min="0" max="64" value="${sv(st.console, 'namelen')}" placeholder="no limit"></label>
          <label class="wide2">Channel colours <span class="note">(the ones the desk has, comma between)</span><input data-c="colors" value="${sv(st.console, 'colors')}" placeholder="Red, Green, Yellow, Blue, Purple, Cyan, White"></label>
        </div><datalist id="gmakes">${GearModels.makes().map((m) => '<option value="' + esc(m) + '">').join('')}</datalist>
        ${known(st.console.name) ? '<p class="note">A card called ' + esc(st.console.name) + ' already exists; it will be kept and its input and output counts filled in if missing.</p>' : ''}`;
    } else if (st.step === 1) {
      body = `<p class="note">Add each stage box. LiveGenie adds it to the stage patch, linked to the ${esc(st.console.name || st.console.model || 'console')}. Which console channel each box input lands on is up to you: assign them in the stage patch.</p>
        ${st.boxes.map((b, i) => `<div class="gbox" data-i="${i}"><div class="gbh"><b>Stage box ${i + 1}</b><button type="button" class="ghost danger" data-rm="${i}">${icon('x')}</button></div><div class="gform">
          <label>Make<input data-b="make" value="${sv(b, 'make')}" placeholder="Manufacturer" list="gmakes"></label>
          <label>Model<input data-b="model" value="${sv(b, 'model')}" placeholder="Model number"></label>
          <label>Name<input data-b="name" value="${sv(b, 'name')}" placeholder="${esc(b.model || 'Stage box')}"></label>
          <label>Location<input data-b="location" value="${sv(b, 'location')}"></label>
          <label>Link to console<input data-b="link" value="${sv(b, 'link')}"></label>
          <label>Inputs<input data-b="inputs" type="number" min="0" max="128" value="${sv(b, 'inputs')}"></label>
          <label>Outputs<input data-b="outputs" type="number" min="0" max="128" value="${sv(b, 'outputs')}"></label>
        </div></div>`).join('') || '<div class="card empty" style="padding:20px">No stage boxes yet.</div>'}
        <datalist id="gmakes">${GearModels.makes().map((m) => '<option value="' + esc(m) + '">').join('')}</datalist>
        <div class="adder"><span class="note">Add</span>${boxModels.map((m, i) => '<button type="button" class="btn" data-addm="' + i + '">' + icon('plus') + esc(m.model) + '</button>').join('')}<button type="button" class="btn" data-addnew>${icon('plus')}New stage box</button></div>
        <p class="note">No stage box? Skip this step: everything plugs straight into the console.</p>`;
    } else if (st.step === 2) {
      body = '<p class="note">Add the rest of the gear you have. Pick what you added before, or type a new make and model; each gets a Gear Locker card you can add a photo, IP and notes to later.</p>' +
        SETUP_GROUPS.map((g) => {
          const list = ofKind(g.kind);
          const chosen = st.other.filter((o) => o.role === g.role);
          const ad = st.adding[g.role] || {};
          return '<div class="ggroup"><b>' + g.title + '</b><div class="gchips">' +
            list.map((m) => {
              const nm = nameFor(m), sel = chosen.find((o) => o.name === nm), on = !!sel;
              return '<label class="tog' + (on ? ' on' : '') + '"><input type="checkbox" data-o="' + esc(nm) + '" data-role="' + g.role + '"' + (on ? ' checked' : '') + '>' + esc(nm) +
                (g.kind === 'receiver' && m.nin ? ' <span class="note">' + m.nin + ' ch</span>' : '') + (known(nm) ? ' <span class="note">(have)</span>' : '') +
                (g.qty && on ? '<span class="qty">×<input type="number" min="1" max="16" data-q="' + esc(nm) + '" value="' + (sel.qty || 1) + '" aria-label="How many ' + esc(nm) + '"></span>' : '') + '</label>';
            }).join('') +
            chosen.filter((o) => o.custom).map((o) => '<span class="chip">' + esc(o.name) + (o.qty > 1 ? ' ×' + o.qty : '') + ' <button type="button" class="ghost" data-orm="' + esc(o.name) + '" style="padding:0 2px">' + icon('x') + '</button></span>').join('') +
            '</div><div class="gnew" data-new="' + g.role + '"><input data-nm="make" placeholder="Make" list="gmakes" value="' + esc(ad.make || '') + '"><input data-nm="model" placeholder="Model" value="' + esc(ad.model || '') + '">' +
            (g.count ? '<input data-nm="count" type="number" min="1" max="64" placeholder="' + g.count[1] + '" title="' + g.count[1] + '" value="' + esc(ad.count || g.count[2]) + '">' : '') +
            '<button type="button" class="btn" data-newadd="' + g.role + '">' + icon('plus') + 'Add</button></div></div>';
        }).join('') + '<datalist id="gmakes">' + GearModels.makes().map((m) => '<option value="' + esc(m) + '">').join('') + '</datalist>';
    } else {
      const cards = [st.console.name, ...st.boxes.map((b) => b.name), ...st.other.flatMap((o) => (o.role === 'wireless' || o.role === 'iem' ? unitNames(o) : [o.name]))];
      const rx = st.other.filter((o) => o.role === 'wireless'), iem = st.other.filter((o) => o.role === 'iem');
      const rxCh = rx.reduce((n, o) => n + (o.ch || 1) * (Number(o.qty) || 1), 0), iemTx = iem.reduce((n, o) => n + (Number(o.qty) || 1), 0);
      const lists = [...st.boxes.map((b) => esc(b.name) + ': ' + b.inputs + ' inputs, ' + b.outputs + ' outputs'), rxCh ? 'Wireless mics: ' + rxCh + ' receiver channels' : '', iemTx ? 'In-ears: ' + iemTx + ' transmitter' + (iemTx === 1 ? '' : 's') : ''].filter(Boolean);
      const fresh = cards.filter((n) => !known(n)), kept = cards.filter((n) => known(n));
      const proc = st.other.filter((o) => o.role === 'processor'), amps = st.other.filter((o) => o.role === 'amp'), spk = st.other.filter((o) => o.role === 'speaker');
      body = `<div class="card" style="margin:0 0 12px"><h2>Gear Locker cards</h2>
          ${fresh.length ? '<p>New: ' + fresh.map((n) => '<span class="chip">' + esc(n) + '</span>').join(' ') + '</p>' : ''}
          ${kept.length ? '<p class="note">Already have: ' + kept.map(esc).join(', ') + ' (kept, input and output counts filled in if missing)</p>' : ''}
          <p class="note">New makes and models go on your list, so next time they are one tap.</p></div>
        <label class="tog ${st.page ? 'on' : ''} gopt"><input type="checkbox" data-opt="page"${st.page ? ' checked' : ''}><span><b>Put it on the stage patch</b><br><span class="note">${lists.length ? lists.join(' · ') + '. Then add your mics and draw the cables.' : 'Draws the console and the rest of your gear on the stage patch.'}</span></span></label>
        <label class="tog ${st.cables ? 'on' : ''} gopt"><input type="checkbox" data-opt="cables"${st.cables ? ' checked' : ''}${proc.length || amps.length ? '' : ' disabled'}><span><b>Wire up the PA</b><br><span class="note">${proc.length || amps.length ? 'A starting point: ' + esc([st.console.name, ...proc.map((x) => x.name), ...amps.map((x) => x.name), ...spk.map((x) => x.name)].join(' → ')) + '. Check it against your rack.' : 'Add a speaker processor or amplifier to get this'}</span></span></label>`;
    }
    app.innerHTML = `<div class="ed gsetup"><div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/gear">Gear Locker</a><span>/</span><span>Guided setup</span></div>
      <h1 class="title" style="font-size:22px;margin:6px 0 10px">Guided equipment setup</h1>
      <div class="gsteps">${STEPS.map((t, i) => '<button type="button" data-step="' + i + '" class="' + (i === st.step ? 'on' : i < st.step ? 'done' : '') + '"><i>' + (i + 1) + '</i>' + t + '</button>').join('')}</div>
      <div class="card">${body}</div>
      <div class="edbar"><span class="note grow"></span>${st.step ? '<button type="button" id="gback">Back</button>' : '<button type="button" id="gcancel">Cancel</button>'}<button class="primary" id="gnext">${st.step === 3 ? 'Create' : 'Next'}</button></div></div>`;
    wire();
  }

  function wire() {
    const ok0 = () => { if (!st.console.model.trim()) { toast('Type the console model', 'bad'); return false; } if (!st.console.name.trim()) st.console.name = st.console.model.trim(); return true; };
    const ok1 = () => { for (const b of st.boxes) { if (!b.model.trim()) { toast('Type the model of each stage box', 'bad'); return false; } if (!b.name.trim()) b.name = b.model.trim(); } return true; };
    $$('[data-step]').forEach((x) => x.addEventListener('click', () => { const to = Number(x.dataset.step); if (to > 0 && st.step === 0 && !ok0()) return; if (to > 1 && st.step === 1 && !ok1()) return; st.step = to; render(); }));
    const back = $('#gback'); if (back) back.addEventListener('click', () => { st.step--; render(); });
    const cancel = $('#gcancel'); if (cancel) cancel.addEventListener('click', () => { location.hash = '#/gear'; });
    $('#gnext').addEventListener('click', () => { if (st.step < 3) { if (st.step === 0 && !ok0()) return; if (st.step === 1 && !ok1()) return; st.step++; render(); } else create(); });
    const pk = $('[data-pick]');
    if (pk) pk.addEventListener('change', () => { Object.assign(st.console, pk.value === '' ? { model: '', make: '', name: '', namelen: '', colors: '' } : fromModel(consoles[Number(pk.value)])); render(); });
    $$('[data-c]').forEach((x) => x.addEventListener('input', () => {
      const k = x.dataset.c;
      const wasName = st.console.name === st.console.model;
      st.console[k] = x.value;
      if (k === 'model' && (wasName || !st.console.name)) { st.console.name = x.value; const n = $('[data-c=name]'); if (n) n.value = x.value; }
      if (k === 'link') st.boxes.forEach((b) => { if (!b.linkTouched) b.link = x.value; });
    }));
    $$('.gbox').forEach((el) => {
      const b = st.boxes[Number(el.dataset.i)];
      el.querySelectorAll('[data-b]').forEach((x) => x.addEventListener('input', () => {
        const k = x.dataset.b;
        const wasName = b.name === b.model;
        if (k === 'link') b.linkTouched = true;
        b[k] = x.value;
        if (k === 'model' && (wasName || !b.name)) { b.name = x.value; const n = el.querySelector('[data-b=name]'); if (n) n.value = x.value; }
      }));
    });
    $$('[data-rm]').forEach((x) => x.addEventListener('click', () => { st.boxes.splice(Number(x.dataset.rm), 1); render(); }));
    $$('[data-addm]').forEach((x) => x.addEventListener('click', () => { addBox(boxModels[Number(x.dataset.addm)]); render(); }));
    $$('[data-addnew]').forEach((x) => x.addEventListener('click', () => { addBox(null); render(); const l = $$('.gbox').pop(); if (l) l.querySelector('[data-b=make]').focus(); }));
    $$('[data-o]').forEach((x) => x.addEventListener('change', () => {
      const g = SETUP_GROUPS.find((y) => y.role === x.dataset.role);
      const m = ofKind(g.kind).find((y) => nameFor(y) === x.dataset.o);
      st.other = st.other.filter((o) => o.name !== x.dataset.o);
      if (x.checked && m) st.other.push({ name: nameFor(m), make: m.make, model: m.model, role: g.role, ch: g.kind === 'receiver' ? m.nin || 1 : undefined, nin: m.nin, nout: m.nout, qty: 1 });
      if (g.qty) render(); else x.closest('.tog').classList.toggle('on', x.checked);
    }));
    $$('[data-q]').forEach((x) => {
      x.addEventListener('click', (e) => e.stopPropagation());
      x.addEventListener('input', () => { const o = st.other.find((y) => y.name === x.dataset.q); if (o) o.qty = Math.max(1, Math.min(16, Number(x.value) || 1)); });
    });
    $$('.gnew').forEach((row) => row.querySelectorAll('[data-nm]').forEach((x) => x.addEventListener('input', () => { const r = row.dataset.new; st.adding[r] = st.adding[r] || {}; st.adding[r][x.dataset.nm] = x.value; })));
    $$('[data-newadd]').forEach((x) => x.addEventListener('click', () => {
      const g = SETUP_GROUPS.find((y) => y.role === x.dataset.newadd);
      const row = x.closest('.gnew');
      const make = row.querySelector('[data-nm=make]').value.trim(), model = row.querySelector('[data-nm=model]').value.trim();
      const cnt = row.querySelector('[data-nm=count]'), n = cnt ? Math.max(1, Number(cnt.value) || g.count[2]) : null;
      if (!model) return toast('Type the model', 'bad');
      const m = { kind: g.kind, make, model }; if (g.count) m[g.count[0]] = n;
      const name = nameFor(m);
      if (st.other.some((o) => o.name === name)) return toast(name + ' is already added', 'bad');
      st.other.push({ name, make, model, role: g.role, custom: true, ch: g.kind === 'receiver' ? n : undefined, nin: m.nin, nout: m.nout, qty: 1 });
      delete st.adding[g.role];
      render();
    }));
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
      const P = PatchCore;
      const colors = String(c.colors || '').split(',').map((x) => x.trim()).filter(Boolean);
      const namelen = Number(c.namelen) >= 1 ? Math.floor(Number(c.namelen)) : undefined;
      // remember every make and model for next time
      const ROLE_KIND = Object.fromEntries(SETUP_GROUPS.map((g) => [g.role, g.kind]));
      await GearModels.add([
        { kind: 'console', make: c.make.trim(), model: c.model.trim(), nin: Number(c.inputs) || 0, nout: Number(c.outputs) || 0, link: c.link.trim(), namelen, colors },
        ...st.boxes.map((b) => ({ kind: 'stagebox', make: b.make.trim(), model: b.model.trim(), nin: Number(b.inputs) || 0, nout: Number(b.outputs) || 0, link: b.link.trim() })),
        ...st.other.filter((o) => o.custom).map((o) => ({ kind: ROLE_KIND[o.role], make: o.make, model: o.model, nin: o.nin, nout: o.nout }))
      ]);
      const ids = {};
      ids[c.name.trim()] = await upsert({ name: c.name.trim(), category: 'audio', make: c.make, model: c.model || c.name, location: c.location, ip: c.ip.trim(), inputs: Number(c.inputs) || 0, outputs: Number(c.outputs) || 0 });
      for (const b of st.boxes) ids[b.name.trim()] = await upsert({ name: b.name.trim(), category: 'audio', make: b.make, model: b.model || b.name, location: b.location, inputs: Number(b.inputs) || 0, outputs: Number(b.outputs) || 0, notes: 'Connected to the ' + c.name + ' over ' + b.link + '.' });
      for (const o of st.other) {
        if (o.role === 'wireless') for (const n of unitNames(o)) ids[n] = await upsert({ name: n, category: 'audio', make: o.make, model: o.model, outputs: o.ch || 0, notes: o.ch ? o.ch + '-channel wireless receiver.' : '' });
        else if (o.role === 'iem') for (const n of unitNames(o)) ids[n] = await upsert({ name: n, category: 'audio', make: o.make, model: o.model, inputs: 2, notes: 'In-ear transmitter.' });
        else ids[o.name] = await upsert({ name: o.name, category: 'audio', make: o.make, model: o.model });
      }
      forgetDevices();
      if (!st.page) { toast('Gear Locker cards ready', 'ok'); location.hash = '#/gear'; return; }
      // put it all on the stage patch drawing (adding to what is there; gear already on it is kept)
      const cur = await get('/api/patch');
      const doc = cur.doc;
      const place = (item) => P.findGear(doc, item.name) || P.addGear(doc, item);
      const con = place({ kind: 'console', name: c.name.trim(), make: c.make, model: c.model || c.name, nin: Number(c.inputs) || 0, nout: Number(c.outputs) || 0, device_id: ids[c.name.trim()], namelen, colors });
      for (const b of st.boxes) {
        const sb = place({ kind: 'stagebox', name: b.name.trim(), make: b.make, model: b.model || b.name, nin: Number(b.inputs) || 0, nout: Number(b.outputs) || 0, device_id: ids[b.name.trim()] });
        if (!doc.cables.some((x) => x.ap === 'link' && ((x.a === sb.id && x.b === con.id) || (x.b === sb.id && x.a === con.id)))) P.connect(doc, sb, 'link', con, 'link', { label: b.link });
      }
      for (const o of st.other) {
        if (o.role === 'wireless') unitNames(o).forEach((n) => place({ kind: 'receiver', name: n, make: o.make, model: o.model, nin: o.ch || 1, device_id: ids[n] }));
        else if (o.role === 'iem') unitNames(o).forEach((n) => place({ kind: 'iemtx', name: n, make: o.make, model: o.model, mode: 'Stereo', device_id: ids[n] }));
      }
      const proc = st.other.filter((o) => o.role === 'processor'), amps = st.other.filter((o) => o.role === 'amp'), spk = st.other.filter((o) => o.role === 'speaker');
      const pg = proc.map((o) => place({ kind: 'processor', name: o.name, make: o.make, model: o.model, nin: o.nin || 2, nout: o.nout || 6, device_id: ids[o.name] }));
      const ag = amps.map((o) => place({ kind: 'amp', name: o.name, make: o.make, model: o.model, nin: o.nin || 2, device_id: ids[o.name] }));
      const sg = spk.map((o) => place({ kind: 'speaker', name: o.name, make: o.make, model: o.model, group: 'Mains' }));
      if (st.cables) {
        // a starting point for the PA: console LR → processor → amps → speakers (check it against the rack)
        const first = pg[0];
        if (first) { con.feeds = { ...(con.feeds || {}), 0: 'LR', 1: 'LR' }; if (con.outs.length > 1) { P.connect(doc, con, 0, first, 0); P.connect(doc, con, 1, first, 1); } }
        ag.forEach((a, i) => { const src = first || con; if (src.outs.length) { P.connect(doc, src, (i * 2) % src.outs.length, a, 0); if (a.ins.length > 1) P.connect(doc, src, (i * 2 + 1) % src.outs.length, a, 1); } });
        sg.forEach((sp, i) => { const a = ag.length ? ag[Math.floor(i / 2) % ag.length] : first; if (a && a.outs.length) P.connect(doc, a, i % a.outs.length, sp, 0); });
      }
      await call('PUT', '/api/patch', { doc, baseVersion: cur.version, note: 'Guided setup' });
      toast('Setup done: now add your mics and draw the cables', 'ok');
      location.hash = '#/patch?edit=1';
    } catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.textContent = 'Create'; }
  }

  render();
}
