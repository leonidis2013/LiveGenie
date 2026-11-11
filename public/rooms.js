/* LiveGenie: rooms. A photo of a room (the sanctuary, the booth, the stage) with the gear in it highlighted: the
 * speakers, the wedges, the console. Each piece has its own four-cornered spot (dragged into place, leaning with the
 * photo), and a card with a quantity can be placed once per piece (PA-L and PA-R). Every card then shows where it is,
 * on its Gear Locker page, in the stage patch pane and on stage plots. Everyone can look; admins arrange. */

/** Rooms with their gear, fetched at most once a minute (every page that shows a card's spot asks for them). */
const ROOMS = { list: null, at: 0, wait: null };
function loadRooms(force) {
  if (!force && ROOMS.list && Date.now() - ROOMS.at < 60000) return Promise.resolve(ROOMS.list);
  if (ROOMS.wait) return ROOMS.wait;
  ROOMS.wait = get('/api/rooms').then((r) => { ROOMS.list = r.rooms; ROOMS.at = Date.now(); ROOMS.wait = null; return r.rooms; }, (e) => { ROOMS.wait = null; throw e; });
  return ROOMS.wait;
}
function forgetRooms() { ROOMS.list = null; ROOMS.at = 0; }

/** The kinds a room usually shows first in the picker: what you point at in a photo of a room. */
const ROOM_KINDS = ['speaker', 'wedge', 'amp', 'mic', 'txmic', 'console', 'stagebox', 'receiver', 'iemtx', 'processor', 'computer', 'network'];

/** One piece's highlight on the room photo. */
function roomMark(e, room) {
  const sp = e.spot || roomDefaultSpot(0);
  return { ...sp, color: 'blue', tag: e.tag, label: tagModel({ name: e.tag, model: e.model }), note: e.note || '' };
}
/** A new piece starts as a box near the middle of the photo (each one a little lower, so they do not stack exactly). */
function roomDefaultSpot(k) {
  const x = 0.4 + (k % 4) * 0.03, y = 0.38 + (k % 6) * 0.04, w = 0.16, h = 0.14;
  return { x, y, w, h, q: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] };
}
/** Where a card is in the rooms: [{ room, entries, marks }], one per room it is in. */
function roomSpotsOf(deviceId, rooms) {
  return (rooms || []).map((room) => {
    const entries = (room.gear || []).filter((e) => e.device_id === deviceId);
    return entries.length ? { room, entries, marks: entries.filter((e) => e.spot).map((e) => roomMark(e, room)) } : null;
  }).filter(Boolean);
}

async function viewRooms() {
  setTitle('Rooms');
  const rooms = await loadRooms(true);
  app.innerHTML = `<div class="page racks rooms">
    <div class="crumbs"><a href="#/">Home</a><span>/</span></div>
    <div class="bar"><div class="grow"><h1 class="title" style="font-size:22px;letter-spacing:.06em;margin:4px 0 2px">ROOMS</h1>
      <div class="note">A photo of each room with its gear highlighted: the speakers, the wedges, the booth.</div></div>
      ${can('admin') ? '<button class="primary btn" id="roNew">' + icon('plus') + 'New room</button>' : ''}</div>
    <div class="rkgrid">${rooms.length ? rooms.map((r) => { const placed = r.gear.filter((g) => g.spot).length;
      return '<a class="rkcard rocard" href="#/rooms/' + r.id + '"><div class="rkthumb rothumb">' + (r.photo ? '<img src="/uploads/' + esc(r.photo) + '" alt="" loading="lazy">' : icon('image')) + '</div>' +
        '<div class="t"><b>' + esc(r.name) + '</b><span>' + (r.gear.length ? r.gear.length + ' piece' + (r.gear.length === 1 ? '' : 's') + ' of gear' + (placed < r.gear.length && r.photo ? ' · ' + (r.gear.length - placed) + ' not placed' : '') : 'No gear yet') + '</span>' +
        '<span class="dmeta">' + (r.photo ? '' : 'No photo yet') + '</span></div></a>'; }).join('')
      : '<div class="card empty">No rooms yet.' + (can('admin') ? ' Make one (Sanctuary, Booth, Stage), give it a photo, then highlight where the speakers and other gear are.' : '') + '</div>'}</div></div>`;
  const nb = $('#roNew'); if (nb) nb.addEventListener('click', () => roomDialog(null));
}

