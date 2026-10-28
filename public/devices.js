/*
 * Device library pages, and the automatic links: any device name, alias or IP
 * on a page becomes a link to its card, with a quick card on hover.
 */
'use strict';

const CAT = { audio: 'Audio', video: 'Video', lighting: 'Lighting', network: 'Network', computer: 'Computer', power: 'Power', other: 'Other' };
const DEV = { list: null, at: 0, dm: null, loading: null };

async function loadDevices(force) {
  if (!force && DEV.list && Date.now() - DEV.at < 30000) return DEV.list;
  if (DEV.loading) return DEV.loading;
  DEV.loading = get('/api/devices').then((d) => {
    DEV.list = d.devices; DEV.at = Date.now();
    DEV.dm = DevMatch.build(d.devices);
    return DEV.list;
  }).catch(() => DEV.list || []).finally(() => { DEV.loading = null; });
  return DEV.loading;
}
const forgetDevices = () => { DEV.at = 0; };

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
        (d.location ? '<span>' + esc(d.location) + '</span>' : '') + (d.ips.length ? '<span class="mono">' + esc(d.ips.join(', ')) + '</span>' : '') + '</div>';
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

// ---------- the library ----------
async function viewDevices(qs) {
  setTitle('Devices');
  const list = await loadDevices(true);
  let cat = qs.get('cat') || '';
  let q = '';
  const sug = can('editor') ? (await get('/api/devices/suggestions')).suggestions : [];
  app.innerHTML = `<div class="crumbs"><a href="#/">Home</a><span>/</span></div>
    <div class="bar"><div class="grow"><h1 class="title" style="font-size:22px;letter-spacing:.06em;margin:4px 0 2px">DEVICES</h1>
      <div class="note">Every device name, nickname or IP address typed on a page links to its card here.</div></div>
      ${sug.length ? '<button class="btn" id="imp">' + icon('net') + 'Create from IP lists (' + sug.length + ')</button>' : ''}
      ${can('editor') ? '<button class="primary btn" id="newDev">' + icon('plus') + 'New device</button>' : ''}</div>
    <div class="bar"><input type="search" id="dq" placeholder="Filter by name, model, location or IP" style="flex:1;min-width:200px">
      <div class="seg" id="dcat"><button data-c="" class="on">All</button>${Object.keys(CAT).filter((k) => list.some((d) => d.category === k)).map((k) => '<button data-c="' + k + '">' + CAT[k] + '</button>').join('')}</div></div>
    <div id="dgrid"></div>`;
  const paint = () => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = list.filter((d) => (!cat || d.category === cat) && words.every((w) => [d.name, ...d.aliases, d.make, d.model, d.location, ...d.ips].join(' ').toLowerCase().includes(w)));
    $('#dgrid').innerHTML = shown.length ? '<div class="dgrid">' + shown.map((d) => '<a class="dcard" href="#/d/' + d.id + '">' + devThumb(d, 46) +
      '<div class="t"><b>' + esc(d.name) + '</b><span>' + esc([d.make, d.model].filter(Boolean).join(' ') || CAT[d.category]) + '</span>' +
      '<span>' + esc(d.location) + (d.location && d.ips.length ? ' · ' : '') + (d.ips.length ? '<span class="mono">' + esc(d.ips[0]) + '</span>' + (d.ips.length > 1 ? ' +' + (d.ips.length - 1) : '') : '') + '</span></div>' +
      (d.tech_only ? '<span class="badge tech">Tech only</span>' : '') + '</a>').join('') + '</div>'
      : '<div class="card empty">' + (list.length ? 'No devices match.' : 'No devices yet.' + (can('editor') ? ' Add the SQ-5, the DriveRack PA2 or a stage box' + (sug.length ? ', or create cards from the names already in your IP lists' : '') + '.' : '')) + '</div>';
  };
  if (cat && !$('#dcat [data-c="' + cat + '"]')) cat = '';
  $$('#dcat button').forEach((b) => { b.classList.toggle('on', b.dataset.c === cat); b.addEventListener('click', () => { cat = b.dataset.c; $$('#dcat button').forEach((x) => x.classList.toggle('on', x === b)); paint(); }); });
  $('#dq').addEventListener('input', (e) => { q = e.target.value; paint(); });
  const nb = $('#newDev'); if (nb) nb.addEventListener('click', () => { location.hash = '#/devices/new'; });
  const ib = $('#imp'); if (ib) ib.addEventListener('click', () => importDialog(sug));
  paint();
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
    if (e.status === 404) { app.innerHTML = '<div class="card empty">' + esc(e.message) + '<div style="margin-top:12px"><a href="#/devices">All devices</a></div></div>'; return; }
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
    ['Plugged into', L.uplink ? dl(L.uplink) + (L.uplink.port ? ' · port <span class="mono">' + esc(L.uplink.port) + '</span>' : '') : ''],
    ['VLAN', (L.vlans || []).map((x) => '<a class="chip" href="#/map/vlans"><i class="sw" style="background:' + esc(x.color) + '"></i>' + x.vid + ' ' + esc(x.name) + '</a>').join(' ')],
    ['Connected here', (L.children || []).map((x) => '<div>' + (x.port ? '<span class="mono">' + esc(x.port) + '</span> ' : '') + dl(x) + '</div>').join('')],
    ['Signal from', (L.signalIn || []).map((x) => dl(x) + (x.count > 1 ? ' <span class="note">×' + x.count + '</span>' : '')).join(', ')],
    ['Signal to', (L.signalOut || []).map((x) => dl(x) + (x.count > 1 ? ' <span class="note">×' + x.count + '</span>' : '')).join(', ')], ['IP address' + (v.ips.length > 1 ? 'es' : ''), ipRows], ['MAC', v.mac ? '<span class="mono">' + esc(v.mac) + '</span>' : ''],
    ['Also called', esc(v.aliases.join(', '))], ['Manual', v.manual_url ? '<a href="' + esc(v.manual_url) + '" target="_blank" rel="noopener">' + esc(v.manual_url.replace(/^https?:\/\//, '').slice(0, 60)) + '</a>' : '']
  ].filter((f) => f[1]);
  const used = d.usedOn;
  app.innerHTML = `<div class="page dev">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/devices">Devices</a></div>
    <div class="devhead">${v.photo ? '<img class="devphoto" src="/uploads/' + esc(v.photo) + '" alt="">' : devThumb(v, 84)}
      <div class="grow"><h1 class="title">${esc(v.name)}</h1><div class="meta" style="margin:0">${esc([v.make, v.model].filter(Boolean).join(' '))}
        <span class="chip">${CAT[v.category] || 'Other'}</span>${v.tech_only ? '<span class="badge tech">Tech only</span>' : ''}</div></div>
      <div class="acts-top">${can('editor') ? '<button class="btn" id="eD">' + icon('edit') + 'Edit</button><button class="ghost danger" id="xD" title="Delete device">' + icon('trash') + '</button>' : ''}</div></div>
    ${facts.length ? '<div class="card facts">' + facts.map((f) => '<div class="fact"><span>' + f[0] + '</span><div>' + f[1] + '</div></div>').join('') + '</div>' : ''}
    ${v.notes.trim() ? '<div class="doc" id="dnotes">' + md(v.notes) + '</div>' : ''}
    <div class="section" style="margin-top:20px"><h2>Used on</h2>${used.length ? '<div class="list used">' + used.map((u) => {
      const first = u.hits.find((h) => h.block);
      return '<a class="row" href="#/p/' + u.page_id + (first ? '?c=' + esc(first.block) : '') + '"><div class="t"><b>' + esc(u.title) + '</b>' +
        u.hits.slice(0, 6).map((h) => '<span class="hit"><em>' + esc(h.label) + '</em> ' + esc(h.text) + '</span>').join('') + (u.hits.length > 6 ? '<span class="note">and ' + (u.hits.length - 6) + ' more</span>' : '') + '</div>' +
        (u.tech_only ? '<span class="badge tech">Tech only</span>' : '') + '<span class="m hide-sm">' + esc(u.space_name || '') + '</span></a>';
    }).join('') + '</div>'
      : '<div class="card empty">Not mentioned on any page yet. Type its name' + (v.aliases.length ? ', a nickname' : '') + (v.ips.length ? ' or its IP' : '') + ' on any page and it links here by itself.</div>'}</div>
  </div>`;
  linkDevices($('#dnotes'));
  if (can('editor')) {
    $('#eD').addEventListener('click', () => { location.hash = '#/d/' + v.id + '/edit'; });
    $('#xD').addEventListener('click', async () => {
      if (!await confirmBox('Delete ' + v.name + '?', 'The card is removed and pages stop linking to it. The pages themselves do not change.', 'Delete', true)) return;
      try { await call('DELETE', '/api/devices/' + v.id); forgetDevices(); toast('Device deleted', 'ok'); location.hash = '#/devices'; } catch (e) { toast(e.message, 'bad'); }
    });
  }
}

async function viewDeviceEdit(id) {
  if (!can('editor')) { app.innerHTML = '<div class="card empty">Editors and admins can add and change devices.</div>'; if (!S.state.user) signInDialog(() => route()); return; }
  const d = id ? (await get('/api/devices/' + id)).device : { uplink_id: '', uplink_port: '', name: '', aliases: [], category: 'audio', make: '', model: '', location: '', ip: '', mac: '', photo: '', manual_url: '', notes: '', tech_only: false };
  setTitle(id ? 'Edit ' + d.name : 'New device');
  S.dirty = false;
  const f = (k, label, ph, extra) => '<label class="dfield' + (extra && extra.wide ? ' wide' : '') + '"><span>' + label + '</span><input data-k="' + k + '" value="' + esc(d[k]) + '" placeholder="' + esc(ph || '') + '"' + (extra && extra.mono ? ' class="mono" autocapitalize="off" spellcheck="false"' : '') + (extra && extra.mode ? ' inputmode="' + extra.mode + '"' : '') + '>' + (extra && extra.hint ? '<em>' + extra.hint + '</em>' : '') + '</label>';
  app.innerHTML = `<div class="ed">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/devices">Devices</a><span>/</span><span>${id ? 'Edit' : 'New device'}</span></div>
    <div class="card" style="margin-top:8px">
      <div class="dphoto"><div id="dph"></div><input type="file" accept="image/*" class="hide" id="dpf"><div><button type="button" id="dpb">${d.photo ? 'Replace photo' : 'Add photo'}</button>${d.photo ? ' <button type="button" class="ghost danger" id="dpx">Remove</button>' : ''}<div class="note">A photo of the device or its rack position helps volunteers find it.</div></div></div>
      <div class="dform">
        ${f('name', 'Name', 'SQ-5', { wide: true })}
        <label class="dfield wide"><span>Also called</span><input data-k="aliases" value="${esc(d.aliases.join(', '))}" placeholder="FOH desk, A&amp;H"><em>Other names people type, separated by commas. Each one links to this card.</em></label>
        <label class="dfield"><span>Category</span><select data-k="category">${Object.keys(CAT).map((k) => '<option value="' + k + '"' + (k === d.category ? ' selected' : '') + '>' + CAT[k] + '</option>').join('')}</select></label>
        ${f('make', 'Make', 'Allen & Heath')}${f('model', 'Model', 'SQ-5')}
        ${f('location', 'Location', 'FOH, front AV rack U4…')}
        ${f('ip', 'IP address', '10.10.20.11', { mono: true, mode: 'decimal', hint: 'Optional. Addresses in IP lists link here too when the device name matches.' })}
        ${f('mac', 'MAC', '', { mono: true })}
        ${f('manual_url', 'Manual link', 'https://…', { wide: true, mode: 'url' })}
        <label class="dfield"><span>Plugged into</span><select data-k="uplink_id"><option value="">Nothing / not set</option>${(await loadDevices(true)).filter((x) => String(x.id) !== String(id)).map((x) => '<option value="' + x.id + '"' + (String(x.id) === String(d.uplink_id || '') ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('')}</select><em>The switch, router or access point it connects to. Draws the network map.</em></label>
        ${f('uplink_port', 'Port', '5', { mode: 'text', hint: 'Port on that switch (optional)' })}
        <label class="tog dfield ${d.tech_only ? 'on' : ''}"><input type="checkbox" data-k="tech_only" ${d.tech_only ? 'checked' : ''}>Tech only <em>Hidden from volunteers</em></label>
      </div>
      <div class="dfield wide" style="margin-top:12px"><span>Notes</span><div id="dnotes"></div></div>
    </div>
    <div class="edbar"><span class="note" id="eMsg"></span><button id="dCancel">Cancel</button><button class="primary" id="dSave">${id ? 'Save' : 'Add device'}</button></div>
  </div>`;
  const dirty = () => { S.dirty = true; $('#eMsg').textContent = 'Unsaved changes'; };
  $$('[data-k]').forEach((x) => x.addEventListener(x.type === 'checkbox' || x.tagName === 'SELECT' ? 'change' : 'input', () => {
    const k = x.dataset.k;
    d[k] = x.type === 'checkbox' ? x.checked : k === 'aliases' ? x.value.split(',').map((s) => s.trim()).filter(Boolean) : x.value;
    if (x.type === 'checkbox') x.closest('.tog').classList.toggle('on', x.checked);
    dirty();
  }));
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
  $('#dCancel').addEventListener('click', () => { location.hash = id ? '#/d/' + id : '#/devices'; });
  $('#dSave').addEventListener('click', async () => {
    $('#dSave').disabled = true;
    try {
      if (id) { await call('PUT', '/api/devices/' + id, d); S.dirty = false; forgetDevices(); toast('Saved', 'ok'); location.hash = '#/d/' + id; }
      else { const x = await call('POST', '/api/devices', d); S.dirty = false; forgetDevices(); toast('Device added', 'ok'); location.hash = '#/d/' + x.id; }
    } catch (e) { toast(e.message, 'bad'); }
    finally { const b = $('#dSave'); if (b) b.disabled = false; }
  });
  if (!id) $('[data-k=name]').focus();
}
