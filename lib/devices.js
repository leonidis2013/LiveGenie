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
const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const validIp = (s) => { const m = IP_RE.exec(s); return !!m && m.slice(1).every((n) => Number(n) <= 255); };
const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function create(db, deps) {
  const { UserError, audit } = deps;
  const seeTech = (user) => Auth.atLeast(user, 'editor');

  const toObj = (r) => r && ({
    id: r.id, name: r.name, aliases: JSON.parse(r.aliases), category: r.category, make: r.make, model: r.model,
    location: r.location, ip: r.ip, mac: r.mac, photo: r.photo, manual_url: r.manual_url, notes: r.notes,
    tech_only: !!r.tech_only, inputs: r.inputs || 0, outputs: r.outputs || 0, uplink_id: r.uplink_id || null, uplink_port: r.uplink_port || '', created_at: r.created_at, updated_at: r.updated_at
  });

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
    return {
      inputs: count(data.inputs), outputs: count(data.outputs),
      uplink_id: uplink, uplink_port: str(data.uplink_port, 30),
      name, aliases: JSON.stringify(aliases), category, make: str(data.make, 60), model: str(data.model, 80), location: str(data.location, 80),
      ip, mac: str(data.mac, 40), photo, manual_url: manual, notes: String(data.notes || '').replace(/\r\n?/g, '\n').slice(0, 20000), tech_only: data.tech_only ? 1 : 0
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
    const r = db.prepare(`INSERT INTO devices (name, aliases, category, make, model, location, ip, mac, photo, manual_url, notes, tech_only, uplink_id, uplink_port, inputs, outputs, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.name, d.aliases, d.category, d.make, d.model, d.location, d.ip, d.mac, d.photo, d.manual_url, d.notes, d.tech_only, d.uplink_id, d.uplink_port, d.inputs, d.outputs, user.id, user.id, now, now);
    audit(user, 'device.create', d.name, '');
    return Number(r.lastInsertRowid);
  }

  function edit(id, data, user, upload) {
    const cur = db.prepare('SELECT * FROM devices WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Device not found', 404);
    const d = check(data, upload);
    clash(d.name, d.aliases, cur.id);
    loopCheck(cur.id, d.uplink_id);
    db.prepare(`UPDATE devices SET name = ?, aliases = ?, category = ?, make = ?, model = ?, location = ?, ip = ?, mac = ?, photo = ?, manual_url = ?, notes = ?, tech_only = ?, uplink_id = ?, uplink_port = ?, inputs = ?, outputs = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .run(d.name, d.aliases, d.category, d.make, d.model, d.location, d.ip, d.mac, d.photo, d.manual_url, d.notes, d.tech_only, d.uplink_id, d.uplink_port, d.inputs, d.outputs, user.id, Date.now(), cur.id);
    audit(user, 'device.edit', d.name, '');
  }

  function remove(id, user) {
    const cur = db.prepare('SELECT name FROM devices WHERE id = ?').get(Number(id));
    if (!cur) throw new UserError('Device not found', 404);
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

  return { list, get, usedOn, add, edit, remove, suggestions, importFromLists, search, CATEGORIES };
}

module.exports = { create, CATEGORIES };
