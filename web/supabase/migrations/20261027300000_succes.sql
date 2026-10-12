-- Succès (demande de Victor, octobre 2026) : 51 succès, 36 points de talent au plus, jamais de W. Chacun se débloque une
-- fois (aur_achievements, insertion idempotente). Tout est évalué ici : à la clôture d'une position (déclencheur
-- zz_achievements, après talents_gain), dans settle() (ach_tick, chaque minute) et sur quelques événements (logement,
-- guilde, salaire, talents, présence, lecture d'un article). Trade valide : mise ≥ 100 W et tenu ≥ 150 s ; une perte casse
-- une série même si le trade n'est pas valide. Succès en % : mise ≥ 1 000 W et levier ≤ ×5. Choix de Victor : INDICIEL =
-- gain dans le sens de l'AUR-12 (l'indice ne se négocie pas), TOUS_SECTEURS = les 13 sociétés permanentes, BANQUIER = la
-- banque perso du QG. Rétroactif pour ce que l'historique permet (ach_history) ; pas pour Sniper, Contrarien, Survivant,
-- Lecteur de surprises, Renaissance, Banquier, Lecteur, Fidèle, classements hebdomadaires.
-- Retour arrière : réappliquer settle, touch, aur_store, achievement_grant, my_talents, talent_points depuis leurs
-- migrations d'origine (indiquées), supprimer les tables et fonctions ach_*.

alter table user_achievements rename to aur_achievements;
alter table aur_achievements rename column at to unlocked_at;
alter table achievements drop constraint achievements_points_check;
alter table achievements add constraint achievements_points_check check (points between 0 and 3),
  add column cat text, add column ord int, add column goal float8, add column unit text,
  add column secret boolean not null default false, add column hint text;

