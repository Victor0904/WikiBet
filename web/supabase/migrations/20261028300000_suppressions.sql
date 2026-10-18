-- H1 de la refonte « progression » (décisions de Victor, 18 octobre 2026) : le QG (boutique, logements, déco, cosmétiques,
-- bonus), la banque, l'arbre de talents et la ville de guilde (Trésor, fonds, bâtiments, parcelles) disparaissent.
-- Ce qui est rendu, en espèces, journalisé dans h1_refunds (jamais un gain de trading : aucune ligne dans bets) :
--   banque : tout le dépôt ; logements et déco : 60 % (valeur déjà comptée au patrimoine, qui ne bouge donc pas) ;
--   bonus non utilisés : 100 % ; Trésor + fonds d'une guilde : aux donateurs au prorata de leurs dons (sans don enregistré :
--   aux membres actuels, à parts égales).
-- Ce qui est détruit, journalisé aussi : tout objet ou part de Trésor d'un bot (aucune espèce de bot n'est touchée),
-- les cosmétiques (personne n'en a ; H2 crée la table des déblocages et pourra relire h1_refunds).
-- Contrôle : W avant (espèces + banque + Trésors et fonds + objets au patrimoine, bonus au prix) − détruit = espèces après,
-- à 1 W près, sinon la migration s'annule.
-- Après : frais, impact, plafond et liquidation d'un joueur sans talent ; ×15 au plus ; 12 positions ; stop pour tous ;
-- ordres à déclenchement gardés par ceux qui avaient le penthouse (trig_ok) jusqu'aux niveaux de trader (H3) ;
-- niveau de départ lvl_floor = ancien niveau de talent + 1 (10 au plus), converti en XP en H3 ; parrainages en attente
-- jusqu'au niveau 3 (trader_level). Succès retirés : PROPRIO, BANQUIER, SPECIALISTE, POLYVALENT (0 point chacun).
-- Retour arrière : restaurer la sauvegarde avant-h1.dump (C:\Users\rescue123\Claude\sauvegardes\aurelys-20261018).

-- ===== 1. Journal, niveau de départ, ordres à déclenchement gardés =====
create table h1_refunds (
  id bigint generated always as identity primary key,
  user_id uuid references profiles on delete cascade, guild_id bigint references guilds on delete set null,
  kind text not null check (kind in ('banque', 'logement', 'deco', 'bonus', 'tresor', 'cosmetique', 'detruit')),
  item text, amount float8 not null, at timestamptz not null default now()
);
alter table h1_refunds enable row level security; -- lu par my_refunds()

alter table profiles add column lvl_floor int not null default 1, add column trig_ok boolean not null default false;
update profiles set lvl_floor = least(10, talent_level(tal_hwm) + 1), trig_ok = home_level(id) >= 4 where not bot;

-- Niveau de trader : l'XP arrive en H3 ; d'ici là, le niveau de départ.
create function trader_level(p_user uuid) returns int language sql stable set search_path = public as $$
  select coalesce((select lvl_floor from profiles where id = p_user), 1)
$$;

-- 20261027500000_reglages.sql : plus de banque (BANQUIER retiré).
create or replace function ach_profile() returns trigger language plpgsql set search_path = public as $$
begin
  if new.bankruptcies > old.bankruptcies then new.renais_target := null; end if;
  return new;
end $$;

-- ===== 2. Remboursements =====
do $$
declare before float8; after float8; gone float8; g record; tot float8; n int; r record;
begin
  select (select coalesce(sum(cash + bank), 0) from profiles)
       + (select coalesce(sum(treasury + fund_units * coalesce(aur_index(), 0)), 0) from guilds)
       + (select coalesce(sum(case when s.kind = 'bonus' then s.price else floor(s.price * .6) end * i.qty), 0)
            from inventory i join shop_items s on s.id = i.item_id where i.qty > 0)
    into before;

  insert into h1_refunds (user_id, kind, amount) select id, 'banque', bank from profiles where bank > 0;
  insert into h1_refunds (user_id, kind, item, amount)
  select i.user_id, case when p.bot then 'detruit' when s.kind = 'home' then 'logement' when s.kind = 'decor' then 'deco'
                         when s.kind = 'bonus' then 'bonus' else 'cosmetique' end,
         s.id, case when s.kind = 'bonus' then s.price else floor(s.price * .6) end * i.qty
    from inventory i join shop_items s on s.id = i.item_id join profiles p on p.id = i.user_id where i.qty > 0;

  for g in select id, treasury + fund_units * coalesce(aur_index(), 0) as tot from guilds where treasury > 0 or fund_units > 0 loop
    if exists (select 1 from city_gifts where guild_id = g.id and kind in ('tresor', 'fonds') and amount > 0) then
      insert into h1_refunds (user_id, guild_id, kind, amount)
      select c.user_id, g.id, case when p.bot then 'detruit' else 'tresor' end, g.tot * sum(c.amount) / sum(sum(c.amount)) over ()
        from city_gifts c join profiles p on p.id = c.user_id
       where c.guild_id = g.id and c.kind in ('tresor', 'fonds') and c.amount > 0 group by c.user_id, p.bot;
    else
      select count(*) into n from guild_members m join profiles p on p.id = m.user_id where m.guild_id = g.id and not p.bot;
      if n = 0 then
        insert into h1_refunds (guild_id, kind, amount) values (g.id, 'detruit', g.tot);
      else
        insert into h1_refunds (user_id, guild_id, kind, amount)
        select m.user_id, g.id, 'tresor', g.tot / n from guild_members m join profiles p on p.id = m.user_id where m.guild_id = g.id and not p.bot;
      end if;
    end if;
  end loop;

  update profiles p set cash = p.cash + x.s
    from (select user_id, sum(amount) s from h1_refunds where kind in ('banque', 'logement', 'deco', 'bonus', 'tresor') group by 1) x
   where p.id = x.user_id;
  update profiles set bank = 0 where bank > 0;

  select coalesce(sum(cash), 0) into after from profiles;
  select coalesce(sum(amount), 0) into gone from h1_refunds where kind in ('detruit', 'cosmetique');
  if abs(before - gone - after) >= 1 then
    raise exception 'H1 : conservation des W rompue (avant %, détruit %, après %)', before, gone, after;
  end if;

  -- Message à chaque joueur : ce qui disparaît, ce qu'il reçoit, son niveau de départ.
  insert into notices (user_id, kind, body)
  select p.id, 'h1', jsonb_build_object('w', coalesce(x.w, 0), 'bank', coalesce(x.b, 0), 'level', p.lvl_floor)
    from profiles p left join (select user_id, sum(amount) filter (where kind <> 'banque') w, sum(amount) filter (where kind = 'banque') b
                                 from h1_refunds where kind in ('banque', 'logement', 'deco', 'bonus', 'tresor') group by 1) x on x.user_id = p.id
   where not p.bot;
end $$;

-- Lignes « Remboursement QG » et « Banque fermée » de l'historique (hors classements de gains).
create function my_refunds() returns table (kind text, amount float8, at timestamptz) language sql stable security definer set search_path = public as $$
  select case when kind = 'banque' then 'banque' else 'qg' end, sum(amount), min(at) from h1_refunds
   where user_id = auth.uid() and kind in ('banque', 'logement', 'deco', 'bonus', 'tresor') and amount > 0
   group by 1 order by 1
$$;
revoke execute on function my_refunds() from public, anon;
grant execute on function my_refunds() to authenticated;
revoke execute on function trader_level(uuid) from public, anon, authenticated;

-- ===== 3. Règles d'un joueur sans talent, sans logement, sans ville =====
drop trigger bets_bonus on bets;
drop trigger salary_bonus on salaries;
drop trigger salary_talent on salaries;

create or replace function aur_fee_rate(p_user uuid) returns float8 language sql stable set search_path = public as $$ select 0.001::float8 $$;
create or replace function aur_max_pos(p_user uuid) returns int language sql stable set search_path = public as $$ select 12 $$;
create or replace function aur_max_lev(p_user uuid) returns int language sql stable security definer set search_path = public as $$ select 15 $$;
-- Conditions de l'ordre pour l'écran (mêmes champs qu'avant pour les onglets restés ouverts).
create or replace function my_terms() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('fee', aur_fee_rate(p.id), 'cut', 1, 'kraken', false, 'max_pos', aur_max_pos(p.id), 'max_lev', aur_max_lev(p.id),
                            'stop', true, 'triggers', p.trig_ok)
  from profiles p where p.id = auth.uid()
$$;

create or replace function bets_reg_open() returns trigger language plpgsql set search_path = public as $$
begin
  new.reg_open := (select x->>'reg' from aur_ticks where tk = 'AUR12' and x is not null and t <= now() order by t desc limit 1);
  return new;
end $$;

create or replace function aur_open(p_user uuid, p_tk text, p_dir text, p_lev int, p_stake float8, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets; k aur_ticks; s aur_stocks; fee float8; px float8; expo float8; mx int;
begin
  select * into s from aur_stocks where tk = p_tk;
  if not found then raise exception 'Action inconnue.'; end if;
  if p_dir not in ('up', 'down') or p_lev not in (1, 5, 10, 15, 20, 25) or not (p_stake > 0) then raise exception 'Ordre invalide.'; end if;
  if p_lev > aur_max_lev(p_user) then raise exception 'Levier ×% indisponible : ×% au plus pour l''instant.', p_lev, aur_max_lev(p_user); end if;
  mx := aur_max_pos(p_user);
  if (select count(*) from bets where user_id = p_user and kind = 'aurelys' and status = 'open') >= mx then
    raise exception 'Au plus % positions ouvertes en même temps.', mx;
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

create or replace function aur_close_px(p_user uuid, p_id bigint, p_slip float8, p_px float8) returns bets
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
  px := coalesce(p_px, k.p) * (1 - (case when b.dir = 'up' then 1 else -1 end) * least(greatest(coalesce(p_slip, 0), 0), 0.2));
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

create or replace function aur_buy(p_user uuid, p_tk text, p_amount float8, p_slip float8) returns aur_holdings
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

create or replace function aur_sell(p_user uuid, p_tk text, p_qty float8, p_slip float8) returns bets
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

create or replace function aur_auto_exec(p_what text, p_id bigint, p_slip float8) returns void
language plpgsql security definer set search_path = public as $$
declare g aur_triggers; b bets; why text;
begin
  if p_what = 'close' then
    select * into b from bets where id = p_id and status = 'open';
    if not found then return; end if;
    select case when (b.dir = 'up' and k.p <= b.sl) or (b.dir = 'down' and k.p >= b.sl) then 'stop' else 'objectif' end into why
      from aur_ticks k where k.tk = b.aur and k.t > b.auto_at and k.t <= now()
       and (case when b.dir = 'up' then k.p <= b.sl or k.p >= b.tp else k.p >= b.sl or k.p <= b.tp end)
     order by k.t limit 1;
    perform aur_close_px(b.user_id, p_id, p_slip, null);
    update bets set closed_by = why where id = p_id and status <> 'open' and closed_by is null;
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

-- Stop et objectif pour tous.
create or replace function aur_set_auto(p_id bigint, p_sl float8, p_tp float8) returns bets
language plpgsql security definer set search_path = public as $$
declare b bets; k aur_ticks; sg int; lq float8;
begin
  select * into b from bets where id = p_id and user_id = auth.uid() and kind = 'aurelys' and status = 'open' for update;
  if not found then raise exception 'Position introuvable ou déjà clôturée.'; end if;
  k := aur_last(b.aur); sg := case when b.dir = 'up' then 1 else -1 end;
  lq := aur_lq(b);
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

create or replace function aur_trigger_add(p_tk text, p_dir text, p_lev int, p_stake float8, p_px float8) returns aur_triggers
language plpgsql security definer set search_path = public as $$
declare k aur_ticks; r aur_triggers; mx int;
begin
  if not coalesce((select trig_ok from profiles where id = auth.uid()), false) then
    raise exception 'Les ordres à déclenchement se débloqueront avec les niveaux de trader.';
  end if;
  if not exists (select 1 from aur_stocks where tk = p_tk) then raise exception 'Action inconnue.'; end if;
  if p_dir not in ('up', 'down') or p_lev not in (1, 5, 10, 15, 20, 25) or not (p_stake > 0) or not (p_px > 0) then raise exception 'Ordre invalide.'; end if;
  if p_lev > aur_max_lev(auth.uid()) then raise exception 'Levier non débloqué.'; end if;
  if (select count(*) from aur_triggers where user_id = auth.uid() and status = 'wait') >= 10 then raise exception 'Au plus 10 ordres en attente.'; end if;
  mx := aur_max_pos(auth.uid());
  if (select count(*) from bets where user_id = auth.uid() and kind = 'aurelys' and status = 'open')
     + (select count(*) from aur_triggers where user_id = auth.uid() and status = 'wait') >= mx then
    raise exception 'Au plus % positions ouvertes ou en attente.', mx;
  end if;
  k := aur_last(p_tk);
  if k.t is null then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  if abs(p_px / k.p - 1) < 0.001 then raise exception 'Seuil trop proche du cours : ouvre la position directement.'; end if;
  insert into aur_triggers (user_id, tk, dir, lev, stake, px, above)
  values (auth.uid(), p_tk, p_dir, p_lev, p_stake, p_px, p_px > k.p) returning * into r;
  return r;
end $$;

-- Alerte de liquidation à 25 % puis 10 % de la mise, pour tous.
create or replace function push_due() returns table (endpoint text) language sql security definer set search_path = public as $$
  with l as (update bets set push_at = now() where closed_by = 'liq' and push_at is null and closed_at > now() - interval '1 hour' returning user_id),
  v as (select b.id, trade_value(b, (aur_last(b.aur)).p) / b.stake r from bets b
         where b.kind = 'aurelys' and b.status = 'open' and b.warn < 2 and b.user_id in (select user_id from push_subs)),
  w as (update bets b set warn = case when v.r <= .10 then 2 else 1 end, warn_at = now() from v
         where b.id = v.id and (v.r <= .10 or (v.r <= .25 and b.warn < 1)) returning b.user_id)
  select s.endpoint from push_subs s where s.user_id in (select user_id from l union select user_id from w)
$$;
create or replace function push_info(p_endpoint text) returns table (kind text, aur text, dir text, lev int, stake float8, lq float8)
language sql stable security definer set search_path = public as $$
  (select 'liq', b.aur, b.dir, b.lev, b.stake, b.exit from bets b join push_subs s on s.user_id = b.user_id
    where s.endpoint = p_endpoint and b.closed_by = 'liq' and b.push_at > now() - interval '10 minutes'
    order by b.closed_at desc limit 5)
  union all
  (select case when b.warn = 2 then '10' else '25' end, b.aur, b.dir, b.lev, b.stake, aur_lq(b)
     from bets b join push_subs s on s.user_id = b.user_id
    where s.endpoint = p_endpoint and b.status = 'open' and b.warn_at > now() - interval '10 minutes'
    order by b.warn_at desc limit 5)
$$;
revoke execute on function push_due(), push_info(text) from public, anon, authenticated;

-- Actualités à leur heure pour tous (plus d'agence de presse ni d'Avant-première).
create or replace function news_lead() returns interval language sql stable as $$ select interval '0' $$;

create or replace function aur_rumor_list() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (
    select r.*, r.res_t is not null and r.res_t <= now() as done,
           coalesce((select s.status = 'delisted' from aur_stocks s where s.tk = r.tk), false) and r.res_t is null as void,
           case when r.t > now() then null
                else (case when r.res_t <= now() then r.p1 else (aur_last(r.tk)).p end) / nullif(r.p0, 0) - 1 end as chg
    from aur_rumors r where r.t <= now() and r.t > now() - interval '7 days'
  )
  select jsonb_build_object(
    'list', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'tk', tk, 't', extract(epoch from t), 'title', title, 'sent', sent,
              'chg', chg, 'status', case when void then 'void' when not done then 'open' when ok then 'ok' else 'no' end,
              'res_t', case when done then extract(epoch from res_t) end) order by t desc, id desc)
            from (select * from v order by t desc limit 300) x), '[]'),
    'stats', (select jsonb_build_object('n', count(*), 'ok', count(*) filter (where ok),
              'chg', avg(chg * sign(sent)) filter (where chg is not null and res_t <= now())) from v where done))
