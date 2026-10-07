-- ===== Live, version 2 =====
-- 1. Le seuil se place près de la prévision (audience actuelle prolongée par sa tendance des 30 dernières minutes) :
--    Oui et Non ont des cotes proches de 1,8 / 2,0. Avant, le seuil ignorait la tendance : un live qui montait
--    dépassait vite son seuil, et l'on voyait « Oui 1,05 / Non 20 ».
-- 2. Questions du jour qui récompensent la connaissance : « Le pic de X aujourd'hui battra-t-il celui d'hier ? »
--    (Steam : sorties, mises à jour, soldes, week-ends ; Twitch : événements, invités, horaires).

create index if not exists stream_ticks_login_at on stream_ticks (login, at desc);

-- Tendance d'un live : pente du log des spectateurs par minute sur 30 min, bornée à ±1 % par minute.
create function stream_trend(p_login text) returns float8 language sql stable set search_path = public as $$
  select least(.01, greatest(-.01, coalesce(regr_slope(ln(viewers::float8), extract(epoch from at) / 60), 0)))
  from stream_ticks where login = p_login and live and viewers > 0 and at > now() - interval '30 minutes'
$$;
-- Arrondi lisible à environ 1 % près : 9 732 → 9 700, 1 284 000 → 1 280 000.
create function round_nice(x float8) returns int language sql immutable as $$
  select (round(x / st) * st)::int from (select power(10, floor(log(greatest(x * .02, 1)))) as st) s
$$;

alter table stream_markets add column kind text not null default 'at' check (kind in ('at', 'peak')),
  add column bet_until timestamptz;

create or replace function make_markets() returns int language plpgsql set search_path = public as $$
declare base timestamptz := now() + interval '10 minutes'; q1 timestamptz; n int; m int;
begin
  q1 := date_trunc('hour', base) + ceil(extract(epoch from base - date_trunc('hour', base)) / 900) * interval '15 minutes';
  insert into stream_markets (login, threshold, closes_at)
  select l.login, round_nice(l.viewers * exp(stream_trend(l.login) * extract(epoch from slot - now()) / 60)), slot
  from (select distinct on (login) login, viewers, live, at from stream_ticks where at > now() - interval '3 minutes' order by login, at desc) l,
       unnest(array[q1, q1 + interval '15 minutes', q1 + interval '45 minutes']) slot
  where l.live and l.viewers >= 100
  on conflict (login, closes_at) do nothing;
  get diagnostics n = row_count;
  -- Questions du jour : pour chaque jeu Steam, et pour les 15 plus gros lives Twitch d'hier.
  insert into stream_markets (login, threshold, closes_at, kind, bet_until)
  select y.login, y.peak, day_start() + interval '1 day' - interval '1 second', 'peak', day_start() + interval '18 hours'
  from (select login, max(viewers) as peak, login like 'steam:%' as steam from stream_ticks
        where live and at >= day_start() - interval '1 day' and at < day_start() group by login) y
  where (y.steam and y.peak >= 1000) or (not y.steam and y.login in (
          select login from stream_ticks where live and login not like 'steam:%' and at >= day_start() - interval '1 day' and at < day_start()
          group by login having max(viewers) >= 2000 order by max(viewers) desc limit 15))
  on conflict (login, closes_at) do nothing;
  get diagnostics m = row_count;
  return n + m;
end $$;

-- Cotes : prévision (tendance comprise) contre seuil. Pic du jour : rythme d'aujourd'hui comparé à hier à la même heure.
create or replace function market_odds(p_market bigint, out p_yes float8, out odds_yes numeric, out odds_no numeric)
language plpgsql stable set search_path = public as $$
declare m stream_markets; v int; mins float8; today int; yday int;
begin
  select * into m from stream_markets where id = p_market;
  if m.kind = 'peak' then
    select max(viewers) into today from stream_ticks where login = m.login and live and at >= day_start();
    select max(viewers) into yday from stream_ticks where login = m.login and live and at >= day_start() - interval '1 day' and at < now() - interval '1 day';
    p_yes := case when today > m.threshold then .98 when coalesce(today, 0) = 0 or coalesce(yday, 0) = 0 then .5
                  else normal_cdf(ln(today::float8 / yday) / .12) end;
  else
    select viewers into v from stream_ticks where login = m.login and live order by at desc limit 1;
    mins := greatest(1, extract(epoch from m.closes_at - now()) / 60);
    p_yes := normal_cdf(ln(greatest(v, 1) * exp(stream_trend(m.login) * mins) / m.threshold) / (greatest(stream_sigma(m.login), .008) * sqrt(mins)));
  end if;
  p_yes := least(0.98, greatest(0.02, p_yes));
  odds_yes := least(20, greatest(1.05, round((0.93 / p_yes)::numeric, 2)));
  odds_no := least(20, greatest(1.05, round((0.93 / (1 - p_yes))::numeric, 2)));