insert into achievements (code, cat, ord, name, descr, points, goal, unit, secret, hint) values
  ('FIRST_TRADE', 'Premiers pas', 1, 'Premier ordre', 'Clôturer un trade valide (mise de 100 W ou plus, tenu 150 s ou plus)', 1, 1, 'trade valide', false, null),
  ('FIRST_GREEN', 'Premiers pas', 2, 'Dans le vert', 'Clôturer un trade valide en gain', 0, 1, 'trade gagnant', false, null),
  ('DIVERSIFIE', 'Premiers pas', 3, 'Diversifié', 'Avoir des positions ouvertes sur 5 sociétés différentes en même temps', 0, null, null, false, null),
  ('LECTEUR', 'Premiers pas', 4, 'Lecteur assidu', 'Ouvrir 20 articles du Courrier', 0, 20, 'articles', false, null),
  ('PROPRIO', 'Premiers pas', 5, 'Propriétaire', 'Acheter son premier logement (studio ou plus)', 0, null, null, false, null),
  ('GUILDE', 'Premiers pas', 6, 'Esprit de corps', 'Rejoindre une guilde', 0, null, null, false, null),
  ('SALAIRE', 'Premiers pas', 7, 'Fiche de paie', 'Toucher son premier salaire', 0, null, null, false, null),
  ('SERIE_5', 'Trading', 10, 'Série de 5', '5 trades valides gagnants d''affilée (une perte remet à zéro)', 1, 5, 'gagnants d''affilée', false, null),
  ('SERIE_10', 'Trading', 11, 'Série de 10', '10 trades valides gagnants d''affilée', 2, 10, 'gagnants d''affilée', false, null),
  ('COUP_50', 'Trading', 12, 'Coup de maître', 'Un trade à +50 % sur la mise (mise de 1 000 W ou plus, levier ×5 au plus)', 1, null, null, false, null),
  ('COUP_100', 'Trading', 13, 'Doublé', 'Un trade à +100 % sur la mise (mise de 1 000 W ou plus, levier ×5 au plus)', 2, null, null, false, null),
  ('SNIPER', 'Trading', 14, 'Sniper', 'Position ouverte moins de 10 min avant des résultats, clôturée après, en gain', 1, null, null, false, null),
  ('CONTRARIEN', 'Trading', 15, 'Contrarien', 'Gain à la hausse ouvert pendant la Nervosité, ou à la baisse pendant l''Euphorie', 1, null, null, false, null),
  ('MAIN_FER', 'Trading', 16, 'Main de fer', 'Trade valide tenu 24 h réelles ou plus, clôturé en gain', 1, null, null, false, null),
  ('SCALPEUR', 'Trading', 17, 'Habitué', '50 trades valides', 0, 50, 'trades valides', false, null),
  ('VETERAN', 'Trading', 18, 'Vétéran', '500 trades valides', 2, 500, 'trades valides', false, null),
  ('SANS_LEVIER', 'Trading', 19, 'Pied ferme', '10 trades valides gagnants à ×1', 0, 10, 'gagnants à ×1', false, null),
  ('DISCIPLINE', 'Trading', 20, 'Discipline', '20 trades valides clôturés avec un stop posé', 0, 20, 'trades avec stop', false, null),
  ('ASSIDU_7', 'Trading', 21, 'Semaine pleine', 'Au moins un trade valide par jour, 7 jours d''affilée', 1, 7, 'jours d''affilée', false, null),
  ('ASSIDU_30', 'Trading', 22, 'Mois plein', 'Au moins un trade valide par jour, 30 jours d''affilée', 2, 30, 'jours d''affilée', false, null),
  ('GAIN_10K', 'Gains de trading', 30, 'Premiers bénéfices', '10 000 W de gain net de trading (ton record)', 0, 10000, 'W', false, null),
  ('GAIN_50K', 'Gains de trading', 31, 'Rentable', '50 000 W de gain net de trading', 0, 50000, 'W', false, null),
  ('GAIN_100K', 'Gains de trading', 32, 'Trader confirmé', '100 000 W de gain net de trading', 1, 100000, 'W', false, null),
  ('GAIN_500K', 'Gains de trading', 33, 'Requin', '500 000 W de gain net de trading', 1, 500000, 'W', false, null),
  ('GAIN_1M', 'Gains de trading', 34, 'Millionnaire', '1 000 000 W de gain net de trading', 2, 1000000, 'W', false, null),
  ('PAT_250K', 'Patrimoine', 40, 'Aisé', '250 000 W de patrimoine', 0, 250000, 'W', false, null),
  ('PAT_1M', 'Patrimoine', 41, 'Fortune', '1 000 000 W de patrimoine', 1, 1000000, 'W', false, null),
  ('AGRONOME', 'Données réelles', 50, 'Agronome', '5 trades valides gagnants sur Granterre', 0, 5, 'gagnants', false, null),
  ('ELECTRICIEN', 'Données réelles', 51, 'Électricien', '5 trades valides gagnants sur Helvane', 0, 5, 'gagnants', false, null),
  ('FLANEUR', 'Données réelles', 52, 'Flâneur', '5 trades valides gagnants sur Lumirue', 0, 5, 'gagnants', false, null),
  ('FERIE', 'Données réelles', 53, 'Jour férié', 'Trade valide gagnant sur Lumirue, clôturé un jour férié', 1, null, null, false, null),
  ('INDICIEL', 'Indice et marché', 60, 'Indiciel', 'Trade valide gagnant dans le même sens que l''AUR-12 pendant la position', 0, null, null, false, null),
  ('TOUS_SECTEURS', 'Indice et marché', 61, 'Tour de la cote', 'Un trade valide gagnant sur chacune des 13 sociétés permanentes', 2, 13, 'sociétés', false, null),
  ('BIEN_INFORME', 'Information', 70, 'Bien informé', 'Gain sur une position ouverte moins de 10 min après une rumeur sur la même société', 0, null, null, false, null),
  ('SURPRISES', 'Information', 71, 'Lecteur de surprises', 'Gain sur 5 résultats « surprise » (position ouverte avant, clôturée après)', 1, 5, 'surprises', false, null),
  ('RENAISSANCE', 'Risque', 80, 'Renaissance', 'Après une liquidation, dépasser ton patrimoine d''avant', 1, null, null, false, null),
  ('SURVIVANT', 'Risque', 81, 'Sang-froid', 'Traverser toute une Nervosité avec une position ouverte, et la clôturer en gain', 0, null, null, false, null),
  ('ZERO_LIQ', 'Risque', 82, 'Gestion du risque', '100 trades valides sans aucune liquidation au milieu', 2, 100, 'trades sans liquidation', false, null),
  ('PARRAIN', 'Social', 90, 'Parrain', 'Un filleul validé', 1, 1, 'filleul', false, null),
  ('MENTOR', 'Social', 91, 'Mentor', '4 filleuls validés', 1, 4, 'filleuls', false, null),
  ('BANQUIER', 'Social', 92, 'Banquier', 'Garder 5 000 W ou plus à la banque du QG pendant 7 jours', 0, 7, 'jours', false, null),
  ('GUILDE_TOP3', 'Social', 93, 'Guilde d''élite', 'Ta guilde finit dans le top 3 d''une semaine', 1, null, null, false, null),
  ('TOP_100', 'Classements de la semaine', 100, 'Dans la course', 'Top 100 des gains de la semaine', 0, null, null, false, null),
  ('TOP_10', 'Classements de la semaine', 101, 'Élite', 'Top 10 des gains de la semaine', 1, null, null, false, null),
  ('CHAMPION', 'Classements de la semaine', 102, 'Champion de la semaine', 'Premier des gains de la semaine', 2, null, null, false, null),
  ('SPECIALISTE', 'Collection', 110, 'Spécialiste', 'Débloquer un talent ultime', 0, null, null, false, null),
  ('POLYVALENT', 'Collection', 111, 'Polyvalent', 'Au moins 5 points dans chacune des 4 branches de talents', 0, 5, 'points dans ta plus petite branche', false, null),
  ('COLLECTIONNEUR', 'Collection', 112, 'Collectionneur', '25 succès débloqués', 1, 25, 'succès', false, null),
  ('LEGENDE', 'Collection', 113, 'Légende', '45 succès débloqués', 2, 45, 'succès', false, null),
  ('NOCTAMBULE', 'Secrets', 120, 'Noctambule', 'Ouvrir un trade valide entre 2 h et 5 h du matin (heure de Paris)', 0, null, null, true, 'Les marchés ne dorment jamais'),
  ('FIDELE', 'Secrets', 121, 'Fidèle au poste', 'Venir 7 jours d''affilée', 0, 7, 'jours d''affilée', true, 'Toujours là');

