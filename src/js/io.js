/* =========================================================
   io.js — palette, settings, import/export, print, help,
   event dispatch, boot
   ========================================================= */

/* ---------- action dispatcher ---------- */
function handleAct(act, id, el, e) {
  if (!act) return;
  if (act.startsWith('tab:')) { view.tab = act.slice(4); view.railOpen = false; render(); return; }
  if (act.startsWith('cat:')) { view.tab = 'library'; view.cat = act.slice(4); view.railOpen = false; render(); return; }

  switch (act) {
    case 'select': if (view.selected === id && window.innerWidth > 1080) { } selectTemplate(id); break;
    case 'copy': case 'fill-copy': e?.stopPropagation(); copyTemplate(id, { forceFill: act === 'fill-copy' }); break;
    case 'copy-phrase': {
      const p = Store.s.phrases.find((x) => x.id === id);
      if (!p) break;
      const missing = fillVars(p.text).missing;
      if (missing.length) openFillDialog(p, p.text, missing, { kind: 'ph' });
      else doCopy(p.text, { source: id, kind: 'ph' });
      break;
    }
    case 'recopy': {
      if (el.dataset.kind === 'ph') { const p = Store.s.phrases.find((x) => x.id === id); if (p) doCopy(p.text, { source: id, kind: 'ph' }); }
      else copyTemplate(id);
      break;
    }
    case 'edit': e?.stopPropagation(); openEditor(id); break;
    case 'dup': {
      const t = Q.template(id);
      if (t) {
        const nid = uid('tpl');
        Store.edit((st) => st.templates.unshift({ ...JSON.parse(JSON.stringify(t)), id: nid, title: t.title + ' (copy)', usage: 0, order: (t.order || 1) - 0.5, createdAt: nowISO(), updatedAt: nowISO(), favorite: false }), 'data');
        Bus.toast('Duplicated', 'ok', 1600);
        selectTemplate(nid);
      }
      break;
    }
    case 'del': e?.stopPropagation(); deleteTemplate(id); modalStack.forEach((m) => m.close()); break;
    case 'star': {
      e?.stopPropagation();
      const t = Q.template(id);
      if (t) { Store.edit((st) => { const x = st.templates.find((y) => y.id === id); x.favorite = !x.favorite; }, 'data'); }
      break;
    }
    case 'tag': {
      const tag = el.dataset.tag;
      view.tags = view.tags.includes(tag) ? view.tags.filter((x) => x !== tag) : [...view.tags, tag];
      if (view.tab !== 'library') view.tab = 'library';
      render();
      break;
    }
    case 'clear-tags': view.tags = []; render(); break;
    case 'clear-search': view.q = ''; render(); break;
    case 'new-template': openEditor(); break;
    case 'new-phrase': openPhraseEditor(); break;
    case 'add-cat': openCatEditor(); break;
    case 'edit-cat': openCatEditor(id); break;
    case 'del-cat': openCatEditor(id); break;
    case 'settings': view.tab = 'settings'; render(); break;
    case 'toggle-rail': view.railOpen = !view.railOpen; render(); break;
    case 'toggle-railhide': toggleRail(); break;
    case 'palette': openPalette(); break;
    case 'help': openHelp(); break;
    case 'print': printSheet(); break;
    case 'export': doExport(el.dataset.includeFiles === '1'); break;
    case 'export-md': exportMarkdown(); break;
    case 'import': pickFile('.json,.csv,text/plain', importFile); break;
    case 'pick-files':
      e?.stopPropagation();
      pickFile('*', async (f) => {
        const target = el?.dataset.target ? (() => { const [k, tid] = el.dataset.target.split(':'); return { kind: k, id: tid }; })() : null;
        await ingestFiles(f, target);
      });
      break;
    case 'drop-files': view.tab = 'files'; render(); Bus.toast('Drop zone is on the “files” page — or just drop anywhere in this window', '', 3400); break;
    case 'add-link': openLinkDialog(); break;
    case 'open-file': e?.stopPropagation(); openFile(id); break;
    case 'download-file': e?.stopPropagation(); downloadFile(id); break;
    case 'del-file': e?.stopPropagation(); deleteFile(id); break;
    case 'rename-file': e?.stopPropagation(); fileOptions(id); break;
    case 'use-file': e?.stopPropagation(); fileOptions(id); break;
    case 'detach': unlinkFile({ kind: 'tpl', id: el.dataset.tpl }, id); break;
    case 'attach-to':
      pickFile('*', async (f) => { await ingestFiles(f, { kind: 'tpl', id }); });
      break;
    case 'new-case': openCaseEditor(); break;
    case 'edit-case': openCaseEditor(id); break;
    case 'del-case': openCaseEditor(id); break;
    case 'case-reply': caseReply(id); break;
    case 'clear-resolved': {
      const n = Store.s.cases.filter((c) => c.status === 'resolved').length;
      if (!n) { Bus.toast('Nothing resolved to clear'); break; }
      const snap = JSON.parse(JSON.stringify(Store.s));
      Store.edit((st) => { st.cases = st.cases.filter((c) => c.status !== 'resolved'); }, 'data');
      Bus.toast('Cleared ' + n + ' resolved case' + (n > 1 ? 's' : ''), 'ok', 6000, { label: 'Undo', fn() { Store.replaceAll(snap); } });
      break;
    }
    case 'set-accent': Store.edit((st) => { st.settings.accent = el.dataset.val; }, 'ui'); applyTheme(); render(); break;
    case 'seg-theme': Store.edit((st) => { st.settings.theme = el.dataset.val; }, 'ui'); applyTheme(); render(); break;
    case 'seg-density': Store.edit((st) => { st.settings.density = el.dataset.val; }, 'ui'); applyTheme(); render(); break;
    case 'fill-var': editVar(el.dataset.key); break;
    case 'close-pane': view.selected = null; render(); break;
    case 'hide-checklist': Store.edit((st) => { st.settings.hideChecklist = true; }, 'data'); Bus.toast('Checklist hidden — Settings → “Show me the 30-second tour” brings the guidance back', '', 3000); break;
    case 'copy-subject': {
      const t = Q.template(id);
      if (!t) break;
      if (!t.subject) { openEditor(id); setTimeout(() => document.getElementById('ed-subj')?.focus(), 60); break; }
      copySubject(t);
      break;
    }
    case 'noop': break;
    case 'reseed': reseed(); break;
    case 'wipe': wipe(); break;
    case 'skip-fill': break;
    default: break;
  }
}

