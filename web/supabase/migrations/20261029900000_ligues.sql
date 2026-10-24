-- H6 de la refonte « progression » : saisons hebdomadaires et ligues (16 divisions, Bronze 1 → Maître).
-- Valeurs partagées : supabase/functions/_shared/progression.js (seasonMove, nextDivision, SEASON_REWARD_PCT,
-- SEASON_XP), vérifiées par tests/ligues.test.js ; calibrage : scripts/sim-saisons.mjs (H9 : injection de W soutenable).
-- Entrée : à la clôture de son premier trade valide de la semaine, le joueur rejoint un groupe de sa division (100 au
-- plus, sinon un nouveau). Classement : rendement de la semaine = week_pnl ÷ max(patrimoine du lundi, 10 000 W).
-- Clôture : week_close (lundi 0 h, toutes les heures à la minute 5, une fois par semaine, rattrapage dans l'ordre).
-- Récompense de saison : seul versement de W de la refonte, en espèces, identique pour une division, jamais dans bets
-- (donc hors des classements de gains) ; pour 5 trades valides ou plus, un compte de 48 h ou plus ou lié à Discord
-- (le jeu ne vérifie aucun e-mail : règle choisie par Victor le 24 octobre 2026).
-- Retour arrière : réappliquer player_division (select 0), week_close, my_refunds depuis leurs migrations d'origine ;
-- supprimer league_*, profiles.division.

alter table profiles add column division int not null default 0 check (division between 0 and 15);
create or replace function player_division(p_user uuid) returns int language sql stable set search_path = public as $$
  select coalesce((select division from profiles where id = p_user), 0)
$$;
create function season_reward(p_div int) returns float8 language sql immutable as $$
  select 10000 * (array[1, 1.5, 2, 3, 3.5, 4, 5, 5.5, 6, 7, 8, 9, 10, 11, 12, 15])[p_div + 1] / 100.0
$$;
create function season_move(p_rank int, p_n int) returns int language sql immutable as $$
  select case when p_n < 10 then case when p_rank = 1 and p_n >= 3 then 1 else 0 end
              when p_rank <= floor(p_n * .05) then 2 when p_rank <= floor(p_n * .05) + floor(p_n * .15) then 1
              when p_rank > p_n - floor(p_n * .2) then -1 else 0 end
$$;

create table league_groups (id bigint generated always as identity primary key, week date not null, division int not null,
  created_at timestamptz not null default now());
create index on league_groups (week, division);
create table league_members (week date not null, user_id uuid not null references profiles on delete cascade,
  group_id bigint not null references league_groups on delete cascade, joined_at timestamptz not null default now(),
  division int not null, pnl float8, ret float8, trades int, rank int, n int, move int, eligible boolean, reward float8,
  div_after int, primary key (week, user_id));
create index on league_members (group_id);
alter table league_groups enable row level security;
alter table league_members enable row level security;

-- Entrée dans la saison (premier trade valide clôturé de la semaine).
create function league_enter(p_user uuid, p_at timestamptz default now()) returns void language plpgsql security definer set search_path = public as $$
declare w date := paris_date(paris_week(p_at)); d int; g bigint;
begin
  if coalesce((select bot from profiles where id = p_user), true) or exists (select 1 from league_members where week = w and user_id = p_user) then return; end if;
  d := player_division(p_user);
  perform pg_advisory_xact_lock(hashtext('ligue:' || w || ':' || d));
  select lg.id into g from league_groups lg where lg.week = w and lg.division = d
     and (select count(*) from league_members m where m.group_id = lg.id) < 100 order by lg.id limit 1;
  if g is null then insert into league_groups (week, division) values (w, d) returning id into g; end if;
  insert into league_members (week, user_id, group_id, division, joined_at) values (w, p_user, g, d, p_at) on conflict do nothing;
end $$;
create function league_on_close() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if ach_valid(new) then perform league_enter(new.user_id, new.closed_at); end if;
  return null;
end $$;
create trigger league_on_close after update on bets for each row
  when (old.status = 'open' and new.status <> 'open' and new.kind = 'aurelys') execute function league_on_close();

-- Bilan d'une saison : classement de chaque groupe, mouvements, récompenses, XP, succès. Une fois par membre (rank posé).
create function league_settle(p_w0 timestamptz) returns void language plpgsql security definer set search_path = public as $$
declare w date := paris_date(p_w0); w1 timestamptz := paris_week(p_w0 + interval '8 days'); m record; pay float8; d1 int; xp int;
begin
  update league_members lm set pnl = week_pnl(lm.user_id, p_w0, w1), trades = week_trades(lm.user_id, p_w0, w1)
   where lm.week = w and lm.rank is null;
  update league_members lm set ret = lm.pnl / greatest(10000, coalesce((select wealth from week_wealth ww where ww.user_id = lm.user_id and ww.week = w), 10000))
   where lm.week = w and lm.rank is null;
  for m in select lm.*, rank() over (partition by lm.group_id order by lm.ret desc) as rk, count(*) over (partition by lm.group_id) as cnt
             from league_members lm where lm.week = w and lm.rank is null order by lm.group_id, lm.ret desc loop
    d1 := greatest(0, least(15, m.division + case when m.trades >= 5 then season_move(m.rk::int, m.cnt::int) else least(0, season_move(m.rk::int, m.cnt::int)) end));
    pay := case when m.trades >= 5 and (
             (select created_at from profiles where id = m.user_id) <= w1 - interval '48 hours'
             or exists (select 1 from auth.identities i where i.user_id = m.user_id and i.provider = 'discord'))
           then season_reward(m.division) else 0 end;
    update league_members set rank = m.rk, n = m.cnt, move = d1 - m.division, eligible = m.trades >= 5, reward = pay, div_after = d1
     where week = w and user_id = m.user_id;
    update profiles set division = d1, cash = cash + pay where id = m.user_id;
    xp := 60 + 100 * greatest(0, d1 - m.division);
    perform xp_grant(m.user_id, 'saison', w::text, xp);
    if d1 >= 3 then perform achievement_grant(m.user_id, 'LIGUE_ARGENT'); end if;
    if d1 >= 6 then perform achievement_grant(m.user_id, 'LIGUE_OR'); end if;
    if d1 >= 9 then perform achievement_grant(m.user_id, 'LIGUE_PLATINE'); end if;
    if d1 >= 12 then perform achievement_grant(m.user_id, 'LIGUE_DIAMANT'); end if;
    if d1 >= 15 then perform achievement_grant(m.user_id, 'MAITRE'); end if;
    if m.rk <= 3 and m.cnt >= 3 and m.trades >= 5 then perform achievement_grant(m.user_id, 'PODIUM'); end if;
    if d1 - m.division >= 2 then perform achievement_grant(m.user_id, 'DOUBLE_PROMO'); end if;
    insert into notices (user_id, kind, body) values (m.user_id, 'season', jsonb_build_object('from', m.division, 'to', d1, 'rank', m.rk, 'n', m.cnt,
      'reward', pay, 'xp', xp, 'trades', m.trades, 'eligible', m.trades >= 5));
  end loop;
end $$;

-- 20261029800000_guildes_objectifs.sql ; + saison des ligues (avant le relevé du patrimoine : la récompense y entre).
create or replace function week_close(p_w0 timestamptz) returns boolean language plpgsql security definer set search_path = public as $$
declare w1 timestamptz := paris_week(p_w0 + interval '8 days');
begin
  insert into week_runs (week) values (paris_date(p_w0)) on conflict do nothing;
  if not found then return false; end if;
  perform league_settle(p_w0);
  perform guild_settle(p_w0);
  insert into week_wealth (user_id, week, wealth) select id, paris_date(w1), patrimoine(id) from profiles where not bot on conflict do nothing;
  perform guild_lock(w1);
  if date_trunc('month', paris_date(w1)) > date_trunc('month', paris_date(p_w0)) then
    perform guild_month_close(date_trunc('month', paris_date(p_w0))::date);
  end if;
  return true;
end $$;
revoke execute on function league_enter(uuid, timestamptz), league_on_close(), league_settle(timestamptz), season_reward(int), season_move(int, int)
  from public, anon, authenticated;

-- Écran Ligue : ma division, mon groupe classé en direct (rendement de la semaine), zones, historique des 8 dernières saisons.
create function my_league() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); w0 timestamptz := paris_week(now()); me league_members; r jsonb;
begin
  if u is null then raise exception 'Connexion requise.'; end if;
  select * into me from league_members where week = paris_date(w0) and user_id = u;
  r := jsonb_build_object('division', player_division(u), 'week_end', extract(epoch from paris_week_end(now())),
    'reward', season_reward(player_division(u)), 'trades', week_trades(u, w0, now()),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('week', h.week, 'division', h.division, 'after', h.div_after, 'rank', h.rank, 'n', h.n,
                  'ret', h.ret, 'reward', h.reward, 'eligible', h.eligible) order by h.week desc), '[]')
                from (select * from league_members where user_id = u and rank is not null order by week desc limit 8) h));
  if me.group_id is not null then
    r := r || jsonb_build_object('group', (
      with x as (select lm.user_id, p.pseudo, week_pnl(lm.user_id, w0, now()) / greatest(10000, coalesce(ww.wealth, 10000)) as ret,
                        week_trades(lm.user_id, w0, now()) as trades
                   from league_members lm join profiles p on p.id = lm.user_id
                   left join week_wealth ww on ww.user_id = lm.user_id and ww.week = lm.week
                  where lm.group_id = me.group_id and lm.week = me.week),
           y as (select x.*, rank() over (order by ret desc) as rk, count(*) over () as cnt from x)
      select jsonb_build_object('n', max(cnt), 'members', jsonb_agg(jsonb_build_object('id', user_id, 'pseudo', pseudo, 'ret', ret, 'trades', trades,
               'rank', rk, 'me', user_id = u, 'move', season_move(rk::int, cnt::int)) order by rk, pseudo)) from y));
  end if;
  return r;
end $$;
revoke execute on function my_league() from public, anon;
grant execute on function my_league() to authenticated;

-- Historique : la récompense de saison y apparaît (20261028300000_suppressions.sql ; + saisons).
create or replace function my_refunds() returns table (kind text, amount float8, at timestamptz) language sql stable security definer set search_path = public as $$
  select case when kind = 'banque' then 'banque' else 'qg' end, sum(amount), min(at) from h1_refunds
   where user_id = auth.uid() and kind in ('banque', 'logement', 'deco', 'bonus', 'tresor') and amount > 0
   group by 1
  union all
  select 'saison', reward, paris_week(paris_day_start(week) + interval '8 days') from league_members where user_id = auth.uid() and reward > 0
  order by 3
$$;
