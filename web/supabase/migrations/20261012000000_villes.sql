-- ===== Villes de guilde =====
-- Chaque guilde est une ville d'Aurelys. Chaque membre y a son immeuble, dont l'allure suit son logement du QG
-- (on entre dedans pour visiter son QG). La ville se construit avec un Trésor commun, alimenté par des dons sans retour.
-- Bâtiments publics reliés aux marchés, 3 niveaux, entretenus chaque jour par le Trésor (sinon ils s'endorment) :
--   Mairie : débloque les niveaux des autres bâtiments, +5 places par niveau dans la guilde (30 → 45).
--   Salle des marchés : frais des ordres Aurelys −10 / −20 / −30 %.
--   Banque : une fois par jour, une position Aurelys liquidée rend 15 / 25 / 35 % de sa mise.
--   Agence de presse : les actualités d'Aurelys 25 / 50 / 75 s plus tôt (5 à 15 minutes d'Aurelys).
--   Observatoire : cotes des questions du Live +2 / +4 / +6 %.
-- Fonds d'investissement : placé sur l'AUR-12 (il monte et baisse avec la bourse), versements sans retour. Chaque nuit,
-- dividende par palier à chaque membre actif la veille (un pari) et présent depuis 3 jours.

create table city_catalog (
  id text primary key, name text not null, description text not null, costs int[] not null, sort int not null
);
insert into city_catalog values
  ('mairie', 'Mairie', 'Débloque les niveaux des autres bâtiments. +5 places dans la guilde par niveau.', '{100000,400000,1500000}', 1),
  ('salle', 'Salle des marchés', 'Frais des ordres Aurelys réduits de 10 % par niveau pour chaque membre.', '{150000,500000,1500000}', 2),
  ('banque', 'Banque', 'Une fois par jour, une position Aurelys liquidée rend 15, 25 ou 35 % de sa mise.', '{200000,600000,2000000}', 3),
  ('presse', 'Agence de presse', 'Les actualités d''Aurelys 25 s plus tôt par niveau (5 minutes d''Aurelys).', '{250000,800000,2500000}', 4),
  ('observatoire', 'Observatoire', 'Cotes des questions Twitch et Steam relevées de 2 % par niveau.', '{150000,500000,1500000}', 5);
alter table city_catalog enable row level security;
create policy "lecture publique" on city_catalog for select using (true);

alter table guilds add column treasury float8 not null default 0, add column fund_units float8 not null default 0,
  add column last_day date;
create table city_buildings (
  guild_id bigint references guilds on delete cascade, building text references city_catalog,
  level int not null check (level between 1 and 3), asleep boolean not null default false, spent float8 not null default 0,
  primary key (guild_id, building)
);
create table city_gifts (
  id bigint generated always as identity primary key, guild_id bigint references guilds on delete cascade,
  user_id uuid references profiles on delete cascade, kind text not null check (kind in ('tresor', 'fonds', 'dividende')),
  amount float8 not null, at timestamptz not null default now()
);
create index on city_gifts (guild_id, kind);
create table city_uses (user_id uuid references profiles on delete cascade, building text, day date, primary key (user_id, building, day));
alter table city_buildings enable row level security;
alter table city_gifts enable row level security;
alter table city_uses enable row level security;

-- Niveau actif d'un bâtiment pour un joueur (0 : pas de guilde, pas construit ou endormi faute d'entretien).
create function city_level(p_user uuid, p_building text) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select b.level from guild_members m join city_buildings b on b.guild_id = m.guild_id
                   where m.user_id = p_user and b.building = p_building and not b.asleep), 0)
$$;
create function aur_index() returns float8 language sql stable set search_path = public as $$
  select p from aur_ticks where tk = 'AUR12' and t <= now() order by t desc limit 1
$$;
create function paris_day() returns date language sql stable as $$ select (now() at time zone 'Europe/Paris')::date $$;

