-- Questions sur les streamers : « X dépassera-t-il N spectateurs à HH:MM ? », Oui / Non à cote fixe.
-- Les questions sont créées par settle() (chaque minute) pour chaque live suivi, sur trois échéances à heure ronde.
-- La cote est calculée par la base au moment du pari et figée ; règlement sur le dernier chiffre Twitch avant l'échéance.

create table stream_markets (
  id bigint generated always as identity primary key,
  login text not null references streamers on delete cascade,
  threshold int not null,
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  final_viewers int,
  result boolean,                -- true : le seuil a été dépassé
  unique (login, closes_at)
);
create index on stream_markets (closes_at) where result is null;
alter table stream_markets enable row level security;
create policy "lecture publique" on stream_markets for select using (true);

alter table bets drop constraint bets_kind_check;
alter table bets add constraint bets_kind_check check (kind in ('trade', 'duel', 'stream', 'question'));
alter table bets drop constraint bets_side_check;
alter table bets add constraint bets_side_check check (side in ('a', 'b', 'yes', 'no'));
alter table bets add column market_id bigint references stream_markets, add column threshold int;

-- Loi normale (approximation logistique, à 1 % près : suffisant pour une cote).
create function normal_cdf(x float8) returns float8 language sql immutable as $$ select 1 / (1 + exp(-1.702 * x)) $$;

-- Volatilité d'un live par minute (écart type du log des spectateurs, sur la dernière heure), bornée.
create function stream_sigma(p_login text) returns float8 language sql stable set search_path = public as $$
  with t as (
    select viewers, lag(viewers) over (order by at) as pv, at, lag(at) over (order by at) as pat
    from stream_ticks where login = p_login and live and at > now() - interval '60 minutes'
  ), d as (
    select ln(viewers::float8 / pv) as r, extract(epoch from at - pat) / 60 as m from t where pv > 0 and viewers > 0
  )
  select least(0.05, greatest(0.004, coalesce(sqrt(sum(r * r) / nullif(sum(m), 0)), 0.01))) from d
$$;

-- Cotes Oui / Non d'une question à l'instant présent (marge de 7 %, bornées entre 1,05 et 20).
create function market_odds(p_market bigint, out p_yes float8, out odds_yes numeric, out odds_no numeric)
language plpgsql stable set search_path = public as $$
declare m stream_markets; v int; mins float8;
begin
  select * into m from stream_markets where id = p_market;
  select viewers into v from stream_ticks where login = m.login and live order by at desc limit 1;
  mins := greatest(1, extract(epoch from m.closes_at - now()) / 60);
  p_yes := normal_cdf(ln(greatest(v, 1)::float8 / m.threshold) / (stream_sigma(m.login) * sqrt(mins)));
  p_yes := least(0.98, greatest(0.02, p_yes));
  odds_yes := least(20, greatest(1.05, round((0.93 / p_yes)::numeric, 2)));
  odds_no := least(20, greatest(1.05, round((0.93 / (1 - p_yes))::numeric, 2)));
end $$;

-- Seuil d'une question : au-dessus de l'audience actuelle, à une distance qui donne au Oui environ une chance sur trois
-- (0,4 écart type sur la durée), arrondi à un pas lisible (9 732 → pas de 50, 25 000 → pas de 500), strictement au-dessus.
create function nice_threshold(v int, sigma float8, mins float8) returns int language sql immutable as $$
  select greatest(((floor(v / st) + 1) * st)::int, (round(v * exp(0.4 * sigma * sqrt(mins)) / st) * st)::int)
  from (select greatest(1, power(10, floor(log(greatest(v, 10))) - 1) / 2) as st) x
$$;

-- Crée les questions manquantes : pour chaque live relevé il y a moins de 3 min (100 spectateurs au moins),
-- échéances au prochain quart d'heure à 10 min au moins, puis +15 min et +45 min.
create function make_markets() returns int language plpgsql set search_path = public as $$
declare base timestamptz := now() + interval '10 minutes'; q1 timestamptz; n int;
begin
  q1 := date_trunc('hour', base) + ceil(extract(epoch from base - date_trunc('hour', base)) / 900) * interval '15 minutes';
  insert into stream_markets (login, threshold, closes_at)
  select l.login, nice_threshold(l.viewers, stream_sigma(l.login), extract(epoch from slot - now()) / 60), slot
  from (select distinct on (login) login, viewers, live, at from stream_ticks where at > now() - interval '3 minutes' order by login, at desc) l,
       unnest(array[q1, q1 + interval '15 minutes', q1 + interval '45 minutes']) slot
  where l.live and l.viewers >= 100
  on conflict (login, closes_at) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Questions ouvertes aux paris (jusqu'à 5 min avant l'échéance), avec les cotes du moment.
