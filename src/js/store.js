/* =========================================================
   store.js — the in-memory workspace on top of db.js.

   State lives in memory (everything renders from it), and every change is
   written through to the local database as individual rows. If IndexedDB is
   unavailable we keep working on the localStorage mirror instead — older,
   smaller, and noisier about it, but never silent about losing your work.

   No build step, no deps. Works from file:// and http://.
   ========================================================= */

/* STATE_SCHEMA, LS_KEY and LS_MIRROR come from db.js (loaded first) */
const SCHEMA = STATE_SCHEMA;

const uid = (p = 'id') =>
  p + '_' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);

const nowISO = () => new Date().toISOString();

/* ---------- key/value adapter (localStorage, else memory) ---------- */
const KV = (() => {
  let ok = true;
  const mem = new Map();
  try {
    const t = '__osr_probe__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
  } catch (e) {
    ok = false;
  }
  return {
    available: ok,
    get(k) {
      try { return ok ? localStorage.getItem(k) : mem.get(k) ?? null; } catch (e) { return mem.get(k) ?? null; }
    },
    set(k, v) {
      try { if (ok) localStorage.setItem(k, v); else mem.set(k, v); return true; }
      catch (e) {
        mem.set(k, v);
        return false;
      }
    },
    del(k) { try { ok ? localStorage.removeItem(k) : mem.delete(k); } catch (e) { mem.delete(k); } }
  };
})();

/* ---------- the file/blob store: DB.blobs, else data URLs in KV ---------- */
const Vault = (() => {
  return {
    /** 'idb' when bytes live in the database, 'kv' when they are inlined */
    get mode() { return DB.available ? 'idb' : 'kv'; },
    async put(id, blob, meta) {
      if (DB.available) {
        try {
          const res = await DB.blobPut(id, blob, meta);
          return { kind: 'idb', size: res.size };
        } catch (e) { /* full, closed, or refused — fall through to KV */ }
      }
      try {
        const dataUrl = await blobToDataURL(blob);
        const saved = KV.set('osr.file.' + id, dataUrl);
        return { kind: saved ? 'kv' : 'mem', dataUrl };
      } catch (e) { return { kind: 'mem' }; }
    },
    async get(id) {
      if (DB.available) {
        try {
          const blob = await DB.blobGet(id);
          if (blob) return blob;
        } catch (e) { /* fall through to KV */ }
      }
      const dv = KV.get('osr.file.' + id);
      if (!dv) return null;
      return dataURLToBlob(dv);
    },
    async del(id) {
      if (DB.available) { try { await DB.blobDel(id); } catch (e) { /* ignore */ } }
      KV.del('osr.file.' + id);
    },
    async exportOne(id) {
      const b = await this.get(id);
      return b ? await blobToDataURL(b) : null;
    },
    /** how much room is left, when the browser will say */
    async estimate() {
      try {
        if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
      } catch (e) { /* ignore */ }
      return null;
    }
  };
})();

function dataURLToBlob(dataUrl) {
  const s = String(dataUrl || '');
  const i = s.indexOf(',');
  if (i < 0) return null;
  const meta = (s.slice(0, i).slice(5).split(';')[0] || 'application/octet-stream').trim() || 'application/octet-stream';
  try {
    const bin = atob(s.slice(i + 1));
    const out = new Uint8Array(bin.length);
    for (let n = 0; n < bin.length; n++) out[n] = bin.charCodeAt(n);
    return new Blob([out.buffer], { type: meta });
  } catch (e) { return null; }
}


