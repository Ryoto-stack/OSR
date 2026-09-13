/* =========================================================
   app.js — view state, render loop, copy engine, editor,
   modals, toasts, keyboard. (panels.js adds files/cases/etc)
   ========================================================= */

const view = {
  tab: 'library',          // library | files | cases | settings
  cat: 'all',              // all | fav | used | orphan | <category id>
  q: '',
  tags: [],
  fileQ: '',
  selected: null,
  pane: false,
  dropHot: false,
  railOpen: false
};

/* ---------- toast ---------- */
const Bus = {
  toast(msg, kind = '', ms = 2600, action) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `<div class="msg">${esc(msg)}</div>` +
      (action ? `<button class="undo">${esc(action.label)}</button>` : '');
    if (action) el.querySelector('.undo').onclick = () => { remove(); action.fn(); };
    host.appendChild(el);
    const timer = setTimeout(remove, ms);
    el.addEventListener('click', (e) => { if (e.target === el) { clearTimeout(timer); remove(); } });
    function remove() {
      clearTimeout(timer);
      el.style.transition = 'opacity .16s, transform .16s';
      el.style.opacity = '0'; el.style.transform = 'translateY(4px)';
      setTimeout(() => el.remove(), 170);
    }
    return remove;
  },
  confirm(title, body, okLabel = 'Do it', danger = true) {
    return new Promise((res) => {
      const m = openModal(`
        <div class="modal-head"><h3>${esc(title)}</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
        <div class="modal-body"><div class="help" style="font-size:13px;line-height:1.6">${body}</div></div>
        <div class="modal-foot"><span class="grow"></span><button class="btn" data-no>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`, { narrow: true });
      m.el.querySelector('[data-yes]').onclick = () => { m.__answered = true; m.close(); res(true); };
      m.el.querySelector('[data-no]').onclick = () => { m.__answered = true; m.close(); res(false); };
      m.onclose = () => { if (!m.__answered) res(false); };
    });
  }
};

/* ---------- modal host ---------- */
let modalStack = [];
function openModal(html, opts = {}) {
  if (opts.key) {
    const existing = modalStack.find((m) => m.key === opts.key);
    if (existing) { existing.bringUp(); return existing; }
  }
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');
  scrim.innerHTML = `<div class="modal ${opts.cls || ''} ${opts.narrow ? 'narrow' : ''} ${opts.wide ? 'wide' : ''}">${html}</div>`;
  document.body.appendChild(scrim);
  document.body.style.overflow = 'hidden';
  const el = scrim.querySelector('.modal');
  const api = {
    scrim, el, key: opts.key || null,
    bringUp() { document.body.appendChild(scrim); const f = scrim.querySelector('input,textarea'); if (f) setTimeout(() => f.focus(), 10); },
    close() {
      if (api.__closed) return;
      api.__closed = true;
      scrim.remove();
      modalStack = modalStack.filter((m) => m !== api);
      if (!modalStack.length) document.body.style.overflow = '';
      if (api.onclose) api.onclose();
    }
  };
  modalStack.push(api);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) api.close(); });
  el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => api.close()));
  const first = el.querySelector('input,textarea,select,button.primary');
  if (first) setTimeout(() => first.focus(), 20);
  return api;
}

/* ---------- clipboard ---------- */
function toHTML(text) {
  return '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">' +
    esc(text).replace(/\n/g, '<br>') + '</div>';
}
async function toClipboard(text, { rich = false } = {}) {
  try {
    if (rich && window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([toHTML(text)], { type: 'text/html' })
      })]);
      return 'rich';
    }
  } catch (e) { /* fall through */ }
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return 'plain'; }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return 'legacy';
  } catch (e) { /* fall through */ }
  return 'fail';
}

const prefersDark = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false);