-- Plafond de 36 points via les succès (20261027200000_talents.sql).
create or replace function talent_points(p_user uuid) returns int language sql stable set search_path = public as $$
  select talent_level(tal_hwm) + least(36, coalesce((select sum(a.points) from aur_achievements u join achievements a on a.code = u.code where u.user_id = p_user), 0))::int
         - coalesce((select sum(rank) from talents where user_id = p_user), 0)::int
  from profiles where id = p_user
$$;
create or replace function my_talents() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'level', talent_level(p.tal_hwm), 'hwm', p.tal_hwm, 'cum', p.tal_cum,
    'from', talent_threshold(talent_level(p.tal_hwm)), 'next', talent_threshold(talent_level(p.tal_hwm) + 1),
    'ach', least(36, coalesce((select sum(a.points) from aur_achievements u join achievements a on a.code = u.code where u.user_id = p.id), 0)),
    'spent', coalesce((select sum(rank) from talents where user_id = p.id), 0),
    'ranks', coalesce((select jsonb_object_agg(code, rank) from talents where user_id = p.id), '{}'),
    'resets', p.tal_resets, 'reset_cost', case when p.tal_resets = 0 then 0 else 5000 end,
    'kraken', jsonb_build_object('armed', p.kraken_armed, 'free', coalesce(p.kraken_day, -1) < aur_day()),
    'bot', p.bot)
  from profiles p where p.id = auth.uid()
$$;

-- Déblocage : une seule fois ; Collectionneur et Légende suivent le nombre de succès.
create or replace function achievement_grant(p_user uuid, p_code text) returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce((select bot from profiles where id = p_user), true) then return false; end if;
  insert into aur_achievements (user_id, code) values (p_user, p_code) on conflict do nothing;
  if not found then return false; end if;
  if p_code not in ('COLLECTIONNEUR', 'LEGENDE') then
    select count(*) into n from aur_achievements where user_id = p_user;
    if n >= 25 then perform achievement_grant(p_user, 'COLLECTIONNEUR'); end if;
    if n >= 45 then perform achievement_grant(p_user, 'LEGENDE'); end if;
  end if;
  return true;
