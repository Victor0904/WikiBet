-- Deuxième revue (octobre 2026) : salaire sans faille de couverture, bots à égalité avec les joueurs, guildes de bots
-- ouvertes aux joueurs, base allégée.

-- ===== Salaire =====
-- 1. Exposition nette par action : une hausse et une baisse sur la même action se compensent (mise × levier).
--    Par action, compte min(mises, |exposition nette| ) : une position seule compte pour sa mise, une couverture pour rien.
-- 2. Une heure d'Aurelys au moins (150 s réelles), pour que la position ait le temps de bouger.
-- 3. Dégressif selon le patrimoine : plein sous 20 000 W, nul au-dessus de 100 000 W. Une aide pour remonter, pas une rente.
create function salary_factor(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select least(1, greatest(0, (100000 - patrimoine(p_user)) / 80000))
$$;

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
                    group by 1, 2, 3) x
            group by 1, 2 loop
    insert into salaries values (r.user_id, r.session, r.amt) on conflict do nothing;
    get diagnostics rc = row_count;
    if rc > 0 and r.amt > 0 then update profiles set cash = cash + r.amt where id = r.user_id; end if;
  end loop;
  return n;
end $$;

-- ===== Bots : ils paient l'impact de leurs ordres =====
-- bots_plan() décide (qui, quoi) ; la fonction aurelys exécute par aur_open / aur_close avec l'impact calculé par le
-- moteur, exactement comme pour un joueur.
drop function bots_play();
create function bots_plan() returns table (bot uuid, what text, bet bigint, tk text, dir text, lev int, stake float8)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r record; b bets; s aur_stocks; p1 float8; p0 float8;
begin
  for r in select p.id, p.cash, p.pseudo from profiles p
            where p.bot and (p.last_seen is null or p.last_seen < now() - make_interval(secs => 120 + random() * 600)) loop
    update profiles set last_seen = now() where id = r.id; -- présence dans la ville de sa guilde
    select * into b from bets x where x.user_id = r.id and x.kind = 'aurelys' and x.status = 'open'
       and x.created_at < now() - interval '3 minutes' order by random() limit 1;
    if found and random() < .5 then
      bot := r.id; what := 'close'; bet := b.id; tk := b.aur; dir := b.dir; lev := b.lev; stake := b.stake;
      return next; continue;
    end if;
    select * into s from aur_stocks x where x.status in ('core', 'listed') order by random() limit 1;
    p1 := (aur_last(s.tk)).p;
    if p1 is null then continue; end if;
    select k.p into p0 from aur_ticks k where k.tk = s.tk and k.t < now() - interval '2 minutes' order by k.t desc limit 1;
    bot := r.id; what := 'open'; bet := null; tk := s.tk;
    dir := case when (p1 >= coalesce(p0, p1)) = (hashtext(r.pseudo) % 2 = 0) then 'up' else 'down' end; -- suiveur ou contrarien
    lev := (array[1, 5, 5, 10])[1 + floor(random() * 4)::int];
    if s.status = 'listed' then lev := least(lev, 5); end if;
    stake := greatest(50, round(r.cash * (.02 + random() * .06)));
    return next;
  end loop;
  -- Faillite d'un bot : il repart à 10 000 W, comme un joueur (jamais de compte à zéro dans les guildes).
  update profiles p set cash = 10000, bankruptcies = p.bankruptcies + 1
   where p.bot and bk_value(p.id) < 2000 and not exists (select 1 from bets x where x.user_id = p.id and x.status = 'open');
end $$;
revoke execute on function bots_plan() from public, anon, authenticated;

-- ===== Guildes de bots ouvertes aux joueurs =====
-- Quand un joueur rejoint une guilde, un bot lui cède sa place ; si le fondateur est un bot, le joueur prend la direction.
create function guild_bot_yield() returns trigger language plpgsql security definer set search_path = public as $$
declare out_bot uuid;
begin
  if (select bot from profiles where id = new.user_id) then return new; end if;
  update guilds g set owner = new.user_id where g.id = new.guild_id and (select bot from profiles where id = g.owner);
  select m.user_id into out_bot from guild_members m join profiles p on p.id = m.user_id
   where m.guild_id = new.guild_id and p.bot order by m.joined_at desc limit 1;
  delete from guild_members where user_id = out_bot;
  return new;
end $$;
create trigger guild_bot_yield after insert on guild_members for each row execute function guild_bot_yield();

-- ===== Base allégée : paris des bots réglés depuis plus de 3 jours =====
-- Remplacés par une seule ligne de cumul par bot (kind = 'invest', gain = payout − mise) : le classement des gains garde
-- le même total. Chaque nuit, avec le ménage.
create function bots_compact() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with old as (delete from bets b using profiles p
                where p.id = b.user_id and p.bot and b.status <> 'open' and b.closed_at < now() - interval '3 days'
                returning b.user_id, bet_gain(b) g, b.closed_at),
       agg as (select user_id, sum(g) g, max(closed_at) at, count(*) c from old group by 1),
       ins as (insert into bets (user_id, session, day, kind, stake, status, payout, created_at, closed_at)
               select user_id, 0, 0, 'invest', greatest(1, 1 - g), case when g >= 0 then 'won' else 'lost' end,
                      greatest(1, 1 - g) + g, at, at from agg)
  select coalesce(sum(c), 0) into n from agg;
  return n;
end $$;
revoke execute on function bots_compact() from public, anon, authenticated;
do $$ begin
  perform cron.schedule('wikibourse-bots', '27 4 * * *', 'select public.bots_compact()');
exception when others then null; end $$;
