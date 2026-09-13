# OSR · Online Support Desk

A personal, offline workspace for an Online Support Representative. It is **not** a company
tool, it talks to **no server**, and it needs **no account**. One HTML file that holds:

1. your reply **template library** (every card has a **Copy** and an **Edit** button),
2. a **grab-and-go phrase bank** for single sentences,
3. a **drag-and-drop resource shelf** (SOPs, screenshots, price lists, saved links),
4. a tiny **live-cases** scratchpad so you know who's waiting on whom,
5. and one-click **backup / restore** of the whole thing.

Built because Coda and Notion are two-click-too-many when you're mid-thread and a client is
waiting on a reply.

---

## Run it

**Option A — nothing to install (recommended)**

1. Copy `OSR-Desk.html` anywhere you like (Desktop, a `Support/` folder, a synced drive).
2. Double-click it. It opens in your browser. Done.

Everything you add is stored by the browser for that file — close the tab, reopen tomorrow,
it's all still there. Works on Windows, macOS and Linux, and offline on a plane.

> Chrome/Edge/Firefox all fine. If you find files don't persist when opened from `file://`
> (some hardened browser configs block storage there), use Option B — it's the same file,
> just served over `http://` where every storage API is guaranteed.

**Option B — one command, a real "app" URL**

```bash
cd the-folder-with-this-file
./open-server.sh            # or: python3 -m http.server 8600   (Windows: double-click open-server.bat)
```

then open <http://localhost:8600>. In Chrome/Edge you can then pick
**⋮ → Install/Save as app** to get its own window + taskbar icon.

**Option C — two machines?** Keep `OSR-Desk.html` in OneDrive/Drive/Dropbox and it's on both.
Or export a backup on one and import it on the other (Settings → Backup).

---

## The workflow it's built around

```
new mail  →  Ctrl+K  →  type 2 words  →  Enter  →  paste  →  tweak one line  →  send
                                        │
                                        └─ placeholders you didn't fill prompt you first,
                                           and the answer is reused for the rest of the day
```

### Library (`Templates`)
* Cards or list, sorted by category / A-Z / **most used** / last edited.
* Optional **subject line** per template, with its own one-click *Copy subject* — after you copy
  the body the toast offers the subject, so pasting both takes two clicks and zero thinking.
* **Copy** puts the email on your clipboard as plain text (no stray formatting in the mail client).
* **Edit** opens the editor with a live variable bar; `Ctrl+Enter` saves.
* **Star** anything you use daily → it shows in `Starred`.
* Right-click a card for duplicate / attach file / export that one / delete. `Delete` always
  offers **Undo** in the toast.
* `{{placeholders}}` are highlighted in the preview panel, with a **Filled preview** so you can
  see what the client will actually read.

### Copy flow, in detail
* Placeholders already known (`{{agent_name}}`, `{{company}}`, `{{date}}`, `{{greeting}}`,
  plus anything you typed earlier today) are silently filled.
* Anything unknown opens a **Fill** dialog: one field per variable, live preview on the right,
  `Enter` copies, `Tab` moves down. Skip it and you get the raw text with the braces.
* Your signature block is appended when you tick it (or turn on *Always append* in Settings).
* If the browser blocks clipboard access entirely, a fallback dialog shows the text selected —
  `Ctrl+C` still works.

### `Grab-and-go lines`
One-liners (empathy openers, boundary sentences, a closing courtesy). Click = copy, no dialog
unless the line has a placeholder. These are the 15 sentences you retype anyway.

### `Resource shelf` (drag & drop)
* Drop files **anywhere in the window** → they land on the shelf, stored locally (up to ~50 MB
  each in IndexedDB; bigger ones are kept as a labelled shortcut).
* Drop a file **onto a template card** → it attaches to that reply ("the form I always send").
* `Ctrl+V` a screenshot → saved straight to the shelf.
* Drop a `.txt` / `.md` / `.csv` you were sent → open it and you can **Copy all**, **Turn into
  template**, or **One template per section** (splits on headings) — instant library import.
* Drop a saved JSON backup onto the window → the import dialog appears.
* Drag a text selection or a URL onto the window → becomes a note / a saved link.

### `Live cases`
Not a ticketing system: the 3–8 threads *you* are personally holding. Client, ticket, status,
what you promised, when. Hit **Reply** on a row → pick a template → the client name and ticket
number are already filled in, and the copy gets logged on the case. Statuses:
`New → Awaiting client → In progress → Escalated → Resolved`.

### Command palette — `Ctrl+K`
One box for templates, phrases, files, cases and commands. `↑↓` to move, `Enter` to copy,
`Alt+Enter` to edit. When you search from a case row, only reply templates are offered.

---

## Keyboard

