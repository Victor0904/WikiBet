-- H2 de la refonte « progression » : profil complet (pseudo, avatar, cadre de ligue, titre, trophées épinglés, page
-- publique, profil masqué, coffres de quêtes). Pas d'envoi de photo : des avatars originaux dessinés par le jeu
-- (src/avatars.jsx), seul leur identifiant est en base (« code:couleur »). Catalogues et règles de déblocage ici,
-- reflétés dans src/avatars.jsx (tests/profil.test.js vérifie que les deux disent la même chose).
-- Pseudo : 3 à 16 caractères, unique sans tenir compte des majuscules, ni grossier ni réservé (name_banned, H7),
-- changeable une fois par 30 jours. Les pseudos existants restent tels quels (règles appliquées au prochain changement).
-- Retour arrière : réappliquer pseudo_check, pseudo_change, create_profile, gains_board, leaderboard, guild_page,
-- my_league depuis leurs migrations d'origine ; supprimer avatar_defs, title_defs, cosmetic_unlocks et les colonnes.

-- ===== Pseudo =====
alter table profiles add column pseudo_changed_at timestamptz;
create or replace function pseudo_check(p text) returns void language plpgsql stable set search_path = public as $$
begin
  if pseudo_email_like(p) then raise exception 'Ton pseudo est visible de tous : pas d''adresse e-mail.'; end if;
  if char_length(p) not between 3 and 16 then raise exception 'Pseudo de 3 à 16 caractères.'; end if;
  if p ~ '[^A-Za-z0-9À-ÖØ-öø-ÿ ._-]' then raise exception 'Pseudo : lettres, chiffres, espace, point, tiret et tiret bas seulement.'; end if;
  if name_banned(p) then raise exception 'Ce pseudo contient un mot interdit ou réservé.'; end if;
end $$;
create or replace function pseudo_change(p_pseudo text) returns profiles language plpgsql security definer set search_path = public as $$
declare p profiles; np text := trim(coalesce(p_pseudo, ''));
begin
  select * into p from profiles where id = auth.uid() for update;
  if not found then raise exception 'Connexion requise.'; end if;
  if not p.pseudo_free and p.pseudo_changed_at > now() - interval '30 days' then
    raise exception 'Un changement de pseudo par 30 jours : le prochain le %.', to_char((p.pseudo_changed_at + interval '30 days') at time zone 'Europe/Paris', 'DD/MM');
  end if;
  perform pseudo_check(np);
  if exists (select 1 from profiles where lower(pseudo) = lower(np) and id <> p.id) then raise exception 'Ce pseudo est déjà pris.'; end if;
  update profiles set pseudo = np, pseudo_free = false, pseudo_changed_at = now() where id = p.id returning * into p;
  return p;
end $$;
create or replace function create_profile(p_pseudo text, p_ref text default null) returns profiles
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  perform pseudo_check(trim(coalesce(p_pseudo, '')));
  if exists (select 1 from profiles where lower(pseudo) = lower(trim(p_pseudo))) then raise exception 'Ce pseudo est déjà pris.'; end if;
  begin
    insert into profiles (id, pseudo) values (auth.uid(), trim(p_pseudo)) returning * into p;
  exception when unique_violation then
    raise exception 'Ce pseudo est déjà pris.';
  end;
  perform referral_link(p.id, p_ref);
  return p;
end $$;

-- ===== Avatars et titres =====
-- Déblocage : free, level (niveau de trader), div (meilleure division atteinte), ach (succès), chest (coffre de quêtes),
-- guild (chef d'une guilde première d'une saison de guilde).
alter table profiles add column avatar text, add column title text, add column pins text[] not null default '{}',
  add column hidden boolean not null default false;
