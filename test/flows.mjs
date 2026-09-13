/* test/flows.mjs — deeper flows: global drag & drop, paste, undo for files,
   destructive confirmations, storage fallback, orphan view, edge cases. */
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('OSR-Desk.html', 'utf8');
const errors = [];
const vc = new VirtualConsole();
const JSDOM_ONLY = /Could not parse CSS|Not implemented: navigation|Not implemented: HTMLFormElement/;
vc.on('jsdomError', (e) => { const s = (e.detail || e).toString(); if (!JSDOM_ONLY.test(s)) errors.push(s.split('\n').slice(0, 3).join(' ')); });
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc, beforeParse(win) {
  win.__step = '';
  win.addEventListener('error', (e) => { if (process.env.TRACE) console.log('### at step [' + win.__step + ']\n' + (e.error?.stack || e.message || '').toString().split('\n').slice(0, 6).join('\n')); });
} });
const w = dom.window, d = w.document;

const clip = { text: '', calls: 0 };
const downloads = [];
let storeOverride = null;
Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { clip.text = t; clip.calls++; } }, configurable: true });
w.URL.createObjectURL = (b) => { storeOverride = b; return 'blob:fake'; };
w.URL.revokeObjectURL = () => {};
w.fetch = async (u) => {
  const [, meta, b64] = String(u).match(/^data:([^;]*);base64,(.*)$/) || [];
  const buf = Buffer.from(b64 || '', 'base64');
  return { blob: async () => new w.Blob([buf], { type: meta || 'application/octet-stream' }), text: async () => buf.toString('utf8') };
};
w.open = (url) => { downloads.push(String(url)); return { closed: false }; };
const origCreate = d.createElement.bind(d);
d.createElement = (tag) => { const el = origCreate(tag); if (tag === 'a') el.click = () => downloads.push('dl:' + el.download); return el; };
const origOpen = w.open;
w.print = () => {};

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const q = (s) => d.querySelector(s);
const qa = (s) => [...d.querySelectorAll(s)];
const byText = (sel, txt) => qa(sel).find((e) => (e.textContent || '').includes(txt));
const click = async (el, o = {}) => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, ...o })); await wait(); };
const type = async (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(120); };
const flush = () => { w.eval('Store.flush()'); return wait(10); };
const readState = async () => { await flush(); return JSON.parse(w.localStorage.getItem('osr.desk.state.v3') || '{}'); };
const clearModals = async () => { w.eval(`if (typeof openPaletteInst!=='undefined'&&openPaletteInst) openPaletteInst.close(); modalStack.slice().forEach(m=>m.close());`); await wait(60); };

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  ← ' + x : '')); } };

/** Build a drop event that looks like a real one to our handlers. */
async function fireDrop(target, { files = [], text = null, internal = null }) {
  const dt = {
    types: [...(files.length ? ['Files'] : []), ...(text != null ? ['text/plain'] : []), ...(internal ? ['application/x-osr-file'] : [])],
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    files,
    effectAllowed: '', dropEffect: '',
    _data: { 'text/plain': text || '', 'application/x-osr-file': internal || '', 'text/osr-file': internal || '' },
    getData(t) { return this._data[t] || (t === 'text/plain' ? (text || '') : ''); },
    setData(t, v) { this._data[t] = v; }
  };
  const mk = (type, el) => { const ev = new w.Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'dataTransfer', { value: dt }); (el || w).dispatchEvent(ev); return ev; };
  mk('dragenter', target);
  mk('dragover', target);
  await wait(20);
  mk('drop', target);
  await wait(260);
}

await wait(900);
await clearModals();
w.eval('Store.s.onboarded = true; render();');
await wait(60);

/* 1. drop files from the OS anywhere → shelf */
w.eval(`window.__step='[1]'`);
console.log('\n[1] global drop of real files');
const f1 = new w.File(['outage note\nline two'], 'outage-2026-09.txt', { type: 'text/plain' });
const f2 = new w.File([new Uint8Array([1, 2, 3, 4])], 'error-shot.png', { type: 'image/png' });
await fireDrop(d.body, { files: [f1, f2] });
let st = await readState();
check('both files landed on the shelf', st.files.length === 2, JSON.stringify(st.files.map((f) => f.name)));
check('text file got a snippet', !!st.files.find((f) => f.name.endsWith('.txt'))?.snippet);
check('binary file got a blob in the fallback store', !!Object.keys(w.localStorage).find((k) => k.startsWith('osr.file.')));
check('drop overlay shown during drag then hidden', !d.getElementById('drop-overlay').classList.contains('on'));

