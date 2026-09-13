/* =========================================================
   ui.js — pure rendering. Reads Store.s + view, writes HTML.
   All interaction is delegated through data-act attributes.
   ========================================================= */

const ICON = {
  search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.4-3.4"/></svg>',
  copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15"/></svg>',
  check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>',
  edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14.5 6.5l3 3"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7m-7.5 0 .6 12.5h7.8L18 7"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.7 1.1-5.9L3.5 9.7l5.9-.8L12 3.5z"/></svg>',
  close: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  file: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/></svg>',
  download: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m-4-4l4 4 4-4M5 20h14"/></svg>',
  open: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>',
  attach: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.5l-7.8 7.8a4.6 4.6 0 0 1-6.5-6.5l8-8a3 3 0 0 1 4.3 4.3l-7.9 7.9a1.5 1.5 0 0 1-2.1-2.1l7.1-7.1"/></svg>',
  arrow: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13m-5-6l6 6-6 6"/></svg>',
  gear: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a1.7 1.7 0 1 1-3.4 0v-.1A1.6 1.6 0 0 0 8 19.4l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1A1.6 1.6 0 0 0 4 14.5h-.2a1.7 1.7 0 1 1 0-3.4H4A1.6 1.6 0 0 0 5 8.4l-.1-.1A1.7 1.7 0 1 1 7.3 5.9l.1.1a1.6 1.6 0 0 0 2.7-1.1V4.7a1.7 1.7 0 1 1 3.4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.6 1.6 0 0 0-1.5 1z"/></svg>',
  bolt: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z"/></svg>',
  lib: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5v-13z"/><path d="M12 4h3.5A1.5 1.5 0 0 1 17 5.5v13a1.5 1.5 0 0 1-1.5 1.5H12z"/><path d="M20 6v13"/></svg>',
  shelf: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9V4.5A1.5 1.5 0 0 1 4.5 3h15A1.5 1.5 0 0 1 21 4.5V9"/><path d="M3 9v10.5A1.5 1.5 0 0 0 4.5 21h15a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M8 13h8"/></svg>',
  cases: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12h18"/></svg>',
  grip: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>',
  quote: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 6C4.8 7.3 3.5 9.4 3.5 12v6H10v-6.5H7c0-1.8.8-3.2 2.4-4.2L7 6zm10 0c-2.2 1.3-3.5 3.4-3.5 6v6H20v-6.5h-3c0-1.8.8-3.2 2.4-4.2L17 6z"/></svg>'
};

const esc2 = esc;

/* ---------- shell pieces ---------- */
function renderTopbar() {
  const s = Store.s;
  return `
  <header class="topbar">
    <button class="btn icon ghost menu-btn" data-act="toggle-rail" aria-label="Menu">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M4 7.5h16M4 12.5h11M4 17.5h7"/></svg>
      </div>
      <div>
        <div class="brand-name">OSR Desk</div>
      </div>
      <span class="brand-sub">· your own support kit</span>
    </div>
    <div class="topbar-spacer"></div>
    <div class="search-wrap">
      ${ICON.search}
      <input id="global-search" type="search" autocomplete="off" spellcheck="false"
             placeholder="Search templates, phrases, files, cases…" value="${esc(view.q)}" aria-label="Search everything">
      <span class="kbd-hint"><kbd id="mod-key">Ctrl</kbd><kbd>K</kbd></span>
    </div>
    <button class="btn" data-act="palette">${ICON.bolt}<span>Palette</span></button>
    <button class="btn primary" data-act="new-template">${ICON.plus}<span>New template</span></button>
    <button class="btn icon ghost" data-act="toggle-railhide" title="Hide this sidebar (Ctrl+B)" aria-label="Hide sidebar">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M9.5 4.5v15"/></svg>
    </button>
    <button class="btn icon ghost" data-act="settings" title="Settings & backup" aria-label="Settings">${ICON.gear}</button>
  </header>`;
}

function railItem(act, label, opts = {}) {
  const cnt = opts.count != null ? `<span class="count">${opts.count}</span>` : '';
  const dot = opts.color ? `<span class="dot" style="background:${opts.color}"></span>` : (opts.icon || '');
  return `<button class="rail-item ${opts.active ? 'active' : ''}" data-act="${act}" ${opts.data || ''}
            title="${esc2(opts.title || label)}">${dot}<span class="label">${esc2(label)}</span>${cnt}</button>`;
}