$$;

-- Les révisions annoncées (pre) ne servaient qu'au talent Initié : on ne les garde plus.
create or replace function aur_store(p_from bigint, p_state jsonb, p_ticks jsonb, p_news jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_from is null then
    insert into aur_state values (1, (p_state->>'t')::bigint, p_state);
  else
    update aur_state set state = p_state, t = (p_state->>'t')::bigint where id = 1 and t = p_from;
    if not found then raise exception 'conflit : la simulation a déjà avancé'; end if;
  end if;
  insert into aur_ticks (tk, t, p, v, halt, x)
  select r.tk, to_timestamp(r.t), r.p, r.v, coalesce(r.halt, false), r.x from jsonb_to_recordset(p_ticks) as r(t bigint, tk text, p float8, v float8, halt boolean, x jsonb)
  on conflict do nothing;
  with r as (
    select x.*, coalesce((select max(id) from aur_news), 0) + row_number() over (order by x.id) as nid
    from jsonb_to_recordset(p_news) as x(id bigint, t bigint, tk text, sector text, cat text, title text, text text, sent float8, fiab float8, rok boolean, pre boolean)
    where x.pre is null
  ), n as (
    insert into aur_news (id, t, tk, sector, cat, title, body, sent, fiab)
    select nid, to_timestamp(t), tk, sector, cat, title, text, sent, fiab from r returning id
  )
  insert into aur_rumors (id, eid, tk, t, title, sent, ok, p0)
  select r.nid, r.id, r.tk, to_timestamp(r.t), r.title, r.sent, r.rok,
         (select k.p from aur_ticks k where k.tk = r.tk and k.t <= to_timestamp(r.t) order by k.t desc limit 1)
  from r where r.rok is not null;
  update aur_rumors a set res_t = to_timestamp(r.t),
         p1 = (select k.p from aur_ticks k where k.tk = a.tk and k.t <= to_timestamp(r.t) order by k.t desc limit 1)
  from jsonb_to_recordset(p_news) as r(t bigint, rid bigint) where r.rid is not null and a.eid = r.rid and a.res_t is null;
  insert into aur_results (tk, t, surp)
  select r.tk, to_timestamp(r.t), coalesce(r.surp, false) from jsonb_to_recordset(p_news) as r(t bigint, tk text, cat text, surp boolean, pre boolean)
  where r.cat = 'resultats' and r.pre is null and r.tk is not null on conflict do nothing;
  with k as (select to_timestamp(r.t) as t, r.x->>'reg' as reg from jsonb_to_recordset(p_ticks) as r(t bigint, tk text, x jsonb) where r.tk = 'AUR12' and r.x ? 'reg'),
  l as (select t, reg, lag(reg) over (order by t) as prev from (select t, reg from k union all (select t, reg from aur_regimes order by t desc limit 1)) z)
  insert into aur_regimes select t, reg from l where prev is distinct from reg and t > coalesce((select max(t) from aur_regimes), '-infinity') on conflict do nothing;
  delete from aur_rumors where t < now() - interval '8 days';
  delete from aur_results where t < now() - interval '10 days';
  delete from aur_regimes where t < now() - interval '10 days' and t < (select max(t) from aur_regimes);
end $$;

-- Faillite : on repart à 10 000 W (plus de logements, plus de Phénix).
create or replace function restart() returns profiles
language plpgsql security definer set search_path = public as $$
declare tot float8; p profiles;
begin
  perform 1 from profiles where id = auth.uid() for update; -- deux faillites simultanées ne paient pas deux fois
  tot := bk_value(auth.uid());
  if tot is null then raise exception 'Connexion requise.'; end if;
  if tot >= 2000 then raise exception 'Tu n''es pas en faillite.'; end if;
  update bets set status = 'lost', payout = 0, closed_at = now() where user_id = auth.uid() and status = 'open';
  update profiles set cash = 10000, bankruptcies = bankruptcies + 1 where id = auth.uid() returning * into p;
  return p;
end $$;

-- Dividendes seulement (plus d'intérêts de banque ni de rente de talent).
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

create or replace function aur_settle() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; w timestamptz; t1 timestamptz := now();
begin
  insert into aur_candles (tk, t, o, h, l, c, v)
  select tk, aur_hour(t), (array_agg(p order by t))[1], max(p), min(p), (array_agg(p order by t desc))[1], sum(v)
    from aur_ticks where t >= aur_hour(now()) - interval '5 minutes' and t <= now()
   group by tk, aur_hour(t)
  on conflict (tk, t) do update set h = greatest(aur_candles.h, excluded.h), l = least(aur_candles.l, excluded.l),
                                    c = excluded.c, v = greatest(aur_candles.v, excluded.v);
  select liq_at - interval '2 minutes' into w from aur_watch;
  for r in select id from bets where kind = 'aurelys' and status = 'open' loop
    if (aur_liquidate(r.id, coalesce(w, '-infinity'))).status = 'lost' then n := n + 1; end if;
  end loop;
  insert into aur_watch values (1, t1) on conflict (id) do update set liq_at = greatest(aur_watch.liq_at, excluded.liq_at);
  perform aur_dividends();
  delete from aur_ticks where ctid in (select ctid from aur_ticks where t < now() - interval '2 hours' limit 20000);
  delete from aur_candles where t < now() - interval '10 days';
  delete from aur_news where t < now() - interval '2 hours' and id < (select max(id) from aur_news);
  delete from aur_orders where taken and t < now() - interval '1 hour';
  return n;
end $$;

-- Patrimoine : espèces, positions à leur valeur actuelle, actions.
create or replace function patrimoine(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select p.cash + open_value(p_user) + holdings_value(p_user) from profiles p where p.id = p_user
$$;
create or replace function bk_value(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select p.cash + open_value(p_user) + holdings_value(p_user) from profiles p where p.id = p_user
$$;

-- Parrainage : validé au niveau 3 de trader (H3), au lieu du premier logement. D'ici là, il reste en attente.
create or replace function referral_check() returns int language plpgsql security definer set search_path = public as $$
declare r referrals; n int := 0; paid int; amt float8;
begin
  for r in select * from referrals where status = 'en_attente' for update skip locked loop
    if (select bot from profiles where id = r.filleul) or (select bot from profiles where id = r.parrain) then continue; end if;
    if trader_level(r.filleul) < 3 then continue; end if;
    if (select count(*) < 5 or count(distinct (closed_at at time zone 'Europe/Paris')::date) < 2
          from bets where user_id = r.filleul and kind = 'aurelys' and status <> 'open' and stake >= 100
           and closed_at - created_at >= interval '150 seconds') then continue; end if;
    perform 1 from profiles where id = r.parrain for update;
    select count(*) into paid from referrals where parrain = r.parrain and paid_parrain > 0;
    amt := case when paid < 4 then 10000 else 0 end;
    update referrals set status = 'validé', validated_at = now(), paid_parrain = amt, paid_filleul = 2000
     where filleul = r.filleul and status = 'en_attente';
    if found then
      if amt > 0 then update profiles set cash = cash + amt where id = r.parrain; end if;
      update profiles set cash = cash + 2000 where id = r.filleul;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Classements : mêmes colonnes qu'avant (onglets restés ouverts), sans logement ni titre acheté ; niveau de trader.
create or replace function leaderboard() returns table (id uuid, pseudo text, cash float8, patrimoine float8, bankruptcies int, home int, title text, level int)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo, p.cash, patrimoine(p.id), p.bankruptcies, 0, null::text, case when p.bot then null else trader_level(p.id) end
  from profiles p order by 4 desc limit 50
$$;
create or replace function gains_board(p_period text default 'today', p_scope text default 'all')
returns table (id uuid, pseudo text, title text, guild text, gain float8, bets int, level int)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo, null::text,
         (select g.tag from guild_members m join guilds g on g.id = m.guild_id where m.user_id = p.id),
         sum(bet_gain(b)), count(*)::int, case when p.bot then null else trader_level(p.id) end
  from bets b join profiles p on p.id = b.user_id
  where b.status <> 'open'
    and (p_period = 'total' or b.closed_at >= day_start())
    and (p_scope = 'all'
      or (p_scope = 'friends' and (p.id = auth.uid() or p.id in (select friend_ids(auth.uid()))))
      or (p_scope = 'guild' and p.id in (select user_id from guild_members
            where guild_id = (select guild_id from guild_members where user_id = auth.uid()))))
  group by p.id order by 5 desc limit 50
$$;

-- Guildes : 30 places (la mairie disparaît avec la ville ; les niveaux de guilde viendront en H7).
create or replace function guild_join(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if exists (select 1 from guild_members where user_id = auth.uid()) then raise exception 'Quitte d''abord ta guilde.'; end if;
  perform 1 from guilds where id = p_id for update;
  if not found then raise exception 'Guilde introuvable.'; end if;
  if (select count(*) from guild_members where guild_id = p_id) >= 30 then raise exception 'Guilde complète (30 membres).'; end if;
  insert into guild_members (user_id, guild_id) values (auth.uid(), p_id);
end $$;
create or replace function guild_list(p_period text default 'today')
returns table (id bigint, name text, tag text, motto text, members int, gain float8, mine boolean, cap int)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.tag, g.motto, count(m.user_id)::int,
         coalesce(sum(gain_since(m.user_id, case when p_period = 'today' then day_start() end)), 0),
         bool_or(m.user_id = auth.uid()), 30
  from guilds g left join guild_members m on m.guild_id = g.id
  group by g.id order by 6 desc, 5 desc limit 50
$$;

-- ===== 4. Succès =====
delete from aur_achievements where code in ('PROPRIO', 'BANQUIER', 'SPECIALISTE', 'POLYVALENT');
delete from achievements where code in ('PROPRIO', 'BANQUIER', 'SPECIALISTE', 'POLYVALENT');

create or replace function ach_stats(u uuid) returns jsonb language sql stable set search_path = public as $$
  with q as (select x.*, ach_net(x) > 0 as w from bets x where x.user_id = u and x.kind = 'aurelys' and x.status <> 'open' and ach_valid(x)),
  d as (select distinct (closed_at at time zone 'Europe/Paris')::date as day from q),
  g as (select day, day - (row_number() over (order by day))::int as grp from d),
  runs as (select grp, count(*) as n, max(day) as last from g group by grp),
  pres as (select day, day - (row_number() over (order by day))::int as grp from presence_days where user_id = u),
  pruns as (select grp, count(*) as n, max(day) as last from pres group by grp)
  select jsonb_build_object(
    'valid', (select count(*) from q), 'wins', (select count(*) from q where w),
    'x1', (select count(*) from q where w and lev = 1), 'stops', (select count(*) from q where sl is not null),
    'GTR', (select count(*) from q where w and aur = 'GTR'), 'HLV', (select count(*) from q where w and aur = 'HLV'), 'LMR', (select count(*) from q where w and aur = 'LMR'),
    'sectors', (select count(distinct q.aur) from q join aur_stocks s on s.tk = q.aur and s.status = 'core' where w),
    'surprises', (select count(*) from q where w and exists (select 1 from aur_results r where r.tk = q.aur and r.surp and r.t > q.created_at and r.t < q.closed_at)),
    'days_best', coalesce((select max(n) from runs), 0),
    'days_now', coalesce((select n from runs where last >= (now() at time zone 'Europe/Paris')::date - 1 order by last desc limit 1), 0),
    'presence', coalesce((select n from pruns where last >= (now() at time zone 'Europe/Paris')::date - 1 order by last desc limit 1), 0),
    'reads', (select count(*) from news_reads where user_id = u),
    'refs', (select count(*) from referrals where parrain = u and status = 'validé'),
    'unlocked', (select count(*) from aur_achievements where user_id = u))
$$;

create or replace function ach_history(u uuid) returns void language plpgsql set search_path = public as $$
declare b bets; s int := 0; z int := 0; bs int := 0; bz int := 0;
begin
  for b in select * from bets where user_id = u and kind = 'aurelys' and status <> 'open' and closed_at is not null order by closed_at, id loop
    if ach_net(b) <= 0 then s := 0; elsif ach_valid(b) then s := s + 1; end if;
    if ach_liq(b) then z := 0; elsif ach_valid(b) then z := z + 1; end if;
    bs := greatest(bs, s); bz := greatest(bz, z);
    if ach_valid(b) then perform ach_trade(b); end if;
  end loop;
  update profiles set ach_streak = s, ach_zl = z where id = u;
  if bs >= 5 then perform achievement_grant(u, 'SERIE_5'); end if;
  if bs >= 10 then perform achievement_grant(u, 'SERIE_10'); end if;
  if bz >= 100 then perform achievement_grant(u, 'ZERO_LIQ'); end if;
  perform ach_counts(u);
  perform ach_wealth(u);
  if exists (select 1 from guild_members where user_id = u) then perform achievement_grant(u, 'GUILDE'); end if;
  if exists (select 1 from salaries where user_id = u and amount > 0) then perform achievement_grant(u, 'SALAIRE'); end if;
  perform ach_social(u);
end $$;

create or replace function ach_event() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'guild_members' then perform achievement_grant(new.user_id, 'GUILDE');
  elsif tg_table_name = 'salaries' then if new.amount > 0 then perform achievement_grant(new.user_id, 'SALAIRE'); end if;
  end if;
  return null;
end $$;

create or replace function ach_tick() returns void language plpgsql set search_path = public as $$
declare r record; ws timestamptz := (date_trunc('week', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
begin
  for r in select b.user_id from bets b join profiles p on p.id = b.user_id and not p.bot where b.status = 'open' and b.kind = 'aurelys'
           group by b.user_id having count(distinct b.aur) >= 5 loop
    perform achievement_grant(r.user_id, 'DIVERSIFIE');
  end loop;
  for r in select id from profiles where not bot and last_seen > now() - interval '10 minutes' loop perform ach_wealth(r.id); end loop;
  for r in select distinct parrain from referrals where status = 'validé' loop perform ach_social(r.parrain); end loop;
  -- Fin de semaine (lundi 0 h, heure de Paris) : classements des gains de la semaine écoulée.
  if coalesce((select week from ach_week), '-infinity') < ws then
    insert into ach_week values (1, ws) on conflict (id) do update set week = excluded.week where ach_week.week < excluded.week;
    if found then perform ach_week_end(ws - interval '7 days', ws); end if;
  end if;
end $$;

create or replace function my_achievements() returns jsonb language sql stable security definer set search_path = public as $$
  with s as (select ach_stats(auth.uid()) as s, p.ach_streak, p.ach_zl, p.tal_hwm, patrimoine(p.id) as pat
             from profiles p where p.id = auth.uid())
  select jsonb_build_object('total', (select count(*) from achievements), 'max_points', 21,
    'points', least(21, coalesce((select sum(a.points) from aur_achievements u join achievements a on a.code = u.code where u.user_id = auth.uid()), 0)),
    'list', coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'cat', a.cat, 'points', a.points, 'goal', a.goal, 'unit', a.unit,
      'name', case when a.secret and u.code is null then '???' else a.name end,
      'descr', case when a.secret and u.code is null then null else a.descr end,
      'hint', case when a.secret and u.code is null then a.hint end, 'secret', a.secret, 'at', u.unlocked_at,
      'cur', case when a.secret and u.code is null then null else case a.code
        when 'FIRST_TRADE' then (s.s->>'valid')::float8 when 'FIRST_GREEN' then (s.s->>'wins')::float8
        when 'SERIE_5' then s.ach_streak when 'SERIE_10' then s.ach_streak
        when 'SCALPEUR' then (s.s->>'valid')::float8 when 'VETERAN' then (s.s->>'valid')::float8
        when 'SANS_LEVIER' then (s.s->>'x1')::float8 when 'DISCIPLINE' then (s.s->>'stops')::float8
        when 'ASSIDU_7' then (s.s->>'days_now')::float8 when 'ASSIDU_30' then (s.s->>'days_now')::float8
        when 'GAIN_10K' then s.tal_hwm when 'GAIN_50K' then s.tal_hwm when 'GAIN_100K' then s.tal_hwm when 'GAIN_500K' then s.tal_hwm when 'GAIN_1M' then s.tal_hwm
        when 'PAT_250K' then s.pat when 'PAT_1M' then s.pat
        when 'AGRONOME' then (s.s->>'GTR')::float8 when 'ELECTRICIEN' then (s.s->>'HLV')::float8 when 'FLANEUR' then (s.s->>'LMR')::float8
        when 'TOUS_SECTEURS' then (s.s->>'sectors')::float8 when 'SURPRISES' then (s.s->>'surprises')::float8
        when 'ZERO_LIQ' then s.ach_zl when 'PARRAIN' then (s.s->>'refs')::float8 when 'MENTOR' then (s.s->>'refs')::float8
        when 'LECTEUR' then (s.s->>'reads')::float8 when 'COLLECTIONNEUR' then (s.s->>'unlocked')::float8 when 'LEGENDE' then (s.s->>'unlocked')::float8
        when 'FIDELE' then (s.s->>'presence')::float8
      end end) order by a.ord), '[]'))
  from achievements a cross join s left join aur_achievements u on u.code = a.code and u.user_id = auth.uid()
$$;
-- 'free' gardé à 0 pour les onglets restés ouverts (plus de points de talent).
create or replace function my_unlocks(p_since timestamptz) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('free', 0, 'now', now(),
    'list', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'points', a.points) order by u.unlocked_at)
                      from aur_achievements u join achievements a on a.code = u.code
                      where u.user_id = auth.uid() and u.unlocked_at > coalesce(p_since, '-infinity')), '[]'))
