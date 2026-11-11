/* LiveGenie: racks. A front elevation of each rack, drawn to scale, with the gear in it (Gear Locker cards),
 * panels (blank, vent, shelf, drawer), the rack photo lined up to the rails (each piece glows in its spot), and power.
 * Admins arrange it: drag a card in from the list (or tap it, then tap a slot), drag a piece to move it, drag its bottom edge
 * to make it taller. Everything is checked (nothing overlaps, nothing runs off the bottom) and saved as you go. */

const RK = { UH: 26, W: 380, RAIL: 30 };

async function viewRacks() {
  setTitle('Racks');
  const { racks } = await get('/api/racks');
  app.innerHTML = `<div class="page racks">
    <div class="crumbs"><a href="#/">Home</a><span>/</span></div>
    <div class="bar"><div class="grow"><h1 class="title" style="font-size:22px;letter-spacing:.06em;margin:4px 0 2px">RACKS</h1>
      <div class="note">What sits where in each rack, its photo, and what plugs into which outlet.</div></div>
      ${can('admin') ? '<button class="primary btn" id="rkNew">' + icon('plus') + 'New rack</button>' : ''}</div>
    <div class="rkgrid">${racks.length ? racks.map((r) => '<a class="rkcard" href="#/racks/' + r.id + '"><div class="rkthumb">' + (r.photo ? '<img src="/uploads/' + esc(r.photo) + '" alt="" loading="lazy">' : rackMini(r)) + '</div>' +
      '<div class="t"><b>' + esc(r.name) + '</b><span>' + r.units + 'U · ' + r.used + ' of ' + r.units + ' U used' + (r.gear ? ' · ' + r.gear + ' piece' + (r.gear === 1 ? '' : 's') + ' of gear' : '') + '</span>' +
      '<span class="dmeta">' + [r.location ? icon('pin') + esc(r.location) : '', r.watts ? icon('plug') + r.watts + ' W' : ''].filter(Boolean).join('<i>·</i>') + '</span></div></a>').join('')
      : '<div class="card empty">No racks yet.' + (can('admin') ? ' Make one, give it a photo, then place the gear from the Gear Locker in it.' : '') + '</div>'}</div></div>`;
  const nb = $('#rkNew'); if (nb) nb.addEventListener('click', () => rackDialog(null));
}

/** A little drawing of a rack with no photo yet. */
function rackMini(r) {
  const n = Math.min(r.units, 24);
  return '<svg viewBox="0 0 60 ' + (n * 5 + 8) + '" class="rkminisvg"><rect x="2" y="2" width="56" height="' + (n * 5 + 4) + '" rx="3"/>' +
    Array.from({ length: n }, (_, k) => '<line x1="8" x2="52" y1="' + (6 + k * 5) + '" y2="' + (6 + k * 5) + '"/>').join('') + '</svg>';
}

/** New rack, or change its name, size, location and notes. */
function rackDialog(rk) {
  modal('<h3>' + (rk ? 'Rack details' : 'New rack') + '</h3><form id="rkf"><label>Name</label><input id="rkn" value="' + esc(rk ? rk.name : '') + '" placeholder="Like Rack AV-102" maxlength="60">' +
    '<label>Size</label><select id="rku">' + Array.from({ length: 60 }, (_, k) => k + 1).map((u) => '<option value="' + u + '"' + ((rk ? rk.units : 12) === u ? ' selected' : '') + '>' + u + 'U</option>').join('') + '</select>' +
    '<label>Where it is</label><input id="rkl" value="' + esc(rk ? rk.location : '') + '" placeholder="Booth, stage left, closet…" maxlength="80">' +
    '<label>Notes</label><textarea id="rkt" rows="3" placeholder="Anything a volunteer should know">' + esc(rk ? rk.notes : '') + '</textarea>' +
    '<div class="acts">' + (rk ? '<button type="button" class="ghost danger" id="rkdel">Delete rack</button><span class="grow"></span>' : '') + '<button type="button" data-close>Cancel</button><button class="primary">' + (rk ? 'Save' : 'Make the rack') + '</button></div></form>', (w, close) => {
    $('#rkf', w).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: $('#rkn', w).value, units: Number($('#rku', w).value), location: $('#rkl', w).value, notes: $('#rkt', w).value };
      try {
        if (rk) { await call('PUT', '/api/racks/' + rk.id, body); close(); toast('Saved', 'ok'); route(); }
        else { const r = await call('POST', '/api/racks', body); close(); location.hash = '#/racks/' + r.id; }
      } catch (err) { toast(err.message, 'bad'); }
    });
    const del = $('#rkdel', w);
    if (del) del.addEventListener('click', async () => {
      if (!await confirmBox('Delete ' + rk.name + '?', 'The gear in it stays in the Gear Locker; it just is not in a rack any more.', 'Delete', true)) return;
      try { await call('DELETE', '/api/racks/' + rk.id); close(); toast('Rack deleted', 'ok'); location.hash = '#/racks'; } catch (err) { toast(err.message, 'bad'); }
    });
  });
}

