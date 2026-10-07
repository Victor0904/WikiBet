-- ===== Corrections après la deuxième revue =====

-- 1. Live : la tendance ne s'extrapole plus sur une heure entière (un live qui démarre donnait un seuil à +48 %).
--    Écart de prévision amorti et borné à ±10 % ; volatilité plancher relevée (Twitch ne publie que toutes les 1 à 3 min,
--    la volatilité mesurée sous-estime le risque : une cote de 1,05 promettait 95 % de réussite, à tort).
create function stream_drift(p_login text, p_mins float8) returns float8 language sql stable set search_path = public as $$
  select least(.1, greatest(-.1, stream_trend(p_login) * least(p_mins, 20) * .5))
$$;
create or replace function make_markets() returns int language plpgsql set search_path = public as $$
declare base timestamptz := now() + interval '10 minutes'; q1 timestamptz; n int; m int;
begin
  q1 := date_trunc('hour', base) + ceil(extract(epoch from base - date_trunc('hour', base)) / 900) * interval '15 minutes';
  insert into stream_markets (login, threshold, closes_at)
  select l.login, round_nice(l.viewers * exp(stream_drift(l.login, extract(epoch from slot - now()) / 60))), slot
  from (select distinct on (login) login, viewers, live, at from stream_ticks where at > now() - interval '3 minutes' order by login, at desc) l,
       unnest(array[q1, q1 + interval '15 minutes', q1 + interval '45 minutes']) slot
  where l.live and l.viewers >= 100
  on conflict (login, closes_at) do nothing;
  get diagnostics n = row_count;
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
    p_yes := normal_cdf(ln(greatest(v, 1) * exp(stream_drift(m.login, mins)) / m.threshold) / (greatest(stream_sigma(m.login), .015) * sqrt(mins)));
    p_yes := least(.88, greatest(.12, p_yes)); -- jamais « gagné d'avance » sur des chiffres aussi volatils
  end if;
  p_yes := least(0.98, greatest(0.02, p_yes));
  odds_yes := least(20, greatest(1.05, round((0.93 / p_yes)::numeric, 2)));
  odds_no := least(20, greatest(1.05, round((0.93 / (1 - p_yes))::numeric, 2)));
end $$;

-- 2. Levées de fonds : on regarde la richesse disponible (solde, mises, actions, objets revendables), pas les logements.
--    Le classement garde le patrimoine décidé (logements compris à 60 %), pour qu'acheter ne fasse pas perdre de places.
create or replace function aur_subscribe(p_tk text, p_amount float8) returns aur_holdings
language plpgsql security definer set search_path = public as $$
declare s aur_stocks; pat float8; mine float8; h aur_holdings;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  select * into s from aur_stocks where tk = p_tk;
  if not found or s.status <> 'round' or s.round_ends <= now() then raise exception 'Cette levée de fonds est close.'; end if;
  pat := bk_value(auth.uid());
  if pat < 50000 then raise exception 'Les levées de fonds demandent 50 000 W disponibles (solde, mises, actions et objets revendables) ; tu en as %.', to_char(pat, 'FM999G999G999'); end if;
  select coalesce(sum(cost), 0) into mine from aur_holdings where user_id = auth.uid() and tk = p_tk;
  if mine + p_amount > .2 * pat then raise exception 'Au plus 20 %% de ta richesse disponible par levée : encore % W possibles.', to_char(greatest(0, .2 * pat - mine), 'FM999G999G999'); end if;
  if not (p_amount >= 100) then raise exception 'Souscription de 100 W au moins.'; end if;
  update profiles set cash = cash - p_amount where id = auth.uid() and cash >= p_amount;
  if not found then raise exception 'Solde insuffisant.'; end if;
  insert into aur_holdings (user_id, tk, qty, cost) values (auth.uid(), p_tk, p_amount / s.round_price, p_amount)
  on conflict (user_id, tk) do update set qty = aur_holdings.qty + excluded.qty, cost = aur_holdings.cost + excluded.cost returning * into h;
  return h;
end $$;
create function my_wealth() returns float8 language sql stable security definer set search_path = public as $$ select bk_value(auth.uid()) $$;
revoke execute on function my_wealth() from public, anon;
grant execute on function my_wealth() to authenticated;

