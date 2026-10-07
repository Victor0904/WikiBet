-- ===== Bourse d'Aurelys, version 2 =====
-- - Le temps ralentit : 1 minute d'Aurelys = 5 s réelles, une journée d'Aurelys = 2 h (on a le temps de lire et de réfléchir).
--   L'état de la simulation change de format : il repart des derniers cours connus (voir la fonction aurelys).
-- - Bougies d'une heure d'Aurelys (5 min réelles), gardées 10 jours réels (120 jours d'Aurelys).
-- - Une 13e entreprise, Ondéo Live, et des entreprises branchées sur des chiffres réels (aur_signals).
-- - Le levier ×10 se mérite : 30 positions Aurelys clôturées d'abord.

insert into aur_stocks (tk, name, sector, liq) values ('OND', 'Ondéo Live', 'loisirs', 20000) on conflict do nothing;

delete from aur_state;
delete from aur_ticks where t > now();
delete from aur_news where t > now();
delete from aur_candles; -- bougies d'une minute réelle : remplacées par des bougies d'une heure d'Aurelys

-- Heure d'Aurelys qui contient l'instant t (EPOCH_S = 1er octobre 2026, 300 s réelles par heure de jeu).
create function aur_hour(p_t timestamptz) returns timestamptz language sql immutable as $$
  select to_timestamp(1790812800 + floor((extract(epoch from p_t) - 1790812800) / 300) * 300)
$$;

create or replace function aur_settle() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  insert into aur_candles (tk, t, o, h, l, c, v)
  select tk, aur_hour(t), (array_agg(p order by t))[1], max(p), min(p), (array_agg(p order by t desc))[1], sum(v)
    from aur_ticks where t >= aur_hour(now()) - interval '5 minutes' and t <= now()
   group by tk, aur_hour(t)
  on conflict (tk, t) do update set o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v;
  for r in select id from bets where kind = 'aurelys' and status = 'open' loop
    if (aur_liquidate(r.id)).status = 'lost' then n := n + 1; end if;
  end loop;
  delete from aur_ticks where t < now() - interval '2 hours';
  delete from aur_candles where t < now() - interval '10 days';
  delete from aur_news where t < now() - interval '10 days';
  delete from aur_orders where taken and t < now() - interval '1 hour';
  return n;
end $$;

-- Premier chargement : la dernière heure réelle (12 h d'Aurelys) ; ensuite, la suite seulement.
create or replace function aur_feed(p_since timestamptz default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', extract(epoch from now()),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(extract(epoch from k.t)::bigint, k.tk, k.p, k.v, k.halt) order by k.t, k.tk)
                      from aur_ticks k where k.t > greatest(coalesce(p_since, '-infinity'), now() - interval '15 minutes') and k.t <= now()), '[]'),
    'x', (select k.x from aur_ticks k where k.tk = 'AUR12' and k.t <= now() order by k.t desc limit 1))
$$;
-- Cours minute par minute d'une action (jusqu'à 2 h réelles = 1 jour d'Aurelys), pour la fiche.
create function aur_ticks_of(p_tk text, p_minutes int) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(extract(epoch from t)::bigint, p, v, halt) order by t), '[]')
  from aur_ticks where tk = p_tk and t > now() - make_interval(mins => least(greatest(p_minutes, 1), 120)) and t <= now()
$$;
-- Bougies d'une heure d'Aurelys : toutes les actions (p_tk nul) ou une seule, sur au plus 10 jours réels.
create or replace function aur_history(p_tk text, p_minutes int) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(tk, rows), '{}') from (
    select tk, jsonb_agg(jsonb_build_array(extract(epoch from t)::bigint, o, h, l, c, v) order by t) as rows
    from aur_candles where (p_tk is null or tk = p_tk) and t > now() - make_interval(mins => least(greatest(p_minutes, 1), 14400))
    group by tk) x
$$;