create table avatar_defs (code text primary key, name text not null, ord int not null, unlock text not null, value text);
insert into avatar_defs (code, name, ord, unlock, value) values
  ('taureau', 'Taureau', 1, 'free', null), ('ours', 'Ours', 2, 'free', null), ('faucon', 'Faucon', 3, 'free', null),
  ('renard', 'Renard', 4, 'free', null), ('hibou', 'Hibou', 5, 'free', null), ('loup', 'Loup', 6, 'free', null),
  ('tortue', 'Tortue', 7, 'free', null), ('chat', 'Chat', 8, 'free', null), ('cerf', 'Cerf', 9, 'free', null),
  ('carpe', 'Carpe', 10, 'free', null),
  ('requin', 'Requin', 11, 'level', '5'), ('pieuvre', 'Pieuvre', 12, 'level', '10'), ('robot', 'Robot', 13, 'level', '15'),
  ('abeille', 'Abeille', 14, 'level', '20'), ('astronaute', 'Astronaute', 15, 'level', '25'), ('phenix', 'Phénix', 16, 'level', '40'),
  ('comete', 'Comète', 17, 'level', '50'),
  ('lion', 'Lion', 18, 'div', '3'), ('aigle', 'Aigle', 19, 'div', '6'), ('licorne', 'Licorne', 20, 'div', '9'),
  ('cristal', 'Cristal', 21, 'div', '12'), ('couronne', 'Couronne', 22, 'div', '15'),
  ('fusee', 'Fusée', 23, 'ach', 'DOUBLE_PROMO'), ('eclair', 'Éclair', 24, 'ach', 'SERIE_10'), ('diamant', 'Diamant', 25, 'ach', 'GAIN_1M'),
  ('boussole', 'Boussole', 26, 'ach', 'TOUS_SECTEURS'), ('lune', 'Lune', 27, 'ach', 'NOCTAMBULE'),
  ('baleine', 'Baleine', 28, 'chest', null), ('colibri', 'Colibri', 29, 'chest', null), ('cameleon', 'Caméléon', 30, 'chest', null),
  ('scarabee', 'Scarabée', 31, 'chest', null), ('lynx', 'Lynx', 32, 'chest', null);
create table title_defs (code text primary key, text text not null, ord int not null, unlock text not null, value text);
insert into title_defs (code, text, ord, unlock, value) values
  ('apprenti', 'Apprenti trader', 1, 'free', null),
  ('herbe', 'Trader en herbe', 2, 'level', '5'), ('confirme', 'Trader confirmé', 3, 'level', '10'), ('habitue', 'Habitué du parquet', 4, 'level', '20'),
  ('chevronne', 'Trader chevronné', 5, 'level', '25'), ('vieux_loup', 'Vieux loup', 6, 'level', '40'), ('exception', 'Trader d''exception', 7, 'level', '50'),
  ('legende', 'Légende du parquet', 8, 'level', '75'), ('maitre_marches', 'Maître des marchés', 9, 'level', '100'),
  ('argente', 'Argenté', 10, 'div', '3'), ('dore', 'Doré', 11, 'div', '6'), ('platine', 'Platiné', 12, 'div', '9'),
  ('diamantaire', 'Diamantaire', 13, 'div', '12'), ('maitre_ligue', 'Maître de ligue', 14, 'div', '15'),
  ('imbattable', 'Imbattable', 15, 'ach', 'SERIE_10'), ('doubleur', 'Doubleur', 16, 'ach', 'COUP_100'), ('main_fer', 'Main de fer', 17, 'ach', 'MAIN_FER'),
  ('millionnaire', 'Millionnaire', 18, 'ach', 'GAIN_1M'), ('agronome', 'Agronome', 19, 'ach', 'AGRONOME'), ('electricien', 'Électricien', 20, 'ach', 'ELECTRICIEN'),
  ('flaneur', 'Flâneur', 21, 'ach', 'FLANEUR'), ('contrarien', 'Contrarien', 22, 'ach', 'CONTRARIEN'), ('sniper', 'Sniper', 23, 'ach', 'SNIPER'),
  ('champion', 'Champion de la semaine', 24, 'ach', 'CHAMPION'), ('oracle', 'Oracle', 25, 'ach', 'PARI_10'), ('infatigable', 'Infatigable', 26, 'ach', 'QUETES_30'),
  ('noctambule', 'Noctambule', 27, 'ach', 'NOCTAMBULE'), ('mentor', 'Mentor', 28, 'ach', 'MENTOR'), ('pilier', 'Pilier de guilde', 29, 'ach', 'OBJECTIF_GUILDE_4'),
  ('fusee', 'Fusée', 30, 'ach', 'DOUBLE_PROMO'), ('chef_champion', 'Chef de la guilde du mois', 31, 'guild', '1');
