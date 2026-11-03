/*
 * Guided equipment setup: console → stage boxes → other gear → review.
 * There is no built-in gear list: you type the make and model (or pick one you added before), and every new
 * one is remembered in your model list. It makes Gear Locker cards named with tag names (FOH SQ-5, SB-A, RX-1…),
 * with what each one is and its input and output counts, and puts the gear on the stage patch drawing,
 * each stage box linked to the console, ready to draw the mics in.
 */
'use strict';

/** The rest of the gear, in three sections. count: the number each unit has (channels, outputs); every row also has How many. */
const SETUP_SECTIONS = [
  { title: 'Wireless', note: 'Wireless mic receivers. The mics themselves are added on the receiver later.', groups: [
    { role: 'wireless', kind: 'receiver', title: 'Wireless receivers', count: ['nin', 'Channels', 1], unit: 'ch' }] },
  { title: 'In-ears', note: 'In-ear transmitters. Packs and who wears them are added later.', groups: [
    { role: 'iem', kind: 'iemtx', title: 'In-ear transmitters' }] },
  { title: 'PA', note: 'From the console to the speakers.', groups: [
    { role: 'processor', kind: 'processor', title: 'Speaker processors', count: ['nout', 'Outputs', 6], unit: 'out' },
    { role: 'amp', kind: 'amp', title: 'Amplifiers', count: ['nin', 'Channels', 2], unit: 'ch' },
    { role: 'speaker', kind: 'speaker', title: 'Speakers' }] }
];
const SETUP_GROUPS = SETUP_SECTIONS.flatMap((s) => s.groups);

