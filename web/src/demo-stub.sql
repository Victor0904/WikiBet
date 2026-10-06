-- Ce que Supabase fournit et qu'une base Postgres nue n'a pas : le schéma auth et les rôles.
-- Sert au mode démo (PGlite dans le navigateur) et aux tests. auth.uid() lit le réglage app.uid.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid
$$;
do $$ begin create role anon; exception when others then null; end $$;
do $$ begin create role authenticated; exception when others then null; end $$;
