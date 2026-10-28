/*
 * LiveGenie web page. Plain JavaScript, no build step.
 * Routes (after #): /  /s/<space>  /p/<id>  /p/<id>/edit  /p/<id>/history[/<v>]  /new[?space=]  /search?q=  /settings[/<tab>]
 */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

const S = { state: null, dirty: false, lastRoute: '#/', offline: false, ed: null };
const can = (role) => ({ viewer: 0, volunteer: 1, editor: 2, admin: 3 }[S.state ? S.state.role : 'viewer'] >= { viewer: 0, volunteer: 1, editor: 2, admin: 3 }[role]);

// ---------- icons ----------
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17h.01"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16h.01"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  line: '<path d="M4 12h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .8 3.2 2.6 3.6 5.2"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
  pin: '<path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pdf: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 14h6M9 17h4"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  grid: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
  net: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
  spark: '<path d="M12 3c.6 3.7 1.3 4.4 5 5-3.7.6-4.4 1.3-5 5-.6-3.7-1.3-4.4-5-5 3.7-.6 4.4-1.3 5-5z"/>'
};
const icon = (n, cls = 'icon') => '<svg class="' + cls + '" viewBox="0 0 24 24">' + (ICONS[n] || '') + '</svg>';

// ---------- talking to the server ----------
async function call(method, url, body, opts = {}) {
  const headers = { 'x-livegenie': '1' };
  let payload;
  if (opts.raw) { payload = body; headers['content-type'] = opts.type || 'application/octet-stream'; Object.assign(headers, opts.headers || {}); }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch (e) {
    goOffline();
    throw new Error('Lost connection to LiveGenie');
  }
  let data = {};
  try { data = await res.json(); } catch (e) { data = { ok: false, error: 'Unexpected answer from LiveGenie (' + res.status + ')' }; }
  if (res.status === 401 && S.state && S.state.user) { await loadState(); paintHeader(); }
  if (!res.ok || data.ok === false) { const err = new Error(data.error || ('Error ' + res.status)); err.status = res.status; throw err; }
  return data;
}
const get = (u) => call('GET', u);

function goOffline() {
  if (S.offline) return;
  S.offline = true;
  document.body.classList.add('offline');
  const poll = async () => {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (r.ok) { S.offline = false; document.body.classList.remove('offline'); await loadState(); paintHeader(); route(); return; }
    } catch (e) { /* still down */ }
    setTimeout(poll, 3000);
  };
  setTimeout(poll, 3000);
}

let toastTimer = null;
function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'bad' ? 5000 : 2600);
}

