-- H9 de la refonte « progression » : journal des comptes suspects, sans rien bloquer (pour une future vue admin).
-- Deux signaux : des comptes liés par le parrainage (même parrain, ou parrain et filleul) qui ouvrent des positions
-- opposées sur la même société à moins d'une minute d'écart (« miroir », 3 fois ou plus sur 7 jours) ; plusieurs comptes
-- vus sur le même appareil (« appareil », identifiant tiré au hasard par le navigateur, clé wb-appareil, 30 jours).
-- Rien n'est lisible par les joueurs. Rappel des garde-fous (H3 à H8) : aucun transfert de W entre joueurs ; quêtes,
-- pari, succès, guildes ne donnent que de l'XP ; le seul versement de W de la refonte est la récompense de saison (H6).
-- Retour arrière : supprimer abuse_log, device_seen, abuse_scan ; réappliquer touch (20261027300000_succes.sql).

create table device_seen (user_id uuid not null references profiles on delete cascade, device text not null,
  last_at timestamptz not null default now(), primary key (user_id, device));
create index on device_seen (device);
create table abuse_log (id bigint generated always as identity primary key, day date not null, kind text not null check (kind in ('miroir', 'appareil')),
  user_a uuid not null references profiles on delete cascade, user_b uuid not null references profiles on delete cascade,
  detail jsonb, unique (day, kind, user_a, user_b));
alter table device_seen enable row level security;
alter table abuse_log enable row level security;

-- 20261027300000_succes.sql ; + appareil (facultatif : les onglets ouverts avant la mise à jour n'en envoient pas).
drop function touch();
create function touch(p_device text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set last_seen = now() where id = auth.uid();
  insert into presence_days values (auth.uid(), (now() at time zone 'Europe/Paris')::date) on conflict do nothing;
  if found and (ach_stats(auth.uid())->>'presence')::int >= 7 then perform achievement_grant(auth.uid(), 'FIDELE'); end if;
  if p_device ~ '^[0-9a-f-]{16,40}$' and exists (select 1 from profiles where id = auth.uid()) then
    insert into device_seen (user_id, device) values (auth.uid(), p_device) on conflict (user_id, device) do update set last_at = now();
  end if;
end $$;
revoke execute on function touch(text) from public, anon;
grant execute on function touch(text) to authenticated;

-- Chaque nuit (04 h 47 UTC) ; rejouer le même jour n'ajoute rien.
create function abuse_scan(p_now timestamptz default now()) returns int language plpgsql security definer set search_path = public as $$
declare d date := paris_date(p_now); n int; m int;
begin
  with links as (select a.filleul as x, b.filleul as y from referrals a join referrals b on b.parrain = a.parrain and b.filleul > a.filleul
                 union select least(parrain, filleul), greatest(parrain, filleul) from referrals),
  pairs as (select l.x, l.y, count(*) as k
              from links l join bets p on p.user_id = l.x and p.kind = 'aurelys' and p.created_at > p_now - interval '7 days'
              join bets q on q.user_id = l.y and q.kind = 'aurelys' and q.aur = p.aur and q.dir <> p.dir
                         and abs(extract(epoch from q.created_at - p.created_at)) < 60
             group by l.x, l.y having count(*) >= 3)
  insert into abuse_log (day, kind, user_a, user_b, detail)
  select d, 'miroir', x, y, jsonb_build_object('positions', k) from pairs on conflict do nothing;
  get diagnostics n = row_count;
  insert into abuse_log (day, kind, user_a, user_b, detail)
  select d, 'appareil', a.user_id, b.user_id, jsonb_build_object('device', left(a.device, 8))
    from device_seen a join device_seen b on b.device = a.device and b.user_id > a.user_id
    join profiles pa on pa.id = a.user_id and not pa.bot join profiles pb on pb.id = b.user_id and not pb.bot
   where a.last_at > p_now - interval '30 days' and b.last_at > p_now - interval '30 days'
  on conflict do nothing;
  get diagnostics m = row_count;
  delete from device_seen where last_at < p_now - interval '90 days';
  return n + m;
end $$;
revoke execute on function abuse_scan(timestamptz) from public, anon, authenticated;

do $$ begin
  perform cron.schedule('wikibourse-abus', '47 4 * * *', 'select public.abuse_scan()');
exception when others then raise notice 'journal des abus non planifié (%)', sqlerrm; end $$;
