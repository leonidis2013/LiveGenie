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
    return { todo: 'todo', search: 'search', gear: 'devices', devices: 'devices', d: 'devices', 'gear-setup': 'devices', map: 'map', racks: 'racks', patch: 'patch', settings: 'settings', admin: 'admin', s: 'space', p: 'space', new: 'space' }[p[0]] || 'home';
  }
  const EDITING = (p) => (p[0] === 'p' && (p[2] === 'edit')) || p[0] === 'new' || ((p[0] === 'devices' || p[0] === 'gear') && p[1] === 'new') || (p[0] === 'd' && p[2] === 'edit') || p[0] === 'gear-setup';

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
    const st0 = S.state;
    const td = st0.todo || { open: 0, overdue: 0 };
    // the admin group: only for admins (not while viewing as a user)
    let adm = '';
    if (can('admin')) {
      let shut = false; try { shut = localStorage.getItem('lg-admgrp') === '0'; } catch (e) { /* private mode */ }
      const tab = section === 'admin' ? (location.hash.split('/')[2] || 'spaces').split('?')[0] : '';
      const ai = (t, label, ic, extra) => '<a class="sn sa' + (tab === t ? ' on' : '') + '" href="#/admin/' + t + '">' + icon(ic) + '<span>' + label + '</span>' + (extra || '') + '</a>';
      adm = '<button type="button" class="shd shdbtn' + (shut ? ' shut' : '') + '" id="sAdm">' + icon('gear') + 'Admin' + (shut && st0.problems ? '<b class="cnt bad">' + st0.problems + '</b>' : '') + '<i>' + (shut ? '▸' : '▾') + '</i></button>' +
        (shut ? '' : '<div class="sadm">' +
          ai('people', 'Users', 'users') + ai('spaces', 'Spaces', 'list') +
          ai('problems', 'Problems', 'alert', st0.problems ? '<b class="cnt bad" title="Open problem reports">' + st0.problems + '</b>' : '') +
          ai('todo', 'To do lists', 'check') + ai('checklog', 'Checklist log', 'clock') +
          ai('setup', 'Equipment setup', 'spark') +
          ai('church', 'Church', 'image') + ai('notify', 'Notifications', 'bell') + ai('backups', 'Backups', 'box') + ai('storage', 'Storage', 'image') +
          ai('trash', 'Trash', 'trash') + ai('activity', 'Activity', 'clock') + ai('reset', 'Reset', 'restore') + '</div>');
    }
    nav.innerHTML = item('#/', 'Home', 'home', section === 'home') +
      '<a class="sn' + (section === 'todo' ? ' on' : '') + (td.open ? ' glow' + (td.overdue ? ' bad' : '') : '') + '" href="#/todo">' + icon('check') + '<span>To do</span>' + todoBadge() + '</a>' +
      item('#/gear', 'Gear Locker', 'box', section === 'devices' && !location.hash.startsWith('#/gear-setup')) +
      item('#/patch', 'Stage patch', 'grid', section === 'patch') +
      item('#/map', 'System map', 'net', section === 'map') +
      item('#/racks', 'Racks', 'rack', section === 'racks') +
      adm +
      '<div class="shd">Spaces</div>' +
      list.map((s) => {
        const open = s.slug === cur;
        const pages = open ? (pagesBySpace[s.slug] || []) : [];
        return '<a class="ssp' + (open && !ctx.page ? ' on' : '') + (open ? ' open' : '') + '" href="#/s/' + esc(s.slug) + '" style="--sc:' + esc(s.color || '#4c8dff') + '"><i></i><span>' + esc(s.name) + '</span>' + (s.admin_only ? icon('lock') : '') + '<em>' + (s.pages || '') + '</em></a>' +
          (open && pages.length ? '<div class="spg">' + pages.map((p) => '<a href="#/p/' + p.id + '"' + (String(p.id) === String(ctx.page) ? ' class="on"' : '') + ' title="' + esc(p.title) + '">' + esc(p.title) + (p.tech_only ? icon('lock') : '') + '</a>').join('') + '</div>' : '');
      }).join('');
    const st = S.state, u = st.user, upd = st.update && st.update.available;
    $('#sfoot').innerHTML =
      (can('admin') ? '<button class="primary btn snew" id="sNew">' + icon('plus') + 'New page</button>' : '') +
      (canViewAs() ? '<label class="tog vas' + (viewAs() ? ' on' : '') + '" title="See LiveGenie the way users do"><input type="checkbox" id="sVas"' + (viewAs() ? ' checked' : '') + '>View as user</label>' : '') +
      (upd ? '<a class="pill acc supd" href="#/settings/about">' + icon('download') + 'Update available' + (st.update.latest ? ' · ' + esc(st.update.latest) : '') + '</a>' : '') +
      '<div class="sme">' + (u
        ? '<a class="who" href="#/settings/account" title="Your account"><span class="av">' + esc(u.name.slice(0, 1).toUpperCase()) + '</span><span class="nm">' + esc(u.name) + '<small>' + esc({ admin: 'Admin', user: 'User' }[st.role] || '') + '</small></span></a>'
        : '<button class="btn" id="sSign">' + icon('user') + 'Sign in</button>') +
      '<a class="gear sgear' + (section === 'settings' ? ' on' : '') + '" href="#/settings" title="Settings" aria-label="Settings">' + icon('gear', '') + '</a></div>';
    const sn = $('#sNew'); if (sn) sn.addEventListener('click', newPage);
    const va = $('#sVas'); if (va) va.addEventListener('change', () => setViewAs(va.checked));
    const ss = $('#sSign'); if (ss) ss.addEventListener('click', () => signInDialog());
    const sa = $('#sAdm'); if (sa) sa.addEventListener('click', () => { try { localStorage.setItem('lg-admgrp', sa.classList.contains('shut') ? '1' : '0'); } catch (e) { /* private mode */ } paintSide(); });
  }

  function paintTabs() {
    const tabs = $('#tabs');
    if (!tabs || !S.state) return;
    tabs.querySelectorAll('[data-t]').forEach((t) => t.classList.toggle('on', t.dataset.t === section || (t.dataset.t === 'more' && ['space', 'map', 'racks', 'patch', 'settings', 'admin'].includes(section))));
    const b = tabs.querySelector('[data-t=todo] .cnt'), td = S.state.todo || { open: 0, overdue: 0 };
    const tt = tabs.querySelector('[data-t=todo]'); tt.classList.toggle('glow', td.open > 0); tt.classList.toggle('bad', td.overdue > 0);
    b.textContent = td.overdue || td.open || '';
    b.classList.toggle('hide', !td.open);
    b.classList.toggle('bad', td.overdue > 0);
    tabs.querySelector('[data-t=more] .dot').classList.toggle('hide', !(S.state.update && S.state.update.available));
  }

  /** Admins can switch to seeing LiveGenie as a user sees it, and back. */
  const canViewAs = () => !!(S.state && S.state.user && (S.state.user.role === 'admin' || S.state.viewAs));
  async function setViewAs(on) {
    try { if (on) sessionStorage.setItem('livegenie-view-as', 'user'); else sessionStorage.removeItem('livegenie-view-as'); } catch (e) { /* private mode */ }
    await loadState(); paintHeader(); route();
    toast(on ? 'Viewing LiveGenie as a user' : 'Back to the admin view');
  }

  function newPage() { location.hash = ctx.space ? '#/new?space=' + encodeURIComponent(ctx.space) : '#/new'; }

  /** Phone: everything that is not a tab. */
  async function moreSheet() {
    const list = spaces || await loadSpaces();
    const st = S.state, u = st.user, upd = st.update && st.update.available;
    const row = (href, ic, label, sub) => '<a class="mrow" href="' + href + '" data-close>' + icon(ic) + '<span><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></a>';
    modal('<div class="more">' +
      (u ? '<a class="mme" href="#/settings/account" data-close><span class="av">' + esc(u.name.slice(0, 1).toUpperCase()) + '</span><span><b>' + esc(u.name) + '</b><small>' + esc({ admin: 'Admin', user: 'User' }[st.role] || '') + ' · account</small></span></a>'
        : '<button class="primary mbtn" id="mSign">' + icon('user') + 'Sign in</button>') +
      (upd ? row('#/settings/about', 'download', 'Update available', esc(st.update.latest || '')) : '') +
      (can('admin') ? '<button class="mbtn" id="mNew">' + icon('plus') + 'New page</button>' : '') +
      '<div class="mh">Spaces</div>' + list.map((s) => row('#/s/' + esc(s.slug), 'list', esc(s.name), s.pages + ' page' + (s.pages === 1 ? '' : 's'))).join('') +
      '<div class="mh">More</div>' + row('#/gear', 'box', 'Gear Locker', 'Every piece of gear, its manuals and IP') + row('#/patch', 'grid', 'Stage patch', 'Mic to speaker, every cable') + row('#/map', 'net', 'System map', 'Signal flow' + (can('admin') ? ', network and VLANs' : '')) + row('#/racks', 'rack', 'Racks', 'What sits where in each rack, and power') +
      
      (can('admin') ? '<div class="mh">Admin</div>' + row('#/admin/people', 'users', 'Users', 'Admins and users, PINs, phone sign-in') + row('#/admin/spaces', 'list', 'Spaces', 'Make, colour, order, admins only') +
        row('#/admin/problems', 'alert', 'Problems' + (st.problems ? ' · ' + st.problems + ' open' : ''), 'What users reported') + row('#/admin/todo', 'check', 'To do lists', 'Every checklist, its steps and reset times') + row('#/admin/checklog', 'clock', 'Checklist log', 'Who ran what, when') + row('#/admin/setup', 'spark', 'Equipment setup', 'The guided setup: run it again') +
        row('#/admin/church', 'image', 'System settings', 'Church, notifications, backups, trash, activity, reset') : '') +
      (canViewAs() ? '<button class="mbtn" id="mVas">' + icon('user') + (viewAs() ? 'Back to admin view' : 'View as user') + '</button>' : '') +
      row('#/settings', 'gear', 'Settings', 'Display, account' + (can('admin') ? ', users, backups' : '')) +
      '</div>', (w, close) => {
      w.classList.add('sheet');
      const si = $('#mSign', w); if (si) si.addEventListener('click', () => { close(); signInDialog(); });
      const nw = $('#mNew', w); if (nw) nw.addEventListener('click', () => { close(); newPage(); });
      const mv = $('#mVas', w); if (mv) mv.addEventListener('click', () => { close(); setViewAs(!viewAs()); });
    });
  }

  function init() {
    const tabs = $('#tabs');
    tabs.innerHTML = '<a href="#/" data-t="home">' + icon('home') + '<span>Home</span></a>' +
      '<a href="#/todo" data-t="todo">' + icon('check') + '<span>To do</span><b class="cnt hide"></b></a>' +
      '<a href="#/search" data-t="search">' + icon('search') + '<span>Search</span></a>' +
      '<a href="#/gear" data-t="devices">' + icon('box') + '<span>Gear</span></a>' +
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
    document.body.classList.toggle('wideview', p[0] === 'patch');
    document.body.classList.toggle('setupmode', !!(S.state && (S.state.setupNeeded || !S.state.user)));
    if (!['space'].includes(section)) ctx = {};
    const fabOn = can('admin') && (section === 'home' || (p[0] === 's'));
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

  return { init, update, paintSide, paintTabs, outline, setCtx: (c) => { ctx = c || {}; }, newPage, setViewAs };
})();