// ---------- time ----------
function ago(t) {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  const d = new Date(t), y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  if (s < 6 * 86400) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const when = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const bytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';

// ---------- markdown (a safe subset: headings, lists, tables, quotes, code, bold, italic, links) ----------
function inline(s) {
  const codes = [], escs = [];
  // backslash escapes (\* \_ \| …) show the character itself
  s = String(s == null ? '' : s).replace(/\\([\\`*_[\]|#+\-.>()!~])/g, (m, c) => { escs.push(c); return '\u0003' + (escs.length - 1) + '\u0003'; });
  let h = esc(s).replace(/`([^`]+)`/g, (m, c) => { codes.push('<code>' + c + '</code>'); return '\u0000' + (codes.length - 1) + '\u0000'; });
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
    const url = u.replace(/&amp;/g, '&');
    if (!/^(https?:\/\/|#\/|\/)/i.test(url)) return m;
    const ext = /^https?:/i.test(url);
    return '<a href="' + esc(url) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + t + '</a>';
  });
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (m, pre, u) => pre + '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  return h.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[i]).replace(/\u0003(\d+)\u0003/g, (m, i) => esc(escs[i]));
}

function md(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1').split(/(?<!\\)\|/).map((c) => inline(c.trim()));
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    if (/^```/.test(l)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push('<pre><code>' + esc(body.join('\n')) + '</code></pre>');
      continue;
    }
    let m = /^(#{1,3})\s+(.*)$/.exec(l);
    if (m) { const n = m[1].length + 1; out.push('<h' + n + '>' + inline(m[2]) + '</h' + n + '>'); i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push('<table><thead><tr>' + head.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^\s*>/.test(l)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push('<blockquote>' + md(q.join('\n')) + '</blockquote>');
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items[items.length - 1] += '\n' + lines[i++].trim();
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push('<' + tag + '>' + items.map((t) => '<li>' + t.split('\n').map(inline).join('<br>') + '</li>').join('') + '</' + tag + '>');
      continue;
    }
    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,3}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]) && !(/^\s*\|/.test(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) para.push(lines[i++]);
    out.push('<p>' + para.map(inline).join('<br>') + '</p>');
  }
  return out.join('');
}

// ---------- state + header ----------
async function loadState() {
  try { S.state = await get('/api/state'); } catch (e) { /* offline handled */ }
}

function paintHeader() {
  const st = S.state;
  if (!st) return;
  $('#hVer').textContent = st.version;
  const u = st.user;
  $('#whoBtn').classList.toggle('hide', !u);
  $('#signBtn').classList.toggle('hide', !!u || st.setupNeeded);
  if (u) { $('#whoAv').textContent = u.name.slice(0, 1).toUpperCase(); $('#whoName').textContent = u.name; }
  const td = st.todo || { open: 0, overdue: 0 };
  $('#todoPill').classList.toggle('hide', !td.open);
  $('#todoPill').classList.toggle('bad', td.overdue > 0);
  $('#todoPill').textContent = td.overdue ? td.overdue + ' overdue' : td.open + ' to do';
  $('#updPill').classList.toggle('hide', !(st.update && st.update.available));
  $('#updPill').textContent = 'Update available' + (st.update && st.update.latest ? ' · ' + st.update.latest : '');
  $('#hdr').classList.toggle('hide', !!st.setupNeeded);
  measureHeader();
}
function measureHeader() { document.documentElement.style.setProperty('--hh', ($('#hdr').offsetHeight || 0) + 'px'); }
window.addEventListener('resize', measureHeader);

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (q) location.hash = '#/search?q=' + encodeURIComponent(q);
});
$('#signBtn').addEventListener('click', () => signInDialog());
$('#whoBtn').addEventListener('click', () => { location.hash = '#/settings/account'; });
$('#updPill').addEventListener('click', () => { location.hash = '#/settings/about'; });
$('#todoPill').addEventListener('click', () => { if (location.hash === '#/' || location.hash === '') route(); else location.hash = '#/'; });
// keep the header (to do count, update notice) fresh
setInterval(async () => { if (document.hidden || S.offline) return; await loadState(); paintHeader(); }, 60000);
document.addEventListener('visibilitychange', async () => { if (!document.hidden && S.state && !S.offline) { await loadState(); paintHeader(); } });
$('#gear').addEventListener('click', () => {
  if (location.hash.startsWith('#/settings')) location.hash = S.lastRoute || '#/';
  else location.hash = '#/settings';
});

// ---------- dialogs ----------
function modal(html, onReady) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = '<div class="box" role="dialog" aria-modal="true">' + html + '</div>';
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && !wrap.dataset.locked) close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && !wrap.dataset.locked) close(); });
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  if (onReady) onReady(wrap, close);
  const f = $('input, select, textarea, button.primary', wrap);
  if (f) setTimeout(() => f.focus(), 30);
  return { wrap, close };
}

function confirmBox(title, text, okLabel, danger) {
  return new Promise((resolve) => {
    modal('<h3>' + esc(title) + '</h3><p>' + text + '</p><div class="acts"><button data-close>Cancel</button><button class="primary ' + (danger ? 'danger' : '') + '" id="okB">' + esc(okLabel || 'OK') + '</button></div>', (w, close) => {
      if (danger) { $('#okB', w).style.background = 'var(--bad)'; $('#okB', w).style.color = '#fff'; }
      $('#okB', w).addEventListener('click', () => { close(); resolve(true); });
      $$('[data-close]', w).forEach((b) => b.addEventListener('click', () => resolve(false)));
    });
  });
}

function signInDialog(then) {
  modal(`<h3>Sign in</h3><p>Volunteers, editors and admins sign in with their name and PIN.</p>
    <form id="sf"><label for="sn">Name</label><input id="sn" autocomplete="username" autocapitalize="words">
    <label for="sp">PIN</label><input id="sp" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8">
    <div class="err" id="se"></div>
    <div class="acts"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Sign in</button></div></form>`, (w, close) => {
    $('#sf', w).addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#se', w).textContent = '';
      try {
        await call('POST', '/api/signin', { name: $('#sn', w).value, pin: $('#sp', w).value });
        close();
        await loadState(); paintHeader();
        toast('Signed in as ' + S.state.user.name, 'ok');
        if (then) then(); else route();
      } catch (err) { $('#se', w).textContent = err.message; $('#sp', w).select(); }
    });
  });
}

// ---------- shared bits ----------
function pageRow(p, opts = {}) {
  const badges = (p.pinned && !opts.noPin ? '<span class="badge pin">Pinned</span>' : '') + (p.tech_only ? '<span class="badge tech">Tech only</span>' : '');
  const sub = opts.snip ? '<span class="snip">' + esc(p.snip).replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>') + '</span>'
    : '<span>' + esc(opts.showSpace ? p.space_name : '') + (opts.showSpace && p.updated_by ? ' · ' : '') + (p.updated_by ? 'Updated by ' + esc(p.updated_by) : '') + '</span>';
  return '<a class="row" href="#/p/' + p.id + '"><div class="t"><b>' + esc(p.title) + '</b>' + sub + '</div>' + badges +
    '<div class="m hide-sm">' + esc(ago(p.updated_at)) + '</div></a>';
}

function spaceName(slug) {
  const sp = (S.spaces || []).find((s) => s.slug === slug);
  return sp ? sp.name : slug;
}

function setTitle(t) { document.title = t ? t + ' · LiveGenie' : 'LiveGenie'; }
function markGear(on) { $('#gear').classList.toggle('on', on); }

// ---------- views ----------
async function viewSetup() {
  setTitle('Set up');
  app.innerHTML = `<div class="first-run">
    <img src="/icons/livegenie-mark.svg" alt="">
    <h1 style="font-size:20px">Welcome to LiveGenie</h1>
    <p class="note" style="font-size:14px;margin:6px 0 18px">Create the first admin. You can add volunteers and editors in Settings afterwards.</p>
    <form class="card" id="setupF">
      <label for="an">Your name</label><input id="an" autocomplete="username" autocapitalize="words" required>
      <label for="ap">PIN (4 to 8 digits)</label><input id="ap" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" required>
      <label for="ap2">PIN again</label><input id="ap2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" required>
      <div class="note" id="ae" style="color:var(--bad);min-height:18px;margin-top:8px"></div>
      <button class="primary" style="width:100%;margin-top:8px;padding:11px">Create admin and start</button>
    </form></div>`;
  $('#setupF').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('#ap').value;
    if (pin !== $('#ap2').value) { $('#ae').textContent = 'The two PINs are not the same'; return; }
    try {
      await call('POST', '/api/setup', { name: $('#an').value, pin });
      await loadState(); paintHeader();
      location.hash = '#/';
      route();
    } catch (err) { $('#ae').textContent = err.message; }
  });
}

async function viewHome() {
  setTitle('');
  const [d, t, devs] = await Promise.all([get('/api/home'), get('/api/todo'), loadDevices(true)]);
  S.spaces = d.spaces;
  const newBtn = can('editor') ? '<button class="primary btn" id="newPage">' + icon('plus') + 'New page</button>' : '';
  app.innerHTML = `
    <div class="bar"><div class="grow"></div>${newBtn}</div>
    ${t.todo.length ? '<div class="section" id="todo"><h2>To do</h2><div class="list">' + t.todo.map(todoRow).join('') + '</div></div>' : ''}
    ${d.pinned.length ? '<div class="section"><h2>Pinned</h2><div class="list">' + d.pinned.map((p) => pageRow(p, { showSpace: true, noPin: true })).join('') + '</div></div>' : ''}
    <div class="section"><h2>Spaces</h2><div class="spaces">${d.spaces.map((s) => `<a class="space" href="#/s/${esc(s.slug)}"><i></i><b>${esc(s.name)}</b><span>${esc(s.blurb)}</span><em class="n">${s.pages} page${s.pages === 1 ? '' : 's'}</em></a>`).join('')}<a class="space devtile" href="#/devices"><i></i><b>Devices</b><span>Every device, its IP and where it is used</span><em class="n">${devs.length} device${devs.length === 1 ? '' : 's'}</em></a><a class="space maptile" href="#/map"><i></i><b>System map</b><span>Signal flow${can('editor') ? ', network and VLANs' : ''} drawn from your pages</span><em class="n">${icon('net')}</em></a></div></div>
    <div class="section"><h2>Recently updated</h2>${d.recent.length ? '<div class="list">' + d.recent.map((p) => pageRow(p, { showSpace: true })).join('') + '</div>'
      : '<div class="card empty">No pages yet.' + (can('editor') ? ' Start with the Sunday startup checklist or a page about the SQ-5.' : (S.state.user ? '' : ' Editors can sign in to add the first pages.')) + '</div>'}</div>`;
  const nb = $('#newPage');
  if (nb) nb.addEventListener('click', () => { location.hash = '#/new'; });
  // refresh the To do list while the home page is open
  const mine = app.firstElementChild;
  const timer = setInterval(async () => {
    if (!mine.isConnected) return clearInterval(timer);
    if (document.hidden || S.offline) return;
    try {
      const x = await get('/api/todo');
      if (!mine.isConnected) return;
      const sec = $('#todo');
      const html = x.todo.length ? '<h2>To do</h2><div class="list">' + x.todo.map(todoRow).join('') + '</div>' : '';
      if (sec) { if (html) sec.innerHTML = html; else sec.remove(); }
      else if (html) { const div = document.createElement('div'); div.className = 'section'; div.id = 'todo'; div.innerHTML = html; app.querySelector('.bar').after(div); }
    } catch (e) { /* offline banner */ }
  }, 30000);
}

function todoRow(t) {
  const tmText = (x) => new Date(x).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const done = t.total - t.left;
  const status = t.complete ? '<span class="chip ok">Done' + (t.completedAt ? ' ' + esc(tmText(t.completedAt)) : '') + '</span>'
    : t.overdue ? '<span class="chip bad">Overdue</span>'
    : t.dueAt ? '<span class="chip acc">Due ' + esc(tmText(t.dueAt)) + '</span>' : '<span class="chip acc">Today</span>';
  const sub = t.complete ? 'Finished' + (t.completedBy ? ' by ' + esc(t.completedBy) : '') + ' · ' + esc(t.page_title)
    : done + ' of ' + t.total + ' done · ' + esc(t.page_title) + (t.overdue ? ' · was due ' + esc(tmText(t.dueAt)) : '');
  return '<a class="row todo' + (t.overdue ? ' overdue' : '') + (t.complete ? ' complete' : '') + '" href="#/p/' + t.page_id + '?c=' + esc(t.block_id) + '">' +
    '<span class="ring" style="--p:' + (t.total ? Math.round(100 * done / t.total) : 0) + '"></span>' +
    '<div class="t"><b>' + esc(t.title) + '</b><span>' + sub + '</span></div>' + status + '</a>';
}

async function viewSpace(slug) {
  const d = await get('/api/spaces/' + encodeURIComponent(slug));
  setTitle(d.space.name);
  const newBtn = can('editor') ? '<button class="primary btn" id="newPage">' + icon('plus') + 'New page</button>' : '';
  app.innerHTML = `<div class="crumbs"><a href="#/">Home</a><span>/</span></div>
    <div class="bar"><div class="grow"><h1 class="title" style="font-size:22px;letter-spacing:.06em;margin:4px 0 2px">${esc(d.space.name)}</h1><div class="note">${esc(d.space.blurb)}</div></div>${newBtn}</div>
    ${d.pages.length ? '<div class="list">' + d.pages.map((p) => pageRow(p)).join('') + '</div>' : (d.hidden ? '' : '<div class="card empty">No pages in this space yet.</div>')}
    ${d.hidden ? '<div class="locknote" style="margin-top:12px">' + d.hidden + ' Tech only page' + (d.hidden === 1 ? ' is' : 's are') + ' hidden here. ' + (S.state.user ? 'Ask an admin for the Editor role to see ' + (d.hidden === 1 ? 'it' : 'them') + '.' : '<a href="#" id="siT">Sign in</a> as an editor to see ' + (d.hidden === 1 ? 'it' : 'them') + '.') + '</div>' : ''}`;
  const siT = $('#siT'); if (siT) siT.addEventListener('click', (e) => { e.preventDefault(); signInDialog(); });
  const nb = $('#newPage');
  if (nb) nb.addEventListener('click', () => { location.hash = '#/new?space=' + encodeURIComponent(slug); });
}

function renderBlocks(blocks, live = true) {
  return blocks.map((b) => {
    switch (b.type) {
      case 'text': return '<div class="mdb">' + md(b.md) + '</div>';
      case 'callout': {
        const meta = { tip: ['info', 'Tip'], warning: ['warn', 'Warning'], critical: ['alert', 'Sunday-critical'] }[b.kind] || ['info', 'Tip'];
        return '<div class="callout ' + b.kind + '">' + icon(meta[0], 'ci') + '<div class="cb"><span class="cl">' + meta[1] + '</span>' + md(b.md) + '</div></div>';
      }
      case 'checklist': case 'patch': case 'iplist': return Blk.render(b, live);
      case 'image': return '<figure class="pic"><img src="/uploads/' + esc(b.upload) + '" alt="' + esc(b.caption) + '" loading="lazy">' + (b.caption ? '<figcaption>' + esc(b.caption) + '</figcaption>' : '') + '</figure>';
      case 'divider': return '<hr>';
      default: return '';
    }
  }).join('');
}

function wireBlocks(root, page, live = true) {
  Blk.wire(root, page, live);
  $$('figure.pic img', root).forEach((img) => img.addEventListener('click', () => {
    const z = document.createElement('div');
    z.className = 'zoom';
    z.innerHTML = '<img src="' + img.src + '" alt="">';
    z.addEventListener('click', () => z.remove());
    document.body.appendChild(z);
  }));
}

/** Export PDF: the browser's print dialog with a clean layout (Save as PDF). */
function exportPdf(title) {
  const old = document.title;
  document.title = title;
  const after = () => { document.title = old; window.removeEventListener('afterprint', after); };
  window.addEventListener('afterprint', after);
  window.print();
  setTimeout(after, 60000);
}

async function viewPage(id, focusChecklist) {
  let d;
  try { [d] = await Promise.all([get('/api/pages/' + id), loadDevices()]); }
  catch (e) {
    if (e.status === 404) {
      setTitle('Not found');
      app.innerHTML = '<div class="card empty">' + esc(e.message) + (S.state.user ? '' : '<div style="margin-top:12px"><button class="primary" id="si">Sign in</button></div>') + '</div>';
      const b = $('#si'); if (b) b.addEventListener('click', () => signInDialog());
      return;
    }
    throw e;
  }
  const p = d.page;
  setTitle(p.title);
  const pdf = '<button class="btn ghost" id="pB" title="Export PDF">' + icon('pdf') + '<span class="hide-sm">PDF</span></button>';
  const acts = can('editor')
    ? '<button class="btn" id="eB">' + icon('edit') + 'Edit</button>' + pdf + '<button class="btn ghost" id="hB" title="History">' + icon('clock') + '<span class="hide-sm">History</span></button><button class="ghost danger" id="dB" title="Delete page">' + icon('trash') + '</button>'
    : pdf + '<button class="btn ghost" id="hB" title="History">' + icon('clock') + '<span class="hide-sm">History</span></button>';
  app.innerHTML = `<div class="page">
    <div class="printhead"><img src="/icons/livegenie-glyph.svg" alt=""><div><b>LiveGenie</b><span>Rolling Hills Community Church · AVL knowledge base</span></div>
      <div class="pm">${esc(p.space_name)} · version ${p.version} · updated ${esc(when(p.updated_at))}${p.updated_by ? ' by ' + esc(p.updated_by) : ''}<br>Printed ${esc(when(Date.now()))}</div></div>
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/s/${esc(p.space)}">${esc(p.space_name)}</a></div>
    <div class="bar acts-top" style="margin-bottom:0"><div class="grow"><h1 class="title">${esc(p.title)}</h1></div>${acts}</div>
    <div class="meta">${p.tech_only ? '<span class="badge tech">' + icon('lock', 'icon') + 'Tech only</span>' : ''}${p.pinned ? '<span class="badge pin">Pinned</span>' : ''}
      <span>Updated ${esc(ago(p.updated_at))}${p.updated_by ? ' by ' + esc(p.updated_by) : ''} · version ${p.version}</span></div>
    <div class="doc" id="doc">${p.blocks.length ? renderBlocks(p.blocks) : '<p class="note">This page is empty.' + (can('editor') ? ' Tap Edit to add text, steps or pictures.' : '') + '</p>'}</div>
  </div>`;
  wireBlocks($('#doc'), p);
  linkDevices($('#doc'));
  $('#hB').addEventListener('click', () => { location.hash = '#/p/' + p.id + '/history'; });
  $('#pB').addEventListener('click', () => exportPdf(p.title));
  if (focusChecklist) {
    const c = document.getElementById('c-' + focusChecklist) || document.querySelector('[data-pid="' + CSS.escape(focusChecklist) + '"], [data-ipid="' + CSS.escape(focusChecklist) + '"]');
    if (c) setTimeout(() => { c.scrollIntoView({ block: 'start', behavior: 'smooth' }); c.classList.add('flash'); }, 60);
    S.noScroll = true;
  }
  if (can('editor')) {
    $('#eB').addEventListener('click', () => { location.hash = '#/p/' + p.id + '/edit'; });
    $('#dB').addEventListener('click', async () => {
      if (!await confirmBox('Delete this page?', 'It moves to the trash; an editor can bring it back from Settings › Trash.', 'Delete', true)) return;
      try { await call('DELETE', '/api/pages/' + p.id); toast('Page moved to the trash', 'ok'); location.hash = '#/s/' + p.space; }
      catch (e) { toast(e.message, 'bad'); }
    });
  }
}

// ----- editor -----
const BLOCK_TYPES = [
  ['text', 'Text', 'text'], ['callout', 'Callout', 'info'], ['checklist', 'Checklist', 'check'], ['patch', 'Patch list', 'grid'],
  ['iplist', 'IP list', 'net'], ['image', 'Picture', 'image'], ['divider', 'Divider', 'line']
];
const BLOCK_LABELS = { text: 'Text', callout: 'Callout', checklist: 'Checklist', patch: 'Patch list', iplist: 'IP list', image: 'Picture', divider: 'Divider' };
const newBlock = (t, preset) => ({
  text: { type: 'text', md: '' }, callout: { type: 'callout', kind: 'tip', md: '' }, checklist: { type: 'checklist', title: '', items: [], schedule: [] },
  patch: { type: 'patch', title: '', preset: preset || 'input', columns: Blk.PRESETS[preset || 'input'].columns.slice(), rows: [], trace: Blk.PRESETS[preset || 'input'].trace.slice() },
  iplist: { type: 'iplist', title: '', net: { name: '', vlan: '', cidr: '', gateway: '' }, rows: [] },
  image: { type: 'image', upload: '', caption: '' }, divider: { type: 'divider' }
}[t]);

/** Ask which patch list layout to start from. */
function pickPreset() {
  return new Promise((resolve) => {
    const P = Blk.PRESETS;
    const desc = { input: 'Mics and DIs into the desk', output: 'Desk outputs to speakers, IEMs, stream', cable: 'Cable labels, from, to, length and route', custom: 'Your own columns' };
    let picked = null;
    modal('<h3>Add a patch list</h3><p>Pick a starting layout. You can rename or add columns later.</p><div class="plist">' +
      Object.keys(P).map((k) => '<button type="button" class="pchoice" data-k="' + k + '"><b>' + P[k].title + '</b><span>' + desc[k] + '</span><em>' + esc(P[k].columns.join(' · ')) + '</em></button>').join('') +
      '</div><div class="acts"><button type="button" data-close>Cancel</button></div>', (w, close) => {
      w.querySelectorAll('.pchoice').forEach((b) => b.addEventListener('click', () => { picked = b.dataset.k; close(); resolve(picked); }));
      w.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(null)));
    });
  });
}

async function viewEdit(id, spaceSlug, drawBlock) {
  if (!can('editor')) {
    if (!S.state.user) { signInDialog(() => route()); app.innerHTML = '<div class="card empty">Sign in as an editor to edit pages.</div>'; return; }
    app.innerHTML = '<div class="card empty">Your role can read pages but not edit them. Ask an admin for the Editor role.</div>'; return;
  }
  const sp = await get('/api/spaces');
  S.spaces = sp.spaces;
  if (id) {
    const d = await get('/api/pages/' + id);
    const p = d.page;
    S.ed = { id: p.id, title: p.title, space: p.space, tech_only: p.tech_only, pinned: p.pinned, blocks: p.blocks.map((b) => ({ ...b, _items: b.items ? b.items.join('\n') : undefined })), baseVersion: p.version };
  } else {
    const sp0 = spaceSlug || (S.spaces[0] && S.spaces[0].slug);
    S.ed = { id: null, title: '', space: sp0, tech_only: sp0 === 'network', pinned: false, blocks: [newBlock('text')], baseVersion: undefined };
  }
  S.dirty = false;
  setTitle(id ? 'Edit ' + S.ed.title : 'New page');
  const ed = S.ed;
  app.innerHTML = `<div class="ed">
    <div class="crumbs"><a href="#/">Home</a><span>/</span><span>${id ? 'Edit page' : 'New page'}</span></div>
    <div class="head" style="margin-top:8px">
      <input class="title-in" id="eT" placeholder="Page title" value="${esc(ed.title)}" maxlength="200">
      <div class="opts">
        <select id="eS" aria-label="Space">${S.spaces.map((s) => '<option value="' + esc(s.slug) + '"' + (s.slug === ed.space ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('')}</select>
        <label class="tog ${ed.tech_only ? 'on' : ''}" title="Only editors and admins can see Tech only pages"><input type="checkbox" id="eTech" ${ed.tech_only ? 'checked' : ''}>Tech only</label>
        <label class="tog ${ed.pinned ? 'on' : ''}" title="Pinned pages show at the top of the home page"><input type="checkbox" id="ePin" ${ed.pinned ? 'checked' : ''}>Pinned</label>
      </div>
    </div>
    <div id="eB"></div>
    <div class="adder"><span class="note">Add</span>${BLOCK_TYPES.map((t) => '<button class="btn" data-add="' + t[0] + '">' + icon(t[2]) + t[1] + '</button>').join('')}</div>
    <div class="edbar"><span class="note" id="eMsg"></span><button id="eCancel">Cancel</button><button class="primary" id="eSave">${id ? 'Save' : 'Create page'}</button></div>
  </div>`;
  const dirty = () => { S.dirty = true; $('#eMsg').textContent = 'Unsaved changes'; };
  $('#eT').addEventListener('input', (e) => { ed.title = e.target.value; dirty(); });
  let techTouched = !!id;
  const setTech = (on) => { ed.tech_only = on; $('#eTech').checked = on; $('#eTech').closest('.tog').classList.toggle('on', on); };
  $('#eS').addEventListener('change', (e) => { ed.space = e.target.value; if (!techTouched) setTech(ed.space === 'network'); dirty(); });
  $('#eTech').addEventListener('change', (e) => { techTouched = true; setTech(e.target.checked); dirty(); });
  $('#ePin').addEventListener('change', (e) => { ed.pinned = e.target.checked; e.target.closest('.tog').classList.toggle('on', e.target.checked); dirty(); });
  $$('[data-add]').forEach((b) => b.addEventListener('click', async () => {
    let preset;
    if (b.dataset.add === 'patch') { preset = await pickPreset(); if (!preset) return; }
    ed.blocks.push(newBlock(b.dataset.add, preset)); dirty(); paintBlocks();
    if (b.dataset.add === 'iplist' && !ed.tech_only && !techTouched) { setTech(true); toast('Tech only is on: IP lists are hidden from volunteers. Switch it off above if you like.'); }
    const last = $$('#eB .blk').pop();
    if (last) {
      last.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const f = $('.rtx, textarea, input:not([type=file]), [data-pick]', last);
      if (f && f.classList.contains('rtx')) { f.focus({ preventScroll: true }); } else if (f && f.focus) f.focus({ preventScroll: true });
    }
  }));
  $('#eCancel').addEventListener('click', () => { location.hash = id ? '#/p/' + id : (ed.space ? '#/s/' + ed.space : '#/'); });
  $('#eSave').addEventListener('click', save);

  function paintBlocks() {
    const host = $('#eB');
    host.innerHTML = ed.blocks.map((b, i) => {
      const label = BLOCK_LABELS[b.type];
      let body = '';
      if (b.type === 'text') body = '<div data-rte="full"></div>';
      if (b.type === 'callout') body = '<div class="seg" style="margin-bottom:8px">' + [['tip', 'Tip'], ['warning', 'Warning'], ['critical', 'Sunday-critical']].map((k) => '<button data-kind="' + k[0] + '" class="' + (b.kind === k[0] ? 'on' : '') + '">' + k[1] + '</button>').join('') + '</div><div data-rte="compact"></div>';
      if (b.type === 'checklist' || b.type === 'patch' || b.type === 'iplist') body = '<div data-blk></div>';
      if (b.type === 'image') body = (b.upload ? '<img class="imgprev" src="/uploads/' + esc(b.upload) + '" alt=""><button data-repick>Replace picture</button>' : '<div class="drop" data-pick>' + icon('image') + '<div>Tap to choose a picture or take a photo</div><div class="note">Large photos are shrunk before upload</div></div>') +
        '<input type="file" accept="image/*" class="hide" data-file><input class="full" data-f="caption" placeholder="Caption (optional)" value="' + esc(b.caption) + '" style="margin-top:8px">';
      if (b.type === 'divider') body = '<hr style="border:0;border-top:1px solid var(--line);margin:4px 0">';
      return '<div class="blk" data-i="' + i + '"><div class="bh"><b>' + label + '</b>' +
        '<button data-mv="-1" title="Move up"' + (i === 0 ? ' disabled' : '') + '>' + icon('up') + '</button>' +
        '<button data-mv="1" title="Move down"' + (i === ed.blocks.length - 1 ? ' disabled' : '') + '>' + icon('down') + '</button>' +
        '<button data-del title="Remove block">' + icon('x') + '</button></div>' + body + '</div>';
    }).join('') || '<div class="card empty">No blocks yet. Add text, a checklist or a picture below.</div>';

    $$('.blk', host).forEach((el) => {
      const i = Number(el.dataset.i);
      const b = ed.blocks[i];
      $$('[data-f]', el).forEach((f) => f.addEventListener('input', () => { b[f.dataset.f] = f.value; dirty(); }));
      $$('[data-kind]', el).forEach((k) => k.addEventListener('click', () => { b.kind = k.dataset.kind; dirty(); $$('[data-kind]', el).forEach((x) => x.classList.toggle('on', x === k)); }));
      $$('[data-mv]', el).forEach((m) => m.addEventListener('click', () => {
        const j = i + Number(m.dataset.mv);
        if (j < 0 || j >= ed.blocks.length) return;
        [ed.blocks[i], ed.blocks[j]] = [ed.blocks[j], ed.blocks[i]];
        dirty(); paintBlocks();
      }));
      const rte = $('[data-rte]', el);
      if (rte) {
        const r = Rich.create({ md: b.md, compact: rte.dataset.rte === 'compact', placeholder: b.type === 'text' ? 'Write here. Use the buttons above for headings, bold, lists and tables.' : 'What should people know?', onChange: (v) => { b.md = v; dirty(); } });
        rte.appendChild(r.el);
      }
      const bh = $('[data-blk]', el);
      if (bh) ({ checklist: Blk.editChecklist, patch: Blk.editPatch, iplist: Blk.editIplist })[b.type](bh, b, dirty);
      $('[data-del]', el).addEventListener('click', async () => {
        const hasContent = (b.md && b.md.trim()) || (b._items && b._items.trim()) || b.upload || (b.items && b.items.length) ||
          (b.rows && b.rows.some((r) => Object.values(r).some((v) => String(v || '').trim())));
        if (hasContent && !await confirmBox('Remove this block?', 'Its content will be gone from this page (older versions keep it).', 'Remove', true)) return;
        ed.blocks.splice(i, 1); dirty(); paintBlocks();
      });
      const file = $('[data-file]', el);
      if (file) {
        const pick = () => file.click();
        const zone = $('[data-pick]', el);
        if (zone) {
          zone.addEventListener('click', pick);
          zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
          zone.addEventListener('dragleave', () => zone.classList.remove('over'));
          zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files[0]) uploadInto(b, e.dataTransfer.files[0]); });
        }
        const rp = $('[data-repick]', el); if (rp) rp.addEventListener('click', pick);
        file.addEventListener('change', () => { if (file.files[0]) uploadInto(b, file.files[0]); });
      }
    });
  }

  async function uploadInto(b, f) {
    $('#eMsg').textContent = 'Uploading picture…';
    try {
      const pic = await shrink(f);
      const r = await call('POST', '/api/uploads', pic.blob, { raw: true, type: pic.type, headers: { 'x-width': String(pic.w || ''), 'x-height': String(pic.h || '') } });
      b.upload = r.id; dirty(); paintBlocks();
    } catch (e) { toast(e.message, 'bad'); $('#eMsg').textContent = S.dirty ? 'Unsaved changes' : ''; }
  }

  async function save() {
    const blocks = ed.blocks.map((b) => {
      const c = { ...b };
      if (c.type === 'checklist') { c.items = String(c._items !== undefined ? c._items : (c.items || []).join('\n')).split('\n').map((s) => s.trim()).filter(Boolean); }
      if (c.type === 'checklist' && (c.schedule || []).some((r) => !r.reset)) c.schedule = c.schedule.filter((r) => r.reset);
      delete c._items;
      return c;
    }).filter((b) => !(b.type === 'image' && !b.upload));
    const body = { title: ed.title, space: ed.space, tech_only: ed.tech_only, pinned: ed.pinned, blocks, baseVersion: ed.baseVersion };
    $('#eSave').disabled = true;
    try {
      if (ed.id) { await call('PUT', '/api/pages/' + ed.id, body); S.dirty = false; toast('Saved', 'ok'); location.hash = '#/p/' + ed.id; }
      else { const r = await call('POST', '/api/pages', body); S.dirty = false; toast('Page created', 'ok'); location.hash = '#/p/' + r.id; }
    } catch (e) { toast(e.message, 'bad'); }
    finally { const b = $('#eSave'); if (b) b.disabled = false; }
  }

  if (drawBlock) { const blk = ed.blocks.find((x) => x.id === drawBlock); if (blk) blk._view = 'draw'; }
  paintBlocks();
  if (!id) $('#eT').focus();
  if (drawBlock) {
    const i = ed.blocks.findIndex((x) => x.id === drawBlock);
    const el = $$('#eB .blk')[i];
    if (el) { S.noScroll = true; setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60); }
  }
}

/** Shrink big photos to at most 1600 px on the long side before upload. */
async function shrink(file) {
  const type = file.type || 'image/jpeg';
  if (!/^image\//.test(type)) throw new Error('That file is not a picture');
  if (type === 'image/gif') return { blob: file, type };
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { if (file.size > 15 * 1048576) throw new Error('That picture is too large (15 MB at most)'); return { blob: file, type }; }
  const max = 1600;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  if (k === 1 && file.size < 1.5 * 1048576 && /png|jpeg|webp/.test(type)) return { blob: file, type, w, h };
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const outType = type === 'image/png' && file.size < 4 * 1048576 ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((res) => c.toBlob(res, outType, 0.86));
  return { blob, type: outType, w, h };
}

// ----- history -----
async function viewHistory(id, v) {
  const [pg, hv] = await Promise.all([get('/api/pages/' + id), get('/api/pages/' + id + '/versions')]);
  const p = pg.page;
  const pick = Number(v) || hv.versions[0].version;
  const ver = (await get('/api/pages/' + id + '/versions/' + pick)).version;
  setTitle('History · ' + p.title);
  const isCurrent = pick === p.version;
  app.innerHTML = `<div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/s/${esc(p.space)}">${esc(p.space_name)}</a><span>/</span><a href="#/p/${p.id}">${esc(p.title)}</a></div>
    <div class="bar"><div class="grow"><h1 class="title" style="font-size:20px;margin:4px 0 0">History</h1><div class="note">${hv.versions.length} saved version${hv.versions.length === 1 ? '' : 's'}</div></div></div>
    <div class="hist">
      <div class="list">${hv.versions.map((x) => `<a class="row ${x.version === pick ? 'on' : ''}" href="#/p/${p.id}/history/${x.version}"><div class="t"><b>Version ${x.version}${x.version === p.version ? ' (current)' : ''}</b><span>${esc(x.saved_by || 'Unknown')} · ${esc(when(x.saved_at))}${x.note ? ' · ' + esc(x.note) : ''}</span></div></a>`).join('')}</div>
      <div class="card page" style="margin:0">
        <div class="bar" style="margin-bottom:6px"><div class="grow"><div class="note">Version ${ver.version} · ${esc(ver.saved_by || '')} · ${esc(when(ver.saved_at))}${ver.tech_only ? ' · Tech only' : ''} · ${esc(spaceName(ver.space))}</div></div>
          ${!isCurrent && can('editor') ? '<button class="primary btn" id="rB">' + icon('restore') + 'Restore this version</button>' : ''}</div>
        <h1 class="title" style="font-size:20px">${esc(ver.title)}</h1>
        <div class="doc" id="doc">${renderBlocks(ver.blocks, false)}</div>
      </div>
    </div>`;
  wireBlocks($('#doc'), { id: p.id, blocks: ver.blocks }, false);
  await loadDevices(); linkDevices($('#doc'));
  const rb = $('#rB');
  if (rb) rb.addEventListener('click', async () => {
    if (!await confirmBox('Restore version ' + ver.version + '?', 'This saves it as a new version on top. Nothing is lost; the current version stays in the history.', 'Restore')) return;
    try { await call('POST', '/api/pages/' + p.id + '/versions/' + ver.version + '/restore'); toast('Version ' + ver.version + ' restored', 'ok'); location.hash = '#/p/' + p.id; }
    catch (e) { toast(e.message, 'bad'); }
  });
}

// ----- search -----
async function viewSearch(q) {
  $('#q').value = q;
  setTitle('Search');
  const d = await get('/api/search?q=' + encodeURIComponent(q));
  app.innerHTML = `<div class="bar"><div class="grow"><h2 style="margin:0">Results for “${esc(q)}”</h2></div><span class="note">${d.results.length} page${d.results.length === 1 ? '' : 's'}</span></div>
    ${d.devices.length ? '<div class="section"><div class="dgrid">' + d.devices.map((v) => '<a class="dcard" href="#/d/' + v.id + '">' + devThumb(v, 40) + '<div class="t"><b>' + esc(v.name) + '</b><span>' + esc([v.make, v.model].filter(Boolean).join(' ')) + '</span><span>' + esc(v.location) + (v.ips.length ? ' <span class="mono">' + esc(v.ips[0]) + '</span>' : '') + '</span></div></a>').join('') + '</div></div>' : ''}
    ${d.results.length ? '<div class="list">' + d.results.map((p) => pageRow(p, { snip: true })).join('') + '</div>'
      : '<div class="card empty">Nothing matches that yet.' + (S.state.user ? '' : ' Some pages are Tech only and need you to sign in.') + (can('editor') ? '<div style="margin-top:12px"><a href="#/new">Write a page about it</a></div>' : '') + '</div>'}`;
}

// ----- settings -----
const TABS = [
  ['display', 'Display', 'sun', 'viewer'], ['account', 'Account', 'user', 'viewer'], ['users', 'Users', 'users', 'admin'],
  ['notify', 'Notifications', 'bell', 'admin'], ['backups', 'Backups', 'box', 'admin'], ['trash', 'Trash', 'trash', 'editor'], ['activity', 'Activity', 'list', 'admin'], ['about', 'About', 'spark', 'viewer']
];

async function viewSettings(tab) {
  const tabs = TABS.filter((t) => can(t[3]));
  if (!tabs.find((t) => t[0] === tab)) tab = 'display';
  setTitle('Settings');
  app.innerHTML = `<div class="setup"><div class="side">${tabs.map((t) => '<button data-tab="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + icon(t[2]) + t[1] + '</button>').join('')}</div><div class="pane" id="pane"></div></div>`;
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/settings/' + b.dataset.tab; }));
  const pane = $('#pane');
  await ({ display: tabDisplay, account: tabAccount, users: tabUsers, notify: tabNotify, backups: tabBackups, trash: tabTrash, activity: tabActivity, about: tabAbout }[tab])(pane);
}

const setRow = (title, sub, ctl, first) => '<div class="set' + (first ? ' first' : '') + '"><div class="sl"><b>' + title + '</b><span>' + (sub || '') + '</span></div><div class="sc">' + ctl + '</div></div>';

function tabDisplay(pane) {
  let pref = 'auto';
  try { pref = localStorage.getItem('livegenie-theme') || 'auto'; } catch (e) { /* default */ }
  pane.innerHTML = '<div class="card"><h2>Display</h2>' + setRow('Theme', 'Auto follows this device. Saved on this device only.',
    '<div class="seg" id="th">' + ['auto', 'dark', 'light'].map((t) => '<button data-t="' + t + '" class="' + (t === pref ? 'on' : '') + '">' + t[0].toUpperCase() + t.slice(1) + '</button>').join('') + '</div>', true) + '</div>';
  $$('#th button').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem('livegenie-theme', b.dataset.t); } catch (e) { /* private mode */ }
    applyTheme();
    $$('#th button').forEach((x) => x.classList.toggle('on', x === b));
  }));
}

function applyTheme() {
  let p = 'auto';
  try { p = localStorage.getItem('livegenie-theme') || 'auto'; } catch (e) { /* default */ }
  const light = p === 'light' || (p === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

function tabAccount(pane) {
  const u = S.state.user;
  if (!u) {
    pane.innerHTML = '<div class="card"><h2>Account</h2>' + setRow('Not signed in', 'Anyone on the church network can read pages that are not Tech only. Sign in to edit or to see Tech only pages.', '<button class="primary" id="si">Sign in</button>', true) + '</div>';
    $('#si').addEventListener('click', () => signInDialog());
    return;
  }
  const roleText = { admin: 'Admin: everything, including users and backups', editor: 'Editor: write pages, see Tech only pages', volunteer: 'Volunteer: read pages and use checklists' }[u.role];
  pane.innerHTML = '<div class="card"><h2>Account</h2>' + setRow(esc(u.name), roleText, '<button id="so">Sign out</button>', true) + '</div>' +
    '<div class="card"><h2>Change PIN</h2><form id="pf">' +
    setRow('Current PIN', '', '<input class="num" id="p0" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password">', true) +
    setRow('New PIN', '4 to 8 digits', '<input class="num" id="p1" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">') +
    setRow('New PIN again', '', '<input class="num" id="p2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">') +
    setRow('', '', '<button class="primary">Change PIN</button>') + '</form></div>';
  $('#so').addEventListener('click', async () => { await call('POST', '/api/signout'); await loadState(); paintHeader(); toast('Signed out'); location.hash = '#/'; });
  $('#pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#p1').value !== $('#p2').value) return toast('The two new PINs are not the same', 'bad');
    try { await call('POST', '/api/me/pin', { current: $('#p0').value, pin: $('#p1').value }); toast('PIN changed', 'ok'); $('#pf').reset(); }
    catch (err) { toast(err.message, 'bad'); }
  });
}

async function tabUsers(pane) {
  const d = await get('/api/users');
  const roleName = { admin: 'Admin', editor: 'Editor', volunteer: 'Volunteer' };
  pane.innerHTML = '<p class="note pnote">Admins manage everything. Editors write pages and see Tech only pages. Volunteers read and use checklists. People who are not signed in can read pages that are not Tech only.</p>' +
    '<div class="card"><h2>Users</h2>' + d.users.map((u, i) => setRow(esc(u.name) + (u.id === S.state.user.id ? ' <span class="note">(you)</span>' : ''),
      roleName[u.role] + (u.locked ? ' · <span style="color:var(--warn)">locked after wrong PINs</span>' : '') + ' · added ' + esc(ago(u.created_at)),
      '<button data-edit="' + u.id + '">Edit</button>' + (u.id !== S.state.user.id ? '<button class="danger ghost" data-rm="' + u.id + '">Remove</button>' : ''), i === 0)).join('') +
    setRow('', '', '<button class="primary btn" id="addU">' + icon('plus') + 'Add user</button>') + '</div>';
  const form = (u) => `<h3>${u ? 'Edit ' + esc(u.name) : 'Add a user'}</h3><p>${u ? 'Leave the PIN empty to keep it.' : 'They sign in with this name and PIN.'}</p><form id="uf">
    <label for="un">Name</label><input id="un" value="${esc(u ? u.name : '')}" autocapitalize="words">
    <label for="ur">Role</label><select id="ur">${['volunteer', 'editor', 'admin'].map((r) => '<option value="' + r + '"' + ((u ? u.role : 'volunteer') === r ? ' selected' : '') + '>' + roleName[r] + '</option>').join('')}</select>
    <label for="up">${u ? 'New PIN (optional)' : 'PIN (4 to 8 digits)'}</label><input id="up" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">
    ${u && u.locked ? '<label class="tog" style="margin-top:12px"><input type="checkbox" id="uu" checked> Unlock now</label>' : ''}
    <div class="err" id="ue"></div><div class="acts"><button type="button" data-close>Cancel</button><button class="primary">${u ? 'Save' : 'Add user'}</button></div></form>`;
  const open = (u) => modal(form(u), (w, close) => {
    $('#uf', w).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: $('#un', w).value, role: $('#ur', w).value, pin: $('#up', w).value };
      if (u && $('#uu', w)) body.unlock = $('#uu', w).checked;
      try {
        if (u) await call('PUT', '/api/users/' + u.id, body); else await call('POST', '/api/users', body);
        close(); toast(u ? 'Saved' : 'User added', 'ok');
        if (u && u.id === S.state.user.id) { await loadState(); paintHeader(); }
        tabUsers(pane);
      } catch (err) { $('#ue', w).textContent = err.message; }
    });
  });
  $('#addU').addEventListener('click', () => open(null));
  $$('[data-edit]', pane).forEach((b) => b.addEventListener('click', () => open(d.users.find((u) => u.id === Number(b.dataset.edit)))));
  $$('[data-rm]', pane).forEach((b) => b.addEventListener('click', async () => {
    const u = d.users.find((x) => x.id === Number(b.dataset.rm));
    if (!await confirmBox('Remove ' + u.name + '?', 'They can no longer sign in. Pages they wrote stay.', 'Remove', true)) return;
    try { await call('DELETE', '/api/users/' + u.id); toast('Removed', 'ok'); tabUsers(pane); } catch (e) { toast(e.message, 'bad'); }
  }));
}

async function tabBackups(pane) {
  const d = await get('/api/backups');
  const kind = { nightly: 'Nightly', manual: 'Made by hand', 'before-restore': 'Saved before a restore', 'before-update': 'Saved before an update', uploaded: 'Uploaded' };
  pane.innerHTML = '<div class="card"><h2>Backups</h2>' +
    setRow('Nightly backup', 'Next one ' + esc(when(d.nextAt)) + '. Kept for ' + d.keepDays + ' days in the data folder. Each backup holds every page, user and picture (' + d.stats.pages + ' pages, ' + d.stats.pictures + ' pictures).', '<button class="primary btn" id="bNow">' + icon('box') + 'Back up now</button>', true) +
    setRow('Restore from a file', 'A backup file downloaded from LiveGenie (.tar).', '<button class="btn" id="bUp">' + icon('upload') + 'Upload backup</button><input type="file" id="bFile" accept=".tar,application/x-tar" class="hide">') +
    '</div><div class="card"><h2>Saved backups</h2>' + (d.backups.length ? d.backups.map((b, i) => setRow(esc(when(b.at)), esc(kind[b.kind] || b.kind) + ' · ' + bytes(b.bytes),
      '<a class="abtn" href="/api/backups/' + encodeURIComponent(b.name) + '/download" download title="Download" aria-label="Download">' + icon('download') + '</a><button data-restore="' + esc(b.name) + '">Restore</button><button class="ghost danger" data-del="' + esc(b.name) + '" title="Delete">' + icon('trash') + '</button>', i === 0)).join('')
      : '<div class="note">No backups yet. The first nightly one runs at ' + esc(when(d.nextAt)) + '.</div>') + '</div>' +
    '<p class="note pnote">Also keep the TrueNAS dataset in a snapshot schedule, so a lost disk does not take the backups with it.</p>';
  $('#bNow').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await call('POST', '/api/backups/now'); toast('Backup saved', 'ok'); tabBackups(pane); } catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
  });
  $('#bUp').addEventListener('click', () => $('#bFile').click());
  $('#bFile').addEventListener('change', async () => {
    const f = $('#bFile').files[0];
    if (!f) return;
    toast('Uploading backup…');
    try { const r = await call('POST', '/api/backups/upload', f, { raw: true, type: 'application/x-tar' }); toast('Backup uploaded. Use Restore on it to bring it back.', 'ok'); tabBackups(pane); void r; }
    catch (err) { toast(err.message, 'bad'); }
  });
  $$('[data-del]', pane).forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmBox('Delete this backup?', 'The file is removed from the data folder.', 'Delete', true)) return;
    try { await call('DELETE', '/api/backups/' + encodeURIComponent(b.dataset.del)); tabBackups(pane); } catch (e) { toast(e.message, 'bad'); }
  }));
  $$('[data-restore]', pane).forEach((b) => b.addEventListener('click', async () => {
    let info;
    try { info = (await get('/api/backups/' + encodeURIComponent(b.dataset.restore) + '/inspect')).info; } catch (e) { return toast(e.message, 'bad'); }
    const ok = await confirmBox('Restore this backup?', 'It holds ' + info.pages + ' pages, ' + info.users + ' users and ' + info.pictures + ' pictures. Everything changed since then is replaced. The current data is saved as a backup first, then LiveGenie restarts (about 10 seconds).', 'Restore and restart', true);
    if (!ok) return;
    try { await call('POST', '/api/backups/' + encodeURIComponent(b.dataset.restore) + '/restore'); }
    catch (e) { return toast(e.message, 'bad'); }
    const m = modal('<h3>Restoring…</h3><p>LiveGenie is restarting with the backup. This page reloads by itself.</p><div style="display:flex;justify-content:center;padding:8px"><span class="spin" style="border-color:var(--line);border-top-color:var(--acc);width:22px;height:22px"></span></div>');
    m.wrap.dataset.locked = '1';
    const started = Date.now();
    const poll = async () => {
      try { const r = await fetch('/api/health', { cache: 'no-store' }); if (r.ok && Date.now() - started > 1500) { location.hash = '#/'; location.reload(); return; } } catch (e) { /* still restarting */ }
      if (Date.now() - started > 90000) { $('p', m.wrap).textContent = 'LiveGenie has not come back yet. If it runs outside Docker, start it again by hand.'; return; }
      setTimeout(poll, 1500);
    };
    setTimeout(poll, 2000);
  }));
}

