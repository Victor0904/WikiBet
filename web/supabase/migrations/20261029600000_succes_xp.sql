-- H8 de la refonte « progression » : les succès rapportent de l'XP de trader (plus de points de talent).
-- 0 point → 25 XP, 1 → 75 XP, 2 → 150 XP (ach_xp), versés une fois par succès (xp_log, clé « ach » + code). Rétroactif :
-- les succès déjà débloqués rapportent leur XP au déploiement (un niveau ne baisse jamais, il ne peut que monter).
-- GUILDE_TOP3 est remplacé par OBJECTIF_GUILDE_4 (objectif de guilde atteint 4 semaines d'affilée, branché en H7).
-- Nouveaux succès : ligues (H6), séries de quêtes, pari du jour, niveaux, guilde (H7), profil (H2). Ceux de H2, H6 et H7
-- sont évalués par leurs migrations. Titres et avatars débloqués par des succès : H2.
-- Retour arrière : réappliquer achievement_grant, xp_grant, quests_check, pari_tick, ach_tick, ach_week_end,
-- my_achievements, my_unlocks depuis leurs migrations d'origine ; l'XP versée reste (xp_log, source « ach »).

create function ach_xp(p_points int) returns int language sql immutable as $$
  select case p_points when 0 then 25 when 1 then 75 else 150 end
$$;

delete from aur_achievements where code = 'GUILDE_TOP3';
delete from achievements where code = 'GUILDE_TOP3';
alter table achievements alter column ord type float8;
insert into achievements (code, cat, ord, name, descr, points, goal, unit, secret, hint) values
  ('NIVEAU_10', 'Progression', 8, 'Trader confirmé', 'Atteindre le niveau 10 de trader', 0, 10, 'niveau', false, null),
  ('NIVEAU_25', 'Progression', 9, 'Trader chevronné', 'Atteindre le niveau 25 de trader', 1, 25, 'niveau', false, null),
  ('NIVEAU_50', 'Progression', 9.5, 'Trader d''exception', 'Atteindre le niveau 50 de trader', 2, 50, 'niveau', false, null),
  ('QUETES_7', 'Progression', 9.6, 'Une semaine de quêtes', 'Série de quêtes de 7 jours', 0, 7, 'jours de série', false, null),
  ('QUETES_30', 'Progression', 9.7, 'Un mois de quêtes', 'Série de quêtes de 30 jours', 1, 30, 'jours de série', false, null),
  ('PARI_3', 'Progression', 9.8, 'Bon pronostic', '3 bonnes réponses d''affilée au pari du jour', 0, 3, 'd''affilée', false, null),
  ('PARI_10', 'Progression', 9.9, 'Oracle', '10 bonnes réponses au pari du jour', 1, 10, 'bonnes réponses', false, null),
  ('LIGUE_ARGENT', 'Ligues', 95, 'Argent', 'Atteindre la ligue Argent', 0, null, null, false, null),
  ('LIGUE_OR', 'Ligues', 96, 'Or', 'Atteindre la ligue Or', 1, null, null, false, null),
  ('LIGUE_PLATINE', 'Ligues', 97, 'Platine', 'Atteindre la ligue Platine', 1, null, null, false, null),
  ('LIGUE_DIAMANT', 'Ligues', 98, 'Diamant', 'Atteindre la ligue Diamant', 2, null, null, false, null),
  ('MAITRE', 'Ligues', 99, 'Maître', 'Atteindre la ligue Maître', 2, null, null, false, null),
  ('PODIUM', 'Ligues', 99.1, 'Podium', 'Finir une semaine dans le top 3 de son groupe de ligue', 0, null, null, false, null),
  ('DOUBLE_PROMO', 'Ligues', 99.2, 'Fusée', 'Monter de deux divisions en une semaine', 1, null, null, false, null),
  ('CHEF_DE_GUILDE', 'Social', 92, 'Chef de guilde', 'Diriger une guilde d''au moins 5 joueurs', 0, null, null, false, null),
  ('OBJECTIF_GUILDE', 'Social', 93, 'Objectif atteint', 'Ta guilde atteint son objectif de la semaine', 0, null, null, false, null),
  ('OBJECTIF_GUILDE_4', 'Social', 94, 'Guilde d''élite', 'Ta guilde atteint son objectif 4 semaines d''affilée', 1, 4, 'semaines d''affilée', false, null),
  ('PROFIL_COMPLET', 'Premiers pas', 7.5, 'Carte de visite', 'Choisir un avatar, un titre et épingler 3 trophées', 0, null, null, false, null);

-- Déblocage : une seule fois, avec son XP ; Collectionneur et Légende suivent le nombre de succès.
create or replace function achievement_grant(p_user uuid, p_code text) returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce((select bot from profiles where id = p_user), true) then return false; end if;
  insert into aur_achievements (user_id, code) values (p_user, p_code) on conflict do nothing;
  if not found then return false; end if;
  perform xp_grant(p_user, 'ach', p_code, ach_xp((select points from achievements where code = p_code)));
  if p_code not in ('COLLECTIONNEUR', 'LEGENDE') then
    select count(*) into n from aur_achievements where user_id = p_user;
    if n >= 25 then perform achievement_grant(p_user, 'COLLECTIONNEUR'); end if;
    if n >= 45 then perform achievement_grant(p_user, 'LEGENDE'); end if;
  end if;
  return true;
end $$;
revoke execute on function achievement_grant(uuid, text), ach_xp(int) from public, anon, authenticated;

-- Succès de niveau : à chaque montée (l'XP d'un succès peut en faire gagner un autre, la clé unique arrête la boucle).
create or replace function ach_level(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare l int := trader_level(p_user);
begin
  if l >= 10 then perform achievement_grant(p_user, 'NIVEAU_10'); end if;
  if l >= 25 then perform achievement_grant(p_user, 'NIVEAU_25'); end if;
  if l >= 50 then perform achievement_grant(p_user, 'NIVEAU_50'); end if;
end $$;
create or replace function xp_grant(p_user uuid, p_source text, p_key text, p_amount int) returns boolean
language plpgsql security definer set search_path = public as $$
declare l0 int; l1 int;
begin
  if not (p_amount > 0) or coalesce((select bot from profiles where id = p_user), true) then return false; end if;
  insert into xp_log (user_id, source, key, amount) values (p_user, p_source, p_key, p_amount) on conflict do nothing;
  if not found then return false; end if;
  l0 := trader_level(p_user);
  update profiles set xp = xp + p_amount where id = p_user;
  l1 := trader_level(p_user);
  if l1 > l0 then
    insert into notices (user_id, kind, body) values (p_user, 'level', jsonb_build_object('from', l0, 'to', l1));
    perform ach_level(p_user);
  end if;
  return true;
end $$;
revoke execute on function xp_grant(uuid, text, text, int), ach_level(uuid) from public, anon, authenticated;

-- Séries de quêtes (20261028400000_niveaux_quetes.sql ; + QUETES_7, QUETES_30).
create or replace function quests_check(p_user uuid, p_ts timestamptz default now()) returns int
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
  if (select count(*) from quest_done d join quest_defs x on x.code = d.code where d.user_id = p_user and d.pkey = 'w' || w and x.period = 'week') >= 3 then
    insert into quest_chests (user_id, week) values (p_user, w) on conflict do nothing;
  end if;
  select * into st from quest_streak(p_user, paris_date(p_ts));
  if st.len >= 3 then perform xp_grant(p_user, 'streak', st.start || ':3', 50); end if;
  if st.len >= 7 then perform xp_grant(p_user, 'streak', st.start || ':7', 150); perform achievement_grant(p_user, 'QUETES_7'); end if;
  if st.len >= 30 then perform xp_grant(p_user, 'streak', st.start || ':30', 500); perform achievement_grant(p_user, 'QUETES_30'); end if;
  return n;
end $$;

-- Bonnes réponses au pari du jour : d'affilée (votes annulés ignorés) et au total.
create function pari_run(p_user uuid, p_day date default null) returns int language sql stable set search_path = public as $$
  select count(*)::int from (
    select w.result, sum(case when w.result = 'wrong' then 1 else 0 end) over (order by p.day desc) as broken
      from aur_pari_vote w join aur_pari p on p.id = w.pari_id
     where w.user_id = p_user and p.day <= coalesce(p_day, 'infinity'::date) and w.result in ('right', 'wrong')) z
   where z.broken = 0
$$;
create function pari_rights(p_user uuid) returns int language sql stable set search_path = public as $$
  select count(*)::int from aur_pari_vote where user_id = p_user and result = 'right'
$$;
create function ach_pari(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if pari_run(p_user) >= 3 then perform achievement_grant(p_user, 'PARI_3'); end if;
  if pari_rights(p_user) >= 10 then perform achievement_grant(p_user, 'PARI_10'); end if;
end $$;
revoke execute on function pari_run(uuid, date), pari_rights(uuid), ach_pari(uuid) from public, anon, authenticated;

-- 20261028500000_pari_du_jour.sql ; + succès du pari.
create or replace function pari_tick(p_now timestamptz default now()) returns void language plpgsql security definer set search_path = public as $$
declare d date := paris_date(p_now); h time := (p_now at time zone 'Europe/Paris')::time; b text[]; q aur_pari; v aur_pari_vote;
        prices jsonb; r float8; top text; gap float8; ok boolean; run int;
begin
  if h >= '08:00' and not exists (select 1 from aur_pari where day = d) then
    select array_agg(tk order by md5(d::text || tk)) into b from (select tk from results_between(paris_day_start(d) + interval '14 hours', paris_day_start(d) + interval '20 hours') tk
      where tk in (select s.tk from aur_stocks s where s.status = 'core')) x;
    if coalesce(array_length(b, 1), 0) >= 3 and get_byte(decode(md5('pari' || d), 'hex'), 0) % 2 = 0 then
      insert into aur_pari (day, kind, tks, open_until, resolve_at)
      values (d, 'B', b[1:3], paris_day_start(d) + interval '14 hours', paris_day_start(d) + interval '20 hours') on conflict do nothing;
    else
      insert into aur_pari (day, kind, tks, open_until, resolve_at)
      select d, 'A', array[s.tk], paris_day_start(d) + interval '14 hours', paris_day_start(d) + interval '20 hours'
        from aur_stocks s where s.status = 'core' order by md5(d::text || s.tk) limit 1
      on conflict do nothing;
    end if;
  end if;

  for q in select * from aur_pari where status = 'open' and resolve_at <= p_now for update skip locked loop
    select jsonb_object_agg(t.tk, (select k.p from aur_ticks k where k.tk = t.tk and k.t >= q.resolve_at and k.t <= least(p_now, q.resolve_at + interval '30 minutes') order by k.t limit 1))
      into prices from unnest(q.tks) t(tk);
    if exists (select 1 from jsonb_each(prices) e where e.value = 'null'::jsonb) then
      if p_now >= q.resolve_at + interval '30 minutes' then
        update aur_pari set status = 'void', resolved_at = p_now where id = q.id;
        update aur_pari_vote set result = 'void' where pari_id = q.id;
      end if;
      continue;
    end if;
    for v in select * from aur_pari_vote where pari_id = q.id loop
      if q.kind = 'A' then
        r := (prices->>q.tks[1])::float8 / (v.ref->>q.tks[1])::float8 - 1;
        ok := (v.choice = 'up') = (r > 0); gap := abs(r);
      else
        select z.tk, z.r - lead(z.r) over (order by z.r desc) into top, gap
          from (select t.tk, (prices->>t.tk)::float8 / (v.ref->>t.tk)::float8 - 1 as r from unnest(q.tks) t(tk)) z order by z.r desc limit 1;
        ok := v.choice = top;
      end if;
      update aur_pari_vote set result = case when gap < 0.0005 then 'void' when ok then 'right' else 'wrong' end
       where user_id = v.user_id and pari_id = q.id;
      if gap >= 0.0005 and ok then
        perform xp_grant(v.user_id, 'pari', q.id || ':right', 25);
        run := pari_run(v.user_id, q.day);
        if run > 0 and run % 3 = 0 then perform xp_grant(v.user_id, 'pari', q.id || ':three', 40); end if;
        perform ach_pari(v.user_id);
      end if;
    end loop;
    update aur_pari set status = 'resolved', px = prices, resolved_at = p_now where id = q.id;
  end loop;
end $$;

-- Chef de guilde : le fondateur (chef) d'une guilde d'au moins 5 joueurs (bots non comptés).
create function ach_guilds() returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select g.owner from guilds g join guild_members m on m.guild_id = g.id join profiles p on p.id = m.user_id and not p.bot
            group by g.id, g.owner having count(*) >= 5 loop
    perform achievement_grant(r.owner, 'CHEF_DE_GUILDE');
  end loop;
end $$;
revoke execute on function ach_guilds() from public, anon, authenticated;

-- 20261028300000_suppressions.sql ; + chef de guilde.
create or replace function ach_tick() returns void language plpgsql set search_path = public as $$
declare r record; ws timestamptz := (date_trunc('week', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
begin
  for r in select b.user_id from bets b join profiles p on p.id = b.user_id and not p.bot where b.status = 'open' and b.kind = 'aurelys'
           group by b.user_id having count(distinct b.aur) >= 5 loop
    perform achievement_grant(r.user_id, 'DIVERSIFIE');
  end loop;
  for r in select id from profiles where not bot and last_seen > now() - interval '10 minutes' loop perform ach_wealth(r.id); end loop;
  for r in select distinct parrain from referrals where status = 'validé' loop perform ach_social(r.parrain); end loop;
  perform ach_guilds();
  if coalesce((select week from ach_week), '-infinity') < ws then
    insert into ach_week values (1, ws) on conflict (id) do update set week = excluded.week where ach_week.week < excluded.week;
    if found then perform ach_week_end(ws - interval '7 days', ws); end if;
  end if;
end $$;

-- 20261027400000_faillite_semaine.sql, sans GUILDE_TOP3.
create or replace function ach_week_end(p_from timestamptz, p_to timestamptz) returns void language plpgsql set search_path = public as $$
declare r record;
begin
  for r in with g as (select b.user_id, sum(bet_gain(b)) as g from bets b join profiles p on p.id = b.user_id and not p.bot
                      where b.status <> 'open' and b.closed_at >= p_from and b.closed_at < p_to group by 1)
           select g.user_id, rank() over (order by g.g desc) as rk, g.g from g loop
    if r.g > 0 and r.rk <= 100 then perform achievement_grant(r.user_id, 'TOP_100'); end if;
    if r.g > 0 and r.rk <= 10 then perform achievement_grant(r.user_id, 'TOP_10'); end if;
    if r.g > 0 and r.rk = 1 then perform achievement_grant(r.user_id, 'CHAMPION'); end if;
  end loop;
end $$;

-- Écran Succès : XP de chaque succès et XP gagnée par les succès (plus de points).
create or replace function my_achievements() returns jsonb language sql stable security definer set search_path = public as $$
  with s as (select ach_stats(auth.uid()) as s, p.ach_streak, p.ach_zl, p.tal_hwm, patrimoine(p.id) as pat, trader_level(p.id) as lvl,
                    (select len from quest_streak(p.id)) as qs, pari_run(p.id) as prun, pari_rights(p.id) as prights
             from profiles p where p.id = auth.uid())
  select jsonb_build_object('total', (select count(*) from achievements),
    'xp', coalesce((select sum(ach_xp(a.points)) from aur_achievements u join achievements a on a.code = u.code where u.user_id = auth.uid()), 0),
    'xp_total', (select sum(ach_xp(points)) from achievements),
    'list', coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'cat', a.cat, 'points', a.points, 'xp', ach_xp(a.points), 'goal', a.goal, 'unit', a.unit,
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
        when 'NIVEAU_10' then s.lvl when 'NIVEAU_25' then s.lvl when 'NIVEAU_50' then s.lvl
        when 'QUETES_7' then s.qs when 'QUETES_30' then s.qs when 'PARI_3' then s.prun when 'PARI_10' then s.prights
      end end) order by a.ord), '[]'))
  from achievements a cross join s left join aur_achievements u on u.code = a.code and u.user_id = auth.uid()
$$;
create or replace function my_unlocks(p_since timestamptz) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('free', 0, 'now', now(),
    'list', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'points', a.points, 'xp', ach_xp(a.points)) order by u.unlocked_at)
                      from aur_achievements u join achievements a on a.code = u.code
                      where u.user_id = auth.uid() and u.unlocked_at > coalesce(p_since, '-infinity')), '[]'))
$$;

-- Rétroactif : l'XP des succès déjà débloqués, puis les succès de niveau, de série de quêtes et du pari.
select xp_grant(u.user_id, 'ach', u.code, ach_xp(a.points)) from aur_achievements u join achievements a on a.code = u.code;
select ach_level(id), ach_pari(id) from profiles where not bot;
select achievement_grant(p.id, 'QUETES_7') from profiles p where not p.bot and (select len from quest_streak(p.id)) >= 7;
select achievement_grant(p.id, 'QUETES_30') from profiles p where not p.bot and (select len from quest_streak(p.id)) >= 30;
select ach_guilds();