end $$;
revoke execute on function achievement_grant(uuid, text) from public, anon, authenticated;

-- ===== Données gardées pour les succès =====
alter table profiles add column ach_streak int not null default 0, add column ach_zl int not null default 0,
  add column renais_target float8, add column bank_since timestamptz;
alter table bets add column reg_open text; -- humeur du marché à l'ouverture (Contrarien)
-- Résultats publiés (Sniper, surprises) et changements d'humeur du marché (Sang-froid) : écrits par aur_store, cachés.
create table aur_results (tk text not null, t timestamptz not null, surp boolean not null, primary key (tk, t));
create table aur_regimes (t timestamptz primary key, reg text not null);
create table news_reads (user_id uuid references profiles on delete cascade, news_id bigint, primary key (user_id, news_id));
create table presence_days (user_id uuid references profiles on delete cascade, day date, primary key (user_id, day));
create table ach_week (id int primary key default 1 check (id = 1), week timestamptz not null);
alter table aur_results enable row level security;
alter table aur_regimes enable row level security;
alter table news_reads enable row level security;
alter table presence_days enable row level security;
alter table ach_week enable row level security;

create function bets_reg_open() returns trigger language plpgsql set search_path = public as $$
begin
  new.reg_open := (select x->>'reg' from aur_ticks where tk = 'AUR12' and x is not null and t <= now() order by t desc limit 1);
  return new;
end $$;
create trigger bets_reg_open before insert on bets for each row when (new.kind = 'aurelys') execute function bets_reg_open();

-- Faillite : Renaissance repart de zéro. Banque : depuis quand on y garde 5 000 W ou plus.
create function ach_profile() returns trigger language plpgsql set search_path = public as $$
begin
  if new.bankruptcies > old.bankruptcies then new.renais_target := null; end if;
  if new.bank < 5000 then new.bank_since := null; elsif new.bank_since is null then new.bank_since := now(); end if;
  return new;
end $$;
create trigger ach_profile before update on profiles for each row execute function ach_profile();
update profiles set bank_since = now() where bank >= 5000;

-- 20261027200000_talents.sql : + résultats (aur_results) et humeurs du marché (aur_regimes).
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
  insert into aur_results (tk, t, surp)
  select r.tk, to_timestamp(r.t), coalesce(r.surp, false) from jsonb_to_recordset(p_news) as r(t bigint, tk text, cat text, surp boolean, pre boolean)
  where r.cat = 'resultats' and r.pre is null and r.tk is not null on conflict do nothing;
  with k as (select to_timestamp(r.t) as t, r.x->>'reg' as reg from jsonb_to_recordset(p_ticks) as r(t bigint, tk text, x jsonb) where r.tk = 'AUR12' and r.x ? 'reg'),
  l as (select t, reg, lag(reg) over (order by t) as prev from (select t, reg from k union all (select t, reg from aur_regimes order by t desc limit 1)) z)
  insert into aur_regimes select t, reg from l where prev is distinct from reg and t > coalesce((select max(t) from aur_regimes), '-infinity') on conflict do nothing;
  delete from aur_rumors where t < now() - interval '8 days';
  delete from aur_revisions where t < now() - interval '1 day';
  delete from aur_results where t < now() - interval '10 days';
  delete from aur_regimes where t < now() - interval '10 days' and t < (select max(t) from aur_regimes);
end $$;

-- ===== Évaluation =====
create function ach_valid(b bets) returns boolean language sql immutable as $$
  select b.kind = 'aurelys' and b.stake >= 100 and b.closed_at - b.created_at >= interval '150 seconds'
$$;
create function ach_net(b bets) returns float8 language sql immutable as $$
  select (case when b.insured then 0 else coalesce(b.payout, 0) end) - b.stake - coalesce(b.fees, 0)
