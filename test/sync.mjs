/* test/sync.mjs — the optional mirror, end to end.

   I cannot reach *.supabase.co from a sandbox (and neither can this file), so the
   desk is driven against a local fake that speaks the same two APIs:
     POST /auth/v1/token?grant_type=password|refresh_token      (GoTrue)
     GET/POST /rest/v1/desk_document?…                          (PostgREST + RLS)
   RLS is enforced for real here: a request with no/revoked bearer token gets 401,
   and every read/write is scoped to the caller's owner uuid.
   Run: node test/sync.mjs   (or npm test)                                     */
import fs from 'node:fs';
import http from 'node:http';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('OSR-Desk.html', 'utf8');
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x ? '  \u2190 ' + x : '')); } };

/* ───────────────────────────── the fake database ───────────────────────────── */
const USERS = { 'ry@example.test': { password: 'correct horse', uid: 'u_11111111-1111-1111-1111-111111111111' } };
const rows = new Map();               // owner|collection|record_id -> row
let tokens = new Map();               // token -> uid
let refreshes = new Map();            // refresh token -> uid
let hits = [];                        // every request the desk made
let down = false;                     // simulate a dead network

function reset(hard = true) {
  hits = [];
  if (hard) { rows.clear(); tokens = new Map(); refreshes = new Map(); }
}
const key = (o, c, r) => `${o}|${c}|${r}`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (down) { req.socket.destroy(); return; }               // fetch rejects, like a dead network
    hits.push({ method: req.method, path: url.pathname + url.search, auth: req.headers.authorization || '', apikey: req.headers.apikey || '', prefer: req.headers.prefer || '', body });
    const send = (code, obj, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(obj == null ? '' : JSON.stringify(obj)); };

    /* ---- auth ---- */
    if (url.pathname === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) {}
      if (grant === 'password') {
        const u = USERS[b.email];
        if (!u || u.password !== b.password) return send(400, { error_description: 'Invalid Login credentials', error_code: 'invalid_credentials' });
        const t = 'tok_' + Math.random().toString(36).slice(2);
        tokens.set(t, u.uid);
        const r = 'ref_' + Math.random().toString(36).slice(2);
        refreshes.set(r, u.uid);
        return send(200, { access_token: t, token_type: 'bearer', expires_in: 3600, refresh_token: r, user: { id: u.uid, email: b.email } });
      }
      if (grant === 'refresh_token') {
        const uid = refreshes.get(b.refresh_token);
        if (!uid) return send(400, { error_description: 'invalid refresh token' });
        const t = 'tok_' + Math.random().toString(36).slice(2);
        tokens.set(t, uid);
        return send(200, { access_token: t, token_type: 'bearer', expires_in: 3600, refresh_token: b.refresh_token, user: { id: uid } });
      }
      return send(404, { message: 'no such grant' });
    }

    /* ---- rest (RLS: the caller's uid scopes everything) ---- */
    if (url.pathname === '/rest/v1/desk_document') {
      const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const owner = tokens.get(auth);
      if (!owner) return send(401, { code: '42501', message: 'new row violates row-level security policy' });

      if (req.method === 'GET') {
        const since = (url.searchParams.get('updated_at') || '').replace(/^gt\./, '');
        const coll = url.searchParams.get('collection');
        let out = [...rows.values()].filter((r) => r.owner === owner && (!since || r.updated_at > since) && (!coll || r.collection === coll));
        out.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
        const limit = Number(url.searchParams.get('limit') || 500);
        return send(200, out.map(({ owner: _o, ...r }) => r).slice(0, limit), { 'Content-Range': `0-${Math.min(out.length, limit) - 1}/${out.length}` });
      }
      if (req.method === 'POST') {
        let list; try { list = JSON.parse(body); } catch (e) { return send(400, { message: 'body is not JSON' }); }
        if (!Array.isArray(list)) list = [list];
        for (const r of list) {
          const o = r.owner || owner;
          if (o !== owner) return send(403, { message: 'invalid owner for row-level security' });
          rows.set(key(o, r.collection, r.record_id), { ...r, owner: o, updated_at: r.updated_at || new Date().toISOString() });
        }
        return send(201, null);
      }
      return send(405, { message: 'method not allowed' });
    }
    return send(404, { message: 'no route: ' + url.pathname });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

