-- Bourse d'Aurelys : marché fictif simulé par agents (moteur : supabase/functions/_shared/aurelys.js).
-- La fonction serveur « aurelys » fait avancer la simulation toutes les 10 s, avec 20 s d'avance. Les cours à venir restent
-- cachés : aur_ticks n'est lisible que par aur_feed, qui s'arrête à now(), et les actualités ne sont visibles qu'à leur heure.
-- Les ordres des joueurs passent par la même fonction serveur, qui calcule l'impact de l'ordre sur le prix et appelle
-- aur_open / aur_close, réservées au serveur. Le prix de base est lu ici, à l'heure de la base.

-- Liquidité par minute de jeu (en aurels, 1 Ꜷ = 1 W), pour le plafond d'exposition d'un joueur (20 × liquidité). Même table que STOCKS dans le moteur.
create table aur_stocks (tk text primary key, name text not null, sector text not null, liq float8 not null);
insert into aur_stocks values
  ('NXR', 'Nexora Systems', 'tech', 60000), ('PXF', 'Pixelfold Studios', 'loisirs', 6000), ('OMB', 'Ombrelune Pharma', 'sante', 20000),
  ('HLV', 'Helvane Énergie', 'energie', 60000), ('FRC', 'Ferrocap Industries', 'industrie', 20000), ('VLS', 'Vélisse Motors', 'industrie', 20000),
  ('BCS', 'Banque Castellane', 'finance', 60000), ('MRV', 'Marivent Logistique', 'industrie', 20000), ('GTR', 'Granterre Agro', 'conso', 20000),
  ('LMR', 'Lumirue Distribution', 'conso', 60000), ('SLM', 'Solarmine Lithium', 'matieres', 6000), ('KST', 'Kestrel Aéro', 'industrie', 20000);

-- État complet de la simulation (valeurs fondamentales comprises) : jamais lisible par les joueurs.
create table aur_state (id int primary key default 1 check (id = 1), t bigint not null, state jsonb not null);
-- Cours de chaque seconde (ligne 'AUR12' = l'indice, avec régime, peur et macro dans x). Gardés 2 h.
create table aur_ticks (tk text not null, t timestamptz not null, p float8 not null, v float8 not null default 0, halt boolean not null default false, x jsonb, primary key (tk, t));
create index on aur_ticks (t);
-- Bougies d'une minute, construites à partir des cours déjà passés uniquement. Gardées 3 jours.
create table aur_candles (tk text not null, t timestamptz not null, o float8 not null, h float8 not null, l float8 not null, c float8 not null, v float8 not null, primary key (tk, t));
create table aur_news (id bigint primary key, t timestamptz not null, tk text, sector text, cat text not null, title text not null, body text, sent float8, fiab float8);
create index on aur_news (t desc);
-- Ordres des joueurs (Ꜷ, + achat) en attente d'être joués par la simulation.
create table aur_orders (id bigint generated always as identity primary key, t timestamptz not null default now(), tk text not null, q float8 not null, taken boolean not null default false);

alter table aur_stocks enable row level security;
alter table aur_state enable row level security;
alter table aur_ticks enable row level security;
alter table aur_candles enable row level security;
alter table aur_news enable row level security;
alter table aur_orders enable row level security;
create policy "lecture publique" on aur_stocks for select using (true);
create policy "lecture publique" on aur_candles for select using (true);
create policy "nouvelles publiées" on aur_news for select using (t <= now());

alter table bets drop constraint bets_kind_check;
alter table bets add constraint bets_kind_check check (kind in ('trade', 'duel', 'stream', 'question', 'crypto', 'aurelys'));
alter table bets add column aur text references aur_stocks;

/* ===== Lecture (joueurs) ===== */
-- Cours des dernières secondes jusqu'à maintenant, en un seul objet JSON (l'API REST plafonne à 1 000 lignes).
create function aur_feed(p_since timestamptz default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', extract(epoch from now()),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(extract(epoch from k.t)::bigint, k.tk, k.p, k.v, k.halt) order by k.t, k.tk)
                      from aur_ticks k where k.t > greatest(coalesce(p_since, '-infinity'), now() - interval '5 minutes') and k.t <= now()), '[]'),
    'x', (select k.x from aur_ticks k where k.tk = 'AUR12' and k.t <= now() order by k.t desc limit 1))
