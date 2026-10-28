/*
 * Checklist schedules. A schedule is a list of rows:
 *   { day: 'daily' | 0..6 (0 = Sunday), reset: 'HH:MM', due: 'HH:MM' | '' }
 * "Sundays, reset 06:00, done by 09:15" means: at 06:00 every Sunday the
 * checklist starts empty again, and from 09:15 it counts as overdue while any
 * item is left. Times are in the server's local time zone (TZ).
 *
 * Nothing is stored when a reset happens: a tick only counts if it was made
 * after the latest reset, so resets need no timer and survive restarts.
 */
'use strict';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_ROWS = 14;

/** Check rows from the browser. Returns { schedule } or { error }. */
function clean(input) {
  if (input === undefined || input === null) return { schedule: [] };
  if (!Array.isArray(input)) return { error: 'The reset schedule must be a list' };
  if (input.length > MAX_ROWS) return { error: 'A checklist can have at most ' + MAX_ROWS + ' reset times' };
  const out = [];
  for (const r of input) {
    if (!r || typeof r !== 'object') return { error: 'Bad reset time' };
    const day = r.day === 'daily' ? 'daily' : Number(r.day);
    if (day !== 'daily' && !(Number.isInteger(day) && day >= 0 && day <= 6)) return { error: 'Pick a day for each reset time' };
    const reset = String(r.reset || '');
    if (!TIME_RE.test(reset)) return { error: 'Enter a reset time like 06:00' };
    const due = String(r.due || '');
    if (due && !TIME_RE.test(due)) return { error: 'Enter a done-by time like 09:15, or leave it empty' };
    out.push({ day, reset, due });
  }
  return { schedule: out };
}

function at(base, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

function dayMatches(row, date) {
  return row.day === 'daily' || row.day === date.getDay();
}

/**
 * Where a checklist stands right now.
 *   runStart     ticks before this time do not count (0 = never reset)
 *   dueAt        when this run must be done (null = no deadline)
 *   activeUntil  the run shows on the To do list until this time (end of the reset or done-by day)
 *   active       true while now is inside that window
 *   nextReset    the next scheduled reset (null when there is no schedule)
 */
function status(schedule, now = Date.now(), manualResetAt = 0) {
  const nowD = new Date(now);
  let last = null, lastRow = null, next = null;
  for (const row of schedule || []) {
    for (let back = 0; back <= 7; back++) {
      const d = new Date(nowD);
      d.setDate(d.getDate() - back);
      if (!dayMatches(row, d)) continue;
      const t = at(d, row.reset);
      if (t.getTime() <= now) {
        if (!last || t > last) { last = t; lastRow = row; }
        break;
      }
    }
    for (let fwd = 0; fwd <= 7; fwd++) {
      const d = new Date(nowD);
      d.setDate(d.getDate() + fwd);
      if (!dayMatches(row, d)) continue;
      const t = at(d, row.reset);
      if (t.getTime() > now) { if (!next || t < next) next = t; break; }
    }
  }
  // A scheduled run is "active" (on the To do list) from its reset until the end of
  // that day, or the end of the done-by day when that is later, or the next reset.
  let dueAt = null, activeUntil = null;
  if (last) {
    const endDay = new Date(last);
    if (lastRow.due) {
      const due = at(last, lastRow.due);
      if (due <= last) due.setDate(due.getDate() + 1);
      dueAt = due.getTime();
      endDay.setTime(due.getTime());
    }
    endDay.setHours(23, 59, 59, 999);
    activeUntil = Math.min(endDay.getTime(), next ? next.getTime() - 1 : Infinity);
  }
  const scheduled = last ? last.getTime() : 0;
  return {
    runStart: Math.max(scheduled, Number(manualResetAt) || 0),
    scheduledStart: scheduled,
    dueAt,
    activeUntil,
    active: !!(last && now <= activeUntil),
    nextReset: next ? next.getTime() : null
  };
}

/** "Sundays at 6:00 AM, done by 9:15 AM" */
function describe(row) {
  const fmt = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
  };
  const day = row.day === 'daily' ? 'Every day' : DAYS[row.day] + 's';
  return day + ' at ' + fmt(row.reset) + (row.due ? ', done by ' + fmt(row.due) : '');
}

module.exports = { clean, status, describe, DAYS };