alter table avatar_defs enable row level security;
alter table title_defs enable row level security;
create policy "catalogue des avatars" on avatar_defs for select using (true);
create policy "catalogue des titres" on title_defs for select using (true);
-- Avatars gagnés dans un coffre de quêtes (les autres déblocages se relisent dans les données).
create table cosmetic_unlocks (user_id uuid not null references profiles on delete cascade, kind text not null check (kind in ('avatar', 'title')),
  code text not null, at timestamptz not null default now(), primary key (user_id, kind, code));
alter table cosmetic_unlocks enable row level security;
create policy "mes déblocages" on cosmetic_unlocks for select using (user_id = auth.uid());

create function best_division(p_user uuid) returns int language sql stable set search_path = public as $$
  select greatest(coalesce((select division from profiles where id = p_user), 0), coalesce((select max(div_after) from league_members where user_id = p_user), 0))
$$;
create function cosmetic_ok(p_user uuid, p_kind text, p_code text) returns boolean language sql stable set search_path = public as $$
  with d as (select unlock, value from avatar_defs where p_kind = 'avatar' and code = p_code
             union all select unlock, value from title_defs where p_kind = 'title' and code = p_code)
  select coalesce((select case d.unlock when 'free' then true
      when 'level' then trader_level(p_user) >= d.value::int
      when 'div' then best_division(p_user) >= d.value::int
      when 'ach' then exists (select 1 from aur_achievements where user_id = p_user and code = d.value)
      when 'chest' then exists (select 1 from cosmetic_unlocks where user_id = p_user and kind = p_kind and code = p_code)
      when 'guild' then exists (select 1 from guild_trophies where chef = p_user and rank <= d.value::int) else false end from d), false)
$$;
create function title_of(p_user uuid) returns text language sql stable set search_path = public as $$
  select t.text from profiles p join title_defs t on t.code = p.title where p.id = p_user
$$;
revoke execute on function best_division(uuid), cosmetic_ok(uuid, text, text), title_of(uuid) from public, anon, authenticated;

-- Avatar « code:couleur » (12 couleurs), titre, 3 trophées épinglés au plus (parmi les siens), profil masqué.
create function profile_set(p_avatar text default null, p_title text default null, p_pins text[] default null, p_hidden boolean default null,
  p_clear_title boolean default false) returns profiles language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p profiles; a text[] := string_to_array(p_avatar, ':');
begin
  if u is null then raise exception 'Connexion requise.'; end if;
  if p_avatar is not null and (cardinality(a) <> 2 or a[2] !~ '^([0-9]|1[01])$' or not exists (select 1 from avatar_defs where code = a[1])) then raise exception 'Avatar inconnu.'; end if;
  if p_avatar is not null and not cosmetic_ok(u, 'avatar', a[1]) then raise exception 'Cet avatar n''est pas encore débloqué.'; end if;
  if p_title is not null and not cosmetic_ok(u, 'title', p_title) then raise exception 'Ce titre n''est pas encore débloqué.'; end if;
  if p_pins is not null and (cardinality(p_pins) > 3 or exists (select 1 from unnest(p_pins) c where not exists (select 1 from aur_achievements where user_id = u and code = c))
     or cardinality(p_pins) <> (select count(distinct c) from unnest(p_pins) c)) then raise exception 'Épingle jusqu''à 3 de tes succès.'; end if;
  update profiles set avatar = coalesce(p_avatar, avatar), title = case when p_clear_title then null else coalesce(p_title, title) end,
         pins = coalesce(p_pins, pins), hidden = coalesce(p_hidden, hidden) where id = u returning * into p;
  if p.avatar is not null and p.title is not null and cardinality(p.pins) = 3 then perform achievement_grant(u, 'PROFIL_COMPLET'); end if;
  return p;
end $$;

-- Coffre de la semaine (3 quêtes de la semaine réussies) : un avatar de coffre pas encore gagné, au hasard.
create function chest_open() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); w date; c text;
begin
  select week into w from quest_chests where user_id = u and opened_at is null order by week limit 1 for update;
  if w is null then raise exception 'Aucun coffre à ouvrir : réussis les 3 quêtes d''une semaine.'; end if;
  update quest_chests set opened_at = now() where user_id = u and week = w;
  select code into c from avatar_defs a where unlock = 'chest'
     and not exists (select 1 from cosmetic_unlocks x where x.user_id = u and x.kind = 'avatar' and x.code = a.code) order by random() limit 1;
  if c is not null then insert into cosmetic_unlocks (user_id, kind, code) values (u, 'avatar', c); end if;
  return jsonb_build_object('avatar', c, 'name', (select name from avatar_defs where code = c));
