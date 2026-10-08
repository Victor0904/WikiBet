-- Après une panne, des centaines de milliers de vieux cours s'accumulent : les purger d'un coup dépassait le délai
-- de 8 s et aur_settle échouait à chaque appel. On purge par lots ; le cron rattrape le retard en quelques passages.
create or replace function aur_settle() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  insert into aur_candles (tk, t, o, h, l, c, v)
  select tk, aur_hour(t), (array_agg(p order by t))[1], max(p), min(p), (array_agg(p order by t desc))[1], sum(v)
    from aur_ticks where t >= aur_hour(now()) - interval '5 minutes' and t <= now()
   group by tk, aur_hour(t)
  on conflict (tk, t) do update set o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v;
  for r in select id from bets where kind = 'aurelys' and status = 'open' loop
    if (aur_liquidate(r.id)).status = 'lost' then n := n + 1; end if;
  end loop;
  if exists (select 1 from guilds where last_day is null or last_day < paris_day()) then perform city_daily(); end if;
  perform aur_dividends();
  delete from aur_ticks where ctid in (select ctid from aur_ticks where t < now() - interval '2 hours' limit 20000);
  delete from aur_candles where t < now() - interval '10 days';
  delete from aur_news where t < now() - interval '10 days';
  delete from aur_orders where taken and t < now() - interval '1 hour';
  return n;
end $$;