/* ---------- render ---------- */
function applyTheme() {
  const s = Store.s.settings;
  const dark = s.theme === 'dark' || (s.theme === 'system' && prefersDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.density = s.density;
  document.documentElement.style.setProperty('--accent', s.accent);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#13151a' : '#f7f7f5');
}

function matchHay(t, q) {
  return [t.title, t.body, (t.tags || []).join(' '), Q.categoryName(t.category), t.useWhen || ''].join('\n').toLowerCase();
}
function visibleTemplates() {
  const s = Store.s;
  let list = [...s.templates];
  if (view.cat === 'fav') list = list.filter((t) => t.favorite);
  else if (view.cat === 'used') list = list.filter((t) => t.usage > 0);
  else if (view.cat === 'orphan') list = list.filter((t) => !s.categories.some((c) => c.id === t.category));
  else if (view.cat !== 'all') list = list.filter((t) => t.category === view.cat);
  if (view.tags.length) list = list.filter((t) => view.tags.every((tag) => (t.tags || []).includes(tag)));
  const q = view.q.trim().toLowerCase();
  if (q) {
    const words = q.split(/\s+/).filter(Boolean);
    list = list.filter((t) => words.every((w) => matchHay(t, w).includes(w)));
  }
  const catOrder = Object.fromEntries(s.categories.map((c, i) => [c.id, c.order ?? i]));
  const sort = s.settings.sort;
  if (q && sort === 'manual') {
    // relevance: title hits first
    list.sort((a, b) => score(b) - score(a));
  } else if (sort === 'recent') list.sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || '') || (a.order || 0) - (b.order || 0));
  else if (sort === 'az') list.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'used') list.sort((a, b) => (b.usage - a.usage) || a.title.localeCompare(b.title));
  else if (sort === 'new') list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  else if (sort === 'cat') list.sort((a, b) => (catOrder[a.category] - catOrder[b.category]) || (a.order - b.order));
  else list.sort((a, b) => (a.order || 0) - (b.order || 0));
  return list;

  function score(t) {
    const title = t.title.toLowerCase();
    let n = 0;
    if (title.includes(q)) n += 50;
    if (t.favorite) n += 6;
    n += Math.min(10, (t.usage || 0));
    n += matchHay(t, q).split(q).length - 1;
    return n;
  }
}

