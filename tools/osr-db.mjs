#!/usr/bin/env node
/* =========================================================
   tools/osr-db.mjs — the desk's data, out in the open.

   The app stores its workspace in the browser (IndexedDB, see src/js/db.js
   and docs/DATABASE.md). This tool is the other half of that: it takes the
   JSON you export from Settings → Export and turns it into a real SQLite
   file with the same tables and indexes, so you can:

     · validate a backup before trusting it            (inspect)
     · open your library in any SQL tool, offline       (sqlite)
     · ask questions of it from a terminal              (query)
     · dump one table to CSV for a spreadsheet         (csv)

   No dependencies: SQLite comes from Node itself (node:sqlite, Node 22.5+).
   Nothing here talks to the network, and nothing here is loaded by the app.

   Usage
     node tools/osr-db.mjs inspect       <backup.json>
     node tools/osr-db.mjs sqlite         <backup.json> [osr.db]
     node tools/osr-db.mjs query          <osr.db> "SELECT title, usage FROM templates ORDER BY usage DESC LIMIT 10"
     node tools/osr-db.mjs csv            <osr.db> templates [templates.csv]
     node tools/osr-db.mjs roundtrip      <backup.json>          # export → db → json, diff it
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TABLES = {
  categories: {
    key: 'id',
    columns: { id: 'TEXT PRIMARY KEY', name: 'TEXT NOT NULL', color: 'TEXT', order: 'INTEGER DEFAULT 0', extra: 'TEXT' },
    indexes: ['name', 'order']
  },
  templates: {
    key: 'id',
    columns: {
      id: 'TEXT PRIMARY KEY', title: 'TEXT NOT NULL', body: 'TEXT NOT NULL', subject: 'TEXT',
      category: 'TEXT REFERENCES categories(id)', usage: 'INTEGER DEFAULT 0', favorite: 'INTEGER DEFAULT 0',
      custom: 'INTEGER DEFAULT 0', noSig: 'INTEGER DEFAULT 0', order: 'REAL DEFAULT 0',
      createdAt: 'TEXT', updatedAt: 'TEXT', extra: 'TEXT'
    },
    indexes: ['category', 'usage', 'updatedAt', 'title', 'favorite']
  },
  phrases: {
    key: 'id',
    columns: { id: 'TEXT PRIMARY KEY', text: 'TEXT NOT NULL', group: 'TEXT', usage: 'INTEGER DEFAULT 0', favorite: 'INTEGER DEFAULT 0', extra: 'TEXT' },
    indexes: ['usage', 'group']
  },
  cases: {
    key: 'id',
    columns: {
      id: 'TEXT PRIMARY KEY', client: 'TEXT', contact: 'TEXT', ticket: 'TEXT', subject: 'TEXT',
      status: 'TEXT', priority: 'TEXT', owner: 'TEXT', promised: 'TEXT', due: 'TEXT',
      updatedAt: 'TEXT', extra: 'TEXT'
    },
    indexes: ['status', 'updatedAt', 'ticket', 'client']
  },
  files: {
    key: 'id',
    columns: {
      id: 'TEXT PRIMARY KEY', name: 'TEXT NOT NULL', kind: 'TEXT', mime: 'TEXT', size: 'INTEGER',
      at: 'TEXT', note: 'TEXT', stored: 'TEXT', missing: 'INTEGER DEFAULT 0',
      snippet: 'TEXT', data: 'TEXT', extra: 'TEXT'
    },
    indexes: ['name', 'kind', 'at']
  },
  vars: { key: 'key', columns: { key: 'TEXT PRIMARY KEY', value: 'TEXT' }, indexes: [] },
  activity: { key: 'id', columns: { id: 'TEXT PRIMARY KEY', at: 'TEXT', kind: 'TEXT', ref: 'TEXT', extra: 'TEXT' }, indexes: ['at', 'ref'] },
  /* the wide, boring ones: one row per record, JSON in a column */
  template_tags: { key: 'rowid', columns: { template_id: 'TEXT REFERENCES templates(id)', tag: 'TEXT' }, indexes: ['tag'], list: 'templates', spread: (t) => (t.tags || []).map((tag) => ({ tag, template_id: t.id })) },
  template_files: { key: 'rowid', columns: { template_id: 'TEXT REFERENCES templates(id)', file_id: 'TEXT REFERENCES files(id)' }, indexes: ['file_id'], list: 'templates', spread: (t) => (t.fileIds || []).map((file_id) => ({ file_id, template_id: t.id })) },
  case_files: { key: 'rowid', columns: { case_id: 'TEXT REFERENCES cases(id)', file_id: 'TEXT REFERENCES files(id)' }, indexes: ['file_id'], list: 'cases', spread: (c) => (c.fileIds || []).map((file_id) => ({ file_id, case_id: c.id })) },
  case_history: { key: 'rowid', columns: { case_id: 'TEXT REFERENCES cases(id)', at: 'TEXT', text: 'TEXT' }, indexes: ['case_id'], list: 'cases', spread: (c) => (c.history || []).map((h) => ({ at: h.at, text: h.text, case_id: c.id })) },
  settings: { key: 'key', columns: { key: 'TEXT PRIMARY KEY', value: 'TEXT' }, indexes: [] },
  meta: { key: 'key', columns: { key: 'TEXT PRIMARY KEY', value: 'TEXT' }, indexes: [] }
};