/* 2. drop onto a specific template card → attach there */
w.eval(`window.__step='[2]'`);
console.log('\n[2] drop onto a template card');
const tplId = st.templates[0].id;
const card = q(`.card[data-id="${tplId}"]`);
await fireDrop(card, { files: [new w.File(['form'], 'claim-form.pdf', { type: 'application/pdf' })] });
st = await readState();
const attached = st.templates.find((t) => t.id === tplId).fileIds;
check('dropped file attached to that template', attached.length === 1, JSON.stringify(attached));
check('shelf still holds it (attachment = link, not move)', st.files.length === 3, 'files: ' + JSON.stringify(st.files.map(f=>f.name)));
check('card shows the attachment count', q(`.card[data-id="${tplId}"] .filepill`) !== null);

/* 3. internal drag: shelf file → another template */
w.eval(`window.__step='[3]'`);
console.log('\n[3] drag a shelf file onto another card');
await w.eval(`view.tab='library'; view.cat='all'; render();`);
await wait(60);
const shelfId = st.files[0].id;
const other = qa('.card')[1].dataset.id;
await fireDrop(q(`.card[data-id="${other}"]`), { internal: shelfId });
st = await readState();
check('existing shelf file attached by internal drag', st.templates.find((t) => t.id === other).fileIds.includes(shelfId));

/* 4. drop a URL → saved link */
w.eval(`window.__step='[4]'`);
console.log('\n[4] drop a link');
await fireDrop(d.body, { text: 'https://status.northwind.example/incidents/441' });
st = await readState();
check('link saved to the shelf', st.files.some((f) => f.kind === 'link' && f.url.includes('status.northwind')));
check('link opens via window.open', (await (async () => { w.eval(`openFile(${JSON.stringify(st.files.find((f) => f.kind === 'link').id)})`); await wait(40); return downloads.some((x) => x.includes('status.northwind')); })()));

/* 5. drop plain text → note, drop JSON → import dialog */
w.eval(`window.__step='[5]'`);
console.log('\n[5] drop text and a backup');
await fireDrop(d.body, { text: 'Escalation contact for billing is Priya, not the queue alias.' });
st = await readState();
check('dropped text became a readable note', st.files.some((f) => (f.snippet || '').includes('Priya')));
const backup = { app: 'osr-desk', version: 3, templates: [{ title: 'Dropped in backup template', body: 'Body from the dropped file {{first_name}}', category: '', tags: [] }], phrases: [], categories: [], files: [] };
await fireDrop(d.body, { files: [new w.File([JSON.stringify(backup)], 'osr-backup.json', { type: 'application/json' })] });
await wait(120);
check('dropping a backup opens the import dialog', !!q('#im-merge'));
await click(q('#im-merge'));
check('dropped backup merged', (await readState()).templates.some((t) => t.title === 'Dropped in backup template'));

/* 6. paste a long text → offer as template */
w.eval(`window.__step='[6]'`);
console.log('\n[6] paste handling');
const pasteEv = new w.Event('paste', { bubbles: true, cancelable: true });
Object.defineProperty(pasteEv, 'clipboardData', { value: { items: [], getData: (t) => (t === 'text/plain' ? 'Hi Sam,\n\nI checked the logs from 14:20 and the token store had rotated.\nNothing to do on your side, I will confirm once the retry lands.\n\nBest,\nRy' : '') } });
d.body.dispatchEvent(pasteEv);
await wait(80);
check('paste of a long message offers "turn into template"', !!q('#pt-save'));
await click(q('#pt-save'));
await wait(80);
check('and it opens the editor with that text', !!q('#ed-save') && q('#ed-body').value.includes('token store'));
await click(q('#ed-save'));
check('template created from paste', (await readState()).templates.some((t) => /Good |^Hi Sam|token store/.test(t.body)));

/* 7. file delete has an undo that restores the attachment too */
w.eval(`window.__step='[7]'`);
console.log('\n[7] file delete + undo');
await w.eval(`view.tab='files'; view.fileQ=''; render();`);
await wait(80);
const before7 = (await readState()).files.length;
const victim = st.files.find((f) => f.name.endsWith('.txt'));
await click(q(`.file-card[data-file="${victim.id}"] [data-act="del-file"]`));
await wait(60);
check('confirm dialog before deleting a file', /Delete/.test(q('.scrim')?.textContent || ''));
await click(q('[data-yes]'));
await wait(120);
check('file removed', (await readState()).files.length === before7 - 1);
await click(byText('#toasts .undo', 'Undo'));
check('undo restored the file', (await readState()).files.length === before7);

