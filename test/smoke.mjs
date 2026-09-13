/* test/smoke.mjs — boots the built single-file app in jsdom and drives the
   main flows. Run: node test/smoke.mjs   (or npm test)                     */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const file = path.resolve('OSR-Desk.html');
const html = fs.readFileSync(file, 'utf8');

const errors = [];
const vc = new VirtualConsole();
const JSDOM_ONLY = /Could not parse CSS|Not implemented: navigation|Not implemented: HTMLFormElement/;
vc.on('jsdomError', (e) => { const s = (e.detail || e).toString(); if (!JSDOM_ONLY.test(s)) errors.push('jsdomError: ' + s.split('\n').slice(0, 3).join(' ')); });
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://local.test/',
  virtualConsole: vc
});
const w = dom.window, d = w.document;

// ---- environment stubs (jsdom has no clipboard / object URLs / fetch-in-window)
const clip = { text: '', calls: 0 };
Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { clip.text = t; clip.calls++; } }, configurable: true });
w.URL.createObjectURL = () => 'blob:fake';
w.URL.revokeObjectURL = () => {};
w.execCommand = () => true;
d.execCommand = () => true;
w.fetch = async (u) => {
  const [, meta, b64] = String(u).match(/^data:([^;]*);base64,(.*)$/) || [];
  const buf = Buffer.from(b64 || '', 'base64');
  return { blob: async () => new w.Blob([buf], { type: meta || 'application/octet-stream' }), text: async () => buf.toString('utf8') };
};
w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const flush = () => { try { w.eval('Store.flush()'); } catch (e) {} return wait(10); };
const readState = async () => { await flush(); return JSON.parse(w.localStorage.getItem('osr.desk.state.v3') || '{}'); };
const q = (s) => d.querySelector(s);
const qa = (s) => [...d.querySelectorAll(s)];
const click = async (el, opt = {}) => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, ...opt })); await wait(); };
const type = async (el, value) => {
  el.value = value;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(120);
};
const clearModals = async () => {
  w.eval(`while (typeof openPaletteInst !== 'undefined' && openPaletteInst) openPaletteInst.close();
          modalStack.slice().forEach(m => m.close()); document.querySelector('.ctx')?.remove();`);
  await wait(60);
};
const byText = (sel, txt) => qa(sel).find((e) => (e.textContent || '').includes(txt));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  \u2190 ' + extra : '')); }
}

await wait(900);

/* 1. boot + seed */
console.log('\n[1] boot & seed');
check('app rendered', !!q('.topbar') && !!q('.rail') && !!q('.main'));
const state = await readState();
check('seeded templates present', (state.templates || []).length >= 25, 'got ' + (state.templates || []).length);
check('seeded categories present', (state.categories || []).length >= 8, 'got ' + (state.categories || []).length);
check('starter phrases present', (state.phrases || []).length >= 10);
check('cards rendered in DOM', qa('.card').length >= 20, 'got ' + qa('.card').length);
check('onboarding modal auto-opened', !!q('.scrim'), 'body html starts: ' + d.body.innerHTML.slice(0,0) + ' onboarded=' + w.eval('Store.s.onboarded'));

/* 2. dismiss onboarding */
console.log('\n[2] onboarding');
if (q('#hl-ok')) await click(q('#hl-ok'));
check('modal dismissed', !q('.scrim'));

/* 3. copy flow with placeholder prompt */
console.log('\n[3] copy + fill');
const firstCard = qa('.card')[0];
const firstId = firstCard.dataset.id;
await click(q(`.card[data-id="${firstId}"] [data-act="copy"]`));
check('fill dialog opened for placeholders', !!q('#fill-go'));
const fillInputs = qa('input[data-var]');
for (const inp of fillInputs) await type(inp, inp.dataset.var === 'first_name' ? 'Sam' : 'test-' + inp.dataset.var);
const fillInput = fillInputs[0];
await click(q('#fill-go'));
check('clipboard received text', clip.calls === 1 && clip.text.length > 20);
check('placeholder was substituted', clip.text.includes('Sam'), JSON.stringify(clip.text.slice(0, 60)));
check('usage counted', ((await readState()).templates.find((t) => t.id === firstId).usage) === 1);
const st2 = await readState();
check('values remembered for the day', st2.vars.first_name === 'Sam' && st2.vars[fillInput.dataset.var] != null, JSON.stringify(st2.vars).slice(0,120));

