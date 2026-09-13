/* test/db.mjs — the database itself: IndexedDB as the source of truth.
   jsdom ships no IndexedDB, so every window here is booted with a real (fake)
   implementation and the assertions read actual rows out of the tables.
   Run: node test/db.mjs   (or npm test)                                       */
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';

const html = fs.readFileSync('OSR-Desk.html', 'utf8');
const LS_KEY = 'osr.desk.state.v3';
const SEED = { templates: 32, phrases: 14, categories: 10 };   /* from src/data/seed.js */

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  \u2190 ' + extra : '')); }
}

/**
 * Boot the built file with a database.
 *   factory    — share one across windows to simulate "same browser profile"
 *   seedLS     — pre-fill localStorage with an old v3 blob (migration)
 *   idb:'none' — a browser with no IndexedDB at all
 *   idb:'throw'— a browser whose storage getter explodes (hardened/enterprise)
 */
async function boot({ factory = new IDBFactory(), seedLS = null, idb = 'ok' } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  const JSDOM_ONLY = /Could not parse CSS|Not implemented: navigation|Not implemented: HTMLFormElement|no-db|tx aborted/;
  vc.on('jsdomError', (e) => { const s = (e.detail || e).toString(); if (!JSDOM_ONLY.test(s)) errors.push('jsdomError: ' + s.split('\n').slice(0, 3).join(' ')); });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  vc.on('warn', () => {});                       // the fallback path warns on purpose

  const written = new Map();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc,
    beforeParse(win) {
      if (idb === 'ok') Object.defineProperty(win, 'indexedDB', { value: factory, configurable: true });
      if (idb === 'none') Object.defineProperty(win, 'indexedDB', { get() { return undefined; }, configurable: true });
      if (idb === 'throw') Object.defineProperty(win, 'indexedDB', { get() { throw new Error('blocked by policy'); }, configurable: true });
      win.URL.createObjectURL = () => 'blob:fake';
      win.URL.revokeObjectURL = () => {};
      win.matchMedia = win.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
      win.structuredClone = win.structuredClone || ((v) => JSON.parse(JSON.stringify(v)));
      Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (t) => { win.__clip = t; } }, configurable: true });
      win.fetch = async (u) => {
        const [, meta, b64] = String(u).match(/^data:([^;]*);base64,(.*)$/) || [];
        const buf = Buffer.from(b64 || '', 'base64');
        return { blob: async () => new win.Blob([buf], { type: meta || 'application/octet-stream' }), text: async () => buf.toString('utf8') };
      };
    }
  });
  const w = dom.window;
  // capture localStorage writes: in database mode the app must not write the big blob
  const ls = w.localStorage;
  const origSet = ls.setItem.bind(ls), origGet = ls.getItem.bind(ls), origDel = ls.removeItem.bind(ls);
  w.localStorage.setItem = (k, v) => { written.set(String(k), String(v)); return origSet(k, v); };
  w.localStorage.getItem = (k) => (written.has(String(k)) ? written.get(String(k)) : origGet(k));
  w.localStorage.removeItem = (k) => { written.delete(String(k)); return origDel(k); };
  if (seedLS) origSet(LS_KEY, JSON.stringify(seedLS));

  const ready = async () => w.eval('!!window.__osrBooted');
  let up = false;
  for (let i = 0; i < 160 && !(up = await ready()); i++) await wait(25);
  await wait(40);

  const api = {
    w, d: w.document, dom, errors, factory,
    ready: up,
    ls: (k) => (written.has(k) ? written.get(k) : origGet(k)),
    mode: () => w.eval('Store.mode'),
    engine: () => w.eval('DB.engine'),
    eval: (s) => w.eval(s),
    rows: (t) => w.eval(`DB.readAll().then(r => r[${JSON.stringify(t)}])`),
    blobKeys: () => w.eval('DB.blobIds()'),
    flush: async () => { try { await w.eval('Store.flush()'); } catch (e) {} await wait(30); },
    /** poll an expression (may return a promise, may use await) until truthy */
    until: async (expr, ms = 3000) => {
      for (let i = 0; i < ms / 50; i++) {
        let v = false;
        try { v = await w.eval(`(async () => { return (${expr}); })()`); } catch (e) { return false; }
        if (v) return true;
        await wait(50);
      }
      return false;
    },
    toastText: () => [...w.document.querySelectorAll('#toasts > *')].map((t) => t.textContent).join(' | '),
    close: () => { try { w.close(); } catch (e) {} }
  };
  return api;
}