function toggleRail() {
  Store.edit((st) => { st.settings.hideRail = !st.settings.hideRail; }, 'ui');
  applyChrome();
  Bus.toast(Store.s.settings.hideRail ? 'Sidebar hidden — Ctrl+B brings it back' : 'Sidebar back', '', 1800);
}
function applyChrome() {
  const app = document.getElementById('app');
  if (!app) return;
  app.classList.toggle('rail-hidden', !!Store.s.settings.hideRail && window.innerWidth > 760);
}

function caseReply(caseId) {
  const c = Store.s.cases.find((x) => x.id === caseId);
  if (!c) return;
  openPalette({ filter: 'tpl', prefs: caseVars(c), caseId, title: 'Reply to ' + (c.client || c.ticket || 'this case') });
}

/* ---------- command palette ---------- */
let openPaletteInst = null;
function openPalette(opts = {}) {
  if (openPaletteInst) openPaletteInst.close();
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="palette">
    <input id="p-input" placeholder="${esc(opts.title ? 'Pick a reply template — ' + opts.title : 'Search templates, phrases, files, cases, or type a command…')}" autocomplete="off" spellcheck="false">
    <div class="results" id="p-results"></div>
    <div class="palette-foot">
      <span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> copy</span><span><kbd>⌥/Alt</kbd>+<kbd>Enter</kbd> edit</span>
      <span><kbd>Esc</kbd> close</span><span style="margin-left:auto">${Store.s.templates.length} templates ready</span>
    </div>
  </div>`;
  document.body.appendChild(scrim);
  const inst = {
    scrim,
    close() { scrim.remove(); openPaletteInst = null; }
  };
  openPaletteInst = inst;
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) inst.close(); });

  const input = scrim.querySelector('#p-input');
  const box = scrim.querySelector('#p-results');
  let items = [];
  let sel = 0;

  function build(q) {
    const s = Store.s;
    const out = [];
    if (opts.filter === 'tpl') {
      s.templates.forEach((t) => out.push({
        icon: ICON.copy, t: t.title, s: Q.categoryName(t.category) + (t.usage ? ' · used ' + t.usage + '×' : ''),
        hay: matchHay(t, ''), run: () => { inst.close(); copyTemplatePreferFill(t.id, opts); }, edit: () => { inst.close(); openEditor(t.id); }
      }));
    } else {
      s.templates.forEach((t) => out.push({
        icon: ICON.copy, t: t.title, s: Q.categoryName(t.category) + (t.usage ? ' · used ' + t.usage + '×' : ''),
        hay: matchHay(t, ''), run: () => { inst.close(); selectTemplate(t.id); copyTemplate(t.id); },
        edit: () => { inst.close(); openEditor(t.id); }, group: 'Templates'
      }));
      s.phrases.forEach((p) => out.push({
        icon: ICON.quote, t: p.text.slice(0, 76), s: (p.note || 'phrase') + (p.usage ? ' · ' + p.usage + '×' : ''),
        hay: (p.text + ' ' + (p.note || '')).toLowerCase(), run: () => { inst.close(); doCopy(p.text, { source: p.id, kind: 'ph' }); }, group: 'Phrases'
      }));
      s.files.forEach((f) => out.push({
        icon: ICON.file, t: f.name, s: f.kind === 'link' ? 'saved link' : bytes(f.size),
        hay: (f.name + ' ' + (f.note || '')).toLowerCase(), run: () => { inst.close(); openFile(f.id); }, group: 'Shelf'
      }));
      s.cases.filter((c) => c.status !== 'resolved').forEach((c) => out.push({
        icon: ICON.cases, t: (c.client || 'case') + (c.ticket ? ' · ' + c.ticket : ''), s: c.subject || CASE_STATUS.find((x) => x[0] === c.status)?.[1] || '',
        hay: [c.client, c.ticket, c.subject, c.notes].join(' ').toLowerCase(), run: () => { inst.close(); view.tab = 'cases'; render(); openCaseEditor(c.id); }, group: 'Cases'
      }));
      const acts = [
        ['New template', ICON.plus, () => { inst.close(); openEditor(); }],
        ['New phrase', ICON.quote, () => { inst.close(); openPhraseEditor(); }],
        ['New case', ICON.cases, () => { inst.close(); openCaseEditor(); }],
        ['Save a link to the shelf', ICON.open, () => { inst.close(); openLinkDialog(); }],
        ['Add files (or just drop them anywhere)', ICON.file, () => { inst.close(); view.tab = 'files'; render(); pickFile('*'); }],
        ['Export a backup', ICON.download, () => { inst.close(); doExport(); }],
        ['Import / merge a backup', ICON.arrow, () => { inst.close(); pickFile('.json,.csv', importFile); }],
        ['Print cheat sheet', ICON.lib, () => { inst.close(); printSheet(); }],
        ['Settings', ICON.gear, () => { inst.close(); view.tab = 'settings'; render(); }],
        ['Toggle dark / light', ICON.bolt, () => { inst.close(); toggleTheme(); }],
        ['Keyboard shortcuts', ICON.open, () => { inst.close(); openHelp(); }]
      ];
      acts.forEach(([t, ic, run]) => out.push({ icon: ic, t, s: 'command', hay: 'command ' + t.toLowerCase(), run, group: 'Actions' }));
    }
    const q2 = q.trim().toLowerCase();
    let list = out;
    if (q2) {
      const words = q2.split(/\s+/);
      list = out.filter((i) => words.every((w) => i.hay.includes(w)));
      list.sort((a, b) => a.hay.indexOf(q2) * -1 === 0 ? 0 : rank(a) - rank(b));
      function rank(i) {
        const head = i.t.toLowerCase().indexOf(q2);
        return (head < 0 ? 60 : head) + (i.group === 'Actions' ? -8 : 0);
      }
    }
    if (!opts.filter) {
      const counts = {};
      list = list.filter((i) => { if (!i.group) return true; counts[i.group] = (counts[i.group] || 0) + 1; return counts[i.group] <= 9; });
    }
    return list.slice(0, 60);
  }
  function draw() {
    const q = input.value;
    items = build(q);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    box.innerHTML = items.length
      ? items.map((i, n) => `<button class="pres ${n === sel ? 'sel' : ''}" data-n="${n}">
          <span class="ic">${i.icon}</span><span class="t">${hl(i.t, q)}</span><span class="s">${esc2(i.s || '')}</span>
          ${i.edit ? '<span class="act">alt+enter edits</span>' : ''}</button>`).join('')
      : `<div style="padding:22px;text-align:center;color:var(--ink-3);font-size:13px">No match. Press Esc, then <b>N</b> to make it a new template.</div>`;
    box.querySelectorAll('.pres').forEach((b) => {
      b.onmouseenter = () => { sel = +b.dataset.n; box.querySelectorAll('.pres').forEach((x) => x.classList.toggle('sel', x === b)); };
      b.onclick = (ev) => { if (ev.altKey && items[+b.dataset.n].edit) items[+b.dataset.n].edit(); else items[+b.dataset.n].run(); };
    });
    sive(box.querySelector('.pres.sel'), { block: 'nearest' });
  }
  sel = 0;
  draw();
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || (ev.key === 'n' && ev.ctrlKey)) { ev.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    else if (ev.key === 'ArrowUp' || (ev.key === 'p' && ev.ctrlKey)) { ev.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); const it = items[sel]; if (!it) { if (input.value.trim()) { inst.close(); openEditor(null, { body: input.value.trim(), title: '' }); } return; } if (ev.altKey && it.edit) it.edit(); else it.run(); }
  });
  setTimeout(() => input.focus(), 20);
}
function copyTemplatePreferFill(id, opts = {}) {
  const t = Q.template(id);
  if (!t) return;
  const body = composedBody(t);
  const keys = varsIn(body);
  const prefs = opts.prefs || {};
  if (!keys.length) { doCopy(body, { source: id }); return; }
  const missing = keys.filter((k) => {
    if (prefs[k] != null && prefs[k] !== '') return false;
    return fillVars('{{' + k + '}}').text === '{{' + k + '}}';
  });
  openFillDialog(t, body, missing, { prefs, caseId: opts.caseId, caseName: opts.caseName });
}

/* ---------- links ---------- */
function openLinkDialog() {
  const m = openModal(`
    <div class="modal-head"><h3>Save a link to the shelf</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
    <div class="modal-body">
      <div class="form-row"><label class="lbl">URL</label><input id="lk-url" class="txt" placeholder="https://…"></div>
      <div class="form-row"><label class="lbl">Label</label><input id="lk-name" class="txt" placeholder="Refund policy (internal wiki)"></div>
      <p class="help">Useful for the docs you get sent to constantly: status page, escalation contacts, refund policy, keyboard-shortcut guide.</p>
    </div>
    <div class="modal-foot"><span class="grow" style="flex:1"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="lk-go">Save</button></div>`, { narrow: true, key: 'link' });
  m.el.querySelector('#lk-go').onclick = () => {
    const url = m.el.querySelector('#lk-url').value.trim();
    if (!/^(https?:|mailto:)/i.test(url)) { Bus.toast('Start it with https:// (or mailto:) — nothing else gets opened automatically', 'warn', 4000); return; }
    Store.edit((st) => st.files.unshift({ id: uid('f'), name: m.el.querySelector('#lk-name').value.trim() || url.replace(/^https?:\/\//, '').slice(0, 40), kind: 'link', url, size: 0, at: nowISO(), note: '' }), 'data');
    m.close();
    Bus.toast('Link saved', 'ok', 1800);
  };
}

function editVar(key) {
  const cur = Store.s.vars[key] ?? (autoValues()[key] || '');
  const m = openModal(`
    <div class="modal-head"><h3>Set a value for <code style="font-family:var(--mono)">{{${esc(key)}}}</code></h3>
      <button class="btn icon ghost" data-close>${ICON.close}</button></div>
    <div class="modal-body">
      <div class="form-row"><label class="lbl">Value OSR Desk will use for you</label>
        <input class="txt" id="ev-val" value="${esc(cur)}" style="font-size:15px"></div>
      <p class="help">This is saved as <b>your</b> default for that placeholder — it gets overwritten any time you type something different in the fill dialog. Useful for <code>{{agent_name}}</code>, <code>{{company}}</code>, the escalation channel you always name, your own SLA wording.</p>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="ev-clear">Forget it</button><span class="grow" style="flex:1"></span>
      <button class="btn" data-close>Cancel</button><button class="btn primary" id="ev-save">${ICON.check} Save value</button></div>`, { narrow: true, key: 'var' });
  m.el.querySelector('#ev-save').onclick = () => {
    Store.edit((st) => { st.vars[key] = m.el.querySelector('#ev-val').value; }, 'data');
    m.close();
    Bus.toast('Saved ' + key + ' for the day', 'ok', 1800);
  };
  m.el.querySelector('#ev-clear').onclick = () => { Store.edit((st) => { delete st.vars[key]; }, 'data'); m.close(); Bus.toast('Value cleared'); };
}

/* ---------- pickers ---------- */
function pickFile(accept, cb) {
  const input = document.createElement('input');
  input.type = 'file';
  if (accept && accept !== '*') input.accept = accept;
  input.multiple = accept !== '.json,.csv' && accept !== '.json,.csv,text/plain';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = () => {
    const fs = [...input.files];
    input.remove();
    if (fs.length) cb ? cb(fs.length === 1 ? fs[0] : fs) : ingestFiles(fs, null);
  };
  input.click();
  setTimeout(() => input.remove(), 30000);
}

/* ---------- export / import ---------- */
function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function doExport(includeFiles) {
  const s = Store.s;
  const out = {
    app: 'osr-desk', version: SCHEMA, exportedAt: nowISO(),
    settings: s.settings, categories: s.categories, templates: s.templates,
    phrases: s.phrases, cases: s.cases, vars: s.vars, activity: [], files: s.files, fileData: {}
  };
  if (includeFiles) {
    Bus.toast('Packing files into the export…', '', 4000);
    for (const f of s.files) {
      if (f.kind === 'link' || f.snippet != null) continue;
      const d = await Store.Vault.exportOne(f.id);
      if (d) out.fileData[f.id] = { name: f.name, mime: f.mime, data: d };
    }
  }
  const stamp = new Date().toISOString().slice(0, 10);
  download(`osr-desk-backup-${stamp}.json`, new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  Bus.toast('Backup saved — put it somewhere synced (OneDrive / Drive / a folder on a stick)', 'ok', 5200);
}
function exportMarkdown() {
  const s = Store.s;
  let md = `# OSR Desk — my support cheat sheet\n\n_${new Date().toLocaleString()} · ${s.templates.length} templates_\n`;
  if (s.settings.yourName) md += `\nBy ${s.settings.yourName}${s.settings.company ? ', ' + s.settings.company : ''}\n`;
  [...s.categories].sort((a, b) => a.order - b.order).forEach((c) => {
    const list = s.templates.filter((t) => t.category === c.id);
    if (!list.length) return;
    md += `\n## ${c.name}\n${c.desc ? '_' + c.desc + '_\n' : ''}`;
    list.forEach((t) => {
      md += `\n### ${t.title}\n${t.tags.length ? '`' + t.tags.join('` `') + '`\n' : ''}${t.subject ? '\n**Subject:** ' + t.subject + '\n' : ''}${t.useWhen ? '\n> ' + t.useWhen + '\n' : ''}\n\n\`\`\`\n${t.body}\n\`\`\`\n`;
    });
  });
  const loose = s.templates.filter((t) => !s.categories.some((c) => c.id === t.category));
  if (loose.length) {
    md += `\n## No category\n`;
    loose.forEach((t) => { md += `\n### ${t.title}\n${t.subject ? '\n**Subject:** ' + t.subject + '\n' : ''}\n\`\`\`\n${t.body}\n\`\`\`\n`; });
  }
  if (s.phrases.length) {
    md += `\n## Grab-and-go lines\n`;
    s.phrases.forEach((p) => { md += `- ${p.text}${p.note ? '  *(' + p.note + ')*' : ''}\n`; });
  }
  download('osr-desk-cheatsheet.md', new Blob([md], { type: 'text/markdown' }));
  Bus.toast('Markdown exported — paste it into your notes app if you ever want to move house', 'ok', 4200);
}

