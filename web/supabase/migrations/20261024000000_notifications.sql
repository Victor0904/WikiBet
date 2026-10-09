-- Notifications (choix de Victor) : un bandeau pour chaque clôture automatique, et une vraie notification (Web Push,
-- même site fermé) quand une position est liquidée.

-- Pourquoi une position s'est fermée toute seule : liquidation, stop ou objectif. Vide = clôture à la main.
alter table bets add column closed_by text check (closed_by in ('liq', 'stop', 'objectif')), add column push_at timestamptz;
create index on bets (closed_at) where closed_by = 'liq' and push_at is null;

create or replace function aur_liquidate(p_id bigint) returns bets language plpgsql set search_path = public as $$
declare b bets; lq float8; t0 timestamptz;
begin
  select * into b from bets where id = p_id and kind = 'aurelys' and status = 'open' for update;
  if not found then return null; end if;
  lq := b.entry * (1 - (case when b.dir = 'up' then 1 else -1 end)::float8 / b.lev);
  select min(k.t) into t0 from aur_ticks k
   where k.tk = b.aur and k.t > b.created_at and k.t <= now() and (case when b.dir = 'up' then k.p <= lq else k.p >= lq end);
  if t0 is null then return b; end if;
  update bets set status = 'lost', payout = 0, exit = lq, exit_at = t0, closed_at = now(), closed_by = 'liq' where id = b.id returning * into b;
  return b;
end $$;

-- Stop ou objectif : le premier seuil touché donne le motif.
create or replace function aur_auto_exec(p_what text, p_id bigint, p_slip float8) returns void
language plpgsql security definer set search_path = public as $$
declare g aur_triggers; b bets; why text;
begin
  if p_what = 'close' then
    select * into b from bets where id = p_id and status = 'open';
    if not found then return; end if;
    select case when (b.dir = 'up' and k.p <= b.sl) or (b.dir = 'down' and k.p >= b.sl) then 'stop' else 'objectif' end into why
      from aur_ticks k where k.tk = b.aur and k.t > b.auto_at and k.t <= now()
       and (case when b.dir = 'up' then k.p <= b.sl or k.p >= b.tp else k.p >= b.sl or k.p <= b.tp end)
     order by k.t limit 1;
    perform aur_close(b.user_id, p_id, p_slip);
    update bets set closed_by = why where id = p_id and status <> 'open' and closed_by is null;
    return;
  end if;
  select * into g from aur_triggers where id = p_id and status = 'wait' for update;
  if not found then return; end if;
  begin
    b := aur_open(g.user_id, g.tk, g.dir, g.lev, g.stake, p_slip);
    update aur_triggers set status = 'done', bet_id = b.id, done_at = now() where id = g.id;
  exception when others then
    if sqlerrm ~ 'indisponible|suspendue' then raise; end if;
    update aur_triggers set status = 'failed', msg = sqlerrm, done_at = now() where id = g.id;
  end;
end $$;

-- ===== Web Push =====
-- Notification sans contenu chiffré : le service worker demande ensuite le détail (push_info) avec son adresse d'abonnement,
-- qui est secrète. Abonnements privés (aucune politique RLS).
create table push_subs (endpoint text primary key, user_id uuid not null references profiles on delete cascade, created_at timestamptz not null default now());
alter table push_subs enable row level security;

create function push_subscribe(p_endpoint text) returns void language sql security definer set search_path = public as $$
  insert into push_subs (endpoint, user_id) values (p_endpoint, auth.uid())
  on conflict (endpoint) do update set user_id = excluded.user_id, created_at = now()
$$;
create function push_unsubscribe(p_endpoint text) returns void language sql security definer set search_path = public as $$
  delete from push_subs where endpoint = p_endpoint and user_id = auth.uid()
$$;
grant execute on function push_subscribe(text), push_unsubscribe(text) to authenticated;

-- Liquidations pas encore annoncées (dernière heure) : marquées, et les abonnements à prévenir.
create function push_due() returns table (endpoint text) language sql security definer set search_path = public as $$
  with b as (update bets set push_at = now() where closed_by = 'liq' and push_at is null and closed_at > now() - interval '1 hour' returning user_id)
  select s.endpoint from push_subs s where s.user_id in (select user_id from b)
$$;
-- Détail pour le texte de la notification : liquidations annoncées depuis moins de 10 minutes.
create function push_info(p_endpoint text) returns table (aur text, dir text, lev int, stake float8)
language sql stable security definer set search_path = public as $$
  select b.aur, b.dir, b.lev, b.stake from bets b join push_subs s on s.user_id = b.user_id
   where s.endpoint = p_endpoint and b.closed_by = 'liq' and b.push_at > now() - interval '10 minutes'
   order by b.closed_at desc limit 5
$$;
revoke execute on function push_due(), push_info(text) from public, anon, authenticated;