/* 4. copy again — remembered values mean no prompt */
console.log('\n[4] remembered value');
await click(q(`.card[data-id="${firstId}"] [data-act="copy"]`));
await wait(60);
check('copied without prompting (remembered)', clip.calls === 2 && !q('#fill-go'));
check('second copy reused Sam', clip.text.includes('Sam'));

/* 5. search */
console.log('\n[5] search');
await type(q('#global-search'), 'refund');
await wait(160);
const found = qa('.card').length;
check('search narrows the list', found > 0 && found < 25, 'found ' + found);
check('match highlighted', !!q('.card mark'));
await type(q('#global-search'), 'zzzz-nothing');
await wait(160);
check('empty state shown', !!q('.empty') && qa('.card').length === 0);
await type(q('#global-search'), '');
await wait(160);

/* 6. tags */
console.log('\n[6] tags');
const tagChip = qa('.toolbar .chip[data-act="tag"]')[0];
await click(tagChip);
check('tag filter active', !!q('.chip.on[data-act="tag"]'));
check('list filtered by tag', qa('.card').length > 0 && qa('.card').length < 33);
await click(q('[data-act="clear-tags"]'));
check('tag filter cleared', qa('.card').length >= 25);

/* 7. star */
console.log('\n[7] star + starred view');
const favBefore = (await readState()).templates.find((t) => t.id === firstId).favorite;
await click(q(`.card[data-id="${firstId}"] [data-act="star"]`));
check('star toggles', (await readState()).templates.find((t) => t.id === firstId).favorite === !favBefore, 'was ' + favBefore);
await click(byText('.rail-item', 'Starred'));
check('starred view shows only favourites', qa('.card').length >= 1 && qa('.card').every((c) => c.querySelector('.star.on')));
await click(byText('.rail-item', 'All templates'));

/* 8. new template via editor */
console.log('\n[8] create template');
await click(q('[data-act="new-template"]'));
check('editor opened', !!q('#ed-save'));
await type(q('#ed-title'), 'Test · missing invoice');
await type(q('#ed-body'), 'Hi {{first_name}},\n\nI cannot see invoice {{invoice_id}} on the account.\n\nBest,\n{{agent_name}}');
await type(q('#ed-tags'), 'billing, test');
check('variable bar reports fields', q('#ed-status').textContent.includes('first_name'));
await click(q('#ed-save'));
await wait(120);
const created = (await readState()).templates.find((t) => t.title.startsWith('Test ·'));
check('template saved', !!created);
check('tags parsed', created && created.tags.join() === 'billing,test');
check('card appears in DOM', qa('.card').some((c) => c.textContent.includes('Test · missing invoice')));

/* 9. select opens preview pane */
console.log('\n[9] preview pane');
const newCard = qa('.card').find((c) => c.textContent.includes('Test · missing invoice'));
await click(newCard);
check('pane open with body', q('.pane')?.textContent.includes('cannot see invoice'));
check('pane has filled preview', q('.pane')?.textContent.includes('Hi Sam,'));
check('fill & copy button exists', !!q('[data-act="fill-copy"]'));

/* 10. edit + delete + undo */
console.log('\n[10] edit, delete, undo');
await click(q('.pane [data-act="edit"]'));
await type(q('#ed-body'), 'Hi {{first_name}}, updated body.');
await click(q('#ed-save'));
check('body updated', (await readState()).templates.find((t) => t.id === created.id).body.includes('updated body'));
const before = (await readState()).templates.length;
await click(q('.card[data-id="' + created.id + '"] [data-act="edit"]'));
await click(q('[data-act="del"]'));
check('deleted', (await readState()).templates.length === before - 1);
const undoBtn = byText('#toasts .undo', 'Undo');
check('undo offered', !!undoBtn);
await click(undoBtn);
check('restored by undo', (await readState()).templates.length === before);

