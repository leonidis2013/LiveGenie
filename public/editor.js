/*
 * LiveGenie rich text editor: what you see is what you get, with a toolbar.
 * Pages are still stored as Markdown, so this file turns the editor's HTML back
 * into Markdown (htmlToMd) and uses md() from app.js to show Markdown as HTML.
 * The browser's own editing commands do the typing, so undo and spell check work.
 */
'use strict';

const Rich = (() => {
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
    'BLOCKQUOTE', 'PRE', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION', 'MAIN', 'ASIDE', 'NAV', 'DL', 'DT', 'DD', 'ADDRESS', 'CAPTION']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'SVG', 'IMG', 'VIDEO', 'AUDIO',
    'CANVAS', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'COLGROUP', 'COL']);
  const ZW = /[​﻿]/g;

  // ---------- HTML -> Markdown ----------
  const escInline = (t) => t.replace(/[\\`*_[\]|]/g, '\\$&');
  function escLineStart(line) {
    return line.replace(/^(#{1,6}(?=\s|$)|[-+](?=\s)|>|\d+(?=[.)]\s)|---)/, (tok) => /^\d+$/.test(tok) ? tok + '\\' : '\\' + tok);
  }

  function cleanUrl(href) {
    let u = String(href || '').trim();
    if (!u) return '';
    const origin = location.origin;
    if (u.startsWith(origin + '/#/')) u = u.slice(origin.length + 1);
    else if (u.startsWith(origin + '/')) u = u.slice(origin.length);
    if (!/^(https?:\/\/|#\/|\/)/i.test(u)) return '';
    return u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  function wrap(s, mark) {
    return s.split('\n').map((line) => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(line);
      return m[2] ? m[1] + mark + m[2] + mark + m[3] : line;
    }).join('\n');
  }

  function kids(node, ctx) {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 1 && BLOCK.has(n.tagName)) out += '\n' + kids(n, ctx) + '\n';
      else out += inl(n, ctx);
    }
    return out;
  }

  function inl(node, ctx) {
    if (node.nodeType === 3) {
      const t = node.nodeValue.replace(ZW, '').replace(/[\s ]+/g, ' ');
      return ctx.code ? t : escInline(t);
    }
    if (node.nodeType !== 1) return '';
    const tag = node.tagName;
    if (SKIP.has(tag)) return '';
    if (tag === 'BR') return '\n';
    const st = node.style || {};
    if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') {
      const t = node.textContent.replace(ZW, '').replace(/[\s ]+/g, ' ').replace(/`/g, '');
      if (!t.trim()) return t;
      const m = /^(\s*)(.*?)(\s*)$/.exec(t);
      return m[1] + '`' + m[2] + '`' + m[3];
    }
    if (tag === 'A') {
      const inner = kids(node, { ...ctx, link: true });
      const url = cleanUrl(node.getAttribute('href'));
      if (ctx.link || !url || !inner.trim()) return inner;
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner.replace(/\n+/g, ' '));
      return m[1] + '[' + m[2] + '](' + url + ')' + m[3];
    }
    const fw = String(st.fontWeight || '');
    let bold = tag === 'STRONG' || tag === 'B' || fw === 'bold' || fw === 'bolder' || Number(fw) >= 600;
    if ((tag === 'B' || tag === 'STRONG') && (fw === 'normal' || (Number(fw) > 0 && Number(fw) < 600))) bold = false;
    let ital = tag === 'EM' || tag === 'I' || st.fontStyle === 'italic';
    if ((tag === 'EM' || tag === 'I') && st.fontStyle === 'normal') ital = false;
    let s = kids(node, { ...ctx, bold: ctx.bold || bold, ital: ctx.ital || ital });
    if (ital && !ctx.ital) s = wrap(s, '_');
    if (bold && !ctx.bold) s = wrap(s, '**');
    return s;
  }

  function linesOf(text) {
    const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines.filter((l, i) => l || lines[i - 1]);
  }

  function para(nodes) {
    const text = nodes.map((n) => inl(n, {})).join('');
    return linesOf(text).map(escLineStart).join('\n');
  }

  const hasBlockChild = (el) => Array.from(el.children).some((c) => BLOCK.has(c.tagName));

  function list(el) {
    const ordered = el.tagName === 'OL';
    const items = [];
    const walk = (l) => {
      for (const li of l.children) {
        if (li.tagName === 'UL' || li.tagName === 'OL') { walk(li); continue; }
        const own = Array.from(li.childNodes).filter((n) => !(n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')));
        const lines = linesOf(own.map((n) => (n.nodeType === 1 && BLOCK.has(n.tagName)) ? '\n' + kids(n, {}) + '\n' : inl(n, {})).join('')).filter(Boolean);
        if (lines.length) items.push(lines);
        Array.from(li.children).filter((n) => n.tagName === 'UL' || n.tagName === 'OL').forEach(walk);
      }
    };
    walk(el);
    return items.map((lines, i) => (ordered ? (i + 1) + '. ' : '- ') + lines.map((l, j) => j ? escLineStart(l) : l).join('\n  ')).join('\n');
  }

  function table(el) {
    const rows = Array.from(el.querySelectorAll('tr')).filter((tr) => tr.closest('table') === el)
      .map((tr) => Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map((c) => kids(c, {}).replace(/\s+/g, ' ').trim()));
    while (rows.length > 1 && rows[rows.length - 1].every((c) => !c)) rows.pop();   // drop empty rows at the bottom
    if (!rows.length) return '';
    const cols = Math.max(...rows.map((r) => r.length), 1);
    const line = (r) => '| ' + Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ') + ' |';
    return [line(rows[0]), '| ' + Array(cols).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n');
  }

  function blocks(root) {
    const out = [];
    let run = [];
    const flush = () => { if (run.length) { const p = para(run); if (p) out.push(p); run = []; } };
    for (const n of root.childNodes) {
      if (n.nodeType === 3 || (n.nodeType === 1 && !BLOCK.has(n.tagName) && !SKIP.has(n.tagName))) { run.push(n); continue; }
      if (n.nodeType !== 1 || SKIP.has(n.tagName)) continue;
      flush();
      const tag = n.tagName;
      if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
        const t = kids(n, {}).replace(/\s+/g, ' ').trim();
        if (t) out.push({ H1: '#', H2: '#', H3: '##' }[tag] ? ({ H1: '#', H2: '#', H3: '##' }[tag] + ' ' + t) : '### ' + t);
      } else if (tag === 'UL' || tag === 'OL') { const l = list(n); if (l) out.push(l); }
      else if (tag === 'TABLE') { const t = table(n); if (t) out.push(t); }
      else if (tag === 'BLOCKQUOTE') { const inner = blocks(n).join('\n\n'); if (inner) out.push(inner.split('\n').map((l) => '> ' + l).join('\n')); }
      else if (tag === 'PRE') { const t = n.textContent.replace(ZW, '').replace(/\n$/, ''); if (t.trim()) out.push('```\n' + t.replace(/```/g, "'''") + '\n```'); }
      else if (tag === 'HR') out.push('---');
      else if (tag === 'LI') { const l = linesOf(kids(n, {})); if (l.length) out.push('- ' + l.join('\n  ')); }
      else if (hasBlockChild(n)) out.push(...blocks(n));
      else { const p = para(Array.from(n.childNodes)); if (p) out.push(p); }
    }
    flush();
    return out;
  }

  /** Join neighbouring <b>, <i>, <code> so "**a****b**" never happens. */
  function mergeInline(root) {
    root.querySelectorAll('b, strong, i, em, code').forEach((el) => {
      if (!el.isConnected) return;
      let next = el.nextSibling;
      while (next && next.nodeType === 1 && next.tagName === el.tagName && (next.getAttribute('style') || '') === (el.getAttribute('style') || '')) {
        while (next.firstChild) el.appendChild(next.firstChild);
        const gone = next;
        next = next.nextSibling;
        gone.remove();
      }
    });
  }

  function htmlToMd(root) {
    const clone = root.cloneNode(true);
    mergeInline(clone);
    return blocks(clone).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------- the editor ----------
  const IC = {
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    ul: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1.3" fill="currentColor"/><circle cx="4" cy="12" r="1.3" fill="currentColor"/><circle cx="4" cy="18" r="1.3" fill="currentColor"/>',
    ol: '<path d="M10 6h11M10 12h11M10 18h11"/><path d="M3.5 4.5L5 4v5M3.5 9h3M3.5 14.5c.4-.6 1-.9 1.6-.9.8 0 1.4.5 1.4 1.2 0 1.2-3 2.2-3 3.7h3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 4v16"/>',
    clear: '<path d="M4 7V5h14v2M9 5l-3 14M12 19H6"/><path d="M15 14l6 6M21 14l-6 6"/>',
    quote: '<path d="M6 17c-1.5 0-2.5-1-2.5-3 0-3 2-6 5-7M15 17c-1.5 0-2.5-1-2.5-3 0-3 2-6 5-7"/>'
  };
  const svg = (k) => '<svg viewBox="0 0 24 24" class="icon">' + IC[k] + '</svg>';

  const FULL = [
    ['undo', svg('undo'), 'Undo'], ['redo', svg('redo'), 'Redo'], '|',
    ['h1', '<b class="tl">H1</b>', 'Heading'], ['h2', '<b class="tl sm">H2</b>', 'Subheading'], '|',
    ['bold', '<b class="tl">B</b>', 'Bold (Ctrl+B)'], ['italic', '<i class="tl serif">I</i>', 'Italic (Ctrl+I)'], '|',
    ['ul', svg('ul'), 'Bullet list'], ['ol', svg('ol'), 'Numbered steps'], '|',
    ['link', svg('link'), 'Link (Ctrl+K)'], ['code', '<span class="tl mono">IP</span>', 'Address or code: shows text like 10.10.20.11 in a box'],
    ['table', svg('table'), 'Table'], ['clear', svg('clear'), 'Clear formatting'], '|',
    ['src', '<span class="tl mono sm">MD</span>', 'Edit as plain text (Markdown)']
  ];
  const COMPACT = [
    ['bold', '<b class="tl">B</b>', 'Bold'], ['italic', '<i class="tl serif">I</i>', 'Italic'], '|',
    ['ul', svg('ul'), 'Bullet list'], ['ol', svg('ol'), 'Numbered steps'], '|',
    ['link', svg('link'), 'Link'], ['code', '<span class="tl mono">IP</span>', 'Address or code'], ['clear', svg('clear'), 'Clear formatting'], '|',
    ['src', '<span class="tl mono sm">MD</span>', 'Edit as plain text (Markdown)']
  ];
  const TABLE_TOOLS = [['rowAdd', '+ Row'], ['colAdd', '+ Column'], ['rowDel', '− Row'], ['colDel', '− Column'], ['tableDel', 'Delete table']];

  let defaultSepSet = false;
  const all = new Set();
  document.addEventListener('selectionchange', () => { all.forEach((ed) => ed._onSel()); });

  function create(opts) {
    const o = { md: '', compact: false, placeholder: 'Write here…', onChange: () => {}, ...opts };
    const wrapEl = document.createElement('div');
    wrapEl.className = 'rte';
    const tools = o.compact ? COMPACT : FULL;
    wrapEl.innerHTML = '<div class="rtbar"><div class="rtb" role="toolbar" aria-label="Formatting">' +
      tools.map((t) => t === '|' ? '<span class="rsep"></span>' : '<button type="button" tabindex="-1" data-c="' + t[0] + '" title="' + t[2] + '" aria-label="' + t[2] + '">' + t[1] + '</button>').join('') +
      '</div><div class="rtt hide">' + TABLE_TOOLS.map((t) => '<button type="button" tabindex="-1" data-c="' + t[0] + '">' + t[1] + '</button>').join('') + '</div></div>' +
      '<div class="rtx doc" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true"></div>' +
      '<textarea class="rsrc hide" spellcheck="false"></textarea>';
    const edit = wrapEl.querySelector('.rtx');
    const src = wrapEl.querySelector('.rsrc');
    const bar = wrapEl.querySelector('.rtb');
    const tbl = wrapEl.querySelector('.rtt');
    edit.dataset.ph = o.placeholder;
    if (o.compact) edit.classList.add('compact');
    let last = String(o.md || '');
    let saved = null;
    let srcMode = false;

    function setHtml(m) {
      edit.innerHTML = md(m) || '<p><br></p>';
      edit.querySelectorAll('a').forEach((a) => { a.removeAttribute('target'); a.removeAttribute('rel'); });
      placeholder();
    }
    function placeholder() {
      edit.classList.toggle('empty', !edit.textContent.replace(ZW, '').trim() && !edit.querySelector('table, hr, li'));
    }
    function sync() {
      placeholder();
      const cur = srcMode ? src.value : htmlToMd(edit);
      if (cur !== last) { last = cur; o.onChange(cur); }
    }
    const inEdit = (n) => n && (n === edit || edit.contains(n));
    const sel = () => window.getSelection();
    const exec = (c, v) => document.execCommand(c, false, v);
    function closest(tags) {
      const s = sel();
      if (!s.rangeCount || !inEdit(s.anchorNode)) return null;
      let n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode;
      while (n && n !== edit) { if (tags.includes(n.tagName)) return n; n = n.parentNode; }
      return null;
    }
    function restore() {
      edit.focus({ preventScroll: true });
      const s = sel();
      if (saved && (!s.rangeCount || !inEdit(s.anchorNode))) { s.removeAllRanges(); s.addRange(saved); }
    }
    function caretInto(node, selectAll) {
      const r = document.createRange();
      r.selectNodeContents(node);
      if (!selectAll) r.collapse(true);
      const s = sel(); s.removeAllRanges(); s.addRange(r);
    }

    function toggleBlock(tag) {
      const cur = closest(['H1', 'H2', 'H3', 'H4', 'P', 'DIV', 'LI', 'BLOCKQUOTE']);
      if (cur && cur.tagName === 'LI') exec(cur.parentNode.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
      exec('formatBlock', cur && cur.tagName === tag ? '<p>' : '<' + tag.toLowerCase() + '>');
    }
    function toggleCode() {
      const c = closest(['CODE']);
      if (c) { c.replaceWith(document.createTextNode(c.textContent)); return; }
      const s = sel();
      if (s.isCollapsed && s.modify) { s.modify('move', 'backward', 'word'); s.modify('extend', 'forward', 'word'); }
      let t = s.toString();
      if (!t.trim()) return toast('Select the address or word first, then tap IP');
      if (/\n/.test(t.trim())) return toast('Pick text on one line for the IP style');
      const trail = /\s$/.test(t) ? ' ' : '';
      exec('insertHTML', '<code>' + esc(t.trim()) + '</code>' + trail);
    }
    function normUrl(v) {
      v = String(v || '').trim();
      if (!v) return '';
      if (v.startsWith(location.origin)) v = v.slice(location.origin.length).replace(/^\/#\//, '#/');
      if (/^#\//.test(v) || /^https?:\/\//i.test(v)) return v;
      if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(v)) return 'http://' + v;
      if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(v)) return 'https://' + v;
      return '';
    }
    function linkDialog() {
      const a = closest(['A']);
      const s = sel();
      const range = s.rangeCount && inEdit(s.anchorNode) ? s.getRangeAt(0).cloneRange() : saved;
      const collapsed = !range || range.collapsed;
      const needText = !a && collapsed;
      modal(`<h3>${a ? 'Edit link' : 'Add a link'}</h3><p>A web address, a device page like 10.10.20.11, or another LiveGenie page (copy its address from the browser).</p>
        <form id="lf">${needText ? '<label for="lt">Text to show</label><input id="lt" placeholder="SQ-5 manual">' : ''}
        <label for="lu">Address</label><input id="lu" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://… or 10.10.20.11" value="${esc(a ? a.getAttribute('href') : '')}">
        <div class="err" id="le"></div>
        <div class="acts">${a ? '<button type="button" class="danger" id="lr" style="margin-right:auto">Remove link</button>' : ''}<button type="button" data-close>Cancel</button><button class="primary">${a ? 'Save' : 'Add link'}</button></div></form>`, (w, close) => {
        const back = () => { edit.focus({ preventScroll: true }); if (range) { const s2 = sel(); s2.removeAllRanges(); s2.addRange(range); } };
        if (a) w.querySelector('#lr').addEventListener('click', () => { close(); back(); a.replaceWith(...a.childNodes); sync(); });
        w.querySelector('#lf').addEventListener('submit', (e) => {
          e.preventDefault();
          const url = normUrl(w.querySelector('#lu').value);
          if (!url) { w.querySelector('#le').textContent = 'Enter a web address (https://…), a device address (10.10.20.11) or a LiveGenie page address'; return; }
          close(); back();
          if (a) a.setAttribute('href', url);
          else if (needText) { const t = w.querySelector('#lt').value.trim() || url.replace(/^https?:\/\//, ''); exec('insertHTML', '<a href="' + esc(url) + '">' + esc(t) + '</a>&nbsp;'); }
          else exec('createLink', url);
          sync(); state();
        });
      });
    }
    function insertTable() {
      if (closest(['TABLE'])) return toast('You are already in a table');
      // built by hand: the browser's insertHTML scrambles tables inside lists and paragraphs
      const t = document.createElement('table');
      t.innerHTML = '<thead><tr><th>Column 1</th><th>Column 2</th></tr></thead><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody>';
      const after = document.createElement('p'); after.innerHTML = '<br>';
      let blk = closest(['P', 'DIV', 'H2', 'H3', 'H4', 'UL', 'OL', 'BLOCKQUOTE', 'PRE']);
      while (blk && blk.parentNode !== edit) blk = blk.parentNode;
      if (blk && blk.parentNode === edit) {
        const empty = !blk.textContent.replace(ZW, '').trim() && !blk.querySelector('table, hr, li');
        if (empty) blk.replaceWith(t); else blk.after(t);
      } else edit.appendChild(t);
      t.after(after);
      caretInto(t.querySelector('th'), true);
    }
    function tableOp(op) {
      const cellEl = closest(['TD', 'TH']);
      const t = closest(['TABLE']);
      if (!t || !cellEl) return;
      const tr = cellEl.parentNode;
      const idx = Array.from(tr.children).indexOf(cellEl);
      const rows = Array.from(t.querySelectorAll('tr'));
      const blank = (tag) => { const c = document.createElement(tag); c.innerHTML = '<br>'; return c; };
      if (op === 'rowAdd') {
        const n = document.createElement('tr');
        for (let i = 0; i < tr.children.length; i++) n.appendChild(blank('td'));
        if (tr.parentNode.tagName === 'THEAD') { let body = t.querySelector('tbody'); if (!body) { body = document.createElement('tbody'); t.appendChild(body); } body.insertBefore(n, body.firstChild); }
        else tr.after(n);
        caretInto(n.children[Math.min(idx, n.children.length - 1)]);
      } else if (op === 'colAdd') {
        rows.forEach((r) => { const c = r.children[idx]; const n = blank(c ? c.tagName.toLowerCase() : 'td'); if (c) c.after(n); else r.appendChild(n); });
        caretInto(tr.children[idx + 1]);
      } else if (op === 'rowDel') {
        if (tr.parentNode.tagName === 'THEAD' || rows.indexOf(tr) === 0) return toast('The top row holds the column names. Use Delete table to remove it all.');
        const other = tr.nextElementSibling || tr.previousElementSibling;
        tr.remove();
        if (other) caretInto(other.children[Math.min(idx, other.children.length - 1)]);
      } else if (op === 'colDel') {
        if (tr.children.length <= 1) return tableOp('tableDel');
        rows.forEach((r) => { if (r.children[idx]) r.children[idx].remove(); });
        caretInto(tr.children[Math.max(0, idx - 1)]);
      } else if (op === 'tableDel') {
        const p = document.createElement('p'); p.innerHTML = '<br>';
        t.replaceWith(p); caretInto(p);
      }
      sync(); state();
    }
    function toggleSrc() {
      srcMode = !srcMode;
      if (srcMode) { src.value = last; src.style.height = Math.max(edit.offsetHeight, 120) + 'px'; }
      else setHtml(last);
      edit.classList.toggle('hide', srcMode);
      src.classList.toggle('hide', !srcMode);
      bar.querySelectorAll('button').forEach((b) => { b.disabled = srcMode && b.dataset.c !== 'src'; });
      bar.querySelector('[data-c=src]').classList.toggle('on', srcMode);
      tbl.classList.add('hide');
      (srcMode ? src : edit).focus();
    }

    function run(c) {
      if (c === 'src') return toggleSrc();
      if (srcMode) return;
      restore();
      if (!defaultSepSet) { try { exec('defaultParagraphSeparator', 'p'); } catch (e) { /* older browsers */ } defaultSepSet = true; }
      switch (c) {
        case 'undo': case 'redo': case 'bold': case 'italic': exec(c); break;
        case 'h1': toggleBlock('H2'); break;
        case 'h2': toggleBlock('H3'); break;
        case 'ul': if (closest(['H2', 'H3'])) exec('formatBlock', '<p>'); exec('insertUnorderedList'); break;
        case 'ol': if (closest(['H2', 'H3'])) exec('formatBlock', '<p>'); exec('insertOrderedList'); break;
        case 'link': return linkDialog();
        case 'code': toggleCode(); break;
        case 'table': insertTable(); break;
        case 'clear': {
          exec('removeFormat'); exec('unlink');
          const cc = closest(['CODE']); if (cc) cc.replaceWith(document.createTextNode(cc.textContent));
          if (closest(['H2', 'H3', 'H4'])) exec('formatBlock', '<p>');
          break;
        }
        default: if (c in { rowAdd: 1, colAdd: 1, rowDel: 1, colDel: 1, tableDel: 1 }) return tableOp(c);
      }
      sync(); state();
    }

    function state() {
      if (srcMode) return;
      const s = sel();
      const inside = s.rangeCount && inEdit(s.anchorNode);
      const on = (c, v) => { const b = bar.querySelector('[data-c=' + c + ']'); if (b) b.classList.toggle('on', !!(inside && v)); };
      let qb = false, qi = false;
      try { qb = document.queryCommandState('bold'); qi = document.queryCommandState('italic'); } catch (e) { /* not supported */ }
      on('bold', qb && !closest(['TH', 'H2', 'H3'])); on('italic', qi);
      on('h1', closest(['H2'])); on('h2', closest(['H3']));
      on('ul', closest(['UL'])); on('ol', closest(['OL']));
      on('link', closest(['A'])); on('code', closest(['CODE']));
      tbl.classList.toggle('hide', !(inside && closest(['TABLE'])));
    }

    const api = {
      el: wrapEl,
      getMd: () => last,
      focus: () => { edit.focus(); caretInto(edit.lastElementChild || edit); },
      _onSel: () => {
        if (!wrapEl.isConnected) { all.delete(api); return; }
        const s = sel();
        if (s.rangeCount && inEdit(s.anchorNode)) saved = s.getRangeAt(0).cloneRange();
        state();
      }
    };
    all.add(api);

    // toolbar: keep the text selected while tapping buttons
    wrapEl.querySelector('.rtbar').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    wrapEl.querySelector('.rtbar').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled) run(b.dataset.c); });

    edit.addEventListener('input', (e) => {
      // Markdown habits still work: "- " starts a list, "1. " numbered steps, "# " a heading
      if (e.inputType === 'insertText' && e.data === ' ') {
        const blk = closest(['P', 'DIV']);
        const t = blk ? blk.textContent.replace(/ /g, ' ') : '';
        const map = { '- ': 'ul', '* ': 'ul', '1. ': 'ol', '# ': 'h1', '## ': 'h2' };
        if (blk && map[t]) {
          caretInto(blk, true); exec('delete');
          run(map[t]);
          return;
        }
      }
      sync(); state();
    });
    edit.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); linkDialog(); return; }
      if (e.key === 'Tab') {
        const cellEl = closest(['TD', 'TH']);
        if (!cellEl) return;
        e.preventDefault();
        const cells = Array.from(closest(['TABLE']).querySelectorAll('th, td'));
        const i = cells.indexOf(cellEl) + (e.shiftKey ? -1 : 1);
        if (i >= cells.length) { tableOp('rowAdd'); caretInto(closest(['TR']).children[0]); return; }
        if (i >= 0) caretInto(cells[i], true);
      }
    });
    edit.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const html = cd.getData('text/html');
      const text = cd.getData('text/plain');
      if (!html && !text) { if (cd.files && cd.files.length) { e.preventDefault(); toast('Use the Picture block for photos'); } return; }
      e.preventDefault();
      if (html && !closest(['CODE'])) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const m = htmlToMd(doc.body);
        let out = md(m);
        if (closest(['TD', 'TH'])) out = esc(doc.body.textContent.replace(/\s+/g, ' ').trim());
        else if (/^<p>[\s\S]*<\/p>$/.test(out) && out.indexOf('<p>', 1) < 0) out = out.slice(3, -4);
        exec('insertHTML', out.replace(/ target="_blank" rel="noopener"/g, ''));
      } else exec('insertText', text);
      sync();
    });
    src.addEventListener('input', sync);

    setHtml(last);
    return api;
  }

  return { create, htmlToMd };
})();