function importFile(file) {
  if (!file) return;
  const name = file.name || '';
  const fr = new FileReader();
  fr.onload = () => {
    const text = String(fr.result);
    if (/\.csv$/i.test(name)) return importCSV(text);
    let data;
    try { data = JSON.parse(text); } catch (e) { Bus.toast('That file isn’t readable JSON', 'bad', 4000); return; }
    if (!data || (!data.templates && !data.phrases)) { Bus.toast('No templates found in that file — is it an OSR Desk export?', 'bad', 4500); return; }
    importDialog(data);
  };
  fr.onerror = () => Bus.toast('Could not read that file', 'bad');
  fr.readAsText(file);
}
function importDialog(data) {
  const m = openModal(`
    <div class="modal-head"><h3>Import ${data.templates?.length || 0} templates</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
    <div class="modal-body">
      <p class="help" style="font-size:13px">This file has <b>${data.templates?.length || 0}</b> templates, <b>${data.phrases?.length || 0}</b> phrases, <b>${data.categories?.length || 0}</b> categories${data.cases?.length ? `, <b>${data.cases.length}</b> cases` : ''}${Object.keys(data.fileData || {}).length ? ` and <b>${Object.keys(data.fileData).length}</b> files` : ''}.</p>
      <div class="set-grid" style="grid-template-columns:1fr 1fr">
        <button class="set-card" id="im-merge" style="text-align:left;cursor:pointer"><h4>${ICON.plus} Merge into what I have</h4><p class="desc">Adds anything new, skips exact duplicates by title. Safest.</p></button>
        <button class="set-card" id="im-replace" style="text-align:left;cursor:pointer"><h4 style="color:var(--bad)">${ICON.arrow} Replace everything</h4><p class="desc">Your current library is exported first, then wiped and replaced.</p></button>
      </div>
    </div>
    <div class="modal-foot"><span class="grow" style="flex:1"></span><button class="btn" data-close>Cancel</button></div>`, { wide: true, key: 'import' });

  m.el.querySelector('#im-merge').onclick = () => { m.close(); runImport(data, false); };
  m.el.querySelector('#im-replace').onclick = async () => {
    m.close();
    await doExport(true);
    runImport(data, true);
  };
}
async function runImport(data, replace) {
  const sig = (t) => (t.title + '§' + t.body).toLowerCase().replace(/\s+/g, ' ').trim();
  const before = { t: Store.s.templates.length };
  if (replace) {
    const next = {
      ...Store.blankState(),
      onboarded: true,
      settings: { ...Store.s.settings, ...(data.settings || {}), theme: Store.s.settings.theme, accent: data.settings?.accent || Store.s.settings.accent },
      vars: data.vars || Store.s.vars,
      categories: data.categories || [], templates: data.templates || [],
      phrases: data.phrases || [], files: data.files || [], cases: data.cases || []
    };
    Store.replaceAll(next);
    await restoreBlobs(data, false);
  } else {
    Store.edit((st) => {
      const catMap = {};
      (data.categories || []).forEach((c) => {
        const found = st.categories.find((x) => x.name.toLowerCase() === String(c.name || '').toLowerCase());
        if (found) { catMap[c.id] = found.id; return; }
        const nc = { id: 'cat_' + uid('c').slice(4), name: c.name, color: c.color || CAT_COLORS[st.categories.length % CAT_COLORS.length], desc: c.desc || '', order: st.categories.length };
        st.categories.push(nc); catMap[c.id] = nc.id;
      });
      let order = Math.max(0, ...st.templates.map((x) => x.order || 0));
      const seen = new Set(st.templates.map(sig));
      (data.templates || []).forEach((t) => {
        const norm = {
          ...t, id: uid('tpl'), tags: Array.isArray(t.tags) ? t.tags : [], fileIds: [],
          useWhen: t.useWhen || '', usage: Number(t.usage) || 0, favorite: !!t.favorite, pinned: false,
          order: ++order, createdAt: t.createdAt || nowISO(), updatedAt: nowISO(), lastUsed: t.lastUsed || null
        };
        norm.category = catMap[t.category] || (st.categories.some((c) => c.id === t.category) ? t.category : '');
        const key = sig(norm);
        if (!norm.body || seen.has(key)) return;
        seen.add(key);
        st.templates.push(norm);
      });
      const pseen = new Set(st.phrases.map((p) => p.text));
      (data.phrases || []).forEach((p) => { if (p.text && !pseen.has(p.text)) st.phrases.unshift({ ...p, id: uid('ph') }); });
      (data.files || []).forEach((f) => {
        if (st.files.some((x) => x.name === f.name && x.size === f.size)) return;
        st.files.unshift({ ...f, id: uid('f'), note: [f.note, 'imported'].filter(Boolean).join(' · ') });
      });
      (data.cases || []).forEach((c) => {
        if (c.ticket && st.cases.some((x) => x.ticket === c.ticket)) return;
        st.cases.unshift({ ...c, id: uid('case') });
      });
      ['yourName', 'company', 'signature', 'yourRole'].forEach((k) => {
        if (!st.settings[k] && data.settings?.[k]) st.settings[k] = data.settings[k];
      });
      if (data.vars) Object.entries(data.vars).forEach(([k, v]) => { if (st.vars[k] == null) st.vars[k] = v; });
    }, 'data');
    await restoreBlobs(data, true);
  }
  const added = Store.s.templates.length - before.t;
  Bus.toast(replace ? 'Workspace replaced — ' + Store.s.templates.length + ' templates loaded'
    : added + ' template(s) added' + (added === 0 && (data.templates || []).length ? ' (everything was already here)' : ''), 'ok', 4200);
  view.tab = 'library'; view.cat = 'all'; view.q = ''; render();
}
async function restoreBlobs(data, byName) {
  const fd = data.fileData || {};
  const ids = Object.keys(fd);
  if (!ids.length) return;
  let n = 0;
  for (const oldId of ids) {
    const rec = (data.files || []).find((f) => f.id === oldId);
    const target = byName
      ? Store.s.files.find((x) => x.name === (rec && rec.name))
      : Store.s.files.find((x) => x.id === oldId);
    if (!target) continue;
    try {
      const r = await fetch(fd[oldId].data);
      await Store.Vault.put(target.id, await r.blob());
      n++;
    } catch (e) { /* data URL too big / unsupported */ }
  }
  if (n) Bus.toast(n + ' file(s) restored into your shelf', 'ok', 2600);
}
function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) { Bus.toast('That CSV looks empty', 'bad'); return; }
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (...names) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const ti = idx('title', 'name', 'template');
  const bi = idx('body', 'text', 'content', 'template body', 'message');
  const ci = idx('category', 'group', 'folder');
  const gi = idx('tag');
  const ui = idx('when', 'note', 'use');
  if (bi < 0 && ti < 0) { Bus.toast('CSV needs a Title or Body column (Notion / Google Sheets export works)', 'bad', 4500); return; }
  const catIds = {};
  const out = rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => {
    const catName = ci >= 0 ? (r[ci] || '').trim() : '';
    if (catName && !catIds[catName]) catIds[catName] = 'cat_' + uid('c').slice(4);
    return {
      id: uid('tpl'), title: (r[ti] || 'Imported ' + new Date().toLocaleDateString()).trim(),
      category: catName ? catIds[catName] : '', tags: gi >= 0 ? csv(r[gi]) : [],
      body: (bi >= 0 ? r[bi] : r[ti]).trim(), useWhen: ui >= 0 ? (r[ui] || '').trim() : '',
      favorite: false, usage: 0, pinned: false, order: 999, fileIds: [], createdAt: nowISO(), updatedAt: nowISO(), lastUsed: null
    };
  });
  Store.edit((st) => {
    Object.entries(catIds).forEach(([name, id], n) => {
      if (!st.categories.some((c) => c.name === name)) st.categories.push({ id, name, color: CAT_COLORS[(st.categories.length + n) % CAT_COLORS.length], desc: 'Imported', order: st.categories.length + n });
    });
    st.templates.push(...out);
  }, 'data');
  Bus.toast(out.length + ' templates imported from CSV', 'ok', 3600);
  view.tab = 'library'; render();
}
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* skip */ }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x ?? ''));
}