/** A rack. View mode by default (look, step through the photo, print); #/racks/ID/edit is edit mode, for admins. */
async function viewRack(id, mode) {
  let data;
  try { data = await get('/api/racks/' + id); }
  catch (e) { if (e.status === 404) { app.innerHTML = '<div class="card empty"><b>That rack is not here any more.</b><div style="margin-top:12px"><a class="btn" href="#/racks">Racks</a></div></div>'; return; } throw e; }
  await loadDevices(true);
  const canEdit = can('admin');
  // everything that changes the rack is only there in edit mode
  const admin = canEdit && mode === 'edit';
  let rack = data.rack;
  setTitle(rack.name);
  // the layout as it is being arranged
  let items = rack.items.map((x) => ({ ...x }));
  let gear = data.gear.map((g) => ({ id: g.id, u: g.rack_u, h: g.rack_h || 1, side: g.rack_side || '', shelf: g.shelf_id || '' }));
  const card = (gid) => (DEV.list || []).find((d) => d.id === gid) || data.gear.find((d) => d.id === gid) || { id: gid, name: 'Gear', model: '' };
  let sel = null;          // { kind: 'gear'|'item', id }
  let pending = null;      // a card waiting to be tapped into a slot: { id, h, side }
  let pendH = 1;

  app.innerHTML = `<div class="page rack">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/racks">Racks</a></div>
    <div class="bar"><div class="grow"><h1 class="title">${esc(rack.name)}</h1><div class="meta" style="margin:0"><span class="chip">${rack.units}U</span>${rack.location ? '<span>' + icon('pin') + esc(rack.location) + '</span>' : ''}<span id="rkuse"></span></div></div>
      ${admin ? '<button class="btn" id="rkEd">' + icon('edit') + 'Details</button><button class="btn" id="rkPh">' + icon('image') + (rack.photo ? 'Photo' : 'Add photo') + '</button>' : ''}
      ${admin ? '' : '<button class="btn" id="rkPr">' + icon('pdf') + 'Print</button>'}
      ${admin ? '<button class="btn primary" id="rkDone">' + icon('check') + 'Done</button>' : canEdit ? '<a class="btn primary" href="#/racks/' + rack.id + '/edit">' + icon('edit') + 'Edit</a>' : ''}</div>
    ${admin ? '<div class="rkmode note">Editing: changes save as you go. Tap <b>Done</b> when you are finished.</div>' : ''}
    ${rack.notes ? '<div class="doc rknotes">' + md(rack.notes) + '</div>' : ''}
    <div class="rkmain">
      <div class="rkcol"><div class="rkhd"><h2>Front</h2><span class="note" id="rkst"></span></div>
        ${admin ? '<div class="rktools" id="rktools"><span class="note">Add:</span>' + Object.entries(RackCore.ITEM_TYPES).filter(([k]) => !/^patch/.test(k)).map(([k, l]) => '<button class="btn sm" data-add="' + k + '">' + esc(k === 'custom' ? 'Custom…' : l.replace(' panel', '')) + '</button>').join('') +
          '<select class="btn sm rkpsel" id="rkpatch" aria-label="Add a patch panel"><option value="">Patch panel…</option><option value="patch">Network (RJ45)</option><option value="patchaudio">Audio (XLR / TRS)</option><option value="patchav">AV / video (BNC, HDMI)</option></select>' + '<span class="rksep"></span><button class="btn sm" data-new="network">' + icon('plus') + 'Network switch</button><button class="btn sm" data-new="power">' + icon('plus') + 'Power strip</button></div><div class="rkpend hide" id="rkpend"></div>' : ''}
        <div class="rkelev" id="rkelev"></div><div id="rksel"></div>
        ${admin ? '<div class="rkside" id="rkside"></div>' : ''}</div>
      <div class="rkcol rkphoto" id="rkphoto"></div>
    </div>
    <div class="section" style="margin-top:22px"><h2>Power</h2><div id="rkpow"></div></div>
    <div class="section" style="margin-top:22px"><h2>In this rack</h2><div id="rktable"></div></div>
  </div>`;

  const gearRows = () => gear.map((g) => { const c = card(g.id); return { ...c, rack_u: g.shelf ? null : g.u, rack_h: g.shelf ? 0 : g.h, rack_side: g.side, shelf_id: g.shelf }; });
  const problems = () => RackCore.problems(rack.units, items, gearRows().map((g) => ({ ...g, name: g.name })));
  let saveT = null, saving = Promise.resolve();
  const save = () => {
    clearTimeout(saveT);
    $('#rkst').textContent = 'Saving…';
    saveT = setTimeout(() => {
      saving = saving.then(async () => {
        try {
          const r = await call('PUT', '/api/racks/' + rack.id + '/layout', { items, gear });
          data = r; rack = r.rack; items = rack.items.map((x) => ({ ...x }));
          $('#rkst').textContent = 'Saved'; forgetDevices(); await loadDevices(true); paintAll(true);
        } catch (e) { toast(e.message, 'bad'); $('#rkst').textContent = 'Not saved'; }
      });
    }, 250);
  };
  /** Try a change; refuse it (and say why) if something would overlap or run off the bottom. */
  const attempt = (fn) => {
    const before = JSON.stringify({ items, gear });
    fn();
    const bad = problems();
    if (bad.length) { const b = JSON.parse(before); items = b.items; gear = b.gear; toast(bad[0], 'bad'); paintAll(); return false; }
    paintAll(); save(); return true;
  };

  // ---- the elevation
  const H = () => rack.units * RK.UH;
  const yOf = (u) => 14 + (u - 1) * RK.UH;
  const xIn = RK.RAIL, wIn = RK.W - RK.RAIL * 2;
  function elevation(forPrint) {
    const rows = gearRows();
    let s = '<svg class="rksvg" viewBox="0 0 ' + RK.W + ' ' + (H() + 28) + '" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><pattern id="rkhatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" class="rkh"/></pattern></defs>' +
      '<rect class="rkframe" x="2" y="6" width="' + (RK.W - 4) + '" height="' + (H() + 16) + '" rx="6"/>';
    // rails and U numbers
    for (let u = 1; u <= rack.units; u++) {
      const y = yOf(u);
      s += '<rect class="rkslot" data-slot="' + u + '" x="' + xIn + '" y="' + y + '" width="' + wIn + '" height="' + RK.UH + '"/>' +
        '<text class="rkun" x="' + (RK.RAIL / 2) + '" y="' + (y + RK.UH / 2 + 4) + '" text-anchor="middle">' + u + '</text>' +
        '<text class="rkun" x="' + (RK.W - RK.RAIL / 2) + '" y="' + (y + RK.UH / 2 + 4) + '" text-anchor="middle">' + u + '</text>' +
        '<circle class="rkhole" cx="' + (RK.RAIL - 7) + '" cy="' + (y + RK.UH / 2) + '" r="2"/><circle class="rkhole" cx="' + (RK.W - RK.RAIL + 7) + '" cy="' + (y + RK.UH / 2) + '" r="2"/>';
    }
    // free runs
    if (!forPrint) for (const gp of RackCore.gaps(rack.units, items, rows)) {
      if (gp.h < 1) continue;
      s += '<text class="rkfree" x="' + (RK.W / 2) + '" y="' + (yOf(gp.u) + gp.h * RK.UH / 2 + 4) + '" text-anchor="middle">' + gp.h + 'U free</text>';
    }
    // panels
    for (const it of items) {
      const y = yOf(it.u), h = it.h * RK.UH, on = sel && sel.kind === 'item' && sel.id === it.id;
      const cls = 'rkit rk-' + it.type + (on ? ' on' : '');
      s += '<g class="' + cls + '" data-item="' + it.id + '"><rect x="' + (xIn + 1) + '" y="' + (y + 1) + '" width="' + (wIn - 2) + '" height="' + (h - 2) + '" rx="3"' + (it.type === 'blank' ? ' fill="url(#rkhatch)"' : '') + '/>';
      if (it.type === 'vent') for (let k = 0; k < 9; k++) s += '<rect class="rkvent" x="' + (xIn + 40 + k * 28) + '" y="' + (y + 7) + '" width="16" height="' + Math.max(4, h - 14) + '" rx="2"/>';
      // patch panels: a row of jacks, square for network, round for audio, small round for video
      if (/^patch/.test(it.type)) { const n = it.type === 'patch' ? 24 : it.type === 'patchaudio' ? 16 : 16, gap = (wIn - 150) / n; for (let k = 0; k < n; k++) { const cx = xIn + 130 + k * gap + gap / 2, cy = y + h / 2 + 2; s += it.type === 'patch' ? '<rect class="rkjack" x="' + (cx - 4) + '" y="' + (cy - 4) + '" width="8" height="7" rx="1"/>' : '<circle class="rkjack" cx="' + cx + '" cy="' + cy + '" r="' + (it.type === 'patchaudio' ? 5 : 3.5) + '"/>'; } }
      if (it.type === 'drawer') s += '<rect class="rkhandle" x="' + (RK.W / 2 - 30) + '" y="' + (y + h / 2 - 3) + '" width="60" height="6" rx="3"/>';
      if (it.type === 'shelf') {
        s += '<line class="rkshelf" x1="' + (xIn + 2) + '" x2="' + (xIn + wIn - 2) + '" y1="' + (y + h - 4) + '" y2="' + (y + h - 4) + '"/>';
        const on2 = rows.filter((g) => g.shelf_id === it.id);
        let x = xIn + 6;
        on2.forEach((g) => {
          const t = g.name, w = Math.min(150, 12 + t.length * 7);
          const gon = sel && sel.kind === 'gear' && sel.id === g.id;
          s += '<g class="rkchip' + (gon ? ' on' : '') + '" data-gear="' + g.id + '"><rect x="' + x + '" y="' + (y + 4) + '" width="' + w + '" height="' + Math.max(14, h - 12) + '" rx="4"/><text x="' + (x + 6) + '" y="' + (y + 4 + Math.max(14, h - 12) / 2 + 4) + '">' + esc(t) + '</text></g>';
          x += w + 6;
        });
        if (!on2.length) s += '<text class="rkpl" x="' + (xIn + 10) + '" y="' + (y + h / 2 + 2) + '">' + esc(it.label || 'Shelf') + ' · empty</text>';
      } else s += '<text class="rkpl" x="' + (xIn + 10) + '" y="' + (y + h / 2 + 4) + '">' + esc(it.label || RackCore.ITEM_TYPES[it.type]) + '</text>';
      if (admin && !forPrint) s += '<rect class="rkgrip" data-grip-item="' + it.id + '" x="' + (RK.W / 2 - 18) + '" y="' + (y + h - 6) + '" width="36" height="6" rx="3"/>';
      s += '</g>';
    }
    // gear
    for (const g of rows.filter((x) => !x.shelf_id && x.rack_u)) {
      const y = yOf(g.rack_u), h = (g.rack_h || 1) * RK.UH;
      const half = g.rack_side === 'L' || g.rack_side === 'R';
      const x = g.rack_side === 'R' ? xIn + wIn / 2 : xIn, w = half ? wIn / 2 : wIn;
      const on = sel && sel.kind === 'gear' && sel.id === g.id;
      const cat = g.kind === 'power' ? 'pow' : ['network', 'computer'].includes(g.kind) ? 'net' : ['amp', 'processor'].includes(g.kind) ? 'pa' : ['console', 'stagebox'].includes(g.kind) ? 'mix' : ['receiver', 'iemtx'].includes(g.kind) ? 'rf' : 'gen';
      const title = g.name, sub = [g.make, g.model].filter(Boolean).join(' ');
      const maxc = Math.floor((w - 20) / 6.6);
      s += '<g class="rkg c-' + cat + (on ? ' on' : '') + '" data-gear="' + g.id + '"><rect x="' + (x + 1.5) + '" y="' + (y + 1.5) + '" width="' + (w - 3) + '" height="' + (h - 3) + '" rx="4"/>' +
        '<text class="rkt" x="' + (x + 10) + '" y="' + (y + (h > RK.UH ? 18 : RK.UH / 2 + 4)) + '">' + esc(title.length > maxc ? title.slice(0, maxc - 1) + '…' : title) + '</text>' +
        (sub && (h > RK.UH || (!half && title.length + sub.length < maxc - 3)) ? '<text class="rks" x="' + (h > RK.UH ? x + 10 : x + w - 10) + '" y="' + (h > RK.UH ? y + 34 : y + RK.UH / 2 + 4) + '"' + (h > RK.UH ? '' : ' text-anchor="end"') + '>' + esc(sub.length > maxc ? sub.slice(0, maxc - 1) + '…' : sub) + '</text>' : '') +
        (admin && !forPrint ? '<rect class="rkgrip" data-grip-gear="' + g.id + '" x="' + (x + w / 2 - 18) + '" y="' + (y + h - 6) + '" width="36" height="6" rx="3"/>' : '') + '</g>';
    }
    return s + '</svg>';
  }

  // ---- the photo, each piece glowing in its spot
  function paintPhoto() {
    const host = $('#rkphoto');
    if (!rack.photo) { host.innerHTML = '<div class="rkhd"><h2>Photo</h2></div><div class="card empty">' + (admin ? 'Add a photo of the front of the rack (Photo, at the top), then line it up: every piece of gear in it then shows its spot in the photo, on its own card too.' : 'No photo of this rack yet.' + (canEdit ? ' Tap Edit to add one.' : '')) + '</div>'; return; }
    const rows = photoEntries();
    const marks = rows.map((r) => r.mark);
    host.innerHTML = '<div class="rkhd"><h2>Photo</h2>' + (admin ? '<span class="rkbtns">' + (rows.length ? '<button class="btn sm" id="rkSpots">' + icon('edit') + 'Adjust spots</button>' : '') + '<button class="btn sm" id="rkLine">' + icon('edit') + 'Line up the photo</button></span>' : '') + '</div><div id="rkspot" class="capped">' + marksView(rack.photo, marks, { location: rack.name }) + '</div>' +
      '<div class="note" style="margin-top:6px">' + (marks.length ? 'Tap a piece of gear in the drawing, or step through with the arrows. Tap the photo for full screen.' : 'Place gear in the rack and it shows here.') + '</div>';
    wireMarksView($('#rkspot'));
    photoLightbox($('#rkspot'), rack.photo, marks, { location: rack.name });
    rkSpotIds = rows.map((r) => r.key);
    const sb = $('#rkSpots'); if (sb) sb.addEventListener('click', () => adjustSpots(rack, rows, async (spots) => { await call('PUT', '/api/racks/' + rack.id, { spots }); rack.spots = spots; paintPhoto(); toast('Spots saved', 'ok'); }));
    const lb = $('#rkLine'); if (lb) lb.addEventListener('click', () => lineUp(rack, async (rails) => { await call('PUT', '/api/racks/' + rack.id, { rails }); rack.rails = rails; paintPhoto(); toast('Photo lined up', 'ok'); }));
  }
  /**
   * What shows on the photo, top to bottom: every piece of gear, and the rack's own pieces worth pointing at
   * (patch panels, custom items, cable managers, drawers, a shelf with nothing on it…). Each has a key (g12 / iab3) for its spot.
   */
  function photoEntries() {
    const g = gearRows().filter((x) => x.rack_u || x.shelf_id).map((x) => ({ key: 'g' + x.id, u: x.rack_u || (items.find((y) => y.id === x.shelf_id) || {}).u || 99, side: x.rack_side || '', name: x.name, title: tagModel(x), mark: rackMark(x, rack), grid: () => { const m = rackMark({ ...x, notes: '' }, { ...rack, spots: {} }); return { x: m.x, y: m.y, w: m.w, h: m.h, q: m.q }; } }));
    const it = items.filter((x) => x.type !== 'shelf' || !gear.some((y) => y.shelf === x.id)).map((x) => {
      const title = x.label || RackCore.ITEM_TYPES[x.type];
      const grid = () => RackCore.region(rack.rails, rack.units, x.u, x.h, '');
      const box = (rack.spots && rack.spots['i' + x.id]) || grid();
      return { key: 'i' + x.id, u: x.u, side: '', name: title, title, mark: { ...box, color: 'blue', label: title, tag: '', note: x.label ? RackCore.ITEM_TYPES[x.type] : '' }, grid };
    });
    return g.concat(it).sort((a, b) => a.u - b.u || a.side.localeCompare(b.side));
  }
  let rkSpotIds = [];
  const spotTo = (key) => { const k = rkSpotIds.indexOf(key); const b = $('#rkspot .spk[data-mi="' + k + '"]'); if (k >= 0 && b) b.click(); };

  // ---- the gear list beside it (admins): unracked first
  function paintSide() {
    const host = $('#rkside'); if (!host) return;
    const inHere = new Set(gear.map((g) => g.id));
    const q = (host.dataset.q || '').toLowerCase();
    const cand = (DEV.list || []).filter((d) => !inHere.has(d.id) && (!q || [d.name, d.make, d.model, d.location].join(' ').toLowerCase().includes(q)));
    const free = cand.filter((d) => !d.rack_id), else_ = cand.filter((d) => d.rack_id);
    const rowOf = (d) => '<button class="rkcand' + (pending && pending.id === d.id ? ' on' : '') + '" draggable="true" data-cand="' + d.id + '"><b>' + esc(tagModel(d)) + '</b><span>' + esc([kindLabel(d.kind), d.rack_id ? 'in another rack' : ''].filter(Boolean).join(' · ') || ' ') + '</span></button>';
    host.innerHTML = '<div class="rkhd"><h2>Gear Locker</h2></div><input type="search" id="rkq" placeholder="Find gear" value="' + esc(host.dataset.q || '') + '">' +
      '<div class="note" style="margin:6px 0">Drag one into the rack, or tap it, then tap a slot.</div>' +
      '<div class="rkcands">' + (free.length ? free.map(rowOf).join('') : '<p class="note">' + (q ? 'Nothing matches.' : 'Every card is in a rack.') + '</p>') +
      (else_.length ? '<div class="rkcsub">In other racks</div>' + else_.map(rowOf).join('') : '') + '</div>';
    const qi = $('#rkq', host);
    qi.addEventListener('input', () => { host.dataset.q = qi.value; const pos = qi.selectionStart; paintSide(); const n = $('#rkq'); n.focus(); n.setSelectionRange(pos, pos); });
    $$('[data-cand]', host).forEach((b) => {
      b.addEventListener('click', () => { const d = card(Number(b.dataset.cand)); pendH = d.rack_h > 1 ? d.rack_h : 1; pending = pending && pending.id === d.id ? null : { id: d.id }; paintPending(); paintSide(); });
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 'card:' + b.dataset.cand); const d = card(Number(b.dataset.cand)); pendH = d.rack_h > 1 ? d.rack_h : pendH; });
    });
  }
  function paintPending() {
    const host = $('#rkpend'); if (!host) return;
    host.classList.toggle('hide', !pending);
    if (!pending) { host.innerHTML = ''; return; }
    const d = card(pending.id);
    host.innerHTML = '<b>' + esc(tagModel(d)) + '</b><span class="note">Height</span>' + [1, 2, 3, 4].map((h) => '<button class="btn sm' + (pendH === h ? ' on' : '') + '" data-ph="' + h + '">' + h + 'U</button>').join('') +
      '<span class="note">Width</span><select id="rkpside"><option value="">Full</option><option value="L">Left half</option><option value="R">Right half</option></select><span class="note grow">Now tap a slot in the rack (or a shelf).</span><button class="ghost sm" id="rkpx">Cancel</button>';
    $$('[data-ph]', host).forEach((b) => b.addEventListener('click', () => { pendH = Number(b.dataset.ph); paintPending(); }));
    $('#rkpside', host).value = pending.side || '';
    $('#rkpside', host).addEventListener('change', (e) => { pending.side = e.target.value; });
    $('#rkpx', host).addEventListener('click', () => { pending = null; paintPending(); paintSide(); });
  }

  // ---- the selected piece: its details
  function paintSel() {
    const host = $('#rksel');
    if (!sel) { host.innerHTML = ''; return; }
    if (sel.kind === 'gear') {
      const g = gear.find((x) => x.id === sel.id); if (!g) { sel = null; host.innerHTML = ''; return; }
      const c = card(g.id);
      host.innerHTML = '<div class="card rkselc"><div class="rkhd"><b>' + esc(tagModel(c)) + '</b><a class="btn sm" href="#/d/' + c.id + '">Open card</a></div>' +
        '<div class="note">' + esc(rackSpot({ rack_u: g.u, rack_h: g.h, rack_side: g.side, shelf_id: g.shelf }, rack)) + '</div>' +
        (admin ? '<div class="rkrow">' + (g.shelf ? '' : '<label><em>Height</em><select data-sh>' + [1, 2, 3, 4, 5, 6, 8, 10].filter((h) => h <= rack.units).map((h) => '<option' + (g.h === h ? ' selected' : '') + '>' + h + '</option>').join('') + '</select></label>' +
          '<label><em>Width</em><select data-ss><option value="">Full</option><option value="L"' + (g.side === 'L' ? ' selected' : '') + '>Left half</option><option value="R"' + (g.side === 'R' ? ' selected' : '') + '>Right half</option></select></label>') +
          '<label><em>&nbsp;</em><button class="ghost danger sm" data-sx>Take out of the rack</button></label></div>' : '') + '</div>';
      if (admin) {
        const sh = $('[data-sh]', host); if (sh) sh.addEventListener('change', () => attempt(() => { g.h = Number(sh.value); }));
        const ss = $('[data-ss]', host); if (ss) ss.addEventListener('change', () => attempt(() => { g.side = ss.value; }));
        $('[data-sx]', host).addEventListener('click', () => { sel = null; attempt(() => { gear = gear.filter((x) => x !== g); }); });
      }
    } else {
      const it = items.find((x) => x.id === sel.id); if (!it) { sel = null; host.innerHTML = ''; return; }
      host.innerHTML = '<div class="card rkselc"><div class="rkhd"><b>' + esc(RackCore.ITEM_TYPES[it.type]) + '</b></div>' + (admin ? '<div class="rkrow"><label><em>Label</em><input data-il value="' + esc(it.label) + '" placeholder="' + esc(RackCore.ITEM_TYPES[it.type]) + '" maxlength="60"></label>' +
        '<label><em>Height</em><select data-ih>' + [1, 2, 3, 4, 5, 6, 8, 10].filter((h) => h <= rack.units).map((h) => '<option' + (it.h === h ? ' selected' : '') + '>' + h + '</option>').join('') + '</select></label>' +
        '<label><em>&nbsp;</em><button class="ghost danger sm" data-ix>Remove</button></label></div>' + (it.type === 'shelf' ? '<div class="note">Tap a card in the list, then tap this shelf, to sit it on the shelf.</div>' : '') : '') + '</div>';
      if (admin) {
        $('[data-il]', host).addEventListener('change', (e) => attempt(() => { it.label = e.target.value; }));
        $('[data-ih]', host).addEventListener('change', (e) => attempt(() => { it.h = Number(e.target.value); }));
        $('[data-ix]', host).addEventListener('click', () => { sel = null; attempt(() => { items = items.filter((x) => x !== it); gear.forEach((g) => { if (g.shelf === it.id) g.shelf = ''; }); gear = gear.filter((g) => g.shelf !== '' || g.u); }); });
      }
    }
  }

  // ---- power
  function paintPower() {
    const host = $('#rkpow');
    const strips = data.power || [];
    const rows = gearRows().filter((g) => g.kind !== 'power');
    const unplugged = rows.filter((g) => !g.power_pdu);
    if (!strips.length) { host.innerHTML = '<div class="card empty">No power strip or PDU in this rack.' + (admin ? ' Add one with + Power strip above the rack, or from the Gear Locker, then place it.' : '') + '</div>'; return; }
    host.innerHTML = strips.map((p) => {
      const n = Math.max(p.outlets || 0, ...p.plugs.map((x) => x.outlet || 0), 1);
      return '<div class="card rkpdu' + (p.over ? ' over' : '') + '"><div class="rkhd"><b>' + esc(p.name) + (p.model && p.model !== p.name ? ' <span class="note">' + esc(p.model) + '</span>' : '') + '</b><span class="rkw">' + p.watts + ' W' + (p.max ? ' of ' + p.max + ' W' : '') + (p.over ? ' · over the limit' : '') + '</span></div>' +
        (p.max ? '<div class="rkbar"><i style="width:' + Math.min(100, Math.round(p.watts / p.max * 100)) + '%"></i></div>' : '') +
        '<div class="rkouts">' + Array.from({ length: n }, (_, k) => {
          const on = p.plugs.find((x) => x.outlet === k + 1);
          return '<div class="rkout"><span class="rkon">' + (k + 1) + '</span>' + (admin ? '<select data-pdu="' + p.id + '" data-out="' + (k + 1) + '"><option value="">Empty</option>' + rows.map((g) => '<option value="' + g.id + '"' + (on && on.id === g.id ? ' selected' : '') + '>' + esc(tagModel(g)) + '</option>').join('') + '</select>' : '<span>' + (on ? esc(on.name) : '<span class="note">Empty</span>') + '</span>') +
            (on ? '<span class="note">' + (on.watts ? on.watts + ' W' : '') + '</span>' : '') + '</div>';
        }).join('') + '</div></div>';
    }).join('') + (unplugged.length ? '<div class="note" style="margin-top:8px"><b>Not plugged in:</b> ' + unplugged.map((g) => esc(g.name)).join(', ') + '</div>' : '');
    $$('[data-pdu]', host).forEach((s) => s.addEventListener('change', async () => {
      const pdu = Number(s.dataset.pdu), out = Number(s.dataset.out), gid = Number(s.value);
      const plugs = [];
      const strip = strips.find((x) => x.id === pdu), was = strip.plugs.find((x) => x.outlet === out);
      if (was && was.id !== gid) plugs.push({ id: was.id, pdu: null });
      if (gid) plugs.push({ id: gid, pdu, outlet: out });
      try { data = await call('PUT', '/api/racks/' + rack.id + '/power', { plugs }); forgetDevices(); await loadDevices(true); paintAll(); toast('Saved', 'ok'); } catch (e) { toast(e.message, 'bad'); paintPower(); }
    }));
  }

  // ---- the table (also on the print)
  function tableHtml() {
    const rows = gearRows().map((g) => ({ g, u: g.rack_u || ((items.find((x) => x.id === g.shelf_id) || {}).u) || 99 })).concat(items.filter((x) => x.type !== 'shelf' || !gear.some((g) => g.shelf === x.id)).map((it) => ({ it, u: it.u })))
      .sort((a, b) => a.u - b.u);
    const pdu = (g) => { const p = g.power_pdu && card(g.power_pdu); return p ? esc(p.name) + (g.power_outlet ? ' · ' + g.power_outlet : '') : ''; };
    return '<table class="rktab"><thead><tr><th>U</th><th>Tag</th><th>Make and model</th><th>Plugs into</th><th>Power</th></tr></thead><tbody>' + rows.map((r) => r.g
      ? '<tr><td>' + esc(rackSpot(r.g, rack).replace(/^U/, '')) + '</td><td><b>' + esc(r.g.name) + '</b></td><td>' + esc([r.g.make, r.g.model].filter(Boolean).join(' ')) + '</td><td>' + pdu(r.g) + '</td><td>' + (r.g.power_w != null ? r.g.power_w + ' W' : '') + '</td></tr>'
      : '<tr class="rkpanel"><td>' + r.it.u + (r.it.h > 1 ? '–' + (r.it.u + r.it.h - 1) : '') + '</td><td colspan="4">' + esc(r.it.label || RackCore.ITEM_TYPES[r.it.type]) + '</td></tr>').join('') + '</tbody></table>';
  }

  function paintAll(keepPhoto) {
    $('#rkelev').innerHTML = elevation(false);
    const us = RackCore.usage(rack.units, items, gearRows());
    $('#rkuse').textContent = us.used + ' of ' + rack.units + ' U used · ' + us.free + ' U free';
    paintSel(); paintSide(); paintPending(); paintPower();
    $('#rktable').innerHTML = tableHtml();
    if (!keepPhoto || !$('#rkspot')) paintPhoto(); else paintPhoto();
    wireElev();
  }

  // ---- arranging: tap, drag to move, drag the bottom edge to resize, drop cards in
  function uAt(e) {
    const svg = $('#rkelev svg'), r = svg.getBoundingClientRect(), k = (RK.W) / r.width;
    const y = (e.clientY - r.top) * k, x = (e.clientX - r.left) * k;
    return { u: Math.max(1, Math.min(rack.units, Math.floor((y - 14) / RK.UH) + 1)), half: x < RK.W / 2 ? 'L' : 'R', x, y };
  }
  function placeCard(gid, u, side, shelf) {
    const d = card(gid);
    return attempt(() => {
      gear = gear.filter((x) => x.id !== gid);
      gear.push(shelf ? { id: gid, u: null, h: 0, side: '', shelf } : { id: gid, u, h: pendH || (d.rack_h > 1 ? d.rack_h : 1), side: side || '', shelf: '' });
      sel = { kind: 'gear', id: gid };
    });
  }
  function wireElev() {
    const svg = $('#rkelev svg');
    svg.addEventListener('click', (e) => {
      if (svg.dataset.dragged) { delete svg.dataset.dragged; return; }
      const gEl = e.target.closest('[data-gear]'), iEl = e.target.closest('[data-item]');
      if (pending) {
        const p = uAt(e);
        if (iEl && items.find((x) => x.id === iEl.dataset.item && x.type === 'shelf')) { if (placeCard(pending.id, 0, '', iEl.dataset.item)) { pending = null; paintPending(); } return; }
        if (placeCard(pending.id, p.u, pending.side || '')) { pending = null; paintPending(); paintSide(); }
        return;
      }
      if (gEl) { sel = { kind: 'gear', id: Number(gEl.dataset.gear) }; paintAll(true); spotTo('g' + sel.id); return; }
      if (iEl) { sel = { kind: 'item', id: iEl.dataset.item }; paintAll(true); spotTo('i' + sel.id); return; }
      sel = null; paintAll(true);
    });
    if (!admin) return;
    svg.addEventListener('dragover', (e) => e.preventDefault());
    svg.addEventListener('drop', (e) => {
      e.preventDefault();
      const t = e.dataTransfer.getData('text/plain'); if (!t.startsWith('card:')) return;
      const gid = Number(t.slice(5)), p = uAt(e);
      const iEl = e.target.closest('[data-item]');
      if (iEl && items.find((x) => x.id === iEl.dataset.item && x.type === 'shelf')) placeCard(gid, 0, '', iEl.dataset.item);
      else placeCard(gid, p.u, '');
      pending = null; paintPending();
    });
    // drag to move or resize: the piece follows the finger; the change is checked when it is let go
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (pending) return;
      const grip = e.target.closest('[data-grip-gear],[data-grip-item]');
      const gEl = e.target.closest('[data-gear]'), iEl = e.target.closest('[data-item]');
      if (!grip && !gEl && !iEl) return;
      const p = uAt(e);
      const el = gEl || iEl;
      if (gEl) { const g = gear.find((x) => x.id === Number(gEl.dataset.gear)); if (!g || g.shelf) return; drag = { gear: g.id, u0: g.u, h0: g.h, side0: g.side }; }
      else { const it = items.find((x) => x.id === iEl.dataset.item); drag = { item: it.id, u0: it.u, h0: it.h }; }
      Object.assign(drag, { mode: grip ? 'size' : 'move', p, el, rect: el.querySelector('rect'), moved: false, du: 0, dh: 0, side: drag.side0 });
      drag.rh = Number(drag.rect.getAttribute('height'));
      drag.pid = e.pointerId;   // captured once it really moves, so a plain tap still selects
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = uAt(e);
      if (!drag.moved && Math.abs(p.y - drag.p.y) < 6 && Math.abs(p.x - drag.p.x) < 12) return;
      if (!drag.moved) { try { svg.setPointerCapture(drag.pid); } catch (err) { /* already gone */ } }
      drag.moved = true;
      if (drag.mode === 'move') {
        drag.du = Math.max(1 - drag.u0, Math.min(rack.units - drag.u0, p.u - drag.p.u));
        let dx = 0;
        if (drag.side0) { drag.side = p.half; dx = drag.side === drag.side0 ? 0 : (drag.side === 'R' ? wIn / 2 : -wIn / 2); }
        drag.el.setAttribute('transform', 'translate(' + dx + ',' + drag.du * RK.UH + ')');
      } else {
        drag.dh = Math.max(1, p.u - drag.u0 + 1) - drag.h0;
        drag.rect.setAttribute('height', Math.max(RK.UH - 3, drag.rh + drag.dh * RK.UH));
      }
      drag.el.classList.add('drag');
    });
    const end = () => {
      if (!drag) return;
      const d0 = drag; drag = null;
      if (!d0.moved) return;
      svg.dataset.dragged = '1';
      const g = d0.gear != null ? gear.find((x) => x.id === d0.gear) : null, it = d0.item ? items.find((x) => x.id === d0.item) : null;
      const t = g || it;
      attempt(() => {
        if (d0.mode === 'move') { t.u = d0.u0 + d0.du; if (g && d0.side0) g.side = d0.side; }
        else t.h = Math.max(1, d0.h0 + d0.dh);
        sel = g ? { kind: 'gear', id: g.id } : { kind: 'item', id: it.id };
      });
    };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  }

  if (admin) {
    const placeItem = (type, label, h) => {
      const gp = RackCore.gaps(rack.units, items, gearRows()).find((x) => x.h >= h) || null;
      if (!gp) return toast(h > 1 ? 'No ' + h + 'U space free in this rack' : 'The rack is full', 'bad');
      const id = 'i' + Math.random().toString(36).slice(2, 8);
      attempt(() => { items.push({ id, type, u: gp.u, h, label }); sel = { kind: 'item', id }; });
    };
    const ps = $('#rkpatch'); if (ps) ps.addEventListener('change', () => { const t = ps.value; ps.value = ''; if (t) placeItem(t, '', 1); });
    $$('[data-add]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.add !== 'custom') return placeItem(b.dataset.add, '', 1);
      // something of your own: a monitor shelf, a light, a label strip…
      modal('<h3>Custom item</h3><p class="note">Anything in the rack that is not a Gear Locker card: a rack light, a monitor, a label strip. It takes up space and shows in the drawing and the print.</p><form id="rcf"><label>Name</label><input id="rcn" maxlength="60" placeholder="Rack light, Monitor, Keyboard tray…" required>' +
        '<label>Height</label><select id="rch">' + [1, 2, 3, 4, 5, 6, 8, 10].filter((h) => h <= rack.units).map((h) => '<option value="' + h + '">' + h + 'U</option>').join('') + '</select>' +
        '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Add to the rack</button></div></form>', (w, close) => {
        $('#rcf', w).addEventListener('submit', (e) => { e.preventDefault(); const n = $('#rcn', w).value.trim(); if (!n) return; close(); placeItem('custom', n, Number($('#rch', w).value)); });
        $('#rcn', w).focus();
      });
    }));
    // a new Gear Locker card made right here (a switch or a power strip), then placed like any other card
    $$('[data-new]').forEach((b) => b.addEventListener('click', () => newRackGear(b.dataset.new, (d) => {
      DEV.list = DEV.list || []; DEV.list.push(d);
      pendH = d.rack_h > 1 ? d.rack_h : 1; pending = { id: d.id }; paintPending(); paintSide();
      toast(d.name + ' added to the Gear Locker. Tap a slot to place it.', 'ok');
    })));
    $('#rkEd').addEventListener('click', () => rackDialog(rack));
    $('#rkPh').addEventListener('click', () => rackPhoto(rack, async (pid) => {
      await call('PUT', '/api/racks/' + rack.id, { photo: pid });
      rack.photo = pid; paintPhoto();
      $('#rkPh').lastChild.textContent = 'Photo';
      lineUp(rack, async (rails) => { await call('PUT', '/api/racks/' + rack.id, { rails }); rack.rails = rails; paintPhoto(); toast('Photo lined up', 'ok'); });
    }));
  }
  // the print: every U top to bottom (free space too), what plugs in where, IPs, and a power summary
  function printTable() {
    const rows = gearRows().map((g) => ({ g, u: g.rack_u || ((items.find((x) => x.id === g.shelf_id) || {}).u) || 99, sub: g.shelf_id ? 1 : 0 }))
      .concat(items.filter((x) => x.type !== 'shelf' || !gear.some((g) => g.shelf === x.id)).map((it) => ({ it, u: it.u, sub: 0 })))
      .concat(RackCore.gaps(rack.units, items, gearRows()).map((gp) => ({ free: gp, u: gp.u, sub: 0 })))
      .sort((a, b) => a.u - b.u || a.sub - b.sub || String((a.g || {}).rack_side || '').localeCompare(String((b.g || {}).rack_side || '')));
    const pdu = (g) => { const p = g.power_pdu && card(g.power_pdu); return p ? esc(p.name) + (g.power_outlet ? ' · outlet ' + g.power_outlet : '') : ''; };
    const ip = (g) => { const c = card(g.id); const a = (c.ips && c.ips.length ? c.ips.map((x) => x.ip || x).filter(Boolean) : []).concat(c.ip ? [c.ip] : []); return esc([...new Set(a)].join(', ')); };
    const span = (u, h) => u + (h > 1 ? '–' + (u + h - 1) : '');
    return '<table class="rkpt"><thead><tr><th>U</th><th>Tag</th><th>Make and model</th><th>Plugs into</th><th class="r">Power</th><th>IP address</th></tr></thead><tbody>' + rows.map((r) => {
      if (r.free) return '<tr class="free"><td>' + span(r.free.u, r.free.h) + '</td><td colspan="5">Free · ' + r.free.h + 'U</td></tr>';
      if (r.it) return '<tr class="panel"><td>' + span(r.it.u, r.it.h) + '</td><td colspan="5">' + esc(r.it.label || RackCore.ITEM_TYPES[r.it.type]) + (r.it.label ? ' <span>' + esc(RackCore.ITEM_TYPES[r.it.type]) + '</span>' : '') + '</td></tr>';
      const g = r.g, where = rackSpot(g, rack).replace(/^U/, '').replace(/ left half$/, ' L').replace(/ right half$/, ' R');
      return '<tr><td>' + esc(where) + '</td><td><b>' + esc(g.name) + '</b></td><td>' + esc([g.make, g.model].filter(Boolean).join(' ')) + '</td><td>' + pdu(g) + '</td><td class="r">' + (g.power_w ? g.power_w + ' W' : '') + '</td><td>' + ip(g) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  const pr = $('#rkPr'); if (pr) pr.addEventListener('click', () => {
    const us = RackCore.usage(rack.units, items, gearRows());
    const strips = (data.power || []);
    const watts = gearRows().filter((g) => g.kind !== 'power').reduce((t, g) => t + (Number(g.power_w) || 0), 0);
    printRack(rack, elevation(true), printTable(), { used: us.used, free: us.free, watts, strips, count: gear.length });
  });
  // Done: wait for the last save, then back to view mode
  const dn = $('#rkDone'); if (dn) dn.addEventListener('click', async () => { dn.disabled = true; try { await saving; } catch (e) { /* the save said why */ } location.hash = '#/racks/' + rack.id; });
  paintAll();
}

/**
 * A new Gear Locker card made from the rack page: a network switch (with its ports) or a power strip (with its outlets).
 * done(device) gets the new card, ready to place.
 */
function newRackGear(kind, done) {
  const sw = kind === 'network';
  const taken = (DEV.list || []).map((d) => d.name);
  const tag = Tags.suggest(kind, taken);
  modal('<h3>' + (sw ? 'New network switch' : 'New power strip') + '</h3><p class="note">It gets a Gear Locker card' + (sw ? ', and its ports show on the stage patch and the System map.' : '; plug gear into its outlets below the rack.') + '</p><form id="ngf">' +
    '<label>Tag name</label><input id="ngn" maxlength="60" value="' + esc(tag) + '" required>' +
    '<div class="ngrow"><div><label>Make</label><input id="ngm" maxlength="60" placeholder="' + (sw ? 'Ubiquiti' : 'Furman') + '" list="ngml"></div><div><label>Model</label><input id="ngd" maxlength="60" placeholder="Model number" list="ngdl"></div></div>' +
    '<datalist id="ngdl">' + GearModels.all().filter((m) => m.kind === kind).map((m) => '<option value="' + esc(m.model) + '">' + esc(m.make || '') + '</option>').join('') + '</datalist>' +
    '<div class="ngrow"><div><label>' + (sw ? 'Ports' : 'Outlets') + '</label><input id="ngp" type="number" min="1" max="96" value="' + (sw ? 16 : 8) + '"></div><div><label>Height</label><select id="ngh">' + [1, 2, 3, 4].map((h) => '<option value="' + h + '">' + h + 'U</option>').join('') + '</select></div>' +
    (sw ? '' : '<div><label>Limit (watts)</label><input id="ngw" type="number" min="0" max="20000" value="1800"></div>') + '</div>' +
    '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Add and place</button></div></form>', (w, close) => {
    $('#ngd', w).addEventListener('change', () => { const m = GearModels.find($('#ngd', w).value, kind); if (m && m.make && !$('#ngm', w).value) $('#ngm', w).value = m.make; });
    $('#ngf', w).addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = Number($('#ngp', w).value) || (sw ? 16 : 8), make = $('#ngm', w).value.trim(), model = $('#ngd', w).value.trim();
      const body = { name: $('#ngn', w).value.trim(), kind, make, model, category: sw ? 'network' : 'power', rack_h: Number($('#ngh', w).value) };
      if (sw) { body.networked = true; body.inputs = n; } else { body.outputs = n; body.power_max = Number(($('#ngw', w) || {}).value) || 0; }
      try {
        const r = await call('POST', '/api/devices', body);
        if (model) GearModels.add([{ kind, make, model }]);
        forgetDevices(); close();
        done({ ...body, id: r.id, rack_id: null, qty: 1 });
      } catch (err) { toast(err.message, 'bad'); }
    });
  });
}

