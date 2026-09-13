# Sync (optional) — two machines, one desk

Everything in the desk is still local-first. This feature adds **one outward
path**, off until you turn it on:

```
your typing ──▶ IndexedDB (the real store) ──▶ a Postgres table you own ──▶ your other machine
                   ▲                                                            │
                   └────────────────── the merge, on pull ◀─────────────────────┘
```

**IndexedDB stays the source of truth.** Supabase is a *mirror*: the desk never
waits for the network to save, never refuses an edit because a server is
unreachable, and never treats the remote copy as authoritative for anything it
hasn't seen come down as a row. If sync is off you get exactly the behaviour you
had before — no probing, no timers, no requests, nothing in Settings except a
status line that says `Off — nothing leaves this machine`.

*Code:* `src/js/sync.js` (~400 lines, the only file in the app that calls
`fetch` for anything but a data URL). *Schema:* `supabase/schema.sql`.
*Tests:* `npm run test:sync` — 88 assertions against a fake PostgREST + GoTrue
server, including row-level security and a dead network.

---

## What goes out, and what never does

| Synced | Never synced |
| --- | --- |
| templates (title, body, subject, category, tags, usage, `{{placeholders}}`) | the **file shelf** — dropped PDFs, SOPs, screenshots, any bytes |
| grab-and-go phrases | thumbnails, inline image previews, captured snippet text |
| categories | `activity` log, `trash`, saved scroll positions |
| live cases | `meta` (device id, migration bookkeeping) |
| remembered variable values (`client_name`, amounts…) | the pre-migration `localStorage` rollback blob |
| settings (name, theme, sort, caps…) | the Supabase URL/key/login itself — that stays in this browser |

Deletes travel as **tombstones** (`deleted = true` with an empty payload), not
as holes, so a template you deleted on the laptop is also gone at home instead
of coming back to haunt you.

## Set it up (once)

1. **A project.** Supabase → *New project* (any free region). Free tier pauses a
   project after ~7 days of no traffic — open the desk once a week, or resume it
   from the dashboard; the desk just reports "server unreachable" meanwhile and
   keeps queueing locally.
2. **The table.** Project → *SQL Editor* → *New query* → paste the whole of
   [`supabase/schema.sql`](../supabase/schema.sql) → *Run*. It creates one table
   (`public.desk_document`), two indexes, a trigger, RLS and one policy. Expected
   result: `Success. No rows returned`.
3. **A login for the desk.** Project → *Authentication* → *Users* → **Add user**
   (email + password, mark email confirmed). Use *Add user*, **not** *Invite
   user*: an invite sends an email whose link puts a token in your browser
   address bar, and it redirects to a Site URL you don't have.
   Settings → *API keys*: copy the **Project URL** and the **publishable** key.
   The publishable (anon) key is not a secret — it is designed to sit in a
   browser; row-level security is what protects the data. Don't paste the
   **secret** / service-role key into the desk, and don't use it anywhere in the
   client.
4. **Point the desk at it.** In `OSR-Desk.html`: Settings → **Sync** → paste URL
   + publishable key → *Save & connect* → sign in with the email and password
   from step 3 → *Sign in & pull*. Signing in pulls first, then queues your
   library for upload; press **Send everything up** once if you want it there
   immediately.

Then on machine two: same file, same two fields, same login. That's all.

### If you'd rather not use Supabase

Anything that speaks PostgREST works, because that's all the desk uses: one
table named `desk_document` with those columns, the unique
`(owner, collection, record_id)` index, a `updated_at` the server can own, and
`apikey` + `Authorization: Bearer` handling. Self-hosted Supabase or a plain
Postgres behind PostgREST both qualify; `src/js/sync.js` never mentions the word
Supabase in a request path except `/auth/v1/` and `/rest/v1/`.

## How it behaves day to day

| Thing | Behaviour |
| --- | --- |
| You type | local save as always, then ~4 s after you stop, a **diff** of the changed rows goes up — not the library |
| Nothing changed | no write request at all — `push` returns before touching `/rest/v1` (a token refresh may still go out if yours is near expiry) |
| Other machine's change | pulled every 60 s while the tab is visible, and immediately when you switch back to it |
| Volume | one page of 500 rows per pull, oldest-first, so a big backlog (or a machine that was off for a month) drains over successive pulls instead of timing out |
| Same row edited on both machines | **last write wins by the row's own `updatedAt`**: if the incoming row is older than your local copy, your copy survives *and stays dirty*, so it goes back up on the next push. Nothing silently overwrites unsent work |
| Token expires | refreshed once; if the refresh token is dead you're signed out quietly and the status line says so (your edits keep saving locally) |
| Server down / paused / URL wrong | the push fails, the error is shown in plain words, the rows stay queued, the next loop retries. A failed sync can never lose a row |
| You turn it off | *Forget this project* removes the URL, key, login and cursor **from this browser only** — nothing in the database is deleted, so the other machine keeps its copy |

