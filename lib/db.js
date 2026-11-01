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
  `,
  // 8: admins and users, spaces the admin owns (colour, admins-only), manuals, problem reports, checklist log (0.14.0)
  `
  UPDATE users SET role = 'admin' WHERE role = 'editor';
  ALTER TABLE spaces ADD COLUMN color TEXT NOT NULL DEFAULT '#4c8dff';
  ALTER TABLE spaces ADD COLUMN admin_only INTEGER NOT NULL DEFAULT 0;
  UPDATE spaces SET admin_only = 1 WHERE slug = 'network'
    OR id IN (SELECT space_id FROM pages WHERE deleted_at IS NULL GROUP BY space_id HAVING MIN(tech_only) = 1);
  UPDATE pages SET tech_only = 0 WHERE space_id IN (SELECT id FROM spaces WHERE admin_only = 1);
  UPDATE spaces SET color = CASE slug WHEN 'audio' THEN '#2ec4b6' WHEN 'video' THEN '#4c8dff' WHEN 'lighting' THEN '#f2c94c'
    WHEN 'network' THEN '#8b6cff' WHEN 'volunteers' THEN '#3ecf6e' WHEN 'services' THEN '#ef8a3c' ELSE color END;
  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at INTEGER NOT NULL
  );
  CREATE INDEX files_device ON files(device_id);
  CREATE TABLE problems (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL,
    where_text TEXT NOT NULL DEFAULT '',
    page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
    device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
    gear TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    resolved_name TEXT NOT NULL DEFAULT '',
    resolved_at INTEGER,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX problems_status ON problems(status, created_at);
  CREATE TABLE checklist_runs (
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    block_id TEXT NOT NULL,
    run_start INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    total INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    items TEXT NOT NULL DEFAULT '[]',
    first_at INTEGER,
    last_at INTEGER,
    completed_at INTEGER,
    completed_by TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (page_id, block_id, run_start)
  );
  CREATE INDEX checklist_runs_at ON checklist_runs(run_start);
  `,
  // 9: Gear Locker buckets (0.16.0); empty = sorted automatically from what the gear is
  `
  ALTER TABLE devices ADD COLUMN bucket TEXT NOT NULL DEFAULT '';
  `,
  // 10: highlight boxes drawn on a gear photo (0.18.0)
  `
  ALTER TABLE devices ADD COLUMN marks TEXT NOT NULL DEFAULT '[]';
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

/** New installs start with no spaces: the admin makes the ones they want (Admin › Spaces). */
function seed() {}

/** Run fn inside a transaction; rolls back if it throws. */
function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { open, tx, SCHEMA_VERSION: MIGRATIONS.length, SPACES };