-- ===== Chiffres réels =====
-- Dernier relevé des signaux (rempli par la fonction aurelys au plus tous les quarts d'heure) : lisible par tous.
create table aur_signals (id int primary key default 1 check (id = 1), at timestamptz not null, data jsonb not null);
alter table aur_signals enable row level security;
create policy "lecture publique" on aur_signals for select using (true);

-- Audience Steam et Twitch maintenant et la veille à la même heure (dernier relevé de chaque sujet sur 6 minutes).
create function aur_real_inputs() returns jsonb language sql stable security definer set search_path = public as $$
  with w as (
    select distinct on (login, cur) login, login like 'steam:%' as steam, cur, viewers
    from (select login, viewers, at, at >= now() - interval '6 minutes' as cur from stream_ticks
          where live and (at >= now() - interval '6 minutes' or at between now() - interval '1 day 6 minutes' and now() - interval '1 day')) t
    order by login, cur, at desc)
  select jsonb_build_object(
    'steam_now', sum(viewers) filter (where steam and cur), 'steam_then', sum(viewers) filter (where steam and not cur),
    'twitch_now', sum(viewers) filter (where not steam and cur), 'twitch_then', sum(viewers) filter (where not steam and not cur))
  from w
$$;

-- ===== Levier ×10 réservé aux joueurs expérimentés =====
create function aur_xp(p_user uuid) returns int language sql stable set search_path = public as $$
  select count(*)::int from bets where user_id = p_user and kind = 'aurelys' and status <> 'open'
$$;
create function my_aur_xp() returns int language sql stable security definer set search_path = public as $$ select aur_xp(auth.uid()) $$;

create or replace function aur_open(p_user uuid, p_tk text, p_dir text, p_lev int, p_stake float8, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets; k aur_ticks; s aur_stocks; fee float8; px float8; expo float8;
begin
  select * into s from aur_stocks where tk = p_tk;
  if not found then raise exception 'Action inconnue.'; end if;
  if p_dir not in ('up', 'down') or p_lev not in (1, 5, 10) or not (p_stake > 0) then raise exception 'Ordre invalide.'; end if;
  if p_lev = 10 and aur_xp(p_user) < 30 then raise exception 'Le levier ×10 se débloque après 30 positions clôturées sur Aurelys.'; end if;
  k := aur_last(p_tk);
  if k.t is null or k.t < now() - interval '30 seconds' then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  if k.halt then raise exception 'Cotation suspendue sur cette action.'; end if;
  select coalesce(sum(stake * lev), 0) into expo from bets where user_id = p_user and kind = 'aurelys' and aur = p_tk and status = 'open';
  if expo + p_stake * p_lev > 20 * s.liq then
    raise exception 'Plafond atteint : au plus % W engagés sur cette action (mise × levier).', to_char(20 * s.liq, 'FM999G999G999');
  end if;
  px := k.p * (1 + (case when p_dir = 'up' then 1 else -1 end) * least(greatest(coalesce(p_slip, 0), 0), 0.2));
  fee := p_stake * p_lev * 0.001;
  update profiles set cash = cash - p_stake - fee where id = p_user and cash >= p_stake + fee;
  if not found then raise exception 'Solde insuffisant (mise + frais).'; end if;
  select * into g from game_now();
  insert into bets (user_id, session, day, kind, stake, aur, dir, lev, entry, fees)
  values (p_user, g.k, g.d, 'aurelys', p_stake, p_tk, p_dir, p_lev, px, fee) returning * into b;
  insert into aur_orders (tk, q) values (p_tk, (case when p_dir = 'up' then 1 else -1 end) * p_stake * p_lev);
  return b;
end $$;

revoke execute on function aur_real_inputs(), aur_xp(uuid), aur_open(uuid, text, text, int, float8, float8) from public, anon, authenticated;
revoke execute on function my_aur_xp(), aur_ticks_of(text, int) from public, anon;
grant execute on function my_aur_xp(), aur_ticks_of(text, int) to authenticated;
