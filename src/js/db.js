/* =========================================================
   db.js — the local database.

   Everything the desk knows lives here: one IndexedDB per origin,
   split into real tables (templates, phrases, files, cases, …) with
   indexes, instead of one giant JSON string in localStorage.

   Why: localStorage gives a browser ~5 MB for ONE value, and the old
   design re-serialised the whole workspace on every keystroke. A pasted
   screenshot over ~1 MB could blow the quota and the library would then
   silently stop saving. IndexedDB gives hundreds of MB, per-record
   writes, indexed lookups, and real blob storage — with no server, no
   account, no dependencies, and no network.

   The rules this file must never break:
     · works from file:// AND http://
     · if IndexedDB is missing / blocked / full / locked by another tab,
       we degrade to store.js's localStorage path — the app must still
       boot, still save, and say so
     · a failed write must never lose the in-memory workspace
   ========================================================= */

const DB_NAME = 'osr-desk';
const DB_VERSION = 1;                        // bump to change the tables
const STATE_SCHEMA = 3;                      // shape of the records themselves
const LEGACY_VAULT_DB = 'osr-desk-files';    // the old blob-only database, absorbed on first run
const LS_KEY = 'osr.desk.state.v' + STATE_SCHEMA;
const LS_MIRROR = LS_KEY + '.mirror';

/**
 * Table map. `key` is the IDB keyPath, `idx` are secondary indexes.
 * A collection in the state object maps 1:1 to a table, so what you see in
 * DevTools (`await OSRDB.dump('templates')`) is literally the rows.
 */
const TABLES = {
  meta:       { key: 'key', idx: [] },
  settings:   { key: 'key', idx: [] },
  vars:       { key: 'key', idx: [] },
  categories: { key: 'id',  idx: [['order', 'number'], ['name', 'string']] },
  templates:  { key: 'id',  idx: [['category', 'string'], ['favorite', 'string'], ['usage', 'number'],
                                  ['updatedAt', 'string'], ['title', 'string'], ['tags', 'string', true]] },
  phrases:    { key: 'id',  idx: [['usage', 'number'], ['favorite', 'string']] },
  cases:      { key: 'id',  idx: [['status', 'string'], ['updatedAt', 'string']] },
  files:      { key: 'id',  idx: [['name', 'string'], ['kind', 'string'], ['at', 'string']] },
  activity:   { key: 'id',  idx: [['at', 'string'], ['kind', 'string'], ['ref', 'string']] },
  trash:      { key: 'id',  idx: [['at', 'string']] },
  blobs:      { key: 'id',  idx: [['mime', 'string'], ['at', 'string']] }
};

/** rows we keep per table — the DB can afford more history than the 5 MB blob could */
const LIMITS = { activity: 400, trash: 40 };

const ROW_TABLES = ['settings', 'vars', 'categories', 'templates', 'phrases', 'cases', 'files', 'activity', 'trash'];