-- 3. Guildes : plus d'argent créé à partir de rien.
--    Observatoire : un avantage d'information (tendance et prévision des lives affichées), plus de cote relevée.
--    Fonds : le dividende ne verse que des gains réels, la moitié de ce que le fonds a gagné au-dessus de son plus haut.
--    Prix ÷ 10, entretien proportionné aux membres actifs (150 W par membre actif et par jour au plus).
update city_catalog set description = 'Pour les membres : la tendance et la prévision de chaque live Twitch et jeu Steam, à côté des questions.', costs = '{15000,50000,150000}' where id = 'observatoire';
update city_catalog set costs = '{10000,40000,150000}' where id = 'mairie';
update city_catalog set costs = '{15000,50000,150000}' where id = 'salle';
update city_catalog set costs = '{20000,60000,200000}' where id = 'banque';
update city_catalog set costs = '{25000,80000,250000}' where id = 'presse';

create or replace function bets_bonus() returns trigger language plpgsql set search_path = public as $$
declare lv int;
begin
  if tg_op = 'INSERT' then
    if new.kind = 'duel' and consume_bonus(new.user_id, 'boost_duel') then new.odds := round(new.odds * 1.2, 2); end if;
  elsif old.status = 'open' and new.status = 'lost' and coalesce(new.payout, 0) = 0 and new.kind in ('trade', 'stream', 'crypto', 'aurelys') and new.exit is not null then
    if consume_bonus(new.user_id, 'assurance') then
      new.payout := new.stake * 0.5; new.insured := true;
      update profiles set cash = cash + new.payout where id = new.user_id;
    elsif new.kind = 'aurelys' then
      lv := city_level(new.user_id, 'banque');
      if lv > 0 then
        insert into city_uses values (new.user_id, 'banque', paris_day()) on conflict do nothing;
        if found then
          new.payout := new.stake * (.05 + .1 * lv); new.insured := true;
          update profiles set cash = cash + new.payout where id = new.user_id;
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

alter table guilds add column fund_hwm float8 not null default 0;
update guilds set fund_hwm = fund_units * coalesce(aur_index(), 0);
create or replace function city_give(p_amount float8, p_kind text) returns guilds
language plpgsql security definer set search_path = public as $$
declare gid bigint; g guilds; idx float8;
begin
  select guild_id into gid from guild_members where user_id = auth.uid();
  if gid is null then raise exception 'Rejoins d''abord une guilde.'; end if;
  if p_kind not in ('tresor', 'fonds') or not (p_amount >= 100) then raise exception 'Don de 100 W au moins.'; end if;
  update profiles set cash = cash - p_amount where id = auth.uid() and cash >= p_amount;
  if not found then raise exception 'Solde insuffisant.'; end if;
  if p_kind = 'tresor' then
    update guilds set treasury = treasury + p_amount where id = gid returning * into g;
  else
    idx := aur_index(); if idx is null then raise exception 'Bourse d''Aurelys indisponible, réessaie dans un instant.'; end if;
    update guilds set fund_units = fund_units + p_amount / idx, fund_hwm = fund_hwm + p_amount where id = gid returning * into g;
  end if;
  insert into city_gifts (guild_id, user_id, kind, amount) values (gid, auth.uid(), p_kind, p_amount);
  return g;
end $$;

create function active_members(p_guild bigint) returns int language sql stable set search_path = public as $$
  select count(*)::int from guild_members m where m.guild_id = p_guild
    and exists (select 1 from bets b where b.user_id = m.user_id and b.created_at >= day_start() - interval '1 day' and b.created_at < day_start())
