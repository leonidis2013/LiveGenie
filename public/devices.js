/*
 * Device library pages, and the automatic links: any device name, alias or IP
 * on a page becomes a link to its card, with a quick card on hover.
 */
'use strict';

const CAT = { audio: 'Audio', video: 'Video', lighting: 'Lighting', network: 'Network', computer: 'Computer', power: 'Power', other: 'Other' };
const DEV = { list: null, at: 0, dm: null, loading: null, buckets: [] };

/*
 * Gear Locker buckets. Gear sorts itself by what it is (its kind on the stage patch, else its model and category);
 * an admin can move a piece to another bucket, rename, reorder or add buckets.
 */
const AUTO_BUCKETS = ['Mics & wireless', 'In-ears', 'Stage I/O', 'Mixing', 'Processing', 'Amps', 'Speakers & monitors', 'Video', 'Lighting', 'Network', 'Computers', 'Power', 'Other'];
const BUCKET_OF_KIND = { mic: 'Mics & wireless', di: 'Mics & wireless', txmic: 'Mics & wireless', receiver: 'Mics & wireless', source: 'Other', iemtx: 'In-ears', bodypack: 'In-ears', headamp: 'In-ears',
  stagebox: 'Stage I/O', network: 'Network', console: 'Mixing', computer: 'Computers', processor: 'Processing', amp: 'Amps', speaker: 'Speakers & monitors', wedge: 'Speakers & monitors' };
function autoBucket(d) {
  if (d.kind && BUCKET_OF_KIND[d.kind]) return BUCKET_OF_KIND[d.kind];
  // its type on your model list, else plain words in its name
  const m = typeof GearModels !== 'undefined' ? GearModels.find(d.model) || GearModels.find(d.name) : null;
  if (m && BUCKET_OF_KIND[m.kind]) return BUCKET_OF_KIND[m.kind];
  const t = (d.make + ' ' + d.model + ' ' + d.name).toLowerCase();
  if (/wireless|receiver|\bmic|microphone|\bdi\b/.test(t)) return 'Mics & wireless';
  if (/\biem\b|in-?ear/.test(t)) return 'In-ears';
  if (/stage ?box|snake|\bi\/o\b/.test(t)) return 'Stage I/O';
  if (/console|mixer|desk/.test(t)) return 'Mixing';
  if (/\bdsp\b|processor|crossover/.test(t)) return 'Processing';
  if (/amplifier|\bamp\b/.test(t)) return 'Amps';
  if (/speaker|\bsub\b|subwoofer|wedge|monitor/.test(t)) return 'Speakers & monitors';
  return { video: 'Video', lighting: 'Lighting', network: 'Network', computer: 'Computers', power: 'Power', audio: 'Other', other: 'Other' }[d.category] || 'Other';
}
const bucketOf = (d) => d.bucket || autoBucket(d);
/** Every location used in the Gear Locker, sorted (plus this one). */
const gearLocations = (list, extra) => [...new Set(list.map((d) => d.location).concat(extra ? [extra] : []).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
/** Every bucket name in order: the admin's list first, then automatic ones that have gear. */
function bucketOrder(list) {
  const out = (DEV.buckets || []).slice();
  AUTO_BUCKETS.forEach((b) => { if (!out.includes(b) && list.some((d) => bucketOf(d) === b)) out.push(b); });
  list.forEach((d) => { const b = bucketOf(d); if (!out.includes(b)) out.push(b); });
  return out;
}

async function loadDevices(force) {
  if (!force && DEV.list && Date.now() - DEV.at < 30000) return DEV.list;
  if (DEV.loading) return DEV.loading;
  DEV.loading = get('/api/devices').then((d) => {
    DEV.list = d.devices; DEV.buckets = d.buckets || []; DEV.at = Date.now();
    DEV.dm = DevMatch.build(d.devices);
    return DEV.list;
  }).catch(() => DEV.list || []).finally(() => { DEV.loading = null; });
  return DEV.loading;
}
const forgetDevices = () => { DEV.at = 0; };

/**
 * The team's own list of makes and models. It starts empty and grows as gear is added (stage patch, guided setup),
 * so next time the same model is one click, with its inputs, outputs and link already filled in.
 */
const GearModels = (() => {
  let list = null, at = 0;
  const keyOf = (m) => (m.kind + '|' + (m.make || '') + '|' + m.model).toLowerCase();
  /** The wireless receivers and in-ear systems feed the older patch list dialogs too. */
  function sync() {
    if (typeof Blk === 'undefined' || !Blk.RF_GEAR) return;
    const R = Blk.RF_GEAR;
    R.receivers.length = 0; R.iem.length = 0;
    (list || []).filter((m) => m.kind === 'receiver').forEach((m) => R.receivers.push({ name: m.model, make: m.make, model: m.model, ch: m.nin || 1 }));
    (list || []).filter((m) => m.kind === 'iemtx').forEach((m) => R.iem.push({ name: m.model, make: m.make, model: m.model, tx: 1 }));
  }
  async function load(force) {
    if (!force && list && Date.now() - at < 30000) return list;
    try { list = (await get('/api/devices/models')).models; at = Date.now(); } catch (e) { list = list || []; }
    sync();
    return list;
  }
  async function add(models) {
    const clean = models.filter((m) => m && m.kind && String(m.model || '').trim());
    if (!clean.length || !can('admin')) return list || [];
    try { list = (await call('POST', '/api/devices/models', { add: clean })).models; at = Date.now(); sync(); } catch (e) { /* the gear still gets added */ }
    return list;
  }
  async function remove(m) { list = (await call('POST', '/api/devices/models', { remove: [keyOf(m)] })).models; sync(); return list; }
  const find = (model, kind) => { const k = String(model || '').trim().toLowerCase(); return k ? (list || []).find((m) => (!kind || m.kind === kind) && m.model.toLowerCase() === k) : null; };
  const makes = () => [...new Set((list || []).map((m) => m.make).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { load, add, remove, find, makes, keyOf, all: () => list || [] };
})();

/** Turn device names and IPs inside root into links. */
function linkDevices(root) {
  if (!root || !DEV.dm || !DEV.dm.size) return;
  const skip = (n) => n.closest && n.closest('a, svg, textarea, input, button, select, .rte, .ph, .cmeta, .cfoot, .netline, h1.title, .dev-skip');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => (t.nodeValue.trim().length < 2 || skip(t.parentNode)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const t of nodes) {
    const hits = DEV.dm.find(t.nodeValue);
    if (!hits.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const h of hits) {
      if (h.index > pos) frag.appendChild(document.createTextNode(t.nodeValue.slice(pos, h.index)));
      const a = document.createElement('a');
      a.className = 'dev'; a.href = '#/d/' + h.id; a.dataset.dev = h.id; a.textContent = h.text;
      frag.appendChild(a);
      pos = h.index + h.length;
    }
    if (pos < t.nodeValue.length) frag.appendChild(document.createTextNode(t.nodeValue.slice(pos)));
    t.replaceWith(frag);
  }
}

// ---------- quick card on hover (mouse only; on phones a tap opens the card page) ----------
(() => {
  let pop = null, timer = null;
  const hide = () => { clearTimeout(timer); if (pop) { pop.remove(); pop = null; } };
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest && e.target.closest('a.dev');
    if (!a || !matchMedia('(hover: hover)').matches) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const d = (DEV.list || []).find((x) => String(x.id) === a.dataset.dev);
      if (!d) return;
      hide();
      pop = document.createElement('div');
      pop.className = 'devpop';
      pop.innerHTML = devThumb(d, 44) + '<div><b>' + esc(d.name) + '</b><span>' + esc([d.make, d.model].filter(Boolean).join(' ')) + '</span>' +
        (d.location ? '<span>' + esc(d.location) + '</span>' : '') + (d.networked && d.ips.length ? '<span class="mono">' + esc(d.ips.join(', ')) + '</span>' : '') + '</div>';
      document.body.appendChild(pop);
      const r = a.getBoundingClientRect();
      const left = Math.min(window.innerWidth - pop.offsetWidth - 10, Math.max(10, r.left));
      const below = r.bottom + 8 + pop.offsetHeight < window.innerHeight;
      pop.style.left = left + 'px';
      pop.style.top = (below ? r.bottom + 6 : r.top - pop.offsetHeight - 6) + window.scrollY + 'px';
    }, 250);
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('a.dev')) hide(); });
  window.addEventListener('hashchange', hide);
  window.addEventListener('scroll', hide, { passive: true });
})();

