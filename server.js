/*
 * LiveGenie: the RHCC AVL knowledge base. Part of the Live series.
 * Copyright (c) 2026 Jerod Ulicki.
 *
 * One Node process, no outside packages: the web page in public/, a JSON API under /api,
 * and an SQLite database plus pictures and backups in the data folder (/data in Docker).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');
const DB = require('./lib/db');
const Auth = require('./lib/auth');
const Store = require('./lib/store');
const Backup = require('./lib/backup');
const Update = require('./lib/update');

const DATA = path.resolve(process.env.LIVEGENIE_DATA || path.join(__dirname, 'data'));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const BACKUP_AT = (process.env.LIVEGENIE_BACKUP_AT || '02:30').split(':').map(Number);
const MAX_JSON = 4 * 1024 * 1024;
const MAX_BACKUP_UPLOAD = 4 * 1024 * 1024 * 1024;
const PUBLIC = path.join(__dirname, 'public');

fs.mkdirSync(DATA, { recursive: true });
const restoreNote = Backup.applyPending(DATA);
if (restoreNote) console.log(restoreNote);

const db = DB.open(path.join(DATA, 'livegenie.db'));
const auth = Auth.create(db);
const store = Store.create(db, DATA);
const update = Update.create(pkg.version);
if (restoreNote) store.audit(null, 'backup.restored', '', restoreNote);

// ---------- small http helpers ----------
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
    ...headers
  });
  res.end(data);
}

const fail = (res, status, error, extra) => send(res, status, { ok: false, error, ...(extra || {}) });

function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function sessionCookie(token, maxAge) {
  return 'lg_s=' + (token || '') + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new Store.UserError('That is too large to upload', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) throw new Store.UserError('Expected JSON', 415);
  const buf = await readBody(req, MAX_JSON);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { throw new Store.UserError('Bad JSON'); }
}

function streamToFile(req, file, limit) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { req.destroy(); out.destroy(); reject(new Store.UserError('That file is too large', 413)); }
    });
    req.pipe(out);
    out.on('finish', () => resolve(n));
    out.on('error', reject);
    req.on('error', reject);
  });
}

function need(user, role) {
  if (!user) throw new Store.UserError('Sign in first', 401);
  if (!Auth.atLeast(user, role)) throw new Store.UserError('Your role cannot do that', 403);
}

// ---------- static files ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, url) {
  let rel = url === '/' ? '/index.html' : url;
  if (rel === '/favicon.ico') rel = '/icons/favicon.ico';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return false;
  let st;
  try { st = fs.statSync(file); } catch (e) { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': TYPES[ext] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
  });
  if (req.method === 'HEAD') return res.end(), true;
  fs.createReadStream(file).pipe(res);
  return true;
}

function serveFile(req, res, file, type, extra = {}) {
  const st = fs.statSync(file);
  res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': type, 'content-length': st.size, ...extra });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------- API ----------
function state(user) {
  return {
    ok: true,
    name: 'LiveGenie',
    version: pkg.version,
    setupNeeded: !auth.hasUsers(),
    user: user ? { id: user.id, name: user.name, role: user.role } : null,
    role: Auth.roleOf(user),
    update: update.info()
  };
}

let restarting = false;

async function api(req, res, url, user, token) {
  const m = req.method;
  const parts = url.split('/').filter(Boolean).slice(1);     // after "api"
  const [a, b, c, d, e] = parts;

  if (m === 'GET' && a === 'health') return send(res, 200, { ok: true, version: pkg.version });
  if (m === 'GET' && a === 'state') return send(res, 200, state(user));

  // everything that changes something must come from the LiveGenie page (blocks cross-site form posts)
  if (m !== 'GET' && m !== 'HEAD' && req.headers['x-livegenie'] !== '1') return fail(res, 403, 'Missing request header');

  // ----- first run, sign in, sign out -----
  if (m === 'POST' && a === 'setup') {
    if (auth.hasUsers()) return fail(res, 409, 'LiveGenie is already set up');
    const body = await readJson(req);
    store.createUser({ name: body.name, pin: body.pin, role: 'admin' }, null);
    const r = auth.signIn(body.name, body.pin);
    return send(res, 200, { ok: true, user: r.user }, { 'set-cookie': sessionCookie(r.token, 60 * 86400) });
  }
  if (m === 'POST' && a === 'signin') {
    const body = await readJson(req);
    const r = auth.signIn(body.name, body.pin);
    if (!r.ok) return fail(res, 401, r.error);
    store.audit(r.user, 'signin', '', '');
    return send(res, 200, { ok: true, user: r.user }, { 'set-cookie': sessionCookie(r.token, 60 * 86400) });
  }
  if (m === 'POST' && a === 'signout') {
    auth.signOut(token);
    return send(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) });
  }
  if (m === 'POST' && a === 'me' && b === 'pin') {
    need(user, 'volunteer');
    const body = await readJson(req);
    const full = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get(user.id);
    if (!Auth.checkPin(body.current, full.pin_hash)) return fail(res, 400, 'Your current PIN is not right');
    store.updateUser(user.id, { pin: body.pin }, user);
    return send(res, 200, { ok: true });
  }

  // ----- reading -----
  if (m === 'GET' && a === 'home') return send(res, 200, { ok: true, ...store.home(user) });
  if (m === 'GET' && a === 'spaces' && !b) return send(res, 200, { ok: true, spaces: store.spaces(user) });
  if (m === 'GET' && a === 'spaces' && b) return send(res, 200, { ok: true, ...store.pagesIn(b, user) });
  if (m === 'GET' && a === 'search') {
    const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
    return send(res, 200, { ok: true, q, results: store.search(q, user) });
  }

  // ----- pages -----
  if (a === 'pages') {
    if (m === 'POST' && !b) {
      need(user, 'editor');
      const id = store.createPage(await readJson(req), user);
      return send(res, 200, { ok: true, id });
    }
    if (b && !c) {
      if (m === 'GET') {
        const p = store.getPage(b, user);
        if (!p) return fail(res, user ? 404 : 404, user ? 'Page not found' : 'Page not found. If it is a Tech only page, sign in first.');
        return send(res, 200, { ok: true, page: p });
      }
      if (m === 'PUT') {
        need(user, 'editor');
        const v = store.updatePage(b, await readJson(req), user);
        return send(res, 200, { ok: true, version: v });
      }
      if (m === 'DELETE') {
        need(user, 'editor');
        store.deletePage(b, user);
        return send(res, 200, { ok: true });
      }
    }
    if (b && c === 'versions') {
      if (m === 'GET' && !d) return send(res, 200, { ok: true, versions: store.versions(b, user) });
      if (m === 'GET' && d) return send(res, 200, { ok: true, version: store.version(b, d, user) });
      if (m === 'POST' && d && e === 'restore') {
        need(user, 'editor');
        return send(res, 200, { ok: true, version: store.restoreVersion(b, d, user) });
      }
    }
  }

  if (a === 'trash') {
    need(user, 'editor');
    if (m === 'GET' && !b) return send(res, 200, { ok: true, pages: store.trash() });
    if (m === 'POST' && b && c === 'restore') { store.undelete(b, user); return send(res, 200, { ok: true }); }
  }

  // ----- pictures -----
  if (m === 'POST' && a === 'uploads') {
    need(user, 'editor');
    const buf = await readBody(req, Store.MAX_IMAGE + 1024);
    const r = store.saveUpload(buf, req.headers['content-type'], user, { w: req.headers['x-width'], h: req.headers['x-height'] });
    return send(res, 200, { ok: true, ...r });
  }

  // ----- admin -----
  if (a === 'users') {
    need(user, 'admin');
    if (m === 'GET' && !b) return send(res, 200, { ok: true, users: store.users() });
    if (m === 'POST' && !b) return send(res, 200, { ok: true, id: store.createUser(await readJson(req), user) });
    if (m === 'PUT' && b) {
      const r = store.updateUser(b, await readJson(req), user);
      if ((r.pinChanged || r.roleChanged) && Number(b) !== user.id) auth.signOutUser(Number(b));
      return send(res, 200, { ok: true });
    }
    if (m === 'DELETE' && b) { store.deleteUser(b, user); return send(res, 200, { ok: true }); }
  }

  if (a === 'activity' && m === 'GET') { need(user, 'admin'); return send(res, 200, { ok: true, activity: store.activity(200) }); }

  if (a === 'backups') {
    need(user, 'admin');
    if (m === 'GET' && !b) {
      const next = new Date(); next.setHours(BACKUP_AT[0], BACKUP_AT[1] || 0, 0, 0); if (next <= new Date()) next.setDate(next.getDate() + 1);
      return send(res, 200, { ok: true, backups: Backup.list(DATA), keepDays: Backup.KEEP_DAYS, nextAt: next.getTime(), stats: store.stats() });
    }
    if (m === 'POST' && b === 'now') {
      const name = Backup.make(DATA, db, 'manual');
      store.audit(user, 'backup.make', name, '');
      return send(res, 200, { ok: true, name });
    }
    if (m === 'POST' && b === 'upload') {
      const tmp = path.join(DATA, '.upload-' + Date.now() + '.tar');
      try {
        await streamToFile(req, tmp, MAX_BACKUP_UPLOAD);
        const name = Backup.saveUploaded(DATA, fs.readFileSync(tmp), DB.SCHEMA_VERSION);
        store.audit(user, 'backup.upload', name, '');
        return send(res, 200, { ok: true, name });
      } finally { fs.rmSync(tmp, { force: true }); }
    }
    if (m === 'GET' && b && c === 'download') {
      const file = Backup.fileFor(DATA, b);
      if (!file) return fail(res, 404, 'That backup no longer exists');
      return serveFile(req, res, file, 'application/x-tar', { 'content-disposition': 'attachment; filename="' + b + '"', 'cache-control': 'no-store' });
    }
    if (m === 'GET' && b && c === 'inspect') {
      const file = Backup.fileFor(DATA, b);
      if (!file) return fail(res, 404, 'That backup no longer exists');
      return send(res, 200, { ok: true, info: Backup.inspect(file, DB.SCHEMA_VERSION) });
    }
    if (m === 'POST' && b && c === 'restore') {
      if (restarting) return fail(res, 409, 'LiveGenie is already restarting');
      const info = Backup.requestRestore(DATA, b, DB.SCHEMA_VERSION, user.name);
      store.audit(user, 'backup.restore', b, 'requested');
      restarting = true;
      send(res, 200, { ok: true, info, restarting: true });
      setTimeout(() => shutdown('restore'), 400);
      return;
    }
    if (m === 'DELETE' && b) {
      const file = Backup.fileFor(DATA, b);
      if (!file) return fail(res, 404, 'That backup no longer exists');
      fs.rmSync(file, { force: true });
      store.audit(user, 'backup.delete', b, '');
      return send(res, 200, { ok: true });
    }
  }

  if (m === 'POST' && a === 'update-check') {
    need(user, 'admin');
    const okay = await update.check();
    return send(res, 200, { ok: okay, update: update.info(), error: okay ? undefined : (update.info().enabled ? 'Could not reach GitHub to check. Is this machine online?' : 'Update checks are turned off') });
  }

  return fail(res, 404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const token = cookies(req).lg_s;
  try {
    if (restarting && url !== '/api/health') return fail(res, 503, 'LiveGenie is restarting');
    const user = auth.userFor(token);
    if (url === '/api' || url.startsWith('/api/')) return await api(req, res, url, user, token);
    if ((req.method === 'GET' || req.method === 'HEAD') && url.startsWith('/uploads/')) {
      const u = store.upload(url.slice(9).split('.')[0]);
      if (!u || !fs.existsSync(u.path)) return fail(res, 404, 'Picture not found');
      return serveFile(req, res, u.path, u.mime, { 'cache-control': 'private, max-age=31536000, immutable' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, url)) return;
    fail(res, 404, 'Not found');
  } catch (e) {
    if (e instanceof Store.UserError || e.expose) return fail(res, e.status || 400, e.message, e.extra);
    console.error(e);
    if (!res.headersSent) fail(res, 500, 'Something went wrong: ' + e.message);
  }
});

// ---------- start ----------
let stopping = false;
function shutdown(why) {
  if (stopping) return;
  stopping = true;
  console.log('LiveGenie stopping (' + why + ')');
  server.close();
  setTimeout(() => { try { db.close(); } catch (e) { /* already closed */ } process.exit(0); }, 300).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

Backup.daily(BACKUP_AT[0], BACKUP_AT[1] || 0, () => {
  const name = Backup.make(DATA, db, 'nightly');
  store.audit(null, 'backup.nightly', name, '');
});
setInterval(() => auth.prune(), 6 * 3600 * 1000).unref();
update.start();

server.listen(PORT, HOST, () => {
  console.log('LiveGenie ' + pkg.version + ' on http://' + HOST + ':' + PORT + ' (data in ' + DATA + ')');
});

module.exports = { server };