/** Upload a rack photo, or pick one already in LiveGenie. */
function rackPhoto(rack, done) {
  modal('<h3>Rack photo</h3><p class="note">A straight-on photo of the front of the rack works best. You line it up next.</p><input type="file" accept="image/*" class="hide" id="rpf">' +
    '<div class="acts" style="justify-content:flex-start;flex-wrap:wrap"><button class="primary" id="rpu">' + icon('upload') + 'Upload a photo</button><button id="rpc">Choose one already in LiveGenie</button>' + (rack.photo ? '<button class="ghost danger" id="rpx">Remove the photo</button>' : '') + '<span class="grow"></span><button data-close>Cancel</button></div><div class="note" id="rpm"></div>', (w, close) => {
    $('#rpu', w).addEventListener('click', () => $('#rpf', w).click());
    $('#rpf', w).addEventListener('change', async () => {
      const f = $('#rpf', w).files[0]; if (!f) return;
      $('#rpm', w).textContent = 'Uploading…';
      try { const pic = await shrink(f); const up = await call('POST', '/api/uploads', pic.blob, { raw: true, type: pic.type }); close(); if (up.reused) toast('That photo is already in LiveGenie: using the one there', 'ok'); done(up.id); }
      catch (e) { toast(e.message, 'bad'); $('#rpm', w).textContent = ''; }
    });
    $('#rpc', w).addEventListener('click', async () => { const pid = await choosePhoto(); if (pid) { close(); done(pid); } });
    const x = $('#rpx', w); if (x) x.addEventListener('click', async () => { await call('PUT', '/api/racks/' + rack.id, { photo: '' }); close(); toast('Photo removed', 'ok'); route(); });
  });
}

