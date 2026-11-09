/**
 * Admin › Gear check: every Gear Locker card that is missing something, grouped by what is missing, with the fields
 * to fill it right there (one Save per card). "Doesn't apply" hides a card from one check for good (a passive speaker
 * needs no power, a DI has no IP). Checks: power, what it is, make and model, IP, location, watts, wireless pairing,
 * frequency, inputs and outputs, manual, photo.
 */
const GEAR_CHECKS = [
  { id: 'power', label: 'Not plugged in', why: 'Gear in a rack, or gear that needs power, with no power strip or sequencer outlet set.' },
  { id: 'kind', label: 'What it is', why: 'No "What is it?" set, so it cannot sort into a bucket or pair with anything.' },
  { id: 'model', label: 'Make or model', why: 'Missing the make or the model number.' },
  { id: 'ip', label: 'IP address', why: 'Marked as on the network, with no IP address.' },
  { id: 'location', label: 'Location', why: 'No location, and not in a rack.' },
  { id: 'watts', label: 'Watts', why: 'Plugged into a strip, but how much power it draws is not set, so the strip total is short.' },
  { id: 'pair', label: 'Not paired', why: 'A wireless mic or in-ear pack with no receiver or transmitter.' },
  { id: 'freq', label: 'Frequency', why: 'A wireless mic or in-ear pack with no frequency.' },
  { id: 'io', label: 'Inputs and outputs', why: 'A console, stage box, receiver, processor or amp with no inputs or outputs set.' },
  // nice to have: shown, but not counted against "complete"
  { id: 'manual', label: 'Manual', extra: true, why: 'No manual uploaded and no manufacturer page.' },
  { id: 'photo', label: 'Photo', extra: true, why: 'No photo of its own, and not in a rack with a photo.' }
];
/** Gear that plugs into the wall. Mics, capsules, packs (batteries), passive DIs and most speakers do not. */
const NEEDS_POWER = ['console', 'stagebox', 'receiver', 'iemtx', 'processor', 'amp', 'network', 'computer', 'headamp'];
const NEEDS_IO = ['console', 'stagebox', 'receiver', 'processor', 'amp', 'iemtx'];

/** What each card is missing (issue ids), not counting ones marked "doesn't apply". */
function gearIssues(d, ctx) {
  const out = [];
  const skip = (id) => ctx.skip.has(d.id + ':' + id);
  const add = (id, yes) => { if (yes && !skip(id)) out.push(id); };
  const wireless = d.kind === 'txmic' || d.kind === 'bodypack';
  add('power', d.kind !== 'power' && !d.power_pdu && ctx.strips.length > 0 && (!!d.rack_id || NEEDS_POWER.includes(d.kind)));
  add('kind', !d.kind);
  add('model', !d.make || !d.model);
  add('ip', !!d.networked && !(d.ips && d.ips.length));
  add('location', !d.location && !d.rack_id);
  add('watts', !!d.power_pdu && !Number(d.power_w));
  add('pair', wireless && !d.pair_id);
  add('freq', wireless && !d.freq);
  add('io', NEEDS_IO.includes(d.kind) && !Number(d.inputs) && !Number(d.outputs));
  add('manual', !d.files && !d.manual_url && d.kind !== 'capsule');
  add('photo', !d.photo && !(d.rack_id && ctx.rackPhoto.has(d.rack_id)));
  return out;
}