async function tabNotify(pane) {
  const d = await get('/api/settings/notify');
  const ha = `alias: LiveGenie overdue checklist
triggers:
  - trigger: webhook
    webhook_id: livegenie_overdue
    allowed_methods: [POST]
    local_only: true
actions:
  - action: notify.notify   # or notify.mobile_app_your_phone
    data:
      title: "{{ trigger.json.title }}"
      message: "{{ trigger.json.message }}"
      data:
        url: "{{ trigger.json.url }}"
        clickAction: "{{ trigger.json.url }}"`;
  pane.innerHTML = '<p class="note pnote">Overdue checklists always show in LiveGenie: red on the checklist, on the To do list and in the header. To also get them on your phone, send them to a webhook. Each overdue checklist sends one notice.</p>' +
    '<div class="card"><h2>Webhook</h2><form id="nf">' +
    setRow('Webhook address', 'LiveGenie sends a POST with JSON (title, message, page, items left, link). Leave empty to turn it off.', '<input class="txt" id="nw" style="width:340px" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="http://homeassistant.local:8123/api/webhook/livegenie_overdue" value="' + esc(d.webhook) + '">', true) +
    setRow('', d.baseUrl ? 'Links in notices open ' + esc(d.baseUrl) + ' (the address you use right now, saved when you press Save).' : 'Links in notices use the address you are on when you press Save.', '<button type="button" id="nt">Send test</button><button class="primary">Save</button>') +
    '</form></div>' +
    '<div class="card"><h2>Home Assistant</h2><p class="note" style="margin:0 0 8px">In Home Assistant: Settings › Automations › Create automation › ⋮ › Edit in YAML, paste this, and save. Then use <span class="mono">http://&lt;home-assistant&gt;:8123/api/webhook/livegenie_overdue</span> above. Home Assistant must be reachable from the LiveGenie server.</p>' +
    '<pre class="code">' + esc(ha) + '</pre><button type="button" id="cp">Copy</button></div>';
  const save = async () => { await call('PUT', '/api/settings/notify', { webhook: $('#nw').value.trim() }); };
  $('#nf').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await save(); toast('Saved', 'ok'); tabNotify(pane); } catch (err) { toast(err.message, 'bad'); }
  });
  $('#nt').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await save(); await call('POST', '/api/settings/notify/test'); toast('Test sent. Check your phone.', 'ok'); }
    catch (err) { toast(err.message, 'bad'); }
    finally { e.target.disabled = false; }
  });
  $('#cp').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ha); toast('Copied', 'ok'); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('pre.code', pane)); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Selected. Copy it with your keyboard or long-press.'); }
  });
}