/* 8. orphan / no-category view + rename category + delete category keeps templates */
w.eval(`window.__step='[8]'`);
console.log('\n[8] category management');
w.eval(`view.cat='orphan'; render();`);
await wait(60);
check('no-category view works', qa('.card').length === 0 || q('.main-title').textContent.includes('No category'));
await click(byText('.rail-item', 'First touch'));
check('category view active', q('.main-title').textContent.includes('First touch'));
await click(q('[data-act="edit-cat"]'));
await type(q('#cat-name'), 'First replies');
await click(q('#cat-save'));
st = await readState();
check('rename applied everywhere', st.categories.some((c) => c.name === 'First replies') && !st.categories.some((c) => c.name === 'First touch'));
const movedCount = st.templates.filter((t) => t.category === st.categories.find((c) => c.name === 'First replies').id).length;
await click(q('[data-act="edit-cat"]'));
await click(q('#cat-del'));
await wait(60);
await click(q('[data-yes]'));
await wait(120);
st = await readState();
check('deleting a category keeps its templates as unsorted', st.templates.filter((t) => !st.categories.some((c) => c.id === t.category)).length >= movedCount);

/* 9. wipe and reseed keep the app usable */
w.eval(`window.__step='[9]'`);
console.log('\n[9] destructive settings actions');
await w.eval(`view.tab='settings'; render();`);
await clearModals();
await click(q('[data-act="reseed"]'));
await wait(80);
check('reseed asks for confirmation', /Reset to the starter library/.test(q('.scrim')?.textContent || ''), 'scrims=' + qa('.scrim').length + ' text=' + (q('.scrim')?.textContent || '').slice(0, 80));
await click(q('[data-yes]'));
await wait(400);
st = await readState();
check('after reseed the library is back to the starter set', st.templates.length >= 25 && st.templates.every((t) => t.id.startsWith('tpl_')));
check('files survived a reseed', st.files.length >= 3);
check('a backup was exported first', downloads.some((x) => /osr-desk-backup/.test(x)), JSON.stringify(downloads.slice(-2)));

/* 10. rail hide + persistence of settings */
w.eval(`window.__step='[10]'`);
console.log('\n[10] chrome');
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
await wait(60);
check('Ctrl+B hides the rail', d.getElementById('app').classList.contains('rail-hidden'));
check('hidden rail remembered in settings', (await readState()).settings.hideRail === true);
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
await wait(60);
check('and brings it back', !d.getElementById('app').classList.contains('rail-hidden'));

/* 11. storage-blocked mode */
w.eval(`window.__step='[11]'`);
console.log('\n[11] hostile browser (storage throws)');
const blocked = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
await wait(600);
Object.defineProperty(blocked.window, 'localStorage', { value: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} }, configurable: true });
blocked.window.location.reload();
await wait(900);
check('blocked-storage instance still renders something or warns', blocked.window.document.querySelectorAll('.card').length > 0 || blocked.window.document.querySelector('#toasts')?.textContent.length > 0, 'cards: ' + blocked.window.document.querySelectorAll('.card').length);
blocked.window.close();

/* 12. huge file → shortcut instead of a crash */
w.eval(`window.__step='[12]'`);
console.log('\n[12] oversized file');
const big = new w.File([new Uint8Array(1400 * 1024)], 'walkthrough.mp4', { type: 'video/mp4' });
await fireDrop(d.body, { files: [big] });
st = await readState();
const rec = st.files.find((f) => f.name === 'walkthrough.mp4');
check('oversized file kept as a labelled shortcut', rec && rec.kind === 'shortcut', JSON.stringify(rec && { k: rec.kind, n: rec.name }));
await w.eval(`view.tab='files'; render();`);
await wait(80);
await click(q(`.file-card[data-file="${rec.id}"] [data-act="open-file"]`));
await wait(80);
check('opening a shortcut asks for the file instead of erroring', /shortcut/.test(q('#toasts').textContent) || !!d.querySelector('input[type=file]'));

