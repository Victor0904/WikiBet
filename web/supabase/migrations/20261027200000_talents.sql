-- Arbre de talents (demande de Victor, octobre 2026 ; valeurs validées après scripts/sim-talents.mjs).
-- Niveau : gain net de trading Aurelys cumulé (clôtures tenues au moins 150 s, tous frais déduits, remboursements exclus),
-- au plus haut historique (perdre ne fait pas perdre de niveau). 2 500 W par niveau jusqu'au 5, 5 000 W jusqu'au 15, puis
-- 10 000 W. Points = niveau + points des succès. Pas de talents pour les bots. Réinitialisation : 1 gratuite, puis 5 000 W.
-- 4 branches ; l'ultime d'une branche demande 10 points dans ses autres talents. Tous les effets sont appliqués ici.
-- Retour arrière : réappliquer les fonctions redéfinies depuis leurs migrations d'origine (indiquées à chaque fonction),
-- supprimer les tables talents, talent_uses, talent_day, achievements, user_achievements, aur_revisions.

alter table profiles add column tal_cum float8 not null default 0, add column tal_hwm float8 not null default 0,
  add column tal_resets int not null default 0, add column kraken_armed boolean not null default false,
  add column kraken_day int, add column phenix_at timestamptz;

create table talent_defs (code text primary key, branch text not null, max_rank int not null, ultimate boolean not null default false);
insert into talent_defs values
  ('amort', 'prudence', 5, false), ('frais', 'prudence', 5, false), ('sangfroid', 'prudence', 1, false), ('filet', 'prudence', 1, false), ('phenix', 'prudence', 1, true),
  ('passif', 'rente', 6, false), ('dividendes', 'rente', 5, false), ('negociateur', 'rente', 5, false), ('fidelite', 'rente', 5, false), ('rentier', 'rente', 1, true),
  ('avant', 'info', 3, false), ('flair', 'info', 3, false), ('archiviste', 'info', 3, false), ('analyste', 'info', 2, false), ('initie', 'info', 1, true),
  ('multitache', 'audace', 3, false), ('discretion', 'audace', 4, false), ('calibre', 'audace', 3, false), ('timing', 'audace', 1, false), ('kraken', 'audace', 1, true);
alter table talent_defs enable row level security;
create policy "catalogue des talents" on talent_defs for select using (true);

create table talents (user_id uuid references profiles on delete cascade, code text references talent_defs, rank int not null check (rank > 0),
  primary key (user_id, code));
alter table talents enable row level security;
create policy "mes talents" on talents for select using (user_id = auth.uid());
-- Effets limités dans le temps (Amortisseur : une fois par jour réel).
create table talent_uses (user_id uuid references profiles on delete cascade, code text, day date, primary key (user_id, code, day));
alter table talent_uses enable row level security;

-- Succès : 2e source de points (1, 2 ou 3 selon la difficulté). Liste à venir (Victor) ; achievement_grant les attribue.
create table achievements (code text primary key, name text not null, descr text not null, points int not null check (points between 1 and 3));
create table user_achievements (user_id uuid references profiles on delete cascade, code text references achievements, at timestamptz not null default now(),
  primary key (user_id, code));
alter table achievements enable row level security;
alter table user_achievements enable row level security;
create policy "succès" on achievements for select using (true);
create policy "succès obtenus" on user_achievements for select using (true);
create function achievement_grant(p_user uuid, p_code text) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if (select bot from profiles where id = p_user) then return false; end if;
  insert into user_achievements (user_id, code) values (p_user, p_code) on conflict do nothing;
  return found;
end $$;
revoke execute on function achievement_grant(uuid, text) from public, anon, authenticated;

create function talent_level(h float8) returns int language sql immutable as $$
  select case when h < 12500 then floor(greatest(h, 0) / 2500)::int when h < 62500 then 5 + floor((h - 12500) / 5000)::int
              else 15 + floor((h - 62500) / 10000)::int end