const DB = (() => {
  let dbp = null;
  let db = null;
  let broken = false;
  let lastErr = '';
  let channel = null;
  const deviceId = 'dev_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  /* last-written JSON per table+id, so a flush only touches rows that changed */
  let written = Object.create(null);

  const ok = () => !broken && !!db;

  function giveUp(why) {
    broken = true;
    lastErr = String((why && why.message) || why || 'unknown');
    if (typeof console !== 'undefined' && console.warn) console.warn('[osr-db] using the localStorage fallback —', lastErr);
    return null;
  }

  function canTry() {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB || typeof indexedDB.open !== 'function') return false;
      void indexedDB.open;      // some hardened browsers throw on the getter
      return true;
    } catch (e) { return false; }
  }

  function open() {
    if (broken) return Promise.resolve(null);
    if (dbp) return dbp;
    if (!canTry()) return Promise.resolve(giveUp('this browser has no IndexedDB'));

    dbp = new Promise((res) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; res(v); };
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { finish(giveUp(e)); return; }

      // another window on an older version can block an upgrade forever
      const guard = setTimeout(() => finish(giveUp('opening the database timed out (another window holds it open)')), 6000);

      req.onupgradeneeded = (ev) => {
        try {
          const d = req.result;
          const txr = req.transaction;
          for (const [name, spec] of Object.entries(TABLES)) {
            const store = d.objectStoreNames.contains(name) ? txr.objectStore(name) : d.createObjectStore(name, { keyPath: spec.key });
            for (const [field, , multi] of spec.idx) {
              const iname = 'by_' + field;
              if (!store.indexNames.contains(iname)) store.createIndex(iname, field, { unique: false, multiEntry: !!multi });
            }
          }
          txr.objectStore('meta').put({
            key: 'app', dbVersion: DB_VERSION, stateSchema: STATE_SCHEMA,
            createdAt: new Date().toISOString(), upgradedAt: new Date().toISOString()
          });
        } catch (e) { clearTimeout(guard); finish(giveUp(e)); }
      };
      req.onsuccess = () => {
        clearTimeout(guard);
        db = req.result;
        try { db.onversionchange = () => { try { db.close(); } catch (e) {} db = null; broken = true; }; } catch (e) {}
        try { db.onclose = () => { if (!broken) { db = null; giveUp('the database connection closed'); } }; } catch (e) {}
        finish(db);
      };
      req.onerror = () => { clearTimeout(guard); finish(giveUp(req.error || new Error('open failed'))); };
      req.onblocked = () => { clearTimeout(guard); finish(giveUp('blocked by another window that has the desk open')); };
    });
    return dbp;
  }

  /* ---------- transaction helpers ---------- */

  /** one transaction; `fn(getStore)` queues work, the promise settles on complete */
  function tx(names, mode, fn) {
    if (!ok()) return Promise.reject(new Error('no-db'));
    return new Promise((res, rej) => {
      let t;
      try { t = db.transaction(names, mode); } catch (e) { rej(e); return; }
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error || new Error('database error'));
      t.onabort = () => rej(t.error || new Error('write aborted (storage full?)'));
      try { fn((name) => t.objectStore(name)); }
      catch (e) { try { t.abort(); } catch (e2) {} rej(e); }
    });
  }

  /** read helper that also works when the tx helper's fire-and-forget would not */
  function readRows(name, want) {
    if (!ok()) return Promise.resolve(null);
    return new Promise((res) => {
      try {
        const t = db.transaction(name, 'readonly');
        const store = t.objectStore(name);
        const r = want === 'keys' ? store.getAllKeys() : store.getAll();
        r.onsuccess = () => res(r.result == null ? [] : r.result);
        r.onerror = () => res(null);
        t.onabort = () => res(null);
      } catch (e) { res(null); }
    });
  }

  function readRow(storeName, key) {
    if (!ok()) return Promise.resolve(null);
    return new Promise((res) => {
      try {
        const t = db.transaction(storeName, 'readonly');
        const r = t.objectStore(storeName).get(key);
        r.onsuccess = () => res(r.result == null ? null : r.result);
        r.onerror = () => res(null);
        t.onabort = () => res(null);
      } catch (e) { res(null); }
    });
  }

  /* ---------- reading the workspace ---------- */

  /** every table except blobs, in one readonly transaction */
  function readAll() {
    if (!ok()) return Promise.reject(new Error('no-db'));
    const out = { meta: [] };
    for (const n of ROW_TABLES) out[n] = [];
    return tx(['meta'].concat(ROW_TABLES), 'readonly', (s) => {
      const collect = (name, store) => {
        const r = store.getAll();
        r.onsuccess = () => { out[name] = r.result || []; };
      };
      collect('meta', s('meta'));
      for (const name of ROW_TABLES) collect(name, s(name));
    }).then(() => out, () => Promise.reject(new Error('read failed')));
  }

  function countAll() {
    if (!ok()) return Promise.resolve(null);
    const out = {};
    const names = Object.keys(TABLES);
    return tx(names, 'readonly', (s) => {
      for (const name of names) {
        const r = s(name).count();
        r.onsuccess = () => { out[name] = r.result; };
      }
    }).then(() => out, () => null);
  }

  /* ---------- writing ---------- */

  /** the state object → rows for one table */
  function rowsFor(name, state) {
    switch (name) {
      case 'settings': return state.settings ? [Object.assign({ key: 'settings' }, state.settings)] : [];
      case 'vars': return Object.keys(state.vars || {}).map((k) => ({ key: k, value: state.vars[k] }));
      case 'categories': return (state.categories || []).map((c, i) => Object.assign({}, c, { order: Number.isFinite(c.order) ? c.order : i }));
      case 'activity': return (state.activity || []).slice(0, LIMITS.activity);
      case 'trash': return (state.trash || []).slice(0, LIMITS.trash);
      default: return state[name] || [];
    }
  }

  const hash = (row) => { try { return JSON.stringify(row); } catch (e) { return String(row); } };

  /**
   * Diff the in-memory workspace against what we last wrote, and only touch
   * rows that changed. Editing one template rewrites one row — not the whole
   * library. Resolves { touched, bytes }; rejects if the transaction failed
   * (the caller then keeps the in-memory state and retries on the next save).
   */
  function flushState(state) {
    if (!ok()) return Promise.reject(new Error('no-db'));
    const jobs = [];
    const nextWritten = Object.create(null);
    for (const name of ROW_TABLES) {
      const keyPath = TABLES[name].key;
      const want = rowsFor(name, state);
      const prev = written[name] || {};
      const seen = Object.create(null);
      const next = Object.create(null);
      const puts = [];
      for (const row of want) {
        const id = row[keyPath];
        seen[id] = 1;
        const json = hash(row);
        next[id] = json;
        if (prev[id] === json) continue;
        puts.push(row);
      }
      const dels = Object.keys(prev).filter((id) => !seen[id]);
      if (puts.length || dels.length) jobs.push({ name, puts, dels });
      nextWritten[name] = next;
    }
    if (!jobs.length) return Promise.resolve({ engine: 'idb', touched: 0, bytes: 0 });

    let touched = 0, bytes = 0;
    const p = tx(['meta'].concat(ROW_TABLES), 'readwrite', (s) => {
      for (const job of jobs) {
        const store = s(job.name);
        for (const row of job.puts) { touched++; bytes += hash(row).length; store.put(row); }
        for (const id of job.dels) { touched++; store.delete(id); }
      }
      s('meta').put({ key: 'saved', at: new Date().toISOString(), device: deviceId, touched, bytes });
    });
    // publish the new snapshot only once the write has actually landed
    return p.then(
      () => { written = nextWritten; return { engine: 'idb', touched, bytes }; },
      (err) => { throw err; }
    );
  }

  /** rewrite every row, ignoring the diff cache — first save, import, repair */
  function writeAll(state) {
    if (!ok()) return Promise.reject(new Error('no-db'));
    const rows = {};
    for (const name of ROW_TABLES) rows[name] = rowsFor(name, state);
    let n = 0;
    return tx(['meta'].concat(ROW_TABLES), 'readwrite', (s) => {
      for (const name of ROW_TABLES) {
        const store = s(name);
        store.clear();
        for (const row of rows[name]) { n++; store.put(row); }
      }
      s('meta').put({ key: 'saved', at: new Date().toISOString(), device: deviceId, touched: n, bytes: 0 });
    }).then(() => {
      const next = Object.create(null);
      for (const name of ROW_TABLES) {
        const per = Object.create(null);
        for (const row of rows[name]) per[row[TABLES[name].key]] = hash(row);
        next[name] = per;
      }
      written = next;
      return { engine: 'idb', rows: n };
    });
  }

  /* ---------- single-row helpers (delete / undo / import) ---------- */
  function put(name, row) {
    if (!ok()) return Promise.reject(new Error('no-db'));
    return tx([name], 'readwrite', (s) => { s(name).put(row); }).then(() => {
      const per = written[name] || (written[name] = Object.create(null));
      per[row[TABLES[name].key]] = hash(row);
    });
  }
  function remove(name, id) {
    if (!ok()) return Promise.reject(new Error('no-db'));
    return tx([name], 'readwrite', (s) => { s(name).delete(id); }).then(() => {
      if (written[name]) delete written[name][id];
    });
  }
  function clear(name) {
    if (!ok()) return Promise.reject(new Error('no-db'));
    return tx([name], 'readwrite', (s) => { s(name).clear(); }).then(() => {
      if (written[name]) written[name] = Object.create(null);
    });
  }

  /* ---------- meta ---------- */
  function setMeta(key, value) {
    if (!ok()) return Promise.resolve(false);
    return tx(['meta'], 'readwrite', (s) => { s('meta').put(Object.assign({ key }, value || {})); }).then(() => true, () => false);
  }
  function getMeta(key) { return readRow('meta', key); }

  /* ---------- the blob table: files, screenshots, attachments ---------- */

  /*
   * Blobs are stored as { id, name, mime, size, at, bytes } where `bytes` is an
   * ArrayBuffer. ArrayBuffers clone cleanly through IDB everywhere (Blobs do not
   * in every webview), and the size is on the row so stats don't need the bytes.
   */
  async function blobPut(fileId, blob, meta) {
    if (!ok()) throw new Error('no-db');
    const bytes = await toBytes(blob);
    const size = bytes.byteLength;
    const row = Object.assign({
      id: fileId,
      name: (blob && blob.name) || (meta && meta.name) || '',
      mime: (blob && blob.type) || (meta && meta.mime) || 'application/octet-stream',
      size,
      at: new Date().toISOString()
    }, meta && meta.thumbOf ? { thumbOf: meta.thumbOf } : null, { bytes });
    await tx(['blobs'], 'readwrite', (s) => { s('blobs').put(row); });
    return { stored: 'idb', size };
  }

  async function blobGet(fileId) {
    const row = await readRow('blobs', fileId);
    if (!row) return null;
    return fromBytes(row.bytes, row.mime);
  }

  /** the row itself (no bytes) — for stats and verification */
  function blobRow(fileId) {
    return readRow('blobs', fileId).then((row) => {
      if (!row) return null;
      const { bytes, ...rest } = row;
      return rest;
    });
  }

  function blobDel(fileId) {
    if (!ok()) return Promise.resolve(false);
    return tx(['blobs'], 'readwrite', (s) => { s('blobs').delete(fileId); }).then(() => true, () => false);
  }

  function blobIds() { return readRows('blobs', 'keys'); }

  async function blobBytesFor(fileId) {
    const row = await readRow('blobs', fileId);
    return row ? row.bytes : null;
  }

  function toBytes(blob) {
    if (blob == null) return Promise.resolve(new Uint8Array(0).buffer);
    if (typeof blob === 'string') return Promise.resolve(new TextEncoder().encode(blob).buffer);
    if (typeof ArrayBuffer !== 'undefined' && blob instanceof ArrayBuffer) return Promise.resolve(blob);
    if (typeof Uint8Array !== 'undefined' && blob instanceof Uint8Array) return Promise.resolve(blob.buffer);
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((b) => b, () => readAsDataURLBytes(blob));
    return readAsDataURLBytes(blob);
  }
  function readAsDataURLBytes(blob) {
    return new Promise((res) => {
      try {
        const fr = new FileReader();
        fr.onload = () => {
          const s = String(fr.result || '');
          const i = s.indexOf(',');
          try { res(base64ToBytes(i >= 0 ? s.slice(i + 1) : s)); } catch (e) { res(new Uint8Array(0).buffer); }
        };
        fr.onerror = () => res(new Uint8Array(0).buffer);
        fr.readAsDataURL(blob);
      } catch (e) { res(new Uint8Array(0).buffer); }
    });
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  function fromBytes(bytes, mime) {
    if (typeof Blob !== 'undefined') { try { return new Blob([bytes], { type: mime || '' }); } catch (e) {} }
    return bytes;
  }

  /* ---------- absorb the old blob-only database, once ---------- */
  async function absorbLegacyVault() {
    if (!ok()) return 0;
    let moved = 0;
    let old = null;
    try {
      // opening a database that does not exist would CREATE it, so look first
      if (indexedDB.databases) {
        const list = await indexedDB.databases().catch(() => null);
        if (list && !list.some((d) => d.name === LEGACY_VAULT_DB)) return 0;
      }
      old = await new Promise((res) => {
        let r;
        try { r = indexedDB.open(LEGACY_VAULT_DB); } catch (e) { res(null); return; }
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
        r.onblocked = () => res(null);
      });
      if (!old) return 0;
      if (!old.objectStoreNames.contains('blobs')) { old.close(); return 0; }
      // the old vault stored raw Blobs under out-of-line keys, so we need cursors
      const pairs = await new Promise((res) => {
        try {
          const t = old.transaction('blobs', 'readonly');
          const rows = [];
          const cur = t.objectStore('blobs').openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (c) { rows.push({ key: c.key, value: c.value }); c.continue(); } else res(rows);
          };
          cur.onerror = () => res([]);
        } catch (e) { res([]); }
      });
      const have = new Set((await blobIds()) || []);
      const keep = [];
      for (const p of pairs) {
        if (p.key == null || have.has(p.key)) continue;
        try {
          const bytes = await toBytes(p.value);
          keep.push({
            id: p.key, name: '', mime: (p.value && p.value.type) || 'application/octet-stream',
            size: bytes.byteLength, at: new Date().toISOString(), legacy: true, bytes
          });
        } catch (e) { /* skip an unreadable row rather than failing the boot */ }
      }
      if (keep.length) {
        await tx(['blobs'], 'readwrite', (s) => { for (const row of keep) s('blobs').put(row); });
        moved = keep.length;
        old.close();
        try { indexedDB.deleteDatabase(LEGACY_VAULT_DB); } catch (e) {}
      } else old.close();
    } catch (e) {
      try { if (old && old.close) old.close(); } catch (e2) {}
    }
    if (moved) setMeta('absorbed', { at: new Date().toISOString(), blobs: moved });
    return moved;
  }

  /* ---------- two windows, one database ---------- */
  function openChannel(onOther) {
    if (typeof BroadcastChannel === 'undefined') return;
    if (channel) return;
    try {
      channel = new BroadcastChannel('osr-desk');
      channel.onmessage = (ev) => {
        const d = ev && ev.data;
        if (!d || d.device === deviceId) return;
        try { onOther(d); } catch (e) { /* a stale window must not break this one */ }
      };
    } catch (e) { channel = null; }
  }
  function announce(kind, info) {
    if (!channel) return;
    try { channel.postMessage(Object.assign({ device: deviceId, kind, at: Date.now() }, info || {})); } catch (e) {}
  }

  /* ---------- health: the things a human needs to fix this ---------- */

  async function stats(state) {
    const counts = await countAll();
    let est = null;
    try { if (navigator.storage && navigator.storage.estimate) est = await navigator.storage.estimate(); } catch (e) { est = null; }
    const tables = {};
    for (const name of Object.keys(TABLES)) {
      const live = counts && counts[name] != null ? counts[name] : null;
      if (live != null) { tables[name] = live; continue; }
      if (name === 'blobs' || name === 'meta') { tables[name] = null; continue; }
      if (name === 'settings') { tables[name] = state && state.settings ? 1 : 0; continue; }
      if (name === 'vars') { tables[name] = state ? Object.keys(state.vars || {}).length : 0; continue; }
      tables[name] = state && Array.isArray(state[name]) ? state[name].length : 0;
    }
    let mirrorBytes = 0;
    try { mirrorBytes = (localStorage.getItem(LS_MIRROR) || '').length; } catch (e) {}
    return {
      engine: DB.engine,
      available: ok(),
      db: DB_NAME,
      dbVersion: DB_VERSION,
      stateSchema: STATE_SCHEMA,
      device: deviceId,
      error: lastErr || null,
      tables,
      usage: est ? { usage: est.usage || 0, quota: est.quota || 0 } : null,
      lastSavedAt: savedAt(),
      mirrorBytes
    };
  }

  let savedAtCache = null;
  function savedAt() { return savedAtCache; }
  function noteSaved(at) { savedAtCache = at; }

  /** a write failed mid-session: remember why, for Settings + diagnostics */
  function noteWriteError(err) {
    lastErr = 'write refused: ' + String((err && err.message) || err || 'unknown');
    if (typeof console !== 'undefined' && console.warn) console.warn('[osr-db]', lastErr);
    return lastErr;
  }

  /**
   * Verify memory against the database: row counts match, every file that
   * claims to be stored really has bytes, no orphaned blobs, no dangling
   * links. Returns { ok, problems: [] }.
   */
  async function verify(state) {
    const problems = [];
    if (lastErr && ok()) problems.unshift('the last write was refused — ' + lastErr);
    if (!ok()) {
      return { ok: false, engine: DB.engine, problems: ['no database here — the desk is running on the localStorage mirror (' + (lastErr || 'no IndexedDB') + ')'] };
    }
    const counts = await countAll();
    for (const name of ROW_TABLES) {
      if (name === 'settings' || name === 'vars') continue;
      const want = (state[name] || []).length;
      const have = counts ? counts[name] : null;
      if (have != null && have !== want) problems.push(name + ': ' + want + ' in memory vs ' + have + ' in the database');
    }
    const ids = await blobIds();
    const fileRows = (state.files || []).filter((f) => f.kind === 'file' && !f.missing);
    if (ids) {
      const got = new Set(ids);
      for (const f of fileRows) if (!got.has(f.id)) problems.push('“' + f.name + '” has no bytes in the database');
      const used = new Set(fileRows.map((f) => f.id));
      for (const id of got) if (!used.has(id)) problems.push('an orphan blob (' + id + ') is taking space with no file using it');
    }
    const known = new Set((state.files || []).map((f) => f.id));
    for (const t of (state.templates || [])) {
      for (const fid of (t.fileIds || [])) if (!known.has(fid)) problems.push('“' + t.title + '” points at a file that no longer exists');
    }
    for (const c of (state.categories || [])) {
      if (!Number.isFinite(c.order)) problems.push('category “' + c.name + '” has no sort order');
    }
    for (const t of (state.templates || [])) {
      if (!t.category || !(state.categories || []).some((c) => c.id === t.category)) problems.push('“' + t.title + '” has no category');
    }
    return { ok: !problems.length, problems: problems.slice(0, 40), extra: problems.length - 40, engine: DB.engine, counts };
  }

  /** rewrite every row from memory and garbage-collect blobs nothing points at */
  async function repair(state) {
    const before = await countAll();
    const r = await writeAll(state);
    let dropped = 0;
    const ids = await blobIds();
    if (ids) {
      const keep = new Set((state.files || []).filter((f) => f.kind === 'file' || f.thumb).map((f) => f.id));
      const dead = ids.filter((i) => !keep.has(i));
      dropped = dead.length;
      if (dead.length) await tx(['blobs'], 'readwrite', (s) => { dead.forEach((i) => s('blobs').delete(i)); });
    }
    await setMeta('repair', Object.assign({ at: new Date().toISOString(), before }, before ? {} : {}));
    return { engine: DB.engine, rows: r.rows, droppedBlobs: dropped };
  }

  /** the JSON to paste into a chat / issue when the desk is misbehaving */
  function diagnostics(state) {
    const s = state || {};
    let lsBytes = -1, blocked = false;
    try { lsBytes = (localStorage.getItem(LS_KEY) || '').length; } catch (e) { blocked = true; }
    return {
      product: 'OSR Desk',
      at: new Date().toISOString(),
      engine: DB.engine,
      db: DB_NAME,
      dbVersion: DB_VERSION,
      stateSchema: STATE_SCHEMA,
      device: deviceId,
      error: lastErr || null,
      counts: {
        templates: (s.templates || []).length,
        phrases: (s.phrases || []).length,
        categories: (s.categories || []).length,
        files: (s.files || []).length,
        storedFiles: (s.files || []).filter((f) => f.stored).length,
        shortcutFiles: (s.files || []).filter((f) => f.kind === 'shortcut' || f.missing).length,
        cases: (s.cases || []).length,
        openCases: (s.cases || []).filter((c) => c.status !== 'resolved').length,
        activity: (s.activity || []).length,
        vars: Object.keys(s.vars || {}).length,
        trash: (s.trash || []).length
      },
      localStorageBytes: lsBytes,
      storageBlocked: blocked,
      origin: typeof location !== 'undefined' ? (location.origin === 'null' ? 'file://' : location.origin) : 'none',
      ua: typeof navigator !== 'undefined' ? String(navigator.userAgent).slice(0, 160) : ''
    };
  }

  /** seed the diff cache from a freshly hydrated state so boot rewrites nothing */
  function prime(state) {
    if (!state) return;
    const next = Object.create(null);
    for (const name of ROW_TABLES) {
      const per = Object.create(null);
      for (const row of rowsFor(name, state)) per[row[TABLES[name].key]] = hash(row);
      next[name] = per;
    }
    written = next;
  }

  return {
    get engine() { return broken ? 'kv' : (db ? 'idb' : 'opening'); },
    get available() { return ok(); },
    get broken() { return broken; },
    get lastError() { return lastErr; },
    get deviceId() { return deviceId; },
    get name() { return DB_NAME; },
    get key() { return LS_KEY; },
    get mirrorKey() { return LS_MIRROR; },
    get tables() { return TABLES; },
    get rowTables() { return ROW_TABLES; },
    get limits() { return LIMITS; },
    get lastSavedAt() { return savedAt(); },
    open, readAll, countAll, flushState, writeAll, put, remove, clear, prime,
    setMeta, getMeta, noteSaved, noteWriteError,
    blobPut, blobGet, blobDel, blobIds, blobRow, blobBytesFor,
    absorbLegacyVault, openChannel, announce,
    stats, verify, repair, diagnostics,
    /** every table, including blobs — Settings → Wipe uses this */
    async wipeAll() {
      if (!ok()) return false;
      written = Object.create(null);
      const names = Object.keys(TABLES);
      await tx(names, 'readwrite', (s) => { for (const n of names) s(n).clear(); });
      return true;
    }
  };
})();