/**
 * Line up the photo: drag the four corners to the inside corners of the rails (top of U1, bottom of the last U).
 * Lines across show where each U falls, so it is easy to check against the screws.
 */
function lineUp(rack, done) {
  const rails = RackCore.cleanRails(rack.rails);
  modal('<h3>Line up the photo</h3><p class="note">Drag the four corners to the inside edges of the rails: the top corners at the top of U1, the bottom corners at the bottom of U' + rack.units + '. The lines show each U.</p>' +
    '<div class="luwrap"><div class="lupic" id="lup"><img src="/uploads/' + esc(rack.photo) + '" alt="" draggable="false"><svg id="lus" viewBox="0 0 1000 1000" preserveAspectRatio="none"></svg>' +
    ['tl', 'tr', 'bl', 'br'].map((k) => '<i class="luh" data-k="' + k + '"></i>').join('') + '</div></div>' +
    '<div class="acts"><button type="button" class="ghost" id="lur">Start again</button><span class="grow"></span><button type="button" data-close>Cancel</button><button class="primary" id="luok">Save</button></div>', (w, close) => {
    w.classList.add('mwide', 'mkmodal');
    const pic = $('#lup', w), svg = $('#lus', w);
    const paint = () => {
      ['tl', 'tr', 'bl', 'br'].forEach((k) => { const h = $('[data-k="' + k + '"]', w); h.style.left = (rails[k].x * 100) + '%'; h.style.top = (rails[k].y * 100) + '%'; });
      let s = '<polygon class="luq" points="' + ['tl', 'tr', 'br', 'bl'].map((k) => rails[k].x * 1000 + ',' + rails[k].y * 1000).join(' ') + '"/>';
      for (let u = 0; u <= rack.units; u++) { const a = RackCore.at(rails, 0, u / rack.units), b = RackCore.at(rails, 1, u / rack.units); s += '<line class="lul' + (u % 2 ? '' : ' e') + '" x1="' + a.x * 1000 + '" y1="' + a.y * 1000 + '" x2="' + b.x * 1000 + '" y2="' + b.y * 1000 + '"/>'; }
      for (let u = 1; u <= rack.units; u++) { const m = RackCore.at(rails, 0, (u - 0.5) / rack.units); s += '<text class="lut" x="' + (m.x * 1000 + 8) + '" y="' + (m.y * 1000 + 6) + '">' + u + '</text>'; }
      svg.innerHTML = s;
    };
    paint();
    let drag = null;
    const at = (e) => { const r = pic.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    pic.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const h = e.target.closest('.luh');
      const p = at(e);
      // grab the handle tapped, or the nearest corner
      const k = h ? h.dataset.k : ['tl', 'tr', 'bl', 'br'].sort((a, b) => Math.hypot(rails[a].x - p.x, rails[a].y - p.y) - Math.hypot(rails[b].x - p.x, rails[b].y - p.y))[0];
      drag = k; rails[k] = p; paint();
      pic.setPointerCapture(e.pointerId);
    });
    pic.addEventListener('pointermove', (e) => { if (!drag) return; rails[drag] = at(e); paint(); });
    const end = () => { drag = null; };
    pic.addEventListener('pointerup', end); pic.addEventListener('pointercancel', end);
    $('#lur', w).addEventListener('click', () => { Object.assign(rails, RackCore.cleanRails({})); paint(); });
    $('#luok', w).addEventListener('click', async () => { try { await done(RackCore.cleanRails(rails)); close(); } catch (e) { toast(e.message, 'bad'); } });
  });
}