function devThumb(d, size) {
  const s = size || 40;
  return d.photo
    ? '<span class="dthumb" style="width:' + s + 'px;height:' + s + 'px;background-image:url(/uploads/' + esc(d.photo) + ')"></span>'
    : '<span class="dthumb" style="width:' + s + 'px;height:' + s + 'px">' + esc(d.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase()) + '</span>';
}

// ---------- the Gear Locker ----------
async function viewDevices(qs) {
  setTitle('Gear Locker');
  const list = await loadDevices(true);
  let bk = qs.get('b') || '';
  let q = '';
  let lc = qs.get('loc') || '';
  let by = 'bucket'; try { by = localStorage.getItem('lg-gl-by') || 'bucket'; } catch (e) { /* private mode */ }
  let shut = {}; try { shut = JSON.parse(localStorage.getItem('lg-gl-shut') || '{}'); } catch (e) { /* private mode */ }
  const sug = can('admin') ? (await get('/api/devices/suggestions')).suggestions : [];
  // who uses a piece of gear, from the stage patch (a mic, a pack)
  let users = new Map();
  try { const doc = await PatchView.load(); doc.gear.forEach((g) => { if (g.device_id && (g.person || g.use)) users.set(g.device_id, g.person || g.use); }); } catch (e) { /* the patch is optional */ }
  const order = bucketOrder(list);
  app.innerHTML = `<div class="crumbs"><a href="#/">Home</a><span>/</span></div>
    <div class="bar"><div class="grow"><h1 class="title" style="font-size:22px;letter-spacing:.06em;margin:4px 0 2px">GEAR LOCKER</h1>
      <div class="note">Every piece of gear, sorted into buckets. Its name, nickname or IP typed on a page links to its card here.</div></div>
      ${can('admin') ? '<a class="btn" href="#/gear-setup">' + icon('spark') + '<span class="hide-sm">Guided setup</span></a>' : ''}
      ${can('admin') ? '<button class="btn" id="gBk">' + icon('list') + '<span class="hide-sm">Buckets</span></button>' : ''}
      ${sug.length ? '<button class="btn" id="imp">' + icon('net') + 'From IP lists (' + sug.length + ')</button>' : ''}
      ${can('admin') ? '<button class="primary btn" id="newDev">' + icon('plus') + 'Add gear</button>' : ''}</div>
    <div class="bar"><input type="search" id="dq" placeholder="Find gear: name, model, location, IP or who uses it" style="flex:1;min-width:200px">
      <select id="dlf" title="Only gear in one location"><option value="">Every location</option>${gearLocations(list).map((l) => '<option' + (l === lc ? ' selected' : '') + '>' + esc(l) + '</option>').join('')}${list.some((d) => !d.location) ? '<option value="__none">No location set</option>' : ''}</select>
      <div class="seg" id="dgb"><button data-gb="bucket" class="${by === 'bucket' ? 'on' : ''}">By bucket</button><button data-gb="location" class="${by === 'location' ? 'on' : ''}">By location</button></div></div>
    <div class="gchips" id="dcat"><button data-b="" class="chipb on">All <em>${list.length}</em></button>${order.filter((b) => list.some((d) => bucketOf(d) === b)).map((b) => '<button class="chipb" data-b="' + esc(b) + '">' + esc(b) + ' <em>' + list.filter((d) => bucketOf(d) === b).length + '</em></button>').join('')}</div>
    <div id="dgrid"></div>`;
  const cardHtml = (d) => '<a class="dcard" href="#/d/' + d.id + '">' + devThumb(d, 46) +
    '<div class="t"><b>' + esc(d.name) + '</b><span>' + esc([d.make, d.model].filter(Boolean).join(' ') || CAT[d.category]) + '</span>' +
    '<span class="dmeta">' + [d.location ? icon('pin') + esc(d.location) : '', d.networked && d.ips.length ? '<span class="mono">' + esc(d.ips[0]) + '</span>' + (d.ips.length > 1 ? ' +' + (d.ips.length - 1) : '') : '', users.get(d.id) ? icon('user') + esc(users.get(d.id)) : ''].filter(Boolean).join('<i>·</i>') + '</span></div>' +
    '<div class="dbadges">' + (d.files ? '<span class="badge" title="' + d.files + ' manual' + (d.files === 1 ? '' : 's') + '">' + icon('pdf') + d.files + '</span>' : '') + (d.tech_only ? '<span class="badge tech">Tech only</span>' : '') + '</div></a>';
  const paint = () => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = list.filter((d) => (!bk || bucketOf(d) === bk) && (!lc || (lc === '__none' ? !d.location : d.location === lc)) && words.every((w) => [d.name, ...d.aliases, d.make, d.model, d.location, ...d.ips, users.get(d.id) || '', bucketOf(d)].join(' ').toLowerCase().includes(w)));
    if (!shown.length) {
      $('#dgrid').innerHTML = '<div class="card empty">' + (list.length ? 'No gear matches.' : 'The Gear Locker is empty.' + (can('admin') ? ' Try the <a href="#/gear-setup">guided setup</a> or add your first piece of gear' + (sug.length ? ', or make cards from the names already in your IP lists' : '') + '.' : '')) + '</div>';
      return;
    }
    const secOf = by === 'location' ? (d) => d.location || 'No location set' : bucketOf;
    const secs = by === 'location' ? gearLocations(shown).concat(shown.some((d) => !d.location) ? ['No location set'] : []) : order;
    $('#dgrid').innerHTML = secs.map((b) => {
      const inB = shown.filter((d) => secOf(d) === b);
      if (!inB.length) return '';
      const closed = !bk && !words.length && shut[b];
      return '<section class="gbucket' + (closed ? ' shut' : '') + '"><button type="button" class="gbh" data-shut="' + esc(b) + '"><span>' + esc(b) + '</span><em>' + inB.length + '</em><i>' + (closed ? '▸' : '▾') + '</i></button>' +
        (closed ? '' : '<div class="dgrid">' + inB.map(cardHtml).join('') + '</div>') + '</section>';
    }).join('');
    $$('[data-shut]').forEach((x) => x.addEventListener('click', () => { const b = x.dataset.shut; shut[b] = !shut[b]; try { localStorage.setItem('lg-gl-shut', JSON.stringify(shut)); } catch (e) { /* private mode */ } paint(); }));
  };
  if (bk && !$('#dcat [data-b="' + CSS.escape(bk) + '"]')) bk = '';
  $$('#dcat button').forEach((b) => { b.classList.toggle('on', b.dataset.b === bk); b.addEventListener('click', () => { bk = b.dataset.b; $$('#dcat button').forEach((x) => x.classList.toggle('on', x === b)); paint(); }); });
  $('#dq').addEventListener('input', (e) => { q = e.target.value; paint(); });
  $('#dlf').addEventListener('change', (e) => { lc = e.target.value; paint(); });
  $$('#dgb [data-gb]').forEach((b) => b.addEventListener('click', () => { by = b.dataset.gb; try { localStorage.setItem('lg-gl-by', by); } catch (e) { /* private mode */ } $$('#dgb button').forEach((x) => x.classList.toggle('on', x === b)); paint(); }));
  const nb = $('#newDev'); if (nb) nb.addEventListener('click', () => { location.hash = '#/gear/new' + (bk ? '?b=' + encodeURIComponent(bk) : ''); });
  const ib = $('#imp'); if (ib) ib.addEventListener('click', () => importDialog(sug));
  const gb = $('#gBk'); if (gb) gb.addEventListener('click', () => bucketsDialog(list));
  paint();
}

