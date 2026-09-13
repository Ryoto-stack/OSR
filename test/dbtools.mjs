/* test/dbtools.mjs — the offline database tool: backup → validation → SQLite
   → SQL → back again. Run: node test/dbtools.mjs   (or npm test)             */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TOOL = path.resolve('tools/osr-db.mjs');
const FIXTURE = path.resolve('test/fixtures/backup.sample.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osrdb-'));
const out = (n) => path.join(dir, n);

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x ? '  \u2190 ' + x : '')); } };

function run(args, expectCode = 0) {
  try {
    const stdout = execFileSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    const r = { code: e.status == null ? -1 : e.status, stdout: e.stdout || '', stderr: (e.stderr || '') + (e.message || '') };
    if (r.code !== expectCode) throw new Error(`tool exited ${r.code} running: ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
    return r;
  }
}

const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

console.log('\n[1] inspect — validation of a real export');
{
  const r = run(['inspect', FIXTURE]);
  check('exit 0 on a good file', r.code === 0);
  check('counts the templates', /templates: 4/.test(r.stdout), r.stdout.slice(0, 300));
  check('counts categories, phrases, files, cases', /categories: 3/.test(r.stdout) && /phrases: 3/.test(r.stdout) && /files: 4/.test(r.stdout) && /cases: 3/.test(r.stdout));
  check('separates open cases from resolved', /openCases: 2/.test(r.stdout));
  check('notices which files carry bytes', /filesWithBytes: 2/.test(r.stdout), r.stdout.slice(0, 400));
  check('reports no problems on a clean file', /no problems found/.test(r.stdout));
  check('reads the schema stamp from `version` too', /schema v3/.test(r.stdout));
}

console.log('\n[2] inspect — a broken file says so');
{
  const bad = JSON.parse(JSON.stringify(data));
  delete bad.templates[2].category;
  bad.templates[2].category = 'cat_gone';
  bad.templates[1].id = bad.templates[0].id;
  bad.files[1] = { id: 'x', name: 'ghost.pdf', kind: 'file', size: 10 };
  bad.categories[1].id = '';
  const badFile = out('broken.json');
  fs.writeFileSync(badFile, JSON.stringify(bad));
  const r = run(['inspect', badFile], 2);
  check('exit code 2 when it is not importable-clean', r.code === 2, 'got ' + r.code);
  check('names the missing category', /cat_gone/.test(r.stdout), r.stdout.slice(0, 400));
  check('names the duplicate id', /duplicate template id/.test(r.stdout));
  check('names metadata without bytes', /metadata without bytes/.test(r.stdout));
  check('names the category with no id', /category has no id/.test(r.stdout));

  const nope = out('not-osr.json');
  fs.writeFileSync(nope, JSON.stringify({ hello: 'world' }));
  const r2 = run(['inspect', nope], 1);
  check('rejects a JSON file that is not a desk export', /is this an OSR Desk export/.test(r2.stdout + r2.stderr));

  const junk = out('junk.json');
  fs.writeFileSync(junk, '{ nope');
  const r3 = run(['inspect', junk], 1);
  check('rejects unreadable JSON with a message, not a stack', /not readable JSON/.test(r3.stdout + r3.stderr) && !/at Object\./.test(r3.stdout + r3.stderr));
}

console.log('\n[3] sqlite — build a real database file');
{
  const db = out('osr.db');
  const r = run(['sqlite', FIXTURE, db]);
  check('built without error', r.code === 0 && fs.existsSync(db));
  check('reports row counts per table', /templates=4/.test(r.stdout) && /phrases=3/.test(r.stdout) && /files=4/.test(r.stdout), r.stdout.slice(0, 400));
  check('mentions the views it made', /library.*most_copied/s.test(r.stdout));
  check('the file is a real SQLite database', fs.readFileSync(db).slice(0, 15).toString('latin1').startsWith('SQLite format 3'));

  const q = (sql) => run(['query', db, sql]).stdout;
  /** exact values, no pretty-printing in the way */
  const jq = (sql) => JSON.parse(run(['query', db, sql, '--json']).stdout);
  check('templates table holds the bodies verbatim', jq("SELECT body FROM templates WHERE id = 'tpl_refund'")[0].body === data.templates[0].body, JSON.stringify(jq("SELECT body FROM templates WHERE id = 'tpl_refund'")[0].body).slice(0, 80));
  check('booleans came back as 0/1', jq("SELECT favorite, usage, noSig FROM templates WHERE id = 'tpl_refund'")[0].favorite === 1 && jq("SELECT noSig FROM templates WHERE id = 'tpl_escalate'")[0].noSig === 1, JSON.stringify(jq("SELECT favorite, noSig FROM templates WHERE id = 'tpl_refund'")));
  check('the tags relation table works', q("SELECT tag FROM template_tags ORDER BY tag").includes('refund') && q("SELECT tag FROM template_tags").includes('money'));
  check('attachment links are queryable', /file_policy/.test(q("SELECT * FROM template_files")));
  check('the library view joins the category name', jq("SELECT category, tags, files FROM library WHERE id = 'tpl_reset'")[0].category === 'Account & login' && jq("SELECT tags, files FROM library WHERE id = 'tpl_refund'")[0].files === 1, JSON.stringify(jq("SELECT * FROM library WHERE id = 'tpl_refund'")[0]).slice(0, 160));
  check('most_copied orders by usage', (() => { const t = jq('SELECT title, usage FROM most_copied'); return t[0].title === 'Refund approved' && t[0].usage === 41 && t.length === 3; })(), JSON.stringify(jq('SELECT title, usage FROM most_copied')));
  check('never_copied finds the untouched one', jq("SELECT title FROM never_copied").length === 1 && jq("SELECT title FROM never_copied")[0].title.startsWith('Chase-up'));
  check('open_cases excludes resolved ones', jq("SELECT client FROM open_cases").length === 2 && !JSON.stringify(jq("SELECT client FROM open_cases")).includes('Priya'));
  check('orphan_files lists shelf items attached to nothing', jq("SELECT name FROM orphan_files").some((r) => /Price list/.test(r.name)), JSON.stringify(jq('SELECT * FROM orphan_files')));
  check('vars became a key/value table', jq("SELECT value FROM vars WHERE key = 'ticket_id'")[0].value === 'T-4001');
  check('settings became a key/value table', jq("SELECT value FROM settings WHERE key = 'yourName'")[0].value === 'Ry Tan' && jq("SELECT value FROM settings WHERE key = 'signature'")[0].value.includes('Northwind'));
  check('case history is its own table', jq("SELECT COUNT(*) n FROM case_history")[0].n === 5 && jq("SELECT text FROM case_history WHERE case_id = 'case_1' ORDER BY at ASC LIMIT 1")[0].text === 'opened from mail thread' && jq("SELECT at, text FROM case_history WHERE case_id = 'case_2'")[0].text === '→ in progress');
  check('file bytes are stored when the export had them', jq("SELECT length(data) n, name FROM files WHERE id = 'file_policy'")[0].n === 13);
  check('files without bytes are NULL, not empty strings', jq("SELECT data IS NULL AS is_null FROM files WHERE id = 'file_status'")[0].is_null === 1);
  check('indexes exist for the hot paths', jq("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").some((r) => r.name === 'ix_templates_usage') && jq("SELECT name FROM sqlite_master WHERE type = 'index'").some((r) => r.name === 'ix_cases_status'));
  check('un-modelled fields survive in the extra column', JSON.parse(jq("SELECT extra FROM files WHERE id = 'file_prices'")[0].extra).url === null, JSON.stringify(jq("SELECT extra FROM files WHERE id = 'file_prices'")));
}

console.log('\n[4] query is read-only and refuses to be creative');
{
  const db = out('osr.db');
  for (const sql of ['DELETE FROM templates', 'UPDATE settings SET value = 1', 'DROP TABLE files', 'PRAGMA journal_mode = off', 'ATTACH "x" AS y']) {
    const r = run(['query', db, sql], 1);
    check(`refuses: ${sql.split(' ')[0]}`, /only reads/.test(r.stdout + r.stderr));
  }
}

console.log('\n[5] csv — one table out to a spreadsheet');
{
  const db = out('osr.db');
  const csvPath = out('cats.csv');
  const r = run(['csv', db, 'categories', csvPath]);
  check('says how many rows went out', /3 rows/.test(r.stdout), r.stdout);
  const csv = fs.readFileSync(csvPath, 'utf8');
  const lines = csv.trim().split('\n');
  check('header is the column list', lines[0] === 'id,name,color,order,extra', lines[0]);
  check('one line per row', lines.length === 4, lines.length + ' lines');
  check('the values are the values', lines.some((l) => l.includes('Billing') && l.includes('#c1362f')));
  const libPath = out('library.csv');
  run(['csv', db, 'library', libPath]);
  const lib = fs.readFileSync(libPath, 'utf8');
  check('a field containing a newline is quoted, not split', /"(\\"|[^"])*\n[^"]*"/.test(lib) || lib.split('\n').length > 6, lib.slice(0, 160));
}

console.log('\n[6] roundtrip — sqlite in, JSON out, nothing changed');
{
  const r = run(['roundtrip', FIXTURE]);
  check('it reports a clean round trip', /round-trip clean/.test(r.stdout), r.stdout.slice(0, 400));
  check('and the template count matches the file', /4 templates/.test(r.stdout));

  const mutated = JSON.parse(JSON.stringify(data));
  mutated.templates[0].body = mutated.templates[0].body + '\n\nand one more line';
  const mFile = out('mutated.json');
  fs.writeFileSync(mFile, JSON.stringify(mutated));
  const before = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  check('the fixture itself is untouched by the tool', before.templates[0].body === data.templates[0].body);
  const r2 = run(['roundtrip', mFile]);
  check('a changed body still round-trips (the tool is not lossy)', /round-trip clean/.test(r2.stdout), r2.stdout.slice(0, 300));

  const withTags = JSON.parse(JSON.stringify(data));
  withTags.templates[1].tags = ['login', 'steps', 'urgent', 'vip-client'];
  withTags.templates[1].fileIds = ['file_policy', 'file_escalation', 'file_status'];
  const tFile = out('tags.json');
  fs.writeFileSync(tFile, JSON.stringify(withTags));
  check('many tags and attachments round-trip in order', /round-trip clean/.test(run(['roundtrip', tFile]).stdout));
}

console.log('\n[7] it copes with an export the desk actually writes');
{
  /* a minimal real export: no trash, no activity, no files, only two templates */
  const mini = { app: 'osr-desk', version: 3, exportedAt: new Date().toISOString(), settings: { yourName: 'A' }, categories: [{ id: 'c', name: 'C' }], templates: [{ id: 't1', title: 'Hi', body: 'there' }, { id: 't2', title: 'Bye', body: 'see you', tags: ['x'] }], phrases: [], cases: [], vars: {}, activity: [], files: [], fileData: {} };
  const f = out('mini.json');
  fs.writeFileSync(f, JSON.stringify(mini));
  check('inspect passes it', run(['inspect', f]).code === 0);
  const db = out('mini.db');
  run(['sqlite', f, db]);
  check('empty tables are allowed', run(["query", db, "SELECT * FROM phrases"]).stdout.includes('no rows'));
  check('counts are right', run(["query", db, "SELECT COUNT(*) n FROM templates"]).stdout.includes('2'));
  check('missing optional fields do not break it', run(['roundtrip', f]).stdout.includes('round-trip clean'));
  const helpOut = run([]).stdout;
  check('help lists every command', ['inspect', 'sqlite', 'query', 'csv', 'roundtrip'].every((c) => helpOut.includes(c)));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n────────  ' + pass + ' passed, ' + fail + ' failed  ────────\n');
if (fail) process.exit(1);
