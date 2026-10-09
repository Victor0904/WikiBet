-- Budget disque de l'offre gratuite (octobre 2026) : moins de lectures et d'écritures, mêmes règles du jeu.
-- Mesure avant : aur_settle touchait 43 000 pages par passage (toutes les 10 s) pour vérifier les liquidations,
-- et verrouillait chaque position ouverte (une écriture par position et par passage).
--
-- Retour arrière : réappliquer aur_settle / aur_liquidate / settle / aur_dividends de leurs migrations précédentes
-- (20261018200000_actus_2h, 20261024000000_notifications, 20261025500000_salaire_bots, 20261018000000_dividendes),
-- drop table aur_watch ; drop index bets_open_aur ; remettre la tâche wikibourse-menage (20261020100000_menage) ;
-- alter publication supabase_realtime add table stream_ticks.

-- ===== 1. Liquidations : ne relire que les cours nouveaux =====
-- Les cours plus anciens que le dernier passage ont déjà été vérifiés. Marge de 2 minutes : un passage concurrent
-- peut enregistrer des cours juste avant le nôtre. Même prix de liquidation, même heure (premier cours qui la touche).
create table aur_watch (id int primary key default 1 check (id = 1), liq_at timestamptz not null);
alter table aur_watch enable row level security;

drop function aur_liquidate(bigint);
create function aur_liquidate(p_id bigint, p_since timestamptz default '-infinity') returns bets
language plpgsql set search_path = public as $$
declare b bets; lq float8; t0 timestamptz;
begin
  -- Lecture sans verrou : on ne verrouille (donc n'écrit) que la position réellement touchée.
  select * into b from bets where id = p_id and kind = 'aurelys' and status = 'open';
  if not found then return null; end if;
  lq := b.entry * (1 - (case when b.dir = 'up' then 1 else -1 end)::float8 / b.lev);
  select min(k.t) into t0 from aur_ticks k
   where k.tk = b.aur and k.t > greatest(b.created_at, p_since) and k.t <= now()
     and (case when b.dir = 'up' then k.p <= lq else k.p >= lq end);
  if t0 is null then return b; end if;
  select * into b from bets where id = p_id and status = 'open' for update;
  if not found then return null; end if; -- clôturée entre-temps
  update bets set status = 'lost', payout = 0, exit = lq, exit_at = t0, closed_at = now(), closed_by = 'liq' where id = b.id returning * into b;
  return b;
end $$;
revoke execute on function aur_liquidate(bigint, timestamptz) from public, anon, authenticated;

create or replace function aur_settle() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; w timestamptz; t1 timestamptz := now();
begin
  insert into aur_candles (tk, t, o, h, l, c, v)
  select tk, aur_hour(t), (array_agg(p order by t))[1], max(p), min(p), (array_agg(p order by t desc))[1], sum(v)
    from aur_ticks where t >= aur_hour(now()) - interval '5 minutes' and t <= now()
   group by tk, aur_hour(t)
  on conflict (tk, t) do update set o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v;
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

-- Dividendes : on ne verrouille le jour que quand il change (avant : une écriture à chaque passage).
create or replace function aur_dividends() returns int language plpgsql security definer set search_path = public as $$
declare today int := floor((extract(epoch from now()) - 1790812800) / 3600)::int; last int; n int := 0; r record; pay float8;
begin
  if (select day from aur_div_day) >= today then return 0; end if;
  select day into last from aur_div_day for update;
  if last is null then insert into aur_div_day values (1, today); return 0; end if;
  if last >= today then return 0; end if;
  update aur_div_day set day = today where id = 1;
  for r in select h.user_id, h.tk, h.qty, s.div from aur_holdings h join aur_stocks s on s.tk = h.tk where h.qty > 0 and s.div > 0 and s.status = 'core' loop
    pay := r.qty * coalesce((aur_last(r.tk)).p, 0) * r.div / 100 / 365;
    if pay > 0 then update profiles set cash = cash + pay where id = r.user_id; n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ===== 6. Positions ouvertes : index partiel (aur_settle, aur_due, push_due) =====
create index bets_open_aur on bets (aur) where status = 'open' and kind = 'aurelys';

-- ===== 6. Salaire : ne plus recalculer le patrimoine des séances déjà payées =====
-- Avant : chaque minute, salary_factor() (donc patrimoine()) pour chaque joueur et chacune des 5 dernières séances,
-- même déjà payées (100 ms sur 87 couples). Règle inchangée.
create or replace function settle() returns int
language plpgsql security definer set search_path = public as $$
declare g record; r record; n int := 0; rc int; due boolean; ended timestamptz;
begin
  select * into g from game_now();
  -- Anciens modes (articles, duels, Live) : plus rien ne s'y ouvre, le règlement reste pour l'historique et les tests.
  for r in select id, session, end_tick from bets where status = 'open' and kind = 'trade' loop
    due := r.session < g.k or not g.playing or r.end_tick <= g.t;
    perform close_trade_at(r.id, case when due then r.end_tick else g.t end, due);
    n := n + 1;
  end loop;
  for r in select id from bets where status = 'open' and kind = 'duel' and (session < g.k or (session = g.k and not g.playing)) loop
    perform settle_duel(r.id); n := n + 1;
  end loop;
  for r in select id, login, created_at, end_at from bets where status = 'open' and kind = 'stream' loop
    select min(at) into ended from stream_ticks where login = r.login and not live and at > r.created_at;
    due := ended is not null or (r.end_at is not null and r.end_at <= now());
    perform close_stream_at(r.id, least(now(), coalesce(r.end_at, now()), coalesce(ended, now())), due);
    n := n + 1;
  end loop;
  n := n + resolve_markets();
  for r in select x.user_id, x.session, least(500, round(0.1 * sum(x.counted) * salary_factor(x.user_id))) amt
             from (select b.user_id, b.session, b.aur,
                          least(sum(b.stake), abs(sum(case when b.dir = 'up' then 1 else -1 end * b.stake * b.lev))) counted
                     from bets b
                    where b.session >= g.k - 5 and (b.session < g.k or not g.playing) and b.kind = 'aurelys'
                      and coalesce(b.closed_at, now()) - b.created_at >= interval '150 seconds'
                      and not exists (select 1 from salaries s where s.user_id = b.user_id and s.session = b.session)
                    group by 1, 2, 3) x
            group by 1, 2 loop
    insert into salaries values (r.user_id, r.session, r.amt) on conflict do nothing;
    get diagnostics rc = row_count;
    if rc > 0 and r.amt > 0 then update profiles set cash = cash + r.amt where id = r.user_id; end if;
  end loop;
  return n;
end $$;

-- ===== 5. Temps réel : stream_ticks n'est plus écrit (Live retiré) =====
do $$ begin
  alter publication supabase_realtime drop table stream_ticks;
exception when others then null; end $$;

-- ===== 7. Journaux : garder 1 h au lieu de 2 jours (job_run_details : 25 Mo, net._http_response : 6 h par défaut) =====
do $$ begin
  perform cron.unschedule('wikibourse-menage');
  perform cron.schedule('wikibourse-menage', '7 * * * *', $c$
    delete from cron.job_run_details where end_time < now() - interval '1 hour';
    delete from net._http_response where created < now() - interval '1 hour';
  $c$);
exception when others then null; end $$;