end $$;

-- Mon profil à modifier : avatars et titres, débloqués ou non (et comment), coffres à ouvrir.
create function my_cosmetics() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('avatar', p.avatar, 'title', p.title, 'pins', p.pins, 'hidden', p.hidden,
    'pseudo_next', case when p.pseudo_free or p.pseudo_changed_at is null then null else p.pseudo_changed_at + interval '30 days' end,
    'chests', (select count(*) from quest_chests where user_id = p.id and opened_at is null),
    'avatars', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'unlock', unlock, 'value', value, 'ok', cosmetic_ok(p.id, 'avatar', code)) order by ord) from avatar_defs),
    'titles', (select jsonb_agg(jsonb_build_object('code', code, 'text', text, 'unlock', unlock, 'value', value, 'ok', cosmetic_ok(p.id, 'title', code)) order by ord) from title_defs),
    'achievements', (select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name) order by a.ord), '[]') from aur_achievements u join achievements a on a.code = u.code where u.user_id = p.id))
  from profiles p where p.id = auth.uid()
$$;

-- Page publique d'un joueur (pas les bots ; profil masqué : rien, sauf pour lui-même). Aucune donnée personnelle.
create function player_page(p_pseudo text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p profiles; lv int; r jsonb;
begin
  select * into p from profiles where lower(pseudo) = lower(trim(p_pseudo)) and not bot;
  if not found or (p.hidden and p.id is distinct from auth.uid()) then return null; end if;
  lv := trader_level(p.id);
  with v as (select b.*, ach_net(b) as g from bets b where b.user_id = p.id and b.kind = 'aurelys' and b.status <> 'open' and ach_valid(b))
  select jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'avatar', p.avatar, 'title', title_of(p.id), 'level', lv, 'xp', p.xp,
    'from', (select xp from xp_curve where level = lv), 'next', (select xp from xp_curve where level = lv + 1),
    'division', p.division, 'patrimoine', patrimoine(p.id), 'hidden', p.hidden, 'me', p.id = auth.uid(), 'since', p.created_at,
    'pins', (select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'descr', a.descr) order by array_position(p.pins, a.code)), '[]')
               from achievements a where a.code = any(p.pins)),
    'trades', (select count(*) from v), 'wins', (select count(*) from v where g > 0), 'best', (select max(g) from v),
    'streak', (select len from quest_streak(p.id)),
    'guild', (select jsonb_build_object('id', g.id, 'name', g.name, 'tag', g.tag) from guild_members m join guilds g on g.id = m.guild_id where m.user_id = p.id),
    'seasons', (select coalesce(jsonb_agg(jsonb_build_object('week', h.week, 'division', h.division, 'after', h.div_after, 'rank', h.rank, 'n', h.n) order by h.week desc), '[]')
                  from (select * from league_members where user_id = p.id and rank is not null order by week desc limit 8) h))
  into r;
  return r;
end $$;
revoke execute on function profile_set(text, text, text[], boolean, boolean), chest_open(), my_cosmetics(), player_page(text) from public, anon;
grant execute on function profile_set(text, text, text[], boolean, boolean), chest_open(), my_cosmetics(), player_page(text) to authenticated;

