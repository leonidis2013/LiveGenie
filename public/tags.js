/**
 * Tag names. Auto label suggests a short code for a piece of gear (RX-1, WMIC-1 Kyle, PA-AMP1…) or a cable (C-001),
 * numbered so it never repeats one already in use. Names are only ever suggested: nothing renames itself.
 * Shared by the Gear Locker, the guided setup and the stage patch; works in Node for the tests.
 */
(function (root) {
  /** The short code for each kind of gear. letter: numbered A, B, C… instead of 1, 2, 3. */
  const CODES = {
    mic: { code: 'MIC-' }, txmic: { code: 'WMIC-' }, capsule: { code: 'CAP-' }, receiver: { code: 'RX-' }, di: { code: 'DI-' }, source: { code: 'SRC-' },
    iemtx: { code: 'IEM-TX' }, bodypack: { code: 'IEM-' }, headamp: { code: 'HP-' }, console: { code: 'FOH ', model: true }, stagebox: { code: 'SB-', letter: true },
    processor: { code: 'PA-PROC' , plain: true }, amp: { code: 'PA-AMP' }, speaker: { code: 'SPK-' }, wedge: { code: 'WEDGE-' }, network: { code: 'SW-' }, power: { code: 'PWR-' }, computer: { code: 'PC-' }, other: { code: 'GEAR-' }
  };
  /** Speaker positions an admin can pick instead of a number. */
  const POSITIONS = ['PA-L', 'PA-R', 'SUB-1', 'SUB-2', 'FILL-L', 'FILL-R', 'DELAY-1'];

  /** For comparing names: case, spaces, dashes, dots and underscores do not count. */
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_.·/]+/g, '');
  const letter = (n) => { let s = ''; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const takenSet = (taken) => new Set([...(taken || [])].map((t) => norm(t)));

  /**
   * A tag name for a piece of gear. taken: names already used (any iterable); the suggestion avoids them.
   * opts: model (for the console), person (added after the number), position (a speaker spot like PA-L), keep (a name of its own that may stay).
   */
  function suggest(kind, taken, opts = {}) {
    const t = takenSet(taken);
    if (opts.keep) t.delete(norm(opts.keep));
    const c = CODES[kind] || CODES.other;
    const person = String(opts.person || '').trim();
    const withPerson = (base) => (person ? base + ' ' + person : base);
    // a number is used when a name is exactly it, or it followed by a person ("WMIC-1 Kyle" uses WMIC-1, "WMIC-10" does not)
    const free = (base) => { const b = norm(base); return ![...t].some((x) => x === b || (x.startsWith(b) && /^[a-z]/.test(x.slice(b.length)) && !c.letter)); };
    if (opts.position) {
      if (free(opts.position)) return opts.position;
      for (let n = 2; n < 100; n++) if (free(opts.position + ' ' + n)) return opts.position + ' ' + n;
    }
    if (c.model && !String(opts.model || '').trim()) {   // a console with no model yet: FOH, then FOH 2…
      if (free('FOH')) return 'FOH';
      for (let n = 2; n < 100; n++) if (free('FOH ' + n)) return 'FOH ' + n;
    }
    if (c.model && opts.model) {
      const base = (c.code + opts.model).trim();
      if (free(base)) return base;
      for (let n = 2; n < 100; n++) if (free(base + ' ' + n)) return base + ' ' + n;
    }
    if (c.plain && free(c.code)) return withPerson(c.code);
    for (let n = c.plain ? 2 : 0; n < 999; n++) {
      const base = c.code + (c.letter ? letter(n) : c.plain ? n : n + 1);
      if (free(base)) return withPerson(base);
    }
    return withPerson(c.code + Date.now() % 1000);
  }

  /** A cable number: C-001, C-002… the lowest one not already used. */
  function cable(taken) {
    const t = takenSet(taken);
    for (let n = 1; n < 10000; n++) { const s = 'C-' + String(n).padStart(3, '0'); if (!t.has(norm(s))) return s; }
    return 'C-' + Date.now() % 10000;
  }

  /**
   * A cable name that says what the cable does.
   *   in:  the input it plugs into — IN-A12 (stage box A input 12), IN-L03 (console local input 3), IN-M03 (a second console);
   *        cables further back in a chain (instrument → DI → box) add .1, .2…: IN-A12.1
   *   out / spk / lnk / net: counted per prefix — OUT-001, SPK-002, LNK-001, NET-004.
   * info: { type: 'in'|'out'|'spk'|'lnk'|'net', at: 'A' | 'L' | 'M'…, input: 12, back: 0 }. Never returns a name in taken.
   */
  const CABLE_PREFIX = { in: 'IN-', out: 'OUT-', spk: 'SPK-', lnk: 'LNK-', net: 'NET-' };
  function cableName(info, taken) {
    const t = takenSet(taken);
    const type = CABLE_PREFIX[info && info.type] ? info.type : 'out';
    if (type === 'in' && info.at && Number(info.input) > 0) {
      let base = 'IN-' + String(info.at).toUpperCase() + String(Number(info.input)).padStart(2, '0');
      if (info.back > 0) base += '.' + info.back;
      if (!t.has(norm(base))) return base;
      for (let n = 2; n < 100; n++) if (!t.has(norm(base + '-' + n))) return base + '-' + n;   // only when someone already used it by hand
    }
    const pre = type === 'in' ? 'IN-' : CABLE_PREFIX[type];
    for (let n = 1; n < 10000; n++) { const s = pre + String(n).padStart(3, '0'); if (!t.has(norm(s))) return s; }
    return pre + Date.now() % 10000;
  }

  /** "RX-1 (SLXD4D)": the tag name with the model after it, unless the name already says the model. */
  function withModel(name, model) {
    name = String(name || '').trim(); model = String(model || '').trim();
    if (!model || norm(name).includes(norm(model))) return name;
    return name + ' (' + model + ')';
  }

  /**
   * Names that are probably the same thing entered twice: equal once case, spaces and dashes are ignored.
   * items: [{ id, name }]; skip: Set of "id|id" pairs someone marked "Not a duplicate". Returns groups of 2 or more items.
   */
  function nearDupes(items, skip) {
    const by = new Map();
    for (const it of items || []) { const k = norm(it.name); if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
    const out = [];
    for (const g of by.values()) {
      if (g.length < 2) continue;
      const ids = g.map((x) => String(x.id)).sort();
      if (skip && skip.has(ids.join('|'))) continue;
      out.push(g);
    }
    return out;
  }

  const api = { CODES, POSITIONS, CABLE_PREFIX, norm, suggest, cable, cableName, withModel, nearDupes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tags = api;
})(typeof window !== 'undefined' ? window : globalThis);
