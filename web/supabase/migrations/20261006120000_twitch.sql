-- Catégorie Streamers : positions sur la hausse ou la baisse du nombre de spectateurs d'un live Twitch.
-- Les relevés viennent de la fonction twitch-poll (supabase/functions), appelée chaque minute par pg_cron.
-- Les échéances sont en temps réel (15 min, 1 h ou fin du live), indépendantes des séances de 11 minutes.

create table streamers (
  login text primary key,
  display_name text not null,
  avatar text
);
-- Un relevé par streamer suivi et par minute. live = false : le stream est terminé (ou pas encore commencé).
create table stream_ticks (
  login text not null references streamers on delete cascade,
  at timestamptz not null,
  viewers int not null,
  live boolean not null,
  stream_id text,
  title text,
  game text,
  primary key (login, at)
);
create index on stream_ticks (at desc);
-- Jeton d'application Twitch, lu et écrit seulement par la fonction (aucune politique RLS : invisible des joueurs).
create table twitch_token (id int primary key default 1 check (id = 1), token text not null, expires_at timestamptz not null);

alter table bets drop constraint bets_kind_check;
alter table bets add constraint bets_kind_check check (kind in ('trade', 'duel', 'stream'));
alter table bets add column login text references streamers, add column end_at timestamptz, add column exit_at timestamptz;

alter table streamers enable row level security;
alter table stream_ticks enable row level security;
alter table twitch_token enable row level security;
create policy "lecture publique" on streamers for select using (true);
create policy "lecture publique" on stream_ticks for select using (true);

