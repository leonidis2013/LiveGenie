/*
 * VLANs and the system map.
 *
 * VLAN registry: one record per VLAN (ID, name, subnet, gateway, colour, purpose,
 * DHCP range). Devices belong to a VLAN when one of their IPs is inside its subnet.
 *
 * The map is built from what is already in LiveGenie, so it never needs redrawing by hand:
 *   network links  device cards' "Plugged into" (switch, port)
 *   signal links   patch lists and cable runs: neighbouring cells along the wire
 *                  trace that name devices become an arrow from one to the next
 * Editors can drag boxes; positions are saved per view.
 */
'use strict';

const DevMatch = require('../public/devmatch');

const COLORS = ['#4c8dff', '#2ec4b6', '#f2c94c', '#ef7b4c', '#b07cff', '#3ecf6e', '#ff6fa8', '#8a96a5'];
const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function ipInt(s) {
  const m = IP_RE.exec(String(s || '').trim());
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.some((n) => n > 255) ? null : ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}
const intIp = (n) => [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');
function subnet(cidr) {
  const m = /^([\d.]+)\/(\d+)$/.exec(String(cidr || '').trim());
  if (!m) return null;
  const base = ipInt(m[1]), prefix = Number(m[2]);
  if (base === null || prefix < 8 || prefix > 30) return null;
  const size = 2 ** (32 - prefix);
  const net = Math.floor(base / size) * size;
  return { net, bcast: net + size - 1, first: net + 1, last: net + size - 2, prefix, text: intIp(net) + '/' + prefix };
}
const inNet = (sn, ip) => { const n = ipInt(ip); return !!sn && n !== null && n >= sn.net && n <= sn.bcast; };
const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function create(db, deps) {
  const { UserError, audit, devices, getSetting, setSetting } = deps;

  const toVlan = (r) => ({ id: r.id, vid: r.vid, name: r.name, cidr: r.cidr, gateway: r.gateway, color: r.color, purpose: r.purpose, dhcp_start: r.dhcp_start, dhcp_end: r.dhcp_end, notes: r.notes, updated_at: r.updated_at });
  const vlans = () => db.prepare('SELECT * FROM vlans ORDER BY vid').all().map(toVlan);

  function checkVlan(data, exceptId) {
    const vid = Number(data.vid);
    if (!Number.isInteger(vid) || vid < 1 || vid > 4094) throw new UserError('The VLAN ID must be a number from 1 to 4094');
    const name = str(data.name, 60);
    if (!name) throw new UserError('Give the VLAN a name, like AVL or Guest');
    let cidr = str(data.cidr, 20).replace(/\s+/g, '');
    const sn = cidr ? subnet(cidr) : null;
    if (cidr && !sn) throw new UserError('Enter the subnet like 10.10.20.0/24');
    if (sn) cidr = sn.text;
    const gateway = str(data.gateway, 20);
    if (gateway && (ipInt(gateway) === null || (sn && !inNet(sn, gateway)))) throw new UserError(sn ? 'The gateway must be inside ' + sn.text : 'The gateway must be an IP address');
    const dhcp_start = str(data.dhcp_start, 20), dhcp_end = str(data.dhcp_end, 20);
    for (const ip of [dhcp_start, dhcp_end]) if (ip && (ipInt(ip) === null || (sn && !inNet(sn, ip)))) throw new UserError('The DHCP range must be inside ' + (sn ? sn.text : 'the subnet'));
    if (dhcp_start && dhcp_end && ipInt(dhcp_start) > ipInt(dhcp_end)) throw new UserError('The DHCP range runs backwards');
    for (const o of vlans()) {
      if (o.id === exceptId) continue;
      if (o.vid === vid) throw new UserError('VLAN ' + vid + ' already exists (' + o.name + ')');
      const osn = subnet(o.cidr);
      if (sn && osn && sn.net <= osn.bcast && osn.net <= sn.bcast) throw new UserError('That subnet overlaps VLAN ' + o.vid + ' (' + o.name + ', ' + o.cidr + ')');
    }
    const used = new Set(vlans().filter((o) => o.id !== exceptId).map((o) => o.color));
    const color = /^#[0-9a-f]{6}$/i.test(String(data.color || '')) ? data.color : (COLORS.find((c) => !used.has(c)) || COLORS[used.size % COLORS.length]);
    return { vid, name, cidr, gateway, color, purpose: str(data.purpose, 200), dhcp_start, dhcp_end, notes: String(data.notes || '').slice(0, 5000) };
  }

  function addVlan(data, user) {
    const v = checkVlan(data, 0);
    const r = db.prepare('INSERT INTO vlans (vid, name, cidr, gateway, color, purpose, dhcp_start, dhcp_end, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(v.vid, v.name, v.cidr, v.gateway, v.color, v.purpose, v.dhcp_start, v.dhcp_end, v.notes, Date.now());
    audit(user, 'vlan.create', 'VLAN ' + v.vid, v.name);
    return Number(r.lastInsertRowid);
  }
  function editVlan(id, data, user) {
    if (!db.prepare('SELECT 1 FROM vlans WHERE id = ?').get(Number(id))) throw new UserError('VLAN not found', 404);
    const v = checkVlan(data, Number(id));
    db.prepare('UPDATE vlans SET vid = ?, name = ?, cidr = ?, gateway = ?, color = ?, purpose = ?, dhcp_start = ?, dhcp_end = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(v.vid, v.name, v.cidr, v.gateway, v.color, v.purpose, v.dhcp_start, v.dhcp_end, v.notes, Date.now(), Number(id));
    audit(user, 'vlan.edit', 'VLAN ' + v.vid, v.name);
  }
  function removeVlan(id, user) {
    const r = db.prepare('SELECT vid, name FROM vlans WHERE id = ?').get(Number(id));
    if (!r) throw new UserError('VLAN not found', 404);
    db.prepare('DELETE FROM vlans WHERE id = ?').run(Number(id));
    audit(user, 'vlan.delete', 'VLAN ' + r.vid, r.name);
  }

  function pagesFor(user) {
    return db.prepare('SELECT id, title, blocks FROM pages WHERE deleted_at IS NULL' + (user && ['editor', 'admin'].includes(user.role) ? '' : ' AND tech_only = 0')).all();
  }

  /** Networks typed into IP lists that are not in the registry yet. */
  function vlanSuggestions(user) {
    const have = vlans();
    const out = new Map();
    for (const p of pagesFor(user)) {
      for (const b of JSON.parse(p.blocks)) {
        if (b.type !== 'iplist' || !b.net) continue;
        const vid = Number(b.net.vlan);
        const sn = subnet(b.net.cidr);
        if (!Number.isInteger(vid) || vid < 1 || vid > 4094) continue;
        if (have.some((v) => v.vid === vid || (sn && subnet(v.cidr) && subnet(v.cidr).net === sn.net))) continue;
        if (!out.has(vid)) out.set(vid, { vid, name: b.net.name || b.title || 'VLAN ' + vid, cidr: sn ? sn.text : '', gateway: b.net.gateway || '', from: p.title });
      }
    }
    return [...out.values()].sort((a, b) => a.vid - b.vid);
  }
  function importVlans(vids, user) {
    const want = new Set((vids || []).map(Number));
    let made = 0;
    for (const s of vlanSuggestions(user)) {
      if (!want.has(s.vid)) continue;
      try { addVlan(s, user); made++; } catch (e) { /* overlap: skip */ }
    }
    return made;
  }

  /** Per-VLAN usage: devices in it and addresses listed in IP lists. */
  function vlanDetails(user) {
    const all = vlans();
    const devs = devices.list(user);
    const listed = new Map(all.map((v) => [v.id, new Set()]));
    for (const p of pagesFor(user)) {
      for (const b of JSON.parse(p.blocks)) {
        if (b.type !== 'iplist') continue;
        for (const r of b.rows || []) for (const v of all) if (inNet(subnet(v.cidr), r.ip)) listed.get(v.id).add(ipInt(r.ip));
      }
    }
    return all.map((v) => {
      const sn = subnet(v.cidr);
      const inside = devs.filter((d) => d.ips.some((ip) => inNet(sn, ip)));
      inside.forEach((d) => d.ips.forEach((ip) => { if (inNet(sn, ip)) listed.get(v.id).add(ipInt(ip)); }));
      if (sn && v.gateway) listed.get(v.id).add(ipInt(v.gateway));
      const hosts = sn ? sn.last - sn.first + 1 : 0;
      const dhcp = v.dhcp_start && v.dhcp_end ? ipInt(v.dhcp_end) - ipInt(v.dhcp_start) + 1 : 0;
      return { ...v, hosts, used: listed.get(v.id).size, dhcp, devices: inside.map((d) => ({ id: d.id, name: d.name, ips: d.ips.filter((ip) => inNet(sn, ip)) })) };
    });
  }

  /** Everything the map draws. Network details (VLANs, IPs, network links) only for editors. */
  function map(user) {
    const tech = !!user && ['editor', 'admin'].includes(user.role);
    const all = tech ? vlans() : [];
    const devs = devices.list(user);
    const nodes = devs.map((d) => ({
      id: d.id, name: d.name, category: d.category, make: d.make, model: d.model, location: d.location, photo: d.photo,
      ips: tech ? d.ips : [],
      vlans: tech ? all.filter((v) => d.ips.some((ip) => inNet(subnet(v.cidr), ip))).map((v) => v.vid) : [],
      uplink_id: tech && devs.some((x) => x.id === d.uplink_id) ? d.uplink_id : null, uplink_port: tech ? d.uplink_port : ''
    }));
    const netLinks = nodes.filter((n) => n.uplink_id).map((n) => ({ from: n.uplink_id, to: n.id, port: n.uplink_port }));

    const dm = DevMatch.build(devs.map((d) => ({ id: d.id, name: d.name, aliases: d.aliases })));
    const sig = new Map();
    for (const p of pagesFor(user)) {
      for (const b of JSON.parse(p.blocks)) {
        if (b.type !== 'patch') continue;
        const cols = (b.trace && b.trace.length >= 2 ? b.trace : b.columns.map((_, i) => i)).filter((i) => i < b.columns.length);
        const label = b.title || ({ input: 'Input patch', output: 'Output patch', cable: 'Cable runs' }[b.preset] || 'Patch list');
        for (const r of b.rows || []) {
          const chain = [];
          for (const ci of cols) {
            const hit = dm.find(r[ci] || '')[0];
            if (hit && chain[chain.length - 1] !== hit.id) chain.push(hit.id);
          }
          for (let i = 1; i < chain.length; i++) {
            const key = chain[i - 1] + '>' + chain[i];
            if (!sig.has(key)) sig.set(key, { from: chain[i - 1], to: chain[i], count: 0, rows: [], pages: new Map() });
            const e = sig.get(key);
            e.count++;
            if (e.rows.length < 8) e.rows.push(b.columns.map((c, j) => (r[j] ? r[j] : '')).filter(Boolean).slice(0, 4).join(' · '));
            e.pages.set(p.id, { page_id: p.id, title: p.title, block: b.id, label });
          }
        }
      }
    }
    const sigLinks = [...sig.values()].map((e) => ({ ...e, pages: [...e.pages.values()] }));
    let layouts = {};
    try { layouts = JSON.parse(getSetting('map_layouts', '{}')); } catch (e) { layouts = {}; }
    return { tech, vlans: all, nodes, netLinks, sigLinks, layouts };
  }

  function saveLayout(view, positions, user) {
    if (!['network', 'signal'].includes(view)) throw new UserError('Unknown map view');
    let layouts = {};
    try { layouts = JSON.parse(getSetting('map_layouts', '{}')); } catch (e) { layouts = {}; }
    const clean = {};
    if (positions && typeof positions === 'object') {
      for (const [k, v] of Object.entries(positions)) {
        if (/^\d+$/.test(k) && Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n) && Math.abs(n) < 100000)) clean[k] = [Math.round(v[0]), Math.round(v[1])];
      }
    }
    if (Object.keys(clean).length) layouts[view] = clean; else delete layouts[view];
    setSetting('map_layouts', JSON.stringify(layouts));
    audit(user, 'map.layout', view, Object.keys(clean).length ? 'saved' : 'reset to automatic');
  }

  return { vlans, vlanDetails, addVlan, editVlan, removeVlan, vlanSuggestions, importVlans, map, saveLayout, COLORS };
}

module.exports = { create, COLORS, subnet, inNet };
