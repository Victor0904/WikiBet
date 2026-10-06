-- Wiki-Bourse : schéma, règles d'accès et fonctions de jeu.
-- La base fait foi : les paris s'ouvrent, se clôturent et se règlent ici, à l'heure du serveur.
-- Les joueurs ne peuvent rien écrire directement ; tout passe par les fonctions en bas de fichier.

-- ===== Données du jeu (remplies par scripts/seed.mjs) =====
create table game_config (
  id int primary key default 1 check (id = 1),
  epoch timestamptz not null,       -- début de la séance 0
  play_ms int not null,             -- durée de jeu d'une séance
  pause_ms int not null,            -- pause entre deux séances
  ticks int not null,               -- minutes de jeu par séance (510 = 9:00 → 17:30)
  start_day int not null,           -- premier jour de données rejoué
  nsess int not null                -- nombre de jours rejoués en boucle
);
create table articles (tk text primary key, slug text not null, name text not null, sector text not null);
create table views (tk text references articles on delete cascade, day int, views int not null, primary key (tk, day));
-- Cours minute par minute d'un article pour un jour de données : ticks + 1 points, calculés par src/engine.js.
create table prices (day int, tk text references articles on delete cascade, px float8[] not null, primary key (day, tk));
create table duels (
  id text primary key, day int not null,
  a text not null references articles, b text not null references articles,
  oa numeric not null, ob numeric not null, boost text
);
create index on duels (day);

-- ===== Joueurs et paris =====
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  pseudo text not null unique check (char_length(pseudo) between 2 and 20),
  cash float8 not null default 10000 check (cash >= 0),
  bankruptcies int not null default 0,
  created_at timestamptz not null default now()
);
create table bets (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles on delete cascade,
  session int not null,
  day int not null,
  kind text not null check (kind in ('trade', 'duel')),
  stake float8 not null check (stake > 0),
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  payout float8,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  -- position
  tk text references articles,
  dir text check (dir in ('up', 'down')),
  lev int check (lev in (1, 5, 10)),
  entry float8, start_tick int, end_tick int, exit float8, closed_tick int,
  -- duel
  duel_id text references duels,
  side text check (side in ('a', 'b')),
  odds numeric
);
create index on bets (user_id, session desc);
create index on bets (session) where status = 'open';
-- Salaire versé une fois par séance jouée (au moins un pari).
create table salaries (user_id uuid references profiles on delete cascade, session int, primary key (user_id, session));

-- ===== Horloge et cours =====
-- Séance en cours à l'instant `at` : même calcul que session() dans src/engine.js.
create function game_now(p_at timestamptz default now())
returns table (k int, d int, t int, playing boolean)
language sql stable set search_path = public as $$
  select x.k,
         c.start_day + mod(x.k, c.nsess),
         case when x.off < c.play_ms then floor(x.off * c.ticks / c.play_ms)::int else c.ticks end,
         x.off < c.play_ms
  from game_config c,
  lateral (select m.ms, floor(m.ms / (c.play_ms + c.pause_ms))::int as k,
                  m.ms - floor(m.ms / (c.play_ms + c.pause_ms)) * (c.play_ms + c.pause_ms) as off
           from (select floor(extract(epoch from p_at - c.epoch) * 1000) as ms) m) x
$$;

create function server_time() returns timestamptz language sql stable as $$ select now() $$;

create function price_at(p_day int, p_tk text, p_t int) returns float8
language sql stable set search_path = public as $$
  select px[least(greatest(p_t, 0), array_length(px, 1) - 1) + 1] from prices where day = p_day and tk = p_tk
$$;

-- Valeur d'une position : mise × (1 + levier × sens × variation), jamais sous 0.
create function trade_value(b bets, px float8) returns float8 language sql immutable as $$
  select greatest(0, b.stake * (1 + b.lev * (case when b.dir = 'up' then 1 else -1 end) * (px / b.entry - 1)))
$$;