### Where the desk keeps its sync bookkeeping

Four `localStorage` keys, deliberately *outside* the workspace database (writing
sync state into a table would re-trigger the save→push hook and cause a loop):

```
osr.desk.sync.config.v1    the project URL + publishable key
osr.desk.sync.session.v1   access token, refresh token, uid, email, expiry
osr.desk.sync.sent.v1      for each row: a canonical hash of what we last pushed
osr.desk.sync.cursor.v1    newest updated_at we have pulled
```

They are per **origin**, and `file://OSR-Desk.html` and `http://localhost:8600`
are different origins: configure the one you actually use. `sent.v1` is a cache,
not data — lose it and the next push just re-sends the library; delete a
category and it stays deleted either way.

## Checking it from the console

```js
await OSRSync.status(Store.s)   // { configured, signedIn, pending, cursor, lastPush, lastPull, error, … }
OSRSync.pending(Store.s)        // { ups: […rows that differ…], dels: […tombstones…] }
await OSRSync.sync()            // pull then push, the same thing "Sync now" does
await OSRSync.pushAll()         // ignore the diff and re-send the whole library
```

In the dashboard, *Table editor* → `desk_document` shows one row per record:
`payload` is the record as JSON, `deleted` marks tombstones, `owner` is your
auth uid and `device` is the writing machine's id. To watch a sync land:

```sql
select collection, count(*), max(updated_at)
  from public.desk_document group by collection order by 2 desc;
```

## The wire contract, exactly

```
POST {url}/auth/v1/token?grant_type=password          { email, password }
POST {url}/auth/v1/token?grant_type=refresh_token     { refresh_token }

POST {url}/rest/v1/desk_document
     ?on_conflict=owner,collection,record_id
     Prefer: resolution=merge-duplicates, return=minimal
     [ { owner, collection, record_id, payload, deleted, updated_at, device }, … ]

GET  {url}/rest/v1/desk_document
     ?select=collection,record_id,payload,deleted,updated_at
     &order=updated_at.asc&limit=500[&updated_at=gt.<cursor>]
```

Every request carries `apikey: <publishable key>`; every request after sign-in
also carries `Authorization: Bearer <access token>`. Row shapes: `settings` is
one row with `record_id = 'settings'` holding the whole settings object; `vars`
is one row per variable with `payload = { value }`; every other row mirrors its
record minus `thumb`/`snippet`. A 401 is treated as "signed out", a 403 as "RLS
refused that write" — both are shown to you rather than retried forever.

## Deliberate limits

* **One table, one policy.** No per-field merge: a row is replaced whole. Two
  people editing the *same template body* on two machines at the same minute
  means one of those texts loses — this is a personal desk, not a collaborative
  editor.
* **`updated_at` is the server's, not yours** (a trigger sets it), so a machine
  with a wrong clock can't poison the ordering. The conflict rule compares
  *record* `updatedAt` values, which are written locally — a machine whose clock
  is far ahead will "win" conflicts until you press *Send everything up* from
  the other one.
* **Settings merge, they don't replace** — a fresh machine keeps its local
  settings plus whatever came down, so a laptop's theme can't wipe a desktop's.
  A `settings` tombstone is refused outright, for the same reason.
* **No file transfer, no thumbnails, no history of who typed what.** `activity`
  stays local. Anything with bytes in it has no business in a JSON column.
* **No e2e encryption.** The database owner and anyone with the service-role key
  can read the rows. It's your template library, not your client's personal data.

## Removing it

* Just stop: Settings → Sync → **Sign out** (keeps the URL so you can resume).
* Fully off: **Forget this project** (asks first; removes config + login + cursor
  from this browser).
* Off the server too: run `delete from public.desk_document;` — or to remove the
  feature entirely, `drop table public.desk_document; drop function public.desk_touch();`
  and revoke the key in *API Keys* if it was ever pasted somewhere it shouldn't
  have been.
* To delete the code instead: drop `src/js/sync.js` and the `<script>` line for
  it, remove `syncCard()` from `src/js/ui.js` and the `sync*` cases and three boot
  hooks from `src/js/io.js`, then `npm run build`. Nothing else in the app refers
  to the network.

## Known rough edges (as of this build)

* The mirror is text-only by design, so a machine that pulls your library still
  has no shelf files — the templates still copy, but their attachments aren't
  there. That's the trade for not shipping bytes to a third party.
* `Send everything up` re-stamps every row, so the other machine then pulls
  ~everything back. Harmless, slightly chatty on a slow connection.
* A failed push isn't retried faster than the 60 s loop, so an edit made just
  after a sync failure can wait up to a minute. *Sync now* if you're in a hurry.
* Pull only asks for rows newer than the cursor. If you emptied the table on the
  server, press *Send everything up* to re-upload rather than waiting for a
  machine to notice the difference.