function renderRail() {
  const s = Store.s;
  const cats = [...s.categories].sort((a, b) => a.order - b.order);
  const favCount = s.templates.filter((t) => t.favorite).length;
  const tabs = [
    ['library', 'Templates', ICON.lib],
    ['files', 'Resource shelf', ICON.shelf],
    ['cases', 'Live cases', ICON.cases]
  ];
  return `
  <nav class="rail" aria-label="Sections">
    <div>
      <div class="rail-sec-title">Workspace</div>
      <div class="rail-list">
        ${tabs.map(([tab, name, ic]) =>
          railItem('tab:' + tab, name, { active: view.tab === tab, icon: `<span style="color:var(--ink-3);display:flex">${ic}</span>` })).join('')}
      </div>
    </div>

    <div>
      <div class="rail-sec-title">Library</div>
      <div class="rail-list">
        ${railItem('cat:all', 'All templates', { active: view.tab === 'library' && view.cat === 'all', count: s.templates.length })}
        ${railItem('cat:fav', 'Starred', { active: view.cat === 'fav', count: favCount })}
        ${railItem('cat:used', 'Recently used', { active: view.cat === 'used', count: s.templates.filter((t) => t.usage > 0).length })}
        ${railItem('cat:orphan', 'No category', { active: view.cat === 'orphan', count: s.templates.filter((t) => !cats.some((c) => c.id === t.category)).length })}
      </div>
    </div>

    <div>
      <div class="rail-sec-title">Categories <button class="btn ghost sm" data-act="add-cat" title="New category">${ICON.plus}</button></div>
      <div class="rail-list">
        ${cats.map((c) => {
          const n = s.templates.filter((t) => t.category === c.id).length;
          return railItem('cat:' + c.id, c.name, {
            active: view.cat === c.id, count: n, color: c.color || 'var(--ink-3)', title: c.desc || c.name
          });
        }).join('') || `<div class="rail-empty">No categories yet.</div>`}
      </div>
    </div>

    <div>
      <div class="rail-sec-title">Quick add</div>
      <div class="rail-list">
        ${railItem('new-template', 'New template', { icon: `<span style="color:var(--ink-3);display:flex">${ICON.plus}</span>` })}
        ${railItem('new-phrase', 'New phrase / line', { icon: `<span style="color:var(--ink-3);display:flex">${ICON.quote}</span>` })}
        ${railItem('drop-files', 'Drop / add files', { icon: `<span style="color:var(--ink-3);display:flex">${ICON.file}</span>`, count: s.files.length })}
        ${railItem('new-case', 'New case', { icon: `<span style="color:var(--ink-3);display:flex">${ICON.cases}</span>`, count: s.cases.filter((c) => c.status !== 'resolved').length })}
      </div>
    </div>

    <div class="rail-foot">
      ${s.settings.yourName ? `<div class="rail-sec-title" style="padding-bottom:2px">Signed in as</div>
        <div class="rail-item" data-act="settings" title="Edit your signature & details">
          <span class="dot" style="background:var(--ok)"></span>
          <span class="label">${esc2(s.settings.yourName)}${s.settings.company ? ' · ' + esc2(s.settings.company) : ''}</span>
        </div>` : `<button class="rail-item" data-act="settings"><span class="dot" style="background:var(--warn)"></span><span class="label">Add your name &amp; signature</span></button>`}
      <div class="save-state ${Store.isDirty ? 'dirty' : ''}" id="save-state" title="${Store.mode === 'idb' ? 'IndexedDB · ' + DB.name : 'local storage'}"><i></i><span>${Store.isDirty ? 'Saving…' : (Store.mode === 'idb' ? 'Saved to the local database' : (KV.available ? 'Saved on this PC' : 'Not persisting!'))}</span></div>
    </div>
  </nav>`;
}

/* ---------- the optional mirror (see src/js/sync.js) ---------- */
function syncCard() {
  const st = (typeof Sync !== 'undefined') ? Sync.status(Store.s) : { configured: false, signedIn: false };
  const cfg = (typeof Sync !== 'undefined') ? (Sync.config() || {}) : {};
  const dot = !st.configured ? 'var(--line)' : (st.signedIn ? (st.error ? 'var(--warn)' : 'var(--ok)') : 'var(--warn)');
  const state = !st.configured ? 'Off — nothing leaves this machine'
    : !st.signedIn ? 'Configured, not signed in'
    : st.busy ? (st.busy === 'push' ? 'Pushing…' : 'Pulling…')
    : st.error ? 'Problem: ' + st.error
    : st.pending ? st.pending + ' row' + (st.pending === 1 ? '' : 's') + ' waiting to go up'
    : 'Up to date';
  return `<div class="set-card">
      <h4><span class="dot" style="background:${dot};display:inline-block;margin-right:6px"></span>${ICON.arrow} Sync to your own database <span class="help" style="font-weight:400">(optional)</span></h4>
      <p class="desc">Mirrors the <b>text</b> of this desk — templates, phrases, categories, cases, remembered placeholders and settings — into a Postgres you own, so a second machine can pull it. Your <b>file shelf is never sent</b>, the local database stays the working copy, and with sync off this file behaves exactly as it always did.</p>
      ${!st.configured ? `<div class="form-row"><label class="lbl" for="sync-url">Project URL</label>
        <input class="txt" id="sync-url" data-sync-field="url" value="${esc2(cfg.url || '')}" placeholder="https://your-project.supabase.co" spellcheck="false" style="font-size:12.5px"></div>
      <div class="form-row"><label class="lbl" for="sync-key">Publishable key</label>
        <input class="txt" id="sync-key" data-sync-field="key" value="" placeholder="sb_publishable_…" spellcheck="false" style="font-size:12.5px"></div>
      <div class="help">The <b>publishable</b> (anon) key only. Never paste the <code>service_role</code> secret in here — it bypasses the row-level security that keeps other people out of your rows.</div>
      <div class="row" style="display:flex;gap:7px;margin-top:8px"><button class="btn primary" data-act="sync-save">Save &amp; connect</button></div>` : ''}
      ${st.configured && !st.signedIn ? `<div class="form-row"><label class="lbl" for="sync-email">Login email</label>
        <input class="txt" id="sync-email" value="${esc2(cfg.email || '')}" placeholder="you@example.com" spellcheck="false" autocomplete="username" style="font-size:12.5px"></div>
      <div class="form-row"><label class="lbl" for="sync-pass">Password</label>
        <input class="txt" id="sync-pass" type="password" placeholder="the password of your Supabase user" autocomplete="current-password" style="font-size:12.5px"></div>
      <div class="row" style="display:flex;gap:7px;margin-top:8px">
        <button class="btn primary" data-act="sync-signin">${ICON.check} Sign in &amp; pull</button>
        <button class="btn ghost" data-act="sync-clear">Disconnect</button>
      </div>
      <div class="help">Signed in as the user you created under <b>Authentication → Users</b>. The token is kept in this browser only.</div>` : ''}
      ${st.signedIn ? `<div class="meta-row"><span>${esc2(state)}</span><span>·</span><span>${st.lastSyncAt ? 'last run ' + ago(st.lastSyncAt) : 'no run yet'}</span>
        ${st.pushed ? `<span>·</span><span>${st.pushed} rows up</span>` : ''}${st.pulled ? `<span>·</span><span>${st.pulled} rows down</span>` : ''}</div>
      <div class="row" style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px">
        <button class="btn primary" data-act="sync-now">${ICON.arrow} Sync now</button>
        <button class="btn" data-act="sync-push-all">Send everything up</button>
        <button class="btn ghost" data-act="sync-signout">Sign out</button>
        <button class="btn ghost" data-act="sync-clear">Forget this project</button>
      </div>
      <div class="help">Polls every 60 s and whenever this window is focused. <b>Send everything up</b> ignores the change-tracking and re-sends the whole library — use it after an import, or if a machine has been offline a long time.</div>` : ''}
    </div>`;
}