/* ------------------------------------------------------------------ */
console.log('\n[1] a fresh desk lands in the database, not in a blob');
{
  const a = await boot();
  check('the app finished booting', a.ready);
  check('engine is IndexedDB', a.engine() === 'idb', 'got ' + a.engine());
  check('Store reports idb mode', a.mode() === 'idb');
  const t = await a.rows('templates');
  check('the starter library went in as rows', t.length === a.eval('Store.s.templates.length') && t.length >= SEED.templates, 'rows: ' + t.length);
  const cats = await a.rows('categories');
  check('categories are their own table', cats.length === SEED.categories, 'rows: ' + cats.length);
  const phr = await a.rows('phrases');
  check('phrases are their own table', phr.length >= SEED.phrases, 'rows: ' + phr.length);
  const meta = await a.rows('meta');
  check('meta.app stamped the schema', meta.some((m) => m.key === 'app' && m.dbVersion === 1 && m.stateSchema === 3), JSON.stringify(meta).slice(0, 120));
  check('meta.saved stamped a write', meta.some((m) => m.key === 'saved' && !!m.at && /^dev_/.test(m.device)));
  const blob = a.ls(LS_KEY);
  check('no giant workspace blob was written to localStorage', !blob, 'wrote ' + (blob || '').length + ' chars');
  const mirror = a.ls(LS_KEY + '.mirror');
  check('a small mirror marker was written instead', !!mirror && mirror.length < 400 && JSON.parse(mirror).db === true, String(mirror).slice(0, 80));
  a.close();
}

console.log('\n[2] the tables and indexes a support desk actually queries');
{
  const a = await boot();
  for (const table of ['templates', 'phrases', 'categories', 'settings', 'vars', 'files', 'cases', 'activity', 'trash', 'blobs', 'meta']) {
    check('table "' + table + '" exists', a.eval(`Object.keys(DB.tables).includes(${JSON.stringify(table)})`));
  }
  check('templates indexed by category (the library groups)', a.eval(`DB.tables.templates.idx.some(i => i[0] === 'category')`));
  check('templates indexed by usage ("most used" sort)', a.eval(`DB.tables.templates.idx.some(i => i[0] === 'usage')`));
  check('templates indexed by tags, multiEntry (tag filters)', a.eval(`DB.tables.templates.idx.some(i => i[0] === 'tags' && i[2] === true)`));
  check('templates indexed by updatedAt (last edited sort)', a.eval(`DB.tables.templates.idx.some(i => i[0] === 'updatedAt')`));
  check('templates indexed by title (alphabetical)', a.eval(`DB.tables.templates.idx.some(i => i[0] === 'title')`));
  check('cases indexed by status (the board columns)', a.eval(`DB.tables.cases.idx.some(i => i[0] === 'status')`));
  check('files indexed by name and kind (the shelf filter)', a.eval(`DB.tables.files.idx.some(i => i[0] === 'name') && DB.tables.files.idx.some(i => i[0] === 'kind')`));
  check('blobs indexed by mime', a.eval(`DB.tables.blobs.idx.some(i => i[0] === 'mime')`));
  a.close();
}

console.log('\n[3] an edit rewrites one row, not the library');
{
  const a = await boot();
  const before = await a.rows('templates');
  const id = before[0].id;
  const r0 = await a.eval(`DB.countAll()`);
  a.eval(`Store.edit(st => { const t = st.templates.find(x => x.id === ${JSON.stringify(id)}); t.title = 'Renamed by the DB test'; t.updatedAt = '2030-01-01T00:00:00.000Z'; }, 'data')`);
  await a.flush();
  const after = await a.rows('templates');
  check('the changed row is on disk', after.find((r) => r.id === id)?.title === 'Renamed by the DB test');
  check('row count is stable (no duplicates from the diff)', after.length === before.length, after.length + ' vs ' + before.length);
  check('localStorage still holds no copy of the workspace', !a.ls(LS_KEY));
  const saved0 = (await a.rows('meta')).find((m) => m.key === 'saved');
  check('the write reported touching a small number of rows', saved0.touched === 1, 'touched: ' + saved0.touched);
  a.eval(`Store.edit(st => { st.templates[0].title = st.templates[0].title; }, 'data')`);
  await a.flush();
  const saved1 = (await a.rows('meta')).find((m) => m.key === 'saved');
  check('an unchanged record is skipped entirely (no row rewrite)', saved1.at === saved0.at, saved0.at + ' vs ' + saved1.at);
  a.close();
}