-- ===== Règlement (fonctions internes) =====
-- Clôture une position à la minute p_upto. Si la valeur est tombée à 0 avant, elle est liquidée à ce moment-là.
-- Sans p_force, ne fait que la liquidation éventuelle.
create function close_trade_at(p_id bigint, p_upto int, p_force boolean) returns bets
language plpgsql set search_path = public as $$
declare b bets; arr float8[]; liq int; px float8; pay float8;
begin
  select * into b from bets where id = p_id and status = 'open' and kind = 'trade' for update;
  if not found then return null; end if;
  select p.px into arr from prices p where p.day = b.day and p.tk = b.tk;
  select min(i) into liq from generate_subscripts(arr, 1) i
   where i - 1 > b.start_tick and i - 1 <= p_upto and trade_value(b, arr[i]) <= 0;
  if liq is not null then
    px := arr[liq]; pay := 0; p_upto := liq - 1;
  elsif p_force then
    px := arr[p_upto + 1]; pay := trade_value(b, px);
  else
    return b;
  end if;
  update bets set status = case when pay > b.stake then 'won' else 'lost' end,
                  payout = pay, exit = px, closed_tick = p_upto, closed_at = now()
   where id = b.id returning * into b;
  update profiles set cash = cash + pay where id = b.user_id;
  return b;
end $$;

-- Règle un duel sur les vraies vues du lendemain du jour de données.
create function settle_duel(p_id bigint) returns void
language plpgsql set search_path = public as $$
declare b bets; du duels; va int; vb int; pay float8;
begin
  select * into b from bets where id = p_id and status = 'open' and kind = 'duel' for update;
  if not found then return; end if;
  select * into du from duels where id = b.duel_id;
  select views into va from views where tk = du.a and day = b.day + 1;
  select views into vb from views where tk = du.b and day = b.day + 1;
  pay := case when (va > vb) = (b.side = 'a') then b.stake * b.odds else 0 end;
  update bets set status = case when pay > 0 then 'won' else 'lost' end, payout = pay, closed_at = now() where id = b.id;
  update profiles set cash = cash + pay where id = b.user_id;
end $$;

