/* =========================================================
   OSR Desk — the optional sync mirror (Supabase / Postgres)

   One table. Run this once in the Supabase dashboard:
   Project → SQL Editor → New query → paste → Run.
   It is idempotent, so re-running it after an edit is safe.

   Nothing else is needed: no service role key, no second table, no
   migration tool. The desk talks to this table through PostgREST
   (the auto-generated /rest/v1/desk_document API) and a normal
   Supabase login, with plain fetch() — there is no client library
   and no CDN script in the app.

   Model: your IndexedDB in the browser stays the source of truth.
   This table is a mirror of the TEXT rows only (templates, phrases,
   categories, cases, remembered {{placeholders}}, settings). The file
   shelf — screenshots, dropped documents, thumbnails — is never sent
   anywhere, so nothing here holds bytes.

   Row-level security is the whole access model: every row is stamped
   with `owner = auth.uid()` and each policy lets a user touch only
   their own rows. Two desks signed in as the same user share a mirror;
   two desks signed in as different users cannot read each other at all,
   even if they point at the same project.
   ========================================================= */

create table if not exists public.desk_document (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid    not null default auth.uid(),
  collection  text    not null,
  record_id   text    not null,
  payload     jsonb   not null,
  deleted     boolean          default false,
  updated_at  timestamptz      default now(),
  device      text,
  /* the on_conflict target the desk upserts against */
  unique (owner, collection, record_id),
  constraint desk_document_collection_check
    check (collection in ('templates', 'phrases', 'categories', 'cases', 'vars', 'settings'))
);

/* pulls are "everything newer than my cursor", scoped per owner */
create index if not exists desk_document_owner_updated
  on public.desk_document (owner, updated_at);
create index if not exists desk_document_owner_collection_updated
  on public.desk_document (owner, collection, updated_at);

/*
 * The desk does not trust its own clock, and it does not trust the client:
 * the server decides when a row changed, and who it belongs to.
 * (Consequence: a "Send everything up" re-stamps rows even when the text is
 * identical — that is fine, it just makes the next pull from another machine
 * see those rows as newer and take them, which is what you asked for.)
 */
create or replace function public.desk_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.owner := coalesce(new.owner, auth.uid());
  return new;
end $$;

drop trigger if exists desk_document_touch on public.desk_document;
create trigger desk_document_touch
  before insert or update on public.desk_document
  for each row execute function public.desk_touch();

alter table public.desk_document enable row level security;
alter table public.desk_document force  row level security;

drop policy if exists "own desk rows" on public.desk_document;
create policy "own desk rows"
  on public.desk_document as permissive for all
  to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

/* PostgREST needs these explicitly on a fresh project */
grant select, insert, update, delete on public.desk_document to authenticated;
grant usage on schema public to authenticated;

/* ------------------------------------------------------------------
 * Check it worked (should return 0, and no permission error):
 *   select count(*) from public.desk_document;
 *
 * Watch the mirror from the same dashboard:
 *   select collection, count(*), max(updated_at)
 *     from public.desk_document group by collection order by 2 desc;
 *
 * Empty it (the desk will re-upload on the next "Send everything up"):
 *   delete from public.desk_document where owner = auth.uid();
 *
 * Delete the whole feature:
 *   drop table public.desk_document;
 *   drop function public.desk_touch();
 * ------------------------------------------------------------------ */