-- Streamers à relever en plus du top : ceux qui ont un pari ouvert, ou qui étaient en live il y a peu
-- (pour voir la fin de leur stream même s'ils sortent du top).
create function streamers_to_watch() returns table (login text) language sql stable set search_path = public as $$
  select login from bets where status = 'open' and kind = 'stream'
  union
  select login from stream_ticks where live and at > now() - interval '30 minutes'
$$;

-- Clôture une position sur un streamer à l'instant p_upto. Si la valeur est tombée à 0 avant (liquidation),
-- elle est fermée à ce relevé-là. Sans p_force, ne fait que la liquidation éventuelle.
create function close_stream_at(p_id bigint, p_upto timestamptz, p_force boolean) returns bets
language plpgsql set search_path = public as $$
declare b bets; liq stream_ticks; last stream_ticks; px float8; pay float8; at_ timestamptz;
begin
  select * into b from bets where id = p_id and status = 'open' and kind = 'stream' for update;
  if not found then return null; end if;
  select * into liq from stream_ticks s
   where s.login = b.login and s.live and s.at > b.created_at and s.at <= p_upto and trade_value(b, s.viewers) <= 0
   order by s.at limit 1;
  if found then
    px := liq.viewers; pay := 0; at_ := liq.at;
  elsif p_force then
    select * into last from stream_ticks s where s.login = b.login and s.live and s.at <= p_upto order by s.at desc limit 1;
    px := coalesce(last.viewers, b.entry); at_ := coalesce(last.at, b.created_at);
    pay := trade_value(b, px);
  else
    return b;
  end if;
  update bets set status = case when pay > b.stake then 'won' else 'lost' end,
                  payout = pay, exit = px, exit_at = at_, closed_at = now()
   where id = b.id returning * into b;
  update profiles set cash = cash + pay where id = b.user_id;
  return b;
end $$;

create function open_stream(p_login text, p_dir text, p_lev int, p_stake float8, p_horizon text) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; t stream_ticks; b bets;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if p_horizon not in ('15', '60', 'live') then raise exception 'Échéance inconnue.'; end if;
  select * into t from stream_ticks where login = p_login order by at desc limit 1;
  if not found or not t.live then raise exception 'Ce streamer n''est pas en live.'; end if;
  if t.at < now() - interval '3 minutes' then raise exception 'Pas de relevé récent pour ce live, réessaie dans une minute.'; end if;
  if t.viewers < 1 then raise exception 'Pas assez de spectateurs pour ouvrir une position.'; end if;
  select * into g from game_now();
  update profiles set cash = cash - p_stake where id = auth.uid() and p_stake > 0 and cash >= p_stake;
  if not found then raise exception 'Solde insuffisant.'; end if;
  insert into bets (user_id, session, day, kind, stake, login, dir, lev, entry, end_at)
  values (auth.uid(), g.k, g.d, 'stream', p_stake, p_login, p_dir, p_lev, t.viewers,
          case p_horizon when 'live' then null else now() + (p_horizon || ' minutes')::interval end)
  returning * into b;
  return b;
end $$;

-- close_trade sait maintenant clôturer une position sur un streamer.
create or replace function close_trade(p_id bigint) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets;
begin
  select * into b from bets where id = p_id and user_id = auth.uid() and kind in ('trade', 'stream');
  if not found then raise exception 'Position introuvable.'; end if;
  if b.status <> 'open' then return b; end if;
  if b.kind = 'stream' then
    b := close_stream_at(p_id, least(now(), coalesce(b.end_at, now())), true);
    return coalesce(b, (select x from bets x where x.id = p_id));
  end if;
  select * into g from game_now();
  if b.session <> g.k or not g.playing then
    perform settle();
    select * into b from bets where id = p_id;
    return b;
  end if;
  b := close_trade_at(p_id, least(g.t, b.end_tick), true);
  return coalesce(b, (select x from bets x where x.id = p_id));
end $$;

-- settle() règle aussi les positions sur streamers : échéance atteinte, fin du live ou liquidation.
create or replace function settle() returns int
language plpgsql security definer set search_path = public as $$
declare g record; r record; n int := 0; rc int; due boolean; ended timestamptz;
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
  for r in select id, login, created_at, end_at from bets where status = 'open' and kind = 'stream' loop
    -- fin du live : premier relevé hors ligne après l'ouverture
    select min(at) into ended from stream_ticks where login = r.login and not live and at > r.created_at;
    due := ended is not null or (r.end_at is not null and r.end_at <= now());
    perform close_stream_at(r.id, least(now(), coalesce(r.end_at, now()), coalesce(ended, now())), due);
    n := n + 1;
  end loop;
  for r in select distinct user_id, session from bets
            where session >= g.k - 5 and (session < g.k or not g.playing) loop
    insert into salaries values (r.user_id, r.session) on conflict do nothing;
    get diagnostics rc = row_count;
    if rc > 0 then update profiles set cash = cash + 500 where id = r.user_id; end if;
  end loop;
  return n;
end $$;

-- Tableau des streamers pour l'écran : une ligne par streamer vu dans les p_minutes dernières minutes,
-- avec son dernier relevé et sa courbe (instants en ms, spectateurs) sur la période.
create function stream_board(p_minutes int default 120)
returns table (login text, display_name text, avatar text, live boolean, viewers int, title text, game text, at timestamptz, ts float8[], vs int[])
language sql stable set search_path = public as $$
  with recent as (select * from stream_ticks where at > now() - make_interval(mins => p_minutes)),
       last as (select distinct on (login) * from recent order by login, at desc)
  select s.login, s.display_name, s.avatar, l.live, l.viewers, l.title, l.game, l.at,
         array(select floor(extract(epoch from r.at) * 1000) from recent r where r.login = s.login and r.live order by r.at),
         array(select r.viewers from recent r where r.login = s.login and r.live order by r.at)
  from streamers s join last l on l.login = s.login
  order by l.live desc, l.viewers desc
$$;

revoke execute on function close_stream_at(bigint, timestamptz, boolean), streamers_to_watch() from public, anon, authenticated;
revoke execute on function open_stream(text, text, int, float8, text) from public, anon;
grant execute on function open_stream(text, text, int, float8, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table stream_ticks;
  end if;
end $$;

-- Relève Twitch chaque minute : pg_cron appelle la fonction twitch-poll avec pg_net.
-- L'adresse du projet et la clé publique (anon) ne sont pas secrètes : elles sont déjà dans le site.
do $$ begin
  create extension if not exists pg_net;
  perform cron.schedule('wikibourse-twitch', '* * * * *', $cron$
    select net.http_post(
      url := 'https://urivyzajsfcbtbfrvjcs.supabase.co/functions/v1/twitch-poll',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyaXZ5emFqc2ZjYnRiZnJ2amNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODE1MzQsImV4cCI6MjEwNjg1NzUzNH0.urFCndYjySGLjHQqoli4-UaP843pVG2kR1ggW7SpIxo'),
      body := '{}'::jsonb)
  $cron$);
exception when others then
  raise notice 'relève Twitch non planifiée (%)', sqlerrm;
end $$;
