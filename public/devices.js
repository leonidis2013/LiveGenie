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
const AUTO_BUCKETS = ['Wired mics', 'Wireless mics', 'Receivers', 'Capsules', 'In-ears', 'Stage I/O', 'Mixing', 'Processing', 'Amps', 'Speakers', 'Video', 'Lighting', 'Network', 'Computers & interfaces', 'Power', 'Other'];
/** What a piece of gear is, in the order the "What is it?" list shows them. Same words as the stage patch. */
const GEAR_KIND = [['mic', 'Microphone'], ['txmic', 'Wireless mic (handheld or pack)'], ['capsule', 'Mic capsule or head'], ['receiver', 'Wireless receiver'], ['di', 'DI box'], ['source', 'Instrument or playback'],
  ['iemtx', 'In-ear transmitter'], ['bodypack', 'In-ear pack'], ['headamp', 'Headphone amp'], ['console', 'Mixer'], ['stagebox', 'Stage box'], ['processor', 'Processor'], ['amp', 'Amplifier'], ['speaker', 'Speaker'], ['wedge', 'Wedge or monitor'],
  ['network', 'Network'], ['computer', 'Computer'], ['interface', 'Audio interface'], ['power', 'Power strip or PDU'], ['other', 'Something else']];
/** Gear with its own frequency, person or channel: one card each, never a quantity. */
const ONE_EACH = ['txmic', 'receiver', 'iemtx', 'bodypack'];
const qtyOf = (d) => (d && !ONE_EACH.includes(d.kind) ? Math.max(1, d.qty || 1) : 1);
const kindLabel = (k) => (GEAR_KIND.find((x) => x[0] === k) || [0, ''])[1];
/** What each kind pairs with, and how the card says it. */
const GEAR_PAIR = { txmic: { with: 'receiver', label: 'Receiver', add: 'Add a wireless mic', list: 'Wireless mics' }, bodypack: { with: 'iemtx', label: 'Transmitter', add: 'Add an in-ear pack', list: 'In-ear packs' } };
const PAIR_CHILD = { receiver: 'txmic', iemtx: 'bodypack' };
const TX_KINDS = ['Handheld', 'Bodypack', 'Headset', 'Lavalier', 'Instrument', 'Other'];
const BUCKET_OF_KIND = { capsule: 'Capsules', mic: 'Wired mics', di: 'Wired mics', txmic: 'Wireless mics', receiver: 'Receivers', source: 'Other', iemtx: 'In-ears', bodypack: 'In-ears', headamp: 'In-ears',
  stagebox: 'Stage I/O', network: 'Network', console: 'Mixing', computer: 'Computers & interfaces', interface: 'Computers & interfaces', processor: 'Processing', amp: 'Amps', speaker: 'Speakers', wedge: 'Speakers', power: 'Power' };
function autoBucket(d) {
  if (d.kind && BUCKET_OF_KIND[d.kind]) return BUCKET_OF_KIND[d.kind];
  // its type on your model list, else plain words in its name
  const m = typeof GearModels !== 'undefined' ? GearModels.find(d.model) || GearModels.find(d.name) : null;
  if (m && BUCKET_OF_KIND[m.kind]) return BUCKET_OF_KIND[m.kind];
  const t = (d.make + ' ' + d.model + ' ' + d.name).toLowerCase();
  if (/\biem\b|in-?ear|bodypack receiver/.test(t)) return 'In-ears';
  if (/receiver|\brx\b/.test(t)) return 'Receivers';
  if (/capsule|mic head|cartridge/.test(t)) return 'Capsules';
  if (/wireless|handheld|bodypack|\bwmic/.test(t)) return 'Wireless mics';
  if (/\bmic|microphone|\bdi\b|direct box/.test(t)) return 'Wired mics';
  if (/stage ?box|snake|\bi\/o\b/.test(t)) return 'Stage I/O';
  if (/console|mixer|desk/.test(t)) return 'Mixing';
  if (/\bdsp\b|processor|crossover/.test(t)) return 'Processing';
  if (/amplifier|\bamp\b/.test(t)) return 'Amps';
  if (/speaker|\bsub\b|subwoofer|wedge|monitor|column|line ?array|\bpa\b|cabinet/.test(t)) return 'Speakers';
  return { video: 'Video', lighting: 'Lighting', network: 'Network', computer: 'Computers & interfaces', power: 'Power', audio: 'Other', other: 'Other' }[d.category] || 'Other';
}
/** Older names for a bucket, so gear filed under them lands in the new one ('' = sort it automatically again). */
const BUCKET_RENAMED = { 'Speakers & monitors': 'Speakers', 'Mics & wireless': '', Computers: 'Computers & interfaces' };
const bucketOf = (d) => { let b = d.bucket || ''; if (b in BUCKET_RENAMED) b = BUCKET_RENAMED[b]; return b || autoBucket(d); };
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
    DEV.list = d.devices; DEV.buckets = [...new Set((d.buckets || []).map((b) => (b in BUCKET_RENAMED ? BUCKET_RENAMED[b] : b)).filter(Boolean))]; DEV.dupeSkip = new Set(d.dupeSkip || []); DEV.checkSkip = new Set(d.checkSkip || []); DEV.at = Date.now();
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
    : '<span class="dthumb" style="width:' + s + 'px;height:' + s + 'px">' + esc(([d.make, d.model].filter(Boolean).join(' ') || d.name).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase()) + '</span>';
}

// ---------- the Gear Locker ----------
/** Short words for what a piece of gear is, for card subtitles. */
const KIND_SHORT = { mic: 'Wired mic', txmic: 'Wireless mic', capsule: 'Capsule', receiver: 'Receiver', di: 'DI', source: 'Source', iemtx: 'In-ear transmitter', bodypack: 'In-ear pack', headamp: 'Headphone amp',
  console: 'Mixer', stagebox: 'Stage box', processor: 'Processor', amp: 'Amp', speaker: 'Speaker', wedge: 'Wedge', network: 'Network', computer: 'Computer', interface: 'Audio interface' };
/** A tag name with its model: "RX-1 (SLXD4D)". */
const tagModel = (x) => (x ? (typeof Tags !== 'undefined' ? Tags.withModel(x.name, x.model) : x.name) : '');
/**
 * One line that says what it is: "Wireless mic · Handheld · Shure SLXD2 · on RX-1 (SLXD4D)", "Receiver · 2 wireless mics".
 * Only wireless mics, capsules and in-ear packs say what they pair with; a wired mic never does.
 */
/** A card's title: its make and model ("Rode M5"), or its name when it has no model. */
const gearTitle = (d) => [d.make, d.model].filter(Boolean).join(' ') || d.name;
/** The tags on a card: one per piece for a card with a quantity (MIC-2, MIC-3), otherwise its tag name. */
function gearTags(d) {
  if (qtyOf(d) > 1) return d.unit_tags && d.unit_tags.length ? d.unit_tags : Tags.namesOf({ name: d.name, qty: qtyOf(d) });
  return [d.name];
}
const tagChips = (d, cls) => { const t = gearTags(d); return t.length && !(t.length === 1 && t[0] === gearTitle(d)) ? '<span class="dtags' + (cls ? ' ' + cls : '') + '">' + t.map((x) => '<i>' + esc(x) + '</i>').join('') + (qtyOf(d) > 1 && t.length < qtyOf(d) ? '<i class="miss">+' + (qtyOf(d) - t.length) + ' untagged</i>' : '') + '</span>' : ''; };
/** A computer's software as small chips ("LiveProfessor", "OBS"). */
const softwareChips = (d) => (d.kind === 'computer' && (d.software || []).length ? '<span class="gswchips">' + d.software.map((x) => '<span>' + esc(x) + '</span>').join('') + '</span>' : '');
function gearLine(d, list, noModel) {
  list = list || DEV.list || [];
  const mm = [d.make, d.model].filter(Boolean).join(' ');
  const showMm = !noModel && mm && !(typeof Tags !== 'undefined' && d.model && Tags.norm(d.name).includes(Tags.norm(d.model)));
  const mate = GEAR_PAIR[d.kind] && d.pair_id ? list.find((x) => x.id === d.pair_id) : null;
  const kids = PAIR_CHILD[d.kind] ? list.filter((x) => x.kind === PAIR_CHILD[d.kind] && x.pair_id === d.id).length : 0;
  // most useful first (what it is, what it pairs with), make and model last, since a narrow card cuts the end off
  const parts = [KIND_SHORT[d.kind] || '', d.kind === 'txmic' ? d.txtype : ''];
  if (mate) parts.push('on ' + tagModel(mate));
  // a capsule card: which mics it is in, out of how many there are
  if (d.kind === 'capsule') { const on = list.filter((x) => x.kind === 'txmic' && x.capsule_card === d.id); parts.push(on.length ? 'in ' + on.map((x) => x.name).join(', ') + (d.qty > 1 ? ' (' + on.length + ' of ' + d.qty + ')' : '') : (d.qty > 1 ? d.qty + ' spare' : 'spare')); }
  if (PAIR_CHILD[d.kind]) parts.push(kids ? kids + ' ' + (d.kind === 'receiver' ? 'wireless mic' : 'pack') + (kids === 1 ? '' : 's') : 'none paired');
  if (showMm) parts.push(mm);
  return parts.filter(Boolean).join(' · ') || CAT[d.category] || '';
}

