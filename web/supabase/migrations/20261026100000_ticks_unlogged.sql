-- Cours à la seconde hors journal (WAL) : 65 000 lignes par heure écrites puis purgées, la moitié des écritures disque.
-- Après un arrêt brutal de Postgres, la table repart vide : on perd au plus 2 h de cours à la seconde. Les bougies
-- (aur_candles) gardent l'historique, et le moteur reprend depuis aur_state au passage suivant.
-- Retour arrière : alter table aur_ticks set logged; (aur_last et aur_settle peuvent rester tels quels).
alter table aur_ticks set unlogged;

-- Table vide (après un redémarrage) : dernier cours = clôture de la dernière bougie. Sans ce repli, les actions
-- vaudraient 0 (patrimoine, faillite, dividendes). Les ordres restent refusés : ce cours a plus de 30 s.
create or replace function aur_last(p_tk text) returns aur_ticks language sql stable set search_path = public as $$
  (select * from aur_ticks where tk = p_tk and t <= now() order by t desc limit 1)
  union all
  (select c.tk, c.t, c.c, 0::float8, false, null::jsonb from aur_candles c where c.tk = p_tk and c.t <= now() order by c.t desc limit 1)
  limit 1
$$;

-- Bougie de l'heure en cours : si les cours à la seconde ont été perdus, ne pas l'écraser avec ce qui reste
-- (ouverture gardée, plus haut et plus bas cumulés). Sans perte, le résultat est identique.
create or replace function aur_settle() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; w timestamptz; t1 timestamptz := now();
begin
  insert into aur_candles (tk, t, o, h, l, c, v)
  select tk, aur_hour(t), (array_agg(p order by t))[1], max(p), min(p), (array_agg(p order by t desc))[1], sum(v)
    from aur_ticks where t >= aur_hour(now()) - interval '5 minutes' and t <= now()
   group by tk, aur_hour(t)
  on conflict (tk, t) do update set h = greatest(aur_candles.h, excluded.h), l = least(aur_candles.l, excluded.l),
                                    c = excluded.c, v = greatest(aur_candles.v, excluded.v);
  select liq_at - interval '2 minutes' into w from aur_watch;
  for r in select id from bets where kind = 'aurelys' and status = 'open' loop
    if (aur_liquidate(r.id, coalesce(w, '-infinity'))).status = 'lost' then n := n + 1; end if;
  end loop;
  insert into aur_watch values (1, t1) on conflict (id) do update set liq_at = greatest(aur_watch.liq_at, excluded.liq_at);
  if exists (select 1 from guilds where last_day is null or last_day < paris_day()) then perform city_daily(); end if;
  perform aur_dividends();
  delete from aur_ticks where ctid in (select ctid from aur_ticks where t < now() - interval '2 hours' limit 20000);
  delete from aur_candles where t < now() - interval '10 days';
  delete from aur_news where t < now() - interval '2 hours' and id < (select max(id) from aur_news);
  delete from aur_orders where taken and t < now() - interval '1 hour';
  return n;
end $$;