/* ---------- library ---------- */
function templateCard(t, q) {
  const cat = Q.category(t.category);
  const v = varsIn(t.body);
  const files = (t.fileIds || []).length;
  const preview = String(t.body).replace(/\{\{\s*([^}]+?)\s*\}\}/g, '[$1]');
  return `
  <article class="card ${view.selected === t.id ? 'selected' : ''}" data-act="select" data-id="${t.id}" tabindex="0"
           role="button" aria-label="Template ${esc2(t.title)}">
    <div class="card-top">
      <h3 class="card-title">${hl(t.title, q)}</h3>
      <span class="card-cat">${cat ? `<span class="dot" style="width:6px;height:6px;border-radius:9px;background:${cat.color || 'var(--ink-3)'};display:inline-block"></span>${esc2(cat.name)}` : 'Unsorted'}</span>
      <button class="star ${t.favorite ? 'on' : ''}" data-act="star" data-id="${t.id}" title="${t.favorite ? 'Unstar' : 'Star this'}" aria-label="Star">${ICON.star}</button>
    </div>
    ${t.subject ? `<div class="card-subj">${hl(t.subject, q)}</div>` : ''}
    <div class="card-snip">${hl(preview.slice(0, 320), q)}</div>
    <div class="card-foot">
      <div class="card-meta">
        ${v.length ? `<span class="varpill" title="Placeholders you'll be prompted to fill">${v.length} field${v.length > 1 ? 's' : ''}</span>` : ''}
        ${files ? `<span class="filepill">${ICON.file}${files}</span>` : ''}
        ${(t.tags || []).slice(0, 2).map((tag) => `<span class="tag" data-act="tag" data-tag="${esc2(tag)}" title="Filter by #${esc2(tag)}">#${esc2(tag)}</span>`).join('')}
        ${t.usage ? `<span title="Copied ${t.usage}×">×${t.usage}</span>` : ''}
      </div>
      <div class="card-btns">
        <button class="btn sm" data-act="edit" data-id="${t.id}" title="Edit (E)">${ICON.edit}<span>Edit</span></button>
        <button class="btn sm copy-btn" data-act="copy" data-id="${t.id}" title="Copy to clipboard (C)">${ICON.copy}<span>Copy</span></button>
      </div>
    </div>
  </article>`;
}

function phraseRow(p, q) {
  return `<div class="phrase" data-act="copy-phrase" data-id="${p.id}" tabindex="0" title="Click to copy · right-click / long-press for options">
    <p>${hl(p.text, q)}</p>
    <span class="copy-inline btn sm" style="pointer-events:none">${ICON.copy}</span>
  </div>`;
}

function recentCopiedStrip() {
  const items = (Store.s.activity || []).filter((a) => a.kind === 'copy').slice(0, 6);
  if (items.length < 2) return '';
  return `<div class="tagchips" style="margin:-4px 0 12px;align-items:center">
    <span style="font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:var(--ink-3)">Just copied</span>
    ${items.map((a) => {
      const t = Q.template(a.ref) || Q.phrase?.(a.ref);
      const label = a.title || t?.title || (a.ref || '').toString();
      return `<button class="chip" data-act="recopy" data-kind="${a.refKind || 'tpl'}" data-id="${a.ref}" title="Copy again">${ICON.copy} ${esc2(label.length > 34 ? label.slice(0, 34) + '…' : label)}</button>`;
    }).join('')}
  </div>`;
}

function renderLibrary(list, filtered) {
  const s = Store.s;
  const cat = Q.category(view.cat);
  const titles = {
    all: 'All templates', fav: 'Starred', used: 'Recently used', orphan: 'No category'
  };
  const title = cat ? cat.name : titles[view.cat] || 'All templates';
  const desc = cat?.desc || (view.cat === 'fav' ? 'The ones you reach for. Anything can be starred from its card.'
    : view.cat === 'used' ? 'Sorted by how often you actually copy each one.'
    : titles[view.cat] ? 'Everything you keep. Click a card to open it, C to copy it, E to change it.' : '');
  const tags = Q.allTags().slice(0, 14);
  const phrases = s.phrases || [];

  return `
  <div class="main-head">
    <div>
      <div class="main-title">${esc2(title)}</div>
      <div class="main-desc">${esc2(desc || '')}</div>
    </div>
    <div class="main-actions">
      ${cat ? `<button class="btn sm ghost" data-act="edit-cat" data-id="${cat.id}" title="Rename / recolor">${ICON.edit}</button>
               <button class="btn sm ghost" data-act="del-cat" data-id="${cat.id}" title="Delete category (templates move to No category)">${ICON.trash}</button>` : ''}
      <button class="btn sm" data-act="new-phrase">${ICON.quote}<span>Add phrase</span></button>
      <button class="btn sm" data-act="print">${ICON.download}<span>Print sheet</span></button>
      <button class="btn sm" data-act="new-template">${ICON.plus}<span>Template</span></button>
    </div>
  </div>

  <div class="toolbar">
    <div class="field-inline">
      <select class="mini" data-act="set-sort" aria-label="Sort">
        ${[['manual', 'My order'], ['recent', 'Last used first'], ['az', 'A → Z'], ['used', 'Most used'], ['new', 'Last edited'], ['cat', 'By category']]
          .map(([v, l]) => `<option value="${v}" ${s.settings.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="field-inline">
      <select class="mini" data-act="set-view" aria-label="Layout">
        <option value="grid" ${s.settings.view === 'grid' ? 'selected' : ''}>Cards</option>
        <option value="list" ${s.settings.view === 'list' ? 'selected' : ''}>List</option>
      </select>
    </div>
    <div class="sep"></div>
    <div class="tagchips">
      ${tags.map(([tag, n]) => `<button class="chip ${view.tags.includes(tag) ? 'on' : ''}" data-act="tag" data-tag="${esc2(tag)}">#${esc2(tag)} <span style="opacity:.65">${n}</span></button>`).join('')}
      ${view.tags.length ? `<button class="chip" data-act="clear-tags" style="color:var(--bad)">clear ${view.tags.length}</button>` : ''}
    </div>
    <div class="grow"></div>
    <span style="font-size:11.5px;color:var(--ink-3)">${list.length} shown</span>
  </div>

  ${recentCopiedStrip()}
  ${renderChecklist()}

  ${list.length === 0 ? emptyLibrary(filtered) : `
    <div class="${s.settings.view === 'list' ? 'list' : 'grid'}">
      ${list.map((t) => templateCard(t, view.q)).join('')}
    </div>`}

  ${view.cat === 'all' && !filtered && phrases.length ? `
    <div class="pane-sec" style="margin-top:26px">
      <h4>${ICON.quote} Grab-and-go lines <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--ink-3)">— single sentences, click to copy</span>
        <button class="btn ghost sm" data-act="new-phrase" style="margin-left:auto">${ICON.plus} Add</button>
      </h4>
      <div class="phrase-grid">${phrases.map((p) => phraseRow(p, view.q)).join('')}</div>
    </div>` : ''}
  `;
}

function emptyLibrary(filtered) {
  if (filtered) {
    return `<div class="empty">
      <h3>Nothing matches “${esc2(view.q)}”${view.tags.length ? ' + #' + esc2(view.tags.join(', #')) : ''}</h3>
      <p>Search looks at titles, the email body, tags and categories. Try fewer words, or make this a new template — one you wrote beats one you can't find.</p>
      <div class="row">
        <button class="btn" data-act="clear-search">Clear search</button>
        <button class="btn primary" data-act="new-template">${ICON.plus} New template from scratch</button>
      </div>
    </div>`;
  }
  return `<div class="empty">
    <h3>Nothing here yet</h3>
    <p>Save the emails you send every day. Open one of your sent messages, copy the body, hit <b>New template</b>, and swap the client-specific bits for placeholders like <code style="font-family:var(--mono)">{{first_name}}</code>.</p>
    <div class="row">
      <button class="btn primary" data-act="new-template">${ICON.plus} New template</button>
      <button class="btn" data-act="import">Import a backup</button>
    </div>
  </div>`;
}

const SETUP = [
  { key: 'me', label: 'Put your name + signature on file', hint: 'so {{agent_name}} fills itself in', act: 'settings', icon: ICON.gear },
  { key: 'own', label: 'Write 5 of your own templates', hint: 'the ones only your team sends', act: 'new-template', icon: ICON.plus },
  { key: 'star', label: 'Star the 3 you use most', hint: 'they jump to the Starred view', act: 'cat:fav', icon: ICON.star },
  { key: 'files', label: 'Drop the docs you keep re-opening', hint: 'SOPs, price list, escalation contacts', act: 'tab:files', icon: ICON.file },
  { key: 'cases', label: 'Put today\u2019s open threads on the board', hint: 'who owes you a reply', act: 'tab:cases', icon: ICON.cases }
];

function renderChecklist() {
  const st = Store.s;
  if (st.settings.hideChecklist) return '';
  const done = {
    me: !!(st.settings.yourName && (st.settings.signature || st.settings.company)),
    own: st.templates.filter((t) => t.custom).length >= 5,
    star: st.templates.filter((t) => t.favorite).length >= 3,
    files: st.files.length > 0,
    cases: st.cases.length > 0
  };
  const n = Object.values(done).filter(Boolean).length;
  if (n === 5) return `<div class="checklist done-strip"><b>${ICON.check} Your desk is set up.</b>
    <span>Five habits in there will save you an hour a day: search before you type, keep placeholders short, star the winners, prune what you never copy, and export weekly.</span>
    <button class="btn sm ghost" data-act="hide-checklist">hide this</button></div>`;
  return `<div class="checklist">
    <div class="cl-head"><b>First week</b><span>${n} of 5 done</span>
      <div class="cl-bar"><i style="width:${(n / 5) * 100}%"></i></div>
      <button class="btn sm ghost" data-act="hide-checklist" title="Not now">hide</button></div>
    <div class="cl-items">
      ${SETUP.map((item) => `<button class="cl-item ${done[item.key] ? 'on' : ''}" data-act="${item.act}" title="${esc2(item.hint)}">
        <span class="tick">${done[item.key] ? ICON.check : ''}</span>
        <span class="ci-label">${esc2(item.label)}</span><span class="ci-hint">${esc2(item.hint)}</span></button>`).join('')}
    </div>
  </div>`;
}

/* ---------- files ---------- */
function fileCard(f, opts = {}) {
  const isImg = /^image\//.test(f.mime || '');
  const link = f.kind === 'link';
  return `
  <article class="file-card ${opts.dragging ? 'dragging' : ''}" data-file="${f.id}" draggable="true" data-act="${opts.attach ? 'noop' : 'open-file'}" data-id="${f.id}">
    <div class="file-thumb">
      ${link ? `<div style="font-size:11.5px;padding:0 10px;text-align:center;color:var(--accent);word-break:break-all">${esc2(String(f.url || '').replace(/^https?:\/\//, '').slice(0, 60))}</div>`
        : isImg && f.thumb ? `<img src="${esc2(f.thumb)}" alt="${esc2(f.name)}">`
        : `<span class="ext">${esc2((link ? 'link' : (f.name.split('.').pop() || 'file')).slice(0, 4))}</span>`}
    </div>
    <div class="file-name">${esc2(f.name)}</div>
    <div class="file-sub">
      ${link ? 'Saved link' : bytes(f.size)}
      ${f.note ? ' · ' + esc2(f.note) : ''}
      ${opts.showUsage ? `<span style="margin-left:auto">${(Store.s.templates || []).filter((t) => (t.fileIds || []).includes(f.id)).length} tpl</span>` : ''}
    </div>
    <div class="file-btns">
      ${opts.tpl ? `<button class="btn sm danger" data-act="detach" data-id="${f.id}" data-tpl="${opts.tpl}" title="Remove from this template">${ICON.close}</button>` : ''}
      ${link ? '' : `<button class="btn sm" data-act="download-file" data-id="${f.id}">${ICON.download}</button>`}
      <button class="btn sm" data-act="use-file" data-id="${f.id}" title="Attach to a template or case">${ICON.attach}</button>
      <button class="btn sm" data-act="rename-file" data-id="${f.id}" title="Rename / add note">${ICON.edit}</button>
      <button class="btn sm" data-act="open-file" data-id="${f.id}" title="Open / preview">${ICON.open}</button>
      <button class="btn sm" data-act="del-file" data-id="${f.id}" title="Delete file">${ICON.trash}</button>
    </div>
  </article>`;
}

function renderFiles(list) {
  const s = Store.s;
  const used = s.templates.reduce((n, t) => n + (t.fileIds || []).length, 0);
  return `
  <div class="main-head">
    <div>
      <div class="main-title">Resource shelf</div>
      <div class="main-desc">Drag any file straight onto this window — SOPs, screenshots, price lists, one-pagers, links to internal docs. Files live on this PC only. Drop one on a template card to attach it there.</div>
    </div>
    <div class="main-actions">
      <button class="btn sm" data-act="add-link">${ICON.plus}<span>Save a link</span></button>
      <button class="btn sm" data-act="pick-files">${ICON.file}<span>Choose files</span></button>
      <button class="btn primary" data-act="drop-files">${ICON.plus}<span>Drop zone</span></button>
    </div>
  </div>

  <div class="toolbar">
    <span class="chip" style="pointer-events:none">${s.files.length} files · ${used} attachments</span>
    <span class="chip" style="pointer-events:none">${Q.orphans().length} unattached</span>
    <div class="grow"></div>
    <div class="field-inline"><label class="help" for="file-filter">filter</label>
      <input id="file-filter" class="mini" type="search" placeholder="filename…" value="${esc2(view.fileQ || '')}" data-act="file-filter" style="width:130px">
    </div>
  </div>

  <div class="dropzone ${view.dropHot ? 'hot' : ''}" id="files-drop" data-act="pick-files">
    ${ICON.file}
    <div><b>Drop files here</b> — or anywhere in this window — or click to browse. Images, PDFs, text, sheets, zips: everything is stored on this PC (files over ${'50 MB'} are kept as a labelled shortcut instead).</div>
    <div class="help">Drop a <code>.txt</code> / <code>.md</code> file and you can turn it into templates in one click. Paste a screenshot with <kbd>Ctrl</kbd>+<kbd>V</kbd> and it lands here too. Drag one onto a template card to attach it to that reply.</div>
  </div>

  ${list.length ? `<div class="files-grid" style="margin-top:12px">${list.map((f) => fileCard(f, { showUsage: true })).join('')}</div>`
    : `<div class="empty" style="margin-top:12px"><h3>Shelf is empty</h3><p>Keep the things you re-open all day here: keyboard-shortcut cheatsheets, the escalation contact list, your latest price table, the “good screenshot” of each error message.</p></div>`}
  `;
}

/* ---------- cases ---------- */
const CASE_STATUS = [['new', 'New'], ['awaiting', 'Awaiting client'], ['progress', 'In progress'], ['escalated', 'Escalated'], ['resolved', 'Resolved']];
const CASE_PRIO = [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']];

function renderCases(list) {
  const s = Store.s;
  const open = s.cases.filter((c) => c.status !== 'resolved');
  const st = (k) => s.cases.filter((c) => c.status === k).length;
  return `
  <div class="main-head">
    <div>
      <div class="main-title">Live cases</div>
      <main class="main-desc" style="display:block">Your own scratchpad for threads you're holding. Not a ticket system — a “who am I waiting on / who is waiting on me” list. Drop a screenshot onto a row to attach it.</main>
    </div>
    <div class="main-actions">
      <button class="btn sm" data-act="clear-resolved">${ICON.trash}<span>Clear resolved</span></button>
      <button class="btn primary" data-act="new-case">${ICON.plus}<span>New case</span></button>
    </div>
  </div>

  <div class="stat-row">
    <div class="stat"><b>${open.length}</b><span>Open</span></div>
    <div class="stat"><b>${st('awaiting')}</b><span>Waiting on client</span></div>
    <div class="stat"><b>${st('escalated')}</b><span>With another team</span></div>
    <div class="stat"><b>${st('new')}</b><span>New / unassigned</span></div>
    <div class="stat"><b>${st('resolved')}</b><span>Resolved</span></div>
  </div>

  ${list.length ? `
  <div class="table-wrap">
    <table class="cases">
      <thead><tr>
        <th style="width:19%">Client / thread</th><th style="width:12%">Status</th><th style="width:11%">Next step &amp; date</th>
        <th style="width:29%">Notes</th><th style="width:14%">Files</th><th style="width:15%"></th>
      </tr></thead>
      <tbody>
      ${list.map((c) => `
        <tr data-case="${c.id}" data-act="edit-case" data-id="${c.id}">
          <td>
            <div style="font-weight:600;font-size:12.5px">${esc2(c.client || '—')}</div>
            <div style="font-size:11.5px;color:var(--ink-3)">${esc2(c.ticket || '')}${c.subject ? ' · ' + esc2(c.subject) : ''}</div>
            ${c.priority && c.priority !== 'normal' ? `<span class="chip" style="height:19px;font-size:10px;margin-top:3px;color:var(--bad);border-color:color-mix(in srgb, var(--bad) 30%, var(--line))">${esc2(c.priority)}</span>` : ''}
          </td>
          <td>
            <select class="mini status-pill" data-status="${c.status}" data-act="case-status" data-id="${c.id}" style="max-width:150px;font-weight:600">
              ${CASE_STATUS.map(([v, l]) => `<option value="${v}" ${c.status === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            ${c.owner ? `<div style="font-size:11px;color:var(--ink-3);margin-top:3px">${esc2(c.owner)}</div>` : ''}
          </td>
          <td>
            <div class="case-note" style="font-size:11.5px">${esc2(c.next || '—')}</div>
            ${c.due ? `<div style="font-size:11px;color:${new Date(c.due) < new Date() && c.status !== 'resolved' ? 'var(--bad)' : 'var(--ink-3)'};margin-top:2px">${esc2(c.due)}</div>` : ''}
          </td>
          <td><div class="case-note">${hl(String(c.notes || '').slice(0, 240), view.q)}</div></td>
          <td>${(c.fileIds || []).length ? `<div class="tagchips">${(c.fileIds || []).map((id) => Q.file(id)).filter(Boolean).map((f) => `<button class="chip" data-act="open-file" data-id="${f.id}" title="${esc2(f.name)}">${ICON.file} ${esc2(f.name.slice(0, 16))}</button>`).join('')}</div>` : `<span style="font-size:11px;color:var(--ink-3)">drop a file on the row</span>`}</td>
          <td>
            <div class="case-row-actions">
              <button class="btn sm" data-act="case-reply" data-id="${c.id}" title="Copy a template with this case's details pre-filled">${ICON.copy}<span>Reply</span></button>
              <button class="btn sm ghost" data-act="edit-case" data-id="${c.id}">${ICON.edit}</button>
              <button class="btn sm ghost" data-act="del-case" data-id="${c.id}" title="Delete case">${ICON.trash}</button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : `<div class="empty"><h3>No cases on the board</h3><p>Add the 3–6 threads you're personally holding today: who, ticket, what you promised, when. Use “Reply” on a row to fire a template with the client name and ticket already filled in.</p><div class="row"><button class="btn primary" data-act="new-case">${ICON.plus} New case</button></div></div>`}
  `;
}

/* ---------- settings ---------- */
function renderSettings() {
  const s = Store.s.settings;
  const accents = ['#2f6df6', '#0f9d8a', '#7b5cd6', '#d98314', '#c1362f', '#2f8a3f', '#b0457a', '#4a5b6a'];
  const tplCount = Store.s.templates.length, phCount = Store.s.phrases.length;
  let legacyBlob = 0;
  try { legacyBlob = (localStorage.getItem(LS_KEY) || '').length; } catch (e) { legacyBlob = 0; }
  if (Store.mode === 'idb' && !legacyBlob) legacyBlob = 0;
  return `
  <div class="main-head"><div><div class="main-title">Settings &amp; backup</div>
    <div class="main-desc">Everything is stored in this browser profile on this machine — no account, no server, nothing sent anywhere. Back it up by exporting.</div></div></div>

  <div class="set-grid">
    <div class="set-card">
      <h4>${ICON.bolt} You, on file</h4>
      <p class="desc">These fill <code>{{agent_name}}</code>, <code>{{company}}</code> and <code>{{role}}</code> automatically, and get appended as your signature when you ask for it.</p>
      <div class="form-row"><label class="lbl" for="set-name">Display name</label><input id="set-name" class="txt" data-set="yourName" value="${esc2(s.yourName)}" placeholder="e.g. Ry O. Tan"></div>
      <div class="form-row"><label class="lbl" for="set-role">Role</label><input id="set-role" class="txt" data-set="yourRole" value="${esc2(s.yourRole)}"></div>
      <div class="form-row"><label class="lbl" for="set-company">Company / product</label><input id="set-company" class="txt" data-set="company" value="${esc2(s.company)}"></div>
      <div class="form-row"><label class="lbl" for="set-sig">Signature block</label>
        <textarea class="txt" id="set-sig" data-set="signature" style="min-height:96px;font-family:var(--font);font-size:13px">${esc2(s.signature)}</textarea>
        <div class="checkrow"><input type="checkbox" id="set-appsig" data-set="appendSignature" ${s.appendSignature ? 'checked' : ''}><label for="set-appsig">Always append signature after copy</label></div>
      </div>
    </div>

    <div class="set-card">
      <h4>${ICON.gear} Feel</h4>
      <div class="form-row"><label class="lbl">Theme</label>
        <div class="seg">
          ${[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button class="${s.theme === v ? 'on' : ''}" data-act="seg-theme" data-val="${v}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="form-row"><label class="lbl">Accent</label><div class="swatches">
        ${accents.map((c) => `<button class="swatch ${s.accent === c ? 'on' : ''}" data-act="set-accent" data-val="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
      </div></div>
      <div class="form-row"><label class="lbl">Density</label>
        <div class="seg">
          ${[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([v, l]) => `<button class="${s.density === v ? 'on' : ''}" data-act="seg-density" data-val="${v}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="form-row"><label class="lbl" for="set-fs">Preview text size — ${s.fontSize}px</label>
        <input id="set-fs" type="range" min="12" max="19" step=".5" value="${s.fontSize}" data-set="fontSize"></div>
      <div class="checkrow"><input type="checkbox" id="set-plain" data-set="plainCopy" ${s.plainCopy ? 'checked' : ''}><label for="set-plain">Copy as plain text (avoids pasting our blue highlight boxes into email)</label></div>
      <div class="checkrow"><input type="checkbox" id="set-rem" data-set="rememberFill" ${s.rememberFill ? 'checked' : ''}><label for="set-rem">Remember what I typed in {{placeholders}} for the day</label></div>
    </div>

    <div class="set-card">
      <h4>${ICON.shelf} Where your data lives</h4>
      <p class="desc">One local database on this machine — <b>no server, no account, nothing uploaded</b>. Text, files and screenshots are stored as separate rows, so a 4 MB screenshot can no longer stop your templates from saving.</p>
      <div class="meta-row" id="db-summary"><span class="help">checking…</span></div>
      <div id="db-tables" class="tagchips" style="margin-top:6px"></div>
      ${legacyBlob ? `<div class="help" style="margin-top:6px">A pre-migration copy is still in local storage (${esc2(bytes(legacyBlob))}). Keep it as a rollback, or free the space once you have exported a backup.</div>` : ''}
      <div class="row" style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px">
        <button class="btn" data-act="db-verify">${ICON.check} Verify database</button>
        <button class="btn" data-act="db-repair">${ICON.bolt} Rewrite every row</button>
        <button class="btn" data-act="db-diagnostics">${ICON.copy} Copy diagnostics</button>
        ${legacyBlob ? `<button class="btn ghost" data-act="db-clear-legacy">Delete the old copy</button>` : ''}
        <button class="btn ghost" data-act="db-console">Console commands</button>
      </div>
      <div class="help">Storage used: <span id="storage-used">…</span> · last write <span id="db-last">…</span></div>
    </div>

    ${syncCard()}

    <div class="set-card">
      <h4>${ICON.download} Backup &amp; move it</h4>
      <p class="desc">Export writes one JSON file with every template, phrase, category, case, and (optionally) the files themselves. Keep it in your OneDrive / Dropbox / a folder and you can be back up in 10 seconds on any machine.</p>
      <div class="row" style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn primary" data-act="export">${ICON.download} Export workspace</button>
        <button class="btn" data-act="export" data-include-files="1">${ICON.file} Export with files</button>
        <button class="btn" data-act="import">${ICON.arrow} Import / merge</button>
        <button class="btn" data-act="export-md">Export as Markdown</button>
        <button class="btn" data-act="print">Print cheat sheet</button>
      </div>
      <div class="help">Current workspace: <b>${tplCount}</b> templates · <b>${phCount}</b> phrases · <b>${Store.s.files.length}</b> files · <b>${Store.s.cases.length}</b> cases, all in ${Store.mode === 'idb' ? 'the local database' : 'this browser\'s local storage'}.</div>
    </div>

    <div class="set-card">
      <h4>${ICON.lib} Library maintenance</h4>
      <div class="form-row"><label class="lbl">Categories</label>
        <div style="display:flex;flex-direction:column;gap:4px">
        ${Store.s.categories.map((c) => `<div class="rail-item" style="cursor:default">
            <span class="dot" style="background:${c.color}"></span><span class="label">${esc2(c.name)}</span>
            <span class="count">${Q.templatesIn(c.id).length}</span>
            <button class="btn sm ghost" data-act="edit-cat" data-id="${c.id}">${ICON.edit}</button>
          </div>`).join('')}
        </div>
        <button class="btn sm" data-act="add-cat" style="align-self:flex-start;margin-top:4px">${ICON.plus} New category</button>
      </div>
      <div class="form-row"><label class="lbl">Common {{placeholders}} in your library</label>
        <div class="var-list">${Object.keys(Store.s.vars || {}).length ? Object.entries(Store.s.vars).map(([k, v]) => `<span class="chip" style="pointer-events:none" title="last used: ${esc2(String(v).slice(0, 40))}">${esc2(k)}</span>`).join('') : '<span class="help">Nothing filled in yet.</span>'}</div>
      </div>
      <button class="btn sm" data-act="help">${ICON.open} Show me the 30-second tour again</button>
    </div>

    <div class="set-card">
      <h4>${ICON.bolt} What I actually use</h4>
      <p class="desc">Honest signal for pruning: if a template hasn't been copied in a month it's noise. Delete it, or move it to the shelf as a note.</p>
      ${usagePanel()}</div>
    </div>

    <div class="set-card danger-zone">
      <h4 style="color:var(--bad)">Careful</h4>
      <p class="desc">These can't be undone unless you exported first.</p>
      <div style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn danger" data-act="reseed">Reset to starter library</button>
        <button class="btn danger" data-act="wipe">Wipe everything</button>
      </div>
    </div>

    <div class="set-card">
      <h4>Keyboard</h4>
      <table class="kbd-table">
        <tr><td><kbd class="mk">Ctrl</kbd>+<kbd>K</kbd></td><td>Command palette / search anything</td></tr>
        <tr><td><kbd>/</kbd></td><td>Jump to search</td></tr>
        <tr><td><kbd>N</kbd></td><td>New template</td></tr>
        <tr><td><kbd>Enter</kbd> / <kbd>C</kbd></td><td>Copy the open template</td></tr>
        <tr><td><kbd>E</kbd></td><td>Edit the open template</td></tr>
        <tr><td><kbd>J</kbd> <kbd>K</kbd></td><td>Next / previous template</td></tr>
        <tr><td><kbd>1</kbd>…<kbd>9</kbd></td><td>Jump to category</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>B</kbd></td><td>Show / hide this sidebar</td></tr>
        <tr><td><kbd>?</kbd></td><td>All shortcuts</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close panel / modal</td></tr>
      </table>
      <div class="help">On a Mac use <kbd>⌘</kbd> wherever you see <kbd>Ctrl</kbd>.</div>
    </div>
  </div>`;
}

/* ---------- preview pane ---------- */
function renderPane(t) {
  if (!t) return '';
  const cat = Q.category(t.category);
  const v = varsIn(t.body);
  const files = Q.filesFor(t);
  const filled = fillVars(t.body).text;
  return `
  <div class="pane-head">
    <span class="card-cat" style="flex:none">${cat ? `<span class="dot" style="width:6px;height:6px;border-radius:9px;background:${cat.color};display:inline-block"></span>${esc2(cat.name)}` : 'Unsorted'}</span>
    <div class="t" title="${esc2(t.title)}">${esc2(t.title)}</div>
    <button class="btn icon sm ghost" data-act="star" data-id="${t.id}" title="Star">${ICON.star}</button>
    <button class="btn icon sm ghost" data-act="close-pane" title="Close (Esc)" aria-label="Close">${ICON.close}</button>
  </div>
  <div class="pane-body">
    ${t.useWhen ? `<div class="pane-sec"><h4>When I use this</h4><div class="help" style="font-size:12.5px;color:var(--ink-2);line-height:1.6">${hl(t.useWhen, '')}</div></div>` : ''}
    <div class="pane-sec subj-row">
      <h4>Subject line <button class="btn ghost sm" data-act="copy-subject" data-id="${t.id}" style="margin-left:auto">${ICON.copy} ${t.subject ? 'Copy subject' : 'Add one'}</button></h4>
      ${t.subject ? `<div class="subj">${renderProse(fillVars(t.subject).text)}</div>` : `<div class="help">No subject on this template yet — click “Add one” to write it (useful when you start a new thread instead of replying).</div>`}
    </div>
    <div class="pane-sec">
      <h4>${ICON.copy} Email body <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--ink-3)">· ${t.body.length.toLocaleString()} chars</span></h4>
      <div class="prose" id="pane-prose" style="font-size:${Store.s.settings.fontSize}px">${renderProse(t.body)}</div>
    </div>
    <div class="pane-sec">
      <h4>${ICON.bolt} Filled preview</h4>
      <div class="prose" style="font-size:${Store.s.settings.fontSize}px;max-height:300px;overflow:auto">${renderProse(filled, true)}</div>
    </div>
    ${v.length ? `<div class="pane-sec"><h4>Fields it fills in</h4><div class="var-list">${v.map((k) => `<button class="chip" data-act="fill-var" data-key="${esc2(k)}" title="Update the value used for {{${esc2(k)}}}">{{${esc2(k)}}}</button>`).join('')}</div></div>` : ''}
    ${(t.tags || []).length ? `<div class="pane-sec"><h4>Tags</h4><div class="tagchips">${t.tags.map((tag) => `<button class="chip" data-act="tag" data-tag="${esc2(tag)}">#${esc2(tag)}</button>`).join('')}</div></div>` : ''}
    <div class="pane-sec">
      <h4>${ICON.file} Attachments <button class="btn ghost sm" data-act="attach-to" data-id="${t.id}" style="margin-left:auto">${ICON.plus} add</button></h4>
      ${files.length ? `<div class="files-grid">${files.map((f) => fileCard(f)).join('')}</div>` : `<div class="help">Nothing attached. You can drag a file straight onto this template's card — handy for “here's the form / screenshot / guide I always send”.</div>`}
    </div>
    <div class="meta-row">
      <span title="Copied ${t.usage} times">used ${t.usage || 0}×</span><span>·</span>
      <span>${t.lastUsed ? 'last copied ' + ago(t.lastUsed) : 'never copied'}</span><span>·</span>
      <span>edited ${ago(t.updatedAt)}</span>
    </div>
  </div>
  <div class="pane-foot">
    <button class="btn primary copy-btn" data-act="copy" data-id="${t.id}">${ICON.copy}<span>Copy</span></button>
    <button class="btn" data-act="fill-copy" data-id="${t.id}">${ICON.bolt}<span>Fill &amp; copy</span></button>
    <button class="btn" data-act="edit" data-id="${t.id}">${ICON.edit}<span>Edit</span></button>
    <span class="hint"><kbd>C</kbd> copy · <kbd>E</kbd> edit</span>
  </div>`;
}

function usagePanel() {
  const list = Store.s.templates.filter((t) => t.usage > 0).sort((a, b) => b.usage - a.usage).slice(0, 6);
  const never = Store.s.templates.filter((t) => !t.usage).length;
  const week = Store.s.templates.filter((t) => t.lastUsed && Date.now() - new Date(t.lastUsed) < 7 * 864e5).length;
  return `
  ${list.length ? `<div class="usage-list">${list.map((t) => {
    const max = list[0].usage || 1;
    return `<button class="usage-row" data-act="select" data-id="${t.id}" title="Open ${esc2(t.title)}">
      <span class="u-name">${esc2(t.title)}</span>
      <span class="u-bar"><i style="width:${Math.max(6, (t.usage / max) * 100)}%"></i></span>
      <span class="u-n">${t.usage}×</span><span class="u-ago">${ago(t.lastUsed)}</span></button>`;
  }).join('')}</div>` : '<div class="help">Nothing copied yet — this fills in as you use the desk.</div>'}
  <div class="meta-row"><span>${Store.s.templates.length} templates</span><span>·</span><span>${never} never copied</span><span>·</span><span>${week} used this week</span></div>`;
}

function renderProse(text, plain) {
  let out = esc(text);
  out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => `<span class="var">{{${esc(k.trim())}}}</span>`);
  if (plain) out = out.replace(/&lt;(b|i|u)&gt;|&lt;\/(b|i|u)&gt;/g, '');
  return out;
}