async function tabTrash(pane) {
  const d = await get('/api/trash');
  pane.innerHTML = '<div class="card"><h2>Trash</h2>' + (d.pages.length ? d.pages.map((p, i) => setRow(esc(p.title), esc(p.space_name) + ' · deleted ' + esc(ago(p.deleted_at)) + (p.deleted_by ? ' by ' + esc(p.deleted_by) : ''), '<button data-un="' + p.id + '">Restore</button>', i === 0)).join('')
    : '<div class="note">The trash is empty.</div>') + '</div>';
  $$('[data-un]', pane).forEach((b) => b.addEventListener('click', async () => {
    try { await call('POST', '/api/trash/' + b.dataset.un + '/restore'); toast('Page restored', 'ok'); tabTrash(pane); } catch (e) { toast(e.message, 'bad'); }
  }));
}

async function tabActivity(pane) {
  const d = await get('/api/activity');
  const what = {
    'page.create': 'created page', 'page.edit': 'edited page', 'page.delete': 'deleted page', 'page.undelete': 'restored page', signin: 'signed in',
    'user.create': 'added user', 'user.edit': 'changed user', 'user.delete': 'removed user', 'backup.make': 'made a backup', 'backup.nightly': 'Nightly backup',
    'checklist.reset': 'reset a checklist', 'device.create': 'added device', 'device.edit': 'changed device', 'device.delete': 'deleted device', 'vlan.create': 'added', 'vlan.edit': 'changed', 'vlan.delete': 'deleted', 'map.layout': 'arranged the map', 'notify.overdue': 'Overdue notice', 'settings.notify': 'changed notifications',
    'backup.upload': 'uploaded a backup', 'backup.restore': 'restored a backup', 'backup.restored': 'Restore finished', 'backup.delete': 'deleted a backup'
  };
  pane.innerHTML = '<div class="card"><h2>Activity</h2>' + (d.activity.length ? d.activity.map((a, i) => setRow(
    esc(a.user_name || 'LiveGenie') + ' ' + esc(what[a.action] || a.action), esc([/^page\./.test(a.action) ? '' : a.target, a.detail].filter(Boolean).join(' · ')), '<span class="val">' + esc(ago(a.at)) + '</span>', i === 0)).join('')
    : '<div class="note">Nothing yet.</div>') + '</div>';
}