| Keys | What |
|---|---|
| `Ctrl`/`⌘` + `K` | palette — search + copy anything |
| `/` | jump to the search box |
| `N` | new template |
| `J` / `K` or `↑` / `↓` | move through templates |
| `Enter` or `C` | copy the selected template |
| `E` | edit the selected template |
| `1`–`9` | jump to a category |
| `F` | dark / light |
| `Ctrl`+`B` | hide / show the sidebar (more room for the list) |
| `?` | shortcuts + how-to |
| `Esc` | close menu, modal, or the preview panel |
| `Ctrl` + `V` | paste a screenshot or long text into the desk |

---

## Placeholders

Anything in `{{double braces}}` becomes a prompt field. The names are yours to invent; these
are the ones the app and the starter library know about:

| Placeholder | Source when you copy |
|---|---|
| `{{agent_name}}`, `{{name}}` | Settings → *Display name* |
| `{{company}}` | Settings → *Company* |
| `{{role}}` | Settings → *Role* |
| `{{date}}`, `{{today}}`, `{{time}}`, `{{greeting}}` | today's date / time of day |
| everything else | remembered value, or the Fill dialog (from a case row: client + ticket are prefilled) |

`Ctrl+K` → nothing? Press `N` and the palette text becomes the new template body.

---

## Your data, and not losing it

* Text lives in `localStorage` for that origin; file blobs live in **IndexedDB**. Nothing is
  uploaded, nothing is synced, nothing is logged. Autosave is debounced ~250 ms and flushed on
  tab close (the rail says *Saving…* / *Saved on this PC*).
* **One habit:** Settings → **Export with files** once a week into a synced folder. Re-import by
  dropping that JSON on the window. A wiped browser profile otherwise costs you the library.
* Export also gives you **Markdown** (paste into any notes app) and a **Print cheat sheet**
  (one tidy PDF per category — nice for the first month, taped inside the monitor bezel).
* **Import** also accepts **Notion / Google Sheets CSV exports** with `Name`, `Category`, `Tags`
  and `Body` columns — it will make categories for you.

---

## Editing it

The real source is `src/` — plain HTML/CSS/vanilla JS, no framework, no build deps:

```
src/index.html      shell
src/styles.css      all the visual language (CSS custom properties up top)
src/js/store.js     state, localStorage + IndexedDB vault, placeholder engine
src/js/ui.js        rendering only (data-act attributes drive everything)
src/js/app.js       render loop, clipboard, fill dialog, editor, keyboard
src/js/panels.js    shelf, drag & drop, paste, cases, phrase editing
src/js/io.js        palette, settings, import/export, print, event dispatch, boot
src/data/seed.js    the starter library — edit freely, then `npm run build`
```

```bash
npm run build      # re-inlines src/ into OSR-Desk.html + index.html
npm test           # build, CSS lint, then 133 assertions against the real built file
npm run test:ui    # just the main flows (copy, fill, search, editor, files, cases, backup…)
npm run test:flows # drag & drop, paste, undo, storage failure, oversized files, safety
```

The tests boot the actual `OSR-Desk.html` inside jsdom and click things: seeding, the fill
dialog, remembered placeholders, search, tag filters, starring, create/edit/delete + undo,
the command palette, keyboard-only navigation, phrase copying, file ingest and attachment,
the case board, settings, export/import/merge, CSV import, Markdown export, print sheet,
category CRUD, `Ctrl+B`, a hostile browser with storage disabled, 50 MB-limit files, and
markup-injection attempts on titles/bodies/links. The CSS is linted for balance and for
classes used in JS that were never styled.

Clearing your own data: `localStorage.removeItem('osr.desk.state.v3')` in DevTools, or
Settings → **Wipe everything** (it re-seeds the starter library so you're never at a blank page).

---

## If you'd rather use something off the shelf

This is deliberately not a SaaS. But if a colleague asks, these are the decent ones:

| Need | Tool |
|---|---|
| Canned replies inside Gmail/Outlook, zero new app | Gmail **Templates**, Outlook **Quick Parts**, or **QuickFill** / **TextBlaster** |
| Type-a-shortcut → expands anywhere in Windows | **Espanso** (free, plain-text files, great for `;thanks`) |
| Snippet manager with clipboard history, cross-app | **Dashy**, **Beeper Snippet Manager**, **Paste** (macOS), **Ditto** (Win) |
| A real local notes vault instead of Notion | **Obsidian** (free, Markdown files on disk) or **Trilium** |
| Mac-only dedicated snippet app | **SnippetsLab**, **Raycast** + its snippet store |
| Company-approved shared library | the canned-response features already in your helpdesk (Zendesk Macros, Freshdesk Replies, Intercom Micro-apps) — worth knowing about, but you can't edit those on the fly |

The usual complaint with all of them: you leave the mail tab to go fetch the words. This one
lives in a pinned second window, `Ctrl+K`, copy, back.

---

## Roadmap ideas (not built, on purpose)

Auto-timestamped reply SLA countdowns · per-client variable memory (not per-day) · a "was this
resolved?" follow-up generator · folder-of-folders for multi-product desks · Web Extension to
copy templates into any web mail client.