$$;
-- Bougies d'une minute : toutes les actions (p_tk nul) ou une seule, sur au plus 24 h.
create function aur_history(p_tk text, p_minutes int) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(tk, rows), '{}') from (
    select tk, jsonb_agg(jsonb_build_array(extract(epoch from t)::bigint, o, h, l, c, v) order by t) as rows
    from aur_candles where (p_tk is null or tk = p_tk) and t > now() - make_interval(mins => least(greatest(p_minutes, 1), 1440))
    group by tk) x
$$;

/* ===== Simulation (serveur) ===== */
-- Enregistre un pas de simulation. p_from = heure du dernier état lu : si un autre appel l'a déjà fait avancer, refus.
create function aur_store(p_from bigint, p_state jsonb, p_ticks jsonb, p_news jsonb) returns void
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
  insert into aur_news (id, t, tk, sector, cat, title, body, sent, fiab)
  select r.id, to_timestamp(r.t), r.tk, r.sector, r.cat, r.title, r.text, r.sent, r.fiab from jsonb_to_recordset(p_news) as r(id bigint, t bigint, tk text, sector text, cat text, title text, text text, sent float8, fiab float8)
  on conflict do nothing;
end $$;

-- Ordres des joueurs à jouer au prochain pas (pris une seule fois).
create function aur_take_orders() returns table (tk text, q float8)
language sql security definer set search_path = public as $$
  update aur_orders set taken = true where not taken returning tk, q
$$;

-- Dernier cours connu à l'instant présent.
create function aur_last(p_tk text) returns aur_ticks language sql stable set search_path = public as $$
  select * from aur_ticks where tk = p_tk and t <= now() order by t desc limit 1
$$;

-- Liquidation : premier cours depuis l'ouverture qui touche le seuil (valeur nulle).
create function aur_liquidate(p_id bigint) returns bets language plpgsql set search_path = public as $$
declare b bets; lq float8; t0 timestamptz;
begin
  select * into b from bets where id = p_id and kind = 'aurelys' and status = 'open' for update;
  if not found then return null; end if;
  lq := b.entry * (1 - (case when b.dir = 'up' then 1 else -1 end)::float8 / b.lev);
  select min(k.t) into t0 from aur_ticks k
   where k.tk = b.aur and k.t > b.created_at and k.t <= now() and (case when b.dir = 'up' then k.p <= lq else k.p >= lq end);
  if t0 is null then return b; end if;
  update bets set status = 'lost', payout = 0, exit = lq, exit_at = t0, closed_at = now() where id = b.id returning * into b;
  return b;
end $$;

-- Après chaque pas : bougies des minutes récentes (cours passés seulement), liquidations, ménage.
create function aur_settle() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  insert into aur_candles (tk, t, o, h, l, c, v)
  select tk, date_trunc('minute', t), (array_agg(p order by t))[1], max(p), min(p), (array_agg(p order by t desc))[1], sum(v)
    from aur_ticks where t > date_trunc('minute', now()) - interval '2 minutes' and t <= now()
   group by tk, date_trunc('minute', t)
  on conflict (tk, t) do update set o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v;
  for r in select id from bets where kind = 'aurelys' and status = 'open' loop
    if (aur_liquidate(r.id)).status = 'lost' then n := n + 1; end if;
  end loop;
  delete from aur_ticks where t < now() - interval '2 hours';
  delete from aur_candles where t < now() - interval '3 days';
  delete from aur_news where t < now() - interval '3 days';
  delete from aur_orders where taken and t < now() - interval '1 hour';
  return n;
end $$;

