/* =========================================================
   sync.js — OPTIONAL, opt-in mirroring of the workspace to
   a Postgres you own (Supabase by default).

   This is the only file in the app that talks to a network.
   Three rules it must never break:

     1. OFF until you configure it. No config → no fetch, no
        timers, no probing, no "phone home on first run".
     2. The local database (db.js) is still the source of truth.
        Sync is a mirror: if the network is down, slow, dead or
        returns garbage, your workspace is unchanged and the
        queue waits for you.
     3. Only text rows go out — templates, phrases, categories,
        cases, remembered {{placeholders}} and settings. Never
        the file shelf, never screenshots, never bytes.
   ========================================================= */

const SYNC_TABLE = 'desk_document';
const SYNC_COLLECTIONS = ['templates', 'phrases', 'categories', 'cases', 'vars', 'settings'];
const SYNC_CFG_KEY = 'osr.desk.sync.config.v1';
const SYNC_SES_KEY = 'osr.desk.sync.session.v1';
const SYNC_SENT_KEY = 'osr.desk.sync.sent.v1';      // what the last push contained
const SYNC_CUR_KEY = 'osr.desk.sync.cursor.v1';     // last pulled updated_at
const SYNC_PAGE = 500;
const SYNC_TIMEOUT = 12000;

const Sync = (() => {
  let cfg = null;           // { url, key }
  let ses = null;           // { token, refresh, uid, expiresAt, email }
  let sent = {};            // collection -> { recordId -> hash }
  let cursor = '';          // updated_at of the newest row we have pulled
  let busy = null;          // 'push' | 'pull' | null
  let lastError = '';
  let lastSyncAt = '';
  let lastPush = null;      // { sent, tombstones }
  let lastPull = null;      // { applied, skipped, removed }
  let timer = null;
  let pushTimer = null;
  let applying = false;

  /* ---------- little storage helpers (KV, not the DB: sync state must
     never feed back into the thing that triggers a sync) ---------- */
  function kvGet(k, fallback) {
    try { const raw = KV.get(k); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function kvSet(k, v) { try { KV.set(k, JSON.stringify(v)); } catch (e) { /* nowhere to remember it */ } }
  function kvDel(k) { try { KV.del(k); } catch (e) { /* ignore */ } }

  function persistCfg() {
    if (cfg) { kvSet(SYNC_CFG_KEY, cfg); return; }
    // forgetting the project means forgetting where we were up to as well
    kvDel(SYNC_CFG_KEY); kvDel(SYNC_CUR_KEY); cursor = '';
  }
  function persistSes() { if (ses) kvSet(SYNC_SES_KEY, ses); else kvDel(SYNC_SES_KEY); }
  function persistSent() { kvSet(SYNC_SENT_KEY, sent); }

  function restore() {
    cfg = kvGet(SYNC_CFG_KEY, null);
    ses = kvGet(SYNC_SES_KEY, null);
    sent = kvGet(SYNC_SENT_KEY, {}) || {};
    cursor = kvGet(SYNC_CUR_KEY, '') || '';
    if (ses && ses.expiresAt && ses.expiresAt - 60_000 < Date.now()) refresh().catch(() => {});
  }

  const base = () => String((cfg && cfg.url) || '').replace(/\/+$/, '');
  const enabled = () => !!(cfg && /^https?:\/\//i.test(base()) && cfg.key);
  const signedIn = () => !!(ses && ses.token);

  /* ---------- transport ---------- */
  function hdrs(extra) {
    const h = { apikey: cfg.key, 'Content-Type': 'application/json', ...extra };
    if (ses && ses.token) h.Authorization = 'Bearer ' + ses.token;
    return h;
  }

  async function req(path, opts = {}) {
    if (!enabled()) throw new Error('not configured');
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const to = setTimeout(() => { try { ctrl && ctrl.abort(); } catch (e) {} }, SYNC_TIMEOUT);
    try {
      const res = await fetch(base() + path, { ...opts, headers: hdrs(opts.headers), signal: ctrl && ctrl.signal });
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        const e = new Error(res.status === 401 ? 'signed out: the server rejected the token' : 'not allowed: row-level security refused that write');
        e.auth = true; e.body = text.slice(0, 300);
        throw e;
      }
      if (!res.ok) {
        const e = new Error('server said ' + res.status + (text ? ': ' + text.slice(0, 200) : ''));
        e.body = text.slice(0, 300);
        throw e;
      }
      if (!text) return null;
      try { return JSON.parse(text); } catch (e) { const err = new Error('the server sent something that was not JSON'); err.body = text.slice(0, 200); throw err; }
    } finally {
      clearTimeout(to);
    }
  }

  /* ---------- auth ---------- */
  async function signIn(email, password) {
    if (!enabled()) { lastError = 'add the project URL and key first'; return false; }
    lastError = '';
    try {
      const r = await fetch(base() + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: cfg.key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: String(email || '').trim(), password: String(password || '') })
      }).then(async (res) => {
        const t = await res.text().catch(() => '');
        if (!res.ok) throw new Error(readableAuthError(res.status, t));
        try { return JSON.parse(t); } catch (e) { throw new Error('the auth endpoint did not return JSON'); }
      });
      ses = {
        token: r.access_token,
        refresh: r.refresh_token || '',
        uid: (r.user && r.user.id) || '',
        email: (r.user && r.user.email) || String(email || '').trim(),
        expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000
      };
      if (!ses.token) throw new Error('no access token came back');
      persistSes();
      await pull().catch(() => {});
      return true;
    } catch (e) {
      lastError = String((e && e.message) || e);
      return false;
    }
  }

  function readableAuthError(status, body) {
    let m = '';
    try { m = (JSON.parse(body || '{}').error_description || JSON.parse(body || '{}').msg || '').toString(); } catch (e) { m = String(body || '').slice(0, 120); }
    if (status === 400 && /invalid login/i.test(m)) return 'wrong email or password';
    if (status === 429) return 'too many attempts — wait a minute and try again';
    return m || ('auth failed (' + status + ')');
  }

  async function refresh() {
    if (!ses || !ses.refresh || !enabled()) return false;
    try {
      const r = await fetch(base() + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: cfg.key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refresh_token: ses.refresh })
      }).then(async (res) => { const t = await res.text(); if (!res.ok) throw new Error(t.slice(0, 120)); return JSON.parse(t); });
      ses = { ...ses, token: r.access_token, refresh: r.refresh_token || ses.refresh, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
      persistSes();
      return true;
    } catch (e) {
      // a dead refresh token is not worth bothering you about mid-typing: sign out quietly
      ses = null; persistSes();
      lastError = 'the saved login expired — sign in again to resume syncing';
      return false;
    }
  }

  function signOut() { ses = null; persistSes(); kvDel(SYNC_SENT_KEY); sent = {}; lastError = ''; }

  /* ---------- what belongs in the mirror ---------- */
  // key order is not a change: stringify sorted, or a merge that reordered the
  // keys would look like a local edit and get pushed straight back at the server
  function hash(v) {
    const canon = (x, depth) => {
      if (depth > 24) return '"…"';
      if (x === undefined || x === null) return 'null';
      if (Array.isArray(x)) return '[' + x.map((y) => canon(y, depth + 1)).join(',') + ']';
      if (typeof x === 'object') {
        const ks = Object.keys(x).sort();
        return '{' + ks.map((k) => JSON.stringify(k) + ':' + canon(x[k], depth + 1)).join(',') + '}';
      }
      return JSON.stringify(x);
    };
    try { return canon(v, 0); } catch (e) { return String(v); }
  }

  function localRows(state) {
    const out = [];
    for (const c of SYNC_COLLECTIONS) {
      if (c === 'settings') { out.push({ collection: c, record_id: 'settings', payload: state.settings || {}, updatedAt: null }); continue; }
      if (c === 'vars') {
        for (const k of Object.keys(state.vars || {})) out.push({ collection: c, record_id: k, payload: { value: state.vars[k] }, updatedAt: null });
        continue;
      }
      for (const r of (state[c] || [])) {
        const payload = { ...r };
        if (c === 'files') continue;                       // belt and braces: never files
        delete payload.thumb; delete payload.snippet;      // previews and text captures stay home
        out.push({ collection: c, record_id: r.id, payload, updatedAt: r.updatedAt || r.at || null });
      }
    }
    return out;
  }

  /** rows the server needs because memory says they changed since the last push */
  function pendingPush(state) {
    const rows = localRows(state);
    const ups = [];
    const seen = {};
    for (const r of rows) {
      const prev = (sent[r.collection] || {})[r.record_id];
      const h = hash(r.payload);
      seen[r.collection + '|' + r.record_id] = 1;
      if (prev === h) continue;
      ups.push({ collection: r.collection, record_id: r.record_id, h, payload: r.payload, deleted: false, updated_at: r.updatedAt || new Date().toISOString() });
    }
    const dels = [];
    for (const c of Object.keys(sent)) {
      for (const id of Object.keys(sent[c] || {})) {
        if (seen[c + '|' + id]) continue;
        dels.push({ collection: c, record_id: id, deleted: true, updated_at: new Date().toISOString() });
      }
    }
    return { ups, dels };
  }

  /* ---------- push ---------- */
  async function push() {
    if (!enabled()) { lastError = 'not configured'; return false; }
    if (!signedIn()) { lastError = 'sign in to sync'; return false; }
    if (busy) return false;
    if (ses.expiresAt - 60_000 < Date.now()) await refresh();
    if (!signedIn()) return false;
    busy = 'push';
    try {
      const state = Store.s;
      const { ups, dels } = pendingPush(state);
      if (!ups.length && !dels.length) { busy = null; return true; }
      const body = ups.concat(dels).map((r) => ({
        owner: ses.uid || undefined,
        collection: r.collection,
        record_id: r.record_id,
        payload: r.deleted ? {} : r.payload,
        deleted: !!r.deleted,
        updated_at: r.updated_at,
        device: DB.deviceId
      }));
      await req('/rest/v1/' + SYNC_TABLE + '?on_conflict=owner,collection,record_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates, return=minimal' },
        body: JSON.stringify(body)
      });
      for (const u of ups) { (sent[u.collection] || (sent[u.collection] = {}))[u.record_id] = u.h; }
      for (const d of dels) { if (sent[d.collection]) delete sent[d.collection][d.record_id]; }
      persistSent();
      lastPush = { sent: ups.length, tombstones: dels.length, at: new Date().toISOString() };
      lastSyncAt = lastPush.at; lastError = '';
      emitStatus();
      return true;
    } catch (e) {
      lastError = String((e && e.message) || e);
      if (e.auth) { ses = null; persistSes(); }
      emitStatus();
      return false;
    } finally {
      busy = null;
    }
  }

  /* ---------- pull ---------- */
  async function pull() {
    if (!enabled() || !signedIn() || busy === 'pull') return false;
    busy = 'pull';
    try {
      if (ses.expiresAt - 60_000 < Date.now()) await refresh();
      const q = ['select=collection,record_id,payload,deleted,updated_at', 'order=updated_at.asc', 'limit=' + SYNC_PAGE];
      if (cursor) q.push('updated_at=gt.' + encodeURIComponent(cursor));
      const rows = await req('/rest/v1/' + SYNC_TABLE + '?' + q.join('&'), { method: 'GET', headers: { Accept: 'application/json' } }) || [];
      let applied = 0, skipped = 0, removed = 0, newest = cursor;
      const patch = { put: {}, del: {}, unsent: [], vars: {}, settings: null };
      for (const r of rows) {
        if (r.updated_at && r.updated_at > newest) newest = r.updated_at;
        if (!SYNC_COLLECTIONS.includes(r.collection)) continue;

        // a delete on another machine: drop the row here, and forget we ever
        // sent it so we don't echo a second tombstone back
        if (r.deleted) {
          if (r.collection === 'settings') { skipped++; continue; }   // never blank out theme/name on a tombstone
          (patch.del[r.collection] || (patch.del[r.collection] = [])).push(r.record_id);
          patch.unsent.push([r.collection, r.record_id]);
          removed++;
          continue;
        }
        if (r.collection === 'settings') {
          patch.settings = r.payload || null;
          (patch.applied || (patch.applied = [])).push(['settings', 'settings']);
          applied++; continue;
        }
        if (r.collection === 'vars') {
          patch.vars[r.record_id] = (r.payload && r.payload.value !== undefined) ? r.payload.value : r.payload;
          (patch.applied || (patch.applied = [])).push(['vars', r.record_id]);
          applied++;
          continue;
        }
        const local = (Store.s[r.collection] || []).find((x) => x.id === r.record_id);
        // last write wins, using the record's own clock. An edit that is still
        // only local (never pushed) must not be overwritten by an older row —
        // and it must stay dirty so it goes back out on the next push.
        if (local && local.updatedAt && r.updated_at && String(local.updatedAt) > String(r.updated_at)) {
          skipped++;
          if (sent[r.collection]) delete sent[r.collection][r.record_id];
          continue;
        }
        (patch.put[r.collection] || (patch.put[r.collection] = [])).push(r.payload);
        (patch.applied || (patch.applied = [])).push([r.collection, r.record_id]);
        applied++;
      }
      if (applied || removed) {
        applying = true;
        Store.edit((st) => {
          for (const c of Object.keys(patch.put)) {
            for (const row of patch.put[c]) {
              if (!row || !row.id) continue;
              if (!Array.isArray(st[c])) continue;
              const i = st[c].findIndex((x) => x.id === row.id);
              if (i >= 0) st[c][i] = { ...st[c][i], ...row }; else st[c].unshift(row);
            }
          }
          for (const c of Object.keys(patch.del)) {
            if (!Array.isArray(st[c])) continue;
            for (const id of patch.del[c]) st[c] = st[c].filter((x) => x.id !== id);
          }
          for (const k of Object.keys(patch.vars)) st.vars[k] = patch.vars[k];
          if (patch.settings) st.settings = { ...st.settings, ...patch.settings };
        }, 'data');
        // remember what the server now holds, so the next push does not echo it straight back
        for (const [c, id] of patch.unsent) { if (sent[c]) delete sent[c][id]; }
        // remember what memory holds *after* the merge, row by row: that is what
        // the next push would send, so it is what "already sent" means now
        const fresh = {};
        for (const r of localRows(Store.s)) fresh[r.collection + '|' + r.record_id] = hash(r.payload);
        for (const [c, id] of (patch.applied || [])) {
          const h = fresh[c + '|' + id];
          if (h === undefined) { if (sent[c]) delete sent[c][id]; continue; }
          (sent[c] || (sent[c] = {}))[id] = h;
        }
        persistSent();
        await Store.flush();
      }
      if (newest && newest !== cursor) { cursor = newest; kvSet(SYNC_CUR_KEY, cursor); }
      lastPull = { applied, skipped, removed, at: new Date().toISOString() };
      lastSyncAt = lastPull.at;
      if (!applied && !removed) { lastError = ''; }
      emitStatus();
      return true;
    } catch (e) {
      lastError = String((e && e.message) || e);
      if (e.auth) { ses = null; persistSes(); }
      emitStatus();
      return false;
    } finally {
      busy = null;
      applying = false;
    }
  }

  async function sync() { const p = await pull(); const q = await push(); return p && q; }

  /** push the whole library, ignoring the diff (after an import, or by button) */
  async function pushAll() {
    sent = {}; persistSent();
    return push();
  }

  function emitStatus() {
    try { if (typeof render === 'function' && !applying && document.querySelector('#sync-status')) render(); } catch (e) { /* a redraw is never important */ }
    try { Bus.emit && Bus.emit('sync'); } catch (e) { /* optional hook */ }
  }

  /** debounce edits into one push a few seconds after you stop typing */
  function queuePush(delay = 4000) {
    if (!enabled() || !signedIn()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { push(false).catch(() => {}); }, delay);
  }

  function startLoop(ms = 60_000) {
    if (!enabled() || !signedIn()) return;
    clearInterval(timer);
    timer = setInterval(() => { if (document.visibilityState !== 'hidden') pull().catch(() => {}); }, ms);
    try {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && enabled() && signedIn()) pull().catch(() => {}); });
    } catch (e) { /* ignore */ }
  }

  function status(state) {
    const st = state || {};
    const { ups, dels } = enabled() && signedIn() ? pendingPush(st) : { ups: [], dels: [] };
    return {
      configured: enabled(),
      signedIn: signedIn(),
      busy,
      pending: ups.length + dels.length,
      cursor: cursor || null,
      lastSyncAt: lastSyncAt || null,
      lastPush, lastPull,
      error: lastError || null,
      url: base() || null,
      email: ses ? ses.email : null,
      pushed: lastPush ? lastPush.sent : 0,
      tombstones: lastPush ? lastPush.tombstones : 0,
      pulled: lastPull ? lastPull.applied : 0,
      dropped: lastPull ? lastPull.removed : 0,
      conflicts: lastPull ? lastPull.skipped : 0,
      collections: SYNC_COLLECTIONS
    };
  }

  return {
    get enabled() { return enabled(); },
    get signedIn() { return signedIn(); },
    get busy() { return busy; },
    get lastError() { return lastError; },
    get applying() { return applying; },
    config: () => (cfg
      ? { url: base(), key: cfg.key ? '••••' + String(cfg.key).slice(-4) : '', email: (ses && ses.email) || '' }
      : null),
    setConfig(url, key) {
      cfg = { url: String(url || '').trim().replace(/\/+$/, ''), key: String(key || '').trim() };
      if (!cfg.url && !cfg.key) cfg = null;
      persistCfg();
      if (!cfg) { ses = null; persistSes(); clearInterval(timer); }
      return enabled();
    },
    restore, signIn, signOut, refresh, push, pull, sync, pushAll, queuePush, startLoop, status,
    pending: (state) => pendingPush(state || Store.s),
    rowsFor: (state) => localRows(state)
  };
})();

window.OSRSync = Sync;
