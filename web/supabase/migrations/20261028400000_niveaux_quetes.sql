-- H3 + H4 de la refonte « progression » (Victor, octobre 2026) : niveaux de trader, XP, levier par paliers, quêtes.
-- L'XP ne vient que des quêtes, de la série, du pari du jour (H5), du tutoriel, puis des succès (H8), des saisons (H6) et
-- des objectifs de guilde (H7) : jamais du P&L ni du nombre de trades. Tout est calculé ici, et rejouer ne double rien
-- (xp_log : une clé par gain ; quest_done : une ligne par quête et par période).
-- Valeurs partagées avec l'écran et les simulations : supabase/functions/_shared/progression.js (courbe calibrée par
-- scripts/sim-xp.mjs). tests/progression.test.js vérifie que la base et ce fichier disent la même chose.
-- Retour arrière : restaurer la sauvegarde d'avant le déploiement (C:\Users\rescue123\Claude\sauvegardes).

-- ===== Bornes de jour et de semaine (heure de Paris, changement d'heure compris) =====
create function paris_date(p_ts timestamptz) returns date language sql stable as $$ select (p_ts at time zone 'Europe/Paris')::date $$;
create function paris_day_start(p_d date) returns timestamptz language sql stable as $$ select p_d::timestamp at time zone 'Europe/Paris' $$;
create function paris_week(p_ts timestamptz) returns timestamptz language sql stable as $$
  select date_trunc('week', p_ts at time zone 'Europe/Paris') at time zone 'Europe/Paris'
$$;
create function paris_week_end(p_ts timestamptz) returns timestamptz language sql stable as $$
  select (date_trunc('week', p_ts at time zone 'Europe/Paris') + interval '7 days') at time zone 'Europe/Paris'
$$;

-- ===== XP et niveaux =====
create table xp_curve (level int primary key, xp int not null);
insert into xp_curve values
  (1, 0), (2, 40), (3, 120), (4, 220), (5, 330), (6, 570), (7, 850), (8, 1170), (9, 1530), (10, 1920),
  (11, 2350), (12, 2820), (13, 3420), (14, 4070), (15, 4770), (16, 5520), (17, 6320), (18, 7170), (19, 8070), (20, 9020),
  (21, 10020), (22, 11070), (23, 12170), (24, 13320), (25, 14520), (26, 15770), (27, 17050), (28, 18360), (29, 19710), (30, 21090),
  (31, 22500), (32, 23940), (33, 25420), (34, 26930), (35, 28470), (36, 30040), (37, 31640), (38, 33280), (39, 34950), (40, 36650),
  (41, 38370), (42, 40120), (43, 41890), (44, 43690), (45, 45510), (46, 47350), (47, 49220), (48, 51110), (49, 53020), (50, 54960),
  (51, 56920), (52, 58910), (53, 60920), (54, 62950), (55, 65010), (56, 67090), (57, 69190), (58, 71320), (59, 73470), (60, 75650),
  (61, 77850), (62, 80070), (63, 82310), (64, 84570), (65, 86850), (66, 89150), (67, 91470), (68, 93810), (69, 96170), (70, 98550),
  (71, 100950), (72, 103370), (73, 105810), (74, 108270), (75, 110750), (76, 113250), (77, 115770), (78, 118310), (79, 120870), (80, 123450),
  (81, 126050), (82, 128670), (83, 131310), (84, 133970), (85, 136650), (86, 139350), (87, 142070), (88, 144810), (89, 147570), (90, 150350),
  (91, 153150), (92, 155970), (93, 158810), (94, 161670), (95, 164550), (96, 167450), (97, 170370), (98, 173310), (99, 176270), (100, 179250);
alter table xp_curve enable row level security;
create policy "courbe publique" on xp_curve for select using (true);

alter table profiles add column xp int not null default 0;
create table xp_log (
  id bigint generated always as identity primary key, user_id uuid not null references profiles on delete cascade,
  source text not null, key text not null, amount int not null check (amount > 0), at timestamptz not null default now(),
  unique (user_id, source, key)
);
alter table xp_log enable row level security;
create policy "mon XP" on xp_log for select using (user_id = auth.uid());

create function level_of(p_xp int) returns int language sql stable set search_path = public as $$
  select coalesce(max(level), 1) from xp_curve where xp <= p_xp
$$;
-- Le niveau de départ (lvl_floor, posé en H1) reste un plancher : un niveau ne baisse jamais.
create or replace function trader_level(p_user uuid) returns int language sql stable set search_path = public as $$
  select coalesce((select greatest(level_of(xp), lvl_floor) from profiles where id = p_user), 1)
$$;

-- Seule façon de gagner de l'XP. Une clé (source, key) ne rapporte qu'une fois ; pas d'XP pour les bots.
create function xp_grant(p_user uuid, p_source text, p_key text, p_amount int) returns boolean
language plpgsql security definer set search_path = public as $$
declare l0 int; l1 int;
begin
  if not (p_amount > 0) or coalesce((select bot from profiles where id = p_user), true) then return false; end if;
  insert into xp_log (user_id, source, key, amount) values (p_user, p_source, p_key, p_amount) on conflict do nothing;
  if not found then return false; end if;
  l0 := trader_level(p_user);
  update profiles set xp = xp + p_amount where id = p_user;
  l1 := trader_level(p_user);
  if l1 > l0 then insert into notices (user_id, kind, body) values (p_user, 'level', jsonb_build_object('from', l0, 'to', l1)); end if;
  return true;
end $$;
revoke execute on function xp_grant(uuid, text, text, int), level_of(int) from public, anon, authenticated;

-- Niveau de départ (H1) converti en XP avec la courbe finale : le niveau ne bouge pas.
select xp_grant(p.id, 'h1', 'niveau-depart', c.xp) from profiles p join xp_curve c on c.level = p.lvl_floor where not p.bot and p.lvl_floor > 1;

-- Tutoriel (première séance : niveau 2) : lire « Comment jouer », ouvrir une fiche (déclarés par l'écran), premier ordre.
create function tuto_done(p_step text) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_step not in ('howto', 'fiche') then raise exception 'Étape inconnue.'; end if;
  return xp_grant(auth.uid(), 'tuto', p_step, 10);
end $$;
create function tuto_ordre() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform xp_grant(new.user_id, 'tuto', 'ordre', 20);
  return null;
end $$;
create trigger tuto_ordre after insert on bets for each row when (new.kind = 'aurelys') execute function tuto_ordre();
revoke execute on function tuto_ordre() from public, anon, authenticated;

-- ===== Levier, positions, ordres à déclenchement =====
-- Levier maximal = min(plafond de la société, palier de niveau, palier de ligue). Plafond de la société : jeunes pousses ×5
-- (déclencheur bets_young_lev). Ligue : H6 ; d'ici là, tout le monde est en Bronze 1 (division 0).
alter table bets drop constraint bets_lev_check;
alter table bets add constraint bets_lev_check check (lev in (1, 2, 5, 10, 15, 20, 25)); -- ×25 : positions d'avant H1
create function lev_level(p_lev int) returns int language sql immutable as $$
  select case p_lev when 1 then 1 when 2 then 2 when 5 then 5 when 10 then 12 when 15 then 25 when 20 then 40 else 1000 end
$$;
create function lev_division(p_lev int) returns int language sql immutable as $$ select case when p_lev >= 20 then 12 when p_lev >= 15 then 9 else 0 end $$;
create function division_name(p_div int) returns text language sql immutable as $$
  select (array['Bronze 1', 'Bronze 2', 'Bronze 3', 'Argent 1', 'Argent 2', 'Argent 3', 'Or 1', 'Or 2', 'Or 3',
                'Platine 1', 'Platine 2', 'Platine 3', 'Diamant 1', 'Diamant 2', 'Diamant 3', 'Maître'])[p_div + 1]
$$;
create function player_division(p_user uuid) returns int language sql stable as $$ select 0 $$; -- remplacée en H6
-- Les bots ne sont pas des joueurs : leur levier (×1 à ×10) et leurs positions ne suivent pas les niveaux.
create or replace function aur_max_lev(p_user uuid) returns int language sql stable security definer set search_path = public as $$
  select case when (select bot from profiles where id = p_user) then 20 else
    (select coalesce(max(v), 1) from unnest(array[1, 2, 5, 10, 15, 20]) v
      where trader_level(p_user) >= lev_level(v) and player_division(p_user) >= lev_division(v)) end
$$;
create or replace function aur_max_pos(p_user uuid) returns int language sql stable set search_path = public as $$
  select case when (select bot from profiles where id = p_user) then 12 else least(25, 5 + (trader_level(p_user) - 1) / 2) end
$$;
-- Pourquoi un levier est refusé (même texte à l'écran : « Débloqué au niveau N / en ligue X »).
create function lev_refusal(p_user uuid, p_lev int) returns text language sql stable set search_path = public as $$
  select case when trader_level(p_user) < lev_level(p_lev) then format('Levier ×%s : débloqué au niveau %s (tu es niveau %s).', p_lev, lev_level(p_lev), trader_level(p_user))
              else format('Levier ×%s : réservé à la ligue %s ou plus.', p_lev, division_name(lev_division(p_lev))) end
$$;

create or replace function aur_open(p_user uuid, p_tk text, p_dir text, p_lev int, p_stake float8, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets; k aur_ticks; s aur_stocks; fee float8; px float8; expo float8; mx int;
begin
  select * into s from aur_stocks where tk = p_tk;
  if not found then raise exception 'Action inconnue.'; end if;
  if p_dir not in ('up', 'down') or p_lev not in (1, 2, 5, 10, 15, 20) or not (p_stake > 0) then raise exception 'Ordre invalide.'; end if;
  if p_lev > aur_max_lev(p_user) then raise exception '%', lev_refusal(p_user, p_lev); end if;
  mx := aur_max_pos(p_user);
  if (select count(*) from bets where user_id = p_user and kind = 'aurelys' and status = 'open') >= mx then
    raise exception 'Au plus % positions ouvertes en même temps à ton niveau.', mx;
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

-- Ordres à déclenchement : niveau 10.
create or replace function aur_trigger_add(p_tk text, p_dir text, p_lev int, p_stake float8, p_px float8) returns aur_triggers
language plpgsql security definer set search_path = public as $$
declare k aur_ticks; r aur_triggers; mx int;
begin
  if trader_level(auth.uid()) < 10 then raise exception 'Les ordres à déclenchement se débloquent au niveau 10.'; end if;
  if not exists (select 1 from aur_stocks where tk = p_tk) then raise exception 'Action inconnue.'; end if;
  if p_dir not in ('up', 'down') or p_lev not in (1, 2, 5, 10, 15, 20) or not (p_stake > 0) or not (p_px > 0) then raise exception 'Ordre invalide.'; end if;
  if p_lev > aur_max_lev(auth.uid()) then raise exception '%', lev_refusal(auth.uid(), p_lev); end if;
  if (select count(*) from aur_triggers where user_id = auth.uid() and status = 'wait') >= 10 then raise exception 'Au plus 10 ordres en attente.'; end if;
  mx := aur_max_pos(auth.uid());
  if (select count(*) from bets where user_id = auth.uid() and kind = 'aurelys' and status = 'open')
     + (select count(*) from aur_triggers where user_id = auth.uid() and status = 'wait') >= mx then
    raise exception 'Au plus % positions ouvertes ou en attente à ton niveau.', mx;
  end if;
  k := aur_last(p_tk);
  if k.t is null then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  if abs(p_px / k.p - 1) < 0.001 then raise exception 'Seuil trop proche du cours : ouvre la position directement.'; end if;
  insert into aur_triggers (user_id, tk, dir, lev, stake, px, above)
  values (auth.uid(), p_tk, p_dir, p_lev, p_stake, p_px, p_px > k.p) returning * into r;
  return r;
end $$;

-- Conditions de l'ordre et progression, pour l'écran.
create or replace function my_terms() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('fee', aur_fee_rate(p.id), 'cut', 1, 'kraken', false, 'max_pos', aur_max_pos(p.id), 'max_lev', aur_max_lev(p.id),
                            'stop', true, 'triggers', trader_level(p.id) >= 10, 'level', trader_level(p.id), 'xp', p.xp,
                            'division', player_division(p.id))
  from profiles p where p.id = auth.uid()
$$;
alter table profiles drop column trig_ok;

-- Créer une guilde : niveau 8 (20261010000000_social.sql).
create or replace function guild_create(p_name text, p_tag text, p_motto text default null) returns guilds
language plpgsql security definer set search_path = public as $$
declare g guilds;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if trader_level(auth.uid()) < 8 and not coalesce((select bot from profiles where id = auth.uid()), false) then
    raise exception 'Créer une guilde : niveau 8 de trader (tu es niveau %).', trader_level(auth.uid());
  end if;
  if exists (select 1 from guild_members where user_id = auth.uid()) then raise exception 'Quitte d''abord ta guilde.'; end if;
  if exists (select 1 from guilds where lower(name) = lower(trim(p_name)) or tag = upper(trim(p_tag))) then raise exception 'Ce nom ou ce sigle est déjà pris.'; end if;
  insert into guilds (name, tag, motto, owner) values (trim(p_name), upper(trim(p_tag)), nullif(trim(p_motto), ''), auth.uid()) returning * into g;
  insert into guild_members (user_id, guild_id) values (auth.uid(), g.id);
  return g;
end $$;

-- ===== Quêtes =====
create table quest_defs (code text primary key, period text not null check (period in ('day', 'week')),
  tier text not null check (tier in ('easy', 'medium', 'hard')), goal int not null, needs text, text text not null);
insert into quest_defs (code, period, tier, goal, needs, text) values
  ('trade_1', 'day', 'easy', 1, null, 'Clôturer un trade valide'),
  ('stop_1', 'day', 'easy', 1, null, 'Poser un stop ou un objectif sur une position'),
  ('read_2', 'day', 'easy', 2, null, 'Lire 2 articles du Courrier'),
  ('pari_vote', 'day', 'easy', 1, 'pari', 'Voter au pari du jour'),
  ('invest_1', 'day', 'easy', 1, null, 'Acheter des actions (Investir)'),
  ('hold_10', 'day', 'easy', 1, null, 'Tenir une position 10 minutes, puis la clôturer'),
  ('trade_3co', 'day', 'medium', 3, null, 'Trader 3 sociétés différentes'),
  ('win_1', 'day', 'medium', 1, null, 'Clôturer un trade valide gagnant'),
  ('real_1', 'day', 'medium', 1, null, 'Trader une société liée aux données réelles (Granterre, Helvane, Lumirue)'),
  ('news_trade', 'day', 'medium', 1, null, 'Lire une actualité, puis trader la même société dans l''heure'),
  ('trade_5', 'day', 'medium', 5, null, 'Clôturer 5 trades valides'),
  ('short_1', 'day', 'medium', 1, null, 'Clôturer un trade valide à la baisse (▼)'),
  ('hold_30', 'day', 'medium', 1, null, 'Tenir une position 30 minutes, puis la clôturer'),
  ('guild_win', 'day', 'medium', 2, 'guild', 'Clôturer 2 trades gagnants pour l''objectif de ta guilde'),
  ('win_3', 'day', 'hard', 3, null, 'Clôturer 3 trades valides gagnants'),
  ('trade_5co', 'day', 'hard', 5, null, 'Trader 5 sociétés différentes'),
  ('gain_10', 'day', 'hard', 1, null, 'Un trade valide à +10 % sur la mise'),
  ('real_3', 'day', 'hard', 3, null, 'Clôturer 3 trades valides sur des sociétés liées aux données réelles'),
  ('lev10_win', 'day', 'hard', 1, 'lev10', 'Clôturer un trade valide gagnant à ×10'),
  ('news_trade_2', 'day', 'hard', 2, null, 'Deux fois : lire une actualité, puis trader la même société dans l''heure'),
  ('trade_10', 'day', 'hard', 10, null, 'Clôturer 10 trades valides'),
  ('results', 'day', 'hard', 1, null, 'Ouvrir une position avant des résultats et la clôturer après, en gain'),
  ('w_trade_15', 'week', 'easy', 15, null, 'Clôturer 15 trades valides'),
  ('w_days_3', 'week', 'easy', 3, null, 'Trader 3 jours différents'),
  ('w_read_15', 'week', 'easy', 15, null, 'Lire 15 articles du Courrier'),
  ('w_stop_5', 'week', 'easy', 5, null, 'Clôturer 5 trades valides avec un stop ou un objectif posé'),
  ('w_win_8', 'week', 'medium', 8, null, 'Clôturer 8 trades valides gagnants'),
  ('w_co_8', 'week', 'medium', 8, null, 'Trader 8 sociétés différentes'),
  ('w_quests_10', 'week', 'medium', 10, null, 'Réussir 10 quêtes du jour'),
  ('w_pari_5', 'week', 'medium', 5, 'pari', 'Voter 5 fois au pari du jour'),
  ('w_guild_10', 'week', 'medium', 10, 'guild', 'Clôturer 10 trades gagnants pour l''objectif de ta guilde'),
  ('w_days_5', 'week', 'hard', 5, null, 'Trader 5 jours différents'),
  ('w_trade_40', 'week', 'hard', 40, null, 'Clôturer 40 trades valides'),
  ('w_real_10', 'week', 'hard', 10, null, 'Clôturer 10 trades valides sur des sociétés liées aux données réelles'),
  ('w_win_20', 'week', 'hard', 20, null, 'Clôturer 20 trades valides gagnants');
alter table quest_defs enable row level security;
create policy "catalogue des quêtes" on quest_defs for select using (true);
create table quest_done (user_id uuid references profiles on delete cascade, pkey text, code text references quest_defs,
  done_at timestamptz not null default now(), primary key (user_id, pkey, code));
create table quest_chests (user_id uuid references profiles on delete cascade, week date, opened_at timestamptz, primary key (user_id, week));
alter table quest_done enable row level security;
alter table quest_chests enable row level security;
create policy "mes quêtes" on quest_done for select using (user_id = auth.uid());
create policy "mes coffres" on quest_chests for select using (user_id = auth.uid());

-- Actions comptées par les quêtes et que rien d'autre ne garde : stop ou objectif posé, achat d'actions.
create table player_events (user_id uuid references profiles on delete cascade, kind text not null, at timestamptz not null default now());
create index on player_events (user_id, at);
alter table player_events enable row level security;
-- Lectures d'articles : l'heure et la société (les articles ne sont gardés que 2 h).
alter table news_reads add column at timestamptz, add column tk text;
alter table news_reads alter column at set default now();

create function quest_xp(p_period text, p_tier text) returns int language sql immutable as $$
  select case p_period when 'day' then case p_tier when 'easy' then 30 when 'medium' then 50 else 80 end
                       else case p_tier when 'easy' then 150 when 'medium' then 250 else 400 end end
$$;
-- Conditions : « lev10 » (×10 débloqué), « guild » (membre d'une guilde), « pari » (toujours : un pari chaque jour).
create function quest_ok(p_user uuid, p_needs text) returns boolean language sql stable set search_path = public as $$
  select case p_needs when 'lev10' then aur_max_lev(p_user) >= 10
                      when 'guild' then exists (select 1 from guild_members where user_id = p_user) else true end
$$;
-- Quêtes du joueur : le même tirage pour tous un jour donné (ordre fixé par la date), puis la première quête faisable de
-- chaque difficulté ; une 2e moyenne dès le niveau 20. Semaine : une quête par difficulté.
create function quests_of(p_user uuid, p_ts timestamptz default now())
returns table (code text, period text, tier text, goal int, pkey text, t0 timestamptz, t1 timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare d date := paris_date(p_ts); w timestamptz := paris_week(p_ts); wd date := paris_date(paris_week(p_ts)); lvl int := trader_level(p_user); r record;
begin
  for r in select x.tier, x.n from (values ('easy', 1), ('medium', case when lvl >= 20 then 2 else 1 end), ('hard', 1)) x(tier, n) loop
    return query select q.code, q.period, q.tier, q.goal, d::text, paris_day_start(d), paris_day_start(d + 1)
      from quest_defs q where q.period = 'day' and q.tier = r.tier and quest_ok(p_user, q.needs)
      order by md5(d::text || q.code) limit r.n;
  end loop;
  return query select z.code, z.period, z.tier, z.goal, z.pkey, z.t0, z.t1 from (
    select distinct on (q.tier) q.code, q.period, q.tier, q.goal, 'w' || wd as pkey, w as t0, paris_week_end(p_ts) as t1,
           case q.tier when 'easy' then 1 when 'medium' then 2 else 3 end as o
      from quest_defs q where q.period = 'week' and quest_ok(p_user, q.needs)
     order by q.tier, md5(wd::text || q.code)) z order by z.o;
end $$;

-- Progression d'une quête sur [p_t0, p_t1[ : tout se relit dans les données (paris, lectures, actions, votes).
create function quest_progress(p_user uuid, p_code text, p_t0 timestamptz, p_t1 timestamptz) returns int
language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  if p_code in ('stop_1') then
    select count(*) into n from player_events where user_id = p_user and kind = 'auto' and at >= p_t0 and at < p_t1;
  elsif p_code = 'invest_1' then
    select count(*) into n from player_events where user_id = p_user and kind = 'buy' and at >= p_t0 and at < p_t1;
  elsif p_code in ('read_2', 'w_read_15') then
    select count(*) into n from news_reads where user_id = p_user and at >= p_t0 and at < p_t1;
  elsif p_code in ('pari_vote', 'w_pari_5') then
    select count(*) into n from aur_pari_vote where user_id = p_user and voted_at >= p_t0 and voted_at < p_t1;
  elsif p_code = 'w_quests_10' then
    select count(*) into n from quest_done d join quest_defs q on q.code = d.code
     where d.user_id = p_user and q.period = 'day' and d.done_at >= p_t0 and d.done_at < p_t1;
  elsif p_code in ('news_trade', 'news_trade_2') then
    select count(*) into n from bets b where b.user_id = p_user and b.kind = 'aurelys' and b.created_at >= p_t0 and b.created_at < p_t1
       and exists (select 1 from news_reads r where r.user_id = p_user and r.tk = b.aur and r.at <= b.created_at and r.at > b.created_at - interval '1 hour');
  else
    with v as (select b.*, ach_net(b) as g from bets b
                where b.user_id = p_user and b.kind = 'aurelys' and b.status <> 'open' and b.closed_at >= p_t0 and b.closed_at < p_t1
                  and b.stake >= 100 and b.closed_at - b.created_at >= interval '150 seconds')
    select case
      when p_code in ('trade_1', 'trade_5', 'trade_10', 'w_trade_15', 'w_trade_40') then count(*)
      when p_code in ('win_1', 'win_3', 'w_win_8', 'w_win_20') then count(*) filter (where g > 0)
      when p_code in ('trade_3co', 'trade_5co', 'w_co_8') then count(distinct aur)
      when p_code in ('real_1', 'real_3', 'w_real_10') then count(*) filter (where aur in ('GTR', 'HLV', 'LMR'))
      when p_code = 'short_1' then count(*) filter (where dir = 'down')
      when p_code = 'hold_10' then count(*) filter (where closed_at - created_at >= interval '10 minutes')
      when p_code = 'hold_30' then count(*) filter (where closed_at - created_at >= interval '30 minutes')
      when p_code = 'gain_10' then count(*) filter (where g >= .1 * stake)
      when p_code = 'lev10_win' then count(*) filter (where lev >= 10 and g > 0)
      when p_code = 'results' then count(*) filter (where g > 0 and exists (select 1 from aur_results r where r.tk = v.aur and r.t > v.created_at and r.t < v.closed_at))
      when p_code in ('guild_win', 'w_guild_10') then count(*) filter (where g > 0 and exists (select 1 from guild_members m where m.user_id = p_user and m.joined_at <= v.closed_at))
      when p_code in ('w_days_3', 'w_days_5') then count(distinct paris_date(closed_at))
      when p_code = 'w_stop_5' then count(*) filter (where sl is not null or tp is not null)
      else 0 end into n from v;
  end if;
  return coalesce(n, 0);
end $$;

-- Série : jours de suite avec au moins une quête du jour réussie ; un jour manqué par semaine est pardonné. Le jour en
-- cours ne casse rien tant qu'il n'est pas fini.
create function quest_streak(p_user uuid, p_today date default null) returns table (len int, start date)
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_today, paris_date(now())); first date; graced date[] := '{}'; l int := 0; s date;
begin
  select min(q.pkey::date) into first from quest_done q join quest_defs x on x.code = q.code where q.user_id = p_user and x.period = 'day';
  if first is null then return query select 0, null::date; return; end if;
  if not exists (select 1 from quest_done q where q.user_id = p_user and q.pkey = d::text) then d := d - 1; end if;
  while d >= first loop
    if exists (select 1 from quest_done q where q.user_id = p_user and q.pkey = d::text) then l := l + 1; s := d;
    elsif date_trunc('week', d)::date = any(graced) then exit;
    else graced := graced || date_trunc('week', d)::date;
    end if;
    d := d - 1;
  end loop;
  return query select l, s;
end $$;

-- Vérifie les quêtes du moment d'un joueur ; idempotent (une quête réussie une fois par période, l'XP une fois par clé).
create function quests_check(p_user uuid, p_ts timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare q record; n int := 0; st record; w date := paris_date(paris_week(p_ts));
begin
  if coalesce((select bot from profiles where id = p_user), true) then return 0; end if;
  for q in select * from quests_of(p_user, p_ts) loop
    if exists (select 1 from quest_done d where d.user_id = p_user and d.pkey = q.pkey and d.code = q.code) then continue; end if;
    if quest_progress(p_user, q.code, q.t0, q.t1) >= q.goal then
      insert into quest_done (user_id, pkey, code) values (p_user, q.pkey, q.code) on conflict do nothing;
      if found then
        perform xp_grant(p_user, 'quest', q.pkey || ':' || q.code, quest_xp(q.period, q.tier));
        insert into notices (user_id, kind, body) values (p_user, 'quest', jsonb_build_object('code', q.code, 'xp', quest_xp(q.period, q.tier)));
        n := n + 1;
      end if;
    end if;
  end loop;
  -- Coffre cosmétique (ouvert avec le profil, H2) : les 3 quêtes de la semaine réussies.
  if (select count(*) from quest_done d join quest_defs x on x.code = d.code where d.user_id = p_user and d.pkey = 'w' || w and x.period = 'week') >= 3 then
    insert into quest_chests (user_id, week) values (p_user, w) on conflict do nothing;
  end if;
  select * into st from quest_streak(p_user, paris_date(p_ts));
  if st.len >= 3 then perform xp_grant(p_user, 'streak', st.start || ':3', 50); end if;
  if st.len >= 7 then perform xp_grant(p_user, 'streak', st.start || ':7', 150); end if;
  if st.len >= 30 then perform xp_grant(p_user, 'streak', st.start || ':30', 500); end if;
  return n;
end $$;
revoke execute on function quests_check(uuid, timestamptz), quests_of(uuid, timestamptz), quest_progress(uuid, text, timestamptz, timestamptz),
  quest_streak(uuid, date) from public, anon, authenticated;

-- À la clôture d'une position (après les succès).
create function zzz_quests() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform quests_check(new.user_id);
  return null;
end $$;
create trigger zzz_quests after update on bets for each row
  when (old.status = 'open' and new.status <> 'open' and new.kind = 'aurelys') execute function zzz_quests();
revoke execute on function zzz_quests() from public, anon, authenticated;

-- Écran Quêtes (vérifie d'abord, pour que la barre soit à jour).
create function my_quests() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); lv int; st record;
begin
  if u is null then raise exception 'Connexion requise.'; end if;
  perform quests_check(u);
  lv := trader_level(u);
  select * into st from quest_streak(u);
  return jsonb_build_object(
    'level', lv, 'xp', (select xp from profiles where id = u),
    'from', (select xp from xp_curve where level = lv), 'next', (select xp from xp_curve where level = lv + 1),
    'streak', st.len, 'day_end', extract(epoch from paris_day_start(paris_date(now()) + 1)), 'week_end', extract(epoch from paris_week_end(now())),
    'chest', exists (select 1 from quest_chests where user_id = u and week = paris_date(paris_week(now()))),
    'quests', coalesce((select jsonb_agg(jsonb_build_object('code', q.code, 'period', q.period, 'tier', q.tier, 'goal', q.goal,
                'cur', least(q.goal, quest_progress(u, q.code, q.t0, q.t1)), 'xp', quest_xp(q.period, q.tier),
                'done', exists (select 1 from quest_done d where d.user_id = u and d.pkey = q.pkey and d.code = q.code)))
              from quests_of(u) q), '[]'));
end $$;
revoke execute on function my_quests(), tuto_done(text) from public, anon;
grant execute on function my_quests(), tuto_done(text) to authenticated;

-- Événements comptés par les quêtes (20261028300000_suppressions.sql).
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
  if p_sl is not null or p_tp is not null then insert into player_events (user_id, kind) values (auth.uid(), 'auto'); end if;
  return b;
end $$;
create function player_buy_event() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.qty > coalesce(old.qty, 0) then insert into player_events (user_id, kind) values (new.user_id, 'buy'); end if;
  return null;
end $$;
create trigger player_buy_event after insert or update on aur_holdings for each row execute function player_buy_event();
revoke execute on function player_buy_event() from public, anon, authenticated;
-- 20261027300000_succes.sql : + heure et société de la lecture.
create or replace function article_read(p_id bigint) returns void language plpgsql security definer set search_path = public as $$
declare tk text;
begin
  select n.tk into tk from aur_news n where n.id = p_id and n.t <= now() + news_lead();
  if not found then return; end if;
  insert into news_reads (user_id, news_id, at, tk) values (auth.uid(), p_id, now(), tk) on conflict do nothing;
  if found and (select count(*) from news_reads where user_id = auth.uid()) >= 20 then perform achievement_grant(auth.uid(), 'LECTEUR'); end if;
end $$;

-- Chaque minute : quêtes des joueurs actifs (lectures, achats, stops : pas de déclencheur sur bets pour eux).
create function progress_tick() returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from profiles where not bot and last_seen > now() - interval '10 minutes' loop perform quests_check(r.id); end loop;
end $$;
revoke execute on function progress_tick() from public, anon, authenticated;

-- 20261027300000_succes.sql ; + quêtes (progress_tick).
create or replace function settle() returns int
language plpgsql security definer set search_path = public as $$
declare g record; r record; n int := 0; rc int; due boolean; ended timestamptz;
begin
  select * into g from game_now();
  -- Anciens modes (articles, duels, Live) : plus rien ne s'y ouvre, le règlement reste pour l'historique et les tests.
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
  for r in select x.user_id, x.session, least(500, round(0.1 * sum(x.counted) * salary_factor(x.user_id))) amt
             from (select b.user_id, b.session, b.aur,
                          least(sum(b.stake), abs(sum(case when b.dir = 'up' then 1 else -1 end * b.stake * b.lev))) counted
                     from bets b
                    where b.session >= g.k - 5 and (b.session < g.k or not g.playing) and b.kind = 'aurelys'
                      and coalesce(b.closed_at, now()) - b.created_at >= interval '150 seconds'
                      and not exists (select 1 from salaries s where s.user_id = b.user_id and s.session = b.session)
                    group by 1, 2, 3) x
            group by 1, 2 loop
    insert into salaries values (r.user_id, r.session, r.amt) on conflict do nothing;
    get diagnostics rc = row_count;
    if rc > 0 and r.amt > 0 then update profiles set cash = cash + r.amt where id = r.user_id; end if;
  end loop;
  perform referral_check();
  perform rank_snapshot();
  perform ach_tick();
  perform progress_tick();
  return n;
end $$;