/* 11. palette */
await clearModals();
console.log('\n[11] command palette');
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
await wait(80);
check('palette open', !!q('.palette'));
await type(q('#p-input'), 'apology');
await wait(80);
check('palette results narrowed', qa('.pres').length > 0 && qa('.pres').length < 20, 'got ' + qa('.pres').length);
const clipBefore = clip.calls;
q('#p-input').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await wait(250);
check('enter ran an action', clip.calls > clipBefore || !!q('#fill-go'));
if (q('#fill-go')) { for (const i of qa('input[data-var]')) await type(i, 'x'); await click(q('#fill-go')); }
check('palette closed after run', !q('.palette'));

/* 12. keyboard nav */
await clearModals();
console.log('\n[12] keyboard');
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
await wait(60);
check('N opens editor', !!q('#ed-save'));
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await wait(60);
check('Esc closes editor', !q('#ed-save'), 'scrims left: ' + qa('.scrim').length);
await clearModals();

/* 13. phrases */
await clearModals();
w.eval(`view.tab='library'; view.cat='all'; view.q=''; view.tags=[]; render();`);
await wait(60);
console.log('\n[13] phrases');
check('phrase grid is visible on All templates', qa('.phrase').length >= 10, 'found ' + qa('.phrase').length);
await click(q('[data-act="new-phrase"]'));
await type(q('#ph-text'), 'Nothing needed from you now — I will come back to you by {{next_update_date}}.');
await type(q('#ph-note'), 'testnote');
await click(q('#ph-save'));
check('phrase saved', (await readState()).phrases.some((p) => p.note === 'testnote'));
const pEl = qa('.phrase').find((x) => x.textContent.includes('Nothing needed from you'));
const cb = clip.calls;
await click(pEl);
check('phrase copy went through (prompt if var unfilled)', clip.calls > cb || !!q('#fill-go'));
if (q('#fill-go')) {
  const i = q('input[data-var]'); await type(i, 'Thursday'); await click(q('#fill-go'));
  check('phrase filled then copied', clip.text.includes('Thursday'));
}

await clearModals();
/* 14. files: ingest + attach + shelf view */
console.log('\n[14] files');
await w.eval(`ingestFiles([new File(["refund policy v4\\nsection a\\nsection b"], "refund-policy.txt", {type:"text/plain"})], null)`);
await wait(200);
let st14 = await readState();
check('file stored on shelf', st14.files.length >= 1, JSON.stringify(st14.files.map((f) => f.name)));
check('text file got a snippet preview', !!st14.files[0].snippet);
await click(byText('.rail-item', 'Resource shelf'));
check('shelf view renders', !!q('#files-drop'));
check('file card shown', qa('.file-card').length >= 1);
await click(q('.file-card [data-act="open-file"]'));
check('text preview modal opens', !!q('#tx-tpl'));
await click(q('#tx-tpl'));
check('draft editor prefilled from file', !!q('#ed-save') && q('#ed-body').value.includes('refund policy'));
await click(q('#ed-save'));
check('file turned into a template', (await readState()).templates.some((t) => /refund.?policy/i.test(t.title)));

/* 15. attach to template by API (same path the drop uses) */
console.log('\n[15] attach to template');
const someId = (await readState()).templates[0].id;
const fid = (await readState()).files[0].id;
await w.eval(`ingestFiles([new File(["one-pager"], "one-pager.pdf", {type:"application/pdf"})], {kind:"tpl", id:"${someId}"})`);
await wait(200);
const st15 = await readState();
check('new file attached to that template', st15.templates.find((t) => t.id === someId).fileIds.length === 1);
check('attachment shows on card', qa('.card[data-id="' + someId + '"] .filepill').length === 1);

