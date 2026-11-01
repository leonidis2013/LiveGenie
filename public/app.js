/*
 * LiveGenie web page. Plain JavaScript, no build step.
 * Routes (after #): /  /todo  /s/<space>  /p/<id>  /p/<id>/edit  /p/<id>/history[/<v>]  /new[?space=]  /search?q=  /settings[/<tab>]
 */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

const S = { state: null, dirty: false, lastRoute: '#/', offline: false, ed: null };
const RANK = { viewer: 0, user: 1, admin: 3 };
const can = (role) => (RANK[S.state ? S.state.role : 'viewer'] || 0) >= RANK[role];
/** An admin looking at LiveGenie the way users see it (kept for this browser tab). */
const viewAs = () => { try { return sessionStorage.getItem('livegenie-view-as') === 'user'; } catch (e) { return false; } };

// ---------- icons ----------
const ICONS = {
  chev: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  wave: '<path d="M3 12h3l2-6 4 12 3-9 2 3h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01"/>',
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
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  spark: '<path d="M12 3c.6 3.7 1.3 4.4 5 5-3.7.6-4.4 1.3-5 5-.6-3.7-1.3-4.4-5-5 3.7-.6 4.4-1.3 5-5z"/>'
};
const icon = (n, cls = 'icon') => '<svg class="' + cls + '" viewBox="0 0 24 24">' + (ICONS[n] || '') + '</svg>';

// ---------- talking to the server ----------
async function call(method, url, body, opts = {}) {
  const headers = { 'x-livegenie': '1' };
  if (viewAs()) headers['x-view-as'] = 'user';
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
  $('#sVer').textContent = st.version;
  document.body.classList.toggle('setupmode', !!st.setupNeeded || !st.user);
  document.body.classList.toggle('signmode', !st.setupNeeded && !st.user);
  document.body.classList.toggle('viewas', !!st.viewAs);
  let vb = $('#vasbar');
  if (st.viewAs && !vb) {
    vb = document.createElement('div'); vb.id = 'vasbar'; vb.className = 'vasbar';
    vb.innerHTML = '<span>' + icon('user') + '<span>Viewing as a user<span class="long"> · this is what users see</span></span></span><button type="button">Back to admin view</button>';
    vb.querySelector('button').addEventListener('click', () => Shell.setViewAs(false));
    document.body.appendChild(vb);
  } else if (!st.viewAs && vb) vb.remove();
  Shell.paintSide(); Shell.paintTabs();
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

/*
 * Sign in, made for a phone: tap your name (this device remembers who signs in on it), then a big PIN pad.
 * Or skip it: on a signed-in computer, Account › Sign in on your phone shows a QR code.
 */
const PEOPLE_KEY = 'livegenie-people';
function rememberedPeople() { try { return JSON.parse(localStorage.getItem(PEOPLE_KEY) || '[]').filter((x) => typeof x === 'string').slice(0, 8); } catch (e) { return []; } }
function rememberPerson(name) {
  try { localStorage.setItem(PEOPLE_KEY, JSON.stringify([name, ...rememberedPeople().filter((x) => x.toLowerCase() !== String(name).toLowerCase())].slice(0, 8))); } catch (e) { /* private mode */ }
}
function forgetPerson(name) { try { localStorage.setItem(PEOPLE_KEY, JSON.stringify(rememberedPeople().filter((x) => x !== name))); } catch (e) { /* private mode */ } }

function signInDialog(then) {
  modal('<div class="signin" id="sgn"></div>', (w, close) => {
    w.classList.add('signsheet');
    signInPanel($('#sgn', w), { close, then });
  });
}

/** The sign-in itself: in a dialog (close given) or on the full sign-in screen (no Cancel). */
function signInPanel(host, opts = {}) {
  const st = { name: '', pin: '', busy: false, step: rememberedPeople().length ? 'who' : 'name' };
  const inline = !opts.close;
  const close = opts.close || (() => {});
  const then = opts.then;
  const w = host;
  {
    const av = (n) => '<span class="av">' + esc(n.slice(0, 1).toUpperCase()) + '</span>';
    const qrHint = '<p class="note sqr">' + icon('grid') + '<span><b>On a phone?</b> Someone signed in on a computer can open <b>Settings › Account › Sign in on your phone</b>. Scan the code with your camera and you are in. No PIN needed.</span></p>';
    const done = async (user) => {
      rememberPerson(user.name);
      close(); document.removeEventListener('keydown', keys);
      await loadState(); paintHeader();
      toast('Signed in as ' + user.name, 'ok');
      if (then) then(); else route();
    };
    const submit = async () => {
      if (st.busy || st.pin.length < 4) return;
      st.busy = true; paint();
      try { const r = await call('POST', '/api/signin', { name: st.name, pin: st.pin }); await done(r.user); }
      catch (err) {
        st.busy = false; st.pin = ''; paint();
        $('#se', w).textContent = err.message;
        const dots = $('.pdots', w); if (dots) { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); }
        if (navigator.vibrate) navigator.vibrate(120);
      }
    };
    const press = (k) => {
      if (st.step !== 'pin' || st.busy) return;
      if (k === 'back') st.pin = st.pin.slice(0, -1);
      else if (k === 'go') return submit();
      else if (st.pin.length < 8) st.pin += k;
      $('#se', w).textContent = '';
      paintDots();
    };
    const paintDots = () => {
      const d = $('.pdots', w); if (!d) return;
      d.innerHTML = Array.from({ length: Math.max(4, st.pin.length) }, (_, i) => '<i class="' + (i < st.pin.length ? 'on' : '') + '"></i>').join('');
      const go = $('[data-k=go]', w); if (go) go.disabled = st.pin.length < 4 || st.busy;
    };
    function paint() {
      if (st.step === 'who') {
        host.innerHTML = '<h3>Who is signing in?</h3><div class="people">' + rememberedPeople().map((n) => '<div class="pwrap"><button type="button" class="person" data-p="' + esc(n) + '">' + av(n) + '<b>' + esc(n) + '</b></button><button type="button" class="pforget" data-forget="' + esc(n) + '" aria-label="Forget ' + esc(n) + ' on this device" title="Forget on this device">' + icon('x') + '</button></div>').join('') +
          '<button type="button" class="person other" data-p="">' + '<span class="av">' + icon('plus') + '</span><b>Someone else</b></button></div>' + qrHint +
          (inline ? '' : '<div class="acts"><button type="button" data-close>Cancel</button></div>');
        $$('[data-p]', host).forEach((b) => b.addEventListener('click', () => { st.name = b.dataset.p; st.pin = ''; st.step = st.name ? 'pin' : 'name'; paint(); }));
        $$('[data-forget]', host).forEach((b) => b.addEventListener('click', () => { forgetPerson(b.dataset.forget); st.step = rememberedPeople().length ? 'who' : 'name'; paint(); }));
        $$('[data-close]', host).forEach((b) => b.addEventListener('click', () => { close(); document.removeEventListener('keydown', keys); }));
        return;
      }
      if (st.step === 'name') {
        host.innerHTML = '<h3>Sign in</h3><p>Type your name, then your PIN.</p><form id="snf" class="snform"><label for="sn">Your name</label>' +
          '<input id="sn" autocomplete="username" autocapitalize="words" enterkeyhint="next" placeholder="First and last name" value="' + esc(st.name) + '"><div class="err" id="se"></div>' +
          '<button class="primary snext">Continue' + icon('chev') + '</button>' +
          (inline && !rememberedPeople().length ? '' : '<button type="button" class="ghost sback" id="sb">' + (rememberedPeople().length ? 'Back' : 'Cancel') + '</button>') + '</form>' + qrHint;
        const sbb = $('#sb', host); if (sbb) sbb.addEventListener('click', () => { if (rememberedPeople().length) { st.step = 'who'; paint(); } else { close(); document.removeEventListener('keydown', keys); } });
        $('#snf', host).addEventListener('submit', (e) => { e.preventDefault(); const n = $('#sn', host).value.trim(); if (!n) { $('#se', w).textContent = 'Type your name'; return; } st.name = n; st.step = 'pin'; paint(); });
        setTimeout(() => $('#sn', host).focus(), 40);
        return;
      }
      host.innerHTML = '<div class="pinhead">' + av(st.name) + '<div><b>' + esc(st.name) + '</b><button type="button" class="linkbtn" id="nyou">Not you?</button></div></div>' +
        '<div class="pdots" aria-live="polite"></div><div class="err" id="se"></div>' +
        '<div class="pad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => '<button type="button" data-k="' + k + '">' + k + '</button>').join('') +
        '<button type="button" data-k="back" aria-label="Delete">⌫</button><button type="button" data-k="0">0</button><button type="button" data-k="go" class="primary" aria-label="Sign in">' + (st.busy ? '<span class="spin"></span>' : 'Go') + '</button></div>' +
        (inline ? '' : '<div class="acts"><button type="button" data-close>Cancel</button></div>');
      $$('[data-k]', host).forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
      $('#nyou', host).addEventListener('click', () => { st.pin = ''; st.step = rememberedPeople().length ? 'who' : 'name'; paint(); });
      $$('[data-close]', host).forEach((b) => b.addEventListener('click', () => { close(); document.removeEventListener('keydown', keys); }));
      paintDots();
    }
    // a computer keyboard works too
    function keys(e) {
      if (!w.isConnected) return document.removeEventListener('keydown', keys);
      if (st.step !== 'pin') return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
      else if (e.key === 'Enter') { e.preventDefault(); press('go'); }
    }
    document.addEventListener('keydown', keys);
    paint();
  }
}

/** A QR code that signs a phone in as someone (yourself, or anyone if you are an admin). Works once, for 5 minutes. */
async function signInQr(userId, name) {
  let timer = null;
  modal('<h3>' + (userId ? 'Sign ' + esc(name) + ' in on a phone' : 'Sign in on your phone') + '</h3><p>Open the camera on the phone, point it at the code and tap the link. The phone stays signed in' + (userId ? ' as ' + esc(name) : '') + ' for 60 days from its last use.</p>' +
    '<div class="qrbox" id="qrb"><span class="spin"></span></div><p class="note qrnote" id="qrn"></p>' +
    '<div class="acts"><button type="button" id="qrr">New code</button><button type="button" class="primary" data-close>Done</button></div>', (w, close) => {
    const make = async () => {
      clearInterval(timer);
      try {
        const r = await call('POST', '/api/links', userId ? { user_id: userId } : {});
        const url = location.origin + location.pathname + '#/link/' + r.token;
        $('#qrb', w).innerHTML = QR.svg(url, { size: 232 });
        const tick = () => {
          const left = Math.max(0, Math.round((r.expires - Date.now()) / 1000));
          if (!w.isConnected) return clearInterval(timer);
          if (!left) { clearInterval(timer); $('#qrb', w).classList.add('expired'); $('#qrn', w).textContent = 'This code has expired. Tap New code.'; return; }
          $('#qrb', w).classList.remove('expired');
          $('#qrn', w).innerHTML = 'Works once · ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + ' left<br><span class="mono">' + esc(location.host) + '</span>';
        };
        tick(); timer = setInterval(tick, 1000);
      } catch (e) { $('#qrb', w).innerHTML = ''; $('#qrn', w).textContent = e.message; }
    };
    $('#qrr', w).addEventListener('click', make);
    $$('[data-close]', w).forEach((b) => b.addEventListener('click', () => clearInterval(timer)));
    make();
  });
}