function tabAbout(pane) {
  const u = S.state.update || {};
  const status = !u.enabled ? 'Update checks are turned off (LIVEGENIE_NO_UPDATE_CHECK).'
    : u.available ? 'Version ' + esc(u.latest) + ' is available.'
    : u.checkedAt ? (u.failed ? 'Could not reach GitHub at the last check.' : 'You have the newest version.') + ' Checked ' + esc(ago(u.checkedAt)) + '.' : 'Checking…';
  pane.innerHTML = (u.available ? '<div class="okbox"><b>LiveGenie ' + esc(u.latest) + ' is available.</b> In TrueNAS: Apps › LiveGenie › Edit, then save to pull the new image (the app uses <span class="mono">' + esc(u.image.replace(/:.*/, ':latest')) + '</span> and always pulls). Your data is kept.</div>' : '') +
    '<div class="card"><h2>About</h2>' + setRow('LiveGenie ' + esc(S.state.version), 'The RHCC AVL knowledge base. Part of the Live series.', '', true) +
    setRow('Updates', status, can('admin') ? '<button id="chk">Check now</button>' : '') +
    setRow('Image', '<span class="mono">ghcr.io/leonidis2013/livegenie</span>', '') +
    setRow('Coming next', '0.3.0 adds the document library and AI drafts from the Jetson; Bitfocus Companion buttons in checklists follow.', '') +
    '</div><p class="note pnote">© 2026 Jerod Ulicki</p>';
  const c = $('#chk');
  if (c) c.addEventListener('click', async () => {
    c.disabled = true;
    try { const r = await call('POST', '/api/update-check'); S.state.update = r.update; paintHeader(); tabAbout(pane); }
    catch (e) { toast(e.message, 'bad'); c.disabled = false; }
  });
}