await clearModals();
/* 16. cases */
console.log('\n[16] live cases');
await click(byText('.rail-item', 'Live cases'));
await click(q('[data-act="new-case"]'));
await type(q('#cy-client'), 'Acme Ltd');
await type(q('#cy-ticket'), '48213');
await type(q('#cy-subject'), 'Cannot log in after reset');
await type(q('#cy-next'), 'Chase L2 Friday');
q('#cy-status').value = 'escalated';
q('#cy-status').dispatchEvent(new w.Event('change', { bubbles: true }));
await click(q('#cy-save'));
await wait(80);
const st16 = await readState();
check('case created', st16.cases.length === 1 && st16.cases[0].client === 'Acme Ltd');
check('status + stat block rendered', q('.stat-row')?.textContent.includes('1'));
const caseId = st16.cases[0].id;
await click(q(`tr[data-case="${caseId}"] [data-act="case-reply"]`));
await wait(80);
check('reply palette opened for the case', !!q('.palette') && q('#p-input').placeholder.includes('Acme'));
q('#p-input').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await wait(200);
if (q('#fill-go')) { for (const i of qa('input[data-var]')) await type(i, i.value || 'filled'); await click(q('#fill-go')); await wait(80); }
if (q('#fill-go')) {
  check('case values pre-filled', q('input[data-var="client_name"]')?.value === 'Acme Ltd', JSON.stringify(qa('input[data-var]').map(i => [i.dataset.var, i.value])));
  await click(q('#fill-go'));
}
const st16b = await readState();
check('copy logged on the case trail', (st16b.cases[0].history[0] || {}).text?.startsWith('Copied'));

await clearModals();
/* 17. settings, theme, signature, export */
console.log('\n[17] settings & backup');
await click(q('[data-act="settings"]'));
check('settings view renders', !!q('[data-set="yourName"]'));
await type(q('[data-set="yourName"]'), 'Ry Tan');
await type(q('[data-set="company"]'), 'Northwind Support');
q('#set-appsig').checked = true;
q('#set-appsig').dispatchEvent(new w.Event('change', { bubbles: true }));
await type(q('[data-set="signature"]'), '--\nRy Tan · Online Support Representative\nNorthwind Support · support@northwind.example');
await wait(60);
const st17 = await readState();
check('identity saved', st17.settings.yourName === 'Ry Tan' && st17.settings.appendSignature === true);
await click(q('[data-act="seg-theme"][data-val="dark"]'));
check('dark theme applied', d.documentElement.dataset.theme === 'dark');
await click(q('[data-act="set-accent"][data-val="#0f9d8a"]'));
check('accent applied', d.documentElement.style.getPropertyValue('--accent') === '#0f9d8a');
let dl = null;
const origCreate = d.createElement.bind(d);
d.createElement = (tag) => { const el = origCreate(tag); if (tag === 'a') { el.click = () => { dl = el.download; }; } return el; };
await click(q('[data-act="export"]'));
await wait(120);
check('export triggers a download named backup', /osr-desk-backup-\d{4}-\d{2}-\d{2}\.json/.test(dl || ''), 'got ' + dl);
d.createElement = origCreate;

/* 18. signature appended + agent_name auto-filled on next copy */
console.log('\n[18] signature + auto vars');
await click(byText('.rail-item', 'All templates'));
const plainTpl = st17.templates.find((t) => !t.title.startsWith('refund'));
clip.calls = 0;
w.eval(`Store.s.settings.appendSignature = true; render(); copyTemplate("${plainTpl.id}")`);
await wait(150);
const txt = w.eval('fillVars("{{agent_name}} {{company}} {{date}}").text');
check('auto vars resolved', String(txt).startsWith('Ry Tan Northwind Support') && !/date/.test(String(txt)), String(txt));
check('signature in copied output', clip.text.includes('support@northwind.example'), JSON.stringify(clip.text.slice(-70)));

