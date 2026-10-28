/*
 * A page is a list of blocks. This file checks blocks coming from the browser
 * and turns them into plain text for search.
 *
 *   text       { type, md }                       Markdown-style text
 *   callout    { type, kind, md }                 kind: tip | warning | critical (Sunday-critical)
 *   checklist  { type, title, items: [string] }   tickable steps (ticks are kept per device)
 *   image      { type, upload, caption }          a picture uploaded to LiveGenie
 *   divider    { type }
 */
'use strict';

const TYPES = ['text', 'callout', 'checklist', 'image', 'divider'];
const CALLOUTS = ['tip', 'warning', 'critical'];
const MAX_BLOCKS = 300;
const MAX_TEXT = 50000;

const str = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').slice(0, max);

/** Returns { blocks } or { error }. Unknown fields are dropped. */
function clean(input) {
  if (!Array.isArray(input)) return { error: 'Blocks must be a list' };
  if (input.length > MAX_BLOCKS) return { error: 'A page can hold at most ' + MAX_BLOCKS + ' blocks' };
  const out = [];
  for (const b of input) {
    if (!b || typeof b !== 'object' || !TYPES.includes(b.type)) return { error: 'Unknown block type: ' + (b && b.type) };
    switch (b.type) {
      case 'text': out.push({ type: 'text', md: str(b.md, MAX_TEXT) }); break;
      case 'callout': out.push({ type: 'callout', kind: CALLOUTS.includes(b.kind) ? b.kind : 'tip', md: str(b.md, MAX_TEXT) }); break;
      case 'checklist': {
        const items = (Array.isArray(b.items) ? b.items : []).map((t) => str(t, 500).trim()).filter(Boolean).slice(0, 200);
        out.push({ type: 'checklist', title: str(b.title, 200).trim(), items });
        break;
      }
      case 'image':
        if (!/^[a-f0-9]{24}$/.test(String(b.upload || ''))) return { error: 'An image block is missing its picture' };
        out.push({ type: 'image', upload: b.upload, caption: str(b.caption, 500).trim() });
        break;
      case 'divider': out.push({ type: 'divider' }); break;
    }
  }
  return { blocks: out };
}

/** Markdown-ish text to plain words for the search index. */
function strip(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ' '))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function plainText(blocks) {
  const parts = [];
  for (const b of blocks || []) {
    if (b.type === 'text' || b.type === 'callout') parts.push(strip(b.md));
    else if (b.type === 'checklist') parts.push(b.title, ...b.items);
    else if (b.type === 'image') parts.push(b.caption);
  }
  return parts.filter(Boolean).join('\n');
}

/** Upload ids a page uses (so backups and clean-up know what is still needed). */
function uploadsIn(blocks) {
  return (blocks || []).filter((b) => b.type === 'image').map((b) => b.upload);
}

module.exports = { clean, plainText, uploadsIn, TYPES, CALLOUTS };