/** Opening a sign-in QR code on a phone lands here. */
async function useSignInLink(token) {
  app.innerHTML = '<div class="card empty"><span class="spin"></span><div style="margin-top:10px">Signing in…</div></div>';
  try {
    const r = await call('POST', '/api/links/use', { token });
    rememberPerson(r.user.name);
    await loadState(); paintHeader();
    toast('Signed in as ' + r.user.name, 'ok');
  } catch (e) { toast(e.message, 'bad'); }
  history.replaceState(null, '', '#/');
  lastHash = '#/';
  route();
}

// ---------- shared bits ----------
function pageRow(p, opts = {}) {
  const badges = (p.pinned && !opts.noPin ? '<span class="badge pin">Pinned</span>' : '') + (p.tech_only ? '<span class="badge tech">Hidden from users</span>' : '');
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
    <p class="note" style="font-size:14px;margin:6px 0 18px">Create the first admin. You can add more admins and users in Admin › People afterwards.</p>
    <form class="card" id="setupF">
      <label for="ao">Church or organisation <span class="note">(optional)</span></label><input id="ao" autocapitalize="words" placeholder="Rolling Hills Community Church">
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
      await call('POST', '/api/setup', { name: $('#an').value, pin, org: $('#ao').value });
      await loadState(); paintHeader();
      location.hash = '#/';
      route();
    } catch (err) { $('#ae').textContent = err.message; }
  });
}

/** Everyone signs in before seeing anything: a full screen of its own, brand on one side, sign-in on the other. */
function viewSignIn() {
  setTitle('Sign in');
  const org = (S.state && S.state.org) || {};
  const ver = (S.state && S.state.version) || '';
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const feat = (ic, t, d) => '<li>' + icon(ic) + '<div><b>' + t + '</b><span>' + d + '</span></div></li>';
  app.innerHTML = '<div class="signpage">' +
    '<section class="signside" aria-hidden="true">' +
      '<svg class="signflow" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sfl" x1="0" x2="1"><stop offset="0" stop-color="#2ec4b6" stop-opacity="0"/><stop offset=".5" stop-color="#2ec4b6" stop-opacity=".55"/><stop offset="1" stop-color="#4c8dff" stop-opacity="0"/></linearGradient></defs>' +
        [120, 230, 340, 450, 560, 670, 780].map((y, i) => '<path d="M-20 ' + y + ' C 160 ' + (y - 60 + i * 9) + ', 300 ' + (y + 70 - i * 7) + ', 620 ' + (y - 30) + '" stroke="url(#sfl)" stroke-width="' + (i % 3 ? 1.2 : 2) + '" fill="none"/>').join('') +
        [[150, 196], [330, 300], [470, 545], [210, 690]].map(([x, y]) => '<circle cx="' + x + '" cy="' + y + '" r="4" fill="#2ec4b6" opacity=".7"/>').join('') + '</svg>' +
      '<div class="signtop"><img src="/icons/livegenie-mark.svg" alt=""><div><div class="sword">LIVEGENIE</div><div class="ssub">AVL knowledge base</div></div></div>' +
      '<div class="signmid">' + (org.logo ? '<div class="slogo"><img src="/api/org/logo" alt=""></div>' : '') +
        '<h2>' + (org.name ? esc(org.name) : 'Everything the tech team needs, in one place.') + '</h2>' +
        '<p>' + (org.name ? 'Audio, video, lighting and stream help for the tech team.' : 'Help pages, checklists and the whole stage patch.') + '</p>' +
        '<ul class="sfeat">' + feat('book', 'Help pages', 'How-tos for every console, camera and screen') + feat('check', 'Checklists', 'Pre-service checks everyone can tick') + feat('wave', 'Stage patch', 'Tap any mic to see its whole signal path') + '</ul></div>' +
      '<div class="sfoot">LiveGenie ' + esc(ver) + '</div>' +
    '</section>' +
    '<section class="signmain"><div class="signbox">' +
      '<div class="signmob">' + (org.logo ? '<img class="orglogo" src="/api/org/logo" alt="">' : '<img src="/icons/livegenie-mark.svg" alt="">') +
        '<div><div class="sword">LIVEGENIE</div><div class="ssub">' + esc(org.name || 'AVL knowledge base') + '</div></div></div>' +
      '<div class="shello">' + hello + '</div>' +
      '<div class="signin" id="sgp"></div>' +
      '<div class="shelp">' + icon('help') + '<span>Forgot your PIN or new to the team? Ask an admin. They can set you up under <b>Admin › People</b>.</span></div>' +
    '</div></section></div>';
  signInPanel($('#sgp'), { then: () => { location.hash = location.hash && location.hash !== '#/' ? location.hash : '#/'; route(); } });
}

