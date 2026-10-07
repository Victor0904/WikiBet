-- ===== Classement des gains, amis et guildes de traders =====
-- Tout passe par des fonctions security definer : les tables elles-mêmes ne sont lisibles par personne.

-- Gain net d'un pari réglé : ce qui est revenu moins ce qui est parti (mise + frais d'ouverture).
-- Les frais de clôture sont déjà retirés du paiement ; ceux d'ouverture ont la même formule sur crypto et Aurelys.
create function bet_gain(b bets) returns float8 language sql immutable as $$
  select coalesce(b.payout, 0) - b.stake - case when b.kind in ('crypto', 'aurelys') then crypto_fee(b.stake, b.lev) else 0 end
$$;
-- Début du jour en heure de Paris : le classement du jour repart à zéro à minuit.
create function day_start() returns timestamptz language sql stable as $$
  select date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'
$$;
create index on bets (closed_at) where status <> 'open';
create index on bets (user_id, closed_at) where status <> 'open';

create function gain_since(p_user uuid, p_since timestamptz) returns float8 language sql stable set search_path = public as $$
  select coalesce(sum(bet_gain(b)), 0) from bets b
  where b.user_id = p_user and b.status <> 'open' and (p_since is null or b.closed_at >= p_since)
$$;

-- ===== Amis =====
-- Une ligne par demande (de user_id vers friend_id), acceptée quand l'autre accepte.
create table friends (
  user_id uuid references profiles on delete cascade,
  friend_id uuid references profiles on delete cascade,
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index on friends (friend_id);
create table guilds (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(name) between 3 and 24),
  tag text not null unique check (tag ~ '^[A-Z0-9]{2,4}$'),
  motto text check (char_length(motto) <= 80),
  owner uuid not null references profiles on delete cascade,
  created_at timestamptz not null default now()
);
create table guild_members (
  user_id uuid primary key references profiles on delete cascade,
  guild_id bigint not null references guilds on delete cascade,
  joined_at timestamptz not null default now()
);
create index on guild_members (guild_id);

create function friend_ids(p uuid) returns setof uuid language sql stable set search_path = public as $$
  select case when user_id = p then friend_id else user_id end from friends where accepted and p in (user_id, friend_id)
$$;

-- Ajouter par pseudo. Si l'autre m'a déjà demandé, c'est accepté directement.
create function friend_add(p_pseudo text) returns text
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  select id into t from profiles where lower(pseudo) = lower(trim(p_pseudo));
  if t is null then raise exception 'Aucun joueur avec ce pseudo.'; end if;
  if t = auth.uid() then raise exception 'C''est toi.'; end if;
  if exists (select 1 from friends where (user_id, friend_id) in ((auth.uid(), t), (t, auth.uid())) and accepted) then raise exception 'Vous êtes déjà amis.'; end if;
  if (select count(*) from friends where auth.uid() in (user_id, friend_id)) >= 100 then raise exception 'Limite de 100 amis atteinte.'; end if;
  update friends set accepted = true where user_id = t and friend_id = auth.uid();
  if found then return 'ami'; end if;
  insert into friends (user_id, friend_id) values (auth.uid(), t) on conflict do nothing;
  return 'envoye';
end $$;