/* ===== Ordres (serveur) ===== */
-- p_slip : écart de prix dû à l'impact de l'ordre, calculé par le moteur (loi de la racine carrée). Le prix de base est lu ici.
create function aur_open(p_user uuid, p_tk text, p_dir text, p_lev int, p_stake float8, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets; k aur_ticks; s aur_stocks; fee float8; px float8; expo float8;
begin
  select * into s from aur_stocks where tk = p_tk;
  if not found then raise exception 'Action inconnue.'; end if;
  if p_dir not in ('up', 'down') or p_lev not in (1, 5, 10) or not (p_stake > 0) then raise exception 'Ordre invalide.'; end if;
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

create function aur_close(p_user uuid, p_id bigint, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare b bets; k aur_ticks; fee float8; pay float8; px float8;
begin
  perform aur_liquidate(p_id);
  select * into b from bets where id = p_id and user_id = p_user and kind = 'aurelys' for update;
  if not found then raise exception 'Position introuvable.'; end if;
  if b.status <> 'open' then return b; end if;
  k := aur_last(b.aur);
  if k.t is null or k.t < now() - interval '30 seconds' then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  if k.halt then raise exception 'Cotation suspendue : clôture possible à la reprise.'; end if;
  -- Clôturer une position à la hausse, c'est vendre : le prix obtenu est un peu plus bas (et inversement).
  px := k.p * (1 - (case when b.dir = 'up' then 1 else -1 end) * least(greatest(coalesce(p_slip, 0), 0), 0.2));
  fee := b.stake * b.lev * 0.001;
  pay := greatest(0, trade_value(b, px) - fee);
  update bets set status = case when pay > b.stake + b.fees then 'won' else 'lost' end,
                  payout = pay, exit = px, exit_at = now(), closed_at = now(), fees = b.fees + fee
   where id = b.id returning * into b;
  update profiles set cash = cash + pay where id = b.user_id;
  insert into aur_orders (tk, q) values (b.aur, (case when b.dir = 'up' then -1 else 1 end) * b.stake * b.lev);
  return b;
end $$;

-- L'assurance du QG couvre aussi les positions Aurelys liquidées.
create or replace function bets_bonus() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.kind = 'duel' and consume_bonus(new.user_id, 'boost_duel') then new.odds := round(new.odds * 1.2, 2); end if;
  elsif old.status = 'open' and new.status = 'lost' and coalesce(new.payout, 0) = 0 and new.kind in ('trade', 'stream', 'crypto', 'aurelys')
        and new.exit is not null and consume_bonus(new.user_id, 'assurance') then
    new.payout := new.stake * 0.5; new.insured := true;
    update profiles set cash = cash + new.payout where id = new.user_id;
  end if;
  return new;
end $$;

revoke execute on function aur_store(bigint, jsonb, jsonb, jsonb), aur_take_orders(), aur_last(text), aur_liquidate(bigint), aur_settle(),
  aur_open(uuid, text, text, int, float8, float8), aur_close(uuid, bigint, float8) from public, anon, authenticated;

-- La simulation avance toutes les 10 s (20 s d'avance). Sans planification à la seconde, une fois par minute avec 75 s d'avance.
do $$
declare cmd text := $cron$
    select net.http_post(
      url := 'https://urivyzajsfcbtbfrvjcs.supabase.co/functions/v1/aurelys',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyaXZ5emFqc2ZjYnRiZnJ2amNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODE1MzQsImV4cCI6MjEwNjg1NzUzNH0.urFCndYjySGLjHQqoli4-UaP843pVG2kR1ggW7SpIxo'),
      body := '{"action":"tick","lead":LEAD}'::jsonb)
  $cron$;
begin
  begin
    perform cron.schedule('wikibourse-aurelys', '10 seconds', replace(cmd, 'LEAD', '20'));
  exception when others then
    perform cron.schedule('wikibourse-aurelys', '* * * * *', replace(cmd, 'LEAD', '75'));
  end;
exception when others then
  raise notice 'simulation Aurelys non planifiée (%)', sqlerrm;
end $$;