async function viewHome() {
  setTitle('');
  const [d, t, devs, pd] = await Promise.all([get('/api/home'), get('/api/todo'), loadDevices(true), get('/api/patch').catch(() => null)]);
  S.spaces = d.spaces;
  const st = S.state, org = st.org || {}, u = st.user;
  const admin = can('admin');
  const fresh = admin && !d.spaces.length;
  const now = new Date(), hr = now.getHours();
  const hello = (hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening') + (u ? ', ' + u.name.split(' ')[0] : '');
  const doc = pd && pd.doc;
  const checks = admin && doc && typeof PatchCore !== 'undefined' ? PatchCore.checks(doc).filter((c) => c.level !== 'note') : [];
  const manuals = devs.reduce((n, x) => n + (x.files || 0), 0);
  const tile = (href, ic, title, sub, cls) => '<a class="htile ' + (cls || '') + '" href="' + href + '"><span class="hti">' + icon(ic) + '</span><b>' + title + '</b><span>' + sub + '</span></a>';
  const latestRow = (sp) => sp.latest ? '<a class="hsl" href="#/p/' + sp.latest.id + '">' + esc(sp.latest.title) + '<em>' + esc(ago(sp.latest.updated_at)) + '</em></a>' : '<span class="hsl none">No pages yet</span>';
  const todoHtml = (list) => {
    const open = list.filter((x) => !x.complete), done = list.filter((x) => x.complete);
    if (!list.length) return '';
    return '<section class="hsec htodo' + (open.some((x) => x.overdue) ? ' bad' : '') + '" id="todo"><div class="hsh"><h2>' + icon('check') + (open.length ? open.length + ' checklist' + (open.length === 1 ? '' : 's') + ' to finish' : 'All checklists done') + '</h2><a href="#/todo">Open To do ›</a></div>' +
      '<div class="tstrip">' + open.map((x) => {
        const n = x.total - x.left, pct = x.total ? Math.round(100 * n / x.total) : 0;
        return '<a class="tcard' + (x.overdue ? ' overdue' : '') + '" href="' + esc(todoHref(x)) + '"><div class="tct"><b>' + esc(x.title) + '</b><span>' + esc(x.page_title) + '</span></div>' +
          '<div class="tbar"><i style="width:' + pct + '%"></i></div><div class="tcf"><span>' + n + ' of ' + x.total + (x.overdue ? ' · overdue' : x.lastBy && n ? ' · ' + esc(x.lastBy) : '') + '</span><span class="tgo">Continue ›</span></div></a>';
      }).join('') + done.map((x) => '<a class="tcard done" href="' + esc(todoHref(x)) + '"><div class="tct"><b>' + esc(x.title) + '</b><span>Done' + (x.completedBy ? ' by ' + esc(x.completedBy) : '') + '</span></div><span class="tok">' + icon('check') + '</span></a>').join('') + '</div></section>';
  };
  app.innerHTML = `<div class="home2">
    <header class="hhero">
      ${org.logo ? '<img class="hlogo" src="/api/org/logo" alt="">' : '<img class="hlogo mark" src="/icons/livegenie-mark.svg" alt="">'}
      <div class="hht"><div class="hdate">${esc(now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}</div><h1>${esc(hello)}</h1>${org.name ? '<div class="horg">' + esc(org.name) + '</div>' : ''}</div>
      ${admin ? '<button class="primary btn" id="newPage">' + icon('plus') + 'New page</button>' : ''}
    </header>
    <form class="hsearch" id="hsF" role="search">${icon('search')}<input id="hsQ" type="search" placeholder="Search pages, gear, people, IP addresses…" autocomplete="off"></form>
    ${fresh ? '<section class="card welcome"><h2>Get started</h2><p>LiveGenie starts empty so it fits the way your team works. A few good first steps:</p><div class="wsteps">' +
      '<a class="wstep" href="#/admin/spaces">' + icon('list') + '<b>Make your spaces</b><span>Audio, Video, Training… or add a starter set</span></a>' +
      '<a class="wstep" href="#/gear-setup">' + icon('spark') + '<b>Guided equipment setup</b><span>Console, stage boxes, wireless, in-ears, PA onto the stage patch</span></a>' +
      '<a class="wstep" href="#/admin/people">' + icon('users') + '<b>Add people</b><span>Admins build; users read and tick checklists</span></a>' +
      '<a class="wstep" href="#/admin/church">' + icon('image') + '<b>Church name and logo</b><span>Shown on sign in and on every PDF</span></a></div></section>' : ''}
    ${todoHtml(t.todo)}
    <section class="htiles">
      ${tile('#/patch', 'grid', 'Stage patch', doc ? doc.gear.length + ' pieces · ' + doc.cables.length + ' cables' : 'Mic to speaker', 'tpatch')}
      ${tile('#/gear', 'box', 'Gear Locker', devs.length + ' piece' + (devs.length === 1 ? '' : 's') + (manuals ? ' · ' + manuals + ' manual' + (manuals === 1 ? '' : 's') : ''), 'tgear')}
      ${tile('#/map', 'net', 'System map', admin ? 'Signal, network, VLANs' : 'Signal flow', 'tmap')}
      ${admin ? tile(st.problems ? '#/admin/problems' : '#/patch', st.problems || checks.length ? 'alert' : 'check', st.problems || checks.length ? 'Needs attention' : 'All good',
        [st.problems ? st.problems + ' problem' + (st.problems === 1 ? '' : 's') + ' reported' : '', checks.length ? checks.length + ' patch check' + (checks.length === 1 ? '' : 's') : ''].filter(Boolean).join(' · ') || 'No problems reported', st.problems || checks.length ? 'tattn' : 'tok') : ''}
    </section>
    ${d.pinned.length ? '<section class="hsec"><div class="hsh"><h2>' + icon('pin') + 'Pinned</h2></div><div class="hpins">' + d.pinned.map((p) => '<a class="hpin" href="#/p/' + p.id + '"><b>' + esc(p.title) + '</b><span>' + esc(p.space_name) + '</span></a>').join('') + '</div></section>' : ''}
    ${d.spaces.length ? '<section class="hsec"><div class="hsh"><h2>' + icon('list') + 'Spaces</h2>' + (admin ? '<a href="#/admin/spaces">Manage ›</a>' : '') + '</div><div class="hspaces">' + d.spaces.map((sp) => '<div class="hspace" style="--sc:' + esc(sp.color || '#4c8dff') + '"><a class="hsh2" href="#/s/' + esc(sp.slug) + '"><i></i><b>' + esc(sp.name) + (sp.admin_only ? ' ' + icon('lock') : '') + '</b><em>' + sp.pages + '</em></a>' + (sp.blurb ? '<p>' + esc(sp.blurb) + '</p>' : '') + latestRow(sp) + '</div>').join('') + '</div></section>' : ''}
    <section class="hsec"><div class="hsh"><h2>${icon('clock')}Recently updated</h2></div>${d.recent.length ? '<div class="hrecent">' + d.recent.slice(0, 8).map((p) => '<a href="#/p/' + p.id + '"><b>' + esc(p.title) + '</b><span>' + esc(p.space_name) + (p.updated_by ? ' · ' + esc(p.updated_by) : '') + '</span><em>' + esc(ago(p.updated_at)) + '</em></a>').join('') + '</div>'
      : '<div class="card empty">No pages yet.' + (admin ? (d.spaces.length ? ' Start with the Sunday startup checklist or a page about the console.' : ' Make a space first, then add pages to it.') : ' The admins have not written any yet.') + '</div>'}</section>
  </div>`;
  const nb = $('#newPage');
  if (nb) nb.addEventListener('click', () => { location.hash = '#/new'; });
  $('#hsF').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#hsQ').value.trim(); if (q) location.hash = '#/search?q=' + encodeURIComponent(q); });
  // refresh the To do strip while the home page is open
  const mine = app.firstElementChild;
  const timer = setInterval(async () => {
    if (!mine.isConnected) return clearInterval(timer);
    if (document.hidden || S.offline) return;
    try {
      const x = await get('/api/todo');
      if (!mine.isConnected) return;
      const sec = $('#todo'), html = todoHtml(x.todo);
      if (sec) { if (html) sec.outerHTML = html; else sec.remove(); }
      else if (html) $('.hsearch', mine).insertAdjacentHTML('afterend', html);
    } catch (e) { /* offline banner */ }
  }, 30000);
}

/** Where a to do list opens: the To do page (or, for an older checklist still on a page, that page). */
const todoHref = (x) => (x.page_id ? '#/p/' + x.page_id + '?c=' + encodeURIComponent(x.block_id) : '#/todo?l=' + encodeURIComponent(x.block_id));
function todoRow(t) {
  const tmText = (x) => new Date(x).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const done = t.total - t.left;
  const status = t.complete ? '<span class="chip ok">Done' + (t.completedAt ? ' ' + esc(tmText(t.completedAt)) : '') + '</span>'
    : t.overdue ? '<span class="chip bad">Overdue</span>'
    : t.dueAt ? '<span class="chip acc">Due ' + esc(tmText(t.dueAt)) + '</span>' : t.scheduled ? '<span class="chip acc">Today</span>' : '<span class="chip warn">In progress</span>';
  const sub = t.complete ? 'Finished' + (t.completedBy ? ' by ' + esc(t.completedBy) : '') + ' · ' + esc(t.page_title)
    : done + ' of ' + t.total + ' done · ' + esc(t.page_title) + (t.overdue ? ' · was due ' + esc(tmText(t.dueAt)) : '') + (t.lastBy && done ? ' · last ticked by ' + esc(t.lastBy) + ' ' + esc(ago(t.lastAt)) : '');
  return '<a class="row todo' + (t.overdue ? ' overdue' : '') + (t.complete ? ' complete' : '') + '" href="' + esc(todoHref(t)) + '">' +
    '<span class="ring" style="--p:' + (t.total ? Math.round(100 * done / t.total) : 0) + '"></span>' +
    '<div class="t"><b>' + esc(t.title) + '</b><span>' + sub + '</span></div>' + status + '</a>';
}

/**
 * To do: every to do list, in its groups, on one page. Tap a list to open it and tick its steps; everyone sees
 * the same ticks. Lists that are open now (started, or scheduled for today) are marked; overdue ones turn red.
 */
async function viewTodo(qs) {
  setTitle('To do');
  let openId = qs && qs.get('l') ? qs.get('l') : null;
  let shut = {}; try { shut = JSON.parse(localStorage.getItem('lg-todo-shut') || '{}'); } catch (e) { /* private mode */ }
  let data = await get('/api/todo/lists');
  const tm = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const state = (x) => x.total && x.left === 0 ? ['done', 'Done'] : x.overdue ? ['bad', 'Overdue'] : x.left < x.total ? ['warn', (x.total - x.left) + ' of ' + x.total] : x.schedule.length && x.active ? ['acc', x.dueAt ? 'Due ' + tm(x.dueAt) : 'Today'] : ['', x.total + ' step' + (x.total === 1 ? '' : 's')];
  const listHtml = (x) => {
    const [cls, txt] = state(x), pct = x.total ? Math.round(100 * (x.total - x.left) / x.total) : 0, open = x.id === openId;
    return '<div class="tdl' + (open ? ' open' : '') + (cls ? ' ' + cls : '') + '" data-l="' + esc(x.id) + '"><button type="button" class="tdh" data-open="' + esc(x.id) + '"><span class="ring" style="--p:' + pct + '"></span><span class="tdt"><b>' + esc(x.title) + '</b>' +
      (x.scheduleText.length ? '<em>' + icon('clock') + esc(x.scheduleText.join('; ')) + '</em>' : '') + '</span><span class="chip ' + cls + '">' + esc(txt) + '</span><i>' + (open ? '▾' : '▸') + '</i></button>' +
      (open ? '<div class="tdb">' + x.items.map((it) => '<label class="tdi' + (it.done ? ' on' : '') + '"><input type="checkbox" data-tick="' + esc(it.text) + '"' + (it.done ? ' checked' : '') + '><span>' + esc(it.text) + '</span>' + (it.done ? '<em>' + esc(it.by) + ' · ' + esc(tm(it.at)) + '</em>' : '') + '</label>').join('') +
        '<div class="tdf"><span class="note">' + (x.lastReset ? 'Started over ' + esc(ago(x.lastReset.at)) + (x.lastReset.by ? ' by ' + esc(x.lastReset.by) : '') : '') + '</span><button type="button" class="ghost" data-reset="' + esc(x.id) + '">' + icon('restore') + 'Start over</button></div></div>' : '') + '</div>';
  };
  const paint = () => {
    const groups = data.groups.filter((g) => g.lists.length);
    const all = groups.flatMap((g) => g.lists);
    const now = all.filter((x) => x.overdue || (x.left < x.total && x.left > 0) || (x.schedule.length && x.active && x.left > 0));
    app.innerHTML = '<div class="todov"><div class="bar"><div class="grow"><h1 class="title" style="font-size:22px;letter-spacing:.06em;margin:4px 0 2px">To do</h1>' +
      '<div class="note">' + (now.length ? now.length + ' open now' + (now.some((x) => x.overdue) ? ' · ' + now.filter((x) => x.overdue).length + ' overdue' : '') : 'Nothing open right now') + '</div></div>' +
      (can('admin') ? '<a class="btn" href="#/admin/todo">' + icon('edit') + 'Manage lists</a>' : '') + '</div>' +
      (groups.length ? groups.map((g) => {
        const closed = shut[g.name] && !g.lists.some((x) => x.id === openId);
        const openN = g.lists.filter((x) => now.includes(x)).length;
        return '<section class="tdg' + (closed ? ' shut' : '') + '"><button type="button" class="gbh" data-g="' + esc(g.name) + '"><span>' + esc(g.name || 'To do lists') + '</span><em>' + g.lists.length + '</em>' + (openN ? '<b class="cnt' + (g.lists.some((x) => x.overdue) ? ' bad' : '') + '">' + openN + ' open</b>' : '') + '<i>' + (closed ? '▸' : '▾') + '</i></button>' +
          (closed ? '' : '<div class="tdls">' + g.lists.map(listHtml).join('') + '</div>') + '</section>';
      }).join('') : '<div class="card empty">' + icon('check') + '<div style="margin-top:8px">No to do lists yet.</div>' + (can('admin') ? '<div class="note" style="margin-top:4px"><a href="#/admin/todo">Make the first one</a> in Admin › To do lists.</div>' : '') + '</div>') + '</div>';
    $$('[data-g]').forEach((b) => b.addEventListener('click', () => { shut[b.dataset.g] = !shut[b.dataset.g]; try { localStorage.setItem('lg-todo-shut', JSON.stringify(shut)); } catch (e) { /* private mode */ } paint(); }));
    $$('[data-open]').forEach((b) => b.addEventListener('click', () => { openId = openId === b.dataset.open ? null : b.dataset.open; history.replaceState(null, '', '#/todo' + (openId ? '?l=' + encodeURIComponent(openId) : '')); lastHash = location.hash; paint(); }));
    $$('[data-tick]').forEach((c) => c.addEventListener('change', async () => {
      const id = c.closest('[data-l]').dataset.l;
      try { await call('POST', '/api/pages/0/checklists/' + encodeURIComponent(id) + '/tick', { item: c.dataset.tick, done: c.checked }); await refresh(); }
      catch (e) { toast(e.message, 'bad'); c.checked = !c.checked; }
    }));
    $$('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmBox('Start this list over?', 'Every tick is cleared for everyone. The run so far stays in the checklist log.', 'Start over')) return;
      try { await call('POST', '/api/pages/0/checklists/' + encodeURIComponent(b.dataset.reset) + '/reset'); await refresh(); toast('Started over', 'ok'); } catch (e) { toast(e.message, 'bad'); }
    }));
    const o = openId && $('[data-l="' + CSS.escape(openId) + '"]'); if (o && !paint.scrolled) { paint.scrolled = true; o.scrollIntoView({ block: 'center' }); }
  };
  const refresh = async () => { data = await get('/api/todo/lists'); paint(); loadState().then(paintHeader).catch(() => {}); };
  paint();
  const mine = app.firstElementChild;
  const timer = setInterval(async () => {
    if (!mine.isConnected || !app.contains(mine) && !app.querySelector('.todov')) return clearInterval(timer);
    if (!app.querySelector('.todov')) return clearInterval(timer);
    if (document.hidden || S.offline || document.activeElement && document.activeElement.matches('input')) return;
    try { data = await get('/api/todo/lists'); paint(); } catch (e) { /* offline banner */ }
  }, 20000);
}