end $$;

-- Questions ouvertes : jusqu'à 5 min avant l'échéance, ou jusqu'à 18 h pour un pic du jour (tant qu'il n'est pas déjà battu).
drop function open_markets();
create function open_markets()
returns table (id bigint, login text, threshold int, closes_at timestamptz, p_yes float8, odds_yes numeric, odds_no numeric, kind text, bet_until timestamptz)
language sql stable set search_path = public as $$
  select m.id, m.login, m.threshold, m.closes_at, o.p_yes, o.odds_yes, o.odds_no, m.kind, coalesce(m.bet_until, m.closes_at - interval '5 minutes')
  from stream_markets m, lateral market_odds(m.id) o
  where m.result is null and coalesce(m.bet_until, m.closes_at - interval '5 minutes') > now() and o.p_yes < .98
  order by m.kind, m.closes_at, m.login
$$;

create or replace function bet_question(p_market bigint, p_side text, p_stake float8) returns bets
language plpgsql security definer set search_path = public as $$
declare m stream_markets; o record; g record; b bets; t stream_ticks;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if p_side not in ('yes', 'no') then raise exception 'Choisis Oui ou Non.'; end if;
  select * into m from stream_markets where id = p_market;
  if not found or m.result is not null or coalesce(m.bet_until, m.closes_at - interval '5 minutes') <= now() then
    raise exception 'Les paris sur cette question sont fermés.';
  end if;
  select * into t from stream_ticks where login = m.login order by at desc limit 1;
  if m.kind = 'at' and (not t.live or t.at < now() - interval '3 minutes') then raise exception 'Pas de chiffre récent pour ce live, réessaie dans une minute.'; end if;
  select * into o from market_odds(p_market);
  if o.p_yes >= .98 then raise exception 'Le pic d''hier est déjà battu : question fermée.'; end if;
  select * into g from game_now();
  update profiles set cash = cash - p_stake where id = auth.uid() and p_stake > 0 and cash >= p_stake;
  if not found then raise exception 'Solde insuffisant.'; end if;
  insert into bets (user_id, session, day, kind, stake, login, market_id, threshold, side, odds, entry, end_at)
  values (auth.uid(), g.k, g.d, 'question', p_stake, m.login, m.id, m.threshold, p_side,
          case p_side when 'yes' then o.odds_yes else o.odds_no end, coalesce(t.viewers, 0), m.closes_at)
  returning * into b;
  return b;
end $$;

-- Règlement : pic du jour = plus haut chiffre de la journée (heure de Paris) ; question à l'heure : comme avant.
create or replace function resolve_markets() returns int language plpgsql set search_path = public as $$
declare m stream_markets; t stream_ticks; v int; n int := 0; b record; won boolean; pay float8;
begin
  for m in select * from stream_markets where result is null and closes_at <= now() loop
    if m.kind = 'peak' then
      select coalesce(max(viewers), 0) into v from stream_ticks where login = m.login and live and at > m.closes_at - interval '1 day' and at <= m.closes_at;
    else
      if not exists (select 1 from stream_ticks where login = m.login and at >= m.closes_at)
         and now() < m.closes_at + interval '5 minutes' then continue; end if;
      select * into t from stream_ticks where login = m.login and at <= m.closes_at order by at desc limit 1;
      v := case when t.live then t.viewers else 0 end;
    end if;
    update stream_markets set final_viewers = v, result = v > m.threshold where id = m.id and result is null;
    n := n + 1;
  end loop;
  for b in select x.id, x.side, x.stake, x.odds, x.user_id, sm.result, sm.final_viewers from bets x join stream_markets sm on sm.id = x.market_id
           where x.status = 'open' and x.kind = 'question' and sm.result is not null loop
    won := (b.side = 'yes') = b.result;
    pay := case when won then b.stake * b.odds else 0 end;
    update bets set status = case when won then 'won' else 'lost' end, payout = pay, closed_at = now(), exit = b.final_viewers
     where id = b.id and status = 'open';
    if found then update profiles set cash = cash + pay where id = b.user_id; end if;
  end loop;
  return n;
end $$;
