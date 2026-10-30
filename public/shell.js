/*
 * The two layouts around every view.
 *   Desktop (1024 px and wider: computers, iPad landscape): a sidebar with search, Home, To do,
 *     Devices, System map, the spaces (the current one opened to show its pages), New page and your
 *     account. Wide screens also get an "On this page" outline beside each page.
 *   Phone (narrower: phones, iPad portrait): a slim top bar, a bottom tab bar
 *     (Home, To do, Search, Devices, More), a New page button in thumb reach, dialogs as bottom sheets.
 * Which one shows is pure CSS (a media query), so rotating an iPad switches straight away.
 * Uses helpers from app.js (get, esc, icon, can, S, signInDialog, modal).
 */
'use strict';

const Shell = (() => {
  let spaces = null;
  const pagesBySpace = {};
  let ctx = {};          // { space, page } of the view on screen, for the sidebar
  let section = 'home';

  /** Which tab / sidebar item a route belongs to. */
  function sectionOf(p) {
    if (!p.length) return 'home';
    return { todo: 'todo', search: 'search', devices: 'devices', d: 'devices', 'gear-setup': 'devices', map: 'map', settings: 'settings', s: 'space', p: 'space', new: 'space' }[p[0]] || 'home';
  }
  const EDITING = (p) => (p[0] === 'p' && (p[2] === 'edit')) || p[0] === 'new' || (p[0] === 'devices' && p[1] === 'new') || (p[0] === 'd' && p[2] === 'edit') || p[0] === 'gear-setup';

  async function loadSpaces() {
    try { spaces = (await get('/api/spaces')).spaces; S.spaces = spaces; } catch (e) { /* offline banner */ }
    return spaces || [];
  }
  async function loadPages(slug) {
    try { pagesBySpace[slug] = (await get('/api/spaces/' + encodeURIComponent(slug))).pages; } catch (e) { /* keep the last list */ }
    return pagesBySpace[slug] || [];
  }

  const item = (href, label, ic, on, extra) => '<a class="sn' + (on ? ' on' : '') + '" href="' + href + '">' + icon(ic) + '<span>' + label + '</span>' + (extra || '') + '</a>';
  const todoBadge = () => {
    const td = (S.state && S.state.todo) || { open: 0, overdue: 0 };
    return td.open ? '<b class="cnt' + (td.overdue ? ' bad' : '') + '">' + (td.overdue || td.open) + '</b>' : '';
  };

  function paintSide() {
    const nav = $('#snav');
    if (!nav || !S.state) return;
    const list = spaces || [];
    const cur = ctx.space;
    nav.innerHTML = item('#/', 'Home', 'home', section === 'home') +
      item('#/todo', 'To do', 'check', section === 'todo', todoBadge()) +
      item('#/devices', 'Devices', 'box', section === 'devices') +
      item('#/map', 'System map', 'net', section === 'map') +
      '<div class="shd">Spaces</div>' +
      list.map((s) => {
        const open = s.slug === cur;
        const pages = open ? (pagesBySpace[s.slug] || []) : [];
        return '<a class="ssp' + (open && !ctx.page ? ' on' : '') + (open ? ' open' : '') + '" href="#/s/' + esc(s.slug) + '"><i></i><span>' + esc(s.name) + '</span><em>' + (s.pages || '') + '</em></a>' +
          (open && pages.length ? '<div class="spg">' + pages.map((p) => '<a href="#/p/' + p.id + '"' + (String(p.id) === String(ctx.page) ? ' class="on"' : '') + ' title="' + esc(p.title) + '">' + esc(p.title) + (p.tech_only ? icon('lock') : '') + '</a>').join('') + '</div>' : '');
      }).join('');
    const st = S.state, u = st.user, upd = st.update && st.update.available;
    $('#sfoot').innerHTML =
      (can('editor') ? '<button class="primary btn snew" id="sNew">' + icon('plus') + 'New page</button>' : '') +
      (upd ? '<a class="pill acc supd" href="#/settings/about">' + icon('download') + 'Update available' + (st.update.latest ? ' · ' + esc(st.update.latest) : '') + '</a>' : '') +
      '<div class="sme">' + (u
        ? '<a class="who" href="#/settings/account" title="Your account"><span class="av">' + esc(u.name.slice(0, 1).toUpperCase()) + '</span><span class="nm">' + esc(u.name) + '<small>' + esc({ admin: 'Admin', editor: 'Editor', volunteer: 'Volunteer' }[st.role] || '') + '</small></span></a>'
        : '<button class="btn" id="sSign">' + icon('user') + 'Sign in</button>') +
      '<a class="gear sgear' + (section === 'settings' ? ' on' : '') + '" href="#/settings" title="Settings" aria-label="Settings">' + icon('gear', '') + '</a></div>';
    const sn = $('#sNew'); if (sn) sn.addEventListener('click', newPage);
    const ss = $('#sSign'); if (ss) ss.addEventListener('click', () => signInDialog());
  }

  function paintTabs() {
    const tabs = $('#tabs');
    if (!tabs || !S.state) return;
    tabs.querySelectorAll('[data-t]').forEach((t) => t.classList.toggle('on', t.dataset.t === section || (t.dataset.t === 'more' && ['space', 'map', 'settings'].includes(section))));
    const b = tabs.querySelector('[data-t=todo] .cnt'), td = S.state.todo || { open: 0, overdue: 0 };
    b.textContent = td.overdue || td.open || '';
    b.classList.toggle('hide', !td.open);
    b.classList.toggle('bad', td.overdue > 0);
    tabs.querySelector('[data-t=more] .dot').classList.toggle('hide', !(S.state.update && S.state.update.available));
  }

  function newPage() { location.hash = ctx.space ? '#/new?space=' + encodeURIComponent(ctx.space) : '#/new'; }

  /** Phone: everything that is not a tab. */
  async function moreSheet() {
    const list = spaces || await loadSpaces();
    const st = S.state, u = st.user, upd = st.update && st.update.available;
    const row = (href, ic, label, sub) => '<a class="mrow" href="' + href + '" data-close>' + icon(ic) + '<span><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></a>';
    modal('<div class="more">' +
      (u ? '<a class="mme" href="#/settings/account" data-close><span class="av">' + esc(u.name.slice(0, 1).toUpperCase()) + '</span><span><b>' + esc(u.name) + '</b><small>' + esc({ admin: 'Admin', editor: 'Editor', volunteer: 'Volunteer' }[st.role] || '') + ' · account</small></span></a>'
        : '<button class="primary mbtn" id="mSign">' + icon('user') + 'Sign in</button>') +
      (upd ? row('#/settings/about', 'download', 'Update available', esc(st.update.latest || '')) : '') +
      (can('editor') ? '<button class="mbtn" id="mNew">' + icon('plus') + 'New page</button>' : '') +
      '<div class="mh">Spaces</div>' + list.map((s) => row('#/s/' + esc(s.slug), 'list', esc(s.name), s.pages + ' page' + (s.pages === 1 ? '' : 's'))).join('') +
      '<div class="mh">More</div>' + row('#/map', 'net', 'System map', 'Signal flow' + (can('editor') ? ', network and VLANs' : '')) +
      (can('editor') ? row('#/gear-setup', 'spark', 'Guided equipment setup', 'Console, stage boxes, wireless, in-ears') : '') +
      row('#/settings', 'gear', 'Settings', 'Display, account' + (can('admin') ? ', users, backups' : '')) +
      '</div>', (w, close) => {
      w.classList.add('sheet');
      const si = $('#mSign', w); if (si) si.addEventListener('click', () => { close(); signInDialog(); });
      const nw = $('#mNew', w); if (nw) nw.addEventListener('click', () => { close(); newPage(); });
    });
  }

  function init() {
    const tabs = $('#tabs');
    tabs.innerHTML = '<a href="#/" data-t="home">' + icon('home') + '<span>Home</span></a>' +
      '<a href="#/todo" data-t="todo">' + icon('check') + '<span>To do</span><b class="cnt hide"></b></a>' +
      '<a href="#/search" data-t="search">' + icon('search') + '<span>Search</span></a>' +
      '<a href="#/devices" data-t="devices">' + icon('box') + '<span>Devices</span></a>' +
      '<button type="button" data-t="more">' + icon('menu') + '<span>More</span><i class="dot acc hide"></i></button>';
    tabs.querySelector('[data-t=more]').addEventListener('click', moreSheet);
    $('#fab').innerHTML = icon('plus');
    $('#fab').addEventListener('click', newPage);
    $('#sideSearch').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('#sq').value.trim();
      if (q) location.hash = '#/search?q=' + encodeURIComponent(q);
    });
    // "/" jumps to search on a computer
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable || document.querySelector('.modal')) return;
      e.preventDefault();
      const f = getComputedStyle($('#side')).display !== 'none' ? $('#sq') : null;
      if (f) f.focus(); else location.hash = '#/search';
    });
  }

  /** Called by the router after each view is drawn. */
  async function update(p) {
    section = sectionOf(p);
    document.body.classList.toggle('editing', EDITING(p));
    document.body.classList.toggle('setupmode', !!(S.state && S.state.setupNeeded));
    if (!['space'].includes(section)) ctx = {};
    const fabOn = can('editor') && (section === 'home' || (p[0] === 's'));
    $('#fab').classList.toggle('hide', !fabOn);
    if (p[0] !== 'search') $('#sq').value = '';
    paintSide(); paintTabs();
    if (S.state && !S.state.setupNeeded) {
      await loadSpaces();
      if (ctx.space) await loadPages(ctx.space);
      paintSide();
    }
  }

  /** "On this page": headings and the named lists on a page, beside it on wide screens. */
  function outline(doc, host) {
    const items = [];
    doc.querySelectorAll('.mdb h2, .mdb h3, .mdb h4, .check .ch b, .patch .ph > b, .iplist .ph > b, .ipl .ph > b').forEach((el, i) => {
      const txt = el.textContent.trim();
      if (!txt) return;
      const target = el.closest('.check, .patch, .blockbox') || el;
      if (!target.id) target.id = 'o-' + i;
      items.push({ id: target.id, txt, sub: /H[34]/.test(el.tagName) && el.tagName !== 'H2' ? (el.tagName === 'H4' ? 2 : 1) : 0, kind: el.closest('.check') ? 'check' : el.closest('.patch') ? 'grid' : el.closest('.blockbox') ? 'net' : '' });
    });
    if (items.length < 2) { host.remove(); return false; }
    host.innerHTML = '<div class="oh">On this page</div>' + items.map((x) => '<a href="#" data-o="' + esc(x.id) + '" class="l' + x.sub + '">' + (x.kind ? icon(x.kind) : '') + '<span>' + esc(x.txt) + '</span></a>').join('');
    host.querySelectorAll('[data-o]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const t = document.getElementById(a.dataset.o);
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    // highlight the section being read
    const links = [...host.querySelectorAll('[data-o]')];
    const obs = new IntersectionObserver((ents) => {
      ents.forEach((en) => { if (en.isIntersecting) links.forEach((l) => l.classList.toggle('on', l.dataset.o === en.target.id)); });
    }, { rootMargin: '0px 0px -70% 0px' });
    items.forEach((x) => { const t = document.getElementById(x.id); if (t) obs.observe(t); });
    return true;
  }

  return { init, update, paintSide, paintTabs, outline, setCtx: (c) => { ctx = c || {}; }, newPage };
})();