/* ---------- print ---------- */
function printSheet() {
  const s = Store.s;
  let html = `<h1>OSR Desk — cheat sheet</h1><p class="meta">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}` +
    (s.settings.yourName ? ' · ' + esc(s.settings.yourName) : '') + '</p>';
  const groups = [...s.categories].sort((a, b) => a.order - b.order);
  groups.forEach((c) => {
    const list = s.templates.filter((t) => t.category === c.id);
    if (!list.length) return;
    html += `<section><h2>${esc(c.name)}</h2>`;
    list.forEach((t) => {
      html += `<div class="pt"><h3>${esc(t.title)}</h3>${t.subject ? `<p class="subjline"><b>Subject:</b> ${esc(t.subject)}</p>` : ''}<pre>${esc(t.body)}</pre></div>`;
    });
    html += '</section>';
  });
  const loose = s.templates.filter((t) => !groups.some((c) => c.id === t.category));
  if (loose.length) { html += '<section><h2>Unsorted</h2>' + loose.map((t) => `<div class="pt"><h3>${esc(t.title)}</h3><pre>${esc(t.body)}</pre></div>`).join('') + '</section>'; }
  if (s.phrases.length) html += '<section><h2>Grab-and-go lines</h2><ul>' + s.phrases.map((p) => `<li>${esc(p.text)}</li>`).join('') + '</ul></section>';
  const old = document.getElementById('print-sheet');
  old?.remove();
  const div = document.createElement('div');
  div.id = 'print-sheet';
  div.innerHTML = html;
  document.body.appendChild(div);
  Bus.toast('Print dialog open — “Save as PDF” makes a nice desk reference', '', 4000);
  setTimeout(() => { window.print(); setTimeout(() => div.remove(), 800); }, 120);
}

