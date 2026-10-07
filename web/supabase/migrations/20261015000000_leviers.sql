-- ===== Leviers : ×1, ×5, ×10, ×15 pour tous ; ×20 avec un logement ; ×25 dans une guilde qui a une salle des marchés =====
-- (choix de Victor). La condition des 30 positions pour le ×10 disparaît. Aurelys seulement.
alter table bets drop constraint bets_lev_check;
alter table bets add constraint bets_lev_check check (lev in (1, 5, 10, 15, 20, 25));

create function aur_max_lev(p_user uuid) returns int language sql stable security definer set search_path = public as $$
  select case when city_level(p_user, 'salle') > 0 then 25 when home_level(p_user) >= 1 then 20 else 15 end
$$;
create function my_max_lev() returns int language sql stable security definer set search_path = public as $$ select aur_max_lev(auth.uid()) $$;
revoke execute on function aur_max_lev(uuid) from public, anon, authenticated;
revoke execute on function my_max_lev() from public, anon;
grant execute on function my_max_lev() to authenticated;

create or replace function aur_open(p_user uuid, p_tk text, p_dir text, p_lev int, p_stake float8, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets; k aur_ticks; s aur_stocks; fee float8; px float8; expo float8;
begin
  select * into s from aur_stocks where tk = p_tk;
  if not found then raise exception 'Action inconnue.'; end if;
  if p_dir not in ('up', 'down') or p_lev not in (1, 5, 10, 15, 20, 25) or not (p_stake > 0) then raise exception 'Ordre invalide.'; end if;
  if p_lev > aur_max_lev(p_user) then
    raise exception '%', case when p_lev = 20 then 'Le levier ×20 se débloque avec un logement (studio ou plus, dans le QG).'
                             else 'Le levier ×25 se débloque dans une guilde qui a une salle des marchés en service.' end;
  end if;
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

-- Le jeu s'appelle désormais Aurelys : le néon du QG suit.
update shop_items set name = 'Néon Aurelys', description = 'L''enseigne lumineuse Aurelys au mur.' where id = 'neon';