console.log('\n[4] close the tab, open it again — the data is still there');
{
  const factory = new IDBFactory();
  const a = await boot({ factory });
  a.eval(`Store.edit(st => { st.templates.unshift({ id: 'kept_1', title: 'Survives a reload', body: 'hi {{name}}', category: st.categories[0].id, tags: ['refund', 'x'], usage: 3, favorite: true, fileIds: [], custom: true, createdAt: '2026-01-01', updatedAt: '2026-01-02', order: 99, subject: 're: your ticket', noSig: true }); }, 'data')`);
  await a.flush();
  a.close();

  const b = await boot({ factory });
  const t = (await b.rows('templates')).find((x) => x.id === 'kept_1');
  check('the new template came back from the database', !!t && t.title === 'Survives a reload');
  check('its usage count came back', t?.usage === 3);
  check('its subject line came back', t?.subject === 're: your ticket');
  check('its star came back', t?.favorite === true);
  check('its tags came back', JSON.stringify(t?.tags) === '["refund","x"]');
  check('its signature opt-out came back', t?.noSig === true);
  check('and it is rendered, not just stored', b.d.body.textContent.includes('Survives a reload'));
  const cats = await b.rows('categories');
  check('category order survived', cats.length > 3 && cats.every((c) => Number.isFinite(c.order)));
  b.close();
}

console.log('\n[5] migrating an old localStorage workspace into the database');
{
  const factory = new IDBFactory();
  const legacy = {
    schema: 3, onboarded: true, installedAt: '2025-01-01T00:00:00.000Z',
    settings: { yourName: 'Ry', company: 'Old Corp', theme: 'dark', signature: '— Ry' },
    vars: { client_name: 'Maya', ticket_id: 'T-4001' },
    categories: [{ id: 'c1', name: 'Billing', color: '#c1362f', order: 0 }, { id: 'c2', name: 'Tech', color: '#2f6df6', order: 1 }],
    templates: [
      { id: 't1', title: 'Refund approved', body: 'Hi {{client_name}}, refund for {{ticket_id}} is on its way.', subject: 'Your refund', category: 'c1', tags: ['refund'], usage: 7, favorite: true, fileIds: [], custom: true, createdAt: '2025-02-02', updatedAt: '2025-03-03', order: 0 },
      { id: 't2', title: 'Chase-up', body: 'Following up on {{ticket_id}}.', category: 'c1', tags: [], usage: 1, fileIds: [], custom: true, createdAt: '2025-02-04', updatedAt: '2025-02-04', order: 1 }
    ],
    phrases: [{ id: 'p1', text: 'Thanks for your patience.', usage: 4, group: 'manners' }],
    files: [], cases: [{ id: 'k1', client: 'Maya', ticket: 'T-4001', status: 'awaiting', promised: 'by Friday', history: [], updatedAt: '2025-03-01' }],
    activity: [], trash: []
  };
  const a = await boot({ factory, seedLS: legacy });
  check('boot preferred the old workspace over the seed', a.eval('Store.s.templates.length') === 2, 'got ' + a.eval('Store.s.templates.length'));
  check('name and theme migrated', a.eval('Store.s.settings.yourName') === 'Ry' && a.eval('Store.s.settings.theme') === 'dark');
  const varsRows = await a.rows('vars');
  check('remembered {{placeholders}} became a vars table', varsRows.length === 2 && varsRows.some((r) => r.key === 'ticket_id' && r.value === 'T-4001'));
  check('cases migrated', a.eval('Store.s.cases.length') === 1);
  const t = await a.rows('templates');
  check('the migrated templates are now DB rows', t.length === 2 && t.some((x) => x.id === 't1'));
  check('phrases too', (await a.rows('phrases')).length === 1);
  const st = await a.rows('settings');
  check('settings became a single row', st.length === 1 && st[0].key === 'settings' && st[0].yourName === 'Ry');
  check('the migration is recorded in meta', (await a.rows('meta')).some((m) => m.key === 'app' && m.migratedFrom === 'localStorage'));
  check('the pre-migration blob is KEPT as the rollback copy', !!a.ls(LS_KEY) && JSON.parse(a.ls(LS_KEY)).templates.length === 2);
  a.close();
  const b = await boot({ factory });
  check('a second boot reads the DB, not the stale blob', b.eval('Store.s.templates.length') === 2 && b.eval('Store.s.templates[0].title') === 'Refund approved');
  b.close();
}