$$;
create function ach_liq(b bets) returns boolean language sql immutable as $$
  select coalesce(b.closed_by = 'liq', false) or coalesce(b.insured, false) or (b.status = 'lost' and coalesce(b.payout, 0) = 0 and b.exit is not null)
$$;
-- Cours d'une action (ou de l'indice) à un instant : dernier cours, sinon clôture de la dernière bougie.
create function aur_px_at(p_tk text, p_t timestamptz) returns float8 language sql stable set search_path = public as $$
  select coalesce((select p from aur_ticks where tk = p_tk and t <= p_t order by t desc limit 1),
                  (select c from aur_candles where tk = p_tk and t <= p_t order by t desc limit 1))
$$;
-- Jours fériés de France métropolitaine (Pâques : algorithme de Meeus).
create function fr_holiday(d date) returns boolean language plpgsql immutable as $$
declare y int := extract(year from d); a int; b int; c int; dd int; e int; f int; g int; h int; i int; k int; l int; m int; easter date;
begin
  if to_char(d, 'MM-DD') in ('01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25') then return true; end if;
  a := y % 19; b := y / 100; c := y % 100; dd := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - dd - g + 15) % 30; i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  easter := make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
  return d in (easter + 1, easter + 39, easter + 50);
end $$;

-- Compteurs d'un joueur (trades valides de son historique), pour les succès et pour la progression à l'écran.
create function ach_stats(u uuid) returns jsonb language sql stable set search_path = public as $$
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
    'unlocked', (select count(*) from aur_achievements where user_id = u),
    'branch_min', (select coalesce(min(s), 0) from (select d.branch, coalesce(sum(t.rank) filter (where not d.ultimate), 0) as s
                    from talent_defs d left join talents t on t.code = d.code and t.user_id = u group by d.branch) z))
$$;

