/*
 * Backups (spec section 8).
 *
 * A backup is one .tar file in <data>/backups holding a consistent copy of the
 * database (SQLite "VACUUM INTO", safe while LiveGenie is running) plus every
 * uploaded picture. Nightly at 02:30 local time; kept for 14 days (the newest
 * three are always kept).
 *
 * Restoring: the request is written to <data>/restore-request.json and LiveGenie
 * restarts (Docker brings it back). On start, before the database is opened,
 * the current data is saved as a "before-restore" backup and then replaced.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const tar = require('./tar');

const KEEP_DAYS = 14;
const KEEP_MIN = 3;
const NAME_RE = /^livegenie-(\d{4}-\d{2}-\d{2}_\d{6})-(nightly|manual|before-restore|before-update|uploaded)\.tar$/;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function paths(dataDir) {
  return {
    db: path.join(dataDir, 'livegenie.db'),
    uploads: path.join(dataDir, 'uploads'),
    backups: path.join(dataDir, 'backups'),
    request: path.join(dataDir, 'restore-request.json')
  };
}

function uniqueName(dir, kind) {
  let name = 'livegenie-' + stamp() + '-' + kind + '.tar';
  for (let i = 1; fs.existsSync(path.join(dir, name)); i++) {
    const d = new Date(Date.now() + i * 1000);
    name = 'livegenie-' + stamp(d) + '-' + kind + '.tar';
  }
  return name;
}

/** Write a backup using an open database handle (or a database file path). Returns the file name. */
function make(dataDir, dbOrFile, kind) {
  const P = paths(dataDir);
  fs.mkdirSync(P.backups, { recursive: true });
  const tmp = path.join(P.backups, '.tmp-' + process.pid + '-' + Date.now() + '.db');
  const quoted = "'" + tmp.replace(/'/g, "''") + "'";
  if (typeof dbOrFile === 'string') {
    const db = new DatabaseSync(dbOrFile);
    try { db.exec('VACUUM INTO ' + quoted); } finally { db.close(); }
  } else {
    dbOrFile.exec('VACUUM INTO ' + quoted);
  }
  const files = [{ name: 'livegenie.db', path: tmp }];
  if (fs.existsSync(P.uploads)) {
    for (const f of fs.readdirSync(P.uploads)) {
      const full = path.join(P.uploads, f);
      if (fs.statSync(full).isFile()) files.push({ name: 'uploads/' + f, path: full });
    }
  }
  const name = uniqueName(P.backups, kind);
  const part = path.join(P.backups, name + '.part');
  try {
    tar.write(part, files);
    fs.renameSync(part, path.join(P.backups, name));
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(part, { force: true });
  }
  prune(dataDir);
  return name;
}

function list(dataDir) {
  const P = paths(dataDir);
  if (!fs.existsSync(P.backups)) return [];
  return fs.readdirSync(P.backups)
    .map((name) => {
      const m = NAME_RE.exec(name);
      if (!m) return null;
      const st = fs.statSync(path.join(P.backups, name));
      return { name, kind: m[2], bytes: st.size, at: st.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.name.slice(10, 27).localeCompare(a.name.slice(10, 27)) || b.at - a.at);
}

function prune(dataDir) {
  const P = paths(dataDir);
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  list(dataDir).forEach((b, i) => {
    if (i >= KEEP_MIN && b.at < cutoff) fs.rmSync(path.join(P.backups, b.name), { force: true });
  });
}

function fileFor(dataDir, name) {
  if (!NAME_RE.test(String(name || ''))) return null;
  const f = path.join(paths(dataDir).backups, name);
  return fs.existsSync(f) ? f : null;
}

/** Check that a backup file is complete and from a LiveGenie that this version can read. */
function inspect(file, schemaVersion) {
  try { return inspectRaw(file, schemaVersion); }
  catch (e) { throw userErr(e.message); }
}

/** Errors a person can act on (shown as-is in the web page). */
function userErr(message) {
  const e = new Error(message);
  e.status = 400;
  e.expose = true;
  return e;
}

function inspectRaw(file, schemaVersion) {
  const entries = tar.read(file);
  const dbEntry = entries.find((e) => e.name === 'livegenie.db');
  if (!dbEntry) throw new Error('This backup has no LiveGenie database in it');
  const tmp = file + '.check-' + process.pid + '.db';
  fs.writeFileSync(tmp, dbEntry.data);
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    try {
      const v = db.prepare('SELECT v FROM schema_version').get();
      if (!v) throw new Error('This backup has no LiveGenie database in it');
      if (v.v > schemaVersion) throw new Error('This backup is from a newer LiveGenie. Update LiveGenie first, then restore it.');
      const pages = db.prepare('SELECT COUNT(*) n FROM pages WHERE deleted_at IS NULL').get().n;
      const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
      return { pages, users, pictures: entries.filter((e) => e.name.startsWith('uploads/')).length };
    } finally { db.close(); }
  } catch (e) {
    if (/file is not a database|malformed/i.test(e.message)) throw new Error('The database in this backup is damaged');
    throw e;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Save an uploaded backup file into the backups folder. Returns its new name. */
function saveUploaded(dataDir, buf, schemaVersion) {
  const P = paths(dataDir);
  fs.mkdirSync(P.backups, { recursive: true });
  const name = uniqueName(P.backups, 'uploaded');
  const full = path.join(P.backups, name);
  fs.writeFileSync(full, buf);
  try { inspect(full, schemaVersion); }
  catch (e) { fs.rmSync(full, { force: true }); throw e; }
  return name;
}

function requestRestore(dataDir, name, schemaVersion, by) {
  const file = fileFor(dataDir, name);
  if (!file) throw userErr('That backup no longer exists');
  const info = inspect(file, schemaVersion);
  fs.writeFileSync(paths(dataDir).request, JSON.stringify({ name, by, at: Date.now() }));
  return info;
}

/** Called at start-up, before the database is opened. Returns a log line or ''. */
function applyPending(dataDir) {
  const P = paths(dataDir);
  if (!fs.existsSync(P.request)) return '';
  let req;
  try { req = JSON.parse(fs.readFileSync(P.request, 'utf8')); } catch (e) { req = {}; }
  fs.rmSync(P.request, { force: true });
  const file = fileFor(dataDir, req.name);
  if (!file) return 'Restore skipped: backup ' + req.name + ' was not found';
  const entries = tar.read(file);
  const dbEntry = entries.find((e) => e.name === 'livegenie.db');
  if (!dbEntry) return 'Restore skipped: ' + req.name + ' has no database';
  let saved = '';
  if (fs.existsSync(P.db)) saved = make(dataDir, P.db, 'before-restore');
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(P.db + ext, { force: true });
  fs.writeFileSync(P.db, dbEntry.data);
  fs.mkdirSync(P.uploads, { recursive: true });
  let pics = 0;
  for (const e of entries) {
    const m = /^uploads\/([A-Za-z0-9._-]+)$/.exec(e.name);
    if (!m) continue;
    fs.writeFileSync(path.join(P.uploads, m[1]), e.data);
    pics++;
  }
  return 'Restored ' + req.name + ' (' + pics + ' pictures)' + (saved ? '; previous data saved as ' + saved : '');
}

/** Run fn every day at hh:mm local time. */
function daily(hh, mm, fn) {
  const next = () => {
    const now = new Date();
    const t = new Date(now);
    t.setHours(hh, mm, 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    return t - now;
  };
  const arm = () => setTimeout(() => { try { fn(); } catch (e) { console.error('Nightly backup failed:', e.message); } arm(); }, next()).unref();
  arm();
}

module.exports = { make, list, prune, fileFor, inspect, saveUploaded, requestRestore, applyPending, daily, paths, KEEP_DAYS };
