-- Patrimoine et seuil de faillite : une position Aurelys ouverte compte pour sa valeur actuelle (dernier cours, frais de
-- clôture déduits), et non plus pour sa mise (revue d'octobre 2026 : un patrimoine gonflé de 15 000 W faussait le
-- classement, le seuil des levées de fonds et la faillite). Les autres paris (anciens modes) gardent leur mise.
create function open_value(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select coalesce(sum(case when b.kind = 'aurelys'
                           then greatest(0, trade_value(b, coalesce((aur_last(b.aur)).p, b.entry)) - b.stake * b.lev * 0.001)
                           else b.stake end), 0)
  from bets b where b.user_id = p_user and b.status = 'open'
$$;

create or replace function patrimoine(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select p.cash + open_value(p_user)
       + coalesce((select sum(floor(s.price * 0.6)) from inventory i join shop_items s on s.id = i.item_id
                   where i.user_id = p_user and s.kind <> 'bonus' and i.qty > 0), 0)
       + holdings_value(p_user)
  from profiles p where p.id = p_user
$$;
create or replace function bk_value(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select p.cash + open_value(p_user)
       + coalesce((select sum(floor(s.price * 0.6) * i.qty) from inventory i join shop_items s on s.id = i.item_id
                   where i.user_id = p_user and s.kind <> 'home' and i.qty > 0), 0)
       + holdings_value(p_user)
  from profiles p where p.id = p_user
$$;