-- Règle tout ce qui est dû. Appelée chaque minute par pg_cron et par les clients (sans risque de double paiement :
-- chaque règlement verrouille la ligne et vérifie qu'elle est encore ouverte).
create function settle() returns int
language plpgsql security definer set search_path = public as $$
declare g record; r record; n int := 0; rc int; due boolean;
begin
  select * into g from game_now();
  for r in select id, session, end_tick from bets where status = 'open' and kind = 'trade' loop
    due := r.session < g.k or not g.playing or r.end_tick <= g.t;
    perform close_trade_at(r.id, case when due then r.end_tick else g.t end, due);
    n := n + 1;
  end loop;
  for r in select id from bets where status = 'open' and kind = 'duel' and (session < g.k or (session = g.k and not g.playing)) loop
    perform settle_duel(r.id); n := n + 1;
  end loop;
  for r in select distinct user_id, session from bets
            where session >= g.k - 5 and (session < g.k or not g.playing) loop
    insert into salaries values (r.user_id, r.session) on conflict do nothing;
    get diagnostics rc = row_count;
    if rc > 0 then update profiles set cash = cash + 500 where id = r.user_id; end if;
  end loop;
  return n;
end $$;

-- ===== Actions des joueurs =====
create function create_profile(p_pseudo text) returns profiles
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  insert into profiles (id, pseudo) values (auth.uid(), trim(p_pseudo)) returning * into p;
  return p;
exception when unique_violation then
  raise exception 'Ce pseudo est déjà pris.';
end $$;

create function open_trade(p_tk text, p_dir text, p_lev int, p_stake float8, p_horizon text) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets; px float8; e int; n int;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  perform settle();
  select * into g from game_now();
  select ticks into n from game_config;
  if not g.playing or g.t >= n then raise exception 'La séance est fermée, attends le coup d''envoi.'; end if;
  if p_horizon not in ('15', '60', 'close') then raise exception 'Échéance inconnue.'; end if;
  e := case p_horizon when 'close' then n else least(n, g.t + p_horizon::int) end;
  px := price_at(g.d, p_tk, g.t);
  if px is null then raise exception 'Article inconnu.'; end if;
  update profiles set cash = cash - p_stake where id = auth.uid() and p_stake > 0 and cash >= p_stake;
  if not found then raise exception 'Solde insuffisant.'; end if;
  insert into bets (user_id, session, day, kind, stake, tk, dir, lev, entry, start_tick, end_tick)
  values (auth.uid(), g.k, g.d, 'trade', p_stake, p_tk, p_dir, p_lev, px, g.t, e) returning * into b;
  return b;
end $$;

create function close_trade(p_id bigint) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets;
begin
  select * into b from bets where id = p_id and user_id = auth.uid() and kind = 'trade';
  if not found then raise exception 'Position introuvable.'; end if;
  if b.status <> 'open' then return b; end if;
  select * into g from game_now();
  if b.session <> g.k or not g.playing then
    perform settle();
    select * into b from bets where id = p_id;
    return b;
  end if;
  b := close_trade_at(p_id, least(g.t, b.end_tick), true);
  return coalesce(b, (select x from bets x where x.id = p_id));
end $$;

create function bet_duel(p_duel text, p_side text, p_stake float8) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; du duels; o numeric; b bets; n int;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  select * into g from game_now();
  select ticks into n from game_config;
  if not g.playing then raise exception 'La séance est fermée, attends le coup d''envoi.'; end if;
  select * into du from duels where id = p_duel and day = g.d;
  if not found then raise exception 'Ce duel n''est pas au programme de la séance.'; end if;
  o := case p_side when 'a' then du.oa when 'b' then du.ob end;
  if o is null then raise exception 'Choisis un camp.'; end if;
  update profiles set cash = cash - p_stake where id = auth.uid() and p_stake > 0 and cash >= p_stake;
  if not found then raise exception 'Solde insuffisant.'; end if;
  insert into bets (user_id, session, day, kind, stake, duel_id, side, odds, start_tick, end_tick)
  values (auth.uid(), g.k, g.d, 'duel', p_stake, p_duel, p_side, o, g.t, n) returning * into b;
  return b;
end $$;

-- Faillite : sous 2 000 W (solde + mises en cours), on repart à 10 000 W et le compteur augmente.
create function restart() returns profiles
language plpgsql security definer set search_path = public as $$
declare tot float8; p profiles;
begin
  select cash + coalesce((select sum(stake) from bets where user_id = auth.uid() and status = 'open'), 0)
    into tot from profiles where id = auth.uid();
  if tot is null then raise exception 'Connexion requise.'; end if;
  if tot >= 2000 then raise exception 'Tu n''es pas en faillite.'; end if;
  update bets set status = 'lost', payout = 0, closed_at = now() where user_id = auth.uid() and status = 'open';
  update profiles set cash = 10000, bankruptcies = bankruptcies + 1 where id = auth.uid() returning * into p;
  return p;
end $$;

-- ===== Accès =====
alter table game_config enable row level security;
alter table articles enable row level security;
alter table views enable row level security;
alter table prices enable row level security;
alter table duels enable row level security;
alter table profiles enable row level security;
alter table bets enable row level security;
alter table salaries enable row level security;
create policy "lecture publique" on game_config for select using (true);
create policy "lecture publique" on articles for select using (true);
create policy "lecture publique" on views for select using (true);
create policy "lecture publique" on prices for select using (true);
create policy "lecture publique" on duels for select using (true);
create policy "classement public" on profiles for select using (true);
create policy "mes paris" on bets for select using (user_id = auth.uid());

revoke execute on function close_trade_at(bigint, int, boolean), settle_duel(bigint) from public, anon, authenticated;
revoke execute on function settle(), create_profile(text), open_trade(text, text, int, float8, text),
  close_trade(bigint), bet_duel(text, text, float8), restart() from public, anon;
grant execute on function settle(), create_profile(text), open_trade(text, text, int, float8, text),
  close_trade(bigint), bet_duel(text, text, float8), restart() to authenticated;

-- Temps réel : le classement et mes paris se mettent à jour sans recharger.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table profiles, bets;
  end if;
end $$;

-- Règlement automatique chaque minute (pg_cron est disponible sur Supabase).
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('wikibourse-settle', '* * * * *', 'select public.settle()');
exception when others then
  raise notice 'pg_cron indisponible (%), les clients appelleront settle() eux-mêmes.', sqlerrm;
end $$;