-- Retirer un ami, refuser ou annuler une demande.
create function friend_remove(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from friends where (user_id = auth.uid() and friend_id = p_user) or (user_id = p_user and friend_id = auth.uid())
$$;

-- Mes amis et demandes : état 'ami', 'recu' (à accepter) ou 'envoye', avec les gains du jour et totaux.
create function my_friends() returns table (id uuid, pseudo text, state text, guild text, today float8, total float8)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo,
         case when f.accepted then 'ami' when f.user_id = auth.uid() then 'envoye' else 'recu' end,
         (select g.tag from guild_members m join guilds g on g.id = m.guild_id where m.user_id = p.id),
         gain_since(p.id, day_start()), gain_since(p.id, null)
  from friends f join profiles p on p.id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
  where auth.uid() in (f.user_id, f.friend_id)
  order by 3 desc, 5 desc
$$;

-- ===== Guildes =====
-- Ouvertes : on rejoint librement, 30 membres au plus, une seule guilde à la fois. Le fondateur peut exclure.

create function guild_create(p_name text, p_tag text, p_motto text default null) returns guilds
language plpgsql security definer set search_path = public as $$
declare g guilds;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if exists (select 1 from guild_members where user_id = auth.uid()) then raise exception 'Quitte d''abord ta guilde.'; end if;
  if exists (select 1 from guilds where lower(name) = lower(trim(p_name)) or tag = upper(trim(p_tag))) then raise exception 'Ce nom ou ce sigle est déjà pris.'; end if;
  insert into guilds (name, tag, motto, owner) values (trim(p_name), upper(trim(p_tag)), nullif(trim(p_motto), ''), auth.uid()) returning * into g;
  insert into guild_members (user_id, guild_id) values (auth.uid(), g.id);
  return g;
end $$;

create function guild_join(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if exists (select 1 from guild_members where user_id = auth.uid()) then raise exception 'Quitte d''abord ta guilde.'; end if;
  perform 1 from guilds where id = p_id for update; -- un seul arrivant à la fois, pour la limite de 30
  if not found then raise exception 'Guilde introuvable.'; end if;
  if (select count(*) from guild_members where guild_id = p_id) >= 30 then raise exception 'Guilde complète (30 membres).'; end if;
  insert into guild_members (user_id, guild_id) values (auth.uid(), p_id);
end $$;

-- Quitter : si le fondateur part, le plus ancien membre prend la suite ; sans membre, la guilde disparaît.
create function guild_leave() returns void
language plpgsql security definer set search_path = public as $$
declare gid bigint; nxt uuid;
begin
  delete from guild_members where user_id = auth.uid() returning guild_id into gid;
  if gid is null then return; end if;
  if (select owner from guilds where id = gid) = auth.uid() then
    select user_id into nxt from guild_members where guild_id = gid order by joined_at limit 1;
    if nxt is null then delete from guilds where id = gid;
    else update guilds set owner = nxt where id = gid; end if;
  end if;
end $$;

create function guild_kick(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user = auth.uid() then raise exception 'Utilise « Quitter ».'; end if;
  delete from guild_members m using guilds g
  where m.user_id = p_user and g.id = m.guild_id and g.owner = auth.uid();
  if not found then raise exception 'Seul le fondateur peut exclure un membre.'; end if;
end $$;

-- Classement des guildes : somme des gains de leurs membres actuels, du jour ou depuis toujours.
create function guild_list(p_period text default 'today')
returns table (id bigint, name text, tag text, motto text, members int, gain float8, mine boolean)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.tag, g.motto, count(m.user_id)::int,
         coalesce(sum(gain_since(m.user_id, case when p_period = 'today' then day_start() end)), 0),
         bool_or(m.user_id = auth.uid())
  from guilds g left join guild_members m on m.guild_id = g.id
  group by g.id order by 6 desc, 5 desc limit 50
$$;

create function guild_members_of(p_id bigint) returns table (id uuid, pseudo text, owner boolean, today float8, total float8)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo, g.owner = p.id, gain_since(p.id, day_start()), gain_since(p.id, null)
  from guild_members m join guilds g on g.id = m.guild_id join profiles p on p.id = m.user_id
  where m.guild_id = p_id order by 4 desc
$$;

-- ===== Classement des gains =====
-- p_period : 'today' (depuis minuit, heure de Paris) ou 'total'. p_scope : 'all', 'friends' (moi et mes amis) ou 'guild'.
-- ponytail: agrège tous les paris réglés à chaque appel ; table de cumuls par joueur et par jour si ça ralentit.
create function gains_board(p_period text default 'today', p_scope text default 'all')
returns table (id uuid, pseudo text, title text, guild text, gain float8, bets int)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo,
         (select s.name from inventory i join shop_items s on s.id = i.item_id
           where i.user_id = p.id and i.equipped and s.category = 'title' limit 1),
         (select g.tag from guild_members m join guilds g on g.id = m.guild_id where m.user_id = p.id),
         sum(bet_gain(b)), count(*)::int
  from bets b join profiles p on p.id = b.user_id
  where b.status <> 'open'
    and (p_period = 'total' or b.closed_at >= day_start())
    and (p_scope = 'all'
      or (p_scope = 'friends' and (p.id = auth.uid() or p.id in (select friend_ids(auth.uid()))))
      or (p_scope = 'guild' and p.id in (select user_id from guild_members
            where guild_id = (select guild_id from guild_members where user_id = auth.uid()))))
  group by p.id order by 5 desc limit 50
$$;

alter table friends enable row level security;
alter table guilds enable row level security;
alter table guild_members enable row level security;

revoke execute on function friend_add(text), friend_remove(uuid), my_friends(), guild_create(text, text, text), guild_join(bigint),
  guild_leave(), guild_kick(uuid), guild_list(text), guild_members_of(bigint), gains_board(text, text) from public, anon;
grant execute on function friend_add(text), friend_remove(uuid), my_friends(), guild_create(text, text, text), guild_join(bigint),
  guild_leave(), guild_kick(uuid), guild_list(text), guild_members_of(bigint), gains_board(text, text) to authenticated;