const BOOL_COLS = { templates: ['favorite', 'custom', 'noSig'], phrases: ['favorite'], files: ['missing'] };
const JSON_COLS = { templates: ['tags', 'fileIds'], cases: ['fileIds', 'history'], files: ['snippet'] };

/* ---------- reading a backup ---------- */
function readBackup(file) {
  const raw = fs.readFileSync(file, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch (e) { die(`that file is not readable JSON: ${e.message}`); }
  if (!data || typeof data !== 'object') die('that JSON has no object in it');
  if (!Array.isArray(data.templates) && !Array.isArray(data.phrases)) {
    die('no templates and no phrases in it — is this an OSR Desk export? (Settings → Export workspace)');
  }
  return data;
}

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

/* ---------- validation (shared by inspect + sqlite) ---------- */
function validate(data) {
  const problems = [];
  const warn = (m) => problems.push(m);
  const ids = new Set();
  for (const t of data.templates || []) {
    if (!t || !t.id) { warn('a template row has no id'); continue; }
    if (ids.has(t.id)) warn(`duplicate template id ${t.id}`);
    ids.add(t.id);
    if (typeof t.body !== 'string') warn(`${t.id}: body is not text`);
    if (!t.title) warn(`${t.id}: no title`);
    if (t.category && (data.categories || []).length && !(data.categories || []).some((c) => c && c.id === t.category)) {
      warn(`${t.title || t.id}: category "${t.category}" is not in the file`);
    }
    for (const fid of t.fileIds || []) {
      if (!(data.files || []).some((f) => f && f.id === fid)) warn(`${t.title || t.id}: attachment ${fid} is not in the file`);
    }
    if (t.usage != null && !Number.isFinite(Number(t.usage))) warn(`${t.id}: usage is not a number`);
  }
  const catIds = new Set((data.categories || []).map((c) => c && c.id));
  for (const c of data.categories || []) {
    if (!c || !c.id) warn('a category has no id');
    else if (!c.name) warn(`category ${c.id} has no name`);
  }
  for (const p of data.phrases || []) {
    if (!p || !p.id) warn('a phrase has no id');
    else if (typeof p.text !== 'string') warn(`${p.id}: phrase text is not text`);
  }
  for (const f of data.files || []) {
    if (!f || !f.id) { warn('a file has no id'); continue; }
    const hasBytes = !!f.data || !!(data.fileData && data.fileData[f.id]);
    if (f.kind === 'file' && !hasBytes && !f.snippet && !f.missing) warn(`${f.name || f.id}: metadata without bytes — a "files not included" export, re-export with files if you need them`);
    if (f.size != null && Number(f.size) > 50 * 1024 * 1024) warn(`${f.name}: ${f.size} bytes is over the 50 MB per-file cap the desk keeps`);
  }
  for (const c of data.cases || []) {
    if (!c || !c.id) { warn('a case has no id'); continue; }
    const allowed = ['new', 'awaiting', 'progress', 'escalated', 'resolved'];
    if (c.status && !allowed.includes(c.status)) warn(`case ${c.client || c.id}: status "${c.status}" is not one of ${allowed.join('/')}`);
    for (const fid of c.fileIds || []) if (!(data.files || []).some((f) => f && f.id === fid)) warn(`case ${c.client || c.id}: attachment ${fid} is not in the file`);
  }
  const ver = data.schema ?? data.version;
  if (ver != null && Number(ver) !== 3) warn(`written by schema v${ver}; this tool reads v3 — open older files in the desk first so it can migrate them`);
  const s = data.settings || {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'string' && v.length > 20000) warn(`settings.${k} is ${v.length} chars — that is unusual`);
  }
  return { problems, catIds, counts: {
    templates: (data.templates || []).length,
    phrases: (data.phrases || []).length,
    categories: (data.categories || []).length,
    files: (data.files || []).length,
    filesWithBytes: (data.files || []).filter((f) => f && (f.data || (data.fileData || {})[f.id])).length,
    cases: (data.cases || []).length,
    openCases: (data.cases || []).filter((c) => c && c.status !== 'resolved').length,
    vars: Object.keys(data.vars || {}).length,
    activity: (data.activity || []).length
  } };
}