/* ---------- danger ---------- */
async function reseed() {
  const ok = await Bus.confirm('Reset to the starter library?', 'Your own templates will be removed — export a backup first if there is anything you wrote. Your settings and files stay.', 'Reset library');
  if (!ok) return;
  await doExport(false);
  const seed = seedData();
  Store.edit((st) => { st.categories = seed.cats; st.templates = seed.templates; st.phrases = seed.phrases; }, 'data');
  Bus.toast('Starter library restored (a backup was downloaded first)', 'ok', 4200);
}
async function wipe() {
  const ok = await Bus.confirm('Wipe everything?', 'Templates, phrases, cases, shelf files and settings — all of it, from this browser. This cannot be undone.', 'Wipe it');
  if (!ok) return;
  Store.s.files.forEach((f) => Store.Vault.del(f.id));
  Store.resetAll();
  const seed = seedData();
  Store.edit((st) => { st.onboarded = true; st.categories = seed.cats; st.templates = seed.templates; st.phrases = seed.phrases; }, 'data');
  Bus.toast('Fresh start with the starter library', 'ok');
}

/* ---------- help / onboarding ---------- */
function openHelp(first = false) {
  const m = openModal(`
    <div class="modal-head"><h3>${first ? 'OSR Desk · 30 seconds' : 'How this works'}</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
    <div class="modal-body">
      <p class="help" style="font-size:13px">This is <b>your</b> desk, not a company tool. It's one HTML file — no account, no server, no one can see what's in it. Everything lives in this browser on this machine. ${first ? '' : ''}</p>
      <div class="set-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
        <div class="set-card"><h4><span class="brand-mark" style="width:20px;height:20px;font-size:10px">1</span> Build the library</h4>
          <p class="desc">Open a sent email, copy the body, press <kbd>N</kbd>, paste, swap the personal bits for <code>{{placeholders}}</code>. That's it — 60 seconds per template. Start with the 6 you send most.</p></div>
        <div class="set-card"><h4><span class="brand-mark" style="width:20px;height:20px;font-size:10px">2</span> Copy in one click</h4>
          <p class="desc">Every card has <b>Copy</b> and <b>Edit</b>. <kbd>Ctrl</kbd>+<kbd>K</kbd> searches everything; <kbd>Enter</kbd> copies. Placeholders you haven't filled prompt you first, and the same values are remembered for the rest of the day.</p></div>
        <div class="set-card"><h4><span class="brand-mark" style="width:20px;height:20px;font-size:10px">3</span> Drop the files</h4>
          <p class="desc">Drag screenshots, SOPs, the price list anywhere in the window → they land on your <b>Resource shelf</b>. Drop one on a template card and it attaches to that reply. Paste a screenshot with <kbd>Ctrl</kbd>+<kbd>V</kbd> too.</p></div>
        <div class="set-card"><h4><span class="brand-mark" style="width:20px;height:20px;font-size:10px">4</span> Keep the threads straight</h4>
          <p class="desc"><b>Live cases</b> is a scratchpad for the threads you're holding. Hit <i>Reply</i> on a row and pick a template — the client name and ticket number go in for you.</p></div>
      </div>
      <div class="help" style="font-size:12.5px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">
        <b>The First-week strip</b> at the top of the library ticks itself off as you set yourself up — name &amp; signature, five of your own templates, three stars, your docs on the shelf, today's threads on the board.<br><br>
        <b>Two habits worth having:</b><br>
        · Settings → <b>Export with files</b> once a week. The file lives in a folder that syncs, so a wiped browser costs you nothing.<br>
        · Delete every template you don't use within a fortnight. A 12-template library you actually open beats a 200-template one you avoid.
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" data-act="print">${ICON.download} Print a paper copy</button>
      <span class="grow" style="flex:1"></span>
      <span class="help" style="margin-right:8px">Press <kbd>?</kbd> any time for shortcuts</span>
      <button class="btn primary" id="hl-ok">${ICON.check} Let's go</button>
    </div>`, { wide: true, key: 'help' });
  m.el.querySelector('#hl-ok').onclick = () => { Store.edit((st) => { st.onboarded = true; }, 'data'); m.close(); };
}

