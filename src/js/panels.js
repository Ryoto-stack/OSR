/* =========================================================
   panels.js — resource shelf (files), drag & drop, paste,
   live cases board, phrase editing
   ========================================================= */

const MAX_IDB = 50 * 1024 * 1024;   // per file, IndexedDB mode
const MAX_KV = 1.2 * 1024 * 1024;   // per file, fallback mode

/* ---------- ingest ---------- */
async function ingestFiles(fileList, target) {
  const files = [...fileList];
  if (!files.length) return;
  const added = [];
  let skipped = 0;
  for (const f of files) {
    const cap = Store.Vault.mode === 'idb' ? MAX_IDB : MAX_KV;
    if (f.size > cap) {
      // too big to keep locally: store a labelled shortcut so you know it exists
      const rec = { id: uid('f'), name: (f.name || 'large file'), kind: 'shortcut', mime: (f.type || 'application/octet-stream').split(';')[0], size: f.size, at: nowISO(), note: 'not stored — too big for this browser' };
      Store.edit((st) => { st.files.unshift(rec); if (target?.id) linkFile(st, target, rec.id); }, 'data');
      added.push(rec);
      skipped++;
      continue;
    }
    const baseName = (typeof f.name === 'string' && f.name.trim())
      ? f.name.trim()
      : 'pasted ' + new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/[/,:\s]/g, '-');
    const name = (baseName.length > 70 ? baseName.slice(0, 64) + '-' + (baseName.split('.').pop() || '') : baseName).slice(0, 90);
    const mime = ((f.type || 'application/octet-stream').split(';')[0]);
    const rec = { id: uid('f'), name, kind: 'file', mime, size: f.size || 0, at: nowISO(), note: '' };
    try {
      const res = await Store.Vault.put(rec.id, typeof f.slice === 'function' ? f.slice(0, f.size) : f);
      rec.stored = res.kind;
      if (res.kind !== 'idb' && res.dataUrl && looksTextual(rec)) {
        // keep a readable copy in the record itself so text stays usable even if the blob is lost
        try { rec.snippet = await readBlobText(f, 40000); } catch (e) {}
      } else if (looksTextual(rec)) {
        try { rec.snippet = (await readBlobText(f, 40000)); } catch (e) {}
      }
      if (rec.snippet) rec.lines = (rec.snippet.match(/\n/g) || []).length + 1;
    } catch (e) {
      rec.missing = true; rec.note = 'could not be saved locally';
    }
    // the record is saved NOW — the picture preview catches up a moment later
    Store.edit((st) => { st.files.unshift(rec); if (target?.id) linkFile(st, target, rec.id); }, 'data');
    added.push(rec);
    if (/^image\//.test(mime)) {
      withTimeout(makeThumb(f), 4000).then((thumb) => {
        Store.edit((st) => { const x = st.files.find((y) => y.id === rec.id); if (x) x.thumb = thumb; }, 'data');
      }).catch(() => {});
    }
  }
  const targetLabel = !target ? 'the shelf'
    : target.kind === 'tpl' ? '“' + (Q.template(target.id)?.title || 'template') + '”'
    : 'case ' + (Store.s.cases.find((c) => c.id === target.id)?.client || '');
  if (added.length) {
    Bus.toast(`${added.length} file${added.length > 1 ? 's' : ''} added to ${targetLabel}` + (skipped ? ` · ${skipped} too large, saved as a shortcut` : ''), skipped ? 'warn' : 'ok', 3200, {
      label: 'View', fn() { view.tab = 'files'; render(); }
    });
  }
  render();
}
function linkFile(st, target, fileId) {
  if (target.kind === 'tpl') {
    const t = st.templates.find((x) => x.id === target.id);
    if (t) { t.fileIds = [...new Set([...(t.fileIds || []), fileId])]; t.updatedAt = nowISO(); }
  } else if (target.kind === 'case') {
    const c = st.cases.find((x) => x.id === target.id);
    if (c) { c.fileIds = [...new Set([...(c.fileIds || []), fileId])]; c.updatedAt = nowISO(); }
  }
}
function unlinkFile(target, fileId) {
  Store.edit((st) => {
    if (target.kind === 'tpl') { const t = st.templates.find((x) => x.id === target.id); if (t) t.fileIds = (t.fileIds || []).filter((i) => i !== fileId); }
    if (target.kind === 'case') { const c = st.cases.find((x) => x.id === target.id); if (c) c.fileIds = (c.fileIds || []).filter((i) => i !== fileId); }
  }, 'data');
}
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms))]);
}
function makeThumb(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const max = 360;
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.62));
      } catch (e) { rej(e); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { try { URL.revokeObjectURL(url); } catch (e) {} rej(new Error('img')); };
    img.src = url;
  });
}