/** Admin: rename, reorder, add or remove buckets. */
function bucketsDialog(list) {
  const rows = bucketOrder(list).map((b) => ({ name: b, was: b, n: list.filter((d) => bucketOf(d) === b).length }));
  const paint = (w) => {
    $('#bkl', w).innerHTML = rows.map((r, i) => '<div class="bkrow"><input data-i="' + i + '" value="' + esc(r.name) + '" maxlength="40"><span class="note">' + r.n + '</span>' +
      '<button type="button" class="ghost xs" data-up="' + i + '"' + (i ? '' : ' disabled') + '>' + icon('up') + '</button><button type="button" class="ghost xs" data-dn="' + i + '"' + (i < rows.length - 1 ? '' : ' disabled') + '>' + icon('down') + '</button>' +
      '<button type="button" class="ghost xs danger" data-rm="' + i + '" title="Remove (its gear goes back to its automatic bucket)">' + icon('x') + '</button></div>').join('');
    $$('[data-i]', w).forEach((x) => x.addEventListener('input', () => { rows[Number(x.dataset.i)].name = x.value; }));
    $$('[data-up]', w).forEach((x) => x.addEventListener('click', () => { const i = Number(x.dataset.up); [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; paint(w); }));
    $$('[data-dn]', w).forEach((x) => x.addEventListener('click', () => { const i = Number(x.dataset.dn); [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; paint(w); }));
    $$('[data-rm]', w).forEach((x) => x.addEventListener('click', () => { rows.splice(Number(x.dataset.rm), 1); paint(w); }));
  };
  modal('<h3>Gear Locker buckets</h3><p class="note">Gear sorts itself into these by what it is. Rename or reorder them, add your own (Spares, Youth room), and move a piece of gear on its card (Edit › Bucket).</p><div id="bkl" class="bkl"></div>' +
    '<button type="button" class="btn" id="bkadd">' + icon('plus') + 'Add a bucket</button><div class="acts"><button type="button" data-close>Cancel</button><button class="primary" id="bkok">Save</button></div>', (w, close) => {
    paint(w);
    $('#bkadd', w).addEventListener('click', () => { rows.push({ name: '', was: '', n: 0 }); paint(w); const ins = $$('[data-i]', w); ins[ins.length - 1].focus(); });
    $('#bkok', w).addEventListener('click', async () => {
      const names = rows.map((r) => r.name.trim()).filter(Boolean);
      const renames = {}; rows.forEach((r) => { if (r.was && r.name.trim() && r.was !== r.name.trim()) renames[r.was] = r.name.trim(); });
      // gear in an automatic bucket that was renamed: give it the new name for real
      const moves = list.filter((d) => !d.bucket && renames[autoBucket(d)]);
      try {
        await call('PUT', '/api/devices/buckets', { buckets: names, renames });
        for (const d of moves) await call('PUT', '/api/devices/' + d.id, { ...(await get('/api/devices/' + d.id)).device, bucket: renames[autoBucket(d)] });
        close(); forgetDevices(); toast('Buckets saved', 'ok'); route();
      } catch (e) { toast(e.message, 'bad'); }
    });
  });
}

function importDialog(sug) {
  modal('<h3>Create cards from IP lists</h3><p>These device names are in your IP lists but have no card yet. Their IP addresses stay in the IP list and link through it.</p>' +
    '<div class="implist">' + sug.map((s, i) => '<label class="tog on"><input type="checkbox" data-i="' + i + '" checked><span><b>' + esc(s.name) + '</b> <span class="note">' + esc([s.ip, s.location, s.from].filter(Boolean).join(' · ')) + '</span></span></label>').join('') + '</div>' +
    '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary" id="impok">Create cards</button></div>', (w, close) => {
    w.querySelectorAll('input[data-i]').forEach((x) => x.addEventListener('change', () => x.closest('.tog').classList.toggle('on', x.checked)));
    w.querySelector('#impok').addEventListener('click', async () => {
      const names = Array.from(w.querySelectorAll('input[data-i]:checked')).map((x) => sug[Number(x.dataset.i)].name);
      if (!names.length) return close();
      try { const r = await call('POST', '/api/devices/import', { names }); close(); forgetDevices(); toast(r.made + ' card' + (r.made === 1 ? '' : 's') + ' created', 'ok'); route(); }
      catch (e) { toast(e.message, 'bad'); }
    });
  });
}

async function viewDevice(id) {
  let d;
  try { d = await get('/api/devices/' + id); }
  catch (e) {
    if (e.status === 404) { app.innerHTML = '<div class="card empty">' + esc(e.message) + '<div style="margin-top:12px"><a href="#/gear">Gear Locker</a></div></div>'; return; }
    throw e;
  }
  await loadDevices();
  const v = d.device;
  setTitle(v.name);
  const ipRows = v.ips.map((ip) => {
    const src = v.ipSources.filter((s) => s.ip === ip);
    const where = [...new Set((v.ip === ip ? ['on this card'] : []).concat(src.map((s) => 'IP list ' + s.network + (s.vlan ? ' (VLAN ' + s.vlan + ')' : ''))))];
    return '<div><a class="mono" href="http://' + esc(ip) + '" target="_blank" rel="noopener">' + esc(ip) + '</a> <span class="note">' + esc(where.join(', ')) + '</span></div>';
  }).join('');
  const L = d.links || {};
  const dl = (x) => '<a href="#/d/' + x.id + '">' + esc(x.name) + '</a>';
  const facts = [
    ['Location', esc(v.location)],
    ['Plugged into', v.networked && L.uplink ? dl(L.uplink) + (L.uplink.port ? ' · port <span class="mono">' + esc(L.uplink.port) + '</span>' : '') : ''],
    ['VLAN', !v.networked ? '' : (L.vlans || []).map((x) => '<a class="chip" href="#/map/vlans"><i class="sw" style="background:' + esc(x.color) + '"></i>' + x.vid + ' ' + esc(x.name) + '</a>').join(' ')],
    ['Connected here', (L.children || []).map((x) => '<div>' + (x.port ? '<span class="mono">' + esc(x.port) + '</span> ' : '') + dl(x) + '</div>').join('')],
    ['Signal from', (L.signalIn || []).map((x) => dl(x) + (x.count > 1 ? ' <span class="note">×' + x.count + '</span>' : '')).join(', ')],
    ['Signal to', (L.signalOut || []).map((x) => dl(x) + (x.count > 1 ? ' <span class="note">×' + x.count + '</span>' : '')).join(', ')], ['IP address' + (v.ips.length > 1 ? 'es' : ''), v.networked ? ipRows : ''], ['Inputs / outputs', v.inputs || v.outputs ? (v.inputs || 0) + ' in · ' + (v.outputs || 0) + ' out' : ''], ['MAC', v.networked && v.mac ? '<span class="mono">' + esc(v.mac) + '</span>' : ''],
    ['Also called', esc(v.aliases.join(', '))], ['Manual', v.manual_url ? '<a href="' + esc(v.manual_url) + '" target="_blank" rel="noopener">' + esc(v.manual_url.replace(/^https?:\/\//, '').slice(0, 60)) + '</a>' : '']
  ].filter((f) => f[1]);
  const used = d.usedOn;
  app.innerHTML = `<div class="page dev">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/gear">Gear Locker</a></div>
    <div class="devhead">${v.photo ? '<a href="#dphoto" class="devphotoa" id="dpa"><img class="devphoto" src="/uploads/' + esc(v.photo) + '" alt=""></a>' : devThumb(v, 84)}
      <div class="grow"><h1 class="title">${esc(v.name)}</h1><div class="meta" style="margin:0">${esc([v.make, v.model].filter(Boolean).join(' '))}
        <span class="chip">${CAT[v.category] || 'Other'}</span>${v.tech_only ? '<span class="badge tech">Tech only</span>' : ''}</div></div>
      <div class="acts-top">${can('admin') ? '<button class="btn" id="eD">' + icon('edit') + 'Edit</button><button class="ghost danger" id="xD" title="Delete device">' + icon('trash') + '</button>' : '<button class="btn ghost" id="rD">' + icon('alert') + 'Report a problem</button>'}</div></div>
    ${facts.length ? '<div class="card facts">' + facts.map((f) => '<div class="fact"><span>' + f[0] + '</span><div>' + f[1] + '</div></div>').join('') + '</div>' : ''}
    ${v.notes.trim() ? '<div class="doc" id="dnotes">' + md(v.notes) + '</div>' : ''}
    ${v.photo ? '<div class="section" style="margin-top:20px" id="dphoto"><div class="hsh"><h2>Photo</h2>' + (can('admin') ? '<button class="btn" id="dmk">' + icon('edit') + (v.marks.length ? 'Edit highlights' : 'Highlight on the photo') + '</button>' : '') + '</div><div id="dmarks"></div></div>' : ''}
    <div class="section" style="margin-top:20px"><h2>Manuals and documents</h2><div id="dfiles"></div></div>
    <div class="section" style="margin-top:20px"><h2>Used on</h2>${used.length ? '<div class="list used">' + used.map((u) => {
      const first = u.hits.find((h) => h.block);
      return '<a class="row" href="' + (u.page_id === 'patch' ? '#/patch?g=' + esc(u.gear) : '#/p/' + u.page_id + (first ? '?c=' + esc(first.block) : '')) + '"><div class="t"><b>' + esc(u.title) + '</b>' +
        u.hits.slice(0, 6).map((h) => '<span class="hit"><em>' + esc(h.label) + '</em> ' + esc(h.text) + '</span>').join('') + (u.hits.length > 6 ? '<span class="note">and ' + (u.hits.length - 6) + ' more</span>' : '') + '</div>' +
        (u.tech_only ? '<span class="badge tech">Tech only</span>' : '') + '<span class="m hide-sm">' + esc(u.space_name || '') + '</span></a>';
    }).join('') + '</div>'
      : '<div class="card empty">Not mentioned on any page yet. Type its name' + (v.aliases.length ? ', a nickname' : '') + (v.ips.length ? ' or its IP' : '') + ' on any page and it links here by itself.</div>'}</div>
  </div>`;
  linkDevices($('#dnotes'));
  paintFiles($('#dfiles'), v, d.files || []);
  if (v.photo) {
    $('#dmarks').innerHTML = marksView(v.photo, v.marks);
    wireMarksView($('#dmarks'));
    $('#dpa').addEventListener('click', (e) => { e.preventDefault(); $('#dphoto').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    const mk = $('#dmk'); if (mk) mk.addEventListener('click', () => marksEditor(v, (marks) => { v.marks = marks; $('#dmarks').innerHTML = marksView(v.photo, marks); wireMarksView($('#dmarks')); mk.lastChild.textContent = marks.length ? 'Edit highlights' : 'Highlight on the photo'; }));
  }
  const rd = $('#rD'); if (rd) rd.addEventListener('click', () => reportProblem(v.name, { device_id: v.id }));
  if (can('admin')) {
    $('#eD').addEventListener('click', () => { location.hash = '#/d/' + v.id + '/edit'; });
    $('#xD').addEventListener('click', async () => {
      if (!await confirmBox('Delete ' + v.name + '?', 'The card is removed and pages stop linking to it. The pages themselves do not change.', 'Delete', true)) return;
      try { await call('DELETE', '/api/devices/' + v.id); forgetDevices(); toast('Removed from the Gear Locker', 'ok'); location.hash = '#/gear'; } catch (e) { toast(e.message, 'bad'); }
    });
  }
}

// ---------- highlight boxes on the gear photo ----------
const MARK_COLORS = { yellow: '#facc15', red: '#ef4444', green: '#22c55e', blue: '#3b82f6', purple: '#a855f7' };
const markBox = (m, i, cls) => '<div class="hmk ' + (cls || '') + '" data-mi="' + i + '" style="left:' + (m.x * 100) + '%;top:' + (m.y * 100) + '%;width:' + (m.w * 100) + '%;height:' + (m.h * 100) + '%;--mc:' + MARK_COLORS[m.color || 'yellow'] + '"' + (m.label ? ' title="' + esc(m.label) + '"' : '') + '><b>' + (i + 1) + '</b>' + (m.label ? '<span>' + esc(m.label) + '</span>' : '') + '</div>';
/** The photo with its highlight boxes, numbered, and the list of what each one is. */
function marksView(photo, marks) {
  return '<div class="mkwrap"><div class="mkpic"><img src="/uploads/' + esc(photo) + '" alt="">' + marks.map((m, i) => markBox(m, i)).join('') + '</div>' +
    (marks.length ? '<ol class="mklist">' + marks.map((m, i) => '<li data-mi="' + i + '" style="--mc:' + MARK_COLORS[m.color || 'yellow'] + '"><b>' + (i + 1) + '</b><span>' + esc(m.label || 'Highlight ' + (i + 1)) + '</span></li>').join('') + '</ol>' : '') + '</div>';
}
function wireMarksView(host) {
  const hi = (i, on) => $$('[data-mi="' + i + '"]', host).forEach((x) => x.classList.toggle('hot', on));
  $$('[data-mi]', host).forEach((x) => { x.addEventListener('mouseenter', () => hi(x.dataset.mi, true)); x.addEventListener('mouseleave', () => hi(x.dataset.mi, false)); x.addEventListener('click', () => { const on = !x.classList.contains('hot'); $$('.hot', host).forEach((y) => y.classList.remove('hot')); hi(x.dataset.mi, on); }); });
}
/** Admin: draw boxes on the photo (drag), move them, resize from the corner, name and colour them. */
function marksEditor(v, done) {
  const marks = (v.marks || []).map((m) => ({ ...m }));
  let sel = marks.length ? 0 : -1, color = 'yellow';
  modal('<h3>Highlight on the photo</h3><p class="note">Drag on the picture to draw a box around a switch, a socket or a label. Drag a box to move it, its corner to resize it, and name it on the right.</p>' +
    '<div class="mked"><div class="mkpic edit" id="mkp"><img src="/uploads/' + esc(v.photo) + '" alt="" draggable="false"><div id="mkb"></div></div><div class="mkside" id="mks"></div></div>' +
    '<div class="acts"><span class="grow note" id="mkn"></span><button type="button" data-close>Cancel</button><button class="primary" id="mkok">Save</button></div>', (w, close) => {
    w.classList.add('mwide', 'mkmodal');
    const pic = $('#mkp', w), boxes = $('#mkb', w), side = $('#mks', w);
    function paint() {
      boxes.innerHTML = marks.map((m, i) => markBox(m, i, i === sel ? 'sel' : '').replace('</div>', '<i class="mkh" data-h="' + i + '"></i></div>')).join('');
      side.innerHTML = (marks.length ? marks.map((m, i) => '<div class="mkrow' + (i === sel ? ' sel' : '') + '" data-row="' + i + '"><b style="--mc:' + MARK_COLORS[m.color] + '">' + (i + 1) + '</b><input data-lab="' + i + '" value="' + esc(m.label || '') + '" placeholder="Power switch, Reset, Input 1…" maxlength="80">' +
        '<div class="mkcol">' + Object.keys(MARK_COLORS).map((c) => '<button type="button" data-col="' + c + '" data-ci="' + i + '" class="' + (m.color === c ? 'on' : '') + '" style="--mc:' + MARK_COLORS[c] + '" title="' + c + '"></button>').join('') + '<button type="button" class="ghost xs danger" data-del="' + i + '" title="Remove">' + icon('trash') + '</button></div></div>').join('')
        : '<p class="note">No highlights yet. Drag on the picture to draw the first one.</p>');
      $('#mkn', w).textContent = marks.length + ' highlight' + (marks.length === 1 ? '' : 's');
      $$('[data-row]', side).forEach((r) => r.addEventListener('click', (e) => { if (e.target.closest('button')) return; sel = Number(r.dataset.row); boxes.querySelectorAll('.hmk').forEach((b) => b.classList.toggle('sel', Number(b.dataset.mi) === sel)); $$('[data-row]', side).forEach((x) => x.classList.toggle('sel', x === r)); }));
      $$('[data-lab]', side).forEach((x) => x.addEventListener('input', () => { marks[Number(x.dataset.lab)].label = x.value; const sp = boxes.querySelector('[data-mi="' + x.dataset.lab + '"] span'); if (sp) sp.textContent = x.value; else paintBoxesOnly(); }));
      $$('[data-col]', side).forEach((x) => x.addEventListener('click', () => { const i = Number(x.dataset.ci); marks[i].color = x.dataset.col; color = x.dataset.col; sel = i; paint(); }));
      $$('[data-del]', side).forEach((x) => x.addEventListener('click', () => { marks.splice(Number(x.dataset.del), 1); sel = Math.min(sel, marks.length - 1); paint(); }));
    }
    const paintBoxesOnly = () => { boxes.innerHTML = marks.map((m, i) => markBox(m, i, i === sel ? 'sel' : '').replace('</div>', '<i class="mkh" data-h="' + i + '"></i></div>')).join(''); };
    // drawing, moving and resizing, in fractions of the picture
    let drag = null;
    const at = (e) => { const r = pic.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    pic.addEventListener('pointerdown', (e) => {
      e.preventDefault(); pic.setPointerCapture(e.pointerId);
      const p = at(e), h = e.target.closest('.mkh'), b = e.target.closest('.hmk');
      if (h) { sel = Number(h.dataset.h); drag = { mode: 'size', i: sel, p }; }
      else if (b) { sel = Number(b.dataset.mi); const m = marks[sel]; drag = { mode: 'move', i: sel, p, ox: m.x, oy: m.y }; }
      else { marks.push({ x: p.x, y: p.y, w: 0, h: 0, label: '', color }); sel = marks.length - 1; drag = { mode: 'new', i: sel, p }; }
      paintBoxesOnly();
    });
    pic.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = at(e), m = marks[drag.i];
      if (drag.mode === 'new') { m.x = Math.min(p.x, drag.p.x); m.y = Math.min(p.y, drag.p.y); m.w = Math.abs(p.x - drag.p.x); m.h = Math.abs(p.y - drag.p.y); }
      else if (drag.mode === 'move') { m.x = Math.max(0, Math.min(1 - m.w, drag.ox + p.x - drag.p.x)); m.y = Math.max(0, Math.min(1 - m.h, drag.oy + p.y - drag.p.y)); }
      else { m.w = Math.max(0.02, Math.min(1 - m.x, p.x - m.x)); m.h = Math.max(0.02, Math.min(1 - m.y, p.y - m.y)); }
      paintBoxesOnly();
    });
    const end = () => {
      if (!drag) return;
      const m = marks[drag.i];
      if (drag.mode === 'new' && (m.w < 0.015 || m.h < 0.015)) { marks.splice(drag.i, 1); sel = marks.length - 1; }
      drag = null; paint();
      if (sel >= 0) { const inp = $('[data-lab="' + sel + '"]', side); if (inp && !inp.value) inp.focus(); }
    };
    pic.addEventListener('pointerup', end); pic.addEventListener('pointercancel', end);
    $('#mkok', w).addEventListener('click', async () => {
      try { const r = await call('PUT', '/api/devices/' + v.id + '/marks', { marks }); close(); toast('Highlights saved', 'ok'); done(r.marks); }
      catch (e) { toast(e.message, 'bad'); }
    });
    paint();
  });
}

/** Manuals, quick-start guides, wiring diagrams: stored in LiveGenie (and in its backups), opened in the browser. */
const fileSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const fileIcon = (m) => (m === 'application/pdf' ? 'pdf' : /^image\//.test(m) ? 'image' : 'text');
function paintFiles(host, v, files) {
  host.innerHTML = (files.length ? '<div class="list files">' + files.map((f) => '<div class="row frow">' + icon(fileIcon(f.mime)) + '<a class="t" href="/files/' + esc(f.id) + '" target="_blank" rel="noopener"><b>' + esc(f.name) + '</b><span>' + fileSize(f.bytes) + ' · added ' + esc(ago(f.uploaded_at)) + (f.uploaded_by ? ' by ' + esc(f.uploaded_by) : '') + '</span></a>' +
    '<a class="ghost abtn" href="/files/' + esc(f.id) + '?download=1" title="Download">' + icon('download') + '</a>' + (can('admin') ? '<button class="ghost danger" data-fdel="' + esc(f.id) + '" title="Remove">' + icon('trash') + '</button>' : '') + '</div>').join('') + '</div>'
    : '<div class="card empty" style="padding:16px">' + (can('admin') ? 'No manuals yet. Upload the PDF manual, a quick-start guide or a wiring diagram.' : 'No manuals yet.') + '</div>') +
    (can('admin') ? '<div class="adder" style="margin-top:8px"><input type="file" id="fup" class="hide" multiple accept=".pdf,image/*,.txt,.doc,.docx,.xls,.xlsx,.zip"><button class="btn" id="fupb">' + icon('upload') + 'Upload a manual or document</button><span class="note" id="fmsg"></span></div>' : '');
  $$('[data-fdel]', host).forEach((b) => b.addEventListener('click', async () => {
    const f = files.find((x) => x.id === b.dataset.fdel);
    if (!await confirmBox('Remove ' + f.name + '?', 'It is deleted from LiveGenie (older backups still have it).', 'Remove', true)) return;
    await call('DELETE', '/api/files/' + f.id); files.splice(files.indexOf(f), 1); paintFiles(host, v, files); forgetDevices();
  }));
  const inp = $('#fup', host), btn = $('#fupb', host);
  if (btn) btn.addEventListener('click', () => inp.click());
  if (inp) inp.addEventListener('change', async () => {
    for (const f of inp.files) {
      $('#fmsg', host).textContent = 'Uploading ' + f.name + '…';
      try { const r = await call('POST', '/api/devices/' + v.id + '/files', f, { raw: true, type: f.type || 'application/octet-stream', headers: { 'x-filename': encodeURIComponent(f.name) } }); files.push({ ...r.file, uploaded_at: Date.now(), uploaded_by: S.state.user.name }); }
      catch (e) { toast(f.name + ': ' + e.message, 'bad'); }
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    paintFiles(host, v, files); forgetDevices();
  });
}

async function viewDeviceEdit(id) {
  if (!can('admin')) { app.innerHTML = '<div class="card empty">Admins can add and change devices.</div>'; if (!S.state.user) signInDialog(() => route()); return; }
  await loadDevices();
  const d = id ? (await get('/api/devices/' + id)).device : { bucket: new URLSearchParams((location.hash.split('?')[1] || '')).get('b') || '', inputs: '', outputs: '', uplink_id: '', uplink_port: '', name: '', aliases: [], category: 'audio', make: '', model: '', location: '', ip: '', mac: '', photo: '', manual_url: '', notes: '', tech_only: false };
  setTitle(id ? 'Edit ' + d.name : 'Add gear');
  const locations = gearLocations(DEV.list || [], d.location);
  S.dirty = false;
  const f = (k, label, ph, extra) => '<label class="dfield' + (extra && extra.wide ? ' wide' : '') + '"><span>' + label + '</span><input data-k="' + k + '" value="' + esc(d[k]) + '" placeholder="' + esc(ph || '') + '"' + (extra && extra.mono ? ' class="mono" autocapitalize="off" spellcheck="false"' : '') + (extra && extra.mode ? ' inputmode="' + extra.mode + '"' : '') + '>' + (extra && extra.hint ? '<em>' + extra.hint + '</em>' : '') + '</label>';
  app.innerHTML = `<div class="ed">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/gear">Gear Locker</a><span>/</span><span>${id ? 'Edit' : 'Add gear'}</span></div>
    <div class="card" style="margin-top:8px">
      <div class="dphoto"><div id="dph"></div><input type="file" accept="image/*" class="hide" id="dpf"><div><button type="button" id="dpb">${d.photo ? 'Replace photo' : 'Add photo'}</button>${d.photo ? ' <button type="button" class="ghost danger" id="dpx">Remove</button>' : ''}<div class="note">A photo of the device or its rack position helps volunteers find it.</div></div></div>
      <div class="dform">
        ${f('name', 'Name', 'What your team calls it', { wide: true })}
        <label class="dfield wide"><span>Also called</span><input data-k="aliases" value="${esc(d.aliases.join(', '))}" placeholder="Nicknames, comma between"><em>Other names people type, separated by commas. Each one links to this card.</em></label>
        <label class="dfield"><span>Category</span><select data-k="category">${Object.keys(CAT).map((k) => '<option value="' + k + '"' + (k === d.category ? ' selected' : '') + '>' + CAT[k] + '</option>').join('')}</select></label>
        <label class="dfield"><span>Bucket</span><select data-k="bucket"><option value="">Automatic (${esc(autoBucket({ ...d, kind: (DEV.list || []).find((x) => x.id === d.id)?.kind || '' }))})</option>${bucketOrder(DEV.list || []).map((b) => '<option' + (b === d.bucket ? ' selected' : '') + '>' + esc(b) + '</option>').join('')}</select><em>Where it sits in the Gear Locker</em></label>
        ${f('make', 'Make', 'Manufacturer')}${f('model', 'Model', 'Model number')}
        <label class="dfield"><span>Location</span><select data-k="location" id="dloc"><option value="">Not set</option>${locations.map((l) => '<option' + (l === d.location ? ' selected' : '') + '>' + esc(l) + '</option>').join('')}<option value="__new">+ New location…</option></select><em>Where it lives: a rack, a room, a road case</em></label>
        <label class="dfield"><span>Inputs</span><input data-k="inputs" type="number" min="0" max="512" value="${esc(d.inputs || '')}" placeholder="0"><em>For stage boxes and consoles</em></label>
        <label class="dfield"><span>Outputs</span><input data-k="outputs" type="number" min="0" max="512" value="${esc(d.outputs || '')}" placeholder="0"></label>
        ${f('manual_url', 'Manual link', 'https://…', { wide: true, mode: 'url' })}
        <label class="tog dfield wide ${d.networked ? 'on' : ''}"><input type="checkbox" data-k="networked" ${d.networked ? 'checked' : ''}>On the network <em>Has an IP address, a MAC or plugs into a switch</em></label>
        <div class="dnet wide${d.networked ? '' : ' hide'}" id="dnet">
        ${f('ip', 'IP address', '0.0.0.0', { mono: true, mode: 'decimal', hint: 'Addresses in IP lists link here too when the name matches.' })}
        ${f('mac', 'MAC', '', { mono: true })}
        <label class="dfield"><span>Plugged into</span><select data-k="uplink_id"><option value="">Nothing / not set</option>${(await loadDevices(true)).filter((x) => String(x.id) !== String(id)).map((x) => '<option value="' + x.id + '"' + (String(x.id) === String(d.uplink_id || '') ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('')}</select><em>The switch, router or access point it connects to. Draws the network map.</em></label>
        ${f('uplink_port', 'Port', 'Port number', { mode: 'text', hint: 'Port on that switch (optional)' })}
        </div>
        <label class="tog dfield wide ${d.tech_only ? 'on' : ''}"><input type="checkbox" data-k="tech_only" ${d.tech_only ? 'checked' : ''}>Admins only <em>Hidden from users</em></label>
      </div>
      <div class="dfield wide" style="margin-top:12px"><span>Notes</span><div id="dnotes"></div></div>
    </div>
    <div class="edbar"><span class="note" id="eMsg"></span><button id="dCancel">Cancel</button><button class="primary" id="dSave">${id ? 'Save' : 'Add to the Gear Locker'}</button></div>
  </div>`;
  const dirty = () => { S.dirty = true; $('#eMsg').textContent = 'Unsaved changes'; };
  $$('[data-k]').forEach((x) => x.addEventListener(x.type === 'checkbox' || x.tagName === 'SELECT' ? 'change' : 'input', () => {
    const k = x.dataset.k;
    d[k] = x.type === 'checkbox' ? x.checked : k === 'aliases' ? x.value.split(',').map((s) => s.trim()).filter(Boolean) : x.value;
    if (x.type === 'checkbox') x.closest('.tog').classList.toggle('on', x.checked);
    if (k === 'networked') $('#dnet').classList.toggle('hide', !x.checked);
    dirty();
  }));
  // a new location: type it once, then it is on the list for every piece of gear
  const loc = $('#dloc');
  loc.addEventListener('change', () => {
    if (loc.value !== '__new') return;
    loc.value = d.location || '';
    modal('<h3>New location</h3><form id="nlf"><label>Name</label><input id="nl" placeholder="Rack, room or case"><div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Add</button></div></form>', (w, close) => {
      $('#nlf', w).addEventListener('submit', (e) => {
        e.preventDefault(); const v = $('#nl', w).value.trim(); if (!v) return; close();
        if (![...loc.options].some((o) => o.value === v)) loc.insertBefore(new Option(v, v), loc.querySelector('[value="__new"]'));
        loc.value = v; d.location = v; dirty();
      });
    });
  });
  const r = Rich.create({ md: d.notes, compact: true, placeholder: 'Settings, quirks, how to reset it, who to call…', onChange: (v) => { d.notes = v; dirty(); } });
  $('#dnotes').appendChild(r.el);
  const photo = () => { $('#dph').innerHTML = d.photo ? '<img src="/uploads/' + esc(d.photo) + '" alt="">' : devThumb({ name: d.name || '?' }, 84); };
  photo();
  $('#dpb').addEventListener('click', () => $('#dpf').click());
  const px = $('#dpx'); if (px) px.addEventListener('click', () => { d.photo = ''; photo(); dirty(); px.remove(); });
  $('#dpf').addEventListener('change', async () => {
    const file = $('#dpf').files[0]; if (!file) return;
    $('#eMsg').textContent = 'Uploading photo…';
    try { const pic = await shrink(file); const up = await call('POST', '/api/uploads', pic.blob, { raw: true, type: pic.type }); d.photo = up.id; photo(); dirty(); }
    catch (e) { toast(e.message, 'bad'); $('#eMsg').textContent = S.dirty ? 'Unsaved changes' : ''; }
  });
  $('#dCancel').addEventListener('click', () => { location.hash = id ? '#/d/' + id : '#/gear'; });
  $('#dSave').addEventListener('click', async () => {
    $('#dSave').disabled = true;
    try {
      if (id) { await call('PUT', '/api/devices/' + id, d); S.dirty = false; forgetDevices(); toast('Saved', 'ok'); location.hash = '#/d/' + id; }
      else { const x = await call('POST', '/api/devices', d); S.dirty = false; forgetDevices(); toast('Added to the Gear Locker', 'ok'); location.hash = '#/d/' + x.id; }
    } catch (e) { toast(e.message, 'bad'); }
    finally { const b = $('#dSave'); if (b) b.disabled = false; }
  });
  if (!id) $('[data-k=name]').focus();
}