-- Succès fondés sur des compteurs (après une clôture, et une fois pour l'historique).
create function ach_counts(u uuid) returns void language plpgsql set search_path = public as $$
declare s jsonb := ach_stats(u); v int := (s->>'valid')::int;
begin
  if v >= 1 then perform achievement_grant(u, 'FIRST_TRADE'); end if;
  if (s->>'wins')::int >= 1 then perform achievement_grant(u, 'FIRST_GREEN'); end if;
  if v >= 50 then perform achievement_grant(u, 'SCALPEUR'); end if;
  if v >= 500 then perform achievement_grant(u, 'VETERAN'); end if;
  if (s->>'x1')::int >= 10 then perform achievement_grant(u, 'SANS_LEVIER'); end if;
  if (s->>'stops')::int >= 20 then perform achievement_grant(u, 'DISCIPLINE'); end if;
  if (s->>'GTR')::int >= 5 then perform achievement_grant(u, 'AGRONOME'); end if;
  if (s->>'HLV')::int >= 5 then perform achievement_grant(u, 'ELECTRICIEN'); end if;
  if (s->>'LMR')::int >= 5 then perform achievement_grant(u, 'FLANEUR'); end if;
  if (s->>'sectors')::int >= (select count(*) from aur_stocks where status = 'core') then perform achievement_grant(u, 'TOUS_SECTEURS'); end if;
  if (s->>'surprises')::int >= 5 then perform achievement_grant(u, 'SURPRISES'); end if;
  if (s->>'days_best')::int >= 7 then perform achievement_grant(u, 'ASSIDU_7'); end if;
  if (s->>'days_best')::int >= 30 then perform achievement_grant(u, 'ASSIDU_30'); end if;
end $$;

-- Gains de trading (record), patrimoine, Renaissance.
create function ach_wealth(u uuid) returns void language plpgsql set search_path = public as $$
declare h float8; tgt float8; pat float8;
begin
  select tal_hwm, renais_target into h, tgt from profiles where id = u and not bot;
  if not found then return; end if;
  if h >= 10000 then perform achievement_grant(u, 'GAIN_10K'); end if;
  if h >= 50000 then perform achievement_grant(u, 'GAIN_50K'); end if;
  if h >= 100000 then perform achievement_grant(u, 'GAIN_100K'); end if;
  if h >= 500000 then perform achievement_grant(u, 'GAIN_500K'); end if;
  if h >= 1000000 then perform achievement_grant(u, 'GAIN_1M'); end if;
  pat := patrimoine(u);
  if pat >= 250000 then perform achievement_grant(u, 'PAT_250K'); end if;
  if pat >= 1000000 then perform achievement_grant(u, 'PAT_1M'); end if;
  if tgt is not null and pat > tgt then perform achievement_grant(u, 'RENAISSANCE'); update profiles set renais_target = null where id = u; end if;
end $$;

-- Succès d'un trade valide pris seul.
create function ach_trade(b bets) returns void language plpgsql set search_path = public as $$
declare u uuid := b.user_id; g float8 := ach_net(b); i0 float8; i1 float8;
begin
  if extract(hour from b.created_at at time zone 'Europe/Paris') between 2 and 4 then perform achievement_grant(u, 'NOCTAMBULE'); end if;
  if g <= 0 then return; end if;
  if b.stake >= 1000 and b.lev <= 5 and g >= .5 * b.stake then perform achievement_grant(u, 'COUP_50'); end if;
  if b.stake >= 1000 and b.lev <= 5 and g >= b.stake then perform achievement_grant(u, 'COUP_100'); end if;
  if b.closed_at - b.created_at >= interval '24 hours' then perform achievement_grant(u, 'MAIN_FER'); end if;
  if b.aur = 'LMR' and fr_holiday((b.closed_at at time zone 'Europe/Paris')::date) then perform achievement_grant(u, 'FERIE'); end if;
  i0 := aur_px_at('AUR12', b.created_at); i1 := aur_px_at('AUR12', b.closed_at);
  if i0 > 0 and i1 is not null and (case when b.dir = 'up' then i1 > i0 else i1 < i0 end) then perform achievement_grant(u, 'INDICIEL'); end if;
  if exists (select 1 from aur_results r where r.tk = b.aur and r.t > b.created_at and r.t <= b.created_at + interval '10 minutes' and r.t < b.closed_at) then
    perform achievement_grant(u, 'SNIPER'); end if;
  if (b.dir = 'up' and b.reg_open = 'nervosite') or (b.dir = 'down' and b.reg_open = 'euphorie') then perform achievement_grant(u, 'CONTRARIEN'); end if;
  if exists (select 1 from aur_rumors r where r.tk = b.aur and r.t <= b.created_at and r.t > b.created_at - interval '10 minutes') then
    perform achievement_grant(u, 'BIEN_INFORME'); end if;
  if exists (select 1 from (select t, reg, lead(t) over (order by t) as t1 from aur_regimes) z
              where z.reg = 'nervosite' and z.t > b.created_at and z.t1 is not null and z.t1 < b.closed_at) then
    perform achievement_grant(u, 'SURVIVANT'); end if;
end $$;

-- À chaque clôture Aurelys (après talents_gain : le nom du déclencheur le place après).
create function ach_on_close() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid := new.user_id; v boolean := ach_valid(new); w boolean := ach_net(new) > 0; s int; z int;
begin
  if coalesce((select bot from profiles where id = u), true) then return null; end if;
  update profiles set ach_streak = case when not w then 0 when v then ach_streak + 1 else ach_streak end,
                      ach_zl = case when ach_liq(new) then 0 when v then ach_zl + 1 else ach_zl end,
                      renais_target = case when ach_liq(new) then patrimoine(u) + new.stake - coalesce(new.payout, 0) else renais_target end
   where id = u returning ach_streak, ach_zl into s, z;
  if s >= 5 then perform achievement_grant(u, 'SERIE_5'); end if;
  if s >= 10 then perform achievement_grant(u, 'SERIE_10'); end if;
  if z >= 100 then perform achievement_grant(u, 'ZERO_LIQ'); end if;
  if v then perform ach_trade(new); perform ach_counts(u); end if;
  perform ach_wealth(u);
  return null;
end $$;
create trigger zz_achievements after update on bets for each row
  when (old.status = 'open' and new.status <> 'open' and new.kind = 'aurelys') execute function ach_on_close();

-- Historique d'un joueur (mise en ligne) : séries rejouées dans l'ordre, puis compteurs, gains, logement, guilde…
create function ach_history(u uuid) returns void language plpgsql set search_path = public as $$
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
  if home_level(u) >= 1 then perform achievement_grant(u, 'PROPRIO'); end if;
  if exists (select 1 from guild_members where user_id = u) then perform achievement_grant(u, 'GUILDE'); end if;
  if exists (select 1 from salaries where user_id = u and amount > 0) then perform achievement_grant(u, 'SALAIRE'); end if;
  perform ach_social(u);
  perform ach_talents(u);
end $$;

create function ach_social(u uuid) returns void language plpgsql set search_path = public as $$
declare n int := (select count(*) from referrals where parrain = u and status = 'validé');
begin
  if n >= 1 then perform achievement_grant(u, 'PARRAIN'); end if;
  if n >= 4 then perform achievement_grant(u, 'MENTOR'); end if;
end $$;
create function ach_talents(u uuid) returns void language plpgsql set search_path = public as $$
begin
  if exists (select 1 from talents t join talent_defs d on d.code = t.code where t.user_id = u and d.ultimate) then perform achievement_grant(u, 'SPECIALISTE'); end if;
  if (ach_stats(u)->>'branch_min')::int >= 5 then perform achievement_grant(u, 'POLYVALENT'); end if;
end $$;

-- ===== Événements =====
create function ach_event() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'inventory' then
    if new.qty > 0 and exists (select 1 from shop_items where id = new.item_id and kind = 'home') then perform achievement_grant(new.user_id, 'PROPRIO'); end if;
  elsif tg_table_name = 'guild_members' then perform achievement_grant(new.user_id, 'GUILDE');
  elsif tg_table_name = 'salaries' then if new.amount > 0 then perform achievement_grant(new.user_id, 'SALAIRE'); end if;
  elsif tg_table_name = 'talents' then perform ach_talents(new.user_id);
  end if;
  return null;
end $$;
create trigger ach_event after insert or update on inventory for each row execute function ach_event();
create trigger ach_event after insert on guild_members for each row execute function ach_event();
create trigger ach_event after insert on salaries for each row execute function ach_event();
create trigger ach_event after insert or update on talents for each row execute function ach_event();

-- 20261016000000_qg_vivant.sql ; + jours de présence (Fidèle au poste).
create or replace function touch() returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set last_seen = now() where id = auth.uid();
  insert into presence_days values (auth.uid(), (now() at time zone 'Europe/Paris')::date) on conflict do nothing;
  if found and (ach_stats(auth.uid())->>'presence')::int >= 7 then perform achievement_grant(auth.uid(), 'FIDELE'); end if;
end $$;
-- Lecture d'un article du Courrier (Lecteur assidu) : chaque article compte une fois.
create function article_read(p_id bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from aur_news where id = p_id and t <= now() + news_lead()) then return; end if;
  insert into news_reads values (auth.uid(), p_id) on conflict do nothing;
  if found and (select count(*) from news_reads where user_id = auth.uid()) >= 20 then perform achievement_grant(auth.uid(), 'LECTEUR'); end if;
end $$;
revoke execute on function article_read(bigint) from public, anon;
grant execute on function article_read(bigint) to authenticated;

-- Chaque minute (settle) : positions sur 5 sociétés, gains et patrimoine des joueurs actifs, banque, filleuls, semaine.
create function ach_tick() returns void language plpgsql set search_path = public as $$
declare r record; ws timestamptz := (date_trunc('week', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
begin
  for r in select b.user_id from bets b join profiles p on p.id = b.user_id and not p.bot where b.status = 'open' and b.kind = 'aurelys'
           group by b.user_id having count(distinct b.aur) >= 5 loop
    perform achievement_grant(r.user_id, 'DIVERSIFIE');
  end loop;
  for r in select id from profiles where not bot and last_seen > now() - interval '10 minutes' loop perform ach_wealth(r.id); end loop;
  for r in select id from profiles where not bot and bank >= 5000 and bank_since <= now() - interval '7 days' loop perform achievement_grant(r.id, 'BANQUIER'); end loop;
  for r in select distinct parrain from referrals where status = 'validé' loop perform ach_social(r.parrain); end loop;
  -- Fin de semaine (lundi 0 h, heure de Paris) : classements des gains de la semaine écoulée.
  if coalesce((select week from ach_week), '-infinity') < ws then
    insert into ach_week values (1, ws) on conflict (id) do update set week = excluded.week where ach_week.week < excluded.week;
    if found then perform ach_week_end(ws - interval '7 days', ws); end if;
  end if;
end $$;
create function ach_week_end(p_from timestamptz, p_to timestamptz) returns void language plpgsql set search_path = public as $$
declare r record;
begin
  for r in with g as (select b.user_id, sum(bet_gain(b)) as g from bets b where b.status <> 'open' and b.closed_at >= p_from and b.closed_at < p_to group by 1)
           select g.user_id, rank() over (order by g.g desc) as rk, g.g from g loop
    if r.g > 0 and r.rk <= 100 then perform achievement_grant(r.user_id, 'TOP_100'); end if;
    if r.g > 0 and r.rk <= 10 then perform achievement_grant(r.user_id, 'TOP_10'); end if;
    if r.g > 0 and r.rk = 1 then perform achievement_grant(r.user_id, 'CHAMPION'); end if;
  end loop;
  for r in with g as (select b.user_id, sum(bet_gain(b)) as g from bets b where b.status <> 'open' and b.closed_at >= p_from and b.closed_at < p_to group by 1),
           top as (select m.guild_id from guild_members m join g on g.user_id = m.user_id group by m.guild_id order by sum(g.g) desc limit 3)
           select m.user_id from guild_members m join top on top.guild_id = m.guild_id loop
    perform achievement_grant(r.user_id, 'GUILDE_TOP3');
  end loop;
end $$;
revoke execute on function ach_tick(), ach_week_end(timestamptz, timestamptz), ach_history(uuid), ach_counts(uuid), ach_wealth(uuid), ach_trade(bets),
  ach_social(uuid), ach_talents(uuid), ach_on_close(), ach_event(), ach_profile(), bets_reg_open() from public, anon, authenticated;

-- 20261026300000_parrainage.sql ; + succès (ach_tick).
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
  return n;
end $$;

-- ===== Écran =====
create function my_achievements() returns jsonb language sql stable security definer set search_path = public as $$
  with s as (select ach_stats(auth.uid()) as s, p.ach_streak, p.ach_zl, p.tal_hwm, patrimoine(p.id) as pat, p.bank, p.bank_since
             from profiles p where p.id = auth.uid())
  select jsonb_build_object('total', (select count(*) from achievements), 'max_points', 36,
    'points', least(36, coalesce((select sum(a.points) from aur_achievements u join achievements a on a.code = u.code where u.user_id = auth.uid()), 0)),
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
        when 'POLYVALENT' then (s.s->>'branch_min')::float8 when 'FIDELE' then (s.s->>'presence')::float8
        when 'BANQUIER' then case when s.bank >= 5000 then floor(extract(epoch from now() - s.bank_since) / 86400) else 0 end
      end end) order by a.ord), '[]'))
  from achievements a cross join s left join aur_achievements u on u.code = a.code and u.user_id = auth.uid()
$$;
-- Succès débloqués depuis `p_since` (bandeau à l'écran), et points de talent à dépenser.
create function my_unlocks(p_since timestamptz) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('free', talent_points(auth.uid()), 'now', now(),
    'list', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'points', a.points) order by u.unlocked_at)
                      from aur_achievements u join achievements a on a.code = u.code
                      where u.user_id = auth.uid() and u.unlocked_at > coalesce(p_since, '-infinity')), '[]'))
$$;
revoke execute on function my_achievements(), my_unlocks(timestamptz) from public, anon;
grant execute on function my_achievements(), my_unlocks(timestamptz) to authenticated;

-- Mise en ligne : l'historique de chaque joueur.
do $$ declare r record; begin for r in select id from profiles where not bot loop perform ach_history(r.id); end loop; end $$;
