/*
 * A page is a list of blocks. This file checks blocks coming from the browser
 * and turns them into plain text for search.
 *
 *   text       { type, md }                                  formatted text (stored as Markdown)
 *   callout    { type, kind, md }                            kind: tip | warning | critical (Sunday-critical)
 *   checklist  { type, id, title, items: [string], schedule } shared ticks; schedule = auto reset times (lib/schedule.js)
 *   patch      { type, id, title, preset, columns: [string], rows: [[string]], trace: [column index] }
 *              patch lists and cable runs; trace = the columns the wire trace drawing follows, in order;
 *              ok = names used twice that someone marked as intended ("colIndex:value");
 *              roles = how each trace column draws: box (default, each name should come from one place),
 *              shared (gear many signals pass through: stage box, console), label (a port or link on the line);
 *              assign = the columns you fill in per input/output (a row with them all empty is a spare)
 *   iplist     { type, id, title, net: { name, vlan, cidr, gateway }, rows: [{ ip, device, mac, location, notes }] }
 *   image      { type, upload, caption }                     a picture uploaded to LiveGenie
 *   divider    { type }
 */
'use strict';

const crypto = require('crypto');
const Schedule = require('./schedule');

const TYPES = ['text', 'callout', 'checklist', 'patch', 'patchview', 'iplist', 'image', 'divider'];
const REPORTS = ['inputs', 'outputs', 'wireless', 'iem', 'cables'];
const CALLOUTS = ['tip', 'warning', 'critical'];
const PRESETS = {
  input: { title: 'Input patch', columns: ['Ch', 'Source', 'Mic / DI', 'Stand', 'Stage box', 'Notes'], trace: [1, 2, 4, 0] },
  snake: { title: 'Snake inputs', columns: ['Input', 'Source', 'Mic / DI', 'Stage box', 'Box input', 'Link', 'Console', 'Notes'], trace: [1, 2, 4, 3, 5, 6, 0], roles: { 3: 'shared', 4: 'label', 5: 'label', 6: 'shared' }, assign: [1, 2] },
  snakeout: { title: 'Snake outputs', columns: ['Mix', 'Console', 'Link', 'Stage box', 'Box output', 'Destination', 'Notes'], trace: [0, 1, 2, 3, 4, 5], roles: { 1: 'shared', 2: 'label', 3: 'shared', 4: 'label' }, assign: [0, 5] },
  wireless: { title: 'Wireless mics', columns: ['Input', 'Person / use', 'Capsule', 'Transmitter', 'Frequency', 'Receiver', 'Rx ch', 'Stage box', 'Box input', 'Console', 'Notes'], trace: [1, 2, 3, 4, 6, 5, 8, 7, 9, 0], roles: { 2: 'label', 4: 'rf', 5: 'shared', 6: 'label', 7: 'shared', 8: 'label', 9: 'shared' }, assign: [1, 2, 3] },
  iem: { title: 'In-ears', columns: ['Mix', 'Console', 'Console out', 'Stage box', 'Box output', 'Transmitter', 'Mode', 'Frequency', 'Bodypack', 'Earphones', 'Person', 'Notes'], trace: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], roles: { 1: 'shared', 2: 'label', 3: 'shared', 4: 'label', 6: 'label', 7: 'rf', 9: 'label' }, assign: [0, 10] },
  output: { title: 'Output patch', columns: ['Out', 'Destination', 'Type', 'Notes'], trace: [0, 1] },
  cable: { title: 'Cable runs', columns: ['Label', 'From', 'To', 'Type', 'Length', 'Route'], trace: [1, 0, 2] },
  custom: { title: 'Patch list', columns: ['Column 1', 'Column 2', 'Column 3'], trace: [0, 1, 2] }
};
const MAX_BLOCKS = 300;
const MAX_TEXT = 50000;
const MAX_COLS = 12;
const MAX_ROWS = 500;
const MAX_IPS = 1024;
const IP_FIELDS = ['ip', 'device', 'mac', 'location', 'notes'];
const ipKey = (ip) => { const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip); return m ? m.slice(1).reduce((a, n) => a * 256 + Number(n), 0) : Infinity; };