-- ===== Dons, construction =====
create function city_give(p_amount float8, p_kind text) returns guilds
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
    update guilds set fund_units = fund_units + p_amount / idx where id = gid returning * into g;
  end if;
  insert into city_gifts (guild_id, user_id, kind, amount) values (gid, auth.uid(), p_kind, p_amount);
  return g;
end $$;

create function city_build(p_building text) returns city_buildings
language plpgsql security definer set search_path = public as $$
declare g guilds; c city_catalog; cur int; mairie int; cost float8; b city_buildings;
begin
  select * into g from guilds where owner = auth.uid() for update;
  if not found then raise exception 'Seul le fondateur de la guilde décide des constructions.'; end if;
  select * into c from city_catalog where id = p_building;
  if not found then raise exception 'Bâtiment inconnu.'; end if;
  select coalesce(max(level), 0) into cur from city_buildings where guild_id = g.id and building = p_building;
  select coalesce(max(level), 0) into mairie from city_buildings where guild_id = g.id and building = 'mairie';
  if cur >= 3 then raise exception 'Niveau maximal atteint.'; end if;
  if p_building <> 'mairie' and cur + 1 > mairie then raise exception 'Agrandis d''abord la mairie.'; end if;
  cost := c.costs[cur + 1];
  if g.treasury < cost then raise exception 'Trésor insuffisant : il faut % W.', to_char(cost, 'FM999G999G999'); end if;
  update guilds set treasury = treasury - cost where id = g.id;
  insert into city_buildings (guild_id, building, level, spent) values (g.id, p_building, 1, cost)
  on conflict (guild_id, building) do update set level = city_buildings.level + 1, spent = city_buildings.spent + cost, asleep = false
  returning * into b;
  return b;
end $$;

-- La mairie agrandit la guilde : 30 membres, +5 par niveau.
create or replace function guild_join(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare cap int;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if exists (select 1 from guild_members where user_id = auth.uid()) then raise exception 'Quitte d''abord ta guilde.'; end if;
  perform 1 from guilds where id = p_id for update;
  if not found then raise exception 'Guilde introuvable.'; end if;
  cap := 30 + 5 * coalesce((select level from city_buildings where guild_id = p_id and building = 'mairie'), 0);
  if (select count(*) from guild_members where guild_id = p_id) >= cap then raise exception 'Guilde complète (% membres).', cap; end if;
  insert into guild_members (user_id, guild_id) values (auth.uid(), p_id);
end $$;

-- ===== Chaque nuit : entretien et dividendes =====
-- Entretien : 1 % par jour de ce que les bâtiments ont coûté. Trésor insuffisant : toute la ville s'endort (rien n'est détruit).
-- Dividende par membre actif hier (un pari ouvert hier) et présent depuis 3 jours, selon la valeur du fonds.
create function city_daily() returns int language plpgsql security definer set search_path = public as $$
declare g guilds; today date := paris_day(); upkeep float8; val float8; div int; n int := 0; idx float8 := aur_index(); r record;
begin
  for g in select * from guilds where last_day is null or last_day < today for update skip locked loop
    select coalesce(sum(spent), 0) * .01 into upkeep from city_buildings where guild_id = g.id;
    if g.last_day is not null and upkeep > 0 then
      if g.treasury >= upkeep then
        update guilds set treasury = treasury - upkeep where id = g.id;
        update city_buildings set asleep = false where guild_id = g.id;
      else
        update city_buildings set asleep = true where guild_id = g.id;
      end if;
    end if;
    val := g.fund_units * coalesce(idx, 0);
    div := case when val >= 10000000 then 1000 when val >= 3000000 then 500 when val >= 1000000 then 250 when val >= 250000 then 100 else 0 end;
    if g.last_day is not null and div > 0 then
      for r in select m.user_id from guild_members m where m.guild_id = g.id and m.joined_at <= now() - interval '3 days'
                 and exists (select 1 from bets b where b.user_id = m.user_id and b.created_at >= day_start() - interval '1 day' and b.created_at < day_start()) loop
        update profiles set cash = cash + div where id = r.user_id;
        insert into city_gifts (guild_id, user_id, kind, amount) values (g.id, r.user_id, 'dividende', div);
      end loop;
    end if;
    update guilds set last_day = today where id = g.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===== Lecture : la ville d'une guilde =====