const TEXTISH = /\.(txt|md|markdown|csv|tsv|log|json|jsonl|srt|vtt|html?|xml|ya?ml|ini|conf|rtf|eml|prn)$/i;
function looksTextual(f) {
  return /^text\//.test(f.mime || '') || TEXTISH.test(f.name || '');
}
function readBlobText(blob, limit) {
  const cut = (t) => (limit && t.length > limit ? t.slice(0, limit) : t);
  if (blob && typeof blob.text === 'function') return blob.text().then(cut);
  return new Promise((res, rej) => {
    try {
      const fr = new FileReader();
      fr.onload = () => res(cut(String(fr.result || '')));
      fr.onerror = () => rej(fr.error || new Error('read failed'));
      fr.readAsText(blob);
    } catch (e) { rej(e); }
  });
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

/* ---------- defaults ---------- */
function blankState() {
  return {
    schema: SCHEMA,
    installedAt: nowISO(),
    onboarded: false,
    settings: {
      theme: 'system',
      accent: '#2f6df6',
      density: 'comfortable',
      view: 'grid',
      sort: 'manual',
      yourName: '',
      yourRole: 'Online Support Representative',
      company: '',
      signature: '',
      appendSignature: false,
      plainCopy: true,
      fontSize: 14.5,
      rememberFill: true,
      hideChecklist: false
    },
    vars: {},               // remembered quick-fill values  key -> value
    categories: [],
    templates: [],
    phrases: [],
    files: [],              // metadata only; blob lives in Vault
    cases: [],
    activity: [],           // [{id, at, kind, ref}]
    trash: []               // soft-deleted items for undo
  };
}

/* ---------- store ---------- */
const Store = (() => {
  let state = null;
  const subs = new Set();
  let saveTimer = null;
  let dirty = false;
  let booted = false;

  function emit(kind) {
    subs.forEach((f) => { try { f(kind, state); } catch (e) { console.error(e); } });
  }

  function sanitize(s) {
    const base = blankState();
    if (!s || typeof s !== 'object') return base;
    const out = { ...base, ...s };
    out.settings = { ...base.settings, ...(s.settings || {}) };
    out.vars = s.vars && typeof s.vars === 'object' ? s.vars : {};
    for (const k of ['categories', 'templates', 'phrases', 'files', 'cases', 'activity', 'trash']) {
      if (!Array.isArray(out[k])) out[k] = [];
    }
    out.categories = out.categories.filter((c) => c && c.id && c.name);
    out.templates = out.templates.filter((t) => t && t.id && typeof t.body === 'string');
    out.phrases = out.phrases.filter((p) => p && p.id && p.text);
    out.templates.forEach((t) => {
      t.subject = typeof t.subject === 'string' ? t.subject : '';
      t.custom = !!t.custom; t.noSig = !!t.noSig;
      t.tags = Array.isArray(t.tags) ? t.tags : [];
      t.fileIds = Array.isArray(t.fileIds) ? t.fileIds : [];
      t.usage = Number(t.usage) || 0;
      t.favorite = !!t.favorite;
      t.order = Number.isFinite(t.order) ? t.order : 0;
      if (!t.category || !out.categories.some((c) => c.id === t.category)) t.category = out.categories[0]?.id || '';
    });
    out.phrases.forEach((p) => { p.usage = Number(p.usage) || 0; p.favorite = !!p.favorite; });
    out.files = out.files.filter((f) => f && f.id && f.name);
    out.cases.forEach((c) => { c.status = c.status || 'new'; c.history = Array.isArray(c.history) ? c.history : []; });
    out.schema = SCHEMA;
    return out;
  }

  /* ---------- reading ---------- */

  /** the old way: one JSON blob in localStorage (also our fallback path) */
  function loadFromKV() {
    let s = null;
    const raw = KV.get(LS_KEY);
    if (raw) { try { s = JSON.parse(raw); } catch (e) { s = null; } }
    if (!s || s.schema !== SCHEMA) {
      // migrate from older schema keys if present
      for (const older of ['osr.desk.state.v2', 'osr.desk.state.v1']) {
        const rr = KV.get(older);
        if (rr) { try { const p = JSON.parse(rr); if (p && p.templates) { s = p; break; } } catch (e) {} }
      }
    }
    return s ? sanitize(s) : null;
  }

  /** rows from the database → the shape the app renders from */
  function hydrate(rows) {
    const s = blankState();
    const app = (rows.meta || []).find((m) => m.key === 'app');
    const st = (rows.settings || []).find((r) => r.key === 'settings');
    if (st) {
      s.settings = sanitize({ settings: st }).settings;
      s.onboarded = st.onboarded !== false;
      if (st.installedAt) s.installedAt = st.installedAt;
    }
    for (const r of (rows.vars || [])) s.vars[r.key] = r.value;
    s.categories = (rows.categories || []).slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    s.templates = rows.templates || [];
    s.phrases = rows.phrases || [];
    s.files = rows.files || [];        // each row already carries `stored` + `size`
    s.cases = rows.cases || [];
    s.activity = rows.activity || [];
    s.trash = rows.trash || [];
    if (app && app.createdAt) s.installedAt = app.createdAt;
    return sanitize(s);
  }

  function isEmpty(s) {
    return !(s && (s.templates.length || s.phrases.length || s.categories.length || s.cases.length || Object.keys(s.vars).length));
  }

  /**
   * Boot-time load. Prefers the database, migrates a localStorage workspace
   * into it once, and falls back to the blob if the DB can't be opened.
   */
  async function init() {
    if (booted) return state;
    booted = true;
    await DB.open();
    if (DB.available) {
      let rows = null;
      try { rows = await DB.readAll(); } catch (e) { rows = null; }
      const fromDb = rows ? hydrate(rows) : null;
      if (fromDb && !isEmpty(fromDb)) {
        state = fromDb;
        mode = 'idb';
        DB.prime(state);
        DB.absorbLegacyVault().then((moved) => { if (moved) emit('data'); }).catch(() => {});
        return state;
      }
      // fresh (or just-migrated) database: take whatever the old blob has
      const old = loadFromKV();
      const hasOld = !!old && !isEmpty(old);
      state = hasOld ? old : blankState();
      if (!hasOld) state.__fresh = true;
      mode = 'idb';
      try {
        await DB.writeAll(state);
        await DB.setMeta('app', { dbVersion: DB_VERSION, stateSchema: SCHEMA, createdAt: state.installedAt, migratedFrom: hasOld ? 'localStorage' : 'seed' });
        if (hasOld) {
          // keep the pre-migration blob where it is: it is the rollback copy
          KV.set(LS_MIRROR, JSON.stringify({ db: true, at: nowISO(), note: 'workspace now lives in IndexedDB; the v3 blob was left as the last pre-migration snapshot' }));
        }
        DB.prime(state);
        DB.absorbLegacyVault().catch(() => {});
      } catch (e) {
        mode = 'kv';     // write-through failed: behave like a browser without IDB
      }
      return state;
    }
    mode = 'kv';
    state = loadFromKV();
    if (!state) { state = blankState(); state.__fresh = true; }
    return state;
  }

  /** kept for the synchronous call sites (tests, reset paths) */
  function load() {
    if (!state) state = loadFromKV() || blankState();
    return state;
  }


  /* ---------- writing ---------- */

  let mode = 'idb';
  let failed = false;

  function mirrorKV() {
    // a tiny marker, not the workspace: the DB holds the truth
    try {
      KV.set(LS_MIRROR, JSON.stringify({ db: true, at: nowISO(), n: { t: state.templates.length, p: state.phrases.length, f: state.files.length } }));
    } catch (e) { /* nothing to do */ }
  }

  function persistKV() {
    let ok = KV.set(LS_KEY, JSON.stringify(state));
    if (!ok) {
      // storage was full: shed the heavy, re-creatable bits before giving up
      try {
        state.files.forEach((f) => { delete f.thumb; if ((f.snippet || '').length > 3000) f.snippet = f.snippet.slice(0, 3000); });
        state.activity = [];
        state.trash = [];
        ok = KV.set(LS_KEY, JSON.stringify(state));
        if (ok) Bus.toast('Browser storage was full — image previews were dropped to keep your text. Export a backup and clear some files off the shelf.', 'warn', 11000);
      } catch (e) { /* nothing more to try */ }
    }
    if (!ok) { failed = true; Bus.toast('Could not save to this browser. Export a backup (Settings → Export) before you close the tab.', 'bad', 14000); }
    else failed = false;
    return ok;
  }

  /** write the workspace through to wherever it belongs; resolves when durable */
  async function persist() {
    dirty = false;
    if (mode === 'idb' && DB.available) {
      try {
        const r = await DB.flushState(state);
        if (r.touched) { DB.noteSaved(nowISO()); mirrorKV(); }
        failed = false;
        emit('saved');
        return true;
      } catch (e) {
        // the database let us down mid-session: never lose the edit, fall back
        DB.noteWriteError(e);
        mode = 'kv';
        DB.announce('degraded', { error: String((e && e.message) || e) });
        Bus.toast('The browser database refused that write, so it is saved in the simpler local-storage mode instead. Settings → Where your data lives has the details.', 'warn', 12000);
        const ok = persistKV();
        emit('saved');
        return ok;
      }
    }
    const ok = persistKV();
    emit('saved');
    return ok;
  }

  function save() {
    dirty = true;
    emit('dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 260);
  }

  return {
    get s() { return state; },
    get isDirty() { return dirty; },
    get mode() { return mode === 'idb' && DB.available ? 'idb' : 'kv'; },
    get lastSaveFailed() { return failed; },
    get engineName() { return this.mode === 'idb' ? 'IndexedDB (' + DB.name + ')' : 'localStorage (' + LS_KEY + ')'; },
    load,
    init,
    save,
    /** mutate with a function, then save + re-render */
    edit(mut, kind) {
      mut(state);
      save();
      emit(kind || 'data');
    },
    /** re-render only */
    refresh(kind) { emit(kind || 'ui'); },
    async flush() {
      clearTimeout(saveTimer);
      dirty = false;
      const ok = await persist();
      if (mode === 'idb' && DB.available) DB.announce('save', { n: state.templates.length });
      return ok;
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    replaceAll(next) { state = sanitize(next); save(); emit('data'); },
    /** drop every row in every table, then re-seed from scratch */
    async resetAll() {
      KV.del(LS_KEY);
      KV.del(LS_MIRROR);
      clearTimeout(saveTimer);
      state = blankState();
      if (DB.available) {
        try { await DB.wipeAll(); } catch (e) { /* a DB that will not clear still leaves us consistent in memory */ }
      }
      dirty = false;
      if (mode === 'idb' && DB.available) { try { await DB.writeAll(state); DB.prime(state); } catch (e) { mode = 'kv'; } }
      else KV.set(LS_KEY, JSON.stringify(state));
      emit('data');
    },
    /**
     * Pull the tables back into memory. Another window wrote something and
     * poked us over BroadcastChannel — same database, two desks.
     */
    async reload() {
      if (!DB.available) return false;
      clearTimeout(saveTimer);
      try {
        const rows = await DB.readAll();
        state = hydrate(rows);
        dirty = false;
        DB.prime(state);
        emit('data');
        return true;
      } catch (e) { return false; }
    },
    /** full rewrite of every row — used after imports and by Settings → Verify */
    async rewrite() {
      if (!DB.available) return persistKV();
      const r = await DB.writeAll(state);
      DB.prime(state);
      DB.announce('save', { n: state.templates.length });
      return r;
    },
    async stats() { return DB.stats(state); },
    async verify() { return DB.verify(state); },
    async repair() {
      const r = DB.available ? await DB.repair(state) : { engine: 'kv', rows: 0, droppedBlobs: 0 };
      DB.prime(state);
      emit('data');
      return r;
    },
    diagnostics() { return DB.diagnostics(state); },
    blankState,
    uid,
    nowISO,
    Vault
  };
})();

/* ---------- lookups / helpers ---------- */
const Q = {
  category(id) { return Store.s.categories.find((c) => c.id === id) || null; },
  categoryName(id) { return Q.category(id)?.name || 'Unsorted'; },
  template(id) { return Store.s.templates.find((t) => t.id === id) || null; },
  file(id) { return Store.s.files.find((f) => f.id === id) || null; },
  phrase(id) { return Store.s.phrases.find((p) => p.id === id) || null; },
  templatesIn(catId) { return Store.s.templates.filter((t) => t.category === catId); },
  filesFor(t) { return (t.fileIds || []).map(Q.file).filter(Boolean); },
  allTags() {
    const m = new Map();
    Store.s.templates.forEach((t) => t.tags.forEach((tag) => m.set(tag, (m.get(tag) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  },
  orphans() {
    const used = new Set();
    Store.s.templates.forEach((t) => (t.fileIds || []).forEach((f) => used.add(f)));
    return Store.s.files.filter((f) => !used.has(f.id));
  }
};

const CAT_COLORS = ['#2f6df6', '#0f9d8a', '#d98314', '#c1362f', '#7b5cd6', '#2f8a3f', '#b0457a', '#4a5b6a'];

/* variable parsing */
const VAR_RE = /\{\{\s*([a-zA-Z0-9_. ]+)\s*\}\}/g;
function varsIn(text) {
  const out = [];
  let m;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(String(text || '')))) {
    const k = m[1].trim();
    if (!out.includes(k)) out.push(k);
  }
  return out;
}
function autoValues() {
  const d = new Date();
  const s = Store.s.settings;
  const fmt = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const h = d.getHours();
  return {
    date: fmt,
    today: fmt,
    time: time,
    greeting: h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening',
    day: fmt,
    agent_name: s.yourName || '',
    name: s.yourName || '',
    company: s.company || '',
    role: s.yourRole || ''
  };
}
/** returns { text, missing: [keys], filled: {k:v} } */
function fillVars(text, provided = {}) {
  const auto = autoValues();
  const remembered = Store.s.settings.rememberFill ? Store.s.vars || {} : {};
  const used = {};
  const out = String(text).replace(VAR_RE, (whole, key) => {
    const k = String(key).trim();
    const v = provided[k] != null && provided[k] !== '' ? provided[k]
      : auto[k] != null && auto[k] !== '' ? auto[k]
      : remembered[k] != null && remembered[k] !== '' ? remembered[k]
      : null;
    used[k] = v;
    return v != null ? String(v) : whole;
  });
  const missing = varsIn(text).filter((k) => used[k] == null);
  return { text: out, missing, filled: used };
}

/* DOM helpers that must survive quirky webviews */
function sive(el, opts) {
  try { if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView(opts || { block: 'nearest' }); } catch (e) { /* noop */ }
}
function safeFocus(el, opts) {
  try { if (el) { el.focus(opts); if (el.select && opts && opts.select) el.select(); } } catch (e) { /* noop */ }
}

/* escaping + highlighting */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function hl(text, needle) {
  const t = String(text ?? '');
  if (!needle) return esc(t);
  const i = t.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + needle.length)) + '</mark>' + esc(t.slice(i + needle.length));
}
function bytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function ago(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.round(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
