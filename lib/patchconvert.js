/*
 * One time, on the first start of 0.13.0: the table-style patch lists on pages become gear and cables
 * on the stage patch drawing, and each list on its page becomes a live "Patch list" that shows the
 * matching list from the drawing. The page keeps its old version in History. Custom lists (not
 * patching) become a plain table in a text block.
 */
'use strict';

const PatchCore = require('../public/patchcore');

const KEY = 'patch_converted_v1';
const BY = { id: null, name: 'LiveGenie', role: 'admin' };

const val = (r, i) => (i >= 0 ? String(r[i] == null ? '' : r[i]).trim() : '');
const num = (v) => { const m = /\d+/.exec(String(v || '')); return m ? Number(m[0]) : 0; };
const colIx = (b, name) => b.columns.findIndex((c) => String(c).trim().toLowerCase() === name.toLowerCase());

/** What kind of gear a name most likely is. */
function guessKind(name) {
  const n = String(name || '').toLowerCase();
  if (/\b(sq-?\d|x32|m32|tf\d|dm7|console|desk|mixer)\b/.test(n)) return 'console';
  if (/\b(ar\d{2,4}|ab168|dx168|s16|s32|dl\d{2}|rio|tio|stage ?box|snake)\b/.test(n)) return 'stagebox';
  if (/\b(psm|ptm|p[39]t|iem tx|in-?ear tx|iem transmitter)\b/.test(n)) return 'iemtx';
  if (/\b(pack|p[39]r|bodypack)\b/.test(n)) return 'bodypack';
  if (/\b(slx-?d4|ulx-?d4|qlxd4|ad4|em \d|receiver)\b/.test(n)) return 'receiver';
  if (/\b(pa2|driverack|venu|processor|dsp)\b/.test(n)) return 'processor';
  if (/\b(amp|crown|xli|xls|powersoft|qsc pl)\b/.test(n)) return 'amp';
  if (/\b(wedge|monitor)\b/.test(n)) return 'wedge';
  if (/\b(sub|speaker|main|top|cbt|dxs|fill|delay|lobby)\b/.test(n)) return 'speaker';
  if (/\bdi\b/.test(n)) return 'di';
  return 'other';
}

