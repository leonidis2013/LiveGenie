'use strict';
/*
 * End-to-end tests: start LiveGenie on a temporary data folder and use the API
 * the way the web page does. Run with: npm test
 */
// run in a time zone where it is around midday right now, so schedule tests never cross midnight
{ const off = 12 - new Date().getUTCHours(); process.env.TZ = 'Etc/GMT' + (off > 0 ? '-' : '+') + Math.min(Math.abs(off), 12); }
const { spawn } = require('child_process');
const http = require('http');
const Schedule = require('../lib/schedule');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const PORT = 18000 + Math.floor(Math.random() * 2000);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'livegenie-test-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let proc = null;
function start() {
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
      cwd: ROOT, env: { ...process.env, LIVEGENIE_DATA: DATA, PORT: String(PORT), HOST: '127.0.0.1', LIVEGENIE_NO_UPDATE_CHECK: '1', LIVEGENIE_NOTIFY_EVERY_MS: '300' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const onData = (d) => { out += d; if (out.includes('LiveGenie ')) resolve(out); };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('exit', (code) => reject(new Error('server exited early (' + code + '):\n' + out)));
    setTimeout(() => reject(new Error('server did not start:\n' + out)), 8000);
  });
}
function waitExit() { return new Promise((r) => { if (!proc || proc.exitCode !== null) return r(); proc.removeAllListeners('exit'); proc.on('exit', r); }); }