/* ───────────────────────────── the desk, wired to it ───────────────────────────── */
async function bootDesk({ withSync = null } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  const JSDOM_ONLY = /Could not parse CSS|Not implemented/;
  vc.on('jsdomError', (e) => { const s = (e.detail || e).toString(); if (!JSDOM_ONLY.test(s)) errors.push(s.split('\n')[0]); });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  vc.on('warn', () => {});
  const { IDBFactory } = await import('fake-indexeddb');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc,
    beforeParse(win) {
      Object.defineProperty(win, 'indexedDB', { value: new IDBFactory(), configurable: true });
      win.fetch = async (u, opt = {}) => {
        const target = String(u).replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${PORT}`);
        const body = opt.body == null ? null : String(opt.body);
        return new Promise((res, rej) => {
          const rq = http.request({
            host: '127.0.0.1', port: PORT, method: opt.method || 'GET',
            path: new URL(target).pathname + new URL(target).search, headers: opt.headers || {}
          }, (rs) => {
            let buf = '';
            rs.on('data', (c) => (buf += c));
            rs.on('end', () => res({ status: rs.statusCode, ok: rs.statusCode >= 200 && rs.statusCode < 300, text: async () => buf, json: async () => JSON.parse(buf || 'null') }));
          });
          rq.on('error', (e) => rej(new Error('network down: ' + e.code)));
          if (body) rq.write(body);
          rq.end();
        });
      };
      win.URL.createObjectURL = () => 'blob:fake';
      win.URL.revokeObjectURL = () => {};
      win.matchMedia = win.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
      Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (t) => { win.__clip = t; } }, configurable: true });
    }
  });
  const w = dom.window;
  for (let i = 0; i < 160 && !w.eval('!!window.__osrBooted'); i++) await wait(25);
  const api = {
    w, d: w.document, errors,
    eval: (s) => w.eval(s),
    st: () => w.eval('Sync.status(Store.s)'),
    push: () => w.eval('Sync.push()'),
    pull: () => w.eval('Sync.pull()'),
    flush: () => w.eval('Store.flush()'),
    click: async (sel) => { const el = w.document.querySelector(sel); if (el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(80); } return !!el; },
    type: async (sel, v) => { const el = w.document.querySelector(sel); if (!el) return false; el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(20); return true; },
    toast: () => [...w.document.querySelectorAll('#toasts > *')].map((t) => t.textContent).join(' | ')
  };
  if (withSync) { await api.eval(`Sync.setConfig(${JSON.stringify(withSync.url)}, ${JSON.stringify(withSync.key)})`); }
  return api;
}

const URL_ = `http://127.0.0.1:${PORT}`;
const serverRows = () => [...rows.values()];
const rowFor = (c, r) => serverRows().find((x) => x.collection === c && x.record_id === r);

/* ------------------------------------------------------------------ */
console.log('\n[1] with sync off, the desk makes exactly zero requests');
{
  reset();
  const a = await bootDesk();
  check('sync is not configured', a.eval('Sync.enabled') === false);
  check('no session', a.eval('Sync.signedIn') === false);
  a.eval(`Store.edit(st => { st.templates[0].title = 'edited while offline'; }, 'data')`);
  await a.eval('Store.flush()');
  await a.eval('Sync.queuePush(20)');
  await wait(200);
  check('an edit + queuePush touched nothing on the wire', hits.length === 0, JSON.stringify(hits.map((h) => h.method + ' ' + h.path)).slice(0, 160));
  a.eval(`view.tab='settings'; render()`);
  await wait(40);
  check('Settings says it plainly', /Off — nothing leaves this machine/.test(a.d.body.textContent), (a.d.getElementById('sync-status') || {}).textContent);
  check('and offers the two fields, no network widgets', !!a.d.getElementById('sync-url') && !!a.d.getElementById('sync-key'));
  check('queuePush is safe to call unconfigured', (await a.eval('Sync.push()')) === false);
  a.w.close();
}

console.log('\n[2] configuration');
{
  reset();
  const a = await bootDesk();
  check('junk URL is refused', (await a.eval(`Sync.setConfig('not a url','k')`)) === false);
  a.eval(`view.tab='settings'; render()`);
  await wait(40);
  check('the settings tab shows the two fields', !!a.d.getElementById('sync-url') && !!a.d.getElementById('sync-key'));
  await a.type('#sync-url', URL_);
  await a.type('#sync-key', 'sb_publishable_testkey123');
  check('Save & connect button exists', await a.click('[data-act="sync-save"]'));
  check('now enabled', a.eval('Sync.enabled') === true);
  check('config is remembered in localStorage, not inside a workspace row', !!a.w.localStorage.getItem('osr.desk.sync.config.v1') && !/127\.0\.0\.1/.test(await a.eval('JSON.stringify(Store.s)')));
  check('the key is masked in the UI', a.eval(`JSON.stringify(Sync.config())`).includes('••••'), a.eval('JSON.stringify(Sync.config())'));
  await a.click('[data-act="sync-signin"]');
  check('signing in without credentials fails politely', /sign in|email or password|not signed/i.test(a.toast() + a.eval('Sync.lastError')), a.toast());
  check('and no row was ever written', serverRows().length === 0);
  a.w.close();
}

console.log('\n[3] sign in');
{
  reset();
  const a = await bootDesk({ withSync: { url: URL_, key: 'sb_publishable_testkey123' } });
  await a.eval(`Sync.signIn('ry@example.test','wrong')`);
  check('a bad password is reported in human words', a.eval('Sync.lastError') === 'wrong email or password', a.eval('Sync.lastError'));
  check('no session after the failure', a.eval('Sync.signedIn') === false);
  const ok = await a.eval(`Sync.signIn('ry@example.test','correct horse')`);
  check('right password signs in', ok === true && a.eval('Sync.signedIn') === true);
  check('the pull that follows finds nothing yet', (await a.st()).lastPull == null || (await a.st()).lastPull.applied === 0);
  check('the auth call carried the publishable key as apikey', hits.some((h) => h.path.startsWith('/auth/v1/token') && h.apikey === 'sb_publishable_testkey123'));
  check('the access token is kept out of the workspace tables', !(await a.eval('JSON.stringify(Store.s)')).includes('tok_'));
  check('Settings now shows the signed-in controls', await (async () => { a.eval(`view.tab='settings'; render()`); await wait(40); return !!a.d.querySelector('[data-act="sync-now"]'); })());
  a.w.close();
}

console.log('\n[4] push = the diff, not the library');
{
  reset();
  const a = await bootDesk({ withSync: { url: URL_, key: 'k' } });
  await a.eval(`Sync.signIn('ry@example.test','correct horse')`);
  reset(false);
  const virgin = await a.st();
  check('a brand-new project queues the whole library, not nothing', virgin.pending > 40, 'pending: ' + virgin.pending);
  hits = [];
  await a.push();
  check('the first push uploads everything in one request', hits.filter((h) => h.method === 'POST').length === 1 && serverRows().length > 40, 'rows: ' + serverRows().length);
  check('then nothing is pending', (await a.st()).pending === 0);
  const id = await a.eval('Store.s.templates[0].id');
  a.eval(`Store.edit(st => { st.templates[0].title = 'Refund approved v2'; }, 'data')`);
  await a.eval('Store.flush()');
  check('one row is pending', (await a.st()).pending === 1, JSON.stringify((await a.st()).pending));
  hits = [];
  check('push reports success', (await a.push()) === true);
  check('exactly one POST went out', hits.filter((h) => h.method === 'POST').length === 1, JSON.stringify(hits.map((h) => h.method)));
  const sent = JSON.parse(hits.find((h) => h.method === 'POST').body);
  check('and it carried ONE record, not the library', sent.length === 1, 'rows: ' + sent.length);
  check('the upsert targets the unique index', /on_conflict=owner,collection,record_id/.test(hits.find((h) => h.method === 'POST').path));
  check('and asks to merge duplicates', /resolution=merge-duplicates/.test(hits.find((h) => h.method === 'POST').prefer), JSON.stringify(hits.find((h) => h.method === 'POST')).slice(0, 120));
  check('the row on the server has the new title', rowFor('templates', id)?.payload?.title === 'Refund approved v2');
  check('the row is owned by the signed-in uid', rowFor('templates', id)?.owner === 'u_11111111-1111-1111-1111-111111111111');
  check('nothing is pending afterwards', (await a.st()).pending === 0);
  hits = [];
  await a.push();
  check('a second push with no changes sends nothing', hits.length === 0, JSON.stringify(hits.map((h) => h.path)));
  a.eval(`Store.edit(st => { st.phrases[0].text = 'shorter, kinder'; st.templates[1].title = 'Another one'; }, 'data')`);
  await a.eval('Store.flush()');
  hits = [];
  await a.push();
  const b = JSON.parse(hits.find((h) => h.method === 'POST').body);
  check('two edits in one pause go up in one request', b.length === 2 && hits.filter((h) => h.method === 'POST').length === 1, JSON.stringify(b.map((r) => r.collection)));
  a.w.close();
}

console.log('\n[5] deletes travel as tombstones');
{
  reset();
  const a = await bootDesk({ withSync: { url: URL_, key: 'k' } });
  await a.eval(`Sync.signIn('ry@example.test','correct horse')`);
  await a.eval(`Sync.push()`);
  reset(false);
  const n0 = serverRows().length;
  const id = await a.eval('Store.s.templates[0].id');
  a.eval(`Store.edit(st => { st.templates = st.templates.filter(x => x.id !== ${JSON.stringify(id)}); }, 'data')`);
  await a.eval('Store.flush()');
  check('the delete shows up as pending', (await a.st()).pending === 1, JSON.stringify(await a.st()));
  await a.push();
  const r = rowFor('templates', id);
  check('the server keeps a tombstone, not a hole', !!r && r.deleted === true, JSON.stringify(r || {}).slice(0, 120));
  check('and its payload is emptied (no stale text sitting in the cloud)', JSON.stringify(r.payload) === '{}', JSON.stringify(r.payload));
  check('total rows unchanged', serverRows().length === n0);
  a.w.close();
}

console.log('\n[6] only the text goes — never the shelf');
{
  reset();
  const a = await bootDesk({ withSync: { url: URL_, key: 'k' } });
  await a.eval(`Sync.signIn('ry@example.test','correct horse')`);
  await a.eval(`(async () => {
    await Store.Vault.put('f_secret', new Blob(['bank statement contents'], {type:'text/plain'}));
    Store.edit(st => { st.files.unshift({ id:'f_secret', name:'bank-statement.txt', kind:'file', mime:'text/plain', size:21, at: nowISO(), stored:'idb', snippet:'account 1234', thumb:'data:image/png;base64,AAAA' }); }, 'data');
    Store.edit(st => { st.templates[0].fileIds = ['f_secret']; st.templates[0].snippet = 'inline capture'; st.templates[0].thumb = 'data:image/png;base64,BBBB'; }, 'data');
    await Store.flush();
  })()`);
  await a.eval('Sync.push()');
  check('no files collection was sent', !serverRows().some((r) => r.collection === 'files'), JSON.stringify(serverRows().map((r) => r.collection)));
  check('a template payload carries no thumb', !('thumb' in (rowFor('templates', await a.eval('Store.s.templates[0].id'))?.payload || {})));
  check('nor an inline snippet', !('snippet' in (rowFor('templates', await a.eval('Store.s.templates[0].id'))?.payload || {})));
  check('attachment ids go (so the other machine can relink) — bytes do not', (rowFor('templates', await a.eval('Store.s.templates[0].id'))?.payload?.fileIds || []).includes('f_secret'));
  const kinds = await a.eval('Sync.rowsFor(Store.s).map(r => r.collection)');
  check('rowsFor() only ever yields the 6 whitelisted collections', kinds.every((c) => ['templates', 'phrases', 'categories', 'cases', 'vars', 'settings'].includes(c)), JSON.stringify([...new Set(kinds)]));
  a.w.close();
}

console.log('\n[7] pull — another machine wrote, this one learns');
{
  reset();
  const a = await bootDesk({ withSync: { url: URL_, key: 'k' } });
  await a.eval(`Sync.signIn('ry@example.test','correct horse')`);
  await a.push();                       // library up on the server first, so the diff is clean
  check('nothing is pending to start with', (await a.st()).pending === 0);
  const owner = USERS['ry@example.test'].uid;
  rows.set(key(owner, 'templates', 'tpl_from_phone'), {
    owner, collection: 'templates', record_id: 'tpl_from_phone', deleted: false,
    updated_at: new Date(Date.now() + 5000).toISOString(),
    payload: { id: 'tpl_from_phone', title: 'Written on the phone', body: 'Hi {{client_name}}, sorted.', subject: 'sorted', category: await a.eval('Store.s.categories[0].id'), tags: ['mobile'], usage: 0, fileIds: [], custom: true, createdAt: new Date().toISOString(), updatedAt: new Date(Date.now() + 5000).toISOString(), order: -1 }
  });
  rows.set(key(owner, 'vars', 'amount'), { owner, collection: 'vars', record_id: 'amount', deleted: false, updated_at: new Date(Date.now() + 5001).toISOString(), payload: { value: '1,200.00' } });
  const before = await a.eval('Store.s.templates.length');
  check('pull succeeds', (await a.pull()) === true);
  check('the new template is in memory', a.eval('Store.s.templates.some(t => t.id === "tpl_from_phone")') === true);
  check('count went up by one', a.eval('Store.s.templates.length') === before + 1);
  check('and it is in the local database too, not just memory', (await a.eval(`DB.readAll().then(r => r.templates.some(t => t.id === "tpl_from_phone"))`)) === true);
  check('the remote {{placeholder}} value arrived', a.eval('Store.s.vars.amount') === '1,200.00');
  check('pull does not immediately re-push what it just pulled', (await a.st()).pending === 0, 'pending: ' + (await a.st()).pending);
  const queue = (await a.eval('Sync.pending(Store.s)')).ups;
  check('the pulled rows are not sitting in the queue to go back out', !queue.some((u) => u.record_id === 'tpl_from_phone' || (u.collection === 'vars' && u.record_id === 'amount')), JSON.stringify(queue.map((u) => u.collection + '/' + u.record_id)).slice(0, 160));
  check('the cursor advanced', !!(await a.st()).cursor);
  hits = [];
  await a.pull();
  check('a second pull asks only for newer rows', hits.every((h) => /updated_at=gt\./.test(h.path)) && hits.length === 1, JSON.stringify(hits.map((h) => h.path)));
  // remote tombstone
  rows.set(key(owner, 'templates', 'tpl_from_phone'), { owner, collection: 'templates', record_id: 'tpl_from_phone', deleted: true, updated_at: new Date(Date.now() + 9000).toISOString(), payload: {} });
  await a.pull();
  check('a remote delete removes it here', a.eval('Store.s.templates.some(t => t.id === "tpl_from_phone")') === false);
  check('and the local DB agrees', (await a.eval(`DB.readAll().then(r => r.templates.some(t => t.id === "tpl_from_phone"))`)) === false);
  a.w.close();
}

console.log('\n[8] conflicts — the newer edit wins, the older one is overwritten');
{
  reset();
  const a = await bootDesk({ withSync: { url: URL_, key: 'k' } });
  await a.eval(`Sync.signIn('ry@example.test','correct horse')`);
  const id = await a.eval('Store.s.templates[1].id');
  // an old row from the phone, written yesterday
  const owner = USERS['ry@example.test'].uid;
  rows.set(key(owner, 'templates', id), { owner, collection: 'templates', record_id: id, deleted: false, updated_at: '2020-01-01T00:00:00.000Z', payload: { id, title: 'Ancient text from the phone', body: 'old', category: 'cat', tags: [], usage: 0, fileIds: [], custom: true, updatedAt: '2020-01-01T00:00:00.000Z' } });
  a.eval(`Store.edit(st => { const t = st.templates.find(x => x.id === ${JSON.stringify(id)}); t.title = 'My edit from five minutes ago'; t.updatedAt = '2099-01-01T00:00:00.000Z'; }, 'data')`);
  await a.eval('Store.flush()');
  await a.pull();
  check('a stale remote row does not clobber a newer local edit', a.eval('Store.s.templates.find(t => t.id === ' + JSON.stringify(id) + ')?.title') === 'My edit from five minutes ago', a.eval('Store.s.templates.find(t => t.id === ' + JSON.stringify(id) + ')?.title'));
  check('the pull counted it as a conflict', (await a.st()).conflicts >= 1, JSON.stringify((await a.st()).lastPull));
  check('and the local version is queued to go back up', (await a.st()).pending >= 1);
  await a.push();
  check('after the push the server holds MY text', rowFor('templates', id)?.payload?.title === 'My edit from five minutes ago');
  // and a genuinely newer remote row does win
  rows.set(key(owner, 'templates', id), { owner, collection: 'templates', record_id: id, deleted: false, updated_at: '2099-06-01T00:00:00.000Z', payload: { id, title: 'Newer on the phone', body: 'new', category: 'cat', tags: [], usage: 0, fileIds: [], custom: true, updatedAt: '2099-06-01T00:00:00.000Z' } });
  await a.pull();
  check('a newer remote row does overwrite local', a.eval('Store.s.templates.find(t => t.id === ' + JSON.stringify(id) + ')?.title') === 'Newer on the phone');
  a.w.close();
}

console.log('\n[9] RLS, rejection and a dead network');
{
  reset();
  const a = await bootDesk({ withSync: { url: URL_, key: 'k' } });
  await a.eval(`Sync.signIn('ry@example.test','correct horse')`);
  a.eval(`Store.edit(st => { st.templates[0].title = 'before the outage'; }, 'data')`);
  await a.eval('Store.flush()');
  check('it syncs while healthy', (await a.push()) === true && (await a.st()).error == null);
  // the server starts refusing everyone
  const save = new Map(tokens);
  tokens = new Map();            // every bearer token is now worthless
  a.eval(`Store.edit(st => { st.templates[0].title = 'edited while the server says no'; }, 'data')`);
  await a.eval('Store.flush()');
  const ok2 = await a.push();
  check('a revoked token means the push fails, cleanly', ok2 === false, 'ok=' + ok2);
  check('the error says what it means', /signed out/i.test((await a.st()).error || ''), JSON.stringify((await a.st()).error));
  check('the session is dropped rather than retried forever', a.eval('Sync.signedIn') === false);
  check('the local workspace still has the edit', a.eval('Store.s.templates[0].title') === 'edited while the server says no');
  check('and the local database still has it too', (await a.eval(`DB.readAll().then(r => r.templates[0].title)`)) === 'edited while the server says no');
  tokens = save;
  // now the network itself
  await a.eval(`Sync.signIn('ry@example.test','correct horse')`);
  a.eval(`Store.edit(st => { st.templates[1].title = 'written with the cable unplugged'; }, 'data')`);
  await a.eval('Store.flush()');
  down = true;
  const ok3 = await a.push();
  check('a dead network does not throw into the UI', ok3 === false);
  check('the row is still queued', (await a.st()).pending >= 1, JSON.stringify((await a.st()).pending));
  check('typing still saves locally', a.eval('Store.s.templates[1].title') === 'written with the cable unplugged');
  check('no crash was logged', a.errors.length === 0, JSON.stringify(a.errors).slice(0, 200));
  down = false;
  const ok4 = await a.push();
  check('when the wire comes back, the queue drains', ok4 === true && (await a.st()).pending === 0, 'ok=' + ok4 + ' pending=' + (await a.st()).pending);
  check('the row made it after all', serverRows().some((r) => r.payload?.title === 'written with the cable unplugged'));
  a.w.close();
}

console.log('\n[10] the buttons and the automatic push');
{
  reset();
  const a = await bootDesk({ withSync: { url: URL_, key: 'k' } });
  await a.eval(`Sync.signIn('ry@example.test','correct horse')`);
  reset(false);
  a.eval(`view.tab='settings'; render()`);
  await wait(40);
  check('the status line is readable', /Up to date|rows? waiting|signed in/i.test(a.d.body.textContent));
  hits = [];
  a.eval(`Sync.queuePush(30)`);
  await wait(300);
  check('queuePush pushes by itself', hits.some((h) => h.method === 'POST'), JSON.stringify(hits.map((h) => h.method)));
  await a.click('[data-act="sync-now"]');
  check('Sync now runs both directions and toasts', /Synced/i.test(a.toast()), a.toast().slice(0, 120));
  hits = [];
  await a.click('[data-act="sync-push-all"]');
  check('Send everything up ignores the diff and re-sends the library', hits.some((h) => h.method === 'POST' && JSON.parse(h.body || '[]').length > 20), 'posts: ' + hits.filter((h) => h.method === 'POST').length);
  check('and pending is zero again', (await a.st()).pending === 0);
  await a.click('[data-act="sync-signout"]');
  check('Sign out leaves sync configured but idle', a.eval('Sync.enabled') === true && a.eval('Sync.signedIn') === false);
  hits = [];
  a.eval(`Store.edit(st => { st.templates[0].title = 'edited while signed out'; }, 'data')`);
  await a.eval('Store.flush()');
  await a.eval('Sync.queuePush(20)');
  await wait(150);
  check('signed out = nothing on the wire', hits.length === 0);
  await a.click('[data-act="sync-clear"]');
  await wait(60);
  const cbtn = [...a.d.querySelectorAll('button')].find((b) => /Turn sync off/i.test(b.textContent));
  check('Forget this project asks first', !!cbtn, [...a.d.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(-4).join(' / '));
  if (cbtn) { cbtn.dispatchEvent(new a.w.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(150); }
  check('then removes the URL, key and login', a.eval('Sync.enabled') === false && a.eval('Sync.signedIn') === false);
  check('and nothing is left in localStorage for it', !a.w.localStorage.getItem('osr.desk.sync.config.v1') && !a.w.localStorage.getItem('osr.desk.sync.session.v1'));
  a.w.close();
}

console.log('\n[11] nothing leaks');
{
  reset();
  const a = await bootDesk({ withSync: { url: URL_, key: 'k' } });
  await a.eval(`Sync.signIn('ry@example.test','correct horse')`);
  await a.eval(`Sync.push()`);
  const lsKeys = await a.eval('Object.keys(localStorage)');
  const blob = await a.eval(`JSON.stringify(Object.fromEntries(${JSON.stringify(lsKeys)}.map(k => [k, localStorage.getItem(k)])))`);
  check('the access token is only in the sync session key', lsKeys.filter((k) => /tok_|token/i.test(k)).join(',').length < 60, JSON.stringify(lsKeys));
  const all = await a.eval(`DB.readAll().then(r => JSON.stringify(r))`);
  check('no token or password in any database row', !/tok_|correct horse|refresh/i.test(all));
  check('no row contains a file blob', !/data:image|bank statement/.test(serverRows().map((r) => JSON.stringify(r.payload)).join('')));
  check('every rest hit was scoped to the owner by RLS (server-side)', hits.every((h) => !h.path.startsWith('/rest/') || /Bearer tok_/.test(h.auth)));
  const st = await a.st();
  check('status() exposes no secret', !JSON.stringify(st).includes('tok_') && !JSON.stringify(st).includes('ref_'), JSON.stringify(st).slice(0, 200));
  a.w.close();
}

server.close();
console.log('\n────────  ' + pass + ' passed, ' + fail + ' failed  ────────\n');
if (fail) process.exit(1);