/**
 * Console + Settings API. It exists so the data can be poked at directly,
 * without DevTools archaeology in an IndexedDB viewer:
 *   await OSRDB.dump('templates')
 *   await OSRDB.stats()
 *   await OSRDB.verify()
 *   await OSRDB.sql("SELECT title, usage FROM templates ORDER BY usage DESC LIMIT 5")
 */
window.OSRDB = {
  get engine() { return DB.engine; },
  tables() { return Object.keys(TABLES); },
  stats() { return DB.stats(typeof Store !== 'undefined' ? Store.s : null); },
  async dump(table) {
    const all = await DB.readAll();
    if (!table) return all;
    if (all[table]) return all[table];
    if (table === 'blobs') return (await DB.countAll()) ? (await DB.blobIds() || []).map((id) => ({ id })) : [];
    throw new Error('no such table: ' + table + ' · tables: ' + Object.keys(all).concat('blobs').join(', '));
  },
  blobs() { return DB.blobIds(); },
  verify() { return DB.verify(Store.s); },
  async repair() { const r = await DB.repair(Store.s); Store.refresh('data'); return r; },
  async diagnostics() { return JSON.stringify(DB.diagnostics(Store.s), null, 2); },
  async copyDiagnostics() {
    const text = await this.diagnostics();
    try { await navigator.clipboard.writeText(text); return 'copied'; }
    catch (e) { console.log(text); return 'logged'; }
  },
  wipe() { return DB.wipeAll(); },
  /** a SQL view over the tables, read-only, for people who think in SQL */
  sql(query) {
    return DB.readAll().then((all) => runSQL(String(query || ''), all));
  }
};