/* ---------- building the sqlite file ---------- */
function buildSqlite(data, outFile) {
  if (fs.existsSync(outFile)) fs.rmSync(outFile);
  const db = new DatabaseSync(outFile);
  db.exec('PRAGMA journal_mode = WAL');
  const declared = new Map();      // table -> Set(columns we declared)
  for (const [name, spec] of Object.entries(TABLES)) {
    const cols = Object.entries(spec.columns).map(([c, t]) => `  ${q(c)} ${t}`);
    db.exec(`CREATE TABLE ${q(name)} (\n${cols.join(',\n')}\n)${spec.key === 'rowid' ? '' : ' WITHOUT ROWID'}`);
    for (const idx of spec.indexes || []) db.exec(`CREATE INDEX IF NOT EXISTS ${q('ix_' + name + '_' + idx)} ON ${q(name)}(${q(idx)})`);
    declared.set(name, new Set(Object.keys(spec.columns)));
  }

  const insert = (table, row) => {
    const spec = TABLES[table];
    const keep = declared.get(table);
    const flat = { ...row };
    const dropped = {};
    for (const k of Object.keys(flat)) {
      if (!keep.has(k)) { dropped[k] = flat[k]; delete flat[k]; continue; }
      const v = flat[k];
      if (v == null) { flat[k] = null; continue; }
      if (typeof v === 'boolean') flat[k] = v ? 1 : 0;
      else if ((JSON_COLS[table] || []).includes(k) && typeof v !== 'string') flat[k] = JSON.stringify(v);
      else if (typeof v === 'object') flat[k] = JSON.stringify(v);
    }
    for (const b of BOOL_COLS[table] || []) if (b in flat && typeof flat[b] === 'boolean') flat[b] = flat[b] ? 1 : 0;
    if (keep.has('extra') && Object.keys(dropped).length) flat.extra = JSON.stringify(dropped);
    const keys = Object.keys(flat);
    if (!keys.length) return 0;
    const stmt = db.prepare(`INSERT OR REPLACE INTO ${q(table)} (${keys.map(q).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`);
    for (const k of keys) {
      const v = flat[k];
      flat[k] = (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v;
    }
    stmt.run(...keys.map((k) => flat[k]));
    return 1;
  };

  const counts = {};
  const fileData = data.fileData || {};
  for (const name of ['categories', 'templates', 'phrases', 'cases', 'files', 'activity']) {
    let n = 0;
    for (const row of data[name] || []) {
      const src = name === 'files' && fileData[row.id] ? { ...row, data: fileData[row.id].data, mime: row.mime || fileData[row.id].mime } : row;
      n += insert(name, src);
    }
    counts[name] = n;
  }
  counts.vars = 0;
  for (const [k, v] of Object.entries(data.vars || {})) {
    counts.vars += insert('vars', { key: k, value: typeof v === 'string' ? v : JSON.stringify(v) });
  }
  for (const [k, v] of Object.entries(data.settings || {})) insert('settings', { key: k, value: typeof v === 'string' ? v : JSON.stringify(v) });
  counts.settings = db.prepare('SELECT COUNT(*) n FROM settings').get().n;
  const meta = {
    exportedAt: data.exportedAt || null,
    app: data.app || 'osr-desk',
    schema: data.schema ?? data.version ?? null,
    installedAt: data.installedAt || null,
    builtBy: 'tools/osr-db.mjs',
    writtenAt: new Date().toISOString()
  };
  for (const [k, v] of Object.entries(meta)) insert('meta', { key: k, value: v == null ? null : String(v) });
  counts.meta = db.prepare('SELECT COUNT(*) n FROM meta').get().n;

  /* the relation tables: tags, attachments, history */
  for (const [name, spec] of Object.entries(TABLES)) {
    if (!spec.spread) continue;
    let n = 0;
    for (const parent of data[spec.list] || []) for (const row of spec.spread(parent) || []) n += insert(name, row);
    counts[name] = n;
  }

  db.exec(`CREATE VIEW IF NOT EXISTS library AS
    SELECT t.id, t.title, t.subject, c.name AS category, t.usage, t.favorite, t.updatedAt,
           (SELECT COUNT(*) FROM template_files tf WHERE tf.template_id = t.id) AS files,
           (SELECT group_concat(tag, ', ') FROM template_tags tt WHERE tt.template_id = t.id) AS tags,
           substr(t.body, 1, 160) AS preview
    FROM templates t LEFT JOIN categories c ON c.id = t.category`);
  db.exec(`CREATE VIEW IF NOT EXISTS most_copied AS
    SELECT title, usage, updatedAt FROM templates WHERE usage > 0 ORDER BY usage DESC`);
  db.exec(`CREATE VIEW IF NOT EXISTS never_copied AS
    SELECT title, category FROM templates WHERE usage = 0 OR usage IS NULL ORDER BY title`);
  db.exec(`CREATE VIEW IF NOT EXISTS open_cases AS
    SELECT client, ticket, status, promised, due, updatedAt FROM cases WHERE status <> 'resolved' ORDER BY due`);
  db.exec(`CREATE VIEW IF NOT EXISTS orphan_files AS
    SELECT f.id, f.name, f.size FROM files f
    WHERE f.id NOT IN (SELECT file_id FROM template_files) AND f.id NOT IN (SELECT file_id FROM case_files)`);
  db.exec(`CREATE VIEW IF NOT EXISTS schema_info AS
    SELECT name AS table_name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name`);
  db.close();
  return counts;
}

function q(id) { return '"' + String(id).replace(/"/g, '""') + '"'; }

/* ---------- reading the sqlite file back ---------- */
function readBack(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const withExtra = (rows) => rows.map((r) => {
    const { extra, ...rest } = r;
    if (extra) { try { Object.assign(rest, JSON.parse(extra)); } catch (e) {} }
    return rest;
  });
  const out = { app: 'osr-desk', version: 3, exportedAt: new Date().toISOString(), categories: [], templates: [], phrases: [], cases: [], files: [], vars: {}, settings: {}, activity: [] };
  const all = (sql) => db.prepare(sql).all();
  out.categories = withExtra(all('SELECT * FROM categories ORDER BY "order"'));
  const tags = all('SELECT * FROM template_tags');
  const attaches = all('SELECT * FROM template_files');
  out.templates = withExtra(all('SELECT * FROM templates ORDER BY "order"')).map((t) => ({
    ...t,
    favorite: !!t.favorite, custom: !!t.custom, noSig: !!t.noSig,
    tags: tags.filter((x) => x.template_id === t.id).map((x) => x.tag),
    fileIds: attaches.filter((x) => x.template_id === t.id).map((x) => x.file_id)
  }));
  const hist = all('SELECT * FROM case_history ORDER BY at');
  const cfiles = all('SELECT * FROM case_files');
  out.cases = withExtra(all('SELECT * FROM cases')).map((c) => ({
    ...c,
    history: hist.filter((h) => h.case_id === c.id).map((h) => ({ at: h.at, text: h.text })),
    fileIds: cfiles.filter((x) => x.case_id === c.id).map((x) => x.file_id)
  }));
  out.phrases = withExtra(all('SELECT * FROM phrases ORDER BY usage DESC')).map((p) => ({ ...p, favorite: !!p.favorite }));
  out.fileData = {};
  out.files = withExtra(all('SELECT * FROM files ORDER BY at DESC')).map((f) => {
    const { data: bytes, extra, ...rest } = f;
    if (bytes) out.fileData[f.id] = { name: f.name, mime: f.mime, data: bytes };
    return { ...rest, missing: !!f.missing };
  });
  out.vars = Object.fromEntries(all('SELECT * FROM vars').map((r) => [r.key, r.value]));
  out.settings = Object.fromEntries(all('SELECT * FROM settings').map((r) => [r.key, r.value]));
  out.activity = all('SELECT * FROM activity ORDER BY at DESC');
  db.close();
  return out;
}

/* ---------- commands ---------- */
const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const arg = (i) => argv[i + 1];

function table(name, rows) {
  if (!rows.length) return `${name}: (empty)`;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 6);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] == null ? '' : r[c]).slice(0, 38).length)));
  const line = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
  const head = line(cols);
  return [`${name} (${rows.length})`, head, '-'.repeat(head.length)].concat(rows.slice(0, 25).map((r) => line(cols.map((c) => String(r[c] == null ? '' : r[c]).slice(0, 38))))).concat(rows.length > 25 ? [`… ${rows.length - 25} more`] : []).join('\n');
}