create function city_view(p_guild bigint) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', g.id, 'name', g.name, 'tag', g.tag, 'owner', g.owner, 'treasury', g.treasury,
    'fund', g.fund_units * coalesce(aur_index(), 0), 'cap', 30 + 5 * coalesce((select level from city_buildings where guild_id = g.id and building = 'mairie'), 0),
    'upkeep', (select coalesce(sum(spent), 0) * .01 from city_buildings where guild_id = g.id),
    'buildings', coalesce((select jsonb_agg(jsonb_build_object('id', b.building, 'level', b.level, 'asleep', b.asleep)) from city_buildings b where b.guild_id = g.id), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'home', home_level(p.id)) order by m.joined_at)
                         from guild_members m join profiles p on p.id = m.user_id where m.guild_id = g.id), '[]'),
    'donors', coalesce((select jsonb_agg(x order by x->>'total' desc) from (
                select jsonb_build_object('pseudo', p.pseudo, 'total', sum(c.amount)) as x from city_gifts c join profiles p on p.id = c.user_id
                where c.guild_id = g.id and c.kind <> 'dividende' group by p.pseudo order by sum(c.amount) desc limit 10) d), '[]'))
  from guilds g where g.id = p_guild
$$;

-- ===== Effets des bâtiments =====
-- Salle des marchés : frais réduits (ouverture et clôture). Les frais d'ouverture sont gardés pour le calcul des gains.
alter table bets add column fee_open float8;
create or replace function bet_gain(b bets) returns float8 language sql immutable as $$
  select coalesce(b.payout, 0) - b.stake - case when b.kind in ('crypto', 'aurelys') then coalesce(b.fee_open, crypto_fee(b.stake, b.lev)) else 0 end
$$;
create function aur_fee(p_user uuid, p_notional float8) returns float8 language sql stable set search_path = public as $$
  select p_notional * 0.001 * (1 - 0.1 * city_level(p_user, 'salle'))
$$;

create or replace function aur_open(p_user uuid, p_tk text, p_dir text, p_lev int, p_stake float8, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets; k aur_ticks; s aur_stocks; fee float8; px float8; expo float8;
begin
  select * into s from aur_stocks where tk = p_tk;
  if not found then raise exception 'Action inconnue.'; end if;
  if p_dir not in ('up', 'down') or p_lev not in (1, 5, 10) or not (p_stake > 0) then raise exception 'Ordre invalide.'; end if;
  if p_lev = 10 and aur_xp(p_user) < 30 then raise exception 'Le levier ×10 se débloque après 30 positions clôturées sur Aurelys.'; end if;
  k := aur_last(p_tk);
  if k.t is null or k.t < now() - interval '30 seconds' then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  if k.halt then raise exception 'Cotation suspendue sur cette action.'; end if;
  select coalesce(sum(stake * lev), 0) into expo from bets where user_id = p_user and kind = 'aurelys' and aur = p_tk and status = 'open';
  if expo + p_stake * p_lev > 20 * s.liq then
    raise exception 'Plafond atteint : au plus % W engagés sur cette action (mise × levier).', to_char(20 * s.liq, 'FM999G999G999');
  end if;
  px := k.p * (1 + (case when p_dir = 'up' then 1 else -1 end) * least(greatest(coalesce(p_slip, 0), 0), 0.2));
  fee := aur_fee(p_user, p_stake * p_lev);
  update profiles set cash = cash - p_stake - fee where id = p_user and cash >= p_stake + fee;
  if not found then raise exception 'Solde insuffisant (mise + frais).'; end if;
  select * into g from game_now();
  insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, fees, fee_open)
  values (p_user, g.k, g.d, 'aurelys', p_stake, p_tk, p_dir, p_lev, px, fee, fee) returning * into b;
  insert into aur_orders (tk, q) values (p_tk, (case when p_dir = 'up' then 1 else -1 end) * p_stake * p_lev);
  return b;