async function tabGearCheck(pane, pick) {
  const [devs, racks] = await Promise.all([loadDevices(true), get('/api/racks').catch(() => ({ racks: [] }))]);
  const list = devs || DEV.list || [];
  const ctx = { skip: DEV.checkSkip || new Set(), strips: list.filter((d) => d.kind === 'power'), rackPhoto: new Set((racks.racks || []).filter((r) => r.photo).map((r) => r.id)) };
  const issues = new Map(list.map((d) => [d.id, gearIssues(d, ctx)]));
  const counts = Object.fromEntries(GEAR_CHECKS.map((c) => [c.id, list.filter((d) => issues.get(d.id).includes(c.id)).length]));
  const must = new Set(GEAR_CHECKS.filter((c) => !c.extra).map((c) => c.id));
  const done = list.filter((d) => !issues.get(d.id).some((i) => must.has(i))).length;
  const pct = list.length ? Math.round(done / list.length * 100) : 100;
  let cur = pick && counts[pick] ? pick : (GEAR_CHECKS.find((c) => counts[c.id]) || {}).id || null;

  const paint = () => {
    const c = GEAR_CHECKS.find((x) => x.id === cur);
    const rows = c ? list.filter((d) => issues.get(d.id).includes(c.id)) : [];
    pane.innerHTML = '<p class="note pnote">Every Gear Locker card that is missing something, grouped by what is missing. Fill it in right here and Save, or mark it as not applying to that card.</p>' +
      '<div class="card gcsum"><div class="gcbar"><i style="width:' + pct + '%"></i></div><div class="gcpct"><b>' + pct + '%</b> complete · ' + done + ' of ' + list.length + ' cards have everything</div>' +
      '<div class="gcchips">' + GEAR_CHECKS.map((x, k) => (x.extra && !(GEAR_CHECKS[k - 1] || {}).extra ? '<span class="gcnice">Nice to have</span>' : '') + '<button class="gcchip' + (x.id === cur ? ' on' : '') + (counts[x.id] ? '' : ' zero') + '" data-gc="' + x.id + '"' + (counts[x.id] ? '' : ' disabled') + '>' + esc(x.label) + '<em>' + counts[x.id] + '</em></button>').join('') + '</div></div>' +
      (c ? '<div class="card"><h2>' + esc(c.label) + ' <span class="note">· ' + rows.length + '</span></h2><p class="note">' + esc(c.why) + '</p><div class="gclist">' + rows.map((d) => rowHtml(d, c.id)).join('') + '</div></div>'
        : '<div class="card empty"><b>Everything is filled in.</b><div class="note">Every card has what it needs (or it was marked as not applying).</div></div>') +
      '<datalist id="gclocs">' + locs.map((l) => '<option value="' + esc(l) + '">').join('') + '</datalist>';
    $$('[data-gc]', pane).forEach((b) => b.addEventListener('click', () => { cur = b.dataset.gc; paint(); }));
    if (c) rows.forEach((d) => wireRow(d, c.id));
  };

  const tm = (d) => Tags.withModel(d.name, d.model);
  const freeOutlets = (strip, self) => { const n = Number(strip.outputs) || 8; const taken = new Set(list.filter((x) => x.power_pdu === strip.id && x.id !== self).map((x) => x.power_outlet)); return Array.from({ length: n }, (_, k) => k + 1).filter((k) => !taken.has(k)); };
  const locs = [...new Set(list.map((d) => d.location).filter(Boolean))].sort();
  function fields(d, id) {
    const f = (k, label, v, attrs) => '<label class="gcf"><em>' + label + '</em><input data-f="' + k + '" value="' + esc(v == null ? '' : v) + '" ' + (attrs || '') + '></label>';
    if (id === 'power') {
      return '<label class="gcf"><em>Plugs into</em><select data-f="power_pdu"><option value="">Choose a strip…</option>' + ctx.strips.map((s) => '<option value="' + s.id + '">' + esc(tm(s)) + ' · ' + freeOutlets(s, d.id).length + ' free</option>').join('') + '</select></label>' +
        '<label class="gcf sm"><em>Outlet</em><select data-f="power_outlet"><option value="">—</option></select></label>' + f('power_w', 'Watts', d.power_w || '', 'type="number" min="0" max="20000" class="sm" placeholder="W"');
    }
    if (id === 'kind') return '<label class="gcf"><em>What is it?</em><select data-f="kind"><option value="">Choose…</option>' + GEAR_KIND.map((k) => '<option value="' + k[0] + '">' + k[1] + '</option>').join('') + '</select></label>';
    if (id === 'model') return f('make', 'Make', d.make, 'placeholder="Manufacturer"') + f('model', 'Model', d.model, 'placeholder="Model number"');
    if (id === 'ip') return f('ip', 'IP address', '', 'placeholder="192.168.1.20" inputmode="decimal"');
    if (id === 'location') return f('location', 'Location', d.location, 'list="gclocs" placeholder="Booth, Stage left…"');
    if (id === 'watts') return f('power_w', 'Watts', '', 'type="number" min="1" max="20000" placeholder="W"');
    if (id === 'pair') {
      const want = d.kind === 'txmic' ? 'receiver' : 'iemtx';
      return '<label class="gcf"><em>' + (d.kind === 'txmic' ? 'Receiver' : 'Transmitter') + '</em><select data-f="pair_id"><option value="">Choose…</option>' + list.filter((x) => x.kind === want).map((x) => '<option value="' + x.id + '">' + esc(tm(x)) + '</option>').join('') + '</select></label>';
    }
    if (id === 'freq') return f('freq', 'Frequency (MHz)', '', 'placeholder="518.200" inputmode="decimal"');
    if (id === 'io') return f('inputs', 'Inputs', d.inputs || '', 'type="number" min="0" max="512" class="sm"') + f('outputs', 'Outputs', d.outputs || '', 'type="number" min="0" max="512" class="sm"');
    if (id === 'manual') return f('manual_url', 'Manufacturer page', '', 'type="url" placeholder="https://…"') + '<a class="btn sm" href="#/d/' + d.id + '/edit">Upload a manual</a>';
    if (id === 'photo') return '<a class="btn sm" href="#/d/' + d.id + '/edit">' + icon('image') + 'Add a photo</a>' + (d.rack_id ? '' : '<span class="note">or put it in a rack that has a photo</span>');
    return '';
  }
  function rowHtml(d, id) {
    return '<div class="gcrow" data-row="' + d.id + '"><a class="gcname" href="#/d/' + d.id + '"><b>' + esc(tm(d)) + '</b><span>' + esc([kindLabel(d.kind), d.location].filter(Boolean).join(' · ') || ' ') + '</span></a>' +
      '<div class="gcfields">' + fields(d, id) + '</div><div class="gcacts">' + (id === 'photo' ? '' : '<button class="btn primary sm" data-save>Save</button>') + '<button class="ghost sm" data-na title="Hide this card from this check">Doesn\'t apply</button></div></div>';
  }
  function wireRow(d, id) {
    const row = $('[data-row="' + d.id + '"]', pane); if (!row) return;
    const pdu = $('[data-f="power_pdu"]', row), out = $('[data-f="power_outlet"]', row);
    if (pdu) pdu.addEventListener('change', () => { const s = ctx.strips.find((x) => String(x.id) === pdu.value); out.innerHTML = '<option value="">—</option>' + (s ? freeOutlets(s, d.id).map((k) => '<option value="' + k + '">' + k + '</option>').join('') : ''); if (s && out.options.length > 1) out.selectedIndex = 1; });
    const sv = $('[data-save]', row);
    if (sv) sv.addEventListener('click', async () => {
      const ch = {};
      $$('[data-f]', row).forEach((x) => { ch[x.dataset.f] = x.value.trim(); });
      if (id === 'power' && (!ch.power_pdu || !ch.power_outlet)) return toast('Pick the strip and the outlet', 'bad');
      if (Object.values(ch).every((v) => !v)) return toast('Fill it in first', 'bad');
      sv.disabled = true;
      try {
        const full = (await get('/api/devices/' + d.id)).device;
        const body = { ...full };
        if (ch.power_pdu !== undefined) { body.power_pdu = Number(ch.power_pdu) || null; body.power_outlet = Number(ch.power_outlet) || null; }
        if (ch.power_w) body.power_w = Number(ch.power_w);
        if (ch.kind) body.kind = ch.kind;
        if (ch.make !== undefined) body.make = ch.make; if (ch.model !== undefined) body.model = ch.model;
        if (ch.ip) { body.ip = ch.ip; body.networked = true; }
        if (ch.location) body.location = ch.location;
        if (ch.pair_id) body.pair_id = Number(ch.pair_id);
        if (ch.freq) body.freq = ch.freq;
        if (ch.inputs !== undefined) body.inputs = Number(ch.inputs) || 0; if (ch.outputs !== undefined) body.outputs = Number(ch.outputs) || 0;
        if (ch.manual_url) body.manual_url = ch.manual_url;
        await call('PUT', '/api/devices/' + d.id, body);
        forgetDevices();
        toast(d.name + ' saved', 'ok');
        tabGearCheck(pane, id);
      } catch (e) { sv.disabled = false; toast(e.message, 'bad'); }
    });
    $('[data-na]', row).addEventListener('click', async () => {
      try { const r = await call('PUT', '/api/devices/check-skip', { key: d.id + ':' + id }); DEV.checkSkip = new Set(r.checkSkip); tabGearCheck(pane, id); } catch (e) { toast(e.message, 'bad'); }
    });
  }
  paint();
}