console.log('\n[6] files: bytes in blobs, metadata in files');
{
  const a = await boot();
  const text = 'REFUND POLICY\n=================\n1. Check the invoice.\n2. Approve under 50 USD.\n';
  await a.eval(`(async () => {
    const blob = new Blob([${JSON.stringify(text)}], { type: 'text/plain' });
    const res = await Store.Vault.put('f_demo', blob);
    Store.edit(st => { st.files.unshift({ id: 'f_demo', name: 'refund-policy.txt', kind: 'file', mime: 'text/plain', size: blob.size, at: nowISO(), stored: res.kind, snippet: ${JSON.stringify(text)} }); }, 'data');
  })()`);
  await a.flush();
  check('the bytes came back verbatim', (await a.eval(`Store.Vault.get('f_demo').then(b => b ? readBlobText(b) : null)`)) === text);
  check('the record says it is stored in the database', a.eval('Store.s.files[0].stored') === 'idb');
  check('a row exists in the blobs table', (await a.blobKeys()).includes('f_demo'));
  const row = await a.eval(`DB.blobRow('f_demo')`);
  check('the blob row carries size + mime, not only bytes', !!row && row.mime === 'text/plain' && row.size === text.length, JSON.stringify(row && { mime: row.mime, size: row.size }));
  check('no bytes field leaked onto the file row', a.eval('Store.s.files[0].bytes') === undefined);
  check('file metadata is a separate row', (await a.rows('files')).some((f) => f.id === 'f_demo' && f.name === 'refund-policy.txt'));
  check('exporting one file still yields a data URL', String(await a.eval(`Store.Vault.exportOne('f_demo')`)).startsWith('data:'));
  await a.eval(`Store.Vault.del('f_demo')`);
  await a.flush();
  check('deleting a file drops the blob row', !(await a.blobKeys()).includes('f_demo'));
  a.close();
}

console.log('\n[7] verify() and repair() catch what "it feels slow" means');
{
  const a = await boot();
  const v0 = await a.eval('DB.verify(Store.s)');
  check('a healthy desk verifies clean', v0.ok === true, JSON.stringify(v0.problems || []).slice(0, 160));

  await a.eval(`(async () => { await Store.Vault.put('f_gone', new Blob(['x'], {type:'text/plain'})); Store.edit(st => { st.files.unshift({ id:'f_gone', name:'gone.txt', kind:'file', mime:'text/plain', size:1, at: nowISO(), stored:'idb', snippet:'x' }); }, 'data'); await Store.flush(); await DB.blobDel('f_gone'); })()`);
  const v1 = await a.eval('DB.verify(Store.s)');
  check('a file whose bytes are missing is caught', v1.ok === false && v1.problems.some((p) => /no bytes/.test(p)), JSON.stringify(v1.problems || []).slice(0, 160));

  await a.eval(`DB.blobPut('f_orphan', new Blob(['junk'], {type:'image/png'}))`);
  const v2 = await a.eval('DB.verify(Store.s)');
  check('an orphaned blob is caught', v2.problems.some((p) => /orphan/.test(p)), JSON.stringify(v2.problems || []).slice(0, 160));

  const repaired = await a.eval('DB.repair(Store.s)');
  check('repair() rewrites every row', repaired.rows >= SEED.templates + SEED.phrases + SEED.categories, 'rows: ' + repaired.rows);
  check('repair() garbage-collects the orphan', repaired.droppedBlobs >= 1 && !(await a.blobKeys()).includes('f_orphan'));
  check('after repair the counts agree again', (await a.rows('templates')).length === a.eval('Store.s.templates.length'));

  a.eval(`Store.edit(st => { st.templates[0].fileIds = ['nope_404']; }, 'data')`);
  await a.flush();
  const v3 = await a.eval('DB.verify(Store.s)');
  check('a dangling attachment is caught', v3.problems.some((p) => /no longer exists/.test(p)), JSON.stringify(v3.problems || []).slice(0, 200));
  a.close();
}