end $$;

create or replace function aur_close(p_user uuid, p_id bigint, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare b bets; k aur_ticks; fee float8; pay float8; px float8;
begin
  perform aur_liquidate(p_id);
  select * into b from bets where id = p_id and user_id = p_user and kind = 'aurelys' for update;
  if not found then raise exception 'Position introuvable.'; end if;
  if b.status <> 'open' then return b; end if;
  k := aur_last(b.aur);
  if k.t is null or k.t < now() - interval '30 seconds' then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  if k.halt then raise exception 'Cotation suspendue : clôture possible à la reprise.'; end if;
  px := k.p * (1 - (case when b.dir = 'up' then 1 else -1 end) * least(greatest(coalesce(p_slip, 0), 0), 0.2));
  fee := aur_fee(p_user, b.stake * b.lev);
  pay := greatest(0, trade_value(b, px) - fee);
  update bets set status = case when pay > b.stake + b.fees then 'won' else 'lost' end,
                  payout = pay, exit = px, exit_at = now(), closed_at = now(), fees = b.fees + fee,
                  reg = (select x->>'reg' from aur_ticks where tk = 'AUR12' and x is not null and t <= now() order by t desc limit 1)
   where id = b.id returning * into b;
  update profiles set cash = cash + pay where id = b.user_id;
  insert into aur_orders (tk, q) values (b.aur, (case when b.dir = 'up' then -1 else 1 end) * b.stake * b.lev);
  return b;
end $$;

-- Banque : après l'assurance du QG (si elle n'a pas joué), une liquidation par jour remboursée en partie.
create or replace function bets_bonus() returns trigger language plpgsql set search_path = public as $$
declare lv int;
begin
  if tg_op = 'INSERT' then
    if new.kind = 'duel' and consume_bonus(new.user_id, 'boost_duel') then new.odds := round(new.odds * 1.2, 2); end if;
    if new.kind = 'question' then
      lv := city_level(new.user_id, 'observatoire');
      if lv > 0 then new.odds := round(new.odds * (1 + .02 * lv), 2); end if;
    end if;
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

-- Agence de presse : les membres lisent les actualités en avance.
drop policy "nouvelles publiées" on aur_news;
create function news_lead() returns interval language sql stable security definer set search_path = public as $$
  select make_interval(secs => 25 * city_level(auth.uid(), 'presse'))
$$;
create policy "nouvelles publiées" on aur_news for select using (t <= now() + news_lead());

-- L'entretien et les dividendes passent une fois par jour, au premier règlement après minuit.
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
  delete from aur_ticks where t < now() - interval '2 hours';
  delete from aur_candles where t < now() - interval '10 days';
  delete from aur_news where t < now() - interval '10 days';
  delete from aur_orders where taken and t < now() - interval '1 hour';
  return n;
end $$;

revoke execute on function city_daily(), city_level(uuid, text), aur_fee(uuid, float8) from public, anon, authenticated;
revoke execute on function city_give(float8, text), city_build(text), city_view(bigint) from public, anon;
grant execute on function city_give(float8, text), city_build(text), city_view(bigint) to authenticated;

-- ===== Un cours par seconde =====
-- La simulation reste à la minute d'Aurelys (5 s) ; entre deux minutes, 4 cours intermédiaires (pont brownien) sont de vrais cours.
-- Premier chargement : 5 minutes réelles (14 cours par seconde). L'état du marché (x) n'est publié qu'en fin de minute.
create or replace function aur_feed(p_since timestamptz default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', extract(epoch from now()),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(extract(epoch from k.t)::bigint, k.tk, k.p, k.v, k.halt) order by k.t, k.tk)
                      from aur_ticks k where k.t > greatest(coalesce(p_since, '-infinity'), now() - interval '5 minutes') and k.t <= now()), '[]'),
    'x', (select k.x from aur_ticks k where k.tk = 'AUR12' and k.x is not null and k.t <= now() order by k.t desc limit 1))
$$;