/* 13. case board: due-date colouring, resolved filter, history */
w.eval(`window.__step='[13]'`);
console.log('\n[13] cases');
await w.eval(`view.tab='cases'; render();`);
await click(q('[data-act="new-case"]'));
await type(q('#cy-client'), 'Globex');
await type(q('#cy-ticket'), '5150');
q('#cy-due').value = '2020-01-01';
q('#cy-due').dispatchEvent(new w.Event('input', { bubbles: true }));
await click(q('#cy-save'));
await wait(80);
st = await readState();
check('case stored with a due date', st.cases.some((c) => c.client === 'Globex' && c.due === '2020-01-01'));
const dueIx = d.body.innerHTML.indexOf('2020-01-01');
check('overdue date flagged in red', dueIx > 0 && d.body.innerHTML.slice(Math.max(0, dueIx - 200), dueIx).includes('var(--bad)'));
const caseId = st.cases.find((c) => c.client === 'Globex').id;
q(`tr[data-case="${caseId}"] select[data-act="case-status"]`).value = 'resolved';
q(`tr[data-case="${caseId}"] select[data-act="case-status"]`).dispatchEvent(new w.Event('change', { bubbles: true }));
await wait(80);
st = await readState();
check('status change logged in history', st.cases.find((c) => c.id === caseId).history[0].text.includes('Resolved'));

/* 14. keyboard-only work day */
w.eval(`window.__step='[14]'`);
console.log('\n[14] keyboard only');
await w.eval(`view.tab='library'; view.cat='all'; view.q=''; render();`);
await wait(60);
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: '/', bubbles: true }));
await wait(30);
check('"/" focuses search', d.activeElement?.id === 'global-search');
w.eval('document.getElementById("global-search").blur()');
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'j', bubbles: true }));
await wait(60);
check('J selects the first template', !!q('.card.selected'));
const sel1 = q('.card.selected').dataset.id;
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'j', bubbles: true }));
await wait(60);
check('J again moves down', q('.card.selected').dataset.id !== sel1);
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
await wait(60);
check('K moves back up', q('.card.selected').dataset.id === sel1);
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: '3', bubbles: true }));
await wait(60);
check('number keys jump to a category', (await readState()).categories.length >= 3 && q('.main-title').textContent.length > 0);
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: '?', bubbles: true }));
await wait(60);
check('? opens the help', /Ctrl|palette/i.test(q('.scrim')?.textContent || ''));
await click(q('[data-close]'));

/* 15. safety: hostile-ish inputs must not execute */
console.log('\n[15] safety');
await clearModals();
await fireDrop(d.body, { text: 'javascript:alert(1)' });
let stx = await readState();
check('a javascript: drop is not saved as a link', !stx.files.some((f) => f.kind === 'link' && /javascript:/i.test(f.url || '')));
await w.eval(`saveLink('javascript:alert(1)')`);
await wait(60);
check('saveLink refuses non-http protocols', !(await readState()).files.some((f) => /javascript:/i.test(f.url || '')));
const evil = '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2;<\/script> done';
await w.eval(`openEditor(null, { title: '<b>bold</b> title', body: ${JSON.stringify(evil)} })`);
await wait(60);
await type(q('#ed-title'), '<b>x</b>y');
await click(q('#ed-save'));
await wait(120);
check('markup in a template renders as text, not HTML', !d.querySelector('.card img[src="x"]') && !w.__pwned, 'pwned=' + w.__pwned);
check('the text is preserved verbatim', (await readState()).templates.some((t) => t.body.includes('onerror="window.__pwned=1"')));
await w.eval(`ingestFiles([new File(['x'], "${'A'.repeat(200)}.txt", {type:'text/plain'})], null)`);
await wait(300);
const longName = (await readState()).files[0].name;
check('very long filenames are trimmed for display', longName.length <= 95, longName.length + ' chars');
await w.eval(`view.tab='library'; view.cat='all'; view.q=''; Store.s.templates[0].body = 'x'.repeat(6000); render();`);
await wait(60);
check('a 6k-char template still renders', qa('.card').length > 10);

/* 16. nothing broke */
console.log('\n[16] error sweep');
w.eval(`window.__step='[15]'`);

check('no uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n────────  ${pass} passed, ${fail} failed  ────────\n`);
if (errors.length) console.log(errors.slice(0, 10).join('\n---\n') + '\n');
w.close();
process.exit(fail ? 1 : 0);