$$;

-- 20261028000000_admin.sql : sans banque ni talents (niveau de trader).
create or replace function admin_snapshot() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb := '{}'; v jsonb; d0 timestamptz := day_start();
begin
  perform admin_check();

  -- Sociétés : dernier cours et exposition (mise × levier) des positions ouvertes, joueurs et bots séparés.
  select coalesce(jsonb_agg(jsonb_build_object(
           'tk', s.tk, 'name', s.name, 'sector', s.sector, 'status', s.status, 'p', (aur_last(s.tk)).p,
           'long', coalesce(e.long, 0), 'short', coalesce(e.short, 0), 'bots', coalesce(e.bots, 0)) order by s.tk), '[]')
    into v
    from aur_stocks s
    left join (select b.aur, sum(b.stake * b.lev) filter (where b.dir = 'up' and not p.bot) long,
                      sum(b.stake * b.lev) filter (where b.dir = 'down' and not p.bot) short,
                      sum(b.stake * b.lev) filter (where p.bot) bots
                 from bets b join profiles p on p.id = b.user_id
                where b.status = 'open' and b.kind = 'aurelys' group by b.aur) e on e.aur = s.tk
   where s.status in ('core', 'listed');
  r := r || jsonb_build_object('stocks', v);

  -- Joueurs (les 1 000 vus le plus récemment) avec positions, succès, filleuls.
  -- ponytail: 1 000 profils au plus, paginer si le jeu dépasse.
  select coalesce(jsonb_agg(x order by x->>'seen' desc nulls last), '[]') into v from (
    select jsonb_build_object(
      'id', p.id, 'pseudo', p.pseudo, 'bot', p.bot, 'cash', p.cash, 'patrimoine', patrimoine(p.id),
      'created', p.created_at, 'seen', p.last_seen, 'bankruptcies', p.bankruptcies,
      'level', trader_level(p.id), 'tal_cum', p.tal_cum,
      'positions', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'tk', b.aur, 'dir', b.dir, 'lev', b.lev, 'stake', b.stake,
                      'entry', b.entry, 'at', b.created_at, 'value', trade_value(b, coalesce((aur_last(b.aur)).p, b.entry))) order by b.id), '[]')
                    from bets b where b.user_id = p.id and b.status = 'open' and b.kind = 'aurelys'),
      'achievements', (select coalesce(jsonb_agg(a.code order by a.unlocked_at), '[]') from aur_achievements a where a.user_id = p.id),
      'filleuls', (select coalesce(jsonb_agg(jsonb_build_object('pseudo', f.pseudo, 'status', rf.status)), '[]')
                     from referrals rf join profiles f on f.id = rf.filleul where rf.parrain = p.id),
      'parrain', (select pp.pseudo from referrals rf join profiles pp on pp.id = rf.parrain where rf.filleul = p.id)) x
    from profiles p order by p.last_seen desc nulls last limit 1000) q;
  r := r || jsonb_build_object('players', v);

  -- Indicateurs (joueurs seulement, sans bots).
  select jsonb_build_object(
    'online', count(*) filter (where last_seen > now() - interval '2 minutes'),
    'signups_today', count(*) filter (where created_at >= d0),
    'demos', null, -- non mesuré : la démo tourne dans le navigateur, sans appel au serveur
    'w_cash', sum(cash),
    'players', count(*)) into v
    from profiles where not bot;
  r := r || jsonb_build_object('kpi', v || jsonb_build_object(
    'liq_hour', (select count(*) from bets b join profiles p on p.id = b.user_id where b.closed_by = 'liq' and b.closed_at > now() - interval '1 hour' and not p.bot),
    'liq_hour_bots', (select count(*) from bets b join profiles p on p.id = b.user_id where b.closed_by = 'liq' and b.closed_at > now() - interval '1 hour' and p.bot),
    'retention', (select jsonb_build_object(
        'j1_n', count(*) filter (where c <= today - 1), 'j1', count(*) filter (where c <= today - 1 and exists (select 1 from presence_days d where d.user_id = id and d.day = c + 1)),
        'j7_n', count(*) filter (where c <= today - 7), 'j7', count(*) filter (where c <= today - 7 and exists (select 1 from presence_days d where d.user_id = id and d.day = c + 7)))
      from (select id, (created_at at time zone 'Europe/Paris')::date c, (now() at time zone 'Europe/Paris')::date today
              from profiles where not bot and created_at > now() - interval '30 days') n)));

  -- Santé : avance du moteur (cours calculés jusqu'à … ; négatif = en retard), settle(), appels de la fonction, aur_ticks.
  r := r || jsonb_build_object('health', jsonb_build_object(
    'engine_ahead_s', (select extract(epoch from min(m) - now()) from (select (select max(k.t) from aur_ticks k where k.tk = s.tk) m
                         from aur_stocks s where s.status in ('core', 'listed')) z),
    'ticks_bytes', pg_total_relation_size('aur_ticks'),
    'ticks_rows', (select reltuples::bigint from pg_class where oid = 'aur_ticks'::regclass)));
  if to_regclass('cron.job_run_details') is not null then -- absent des tests et de la démo
    execute $q$ select jsonb_build_object('last_ms', (array_agg(ms order by start_time desc))[1], 'avg_ms', avg(ms), 'max_ms', max(ms),
                  'failed', count(*) filter (where status = 'failed'), 'runs', count(*))
                from (select d.start_time, d.status, extract(epoch from d.end_time - d.start_time) * 1000 ms
                        from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                       where j.jobname = 'wikibourse-settle' order by d.start_time desc limit 30) z $q$ into v;
    r := jsonb_set(r, '{health,settle}', v);
  end if;
  if to_regclass('net._http_response') is not null then
    execute $q$ select coalesce(jsonb_agg(jsonb_build_object('at', created, 'status', status_code, 'error', error_msg, 'body', left(content, 300)) order by created desc), '[]')
                from (select * from net._http_response where error_msg is not null or status_code >= 400 order by created desc limit 10) z $q$ into v;
    r := jsonb_set(r, '{health,errors}', v);
  end if;

  -- Alertes.
  select coalesce(jsonb_agg(z), '[]') into v from ( -- un joueur porte plus de 25 % de l'exposition d'une société
    select jsonb_build_object('kind', 'concentration', 'pseudo', p.pseudo, 'tk', e.aur, 'share', e.x / t.tot) z
      from (select aur, user_id, sum(stake * lev) x from bets where status = 'open' and kind = 'aurelys' group by 1, 2) e
      join (select aur, sum(stake * lev) tot from bets where status = 'open' and kind = 'aurelys' group by 1) t using (aur)
      join profiles p on p.id = e.user_id
     where not p.bot and e.x > 0.25 * t.tot
    union all -- gain du jour plus de 5 fois la médiane des gains positifs du jour
    select jsonb_build_object('kind', 'gain', 'pseudo', g.pseudo, 'gain', g.gain, 'median', m.med)
      from (select p.pseudo, sum(bet_gain(b)) gain from bets b join profiles p on p.id = b.user_id
             where b.closed_at >= d0 and b.kind in ('aurelys', 'invest') and not p.bot group by p.pseudo) g
      cross join (select percentile_cont(0.5) within group (order by gain) med from (
                    select sum(bet_gain(b)) gain from bets b join profiles p on p.id = b.user_id
                     where b.closed_at >= d0 and b.kind in ('aurelys', 'invest') and not p.bot group by p.id) q where gain > 0) m
     where g.gain > 5 * m.med
    union all -- comptes du même parrain (lui compris) qui ouvrent la même position à moins d'une minute d'écart, 3 fois au moins en 24 h
    select jsonb_build_object('kind', 'mirror', 'parrain', pp.pseudo, 'pseudos', w.pseudos, 'pairs', w.n)
      from (select g.parrain, count(*) n, jsonb_agg(distinct pa.pseudo) || jsonb_agg(distinct pb.pseudo) pseudos
              from (select parrain, filleul u from referrals union select distinct parrain, parrain from referrals) g
              join (select parrain, filleul u from referrals union select distinct parrain, parrain from referrals) h on h.parrain = g.parrain and h.u > g.u
              join bets a on a.user_id = g.u and a.kind = 'aurelys' and a.created_at > now() - interval '24 hours'
              join bets b on b.user_id = h.u and b.kind = 'aurelys' and b.aur = a.aur and b.dir = a.dir
                         and b.created_at between a.created_at - interval '60 seconds' and a.created_at + interval '60 seconds'
              join profiles pa on pa.id = g.u join profiles pb on pb.id = h.u
             group by g.parrain having count(*) >= 3) w
      join profiles pp on pp.id = w.parrain) a;
  r := r || jsonb_build_object('alerts', v, 'now', now());
  return r;
end $$;

-- ===== 5. Suppressions =====
drop function bets_bonus(), salary_bonus(), salary_talent(), consume_bonus(uuid, text), use_bonus(text),
  buy_item(text), sell_item(text), equip_item(text), unequip(text), home_level(uuid), bank_move(float8),
  talent_buy(text), talent_reset(), kraken_arm(boolean), my_talents(), talent_points(uuid), talent_threshold(int), talent_level(float8),
  tal_rank(uuid, text), talent_slip(uuid, float8), aur_cap(uuid, float8), talent_daily(), aur_day(), aur_insider(), ach_talents(uuid),
  city_give(float8, text), city_build(text), city_buy_land(), city_view(bigint), city_daily(), city_level(uuid, text), land_cost(int),
  my_city(), active_members(bigint), aur_index();
drop table inventory, shop_items, talents, talent_uses, talent_defs, talent_day, aur_revisions,
  city_gifts, city_uses, city_buildings, city_catalog;
alter table profiles drop column bank, drop column bank_since, drop column salary_boost_until,
  drop column tal_resets, drop column kraken_armed, drop column kraken_day, drop column phenix_at;
alter table guilds drop column treasury, drop column fund_units, drop column fund_hwm, drop column last_day, drop column land;
