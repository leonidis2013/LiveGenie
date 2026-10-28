/*
 * Sign-in with a name and a PIN.
 *
 * Roles (spec section 2):
 *   admin      everything, including users, backups and settings
 *   editor     write pages, see Tech only pages
 *   volunteer  read everything except Tech only pages
 *   (nobody signed in) = viewer: read published pages that are not Tech only
 *
 * PINs are hashed with scrypt. Five wrong tries lock that user for five minutes.
 */
'use strict';

const crypto = require('crypto');

const ROLES = ['admin', 'editor', 'volunteer'];
const RANK = { viewer: 0, volunteer: 1, editor: 2, admin: 3 };
const MAX_TRIES = 5;
const LOCK_MS = 5 * 60 * 1000;
const SESSION_DAYS = 60;

function validPin(pin) {
  return /^\d{4,8}$/.test(String(pin || ''));
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pin), salt, 32, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('hex') + '$' + key.toString('hex');
}

function checkPin(pin, stored) {
  const [kind, saltHex, keyHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

function create(db) {
  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE name = ?'),
    userById: db.prepare('SELECT id, name, role FROM users WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) n FROM users'),
    fail: db.prepare('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?'),
    ok: db.prepare('UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?'),
    newSession: db.prepare('INSERT INTO sessions (token, user_id, created_at, seen_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT s.token, s.seen_at, u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'),
    touch: db.prepare('UPDATE sessions SET seen_at = ? WHERE token = ?'),
    drop: db.prepare('DELETE FROM sessions WHERE token = ?'),
    dropUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    expire: db.prepare('DELETE FROM sessions WHERE seen_at < ?')
  };

  function hasUsers() { return q.count.get().n > 0; }

  /** { ok, token, user } or { ok:false, error } */
  function signIn(name, pin) {
    const u = q.userByName.get(String(name || '').trim());
    const now = Date.now();
    if (!u) return { ok: false, error: 'Wrong name or PIN' };
    if (u.locked_until > now) {
      const mins = Math.ceil((u.locked_until - now) / 60000);
      return { ok: false, error: 'Too many wrong PINs. Try again in ' + mins + ' minute' + (mins === 1 ? '' : 's') + '.' };
    }
    if (!checkPin(pin, u.pin_hash)) {
      const failed = u.failed + 1;
      q.fail.run(failed >= MAX_TRIES ? 0 : failed, failed >= MAX_TRIES ? now + LOCK_MS : 0, u.id);
      return { ok: false, error: failed >= MAX_TRIES ? 'Too many wrong PINs. Locked for 5 minutes.' : 'Wrong name or PIN' };
    }
    q.ok.run(u.id);
    const token = crypto.randomBytes(24).toString('base64url');
    q.newSession.run(token, u.id, now, now);
    return { ok: true, token, user: { id: u.id, name: u.name, role: u.role } };
  }

  /** The signed-in user for a session token, or null. */
  function userFor(token) {
    if (!token) return null;
    const s = q.session.get(token);
    if (!s) return null;
    const now = Date.now();
    if (now - s.seen_at > SESSION_DAYS * 86400000) { q.drop.run(token); return null; }
    if (now - s.seen_at > 60000) q.touch.run(now, token);
    return { id: s.id, name: s.name, role: s.role };
  }

  function signOut(token) { if (token) q.drop.run(token); }
  function signOutUser(userId) { q.dropUser.run(userId); }
  function prune() { q.expire.run(Date.now() - SESSION_DAYS * 86400000); }

  return { hasUsers, signIn, userFor, signOut, signOutUser, prune };
}

const roleOf = (user) => (user ? user.role : 'viewer');
const atLeast = (user, role) => RANK[roleOf(user)] >= RANK[role];

module.exports = { create, hashPin, checkPin, validPin, ROLES, RANK, roleOf, atLeast };