create function open_markets()
returns table (id bigint, login text, threshold int, closes_at timestamptz, p_yes float8, odds_yes numeric, odds_no numeric)
language sql stable set search_path = public as $$
  select m.id, m.login, m.threshold, m.closes_at, o.p_yes, o.odds_yes, o.odds_no
  from stream_markets m, lateral market_odds(m.id) o
  where m.result is null and m.closes_at > now() + interval '5 minutes'
  order by m.closes_at, m.login
$$;

create function bet_question(p_market bigint, p_side text, p_stake float8) returns bets
language plpgsql security definer set search_path = public as $$
declare m stream_markets; o record; g record; b bets; t stream_ticks;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if p_side not in ('yes', 'no') then raise exception 'Choisis Oui ou Non.'; end if;
  select * into m from stream_markets where id = p_market;
  if not found or m.result is not null or m.closes_at <= now() + interval '5 minutes' then
    raise exception 'Les paris sur cette question sont fermés.';
  end if;
  select * into t from stream_ticks where login = m.login order by at desc limit 1;
  if not t.live or t.at < now() - interval '3 minutes' then raise exception 'Pas de chiffre Twitch récent pour ce live, réessaie dans une minute.'; end if;
  select * into o from market_odds(p_market);
  select * into g from game_now();
  update profiles set cash = cash - p_stake where id = auth.uid() and p_stake > 0 and cash >= p_stake;
  if not found then raise exception 'Solde insuffisant.'; end if;
  insert into bets (user_id, session, day, kind, stake, login, market_id, threshold, side, odds, entry, end_at)
  values (auth.uid(), g.k, g.d, 'question', p_stake, m.login, m.id, m.threshold, p_side,
          case p_side when 'yes' then o.odds_yes else o.odds_no end, t.viewers, m.closes_at)
  returning * into b;
  return b;
end $$;

-- Tranche les questions échues : dernier relevé avant l'échéance (0 si le live était terminé).
-- On attend un relevé postérieur à l'échéance, ou 5 min de retard si la relève est en panne.
create function resolve_markets() returns int language plpgsql set search_path = public as $$
declare m stream_markets; t stream_ticks; v int; n int := 0; b record; won boolean; pay float8;
begin
  for m in select * from stream_markets where result is null and closes_at <= now() loop
    if not exists (select 1 from stream_ticks where login = m.login and at >= m.closes_at)
       and now() < m.closes_at + interval '5 minutes' then continue; end if;
    select * into t from stream_ticks where login = m.login and at <= m.closes_at order by at desc limit 1;
    v := case when t.live then t.viewers else 0 end;
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

-- On continue de relever un streamer tant qu'une question pariée n'est pas tranchée.
create or replace function streamers_to_watch() returns table (login text) language sql stable set search_path = public as $$
  select login from bets where status = 'open' and kind in ('stream', 'question')
  union
  select login from stream_ticks where live and at > now() - interval '30 minutes'
$$;

-- settle() : tout ce qui précède, plus la création et le règlement des questions.
create or replace function settle() returns int
language plpgsql security definer set search_path = public as $$
declare g record; r record; n int := 0; rc int; due boolean; ended timestamptz;
begin
  select * into g from game_now();
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
  perform make_markets();
  for r in select distinct user_id, session from bets
            where session >= g.k - 5 and (session < g.k or not g.playing) loop
    insert into salaries values (r.user_id, r.session) on conflict do nothing;
    get diagnostics rc = row_count;
    if rc > 0 then update profiles set cash = cash + 500 where id = r.user_id; end if;
  end loop;
  return n;
end $$;

revoke execute on function make_markets(), resolve_markets() from public, anon, authenticated;
revoke execute on function bet_question(bigint, text, float8) from public, anon;
grant execute on function bet_question(bigint, text, float8) to authenticated;