// a tiny client with its own cookie jar
function client() {
  let cookie = '';
  async function req(method, url, body, opts = {}) {
    const headers = { 'x-livegenie': '1', ...(opts.headers || {}) };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (opts.raw) { payload = body; headers['content-type'] = opts.type; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    if (opts.noHeader) delete headers['x-livegenie'];
    const res = await fetch(BASE + url, { method, headers, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) { const m = /lg_s=([^;]*)/.exec(sc); cookie = m && m[1] ? 'lg_s=' + m[1] : ''; }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, type };
  }
  return { req, get: (u) => req('GET', u), post: (u, b, o) => req('POST', u, b, o), put: (u, b) => req('PUT', u, b), del: (u) => req('DELETE', u) };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const admin = client(), editor = client(), vol = client(), anon = client();
let pageId, techId;

test('first run needs setup and creates the admin', async () => {
  let r = await anon.get('/api/state');
  assert.strictEqual(r.data.setupNeeded, true);
  r = await admin.post('/api/setup', { name: 'Jerod', pin: '12' });
  assert.strictEqual(r.status, 400, 'short PIN refused');
  r = await admin.post('/api/setup', { name: 'Jerod', pin: '2468' });
  assert.strictEqual(r.status, 200);
  r = await admin.get('/api/state');
  assert.strictEqual(r.data.role, 'admin');
  r = await anon.post('/api/setup', { name: 'Eve', pin: '1111' });
  assert.strictEqual(r.status, 409, 'second setup refused');
});

test('changes need the LiveGenie header', async () => {
  const r = await admin.req('POST', '/api/pages', { title: 'x', space: 'audio', blocks: [] }, { noHeader: true });
  assert.strictEqual(r.status, 403);
});

test('admin adds an editor and a volunteer', async () => {
  let r = await admin.post('/api/users', { name: 'Sam', role: 'editor', pin: '1357' });
  assert.strictEqual(r.status, 200);
  r = await admin.post('/api/users', { name: 'Val', role: 'volunteer', pin: '9753' });
  assert.strictEqual(r.status, 200);
  r = await admin.post('/api/users', { name: 'val', role: 'volunteer', pin: '9753' });
  assert.strictEqual(r.status, 400, 'names are unique, ignoring case');
  assert.strictEqual((await editor.post('/api/signin', { name: 'sam', pin: '1357' })).status, 200);
  assert.strictEqual((await vol.post('/api/signin', { name: 'Val', pin: '9753' })).status, 200);
});

test('volunteers and anonymous readers cannot write', async () => {
  assert.strictEqual((await anon.post('/api/pages', { title: 'x', space: 'audio', blocks: [] })).status, 401);
  assert.strictEqual((await vol.post('/api/pages', { title: 'x', space: 'audio', blocks: [] })).status, 403);
  assert.strictEqual((await vol.get('/api/users')).status, 403);
});

test('editor creates pages with blocks; bad blocks are refused', async () => {
  let r = await editor.post('/api/pages', { title: 'Bad', space: 'audio', blocks: [{ type: 'script' }] });
  assert.strictEqual(r.status, 400);
  r = await editor.post('/api/pages', { title: '', space: 'audio', blocks: [] });
  assert.strictEqual(r.status, 400);
  r = await editor.post('/api/pages', {
    title: 'SQ-5 Sunday startup', space: 'audio', pinned: true,
    blocks: [
      { type: 'text', md: '# Power on\nTurn on the **Allen & Heath SQ-5** before the amplifiers.' },
      { type: 'callout', kind: 'critical', md: 'Amps on last, off first.' },
      { type: 'checklist', title: 'Startup', items: ['Desk on', '', 'Load scene Sunday', 'Amps on'] },
      { type: 'divider', extra: 'dropped' }
    ]
  });
  assert.strictEqual(r.status, 200);
  pageId = r.data.id;
  r = await editor.post('/api/pages', { title: 'UDM Pro admin', space: 'network', tech_only: true, blocks: [{ type: 'text', md: 'Management VLAN and the admin login live here. Keyword crossover.' }] });
  techId = r.data.id;
  const p = (await anon.get('/api/pages/' + pageId)).data.page;
  assert.strictEqual(p.blocks.length, 4);
  assert.deepStrictEqual(p.blocks[2].items, ['Desk on', 'Load scene Sunday', 'Amps on'], 'empty steps dropped');
  assert.strictEqual(p.blocks[3].extra, undefined, 'unknown fields dropped');
  assert.strictEqual(p.version, 1);
});

test('Tech only pages are hidden from volunteers and anonymous readers', async () => {
  assert.strictEqual((await anon.get('/api/pages/' + techId)).status, 404);
  assert.strictEqual((await vol.get('/api/pages/' + techId)).status, 404);
  assert.strictEqual((await editor.get('/api/pages/' + techId)).status, 200);
  const net = (await anon.get('/api/spaces/network')).data;
  assert.strictEqual(net.pages.length, 0);
  const home = (await anon.get('/api/home')).data;
  assert.strictEqual(home.spaces.find((s) => s.slug === 'network').pages, 0);
  assert.strictEqual(home.pinned.length, 1);
});

test('search finds words, prefixes and respects Tech only', async () => {
  let r = await anon.get('/api/search?q=amplif');
  assert.strictEqual(r.data.results.length, 1, 'prefix match');
  assert.ok(r.data.results[0].snip.includes('\u0001'), 'snippet marks the match');
  r = await anon.get('/api/search?q=sq-5 startup');
  assert.strictEqual(r.data.results[0].id, pageId);
  assert.strictEqual((await anon.get('/api/search?q=crossover')).data.results.length, 0);
  assert.strictEqual((await editor.get('/api/search?q=crossover')).data.results.length, 1);
  assert.strictEqual((await anon.get('/api/search?q=%22)(*')).data.results.length, 0, 'odd characters are safe');
});

test('saving over someone else\'s change is refused; history and restore work', async () => {
  let r = await editor.put('/api/pages/' + pageId, { title: 'SQ-5 Sunday startup', space: 'audio', blocks: [{ type: 'text', md: 'Version two' }], baseVersion: 1 });
  assert.strictEqual(r.data.version, 2);
  r = await admin.put('/api/pages/' + pageId, { title: 'Stale', space: 'audio', blocks: [], baseVersion: 1 });
  assert.strictEqual(r.status, 409);
  r = await anon.get('/api/pages/' + pageId + '/versions');
  assert.deepStrictEqual(r.data.versions.map((v) => v.version), [2, 1]);
  r = await editor.post('/api/pages/' + pageId + '/versions/1/restore');
  assert.strictEqual(r.data.version, 3);
  const p = (await anon.get('/api/pages/' + pageId)).data.page;
  assert.strictEqual(p.blocks.length, 4);
  assert.strictEqual((await anon.get('/api/search?q=amplifiers')).data.results.length, 1, 'search index follows the restore');
});

test('pictures upload, show on pages, and odd files are refused', async () => {
  let r = await editor.post('/api/uploads', PNG, { raw: true, type: 'image/png' });
  assert.strictEqual(r.status, 200);
  const id = r.data.id;
  r = await editor.post('/api/uploads', Buffer.from('<svg/>'), { raw: true, type: 'image/svg+xml' });
  assert.strictEqual(r.status, 415, 'SVG refused');
  r = await vol.post('/api/uploads', PNG, { raw: true, type: 'image/png' });
  assert.strictEqual(r.status, 403);
  r = await editor.post('/api/pages', { title: 'Rack photo', space: 'video', blocks: [{ type: 'image', upload: id, caption: 'Front AV rack' }] });
  assert.strictEqual(r.status, 200);
  r = await editor.post('/api/pages', { title: 'Ghost', space: 'video', blocks: [{ type: 'image', upload: 'a'.repeat(24) }] });
  assert.strictEqual(r.status, 400, 'unknown picture refused');
  r = await anon.get('/uploads/' + id);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.type, 'image/png');
  assert.ok(Buffer.compare(r.data, PNG) === 0);
});

test('delete moves a page to the trash and it can come back', async () => {
  const id = (await editor.post('/api/pages', { title: 'Temp page', space: 'lighting', blocks: [{ type: 'text', md: 'zebrafish' }] })).data.id;
  assert.strictEqual((await editor.del('/api/pages/' + id)).status, 200);
  assert.strictEqual((await anon.get('/api/pages/' + id)).status, 404);
  assert.strictEqual((await anon.get('/api/search?q=zebrafish')).data.results.length, 0);
  assert.ok((await editor.get('/api/trash')).data.pages.some((p) => p.id === id));
  assert.strictEqual((await editor.post('/api/trash/' + id + '/restore')).status, 200);
  assert.strictEqual((await anon.get('/api/search?q=zebrafish')).data.results.length, 1);
});

test('five wrong PINs lock the user', async () => {
  const c = client();
  for (let i = 0; i < 4; i++) assert.strictEqual((await c.post('/api/signin', { name: 'Val', pin: '0000' })).data.error, 'Wrong name or PIN');
  let r = await c.post('/api/signin', { name: 'Val', pin: '0000' });
  assert.match(r.data.error, /Locked/);
  r = await c.post('/api/signin', { name: 'Val', pin: '9753' });
  assert.strictEqual(r.status, 401, 'right PIN still refused while locked');
  const val = (await admin.get('/api/users')).data.users.find((u) => u.name === 'Val');
  assert.strictEqual(val.locked, true);
  await admin.put('/api/users/' + val.id, { unlock: true });
  assert.strictEqual((await c.post('/api/signin', { name: 'Val', pin: '9753' })).status, 200);
});

test('role changes sign the person out; the last admin cannot be removed or demoted', async () => {
  const users = (await admin.get('/api/users')).data.users;
  const sam = users.find((u) => u.name === 'Sam'), me = users.find((u) => u.name === 'Jerod');
  await admin.put('/api/users/' + sam.id, { role: 'volunteer' });
  assert.strictEqual((await editor.get('/api/state')).data.user, null, 'Sam was signed out');
  assert.strictEqual((await admin.put('/api/users/' + me.id, { role: 'editor' })).status, 400);
  assert.strictEqual((await admin.del('/api/users/' + me.id)).status, 400);
  await admin.put('/api/users/' + sam.id, { role: 'editor' });
  assert.strictEqual((await editor.post('/api/signin', { name: 'Sam', pin: '1357' })).status, 200);
});

test('users change their own PIN', async () => {
  assert.strictEqual((await vol.post('/api/me/pin', { current: '0000', pin: '2222' })).status, 400);
  assert.strictEqual((await vol.post('/api/me/pin', { current: '9753', pin: '2222' })).status, 200);
  assert.strictEqual((await client().post('/api/signin', { name: 'Val', pin: '2222' })).status, 200);
});

test('schedule maths: last reset, done-by, active window, overnight', async () => {
  const sun7 = new Date(2026, 10, 1, 7, 0).getTime();               // Sunday 07:00
  const sch = [{ day: 0, reset: '06:00', due: '09:15' }, { day: 3, reset: '17:00', due: '' }];
  let st = Schedule.status(sch, sun7);
  assert.strictEqual(new Date(st.runStart).getHours(), 6);
  assert.strictEqual(new Date(st.dueAt).getHours(), 9);
  assert.strictEqual(st.active, true);
  assert.strictEqual(new Date(st.nextReset).getDay(), 3);
  st = Schedule.status(sch, sun7 + 25 * 3600e3);                      // Monday 08:00
  assert.strictEqual(st.active, false, 'Sunday run is over on Monday');
  st = Schedule.status([{ day: 'daily', reset: '22:00', due: '01:00' }], new Date(2026, 10, 2, 0, 30).getTime());
  assert.strictEqual(new Date(st.runStart).getDate(), 1, 'overnight run started the evening before');
  assert.strictEqual(new Date(st.dueAt).getDate(), 2);
  assert.strictEqual(st.active, true);
  assert.ok(Schedule.clean([{ day: 9, reset: '06:00' }]).error);
  assert.ok(Schedule.clean([{ day: 0, reset: '6am' }]).error);
  assert.strictEqual(Schedule.describe(sch[0]), 'Sundays at 6:00 AM, done by 9:15 AM');
});

let checkPage, checkId;
const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
test('checklist ticks are shared, signed, and reset at the scheduled time', async () => {
  const now = new Date();
  const reset = new Date(now.getTime() - 2 * 60000), due = new Date(now.getTime() + 60 * 60000);
  let r = await editor.post('/api/pages', { title: 'Sunday Morning Checks', space: 'services', blocks: [
    { type: 'checklist', title: 'Startup', items: ['Desk on', 'Amps on', 'Batteries'], schedule: [{ day: 'daily', reset: hhmm(reset), due: hhmm(due) }] }] });
  checkPage = r.data.id;
  checkId = (await anon.get('/api/pages/' + checkPage)).data.page.blocks[0].id;
  assert.match(checkId, /^[a-f0-9]{8}$/);
  r = await vol.post('/api/pages/' + checkPage + '/checklists/' + checkId + '/tick', { item: 'Desk on', done: true });
  assert.strictEqual(r.data.checklist.left, 2);
  assert.strictEqual(r.data.checklist.items[0].by, 'Val');
  r = await anon.post('/api/pages/' + checkPage + '/checklists/' + checkId + '/tick', { item: 'Amps on', done: true });
  assert.strictEqual(r.data.checklist.items[1].by, 'Guest', 'anyone who can see the page can tick');
  r = await editor.get('/api/pages/' + checkPage + '/checklists');
  assert.strictEqual(r.data.checklists[0].left, 1, 'everyone sees the same ticks');
  assert.strictEqual(r.data.checklists[0].active, true);
  assert.strictEqual(r.data.checklists[0].overdue, false);
  assert.strictEqual((await anon.post('/api/pages/' + checkPage + '/checklists/' + checkId + '/tick', { item: 'Not a step', done: true })).status, 409);
  assert.strictEqual((await anon.post('/api/pages/' + checkPage + '/checklists/' + checkId + '/reset')).status, 401, 'guests cannot reset');
  // editing the page keeps the checklist id, so ticks survive the edit
  const page = (await editor.get('/api/pages/' + checkPage)).data.page;
  await editor.put('/api/pages/' + checkPage, { ...page, space: 'services', title: 'Sunday Morning Checks', baseVersion: page.version });
  assert.strictEqual((await anon.get('/api/pages/' + checkPage + '/checklists')).data.checklists[0].left, 1);
  r = await vol.post('/api/pages/' + checkPage + '/checklists/' + checkId + '/reset');
  assert.strictEqual(r.data.checklist.left, 3);
  assert.strictEqual(r.data.checklist.lastReset.by, 'Val');
});

test('To do list: active runs show, finished ones stay as Done, overdue sorts first', async () => {
  let t = (await anon.get('/api/todo')).data.todo;
  const mine = t.find((x) => x.block_id === checkId);
  assert.ok(mine && !mine.complete && mine.left === 3);
  let st = (await anon.get('/api/state')).data.todo;
  assert.ok(st.open >= 1);
  for (const item of ['Desk on', 'Amps on', 'Batteries']) await vol.post('/api/pages/' + checkPage + '/checklists/' + checkId + '/tick', { item, done: true });
  t = (await anon.get('/api/todo')).data.todo;
  const done = t.find((x) => x.block_id === checkId);
  assert.ok(done.complete, 'finished checklist stays on the list');
  assert.strictEqual(done.completedBy, 'Val');
  st = (await anon.get('/api/state')).data.todo;
  assert.strictEqual(st.open, 0, 'header only counts open ones');
  // an overdue one on a Tech only page
  const now = new Date();
  const r = await editor.post('/api/pages', { title: 'Rack checks', space: 'audio', tech_only: true, blocks: [
    { type: 'checklist', title: 'Rack', items: ['Fans'], schedule: [{ day: 'daily', reset: hhmm(new Date(now - 10 * 60000)), due: hhmm(new Date(now - 60000)) }] }] });
  t = (await editor.get('/api/todo')).data.todo;
  assert.strictEqual(t[0].title, 'Rack');
  assert.strictEqual(t[0].overdue, true);
  assert.ok(!(await anon.get('/api/todo')).data.todo.some((x) => x.page_id === r.data.id), 'Tech only checklists stay hidden from guests');
  assert.strictEqual((await editor.get('/api/state')).data.todo.overdue, 1);
});

test('overdue notices go to the webhook once per run', async () => {
  const got = [];
  const hook = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + hook.address().port + '/api/webhook/test';
  assert.strictEqual((await editor.put('/api/settings/notify', { webhook: url })).status, 403);
  assert.strictEqual((await admin.put('/api/settings/notify', { webhook: 'ftp://x' })).status, 400);
  assert.strictEqual((await admin.put('/api/settings/notify', { webhook: url })).status, 200);
  assert.strictEqual((await admin.post('/api/settings/notify/test')).status, 200);
  await new Promise((r) => setTimeout(r, 1200));
  hook.close();
  assert.strictEqual(got[0].event, 'test');
  const od = got.filter((g) => g.event === 'checklist_overdue');
  assert.strictEqual(od.length, 1, 'one notice, not one per check');
  assert.strictEqual(od[0].checklist, 'Rack');
  assert.deepStrictEqual(od[0].items_left, ['Fans']);
  assert.match(od[0].url, /#\/p\/\d+$/);
});

test('patch lists and IP lists are checked and searchable', async () => {
  let r = await editor.post('/api/pages', { title: 'AVL network', space: 'network', blocks: [
    { type: 'iplist', title: 'AVL', net: { name: 'AVL', vlan: '20', cidr: '10.10.20.0/24', gateway: '10.10.20.1' },
      rows: [{ ip: '10.10.20.12', device: 'DriveRack PA2' }, { ip: '10.10.20.11', device: 'SQ-5', mac: 'aa:bb' }, {}] },
    { type: 'patch', preset: 'input', rows: [['1', 'Pastor lav', 'SLX-D', '', 'SB1-1'], ['', '', '', '', '', '']] }] });
  assert.strictEqual(r.status, 200);
  const p = (await anon.get('/api/pages/' + r.data.id)).data.page;
  assert.deepStrictEqual(p.blocks[0].rows.map((x) => x.ip), ['10.10.20.11', '10.10.20.12'], 'sorted by address, blank rows dropped');
  assert.deepStrictEqual(p.blocks[1].trace, [1, 2, 4, 0]);
  assert.deepStrictEqual(p.blocks[1].ok, [], 'no intended duplicates yet');
  assert.strictEqual(p.blocks[1].rows.length, 1);
  assert.strictEqual((await anon.get('/api/search?q=driverack')).data.results[0].id, r.data.id);
  assert.strictEqual((await anon.get('/api/search?q=pastor')).data.results.some((x) => x.id === r.data.id), true);
  r = await editor.post('/api/pages', { title: 'Bad net', space: 'network', blocks: [{ type: 'iplist', net: { cidr: '10.10.20.0/33' }, rows: [] }] });
  assert.strictEqual(r.status, 400);
});

test('escaped Markdown characters are searchable as words', async () => {
  const r = await editor.post('/api/pages', { title: 'Escapes', space: 'audio', blocks: [{ type: 'text', md: 'Use \\*only\\* the **Aux\\_7** send' }] });
  assert.strictEqual(r.status, 200);
  assert.ok((await anon.get('/api/search?q=only')).data.results.some((x) => x.id === r.data.id));
});

test('device library: cards, aliases, IPs from IP lists, Used on, import', async () => {
  assert.strictEqual((await vol.post('/api/devices', { name: 'SQ-5' })).status, 403);
  let r = await editor.post('/api/devices', { name: 'SQ-5', aliases: 'FOH desk, A&H', category: 'audio', make: 'Allen & Heath', model: 'SQ-5', location: 'FOH' });
  assert.strictEqual(r.status, 200);
  const sq = r.data.id;
  assert.strictEqual((await editor.post('/api/devices', { name: 'Desk', aliases: ['foh desk'] })).status, 400, 'aliases are unique across devices');
  assert.strictEqual((await editor.post('/api/devices', { name: 'Bad', ip: '10.10.20.300' })).status, 400);
  r = await editor.post('/api/devices', { name: 'UDM Pro', category: 'network', ip: '10.10.1.1', tech_only: true });
  const udm = r.data.id;
  let list = (await anon.get('/api/devices')).data.devices;
  assert.ok(!list.some((d) => d.id === udm), 'Tech only devices hidden from guests');
  const card = list.find((d) => d.id === sq);
  assert.deepStrictEqual(card.ips, ['10.10.20.11'], 'IP comes from the IP list row named SQ-5');
  r = await anon.get('/api/devices/' + sq);
  const titles = r.data.usedOn.map((u) => u.title);
  assert.ok(titles.includes('AVL network'), 'IP list mention');
  assert.ok(titles.includes('SQ-5 Sunday startup'), 'text mention');
  const avl = r.data.usedOn.find((u) => u.title === 'AVL network');
  assert.ok(avl.hits.some((h) => h.kind === 'iplist' && h.text.includes('10.10.20.11')));
  assert.strictEqual((await anon.get('/api/devices/' + udm)).status, 404);
  const sug = (await editor.get('/api/devices/suggestions')).data.suggestions.map((x) => x.name);
  assert.ok(sug.includes('DriveRack PA2') && !sug.includes('SQ-5'));
  r = await editor.post('/api/devices/import', { names: ['DriveRack PA2'] });
  assert.strictEqual(r.data.made, 1);
  list = (await editor.get('/api/devices')).data.devices;
  assert.deepStrictEqual(list.find((d) => d.name === 'DriveRack PA2').ips, ['10.10.20.12']);
  assert.strictEqual((await anon.get('/api/search?q=allen')).data.devices[0].name, 'SQ-5');
  assert.strictEqual((await editor.put('/api/devices/' + sq, { name: 'SQ-5', aliases: ['FOH desk'], category: 'audio' })).status, 200);
  assert.strictEqual((await editor.del('/api/devices/' + udm)).status, 200);
});

test('VLANs: registry, checks, import from IP lists, Tech only', async () => {
  assert.strictEqual((await vol.get('/api/vlans')).status, 403, 'volunteers do not see the VLAN registry');
  let r = await editor.get('/api/vlans');
  assert.deepStrictEqual(r.data.suggestions.map((x) => x.vid), [20], 'VLAN 20 from the AVL IP list');
  r = await editor.post('/api/vlans/import', { vids: [20] });
  assert.strictEqual(r.data.made, 1);
  assert.strictEqual((await editor.post('/api/vlans', { vid: 20, name: 'Again' })).status, 400, 'duplicate VLAN ID');
  assert.strictEqual((await editor.post('/api/vlans', { vid: 30, name: 'Overlap', cidr: '10.10.20.128/25' })).status, 400, 'overlapping subnet');
  assert.strictEqual((await editor.post('/api/vlans', { vid: 40, name: 'Guest', cidr: '10.10.40.0/24', gateway: '10.10.41.1' })).status, 400, 'gateway outside subnet');
  assert.strictEqual((await editor.post('/api/vlans', { vid: 5000, name: 'Nope' })).status, 400);
  r = await editor.post('/api/vlans', { vid: 10, name: 'Office', cidr: '10.10.10.5/24', gateway: '10.10.10.1', dhcp_start: '10.10.10.100', dhcp_end: '10.10.10.199', color: '#2ec4b6' });
  assert.strictEqual(r.status, 200);
  const list = (await editor.get('/api/vlans')).data.vlans;
  const office = list.find((v) => v.vid === 10);
  assert.strictEqual(office.cidr, '10.10.10.0/24', 'subnet is normalised');
  assert.strictEqual(office.dhcp, 100);
  const avl = list.find((v) => v.vid === 20);
  assert.ok(avl.devices.some((d) => d.name === 'SQ-5'), 'SQ-5 sits in VLAN 20 by its IP');
});

test('system map: plugged-into links, signal links from patch lists, loops refused, layouts', async () => {
  const devs = (await editor.get('/api/devices')).data.devices;
  const sq = devs.find((d) => d.name === 'SQ-5').id, pa2 = devs.find((d) => d.name === 'DriveRack PA2').id;
  const sw = (await editor.post('/api/devices', { name: 'USW-16-PoE', category: 'network', ip: '10.10.20.2' })).data.id;
  const amp = (await editor.post('/api/devices', { name: 'Crown XLi 2500', category: 'audio' })).data.id;
  assert.strictEqual((await editor.put('/api/devices/' + sq, { name: 'SQ-5', aliases: ['FOH desk'], category: 'audio', uplink_id: sw, uplink_port: '3' })).status, 200);
  assert.strictEqual((await editor.put('/api/devices/' + pa2, { name: 'DriveRack PA2', aliases: ['PA2'], category: 'audio', uplink_id: sw, uplink_port: '4' })).status, 200);
  let r = await editor.put('/api/devices/' + sw, { name: 'USW-16-PoE', category: 'network', ip: '10.10.20.2', uplink_id: sq });
  assert.strictEqual(r.status, 400, 'a loop is refused');
  await editor.post('/api/pages', { title: 'Amp rack wiring', space: 'audio', blocks: [
    { type: 'patch', preset: 'cable', rows: [['C1', 'FOH desk', 'DriveRack PA2', 'XLR', '30 m'], ['C2', 'DriveRack PA2', 'Crown XLi 2500', 'XLR', '1 m'], ['C3', 'PA2', 'Crown XLi 2500', 'XLR', '1 m']] }] });
  r = await editor.get('/api/map');
  assert.strictEqual(r.data.tech, true);
  const net = r.data.netLinks.map((l) => l.from + '>' + l.to + ':' + l.port).sort();
  assert.deepStrictEqual(net, [sw + '>' + pa2 + ':4', sw + '>' + sq + ':3'].sort());
  const sig = r.data.sigLinks.map((l) => l.from + '>' + l.to + 'x' + l.count).sort();
  assert.deepStrictEqual(sig, [sq + '>' + pa2 + 'x1', pa2 + '>' + amp + 'x2'].sort(), 'aliases count, rows add up: ' + JSON.stringify(r.data.sigLinks.map((l) => [l.from, l.to, l.count])) + ' ids sq=' + sq + ' pa2=' + pa2 + ' amp=' + amp);
  assert.ok(r.data.nodes.find((n) => n.id === sq).vlans.includes(20));
  r = await anon.get('/api/map');
  assert.strictEqual(r.data.tech, false);
  assert.strictEqual(r.data.netLinks.length, 0, 'guests get the signal map only');
  assert.ok(r.data.nodes.every((n) => !n.ips.length && !n.vlans.length));
  assert.strictEqual(r.data.sigLinks.length, 2);
  assert.strictEqual((await vol.put('/api/map/layout/signal', { positions: {} })).status, 403);
  assert.strictEqual((await editor.put('/api/map/layout/signal', { positions: { [sq]: [10, 20], bad: [1, 2] } })).status, 200);
  assert.deepStrictEqual((await editor.get('/api/map')).data.layouts.signal, { [sq]: [10, 20] });
  r = await editor.get('/api/devices/' + sq);
  assert.strictEqual(r.data.links.uplink.port, '3');
  assert.strictEqual(r.data.links.signalOut[0].id, pa2);
  assert.strictEqual((await editor.get('/api/devices/' + sw)).data.links.children.length, 2);
});

test('backup, then restore brings the data back after a restart', async () => {
  let r = await admin.post('/api/backups/now');
  assert.strictEqual(r.status, 200);
  const name = r.data.name;
  r = await admin.get('/api/backups/' + name + '/inspect');
  assert.strictEqual(r.data.info.pictures, 1);
  const before = r.data.info.pages;
  const dl = await admin.get('/api/backups/' + name + '/download');
  assert.ok(dl.data.length > 1024 && dl.data.toString('ascii', 257, 262) === 'ustar', 'download is a tar file');
  // a page made after the backup
  await editor.post('/api/pages', { title: 'After the backup', space: 'audio', blocks: [] });
  // upload the downloaded file as another backup, then restore that one
  r = await admin.post('/api/backups/upload', dl.data, { raw: true, type: 'application/x-tar' });
  assert.strictEqual(r.status, 200);
  const uploaded = r.data.name;
  assert.strictEqual((await admin.post('/api/backups/upload', Buffer.from('nope'), { raw: true, type: 'application/x-tar' })).status, 400, 'junk refused');
  const exited = waitExit();
  r = await admin.post('/api/backups/' + uploaded + '/restore');
  assert.strictEqual(r.data.restarting, true);
  await exited;
  await start();
  const home = (await editor.get('/api/home')).data;
  assert.ok(!home.recent.some((p) => p.title === 'After the backup'), 'the later page is gone');
  assert.strictEqual(home.recent.length, before);
  const list = (await admin.get('/api/backups')).data.backups;
  assert.ok(list.some((b) => b.kind === 'before-restore'), 'data was saved before the restore');
  const act = (await admin.get('/api/activity')).data.activity;
  assert.ok(act.some((a) => a.action === 'backup.restored'));
});

test('static files and icons are served with safe headers', async () => {
  const r = await fetch(BASE + '/');
  assert.strictEqual(r.status, 200);
  assert.ok(r.headers.get('content-security-policy').includes("default-src 'self'"));
  for (const f of ['/app.js', '/style.css', '/icons/favicon.svg', '/favicon.ico', '/icons/site.webmanifest']) assert.strictEqual((await fetch(BASE + f)).status, 200, f);
  assert.strictEqual((await fetch(BASE + '/../server.js')).status, 404);
  assert.strictEqual((await fetch(BASE + '/%2e%2e/package.json')).status, 404);
});

(async () => {
  let failed = 0;
  try {
    await start();
    for (const [name, fn] of tests) {
      try { await fn(); console.log('  ok   ' + name); }
      catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
    }
  } catch (e) { failed++; console.error(e); }
  if (proc && proc.exitCode === null) proc.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(failed ? '\n' + failed + ' failed' : '\nall ' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
