# The OSR Desk database

The desk has exactly one storage layer: **`src/js/db.js`**. Everything else
(`store.js`, the panels, the palette, import/export) reads and writes through it.

```
   UI / panels / palette
            │  Store.edit(fn)  ·  Store.s
            ▼
        store.js ──────────► in-memory workspace (the only copy that renders)
            │  debounced flush, per-record diff
            ▼
         db.js ────────────► IndexedDB  "osr-desk"      ← the real database
            │                 11 tables + blob rows
            └───────────────► localStorage mirror        ← fallback only
```

**Why it exists.** The desk used to serialise the whole workspace into *one*
`localStorage` string on every save. `localStorage` gives a browser profile
about 5 MB **for that one value**, and the write is all-or-nothing: one pasted
screenshot over the limit and *nothing* saved any more, with only a toast to say
so. A database gives us per-record writes, hundreds of megabytes, real indexes
for the sorts the UI already does, and a place to keep blobs that never belonged
in a JSON string.

It is still not a server. There is no account, no network call, no sync. One
origin (one folder, one `http://localhost:8600`, one `file://` path) owns one
database.

---

## Tables

| Table | Key | Indexes | Holds |
|---|---|---|---|
| `templates` | `id` | `category`, `favorite`, `usage`, `updatedAt`, `title`, `tags` (multiEntry) | one row per reply template: `title`, `subject`, `body`, `category`, `tags[]`, `usage`, `favorite`, `noSig`, `fileIds[]`, `createdAt`, `updatedAt`, `order` |
| `phrases` | `id` | `usage`, `favorite` | grab-and-go one-liners |
| `categories` | `id` | `order`, `name` | the sidebar groups, in your manual order |
| `cases` | `id` | `status`, `updatedAt` | the live-cases board, `history[]` inline |
| `files` | `id` | `name`, `kind`, `at` | shelf metadata: name, mime, size, `stored`, `note`, `snippet`, `thumb` |
| `blobs` | `id` | `mime`, `at` | the bytes: `{ id, name, mime, size, at, bytes }` — `bytes` is an `ArrayBuffer` |
| `vars` | `key` | — | remembered `{{placeholder}}` values |
| `settings` | `key` | — | one row: `key: 'settings'` plus every setting field |
| `activity` | `id` | `at`, `kind`, `ref` | copy history, **capped at 400 rows** (was 40, because we can afford it now) |
| `trash` | `id` | `at` | undo snapshots, capped at 40 |
| `meta` | `key` | — | `app` (schema stamps), `saved` (last write + which window), `absorbed`, `repair` |

`db.js` is the only place that knows these names: `TABLES` at the top of the
file is the schema, `LIMITS` the row caps.

Row ↔ object is 1:1 and dumb on purpose — what you see in DevTools is what is on
disk, no encoding, no compression, no ORM.

## The write path

1. Any mutation goes through `Store.edit(mut, kind)` → memory updates, `render()`
   fires, `save()` marks the workspace dirty.
2. After ~260 ms of quiet (or on `Ctrl+Enter`, tab close, `visibilitychange`, or
   the 8-second watchdog) `persist()` runs.
3. `DB.flushState()` **diffs** every table against the last thing it wrote and
   issues `put`/`delete` for changed rows only. Editing one template out of 200
   writes one row. Typing into the search box writes nothing.
4. If the transaction succeeds, the diff cache advances. If it *fails*, the cache
   is left alone and the workspace falls back to the `localStorage` path for the
   rest of the session, with a toast saying so — **a refused write never loses
   the edit**, it just changes where it goes.
5. On the database path we no longer re-write the whole workspace blob, only a
   ~150-byte mirror marker (`osr.desk.state.v3.mirror`) so a later boot can tell
   the workspace moved into IndexedDB.

## Migration (what happens the first time you open this build)

* The `localStorage` blob `osr.desk.state.v3` (or `v2` / `v1`) is read.
* If it has data, it is written out into the tables (`DB.writeAll`) and stamped
  with `meta.app.migratedFrom = 'localStorage'`.
* **The blob is left in place.** It is your rollback copy until you delete it.
  Settings → *Where your data lives* has a **Delete the old copy** button once
  you have exported a backup and are happy.
* The old blob-only database (`osr-desk-files`, the pre-database file vault) is
  absorbed into `blobs` via a cursor walk, then deleted — so screenshots and
  attachments you dropped before this change are still there.
* If the database cannot be opened, the desk stays on the old path. Nothing is
  deleted, nothing is lost, and the reason is in Settings.

## Failure modes and what you'll see

| Situation | What the desk does |
|---|---|
| No `indexedDB` (jsdom, some webviews) | Runs on `localStorage`; toast says the database is unavailable and recommends `open-server.sh` |
| `indexedDB` getter throws (hardened/enterprise config) | Same as above; caught in `canTry()`, never a crash |
| Another window holds an older version (`onblocked`) | Gives up after the open event and runs on `localStorage` — the other window keeps working |
| Upgrade/open hangs (locked profile, disk asleep) | 6-second guard, then the fallback |
| Quota exceeded mid-session | Transaction rejects → `mode = 'kv'`, edit saved to `localStorage`, `meta` records why, Settings shows the refusal |
| `localStorage` also full | Drops `thumb` previews and long snippets, empties `activity`/`trash`, retries once, then tells you to export |
| Database closed under us (`onclose`/`onversionchange`) | Marks itself broken; next save goes to the fallback |
| Storage blocked entirely | In-memory only, red **"Not persisting!"** in the rail, and a toast telling you to export |

