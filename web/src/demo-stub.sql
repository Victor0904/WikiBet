-- Ce que Supabase fournit et qu'une base Postgres nue n'a pas : le schéma auth et les rôles.
-- Sert au mode démo (PGlite dans le navigateur) et aux tests. auth.uid() lit le réglage app.uid.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
alter table auth.users add column if not exists email text;
-- Colonnes lues par le ménage des parties anonymes (anon_purge) : comme chez Supabase, compte anonyme par défaut.
alter table auth.users add column if not exists is_anonymous boolean not null default true,
  add column if not exists encrypted_password text, add column if not exists created_at timestamptz not null default now(),
  add column if not exists last_sign_in_at timestamptz;
create table if not exists auth.identities (user_id uuid not null references auth.users on delete cascade, provider text not null);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid
$$;
do $$ begin create role anon; exception when others then null; end $$;
do $$ begin create role authenticated; exception when others then null; end $$;