$$;
-- Gain net à atteindre pour le niveau n.
create function talent_threshold(n int) returns float8 language sql immutable as $$
  select case when n <= 5 then n * 2500.0 when n <= 15 then 12500 + (n - 5) * 5000.0 else 62500 + (n - 15) * 10000.0 end
$$;
create function tal_rank(p_user uuid, p_code text) returns int language sql stable set search_path = public as $$
  select coalesce((select rank from talents where user_id = p_user and code = p_code), 0)
$$;
create function aur_day() returns int language sql stable as $$ select floor((extract(epoch from now()) - 1790812800) / 3600)::int $$;

-- ===== Niveau : chaque clôture Aurelys tenue au moins 150 s =====
create function talents_gain() returns trigger language plpgsql security definer set search_path = public as $$
declare g float8;
begin
  if new.closed_at - new.created_at < interval '150 seconds' then return null; end if;
  g := (case when new.insured then 0 else coalesce(new.payout, 0) end) - new.stake - coalesce(new.fees, 0);
  update profiles set tal_cum = tal_cum + g, tal_hwm = greatest(tal_hwm, tal_cum + g) where id = new.user_id and not bot;
  return null;
end $$;
create trigger talents_gain after update on bets for each row
  when (old.status = 'open' and new.status <> 'open' and new.kind = 'aurelys') execute function talents_gain();

-- Rétroactif : clôtures passées, dans l'ordre.
with g as (
  select b.user_id, b.closed_at, b.id, (case when b.insured then 0 else coalesce(b.payout, 0) end) - b.stake - coalesce(b.fees, 0) as g
  from bets b join profiles p on p.id = b.user_id and not p.bot
  where b.kind = 'aurelys' and b.status <> 'open' and b.closed_at - b.created_at >= interval '150 seconds'
), c as (select user_id, sum(g) over (partition by user_id order by closed_at, id) as c, g from g)
update profiles p set tal_cum = x.cum, tal_hwm = greatest(0, x.hwm)
from (select user_id, sum(g) as cum, max(c) as hwm from c group by user_id) x where p.id = x.user_id;

-- ===== Écran =====
create function my_talents() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'level', talent_level(p.tal_hwm), 'hwm', p.tal_hwm, 'cum', p.tal_cum,
    'from', talent_threshold(talent_level(p.tal_hwm)), 'next', talent_threshold(talent_level(p.tal_hwm) + 1),
    'ach', coalesce((select sum(a.points) from user_achievements u join achievements a on a.code = u.code where u.user_id = p.id), 0),
    'spent', coalesce((select sum(rank) from talents where user_id = p.id), 0),
    'ranks', coalesce((select jsonb_object_agg(code, rank) from talents where user_id = p.id), '{}'),
    'resets', p.tal_resets, 'reset_cost', case when p.tal_resets = 0 then 0 else 5000 end,
    'kraken', jsonb_build_object('armed', p.kraken_armed, 'free', coalesce(p.kraken_day, -1) < aur_day()),
    'bot', p.bot)
  from profiles p where p.id = auth.uid()
$$;
create function talent_points(p_user uuid) returns int language sql stable set search_path = public as $$
  select talent_level(tal_hwm) + coalesce((select sum(a.points) from user_achievements u join achievements a on a.code = u.code where u.user_id = p_user), 0)::int
         - coalesce((select sum(rank) from talents where user_id = p_user), 0)::int
  from profiles where id = p_user