const str = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').slice(0, max);
const cell = (v) => str(v, 300).replace(/\s*\n\s*/g, ' ').trim();
const newId = () => crypto.randomBytes(4).toString('hex');
const ID_RE = /^[a-f0-9]{8}$/;

/** Returns { blocks } or { error }. Unknown fields are dropped. */
function clean(input) {
  if (!Array.isArray(input)) return { error: 'Blocks must be a list' };
  if (input.length > MAX_BLOCKS) return { error: 'A page can hold at most ' + MAX_BLOCKS + ' blocks' };
  const out = [];
  const seen = new Set();
  const idFor = (v) => {
    let id = ID_RE.test(String(v || '')) ? String(v) : newId();
    while (seen.has(id)) id = newId();
    seen.add(id);
    return id;
  };
  for (const b of input) {
    if (!b || typeof b !== 'object' || !TYPES.includes(b.type)) return { error: 'Unknown block type: ' + (b && b.type) };
    switch (b.type) {
      case 'text': out.push({ type: 'text', md: str(b.md, MAX_TEXT) }); break;
      case 'callout': out.push({ type: 'callout', kind: CALLOUTS.includes(b.kind) ? b.kind : 'tip', md: str(b.md, MAX_TEXT) }); break;
      case 'checklist': {
        const items = [];
        for (const t of Array.isArray(b.items) ? b.items : []) {
          const s = str(t, 500).trim();
          if (s && !items.includes(s)) items.push(s);
        }
        const sc = Schedule.clean(b.schedule);
        if (sc.error) return { error: sc.error };
        out.push({ type: 'checklist', id: idFor(b.id), title: str(b.title, 200).trim(), items: items.slice(0, 200), schedule: sc.schedule });
        break;
      }
      case 'patch': {
        const preset = PRESETS[b.preset] ? b.preset : 'custom';
        let columns = (Array.isArray(b.columns) ? b.columns : PRESETS[preset].columns).slice(0, MAX_COLS).map((c) => str(c, 60).replace(/\s+/g, ' ').trim());
        if (!columns.length) columns = PRESETS[preset].columns.slice();
        if (Array.isArray(b.rows) && b.rows.length > MAX_ROWS) return { error: 'A patch list can hold at most ' + MAX_ROWS + ' rows' };
        const rows = (Array.isArray(b.rows) ? b.rows : [])
          .map((r) => columns.map((_, i) => cell(Array.isArray(r) ? r[i] : '')))
          .filter((r) => r.some(Boolean));
        let trace = [];
        for (const i of Array.isArray(b.trace) ? b.trace : (PRESETS[preset].trace || [])) {
          const n = Number(i);
          if (Number.isInteger(n) && n >= 0 && n < columns.length && !trace.includes(n)) trace.push(n);
        }
        if (!Array.isArray(b.trace) && !trace.length) trace = columns.map((_, i) => i);
        // clashes someone marked as intended: "column index:lower-case value"
        const ok = [...new Set((Array.isArray(b.ok) ? b.ok : []).map((x) => String(x || '').slice(0, 320))
          .filter((x) => { const m = /^(\d+):(.+)$/.exec(x); return m && Number(m[1]) < columns.length; }))].slice(0, 200);
        const roles = {};
        const src = b.roles && typeof b.roles === 'object' ? b.roles : (Array.isArray(b.trace) ? {} : (PRESETS[preset].roles || {}));
        for (const [k, v] of Object.entries(src)) {
          const n = Number(k);
          if (Number.isInteger(n) && n < columns.length && ['shared', 'label', 'rf'].includes(v)) roles[n] = v;
        }
        const assign = [...new Set((Array.isArray(b.assign) ? b.assign : (PRESETS[preset].assign || [])).map(Number))]
          .filter((n) => Number.isInteger(n) && n >= 0 && n < columns.length);
        out.push({ type: 'patch', id: idFor(b.id), title: str(b.title, 200).trim(), preset, columns, rows, trace, ok, roles, assign });
        break;
      }
      case 'iplist': {
        const n = b.net && typeof b.net === 'object' ? b.net : {};
        const cidr = cell(n.cidr).replace(/\s+/g, '');
        if (cidr && !/^(\d{1,3}\.){3}\d{1,3}\/([8-9]|[12]\d|30)$/.test(cidr)) return { error: 'Enter the subnet like 10.10.20.0/24' };
        if (Array.isArray(b.rows) && b.rows.length > MAX_IPS) return { error: 'An IP list can hold at most ' + MAX_IPS + ' addresses' };
        const rows = (Array.isArray(b.rows) ? b.rows : [])
          .map((r) => { const o = {}; IP_FIELDS.forEach((f) => { o[f] = cell(r && r[f]); }); return o; })
          .filter((r) => IP_FIELDS.some((f) => r[f]))
          .sort((x, y) => ipKey(x.ip) - ipKey(y.ip));
        out.push({ type: 'iplist', id: idFor(b.id), title: str(b.title, 200).trim(),
          net: { name: cell(n.name).slice(0, 80), vlan: cell(n.vlan).slice(0, 20), cidr, gateway: cell(n.gateway).slice(0, 40) }, rows });
        break;
      }
      case 'image':
        if (!/^[a-f0-9]{24}$/.test(String(b.upload || ''))) return { error: 'A picture block is missing its picture' };
        out.push({ type: 'image', upload: b.upload, caption: str(b.caption, 500).trim() });
        break;
      case 'divider': out.push({ type: 'divider' }); break;
      // a live list from the stage patch (the drawing is the source; this only says which list to show)
      case 'patchview': out.push({ type: 'patchview', id: idFor(b.id), title: str(b.title, 200).trim(), report: REPORTS.includes(b.report) ? b.report : 'inputs', filter: str(b.filter, 80).trim() }); break;
    }
  }
  return { blocks: out };
}

