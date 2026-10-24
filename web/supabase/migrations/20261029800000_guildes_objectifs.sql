-- H7 de la refonte « progression » : guildes à objectif hebdomadaire (sans QG, sans maison, sans banque).
-- Valeurs partagées avec l'écran et scripts/sim-saisons.mjs : supabase/functions/_shared/progression.js (guildCap, guildMin,
-- guildG, guildXp, GUILD_XP_TOTAL), vérifiées par tests/guildes.test.js. Semaine = lundi 0 h → lundi 0 h, heure de Paris.
-- Gain de la semaine (aussi pour les ligues, H6) : positions Aurelys seulement, valeur en fin de semaine − valeur en début
-- de semaine (cours de la frontière, frais de clôture déduits) ; une position ouverte et clôturée dans la semaine compte
-- son gain (paiement − mise − frais d'ouverture). Salaire, parrainage, récompenses de saison et XP n'y sont jamais.
-- Clôture : week_tick() toutes les heures à la minute 5 (pg_cron), idempotente (week_runs : une ligne par semaine), et
-- elle rattrape les semaines manquées dans l'ordre. Rien ici ne verse de W.
-- Retour arrière : réappliquer guild_join, guild_leave, guild_kick, guild_create, guild_list, guild_members_of,
-- quest_progress depuis leurs migrations d'origine ; supprimer les tables et fonctions guild_goal*, week_*.

-- ===== Noms : réservés et grossiers (aussi pour les pseudos, H2) =====
create table banned_words (word text primary key, exact boolean not null default false);
insert into banned_words (word, exact) values
  ('admin', false), ('administrateur', false), ('moderateur', false), ('modo', true), ('aurelys', false), ('support', true),
  ('staff', true), ('officiel', false), ('systeme', true), ('wikibourse', false),
  ('connard', false), ('connasse', false), ('salope', false), ('encule', false), ('enculer', false), ('putain', false),
  ('pute', true), ('putes', true), ('batard', false), ('merde', true), ('bite', true), ('couille', false), ('nique', false),
  ('niquer', false), ('fdp', true), ('ntm', true), ('pd', true), ('tapette', false), ('negre', false), ('bougnoule', false),
  ('youpin', false), ('nazi', false), ('hitler', false), ('pedophile', false), ('pedo', true), ('viol', true), ('violeur', false),
  ('fuck', false), ('shit', true), ('bitch', false), ('cunt', false), ('dick', true), ('pussy', false), ('whore', false),
  ('slut', true), ('nigger', false), ('nigga', false), ('faggot', false), ('retard', true), ('rape', true), ('rapist', false);
alter table banned_words enable row level security;
-- Minuscules, sans accents, chiffres et symboles de remplacement ramenés aux lettres (0 → o, 1 → i, 3 → e, 4 → a, 5 → s, @ → a).
create function name_norm(p text) returns text language sql immutable as $$
  select translate(lower(p), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ013457@$!|', 'aaaaaaceeeeiiiinooooouuuuyyoaoieastasii')
$$;
create function name_banned(p text) returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from banned_words w where
    (not w.exact and position(w.word in regexp_replace(name_norm(p), '[^a-z]', '', 'g')) > 0)
    or (w.exact and w.word = any(regexp_split_to_array(name_norm(p), '[^a-z]+'))))
$$;
revoke execute on function name_banned(text), name_norm(text) from public, anon, authenticated;

-- ===== Gain de la semaine =====
-- Cours d'une société à un instant (dernier cours connu à cet instant ; les bougies sont gardées 10 jours).
create function px_at(p_tk text, p_t timestamptz) returns float8 language sql stable set search_path = public as $$
  select coalesce((select p from aur_ticks where tk = p_tk and t <= p_t order by t desc limit 1),
                  (select c from aur_candles where tk = p_tk and t <= p_t order by t desc limit 1))
$$;
create function bet_mark(b bets, p_px float8) returns float8 language sql immutable as $$
  select greatest(0, trade_value(b, coalesce(p_px, b.entry)) - b.stake * b.lev * 0.001)
$$;
create function week_pnl(p_user uuid, p_w0 timestamptz, p_w1 timestamptz) returns float8 language sql stable set search_path = public as $$
  select coalesce(sum(
           (case when b.status <> 'open' and b.closed_at < p_w1 then coalesce(b.payout, 0) else bet_mark(b, px_at(b.aur, p_w1)) end)
         - (case when b.created_at >= p_w0 then b.stake + coalesce(b.fee_open, 0) else bet_mark(b, px_at(b.aur, p_w0)) end)), 0)
  from bets b
  where b.user_id = p_user and b.kind = 'aurelys' and b.created_at < p_w1 and (b.status = 'open' or b.closed_at >= p_w0)
$$;
create function week_trades(p_user uuid, p_w0 timestamptz, p_w1 timestamptz) returns int language sql stable set search_path = public as $$
  select count(*)::int from bets b where b.user_id = p_user and b.kind = 'aurelys' and b.status <> 'open'
     and b.closed_at >= p_w0 and b.closed_at < p_w1 and ach_valid(b)
$$;
revoke execute on function px_at(text, timestamptz), bet_mark(bets, float8), week_pnl(uuid, timestamptz, timestamptz),
  week_trades(uuid, timestamptz, timestamptz) from public, anon, authenticated;
-- Patrimoine au début de chaque semaine (dénominateur du rendement des ligues, H6), relevé à la clôture.
create table week_wealth (user_id uuid not null references profiles on delete cascade, week date not null, wealth float8 not null,
  primary key (user_id, week));
create table week_runs (week date primary key, done_at timestamptz not null default now());
alter table week_wealth enable row level security;
alter table week_runs enable row level security;

-- ===== Niveaux de guilde =====
alter table guilds add column xp int not null default 0, add column open boolean not null default true,
  add column descr text check (char_length(descr) <= 280), add column emblem int not null default 0 check (emblem between 0 and 11),
  add column banner int not null default 0 check (banner between 0 and 7), add column target_ratio float8 not null default 1
  check (target_ratio between 1 and 5), add column goal_streak int not null default 0;
alter table profiles add column guild_left_at timestamptz;
-- XP de guilde pour atteindre le niveau n : 250 × n × (n − 1) (500 × n pour passer du niveau n au suivant), 20 au plus.
create function guild_level(p_xp int) returns int language sql immutable as $$
  select least(20, floor((1 + sqrt(1 + greatest(p_xp, 0) / 62.5)) / 2))::int
$$;
create function guild_level_xp(p_level int) returns int language sql immutable as $$ select 250 * p_level * (p_level - 1) $$;
create function guild_cap(p_level int) returns int language sql immutable as $$ select least(50, 10 + 5 * ((p_level - 1) / 2)) $$;
create function guild_min(p_members int, p_level int) returns float8 language sql immutable as $$
  select round((p_members * 10000 * 0.02 * (1 + 0.1 * (p_level - 1)))::numeric)::float8
$$;
create function guild_g(p_r float8) returns float8 language sql immutable as $$
  select case when p_r <= 1 then 0.1 when p_r <= 1.5 then 0.1 + 0.6 * (p_r - 1) when p_r <= 2 then 0.4 + 0.6 * (p_r - 1.5)
              when p_r <= 3 then 0.7 + 0.3 * (p_r - 2) when p_r <= 5 then 1 + 0.2 * (p_r - 3) else 1.4 end
$$;
create function guild_xp_for(p_members int, p_target float8, p_min float8, p_total float8) returns int language sql immutable as $$
  select case when p_total >= p_target then round((100 * p_members * guild_g(p_target / p_min))::numeric)
              when p_total >= 0.75 * p_target then round(round((100 * p_members * guild_g(p_target / p_min))::numeric) / 4) else 0 end::int
$$;
-- Emblèmes (12) et bannières (8) : SVG générés par scripts/guildes-svg.mjs ; niveau requis pour chacun.
create function guild_emblem_level(p int) returns int language sql immutable as $$
  select (array[1, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18])[p + 1]
$$;
create function guild_banner_level(p int) returns int language sql immutable as $$
  select (array[1, 2, 4, 6, 9, 12, 16, 20])[p + 1]
$$;

-- ===== Objectif de la semaine =====
create table guild_goals (guild_id bigint not null references guilds on delete cascade, week date not null,
  members int not null, level int not null, min float8 not null, target float8 not null,
  total float8, status text not null default 'open' check (status in ('open', 'reached', 'partial', 'missed')), xp int,
  primary key (guild_id, week));
create table guild_goal_members (guild_id bigint not null, week date not null, user_id uuid not null references profiles on delete cascade,
  contribution float8, trades int, primary key (guild_id, week, user_id),
  foreign key (guild_id, week) references guild_goals on delete cascade);
create index on guild_goal_members (user_id, week);
create table guild_invites (guild_id bigint not null references guilds on delete cascade, user_id uuid not null references profiles on delete cascade,
  at timestamptz not null default now(), primary key (guild_id, user_id));
-- Saison de guilde (mois civil, heure de Paris) : les 3 premières, récompenses cosmétiques (et 200 XP aux membres actifs).
create table guild_trophies (guild_id bigint not null references guilds on delete cascade, month date not null, rank int not null,
  chef uuid references profiles on delete set null, primary key (guild_id, month));
create table guild_month_runs (month date primary key, done_at timestamptz not null default now());
alter table guild_goals enable row level security;
alter table guild_goal_members enable row level security;
alter table guild_invites enable row level security;
alter table guild_trophies enable row level security;
alter table guild_month_runs enable row level security;

-- Verrouillage (lundi 0 h) : les membres présents (joueurs, pas les bots), le minimum au niveau du moment, la cible du chef.
-- p_at : membres arrivés jusqu'à cet instant (le lundi 0 h ; au déploiement, maintenant).
create function guild_lock(p_w0 timestamptz, p_at timestamptz default null) returns void language plpgsql security definer set search_path = public as $$
declare g record; n int; lv int; mn float8;
begin
  for g in select * from guilds loop
    select count(*) into n from guild_members m join profiles p on p.id = m.user_id and not p.bot where m.guild_id = g.id and m.joined_at <= coalesce(p_at, p_w0);
    if n = 0 then continue; end if;
    lv := guild_level(g.xp); mn := guild_min(n, lv);
    insert into guild_goals (guild_id, week, members, level, min, target) values (g.id, paris_date(p_w0), n, lv, mn, round(mn * g.target_ratio))
    on conflict do nothing;
    if found then
      insert into guild_goal_members (guild_id, week, user_id)
      select g.id, paris_date(p_w0), m.user_id from guild_members m join profiles p on p.id = m.user_id and not p.bot
       where m.guild_id = g.id and m.joined_at <= coalesce(p_at, p_w0);
    end if;
  end loop;
end $$;

-- Bilan d'une semaine : contributions bornées à [−10 %, +40 %] de la cible, XP de guilde, +50 XP aux membres qui ont fait
-- 3 trades valides ou plus si l'objectif est atteint, succès. Une fois par objectif (statut « open » → réglé).
create function guild_settle(p_w0 timestamptz) returns void language plpgsql security definer set search_path = public as $$
declare q guild_goals; w1 timestamptz := paris_week(p_w0 + interval '8 days'); tot float8; st text; x int; l0 int; m record;
begin
  for q in select * from guild_goals where week = paris_date(p_w0) and status = 'open' for update loop
    update guild_goal_members set contribution = greatest(-0.1 * q.target, least(0.4 * q.target, week_pnl(user_id, p_w0, w1))),
                                  trades = week_trades(user_id, p_w0, w1)
     where guild_id = q.guild_id and week = q.week;
    select coalesce(sum(contribution), 0) into tot from guild_goal_members where guild_id = q.guild_id and week = q.week;
    x := guild_xp_for(q.members, q.target, q.min, tot);
    st := case when tot >= q.target then 'reached' when tot >= 0.75 * q.target then 'partial' else 'missed' end;
    update guild_goals set total = tot, status = st, xp = x where guild_id = q.guild_id and week = q.week;
    select guild_level(xp) into l0 from guilds where id = q.guild_id;
    update guilds set xp = xp + x, goal_streak = case when st = 'reached' then goal_streak + 1 else 0 end where id = q.guild_id;
    for m in select gm.user_id, gm.trades, g.goal_streak, guild_level(g.xp) as lv
               from guild_goal_members gm join guilds g on g.id = gm.guild_id where gm.guild_id = q.guild_id and gm.week = q.week loop
      insert into notices (user_id, kind, body) values (m.user_id, 'guild', jsonb_build_object('status', st, 'total', round(tot), 'target', q.target,
        'xp', x, 'level', case when m.lv > l0 then m.lv end, 'me', case when st = 'reached' and m.trades >= 3 then 50 else 0 end));
      if st = 'reached' then
        if m.trades >= 3 then perform xp_grant(m.user_id, 'guild', q.guild_id || ':' || q.week, 50); end if;
        perform achievement_grant(m.user_id, 'OBJECTIF_GUILDE');
        if m.goal_streak >= 4 then perform achievement_grant(m.user_id, 'OBJECTIF_GUILDE_4'); end if;
      end if;
    end loop;
  end loop;
end $$;

-- Saison de guilde du mois p_m : XP de guilde gagnée sur les semaines commencées dans le mois ÷ membres actifs (3 trades
-- valides ou plus sur une de ces semaines), 5 membres actifs au moins. Top 3 : trophée, et 200 XP aux membres actifs.
create function guild_month_close(p_m date) returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  insert into guild_month_runs (month) values (p_m) on conflict do nothing;
  if not found then return; end if;
  for r in with s as (select q.guild_id, sum(q.xp) as xp from guild_goals q where q.week >= p_m and q.week < (p_m + interval '1 month')::date and q.status <> 'open' group by 1),
                a as (select gm.guild_id, count(distinct gm.user_id) as n from guild_goal_members gm
                       where gm.week >= p_m and gm.week < (p_m + interval '1 month')::date and gm.trades >= 3 group by 1)
           select s.guild_id, rank() over (order by s.xp::float8 / a.n desc) as rk from s join a using (guild_id) where a.n >= 5 and s.xp > 0
           order by 2 limit 3 loop
    insert into guild_trophies (guild_id, month, rank, chef) select r.guild_id, p_m, r.rk, owner from guilds where id = r.guild_id on conflict do nothing;
    perform xp_grant(gm.user_id, 'guild_month', p_m::text, 200) from (select distinct user_id from guild_goal_members
      where guild_id = r.guild_id and week >= p_m and week < (p_m + interval '1 month')::date and trades >= 3) gm;
  end loop;
end $$;

-- Clôture d'une semaine (une fois) : bilan des guildes, patrimoine de départ de la semaine suivante, verrouillage.
create function week_close(p_w0 timestamptz) returns boolean language plpgsql security definer set search_path = public as $$
declare w1 timestamptz := paris_week(p_w0 + interval '8 days');
begin
  insert into week_runs (week) values (paris_date(p_w0)) on conflict do nothing;
  if not found then return false; end if;
  perform guild_settle(p_w0);
  insert into week_wealth (user_id, week, wealth) select id, paris_date(w1), patrimoine(id) from profiles where not bot on conflict do nothing;
  perform guild_lock(w1);
  -- Dernière semaine commencée dans le mois : la saison de guilde du mois est close.
  if date_trunc('month', paris_date(w1)) > date_trunc('month', paris_date(p_w0)) then
    perform guild_month_close(date_trunc('month', paris_date(p_w0))::date);
  end if;
  return true;
end $$;
-- Toutes les heures : semaines finies pas encore closes (dans l'ordre), semaine en cours verrouillée, chef inactif depuis
-- 14 jours remplacé par le membre actif le plus ancien.
create function week_tick(p_now timestamptz default now()) returns int language plpgsql security definer set search_path = public as $$
declare w timestamptz; cur timestamptz := paris_week(p_now); n int := 0; g record; nxt uuid;
begin
  select coalesce(paris_week(paris_day_start(max(week)) + interval '8 days'), cur) into w from week_runs;
  while w < cur loop
    if week_close(w) then n := n + 1; end if;
    w := paris_week(w + interval '8 days');
  end loop;
  perform guild_lock(cur);
  for g in select gd.id, gd.owner from guilds gd join profiles p on p.id = gd.owner
            where not p.bot and coalesce(p.last_seen, p.created_at) < p_now - interval '14 days' loop
    select m.user_id into nxt from guild_members m join profiles p on p.id = m.user_id
     where m.guild_id = g.id and m.user_id <> g.owner and not p.bot and p.last_seen > p_now - interval '14 days' order by m.joined_at limit 1;
    if nxt is not null then update guilds set owner = nxt where id = g.id; end if;
  end loop;
  return n;
end $$;
revoke execute on function guild_lock(timestamptz, timestamptz), guild_settle(timestamptz), guild_month_close(date), week_close(timestamptz),
  week_tick(timestamptz) from public, anon, authenticated;

-- ===== Membres : 24 h entre deux guildes, invitations, plafond selon le niveau =====
create or replace function guild_join(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare g guilds; bot boolean := coalesce((select bot from profiles where id = auth.uid()), false);
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if exists (select 1 from guild_members where user_id = auth.uid()) then raise exception 'Quitte d''abord ta guilde.'; end if;
  if not bot and (select guild_left_at from profiles where id = auth.uid()) > now() - interval '24 hours' then
    raise exception 'Tu as quitté une guilde il y a moins de 24 h : réessaie après %.',
      to_char(((select guild_left_at from profiles where id = auth.uid()) + interval '24 hours') at time zone 'Europe/Paris', 'DD/MM à HH24:MI');
  end if;
  select * into g from guilds where id = p_id for update;
  if not found then raise exception 'Guilde introuvable.'; end if;
  if not g.open and not exists (select 1 from guild_invites where guild_id = p_id and user_id = auth.uid()) then
    raise exception 'Cette guilde est sur invitation.';
  end if;
  if (select count(*) from guild_members m join profiles p on p.id = m.user_id and not p.bot where m.guild_id = p_id) >= guild_cap(guild_level(g.xp)) then
    raise exception 'Guilde complète (% membres au niveau %).', guild_cap(guild_level(g.xp)), guild_level(g.xp);
  end if;
  insert into guild_members (user_id, guild_id) values (auth.uid(), p_id);
  delete from guild_invites where user_id = auth.uid();
end $$;
create or replace function guild_leave() returns void
language plpgsql security definer set search_path = public as $$
declare gid bigint; nxt uuid;
begin
  delete from guild_members where user_id = auth.uid() returning guild_id into gid;
  if gid is null then return; end if;
  update profiles set guild_left_at = now() where id = auth.uid();
  if (select owner from guilds where id = gid) = auth.uid() then
    select user_id into nxt from guild_members where guild_id = gid order by joined_at limit 1;
    if nxt is null then delete from guilds where id = gid;
    else update guilds set owner = nxt where id = gid; end if;
  end if;
end $$;
create or replace function guild_kick(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user = auth.uid() then raise exception 'Utilise « Quitter ».'; end if;
  delete from guild_members m using guilds g
  where m.user_id = p_user and g.id = m.guild_id and g.owner = auth.uid();
  if not found then raise exception 'Seul le chef peut exclure un membre.'; end if;
  update profiles set guild_left_at = now() where id = p_user;
end $$;
-- Le chef : transférer, ouvrir ou fermer, inviter, fixer la cible de la semaine prochaine, personnaliser.
create function guild_mine_owned() returns guilds language plpgsql stable security definer set search_path = public as $$
declare g guilds;
begin
  select * into g from guilds where owner = auth.uid();
  if not found then raise exception 'Réservé au chef de la guilde.'; end if;
  return g;
end $$;
create function guild_transfer(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare g guilds := guild_mine_owned();
begin
  if not exists (select 1 from guild_members m join profiles p on p.id = m.user_id and not p.bot where m.guild_id = g.id and m.user_id = p_user and p_user <> auth.uid()) then
    raise exception 'Choisis un autre membre de ta guilde.';
  end if;
  update guilds set owner = p_user where id = g.id;
end $$;
create function guild_set(p_open boolean default null, p_ratio float8 default null, p_emblem int default null, p_banner int default null,
  p_color text default null, p_motto text default null, p_descr text default null) returns guilds
language plpgsql security definer set search_path = public as $$
declare g guilds := guild_mine_owned(); lv int := guild_level(g.xp);
begin
  if p_ratio is not null and not (p_ratio between 1 and 5) then raise exception 'Cible : de 1 à 5 fois le minimum.'; end if;
  if p_emblem is not null and (p_emblem not between 0 and 11 or guild_emblem_level(p_emblem) > lv) then raise exception 'Emblème débloqué au niveau % de guilde.', guild_emblem_level(least(11, greatest(0, p_emblem))); end if;
  if p_banner is not null and (p_banner not between 0 and 7 or guild_banner_level(p_banner) > lv) then raise exception 'Bannière débloquée au niveau % de guilde.', guild_banner_level(least(7, greatest(0, p_banner))); end if;
  if p_descr is not null and lv < 3 then raise exception 'La description se débloque au niveau 3 de guilde.'; end if;
  if p_motto is not null and name_banned(p_motto) or p_descr is not null and name_banned(p_descr) then raise exception 'Ce texte contient un mot interdit.'; end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Couleur invalide.'; end if;
  update guilds set open = coalesce(p_open, open), target_ratio = coalesce(round(p_ratio::numeric, 2)::float8, target_ratio),
         emblem = coalesce(p_emblem, emblem), banner = coalesce(p_banner, banner), color = coalesce(p_color, color),
         motto = case when p_motto is null then motto else nullif(trim(p_motto), '') end,
         descr = case when p_descr is null then descr else nullif(trim(p_descr), '') end
   where id = g.id returning * into g;
  return g;
end $$;
create function guild_invite(p_pseudo text) returns void language plpgsql security definer set search_path = public as $$
declare g guilds := guild_mine_owned(); u uuid;
begin
  select id into u from profiles where lower(pseudo) = lower(trim(p_pseudo)) and not bot;
  if u is null then raise exception 'Aucun joueur « % ».', trim(p_pseudo); end if;
  if exists (select 1 from guild_members where user_id = u and guild_id = g.id) then raise exception 'Ce joueur est déjà dans ta guilde.'; end if;
  insert into guild_invites (guild_id, user_id) values (g.id, u) on conflict do nothing;
end $$;
create function my_guild_invites() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'tag', g.tag)), '[]')
    from guild_invites i join guilds g on g.id = i.guild_id where i.user_id = auth.uid()
$$;

-- Fonder : nom filtré (20261028400000_niveaux_quetes.sql).
create or replace function guild_create(p_name text, p_tag text, p_motto text default null) returns guilds
language plpgsql security definer set search_path = public as $$
declare g guilds;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if trader_level(auth.uid()) < 8 and not coalesce((select bot from profiles where id = auth.uid()), false) then
    raise exception 'Créer une guilde : niveau 8 de trader (tu es niveau %).', trader_level(auth.uid());
  end if;
  if exists (select 1 from guild_members where user_id = auth.uid()) then raise exception 'Quitte d''abord ta guilde.'; end if;
  if (select guild_left_at from profiles where id = auth.uid()) > now() - interval '24 hours' then raise exception 'Tu as quitté une guilde il y a moins de 24 h.'; end if;
  if name_banned(p_name) or name_banned(p_tag) or name_banned(coalesce(p_motto, '')) then raise exception 'Ce nom contient un mot interdit ou réservé.'; end if;
  if exists (select 1 from guilds where lower(name) = lower(trim(p_name)) or tag = upper(trim(p_tag))) then raise exception 'Ce nom ou ce sigle est déjà pris.'; end if;
  insert into guilds (name, tag, motto, owner) values (trim(p_name), upper(trim(p_tag)), nullif(trim(p_motto), ''), auth.uid()) returning * into g;
  insert into guild_members (user_id, guild_id) values (auth.uid(), g.id);
  return g;
end $$;

-- Liste et recherche : niveau, membres (joueurs), plafond, ouverte ; recherche par nom ou sigle.
drop function guild_list(text);
create function guild_list(p_period text default 'today', p_q text default null)
returns table (id bigint, name text, tag text, motto text, members int, gain float8, mine boolean, cap int, level int, open boolean, emblem int, color text)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.tag, g.motto, count(m.user_id)::int,
         coalesce(sum(gain_since(m.user_id, case when p_period = 'today' then day_start() end)), 0),
         coalesce(bool_or(m.user_id = auth.uid()), false), guild_cap(guild_level(g.xp)), guild_level(g.xp), g.open, g.emblem, g.color
  from guilds g left join guild_members m on m.guild_id = g.id
  where p_q is null or g.name ilike '%' || p_q || '%' or g.tag ilike p_q || '%'
  group by g.id order by 6 desc, 5 desc limit 50
$$;

-- Page d'une guilde (par son id ou son nom) : niveau, objectif de la semaine en direct, membres et contributions,
-- trophées, historique des objectifs, meilleurs contributeurs.
create function guild_page(p_id bigint default null, p_name text default null) returns jsonb
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
revoke execute on function guild_page(bigint, text), guild_list(text, text), guild_transfer(uuid), guild_set(boolean, float8, int, int, text, text, text),
  guild_invite(text), my_guild_invites(), guild_mine_owned() from public, anon;
grant execute on function guild_page(bigint, text), guild_list(text, text), guild_transfer(uuid), guild_set(boolean, float8, int, int, text, text, text),
  guild_invite(text), my_guild_invites() to authenticated;
revoke execute on function guild_mine_owned() from authenticated;
revoke execute on function guild_level(int), guild_level_xp(int), guild_cap(int), guild_min(int, int), guild_g(float8),
  guild_xp_for(int, float8, float8, float8), guild_emblem_level(int), guild_banner_level(int) from anon;

-- Quêtes de guilde : les trades gagnants d'un membre compté dans l'objectif de la semaine (20261028400000_niveaux_quetes.sql).
create or replace function quest_ok(p_user uuid, p_needs text) returns boolean language sql stable set search_path = public as $$
  select case p_needs when 'lev10' then aur_max_lev(p_user) >= 10
                      when 'guild' then exists (select 1 from guild_goal_members where user_id = p_user and week = paris_date(paris_week(now()))) else true end
$$;
create or replace function quest_progress(p_user uuid, p_code text, p_t0 timestamptz, p_t1 timestamptz) returns int
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
      when p_code in ('guild_win', 'w_guild_10') then count(*) filter (where g > 0 and exists (select 1 from guild_goal_members m
                                                    where m.user_id = p_user and m.week = paris_date(paris_week(v.closed_at))))
      when p_code in ('w_days_3', 'w_days_5') then count(distinct paris_date(closed_at))
      when p_code = 'w_stop_5' then count(*) filter (where sl is not null or tp is not null)
      else 0 end into n from v;
  end if;
  return coalesce(n, 0);
end $$;

-- Départ : guildes au niveau 1, membres gardés (même au-delà de 10 : le plafond ne bloque que les arrivées), semaine en cours
-- verrouillée avec ses membres actuels, patrimoine de départ relevé maintenant.
select guild_lock(paris_week(now()), now());
insert into week_wealth (user_id, week, wealth) select id, paris_date(paris_week(now())), patrimoine(id) from profiles where not bot on conflict do nothing;
insert into week_runs (week) values (paris_date(paris_week(now()) - interval '7 days')) on conflict do nothing;

do $$ begin
  perform cron.schedule('wikibourse-semaine', '5 * * * *', 'select public.week_tick()');
exception when others then raise notice 'clôture des semaines non planifiée (%)', sqlerrm; end $$;