$$;
create or replace function city_daily() returns int language plpgsql security definer set search_path = public as $$
declare g guilds; today date := paris_day(); upkeep float8; val float8; pay float8; act int; n int := 0; idx float8 := aur_index(); r record;
begin
  for g in select * from guilds where last_day is null or last_day < today for update skip locked loop
    act := active_members(g.id);
    select least(coalesce(sum(spent), 0) * .01, 150 * greatest(act, 1)) into upkeep from city_buildings where guild_id = g.id;
    if g.last_day is not null and upkeep > 0 then
      if g.treasury >= upkeep then
        update guilds set treasury = treasury - upkeep where id = g.id;
        update city_buildings set asleep = false where guild_id = g.id;
      else
        update city_buildings set asleep = true where guild_id = g.id;
      end if;
    end if;
    -- Dividende : la moitié du gain au-dessus du plus haut, partagée entre les membres actifs présents depuis 3 jours.
    val := g.fund_units * coalesce(idx, 0);
    if g.last_day is not null and idx > 0 and val > g.fund_hwm then
      select count(*) into act from guild_members m where m.guild_id = g.id and m.joined_at <= now() - interval '3 days'
        and exists (select 1 from bets b where b.user_id = m.user_id and b.created_at >= day_start() - interval '1 day' and b.created_at < day_start());
      if act > 0 then
        pay := (val - g.fund_hwm) * .5;
        for r in select m.user_id from guild_members m where m.guild_id = g.id and m.joined_at <= now() - interval '3 days'
                   and exists (select 1 from bets b where b.user_id = m.user_id and b.created_at >= day_start() - interval '1 day' and b.created_at < day_start()) loop
          update profiles set cash = cash + pay / act where id = r.user_id;
          insert into city_gifts (guild_id, user_id, kind, amount) values (g.id, r.user_id, 'dividende', pay / act);
        end loop;
        update guilds set fund_units = fund_units - pay / idx, fund_hwm = val - pay where id = g.id;
      end if;
    end if;
    update guilds set last_day = today where id = g.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function city_view(p_guild bigint) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', g.id, 'name', g.name, 'tag', g.tag, 'owner', g.owner, 'treasury', g.treasury,
    'fund', g.fund_units * coalesce(aur_index(), 0), 'hwm', g.fund_hwm,
    'cap', 30 + 5 * coalesce((select level from city_buildings where guild_id = g.id and building = 'mairie'), 0),
    'active', active_members(g.id),
    'upkeep', (select least(coalesce(sum(spent), 0) * .01, 150 * greatest(active_members(g.id), 1)) from city_buildings where guild_id = g.id),
    'buildings', coalesce((select jsonb_agg(jsonb_build_object('id', b.building, 'level', b.level, 'asleep', b.asleep)) from city_buildings b where b.guild_id = g.id), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'home', home_level(p.id)) order by m.joined_at)
                         from guild_members m join profiles p on p.id = m.user_id where m.guild_id = g.id), '[]'),
    'donors', coalesce((select jsonb_agg(x order by x->>'total' desc) from (
                select jsonb_build_object('pseudo', p.pseudo, 'total', sum(c.amount)) as x from city_gifts c join profiles p on p.id = c.user_id
                where c.guild_id = g.id and c.kind <> 'dividende' group by p.pseudo order by sum(c.amount) desc limit 10) d), '[]'))
  from guilds g where g.id = p_guild
$$;
-- Mes bâtiments actifs (pour l'observatoire côté écran).
create function my_city() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(id, city_level(auth.uid(), id)), '{}') from city_catalog
$$;
revoke execute on function my_city() from public, anon;
grant execute on function my_city() to authenticated;

-- Le classement des guildes affiche la vraie capacité (la mairie l'agrandit).
drop function guild_list(text);
create function guild_list(p_period text default 'today')
returns table (id bigint, name text, tag text, motto text, members int, gain float8, mine boolean, cap int)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.tag, g.motto, count(m.user_id)::int,
         coalesce(sum(gain_since(m.user_id, case when p_period = 'today' then day_start() end)), 0),
         bool_or(m.user_id = auth.uid()),
         30 + 5 * coalesce((select level from city_buildings b where b.guild_id = g.id and b.building = 'mairie'), 0)
  from guilds g left join guild_members m on m.guild_id = g.id
  group by g.id order by 6 desc, 5 desc limit 50
$$;
revoke execute on function guild_list(text) from public, anon;
grant execute on function guild_list(text) to authenticated;

-- 4. Frais minimum de 1 W : découper un ordre en petits morceaux ne permet plus d'échapper aux frais.
create or replace function aur_fee(p_user uuid, p_notional float8) returns float8 language sql stable set search_path = public as $$
  select greatest(1, p_notional * 0.001 * (1 - 0.1 * city_level(p_user, 'salle')))
$$;