/** New room, or change its name and notes. */
function roomDialog(rm) {
  modal('<h3>' + (rm ? 'Room details' : 'New room') + '</h3><form id="rof"><label>Name</label><input id="ron" value="' + esc(rm ? rm.name : '') + '" placeholder="Like Sanctuary, Booth or Stage" maxlength="60">' +
    '<label>Notes</label><textarea id="rot" rows="3" placeholder="Anything a volunteer should know about this room">' + esc(rm ? rm.notes : '') + '</textarea>' +
    '<div class="acts">' + (rm ? '<button type="button" class="ghost danger" id="rodel">Delete room</button><span class="grow"></span>' : '') + '<button type="button" data-close>Cancel</button><button class="primary">' + (rm ? 'Save' : 'Make the room') + '</button></div></form>', (w, close) => {
    $('#rof', w).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: $('#ron', w).value, notes: $('#rot', w).value };
      try {
        if (rm) { await call('PUT', '/api/rooms/' + rm.id, body); forgetRooms(); close(); toast('Saved', 'ok'); route(); }
        else { const r = await call('POST', '/api/rooms', body); forgetRooms(); close(); location.hash = '#/rooms/' + r.id + '/edit'; }
      } catch (err) { toast(err.message, 'bad'); }
    });
    const del = $('#rodel', w);
    if (del) del.addEventListener('click', async () => {
      if (!await confirmBox('Delete ' + rm.name + '?', 'Its photo and highlights go. The gear stays in the Gear Locker.', 'Delete', true)) return;
      try { await call('DELETE', '/api/rooms/' + rm.id); forgetRooms(); close(); toast('Room deleted', 'ok'); location.hash = '#/rooms'; } catch (err) { toast(err.message, 'bad'); }
    });
  });
}

/** Upload a room photo, or pick one already in LiveGenie. */
function roomPhoto(rm, done) {
  modal('<h3>Room photo</h3><p class="note">A wide photo of the room, taken from where people would look at it, works best. Gear you add gets a spot to drag into place.</p><input type="file" accept="image/*" class="hide" id="ropf">' +
    '<div class="acts" style="justify-content:flex-start;flex-wrap:wrap"><button class="primary" id="ropu">' + icon('upload') + 'Upload a photo</button><button id="ropc">Choose one already in LiveGenie</button>' + (rm.photo ? '<button class="ghost danger" id="ropx">Remove the photo</button>' : '') + '<span class="grow"></span><button data-close>Cancel</button></div><div class="note" id="ropm"></div>', (w, close) => {
    $('#ropu', w).addEventListener('click', () => $('#ropf', w).click());
    $('#ropf', w).addEventListener('change', async () => {
      const f = $('#ropf', w).files[0]; if (!f) return;
      $('#ropm', w).textContent = 'Uploading…';
      try { const pic = await shrink(f); const up = await call('POST', '/api/uploads', pic.blob, { raw: true, type: pic.type }); close(); if (up.reused) toast('That photo is already in LiveGenie: using the one there', 'ok'); done(up.id); }
      catch (e) { toast(e.message, 'bad'); $('#ropm', w).textContent = ''; }
    });
    $('#ropc', w).addEventListener('click', async () => { const pid = await choosePhoto(); if (pid) { close(); done(pid); } });
    const x = $('#ropx', w); if (x) x.addEventListener('click', () => { close(); done(''); });
  });
}