/** Markdown to plain words for the search index. */
function strip(md) {
  return String(md || '')
    .replace(/\\([\\`*_[\]|#+\-.>()!])/g, ' $1 ')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ' '))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Markdown to plain lines (one per paragraph line, table row or list item). */
function plainLines(md) {
  return String(md || '').split('\n').map((l) => {
    if (/^\s*\|?\s*:?-{2,}/.test(l) && /^[\s|:-]+$/.test(l)) return '';            // table separator row
    return l
      .replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*\|/, '').replace(/\|\s*$/, '').replace(/\s*(?<!\\)\|\s*/g, ' · ')
      .replace(/\*\*|`|(^|\W)_|_(?=\W|$)/g, '$1')
      .replace(/\\([\\`*_[\]|#+\-.>()!~])/g, '$1')
      .replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}

function plainText(blocks) {
  const parts = [];
  for (const b of blocks || []) {
    if (b.type === 'text' || b.type === 'callout') parts.push(strip(b.md));
    else if (b.type === 'checklist') parts.push(b.title, ...b.items);
    else if (b.type === 'patch') parts.push(b.title, b.columns.join(' '), ...b.rows.map((r) => r.join(' ')));
    else if (b.type === 'iplist') parts.push(b.title, b.net.name, b.net.vlan ? 'VLAN ' + b.net.vlan : '', b.net.cidr, b.net.gateway, ...b.rows.map((r) => IP_FIELDS.map((f) => r[f]).join(' ')));
    else if (b.type === 'image') parts.push(b.caption);
    else if (b.type === 'patchview') parts.push(b.title, b.filter);
  }
  return parts.filter(Boolean).join('\n');
}

/** Upload ids a page uses (so backups and clean-up know what is still needed). */
function uploadsIn(blocks) {
  return (blocks || []).filter((b) => b.type === 'image').map((b) => b.upload);
}

/** Give old checklist blocks (saved before 0.2.0) an id and an empty schedule. */
function upgrade(blocks) {
  let changed = false;
  const seen = new Set();
  for (const b of blocks || []) {
    if (!['checklist', 'patch', 'iplist'].includes(b.type)) continue;
    if (!ID_RE.test(String(b.id || '')) || seen.has(b.id)) { b.id = newId(); changed = true; }
    seen.add(b.id);
    if (b.type === 'checklist' && !Array.isArray(b.schedule)) { b.schedule = []; changed = true; }
  }
  return changed;
}

module.exports = { clean, plainText, plainLines, uploadsIn, upgrade, TYPES, CALLOUTS, PRESETS };
