/*
 * LiveGenie database: one SQLite file in the data folder, using Node's built-in SQLite.
 * Schema changes are numbered migrations; each runs once, in order, inside a transaction.
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');

const SPACES = [
  ['audio', 'Audio', 'Desk, mics, wireless, PA, monitors'],
  ['video', 'Video & Stream', 'Cameras, OBS, NDI, projectors, livestream'],
  ['lighting', 'Lighting', 'Fixtures, DMX, Art-Net, lighting control'],
  ['network', 'Network', 'VLANs, switches, IP addresses, Wi-Fi'],
  ['volunteers', 'Volunteers', 'Training, roles, how-tos for new people'],
  ['services', 'Services', 'Sunday, Wednesday and Thursday kids runbooks']
];

const MIGRATIONS = [
  // 1: the foundation (0.1.0)
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin','editor','volunteer')),
    pin_hash TEXT NOT NULL,
    failed INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL
  );
  CREATE TABLE spaces (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    blurb TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE pages (
    id INTEGER PRIMARY KEY,
    space_id INTEGER NOT NULL REFERENCES spaces(id),
    title TEXT NOT NULL,
    blocks TEXT NOT NULL DEFAULT '[]',
    tech_only INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','review','published')),
    version INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX pages_space ON pages(space_id, deleted_at);
  CREATE TABLE page_versions (
    id INTEGER PRIMARY KEY,
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    blocks TEXT NOT NULL,
    tech_only INTEGER NOT NULL,
    space_id INTEGER NOT NULL,
    saved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    saved_at INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX page_versions_page ON page_versions(page_id, version);
  CREATE VIRTUAL TABLE pages_fts USING fts5(title, body, tokenize = 'porter unicode61 remove_diacritics 2');
  CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    user_id INTEGER,
    user_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX audit_at ON audit_log(at);
  `
];

function open(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get();
  let v = row ? row.v : 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      if (v === 0) seed(db);
      v++;
      db.prepare('UPDATE schema_version SET v = ?').run(v);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

function seed(db) {
  const ins = db.prepare('INSERT INTO spaces (slug, name, blurb, sort) VALUES (?, ?, ?, ?)');
  SPACES.forEach((s, i) => ins.run(s[0], s[1], s[2], i));
}

/** Run fn inside a transaction; rolls back if it throws. */
function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { open, tx, SCHEMA_VERSION: MIGRATIONS.length };