/* ---------- bindings ---------- */
function bindDelegates() {
  const app = document.getElementById('app');
  // delegated from body: modal buttons live outside #app
  document.body.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.tagName === 'A' || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    handleAct(el.dataset.act, el.dataset.id, el, e);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const c = document.querySelector('.ctx'); if (c) c.remove(); }
  });
  app.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      const el = e.target.closest('[data-act="select"]');
      if (el) { e.preventDefault(); copyTemplate(el.dataset.id); }
    }
  });
  app.addEventListener('dblclick', (e) => {
    const el = e.target.closest('[data-act="select"]');
    if (el) { e.preventDefault(); copyTemplate(el.dataset.id); }
  });
  app.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const el = e.target.closest?.('.card, .phrase');
      if (el && document.activeElement === el) { e.preventDefault(); el.click(); }
    }
  });
  app.addEventListener('contextmenu', (e) => {
    const card = e.target.closest?.('[data-act="select"]');
    if (!card) return;
    e.preventDefault();
    cardMenu(e.clientX, e.clientY, card.dataset.id);
  });
  app.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'global-search') {
      view.q = el.value;
      if (view.tab === 'files') view.fileQ = el.value;
      if (view.tab === 'settings') view.tab = 'library';
      scheduleRender(el);
      return;
    }
    if (el.dataset.act === 'file-filter') { view.fileQ = el.value; scheduleRender(el); return; }
    if (el.dataset.set) {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
      Store.s.settings[el.dataset.set] = v;
      Store.save();
      if (el.dataset.set === 'fontSize') document.querySelectorAll('#pane-prose').forEach((p) => (p.style.fontSize = v + 'px'));
      applyTheme();
    }
  });
  app.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.act === 'set-sort') { Store.edit((st) => { st.settings.sort = el.value; }, 'data'); return; }
    if (el.dataset.act === 'set-view') { Store.edit((st) => { st.settings.view = el.value; }, 'data'); return; }
    if (el.dataset.act === 'case-status') {
      const id = el.dataset.id;
      Store.edit((st) => {
        const c = st.cases.find((x) => x.id === id);
        if (c) { c.status = el.value; c.updatedAt = nowISO(); c.history = [{ at: nowISO(), text: '→ ' + (CASE_STATUS.find((s) => s[0] === el.value)?.[1] || el.value) }, ...(c.history || [])].slice(0, 30); }
      }, 'data');
      return;
    }
    if (el.dataset.set) {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
      Store.s.settings[el.dataset.set] = v;
      Store.save();
      render();
    }
  });
  window.addEventListener('beforeunload', () => Store.flush());
  setInterval(() => { if (Store.isDirty) Store.flush(); }, 8000);
  if (typeof window.matchMedia === 'function') window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
}

