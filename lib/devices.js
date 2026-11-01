/*
 * Device library. One card per device; pages link to it automatically wherever
 * its name, an alias or its IP address appears (public/devmatch.js decides what
 * counts). A card's "Used on" list is worked out on request by reading the pages
 * the person can see, so it is never out of date.
 *
 * IP addresses come from the card itself and from any IP list row whose device
 * name matches the card, so an address typed once in an IP list links everywhere.
 */
'use strict';

const Auth = require('./auth');
const Blocks = require('./blocks');
const DevMatch = require('../public/devmatch');

const CATEGORIES = ['audio', 'video', 'lighting', 'network', 'computer', 'power', 'other'];
/** What a piece of gear is. Same words as the stage patch, so a card and a patch block agree. */
const GEAR_KINDS = ['mic', 'txmic', 'capsule', 'receiver', 'di', 'source', 'iemtx', 'bodypack', 'headamp', 'console', 'stagebox', 'processor', 'amp', 'speaker', 'wedge', 'network', 'computer', 'other'];
/** Which kind each one pairs with. */
const PAIRS = { txmic: 'receiver', capsule: 'txmic', bodypack: 'iemtx' };
const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const validIp = (s) => { const m = IP_RE.exec(s); return !!m && m.slice(1).every((n) => Number(n) <= 255); };
const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function create(db, deps) {
  const { UserError, audit } = deps;
  const seeTech = (user) => Auth.atLeast(user, 'admin');

  const toObj = (r) => r && ({
    id: r.id, name: r.name, aliases: JSON.parse(r.aliases), category: r.category, make: r.make, model: r.model,
    location: r.location, ip: r.ip, mac: r.mac, photo: r.photo, manual_url: r.manual_url, notes: r.notes,
    tech_only: !!r.tech_only, networked: !!r.networked, bucket: r.bucket || '', marks: parseMarks(r.marks), inputs: r.inputs || 0, outputs: r.outputs || 0, uplink_id: r.uplink_id || null, uplink_port: r.uplink_port || '', kind: r.kind || '', pair_id: r.pair_id || null, txtype: r.txtype || '', capsule: r.capsule || '', freq: r.freq || '', created_at: r.created_at, updated_at: r.updated_at
  });

  /** Highlight boxes on the photo: where things are (power switch, reset button), as fractions of the picture. */
  const MARK_COLORS = ['yellow', 'red', 'green', 'blue', 'purple'];
  function cleanMarks(list) {
    const f = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 10000) / 10000)) : null; };
    return (Array.isArray(list) ? list : []).slice(0, 40).map((m) => {
      if (!m) return null;
      const x = f(m.x), y = f(m.y), w = f(m.w), h = f(m.h);
      if ([x, y, w, h].some((v) => v == null) || w < 0.005 || h < 0.005) return null;
      return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y), label: str(m.label, 80), color: MARK_COLORS.includes(m.color) ? m.color : 'yellow' };
    }).filter(Boolean);
  }
  function parseMarks(v) { try { return cleanMarks(JSON.parse(v || '[]')); } catch (e) { return []; } }
  function setMarks(id, list, user) {
    const cur = db.prepare('SELECT name, photo FROM devices WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Device not found', 404);
    if (!cur.photo) throw new UserError('Add a photo first');
    const marks = cleanMarks(list);
    db.prepare('UPDATE devices SET marks = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(marks), user.id, Date.now(), Number(id));
    audit(user, 'device.marks', cur.name, marks.length + ' highlight' + (marks.length === 1 ? '' : 's'));
    return marks;
  }

  function visiblePages(user) {
    return db.prepare('SELECT id, title, blocks, tech_only, space_id FROM pages WHERE deleted_at IS NULL' + (seeTech(user) ? '' : ' AND tech_only = 0')).all();
  }

  /** Every device the person can see, with all its IPs (own + from IP lists). */
  function list(user) {
    const rows = db.prepare('SELECT * FROM devices' + (seeTech(user) ? '' : ' WHERE tech_only = 0') + ' ORDER BY name COLLATE NOCASE').all().map(toObj);
    const byName = DevMatch.build(rows.map((d) => ({ id: d.id, name: d.name, aliases: d.aliases })));
    const extra = new Map();
    for (const p of visiblePages(user)) {
      for (const b of JSON.parse(p.blocks)) {
        if (b.type !== 'iplist') continue;
        for (const r of b.rows || []) {
          if (!validIp(r.ip) || !r.device) continue;
          const hit = byName.find(r.device)[0];
          if (!hit || hit.index !== 0 || hit.length !== r.device.trim().length) continue;   // the whole Device cell is the name
          if (!extra.has(hit.id)) extra.set(hit.id, []);
          extra.get(hit.id).push({ ip: r.ip, vlan: (b.net && b.net.vlan) || '', network: (b.net && b.net.name) || b.title || '', page_id: p.id });
        }
      }
    }
    return rows.map((d) => {
      const fromLists = extra.get(d.id) || [];
      const ips = [...new Set([d.ip, ...fromLists.map((x) => x.ip)].filter(Boolean))];
      return { ...d, ips, ipSources: fromLists };
    });
  }

  function get(id, user) {
    const d = list(user).find((x) => x.id === Number(id));
    if (!d) throw new UserError('Device not found' + (user ? '' : '. If it is Tech only, sign in first.'), 404);
    return d;
  }

  /** Where a device is mentioned, grouped by page. */
  function usedOn(device, user) {
    const m = DevMatch.build([{ id: device.id, name: device.name, aliases: device.aliases, ips: device.ips }]);
    const hits = (text) => m.find(text).length > 0;
    const cut = (s) => (s.length > 140 ? s.slice(0, 137) + '…' : s);
    const spaces = new Map(db.prepare('SELECT id, slug, name FROM spaces').all().map((s) => [s.id, s]));
    const out = [];
    for (const p of visiblePages(user)) {
      const found = [];
      if (hits(p.title)) found.push({ kind: 'title', label: 'Page title', text: p.title });
      for (const b of JSON.parse(p.blocks)) {
        if (b.type === 'text' || b.type === 'callout') {
          const lines = Blocks.plainLines(b.md).filter(hits);
          lines.slice(0, 4).forEach((l) => found.push({ kind: b.type, label: b.type === 'callout' ? 'Callout' : 'Text', text: cut(l) }));
        } else if (b.type === 'checklist') {
          if (hits(b.title)) found.push({ kind: 'checklist', label: 'Checklist', text: b.title, block: b.id });
          b.items.filter(hits).forEach((t) => found.push({ kind: 'checklist', label: (b.title || 'Checklist') + ' step', text: cut(t), block: b.id }));
        } else if (b.type === 'patch') {
          (b.rows || []).filter((r) => r.some(hits)).slice(0, 30).forEach((r) => found.push({
            kind: 'patch', label: b.title || (Blocks.PRESETS[b.preset] || Blocks.PRESETS.custom).title, block: b.id,
            text: cut(b.columns.map((c, i) => (r[i] ? c + ' ' + r[i] : '')).filter(Boolean).join(' · '))
          }));
        } else if (b.type === 'iplist') {
          (b.rows || []).filter((r) => [r.ip, r.device, r.location, r.notes].some(hits)).forEach((r) => found.push({
            kind: 'iplist', label: b.title || (b.net && b.net.name) || 'IP list', block: b.id,
            text: [r.ip, r.device, r.location].filter(Boolean).join(' · ')
          }));
        } else if (b.type === 'image' && hits(b.caption)) found.push({ kind: 'image', label: 'Picture', text: cut(b.caption) });
      }
      if (found.length) {
        const sp = spaces.get(p.space_id) || {};
        out.push({ page_id: p.id, title: p.title, space: sp.slug, space_name: sp.name, tech_only: !!p.tech_only, hits: found });
      }
    }
    return out.sort((a, b) => b.hits.length - a.hits.length || a.title.localeCompare(b.title));
  }

  function check(data, upload) {
    const name = str(data.name, 60);
    if (!name) throw new UserError('Give the device a name');
    const aliases = [...new Set((Array.isArray(data.aliases) ? data.aliases : String(data.aliases || '').split(','))
      .map((a) => str(a, 40)).filter((a) => a.length >= 2 && a.toLowerCase() !== name.toLowerCase()))].slice(0, 10);
    const category = CATEGORIES.includes(data.category) ? data.category : 'other';
    const ip = str(data.ip, 40);
    if (ip && !validIp(ip)) throw new UserError('That IP address does not look right (like 10.10.20.11)');
    const manual = str(data.manual_url, 500);
    if (manual && !/^https?:\/\//i.test(manual)) throw new UserError('The manual link must start with http:// or https://');
    const photo = String(data.photo || '');
    if (photo && !upload(photo)) throw new UserError('The photo is missing; add it again');
    let uplink = data.uplink_id ? Number(data.uplink_id) : null;
    if (uplink && !db.prepare('SELECT 1 FROM devices WHERE id = ?').get(uplink)) uplink = null;
    const count = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= 512 ? n : 0; };
    const kind = GEAR_KINDS.includes(data.kind) ? data.kind : '';
    // a transmitter pairs with a receiver, a capsule fits a transmitter, an in-ear pack pairs with its transmitter
    let pair = PAIRS[kind] && data.pair_id ? Number(data.pair_id) : null;
    if (pair && !db.prepare('SELECT 1 FROM devices WHERE id = ?').get(pair)) pair = null;
    const wl = kind === 'txmic' || kind === 'bodypack';
    return {
      kind, pair_id: pair, txtype: kind === 'txmic' ? str(data.txtype, 30) : '', capsule: kind === 'txmic' ? str(data.capsule, 80) : '', freq: wl ? str(data.freq, 20) : '',
      inputs: count(data.inputs), outputs: count(data.outputs),
      uplink_id: uplink, uplink_port: str(data.uplink_port, 30),
      name, aliases: JSON.stringify(aliases), category, make: str(data.make, 60), model: str(data.model, 80), location: str(data.location, 80),
      ip, mac: str(data.mac, 40), photo, manual_url: manual, bucket: str(data.bucket, 40), networked: data.networked === undefined ? (ip || data.mac || uplink ? 1 : 0) : (data.networked ? 1 : 0), notes: String(data.notes || '').replace(/\r\n?/g, '\n').slice(0, 20000), tech_only: data.tech_only ? 1 : 0
    };
  }

  function clash(name, aliases, exceptId) {
    const all = db.prepare('SELECT id, name, aliases FROM devices WHERE id != ?').all(exceptId || 0);
    const mine = [name, ...JSON.parse(aliases)].map((x) => x.toLowerCase());
    for (const d of all) {
      const theirs = [d.name, ...JSON.parse(d.aliases)].map((x) => x.toLowerCase());
      const same = mine.find((x) => theirs.includes(x));
      if (same) throw new UserError('“' + same + '” is already used by ' + d.name + '. Names and aliases must be unique.');
    }
  }

  /** Refuse a "plugged into" chain that loops back to the device itself. */
  function loopCheck(id, uplink) {
    let cur = uplink, n = 0;
    while (cur && n++ < 100) {
      if (cur === id) throw new UserError('That would plug the device into itself (through ' + n + ' step' + (n === 1 ? '' : 's') + '). Pick a different device.');
      const r = db.prepare('SELECT uplink_id FROM devices WHERE id = ?').get(cur);
      cur = r ? r.uplink_id : null;
    }
  }

  function add(data, user, upload) {
    const d = check(data, upload);
    clash(d.name, d.aliases);
    const now = Date.now();
    const r = db.prepare(`INSERT INTO devices (name, aliases, category, make, model, location, ip, mac, photo, manual_url, notes, tech_only, uplink_id, uplink_port, inputs, outputs, bucket, networked, kind, pair_id, txtype, capsule, freq, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.name, d.aliases, d.category, d.make, d.model, d.location, d.ip, d.mac, d.photo, d.manual_url, d.notes, d.tech_only, d.uplink_id, d.uplink_port, d.inputs, d.outputs, d.bucket, d.networked, d.kind, d.pair_id, d.txtype, d.capsule, d.freq, user.id, user.id, now, now);
    audit(user, 'device.create', d.name, '');
    return Number(r.lastInsertRowid);
  }

  function edit(id, data, user, upload) {
    const cur = db.prepare('SELECT * FROM devices WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Device not found', 404);
    const d = check(data, upload);
    clash(d.name, d.aliases, cur.id);
    loopCheck(cur.id, d.uplink_id);
    if (data.bucket === undefined) d.bucket = cur.bucket || '';
    if (data.kind === undefined) { d.kind = cur.kind || ''; d.pair_id = cur.pair_id || null; d.txtype = cur.txtype || ''; d.capsule = cur.capsule || ''; d.freq = cur.freq || ''; }
    if (d.photo !== cur.photo) db.prepare("UPDATE devices SET marks = '[]' WHERE id = ?").run(cur.id);   // boxes belong to the old picture
    db.prepare(`UPDATE devices SET name = ?, aliases = ?, category = ?, make = ?, model = ?, location = ?, ip = ?, mac = ?, photo = ?, manual_url = ?, notes = ?, tech_only = ?, uplink_id = ?, uplink_port = ?, inputs = ?, outputs = ?, bucket = ?, networked = ?, kind = ?, pair_id = ?, txtype = ?, capsule = ?, freq = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .run(d.name, d.aliases, d.category, d.make, d.model, d.location, d.ip, d.mac, d.photo, d.manual_url, d.notes, d.tech_only, d.uplink_id, d.uplink_port, d.inputs, d.outputs, d.bucket, d.networked, d.kind, d.pair_id === cur.id ? null : d.pair_id, d.txtype, d.capsule, d.freq, user.id, Date.now(), cur.id);
    audit(user, 'device.edit', d.name, '');
  }

  /** Buckets: the admin's list (names in order). Renaming moves the gear; a bucket that goes away sends its gear back to automatic. */
  function setBuckets(list, renames, user, setSetting) {
    const names = [...new Set((Array.isArray(list) ? list : []).map((x) => str(x, 40)).filter(Boolean))].slice(0, 40);
    for (const [from, to] of Object.entries(renames || {})) if (str(from, 40) && str(to, 40)) db.prepare('UPDATE devices SET bucket = ? WHERE bucket = ?').run(str(to, 40), str(from, 40));
    const keep = new Set(names);
    db.prepare('SELECT DISTINCT bucket FROM devices WHERE bucket != \'\'').all().forEach((r) => { if (!keep.has(r.bucket)) db.prepare('UPDATE devices SET bucket = \'\' WHERE bucket = ?').run(r.bucket); });
    setSetting('gear_buckets', JSON.stringify(names));
    audit(user, 'gear.buckets', names.join(', '), '');
    return names;
  }

  /*
   * The model list: makes and models the team has added (a console with its inputs, outputs and link…).
   * It starts empty and grows as gear is added; the stage patch and the guided setup offer it next time.
   */
  const KINDS = ['console', 'stagebox', 'receiver', 'txmic', 'capsule', 'mic', 'di', 'source', 'iemtx', 'bodypack', 'headamp', 'processor', 'amp', 'speaker', 'wedge', 'network', 'computer', 'other'];
  const modelKey = (m) => (m.kind + '|' + m.make + '|' + m.model).toLowerCase();
  function cleanModel(m) {
    if (!m || !KINDS.includes(m.kind)) return null;
    const model = str(m.model, 80);
    if (!model) return null;
    const n = (v, max) => { const x = Number(v); return Number.isInteger(x) && x >= 0 && x <= max ? x : undefined; };
    const out = { kind: m.kind, make: str(m.make, 60), model };
    const nin = n(m.nin, 128), nout = n(m.nout, 128);
    if (nin != null) out.nin = nin; if (nout != null) out.nout = nout;
    if (str(m.link, 30)) out.link = str(m.link, 30);
    if (m.mode === 'Mono' || m.mode === 'Stereo') out.mode = m.mode;
    if (str(m.capsule, 60)) out.capsule = str(m.capsule, 60);
    const nl = n(m.namelen, 64); if (nl) out.namelen = nl;
    if (Array.isArray(m.colors)) { const c = m.colors.map((x) => str(x, 24)).filter(Boolean).slice(0, 32); if (c.length) out.colors = c; }
    return out;
  }
  function models(getSetting) {
    try { return (JSON.parse(getSetting('gear_models', '[]')) || []).map(cleanModel).filter(Boolean); } catch (e) { return []; }
  }
  /** Add or update models (same type, make and model replaces the old one); remove: keys to drop. */
  function saveModels(add, remove, user, getSetting, setSetting) {
    const list = models(getSetting);
    const byKey = new Map(list.map((m) => [modelKey(m), m]));
    const drop = new Set((Array.isArray(remove) ? remove : []).map((k) => String(k).toLowerCase()));
    drop.forEach((k) => byKey.delete(k));
    const added = [];
    for (const m0 of Array.isArray(add) ? add.slice(0, 200) : []) { const m = cleanModel(m0); if (m) { if (!byKey.has(modelKey(m))) added.push(m.make + ' ' + m.model); byKey.set(modelKey(m), m); } }
    const out = [...byKey.values()].slice(0, 2000);
    setSetting('gear_models', JSON.stringify(out));
    if (added.length || drop.size) audit(user, 'gear.models', [added.length ? 'added ' + added.join(', ') : '', drop.size ? 'removed ' + drop.size : ''].filter(Boolean).join('; '), '');
    return out;
  }

  function remove(id, user) {
    const cur = db.prepare('SELECT name FROM devices WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Device not found', 404);
    db.prepare('UPDATE devices SET pair_id = NULL WHERE pair_id = ?').run(Number(id));
    db.prepare('DELETE FROM devices WHERE id = ?').run(Number(id));
    audit(user, 'device.delete', cur.name, '');
  }

  /** Device names in IP lists that have no card yet (for "Create cards from IP lists"). */
  function suggestions(user) {
    const known = DevMatch.build(list(user).concat(db.prepare('SELECT id, name, aliases FROM devices').all().map((r) => ({ id: r.id, name: r.name, aliases: JSON.parse(r.aliases) }))));
    const seen = new Map();
    for (const p of visiblePages(user)) {
      for (const b of JSON.parse(p.blocks)) {
        if (b.type !== 'iplist') continue;
        for (const r of b.rows || []) {
          const name = str(r.device, 60);
          if (!name || name.length < 2) continue;
          const hit = known.find(name)[0];
          if (hit && hit.index === 0 && hit.length === name.length) continue;
          if (seen.has(name.toLowerCase())) continue;
          seen.set(name.toLowerCase(), { name, ip: validIp(r.ip) ? r.ip : '', mac: str(r.mac, 40), location: str(r.location, 80), from: (b.net && b.net.name) || b.title || p.title, tech_only: !!p.tech_only });
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Create cards for the chosen names. IPs stay in the IP list (they link through it). */
  function importFromLists(names, user) {
    const want = new Set((names || []).map((n) => String(n).toLowerCase()));
    let made = 0;
    for (const s of suggestions(user)) {
      if (!want.has(s.name.toLowerCase())) continue;
      try {
        add({ name: s.name, location: s.location, mac: s.mac, category: 'network', tech_only: s.tech_only }, user, () => true);
        made++;
      } catch (e) { /* a clash: skip it */ }
    }
    return made;
  }

  function search(q, user) {
    const words = String(q || '').toLowerCase().match(/[\p{L}\p{N}.:-]+/gu) || [];
    if (!words.length) return [];
    return list(user).filter((d) => {
      const hay = [d.name, ...d.aliases, d.make, d.model, d.location, ...d.ips, d.mac, d.notes].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    }).slice(0, 12).map((d) => ({ id: d.id, name: d.name, make: d.make, model: d.model, location: d.location, ips: d.ips, photo: d.photo, category: d.category }));
  }

  return { list, get, usedOn, add, edit, remove, setMarks, setBuckets, models, saveModels, modelKey, suggestions, importFromLists, search, CATEGORIES };
}

module.exports = { create, CATEGORIES, GEAR_KINDS, PAIRS };
