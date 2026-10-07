-- ===== Portefeuille d'actions et jeunes pousses d'Aurelys =====
-- 1. Investir hors trade : acheter de vraies actions (sans levier, sans liquidation) et les garder. Le prix vient du serveur
--    (dernier cours + impact de l'ordre), frais de 0,1 %. Dividende versé à chaque nouveau jour d'Aurelys.
-- 2. Jeunes pousses : le moteur annonce de nouvelles entreprises (levée de fonds), les introduit en bourse, et les radie
--    quand elles s'effondrent (faillite : actions perdues, positions soldées au dernier cours).
-- 3. Souscrire à une levée demande 50 000 W de patrimoine, et au plus 20 % du patrimoine par levée.

alter table aur_stocks add column status text not null default 'core' check (status in ('core', 'round', 'listed', 'delisted')),
  add column meta jsonb, add column div float8 not null default 0, add column round_price float8, add column round_ends timestamptz,
  add column ipo_price float8, add column listed_at timestamptz, add column delisted_at timestamptz;
update aur_stocks s set div = d.div from (values ('OMB', .8), ('HLV', 6.2), ('FRC', 3.1), ('BCS', 4.5), ('MRV', 2.4), ('GTR', 2.8), ('LMR', 3.5), ('KST', 1.6)) d(tk, div) where s.tk = d.tk;

alter table bets drop constraint bets_kind_check;
alter table bets add constraint bets_kind_check check (kind in ('trade', 'duel', 'stream', 'question', 'crypto', 'aurelys', 'invest'));

create table aur_holdings (
  user_id uuid references profiles on delete cascade, tk text references aur_stocks, qty float8 not null default 0, cost float8 not null default 0,
  primary key (user_id, tk)
);
alter table aur_holdings enable row level security;
create policy "mon portefeuille" on aur_holdings for select using (user_id = auth.uid());

-- Valeur d'une ligne : dernier cours (prix de la levée tant que l'entreprise n'est pas cotée, 0 si radiée).
create function holding_price(p_tk text) returns float8 language sql stable set search_path = public as $$
  select case s.status when 'round' then s.round_price when 'delisted' then 0 else coalesce((aur_last(p_tk)).p, 0) end
  from aur_stocks s where s.tk = p_tk
$$;
create function holdings_value(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select coalesce(sum(h.qty * holding_price(h.tk)), 0) from aur_holdings h where h.user_id = p_user and h.qty > 0
$$;
create or replace function patrimoine(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select p.cash
       + coalesce((select sum(b.stake) from bets b where b.user_id = p_user and b.status = 'open'), 0)
       + coalesce((select sum(floor(s.price * 0.6)) from inventory i join shop_items s on s.id = i.item_id
                   where i.user_id = p_user and s.kind <> 'bonus' and i.qty > 0), 0)
       + holdings_value(p_user)
  from profiles p where p.id = p_user
$$;
create or replace function bk_value(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select p.cash
       + coalesce((select sum(b.stake) from bets b where b.user_id = p_user and b.status = 'open'), 0)
       + coalesce((select sum(floor(s.price * 0.6) * i.qty) from inventory i join shop_items s on s.id = i.item_id
                   where i.user_id = p_user and s.kind <> 'home' and i.qty > 0), 0)
       + holdings_value(p_user)
  from profiles p where p.id = p_user
$$;

-- ===== Acheter et vendre des actions (appelé par la fonction aurelys, qui calcule l'impact p_slip) =====
create function aur_buy(p_user uuid, p_tk text, p_amount float8, p_slip float8) returns aur_holdings
language plpgsql security definer set search_path = public as $$
declare s aur_stocks; k aur_ticks; px float8; fee float8; h aur_holdings;
begin
  select * into s from aur_stocks where tk = p_tk;
  if not found or s.status not in ('core', 'listed') then raise exception 'Cette action n''est pas cotée.'; end if;
  if not (p_amount >= 10) then raise exception 'Achat de 10 W au moins.'; end if;
  if p_amount > 20 * s.liq then raise exception 'Ordre trop gros : au plus % W par ordre sur cette action.', to_char(20 * s.liq, 'FM999G999G999'); end if;
  k := aur_last(p_tk);
  if k.t is null or k.t < now() - interval '30 seconds' then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  if k.halt then raise exception 'Cotation suspendue sur cette action.'; end if;
  px := k.p * (1 + least(greatest(coalesce(p_slip, 0), 0), 0.2));
  fee := aur_fee(p_user, p_amount);
  update profiles set cash = cash - p_amount - fee where id = p_user and cash >= p_amount + fee;
  if not found then raise exception 'Solde insuffisant (montant + frais).'; end if;
  insert into aur_holdings (user_id, tk, qty, cost) values (p_user, p_tk, p_amount / px, p_amount + fee)
  on conflict (user_id, tk) do update set qty = aur_holdings.qty + excluded.qty, cost = aur_holdings.cost + excluded.cost returning * into h;
  insert into aur_orders (tk, q) values (p_tk, p_amount);
  return h;
end $$;

-- Vente : la plus-value (ou moins-value) entre dans l'historique et le classement des gains, comme un pari réglé.
create function aur_sell(p_user uuid, p_tk text, p_qty float8, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare h aur_holdings; k aur_ticks; px float8; fee float8; val float8; basis float8; g record; b bets;
begin
  select * into h from aur_holdings where user_id = p_user and tk = p_tk for update;
  if not found or h.qty <= 0 then raise exception 'Tu n''as pas cette action.'; end if;
  if not (p_qty > 0) or p_qty > h.qty * 1.000001 then raise exception 'Quantité invalide.'; end if;
  p_qty := least(p_qty, h.qty);
  k := aur_last(p_tk);
  if k.t is null or k.t < now() - interval '30 seconds' then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  if k.halt then raise exception 'Cotation suspendue : vente possible à la reprise.'; end if;
  px := k.p * (1 - least(greatest(coalesce(p_slip, 0), 0), 0.2));
  val := p_qty * px; fee := aur_fee(p_user, val); basis := h.cost * p_qty / h.qty;
  update aur_holdings set qty = qty - p_qty, cost = cost - basis where user_id = p_user and tk = p_tk;
  update profiles set cash = cash + val - fee where id = p_user;
  insert into aur_orders (tk, q) values (p_tk, -val);
  select * into g from game_now();
  insert into bets (user_id, session, day, kind, stake, aur, status, payout, entry, exit, fees, fee_open, created_at, closed_at, exit_at)
  values (p_user, g.k, g.d, 'invest', basis, p_tk, case when val - fee > basis then 'won' else 'lost' end, val - fee,
          h.cost / h.qty, px, fee, 0, now(), now(), now()) returning * into b;
  return b;
end $$;

-- ===== Levées de fonds =====
create function aur_subscribe(p_tk text, p_amount float8) returns aur_holdings
language plpgsql security definer set search_path = public as $$
declare s aur_stocks; pat float8; mine float8; h aur_holdings;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  select * into s from aur_stocks where tk = p_tk;
  if not found or s.status <> 'round' or s.round_ends <= now() then raise exception 'Cette levée de fonds est close.'; end if;
  pat := patrimoine(auth.uid());
  if pat < 50000 then raise exception 'Les levées de fonds sont réservées aux joueurs qui ont 50 000 W de patrimoine.'; end if;
  select coalesce(sum(cost), 0) into mine from aur_holdings where user_id = auth.uid() and tk = p_tk;
  if mine + p_amount > .2 * pat then raise exception 'Au plus 20 %% de ton patrimoine par levée : encore % W possibles.', to_char(greatest(0, .2 * pat - mine), 'FM999G999G999'); end if;
  if not (p_amount >= 100) then raise exception 'Souscription de 100 W au moins.'; end if;
  update profiles set cash = cash - p_amount where id = auth.uid() and cash >= p_amount;
  if not found then raise exception 'Solde insuffisant.'; end if;
  insert into aur_holdings (user_id, tk, qty, cost) values (auth.uid(), p_tk, p_amount / s.round_price, p_amount)
  on conflict (user_id, tk) do update set qty = aur_holdings.qty + excluded.qty, cost = aur_holdings.cost + excluded.cost returning * into h;
  return h;
end $$;

-- ===== Annonces, introductions et radiations (écrites par la fonction aurelys après chaque pas) =====
create function aur_listing(p_defs jsonb) returns int language plpgsql security definer set search_path = public as $$
declare d jsonb; n int := 0; r record; px float8; g record;
begin
  for d in select * from jsonb_array_elements(p_defs) loop
    insert into aur_stocks (tk, name, sector, liq, status, meta, round_price, round_ends, ipo_price, listed_at)
    values (d->>'tk', d->>'name', d->>'sector', (d->>'L')::float8, d->>'status', d, (d->>'roundPrice')::float8, to_timestamp((d->>'roundEnd')::float8),
            (d->>'ipoPrice')::float8, case when d->>'status' = 'listed' then to_timestamp((d->>'ipoAt')::float8) end)
    on conflict (tk) do update set status = excluded.status, meta = excluded.meta, ipo_price = coalesce(excluded.ipo_price, aur_stocks.ipo_price),
      listed_at = coalesce(excluded.listed_at, aur_stocks.listed_at),
      delisted_at = case when excluded.status = 'delisted' then now() else aur_stocks.delisted_at end;
    if d->>'status' = 'delisted' then
      px := (d->>'lastPrice')::float8;
      -- Positions à effet de levier : soldées au dernier cours.
      for r in select * from bets where kind = 'aurelys' and aur = d->>'tk' and status = 'open' loop
        update bets set status = 'lost', payout = greatest(0, trade_value(r, px)), exit = px, exit_at = now(), closed_at = now() where id = r.id;
        update profiles set cash = cash + greatest(0, trade_value(r, px)) where id = r.user_id;
      end loop;
      -- Actions détenues : perdues, inscrites dans l'historique.
      select * into g from game_now();
      insert into bets (user_id, session, day, kind, stake, aur, status, payout, entry, exit, fees, fee_open, closed_at, exit_at)
      select user_id, g.k, g.d, 'invest', cost, tk, 'lost', 0, cost / qty, 0, 0, 0, now(), now() from aur_holdings where tk = d->>'tk' and qty > 0;
      update aur_holdings set qty = 0, cost = 0 where tk = d->>'tk';
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===== Dividendes : à chaque nouveau jour d'Aurelys, rendement annuel ÷ 365 sur la valeur détenue =====
create table aur_div_day (id int primary key default 1 check (id = 1), day int not null);
alter table aur_div_day enable row level security;
create function aur_dividends() returns int language plpgsql security definer set search_path = public as $$
declare today int := floor((extract(epoch from now()) - 1790812800) / 7200)::int; last int; n int := 0; r record; pay float8;
begin
  select day into last from aur_div_day for update;
  if last is null then insert into aur_div_day values (1, today); return 0; end if;
  if last >= today then return 0; end if;
  update aur_div_day set day = today;
  for r in select h.user_id, h.tk, h.qty, s.div from aur_holdings h join aur_stocks s on s.tk = h.tk where h.qty > 0 and s.div > 0 and s.status = 'core' loop
    pay := r.qty * coalesce((aur_last(r.tk)).p, 0) * r.div / 100 / 365;
    if pay > 0 then update profiles set cash = cash + pay where id = r.user_id; n := n + 1; end if;
  end loop;
  return n;
end $$;

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
  delete from aur_ticks where t < now() - interval '2 hours';
  delete from aur_candles where t < now() - interval '10 days';
  delete from aur_news where t < now() - interval '10 days';
  delete from aur_orders where taken and t < now() - interval '1 hour';
  return n;
end $$;

-- Mon portefeuille, avec le cours actuel.
create function my_holdings() returns table (tk text, qty float8, cost float8, price float8, status text)
language sql stable security definer set search_path = public as $$
  select h.tk, h.qty, h.cost, holding_price(h.tk), s.status from aur_holdings h join aur_stocks s on s.tk = h.tk
  where h.user_id = auth.uid() and h.qty > 0 order by h.cost desc
$$;

revoke execute on function aur_buy(uuid, text, float8, float8), aur_sell(uuid, text, float8, float8), aur_listing(jsonb), aur_dividends(),
  holding_price(text), holdings_value(uuid) from public, anon, authenticated;
revoke execute on function aur_subscribe(text, float8), my_holdings() from public, anon;
grant execute on function aur_subscribe(text, float8), my_holdings() to authenticated;
