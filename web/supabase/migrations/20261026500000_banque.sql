-- Banque (demande de Victor, octobre 2026) : déposer des W et toucher un intérêt à chaque nouveau jour d'Aurelys (1 h réelle).
-- 0,1 % par jour d'Aurelys, sur 100 000 W de dépôt au plus (100 W par jour d'Aurelys, 2 400 W par jour réel au plus).
-- Le dépôt compte dans le patrimoine et le seuil de faillite. Dépôt et retrait sans frais.
alter table profiles add column bank float8 not null default 0 check (bank >= 0);

create function bank_move(p_amount float8) returns profiles
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if p_amount is null or p_amount = 0 or p_amount = 'NaN' then raise exception 'Montant invalide.'; end if;
  select * into p from profiles where id = auth.uid() for update;
  if not found then raise exception 'Connexion requise.'; end if;
  if p_amount > 0 and p_amount > p.cash then raise exception 'Solde insuffisant.'; end if;
  if p_amount < 0 and -p_amount > p.bank then raise exception 'Dépôt insuffisant.'; end if;
  update profiles set cash = cash - p_amount, bank = bank + p_amount where id = p.id returning * into p;
  return p;
end $$;
revoke execute on function bank_move(float8) from public, anon;
grant execute on function bank_move(float8) to authenticated;

create or replace function patrimoine(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select p.cash + p.bank + open_value(p_user)
       + coalesce((select sum(floor(s.price * 0.6)) from inventory i join shop_items s on s.id = i.item_id
                   where i.user_id = p_user and s.kind <> 'bonus' and i.qty > 0), 0)
       + holdings_value(p_user)
  from profiles p where p.id = p_user
$$;
create or replace function bk_value(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select p.cash + p.bank + open_value(p_user)
       + coalesce((select sum(floor(s.price * 0.6) * i.qty) from inventory i join shop_items s on s.id = i.item_id
                   where i.user_id = p_user and s.kind <> 'home' and i.qty > 0), 0)
       + holdings_value(p_user)
  from profiles p where p.id = p_user
$$;

-- Intérêts versés avec les dividendes, au premier passage d'un nouveau jour d'Aurelys.
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
  update profiles set bank = bank + round((least(bank, 100000) * 0.001)::numeric, 2) where bank > 0;
  return n;
end $$;

-- Objectif (take profit) ouvert à tous ; le stop reste un avantage du loft.
create or replace function aur_set_auto(p_id bigint, p_sl float8, p_tp float8) returns bets
language plpgsql security definer set search_path = public as $$
declare b bets; k aur_ticks; sg int; lq float8;
begin
  if p_sl is not null and home_level(auth.uid()) < 3 then raise exception 'Le stop se débloque avec le loft (QG).'; end if;
  select * into b from bets where id = p_id and user_id = auth.uid() and kind = 'aurelys' and status = 'open' for update;
  if not found then raise exception 'Position introuvable ou déjà clôturée.'; end if;
  k := aur_last(b.aur); sg := case when b.dir = 'up' then 1 else -1 end;
  lq := b.entry * (1 - sg::float8 / b.lev);
  if p_sl is not null and not (sg * (k.p - p_sl) > 0 and sg * (p_sl - lq) > 0) then
    raise exception 'Stop invalide : il doit être % du cours actuel et % du seuil de liquidation (%).',
      case when sg = 1 then 'sous' else 'au-dessus' end, case when sg = 1 then 'au-dessus' else 'sous' end, to_char(lq, 'FM999G990D00');
  end if;
  if p_tp is not null and not (sg * (p_tp - k.p) > 0) then
    raise exception 'Objectif invalide : il doit être % du cours actuel.', case when sg = 1 then 'au-dessus' else 'sous' end;
  end if;
  update bets set sl = p_sl, tp = p_tp, auto_at = now() where id = b.id returning * into b;
  return b;
end $$;