switch (cmd) {
  case 'inspect': {
    const file = arg(0);
    if (!file) die('usage: node tools/osr-db.mjs inspect <backup.json>');
    const data = readBackup(file);
    const v = validate(data);
    console.log(`\nOSR Desk backup · ${path.basename(file)}  (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
    console.log('  written by schema v' + (data.schema ?? data.version ?? '?') + (data.exportedAt ? ` · exported ${data.exportedAt}` : ''));
    console.log('\n  ' + Object.entries(v.counts).map(([k, n]) => `${k}: ${n}`).join('\n  '));
    if (v.problems.length) {
      console.log(`\n  ${v.problems.length} thing${v.problems.length === 1 ? '' : 's'} to look at:`);
      for (const p of v.problems.slice(0, 30)) console.log('   · ' + p);
      if (v.problems.length > 30) console.log(`   … and ${v.problems.length - 30} more`);
    } else {
      console.log('\n  ✓ no problems found — this backup can be imported as-is');
    }
    console.log('');
    process.exit(v.problems.some((p) => /duplicate|not text|no id|not in the file/.test(p)) ? 2 : 0);
  }

  case 'sqlite': {
    const file = arg(0), out = arg(1) || 'osr.db';
    if (!file) die('usage: node tools/osr-db.mjs sqlite <backup.json> [osr.db]');
    const data = readBackup(file);
    const v = validate(data);
    if (v.problems.length) console.log(`note: ${v.problems.length} warning(s) in the source (inspect for details) — building anyway`);
    const counts = buildSqlite(data, out);
    const kb = (fs.statSync(out).size / 1024).toFixed(1);
    console.log(`\n✓ wrote ${out} (${kb} KB) — open it with: sqlite3 ${out}  or any SQL tool`);
    console.log('  rows: ' + Object.entries(counts).map(([k, n]) => `${k}=${n}`).join('  '));
    console.log('  views: library, most_copied, never_copied, open_cases, orphan_files, schema_info');
    console.log(`  try: node tools/osr-db.mjs query ${out} "SELECT title, usage FROM most_copied LIMIT 10"\n`);
    break;
  }

  case 'query': {
    const jsonOut = argv.includes('--json');
    const rest = argv.filter((a) => a !== '--json');
    const file = rest[1], sql = rest[2];
    if (!file || !sql) die('usage: node tools/osr-db.mjs query <osr.db> "SELECT …" [--json]');
    if (/\b(insert|update|delete|drop|alter|create|pragma|attach|vacuum)\b/i.test(sql)) die('this tool only reads. open the file in sqlite3 if you want to write to it');
    const db = new DatabaseSync(file, { readOnly: true });
    let rows;
    try { rows = db.prepare(sql).all(); } catch (e) { db.close(); die('SQLite said: ' + e.message); }
    db.close();
    if (jsonOut) { console.log(JSON.stringify(rows)); break; }
    if (!rows.length) { console.log('(no rows)'); break; }
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    console.log(table('result', rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])))));
    break;
  }

  case 'csv': {
    const file = arg(0), name = arg(1), out = arg(2) || `${name}.csv`;
    if (!file || !name) die('usage: node tools/osr-db.mjs csv <osr.db> <table> [out.csv]');
    const db = new DatabaseSync(file, { readOnly: true });
    let rows;
    try { rows = db.prepare(`SELECT * FROM ${q(name)}`).all(); } catch (e) { db.close(); die('SQLite said: ' + e.message); }
    db.close();
    if (!rows.length) die(`table ${name} is empty`);
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    fs.writeFileSync(out, [cols.join(',')].concat(rows.map((r) => cols.map((c) => cell(r[c])).join(','))).join('\n'));
    console.log(`✓ ${rows.length} rows → ${out}`);
    break;
  }

  case 'roundtrip': {
    const file = arg(0);
    if (!file) die('usage: node tools/osr-db.mjs roundtrip <backup.json>');
    const data = readBackup(file);
    const tmp = path.join(path.dirname(path.resolve(file)), '.osr-roundtrip.db');
    buildSqlite(data, tmp);
    const back = readBack(tmp);
    fs.rmSync(tmp, { force: true });
    const diff = [];
    const cmp = (label, a, b) => { if (a !== b) diff.push(`${label}: ${a} → ${b}`); };
    cmp('templates', (data.templates || []).length, back.templates.length);
    cmp('phrases', (data.phrases || []).length, back.phrases.length);
    cmp('categories', (data.categories || []).length, back.categories.length);
    cmp('cases', (data.cases || []).length, back.cases.length);
    cmp('files', (data.files || []).length, back.files.length);
    cmp('vars', Object.keys(data.vars || {}).length, Object.keys(back.vars).length);
  cmp('fileData', Object.keys(data.fileData || {}).length, Object.keys(back.fileData || {}).length);
  for (const [id, f] of Object.entries(data.fileData || {})) {
    if (!back.fileData[id] || back.fileData[id].data !== f.data) diff.push(`file ${id} bytes did not come back intact`);
  }
    for (const t of data.templates || []) {
      const rt = back.templates.find((x) => x.id === t.id);
      if (!rt) { diff.push(`template ${t.title || t.id} did not come back`); continue; }
      if ((rt.body || '') !== (t.body || '')) diff.push(`template "${t.title}" body changed length ${t.body?.length} → ${rt.body?.length}`);
      if ((rt.tags || []).join() !== (t.tags || []).join()) diff.push(`template "${t.title}" tags changed`);
      if ((rt.fileIds || []).join() !== (t.fileIds || []).join()) diff.push(`template "${t.title}" attachments changed`);
      if (Number(rt.usage) !== Number(t.usage || 0)) diff.push(`template "${t.title}" usage changed ${t.usage} → ${rt.usage}`);
      if (!!rt.favorite !== !!t.favorite) diff.push(`template "${t.title}" star changed`);
    }
    if (diff.length) {
      console.log(`\n✗ round-trip lost or changed ${diff.length} thing(s):`);
      for (const d of diff.slice(0, 20)) console.log('  · ' + d);
      console.log('');
      process.exit(2);
    }
    console.log(`\n✓ round-trip clean: ${back.templates.length} templates went in and came back identical (text, tags, attachments, stars, usage)\n`);
    break;
  }

  default:
    console.log(`
OSR Desk · database tool

  inspect  <backup.json>              validate a backup and print what is in it
  sqlite   <backup.json> [osr.db]     build a real SQLite database from it
  query    <osr.db> "SELECT …"        run read-only SQL (views: library, most_copied,
                                       never_copied, open_cases, orphan_files, schema_info)
  csv      <osr.db> <table> [out.csv] dump one table to CSV
  roundtrip <backup.json>             export → sqlite → json and prove nothing changed

needs Node 22.5+ (SQLite is built in). Nothing here is uploaded anywhere.
`);
}