function render() {
  const app = document.getElementById('app');
  const s = Store.s;
  let mainHTML = '';
  if (view.tab === 'library') {
    const list = visibleTemplates();
    mainHTML = renderLibrary(list, !!(view.q.trim() || view.tags.length));
  } else if (view.tab === 'files') {
    const q = (view.fileQ || '').toLowerCase();
    mainHTML = renderFiles(s.files.filter((f) => !q || f.name.toLowerCase().includes(q) || (f.note || '').toLowerCase().includes(q)));
  } else if (view.tab === 'cases') {
    const q = view.q.trim().toLowerCase();
    let list = [...s.cases];
    if (q) list = list.filter((c) => [c.client, c.ticket, c.subject, c.notes, c.next, c.owner].join(' ').toLowerCase().includes(q));
    list.sort((a, b) => {
      const rank = { escalated: 0, new: 1, progress: 2, awaiting: 3, resolved: 4 };
      return (rank[a.status] - rank[b.status]) || (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
    mainHTML = renderCases(list);
  } else {
    mainHTML = renderSettings();
  }

  const selected = view.selected ? Q.template(view.selected) : null;
  app.innerHTML = renderTopbar() + renderRail() + `<main class="main">${mainHTML}</main>` +
    `<aside class="pane" id="pane">${selected ? renderPane(selected) : ''}</aside>`;
  app.classList.toggle('pane-open', !!selected);
  app.classList.toggle('rail-open', view.railOpen);
  const gs = document.getElementById('global-search');
  if (gs && document.activeElement !== gs) { gs.value = view.q; }
  updateStorageBadge();
  if (typeof applyChrome === 'function') applyChrome();
  if (typeof bindInternalDrag === 'function') bindInternalDrag(document.getElementById('app'));
  requestAnimationFrame(() => {
    if (view.selected && document.activeElement === document.body) sive(document.getElementById('pane'), { block: 'nearest' });
  });
}

/* ---------- selection & pane ---------- */
function selectTemplate(id, opts = {}) {
  view.selected = id;
  Store.refresh('ui');
  if (!opts.noScroll) {
    requestAnimationFrame(() => {
      sive(document.querySelector('.card.selected'), { block: 'nearest' });
    });
  }
}

/* ---------- copy flow ---------- */
async function copySubject(t) {
  if (!t) return;
  const r = fillVars(t.subject || '');
  const how = await toClipboard(r.text);
  Bus.toast(how === 'fail' ? 'Clipboard blocked — copy it from the panel instead' : 'Subject copied', how === 'fail' ? 'bad' : 'ok', 2200);
  if (r.missing.length) Bus.toast('Careful: ' + r.missing.map((k) => '{{' + k + '}}') + ' is still a placeholder', 'warn', 4000);
}

function composedBody(t) {
  let body = t.body;
  const s = Store.s.settings;
  if ((s.appendSignature || t.appendSig) && !t.noSig && s.signature) {
    body = body.replace(/\s*$/, '\n\n') + s.signature.trim() + '\n';
  }
  return body;
}

async function doCopy(text, { source, kind = 'tpl' } = {}) {
  const out = Store.s.settings.plainCopy ? text : text;
  const how = await toClipboard(out, { rich: !Store.s.settings.plainCopy });
  if (how === 'fail') {
    openModal(`
      <div class="modal-head"><h3>Couldn't reach the clipboard</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
      <div class="modal-body">
        <p class="help" style="font-size:13px">Your browser blocked clipboard access from this page. The text is selected below — press <kbd>Ctrl</kbd>+<kbd>C</kbd> and it's yours.</p>
        <textarea class="txt" style="min-height:220px;font-family:var(--font)" id="fallback-copy">${esc(text)}</textarea>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn primary" data-close>Done</button></div>`,
      { wide: false, key: 'clip-fallback' });
    setTimeout(() => { const ta = document.getElementById('fallback-copy'); if (ta) { ta.focus(); ta.select(); } }, 40);
    return;
  }
  if (source) {
    Store.edit((st) => {
      if (kind === 'tpl') {
        const t = st.templates.find((x) => x.id === source);
        if (t) { t.usage = (t.usage || 0) + 1; t.lastUsed = nowISO(); }
      } else {
        const p = st.phrases.find((x) => x.id === source);
        if (p) p.usage = (p.usage || 0) + 1;
      }
      st.activity.unshift({
        id: uid('act'), at: nowISO(), kind: 'copy', ref: source, refKind: kind,
        title: kind === 'tpl' ? Q.template(source)?.title : (Q.phrase?.(source) || st.phrases.find(p => p.id === source))?.text?.slice(0, 40)
      });
      st.activity = st.activity.slice(0, 40);
    }, 'data');
  }
  const btns = document.querySelectorAll(`[data-act="copy"][data-id="${source}"]`);
  btns.forEach((b) => {
    const prev = b.innerHTML;
    b.classList.add('done');
    b.innerHTML = ICON.check + '<span>Copied</span>';
    setTimeout(() => { b.classList.remove('done'); b.innerHTML = prev; }, 1200);
  });
  Bus.toast('Copied to clipboard — paste with Ctrl+V', 'ok', 2000);
}

function noteSubjectOffer(t) {
  if (!t || !t.subject) return;
  Bus.toast('Body copied · subject ready too', 'ok', 6500, {
    label: 'Copy subject',
    fn() { copySubject(t); }
  });
}

function copyTemplate(id, { forceFill = false, noFill = false } = {}) {
  const t = Q.template(id);
  if (!t) return;
  const body = composedBody(t);
  const keys = varsIn(body);
  if (!keys.length) return doCopy(body, { source: id });
  const { missing } = fillVars(body);
  // "Fill & copy" always asks; a plain copy only asks when something is genuinely unknown
  if (forceFill || (missing.length && !noFill)) { openFillDialog(t, body, missing); return; }
  doCopy(fillVars(body).text, { source: id });
  noteSubjectOffer(t);
}

/* ---------- fill dialog ---------- */
let openFill = null;
function openFillDialog(entity, body, missing, opts = {}) {
  const all = varsIn(body);
  const auto = autoValues();
  const remember = Store.s.vars || {};
  const initial = {};
  all.forEach((k) => {
    const f = fillVars('{{' + k + '}}', {});
    const base = f.text !== '{{' + k + '}}' ? f.text.replace(/^\{\{\s*|\s*\}\}$/g, '') : (remember[k] || '');
    initial[k] = (opts.prefs && opts.prefs[k] != null && opts.prefs[k] !== '') ? opts.prefs[k] : base;
  });
  const title = opts.kind === 'ph' ? 'Fill in this line' : 'Fill in ' + (opts.caseName ? 'for ' + esc(opts.caseName) : entity.title);
  const m = openModal(`
    <div class="modal-head">
      <h3>${title}</h3>
      <span class="help" style="flex:1">Tab through the fields · Enter copies</span>
      <button class="btn icon ghost" data-close>${ICON.close}</button>
    </div>
    <div class="modal-body">
      <div class="swap">
        <div class="left">
          <div class="pane-sec"><h4>Values</h4>
            <div style="display:flex;flex-direction:column;gap:8px">
            ${all.map((k) => `
              <div class="form-row" style="gap:3px">
                <label class="lbl" for="fv-${esc(k)}">{{${esc(k)}}}${missing.includes(k) ? ' <span style="color:var(--warn)">• needs a value</span>' : ' <span style="color:var(--ink-3)">prefilled</span>'}</label>
                <input class="txt" id="fv-${esc(k)}" data-var="${esc(k)}" value="${esc(initial[k] ?? '')}"
                       placeholder="${esc(guessPlaceholder(k))}" autocomplete="off" spellcheck="false">
              </div>`).join('')}
            </div>
          </div>
          ${entity.subject ? `<div class="form-row" style="margin-top:2px"><label class="lbl">Subject</label>
            <input class="txt" id="fill-subj" value="${esc(entity.subject)}" style="font-size:13px"></div>` : ''}
          ${opts.kind !== 'ph' ? `<div class="checkrow" style="margin-top:2px">
            <input type="checkbox" id="fill-sig" ${Store.s.settings.appendSignature ? 'checked' : ''}>
            <label for="fill-sig">Append my signature</label></div>` : ''}
        </div>
        <div class="right">
          <div class="pane-sec"><h4>${ICON.copy} Live preview</h4>
            <div class="prose" id="fill-preview" style="max-height:52vh;overflow:auto;font-size:13px"></div>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" data-act="skip-fill">Skip, copy raw</button>
      ${entity.subject ? `<button class="btn" id="fill-subj-copy">${ICON.copy} Copy subject</button>` : ''}
      <span class="grow"></span>
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="fill-go">${ICON.copy} Copy filled text</button>
    </div>`, { wide: true, key: 'fill' });

  openFill = m;
  const inputs = [...m.el.querySelectorAll('input[data-var]')];
  const preview = m.el.querySelector('#fill-preview');
  const subjIn = m.el.querySelector('#fill-subj');
  function currentBody() {
    let body2 = entity.body ?? body;
    if (m.el.querySelector('#fill-sig')?.checked && Store.s.settings.signature) {
      body2 = String(body2).replace(/\s*$/, '\n\n') + Store.s.settings.signature.trim() + '\n';
    }
    return body2;
  }
  function draw() {
    const provided = Object.assign({}, opts.prefs || {});
    inputs.forEach((i) => { if (i.value.trim()) provided[i.dataset.var] = i.value; });
    const r = fillVars(currentBody(), provided);
    preview.innerHTML = renderProse(r.text);
    return provided;
  }
  inputs.forEach((i) => i.addEventListener('input', draw));
  m.el.querySelector('#fill-sig')?.addEventListener('change', draw);
  draw();
  const missingInput = inputs.find((i) => missing.includes(i.dataset.var));
  (missingInput || inputs[0])?.focus();
  (missingInput || inputs[0])?.select();

  m.el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); go(); }
  });
  m.el.querySelector('#fill-go').onclick = go;
  m.el.querySelector('#fill-subj-copy')?.addEventListener('click', async () => {
    const provided = draw();
    const raw = (subjIn && subjIn.value) || entity.subject;
    const r = fillVars(raw, provided);
    await toClipboard(r.text);
    Bus.toast('Subject copied — now paste it in the subject field', 'ok', 2600);
  });
  m.el.querySelector('[data-act="skip-fill"]').onclick = () => {
    const provided = opts.prefs || {};
    m.close();
    doCopy(fillVars(currentBody(), provided).text, { source: entity.id, kind: opts.kind });
  };

  function go() {
    const provided = draw();
    Store.edit((st) => {
      if (st.settings.rememberFill) Object.assign(st.vars, provided);
      if (opts.caseId) {
        const c = st.cases.find((x) => x.id === opts.caseId);
        if (c) { c.history = c.history || []; c.history.unshift({ at: nowISO(), text: 'Copied "' + (entity.title || '') + '"' + (st.settings.appendSignature ? '' : '') }); c.updatedAt = nowISO(); }
      }
    }, 'data');
    m.close();
    const r = fillVars(currentBody(), provided);
    doCopy(r.text, { source: entity.id, kind: opts.kind });
    const still = fillVars(r.text).missing;
    if (still.length) Bus.toast('Heads-up: ' + still.map((k) => '{{' + k + '}}').join(', ') + ' still has no value', 'warn', 4200);
  }
}
function guessPlaceholder(k) {
  const map = {
    first_name: 'Sam', client_name: 'Acme Co', agent_name: 'your name', company: 'your company',
    ticket_id: '48213', invoice_id: 'INV-2291', date: 'Tue, Sep 15', time: '2:00pm',
    time_frame: 'end of day today', next_update_date: 'Thursday', issue: 'the login error',
    browser: 'Chrome', masked_email: 's***@acme.com', sender_domain: 'support.yourcompany.com',
    verification_item: 'billing postcode', team: 'Billing Ops', area: 'payment gateway issues',
    sla: '1 business day', plan: 'Team', amount: '$49.00', alt_1: 'first alternative', cause: 'an expired token cache'
  };
  return map[k] || 'value for ' + k;
}