-- Titre sous le pseudo dans les classements (même forme qu'avant : la colonne title existait, toujours vide).
create or replace function gains_board(p_period text default 'today', p_scope text default 'all')
returns table (id uuid, pseudo text, title text, guild text, gain float8, bets int, level int)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo, title_of(p.id),
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
create or replace function leaderboard() returns table (id uuid, pseudo text, cash float8, patrimoine float8, bankruptcies int, home int, title text, level int)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo, p.cash, patrimoine(p.id), p.bankruptcies, 0, title_of(p.id), case when p.bot then null else trader_level(p.id) end
  from profiles p order by 4 desc limit 50
$$;

-- 20261029800000_guildes_objectifs.sql ; + avatar, titre et division des membres.
create or replace function guild_page(p_id bigint default null, p_name text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g guilds; w0 timestamptz := paris_week(now()); q guild_goals; lv int; r jsonb;
begin
  select * into g from guilds where id = p_id or (p_id is null and lower(name) = lower(p_name));
  if not found then return null; end if;
  lv := guild_level(g.xp);
  select * into q from guild_goals where guild_id = g.id and week = paris_date(w0);
  r := jsonb_build_object('id', g.id, 'name', g.name, 'tag', g.tag, 'motto', g.motto, 'descr', g.descr, 'color', g.color,
    'emblem', g.emblem, 'banner', g.banner, 'open', g.open, 'owner', g.owner, 'level', lv, 'xp', g.xp,
    'from', guild_level_xp(lv), 'next', case when lv < 20 then guild_level_xp(lv + 1) end, 'cap', guild_cap(lv),
    'streak', g.goal_streak, 'mine', exists (select 1 from guild_members where user_id = auth.uid() and guild_id = g.id),
    'chef', g.owner = auth.uid(), 'ratio', case when g.owner = auth.uid() then g.target_ratio end,
    'next_min', guild_min(greatest(1, (select count(*) from guild_members m join profiles p on p.id = m.user_id and not p.bot where m.guild_id = g.id)::int), lv),
    'week_end', extract(epoch from paris_week_end(now())),
    'goal', case when q.guild_id is not null then jsonb_build_object('min', q.min, 'target', q.target, 'members', q.members,
      'total', (select coalesce(sum(greatest(-0.1 * q.target, least(0.4 * q.target, week_pnl(gm.user_id, w0, now())))), 0)
                  from guild_goal_members gm where gm.guild_id = g.id and gm.week = q.week),
      'xp', guild_xp_for(q.members, q.target, q.min, q.target)) end,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'bot', p.bot, 'level', case when p.bot then null else trader_level(p.id) end,
        'avatar', p.avatar, 'title', title_of(p.id), 'division', p.division,
        'owner', p.id = g.owner, 'counted', gm.user_id is not null,
        'contribution', case when gm.user_id is not null then greatest(-0.1 * q.target, least(0.4 * q.target, week_pnl(p.id, w0, now()))) end,
        'trades', case when gm.user_id is not null then week_trades(p.id, w0, now()) end) order by p.id = g.owner desc, m.joined_at), '[]')
      from guild_members m join profiles p on p.id = m.user_id
      left join guild_goal_members gm on gm.guild_id = g.id and gm.week = q.week and gm.user_id = p.id where m.guild_id = g.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('week', h.week, 'target', h.target, 'min', h.min, 'total', h.total, 'status', h.status, 'xp', h.xp) order by h.week desc), '[]')
      from (select * from guild_goals where guild_id = g.id and status <> 'open' order by week desc limit 8) h),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('pseudo', t.pseudo, 'total', t.s) order by t.s desc), '[]')
      from (select p.pseudo, sum(gm.contribution) s from guild_goal_members gm join profiles p on p.id = gm.user_id
             where gm.guild_id = g.id and gm.contribution is not null group by p.pseudo order by 2 desc limit 5) t),
    'trophies', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'rank', rank) order by month desc), '[]') from guild_trophies where guild_id = g.id));
  return r;
end $$;

-- 20261029900000_ligues.sql ; + avatar et titre des joueurs du groupe.
create or replace function my_league() returns jsonb language plpgsql stable security definer set search_path = public as $$
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
      with x as (select lm.user_id, p.pseudo, p.avatar, title_of(p.id) as title, week_pnl(lm.user_id, w0, now()) / greatest(10000, coalesce(ww.wealth, 10000)) as ret,
                        week_trades(lm.user_id, w0, now()) as trades
                   from league_members lm join profiles p on p.id = lm.user_id
                   left join week_wealth ww on ww.user_id = lm.user_id and ww.week = lm.week
                  where lm.group_id = me.group_id and lm.week = me.week),
           y as (select x.*, rank() over (order by ret desc) as rk, count(*) over () as cnt from x)
      select jsonb_build_object('n', max(cnt), 'members', jsonb_agg(jsonb_build_object('id', user_id, 'pseudo', pseudo, 'avatar', avatar, 'title', title, 'ret', ret, 'trades', trades,
               'rank', rk, 'me', user_id = u, 'move', season_move(rk::int, cnt::int)) order by rk, pseudo)) from y));
  end if;
  return r;
end $$;