async function viewSpace(slug) {
  const d = await get('/api/spaces/' + encodeURIComponent(slug));
  setTitle(d.space.name);
  Shell.setCtx({ space: slug });
  const newBtn = can('admin') ? '<button class="primary btn" id="newPage">' + icon('plus') + 'New page</button>' : '';
  app.innerHTML = `<div class="crumbs"><a href="#/">Home</a><span>/</span></div>
    <div class="bar"><div class="grow"><h1 class="title" style="font-size:22px;letter-spacing:.06em;margin:4px 0 2px">${esc(d.space.name)}</h1><div class="note">${esc(d.space.blurb)}</div></div>${newBtn}</div>
    ${d.pages.length ? '<div class="list">' + d.pages.map((p) => pageRow(p)).join('') + '</div>' : (d.hidden ? '' : '<div class="card empty">No pages in this space yet.</div>')}
    ${d.hidden ? '<div class="locknote" style="margin-top:12px">' + d.hidden + ' page' + (d.hidden === 1 ? ' is' : 's are') + ' hidden from users here.</div>' : ''}`;
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
      case 'patchview': return PatchView.blockHtml(b);
      case 'image': return '<figure class="pic"><img src="/uploads/' + esc(b.upload) + '" alt="' + esc(b.caption) + '" loading="lazy">' + (b.caption ? '<figcaption>' + esc(b.caption) + '</figcaption>' : '') + '</figure>';
      case 'divider': return '<hr>';
      default: return '';
    }
  }).join('');
}

