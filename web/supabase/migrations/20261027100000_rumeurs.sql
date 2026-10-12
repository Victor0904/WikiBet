-- Onglet Rumeurs du Marché (demande de Victor, octobre 2026). Le moteur décide l'issue d'une rumeur dès sa sortie ; elle
-- était gardée dans l'état (illisible), et le démenti ou la confirmation sortait comme une nouvelle sans lien. Le moteur
-- marque désormais la rumeur (`rok` : issue) et sa résolution (`rid` : numéro de la rumeur dans le moteur) ; aur_store les
-- range dans aur_rumors, que personne ne lit directement. aur_rumor_list() ne donne l'issue qu'une fois la résolution
-- publiée, et aucun cours postérieur à maintenant. Gardées 8 jours (le Courrier, lui, ne garde que 2 h d'articles).
-- Retour arrière : réappliquer aur_store de 20261013100000_news_ids.sql, supprimer aur_rumors et aur_rumor_list.

create table aur_rumors (
  id bigint primary key,          -- numéro de la nouvelle dans aur_news
  eid bigint unique not null,     -- numéro dans le moteur (S.nid), pour relier la résolution
  tk text not null, t timestamptz not null, title text not null, sent float8 not null,
  ok boolean not null,            -- issue décidée par le moteur : secrète jusqu'à res_t
  p0 float8,                      -- cours à la sortie de la rumeur
  res_t timestamptz, p1 float8    -- heure et cours de la résolution
);
create index on aur_rumors (t desc);
alter table aur_rumors enable row level security; -- aucune politique : illisible par les joueurs

create or replace function aur_store(p_from bigint, p_state jsonb, p_ticks jsonb, p_news jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_from is null then
    insert into aur_state values (1, (p_state->>'t')::bigint, p_state);
  else
    update aur_state set state = p_state, t = (p_state->>'t')::bigint where id = 1 and t = p_from;
    if not found then raise exception 'conflit : la simulation a déjà avancé'; end if;
  end if;
  insert into aur_ticks (tk, t, p, v, halt, x)
  select r.tk, to_timestamp(r.t), r.p, r.v, coalesce(r.halt, false), r.x from jsonb_to_recordset(p_ticks) as r(t bigint, tk text, p float8, v float8, halt boolean, x jsonb)
  on conflict do nothing;
  with r as (
    select x.*, coalesce((select max(id) from aur_news), 0) + row_number() over (order by x.id) as nid
    from jsonb_to_recordset(p_news) as x(id bigint, t bigint, tk text, sector text, cat text, title text, text text, sent float8, fiab float8, rok boolean)
  ), n as (
    insert into aur_news (id, t, tk, sector, cat, title, body, sent, fiab)
    select nid, to_timestamp(t), tk, sector, cat, title, text, sent, fiab from r returning id
  )
  insert into aur_rumors (id, eid, tk, t, title, sent, ok, p0)
  select r.nid, r.id, r.tk, to_timestamp(r.t), r.title, r.sent, r.rok,
         (select k.p from aur_ticks k where k.tk = r.tk and k.t <= to_timestamp(r.t) order by k.t desc limit 1)
  from r where r.rok is not null;
  update aur_rumors a set res_t = to_timestamp(r.t),
         p1 = (select k.p from aur_ticks k where k.tk = a.tk and k.t <= to_timestamp(r.t) order by k.t desc limit 1)
  from jsonb_to_recordset(p_news) as r(t bigint, rid bigint) where r.rid is not null and a.eid = r.rid and a.res_t is null;
  delete from aur_rumors where t < now() - interval '8 days';
end $$;

-- Rumeurs des 7 derniers jours, la plus récente d'abord, et statistiques des rumeurs résolues.
-- Issue : seulement quand la résolution est publiée pour ce joueur (même avance que les actualités, news_lead()).
-- Réaction : cours de résolution (déjà passé) ou dernier cours, face au cours de sortie ; jamais de cours futur.
create function aur_rumor_list() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (
    select r.*, r.res_t is not null and r.res_t <= now() + news_lead() as done,
           case when r.t > now() then null
                else (case when r.res_t <= now() then r.p1 else (aur_last(r.tk)).p end) / nullif(r.p0, 0) - 1 end as chg
    from aur_rumors r where r.t <= now() + news_lead() and r.t > now() - interval '7 days'
  )
  select jsonb_build_object(
    'list', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'tk', tk, 't', extract(epoch from t), 'title', title, 'sent', sent,
              'chg', chg, 'status', case when not done then 'open' when ok then 'ok' else 'no' end,
              'res_t', case when done then extract(epoch from res_t) end) order by t desc, id desc)
            from (select * from v order by t desc limit 300) x), '[]'),
    'stats', (select jsonb_build_object('n', count(*), 'ok', count(*) filter (where ok),
              'chg', avg(chg * sign(sent)) filter (where chg is not null and res_t <= now())) from v where done))
$$;
revoke execute on function aur_rumor_list() from public, anon;
grant execute on function aur_rumor_list() to authenticated;