console.log('\n[8] limits, stats, and the SQL view');
{
  const a = await boot();
  a.eval(`Store.edit(st => { st.activity = Array.from({length: 900}, (_, i) => ({ id: 'a'+i, at: new Date(Date.now()-i*1000).toISOString(), kind: 'copy', ref: 't'+i })); }, 'data')`);
  await a.flush();
  const act = await a.rows('activity');
  check('activity is capped to the table limit (' + a.eval('DB.limits.activity') + ')', act.length === 400, 'rows: ' + act.length);
  const st = await a.eval('DB.stats(Store.s)');
  check('stats() names the engine and the database', st.engine === 'idb' && st.db === 'osr-desk');
  check('stats() counts templates from the DB, not from memory', st.tables.templates === a.eval('Store.s.templates.length'), JSON.stringify(st.tables));
  check('stats() counts the activity rows in the DB (not in memory)', st.tables.activity === 400, 'got ' + st.tables.activity);
  check('stats() exposes the window id for multi-window debugging', /^dev_/.test(st.device || ''));
  const rows5 = await a.eval(`OSRDB.sql("SELECT title, usage FROM templates ORDER BY usage DESC LIMIT 5")`);
  check('OSRDB.sql sorts and limits', rows5.length === 5 && 'title' in rows5[0] && !('body' in rows5[0]), JSON.stringify(rows5[0] || {}).slice(0, 80));
  check('OSRDB.sql orders descending correctly', rows5[0].usage >= rows5[4].usage);
  a.eval(`Store.edit(st => { st.templates.slice(0, 3).forEach((t, i) => { t.usage = (i + 1) * 5; }); }, 'data')`);
  await a.flush();
  const liked = await a.eval(`OSRDB.sql("SELECT title FROM templates WHERE favorite = 1")`);
  check('OSRDB.sql filters on a boolean column', liked.length > 0 && liked.length < a.eval('Store.s.templates.length'), 'got ' + liked.length);
  const used = await a.eval(`OSRDB.sql("SELECT title, usage FROM templates WHERE usage > 9 ORDER BY usage ASC")`);
  check('OSRDB.sql numeric comparison + ordering', used.length === 2 && used[0].usage === 10 && used[1].usage === 15, JSON.stringify(used).slice(0, 120));
  const one = await a.eval(`OSRDB.sql("SELECT title FROM templates WHERE title LIKE 'Refund' LIMIT 1")`);
  check('OSRDB.sql LIKE LIMIT returns at most one row', one.length <= 1);
  let threw = false;
  try { await a.eval(`OSRDB.sql("UPDATE templates SET title = 'x'")`); } catch (e) { threw = true; }
  check('OSRDB.sql refuses to write', threw);
  threw = false;
  try { await a.eval(`OSRDB.sql("DELETE FROM templates")`); } catch (e) { threw = true; }
  check('OSRDB.sql refuses DELETE', threw);
  threw = false;
  try { await a.eval(`OSRDB.sql("SELECT * FROM nosuchtable")`); } catch (e) { threw = true; }
  check('OSRDB.sql rejects an unknown table', threw);
  check('OSRDB.dump(table) returns rows', (await a.eval(`OSRDB.dump('phrases')`)).length >= SEED.phrases);
  a.close();
}

console.log('\n[9] wipe clears every table, not just memory');
{
  const a = await boot();
  await a.eval(`(async () => { await Store.Vault.put('f_w', new Blob(['bye'], {type:'text/plain'})); Store.edit(st => { st.files.unshift({ id:'f_w', name:'bye.txt', kind:'file', mime:'text/plain', size:3, at: nowISO(), stored:'idb' }); }, 'data'); await Store.flush(); })()`);
  check('before: template rows exist', (await a.rows('templates')).length >= SEED.templates);
  check('before: the blob row exists', (await a.blobKeys()).includes('f_w'));
  await a.eval('Store.resetAll()');
  await wait(150);
  check('after: templates table emptied', (await a.rows('templates')).length === 0, 'still ' + (await a.rows('templates')).length);
  check('after: blobs table emptied', ((await a.blobKeys()) || []).length === 0);
  check('after: memory is a blank workspace', a.eval('Store.s.templates.length') === 0 && a.eval('Store.s.onboarded') === false);
  check('after: the localStorage mirror marker is gone', !a.ls(LS_KEY + '.mirror'));
  a.eval(`Store.edit(st => { st.templates.push({ id:'t_new', title:'after wipe', body:'x', category:'', tags:[], usage:0, fileIds:[], custom:true, createdAt: nowISO(), updatedAt: nowISO(), order:0 }); }, 'data')`);
  await a.flush();
  check('and the desk still saves afterwards', (await a.rows('templates')).some((r) => r.id === 't_new'));
  a.close();
}