/** A room. View mode by default (step through the highlights); #/rooms/ID/edit is edit mode, for admins. */
async function viewRoom(id, mode) {
  let room;
  try { room = (await get('/api/rooms/' + id)).room; }
  catch (e) { if (e.status === 404) { app.innerHTML = '<div class="card empty"><b>That room is not here any more.</b><div style="margin-top:12px"><a class="btn" href="#/rooms">Rooms</a></div></div>'; return; } throw e; }
  await loadDevices(true);
  const canEdit = can('admin');
  const admin = canEdit && mode === 'edit';
  setTitle(room.name);
  // the gear as it is being arranged: [{ id, device_id, unit, tag, spot }]
  let gear = room.gear.map((g) => ({ ...g }));
  const card = (did) => (DEV.list || []).find((d) => d.id === did) || { id: did, name: 'Gear', model: '' };

  app.innerHTML = `<div class="page rack room">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/rooms">Rooms</a></div>
    <div class="bar"><div class="grow"><h1 class="title">${esc(room.name)}</h1><div class="meta" style="margin:0"><span id="rost"></span></div></div>
      ${admin ? '<button class="btn" id="roEd">' + icon('edit') + 'Details</button><button class="btn" id="roPh">' + icon('image') + (room.photo ? 'Photo' : 'Add photo') + '</button>' : ''}
      ${admin ? '<button class="btn primary" id="roDone">' + icon('check') + 'Done</button>' : canEdit ? '<a class="btn primary" href="#/rooms/' + room.id + '/edit">' + icon('edit') + 'Edit</a>' : ''}</div>
    ${admin ? '<div class="rkmode note">Editing: changes save as you go. Tap <b>Done</b> when you are finished.</div>' : ''}
    ${room.notes ? '<div class="doc rknotes">' + md(room.notes) + '</div>' : ''}
    <div class="romain">
      <div class="rkcol rkphoto" id="rophoto"></div>
      <div class="rkcol"><div class="rkhd"><h2>In this room</h2></div><div id="rolist"></div>${admin ? '<div class="rkside roside" id="roside"></div>' : ''}</div>
    </div>
  </div>`;

  let saving = Promise.resolve();
  const save = (body) => {
    $('#rost').textContent = 'Saving…';
    saving = saving.then(async () => {
      try {
        const r = await call('PUT', '/api/rooms/' + room.id + '/gear', { gear: gear.map((g) => ({ id: g.id, device_id: g.device_id, unit: g.unit, spot: g.spot || null })) });
        room = r.room; gear = room.gear.map((g) => ({ ...g })); forgetRooms();
        $('#rost').textContent = 'Saved'; paintAll();
      } catch (e) { toast(e.message, 'bad'); $('#rost').textContent = 'Not saved'; }
    });
    return saving;
  };

  // ---- the photo, each piece glowing in its spot
  let spotKeys = [];
  function paintPhoto() {
    const host = $('#rophoto');
    if (!room.photo) {
      host.innerHTML = '<div class="rkhd"><h2>Photo</h2></div><div class="card empty">' + (admin ? 'Add a photo of the room (Photo, at the top). Then add the gear in it and drag each spot to where it is.' : 'No photo of this room yet.' + (canEdit ? ' Tap Edit to add one.' : '')) + '</div>';
      return;
    }
    const placed = gear.filter((g) => g.spot);
    const marks = placed.map((g) => roomMark(g, room));
    spotKeys = placed.map((g) => g.id);
    host.innerHTML = '<div class="rkhd"><h2>Photo</h2>' + (admin && gear.length ? '<span class="rkbtns"><button class="btn sm" id="roSpots">' + icon('edit') + 'Adjust spots</button></span>' : '') + '</div><div id="rospot" class="capped">' + marksView(room.photo, marks, { location: room.name }) + '</div>' +
      '<div class="note" style="margin-top:6px">' + (marks.length ? 'Tap a piece of gear in the list, or step through with the arrows. Tap the photo for full screen.' : admin ? 'Add gear from the list, then drag each spot to where it is.' : 'No gear highlighted yet.') + '</div>';
    wireMarksView($('#rospot'));
    photoLightbox($('#rospot'), room.photo, marks, { location: room.name });
    const sb = $('#roSpots'); if (sb) sb.addEventListener('click', () => spotsDialog());
  }
  function spotsDialog(start) {
    const rows = gear.map((g, k) => ({ key: 'g' + g.id, name: g.tag, title: tagModel({ name: g.tag, model: g.model }), sub: kindLabel(g.kind) + (g.spot ? '' : ' · not placed yet'), grid: () => roomDefaultSpot(k) }));
    const spots = {}; gear.forEach((g) => { if (g.spot) spots['g' + g.id] = g.spot; });
    adjustSpots({ photo: room.photo, rails: RackCore.cleanRails({}), units: 0, spots }, rows, async (out) => {
      gear.forEach((g, k) => { g.spot = out['g' + g.id] || g.spot || roomDefaultSpot(k); });
      await save(); toast('Spots saved', 'ok');
    }, { free: true, title: 'Where is each piece?', note: 'Drag a spot onto that piece of gear in the photo, then drag its four corners to fit it. Corners move on their own, so a spot can follow the angle of the photo.', start });
  }

  // ---- the list of gear in the room
  function paintList() {
    const host = $('#rolist');
    host.innerHTML = gear.length ? '<div class="list rolst">' + gear.map((g) => {
      const c = card(g.device_id);
      return '<div class="row" data-ro="' + g.id + '">' + devThumb(c, 36) + '<div class="t"><b>' + esc(tagModel({ name: g.tag, model: g.model })) + '</b><span>' + esc([kindLabel(g.kind), g.qty > 1 ? 'piece ' + (g.unit + 1) + ' of ' + g.qty : '', room.photo && !g.spot ? 'not placed on the photo yet' : ''].filter(Boolean).join(' · ')) + '</span></div>' +
        '<a class="btn sm ghost" href="#/d/' + g.device_id + '">Card</a>' + (admin ? (room.photo ? '<button class="btn sm" data-place="' + g.id + '">Place</button>' : '') + '<button class="ghost danger sm" data-rx="' + g.id + '" aria-label="Take out of the room">' + icon('x') + '</button>' : '') + '</div>';
    }).join('') + '</div>' : '<div class="card empty" style="padding:16px">' + (admin ? 'Nothing here yet. Add gear from the Gear Locker below.' : 'No gear in this room yet.') + '</div>';
    $$('[data-ro]', host).forEach((r) => r.addEventListener('click', (e) => {
      if (e.target.closest('a,button')) return;
      const k = spotKeys.indexOf(Number(r.dataset.ro)); const b = $('#rospot .spk[data-mi="' + k + '"]'); if (k >= 0 && b) { b.click(); $('#rophoto').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    }));
    $$('[data-place]', host).forEach((b) => b.addEventListener('click', () => spotsDialog('g' + b.dataset.place)));
    $$('[data-rx]', host).forEach((b) => b.addEventListener('click', () => { gear = gear.filter((g) => g.id !== Number(b.dataset.rx)); save(); }));
  }

  // ---- admins: add gear from the Gear Locker (speakers, wedges and the like first; every piece of a card with a quantity)
  function paintSide() {
    const host = $('#roside'); if (!host) return;
    const q = (host.dataset.q || '').toLowerCase();
    const here = new Set(gear.map((g) => g.device_id + ':' + g.unit));
    const pieces = [];
    (DEV.list || []).forEach((d) => {
      if (q && ![d.name, d.make, d.model, kindLabel(d.kind), (d.unit_tags || []).join(' ')].join(' ').toLowerCase().includes(q)) return;
      const n = Math.max(1, Number(d.qty) || 1);
      for (let u = 0; u < n; u++) if (!here.has(d.id + ':' + u)) pieces.push({ d, u, tag: n > 1 ? pieceTagOf(d, u) : d.name });
    });
    const top = pieces.filter((p) => ROOM_KINDS.includes(p.d.kind)), rest = pieces.filter((p) => !ROOM_KINDS.includes(p.d.kind));
    top.sort((a, b) => ROOM_KINDS.indexOf(a.d.kind) - ROOM_KINDS.indexOf(b.d.kind) || a.tag.localeCompare(b.tag, undefined, { numeric: true }));
    const rowOf = (p) => '<button class="rkcand" data-add="' + p.d.id + ':' + p.u + '"><b>' + esc(tagModel({ name: p.tag, model: p.d.model })) + '</b><span>' + esc(kindLabel(p.d.kind) + (Number(p.d.qty) > 1 ? ' · piece ' + (p.u + 1) + ' of ' + p.d.qty : '')) + '</span></button>';
    host.innerHTML = '<div class="rkhd" style="margin-top:18px"><h2>Add from the Gear Locker</h2></div><input type="search" id="roq" placeholder="Find gear" value="' + esc(host.dataset.q || '') + '">' +
      '<div class="note" style="margin:6px 0">Tap a piece to add it to this room. A card with a quantity is listed once per piece.</div>' +
      '<div class="rkcands">' + (top.length ? '<div class="rkcsub">Speakers, wedges and other gear people point at</div>' + top.slice(0, 120).map(rowOf).join('') : '') +
      (rest.length ? '<div class="rkcsub">Everything else</div>' + rest.slice(0, 200).map(rowOf).join('') : '') + (!pieces.length ? '<p class="note">' + (q ? 'Nothing matches.' : 'Every piece is in this room.') + '</p>' : '') + '</div>';
    const qi = $('#roq', host);
    qi.addEventListener('input', () => { host.dataset.q = qi.value; const pos = qi.selectionStart; paintSide(); const n = $('#roq'); n.focus(); n.setSelectionRange(pos, pos); });
    $$('[data-add]', host).forEach((b) => b.addEventListener('click', async () => {
      const [did, u] = b.dataset.add.split(':').map(Number);
      const d = card(did);
      gear.push({ id: null, device_id: did, unit: u, tag: Number(d.qty) > 1 ? pieceTagOf(d, u) : d.name, model: d.model, kind: d.kind, qty: d.qty || 1, spot: room.photo ? roomDefaultSpot(gear.length) : null });
      await save();
      toast(b.querySelector('b').textContent + ' added' + (room.photo ? '. Tap Place to drag it into its spot.' : ''), 'ok');
    }));
  }

  function paintAll() { paintPhoto(); paintList(); paintSide(); }
  paintAll();

  if (admin) {
    $('#roEd').addEventListener('click', () => roomDialog(room));
    $('#roPh').addEventListener('click', () => roomPhoto(room, async (pid) => {
      try {
        const r = await call('PUT', '/api/rooms/' + room.id, { photo: pid });
        room = r.room; forgetRooms();
        // gear added before the photo gets a starting spot to drag into place
        if (pid && gear.some((g) => !g.spot)) { gear.forEach((g, k) => { if (!g.spot) g.spot = roomDefaultSpot(k); }); await save(); }
        paintAll(); $('#roPh').lastChild.textContent = pid ? 'Photo' : 'Add photo';
        if (pid && gear.length) spotsDialog();
      } catch (e) { toast(e.message, 'bad'); }
    }));
    $('#roDone').addEventListener('click', async () => { await saving; location.hash = '#/rooms/' + room.id; });
  }
}

/** The tag of one piece of a card with a quantity: its own tag, or the run its number implies (SPK-1, SPK-2), or "name #2". */
function pieceTagOf(d, u) {
  if (d.unit_tags && d.unit_tags[u]) return d.unit_tags[u];
  if (!u) return d.name;
  const m = /^(.*\D)(\d+)$/.exec(String(d.name || '').trim());
  return m ? m[1] + (Number(m[2]) + u) : d.name + ' #' + (u + 1);
}