/* ---------- open / preview ---------- */
const safeURL = (u) => (/^(https?:|mailto:)/i.test(String(u || '').trim()) ? String(u).trim() : null);
async function openFile(id) {
  const f = Q.file(id);
  if (!f) return;
  if (f.kind === 'link') {
    const u = safeURL(f.url);
    if (!u) { Bus.toast('That saved link is not an http(s) address, so I will not open it', 'bad', 4000); return; }
    window.open(u, '_blank', 'noopener');
    return;
  }
  const isText = looksTextual(f);
  const isImg = /^image\//.test(f.mime || '');
  const isPdf = f.mime === 'application/pdf';
  let blob = null;
  try { blob = await Store.Vault.get(id); } catch (e) { blob = null; }

  if (!blob) {
    if (isText && f.snippet != null) return showTextPreview(f, f.snippet, id);
    if (f.kind === 'shortcut' || f.missing) {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = () => { const nf = input.files && input.files[0]; if (nf) { const u = URL.createObjectURL(nf); isImg ? showImagePreview(f, u, id) : isText ? readBlobText(nf, 200000).then((t) => showTextPreview(f, t, id)) : downloadFile(id); } };
      input.click();
      Bus.toast('That one is stored as a shortcut — pick the file to open it just now', 'warn', 4000);
      return;
    }
    Bus.toast('The bytes for that file are gone from this browser — re-drop it', 'bad', 4000);
    return;
  }
  let url = '';
  try { url = URL.createObjectURL(blob); } catch (e) { url = ''; }
  if (isText) {
    const t = await readBlobText(blob, 200000);
    return showTextPreview(f, t, id, url);
  }
  if (isImg) return showImagePreview(f, url, id);
  if (isPdf) return showIframePreview(f, url, id);
  if (url) {
    const win = window.open(url, '_blank', 'noopener');
    if (!win) { downloadFile(id); Bus.toast('Preview blocked — downloaded instead', 'warn', 2600); }
    return;
  }
  downloadFile(id);
}
function showImagePreview(f, url, id) {
  const m = openModal(`
    <div class="modal-head"><h3>${esc(f.name)}</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
    <div class="modal-body" style="align-items:center;background:var(--panel-2)">
      <img src="${url}" style="max-width:100%;max-height:66vh;border-radius:8px;display:block" alt="">
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="downloadFile('${id}')">${ICON.download} Download</button>
      <button class="btn ghost" style="color:var(--bad)" onclick="deleteFile('${id}'); (modalStack[modalStack.length-1]||{}).close && modalStack[modalStack.length-1].close()">${ICON.trash} Delete</button>
      <span class="grow" style="flex:1"></span>
      <span class="help">${bytes(f.size)} · added ${ago(f.at)} · drag the card in the library to attach it</span>
    </div>`, { wide: true, key: 'fileimg' });
}
function showIframePreview(f, url, id) {
  openModal(`
    <div class="modal-head"><h3>${esc(f.name)}</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
    <div class="modal-body" style="padding:0"><iframe src="${url}" style="width:100%;height:70vh;border:0"></iframe></div>
    <div class="modal-foot"><button class="btn" onclick="downloadFile('${id}')">${ICON.download} Download</button>
      <span class="grow" style="flex:1"></span><span class="help">If the preview is blocked, use Download.</span></div>`, { wide: true, key: 'filepdf' });
}
function showTextPreview(f, text, id, url) {
  const clipped = text.length > 200000;
  const m = openModal(`
    <div class="modal-head"><h3>${esc(f.name)}</h3><span class="help">${(text.length).toLocaleString()} chars${clipped ? ' (first 200k shown)' : ''}</span>
      <button class="btn icon ghost" data-close>${ICON.close}</button></div>
    <div class="modal-body"><pre class="prose" style="white-space:pre-wrap;font-family:var(--mono);font-size:12.5px;max-height:62vh;overflow:auto">${esc(text)}</pre></div>
    <div class="modal-foot">
      <button class="btn primary" id="tx-copy">${ICON.copy} Copy all</button>
      <button class="btn" id="tx-tpl">${ICON.plus} Turn into template</button>
      <button class="btn" id="tx-parts">${ICON.plus} One template per section</button>
      <span class="grow" style="flex:1"></span>
      <button class="btn" onclick="downloadFile('${id}')">${ICON.download} Download</button>
    </div>`, { wide: true, key: 'filetext' });
  m.el.querySelector('#tx-copy').onclick = async () => { await toClipboard(text); Bus.toast('Copied', 'ok', 1500); };
  m.el.querySelector('#tx-tpl').onclick = () => {
    openEditor(null, { title: f.name.replace(/\.[a-z0-9]+$/i, ''), body: text.trim().slice(0, 8000) });
    Bus.toast('Draft from ' + f.name, '', 1600);
  };
  m.el.querySelector('#tx-parts').onclick = () => {
    const parts = text.split(/\n(?=(?:#{1,3}\s|={3,}|-{3,}$|[A-Z][A-Za-z .,&'’()-]{3,50}:$))/).map((p) => p.trim()).filter((p) => p.length > 24);
    if (parts.length < 2) { Bus.toast('I could only find one chunk in that file', 'warn'); return; }
    Store.edit((st) => {
      parts.forEach((p, n) => {
        const first = p.split('\n')[0].replace(/^#+\s*/, '').slice(0, 70);
        st.templates.push({
          id: uid('tpl'), title: first || ('From ' + f.name + ' #' + (n + 1)), category: '',
          tags: ['imported'], body: p, useWhen: 'Imported from ' + f.name, favorite: false, usage: 0, pinned: false,
          order: Math.max(0, ...st.templates.map((t) => t.order || 0)) + 1 + n, fileIds: [], createdAt: nowISO(), updatedAt: nowISO(), lastUsed: null
        });
      });
    }, 'data');
    Bus.toast(parts.length + ' templates created from ' + f.name, 'ok', 3000, { label: 'Open', fn() { view.tab = 'library'; view.cat = 'all'; view.q = 'imported'; render(); } });
  };
}
function downloadFile(id) {
  const f = Q.file(id);
  if (!f) return;
  if (f.kind === 'link') { const u = safeURL(f.url); if (u) window.open(u, '_blank', 'noopener'); return; }
  const go = (blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  Store.Vault.get(id).then((b) => {
    if (b) return go(b);
    if (f.snippet != null) return go(new Blob([f.snippet], { type: 'text/plain' }));
    Bus.toast('The bytes for that file are no longer here — re-drop it to open it', 'warn', 4200);
  }).catch(() => { if (f.snippet != null) go(new Blob([f.snippet], { type: 'text/plain' })); });
}
function fileOptions(id) {
  const f = Q.file(id);
  if (!f) return;
  const tpls = Store.s.templates.filter((t) => (t.fileIds || []).includes(id));
  const m = openModal(`
    <div class="modal-head"><h3>${esc(f.name)}</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
    <div class="modal-body">
      <div class="meta-row"><span>${f.kind === 'link' ? 'Link' : bytes(f.size)}</span><span>·</span><span>added ${ago(f.at)}</span>
      ${f.stored ? `<span>·</span><span>stored in ${f.stored === 'idb' ? 'IndexedDB' : 'local storage'}</span>` : ''}</div>
      <div class="form-row"><label class="lbl">Note to myself (e.g. “use for refund cases”)</label>
        <input class="txt" id="fn-note" value="${esc(f.note || '')}" style="font-size:13px"></div>
      <div class="form-row"><label class="lbl">Rename</label><input class="txt" id="fn-name" value="${esc(f.name)}" style="font-size:13px"></div>
      <div class="form-row"><label class="lbl">Attached to</label>
        ${tpls.length ? `<div class="tagchips">${tpls.map((t) => `<button class="chip" data-act="detach" data-id="${id}" data-tpl="${t.id}">${esc(t.title)} ✕</button>`).join('')}</div>` : '<span class="help">Nothing — the shelf only. Drag it onto a card to attach.</span>'}
      </div>
      <div class="form-row"><label class="lbl">Attach to a template</label>
        <select class="txt" id="fn-attach">${Store.s.templates.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><button class="btn danger" id="f-del">${ICON.trash} Delete</button><span class="grow" style="flex:1"></span>
      <button class="btn" id="f-close">Done</button><button class="btn primary" id="f-save">Save</button></div>`, { narrow: false, key: 'fileopt' });
  m.el.querySelector('#f-save').onclick = () => {
    Store.edit((st) => {
      const x = st.files.find((y) => y.id === id);
      x.note = m.el.querySelector('#fn-note').value.trim();
      x.name = m.el.querySelector('#fn-name').value.trim() || x.name;
    }, 'data');
    m.close();
  };
  m.el.querySelector('#f-attach').onchange = (e) => {
    const tplId = e.target.value;
    if (!tplId) return;
    Store.edit((st) => linkFile(st, { kind: 'tpl', id: tplId }, id), 'data');
    Bus.toast('Attached to ' + Q.template(tplId).title, 'ok', 2000);
    m.close();
  };
  m.el.querySelector('#f-close').onclick = () => m.close();
  m.el.querySelector('#f-del').onclick = () => { m.close(); deleteFile(id); };
}
function deleteFile(id) {
  const f = Q.file(id);
  if (!f) return;
  const snapshot = JSON.parse(JSON.stringify(Store.s));
  Bus.confirm('Delete “' + esc(f.name) + '”?', 'It will be detached from every template that uses it. The blob is removed from this browser too.', 'Delete file').then((ok) => {
    if (!ok) return;
    Store.Vault.del(id);
    Store.edit((st) => {
      st.files = st.files.filter((x) => x.id !== id);
      st.templates.forEach((t) => { t.fileIds = (t.fileIds || []).filter((i) => i !== id); });
      st.cases.forEach((c) => { c.fileIds = (c.fileIds || []).filter((i) => i !== id); });
    }, 'data');
    Bus.toast('File deleted', 'bad', 6000, { label: 'Undo', fn() { Store.replaceAll(snapshot); Bus.toast('Restored', 'ok', 1400); } });
  });
}

/* ---------- global drag & drop ---------- */
let dropTarget = null;
let dragDepth = 0;
function bindDnD() {
  const overlay = document.getElementById('drop-overlay');
  const types = (e) => Array.from(e.dataTransfer?.types || []);
  const isInternal = (e) => types(e).includes('application/x-osr-file');
  const hasFiles = (e) => types(e).includes('Files');
  const hasText = (e) => Array.from(e.dataTransfer?.types || []).some((t) => t === 'text/plain' || t === 'text/uri-list');
  const hasJSON = (e) => e.dataTransfer?.items && [...e.dataTransfer.items].some((i) => i.kind === 'file' && /json|csv|text/.test(i.type));

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) && !hasText(e) && !isInternal(e)) return;
    e.preventDefault();
    dragDepth++;
    if (isInternal(e)) {
      const card = e.target.closest('.card, .pane, tr[data-case]');
      if (card) card.classList.add('drag-over');
    }
    overlay.classList.add('on');
    overlay.querySelector('.box').innerHTML = dropTarget
      ? `Attach to <b>${esc(dropTarget.label)}</b><small>drop here · or release elsewhere for the resource shelf</small>`
      : `Drop to add to your shelf<small>${hasFiles(e) ? e.dataTransfer.files.length + ' file(s)' : 'text / link'} · files attach to this PC only</small>`;
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e) && !hasText(e) && !isInternal(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const card = e.target.closest?.('.card, tr[data-case], .file-card, .pane');
    document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
    if (card?.classList.contains('card')) {
      const t = Q.template(card.dataset.id);
      if (t) { card.classList.add('drag-over'); dropTarget = { kind: 'tpl', id: t.id, label: t.title.slice(0, 28) }; }
    } else if (card?.tagName === 'TR') {
      const c = Store.s.cases.find((x) => x.id === card.dataset.case);
      if (c) { card.classList.add('drag-over'); dropTarget = { kind: 'case', id: c.id, label: c.client || 'case' }; }
    } else if (card?.classList.contains('pane')) {
      const t = Q.template(view.selected);
      if (t) dropTarget = { kind: 'tpl', id: t.id, label: t.title.slice(0, 28) };
    } else if (!hasJSON(e)) {
      dropTarget = null;
    }
  });
  window.addEventListener('dragleave', (e) => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) { overlay.classList.remove('on'); document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over')); }
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e) && !hasText(e) && !isInternal(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('on');
    document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
    const target = dropTarget;
    dropTarget = null;
    // dragging one of my own shelf files onto a template/case = attach it (no copy)
    const moved = e.dataTransfer.getData('application/x-osr-file');
    if (moved) {
      document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
      if (!target) { Bus.toast('Drop it on a template card or a case row to attach it there', 'warn', 3200); return; }
      Store.edit((st) => linkFile(st, target, moved), 'data');
      Bus.toast('Attached to ' + target.label, 'ok', 2200);
      render();
      return;
    }
    if (e.dataTransfer.files?.length) {
      const fs = [...e.dataTransfer.files];
      const json = fs.filter((f) => /\.json$/i.test(f.name));
      const csvf = fs.filter((f) => /\.csv$/i.test(f.name));
      const rest = fs.filter((f) => !json.includes(f) && !csvf.includes(f));
      if (json.length && !rest.length && !target) { importFile(json[0]); return; }
      if (csvf.length && !rest.length && !target) { importFile(csvf[0]); return; }
      await ingestFiles(rest.length ? rest : fs, target);
      if (json.length || csvf.length) { await new Promise((r) => setTimeout(r, 60)); importFile(json[0] || csvf[0]); }
      return;
    }
    const txt = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
    if (!txt || !txt.trim()) return;
    if (/^https?:\/\//i.test(txt.trim()) && !target) {
      saveLink(txt.trim());
    } else {
      const body = txt.trim();
      const name = 'Dropped note ' + new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.txt';
      const blob = new Blob([body], { type: 'text/plain' });
      blob.name = name; blob.type = 'text/plain';
      await ingestFiles([blob], target);
    }
  });

  // paste an image or text right into the desk
  window.addEventListener('paste', async (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const imgs = [...dt.items].filter((i) => i.kind === 'file' && /^image\//.test(i.type));
    if (imgs.length) {
      e.preventDefault();
      const files = imgs.map((it, n) => { const f = it.getAsFile(); return f; });
      const named = files.map((f, n) => { const nb = new Blob([f], { type: f.type }); nb.name = 'pasted ' + new Date().toLocaleTimeString().replace(/:/g, '') + (n ? ' ' + n : '') + '.png'; return nb; });
      await ingestFiles(named, null);
      Bus.toast('Pasted screenshot saved to your shelf', 'ok');
      return;
    }
    const txt = dt.getData('text/plain');
    if (txt && txt.trim().length > 120) {
      const m = openModal(`
        <div class="modal-head"><h3>Turn that paste into a template?</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
        <div class="modal-body">
          <div class="form-row"><label class="lbl">Title</label><input id="pt-title" class="txt" value="${esc(txt.trim().split('\n')[0].slice(0, 60))}" style="font-size:14px;font-weight:600"></div>
          <div class="form-row"><label class="lbl">Body</label><textarea class="txt" id="pt-body" style="min-height:190px">${esc(txt.trim().slice(0, 6000))}</textarea></div>
        </div>
        <div class="modal-foot"><button class="btn" id="pt-as-file">${ICON.file} Save as note</button><span class="grow" style="flex:1"></span>
          <button class="btn" data-close>Discard</button><button class="btn primary" id="pt-save">${ICON.check} Save template</button></div>`, { wide: true, key: 'paste' });
      m.el.querySelector('#pt-save').onclick = () => {
        openEditor(null, { title: m.el.querySelector('#pt-title').value, body: m.el.querySelector('#pt-body').value });
        m.close();
      };
      m.el.querySelector('#pt-as-file').onclick = async () => {
        const blob = new Blob([m.el.querySelector('#pt-body').value], { type: 'text/plain' });
        blob.name = 'pasted ' + new Date().toLocaleTimeString().replace(/:/g, '') + '.txt';
        m.close();
        await ingestFiles([blob], null);
      };
    }
  });
}
function bindInternalDrag(root) {
  (root || document).querySelectorAll?.('.file-card[draggable="true"]').forEach((card) => {
    if (card.__dragBound) return;
    card.__dragBound = 1;
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-osr-file', card.dataset.file);
      e.dataTransfer.setData('text/osr-file', card.dataset.file);
      e.dataTransfer.effectAllowed = 'copyLink';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
      const o = document.getElementById('drop-overlay');
      if (o) o.classList.remove('on');
    });
  });
}

