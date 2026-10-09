-- Avantages du logement (choix de Victor, 9 octobre 2026) :
-- 1. Nombre de positions Aurelys ouvertes en même temps : 3 avec la chambre, puis 5, 8, 12, 20, 25, 30, 40, 50 (île privée).
-- 2. Ordres automatiques. Dès le loft : stop (limiter la perte) et objectif (encaisser le gain) sur une position.
--    Au penthouse : ordre à déclenchement, qui ouvre une position quand le cours atteint un seuil.
-- Un ordre automatique part au cours du marché dès que le seuil est touché (au plus 10 s après, au pas suivant de la
-- fonction aurelys, qui calcule l'impact comme pour un ordre à la main) : le prix obtenu peut différer du seuil.

create function aur_max_pos(p_user uuid) returns int language sql stable set search_path = public as $$
  select (array[3, 5, 8, 12, 20, 25, 30, 40, 50])[least(home_level(p_user), 8) + 1]
$$;

create or replace function aur_open(p_user uuid, p_tk text, p_dir text, p_lev int, p_stake float8, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets; k aur_ticks; s aur_stocks; fee float8; px float8; expo float8; mx int;
begin
  select * into s from aur_stocks where tk = p_tk;
  if not found then raise exception 'Action inconnue.'; end if;
  if p_dir not in ('up', 'down') or p_lev not in (1, 5, 10, 15, 20, 25) or not (p_stake > 0) then raise exception 'Ordre invalide.'; end if;
  if p_lev > aur_max_lev(p_user) then
    raise exception '%', case when p_lev = 20 then 'Le levier ×20 se débloque avec un logement (studio ou plus, dans le QG).'
                             else 'Le levier ×25 se débloque dans une guilde qui a une salle des marchés en service.' end;
  end if;
  mx := aur_max_pos(p_user);
  if (select count(*) from bets where user_id = p_user and kind = 'aurelys' and status = 'open') >= mx then
    raise exception 'Au plus % positions ouvertes en même temps : un logement plus grand en permet davantage (QG).', mx;
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

-- ===== Stop et objectif (loft) =====
alter table bets add column sl float8, add column tp float8, add column auto_at timestamptz;

create function aur_set_auto(p_id bigint, p_sl float8, p_tp float8) returns bets
language plpgsql security definer set search_path = public as $$
declare b bets; k aur_ticks; sg int; lq float8;
begin
  if home_level(auth.uid()) < 3 then raise exception 'Le stop et l''objectif se débloquent avec le loft (QG).'; end if;
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
grant execute on function aur_set_auto(bigint, float8, float8) to authenticated;

-- ===== Ordres à déclenchement (penthouse) =====
create table aur_triggers (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles on delete cascade,
  tk text not null, dir text not null check (dir in ('up', 'down')), lev int not null, stake float8 not null check (stake > 0),
  px float8 not null check (px > 0), above boolean not null, -- déclenché quand le cours monte jusqu'à px (above) ou descend jusqu'à px
  status text not null default 'wait' check (status in ('wait', 'done', 'failed', 'cancelled')),
  msg text, bet_id bigint, created_at timestamptz not null default now(), done_at timestamptz
);
create index on aur_triggers (status) where status = 'wait';
alter table aur_triggers enable row level security;
create policy "mes ordres" on aur_triggers for select using (user_id = auth.uid());

create function aur_trigger_add(p_tk text, p_dir text, p_lev int, p_stake float8, p_px float8) returns aur_triggers
language plpgsql security definer set search_path = public as $$
declare k aur_ticks; r aur_triggers; mx int;
begin
  if home_level(auth.uid()) < 4 then raise exception 'Les ordres à déclenchement se débloquent avec le penthouse (QG).'; end if;
  if not exists (select 1 from aur_stocks where tk = p_tk) then raise exception 'Action inconnue.'; end if;
  if p_dir not in ('up', 'down') or p_lev not in (1, 5, 10, 15, 20, 25) or not (p_stake > 0) or not (p_px > 0) then raise exception 'Ordre invalide.'; end if;
  if p_lev > aur_max_lev(auth.uid()) then raise exception 'Levier non débloqué.'; end if;
  if (select count(*) from aur_triggers where user_id = auth.uid() and status = 'wait') >= 10 then raise exception 'Au plus 10 ordres en attente.'; end if;
  mx := aur_max_pos(auth.uid());
  if (select count(*) from bets where user_id = auth.uid() and kind = 'aurelys' and status = 'open')
     + (select count(*) from aur_triggers where user_id = auth.uid() and status = 'wait') >= mx then
    raise exception 'Au plus % positions ouvertes ou en attente : un logement plus grand en permet davantage (QG).', mx;
  end if;
  k := aur_last(p_tk);
  if k.t is null then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  if abs(p_px / k.p - 1) < 0.001 then raise exception 'Seuil trop proche du cours : ouvre la position directement.'; end if;
  insert into aur_triggers (user_id, tk, dir, lev, stake, px, above)
  values (auth.uid(), p_tk, p_dir, p_lev, p_stake, p_px, p_px > k.p) returning * into r;
  return r;
end $$;

create function aur_trigger_cancel(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update aur_triggers set status = 'cancelled', done_at = now() where id = p_id and user_id = auth.uid() and status = 'wait'
$$;
grant execute on function aur_trigger_add(text, text, int, float8, float8), aur_trigger_cancel(bigint) to authenticated;

-- ===== Exécution, à chaque pas de la fonction aurelys (clé serveur) =====
-- Ordres dont le seuil a été touché par un cours déjà passé.
create function aur_due() returns table (what text, id bigint, tk text, notional float8)
language sql stable security definer set search_path = public as $$
  select 'close', b.id, b.aur, b.stake * b.lev from bets b
   where b.kind = 'aurelys' and b.status = 'open' and (b.sl is not null or b.tp is not null)
     and exists (select 1 from aur_ticks k where k.tk = b.aur and k.t > b.auto_at and k.t <= now()
                   and (case when b.dir = 'up' then k.p <= b.sl or k.p >= b.tp else k.p >= b.sl or k.p <= b.tp end))
  union all
  select 'open', g.id, g.tk, g.stake * g.lev from aur_triggers g
   where g.status = 'wait'
     and exists (select 1 from aur_ticks k where k.tk = g.tk and k.t > g.created_at and k.t <= now()
                   and (case when g.above then k.p >= g.px else k.p <= g.px end))
$$;

-- Un marché indisponible ou suspendu : on réessaie au pas suivant. Toute autre erreur (solde, plafond…) annule l'ordre, avec le motif.
create function aur_auto_exec(p_what text, p_id bigint, p_slip float8) returns void
language plpgsql security definer set search_path = public as $$
declare g aur_triggers; b bets; u uuid;
begin
  if p_what = 'close' then
    select user_id into u from bets where id = p_id and status = 'open';
    if found then perform aur_close(u, p_id, p_slip); end if;
    return;
  end if;
  select * into g from aur_triggers where id = p_id and status = 'wait' for update;
  if not found then return; end if;
  begin
    b := aur_open(g.user_id, g.tk, g.dir, g.lev, g.stake, p_slip);
    update aur_triggers set status = 'done', bet_id = b.id, done_at = now() where id = g.id;
  exception when others then
    if sqlerrm ~ 'indisponible|suspendue' then raise; end if;
    update aur_triggers set status = 'failed', msg = sqlerrm, done_at = now() where id = g.id;
  end;
end $$;
revoke execute on function aur_max_pos(uuid), aur_due(), aur_auto_exec(text, bigint, float8) from public, anon, authenticated;