function wireBlocks(root, page, live = true) {
  Blk.wire(root, page, live);
  PatchView.wireBlocks(root);
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
  Shell.setCtx({ space: p.space, page: p.id });
  const pdf = '<button class="btn ghost" id="pB" title="Export PDF">' + icon('pdf') + '<span class="hide-sm">PDF</span></button>';
  const rep = '<button class="btn ghost" id="rB" title="Report a problem">' + icon('alert') + '<span class="hide-sm">Report a problem</span></button>';
  const acts = can('admin')
    ? '<button class="btn" id="eB">' + icon('edit') + 'Edit</button>' + pdf + '<button class="btn ghost" id="hB" title="History">' + icon('clock') + '<span class="hide-sm">History</span></button><button class="ghost danger" id="dB" title="Delete page">' + icon('trash') + '</button>'
    : pdf + rep;
  app.innerHTML = `<div class="pagewrap"><div class="page">
    <div class="printhead"><img src="/icons/livegenie-glyph.svg" alt=""><div><b>LiveGenie</b><span>${esc((S.state.org && S.state.org.name) || 'AVL knowledge base')}</span></div>
      <div class="pm">${esc(p.space_name)} · version ${p.version} · updated ${esc(when(p.updated_at))}${p.updated_by ? ' by ' + esc(p.updated_by) : ''}<br>Printed ${esc(when(Date.now()))}</div></div>
    <div class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/s/${esc(p.space)}">${esc(p.space_name)}</a></div>
    <div class="bar acts-top" style="margin-bottom:0"><div class="grow"><h1 class="title">${esc(p.title)}</h1></div>${acts}</div>
    <div class="meta">${p.tech_only ? '<span class="badge tech">' + icon('lock', 'icon') + 'Hidden from users</span>' : ''}${(S.spaces || []).some((x) => x.slug === p.space && x.admin_only) ? '<span class="badge tech">' + icon('lock', 'icon') + 'Admins only</span>' : ''}${p.pinned ? '<span class="badge pin">Pinned</span>' : ''}
      <span>Updated ${esc(ago(p.updated_at))}${p.updated_by ? ' by ' + esc(p.updated_by) : ''} · version ${p.version}</span></div>
    <div class="doc" id="doc">${p.blocks.length ? renderBlocks(p.blocks) : '<p class="note">This page is empty.' + (can('admin') ? ' Tap Edit to add text, steps or pictures.' : '') + '</p>'}</div>
  </div><nav class="outline" aria-label="On this page"></nav></div>`;
  wireBlocks($('#doc'), p);
  linkDevices($('#doc'));
  if (Shell.outline($('#doc'), $('.outline'))) $('.pagewrap').classList.add('has-outline');
  const hb = $('#hB'); if (hb) hb.addEventListener('click', () => { location.hash = '#/p/' + p.id + '/history'; });
  const rb = $('#rB'); if (rb) rb.addEventListener('click', () => reportProblem(p.title, { page_id: p.id }));
  $('#pB').addEventListener('click', () => exportPdf(p.title));
  if (focusChecklist) {
    const c = document.getElementById('c-' + focusChecklist) || document.querySelector('[data-pid="' + CSS.escape(focusChecklist) + '"], [data-ipid="' + CSS.escape(focusChecklist) + '"]');
    if (c) setTimeout(() => { c.scrollIntoView({ block: 'start', behavior: 'smooth' }); c.classList.add('flash'); }, 60);
    S.noScroll = true;
  }
  if (can('admin')) {
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
  ['text', 'Text', 'text'], ['callout', 'Callout', 'info'], ['patchview', 'Patch list', 'grid'],
  ['iplist', 'IP list', 'net'], ['image', 'Picture', 'image'], ['divider', 'Divider', 'line']
];
const BLOCK_LABELS = { text: 'Text', callout: 'Callout', checklist: 'Checklist', patch: 'Patch list (old)', patchview: 'Patch list', iplist: 'IP list', image: 'Picture', divider: 'Divider' };
const newBlock = (t, preset) => ({
  text: { type: 'text', md: '' }, callout: { type: 'callout', kind: 'tip', md: '' }, checklist: { type: 'checklist', title: '', items: [], schedule: [] },
  patch: { type: 'patch', title: '', preset: preset || 'input', columns: Blk.PRESETS[preset || 'input'].columns.slice(), rows: [], trace: Blk.PRESETS[preset || 'input'].trace.slice(),
    roles: { ...(Blk.PRESETS[preset || 'input'].roles || {}) }, assign: (Blk.PRESETS[preset || 'input'].assign || []).slice(), _setup: ['snake', 'snakeout', 'wireless', 'iem'].includes(preset) },
  patchview: { type: 'patchview', title: '', report: 'inputs', filter: '' },
  iplist: { type: 'iplist', title: '', net: { name: '', vlan: '', cidr: '', gateway: '' }, rows: [] },
  image: { type: 'image', upload: '', caption: '' }, divider: { type: 'divider' }
}[t]);

/** Ask which patch list layout to start from. */
function pickPreset() {
  return new Promise((resolve) => {
    const P = Blk.PRESETS;
    const desc = { snake: 'Set up a stage box over its link, then assign a source to each input', snakeout: 'Stage box outputs fed from the console: assign a mix and destination to each', wireless: 'Add a receiver, then each channel: who uses it, capsule, transmitter and frequency', iem: 'In-ear transmitters (mono or stereo) fed from the console, with bodypacks and who wears them', input: 'Mics and DIs straight into the desk', output: 'Desk outputs to speakers, IEMs, stream', cable: 'Cable labels, from, to, length and route', custom: 'Your own columns' };
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
  if (!can('admin')) { app.innerHTML = '<div class="card empty">Only admins write pages. If something here is wrong, use <b>Report a problem</b> on the page.</div>'; return; }
  const sp = await get('/api/spaces');
  S.spaces = sp.spaces;
  if (!S.spaces.length) {
    app.innerHTML = '<div class="card empty">' + icon('list') + '<div style="margin-top:8px"><b>Make a space first.</b></div><div class="note" style="margin:4px 0 12px">Pages live in spaces (Audio, Video, Training, whatever suits you).</div><a class="btn abtn" href="#/admin/spaces">' + icon('plus') + 'Make a space</a></div>';
    return;
  }
  if (id) {
    const d = await get('/api/pages/' + id);
    const p = d.page;
    S.ed = { id: p.id, title: p.title, space: p.space, tech_only: p.tech_only, pinned: p.pinned, blocks: p.blocks.map((b) => ({ ...b, _items: b.items ? b.items.join('\n') : undefined })), baseVersion: p.version };
  } else {
    const sp0 = spaceSlug || (S.spaces[0] && S.spaces[0].slug);
    S.ed = { id: null, title: '', space: sp0, tech_only: false, pinned: false, blocks: [newBlock('text')], baseVersion: undefined };
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
        ${ed.tech_only ? '<label class="tog on" title="Set by an older version of LiveGenie: users cannot see this page. Who sees a page is now set per space (Admin › Spaces)."><input type="checkbox" id="eTech" checked>Hidden from users</label>' : '<span class="note" id="eVis"></span>'}
        <label class="tog ${ed.pinned ? 'on' : ''}" title="Pinned pages show at the top of the home page"><input type="checkbox" id="ePin" ${ed.pinned ? 'checked' : ''}>Pinned</label>
      </div>
    </div>
    <div id="eB"></div>
    <div class="adder"><span class="note">Add</span>${BLOCK_TYPES.map((t) => '<button class="btn" data-add="' + t[0] + '">' + icon(t[2]) + t[1] + '</button>').join('')}</div>
    <div class="edbar"><span class="note" id="eMsg"></span><button id="eCancel">Cancel</button><button class="primary" id="eSave">${id ? 'Save' : 'Create page'}</button></div>
  </div>`;
  const dirty = () => { S.dirty = true; $('#eMsg').textContent = 'Unsaved changes'; };
  $('#eT').addEventListener('input', (e) => { ed.title = e.target.value; dirty(); });
  const visNote = () => { const v = $('#eVis'); if (!v) return; const sp = (S.spaces || []).find((x) => x.slug === ed.space); v.innerHTML = sp && sp.admin_only ? icon('lock') + ' Admins only (set by the space)' : 'Everyone signed in can read it'; };
  $('#eS').addEventListener('change', (e) => { ed.space = e.target.value; visNote(); dirty(); });
  const et = $('#eTech'); if (et) et.addEventListener('change', (e) => { ed.tech_only = e.target.checked; e.target.closest('.tog').classList.toggle('on', ed.tech_only); dirty(); });
  visNote();
  $('#ePin').addEventListener('change', (e) => { ed.pinned = e.target.checked; e.target.closest('.tog').classList.toggle('on', e.target.checked); dirty(); });
  $$('[data-add]').forEach((b) => b.addEventListener('click', async () => {
    let preset;
    if (b.dataset.add === 'patch') { preset = await pickPreset(); if (!preset) return; }
    ed.blocks.push(newBlock(b.dataset.add, preset)); dirty(); paintBlocks();
    if (b.dataset.add === 'iplist') { const sp = (S.spaces || []).find((x) => x.slug === ed.space); if (sp && !sp.admin_only) toast('Users can read this space. For IP lists, an admins-only space (Admin › Spaces) keeps them private.'); }
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
      if (b.type === 'patchview') body = '<p class="note" style="margin:0 0 8px">Shows a list made from the <a href="#/patch">stage patch</a> drawing. Change the patch there; this list follows it.</p>' +
        '<div class="two"><label>List<select data-f="report">' + PatchView.REPORTS.map((r) => '<option value="' + r[0] + '"' + (b.report === r[0] ? ' selected' : '') + '>' + r[1] + '</option>').join('') + '</select></label>' +
        '<label>Only gear matching <span class="note">(optional)</span><input data-f="filter" value="' + esc(b.filter || '') + '" placeholder="A piece of gear or a section"></label></div>' +
        '<label>Title <span class="note">(optional)</span><input class="full" data-f="title" value="' + esc(b.title || '') + '" placeholder="Sunday inputs"></label>';
      return '<div class="blk" data-i="' + i + '"><div class="bh"><b>' + label + '</b>' +
        '<button data-mv="-1" title="Move up"' + (i === 0 ? ' disabled' : '') + '>' + icon('up') + '</button>' +
        '<button data-mv="1" title="Move down"' + (i === ed.blocks.length - 1 ? ' disabled' : '') + '>' + icon('down') + '</button>' +
        '<button data-del title="Remove block">' + icon('x') + '</button></div>' + body + '</div>';
    }).join('') || '<div class="card empty">No blocks yet. Add text, a checklist or a picture below.</div>';

    $$('.blk', host).forEach((el) => {
      const i = Number(el.dataset.i);
      const b = ed.blocks[i];
      $$('[data-f]', el).forEach((f) => f.addEventListener(f.tagName === 'SELECT' ? 'change' : 'input', () => { b[f.dataset.f] = f.value; dirty(); }));
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
          ${!isCurrent && can('admin') ? '<button class="primary btn" id="rB">' + icon('restore') + 'Restore this version</button>' : ''}</div>
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
  $('#sq').value = q;
  setTitle('Search');
  const box = '<form class="search psearch" id="pSearch" role="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
    '<input id="pq" type="search" enterkeyhint="search" placeholder="Search pages, devices, IPs" autocomplete="off" value="' + esc(q) + '"></form>';
  const wire = () => $('#pSearch').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#pq').value.trim(); if (v) location.hash = '#/search?q=' + encodeURIComponent(v); });
  if (!q) {
    const sp = S.spaces || (await get('/api/spaces')).spaces;
    app.innerHTML = box + '<div class="section"><h2>Spaces</h2><div class="list">' + sp.map((s) => '<a class="row" href="#/s/' + esc(s.slug) + '"><div class="t"><b>' + esc(s.name) + '</b><span>' + esc(s.blurb) + '</span></div><div class="m">' + s.pages + '</div></a>').join('') + '</div></div>' +
      '<p class="note">Search finds words in page text, checklist steps, patch lists and IP lists, and device names, nicknames and IPs.</p>';
    wire();
    const f = $('#pq'); if (f && getComputedStyle(f).display !== 'none' && matchMedia('(pointer: fine)').matches) f.focus();
    return;
  }
  const d = await get('/api/search?q=' + encodeURIComponent(q));
  app.innerHTML = box + `<div class="bar"><div class="grow"><h2 style="margin:0">Results for “${esc(q)}”</h2></div><span class="note">${d.results.length} page${d.results.length === 1 ? '' : 's'}</span></div>
    ${(d.gear || []).length ? '<div class="section"><h2>On the stage patch</h2><div class="dgrid">' + d.gear.map((g) => '<a class="dcard" href="#/patch?g=' + esc(g.id) + '"><div class="t"><b>' + esc(g.name) + '</b><span>' + esc([g.kind, g.use, g.model].filter(Boolean).join(' · ')) + '</span>' + (g.freq ? '<span class="mono">' + esc(g.freq) + ' MHz</span>' : '') + '</div></a>').join('') + '</div></div>' : ''}
    ${d.devices.length ? '<div class="section"><div class="dgrid">' + d.devices.map((v) => '<a class="dcard" href="#/d/' + v.id + '">' + devThumb(v, 40) + '<div class="t"><b>' + esc(v.name) + '</b><span>' + esc([v.make, v.model].filter(Boolean).join(' ')) + '</span><span>' + esc(v.location) + (v.ips.length ? ' <span class="mono">' + esc(v.ips[0]) + '</span>' : '') + '</span></div></a>').join('') + '</div></div>' : ''}
    ${d.results.length ? '<div class="list">' + d.results.map((p) => pageRow(p, { snip: true })).join('') + '</div>'
      : '<div class="card empty">Nothing matches that yet.' + (can('admin') ? '<div style="margin-top:12px"><a href="#/new">Write a page about it</a></div>' : '') + '</div>'}`;
  wire();
}

// ----- settings -----
const TABS = [['display', 'Display', 'sun', 'user'], ['account', 'Account', 'user', 'user'], ['about', 'About', 'spark', 'user']];
const ADMIN_TABS = [
  ['spaces', 'Spaces', 'list'], ['people', 'People', 'users'], ['problems', 'Problems', 'alert'], ['todo', 'To do lists', 'check'], ['checklog', 'Checklist log', 'clock'],
  ['church', 'Church', 'image'], ['notify', 'Notifications', 'bell'], ['backups', 'Backups', 'box'], ['trash', 'Trash', 'trash'], ['activity', 'Activity', 'clock'], ['reset', 'Reset', 'restore']
];

/** The admin area: everything that builds or runs LiveGenie (users only see help pages, checklists and the drawings). */
async function viewAdmin(tab) {
  if (!can('admin')) { app.innerHTML = '<div class="card empty">This part is for admins.</div>'; return; }
  if (!ADMIN_TABS.find((t) => t[0] === tab)) tab = 'spaces';
  setTitle('Admin');
  const n = (S.state && S.state.problems) || 0;
  app.innerHTML = `<div class="crumbs"><a href="#/">Home</a><span>/</span></div><h1 class="title" style="font-size:22px;letter-spacing:.06em;margin:4px 0 12px">ADMIN</h1>
    <div class="setup adminv"><div class="side">${ADMIN_TABS.map((t) => '<button data-tab="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + icon(t[2]) + t[1] + (t[0] === 'problems' && n ? '<em class="cnt bad">' + n + '</em>' : '') + '</button>').join('')}</div><div class="pane" id="pane"></div></div>`;
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/admin/' + b.dataset.tab; }));
  const pane = $('#pane');
  await ({ spaces: tabSpaces, people: tabUsers, problems: tabProblems, todo: tabTodoLists, checklog: tabChecklog, church: tabChurch, notify: tabNotify, backups: tabBackups, trash: tabTrash, activity: tabActivity, reset: tabReset }[tab])(pane);
}

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
  const roleText = { admin: 'Admin: builds LiveGenie: spaces, pages, stage patch, devices, IP lists, manuals, people and backups', user: 'User: reads help pages, ticks checklists, follows signals and reports problems' }[u.role];
  pane.innerHTML = '<div class="card"><h2>Account</h2>' + setRow(esc(u.name), roleText, '<button id="so">Sign out</button>', true) +
    setRow('Sign in on your phone', 'Shows a QR code. Scan it with the phone\'s camera and the phone is signed in as you, no typing.', '<button class="btn" id="qrMe">' + icon('grid') + 'Show QR code</button>') + '</div>' +
    '<div class="card"><h2>Change PIN</h2><form id="pf">' +
    setRow('Current PIN', '', '<input class="num" id="p0" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password">', true) +
    setRow('New PIN', '4 to 8 digits', '<input class="num" id="p1" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">') +
    setRow('New PIN again', '', '<input class="num" id="p2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">') +
    setRow('', '', '<button class="primary">Change PIN</button>') + '</form></div>';
  $('#qrMe').addEventListener('click', () => signInQr());
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
  const roleName = { admin: 'Admin', user: 'User' };
  pane.innerHTML = '<p class="note pnote"><b>Admins</b> build LiveGenie: spaces, pages, the stage patch, devices, IP lists, VLANs, manuals, people and backups. <b>Users</b> read help pages, tick checklists, follow signals on the stage patch and report problems. Everyone signs in; <b>Phone</b> shows a QR code that signs someone in on their phone.</p>' +
    '<div class="card"><h2>Users</h2>' + d.users.map((u, i) => setRow(esc(u.name) + (u.id === S.state.user.id ? ' <span class="note">(you)</span>' : ''),
      roleName[u.role] + (u.locked ? ' · <span style="color:var(--warn)">locked after wrong PINs</span>' : '') + ' · added ' + esc(ago(u.created_at)),
      '<button class="btn" data-qr="' + u.id + '" title="Sign ' + esc(u.name) + ' in on a phone">' + icon('grid') + '<span class="hide-sm">Phone</span></button><button data-edit="' + u.id + '">Edit</button>' + (u.id !== S.state.user.id ? '<button class="danger ghost" data-rm="' + u.id + '">Remove</button>' : ''), i === 0)).join('') +
    setRow('', '', '<button class="primary btn" id="addU">' + icon('plus') + 'Add user</button>') + '</div>';
  const form = (u) => `<h3>${u ? 'Edit ' + esc(u.name) : 'Add a user'}</h3><p>${u ? 'Leave the PIN empty to keep it.' : 'They sign in with this name and PIN.'}</p><form id="uf">
    <label for="un">Name</label><input id="un" value="${esc(u ? u.name : '')}" autocapitalize="words">
    <label for="ur">Role</label><select id="ur">${['user', 'admin'].map((r) => '<option value="' + r + '"' + ((u ? u.role : 'user') === r ? ' selected' : '') + '>' + roleName[r] + '</option>').join('')}</select>
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
  $$('[data-qr]', pane).forEach((b) => b.addEventListener('click', () => { const u = d.users.find((x) => x.id === Number(b.dataset.qr)); signInQr(u.id === S.state.user.id ? null : u.id, u.name); }));
  $$('[data-edit]', pane).forEach((b) => b.addEventListener('click', () => open(d.users.find((u) => u.id === Number(b.dataset.edit)))));
  $$('[data-rm]', pane).forEach((b) => b.addEventListener('click', async () => {
    const u = d.users.find((x) => x.id === Number(b.dataset.rm));
    if (!await confirmBox('Remove ' + u.name + '?', 'They can no longer sign in. Pages they wrote stay.', 'Remove', true)) return;
    try { await call('DELETE', '/api/users/' + u.id); toast('Removed', 'ok'); tabUsers(pane); } catch (e) { toast(e.message, 'bad'); }
  }));
}

// ----- admin: spaces -----
async function tabSpaces(pane) {
  const d = await get('/api/spaces');
  S.spaces = d.spaces;
  const list = d.spaces;
  pane.innerHTML = '<p class="note pnote">Spaces group your pages (Audio, Video, Training… whatever suits your team). <b>Admins only</b> hides a space and its pages from users, for things like IP addresses and network notes. The arrows change the order everyone sees.</p>' +
    '<div class="card"><h2>Spaces</h2>' + (list.length ? '<div class="splist">' + list.map((sp, i) => '<div class="sprow" data-slug="' + esc(sp.slug) + '"><i class="spdot" style="background:' + esc(sp.color) + '"></i>' +
      '<div class="t"><b>' + esc(sp.name) + (sp.admin_only ? ' <span class="badge tech">' + icon('lock') + 'Admins only</span>' : '') + '</b><span>' + esc(sp.blurb || '') + (sp.blurb ? ' · ' : '') + sp.pages + ' page' + (sp.pages === 1 ? '' : 's') + '</span></div>' +
      '<button class="ghost" data-mv="-1" title="Move up"' + (i ? '' : ' disabled') + '>' + icon('up') + '</button><button class="ghost" data-mv="1" title="Move down"' + (i < list.length - 1 ? '' : ' disabled') + '>' + icon('down') + '</button>' +
      '<button data-edit>Edit</button></div>').join('') + '</div>'
      : '<div class="empty" style="padding:18px 6px">No spaces yet. Make your first one, or add the starter set.</div>') +
    '<div class="adder" style="margin-top:10px"><button class="primary btn" id="spAdd">' + icon('plus') + 'New space</button>' +
    '<button class="btn" id="spStarter" title="Audio, Video & Stream, Lighting, Network (admins only), Volunteers, Services">' + icon('spark') + 'Add the church AVL starter set</button>' +
    '<button class="btn" id="spTrain">' + icon('check') + 'Add the audio training pages</button></div></div>';
  const form = (sp) => '<h3>' + (sp ? 'Edit ' + esc(sp.name) : 'New space') + '</h3><form id="spf"><label>Name</label><input id="spn" value="' + esc(sp ? sp.name : '') + '" placeholder="Audio, Video, Training">' +
    '<label>What goes here <span class="note">(optional)</span></label><input id="spb" value="' + esc(sp ? sp.blurb : '') + '" placeholder="Desk, mics, wireless, PA">' +
    '<label>Colour</label><div class="swatches">' + ['#2ec4b6', '#4c8dff', '#f2c94c', '#8b6cff', '#3ecf6e', '#ef8a3c', '#ec6aa8', '#ef4c4c', '#8a96a5'].map((c) => '<button type="button" class="sw' + ((sp ? sp.color : '') === c ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join('') + '</div>' +
    '<label class="tog' + (sp && sp.admin_only ? ' on' : '') + '" style="margin-top:14px"><input type="checkbox" id="spa"' + (sp && sp.admin_only ? ' checked' : '') + '> Admins only <span class="note">(users do not see this space or its pages)</span></label>' +
    '<div class="err" id="spe"></div><div class="acts">' + (sp ? '<button type="button" class="ghost danger" id="spdel" style="margin-right:auto">' + icon('trash') + 'Remove</button>' : '') + '<button type="button" data-close>Cancel</button><button class="primary">' + (sp ? 'Save' : 'Make space') + '</button></div></form>';
  const open = (sp) => modal(form(sp), (w, close) => {
    let color = sp ? sp.color : '';
    $$('.sw', w).forEach((b) => b.addEventListener('click', () => { color = b.dataset.c; $$('.sw', w).forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#spa', w).addEventListener('change', (e) => e.target.closest('.tog').classList.toggle('on', e.target.checked));
    $('#spf', w).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: $('#spn', w).value, blurb: $('#spb', w).value, admin_only: $('#spa', w).checked };
      if (color) body.color = color;
      try {
        if (sp) await call('PUT', '/api/spaces/' + encodeURIComponent(sp.slug), body); else await call('POST', '/api/spaces', body);
        close(); toast(sp ? 'Saved' : 'Space made', 'ok'); tabSpaces(pane); Shell.update(['admin']);
      } catch (err) { $('#spe', w).textContent = err.message; }
    });
    const del = $('#spdel', w);
    if (del) del.addEventListener('click', async () => {
      const others = list.filter((x) => x.slug !== sp.slug);
      try { await call('DELETE', '/api/spaces/' + encodeURIComponent(sp.slug), {}); close(); toast('Removed ' + sp.name, 'ok'); tabSpaces(pane); Shell.update(['admin']); }
      catch (err) {
        if (err.status !== 409) { $('#spe', w).textContent = err.message; return; }
        if (!others.length) { $('#spe', w).textContent = err.message + ' Make another space first.'; return; }
        close();
        modal('<h3>Remove ' + esc(sp.name) + '</h3><p>' + esc(err.message) + '</p><form id="mvf"><label>Move them to</label><select id="mvs">' + others.map((x) => '<option value="' + esc(x.slug) + '">' + esc(x.name) + '</option>').join('') + '</select>' +
          '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary danger">Move and remove</button></div></form>', (w2, close2) => {
          $('#mvf', w2).addEventListener('submit', async (e) => {
            e.preventDefault();
            try { await call('DELETE', '/api/spaces/' + encodeURIComponent(sp.slug), { move_to: $('#mvs', w2).value }); close2(); toast('Pages moved, space removed', 'ok'); tabSpaces(pane); Shell.update(['admin']); }
            catch (e2) { toast(e2.message, 'bad'); }
          });
        });
      }
    });
  });
  $('#spAdd').addEventListener('click', () => open(null));
  $$('.sprow [data-edit]', pane).forEach((b) => b.addEventListener('click', () => open(list.find((x) => x.slug === b.closest('.sprow').dataset.slug))));
  $$('.sprow [data-mv]', pane).forEach((b) => b.addEventListener('click', async () => {
    const slugs = list.map((x) => x.slug), i = slugs.indexOf(b.closest('.sprow').dataset.slug), j = i + Number(b.dataset.mv);
    [slugs[i], slugs[j]] = [slugs[j], slugs[i]];
    await call('PUT', '/api/spaces-order', { slugs }); tabSpaces(pane); Shell.update(['admin']);
  }));
  $('#spStarter').addEventListener('click', async () => {
    try { const r = await call('POST', '/api/admin/starter'); toast(r.made.length ? 'Added ' + r.made.length + ' spaces' : 'You already have those spaces', 'ok'); tabSpaces(pane); Shell.update(['admin']); } catch (e) { toast(e.message, 'bad'); }
  });
  $('#spTrain').addEventListener('click', async () => {
    try { const r = await call('POST', '/api/admin/training'); toast('Audio training added', 'ok'); location.hash = '#/p/' + r.page; } catch (e) { toast(e.message, 'bad'); }
  });
}

// ----- admin: problems users reported -----
async function tabProblems(pane, status) {
  status = status || 'open';
  const d = await get('/api/problems?status=' + status);
  pane.innerHTML = '<p class="note pnote">Anyone can tap <b>Report a problem</b> on a page, a device card or a piece of gear on the stage patch. New reports also go to the Notifications webhook, if one is set.</p>' +
    '<div class="card"><div class="bar" style="margin-bottom:6px"><h2 class="grow" style="margin:0">Problems</h2><div class="seg" id="pst"><button data-s="open"' + (status === 'open' ? ' class="on"' : '') + '>Open</button><button data-s="resolved"' + (status === 'resolved' ? ' class="on"' : '') + '>Resolved</button></div></div>' +
    (d.problems.length ? '<div class="plist3">' + d.problems.map((p) => '<div class="prob' + (p.status === 'resolved' ? ' done' : '') + '" data-id="' + p.id + '"><div class="t"><b>' + esc(p.text) + '</b>' +
      '<span>' + (p.where_text ? esc(p.where_text) + ' · ' : '') + esc(p.created_name) + ' · ' + esc(ago(p.created_at)) +
      (p.page_id ? ' · <a href="#/p/' + p.page_id + '">page</a>' : '') + (p.device_id ? ' · <a href="#/d/' + p.device_id + '">device</a>' : '') + (p.gear ? ' · <a href="#/patch?g=' + esc(p.gear) + '">on the stage patch</a>' : '') + '</span>' +
      (p.status === 'resolved' ? '<span class="ok">Resolved by ' + esc(p.resolved_name) + ' ' + esc(ago(p.resolved_at)) + (p.note ? ': ' + esc(p.note) : '') + '</span>' : '') + '</div>' +
      (p.status === 'open' ? '<button class="btn" data-res>' + icon('check') + 'Resolve</button>' : '<button class="ghost" data-reopen>Reopen</button>') + '</div>').join('') + '</div>'
      : '<div class="empty" style="padding:18px 6px">' + (status === 'open' ? 'Nothing open. Nice.' : 'Nothing resolved yet.') + '</div>') + '</div>';
  $$('#pst button', pane).forEach((b) => b.addEventListener('click', () => tabProblems(pane, b.dataset.s)));
  $$('[data-res]', pane).forEach((b) => b.addEventListener('click', () => {
    const id = b.closest('.prob').dataset.id;
    modal('<h3>Resolve</h3><form id="rf"><label>What was done <span class="note">(optional)</span></label><textarea id="rn" rows="3" placeholder="Replaced the lav cable"></textarea><div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Resolve</button></div></form>', (w, close) => {
      $('#rf', w).addEventListener('submit', async (e) => { e.preventDefault(); await call('PUT', '/api/problems/' + id, { status: 'resolved', note: $('#rn', w).value }); close(); await loadState(); paintHeader(); viewAdmin('problems'); });
    });
  }));
  $$('[data-reopen]', pane).forEach((b) => b.addEventListener('click', async () => { await call('PUT', '/api/problems/' + b.closest('.prob').dataset.id, { status: 'open' }); await loadState(); paintHeader(); tabProblems(pane, 'resolved'); }));
}

/** Report a problem (anyone signed in). where = what it is about; ctx = { page_id, device_id, gear }. */
function reportProblem(where, ctx = {}) {
  modal('<h3>Report a problem</h3><p>Tell the admins what is wrong. They see it in Admin › Problems.</p><form id="rpf"><label>About</label><input id="rpw" value="' + esc(where || '') + '">' +
    '<label>What is wrong?</label><textarea id="rpt" rows="4" placeholder="Pastor lav cuts out when he turns his head"></textarea><div class="err" id="rpe"></div>' +
    '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">Send</button></div></form>', (w, close) => {
    setTimeout(() => $('#rpt', w).focus(), 40);
    $('#rpf', w).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await call('POST', '/api/problems', { ...ctx, where: $('#rpw', w).value, text: $('#rpt', w).value }); close(); toast('Sent to the admins. Thank you!', 'ok'); if (can('admin')) { await loadState(); paintHeader(); } }
      catch (err) { $('#rpe', w).textContent = err.message; }
    });
  });
}

// ----- admin: the checklist log -----
/**
 * Admin › To do lists: the groups and the lists in them, all on the To do page. Make, edit (steps, reset times,
 * group), reorder, start over and remove lists; add, rename, reorder and remove groups.
 */
const SCHED_DAYS = [['daily', 'Every day'], [0, 'Sundays'], [1, 'Mondays'], [2, 'Tuesdays'], [3, 'Wednesdays'], [4, 'Thursdays'], [5, 'Fridays'], [6, 'Saturdays']];
async function tabTodoLists(pane) {
  const d = await get('/api/todo/lists');
  const groups = d.groups;
  const tm = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const state = (x) => x.total && x.left === 0 ? '<span class="chip ok">Done</span>' : x.overdue ? '<span class="chip bad">Overdue</span>'
    : x.left < x.total ? '<span class="chip warn">In progress · ' + (x.total - x.left) + ' of ' + x.total + '</span>' : x.schedule.length && x.active ? '<span class="chip acc">On To do now</span>' : '';
  const flat = groups.flatMap((g) => g.lists);
  const row = (x, gi, li, n) => '<div class="tlrow"><div class="tlmv"><button class="ghost xs" data-up="' + gi + ':' + li + '"' + (li ? '' : ' disabled') + ' title="Up">' + icon('up') + '</button><button class="ghost xs" data-dn="' + gi + ':' + li + '"' + (li < n - 1 ? '' : ' disabled') + ' title="Down">' + icon('down') + '</button></div>' +
    '<div class="tlt"><b>' + esc(x.title) + '</b><span>' + x.total + ' step' + (x.total === 1 ? '' : 's') + ' · <a href="#/todo?l=' + encodeURIComponent(x.id) + '">open on To do</a></span>' +
    '<span class="note">' + (x.scheduleText.length ? icon('clock') + esc(x.scheduleText.join('; ')) : 'No reset times: on To do while someone has started it') + (x.lastBy ? ' · last ticked by ' + esc(x.lastBy) + ' ' + esc(ago(x.lastAt)) : '') + (x.nextReset ? ' · next reset ' + esc(tm(x.nextReset)) : '') + '</span></div>' +
    state(x) + '<div class="tla"><button class="btn" data-ed="' + esc(x.id) + '">' + icon('edit') + 'Edit</button><button class="ghost" data-rs="' + esc(x.id) + '" title="Start it over: clears every tick">' + icon('restore') + '</button><button class="ghost danger" data-rm="' + esc(x.id) + '" title="Remove">' + icon('trash') + '</button></div></div>';
  pane.innerHTML = '<p class="note pnote">Every to do list lives on the <a href="#/todo">To do</a> page, in its group. A list shows as open there while someone has started it and not finished, and a list with reset times opens at each reset until the end of that day (red after its done-by time).</p>' +
    '<div class="bar" style="margin:0 0 10px"><span class="grow note">' + flat.length + ' list' + (flat.length === 1 ? '' : 's') + ' in ' + groups.length + ' group' + (groups.length === 1 ? '' : 's') + '</span>' +
    '<button class="btn" id="tlGrp">' + icon('list') + 'Groups</button><button class="primary btn" id="tlNew">' + icon('plus') + 'New list</button></div>' +
    (groups.length ? groups.map((g, gi) => '<section class="tlgrp"><div class="gbh"><span>' + esc(g.name || 'No group') + '</span><em>' + g.lists.length + '</em><button class="ghost xs" data-newin="' + gi + '" title="New list in this group">' + icon('plus') + '</button></div>' +
      (g.lists.length ? '<div class="tllist">' + g.lists.map((x, li) => row(x, gi, li, g.lists.length)).join('') + '</div>' : '<p class="note">No lists in this group yet.</p>') + '</section>').join('')
      : '<div class="card empty">No to do lists yet. Make a group (Sunday morning, Audio, Video…) and the lists in it.</div>');
  const again = () => tabTodoLists(pane);
  const find = (id) => flat.find((x) => x.id === id);
  $('#tlNew', pane).addEventListener('click', () => todoListDialog(null, groups, again));
  $('#tlGrp', pane).addEventListener('click', () => todoGroupsDialog(groups, again));
  $$('[data-newin]', pane).forEach((b) => b.addEventListener('click', () => todoListDialog(null, groups, again, groups[Number(b.dataset.newin)].name)));
  $$('[data-ed]', pane).forEach((b) => b.addEventListener('click', () => todoListDialog(find(b.dataset.ed), groups, again)));
  const move = async (key, dir) => {
    const [gi, li] = key.split(':').map(Number);
    const g = groups[gi], j = li + dir;
    if (j < 0 || j >= g.lists.length) return;
    [g.lists[li], g.lists[j]] = [g.lists[j], g.lists[li]];
    try { await call('PUT', '/api/todo/arrange', { order: groups.flatMap((x) => x.lists.map((l) => l.id)) }); again(); } catch (e) { toast(e.message, 'bad'); }
  };
  $$('[data-up]', pane).forEach((b) => b.addEventListener('click', () => move(b.dataset.up, -1)));
  $$('[data-dn]', pane).forEach((b) => b.addEventListener('click', () => move(b.dataset.dn, 1)));
  $$('[data-rs]', pane).forEach((b) => b.addEventListener('click', async () => {
    const x = find(b.dataset.rs);
    if (!await confirmBox('Start ' + x.title + ' over?', 'Every tick is cleared for everyone. The run so far stays in the checklist log.', 'Start over')) return;
    try { await call('POST', '/api/pages/0/checklists/' + encodeURIComponent(x.id) + '/reset'); toast('Started over', 'ok'); loadState().then(paintHeader); again(); } catch (e) { toast(e.message, 'bad'); }
  }));
  $$('[data-rm]', pane).forEach((b) => b.addEventListener('click', async () => {
    const x = find(b.dataset.rm);
    if (!await confirmBox('Remove ' + x.title + '?', 'The list and its ticks are removed. Its past runs stay in the checklist log until then.', 'Remove', true)) return;
    try { await call('DELETE', '/api/todo/lists/' + encodeURIComponent(x.id)); toast('Removed', 'ok'); loadState().then(paintHeader); again(); } catch (e) { toast(e.message, 'bad'); }
  }));
}
/** New or edit: group, title, steps (one per line), reset times. */
function todoListDialog(x, groups, done, inGroup) {
  const rows = x ? x.schedule.map((r) => ({ ...r })) : [];
  const names = groups.map((g) => g.name).filter(Boolean);
  const cur = x ? x.group : inGroup != null ? inGroup : names[0] || '';
  const schedHtml = () => rows.map((r, i) => '<div class="tlsr"><select data-sd="' + i + '">' + SCHED_DAYS.map(([v, l]) => '<option value="' + v + '"' + (String(v) === String(r.day) ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    '<label>reset<input type="time" data-sr="' + i + '" value="' + esc(r.reset || '06:00') + '"></label><label>done by<input type="time" data-su="' + i + '" value="' + esc(r.due || '') + '"></label><button type="button" class="ghost xs" data-sx="' + i + '">' + icon('x') + '</button></div>').join('') || '<p class="note">No reset times: it shows as open on To do while someone has started it.</p>';
  modal('<h3>' + (x ? 'Edit ' + esc(x.title) : 'New to do list') + '</h3><form id="tlf">' +
    '<div class="two"><div><label>Group</label><input id="tl_g" list="tl_gs" value="' + esc(cur) + '" placeholder="Sunday morning"><datalist id="tl_gs">' + names.map((n) => '<option value="' + esc(n) + '">').join('') + '</datalist></div>' +
    '<div><label>Title</label><input id="tl_t" value="' + esc(x ? x.title : '') + '" placeholder="FOH startup" required></div></div>' +
    '<label>Steps <span class="note">(one per line)</span></label><textarea id="tl_i" rows="9" placeholder="Power on the rack&#10;Ring out the monitors&#10;Check every wireless mic">' + esc(x ? x.steps.join('\n') : '') + '</textarea>' +
    '<label>Reset times</label><div id="tl_sc" class="tlsc"></div><button type="button" class="btn" id="tl_add">' + icon('plus') + 'Add a reset time</button>' +
    '<div class="acts"><button type="button" data-close>Cancel</button><button class="primary">' + (x ? 'Save' : 'Make it') + '</button></div></form>', (w, close) => {
    w.classList.add('mwide');
    const paintS = () => {
      $('#tl_sc', w).innerHTML = schedHtml();
      $$('[data-sd]', w).forEach((e) => e.addEventListener('change', () => { rows[Number(e.dataset.sd)].day = e.value === 'daily' ? 'daily' : Number(e.value); }));
      $$('[data-sr]', w).forEach((e) => e.addEventListener('change', () => { rows[Number(e.dataset.sr)].reset = e.value; }));
      $$('[data-su]', w).forEach((e) => e.addEventListener('change', () => { rows[Number(e.dataset.su)].due = e.value; }));
      $$('[data-sx]', w).forEach((e) => e.addEventListener('click', () => { rows.splice(Number(e.dataset.sx), 1); paintS(); }));
    };
    paintS();
    $('#tl_add', w).addEventListener('click', () => { rows.push({ day: 0, reset: '06:00', due: '' }); paintS(); });
    setTimeout(() => $(x ? '#tl_i' : '#tl_t', w).focus(), 40);
    $('#tlf', w).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { group: $('#tl_g', w).value.trim(), title: $('#tl_t', w).value.trim(), items: $('#tl_i', w).value.split('\n').map((t) => t.trim()).filter(Boolean), schedule: rows.map((r) => ({ day: r.day, reset: r.reset || '06:00', due: r.due || '' })) };
      if (!body.title) return toast('Give it a title', 'bad');
      if (!body.items.length) return toast('Add at least one step', 'bad');
      try {
        if (x) await call('PUT', '/api/todo/lists/' + encodeURIComponent(x.id), body); else await call('POST', '/api/todo/lists', body);
        close(); toast(x ? 'Saved' : 'List made', 'ok'); loadState().then(paintHeader); done();
      } catch (err) { toast(err.message, 'bad'); }
    });
  });
}
/** Add, rename, reorder and remove groups (a removed group's lists move to the first group). */
function todoGroupsDialog(groups, done) {
  const rows = groups.map((g) => ({ name: g.name, was: g.name, n: g.lists.length }));
  const paint = (w) => {
    $('#tgl', w).innerHTML = rows.map((r, i) => '<div class="bkrow"><input data-i="' + i + '" value="' + esc(r.name) + '" maxlength="80" placeholder="Group name"><span class="note">' + r.n + '</span>' +
      '<button type="button" class="ghost xs" data-u="' + i + '"' + (i ? '' : ' disabled') + '>' + icon('up') + '</button><button type="button" class="ghost xs" data-d="' + i + '"' + (i < rows.length - 1 ? '' : ' disabled') + '>' + icon('down') + '</button>' +
      '<button type="button" class="ghost xs danger" data-x="' + i + '" title="Remove (its lists move to the first group)">' + icon('x') + '</button></div>').join('') || '<p class="note">No groups yet.</p>';
    $$('[data-i]', w).forEach((x) => x.addEventListener('input', () => { rows[Number(x.dataset.i)].name = x.value; }));
    $$('[data-u]', w).forEach((x) => x.addEventListener('click', () => { const i = Number(x.dataset.u); [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; paint(w); }));
    $$('[data-d]', w).forEach((x) => x.addEventListener('click', () => { const i = Number(x.dataset.d); [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; paint(w); }));
    $$('[data-x]', w).forEach((x) => x.addEventListener('click', () => { rows.splice(Number(x.dataset.x), 1); paint(w); }));
  };
  modal('<h3>To do groups</h3><p class="note">Groups split the To do page into sections, like Sunday morning, Wednesday night, Audio or Video. Rename or reorder them here.</p><div id="tgl" class="bkl"></div>' +
    '<button type="button" class="btn" id="tgadd">' + icon('plus') + 'Add a group</button><div class="acts"><button type="button" data-close>Cancel</button><button class="primary" id="tgok">Save</button></div>', (w, close) => {
    paint(w);
    $('#tgadd', w).addEventListener('click', () => { rows.push({ name: '', was: null, n: 0 }); paint(w); const ins = $$('[data-i]', w); ins[ins.length - 1].focus(); });
    $('#tgok', w).addEventListener('click', async () => {
      const keep = rows.filter((r) => r.name.trim());
      const renames = {}; keep.forEach((r) => { if (r.was != null && r.was !== r.name.trim()) renames[r.was] = r.name.trim(); });
      try { await call('PUT', '/api/todo/arrange', { groups: keep.map((r) => r.name.trim()), renames }); close(); toast('Groups saved', 'ok'); done(); } catch (e) { toast(e.message, 'bad'); }
    });
  });
}

async function tabChecklog(pane, pick) {
  const q = pick ? '?page=' + encodeURIComponent(pick.split(':')[0]) + '&block=' + encodeURIComponent(pick.split(':')[1]) : '';
  const d = await get('/api/checklog' + q);
  const tmx = (t) => (t ? new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const dur = (a, b) => { const m = Math.round((b - a) / 60000); return m < 1 ? 'under a minute' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
  pane.innerHTML = '<p class="note pnote">Every run of every checklist: who did it, when it was finished and how long it took, and what was left undone.</p>' +
    '<div class="card"><div class="bar" style="margin-bottom:6px"><h2 class="grow" style="margin:0">Checklist log</h2><select id="clp"><option value="">All checklists</option>' +
    d.checklists.map((c) => '<option value="' + c.page_id + ':' + esc(c.block_id) + '"' + (pick === c.page_id + ':' + c.block_id ? ' selected' : '') + '>' + esc((c.title || 'Checklist') + ' · ' + c.page_title) + '</option>').join('') + '</select></div>' +
    (d.runs.length ? '<div class="tscroll"><table class="grid"><thead><tr><th>Run</th><th>Checklist</th><th>Done</th><th>Finished</th><th>Took</th><th>Who</th></tr></thead><tbody>' + d.runs.map((r) =>
      '<tr class="' + (r.completed_at ? '' : r.over ? 'missed' : 'live') + '"><td>' + esc(tmx(r.run_start)) + '</td><td><a href="' + esc(todoHref(r)) + '">' + esc(r.title) + '</a><div class="note">' + esc(r.page_title) + '</div></td>' +
      '<td>' + r.done + ' / ' + r.total + (r.missed.length ? '<div class="note">' + (r.over ? 'Not done: ' : 'Left: ') + esc(r.missed.join(', ')) + '</div>' : '') + '</td>' +
      '<td>' + (r.completed_at ? '<span class="chip ok">' + esc(tmx(r.completed_at)) + '</span>' : r.over ? '<span class="chip bad">Not finished</span>' : '<span class="chip acc">In progress</span>') + '</td>' +
      '<td>' + (r.first_at && r.last_at && r.completed_at ? esc(dur(r.first_at, r.last_at)) : '') + '</td><td>' + esc(r.people.join(', ')) + '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="empty" style="padding:18px 6px">No checklist runs yet. They show up here as soon as someone ticks a step.</div>') + '</div>';
  $('#clp', pane).addEventListener('change', (e) => tabChecklog(pane, e.target.value));
}

// ----- admin: church name and logo -----
function tabChurch(pane) {
  const org = S.state.org || {};
  pane.innerHTML = '<div class="card"><h2>Church</h2>' +
    setRow('Name', 'Shown on the sign-in screen, the home page and every PDF.', '<input class="txt" id="orgn" value="' + esc(org.name || '') + '" placeholder="Rolling Hills Community Church">', true) +
    setRow('Logo', 'A square or wide picture (PNG with a clear background looks best). Shown when signing in and on PDFs.', (org.logo ? '<img class="orglogo sm" src="/uploads/' + esc(org.logo) + '" alt="">' : '') + '<input type="file" accept="image/*" id="orgf" class="hide"><button id="orgp">' + (org.logo ? 'Replace' : 'Upload') + '</button>' + (org.logo ? '<button class="ghost danger" id="orgx">Remove</button>' : '')) +
    setRow('', '', '<button class="primary" id="orgs">Save</button>') + '</div>';
  $('#orgp').addEventListener('click', () => $('#orgf').click());
  $('#orgf').addEventListener('change', async () => {
    const f = $('#orgf').files[0]; if (!f) return;
    try {
      const pic = await shrink(f);
      const r = await call('POST', '/api/uploads', pic.blob, { raw: true, type: pic.type, headers: { 'x-width': String(pic.w || ''), 'x-height': String(pic.h || '') } });
      await call('PUT', '/api/org', { logo: r.id }); await loadState(); paintHeader(); tabChurch(pane); toast('Logo saved', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  });
  const x = $('#orgx'); if (x) x.addEventListener('click', async () => { await call('PUT', '/api/org', { logo: '' }); await loadState(); paintHeader(); tabChurch(pane); });
  $('#orgs').addEventListener('click', async () => { try { await call('PUT', '/api/org', { name: $('#orgn').value }); await loadState(); paintHeader(); toast('Saved', 'ok'); } catch (e) { toast(e.message, 'bad'); } });
}

// ----- admin: reset -----
function tabReset(pane) {
  pane.innerHTML = '<div class="card"><h2>Reset</h2><p class="note" style="margin-top:0">Both make a backup first (Admin › Backups), so a reset can be undone by restoring it.</p>' +
    setRow('Clear content', 'Removes every page, space, device card, the stage patch, IP lists, VLANs, pictures, manuals, problem reports and the checklist log. People, PINs and settings (church name, logo, notifications) stay.', '<button class="danger" data-reset="content">Clear content…</button>', true) +
    setRow('Factory reset', 'Removes everything, including every person and setting. LiveGenie starts again at the first-run setup screen. Backups are kept.', '<button class="danger" data-reset="factory">Factory reset…</button>') + '</div>';
  $$('[data-reset]', pane).forEach((b) => b.addEventListener('click', () => {
    const mode = b.dataset.reset;
    modal('<h3>' + (mode === 'factory' ? 'Factory reset' : 'Clear content') + '</h3><p>' + (mode === 'factory' ? 'Everything goes, including all people. You will set LiveGenie up again from the start.' : 'All content goes; people and settings stay.') + ' A backup is made first.</p>' +
      '<form id="rsf"><label>Type RESET to confirm</label><input id="rsc" autocomplete="off" autocapitalize="characters"><div class="err" id="rse"></div><div class="acts"><button type="button" data-close>Cancel</button><button class="primary danger" id="rsb" disabled>' + (mode === 'factory' ? 'Factory reset' : 'Clear content') + '</button></div></form>', (w, close) => {
      const inp = $('#rsc', w), btn = $('#rsb', w);
      btn.style.background = 'var(--bad)'; btn.style.color = '#fff';
      inp.addEventListener('input', () => { btn.disabled = inp.value.trim().toUpperCase() !== 'RESET'; });
      $('#rsf', w).addEventListener('submit', async (e) => {
        e.preventDefault();
        btn.disabled = true; btn.textContent = 'Working…';
        try {
          const r = await call('POST', '/api/admin/reset', { mode, confirm: inp.value });
          close();
          try { sessionStorage.removeItem('livegenie-view-as'); } catch (x) { /* ignore */ }
          toast(mode === 'factory' ? 'LiveGenie is reset. Backup: ' + r.backup : 'Content cleared. Backup: ' + r.backup, 'ok');
          if (typeof forgetDevices === 'function') forgetDevices();
          S.spaces = [];
          await loadState(); paintHeader(); location.hash = '#/'; route();
        } catch (err) { $('#rse', w).textContent = err.message; btn.disabled = false; btn.textContent = 'Try again'; }
      });
    });
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
  Shell.setCtx({});
  document.body.classList.toggle('wideview', p[0] === 'patch');
  if (p[0] !== 'settings') S.lastRoute = h;
  if (p[0] !== 'search') $('#q').value = '';
  try {
    if (S.state.setupNeeded) return await viewSetup();
    if (p[0] === 'link' && p[1]) return await useSignInLink(p[1]);
    if (!S.state.user) { Shell.update(p); return viewSignIn(); }
    if (!p.length) await viewHome();
    else if (p[0] === 's' && p[1]) await viewSpace(p[1]);
    else if (p[0] === 'p' && p[1] && p[2] === 'edit') await viewEdit(p[1], null, qs.get('draw'));
    else if (p[0] === 'p' && p[1] && p[2] === 'history') await viewHistory(p[1], p[3]);
    else if (p[0] === 'p' && p[1]) await viewPage(p[1], qs.get('c'));
    else if (p[0] === 'new') await viewEdit(null, qs.get('space'));
    else if (p[0] === 'map') await viewMap(p[1]);
    else if (p[0] === 'patch') await PatchView.view(qs);
    else if (p[0] === 'gear-setup') await viewGearSetup();
    else if ((p[0] === 'devices' || p[0] === 'gear') && p[1] === 'new') await viewDeviceEdit(null);
    else if (p[0] === 'devices' || p[0] === 'gear') await viewDevices(qs);
    else if (p[0] === 'd' && p[1] && p[2] === 'edit') await viewDeviceEdit(p[1]);
    else if (p[0] === 'd' && p[1]) await viewDevice(p[1]);
    else if (p[0] === 'search') await viewSearch(qs.get('q') || '');
    else if (p[0] === 'todo') await viewTodo(qs);
    else if (p[0] === 'settings') await viewSettings(p[1]);
    else if (p[0] === 'admin') await viewAdmin(p[1]);
    else app.innerHTML = '<div class="card empty">Page not found. <a href="#/">Go home</a></div>';
    if (n === routing && !S.noScroll) window.scrollTo(0, 0);
    S.noScroll = false;
    if (n === routing) Shell.update(p);
  } catch (e) {
    if (n !== routing) return;
    if (!S.offline) app.innerHTML = '<div class="card empty">' + esc(e.message) + '<div style="margin-top:12px"><a href="#/">Go home</a></div></div>';
    Shell.update(p);
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

Shell.init();
route();