async function viewDevices(qs) {
  setTitle('Gear Locker');
  // your model list says what each model is (a speaker, a mic), so gear sorts into the right bucket
  const [list, rackList] = await Promise.all([loadDevices(true), get('/api/racks').then((r) => r.racks).catch(() => []), GearModels.load()]);
  const rackName = new Map(rackList.map((r) => [r.id, r.name]));
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
      <div class="note">Every piece of gear, sorted into buckets. Its name, nickname or IP typed on a page links to its card here.</div>
      ${list.length ? '<div class="gtotal">' + list.length + ' card' + (list.length === 1 ? '' : 's') + ' · ' + list.reduce((t, d) => t + qtyOf(d), 0) + ' piece' + (list.reduce((t, d) => t + qtyOf(d), 0) === 1 ? '' : 's') + ' of gear</div>' : ''}</div>
      ${can('admin') && !(S.state.gearSetup && S.state.gearSetup.done) ? '<a class="btn" href="#/gear-setup">' + icon('spark') + '<span class="hide-sm">Guided setup</span></a>' : ''}
      ${can('admin') ? '<button class="btn" id="gBk">' + icon('list') + '<span class="hide-sm">Buckets</span></button>' : ''}
      ${sug.length ? '<button class="btn" id="imp">' + icon('net') + 'From IP lists (' + sug.length + ')</button>' : ''}
      ${can('admin') ? '<button class="primary btn" id="newDev">' + icon('plus') + 'Add gear</button>' : ''}</div>
    <div class="bar"><input type="search" id="dq" placeholder="Find gear: name, model, location, IP or who uses it" style="flex:1;min-width:200px">
      <select id="dlf" title="Only gear in one location"><option value="">Every location</option>${gearLocations(list).map((l) => '<option' + (l === lc ? ' selected' : '') + '>' + esc(l) + '</option>').join('')}${list.some((d) => !d.location) ? '<option value="__none">No location set</option>' : ''}</select>
      <div class="seg" id="dgb"><button data-gb="bucket" class="${by === 'bucket' ? 'on' : ''}">By bucket</button><button data-gb="location" class="${by === 'location' ? 'on' : ''}">By location</button>${rackList.length ? '<button data-gb="rack" class="' + (by === 'rack' ? 'on' : '') + '">By rack</button>' : ''}</div></div>
    ${can('admin') ? '<div id="ddup"></div>' : ''}
    <div class="gchips" id="dcat"><button data-b="" class="chipb on">All <em>${list.length}</em></button>${order.filter((b) => list.some((d) => bucketOf(d) === b)).map((b) => '<button class="chipb" data-b="' + esc(b) + '">' + esc(b) + ' <em>' + list.filter((d) => bucketOf(d) === b).length + '</em></button>').join('')}</div>
    <div id="dgrid"></div>`;
  const cardHtml = (d) => '<a class="dcard" href="#/d/' + d.id + '">' + devThumb(d, 46) +
    '<div class="t"><b>' + esc(gearTitle(d)) + (qtyOf(d) > 1 ? ' <span class="qtyb">×' + qtyOf(d) + '</span>' : '') + '</b>' + tagChips(d) + '<span>' + esc(gearLine(d, list, gearTitle(d) !== d.name)) + '</span>' + softwareChips(d) +
    '<span class="dmeta">' + [d.location ? icon('pin') + esc(d.location) : '', d.networked && d.ips.length ? '<span class="mono">' + esc(d.ips[0]) + '</span>' + (d.ips.length > 1 ? ' +' + (d.ips.length - 1) : '') : '', users.get(d.id) ? icon('user') + esc(users.get(d.id)) : ''].filter(Boolean).join('<i>·</i>') + '</span></div>' +
    '<div class="dbadges">' + (d.files ? '<span class="badge" title="' + d.files + ' manual' + (d.files === 1 ? '' : 's') + '">' + icon('pdf') + d.files + '</span>' : '') + (d.tech_only ? '<span class="badge tech">Tech only</span>' : '') + '</div></a>';
  const paint = () => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = list.filter((d) => (!bk || bucketOf(d) === bk) && (!lc || (lc === '__none' ? !d.location : d.location === lc)) && words.every((w) => [d.name, ...d.aliases, ...(d.unit_tags || []), d.make, d.model, d.location, ...d.ips, users.get(d.id) || '', bucketOf(d)].join(' ').toLowerCase().includes(w)));
    if (!shown.length) {
      $('#dgrid').innerHTML = '<div class="card empty">' + (list.length ? 'No gear matches.' : 'The Gear Locker is empty.' + (can('admin') ? ' Try the <a href="#/gear-setup">guided setup</a> or add your first piece of gear' + (sug.length ? ', or make cards from the names already in your IP lists' : '') + '.' : '')) + '</div>';
      return;
    }
    if (by === 'rack' && !rackList.length) by = 'bucket';
    const secOf = by === 'location' ? (d) => d.location || 'No location set' : by === 'rack' ? (d) => rackName.get(d.rack_id) || 'Not in a rack' : bucketOf;
    const secs = by === 'location' ? gearLocations(shown).concat(shown.some((d) => !d.location) ? ['No location set'] : []) : by === 'rack' ? rackList.map((r) => r.name).concat(['Not in a rack']) : order;
    $('#dgrid').innerHTML = secs.map((b) => {
      // in a rack: top to bottom, shelf gear last
      const inB = shown.filter((d) => secOf(d) === b).sort((x, y) => (by === 'rack' ? (x.rack_u || 99) - (y.rack_u || 99) || (x.rack_side || '').localeCompare(y.rack_side || '') : 0));
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
  if (can('admin')) paintDupes($('#ddup'), list);
  paint();
}

/**
 * Admins: gear that looks entered twice (tag names equal once spaces, dashes and capitals are ignored), with Merge… and Not a duplicate,
 * and cards of the same model that disagree on their channel count. Several of the same model is normal and never flagged.
 */
function gearWarnings(list) {
  const dupes = Tags.nearDupes(list.map((d) => ({ id: d.id, name: d.name })), DEV.dupeSkip || new Set()).map((g) => g.map((x) => list.find((d) => d.id === x.id)));
  const counts = [];
  const byModel = new Map();
  list.filter((d) => ['receiver', 'iemtx', 'stagebox', 'console'].includes(d.kind) && d.model).forEach((d) => {
    const k = Tags.norm(d.make) + '|' + Tags.norm(d.model); if (!byModel.has(k)) byModel.set(k, []); byModel.get(k).push(d);
  });
  for (const g of byModel.values()) {
    for (const f of ['inputs', 'outputs']) {
      const vals = [...new Set(g.map((d) => d[f]).filter((n) => n > 0))];
      if (vals.length > 1) counts.push({ text: g.length + ' ' + g[0].model + ' cards disagree: ' + vals.sort((x, y) => x - y).join(' vs ') + ' ' + f, cards: g.filter((d) => d[f] > 0) });
    }
  }
  // identical gear on separate cards (same make, model and kind, not wireless): can be one card with a quantity
  const same = new Map();
  // not offered for power strips (each has its own outlets), gear in a rack (each has its own spot) or gear with its own network link
  list.filter((d) => d.model && !ONE_EACH.includes(d.kind) && d.kind !== 'power' && !d.rack_id && !d.uplink_id && !(d.ips && d.ips.length)).forEach((d) => { const k = Tags.norm(d.make) + '|' + Tags.norm(d.model) + '|' + (d.kind || ''); if (!same.has(k)) same.set(k, []); same.get(k).push(d); });
  const skip = DEV.dupeSkip || new Set();
  const key = (g) => g.map((d) => String(d.id)).sort().join('|');
  const combos = [...same.values()].filter((g) => g.length > 1 && !skip.has(key(g)));
  // a near-duplicate that is also the same model gets Combine on its own line instead
  const comboOf = (g) => combos.find((c) => g.every((d) => c.includes(d)));
  const dupesLeft = dupes.filter((g) => !comboOf(g));
  return { dupes: dupesLeft, counts, combos };
}
function paintDupes(host, list) {
  if (!host) return;
  const w = gearWarnings(list);
  if (!w.dupes.length && !w.counts.length && !w.combos.length) { host.innerHTML = ''; return; }
  const link = (d) => '<a href="#/d/' + d.id + '">' + esc(tagModel(d)) + '</a>';
  host.innerHTML = '<div class="gwarn">' + icon('alert') + '<div class="gwl">' +
    w.dupes.map((g, i) => '<div class="gwr"><span>' + g.map(link).join(' and ') + ' look like the same gear.</span><span class="gwb"><button type="button" class="btn xs" data-merge="' + i + '">Merge…</button><button type="button" class="ghost xs" data-notdup="' + i + '">Not a duplicate</button></span></div>').join('') +
    w.combos.map((g, i) => '<div class="gwr"><span>' + g.map(link).join(', ') + ' are the same ' + esc([g[0].make, g[0].model].filter(Boolean).join(' ')) + ': one card ×' + g.reduce((t, d) => t + qtyOf(d), 0) + ' would do.</span><span class="gwb"><button type="button" class="btn xs" data-combine="' + i + '">Combine ×' + g.reduce((t, d) => t + qtyOf(d), 0) + '</button><button type="button" class="btn xs ghost" data-cmerge="' + i + '">Merge…</button><button type="button" class="ghost xs" data-cskip="' + i + '">Keep separate</button></span></div>').join('') +
    w.counts.map((c) => '<div class="gwr"><span>' + esc(c.text) + ': ' + c.cards.map(link).join(', ') + '.</span></div>').join('') + '</div></div>';
  $$('[data-notdup]', host).forEach((b) => b.addEventListener('click', async () => {
    const g = w.dupes[Number(b.dataset.notdup)];
    try { const r = await call('PUT', '/api/devices/dupe-skip', { ids: g.map((d) => d.id) }); DEV.dupeSkip = new Set(r.dupeSkip); paintDupes(host, list); toast('Left alone', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  }));
  $$('[data-merge]', host).forEach((b) => b.addEventListener('click', () => mergeDialog(w.dupes[Number(b.dataset.merge)])));
  $$('[data-combine]', host).forEach((b) => b.addEventListener('click', () => combineDialog(w.combos[Number(b.dataset.combine)])));
  $$('[data-cmerge]', host).forEach((b) => b.addEventListener('click', () => mergeDialog(w.combos[Number(b.dataset.cmerge)])));
  $$('[data-cskip]', host).forEach((b) => b.addEventListener('click', async () => {
    const g = w.combos[Number(b.dataset.cskip)];
    try { const r = await call('PUT', '/api/devices/dupe-skip', { ids: g.map((d) => d.id) }); DEV.dupeSkip = new Set(r.dupeSkip); paintDupes(host, list); toast('Kept as separate cards', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  }));
}
/**
 * Split a card with a quantity into a card for each one (to give each its own details): this card becomes one,
 * the others are new cards with the same make, model, kind, location, bucket and notes. Tag names: the next free ones
 * when this card's name is a tag (SPK-1 → SPK-2, SPK-3), otherwise "Name 2", "Name 3".
 */
async function splitCard(v) {
  const n = qtyOf(v);
  if (!await confirmBox('Split ' + v.name + ' into ' + n + ' cards?', 'This card becomes one of them. ' + (n - 1) + ' new card' + (n > 2 ? 's get' : ' gets') + ' the same make, model, location and notes, ready for details of their own. Manuals and the photo stay on this card. On the stage patch, each placed one goes with its own card.', 'Split')) return;
  try {
    const all = await loadDevices(true);
    // the units already on the stage patch: each becomes its own card, named after its block (SPK-1, SPK-2…)
    let pd = null; try { pd = await get('/api/patch'); } catch (e) { pd = null; }
    const blocks = pd ? pd.doc.gear.filter((g) => g.device_id === v.id) : [];
    const bare = (x) => String(x || '').replace(/\s+#\d+$/, '').trim();
    const taken = all.filter((x) => x.id !== v.id).flatMap((x) => [x.name, ...(x.aliases || [])]);
    const free = (nm) => nm && !taken.some((t) => Tags.norm(t) === Tags.norm(nm));
    const tagLike = Tags.norm(v.name) === Tags.norm(Tags.suggest(v.kind || 'other', [], { model: v.model })) || /^[A-Z]{1,6}(-[A-Z]{1,4})?-?\d+[A-Z]?$/i.test(v.name.trim());
    const nameFor = (i) => {   // i: 1-based unit
      const ut = (v.unit_tags || [])[i - 1];   // each piece already has its tag: it becomes that card's name
      if (ut && free(ut)) return ut;
      const b = blocks[i - 1] && bare(blocks[i - 1].name);
      if (b && free(b)) return b;
      if (i === 1) return v.name;
      let name = tagLike || blocks.length ? Tags.suggest(v.kind || 'other', taken, { model: v.model }) : v.name + ' ' + i;
      while (!free(name)) name += '+';
      return name;
    };
    const first = nameFor(1); taken.push(first);
    const ids = [v.id];
    for (let i = 2; i <= n; i++) {
      const name = nameFor(i); taken.push(name);
      ids.push((await call('POST', '/api/devices', { name, aliases: [], kind: v.kind, category: v.category, make: v.make, model: v.model, location: v.location, bucket: v.bucket, notes: v.notes, inputs: v.inputs, outputs: v.outputs, qty: 1, power_w: v.power_w == null ? undefined : v.power_w })).id);
    }
    await call('PUT', '/api/devices/' + v.id, { ...(await get('/api/devices/' + v.id)).device, name: first, qty: 1, unit_tags: [] });
    // the 2nd, 3rd… blocks on the stage patch now point at their own cards
    if (blocks.length > 1) {
      const doc = pd.doc;
      let k = 0;
      doc.gear.forEach((g) => { if (g.device_id === v.id) { if (k > 0 && ids[k]) g.device_id = ids[k]; k++; } });
      try { await call('PUT', '/api/patch', { doc, baseVersion: pd.version, note: 'Split ' + v.name + ' into separate cards' }); } catch (e) { toast('Cards split, but the stage patch was not updated: ' + e.message, 'bad'); }
    }
    // they were split on purpose: the Gear Locker does not suggest combining them again
    try { await call('PUT', '/api/devices/dupe-skip', { ids }); } catch (e) { /* only a suggestion */ }
    forgetDevices(); toast('Split into ' + n + ' cards' + (blocks.length > 1 ? '; the stage patch follows' : ''), 'ok'); route();
  } catch (e) { toast(e.message, 'bad'); }
}
/** Combine: identical cards become one card with their quantities added (the others merge into it). */
function combineDialog(group) {
  const total = group.reduce((t, d) => t + qtyOf(d), 0);
  const line = (d) => esc([d.make, d.model].filter(Boolean).join(' ')) + (qtyOf(d) > 1 ? ' · ×' + qtyOf(d) : '') + (d.location ? ' · ' + esc(d.location) : '') + (d.files ? ' · ' + d.files + ' manual' + (d.files === 1 ? '' : 's') : '');
  modal('<h3>Combine into one card ×' + total + '</h3><p>Pick the card to keep. It becomes ×' + total + '; the others’ manuals, photo, nicknames and stage patch blocks move onto it, then they are removed.</p>' +
    '<form id="cbf"><div class="mgl">' + group.map((d, i) => '<label class="mgo"><input type="radio" name="keep" value="' + d.id + '"' + (i ? '' : ' checked') + '><span><b>' + esc(d.name) + '</b><em>' + line(d) + '</em></span></label>').join('') + '</div>' +
    '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Combine ×' + total + '</button></div></form>', (w, close) => {
    $('#cbf', w).addEventListener('submit', async (e) => {
      e.preventDefault();
      const keep = Number($('input[name=keep]:checked', w).value);
      try { await call('POST', '/api/devices/' + keep + '/combine', { ids: group.map((d) => d.id).filter((x) => x !== keep) }); close(); forgetDevices(); toast('Combined into one card ×' + total, 'ok'); route(); }
      catch (err) { toast(err.message, 'bad'); }
    });
  });
}
/** Merge: pick the card to keep; the others' manuals, photo, pairings, nicknames and stage patch place move onto it. */
function mergeDialog(group) {
  const line = (d) => esc([d.make, d.model].filter(Boolean).join(' ') || kindLabel(d.kind) || '') + (d.location ? ' · ' + esc(d.location) : '') + (d.files ? ' · ' + d.files + ' manual' + (d.files === 1 ? '' : 's') : '');
  modal('<h3>Merge into one card</h3><p>Pick the card to keep. The other ' + (group.length > 2 ? 'cards' : 'card') + '’s manuals, photo, pairings, empty details and stage patch place move onto it, and its name becomes a nickname, so pages still link. Then it is removed.</p>' +
    '<form id="mgf"><div class="mgl">' + group.map((d, i) => '<label class="mgo"><input type="radio" name="keep" value="' + d.id + '"' + (i ? '' : ' checked') + '><span><b>' + esc(d.name) + '</b><em>' + line(d) + '</em></span></label>').join('') + '</div>' +
    '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Merge</button></div></form>', (w, close) => {
    $('#mgf', w).addEventListener('submit', async (e) => {
      e.preventDefault();
      const keep = Number($('input[name=keep]:checked', w).value);
      try {
        for (const d of group) if (d.id !== keep) await call('POST', '/api/devices/' + d.id + '/merge', { into: keep });
        close(); forgetDevices(); toast('Merged', 'ok'); route();
      } catch (err) { toast(err.message, 'bad'); }
    });
  });
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
    if (e.status === 404) {
      if (S.landing) { S.landing = false; toast('That gear is no longer in the Gear Locker'); history.replaceState(null, '', '#/gear'); lastHash = '#/gear'; return viewDevices(new URLSearchParams()); }
      app.innerHTML = '<div class="card empty"><b>That gear is no longer in the Gear Locker.</b><div style="margin-top:12px"><a class="btn" href="#/gear">Gear Locker</a></div></div>'; return;
    }
    throw e;
  }
  await loadDevices();
  const v = d.device;
  setTitle(v.name);
  // in a rack: its spot, and the rack photo when the card has no photo of its own
  let rack = null;
  if (v.rack_id) { try { rack = (await get('/api/racks/' + v.rack_id)).rack; } catch (e) { rack = null; } }
  const ipRows = v.ips.map((ip) => {
    const src = v.ipSources.filter((s) => s.ip === ip);
    const where = [...new Set((v.ip === ip ? ['on this card'] : []).concat(src.map((s) => 'IP list ' + s.network + (s.vlan ? ' (VLAN ' + s.vlan + ')' : ''))))];
    return '<div><a class="mono" href="http://' + esc(ip) + '" target="_blank" rel="noopener">' + esc(ip) + '</a> <span class="note">' + esc(where.join(', ')) + '</span></div>';
  }).join('');
  const L = d.links || {};
  // a link to another card: its tag name with its model, "RX-1 (SLXD4D)"
  const dl = (x) => '<a href="#/d/' + x.id + '">' + esc(tagModel({ name: x.name, model: x.model || ((DEV.list || []).find((y) => y.id === x.id) || {}).model })) + '</a>';
  const all = DEV.list || [];
  const mate = v.pair_id && all.find((x) => x.id === v.pair_id);
  const kids = PAIR_CHILD[v.kind] ? all.filter((x) => x.pair_id === v.id && x.kind === PAIR_CHILD[v.kind]) : [];
  const facts = [
    ['What it is', esc(kindLabel(v.kind) + (v.txtype ? ' · ' + v.txtype : ''))],
    ['Quantity', qtyOf(v) > 1 ? qtyOf(v) + ' <span class="note">one card for all of them</span>' : ''],
    [GEAR_PAIR[v.kind] ? GEAR_PAIR[v.kind].label : '', mate ? dl(mate) : ''],
    ['Capsule', (() => { const c = v.kind === 'txmic' && v.capsule_card && all.find((x) => x.id === v.capsule_card); return c ? dl(c) : esc(v.capsule); })()],
    ['In mics', (() => { if (v.kind !== 'capsule') return ''; const on = all.filter((x) => x.kind === 'txmic' && x.capsule_card === v.id); return on.length ? on.map(dl).join(', ') + (v.qty > 1 ? ' <span class="note">' + on.length + ' of ' + v.qty + ' in use</span>' : '') : '<span class="note">' + (v.qty > 1 ? 'All ' + v.qty + ' spare' : 'Spare') + '</span>'; })()],
    ['Location', esc(v.location)],
    ['Rack', rack ? '<a href="#/racks/' + rack.id + '">' + esc(rack.name) + '</a> · ' + esc(rackSpot(v, rack)) : ''],
    ['Power', (() => {
      const pdu = v.power_pdu && all.find((x) => x.id === v.power_pdu);
      const bits = [v.power_w != null ? v.power_w + ' W' + (qtyOf(v) > 1 ? ' each' : '') : '', pdu ? 'plugs into ' + dl(pdu) + (v.power_outlet ? ' outlet ' + v.power_outlet : '') : ''];
      if (v.kind === 'power') bits.push((v.outputs || 0) + ' outlets' + (v.power_max ? ' · up to ' + v.power_max + ' W' : ''));
      return bits.filter(Boolean).join(' · ');
    })()],
    ['Plugged into', v.networked && L.uplink ? dl(L.uplink) + (L.uplink.port ? ' · port <span class="mono">' + esc(L.uplink.port) + '</span>' : '') : ''],
    ['VLAN', !v.networked ? '' : (L.vlans || []).map((x) => '<a class="chip" href="#/map/vlans"><i class="sw" style="background:' + esc(x.color) + '"></i>' + x.vid + ' ' + esc(x.name) + '</a>').join(' ')],
    ['Connected here', (L.children || []).map((x) => '<div>' + (x.port ? '<span class="mono">' + esc(x.port) + '</span> ' : '') + dl(x) + '</div>').join('')],
    ['Signal from', (L.signalIn || []).map((x) => dl(x) + (x.count > 1 ? ' <span class="note">×' + x.count + '</span>' : '')).join(', ')],
    ['Signal to', (L.signalOut || []).map((x) => dl(x) + (x.count > 1 ? ' <span class="note">×' + x.count + '</span>' : '')).join(', ')], ['IP address' + (v.ips.length > 1 ? 'es' : ''), v.networked ? ipRows : ''], ['Inputs / outputs', v.inputs || v.outputs ? (v.inputs || 0) + ' in · ' + (v.outputs || 0) + ' out' : ''], ['MAC', v.networked && v.mac ? '<span class="mono">' + esc(v.mac) + '</span>' : ''],
    ['Software', v.kind === 'computer' ? softwareChips(v) : ''],
    ['Also called', esc(v.aliases.join(', '))]
  ].filter((f) => f[1]);
  const used = d.usedOn;
  // the photo: its own (with its highlights), or its spot in the rack photo
  const pic = v.photo ? { photo: v.photo, marks: v.marks, card: v } : rack && rack.photo ? { rack: true, photo: rack.photo, marks: [rackMark(v, rack)], card: { ...v, location: rack.name } } : null;
  app.innerHTML = `<div class="page dev">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/gear">Gear Locker</a></div>
    <div class="devhead">${pic ? '<a href="#dphoto" class="devphotoa" id="dpa"><img class="devphoto" src="/uploads/' + esc(pic.photo) + '" alt=""' + (pic.rack ? ' style="object-position:' + Math.round((pic.marks[0].x + pic.marks[0].w / 2) * 100) + '% ' + Math.round((pic.marks[0].y + pic.marks[0].h / 2) * 100) + '%"' : '') + '></a>' : devThumb(v, 84)}
      <div class="grow"><h1 class="title">${esc(gearTitle(v))}${qtyOf(v) > 1 ? ' <span class="qtyb big">×' + qtyOf(v) + '</span>' : ''}</h1>${tagChips(v, 'big')}<div class="meta" style="margin:0">${esc(kindLabel(v.kind) || '')}
        <span class="chip">${CAT[v.category] || 'Other'}</span>${v.tech_only ? '<span class="badge tech">Tech only</span>' : ''}</div></div>
      <div class="acts-top">${can('admin') ? '<button class="btn" id="eD">' + icon('edit') + 'Edit</button>' + (qtyOf(v) > 1 ? '<button class="btn" id="spD" title="Make a card for each one, to give each its own details">Split into ' + qtyOf(v) + ' cards</button>' : '') + '<button class="ghost danger" id="xD" title="Delete device">' + icon('trash') + '</button>' : '<button class="btn ghost" id="rD">' + icon('alert') + 'Report a problem</button>'}</div></div>
    ${facts.length ? '<div class="card facts">' + facts.map((f) => '<div class="fact"><span>' + f[0] + '</span><div>' + f[1] + '</div></div>').join('') + '</div>' : ''}
    ${v.notes.trim() ? '<div class="doc" id="dnotes">' + md(v.notes) + '</div>' : ''}
    ${pic ? '<div class="section" style="margin-top:20px" id="dphoto"><div class="hsh"><h2>Photo</h2>' + (pic.rack ? '<a class="btn" href="#/racks/' + rack.id + '">' + icon('list') + 'Open ' + esc(rack.name) + '</a>' : '') + '</div><div id="dmarks" class="capped"></div>' +
      '<div class="note" style="margin-top:6px">' + (pic.rack ? 'Where it sits in ' + esc(rack.name) + '. ' : '') + 'Tap the photo to see it full screen.' + (can('admin') && !pic.rack && !v.marks.length ? ' Admins: Edit, then Highlight on the photo.' : '') + '</div></div>' : ''}
    ${PAIR_CHILD[v.kind] ? (() => { const P = GEAR_PAIR[PAIR_CHILD[v.kind]];
      return '<div class="section" style="margin-top:20px"><div class="hsh"><h2>' + P.list + '</h2>' + (can('admin') ? '<a class="btn" href="#/gear/new?kind=' + PAIR_CHILD[v.kind] + '&pair=' + v.id + '">' + icon('plus') + P.add + '</a>' : '') + '</div>' +
        (kids.length ? '<div class="list pairs">' + kids.map((x) => '<a class="row" href="#/d/' + x.id + '">' + devThumb(x, 36) + '<div class="t"><b>' + esc(tagModel(x)) + '</b><span>' + esc([x.txtype, x.capsule, x.freq && x.freq + ' MHz'].filter(Boolean).join(' · ') || [x.make, x.model].filter(Boolean).join(' ')) + '</span></div></a>').join('') + '</div>'
          : '<div class="card empty" style="padding:16px">None paired yet.' + (can('admin') ? ' Add one here, or pick this ' + kindLabel(v.kind).toLowerCase() + ' on its card.' : '') + '</div>') + '</div>'; })() : ''}
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
  paintFiles($('#dfiles'), v, d.files || [], d.sharedFiles || []);
  if (pic) {
    $('#dmarks').innerHTML = marksView(pic.photo, pic.marks, pic.card);
    wireMarksView($('#dmarks'));
    photoLightbox($('#dmarks'), pic.photo, pic.marks, pic.card);
    $('#dpa').addEventListener('click', (e) => { e.preventDefault(); $('#dphoto').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }
  const rd = $('#rD'); if (rd) rd.addEventListener('click', () => reportProblem(v.name, { device_id: v.id }));
  if (can('admin')) {
    $('#eD').addEventListener('click', () => { location.hash = '#/d/' + v.id + '/edit'; });
    const sp = $('#spD'); if (sp) sp.addEventListener('click', () => splitCard(v));
    $('#xD').addEventListener('click', async () => {
      const onPatch = ((d.usedOn || []).find((x) => x.page_id === 'patch') || {}).hits || [];
      const pt = onPatch.length ? ' On the stage patch as ' + onPatch.map((h) => String(h.text || '').split(' · ')[0]).filter(Boolean).join(', ') + ': ' + (onPatch.length === 1 ? 'the block stays' : 'the blocks stay') + ', unlinked.' : '';
      if (!await confirmBox('Delete ' + v.name + '?', 'The card is removed and pages stop linking to it. The pages themselves do not change.' + pt, 'Delete', true)) return;
      try { await call('DELETE', '/api/devices/' + v.id); forgetDevices(); toast('Removed from the Gear Locker', 'ok'); location.hash = '#/gear'; } catch (e) { toast(e.message, 'bad'); }
    });
  }
}

// ---------- highlight boxes on the gear photo ----------
const MARK_COLORS = { yellow: '#facc15', red: '#ef4444', green: '#22c55e', blue: '#3b82f6', purple: '#a855f7' };
const markBox = (m, i, cls) => '<div class="hmk ' + (cls || '') + '" data-mi="' + i + '" style="left:' + (m.x * 100) + '%;top:' + (m.y * 100) + '%;width:' + (m.w * 100) + '%;height:' + (m.h * 100) + '%;--mc:' + MARK_COLORS[m.color || 'yellow'] + '"' + (m.label ? ' title="' + esc(m.label) + '"' : '') + '><b>' + (i + 1) + '</b>' + (m.label ? '<span>' + esc(m.label) + '</span>' : '') + '</div>';
/**
 * The photo with its highlights, shown like a spotlight: the picture is dimmed except the highlight in focus,
 * which glows in its colour with its tag on it, and a caption beside it (where the gear lives, a title, a line about it).
 * More than one highlight: step through them (arrows, the list, or a tap on a box).
 */
function marksView(photo, marks, v) {
  v = v || {};
  if (!marks.length) return '<div class="mkwrap"><div class="mkpic"><img src="/uploads/' + esc(photo) + '" alt=""></div></div>';
  const where = String(v.location || '').toUpperCase();
  const fallback = [v.make, v.model].filter(Boolean).join(' ') || v.name || '';
  const boxes = marks.map((m, i) => '<div class="spk' + (m.q ? ' quad' : '') + '" data-mi="' + i + '" style="left:' + (m.x * 100) + '%;top:' + (m.y * 100) + '%;width:' + (m.w * 100) + '%;height:' + (m.h * 100) + '%;--mc:' + MARK_COLORS[m.color || 'blue'] + '">' +
    (m.q ? quadSvg(m) : '') + (m.tag && !m.label ? '<em class="sptag">' + esc(m.tag) + '</em>' : '') + '</div>').join('');
  const caps = marks.map((m, i) => {
    const below = m.y + m.h < 0.62, right = m.x + m.w / 2 > 0.5;
    const style = (below ? 'top:calc(' + ((m.y + m.h) * 100) + '% + 12px);' : 'bottom:calc(' + ((1 - m.y) * 100) + '% + 12px);') + (right ? 'right:' + Math.max(2, (1 - m.x - m.w) * 100) + '%;' : 'left:' + Math.max(2, m.x * 100) + '%;');
    return '<div class="spcap" data-cap="' + i + '" style="' + style + '--mc:' + MARK_COLORS[m.color || 'blue'] + '">' + (where ? '<span class="spwhere">' + esc(where) + '</span>' : '') +
      '<b class="sptitle">' + esc(m.label ? (m.tag && !Tags.norm(m.label).includes(Tags.norm(m.tag)) ? m.tag + ' · ' + m.label : m.label) : (m.tag || fallback || 'Highlight ' + (i + 1))) + '</b>' + (m.note ? '<p>' + esc(m.note) + '</p>' : '') + '</div>';
  }).join('');
  // the captions sit outside the dimmed photo so they are never cut off; on a phone they drop below it
  return '<div class="mkwrap spot"><div class="spstage"><div class="mkpic spotpic"><img src="/uploads/' + esc(photo) + '" alt="">' + boxes +
    (marks.length > 1 ? '<div class="spnav"><button type="button" class="ghost" data-step="-1" aria-label="Previous">‹</button><span class="spn"></span><button type="button" class="ghost" data-step="1" aria-label="Next">›</button></div>' : '') + '</div>' + caps + '</div>' +
    (marks.length > 1 ? '<ol class="mklist">' + marks.map((m, i) => '<li data-mi="' + i + '" style="--mc:' + MARK_COLORS[m.color || 'blue'] + '"><b>' + (i + 1) + '</b><span>' + esc(m.label || m.tag || 'Highlight ' + (i + 1)) + '</span></li>').join('') + '</ol>' : '') + '</div>';
}
/**
 * A skewed highlight (a rack photographed at an angle): drawn in its box as a four-cornered shape, with the rest of
 * the photo dimmed around the shape itself rather than around the box.
 */
function quadSvg(m) {
  const pt = (p) => (((p.x - m.x) / (m.w || 1)) * 100).toFixed(2) + ' ' + (((p.y - m.y) / (m.h || 1)) * 100).toFixed(2);
  const poly = 'M' + m.q.map(pt).join(' L') + ' Z';
  return '<svg class="spq" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
    '<path class="spdim" d="M-100000 -100000 H100100 V100100 H-100000 Z ' + poly + '"/>' +
    '<path class="spfill" d="' + poly + '"/><path class="spline" d="' + poly + '"/>' +
    '<path class="spedge" d="M' + pt(m.q[0]) + ' L' + pt(m.q[3]) + '"/></svg>';
}
/** "U5–6", "U4 left half", "on the shelf at U8". */
function rackSpot(v, rack) {
  if (v.shelf_id) { const sh = ((rack && rack.items) || []).find((x) => x.id === v.shelf_id); return 'on the shelf' + (sh ? ' at U' + sh.u : ''); }
  if (!v.rack_u) return 'no U set';
  const h = v.rack_h || 1;
  return 'U' + v.rack_u + (h > 1 ? '–' + (v.rack_u + h - 1) : '') + (v.rack_side === 'L' ? ' left half' : v.rack_side === 'R' ? ' right half' : '');
}
/** A card's spot in its rack photo, as a highlight: glows with its tag, captioned with its tag and model. */
function rackMark(v, rack) {
  let u = v.rack_u || 1, h = v.rack_h || 1, side = v.rack_side || '';
  if (v.shelf_id) { const sh = (rack.items || []).find((x) => x.id === v.shelf_id); if (sh) { u = sh.u; h = sh.h; side = ''; } }
  // a spot moved by hand on the photo wins over the U grid
  const r = (rack.spots && rack.spots['g' + v.id]) || RackCore.region(rack.rails, rack.units, u, h, side);
  return { ...r, color: 'blue', tag: v.name, label: tagModel(v), note: String(v.notes || '').split('\n').map((x) => x.replace(/[#*_`>]/g, '').trim()).find(Boolean) || '' };
}
/** Tap the photo: full screen, with its highlights and stepping. Esc, the ✕ or a tap outside the photo closes it. */
function photoLightbox(host, photo, marks, card) {
  const pic = $('.mkpic', host); if (!pic) return;
  pic.style.cursor = 'zoom-in';
  pic.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('.spk')) return;
    const box = document.createElement('div');
    box.className = 'lbox';
    box.innerHTML = '<button class="lbx" aria-label="Close">✕</button><div class="lbin">' + marksView(photo, marks, card) + '</div>';
    document.body.appendChild(box);
    wireMarksView(box);
    const close = () => { box.remove(); document.removeEventListener('keydown', key); };
    const key = (k) => { if (k.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    box.addEventListener('click', (k) => { if (k.target === box || k.target.closest('.lbx') || k.target.classList.contains('lbin')) close(); });
    window.addEventListener('hashchange', close, { once: true });
  });
}
function wireMarksView(host) {
  const all = $$('.spk', host);
  if (!all.length) return;
  // captions are sized from the photo's own width
  const stg = $('.spstage', host) || host, im = $('.spotpic img', host);
  const size = () => { const w = (im && im.getBoundingClientRect().width) || 0; if (w) stg.style.setProperty('--pw', Math.round(w) + 'px'); };
  if (im) { if (im.complete) size(); im.addEventListener('load', size); }
  if (typeof ResizeObserver !== 'undefined' && im) new ResizeObserver(size).observe(im);
  let cur = 0;
  const show = (i) => {
    cur = (i + all.length) % all.length;
    $$('[data-mi]', host).forEach((x) => x.classList.toggle('on', Number(x.dataset.mi) === cur));
    $$('[data-cap]', host).forEach((x) => x.classList.toggle('on', Number(x.dataset.cap) === cur));
    const n = $('.spn', host); if (n) n.textContent = (cur + 1) + ' of ' + all.length;
  };
  $$('[data-mi]', host).forEach((x) => x.addEventListener('click', () => show(Number(x.dataset.mi))));
  $$('[data-step]', host).forEach((b) => b.addEventListener('click', () => show(cur + Number(b.dataset.step))));
  const pic = $('.spotpic', host);
  pic.tabIndex = 0;
  pic.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') show(cur + 1); if (e.key === 'ArrowLeft') show(cur - 1); });
  show(0);
}
/** Admin: draw boxes on the photo (drag), move them, resize from the corner, name and colour them. */
/** Draw highlights on a photo. opts.local: hand them back to the Edit form, which saves them with the card. */
function marksEditor(v, done, opts = {}) {
  const marks = (v.marks || []).map((m) => ({ ...m }));
  let sel = marks.length ? 0 : -1, color = 'blue';
  modal('<h3>Highlight on the photo</h3><p class="note">Drag on the picture to draw a box around a switch, a socket or a label. Drag a box to move it, its corner to resize it, and name it on the right.</p>' +
    '<div class="mked"><div class="mkpic edit" id="mkp"><img src="/uploads/' + esc(v.photo) + '" alt="" draggable="false"><div id="mkb"></div></div><div class="mkside" id="mks"></div></div>' +
    '<div class="acts"><span class="grow note" id="mkn"></span><button type="button" data-close>Cancel</button><button class="primary" id="mkok">Save</button></div>', (w, close) => {
    w.classList.add('mwide', 'mkmodal');
    const pic = $('#mkp', w), boxes = $('#mkb', w), side = $('#mks', w);
    function paint() {
      boxes.innerHTML = marks.map((m, i) => markBox(m, i, i === sel ? 'sel' : '').replace('</div>', '<i class="mkh" data-h="' + i + '"></i></div>')).join('');
      side.innerHTML = (marks.length ? marks.map((m, i) => '<div class="mkrow' + (i === sel ? ' sel' : '') + '" data-row="' + i + '"><b style="--mc:' + MARK_COLORS[m.color] + '">' + (i + 1) + '</b><div class="mkf"><label>Title</label><input data-lab="' + i + '" value="' + esc(m.label || '') + '" placeholder="Title, like Word clock or Power switch" maxlength="80">' +
          '<label>Tag on the box</label><input data-tag="' + i + '" value="' + esc(m.tag || '') + '" placeholder="Tag on the box (optional), like ' + esc(i === 0 && v.name ? v.name : 'IN-A12') + '" maxlength="24">' +
          '<label>About it</label><textarea data-note="' + i + '" rows="2" maxlength="300" placeholder="One line about it (optional)">' + esc(m.note || '') + '</textarea></div>' +
        '<div class="mkcol">' + Object.keys(MARK_COLORS).map((c) => '<button type="button" data-col="' + c + '" data-ci="' + i + '" class="' + (m.color === c ? 'on' : '') + '" style="--mc:' + MARK_COLORS[c] + '" title="' + c + '"></button>').join('') + '<button type="button" class="ghost xs danger" data-del="' + i + '" title="Remove">' + icon('trash') + '</button></div></div>').join('')
        : '<p class="note">No highlights yet. Drag on the picture to draw the first one.</p>');
      $('#mkn', w).textContent = marks.length + ' highlight' + (marks.length === 1 ? '' : 's');
      $$('[data-row]', side).forEach((r) => r.addEventListener('click', (e) => { if (e.target.closest('button')) return; sel = Number(r.dataset.row); boxes.querySelectorAll('.hmk').forEach((b) => b.classList.toggle('sel', Number(b.dataset.mi) === sel)); $$('[data-row]', side).forEach((x) => x.classList.toggle('sel', x === r)); }));
      $$('[data-tag]', side).forEach((x) => x.addEventListener('input', () => { marks[Number(x.dataset.tag)].tag = x.value; }));
      $$('[data-note]', side).forEach((x) => x.addEventListener('input', () => { marks[Number(x.dataset.note)].note = x.value; }));
      $$('[data-lab]', side).forEach((x) => x.addEventListener('input', () => { marks[Number(x.dataset.lab)].label = x.value; const sp = boxes.querySelector('[data-mi="' + x.dataset.lab + '"] span'); if (sp) sp.textContent = x.value; else paintBoxesOnly(); }));
      $$('[data-col]', side).forEach((x) => x.addEventListener('click', () => { const i = Number(x.dataset.ci); marks[i].color = x.dataset.col; color = x.dataset.col; sel = i; paint(); }));
      $$('[data-del]', side).forEach((x) => x.addEventListener('click', () => { marks.splice(Number(x.dataset.del), 1); sel = Math.min(sel, marks.length - 1); paint(); }));
    }
    const paintBoxesOnly = () => { boxes.innerHTML = marks.map((m, i) => markBox(m, i, i === sel ? 'sel' : '').replace('</div>', '<i class="mkh" data-h="' + i + '"></i></div>')).join(''); };
    // drawing, moving and resizing, in fractions of the picture
    let drag = null;
    const at = (e) => { const r = pic.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    let lastType = 'mouse';
    pic.addEventListener('pointerdown', (e) => {
      e.preventDefault(); pic.setPointerCapture(e.pointerId); lastType = e.pointerType;
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
      // with a mouse, type its name straight away; on a phone the keyboard would cover the photo, so leave it
      if (sel >= 0 && lastType === 'mouse') { const inp = $('[data-lab="' + sel + '"]', side); if (inp && !inp.value) inp.focus(); }
    };
    pic.addEventListener('pointerup', end); pic.addEventListener('pointercancel', end);
    $('#mkok', w).addEventListener('click', async () => {
      if (opts.local) { close(); toast(marks.length ? 'Highlights ready: they are saved with the card' : 'No highlights', 'ok'); done(marks.map((m) => ({ ...m }))); return; }
      try { const r = await call('PUT', '/api/devices/' + v.id + '/marks', { marks }); close(); toast('Highlights saved', 'ok'); done(r.marks); }
      catch (e) { toast(e.message, 'bad'); }
    });
    paint();
  });
}

/** Manuals, quick-start guides, wiring diagrams: stored in LiveGenie (and in its backups), opened in the browser. */
const fileSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const fileIcon = (m) => (m === 'application/pdf' ? 'pdf' : /^image\//.test(m) ? 'image' : 'text');
/** Manuals and documents: files stored in LiveGenie, and the manufacturer's web page if there is one. Same on the card and in Edit. */
/** shared: manuals this card can use from other cards (same model, or "same manuals as"), shown read-only under its own. */
function paintFiles(host, v, files, shared) {
  shared = shared || host._shared || []; host._shared = shared;
  const web = v.manual_url ? '<div class="row frow">' + icon('link') + '<a class="t" href="' + esc(v.manual_url) + '" target="_blank" rel="noopener"><b>Manufacturer\'s page</b><span>' + esc(v.manual_url.replace(/^https?:\/\//, '').slice(0, 70)) + '</span></a></div>' : '';
  host.innerHTML = (files.length || web ? '<div class="list files">' + web + files.map((f) => '<div class="row frow">' + icon(fileIcon(f.mime)) + '<a class="t" href="/files/' + esc(f.id) + '" target="_blank" rel="noopener"><b>' + esc(f.name) + '</b><span>' + fileSize(f.bytes) + ' · added ' + esc(ago(f.uploaded_at)) + (f.uploaded_by ? ' by ' + esc(f.uploaded_by) : '') + '</span></a>' +
    '<a class="ghost abtn" href="/files/' + esc(f.id) + '?download=1" title="Download">' + icon('download') + '</a>' + (can('admin') ? '<button class="ghost danger" data-fdel="' + esc(f.id) + '" title="Remove">' + icon('trash') + '</button>' : '') + '</div>').join('') + '</div>'
    : shared.length ? '' : '<div class="card empty" style="padding:16px">' + (can('admin') ? 'No manuals yet. Upload the PDF manual, a quick-start guide or a wiring diagram, or set it to use another card\'s manuals.' : 'No manuals yet.') + '</div>') +
    shared.map((sh) => '<div class="fshared"><div class="fsh">' + icon('link') + '<span>' + (sh.why === 'chosen' ? 'Same manuals as ' : 'Same model as ') + '<a href="#/d/' + sh.from.id + '">' + esc(Tags.withModel(sh.from.name, sh.from.model)) + '</a></span></div><div class="list files">' +
      (sh.manual_url ? '<div class="row frow">' + icon('link') + '<a class="t" href="' + esc(sh.manual_url) + '" target="_blank" rel="noopener"><b>Manufacturer\'s page</b><span>' + esc(sh.manual_url.replace(/^https?:\/\//, '').slice(0, 70)) + '</span></a></div>' : '') +
      sh.files.map((f) => '<div class="row frow">' + icon(fileIcon(f.mime)) + '<a class="t" href="/files/' + esc(f.id) + '" target="_blank" rel="noopener"><b>' + esc(f.name) + '</b><span>' + fileSize(f.bytes) + '</span></a><a class="ghost abtn" href="/files/' + esc(f.id) + '?download=1" title="Download">' + icon('download') + '</a></div>').join('') + '</div></div>').join('') +
    (can('admin') ? '<div class="adder" style="margin-top:8px"><input type="file" id="fup" class="hide" multiple accept=".pdf,image/*,.txt,.doc,.docx,.xls,.xlsx,.zip"><button type="button" class="btn" id="fupb">' + icon('upload') + 'Upload a manual or document</button><span class="note" id="fmsg"></span></div>' : '');
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

/** Pick a picture already in LiveGenie (the rack photo, a photo another card uses) instead of uploading it again. Resolves to its id, or null. */
function choosePhoto() {
  return new Promise(async (done) => {
    let list = [];
    try { list = (await get('/api/uploads')).uploads; } catch (e) { toast(e.message, 'bad'); return done(null); }
    let picked = null;
    modal('<h3>Choose a photo</h3><p class="note">Photos already in LiveGenie, newest first. Using one again takes no extra space.</p>' +
      '<input type="search" id="cpq" placeholder="Filter by where it is used" style="width:100%;margin-bottom:10px">' +
      '<div class="cpgrid" id="cpg"></div><div class="acts"><button type="button" data-close>Cancel</button><button class="primary" id="cpok" disabled>Use this photo</button></div>', (w, close) => {
      w.classList.add('mwide');
      const paint = (q) => {
        const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
        const shown = list.filter((u) => words.every((x) => u.uses.join(' ').toLowerCase().includes(x)));
        $('#cpg', w).innerHTML = shown.length ? shown.map((u) => '<button type="button" class="cpi' + (u.id === picked ? ' on' : '') + '" data-u="' + u.id + '"><img src="/uploads/' + u.id + '" alt="" loading="lazy"><span>' + esc(u.uses[0] || 'Not used yet') + (u.uses.length > 1 ? ' +' + (u.uses.length - 1) : '') + '</span></button>').join('') : '<p class="note">No photos' + (words.length ? ' match' : ' yet') + '.</p>';
        $$('[data-u]', w).forEach((b) => b.addEventListener('click', () => { picked = b.dataset.u; $$('[data-u]', w).forEach((x) => x.classList.toggle('on', x === b)); $('#cpok', w).disabled = false; }));
        $$('[data-u]', w).forEach((b) => b.addEventListener('dblclick', () => { picked = b.dataset.u; close(); done(picked); }));
      };
      paint('');
      $('#cpq', w).addEventListener('input', (e) => paint(e.target.value));
      $('#cpok', w).addEventListener('click', () => { close(); done(picked); });
      $$('[data-close]', w).forEach((b) => b.addEventListener('click', () => done(null)));
    });
  });
}

/**
 * The Edit form's rack and power parts: which rack, top U, how tall, full width or a half, or on a shelf;
 * watts and the power strip outlet it plugs into (a power strip also says how many outlets and its limit).
 */
async function paintRackPower(d, id, dirty) {
  const host = $('#drack'), pw = $('#dpow');
  let racks = [];
  try { racks = (await get('/api/racks')).racks; } catch (e) { racks = []; }
  d.rack_h = d.rack_h || 1;
  const rackOf = () => racks.find((r) => String(r.id) === String(d.rack_id || ''));
  const paint = () => {
    const rk = rackOf();
    const shelves = rk ? (rk.items || []).filter((x) => x.type === 'shelf') : [];
    const units = rk ? rk.units : 0;
    host.innerHTML = '<span>Rack</span>' + (racks.length ? '<div class="rkrow"><label><em>Rack</em><select data-r="rack_id"><option value="">Not in a rack</option>' + racks.map((r) => '<option value="' + r.id + '"' + (String(r.id) === String(d.rack_id || '') ? ' selected' : '') + '>' + esc(r.name) + ' (' + r.units + 'U)</option>').join('') + '</select></label>' +
      (rk ? '<label><em>Where</em><select data-r="where"><option value="u"' + (d.shelf_id ? '' : ' selected') + '>In the rails</option>' + shelves.map((x) => '<option value="s:' + x.id + '"' + (d.shelf_id === x.id ? ' selected' : '') + '>On the shelf at U' + x.u + (x.label ? ' (' + esc(x.label) + ')' : '') + '</option>').join('') + '</select></label>' +
        (d.shelf_id ? '' : '<label><em>Top U</em><select data-r="rack_u"><option value="">Choose…</option>' + Array.from({ length: units }, (_, k) => '<option' + (Number(d.rack_u) === k + 1 ? ' selected' : '') + '>' + (k + 1) + '</option>').join('') + '</select></label>' +
          '<label><em>Height</em><select data-r="rack_h">' + [1, 2, 3, 4, 5, 6, 8, 10].filter((h) => h <= Math.max(units, 1)).map((h) => '<option value="' + h + '"' + (Number(d.rack_h) === h ? ' selected' : '') + '>' + h + 'U</option>').join('') + '</select></label>' +
          '<label><em>Width</em><select data-r="rack_side"><option value="">Full width</option><option value="L"' + (d.rack_side === 'L' ? ' selected' : '') + '>Left half</option><option value="R"' + (d.rack_side === 'R' ? ' selected' : '') + '>Right half</option></select></label>') : '') + '</div>' +
      '<em>' + (rk ? 'U1 is the top of the rack. ' + (rk.photo ? 'With no photo of its own, this card shows its spot in the rack photo.' : '') + ' <a href="#/racks/' + rk.id + '">Open the rack</a>' : 'Or place it from the <a href="#/racks">Racks</a> page.') + '</em>'
      : '<em>No racks yet. <a href="#/racks">Make one on the Racks page</a>, then place gear in it.</em>');
    const pdus = (DEV.list || []).filter((x) => x.kind === 'power' && String(x.id) !== String(id || ''));
    const pdu = pdus.find((x) => String(x.id) === String(d.power_pdu || ''));
    pw.innerHTML = '<span>Power</span><div class="rkrow"><label><em>Draws (watts)</em><input data-p="power_w" type="number" min="0" max="100000" inputmode="numeric" value="' + (d.power_w == null ? '' : esc(d.power_w)) + '" placeholder="Optional"></label>' +
      (d.kind !== 'power' ? '<label><em>Plugs into</em><select data-p="power_pdu"><option value="">Not set</option>' + pdus.map((x) => '<option value="' + x.id + '"' + (String(x.id) === String(d.power_pdu || '') ? ' selected' : '') + '>' + esc(tagModel(x)) + '</option>').join('') + '</select></label>' +
        (pdu ? '<label><em>Outlet</em><select data-p="power_outlet"><option value="">Choose…</option>' + Array.from({ length: Math.max(1, pdu.outputs || 8) }, (_, k) => '<option' + (Number(d.power_outlet) === k + 1 ? ' selected' : '') + '>' + (k + 1) + '</option>').join('') + '</select></label>' : '')
        : '<label><em>Limit (watts)</em><input data-p="power_max" type="number" min="1" max="100000" inputmode="numeric" value="' + (d.power_max == null ? '' : esc(d.power_max)) + '" placeholder="e.g. 1800"></label>') + '</div>' +
      '<em>' + (d.kind === 'power' ? 'A power strip or PDU: its outlets are its Outputs above. Gear picks the outlet it plugs into.' : pdus.length ? 'What it plugs into, so the Racks page can add up the draw on each strip.' : 'Add a power strip or PDU to the Gear Locker (What is it? Power strip or PDU) to pick its outlets here.') + '</em>';
    $$('[data-r]', host).forEach((x) => x.addEventListener('change', () => {
      const k = x.dataset.r;
      if (k === 'where') { d.shelf_id = x.value.startsWith('s:') ? x.value.slice(2) : ''; }
      else if (k === 'rack_id') { d.rack_id = x.value; d.shelf_id = ''; d.rackSet = true; }
      else d[k] = x.value;
      d.rackSet = true; dirty(); paint();
    }));
    $$('[data-p]', pw).forEach((x) => x.addEventListener('change', () => { d[x.dataset.p] = x.value; d.powerSet = true; if (x.dataset.p === 'power_pdu') d.power_outlet = ''; dirty(); paint(); }));
  };
  paint();
  $('#dkind').addEventListener('change', () => setTimeout(paint, 0));
  d.rackName = () => (rackOf() || {}).name || '';
}
/** What the rack and power parts send. Location fills in as "Rack AV-102 · U5–6" unless the card has its own. */
function rackPowerBody(d) {
  const b = {};
  if (d.rackSet) {
    Object.assign(b, { rack_id: d.rack_id || '', rack_u: d.rack_u || '', rack_h: d.rack_h || 1, rack_side: d.rack_side || '', shelf_id: d.shelf_id || '' });
    const name = d.rackName ? d.rackName() : '';
    const auto = /^Rack\b.*·\s*(U\d|on the shelf)|^.+ · U\d+(–\d+)?( (left|right) half)?$/.test(d.location || '');
    if (name && (!d.location || auto)) b.location = name + ' · ' + rackSpot({ ...d, rack_u: Number(d.rack_u), rack_h: Number(d.rack_h) }, { items: [] });
  }
  if (d.powerSet) Object.assign(b, { power_w: d.power_w === '' ? '' : d.power_w, power_pdu: d.power_pdu || '', power_outlet: d.power_outlet || '', power_max: d.power_max === '' ? '' : d.power_max });
  return b;
}

async function viewDeviceEdit(id) {
  if (!can('admin')) { app.innerHTML = '<div class="card empty">Admins can add and change devices.</div>'; if (!S.state.user) signInDialog(() => route()); return; }
  await loadDevices();
  const full = id ? await get('/api/devices/' + id) : null;
  await loadDevices();   // for the pickers (pairing, same manuals as)
  const hq = new URLSearchParams(location.hash.split('?')[1] || '');
  const d = full ? full.device : { kind: GEAR_KIND.some((x) => x[0] === hq.get('kind')) ? hq.get('kind') : '', pair_id: hq.get('pair') || '', txtype: '', capsule: '', freq: '', bucket: hq.get('b') || '', inputs: '', outputs: '', uplink_id: '', uplink_port: '', name: '', aliases: [], category: 'audio', make: '', model: '', location: '', ip: '', mac: '', photo: '', manual_url: '', notes: '', tech_only: false };
  setTitle(id ? 'Edit ' + d.name : 'Add gear');
  const locations = gearLocations(DEV.list || [], d.location);
  S.dirty = false;
  const f = (k, label, ph, extra) => '<label class="dfield' + (extra && extra.wide ? ' wide' : '') + '"><span>' + label + '</span><input data-k="' + k + '" value="' + esc(d[k]) + '" placeholder="' + esc(ph || '') + '"' + (extra && extra.mono ? ' class="mono" autocapitalize="off" spellcheck="false"' : '') + (extra && extra.mode ? ' inputmode="' + extra.mode + '"' : '') + '>' + (extra && extra.hint ? '<em>' + extra.hint + '</em>' : '') + '</label>';
  app.innerHTML = `<div class="ed">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/gear">Gear Locker</a><span>/</span><span>${id ? 'Edit' : 'Add gear'}</span></div>
    <div class="card" style="margin-top:8px">
      <div class="dphoto"><div id="dph"></div><input type="file" accept="image/*" class="hide" id="dpf"><div><div class="dpbtns"><button type="button" id="dpb">${d.photo ? 'Replace photo' : 'Add photo'}</button><button type="button" class="ghost" id="dpc">Choose one already in LiveGenie</button><button type="button" class="ghost danger${d.photo ? '' : ' hide'}" id="dpx">Remove</button></div>
        <button type="button" class="btn${d.photo ? '' : ' hide'}" id="dmk2">${icon('edit')}<span>${(d.marks || []).length ? 'Edit highlights (' + d.marks.length + ')' : 'Highlight on the photo'}</span></button>
        <div class="note">A photo of the gear helps volunteers find it. Gear in a rack can use the rack's photo instead: set its rack below.</div></div></div>
      <div class="dform">
        <label class="dfield wide"><span>What is it?</span><select data-k="kind" id="dkind"><option value="">Choose…</option>${GEAR_KIND.map((k) => '<option value="' + k[0] + '"' + (k[0] === d.kind ? ' selected' : '') + '>' + k[1] + '</option>').join('')}</select><em>Sorts it into the right bucket, and lets wireless mics pair with their receiver</em></label>
        <label class="dfield wide"><span>Tag name</span><div class="tagrow"><input data-k="name" value="${esc(d.name)}" placeholder="Like RX-1 or WMIC-1" autocapitalize="characters" spellcheck="false"><button type="button" class="btn" id="dauto" title="Suggest a tag name from what it is">${icon('spark')}Auto label</button></div><em id="dtagnote">What your team calls it; it goes on the label. Auto label suggests one from what it is.</em></label>
        <label class="dfield" id="dqtyw"><span id="dqtyt">Quantity</span><input id="dqty" type="number" min="1" max="999" value="${qtyOf(d)}" inputmode="numeric"><em id="dqtyh"></em></label>
        <div class="dfield wide hide" id="dutw"><span>Tags, one per piece</span><div class="dtagrow"><input id="dut" value="${esc((d.unit_tags || []).join(', '))}" placeholder="MIC-2, MIC-3"><button type="button" class="btn" id="dutauto">${icon('spark')}Auto label</button></div><em>Each piece's own tag, the way it is labelled. Placing one on the stage patch uses the next tag. The card's title is its make and model.</em></div>
        <label class="dfield wide"><span>Also called</span><input data-k="aliases" value="${esc(d.aliases.join(', '))}" placeholder="Nicknames, comma between"><em>Other names people type, separated by commas. Each one links to this card.</em></label>
        <label class="dfield"><span>Category</span><select data-k="category">${Object.keys(CAT).map((k) => '<option value="' + k + '"' + (k === d.category ? ' selected' : '') + '>' + CAT[k] + '</option>').join('')}</select></label>
        <label class="dfield"><span>Bucket</span><select data-k="bucket"><option value="" id="dbauto">Automatic (${esc(autoBucket({ ...d, kind: d.kind || (DEV.list || []).find((x) => x.id === d.id)?.kind || '' }))})</option>${bucketOrder(DEV.list || []).map((b) => '<option' + (b === d.bucket ? ' selected' : '') + '>' + esc(b) + '</option>').join('')}</select><em>Where it sits in the Gear Locker</em></label>
        ${f('make', 'Make', 'Manufacturer')}<label class="dfield"><span>Model</span><input data-k="model" value="${esc(d.model)}" placeholder="Model number" list="dmodels"><datalist id="dmodels"></datalist></label>
        <div class="dwl wide" id="dwl"></div>
        <label class="dfield"><span>Location</span><select data-k="location" id="dloc"><option value="">Not set</option>${locations.map((l) => '<option' + (l === d.location ? ' selected' : '') + '>' + esc(l) + '</option>').join('')}<option value="__new">+ New location…</option></select><em>Where it lives: a rack, a room, a road case</em></label>
        <div class="dio wide" id="dio"><label class="dfield"><span>Inputs</span><input data-k="inputs" type="number" min="0" max="512" value="${esc(d.inputs || '')}" placeholder="0"><em>For stage boxes, consoles and audio interfaces</em></label>
        <label class="dfield"><span>Outputs</span><input data-k="outputs" type="number" min="0" max="512" value="${esc(d.outputs || '')}" placeholder="0"></label></div>
        <label class="dfield wide${d.kind === 'computer' ? '' : ' hide'}" id="dsww"><span>Software</span><input id="dsw" value="${esc((d.software || []).join(', '))}" placeholder="LiveProfessor, OBS, ProPresenter" list="dswl"><datalist id="dswl">${(typeof PatchCore !== 'undefined' ? PatchCore.SOFTWARE : []).map((x) => '<option value="' + esc(x) + '">').join('')}</datalist><em>What it runs, comma between: ${(typeof PatchCore !== 'undefined' ? PatchCore.SOFTWARE : []).join(', ')}</em></label>
        <div class="dfield wide drack" id="drack"></div>
        <div class="dfield wide dpow" id="dpow"></div>
        <div class="dfield wide dman"><span>Manuals and documents</span>${id ? '<div id="dfiles2"></div>' : '<div class="note">Save it first, then upload manuals here.</div>'}
          <label class="dfield" style="margin-top:8px"><span>Manufacturer's page <span class="note">(optional web address)</span></span><input data-k="manual_url" value="${esc(d.manual_url)}" placeholder="https://…" inputmode="url"></label>
          <label class="dfield" style="margin-top:8px"><span>Same manuals as <span class="note">(optional)</span></span><select id="dmfrom"><option value="">Its own manuals only</option>${(DEV.list || []).filter((x) => String(x.id) !== String(id) && (x.files || x.manual_url)).map((x) => '<option value="' + x.id + '"' + (String(d.manual_from || '') === String(x.id) ? ' selected' : '') + '>' + esc(Tags.withModel(x.name, x.model)) + ' · ' + (x.files ? x.files + ' file' + (x.files === 1 ? '' : 's') : 'web page') + '</option>').join('')}</select><em>Uses that card's manuals here too, so they are uploaded once. Cards of the same make and model share them on their own.</em></label></div>
        <label class="tog dfield wide ${d.networked ? 'on' : ''}"><input type="checkbox" data-k="networked" ${d.networked ? 'checked' : ''}>On the network <em>Has an IP address, a MAC or plugs into a switch</em></label>
        <div class="dnet wide${d.networked ? '' : ' hide'}" id="dnet">
        ${f('ip', 'IP address', '0.0.0.0', { mono: true, mode: 'decimal', hint: 'Addresses in IP lists link here too when the name matches.' })}
        ${f('mac', 'MAC', '', { mono: true })}
        <label class="dfield"><span>Plugged into</span><select data-k="uplink_id"><option value="">Nothing / not set</option>${(await loadDevices(true)).filter((x) => String(x.id) !== String(id)).map((x) => '<option value="' + x.id + '"' + (String(x.id) === String(d.uplink_id || '') ? ' selected' : '') + '>' + esc(tagModel(x)) + '</option>').join('')}</select><em>The switch, router or access point it connects to. Draws the network map.</em></label>
        ${f('uplink_port', 'Port', 'Port number', { mode: 'text', hint: 'Port on that switch (optional)' })}
        </div>
        <label class="tog dfield wide ${d.tech_only ? 'on' : ''}"><input type="checkbox" data-k="tech_only" ${d.tech_only ? 'checked' : ''}>Admins only <em>Hidden from users</em></label>
      </div>
      <div class="dfield wide" style="margin-top:12px"><span>Notes</span><div id="dnotes"></div></div>
    </div>
    <div class="edbar"><span class="note" id="eMsg"></span><button id="dCancel">Cancel</button><button class="primary" id="dSave">${id ? 'Save' : 'Add to the Gear Locker'}</button></div>
  </div>`;
  const dirty = () => { S.dirty = true; $('#eMsg').textContent = 'Unsaved changes'; };
  await GearModels.load();
  const all = DEV.list || [];
  /** The wireless part: what it pairs with, transmitter type, capsule, frequency. Only for the kinds that have them. */
  // the capsule in a wireless mic: one of the capsule cards in the Gear Locker, a new one, or just typed
  const fitted = d.capsule_card ? all.find((x) => x.id === d.capsule_card) : null;
  if (d.capsule_id === undefined) d.capsule_id = fitted ? String(fitted.id) : d.capsule ? '__text' : '';
  const capField = (models) => {
    const caps = all.filter((x) => x.kind === 'capsule');
    // how many of each capsule card are free; a full one can't be picked (it is never taken off another mic)
    const using = (c) => all.filter((x) => x.kind === 'txmic' && x.capsule_card === c.id && String(x.id) !== String(id));
    const left = (c) => Math.max(1, c.qty || 1) - using(c).length;
    const note = (c) => { const u = using(c); const n = Math.max(1, c.qty || 1); return n > 1 ? ' · ' + Math.max(0, left(c)) + ' of ' + n + ' free' : u.length ? ' · on ' + u[0].name : ''; };
    return '<label class="dfield"><span>Capsule</span><select data-cap>' +
      '<option value="">None</option>' + caps.map((c) => { const mine = String(c.id) === String(d.capsule_id); return '<option value="' + c.id + '"' + (mine ? ' selected' : '') + (!mine && left(c) <= 0 ? ' disabled' : '') + '>' + esc(tagModel(c) + note(c)) + '</option>'; }).join('') +
      '<option value="__new">+ New capsule…</option><option value="__text"' + (d.capsule_id === '__text' ? ' selected' : '') + '>Type it (not a Gear Locker card)</option></select>' +
      '<em>' + (caps.length ? 'The capsule in it now. A capsule card with a quantity (SM58 head ×4) can go in that many mics; a full one shows greyed out.' : 'Add your capsules here as you go; one card can stand for several of the same capsule.') + '</em></label>' +
      (d.capsule_id === '__text' ? '<label class="dfield"><span>Capsule or mic</span><input data-w="capsule" value="' + esc(d.capsule) + '" placeholder="Capsule model, or the lav or headset" list="dcaps"><datalist id="dcaps">' + models.map((m) => '<option value="' + esc(m.model) + '">' + esc(m.make || '') + '</option>').join('') + '</datalist></label>' : '');
  };
  const newCapsule = () => new Promise((done) => {
    const models = GearModels.all().filter((m) => m.kind === 'capsule');
    modal('<h3>New capsule</h3><p>It gets its own card in the Gear Locker and goes in this mic.</p><form id="ncf"><label>Make</label><input id="ncm" placeholder="Manufacturer"><label>Model</label><input id="ncd" placeholder="Capsule model" list="ncl"><datalist id="ncl">' + models.map((m) => '<option value="' + esc(m.model) + '">' + esc(m.make || '') + '</option>').join('') + '</datalist>' +
      '<label>Name</label><input id="ncn" placeholder="What your team calls it"><div class="note">Leave it empty to use the make and model.</div><div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Add capsule</button></div></form>', (w, close) => {
      $('#ncd', w).addEventListener('change', () => { const m = GearModels.find($('#ncd', w).value, 'capsule'); if (m && m.make && !$('#ncm', w).value) $('#ncm', w).value = m.make; });
      $('#ncf', w).addEventListener('submit', async (e) => {
        e.preventDefault();
        const make = $('#ncm', w).value.trim(), model = $('#ncd', w).value.trim();
        let name = $('#ncn', w).value.trim() || [make, model].filter(Boolean).join(' ');
        if (!name) return toast('Give it a model or a name', 'bad');
        const taken = (n) => all.some((x) => x.name.toLowerCase() === n.toLowerCase());
        if (!$('#ncn', w).value.trim() && taken(name)) { let i = 2; while (taken(name + ' ' + i)) i++; name += ' ' + i; }
        try {
          const r = await call('POST', '/api/devices', { name, kind: 'capsule', category: 'audio', make, model });
          if (model) GearModels.add([{ kind: 'capsule', make, model }]);
          all.push({ id: r.id, name, kind: 'capsule', make, model, qty: 1, pair_id: null }); forgetDevices(); close(); done(String(r.id));
        } catch (err) { toast(err.message, 'bad'); }
      });
      // closed without adding: put the picker back
      $$('[data-close]', w).forEach((b) => b.addEventListener('click', () => done(null)));
      w.addEventListener('mousedown', (e) => { if (e.target === w) done(null); });
      const esc1 = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', esc1); done(null); } };
      document.addEventListener('keydown', esc1);
    });
  });
  const wireless = () => {
    const P = GEAR_PAIR[d.kind], host = $('#dwl');
    $('#dio').classList.toggle('hide', ['mic', 'txmic', 'capsule', 'di', 'bodypack', 'speaker', 'wedge', 'source'].includes(d.kind));
    $('#dmodels').innerHTML = GearModels.all().filter((m) => !d.kind || m.kind === d.kind).map((m) => '<option value="' + esc(m.model) + '">' + esc(m.make || '') + '</option>').join('');
    if (!P && d.kind !== 'txmic') { host.innerHTML = ''; return; }
    const mates = all.filter((x) => x.kind === P.with && String(x.id) !== String(id));
    const capsules = GearModels.all().filter((m) => m.kind === 'capsule' || m.kind === 'mic');
    host.innerHTML = '<div class="dform">' +
      '<label class="dfield"><span>' + P.label + '</span><select data-w="pair_id"><option value="">Not paired</option>' + mates.map((x) => '<option value="' + x.id + '"' + (String(x.id) === String(d.pair_id || '') ? ' selected' : '') + '>' + esc(tagModel(x)) + '</option>').join('') + '</select><em>' +
        (mates.length ? (d.kind === 'capsule' ? 'The wireless mic it goes on (leave empty for a spare)' : 'Its card lists everything paired with it') : 'No ' + kindLabel(P.with).toLowerCase() + ' in the Gear Locker yet') + '</em></label>' +
      (d.kind === 'txmic' ? '<label class="dfield"><span>Type</span><select data-w="txtype"><option value="">—</option>' + TX_KINDS.map((t) => '<option' + (t === d.txtype ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
        capField(capsules) : '') +
      (d.kind === 'txmic' || d.kind === 'bodypack' ? '<label class="dfield"><span>Frequency</span><input data-w="freq" value="' + esc(d.freq) + '" placeholder="MHz" inputmode="decimal"></label>' : '') + '</div>';
    $$('[data-w]', host).forEach((x) => x.addEventListener(x.tagName === 'SELECT' ? 'change' : 'input', () => { d[x.dataset.w] = x.value; dirty(); }));
    const cs = $('[data-cap]', host);
    if (cs) cs.addEventListener('change', async () => {
      let v = cs.value;
      if (v === '__new') { v = await newCapsule(); if (v == null) { cs.value = d.capsule_id; return; } }
      d.capsule_id = v; dirty(); wireless();
    });
  };
  wireless();
  $('#dkind').addEventListener('change', () => {
    d.kind = $('#dkind').value;   // this runs before the general field listener, so take the new kind now
    if (['network', 'computer'].includes(d.kind)) { d.category = d.kind; $('[data-k=category]').value = d.kind; } else if (d.kind && d.kind !== 'other') { d.category = 'audio'; $('[data-k=category]').value = 'audio'; }
    wireless();
    $('#dsww').classList.toggle('hide', d.kind !== 'computer');
    $('#dbauto').textContent = 'Automatic (' + autoBucket({ ...d }) + ')';
    qtyField();
  });
  // Quantity: one card for several of the same gear. Wireless gear has its own frequency and channel, so "How many?" makes a card for each.
  function qtyField() {
    const each = ONE_EACH.includes(d.kind), w = $('#dqtyw');
    if (each && id) { w.classList.add('hide'); return; }
    w.classList.remove('hide');
    $('#dqtyt').textContent = each ? 'How many?' : 'Quantity';
    $('#dqtyh').textContent = each ? 'More than one makes a card for each (' + (d.kind === 'receiver' ? 'RX-1, RX-2' : d.kind === 'iemtx' ? 'IEM-TX1, IEM-TX2' : d.kind === 'bodypack' ? 'IEM-1, IEM-2' : 'WMIC-1, WMIC-2') + '…): each has its own frequency and channel.'
      : 'How many of these you have. One card stands for all of them; on the stage patch each is placed and cabled on its own.';
    if (!each && Number($('#dqty').value) > 999) $('#dqty').value = 999;
    $('#dutw').classList.toggle('hide', each || (Number($('#dqty').value) || 1) < 2);
  }
  qtyField();
  // a tag that is a run of numbers (MIC-2–3) follows the quantity: change 2 to 3 and it becomes MIC-2–4 (or the next free run)
  const unitAuto = () => {
    const q = Math.max(1, Number($('#dqty').value) || 1);
    const have = $('#dut').value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, q);
    const taken = otherNames().concat(have);
    while (have.length < q) { const t = Tags.suggest(d.kind || 'other', taken, { model: d.model }); have.push(t); taken.push(t); }
    $('#dut').value = have.join(', '); dirty();
  };
  $('#dutauto').addEventListener('click', () => { if (!d.kind) { toast('Pick what it is first, then Auto label', 'bad'); return; } $('#dut').value = ''; unitAuto(); });
  $('#dut').addEventListener('input', dirty);
  $('#dqty').addEventListener('input', () => { qtyField(); const q = Number($('#dqty').value) || 1; if (q > 1 && d.kind && !ONE_EACH.includes(d.kind) && $('#dut').value.trim()) unitAuto(); });
  $('#dqty').addEventListener('input', () => dirty());
  // Auto label: a short code from what it is (RX-1, WMIC-2, PA-AMP1…), never one another card already uses
  let autoNamed = false;
  const otherNames = () => all.filter((x) => String(x.id) !== String(id)).flatMap((x) => Tags.namesOf(x));
  // a card standing for several (Quantity 2+) gets a run of numbers, like MIC-2–3, so the next card starts after it
  // a card standing for several is named by what it is (its make and model); each piece gets its own tag below
  const suggestTag = (taken) => { const q = Number(($('#dqty') || {}).value) || Number(d.qty) || 1; const mm = [d.make, d.model].filter(Boolean).join(' '); return q > 1 && !ONE_EACH.includes(d.kind) && mm ? mm : Tags.suggest(d.kind || 'other', taken || otherNames(), { model: d.model }); };
  $('#dauto').addEventListener('click', () => {
    if (!d.kind) { toast('Pick what it is first, then Auto label', 'bad'); $('#dkind').focus(); return; }
    const n = $('[data-k=name]');
    n.value = d.name = suggestTag(); autoNamed = true; dirty();
    const q = $('#dqty'); if (q && !id && ONE_EACH.includes(d.kind) && Number(q.value) > 1) $('#dtagnote').textContent = 'Each of the ' + q.value + ' gets its own number when you add them.';
  });
  $('[data-k=name]').addEventListener('input', () => { autoNamed = false; });
  // a model already on your list fills in what it is and who makes it
  $('[data-k=model]').addEventListener('change', () => {
    const m = GearModels.find(d.model, d.kind || undefined) || GearModels.find(d.model); if (!m) return;
    if (!d.kind && m.kind) { d.kind = m.kind; $('#dkind').value = m.kind; $('#dkind').dispatchEvent(new Event('change')); }
    if (!d.make && m.make) { d.make = m.make; $('[data-k=make]').value = m.make; }
  });
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
  if (id) paintFiles($('#dfiles2'), d, full.files || [], full.sharedFiles || []);
  // "same manuals as": use another card's manuals instead of uploading them again
  const msel = $('#dmfrom');
  if (msel) msel.addEventListener('change', () => { d.manual_from = msel.value ? Number(msel.value) : null; dirty(); });
  const r = Rich.create({ md: d.notes, compact: true, placeholder: 'Settings, quirks, how to reset it, who to call…', onChange: (v) => { d.notes = v; dirty(); } });
  $('#dnotes').appendChild(r.el);
  // highlights are drawn here, in Edit, and saved with the card
  d.marks = Array.isArray(d.marks) ? d.marks : [];
  let marksDirty = false;
  const photo = () => {
    $('#dph').innerHTML = d.photo ? '<img src="/uploads/' + esc(d.photo) + '" alt="">' : devThumb({ name: d.name || '?' }, 84);
    $('#dpx').classList.toggle('hide', !d.photo); $('#dmk2').classList.toggle('hide', !d.photo);
    $('#dpb').textContent = d.photo ? 'Replace photo' : 'Add photo';
    $('#dmk2 span').textContent = d.marks.length ? 'Edit highlights (' + d.marks.length + ')' : 'Highlight on the photo';
  };
  const newPhoto = (pid) => { if (pid === d.photo) return; d.photo = pid; d.marks = []; marksDirty = true; photo(); dirty(); };
  photo();
  $('#dpb').addEventListener('click', () => $('#dpf').click());
  $('#dpx').addEventListener('click', () => newPhoto(''));
  $('#dpc').addEventListener('click', async () => { const pid = await choosePhoto(); if (pid) newPhoto(pid); });
  $('#dmk2').addEventListener('click', () => marksEditor({ ...d, name: d.name || 'this gear' }, (marks) => { d.marks = marks; marksDirty = true; photo(); dirty(); }, { local: true }));
  paintRackPower(d, id, dirty);
  $('#dpf').addEventListener('change', async () => {
    const file = $('#dpf').files[0]; if (!file) return;
    $('#eMsg').textContent = 'Uploading photo…';
    try { const pic = await shrink(file); const up = await call('POST', '/api/uploads', pic.blob, { raw: true, type: pic.type }); newPhoto(up.id); $('#eMsg').textContent = up.reused ? 'That photo is already in LiveGenie: using the one there' : 'Unsaved changes'; }
    catch (e) { toast(e.message, 'bad'); $('#eMsg').textContent = S.dirty ? 'Unsaved changes' : ''; }
  });
  $('#dCancel').addEventListener('click', () => { location.hash = id ? '#/d/' + id : '#/gear'; });
  /** What gets saved: a wireless mic sends its capsule card (or none, keeping a typed one). */
  const body = () => {
    const b = { ...d };
    b.qty = ONE_EACH.includes(d.kind) ? 1 : Math.max(1, Math.min(999, Math.round(Number($('#dqty').value) || 1)));
    if (d.kind === 'computer') b.software = $('#dsw').value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20); else b.software = [];
    if (b.qty > 1) b.unit_tags = $('#dut').value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, b.qty); else b.unit_tags = [];
    if (d.kind === 'txmic') { b.capsule_id = /^\d+$/.test(String(d.capsule_id)) ? d.capsule_id : ''; if (d.capsule_id === '__text') b.capsule_typed = true; else delete b.capsule; }
    else delete b.capsule_id;
    delete b.marks;
    Object.assign(b, rackPowerBody(d));
    return b;
  };
  const saveMarks = async (cardId) => { if (marksDirty && d.photo) await call('PUT', '/api/devices/' + cardId + '/marks', { marks: d.marks }); };
  $('#dSave').addEventListener('click', async () => {
    $('#dSave').disabled = true;
    try {
      if (id) { await call('PUT', '/api/devices/' + id, body()); await saveMarks(id); S.dirty = false; forgetDevices(); toast('Saved', 'ok'); location.hash = '#/d/' + id; }
      else {
        // wireless: a card for each; anything else: one card with its quantity
        const n = ONE_EACH.includes(d.kind) ? Math.max(1, Math.min(48, Number($('#dqty').value) || 1)) : 1;
        let x;
        // auto-labelled (or left empty): each one gets its own tag, WMIC-1, WMIC-2…; a typed name is numbered after it
        const auto = autoNamed || !d.name.trim();
        const taken = otherNames();
        const nameFor = (i) => { if (!auto) return n === 1 ? d.name : d.name + ' ' + i; const t = i === 1 && autoNamed && n === 1 ? d.name : suggestTag(taken); taken.push(t); return t; };
        // wireless mics with a capsule card: each new mic gets one while the card has room (SM58 head ×4 → four mics)
        const capCard = d.kind === 'txmic' && /^\d+$/.test(String(d.capsule_id)) ? (DEV.list || []).find((c) => String(c.id) === String(d.capsule_id)) : null;
        let capLeft = capCard ? Math.max(1, capCard.qty || 1) - (DEV.list || []).filter((m) => m.kind === 'txmic' && m.capsule_card === capCard.id).length : 0;
        let capGiven = 0;
        for (let i = 1; i <= n; i++) {
          const cap = d.kind === 'txmic' && d.capsule_id !== '__text' ? (capCard && capLeft > 0 ? { capsule_id: capCard.id } : { capsule_id: '' }) : {};
          if (capCard && capLeft > 0) { capLeft--; capGiven++; }
          const one = await call('POST', '/api/devices', { ...body(), name: nameFor(i), ...(n > 1 ? { aliases: [] } : {}), ...cap, ...(i > 1 ? { rack_id: '', power_pdu: '' } : {}) });
          if (i === 1) { x = one; await saveMarks(one.id); }
        }
        S.dirty = false; forgetDevices();
        toast((n === 1 ? 'Added to the Gear Locker' : n + ' added to the Gear Locker') + (capCard && n > 1 ? '; ' + capGiven + ' of them got a ' + capCard.name + (capGiven < n ? ' (no more free; raise its quantity for the rest)' : '') : ''), 'ok');
        location.hash = n === 1 ? '#/d/' + x.id : '#/gear';
      }
      // next time this model is one pick away, and knows what it is
      if (d.kind && d.model) GearModels.add([{ kind: d.kind, make: d.make, model: d.model, capsule: d.kind === 'txmic' ? d.txtype : undefined }]);
      if (d.kind === 'txmic' && d.capsule_id === '__text' && d.capsule && !GearModels.find(d.capsule)) GearModels.add([{ kind: 'capsule', model: d.capsule }]);
    } catch (e) { toast(e.message, 'bad'); }
    finally { const b = $('#dSave'); if (b) b.disabled = false; }
  });
  if (!id) $('[data-k=name]').focus();
}
