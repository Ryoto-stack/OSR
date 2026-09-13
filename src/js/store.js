/* =========================================================
   store.js — state, persistence, file blob storage
   No build step, no deps. Works from file:// and http://.
   ========================================================= */

const SCHEMA = 3;
const LS_KEY = 'osr.desk.state.v' + SCHEMA;

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

/* ---------- IndexedDB blob vault (falls back to dataURLs in KV) ---------- */
const Vault = (() => {
  const DB = 'osr-desk-files', STORE = 'blobs';
  let dbp = null;
  let broken = false;

  function open() {
    if (broken || typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (dbp) return dbp;
    dbp = new Promise((res) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => { broken = true; res(null); };
        req.onblocked = () => { broken = true; res(null); };
      } catch (e) { broken = true; res(null); }
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then((db) => {
      if (!db) throw new Error('no-idb');
      return new Promise((res, rej) => {
        try {
          const t = db.transaction(STORE, mode);
          t.oncomplete = () => res();
          t.onerror = () => rej(t.error);
          t.onabort = () => rej(t.error);
          fn(t.objectStore(STORE), res, rej);
        } catch (e) { rej(e); }
      });
    });
  }

  return {
    get mode() { return broken || typeof indexedDB === 'undefined' ? 'kv' : 'idb'; },
    async put(id, blob) {
      try {
        await tx('readwrite', (s, res, rej) => { s.put(blob, id).onsuccess = res; });
        return { kind: 'idb' };
      } catch (e) {
        // fallback: inline small files as data URLs in KV
        try {
          const dataUrl = await blobToDataURL(blob);
          const ok = KV.set('osr.file.' + id, dataUrl);
          return { kind: ok ? 'kv' : 'mem', dataUrl };
        } catch (e2) { return { kind: 'mem' }; }
      }
    },
    async get(id) {
      try {
        return await new Promise((res, rej) => {
          tx('readonly', (s) => {
            const r = s.get(id);
            r.onsuccess = () => res(r.result ?? null);
            r.onerror = () => rej(r.error);
          }).catch(rej);
        });
      } catch (e) {
        const dv = KV.get('osr.file.' + id);
        if (dv) { const r = await fetch(dv); return await r.blob(); }
        return null;
      }
    },
    async del(id) {
      try { await tx('readwrite', (s, res, rej) => { s.delete(id).onsuccess = res; }); } catch (e) { /* ignore */ }
      KV.del('osr.file.' + id);
    },
    async exportOne(id) {
      const b = await this.get(id);
      return b ? await blobToDataURL(b) : null;
    }
  };
})();

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

  function load() {
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
    if (s) { state = sanitize(s); }
    else { state = blankState(); state.__fresh = true; }
    return state;
  }

  function persist() {
    dirty = false;
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
    if (!ok) Bus.toast('Could not save to this browser. Export a backup (Settings → Export) before you close the tab.', 'bad', 14000);
    emit('saved');
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
    load,
    save,
    /** mutate with a function, then save + re-render */
    edit(mut, kind) {
      mut(state);
      save();
      emit(kind || 'data');
    },
    /** re-render only */
    refresh(kind) { emit(kind || 'ui'); },
    flush() { clearTimeout(saveTimer); persist(); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    replaceAll(next) { state = sanitize(next); save(); emit('data'); },
    resetAll() { KV.del(LS_KEY); state = blankState(); save(); emit('data'); },
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