$$;
create function talent_buy(p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare d talent_defs; r int; br int;
begin
  perform 1 from profiles where id = auth.uid() and not bot for update;
  if not found then raise exception 'Connexion requise.'; end if;
  select * into d from talent_defs where code = p_code;
  if not found then raise exception 'Talent inconnu.'; end if;
  r := tal_rank(auth.uid(), p_code);
  if r >= d.max_rank then raise exception 'Ce talent est déjà au rang maximum.'; end if;
  if talent_points(auth.uid()) < 1 then raise exception 'Aucun point de talent disponible.'; end if;
  if d.ultimate then
    select coalesce(sum(t.rank), 0) into br from talents t join talent_defs x on x.code = t.code where t.user_id = auth.uid() and x.branch = d.branch and not x.ultimate;
    if br < 10 then raise exception 'Talent ultime : il faut 10 points dans cette branche (tu en as %).', br; end if;
  end if;
  insert into talents values (auth.uid(), p_code, 1) on conflict (user_id, code) do update set rank = talents.rank + 1;
  return my_talents();
end $$;
create function talent_reset() returns jsonb language plpgsql security definer set search_path = public as $$
declare p profiles; cost float8;
begin
  select * into p from profiles where id = auth.uid() for update;
  if not found then raise exception 'Connexion requise.'; end if;
  cost := case when p.tal_resets = 0 then 0 else 5000 end;
  if p.cash < cost then raise exception 'Solde insuffisant : la réinitialisation coûte 5 000 W.'; end if;
  update profiles set cash = cash - cost, tal_resets = tal_resets + 1, kraken_armed = false where id = auth.uid();
  delete from talents where user_id = auth.uid();
  return my_talents();
end $$;
-- Kraken : le prochain ordre (même automatique) part sans impact, une fois par jour d'Aurelys.
create function kraken_arm(p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_on and tal_rank(auth.uid(), 'kraken') = 0 then raise exception 'Talent Kraken requis.'; end if;
  update profiles set kraken_armed = p_on where id = auth.uid();
  return my_talents();
end $$;
-- Conditions de l'ordre pour l'écran : taux de frais, part de l'impact gardée (Discrétion), Kraken armé et disponible.
create function my_terms() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('fee', aur_fee_rate(p.id), 'cut', 1 - .025 * tal_rank(p.id, 'discretion'),
    'kraken', p.kraken_armed and tal_rank(p.id, 'kraken') > 0 and coalesce(p.kraken_day, -1) < aur_day())
  from profiles p where p.id = auth.uid()
$$;
revoke execute on function my_talents(), talent_buy(text), talent_reset(), kraken_arm(boolean), my_terms() from public, anon;
grant execute on function my_talents(), talent_buy(text), talent_reset(), kraken_arm(boolean), my_terms() to authenticated;

-- ===== Audace : impact (Discrétion, Kraken), plafond (Gros calibre), positions (Multitâche), stops au cours touché (Timing) =====
create function talent_slip(p_user uuid, p_slip float8) returns float8 language plpgsql set search_path = public as $$
begin
  update profiles set kraken_armed = false, kraken_day = aur_day()
   where id = p_user and kraken_armed and coalesce(kraken_day, -1) < aur_day() and tal_rank(p_user, 'kraken') > 0;
  if found then return 0; end if;
  return p_slip * (1 - .025 * tal_rank(p_user, 'discretion'));
end $$;
revoke execute on function talent_slip(uuid, float8) from public, anon, authenticated;

-- 20261023000000_ordres_auto.sql
create or replace function aur_max_pos(p_user uuid) returns int language sql stable set search_path = public as $$
  select (array[3, 5, 8, 12, 20, 25, 30, 40, 50])[least(home_level(p_user), 8) + 1] + tal_rank(p_user, 'multitache')
$$;
create function aur_cap(p_user uuid, p_liq float8) returns float8 language sql stable set search_path = public as $$
  select 20 * p_liq * (1 + .1 * tal_rank(p_user, 'calibre'))
$$;

-- 20261023000000_ordres_auto.sql
create or replace function aur_open(p_user uuid, p_tk text, p_dir text, p_lev int, p_stake float8, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets; k aur_ticks; s aur_stocks; fee float8; px float8; expo float8; mx int; cap float8;
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
  cap := aur_cap(p_user, s.liq);
  if expo + p_stake * p_lev > cap then
    raise exception 'Plafond atteint : au plus % W engagés sur cette action (mise × levier).', to_char(cap, 'FM999G999G999');
  end if;
  px := k.p * (1 + (case when p_dir = 'up' then 1 else -1 end) * least(greatest(coalesce(talent_slip(p_user, p_slip), 0), 0), 0.2));
  fee := aur_fee(p_user, p_stake * p_lev);
  update profiles set cash = cash - p_stake - fee where id = p_user and cash >= p_stake + fee;
  if not found then raise exception 'Solde insuffisant (mise + frais).'; end if;
  select * into g from game_now();
  insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, fees, fee_open)
  values (p_user, g.k, g.d, 'aurelys', p_stake, p_tk, p_dir, p_lev, px, fee, fee) returning * into b;
  insert into aur_orders (tk, q) values (p_tk, (case when p_dir = 'up' then 1 else -1 end) * p_stake * p_lev);
  return b;
end $$;

-- 20261012000000_villes.sql ; p_px : cours de référence imposé (Timing : le cours qui a touché le stop ou l'objectif).
create function aur_close_px(p_user uuid, p_id bigint, p_slip float8, p_px float8) returns bets
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
  px := coalesce(p_px, k.p) * (1 - (case when b.dir = 'up' then 1 else -1 end) * least(greatest(coalesce(talent_slip(p_user, p_slip), 0), 0), 0.2));
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
revoke execute on function aur_close_px(uuid, bigint, float8, float8) from public, anon, authenticated;
create or replace function aur_close(p_user uuid, p_id bigint, p_slip float8) returns bets
language sql security definer set search_path = public as $$ select * from aur_close_px(p_user, p_id, p_slip, null) $$;

-- 20261013000000_portefeuille.sql
create or replace function aur_buy(p_user uuid, p_tk text, p_amount float8, p_slip float8) returns aur_holdings
language plpgsql security definer set search_path = public as $$
declare s aur_stocks; k aur_ticks; px float8; fee float8; h aur_holdings; cap float8;
begin
  select * into s from aur_stocks where tk = p_tk;
  if not found or s.status not in ('core', 'listed') then raise exception 'Cette action n''est pas cotée.'; end if;
  if not (p_amount >= 10) then raise exception 'Achat de 10 W au moins.'; end if;
  cap := aur_cap(p_user, s.liq);
  if p_amount > cap then raise exception 'Ordre trop gros : au plus % W par ordre sur cette action.', to_char(cap, 'FM999G999G999'); end if;
  k := aur_last(p_tk);
  if k.t is null or k.t < now() - interval '30 seconds' then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  if k.halt then raise exception 'Cotation suspendue sur cette action.'; end if;
  px := k.p * (1 + least(greatest(coalesce(talent_slip(p_user, p_slip), 0), 0), 0.2));
  fee := aur_fee(p_user, p_amount);
  update profiles set cash = cash - p_amount - fee where id = p_user and cash >= p_amount + fee;
  if not found then raise exception 'Solde insuffisant (montant + frais).'; end if;
  insert into aur_holdings (user_id, tk, qty, cost) values (p_user, p_tk, p_amount / px, p_amount + fee)
  on conflict (user_id, tk) do update set qty = aur_holdings.qty + excluded.qty, cost = aur_holdings.cost + excluded.cost returning * into h;
  insert into aur_orders (tk, q) values (p_tk, p_amount);
  return h;
end $$;

-- 20261013000000_portefeuille.sql
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
  px := k.p * (1 - least(greatest(coalesce(talent_slip(p_user, p_slip), 0), 0), 0.2));
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

-- 20261024000000_notifications.sql ; Timing : le stop ou l'objectif part du cours qui l'a touché, pas du cours au pas suivant.
create or replace function aur_auto_exec(p_what text, p_id bigint, p_slip float8) returns void
language plpgsql security definer set search_path = public as $$
declare g aur_triggers; b bets; why text; hit float8;
begin
  if p_what = 'close' then
    select * into b from bets where id = p_id and status = 'open';
    if not found then return; end if;
    select case when (b.dir = 'up' and k.p <= b.sl) or (b.dir = 'down' and k.p >= b.sl) then 'stop' else 'objectif' end, k.p into why, hit
      from aur_ticks k where k.tk = b.aur and k.t > b.auto_at and k.t <= now()
       and (case when b.dir = 'up' then k.p <= b.sl or k.p >= b.tp else k.p >= b.sl or k.p <= b.tp end)
     order by k.t limit 1;
    perform aur_close_px(b.user_id, p_id, p_slip, case when tal_rank(b.user_id, 'timing') > 0 then hit end);
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

-- ===== Prudence =====
-- 20261027000000_impact_cloture.sql : Frais réduits, −5 % par rang.
create or replace function aur_fee_rate(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select 0.001 * (1 - 0.1 * city_level(p_user, 'salle')) * (1 - .05 * tal_rank(p_user, 'frais'))
$$;

-- 20261014000000_retours.sql ; Amortisseur : si ni l'assurance ni la banque de guilde n'ont joué, une liquidation par jour réel
-- rend 3 % de la mise par rang, 1 500 W au plus. Remboursement exclu du niveau (insured).
create or replace function bets_bonus() returns trigger language plpgsql set search_path = public as $$
declare lv int; done boolean := false;
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
          new.payout := new.stake * (.05 + .1 * lv); new.insured := true; done := true;
          update profiles set cash = cash + new.payout where id = new.user_id;
        end if;
      end if;
      lv := tal_rank(new.user_id, 'amort');
      if not done and lv > 0 then
        insert into talent_uses values (new.user_id, 'amort', paris_day()) on conflict do nothing;
        if found then
          new.payout := least(1500, new.stake * .03 * lv); new.insured := true;
          update profiles set cash = cash + new.payout where id = new.user_id;
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

-- 20261025300000_alerte_liquidation.sql ; Sang-froid : première alerte à 40 % de la mise au lieu de 25 %.
create or replace function push_due() returns table (endpoint text) language sql security definer set search_path = public as $$
  with l as (update bets set push_at = now() where closed_by = 'liq' and push_at is null and closed_at > now() - interval '1 hour' returning user_id),
  v as (select b.id, trade_value(b, (aur_last(b.aur)).p) / b.stake r, case when tal_rank(b.user_id, 'sangfroid') > 0 then .40 else .25 end lim from bets b
         where b.kind = 'aurelys' and b.status = 'open' and b.warn < 2 and b.user_id in (select user_id from push_subs)),
  w as (update bets b set warn = case when v.r <= .10 then 2 else 1 end, warn_at = now() from v
         where b.id = v.id and (v.r <= .10 or (v.r <= v.lim and b.warn < 1)) returning b.user_id)
  select s.endpoint from push_subs s where s.user_id in (select user_id from l union select user_id from w)
$$;
create or replace function push_info(p_endpoint text) returns table (kind text, aur text, dir text, lev int, stake float8, lq float8)
language sql stable security definer set search_path = public as $$
  (select 'liq', b.aur, b.dir, b.lev, b.stake, b.exit from bets b join push_subs s on s.user_id = b.user_id
    where s.endpoint = p_endpoint and b.closed_by = 'liq' and b.push_at > now() - interval '10 minutes'
    order by b.closed_at desc limit 5)
  union all
  (select case when b.warn = 2 then '10' when tal_rank(b.user_id, 'sangfroid') > 0 then '40' else '25' end, b.aur, b.dir, b.lev, b.stake,
          b.entry * (1 - (case when b.dir = 'up' then 1 else -1 end)::float8 / b.lev)
     from bets b join push_subs s on s.user_id = b.user_id
    where s.endpoint = p_endpoint and b.status = 'open' and b.warn_at > now() - interval '10 minutes'
    order by b.warn_at desc limit 5)
$$;
revoke execute on function push_due(), push_info(text) from public, anon, authenticated;

-- 20261026500000_banque.sql ; Filet : stop sans le loft.
create or replace function aur_set_auto(p_id bigint, p_sl float8, p_tp float8) returns bets
language plpgsql security definer set search_path = public as $$
declare b bets; k aur_ticks; sg int; lq float8;
begin
  if p_sl is not null and home_level(auth.uid()) < 3 and tal_rank(auth.uid(), 'filet') = 0 then raise exception 'Le stop se débloque avec le loft (QG) ou le talent Filet.'; end if;
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

-- 20261011000000_recentrage.sql ; Phénix : on repart à 15 000 W. Au plus une fois par semaine réelle : sans cette limite,
-- une faillite volontaire rapporterait 5 000 W à chaque fois (vu à la simulation des talents).
create or replace function restart() returns profiles
language plpgsql security definer set search_path = public as $$
declare tot float8; p profiles; ph boolean;
begin
  perform 1 from profiles where id = auth.uid() for update; -- deux faillites simultanées ne paient pas deux fois
  tot := bk_value(auth.uid());
  if tot is null then raise exception 'Connexion requise.'; end if;
  if tot >= 2000 then raise exception 'Tu n''es pas en faillite : revends d''abord tes objets si tu as besoin de W.'; end if;
  update bets set status = 'lost', payout = 0, closed_at = now() where user_id = auth.uid() and status = 'open';
  ph := tal_rank(auth.uid(), 'phenix') > 0 and coalesce((select phenix_at from profiles where id = auth.uid()), '-infinity') < now() - interval '7 days';
  update profiles set cash = case when ph then 15000 else 10000 end, bankruptcies = bankruptcies + 1,
                      phenix_at = case when ph then now() else phenix_at end
   where id = auth.uid() returning * into p;
  return p;
end $$;

-- ===== Rente =====
-- Fidélité : +5 % de salaire par rang (le plafond de 500 W monte d'autant).
create function salary_talent() returns trigger language plpgsql set search_path = public as $$
declare r int := tal_rank(new.user_id, 'fidelite');
begin
  if r > 0 and new.amount > 0 then update profiles set cash = cash + round(new.amount * .05 * r) where id = new.user_id; end if;
  return new;
end $$;
create trigger salary_talent after insert on salaries for each row execute function salary_talent();

-- Négociateur : −3 % par rang sur la boutique (la revente reste à 60 % du prix catalogue : pas d'aller-retour gagnant).
-- 20261007000000_qg.sql
create or replace function buy_item(p_item text) returns inventory language plpgsql security definer set search_path = public as $$
declare it shop_items; inv inventory; lvl int; price float8;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  select * into it from shop_items where id = p_item;
  if not found then raise exception 'Objet inconnu.'; end if;
  lvl := home_level(auth.uid());
  if it.kind <> 'bonus' and exists (select 1 from inventory where user_id = auth.uid() and item_id = p_item and qty > 0) then
    raise exception 'Tu l''as déjà.';
  end if;
  if it.kind = 'home' and it.level <> lvl + 1 then raise exception 'Il faut d''abord emménager dans le logement précédent.'; end if;
  if it.kind <> 'home' and it.level > lvl then raise exception 'Disponible à partir d''un logement plus grand.'; end if;
  price := round(it.price * (1 - .03 * tal_rank(auth.uid(), 'negociateur')));
  update profiles set cash = cash - price where id = auth.uid() and cash >= price;
  if not found then raise exception 'Solde insuffisant.'; end if;
  insert into inventory (user_id, item_id, qty) values (auth.uid(), p_item, 1)
    on conflict (user_id, item_id) do update set qty = inventory.qty + 1, bought_at = now();
  if it.kind = 'cosmetic' then perform equip_item(p_item); end if;
  select * into inv from inventory where user_id = auth.uid() and item_id = p_item;
  return inv;
end $$;

-- Argent passif (10 → 100 W par jour réel, si connecté dans les dernières 24 h), doublé par Rentier si une position
-- Aurelys gagnante a été clôturée la veille. Une fois par jour (heure de Paris), au premier passage après minuit.
create table talent_day (id int primary key default 1 check (id = 1), day date not null);
alter table talent_day enable row level security;
create function talent_daily() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if (select day from talent_day) >= paris_day() then return 0; end if;
  insert into talent_day values (1, paris_day()) on conflict (id) do update set day = excluded.day where talent_day.day < excluded.day;
  if not found then return 0; end if;
  update profiles p set cash = cash + (array[10, 20, 30, 50, 70, 100])[t.rank]
      * case when tal_rank(p.id, 'rentier') > 0 and exists (select 1 from bets b where b.user_id = p.id and b.kind = 'aurelys' and b.status = 'won'
               and b.closed_at >= day_start() - interval '1 day' and b.closed_at < day_start()) then 2 else 1 end
    from talents t where t.user_id = p.id and t.code = 'passif' and p.last_seen > now() - interval '24 hours' and not p.bot;
  get diagnostics n = row_count;
  return n;
end $$;

-- 20261026500000_banque.sql ; Dividendes : +5 % par rang. Appelle aussi la rente quotidienne.
create or replace function aur_dividends() returns int language plpgsql security definer set search_path = public as $$
declare today int := floor((extract(epoch from now()) - 1790812800) / 3600)::int; last int; n int := 0; r record; pay float8;
begin
  perform talent_daily();
  if (select day from aur_div_day) >= today then return 0; end if;
  select day into last from aur_div_day for update;
  if last is null then insert into aur_div_day values (1, today); return 0; end if;
  if last >= today then return 0; end if;
  update aur_div_day set day = today where id = 1;
  for r in select h.user_id, h.tk, h.qty, s.div from aur_holdings h join aur_stocks s on s.tk = h.tk where h.qty > 0 and s.div > 0 and s.status = 'core' loop
    pay := r.qty * coalesce((aur_last(r.tk)).p, 0) * r.div / 100 / 365 * (1 + .05 * tal_rank(r.user_id, 'dividendes'));
    if pay > 0 then update profiles set cash = cash + pay where id = r.user_id; n := n + 1; end if;
  end loop;
  update profiles set bank = bank + round((least(bank, 100000) * 0.001)::numeric, 2) where bank > 0;
  return n;
end $$;

-- ===== Information =====
-- 20261012000000_villes.sql ; Avant-première : +3, +6 puis +10 s.
create or replace function news_lead() returns interval language sql stable security definer set search_path = public as $$
  select make_interval(secs => 25 * city_level(auth.uid(), 'presse') + (array[0, 3, 6, 10])[tal_rank(auth.uid(), 'avant') + 1])
$$;

-- Initié : révisions du consensus décidées par le moteur 1 h d'Aurelys (150 s) avant leur publication. Table cachée ;
-- aur_insider() ne les montre qu'aux initiés, et seulement une fois décidées (t0 passé).
create table aur_revisions (id bigint generated always as identity primary key, tk text not null, t0 timestamptz not null, t timestamptz not null, title text not null);
create index on aur_revisions (t);
alter table aur_revisions enable row level security;
create function aur_insider() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tk', tk, 't', extract(epoch from t), 'title', title) order by t), '[]')
  from aur_revisions where tal_rank(auth.uid(), 'initie') > 0 and t0 <= now() and t > now()
$$;
revoke execute on function aur_insider() from public, anon;
grant execute on function aur_insider() to authenticated;

-- 20261027100000_rumeurs.sql ; les révisions annoncées (pre) vont dans aur_revisions, pas dans le Courrier.
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
  insert into aur_revisions (tk, t0, t, title)
  select r.tk, to_timestamp(r.t0), to_timestamp(r.t), r.title from jsonb_to_recordset(p_news) as r(t bigint, t0 bigint, tk text, title text, pre boolean) where r.pre;
  delete from aur_rumors where t < now() - interval '8 days';
  delete from aur_revisions where t < now() - interval '1 day';
end $$;

-- 20261027100000_rumeurs.sql ; Flair : indice de fiabilité d'une rumeur en cours, juste 60, 65 ou 70 % du temps
-- (tirage fixe par rumeur et par rang : le relire ne change rien).
create or replace function aur_rumor_list() returns jsonb language sql stable security definer set search_path = public as $$
  with v as (
    select r.*, r.res_t is not null and r.res_t <= now() + news_lead() as done,
           case when r.t > now() then null
                else (case when r.res_t <= now() then r.p1 else (aur_last(r.tk)).p end) / nullif(r.p0, 0) - 1 end as chg
    from aur_rumors r where r.t <= now() + news_lead() and r.t > now() - interval '7 days'
  ), f as (select tal_rank(auth.uid(), 'flair') as fr)
  select jsonb_build_object(
    'list', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'tk', tk, 't', extract(epoch from t), 'title', title, 'sent', sent,
              'chg', chg, 'status', case when not done then 'open' when ok then 'ok' else 'no' end,
              'res_t', case when done then extract(epoch from res_t) end,
              'flair', case when not done and f.fr > 0 then
                 case when ((abs(hashtext(id::text || ':' || f.fr)) % 1000) / 1000.0 < (array[.6, .65, .7])[f.fr]) = ok then 'credible' else 'douteuse' end end)
              order by t desc, id desc)
            from (select * from v order by t desc limit 300) x, f), '[]'),
    'stats', (select jsonb_build_object('n', count(*), 'ok', count(*) filter (where ok),
              'chg', avg(chg * sign(sent)) filter (where chg is not null and res_t <= now())) from v where done))
$$;

-- ===== Niveau au classement =====
drop function leaderboard();
create function leaderboard() returns table (id uuid, pseudo text, cash float8, patrimoine float8, bankruptcies int, home int, title text, level int)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo, p.cash, patrimoine(p.id), p.bankruptcies, home_level(p.id),
         (select s.name from inventory i join shop_items s on s.id = i.item_id
           where i.user_id = p.id and i.equipped and s.category = 'title' limit 1),
         case when p.bot then null else talent_level(p.tal_hwm) end
  from profiles p order by 4 desc limit 50
$$;
drop function gains_board(text, text);
create function gains_board(p_period text default 'today', p_scope text default 'all')
returns table (id uuid, pseudo text, title text, guild text, gain float8, bets int, level int)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo,
         (select s.name from inventory i join shop_items s on s.id = i.item_id
           where i.user_id = p.id and i.equipped and s.category = 'title' limit 1),
         (select g.tag from guild_members m join guilds g on g.id = m.guild_id where m.user_id = p.id),
         sum(bet_gain(b)), count(*)::int, case when p.bot then null else talent_level(p.tal_hwm) end
  from bets b join profiles p on p.id = b.user_id
  where b.status <> 'open'
    and (p_period = 'total' or b.closed_at >= day_start())
    and (p_scope = 'all'
      or (p_scope = 'friends' and (p.id = auth.uid() or p.id in (select friend_ids(auth.uid()))))
      or (p_scope = 'guild' and p.id in (select user_id from guild_members
            where guild_id = (select guild_id from guild_members where user_id = auth.uid()))))
  group by p.id order by 5 desc limit 50
$$;
revoke execute on function gains_board(text, text) from public, anon;
grant execute on function gains_board(text, text) to authenticated;
revoke execute on function talent_daily(), salary_talent(), talents_gain() from public, anon, authenticated;