/* ---------- a small SELECT-only SQL subset for OSRDB.sql() ---------- */
function runSQL(q, data) {
  const text = String(q || '').trim().replace(/;+\s*$/, '');
  const m = /^select\s+([\s\S]+?)\s+from\s+(\w+)(?:\s+where\s+([\s\S]+?))?(?:\s+order\s+by\s+(\w+)(\s+(?:asc|desc))?)?(?:\s+limit\s+(\d+))?$/i.exec(text);
  if (!m) throw new Error('only “SELECT cols FROM table [WHERE col op value] [ORDER BY col [desc]] [LIMIT n]” is supported — and it never writes');
  const table = m[2];
  if (!(table in data)) throw new Error('no such table: ' + table + ' · tables: ' + Object.keys(data).concat('blobs').join(', '));
  let out = (data[table] || []).map((r) => Object.assign({}, r));
  const cols = m[1].trim().split(',').map((c) => c.trim()).filter(Boolean);
  const selAll = cols.length === 1 && cols[0] === '*';

  if (m[3]) {
    const c = /^(\w+)\s*(=|!=|<>|>=|<=|>|<|like)\s*([\s\S]+)$/i.exec(m[3].trim());
    if (!c) throw new Error('WHERE takes one comparison, e.g. usage > 3 · favorite = 1 · title LIKE refund');
    const [, field, opRaw, rawVal] = c;
    const op = opRaw.toLowerCase();
    const val = rawVal.trim().replace(/^['"]|['"]$/g, '');
    const num = /^-?\d+(\.\d+)?$/.test(val) ? Number(val) : null;
    out = out.filter((r) => {
      const a = r[field];
      if (op === 'like') return String(a == null ? '' : a).toLowerCase().includes(val.replace(/%/g, '').toLowerCase());
      if (op === '=') return String(a) === String(val) || a === true && /^(1|true)$/i.test(val);
      if (op === '!=' || op === '<>') return String(a) !== String(val);
      if (num == null) return false;
      const x = Number(a);
      if (op === '>') return x > num;
      if (op === '<') return x < num;
      if (op === '>=') return x >= num;
      if (op === '<=') return x <= num;
      return true;
    });
  }
  if (m[4]) {
    const f = m[4], desc = /desc/i.test(m[5] || '');
    out.sort((a, b) => {
      const x = a[f], y = b[f];
      const n = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y));
      return desc ? -n : n;
    });
  }
  if (m[6]) out = out.slice(0, Number(m[6]));
  if (selAll) return out;
  return out.map((r) => { const o = {}; for (const c of cols) o[c] = r[c]; return o; });
}