/* ---------- template editor ---------- */
function openEditor(id, prefill = {}) {
  const t = id ? Q.template(id) : null;
  const s = Store.s;
  const cats = [...s.categories].sort((a, b) => a.order - b.order);
  const draft = {
    title: t?.title || prefill.title || '',
    subject: t?.subject || prefill.subject || '',
    body: t?.body || prefill.body || '',
    category: t?.category || (view.tab === 'library' && cats.some((c) => c.id === view.cat) ? view.cat : cats[0]?.id || ''),
    tags: (t?.tags || []).join(', '),
    useWhen: t?.useWhen || '',
    favorite: t?.favorite || false,
    noSig: t?.noSig || false
  };
  const m = openModal(`
    <div class="modal-head">
      <h3>${t ? 'Edit template' : 'New template'}</h3>
      ${t ? `<button class="btn sm ghost" data-act="dup" data-id="${t.id}" title="Duplicate">${ICON.copy} Duplicate</button>
             <button class="btn sm ghost" data-act="del" data-id="${t.id}" title="Delete" style="color:var(--bad)">${ICON.trash}</button>` : ''}
      <span class="grow" style="flex:1"></span>
      <button class="btn sm" id="ed-preview-btn">${ICON.open} Preview</button>
      <button class="btn icon ghost" data-close aria-label="Close">${ICON.close}</button>
    </div>
    <div class="modal-body">
      <div class="form-row"><label class="lbl" for="ed-title">Title</label>
        <input id="ed-title" class="txt" value="${esc(draft.title)}" placeholder="e.g. Password reset — first reply" style="font-size:15px;font-weight:600"></div>
      <div class="form-row"><label class="lbl" for="ed-subj">Subject line <span style="float:right;text-transform:none;letter-spacing:0;font-weight:400;color:var(--ink-3)">optional — copied separately with one click</span></label>
        <input id="ed-subj" class="txt" value="${esc(draft.subject)}" placeholder="Re: {{ticket_id}} — looking into it now" style="font-size:13.5px"></div>
      <div class="form-row two">
        <div class="form-row"><label class="lbl" for="ed-cat">Category</label>
          <select id="ed-cat" class="txt">
            <option value="">— no category —</option>
            ${cats.map((c) => `<option value="${c.id}" ${draft.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></div>
        <div class="form-row"><label class="lbl" for="ed-tags">Tags (comma separated)</label>
          <input id="ed-tags" class="txt" value="${esc(draft.tags)}" placeholder="password, quick, l1"></div>
      </div>
      <div class="form-row">
        <label class="lbl" for="ed-body">Email body
          <span style="float:right;text-transform:none;letter-spacing:0;font-weight:400;color:var(--ink-3)">
            wrap anything you fill in as <code>{{this}}</code> — you'll get a prompt to complete it before copying</span></label>
        <textarea id="ed-body" class="txt" placeholder="Hi {{first_name}},&#10;&#10;…&#10;&#10;Best,&#10;{{agent_name}}">${esc(draft.body)}</textarea>
        <div class="var-list" id="ed-varbar">
          ${['first_name', 'client_name', 'ticket_id', 'agent_name', 'issue', 'time_frame', 'date', 'team', 'link']
            .map((k) => `<button class="chip" data-insert="${k}" title="Insert {{${k}}} at the cursor">{{${k}}}</button>`).join('')}
        </div>
      </div>
      <div class="form-row"><label class="lbl" for="ed-use">When do I use this? (just for me)</label>
        <input id="ed-use" class="txt" value="${esc(draft.useWhen)}" placeholder="e.g. only if they've already tried the reset link twice" style="font-size:13px"></div>
      <div class="checkrow"><input type="checkbox" id="ed-fav" ${draft.favorite ? 'checked' : ''}><label for="ed-fav">Star it (keeps it in my favourites)</label></div>
      <div class="checkrow"><input type="checkbox" id="ed-nosig" ${draft.noSig ? 'checked' : ''}><label for="ed-nosig">Never append my signature to this one (internal notes, handoff blurbs)</label></div>
      ${t ? `<div class="pane-sec"><h4>${ICON.file} Attached files <span class="help" style="text-transform:none;letter-spacing:0;font-weight:400">— drag files onto the card in the library too</span></h4>
        <div id="ed-files" class="files-grid" style="gap:7px">${Q.filesFor(t).map((f) => fileCard(f, { tpl: t.id })).join('') || '<span class="help">None yet — screenshots of the exact error, the form you always attach, that sort of thing.</span>'}</div>
        <div class="help" id="ed-drop" style="border:1.5px dashed var(--line);border-radius:8px;padding:9px;text-align:center">Drop files here, or
          <button class="btn sm" data-act="pick-files" data-target="tpl:${t.id}" style="margin-left:6px">${ICON.plus} browse</button></div>
      </div>` : ''}
    </div>
    <div class="modal-foot">
      <span class="help" id="ed-status">${t ? 'Edited ' + ago(t.updatedAt) : 'Not saved yet'}</span>
      <span class="grow" style="flex:1"></span>
      <button class="btn" data-close>Cancel</button>
      ${t ? `<button class="btn" id="ed-copy-now">${ICON.copy} Copy now</button>` : ''}
      <button class="btn primary" id="ed-save">${ICON.check} Save</button>
    </div>`, { wide: true, key: 'editor' });

  const ta = m.el.querySelector('#ed-body');
  const titleIn = m.el.querySelector('#ed-title');
  m.el.querySelectorAll('[data-insert]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.insert;
      const i = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, i) + '{{' + k + '}}' + ta.value.slice(ta.selectionEnd ?? i);
      ta.focus();
      ta.setSelectionRange(i + k.length + 4, i + k.length + 4);
      ta.dispatchEvent(new Event('input'));
    };
  });
  ta.addEventListener('input', () => {
    const keys = varsIn(ta.value);
    m.el.querySelector('#ed-status').textContent = keys.length ? 'Variables: ' + keys.join(', ') : 'No placeholders — copies exactly as written';
    const vb = m.el.querySelector('#ed-varbar');
    const extra = keys.filter((k) => !['first_name', 'client_name', 'ticket_id', 'agent_name', 'issue', 'time_frame', 'date', 'team', 'link'].includes(k));
    vb.querySelectorAll('[data-extra]').forEach((x) => x.remove());
    extra.forEach((k) => {
      const b = document.createElement('button');
      b.className = 'chip on'; b.dataset.extra = '1'; b.dataset.insert = k; b.textContent = '{{' + k + '}}';
      b.onclick = () => { const i = ta.selectionStart ?? 0; ta.value = ta.value.slice(0, i) + '{{' + k + '}}' + ta.value.slice(i); ta.focus(); };
      vb.appendChild(b);
    });
  });
  ta.dispatchEvent(new Event('input'));

  m.el.querySelector('#ed-preview-btn').onclick = () => {
    openDraftPreview({
      title: titleIn.value || 'Untitled',
      subject: m.el.querySelector('#ed-subj').value,
      body: ta.value,
      useWhen: m.el.querySelector('#ed-use').value,
      tags: csv(m.el.querySelector('#ed-tags').value),
      category: m.el.querySelector('#ed-cat').value,
      id: t?.id || null
    });
  };
  m.el.querySelector('#ed-copy-now')?.addEventListener('click', () => copyTemplate(t.id));
  m.el.querySelector('#ed-save').onclick = () => save();
  m.el.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); } });
  m.el.querySelector('#ed-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  function save() {
    const title = titleIn.value.trim() || 'Untitled template';
    const body = ta.value.replace(/\r\n/g, '\n');
    const payload = {
      title, body,
      subject: m.el.querySelector('#ed-subj').value.trim(),
      category: m.el.querySelector('#ed-cat').value,
      tags: csv(m.el.querySelector('#ed-tags').value),
      useWhen: m.el.querySelector('#ed-use').value.trim(),
      favorite: m.el.querySelector('#ed-fav').checked,
      noSig: m.el.querySelector('#ed-nosig').checked
    };
    if (!body.trim()) { Bus.toast('Add some body text first — an empty template helps nobody', 'warn'); ta.focus(); return; }
    Store.edit((st) => {
      if (t) {
        const x = st.templates.find((y) => y.id === t.id);
        Object.assign(x, payload, { updatedAt: nowISO() });
      } else {
        const nid = uid('tpl');
        st.templates.push({
          id: nid, ...payload, usage: 0, pinned: false, custom: true,
          order: Math.max(0, ...st.templates.map((z) => z.order || 0)) + 1,
          fileIds: [], createdAt: nowISO(), updatedAt: nowISO(), lastUsed: null
        });
        view.selected = nid;
        view.tab = 'library';
        if (payload.category) view.cat = payload.category;
      }
    }, 'data');
    m.close();
    Bus.toast(t ? 'Template updated' : 'Template saved', 'ok');
    if (!t) selectTemplate(view.selected, { noScroll: true });
  }
}
/** what the client will actually read, from inside the editor */
function openDraftPreview(draft) {
  const filled = fillVars(draft.body).text;
  const subj = draft.subject ? fillVars(draft.subject).text : '';
  const missing = fillVars(draft.body).missing;
  const m = openModal(`
    <div class="modal-head">
      <h3>${esc(draft.title)}</h3>
      <span class="help">${missing.length ? '<span style="color:var(--warn)">' + missing.length + ' unfilled field' + (missing.length > 1 ? 's' : '') + '</span>' : 'no blanks left'}</span>
      <button class="btn icon ghost" data-close>${ICON.close}</button>
    </div>
    <div class="modal-body">
      ${subj ? `<div class="subj-row"><div class="subj">${renderProse(subj)}</div></div>` : ''}
      <div class="prose" style="font-size:15px">${renderProse(filled)}</div>
      <div class="help">This is the filled preview — exactly what lands in the clipboard. Blue bits are still placeholders.</div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-close>${ICON.arrow} Back to editing</button>
      <span class="grow" style="flex:1"></span>
      ${draft.id ? `<button class="btn" id="dp-copy">${ICON.copy} Copy this</button>` : ''}
    </div>`, { wide: true, key: 'draft-preview' });
  m.el.querySelector('#dp-copy')?.addEventListener('click', () => { copyTemplate(draft.id); m.close(); });
}

function csv(s) {
  return String(s || '').split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean).slice(0, 8);
}

/* ---------- categories ---------- */
function openCatEditor(id) {
  const c = id ? Q.category(id) : null;
  const colors = CAT_COLORS;
  const m = openModal(`
    <div class="modal-head"><h3>${c ? 'Rename category' : 'New category'}</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
    <div class="modal-body">
      <div class="form-row"><label class="lbl">Name</label><input id="cat-name" class="txt" value="${esc(c?.name || '')}" placeholder="e.g. Refunds"></div>
      <div class="form-row"><label class="lbl">What goes here (shown under the title)</label><input id="cat-desc" class="txt" value="${esc(c?.desc || '')}" style="font-size:13px"></div>
      <div class="form-row"><label class="lbl">Colour</label><div class="swatches">
        ${colors.map((x) => `<button class="swatch ${c?.color === x ? 'on' : ''}" data-color="${x}" style="background:${x}"></button>`).join('')}
      </div></div>
    </div>
    <div class="modal-foot"><span class="grow" style="flex:1"></span>
      ${c ? '<button class="btn danger" id="cat-del">Delete</button>' : ''}
      <button class="btn primary" id="cat-save">${ICON.check} Save</button></div>`, { narrow: true, key: 'cat' });
  let color = c?.color || colors[Math.floor(Math.random() * colors.length)];
  m.el.querySelectorAll('[data-color]').forEach((b) => {
    b.onclick = () => { color = b.dataset.color; m.el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  m.el.querySelector('#cat-save').onclick = () => {
    const name = m.el.querySelector('#cat-name').value.trim();
    if (!name) return Bus.toast('Give it a name', 'warn');
    Store.edit((st) => {
      if (c) { c.name = name; c.desc = m.el.querySelector('#cat-desc').value.trim(); c.color = color; }
      else st.categories.push({ id: 'cat_' + uid('c').slice(4), name, desc: m.el.querySelector('#cat-desc').value.trim(), color, order: Math.max(-1, ...st.categories.map((x) => x.order || 0)) + 1 });
    }, 'data');
    m.close();
  };
  m.el.querySelector('#cat-del')?.addEventListener('click', async () => {
    m.close();
    const n = Q.templatesIn(c.id).length;
    const ok = await Bus.confirm('Delete category “' + esc(c.name) + '”?',
      n ? 'The ' + n + ' template(s) inside are not deleted — they move to <b>No category</b>.' : 'Nothing is inside it.', 'Delete category');
    if (!ok) return;
    Store.edit((st) => {
      st.categories = st.categories.filter((x) => x.id !== c.id);
      st.templates.forEach((t) => { if (t.category === c.id) t.category = ''; });
    }, 'data');
    if (view.cat === c.id) view.cat = 'all';
  });
}

/* ---------- trash + undo ---------- */
function deleteTemplate(id) {
  const t = Q.template(id);
  if (!t) return;
  const copy = JSON.parse(JSON.stringify(t));
  const idx = Store.s.templates.findIndex((x) => x.id === id);
  Store.edit((st) => { st.templates = st.templates.filter((x) => x.id !== id); if (view.selected === id) { view.selected = null; } }, 'data');
  Bus.toast('Deleted “' + t.title.slice(0, 34) + '”', 'bad', 7000, {
    label: 'Undo',
    fn() {
      Store.edit((st) => { st.templates.splice(Math.min(idx, st.templates.length), 0, copy); }, 'data');
      Bus.toast('Restored', 'ok', 1500);
    }
  });
}

/* ---------- keyboard ---------- */
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleRail(); return; }
    if (mod && e.key === 'Enter' && !typing) { e.preventDefault(); }
    if (e.key === 'Escape') {
      if (openPaletteInst) { closePalette(); return; }
      if (modalStack.length) { modalStack[modalStack.length - 1].close(); return; }
      if (view.selected) { view.selected = null; view.railOpen = false; render(); return; }
      if (view.railOpen) { view.railOpen = false; render(); }
      return;
    }
    if (modalStack.length && !typing) {
      // a modal has the stage: only Esc (handled above) or its own keys apply
      if (!(e.metaKey || e.ctrlKey) && /^(n|c|e|j|k|f|\?|\/) $/.test('')) return;
      if (['n', 'e', 'c', 'j', 'k', 'f', '/', '?'].includes(e.key.toLowerCase()) && !mod) { e.preventDefault(); return; }
    }
    if (typing) {
      if (e.target.id === 'global-search') {
        if (e.key === 'Enter') { e.preventDefault(); const l = visibleTemplates(); if (l[0]) { selectTemplate(l[0].id); } }
        if (e.key === 'Escape') { view.q = ''; e.target.value = ''; render(); }
      }
      return;
    }
    if (e.key === '/') { e.preventDefault(); document.getElementById('global-search')?.focus(); return; }
    if (e.key === '?') { e.preventDefault(); openHelp(); return; }
    if (e.key.toLowerCase() === 'n' && !mod) { e.preventDefault(); openEditor(); return; }
    if (e.key.toLowerCase() === 'f' && !mod) { e.preventDefault(); toggleTheme(); return; }
    if ((e.key.toLowerCase() === 'c' || e.key === 'Enter') && view.selected) { e.preventDefault(); copyTemplate(view.selected); return; }
    if (e.key.toLowerCase() === 'e' && view.selected) { e.preventDefault(); openEditor(view.selected); return; }
    if (e.key === 'j' || e.key === 'ArrowDown') {
      const list = visibleTemplates();
      if (!list.length) return;
      e.preventDefault();
      const i = list.findIndex((t) => t.id === view.selected);
      selectTemplate(list[Math.min(list.length - 1, i + 1)].id);
      return;
    }
    if (e.key === 'k' || e.key === 'ArrowUp') {
      const list = visibleTemplates();
      if (!list.length) return;
      e.preventDefault();
      const i = list.findIndex((t) => t.id === view.selected);
      selectTemplate(list[Math.max(0, i <= 0 ? 0 : i - 1)].id);
      return;
    }
    if (/^[1-9]$/.test(e.key) && view.tab === 'library') {
      const cats = [...Store.s.categories].sort((a, b) => a.order - b.order);
      const n = parseInt(e.key, 10);
      const c = cats[n - 1];
      if (c) { e.preventDefault(); view.cat = c.id; render(); }
    }
  });
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  Store.edit((st) => { st.settings.theme = cur === 'dark' ? 'light' : 'dark'; }, 'ui');
  applyTheme();
  Bus.toast(cur === 'dark' ? 'Light' : 'Dark', '', 1100);
}

/* ---------- misc ---------- */
function togglePaneOpen() { if (view.selected) { view.selected = null; render(); } }
function updateStorageBadge() {
  const el = document.getElementById('storage-used');
  if (!el) return;
  if (!navigator.storage?.estimate) { el.textContent = 'unknown'; return; }
  navigator.storage.estimate().then((r) => {
    el.textContent = bytes(r.usage || 0) + ' used' + (r.quota ? ' of ~' + bytes(r.quota) : '');
  }).catch(() => { el.textContent = 'unknown'; });
}
