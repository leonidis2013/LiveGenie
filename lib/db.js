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
  `,
  // 2: shared checklist ticks, resets and overdue notices (0.2.0)
  `
  CREATE TABLE checklist_ticks (
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    block_id TEXT NOT NULL,
    item TEXT NOT NULL,
    by_name TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL,
    PRIMARY KEY (page_id, block_id, item)
  );
  CREATE TABLE checklist_resets (
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    block_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    by_name TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (page_id, block_id)
  );
  CREATE TABLE checklist_notices (
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    block_id TEXT NOT NULL,
    run_start INTEGER NOT NULL,
    sent_at INTEGER NOT NULL,
    result TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (page_id, block_id, run_start)
  );
  `,
  // 2b: give checklists saved by 0.1.x an id (ticks are kept per checklist id)
  (db) => {
    const { upgrade } = require('./blocks');
    const rows = db.prepare('SELECT id, blocks FROM pages').all();
    const put = db.prepare('UPDATE pages SET blocks = ? WHERE id = ?');
    for (const r of rows) {
      const blocks = JSON.parse(r.blocks);
      if (upgrade(blocks)) put.run(JSON.stringify(blocks), r.id);
    }
  },
  // 3: device library (0.3.0)
  `
  CREATE TABLE devices (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    aliases TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL DEFAULT 'other',
    make TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    mac TEXT NOT NULL DEFAULT '',
    photo TEXT NOT NULL DEFAULT '',
    manual_url TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    tech_only INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // 5: system map (0.4.0): VLAN registry, where each device is plugged in, saved map layouts
  `
  CREATE TABLE vlans (
    id INTEGER PRIMARY KEY,
    vid INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    cidr TEXT NOT NULL DEFAULT '',
    gateway TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#4c8dff',
    purpose TEXT NOT NULL DEFAULT '',
    dhcp_start TEXT NOT NULL DEFAULT '',
    dhcp_end TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );
  ALTER TABLE devices ADD COLUMN uplink_id INTEGER REFERENCES devices(id) ON DELETE SET NULL;
  ALTER TABLE devices ADD COLUMN uplink_port TEXT NOT NULL DEFAULT '';
  `,
  // 6: how many inputs and outputs a device has (stage boxes, consoles), for the guided setup (0.7.0)
  `
  ALTER TABLE devices ADD COLUMN inputs INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE devices ADD COLUMN outputs INTEGER NOT NULL DEFAULT 0;
  `,
  // 7: the stage patch, one drawing for the whole system, with every saved version (0.13.0)
  `
  CREATE TABLE patch (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    doc TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE patch_versions (
    version INTEGER PRIMARY KEY,
    doc TEXT NOT NULL,
    saved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    saved_at INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );
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
      const step = MIGRATIONS[v];
      if (typeof step === 'function') step(db); else db.exec(step);
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