let renderTimer = null;
function scheduleRender(keepFocusEl) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    const id = keepFocusEl?.id;
    const pos = keepFocusEl?.selectionStart;
    render();
    if (id) {
      const again = document.getElementById(id);
      if (again) {
        again.focus();
        if (typeof pos === 'number') { try { again.setSelectionRange(pos, pos); } catch (e) {} }
      }
    }
  }, 90);
}

function cardMenu(x, y, id) {
  const t = Q.template(id);
  if (!t) return;
  document.querySelector('.ctx')?.remove();
  const m = document.createElement('div');
  m.className = 'ctx scrim-lite';
  m.innerHTML = `<div class="ctx-inner">
    <button data-act="copy">${ICON.copy} Copy email body</button>
    ${t.subject ? `<button data-act="copy-subject">${ICON.quote} Copy subject line</button>` : ''}
    <button data-act="edit">${ICON.edit} Edit</button>
    <button data-act="dup">${ICON.copy} Duplicate</button>
    <button data-act="star">${ICON.star} ${t.favorite ? 'Unstar' : 'Star'}</button>
    <button data-act="attach">${ICON.attach} Attach a file…</button>
    <button data-act="export-one">${ICON.download} Export this one (.txt)</button>
    <button data-act="del" style="color:var(--bad)">${ICON.trash} Delete</button>
  </div>`;
  m.style.cssText = `position:fixed;left:${Math.min(x, innerWidth - 210)}px;top:${Math.min(y, innerHeight - 260)}px;z-index:120`;
  document.body.appendChild(m);
  const close = () => m.remove();
  setTimeout(() => document.addEventListener('mousedown', onDoc, { once: true }), 0);
  function onDoc(e) { if (!m.contains(e.target)) close(); }
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    close();
    const act = b.dataset.act;
    if (act === 'attach') pickFile('*', async (f) => { await ingestFiles(f, { kind: 'tpl', id }); });
    else if (act === 'copy-subject') copySubject(t);
    else if (act === 'export-one') download(t.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.txt', new Blob([t.body], { type: 'text/plain' }));
    else handleAct(act, id, m);
  });
}

/* ---------- boot ---------- */
function boot() {
  const st = Store.load();
  if (st.__fresh) {
    const seed = seedData();
    st.categories = seed.cats;
    st.templates = seed.templates;
    st.phrases = seed.phrases;
    delete st.__fresh;
    Store.save();
  }
  applyTheme();
  render();
  bindKeys();
  bindDnD();
  bindDelegates();
  Store.subscribe((kind) => {
    if (kind === 'dirty' || kind === 'saved') {
      const el = document.getElementById('save-state');
      if (el) {
        el.classList.toggle('dirty', kind === 'dirty');
        el.querySelector('span').textContent = !KV.available ? 'Not persisting!' : kind === 'dirty' ? 'Saving…' : 'Saved on this PC';
      }
      return;
    }
    render();
  });
  if (!KV.available) {
    Bus.toast('This browser won’t save between reloads (storage blocked). Use Settings → Export before closing, or run it from a normal http:// address.', 'bad', 12000);
  }
  document.getElementById('mod-key').textContent = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
  if (!Store.s.onboarded) setTimeout(() => openHelp(true), 320);
  window.addEventListener('error', (e) => {
    console.error(e.error || e.message);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