console.log('\n[10] when IndexedDB is not offered, the desk degrades and still saves');
{
  const a = await boot({ idb: 'none' });
  check('engine falls back to kv', a.engine() === 'kv', 'got ' + a.engine());
  check('the app still booted and seeded', a.eval('Store.s.templates.length') === SEED.templates, 'got ' + a.eval('Store.s.templates.length'));
  check('it says why (no IndexedDB here)', /no IndexedDB|blocked|unavailable/i.test(a.eval('DB.lastError') || ''), a.eval('DB.lastError'));
  a.eval(`Store.edit(st => { st.templates[0].title = 'Saved without a database'; }, 'data')`);
  await a.flush();
  const blob = a.ls(LS_KEY);
  check('the whole workspace went into the localStorage blob', !!blob && JSON.parse(blob).templates[0].title === 'Saved without a database');
  check('verify() explains that there is no database to check', (await a.eval('DB.verify(Store.s)')).problems.some((p) => /localStorage|mirror/i.test(p)));
  const f = await a.eval(`Store.Vault.put('f_kv', new Blob(['in a data url'], {type:'text/plain'})).then(r => r.kind)`);
  check('files fall back to a data URL in localStorage', f === 'kv', 'got ' + f);
  check('and read back through the same door', (await a.eval(`Store.Vault.get('f_kv').then(b => b ? readBlobText(b) : null)`)) === 'in a data url');
  check('the mirror marker is NOT used as a source of truth', a.ls(LS_KEY + '.mirror') === null);
  a.close();
}

console.log('\n[11] a browser that throws on storage access is survived');
{
  const a = await boot({ idb: 'throw' });
  check('boot did not die on the throwing getter', a.ready);
  check('engine is kv', a.engine() === 'kv');
  check('it still built a library', a.eval('Store.s.templates.length') === SEED.templates, 'got ' + a.eval('Store.s.templates.length'));
  a.eval(`Store.edit(st => { st.templates[0].title = 'no storage at all'; }, 'data')`);
  await a.flush();
  check('and the edit is kept in memory', a.eval('Store.s.templates[0].title') === 'no storage at all');
  check('no uncaught errors from the fallback', a.errors.length === 0, JSON.stringify(a.errors).slice(0, 240));
  a.close();
}

console.log('\n[12] a database that fails mid-session does not lose the edit');
{
  const a = await boot();
  check('starts on the database', a.mode() === 'idb');
  /* make IDB itself refuse one write — the same shape of failure as a full quota */
  const origPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (value && value.__poison) throw new Error('QuotaExceededError (simulated)');
    return origPut.call(this, value, key);
  };
  a.eval(`Store.edit(st => { st.templates[0].title = 'The edit that must survive'; st.templates[0].__poison = true; }, 'data')`);
  await a.flush();
  IDBObjectStore.prototype.put = origPut;
  check('it dropped to the localStorage mode instead of throwing', a.mode() === 'kv', 'mode: ' + a.mode());
  check('the edit was written to the fallback', JSON.parse(a.ls(LS_KEY) || '{}').templates?.[0]?.title === 'The edit that must survive');
  check('you are told, in words, what happened', /refused|saved/i.test(a.toastText()), a.toastText().slice(0, 140));
  check('the failure was not swallowed silently (lastError set)', !!a.eval('DB.lastError'));
  check('and the workspace is intact in memory', a.eval('Store.s.templates.length') === SEED.templates && a.eval('Store.s.phrases.length') === SEED.phrases);
  a.eval(`Store.edit(st => { delete st.templates[0].__poison; st.templates[1].title = 'a normal edit afterwards'; }, 'data')`);
  await a.flush();
  check('later edits keep saving in the fallback mode', JSON.parse(a.ls(LS_KEY) || '{}').templates?.[1]?.title === 'a normal edit afterwards');
  a.close();
}