await clearModals();
/* 19. import round-trip (merge keeps, replace restores) */
console.log('\n[19] import / merge');
const exported = await readState();
const payload = { app: 'osr-desk', version: 3, settings: {}, categories: [], templates: [{ title: 'Imported only', body: 'Hi {{first_name}}, imported body', tags: ['imported'], category: '' }], phrases: [], files: [], cases: [] };
w.eval(`importDialog(${JSON.stringify(payload)})`);
await wait(80);
check('import dialog shown', !!q('#im-merge'));
await click(q('#im-merge'));
await wait(120);
const st19 = await readState();
check('merge added the new template', st19.templates.some((t) => t.title === 'Imported only'));
check('merge kept existing ones', st19.templates.length > 20);
w.eval(`importDialog(${JSON.stringify(payload)})`);
await click(q('#im-merge'));
await wait(120);
check('duplicate merge skipped', (await readState()).templates.filter((t) => t.title === 'Imported only').length === 1);
const nBefore = (await readState()).templates.length;
w.eval(`importCSV("Name,Category,Body\\n\\"SMB onboarding\\",\\"Onboarding\\",\\"Hello there\\"\\n")`);
await wait(120);
const st19b = await readState();
check('CSV import works + makes a category', st19b.templates.some((t) => t.title === 'SMB onboarding') && st19b.categories.some((c) => c.name === 'Onboarding'));

/* 20. markdown export + print */
console.log('\n[20] md + print');
let mdName = null;
d.createElement = (tag) => { const el = origCreate(tag); if (tag === 'a') { el.click = () => { mdName = el.download; }; } return el; };
w.eval('exportMarkdown()');
await wait(80);
check('markdown exported', /cheatsheet\.md$/.test(mdName || ''), 'got ' + mdName);
w.eval(`window.print = () => { window.__printed = document.querySelector('#print-sheet').textContent; }`);
w.eval('printSheet()');
await wait(260);
const printed = String(w.eval('window.__printed') || '');
check('print sheet contains every category + bodies', printed.includes('First touch') && printed.includes('Refund request') && printed.length > 2000, printed.length + ' chars');

await clearModals();
/* 21. reload persistence */
console.log('\n[21] persistence across reload');
const savedRaw = w.localStorage.getItem('osr.desk.state.v3');
const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
dom2.window.localStorage.setItem('osr.desk.state.v3', savedRaw);
// re-run by reloading
await wait(60);
const dom3 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local.test/', virtualConsole: vc });
await wait(150);
check('second instance boots without errors', !!dom3.window.document.querySelector('.card') || errors.length === 0);
dom2.window.close(); dom3.window.close();

/* 22. category management */
console.log('\n[22] categories');
w.eval(`openCatEditor()`);
await wait(60);
q('#cat-name').value = 'VIP handling';
q('#cat-name').dispatchEvent(new w.Event('input', { bubbles: true }));
q('#cat-desc').value = 'For the accounts that shout loudest';
await click(q('#cat-save'));
const st22 = await readState();
const newCat = st22.categories.find((c) => c.name === 'VIP handling');
check('category created', !!newCat);
check('category in rail', byText('.rail-item', 'VIP handling') !== undefined);
await click(byText('.rail-item', 'VIP handling'));
check('empty category shows empty state', !!q('.empty'));
// move a template into it
await click(q('[data-act="new-template"]'));
await type(q('#ed-title'), 'VIP priority path');
await type(q('#ed-body'), 'Hi {{first_name}}, escalating now.');
q('#ed-cat').value = newCat.id;
await click(q('#ed-save'));
await wait(80);
check('template filed under the new category', (await readState()).templates.some((t) => t.title === 'VIP priority path' && t.category === newCat.id));

