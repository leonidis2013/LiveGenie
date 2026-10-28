/*
 * Finds device names, aliases and IP addresses in text, so LiveGenie can link
 * them to device cards. Shared by the server (Used on lists) and the web page
 * (links on pages), so both agree on what counts as a mention.
 *   "SQ-5" matches "the SQ-5's scene" but not "SQ-50"; "10.10.20.1" does not match "10.10.20.11".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DevMatch = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** devices: [{ id, name, aliases: [], ips: [] }] */
  function build(devices) {
    const map = new Map();
    for (const d of devices || []) {
      const terms = [d.name, ...(d.aliases || []), ...(d.ips || [])];
      for (const t of terms) {
        const k = String(t || '').trim().toLowerCase();
        if (k.length < 2 || map.has(k)) continue;
        map.set(k, d.id);
      }
    }
    if (!map.size) return { find: () => [], size: 0 };
    const terms = Array.from(map.keys()).sort((a, b) => b.length - a.length).map(escRe);
    const re = new RegExp('(?<![\\p{L}\\p{N}.])(' + terms.join('|') + ')(?![\\p{L}\\p{N}]|\\.\\d)', 'giu');
    function find(text) {
      const out = [];
      const s = String(text || '');
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        out.push({ index: m.index, length: m[0].length, text: m[0], id: map.get(m[0].toLowerCase()) });
        if (m[0].length === 0) re.lastIndex++;
      }
      return out;
    }
    return { find, size: map.size };
  }

  return { build };
}));