console.log('\n[13] the old blob-only database is absorbed, not lost');
{
  const factory = new IDBFactory();
  // a desk from the previous version wrote blobs into osr-desk-files/blobs
  await new Promise((res) => {
    const r = factory.open('osr-desk-files', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('blobs')) r.result.createObjectStore('blobs'); };
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction('blobs', 'readwrite');
      t.objectStore('blobs').put('the price list', 'f_old');
      t.objectStore('blobs').put('the escalation form', 'f_old2');
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = () => res();
    };
    r.onerror = () => res();
  });
  const a = await boot({ factory });
  const moved = await a.until(`DB.blobIds().then(ids => (ids || []).includes('f_old'))`, 4000);
  check('both old blobs moved into osr-desk/blobs at boot', moved && (await a.blobKeys()).includes('f_old2'), JSON.stringify(await a.blobKeys()));
  check('they read back through the new table', (await a.eval(`DB.blobGet('f_old').then(b => b ? readBlobText(b) : null)`)) === 'the price list');
  const names = await factory.databases().then((l) => l.map((x) => x.name));
  check('the old database is deleted once the move succeeded', !names.includes('osr-desk-files'), JSON.stringify(names));
  check('absorbing again is a no-op (no duplicate rows)', (await a.eval('DB.absorbLegacyVault()')) === 0);
  a.close();
}

console.log('\n[14] durability: the last write lands before the tab closes');
{
  const factory = new IDBFactory();
  const a = await boot({ factory });
  const dev = a.eval('DB.deviceId');
  a.eval(`Store.edit(st => { st.templates[0].title = 'written just before closing'; }, 'data')`);
  await a.eval('Store.flush()');            // what beforeunload / visibilitychange calls
  a.close();
  const b = await boot({ factory });
  check('after a reload the last edit is in the database', b.eval('Store.s.templates[0].title') === 'written just before closing');
  const saved = (await b.rows('meta')).find((m) => m.key === 'saved');
  check('the write is stamped with the window that made it', saved.device === dev && !!saved.at, JSON.stringify(saved).slice(0, 120));
  b.close();
}