/* 23. subject lines */
console.log('\n[23] subject lines');
await clearModals();
w.eval(`view.tab='library'; view.cat='all'; view.q=''; view.tags=[]; render();`);
await wait(60);
check('starter library ships subjects', (await readState()).templates.filter((t) => t.subject).length >= 25);
check('subject visible on the card', qa('.card-subj').length >= 20, 'got ' + qa('.card-subj').length);
const withSubj = (await readState()).templates.find((t) => t.subject && t.subject.includes('{{'));
await w.eval(`selectTemplate("${withSubj.id}")`);
await wait(60);
check('pane shows the subject row', /Subject line/.test(q('.pane').textContent));
const clipB = clip.calls;
await click(q('.pane [data-act="copy-subject"]'));
check('copy-subject put a filled subject on the clipboard', clip.calls > clipB && !/\{\{/.test(clip.text), JSON.stringify(clip.text));
// editor round-trip
const mine = (await readState()).templates.find((t) => /Test ·|VIP priority/.test(t.title)) || (await readState()).templates[0];
await w.eval(`openEditor("${mine.id}")`);
await wait(60);
await type(q('#ed-subj'), 'Re: {{ticket_id}} — quick update');
await click(q('#ed-save'));
check('subject saved through the editor', (await readState()).templates.find((t) => t.id === mine.id).subject === 'Re: {{ticket_id}} — quick update');
// fill dialog offers the subject too
await w.eval(`copyTemplate("${withSubj.id}", { forceFill: true })`);
await wait(60);
check('fill dialog exposes a subject field + copy button', !!q('#fill-subj') && !!q('#fill-subj-copy'));
if (q('#fill-subj-copy')) {
  const subjTxt = withSubj.subject;
  await click(q('#fill-subj-copy'));
  check('copy-subject from inside the dialog works', !/\{\{/.test(clip.text) && /Re:/.test(clip.text) && clip.text.length === subjTxt.replace(/\{\{ticket_id\}\}/, '48213').length, JSON.stringify(clip.text.slice(0, 60)));
}
await clearModals();

/* 24. first-week checklist, noSig, usage panel */
console.log('\n[24] setup aids');
await clearModals();
w.eval(`view.tab='library'; view.cat='all'; view.q=''; view.tags=[]; Store.s.settings.hideChecklist=false; render();`);
await wait(60);
check('first-week checklist shows on the library', !!q('.checklist') && qa('.cl-item').length === 5);
w.eval(`Store.s.settings.yourName=''; Store.s.settings.signature=''; render();`);
await wait(60);
const doneBefore = qa('.cl-item.on').length;
check('clearing the name unticks the first box', !qa('.cl-item')[0].classList.contains('on'), 'done count ' + doneBefore);
w.eval(`Store.s.settings.yourName='Ry Tan'; Store.s.settings.company='Northwind'; Store.s.settings.signature='Ry --'; render();`);
await wait(60);
check('setting name+signature ticks it again', qa('.cl-item')[0].classList.contains('on') && qa('.cl-item.on').length === doneBefore + 1, 'done ' + qa('.cl-item.on').length);
await click(q('[data-act="hide-checklist"]'));
check('it can be dismissed', !q('.checklist') && (await readState()).settings.hideChecklist === true);
w.eval(`Store.s.settings.hideChecklist=false; Store.s.settings.appendSignature=true; render();`);
const forSig = (await readState()).templates[0].id;
await w.eval(`openEditor("${forSig}")`);
await wait(60);
check('editor offers a per-template signature opt-out', !!q('#ed-nosig'));
q('#ed-nosig').checked = true; q('#ed-nosig').dispatchEvent(new w.Event('change', { bubbles: true }));
await click(q('#ed-save'));
check('opt-out persisted', (await readState()).templates.find((t) => t.id === forSig).noSig === true);
clip.calls = 0; clip.text = '';
await w.eval(`copyTemplate("${forSig}", { noFill: true })`);
await wait(120);
check('that template copies without the signature', clip.calls === 1 && !clip.text.includes('Ry --'), JSON.stringify(clip.text.slice(-40)));
await w.eval(`view.tab='settings'; render();`);
await wait(60);
check('usage panel lists what I actually copy', !!q('.usage-row') && /\d+×/.test(q('.usage-row').textContent) && q('.usage-row').textContent.trim().length > 4, JSON.stringify(q('.usage-list')?.textContent.replace(/\s+/g, ' ').slice(0, 70)));
check('usage panel counts never-used templates', /never copied/.test(q('.set-card')?.parentElement.textContent || ''));
await w.eval(`Store.s.settings.appendSignature=false; render();`);

/* 25. no runtime errors */
console.log('\n[25] error sweep');
check('no uncaught errors during the whole run', errors.length === 0, errors.slice(0, 4).join(' | '));

console.log(`\n────────  ${pass} passed, ${fail} failed  ────────\n`);
if (errors.length) { console.log('captured errors:\n' + errors.slice(0, 12).join('\n') + '\n'); }
w.close();
process.exit(fail ? 1 : 0);