/**
 * Adjust spots: the rails give every piece a spot on the photo from its U, but real racks have gaps (half a U between
 * a patch panel and a switch), gear mounted a hole off, and photos taken at an angle. Here each spot can be moved and
 * resized by hand; "Back to the grid" drops the change for one piece. Saved on the rack.
 */
function adjustSpots(rack, rows, done, opts) {
  // opts (rooms): { free: true } no U lines or rails to snap to and no grid to go back to; title, note
  opts = opts || {};
  const spots = JSON.parse(JSON.stringify(rack.spots || {}));
  // rows: { key, name, title, grid() } for gear and the rack's own pieces
  const boxOf = (g) => spots[g.key] || g.grid();
  let cur = opts.start && rows.some((g) => g.key === opts.start) ? opts.start : rows.length ? rows[0].key : null;
  modal('<h3>' + esc(opts.title || 'Adjust spots') + '</h3><p class="note">' + esc(opts.note || 'Drag a spot to where that piece of gear really is in the photo. Drag any of its four corners to fit it: corners move on their own, so a spot can lean with a photo taken at an angle.') + '</p>' +
    '<div class="sjwrap"><div class="lupic sjpic" id="sjp"><img src="/uploads/' + esc(rack.photo) + '" alt="" draggable="false"><div id="sjb"></div><div id="sjg" class="sjg"></div></div>' +
    '<div class="sjlist" id="sjl"></div></div>' +
    '<div class="acts"><label class="tog sjtog"><input type="checkbox" id="sjsnap"' + ((() => { try { return localStorage.getItem('lg-rack-snap'); } catch (e) { return null; } })() === '0' ? '' : ' checked') + '><span>Snap</span></label>' + (opts.free ? '' : '<button type="button" class="ghost" id="sjall">All back to the grid</button>') + '<span class="grow"></span><button type="button" data-close>Cancel</button><button class="primary" id="sjok">Save</button></div>', (w, close) => {
    w.classList.add('mwide', 'mkmodal');
    const pic = $('#sjp', w);
    /**
     * Snap: while dragging, a box's edges catch on the U lines, the rails and the edges of the other boxes
     * (within about 1% of the photo), and a guide line shows what it caught. Off with the tick, or hold Alt (Option).
     */
    const THR = 0.012;
    const uLines = () => { if (opts.free) return []; const out = []; for (let u = 0; u <= rack.units; u++) out.push(RackCore.at(rack.rails, 0.5, u / rack.units).y); return out; };
    const railX = () => { if (opts.free) return []; const out = []; for (let k = 0; k <= 4; k++) { const d = k / 4; out.push(RackCore.at(rack.rails, 0, d).x, RackCore.at(rack.rails, 1, d).x, RackCore.at(rack.rails, 0.5, d).x); } return out; };
    const near = (v, list) => { let best = null; list.forEach((c) => { if (Math.abs(c - v) <= THR && (best == null || Math.abs(c - v) < Math.abs(best - v))) best = c; }); return best; };
    function snapBox(b, key, resize, off) {
      const on = $('#sjsnap', w).checked && !off;
      if (!on) { guides([], []); return b; }
      const others = rows.filter((g) => g.key !== key).map((g) => boxOf(g));
      const ys = uLines().concat(...others.map((o) => [o.y, o.y + o.h]));
      const xs = railX().concat(...others.map((o) => [o.x, o.x + o.w]));
      const gx = [], gy = [];
      const n = { ...b };
      if (resize) {
        const r = near(b.x + b.w, xs); if (r != null && r - b.x > 0.02) { n.w = r - b.x; gx.push(r); }
        const bt = near(b.y + b.h, ys); if (bt != null && bt - b.y > 0.01) { n.h = bt - b.y; gy.push(bt); }
      } else {
        const t = near(b.y, ys), bt = near(b.y + b.h, ys);
        if (t != null && (bt == null || Math.abs(t - b.y) <= Math.abs(bt - b.y - b.h))) { n.y = t; gy.push(t); } else if (bt != null) { n.y = bt - b.h; gy.push(bt); }
        const l = near(b.x, xs), r = near(b.x + b.w, xs);
        if (l != null && (r == null || Math.abs(l - b.x) <= Math.abs(r - b.x - b.w))) { n.x = l; gx.push(l); } else if (r != null) { n.x = r - b.w; gx.push(r); }
      }
      n.x = clamp(n.x, 0, 1 - n.w); n.y = clamp(n.y, 0, 1 - n.h);
      guides(gx, gy);
      return n;
    }
    /** A spot: its box (for the name tag) holding its four-cornered shape; only the shape catches a drag. */
    const boxHtml = (g) => {
      const b = boxOf(g), q = RackCore.quadOf(b), on = g.key === cur, moved = !!spots[g.key];
      const pt = (p) => (((p.x - b.x) / (b.w || 1)) * 100).toFixed(2) + ',' + (((p.y - b.y) / (b.h || 1)) * 100).toFixed(2);
      return '<div class="sjbox' + (on ? ' on' : '') + (moved ? ' moved' : '') + '" data-g="' + g.key + '" style="left:' + b.x * 100 + '%;top:' + b.y * 100 + '%;width:' + b.w * 100 + '%;height:' + b.h * 100 + '%">' +
        '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon class="sjarea" points="' + q.map(pt).join(' ') + '"/></svg><em style="left:calc(' + pt(q[0]).split(',')[0] + '% + 4px);top:calc(' + pt(q[0]).split(',')[1] + '% + 2px)">' + esc(g.name) + '</em></div>';
    };
    /** The four corner handles of the spot being adjusted. */
    const cornersHtml = (g) => { if (!g) return ''; const q = RackCore.quadOf(boxOf(g)); return q.map((p, c) => '<i class="sjc" data-c="' + c + '" style="left:' + p.x * 100 + '%;top:' + p.y * 100 + '%"></i>').join(''); };
    /** Put a moved shape on screen without repainting everything. */
    const show = (g) => {
      const el = $('.sjbox[data-g="' + g.key + '"]', w); if (el) el.outerHTML = boxHtml(g);
      const q = RackCore.quadOf(boxOf(g)); $$('.sjc', w).forEach((h) => { const p = q[Number(h.dataset.c)]; h.style.left = p.x * 100 + '%'; h.style.top = p.y * 100 + '%'; });
    };
    function guides(gx, gy) {
      $('#sjg', w).innerHTML = gx.map((x) => '<i class="sjgx" style="left:' + x * 100 + '%"></i>').join('') + gy.map((y) => '<i class="sjgy" style="top:' + y * 100 + '%"></i>').join('');
    }
    const paint = () => {
      $('#sjb', w).innerHTML = rows.map((g) => boxHtml(g)).join('') + (cur ? cornersHtml(rows.find((g) => g.key === cur)) : '');
      $('#sjl', w).innerHTML = rows.map((g) => '<button type="button" class="sjrow' + (g.key === cur ? ' on' : '') + '" data-pick="' + g.key + '"><b>' + esc(g.title) + '</b><span>' + (opts.free ? esc(g.sub || '') : spots[g.key] ? 'Moved by hand · <u data-reset="' + g.key + '">back to the grid</u>' : 'On the grid') + '</span></button>').join('');
      $$('[data-pick]', w).forEach((b) => b.addEventListener('click', (e) => { const r = e.target.closest('[data-reset]'); if (r) { delete spots[r.dataset.reset]; } cur = b.dataset.pick; paint(); }));
    };
    paint();
    let drag = null;
    const at = (e) => { const r = pic.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    pic.addEventListener('pointerdown', (e) => {
      const hc = e.target.closest('.sjc');
      const el = e.target.closest('.sjbox');
      if (!hc && !el) return;
      e.preventDefault();
      const g = hc ? rows.find((x) => x.key === cur) : rows.find((x) => x.key === el.dataset.g); if (!g) return;
      if (cur !== g.key) { cur = g.key; paint(); }
      const p = at(e), b = boxOf(g);
      drag = { g, p, q: RackCore.quadOf(b).map((x) => ({ ...x })), b: { x: b.x, y: b.y, w: b.w, h: b.h }, corner: hc ? Number(hc.dataset.c) : null };
      pic.setPointerCapture(e.pointerId);
    });
    pic.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = at(e);
      let q;
      if (drag.corner != null) {
        // one corner on its own: catches on the U lines, the rails and the other spots' edges
        let c = { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
        if ($('#sjsnap', w).checked && !e.altKey) {
          const others = rows.filter((g) => g.key !== drag.g.key).map((g) => RackCore.quadOf(boxOf(g)));
          const sx = near(c.x, railX().concat(...others.map((o) => o.map((v) => v.x)))), sy = near(c.y, uLines().concat(...others.map((o) => o.map((v) => v.y))));
          if (sx != null) c.x = sx; if (sy != null) c.y = sy;
          guides(sx != null ? [sx] : [], sy != null ? [sy] : []);
        } else guides([], []);
        q = drag.q.map((v, k) => (k === drag.corner ? c : v));
      } else {
        // the whole spot: moved as one, snapping by the box around it
        const b = drag.b, dx = p.x - drag.p.x, dy = p.y - drag.p.y;
        const nb = snapBox({ x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h), w: b.w, h: b.h }, drag.g.key, false, e.altKey);
        q = drag.q.map((v) => ({ x: v.x + nb.x - b.x, y: v.y + nb.y - b.y }));
      }
      const bb = RackCore.boundsOf(q);
      if (bb.w < 0.01 || bb.h < 0.005) return;
      spots[drag.g.key] = { ...bb, q };
      show(drag.g);
    });
    const end = () => { if (drag) { drag = null; guides([], []); paint(); } };
    pic.addEventListener('pointerup', end); pic.addEventListener('pointercancel', end);
    $('#sjsnap', w).addEventListener('change', (e) => { try { localStorage.setItem('lg-rack-snap', e.target.checked ? '1' : '0'); } catch (er) { /* private mode */ } });
    const sjall = $('#sjall', w); if (sjall) sjall.addEventListener('click', () => { Object.keys(spots).forEach((k) => delete spots[k]); paint(); });
    $('#sjok', w).addEventListener('click', async () => {
      // keep only spots for gear still in the rack
      const keep = {}; rows.forEach((g) => { if (spots[g.key]) keep[g.key] = spots[g.key]; });
      try { await done(keep); close(); } catch (e) { toast(e.message, 'bad'); }
    });
  });
}