async function viewGearSetup(qs) {
  if (!can('admin')) { app.innerHTML = '<div class="card empty">Admins can run the guided setup.</div>'; if (!S.state.user) signInDialog(() => route()); return; }
  setTitle('Guided setup');
  // it runs once; after that it runs again only from Admin › Equipment setup
  const gs = S.state.gearSetup || {};
  if (gs.done && !(qs && qs.get('again'))) {
    app.innerHTML = '<div class="card empty">' + icon('spark') + '<div style="margin-top:8px"><b>The guided setup has already been run' + (gs.at ? ' (' + esc(new Date(gs.at).toLocaleDateString()) + (gs.by ? ' by ' + esc(gs.by) : '') + ')' : '') + '.</b></div>' +
      '<div class="note" style="margin:4px 0 12px">Add gear in the Gear Locker or on the stage patch, or run it again from Admin › Equipment setup.</div><a class="btn" href="#/gear">' + icon('box') + 'Gear Locker</a> <a class="btn" href="#/admin/setup">' + icon('spark') + 'Equipment setup</a></div>';
    return;
  }
  const [have, models] = await Promise.all([loadDevices(true), GearModels.load(true)]);
  const ofKind = (k) => models.filter((m) => m.kind === k);
  const haveOf = (k) => have.filter((d) => d.kind === k);
  const consoles = ofKind('console'), boxModels = ofKind('stagebox');
  const lc = (s) => String(s || '').trim().toLowerCase();
  const findModel = (kind, model) => ofKind(kind).find((m) => lc(m.model) === lc(model));
  const blankConsole = { model: '', make: '', name: '', location: 'FOH', ip: '', inputs: 16, outputs: 12, link: 'SLink', namelen: '', colors: '' };
  const fromModel = (m) => ({ model: m.model, make: m.make, inputs: m.nin != null ? m.nin : 16, outputs: m.nout != null ? m.nout : 12, link: m.link || 'SLink', namelen: m.namelen || '', colors: (m.colors || []).join(', ') });
  const st = { step: 0, console: { ...blankConsole, ...(consoles[0] ? fromModel(consoles[0]) : {}) }, boxes: [], other: [], page: true, cables: true, adding: {} };
  // a console already in the Gear Locker is used again (not made twice)
  const existingConsole = haveOf('console')[0] || have.find((d) => consoles.some((c) => lc(c.model) === lc(d.model || d.name)));
  if (existingConsole) Object.assign(st.console, { useId: existingConsole.id, name: existingConsole.name, make: existingConsole.make || st.console.make, model: existingConsole.model || st.console.model, location: existingConsole.location || 'FOH', inputs: existingConsole.inputs || st.console.inputs, outputs: existingConsole.outputs || st.console.outputs });
  const STEPS = ['Console', 'Stage boxes', 'Other gear', 'Review'];
  const byName = (name) => have.find((d) => lc(d.name) === lc(name));

  /**
   * Every card this run makes, with its tag name: the console, the stage boxes, then each unit of the other gear.
   * A name typed in stays; an empty one gets the next free tag (never one already in the Gear Locker or made earlier in this run).
   */
  function plan() {
    const taken = have.map((d) => d.name);
    const take = (n) => { taken.push(n); return n; };
    const c = st.console;
    const out = { console: null, boxes: [], other: [] };
    out.console = c.useId ? { name: c.name, id: c.useId, kept: true } : { name: take(c.name.trim() || Tags.suggest('console', taken, { model: c.model.trim() })) };
    for (const b of st.boxes) out.boxes.push({ b, name: take(b.name.trim() || Tags.suggest('stagebox', taken)) });
    for (const o of st.other) for (let i = 0; i < o.qty; i++) out.other.push({ o, name: take(Tags.suggest(o.kind, taken)) });
    return out;
  }

  function addBox(m) {
    st.boxes.push(m
      ? { model: m.model, make: m.make, name: '', location: st.boxes.length ? 'Stage right' : 'Stage', link: m.link || st.console.link || 'SLink', inputs: m.nin != null ? m.nin : 16, outputs: m.nout != null ? m.nout : 8 }
      : { model: '', make: '', name: '', location: 'Stage', link: st.console.link || 'SLink', inputs: 16, outputs: 8 });
  }

  /** What one row adds: "Shure SLXD4D ×2 · 2 ch". */
  const chipText = (o) => [o.make, o.model].filter(Boolean).join(' ') + (o.qty > 1 ? ' ×' + o.qty : '') + (o.n && o.unit ? ' · ' + o.n + ' ' + o.unit : '');
  const makesList = () => '<datalist id="gmakes">' + GearModels.makes().map((m) => '<option value="' + esc(m) + '">').join('') + '</datalist>';
  const haveList = (kinds) => { const h = have.filter((d) => kinds.includes(d.kind)); return h.length ? '<div class="gs-have">' + icon('box') + '<span>Already in the Gear Locker: ' + h.map((d) => '<b>' + esc(Tags.withModel(d.name, d.model)) + '</b>').join(', ') + '</span></div>' : ''; };

  function render() {
    const sv = (o, k) => esc(o[k] == null ? '' : o[k]);
    const p = plan();
    let body = '';
    if (st.step === 0) {
      const c = st.console;
      body = c.useId
        ? `<p class="note">The console already in the Gear Locker is used: <b>${esc(Tags.withModel(c.name, c.model))}</b>. Its card is kept; missing input and output counts are filled in.</p>
          <div class="gform">
            <label>Local inputs<input data-c="inputs" type="number" min="0" value="${sv(c, 'inputs')}"></label>
            <label>Local outputs<input data-c="outputs" type="number" min="0" value="${sv(c, 'outputs')}"></label>
            <label>Link to stage boxes<input data-c="link" value="${sv(c, 'link')}" placeholder="SLink, AES50, Dante"></label>
          </div><button type="button" class="linkbtn gs-other" id="gsNewCon">Set up a different console instead</button>`
        : `<p class="note">Start with the mixing console. ${consoles.length ? 'Pick one you added before, or type a new make and model.' : 'Type its make and model: LiveGenie remembers it for next time.'}</p>
        ${consoles.length ? '<label class="gpick">From your list<select data-pick><option value="">New console…</option>' + consoles.map((m, i) => '<option value="' + i + '"' + (m.model === c.model && m.make === c.make ? ' selected' : '') + '>' + esc([m.make, m.model].filter(Boolean).join(' ')) + '</option>').join('') + '</select></label>' : ''}
        <div class="gform">
          <label>Make<input data-c="make" value="${sv(c, 'make')}" placeholder="Manufacturer" list="gmakes"></label>
          <label>Model<input data-c="model" value="${sv(c, 'model')}" placeholder="Model number"></label>
          <label>Tag name<span class="gs-tag"><input data-c="name" value="${sv(c, 'name')}" placeholder="${esc(p.console.name)}"><button type="button" class="btn" data-auto="console">Auto label</button></span></label>
          <label>Location<input data-c="location" value="${sv(c, 'location')}" placeholder="FOH"></label>
          <label>Local inputs<input data-c="inputs" type="number" min="0" value="${sv(c, 'inputs')}"></label>
          <label>Local outputs<input data-c="outputs" type="number" min="0" value="${sv(c, 'outputs')}"></label>
          <label>Link to stage boxes<input data-c="link" value="${sv(c, 'link')}" placeholder="SLink, AES50, Dante"></label>
          <label>IP address<input data-c="ip" class="mono" inputmode="decimal" value="${sv(c, 'ip')}" placeholder="optional"></label>
          <label>Channel name: most letters<input data-c="namelen" type="number" min="0" max="64" value="${sv(c, 'namelen')}" placeholder="no limit"></label>
          <label class="wide2">Channel colours <span class="note">(the ones the desk has, comma between)</span><input data-c="colors" value="${sv(c, 'colors')}" placeholder="Red, Green, Yellow, Blue, Purple, Cyan, White"></label>
        </div>${makesList()}
        <p class="note">Leave the tag name empty and it is named ${esc(p.console.name)}.</p>`;
    } else if (st.step === 1) {
      body = `<p class="note">Add each stage box. LiveGenie adds it to the stage patch, linked to the ${esc(p.console.name)}. Which console channel each box input lands on is up to you: assign them in the stage patch.</p>
        ${haveList(['stagebox'])}
        ${st.boxes.map((b, i) => `<div class="gs-box" data-i="${i}"><div class="gs-boxh"><b>${esc(Tags.withModel(p.boxes[i].name, b.model) || 'Stage box ' + (i + 1))}</b><button type="button" class="ghost danger" data-rm="${i}" title="Remove">${icon('x')}</button></div><div class="gform">
          <label>Make<input data-b="make" value="${sv(b, 'make')}" placeholder="Manufacturer" list="gmakes"></label>
          <label>Model<input data-b="model" value="${sv(b, 'model')}" placeholder="Model number"></label>
          <label>Tag name<span class="gs-tag"><input data-b="name" value="${sv(b, 'name')}" placeholder="${esc(p.boxes[i].name)}"><button type="button" class="btn" data-auto="box">Auto label</button></span></label>
          <label>Location<input data-b="location" value="${sv(b, 'location')}"></label>
          <label>Link to console<input data-b="link" value="${sv(b, 'link')}"></label>
          <label>Inputs<input data-b="inputs" type="number" min="0" max="128" value="${sv(b, 'inputs')}"></label>
          <label>Outputs<input data-b="outputs" type="number" min="0" max="128" value="${sv(b, 'outputs')}"></label>
        </div></div>`).join('') || '<div class="card empty" style="padding:20px">No stage boxes added.</div>'}
        ${makesList()}
        <div class="adder"><span class="note">Add</span>${boxModels.map((m, i) => '<button type="button" class="btn" data-addm="' + i + '">' + icon('plus') + esc([m.make, m.model].filter(Boolean).join(' ')) + '</button>').join('')}<button type="button" class="btn" data-addnew>${icon('plus')}New stage box</button></div>
        <p class="note">No stage box? Skip this step: everything plugs straight into the console.</p>`;
    } else if (st.step === 2) {
      body = '<p class="note">Add the rest of the gear you have. Pick a model you added before or type a new make and model, set how many, then Add. Each unit gets its own Gear Locker card with a tag name; add photos, IPs and notes later.</p>' +
        SETUP_SECTIONS.map((sec) => '<section class="gs-sec"><h3>' + sec.title + '</h3><p class="note">' + sec.note + '</p>' + haveList(sec.groups.map((g) => g.kind)) +
          sec.groups.map((g) => {
            const chosen = st.other.filter((o) => o.role === g.role);
            const ad = st.adding[g.role] || {};
            const picks = ofKind(g.kind);
            return '<div class="gs-grp" data-role="' + g.role + '"><div class="gs-grph">' + g.title + '</div>' +
              (chosen.length ? '<div class="gs-chips">' + chosen.map((o) => '<span class="gs-chip">' + esc(chipText(o)) + '<button type="button" data-orm="' + esc(o.key) + '" title="Remove">' + icon('x') + '</button></span>').join('') + '</div>' : '') +
              (picks.length ? '<div class="gs-picks"><span class="note">Your list:</span>' + picks.map((m, i) => '<button type="button" class="gs-pick" data-pk="' + i + '">' + esc([m.make, m.model].filter(Boolean).join(' ')) + (g.count && m[g.count[0]] ? ' · ' + m[g.count[0]] + ' ' + g.unit : '') + '</button>').join('') + '</div>' : '') +
              '<div class="gs-row">' +
                '<label class="gs-f">Make<input data-nm="make" placeholder="Manufacturer" list="gmakes" value="' + esc(ad.make || '') + '"></label>' +
                '<label class="gs-f">Model<input data-nm="model" placeholder="Model number" list="gm-' + g.role + '" value="' + esc(ad.model || '') + '"></label>' +
                (g.count ? '<label class="gs-f gs-n">' + g.count[1] + '<input data-nm="count" type="number" min="1" max="64" inputmode="numeric" value="' + esc(ad.count || g.count[2]) + '"></label>' : '') +
                '<label class="gs-f gs-n">How many<input data-nm="qty" type="number" min="1" max="32" inputmode="numeric" value="' + esc(ad.qty || 1) + '"></label>' +
                '<button type="button" class="btn gs-add" data-newadd="' + g.role + '">' + icon('plus') + 'Add</button>' +
              '</div><datalist id="gm-' + g.role + '">' + picks.map((m) => '<option value="' + esc(m.model) + '">' + esc(m.make || '') + '</option>').join('') + '</datalist></div>';
          }).join('') + '</section>').join('') + makesList();
    } else {
      const c = st.console;
      const rx = st.other.filter((o) => o.role === 'wireless'), iem = st.other.filter((o) => o.role === 'iem');
      const rxCh = rx.reduce((n, o) => n + (o.n || 1) * o.qty, 0), iemTx = iem.reduce((n, o) => n + o.qty, 0);
      const lists = [...p.boxes.map((x) => esc(x.name) + ': ' + x.b.inputs + ' inputs, ' + x.b.outputs + ' outputs'), rxCh ? 'Wireless mics: ' + rxCh + ' receiver channels' : '', iemTx ? 'In-ears: ' + iemTx + ' transmitter' + (iemTx === 1 ? '' : 's') : ''].filter(Boolean);
      const row = (name, model, what) => '<li><b>' + esc(Tags.withModel(name, model)) + '</b><span>' + esc(what) + '</span></li>';
      const groups = [
        ['Console', [p.console.kept ? '' : row(p.console.name, c.model, 'Console')]],
        ['Stage boxes', p.boxes.map((x) => row(x.name, x.b.model, x.b.inputs + ' in · ' + x.b.outputs + ' out'))],
        ...SETUP_GROUPS.map((g) => [g.title, p.other.filter((x) => x.o.role === g.role).map((x) => row(x.name, x.o.model, [x.o.make, x.o.n && g.unit ? x.o.n + ' ' + g.unit : ''].filter(Boolean).join(' · ')))])
      ].filter((g) => g[1].join(''));
      const total = groups.reduce((n, g) => n + g[1].filter(Boolean).length, 0);
      const proc = p.other.filter((x) => x.o.role === 'processor'), amps = p.other.filter((x) => x.o.role === 'amp'), spk = p.other.filter((x) => x.o.role === 'speaker');
      body = `<div class="gs-review"><h2>${total ? total + ' new Gear Locker card' + (total === 1 ? '' : 's') : 'No new Gear Locker cards'}</h2>
          ${p.console.kept ? '<p class="note">Using the console already there: ' + esc(Tags.withModel(p.console.name, c.model)) + '.</p>' : ''}
          ${groups.map((g) => '<div class="gs-rg"><div class="gs-grph">' + g[0] + '</div><ul>' + g[1].join('') + '</ul></div>').join('')}
          <p class="note">Tag names can be changed on each card later. New makes and models go on your list, so next time they are one tap.</p></div>
        <label class="tog ${st.page ? 'on' : ''} gopt"><input type="checkbox" data-opt="page"${st.page ? ' checked' : ''}><span><b>Put it on the stage patch</b><br><span class="note">${lists.length ? lists.join(' · ') + '. Then add your mics and draw the cables.' : 'Draws the console and the rest of your gear on the stage patch.'}</span></span></label>
        <label class="tog ${st.cables ? 'on' : ''} gopt"><input type="checkbox" data-opt="cables"${st.cables ? ' checked' : ''}${proc.length || amps.length ? '' : ' disabled'}><span><b>Wire up the PA</b><br><span class="note">${proc.length || amps.length ? 'A starting point: ' + esc([p.console.name, ...proc.map((x) => x.name), ...amps.map((x) => x.name), ...spk.map((x) => x.name)].join(' → ')) + '. Check it against your rack.' : 'Add a speaker processor or amplifier to get this'}</span></span></label>`;
    }
    app.innerHTML = `<div class="ed gsetup"><div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/admin/setup">Equipment setup</a><span>/</span><span>Guided setup</span></div>
      <h1 class="title" style="font-size:22px;margin:6px 0 10px">Guided equipment setup</h1>
      <div class="gsteps">${STEPS.map((t, i) => '<button type="button" data-step="' + i + '" class="' + (i === st.step ? 'on' : i < st.step ? 'done' : '') + '"><i>' + (i + 1) + '</i>' + t + '</button>').join('')}</div>
      <div class="card">${body}</div>
      <div class="edbar"><span class="note grow"></span>${st.step ? '<button type="button" id="gback">Back</button>' : '<button type="button" id="gcancel">Cancel</button>'}<button class="primary" id="gnext">${st.step === 3 ? 'Create' : 'Next'}</button></div></div>`;
    wire();
  }

  /** A typed tag name must not be one another card already uses. */
  const clash = (name, mine) => { const d = byName(name); return d && d.id !== mine ? d : null; };

  function wire() {
    const ok0 = () => {
      const c = st.console;
      if (!c.useId && !c.model.trim()) { toast('Type the console model', 'bad'); return false; }
      if (!c.useId && c.name.trim() && clash(c.name)) { toast('“' + c.name.trim() + '” is already a card in the Gear Locker. Pick another tag name.', 'bad'); return false; }
      return true;
    };
    const ok1 = () => {
      for (const b of st.boxes) {
        if (!b.model.trim()) { toast('Type the model of each stage box', 'bad'); return false; }
        if (b.name.trim() && clash(b.name)) { toast('“' + b.name.trim() + '” is already a card in the Gear Locker. Pick another tag name.', 'bad'); return false; }
      }
      const names = st.boxes.map((b) => lc(b.name)).filter(Boolean);
      if (new Set(names).size !== names.length) { toast('Two stage boxes have the same tag name', 'bad'); return false; }
      return true;
    };
    $$('[data-step]').forEach((x) => x.addEventListener('click', () => { const to = Number(x.dataset.step); if (to > 0 && st.step === 0 && !ok0()) return; if (to > 1 && st.step === 1 && !ok1()) return; st.step = to; render(); }));
    const back = $('#gback'); if (back) back.addEventListener('click', () => { st.step--; render(); });
    const cancel = $('#gcancel'); if (cancel) cancel.addEventListener('click', () => { location.hash = '#/gear'; });
    $('#gnext').addEventListener('click', () => { if (st.step < 3) { if (st.step === 0 && !ok0()) return; if (st.step === 1 && !ok1()) return; st.step++; render(); } else create(); });
    const nc = $('#gsNewCon'); if (nc) nc.addEventListener('click', () => { Object.assign(st.console, { ...blankConsole, useId: null, name: '' }); render(); });
    const pk = $('[data-pick]');
    if (pk) pk.addEventListener('change', () => { Object.assign(st.console, pk.value === '' ? { model: '', make: '', namelen: '', colors: '' } : fromModel(consoles[Number(pk.value)])); render(); });
    $$('[data-c]').forEach((x) => x.addEventListener('input', () => {
      st.console[x.dataset.c] = x.value;
      if (x.dataset.c === 'link') st.boxes.forEach((b) => { if (!b.linkTouched) b.link = x.value; });
      if (x.dataset.c === 'model') { const n = $('[data-c=name]'); if (n) n.placeholder = plan().console.name; }
    }));
    $$('[data-auto]').forEach((x) => x.addEventListener('click', () => {
      // fill the tag name with the suggestion (it is the placeholder until something is typed)
      if (x.dataset.auto === 'console') { st.console.name = ''; st.console.name = plan().console.name; }
      else { const i = Number(x.closest('.gs-box').dataset.i); st.boxes[i].name = ''; st.boxes[i].name = plan().boxes[i].name; }
      render();
    }));
    $$('.gs-box').forEach((el) => {
      const b = st.boxes[Number(el.dataset.i)];
      el.querySelectorAll('[data-b]').forEach((x) => x.addEventListener('input', () => {
        if (x.dataset.b === 'link') b.linkTouched = true;
        b[x.dataset.b] = x.value;
        if (x.dataset.b === 'model') { const m = findModel('stagebox', x.value); if (m) { if (!b.make && m.make) { b.make = m.make; el.querySelector('[data-b=make]').value = m.make; } } }
      }));
    });
    $$('[data-rm]').forEach((x) => x.addEventListener('click', () => { st.boxes.splice(Number(x.dataset.rm), 1); render(); }));
    $$('[data-addm]').forEach((x) => x.addEventListener('click', () => { addBox(boxModels[Number(x.dataset.addm)]); render(); }));
    $$('[data-addnew]').forEach((x) => x.addEventListener('click', () => { addBox(null); render(); const l = $$('.gs-box').pop(); if (l) l.querySelector('[data-b=make]').focus(); }));
    // other gear: a model from your list fills the row; typing a known model fills its make and count
    $$('.gs-grp').forEach((grp) => {
      const g = SETUP_GROUPS.find((y) => y.role === grp.dataset.role);
      const ad = () => (st.adding[g.role] = st.adding[g.role] || {});
      const fill = (m) => {
        const a = ad();
        if (m.make) a.make = m.make;
        a.model = m.model;
        if (g.count && m[g.count[0]]) a.count = m[g.count[0]];
        grp.querySelector('[data-nm=make]').value = a.make || '';
        grp.querySelector('[data-nm=model]').value = a.model;
        const cn = grp.querySelector('[data-nm=count]'); if (cn && a.count) cn.value = a.count;
      };
      grp.querySelectorAll('[data-nm]').forEach((x) => x.addEventListener('input', () => {
        ad()[x.dataset.nm] = x.value;
        if (x.dataset.nm === 'model') { const m = findModel(g.kind, x.value); if (m) fill(m); }
      }));
      grp.querySelectorAll('[data-pk]').forEach((x) => x.addEventListener('click', () => { fill(ofKind(g.kind)[Number(x.dataset.pk)]); grp.querySelector('[data-nm=qty]').focus(); }));
    });
    $$('[data-newadd]').forEach((x) => x.addEventListener('click', () => {
      const g = SETUP_GROUPS.find((y) => y.role === x.dataset.newadd);
      const row = x.closest('.gs-grp');
      const make = row.querySelector('[data-nm=make]').value.trim(), model = row.querySelector('[data-nm=model]').value.trim();
      const cnt = row.querySelector('[data-nm=count]');
      const n = g.count ? Math.max(1, Math.min(64, Number(cnt.value) || g.count[2])) : null;
      const qty = Math.max(1, Math.min(32, Number(row.querySelector('[data-nm=qty]').value) || 1));
      if (!model) return toast('Type the model', 'bad');
      // the same make, model and count again adds to how many
      const same = st.other.find((o) => o.role === g.role && lc(o.make) === lc(make) && lc(o.model) === lc(model) && (o.n || null) === n);
      if (same) same.qty = Math.min(32, same.qty + qty);
      else st.other.push({ key: g.role + ':' + Date.now() + ':' + st.other.length, role: g.role, kind: g.kind, make, model, n, unit: g.unit, qty });
      delete st.adding[g.role];
      render();
    }));
    $$('[data-orm]').forEach((x) => x.addEventListener('click', () => { st.other = st.other.filter((o) => o.key !== x.dataset.orm); render(); }));
    $$('[data-opt]').forEach((x) => x.addEventListener('change', () => { st[x.dataset.opt] = x.checked; x.closest('.tog').classList.toggle('on', x.checked); }));
  }

  async function create() {
    const btn = $('#gnext'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const c = st.console;
      const P = PatchCore;
      const p = plan();
      const colors = String(c.colors || '').split(',').map((x) => x.trim()).filter(Boolean);
      const namelen = Number(c.namelen) >= 1 ? Math.floor(Number(c.namelen)) : undefined;
      const cnt = (o, which) => { const g = SETUP_GROUPS.find((y) => y.role === o.role); return g.count && g.count[0] === which ? o.n : undefined; };
      // remember every make and model (and its channel or output count) for next time
      await GearModels.add([
        c.model.trim() ? { kind: 'console', make: c.make.trim(), model: c.model.trim(), nin: Number(c.inputs) || 0, nout: Number(c.outputs) || 0, link: c.link.trim(), namelen, colors } : null,
        ...st.boxes.map((b) => ({ kind: 'stagebox', make: b.make.trim(), model: b.model.trim(), nin: Number(b.inputs) || 0, nout: Number(b.outputs) || 0, link: b.link.trim() })),
        ...st.other.map((o) => ({ kind: o.kind, make: o.make, model: o.model, nin: cnt(o, 'nin'), nout: cnt(o, 'nout') }))
      ].filter(Boolean));
      const post = async (d) => (await call('POST', '/api/devices', { category: 'audio', ...d })).id;
      let conId;
      if (p.console.kept) {
        conId = c.useId;
        const full = (await get('/api/devices/' + conId)).device;
        if (!full.inputs || !full.outputs || !full.kind) await call('PUT', '/api/devices/' + conId, { ...full, kind: full.kind || 'console', inputs: full.inputs || Number(c.inputs) || 0, outputs: full.outputs || Number(c.outputs) || 0 });
      } else conId = await post({ name: p.console.name, kind: 'console', make: c.make.trim(), model: c.model.trim(), location: c.location, ip: c.ip.trim(), inputs: Number(c.inputs) || 0, outputs: Number(c.outputs) || 0 });
      const boxIds = [];
      for (const x of p.boxes) boxIds.push(await post({ name: x.name, kind: 'stagebox', make: x.b.make.trim(), model: x.b.model.trim(), location: x.b.location, inputs: Number(x.b.inputs) || 0, outputs: Number(x.b.outputs) || 0, notes: 'Connected to ' + p.console.name + ' over ' + x.b.link + '.' }));
      const otherIds = [];
      for (const x of p.other) {
        const o = x.o, d = { name: x.name, kind: o.kind, make: o.make, model: o.model };
        if (o.kind === 'receiver') Object.assign(d, { outputs: o.n || 1, notes: (o.n || 1) + '-channel wireless receiver.' });
        else if (o.kind === 'iemtx') Object.assign(d, { inputs: 2 });
        else if (o.kind === 'processor') Object.assign(d, { inputs: 2, outputs: o.n || 6 });
        else if (o.kind === 'amp') Object.assign(d, { inputs: o.n || 2, outputs: o.n || 2 });
        otherIds.push(await post(d));
      }
      forgetDevices();
      try { await call('POST', '/api/admin/gear-setup'); await loadState(); } catch (e) { /* the gear is made either way */ }
      if (!st.page) { toast('Gear Locker cards ready', 'ok'); location.hash = '#/gear'; return; }
      // put it all on the stage patch drawing (adding to what is there; gear already on it is kept)
      const cur = await get('/api/patch');
      const doc = cur.doc;
      const place = (item) => (item.device_id && doc.gear.find((g) => g.device_id === item.device_id)) || P.findGear(doc, item.name) || P.addGear(doc, item);
      const con = place({ kind: 'console', name: p.console.name, make: c.make, model: c.model, nin: Number(c.inputs) || 0, nout: Number(c.outputs) || 0, device_id: conId, namelen, colors });
      p.boxes.forEach((x, i) => {
        const sb = place({ kind: 'stagebox', name: x.name, make: x.b.make, model: x.b.model, nin: Number(x.b.inputs) || 0, nout: Number(x.b.outputs) || 0, device_id: boxIds[i] });
        if (!doc.cables.some((k) => k.ap === 'link' && ((k.a === sb.id && k.b === con.id) || (k.b === sb.id && k.a === con.id)))) P.connect(doc, sb, 'link', con, 'link', { label: x.b.link });
      });
      const pg = [], ag = [], sg = [];
      p.other.forEach((x, i) => {
        const o = x.o, base = { name: x.name, make: o.make, model: o.model, device_id: otherIds[i] };
        if (o.kind === 'receiver') place({ ...base, kind: 'receiver', nin: o.n || 1 });
        else if (o.kind === 'iemtx') place({ ...base, kind: 'iemtx', mode: 'Stereo' });
        else if (o.kind === 'processor') pg.push(place({ ...base, kind: 'processor', nin: 2, nout: o.n || 6 }));
        else if (o.kind === 'amp') ag.push(place({ ...base, kind: 'amp', nin: o.n || 2 }));
        else if (o.kind === 'speaker') sg.push(place({ ...base, kind: 'speaker', group: 'Mains' }));
      });
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