// ---------- router ----------
let routing = 0;
async function route() {
  const n = ++routing;
  if (!S.state) await loadState();
  if (!S.state) return;
  paintHeader();
  const h = location.hash || '#/';
  const [pathPart, query] = h.slice(1).split('?');
  const qs = new URLSearchParams(query || '');
  const p = pathPart.split('/').filter(Boolean);
  markGear(p[0] === 'settings');
  if (p[0] !== 'settings') S.lastRoute = h;
  if (p[0] !== 'search') $('#q').value = '';
  try {
    if (S.state.setupNeeded) return await viewSetup();
    if (!p.length) await viewHome();
    else if (p[0] === 's' && p[1]) await viewSpace(p[1]);
    else if (p[0] === 'p' && p[1] && p[2] === 'edit') await viewEdit(p[1], null, qs.get('draw'));
    else if (p[0] === 'p' && p[1] && p[2] === 'history') await viewHistory(p[1], p[3]);
    else if (p[0] === 'p' && p[1]) await viewPage(p[1], qs.get('c'));
    else if (p[0] === 'new') await viewEdit(null, qs.get('space'));
    else if (p[0] === 'map') await viewMap(p[1]);
    else if (p[0] === 'devices' && p[1] === 'new') await viewDeviceEdit(null);
    else if (p[0] === 'devices') await viewDevices(qs);
    else if (p[0] === 'd' && p[1] && p[2] === 'edit') await viewDeviceEdit(p[1]);
    else if (p[0] === 'd' && p[1]) await viewDevice(p[1]);
    else if (p[0] === 'search') await viewSearch(qs.get('q') || '');
    else if (p[0] === 'settings') await viewSettings(p[1]);
    else app.innerHTML = '<div class="card empty">Page not found. <a href="#/">Go home</a></div>';
    if (n === routing && !S.noScroll) window.scrollTo(0, 0);
    S.noScroll = false;
  } catch (e) {
    if (n !== routing) return;
    if (!S.offline) app.innerHTML = '<div class="card empty">' + esc(e.message) + '<div style="margin-top:12px"><a href="#/">Go home</a></div></div>';
  }
}

let lastHash = location.hash;
window.addEventListener('hashchange', (e) => {
  if (S.dirty) {
    if (!confirm('Leave without saving? Your changes will be lost.')) { history.replaceState(null, '', lastHash); return; }
    S.dirty = false;
  }
  lastHash = location.hash;
  route();
});
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

route();