/** Print the rack for its door: the front drawing and the list, with a smart file name. */
function printRack(rack, svg, table, info) {
  info = info || {};
  const old = document.getElementById('rkprint'); if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'rkprint';
  const org = (S.state && S.state.org) || {};
  const d = new Date(), date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const stat = (n, l) => '<div class="rkpstat"><b>' + n + '</b><span>' + l + '</span></div>';
  const power = (info.strips || []).map((p) => '<div class="rkppow"><b>' + esc(p.name) + '</b>' + (p.model && p.model !== p.name ? ' <span>' + esc(p.model) + '</span>' : '') +
    '<em>' + p.watts + ' W' + (p.max ? ' of ' + p.max + ' W' : '') + (p.over ? ' · over the limit' : '') + '</em>' +
    '<ol>' + Array.from({ length: Math.max(p.outlets || 0, ...p.plugs.map((x) => x.outlet || 0)) }, (_, k) => { const on = p.plugs.find((x) => x.outlet === k + 1); return '<li><i>' + (k + 1) + '</i>' + (on ? esc(on.name) + (on.watts ? ' <span>' + on.watts + ' W</span>' : '') : '<span>Empty</span>') + '</li>'; }).join('') + '</ol></div>').join('');
  box.innerHTML =
    '<div class="rkph">' + (org.logo ? '<img src="/api/org/logo" alt="">' : '') + '<div class="grow"><div class="rkpo">' + esc(org.name || '') + '</div><h1>' + esc(rack.name) + '</h1>' +
      '<div class="rkpm">' + [rack.location, 'Printed ' + date].filter(Boolean).map(esc).join(' · ') + '</div></div>' +
      '<div class="rkpstats">' + stat(rack.units + 'U', 'rack') + stat(info.used + 'U', 'used') + stat(info.free + 'U', 'free') + stat(info.count || 0, 'pieces') + (info.watts ? stat(info.watts + ' W', 'power') : '') + '</div></div>' +
    '<div class="rkpbody"><div class="rkpsvg">' + svg + '</div><div class="rkpside">' + (rack.notes ? '<div class="rkpnotes">' + md(rack.notes) + '</div>' : '') + (power ? '<h2>Power</h2>' + power : '') + '</div></div>' +
    '<h2>In this rack, top to bottom</h2>' + table +
    '<div class="rkpfoot">' + esc([org.name, rack.name, date].filter(Boolean).join(' · ')) + '</div>';
  document.body.appendChild(box);
  document.body.classList.add('printrack');
  const started = Date.now();
  const done = () => { box.remove(); document.body.classList.remove('printrack'); window.removeEventListener('hashchange', done); };
  window.addEventListener('hashchange', done);
  // some phones say "done" as the print sheet opens: ignore that, and tidy up when you leave the page
  window.addEventListener('afterprint', function after() { if (Date.now() - started < 2500) return; window.removeEventListener('afterprint', after); setTimeout(done, 500); });
  exportPdf(rack.name + ' Rack');
}