function saveLink(rawUrl, note) {
  const url = String(rawUrl || '').trim();
  if (!safeURL(url)) { Bus.toast('Only http(s) links can be saved', 'warn', 3000); return; }
  const host = url.replace(/^https?:\/\//, '').split('/')[0];
  const name = note || host + url.slice(host.length + 8).split('/').filter(Boolean).slice(-1)[0] || 'Saved link';
  Store.edit((st) => st.files.unshift({ id: uid('f'), name: String(name).slice(0, 60) || host, kind: 'link', url, size: 0, at: nowISO(), note: '' }), 'data');
  Bus.toast('Link saved to shelf', 'ok', 2400, { label: 'View', fn() { view.tab = 'files'; render(); } });
}

/* ---------- cases ---------- */
function caseVars(c) {
  const first = (c.contact || c.client || '').split(/\s+/)[0] || '';
  return {
    client_name: c.client || '', first_name: first, ticket_id: c.ticket || '',
    case_summary: c.subject || '', issue: c.subject || '', agent_name: Store.s.settings.yourName || ''
  };
}
function openCaseEditor(id) {
  const c = id ? Store.s.cases.find((x) => x.id === id) : null;
  const m = openModal(`
    <div class="modal-head"><h3>${c ? 'Case · ' + esc(c.client || c.ticket || 'untitled') : 'New case'}</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
    <div class="modal-body">
      <div class="form-row two">
        <div class="form-row"><label class="lbl">Client / account</label><input class="txt" id="cy-client" value="${esc(c?.client || '')}" placeholder="Acme Ltd"></div>
        <div class="form-row"><label class="lbl">Contact name</label><input class="txt" id="cy-contact" value="${esc(c?.contact || '')}" placeholder="Sam Rivera"></div>
      </div>
      <div class="form-row two">
        <div class="form-row"><label class="lbl">Ticket</label><input class="txt" id="cy-ticket" value="${esc(c?.ticket || '')}" placeholder="48213"></div>
        <div class="form-row"><label class="lbl">Subject</label><input class="txt" id="cy-subject" value="${esc(c?.subject || '')}" placeholder="Can't log in after reset"></div>
      </div>
      <div class="form-row two">
        <div class="form-row"><label class="lbl">Status</label><select class="txt" id="cy-status">${CASE_STATUS.map(([v, l]) => `<option value="${v}" ${c?.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="form-row"><label class="lbl">Priority</label><select class="txt" id="cy-prio">${CASE_PRIO.map(([v, l]) => `<option value="${v}" ${c?.priority === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="form-row two">
        <div class="form-row"><label class="lbl">With whom (if escalated)</label><input class="txt" id="cy-owner" value="${esc(c?.owner || '')}" placeholder="Billing Ops — Priya"></div>
        <div class="form-row"><label class="lbl">Next step by</label><input class="txt" id="cy-due" type="date" value="${esc(c?.due || '')}"></div>
      </div>
      <div class="form-row"><label class="lbl">What I promised / what happens next</label><input class="txt" id="cy-next" value="${esc(c?.next || '')}" placeholder="Update them Thu if L2 hasn't replied"></div>
      <div class="form-row"><label class="lbl">Notes</label><textarea class="txt" id="cy-notes" style="min-height:110px;font-family:var(--font);font-size:13.5px">${esc(c?.notes || '')}</textarea></div>
      ${c?.history?.length ? `<div class="pane-sec"><h4>Trail</h4><div class="help" style="font-size:12px;line-height:1.7">${c.history.slice(0, 8).map((h) => `<div><b>${ago(h.at)}</b> · ${esc(h.text)}</div>`).join('')}</div></div>` : ''}
      ${c?.fileIds?.length ? `<div class="pane-sec"><h4>Files on this case</h4><div class="tagchips">${c.fileIds.map((f) => Q.file(f)).filter(Boolean).map((f) => `<button class="chip" data-act="open-file" data-id="${f.id}">${ICON.file} ${esc(f.name.slice(0, 22))}</button>`).join('')}</div></div>` : ''}
    </div>
    <div class="modal-foot">${c ? `<button class="btn danger" id="cy-del">${ICON.trash} Delete case</button>` : ''}
      <span class="grow" style="flex:1"></span>
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="cy-save">${ICON.check} Save</button></div>`, { wide: true, key: 'case' });

  const g = (s) => m.el.querySelector(s).value.trim();
  m.el.querySelector('#cy-save').onclick = () => {
    const patch = {
      client: g('#cy-client'), contact: g('#cy-contact'), ticket: g('#cy-ticket'), subject: g('#cy-subject'),
      status: g('#cy-status'), priority: g('#cy-prio'), owner: g('#cy-owner'), due: g('#cy-due'),
      next: g('#cy-next'), notes: g('#cy-notes'), updatedAt: nowISO()
    };
    if (!patch.client && !patch.ticket) { Bus.toast('Put a client or a ticket on it', 'warn'); return; }
    Store.edit((st) => {
      if (c) { Object.assign(st.cases.find((x) => x.id === c.id), patch); }
      else st.cases.unshift({ id: uid('case'), ...patch, fileIds: [], history: [{ at: nowISO(), text: 'created' }], createdAt: nowISO() });
    }, 'data');
    m.close();
    view.tab = 'cases';
    Bus.toast(c ? 'Case updated' : 'Case added to your board', 'ok');
  };
  m.el.querySelector('#cy-del')?.addEventListener('click', () => {
    m.close();
    const snapshot = JSON.parse(JSON.stringify(Store.s));
    Store.edit((st) => { st.cases = st.cases.filter((x) => x.id !== c.id); }, 'data');
    Bus.toast('Case deleted', 'bad', 6000, { label: 'Undo', fn() { Store.replaceAll(snapshot); } });
  });
}

/* ---------- phrase ---------- */
function openPhraseEditor(id) {
  const p = id ? Store.s.phrases.find((x) => x.id === id) : null;
  const m = openModal(`
    <div class="modal-head"><h3>${p ? 'Edit phrase' : 'New grab-and-go line'}</h3><button class="btn icon ghost" data-close>${ICON.close}</button></div>
    <div class="modal-body">
      <div class="form-row"><label class="lbl">The line (as you'd write it)</label>
        <textarea class="txt" id="ph-text" style="min-height:80px;font-family:var(--font);font-size:14px">${esc(p?.text || '')}</textarea></div>
      <div class="form-row"><label class="lbl">Group / note</label><input class="txt" id="ph-note" value="${esc(p?.note || '')}" placeholder="opening, empathy, boundary…"></div>
      <p class="help">Phrases are single lines you drop into the middle of a reply — no greeting, no signature. They copy with one click and never open the fill dialog unless they contain <code>{{placeholders}}</code>.</p>
    </div>
    <div class="modal-foot">${p ? `<button class="btn danger" id="ph-del">${ICON.trash} Delete</button>` : ''}<span class="grow" style="flex:1"></span>
      <button class="btn" data-close>Cancel</button><button class="btn primary" id="ph-save">${ICON.check} Save</button></div>`, { narrow: true, key: 'phrase' });
  m.el.querySelector('#ph-save').onclick = () => {
    const text = m.el.querySelector('#ph-text').value.trim();
    if (!text) return Bus.toast('Nothing to save', 'warn');
    Store.edit((st) => {
      if (p) { p.text = text; p.note = m.el.querySelector('#ph-note').value.trim(); p.tags = [p.note].filter(Boolean); p.updatedAt = nowISO(); }
      else st.phrases.unshift({ id: uid('ph'), text, note: m.el.querySelector('#ph-note').value.trim(), tags: [m.el.querySelector('#ph-note').value.trim()].filter(Boolean), usage: 0, favorite: false, createdAt: nowISO(), updatedAt: nowISO() });
    }, 'data');
    m.close();
    Bus.toast('Saved', 'ok', 1400);
  };
  m.el.querySelector('#ph-del')?.addEventListener('click', () => {
    Store.edit((st) => { st.phrases = st.phrases.filter((x) => x.id !== p.id); }, 'data');
    m.close();
  });
  setTimeout(() => m.el.querySelector('#ph-text').focus(), 30);
}