console.log('\n[15] nothing leaves the machine');
{
  const a = await boot();
  const dbSrc = fs.readFileSync('src/js/db.js', 'utf8');
  check('db.js makes no network call', !/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.serviceWorker|import\s*\(/.test(dbSrc));
  check('store.js makes no network call', !/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(fs.readFileSync('src/js/store.js', 'utf8')));
  check('the bundle has no remote URL to call', !/(fetch|open)\s*\(\s*['"`]https?:/.test(html));
  // the opt-in mirror must stay one file, and must stay a door rather than a wall
  const files = fs.readdirSync('src/js').filter((f) => f.endsWith('.js'));
  const reaching = files.flatMap((f) => (fs.readFileSync('src/js/' + f, 'utf8').match(/\bfetch\s*\(\s*[^'")\s][^)]{0,60}/g) || [])
    .filter((c) => !(f === 'sync.js' || /^fetch\(fd\[/.test(c)))
    .map((c) => f + ': ' + c.trim().slice(0, 50)));
  check('only sync.js can reach a network address (a local data URL is fine)', reaching.length === 0, JSON.stringify(reaching));
  const syncSrc = fs.readFileSync('src/js/sync.js', 'utf8');
  check('sync.js has no vendor host written into it', !/supabase\.(co|in|net)|postgres\.|\.(herokuapp|firebaseio)\.(com|app)/i.test(syncSrc));
  check('sync.js goes through the store, never past it into the database', !/\bDB\.(read|readAll|writeAll|flushState|tx|open|put|delete)\b/.test(syncSrc) && /Store\.edit\(/.test(syncSrc) && /Store\.flush\(/.test(syncSrc));
  check('db.js does not know sync exists', !/OSRSync|\bsupabase\b|desk_document/i.test(dbSrc));
  check('the mirror refuses to run before it is configured', /if \(!enabled\(\)\) throw new Error\('not configured'\)/.test(syncSrc) && /if \(!enabled\(\)\) \{ lastError = 'not configured'; return false; \}/.test(syncSrc));
  check('no analytics / telemetry identifiers in the bundle', !/gtag|google-analytics|posthog|sentry|mixpanel/i.test(html));
  check('the only allowed storage APIs are IDB + localStorage', !/document\.cookie|sessionStorage|caches\.open/.test(dbSrc));
  const diag = JSON.parse(await a.eval('OSRDB.diagnostics()'));
  check('diagnostics are about this machine only', diag.origin === 'https://local.test' && !/token|password|secret/i.test(JSON.stringify(diag)));
  check('diagnostics carry the counts a support human needs', typeof diag.counts.templates === 'number' && typeof diag.counts.storedFiles === 'number' && !!diag.engine);
  check('diagnostics name the engine so "which build is this" is answerable', diag.db === 'osr-desk' && diag.stateSchema === 3);
  check('the copy button uses the clipboard, not the network', (await a.eval('OSRDB.copyDiagnostics()')).match(/copied|logged/) !== null);
  a.close();
}

console.log('\n[16] Settings shows the database, and the buttons act on it');
{
  const a = await boot();
  const click = async (sel) => { const el = a.d.querySelector(sel); if (el) { el.dispatchEvent(new a.w.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(120); } return !!el; };
  check('the rail says where it is saved', a.d.getElementById('save-state').textContent.includes('local database'), a.d.getElementById('save-state').textContent);
  check('the rail tooltip names the database', /osr-desk/.test(a.d.getElementById('save-state').title), a.d.getElementById('save-state').title);
  a.eval(`view.tab = 'settings'; render()`);
  await wait(60);
  check('the settings tab has a "Where your data lives" card', !!a.d.querySelector('[data-act=\"db-verify\"]'));
  const filled = await a.until(`document.getElementById('db-summary') && /IndexedDB/.test(document.getElementById('db-summary').textContent)`, 3000);
  check('the card fills in with the engine', filled, a.d.getElementById('db-summary')?.textContent);
  check('it lists the row counts', /\d+ templates/.test(a.d.getElementById('db-tables').textContent), a.d.getElementById('db-tables').textContent.slice(0, 120));
  check('and when the last write happened', /just now|\d+[mhd] ago/.test(a.d.getElementById('db-last').textContent) && /window \w{4}/.test(a.d.getElementById('db-last').textContent), a.d.getElementById('db-last').textContent);
  check('storage estimate line is present', !!a.d.getElementById('storage-used'));
  await click('[data-act=\"db-verify\"]');
  check('Verify says it is clean', /Database checked|found/i.test(a.toastText()), a.toastText().slice(0, 120));
  await click('[data-act=\"db-repair\"]');
  check('Rewrite every row reports how many', /Rewrote \d+ row/.test(a.toastText()), a.toastText().slice(0, 120));
  await click('[data-act=\"db-diagnostics\"]');
  check('Copy diagnostics puts JSON on the clipboard', /\"engine\":\"idb\"|"engine": "idb"/.test(String(a.w.__clip)), String(a.w.__clip).slice(0, 80));
  await click('[data-act=\"db-console\"]');
  check('the console hint names real commands', /OSRDB/.test(a.toastText()), a.toastText().slice(0, 100));
  check('no old-copy button when there is nothing to clean', !a.d.querySelector('[data-act=\"db-clear-legacy\"]'));
  a.close();
}

console.log('\n[17] and in fallback mode Settings says so honestly');
{
  const a = await boot({ idb: 'none' });
  a.eval(`view.tab = 'settings'; render()`);
  await a.until(`document.getElementById('db-summary') && /localStorage/.test(document.getElementById('db-summary').textContent)`, 3000);
  check('the card says localStorage fallback', /localStorage/.test(a.d.getElementById('db-summary').textContent), a.d.getElementById('db-summary').textContent);
  check('the rail is honest about where it is saving', !/local database/.test(a.d.getElementById('save-state').textContent));
  check('counts still show up (from memory, since there is no DB)', /templates/.test(a.d.getElementById('db-tables').textContent), a.d.getElementById('db-tables').textContent.slice(0, 100));
  a.close();
}

await wait(80);
console.log('\n────────  ' + pass + ' passed, ' + fail + ' failed  ────────\n');
if (fail) process.exit(1);