function run({ db, store, patch, devices: devicesApi }) {
  if (store.getSetting(KEY)) return null;
  const devices = db.prepare('SELECT id, name, inputs, outputs, make, model FROM devices').all();
  const devBy = (name) => devices.find((d) => d.name.toLowerCase() === String(name || '').trim().toLowerCase());
  const doc = patch.get().doc;
  let changed = 0, lists = 0;

  function gear(name, kind, extra) {
    name = String(name || '').trim();
    if (!name) return null;
    const ex = PatchCore.findGear(doc, name);
    if (ex) return ex;
    const d = devBy(name);
    const item = { kind, name, model: (d && d.model) || name, make: (d && d.make) || '', device_id: d ? d.id : undefined, ...(extra || {}) };
    if (d && d.inputs && !item.nin) item.nin = d.inputs;
    if (d && d.outputs && !item.nout) item.nout = d.outputs;
    if (kind === 'receiver' && d && d.outputs) item.nin = d.outputs;
    return PatchCore.addGear(doc, item);
  }
  /** Make sure a gear has at least n inputs / outputs. */
  function room(g, nin, nout) {
    const k = PatchCore.KINDS[g.kind];
    const wantIn = Math.max(g.ins.length, nin || 0), wantOut = Math.max(g.outs.length, nout || 0);
    if (wantIn === g.ins.length && wantOut === g.outs.length) return;
    if (k.counts === 'both') PatchCore.resize(doc, g, wantIn, wantOut);
    else if (k.counts === 'ch') PatchCore.resize(doc, g, Math.max(wantIn, wantOut), Math.max(wantIn, wantOut));
    else if (k.counts === 'outs') PatchCore.resize(doc, g, g.ins.length, wantOut);
  }
  function link(sb, con, name) {
    if (!sb || !con) return;
    if (doc.cables.some((c) => c.ap === 'link' && ((c.a === sb.id && c.b === con.id) || (c.a === con.id && c.b === sb.id)))) return;
    PatchCore.connect(doc, sb, 'link', con, 'link', { label: name || '' });
  }
  /** A mic, DI or line source for one row (several rows can share a name like "DI": they get #2, #3). */
  function source(micName, use, notes) {
    // the card is named for what it picks up (Kick, Keys L); the mic or DI model goes underneath
    const name = use || micName;
    if (!name) return null;
    const kind = micName ? (/\bdi\b/i.test(micName) ? 'di' : 'mic') : 'source';
    const ex = PatchCore.findGear(doc, name);
    if (ex && !doc.cables.some((c) => c.a === ex.id) && (ex.model || '') === (micName || '')) return ex;
    return PatchCore.addGear(doc, { kind, name: PatchCore.uniqueName(doc, name), model: micName || '', use: use || '', notes: notes || undefined, nout: 1 });
  }
  const into = (g, i) => { room(g, i + 1, 0); return i; };
  const firstConsole = () => doc.gear.find((g) => g.kind === 'console') || gear('Console', 'console');

  function convert(b) {
    const C = (n) => colIx(b, n);
    const rows = (b.rows || []).filter((r) => r.some((v) => String(v || '').trim()));
    const spare = (r) => (b.assign || []).length && (b.assign || []).every((ci) => !val(r, ci));
    if (b.preset === 'snake') {
      let box = null;
      for (const r of rows) {
        const sb = gear(val(r, C('Stage box')), 'stagebox', { nin: 16, nout: 8 }), con = gear(val(r, C('Console')), 'console');
        if (sb) { box = sb; link(sb, con, val(r, C('Link'))); }
        const bi = num(val(r, C('Box input'))), inp = num(val(r, C('Input')));
        if (sb && bi && inp && !sb._startSet) { sb.start = Math.max(1, inp - bi + 1); sb._startSet = true; }
        if (sb && bi) room(sb, bi, 0);          // spare inputs still count: the box keeps all its sockets
        if (spare(r)) continue;
        const src = source(val(r, C('Mic / DI')), val(r, C('Source')), val(r, C('Notes')));
        if (!src) continue;
        if (sb && bi) PatchCore.connect(doc, src, 0, sb, into(sb, bi - 1));
        else if (con && inp) PatchCore.connect(doc, src, 0, con, into(con, inp - 1));
      }
      return { report: 'inputs', filter: box ? box.name : '' };
    }
    if (b.preset === 'snakeout') {
      let box = null;
      for (const r of rows) {
        const sb = gear(val(r, C('Stage box')), 'stagebox', { nin: 16, nout: 8 }), con = gear(val(r, C('Console')), 'console');
        if (sb) { box = sb; link(sb, con, val(r, C('Link'))); }
        const bo = num(val(r, C('Box output')));
        if (!sb || !bo) continue;
        room(sb, 0, bo);
        if (val(r, C('Mix'))) sb.feeds[bo - 1] = val(r, C('Mix'));
        const dest = val(r, C('Destination'));
        if (dest) { const d = gear(dest, guessKind(dest)); if (d && d.ins.length) PatchCore.connect(doc, sb, bo - 1, d, Math.max(0, PatchCore.freeIn(doc, d))); }
      }
      return { report: 'outputs', filter: box ? box.name : '' };
    }
    if (b.preset === 'input') {
      const con = firstConsole();
      for (const r of rows) {
        const ch = num(val(r, C('Ch')));
        const src = source(val(r, C('Mic / DI')), val(r, C('Source')), [val(r, C('Stand')) && 'Stand: ' + val(r, C('Stand')), val(r, C('Notes'))].filter(Boolean).join(' · '));
        if (!src || !ch) continue;
        const c = PatchCore.connect(doc, src, 0, con, into(con, ch - 1));
        if (c && val(r, C('Stage box'))) c.label = val(r, C('Stage box'));
      }
      return { report: 'inputs', filter: '' };
    }
    if (b.preset === 'output') {
      const con = firstConsole();
      for (const r of rows) {
        const out = num(val(r, C('Out'))), dest = val(r, C('Destination'));
        if (!out) continue;
        room(con, 0, out);
        if (!dest) continue;
        const d = gear(dest, guessKind(dest));
        if (!d) continue;
        room(d, 1, 0);
        const c = PatchCore.connect(doc, con, out - 1, d, Math.max(0, PatchCore.freeIn(doc, d)));
        if (c && val(r, C('Type'))) c.label = val(r, C('Type'));
      }
      return { report: 'outputs', filter: con.name };
    }
    if (b.preset === 'cable') {
      const names = new Set();
      for (const r of rows) {
        const from = val(r, C('From')), to = val(r, C('To'));
        if (from) names.add(from); if (to) names.add(to);
        if (!from || !to) continue;
        const a = gear(from, guessKind(from)), z = gear(to, guessKind(to));
        if (!a || !z || a === z) continue;
        if (!a.outs.length) room(a, 0, 1);
        if (!z.ins.length) room(z, 1, 0);
        if (!a.outs.length || !z.ins.length) continue;
        let bi = PatchCore.freeIn(doc, z);
        if (bi < 0) { room(z, z.ins.length + 1, 0); bi = PatchCore.freeIn(doc, z); }
        if (bi < 0) bi = 0;
        let ao = a.outs.findIndex((_, j) => !doc.cables.some((c) => c.a === a.id && c.ap === j));
        if (ao < 0) { room(a, 0, a.outs.length + 1); ao = a.outs.findIndex((_, j) => !doc.cables.some((c) => c.a === a.id && c.ap === j)); }
        if (ao < 0) ao = 0;
        const type = val(r, C('Type')).toLowerCase();
        PatchCore.connect(doc, a, ao, z, bi, { label: val(r, C('Label')), length: val(r, C('Length')), notes: val(r, C('Route')), kind: /speakon|nl4|speaker/.test(type) ? 'speaker' : /cat|dante|ether/.test(type) ? 'dante' : /aes/.test(type) ? 'aes' : undefined });
      }
      return { report: 'cables', filter: [...names].join(', ') };
    }
    if (b.preset === 'wireless') {
      for (const r of rows) {
        if (spare(r)) {
          const rx = gear(val(r, C('Receiver')), 'receiver', { nin: 2 }); if (rx) room(rx, num(val(r, C('Rx ch'))), num(val(r, C('Rx ch'))));
          continue;
        }
        const person = val(r, C('Person / use'));
        const tx = gear(val(r, C('Transmitter')) || (person ? person + ' mic' : ''), 'txmic', { use: person, capsule: val(r, C('Capsule')), freq: val(r, C('Frequency')), group: 'Wireless' });
        const rx = gear(val(r, C('Receiver')), 'receiver', { nin: 2 });
        const ch = num(val(r, C('Rx ch'))) || 1;
        if (!tx) continue;
        if (!rx) continue;
        room(rx, ch, ch);
        PatchCore.connect(doc, tx, 0, rx, ch - 1);
        const sb = gear(val(r, C('Stage box')), 'stagebox', { nin: 16, nout: 8 }), con = gear(val(r, C('Console')), 'console');
        if (sb) link(sb, con, '');
        const bi = num(val(r, C('Box input'))), inp = num(val(r, C('Input')));
        if (sb && bi) PatchCore.connect(doc, rx, ch - 1, sb, into(sb, bi - 1));
        else if (con && inp) PatchCore.connect(doc, rx, ch - 1, con, into(con, inp - 1));
      }
      return { report: 'wireless', filter: '' };
    }
    if (b.preset === 'iem') {
      for (const r of rows) {
        const txName = val(r, C('Transmitter'));
        if (!txName) continue;
        const mode = /mono/i.test(val(r, C('Mode'))) ? 'Mono' : 'Stereo';
        const tx = gear(txName, 'iemtx', { mode, freq: val(r, C('Frequency')) });
        const mix = val(r, C('Mix'));
        const sb = gear(val(r, C('Stage box')), 'stagebox', { nin: 16, nout: 8 }), con = gear(val(r, C('Console')), 'console');
        if (sb && con) link(sb, con, '');
        const src = sb || con;
        const outs = String(sb ? val(r, C('Box output')) : val(r, C('Console out'))).split(/[^\d]+/).map(Number).filter(Boolean);
        if (src && outs.length) {
          outs.forEach((o, k) => {
            room(src, 0, o);
            if (mix) src.feeds[o - 1] = mix;
            if (k < tx.ins.length && !doc.cables.some((c) => c.b === tx.id && c.bp === k)) PatchCore.connect(doc, src, o - 1, tx, k);
          });
        }
        const person = val(r, C('Person'));
        const packName = val(r, C('Bodypack')) || (person ? person + ' pack' : '');
        if (packName) {
          const pk = gear(packName, 'bodypack', { use: person, phones: val(r, C('Earphones')), group: 'IEM packs' });
          if (pk && !doc.cables.some((c) => c.b === pk.id)) PatchCore.connect(doc, tx, 0, pk, 0);
        }
      }
      return { report: 'iem', filter: '' };
    }
    return null;
  }

  const ids = db.prepare('SELECT id FROM pages WHERE deleted_at IS NULL').all().map((r) => r.id);
  for (const id of ids) {
    const page = store.getPage(id, BY);
    if (!page || !page.blocks.some((b) => b.type === 'patch')) continue;
    const blocks = [];
    for (const b of page.blocks) {
      if (b.type !== 'patch') { blocks.push(b); continue; }
      lists++;
      try {
        if (b.preset === 'custom' || !b.preset) {
          const esc = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
          const md = (b.title ? '**' + esc(b.title) + '**\n\n' : '') + '| ' + b.columns.map(esc).join(' | ') + ' |\n|' + b.columns.map(() => ' --- ').join('|') + '|\n' +
            b.rows.filter((r) => r.some((v) => String(v || '').trim())).map((r) => '| ' + b.columns.map((_, i) => esc(r[i])).join(' | ') + ' |').join('\n');
          blocks.push({ type: 'text', md });
          continue;
        }
        const r = convert(b);
        if (r) blocks.push({ type: 'patchview', title: b.title || '', report: r.report, filter: r.filter });
        else blocks.push(b);
      } catch (e) {
        console.error('Could not move a patch list on page ' + id + ':', e.message);
        blocks.push(b);
      }
    }
    try {
      store.updatePage(id, { title: page.title, space: page.space, tech_only: page.tech_only, pinned: page.pinned, blocks }, BY, 'Patch lists moved to the stage patch');
      changed++;
    } catch (e) { console.error('Could not update page ' + id + ':', e.message); }
  }
  doc.gear.forEach((g) => { delete g._startSet; });
  // big gear gets a device card (as when it is added from the catalog), so the map and the device library know it
  if (devicesApi) for (const g of doc.gear) {
    if (g.device_id || !PatchCore.KINDS[g.kind].card) continue;
    const ex = devBy(g.name);
    if (ex) { g.device_id = ex.id; continue; }
    try {
      const d = devicesApi.add({ name: g.name, category: 'audio', make: g.make || '', model: g.model || '', inputs: g.kind === 'receiver' ? 0 : g.ins.length, outputs: g.outs.length, notes: 'Made from the patch lists when they moved to the stage patch.' }, BY);
      g.device_id = d && d.id ? d.id : d;
    } catch (e) { /* a name clash with a nickname: leave it off the library */ }
  }
  if (lists) patch.save(doc, BY, null, 'Made from ' + lists + ' patch list' + (lists === 1 ? '' : 's') + ' on ' + changed + ' page' + (changed === 1 ? '' : 's'));
  store.setSetting(KEY, String(Date.now()));
  return { lists, pages: changed };
}

module.exports = { run, guessKind };