`DB.verify()` exists for the "is my data actually fine?" question: it compares
memory against the tables, checks every file row has bytes, finds orphaned blobs,
dangling `fileIds`, and categories with no order. Settings → **Verify database**
runs it and offers **Rewrite every row** (which is `DB.repair()`: full `writeAll`
plus garbage collection of blobs nothing points at).

## Inspecting it yourself

In DevTools on the desk's tab:

```js
await OSRDB.stats()                 // engine, table counts, disk usage, last write
await OSRDB.dump('templates')       // every row, as objects
await OSRDB.verify()                // { ok, problems: [] }
await OSRDB.repair()                // rewrite all rows, collect orphans
await OSRDB.diagnostics()           // the JSON to paste into a bug report
await OSRDB.sql("SELECT title, usage FROM templates ORDER BY usage DESC LIMIT 10")
await OSRDB.sql("SELECT title FROM templates WHERE favorite = 1")
await OSRDB.sql("SELECT name, size FROM files WHERE kind = 'file' ORDER BY size DESC")
```

`OSRDB.sql` is a small read-only SELECT subset (WHERE with one comparison,
`LIKE`, `ORDER BY`, `LIMIT`) over the live tables. It refuses anything that isn't
a SELECT. Chrome also shows the same data under *Application → IndexedDB →
osr-desk*; the console is faster.

Clearing everything: Settings → **Wipe everything** (drops every table, including
blobs, then re-seeds the starter library).

## The offline tool: `tools/osr-db.mjs`

The browser database is the working copy; **the export is the backup**. To make a
backup a database you can query, use the dev-only CLI (Node 22.5+, no
dependencies — SQLite is built into Node):

```bash
node tools/osr-db.mjs inspect    osr-desk-backup-2026-09-13.json
node tools/osr-db.mjs sqlite     osr-desk-backup-2026-09-13.json osr.db
node tools/osr-db.mjs query      osr.db "SELECT title, usage FROM most_copied LIMIT 10"
node tools/osr-db.mjs csv        osr.db library library.csv
node tools/osr-db.mjs roundtrip  osr-desk-backup-2026-09-13.json
```

* `inspect` validates a backup: duplicate ids, templates whose category or
  attachment is missing from the file, metadata with no bytes, oversized files,
  statuses the desk doesn't know. Exit code 2 means "importable, but look first".
* `sqlite` builds a real file with the same tables plus `template_tags`,
  `template_files`, `case_files`, `case_history`, and views `library`,
  `most_copied`, `never_copied`, `open_cases`, `orphan_files`. Fields the columns
  don't model go into an `extra` JSON column, so nothing is silently dropped.
  Open it in `sqlite3`, Datasette, DBeaver, TablePlus — it's an ordinary database.
* `query` is read-only by design (it refuses INSERT/UPDATE/DELETE/DROP/PRAGMA/
  ATTACH), `--json` for scripting.
* `roundtrip` proves the tool is lossless: export → SQLite → JSON, field by field.

npm aliases: `db:inspect`, `db:sqlite`, `db:query`, `db:roundtrip`.

## Tests

`test/db.mjs` (138 assertions) boots the **built** `OSR-Desk.html` in jsdom with
a real IndexedDB implementation and asserts against actual rows: rows landing in
tables, per-record writes, unchanged rows skipped, reload persistence,
`localStorage` → database migration (including that the pre-migration blob is
kept), blob round-trip, orphan/missing-bytes verification and repair, table
limits, stats, the SQL view, wipe clearing blobs too, both degraded modes
(no IndexedDB / a throwing getter), a mid-session refused write falling back
without losing the edit, absorbing the old blob-only database, durability of the
last write before close, and a sweep proving the database code makes no network
call. `test/dbtools.mjs` (54) covers the CLI.

## If this ever wants to be a *shared* database

Built — but as a door you have to open, not a wall you live in. `src/js/sync.js`
mirrors the text rows into a Postgres table you own (`supabase/schema.sql`) and
is the only module in the app that calls `fetch`; `db.js` still makes no network
call and still doesn't know sync exists. That separation is the point:

* sync reads `Store.s` / `Store.flushState()` and writes through `Store.edit` —
  it never opens a transaction, never re-implements a table, and never becomes a
  second source of truth. `test/db.mjs` keeps asserting that `db.js` contains no
  `fetch`/`XMLHttpRequest`/`sendBeacon` at all;
* the three things this project used to refuse are answered by one design rule
  each: a **host** you supply (and nothing happens until you do), a **secret**
  that is a publishable key plus a normal login rather than a service-role key,
  and a **conflict policy** of last-write-wins on `updatedAt`, where a row the
  local machine has edited but not yet pushed is kept *and stays dirty* instead
  of being clobbered;
* `Vault` / `blobs` / `files` are excluded by `localRows()`, which is why the
  database can grow a 50 MB screenshot and sync still sends nothing but text.

Setup, the wire contract and the removal path are in [SYNC.md](SYNC.md).
Behavioural tests live in `test/sync.mjs` (88 assertions, fake Supabase server,
no network required).
