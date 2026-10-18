-- H5 de la refonte « progression » : pari du jour, gratuit, le même pour tous (Victor, octobre 2026).
-- Créé à 8 h (heure de Paris) par settle(), sans nouvel appel périodique. Vote de 8 h à 14 h, une fois, non modifiable ;
-- résolution à 20 h. Type A : « <Société> sera-t-elle plus haute à 20 h ? ». Type B, les jours où au moins trois sociétés
-- publient leurs résultats entre 14 h et 20 h (un jour sur deux, tiré par la date) : « Qui fera la plus forte hausse ? ».
-- Cours de référence : le cours frais (moins de 30 s, jamais le repli sur une bougie) enregistré au vote. Cours de
-- résolution : le premier vrai cours après 20 h ; sans cours dans les 30 min, la question est annulée sans pénalité.
-- Écart de moins de 0,05 % : vote annulé. XP seulement : +10 au vote, +25 si juste, +40 à chaque 3e bonne réponse d'affilée.
-- Retour arrière : restaurer la sauvegarde d'avant le déploiement.

create table aur_pari (
  id bigint generated always as identity primary key, day date not null unique,
  kind text not null check (kind in ('A', 'B')), tks text[] not null,
  open_until timestamptz not null, resolve_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'void')),
  px jsonb, resolved_at timestamptz
);
create table aur_pari_vote (
  user_id uuid references profiles on delete cascade, pari_id bigint references aur_pari on delete cascade,
  choice text not null, ref jsonb not null, voted_at timestamptz not null default now(),
  result text check (result in ('right', 'wrong', 'void')), primary key (user_id, pari_id)
);
alter table aur_pari enable row level security;
alter table aur_pari_vote enable row level security;
create policy "pari public" on aur_pari for select using (true);
create policy "mes votes" on aur_pari_vote for select using (user_id = auth.uid());

-- Cours frais : un vrai cours de moins de 30 s (aur_last, lui, se replie sur la dernière bougie).
create function aur_fresh(p_tk text) returns float8 language sql stable set search_path = public as $$
  select p from aur_ticks where tk = p_tk and t <= now() and t > now() - interval '30 seconds' order by t desc limit 1
$$;
-- Sociétés qui publient leurs résultats entre deux instants (même calendrier que le moteur, `calendar` dans aurelys.js :
-- chaque société tous les 7 jours d'Aurelys, à 14:00 + 45 min × (rang mod 3)).
create function results_between(p_t0 timestamptz, p_t1 timestamptz) returns setof text language sql stable as $$
  with m as (select floor((extract(epoch from p_t0) - 1790812800) / 2.5)::bigint as m0, floor((extract(epoch from p_t1) - 1790812800) / 2.5)::bigint as m1),
  s as (select tk, (i - 1)::int as i from unnest(array['NXR', 'PXF', 'OMB', 'HLV', 'FRC', 'VLS', 'BCS', 'MRV', 'GTR', 'LMR', 'SLM', 'KST', 'OND']) with ordinality t(tk, i))
  select distinct s.tk from m, s, generate_series(m.m0 / 1440, m.m1 / 1440) d
   where d % 7 = s.i % 7 and d * 1440 + 840 + (s.i % 3) * 45 between m.m0 and m.m1
$$;

-- Création (dès 8 h), puis résolution (dès 20 h). Idempotent : une question par jour, une résolution par question.
create function pari_tick(p_now timestamptz default now()) returns void language plpgsql security definer set search_path = public as $$
declare d date := paris_date(p_now); h time := (p_now at time zone 'Europe/Paris')::time; b text[]; q aur_pari; v aur_pari_vote;
        prices jsonb; r float8; top text; gap float8; ok boolean; run int;
begin
  if h >= '08:00' and not exists (select 1 from aur_pari where day = d) then
    select array_agg(tk order by md5(d::text || tk)) into b from (select tk from results_between(paris_day_start(d) + interval '14 hours', paris_day_start(d) + interval '20 hours') tk
      where tk in (select s.tk from aur_stocks s where s.status = 'core')) x;
    if coalesce(array_length(b, 1), 0) >= 3 and get_byte(decode(md5('pari' || d), 'hex'), 0) % 2 = 0 then
      insert into aur_pari (day, kind, tks, open_until, resolve_at)
      values (d, 'B', b[1:3], paris_day_start(d) + interval '14 hours', paris_day_start(d) + interval '20 hours') on conflict do nothing;
    else
      insert into aur_pari (day, kind, tks, open_until, resolve_at)
      select d, 'A', array[s.tk], paris_day_start(d) + interval '14 hours', paris_day_start(d) + interval '20 hours'
        from aur_stocks s where s.status = 'core' order by md5(d::text || s.tk) limit 1
      on conflict do nothing;
    end if;
  end if;

  for q in select * from aur_pari where status = 'open' and resolve_at <= p_now for update skip locked loop
    -- Premier vrai cours après 20 h, pour chaque société ; sinon on attend, et au-delà de 30 min la question est annulée.
    select jsonb_object_agg(t.tk, (select k.p from aur_ticks k where k.tk = t.tk and k.t >= q.resolve_at and k.t <= least(p_now, q.resolve_at + interval '30 minutes') order by k.t limit 1))
      into prices from unnest(q.tks) t(tk);
    if exists (select 1 from jsonb_each(prices) e where e.value = 'null'::jsonb) then
      if p_now >= q.resolve_at + interval '30 minutes' then
        update aur_pari set status = 'void', resolved_at = p_now where id = q.id;
        update aur_pari_vote set result = 'void' where pari_id = q.id;
      end if;
      continue;
    end if;
    for v in select * from aur_pari_vote where pari_id = q.id loop
      if q.kind = 'A' then
        r := (prices->>q.tks[1])::float8 / (v.ref->>q.tks[1])::float8 - 1;
        ok := (v.choice = 'up') = (r > 0); gap := abs(r);
      else
        select z.tk, z.r - lead(z.r) over (order by z.r desc) into top, gap
          from (select t.tk, (prices->>t.tk)::float8 / (v.ref->>t.tk)::float8 - 1 as r from unnest(q.tks) t(tk)) z order by z.r desc limit 1;
        ok := v.choice = top;
      end if;
      update aur_pari_vote set result = case when gap < 0.0005 then 'void' when ok then 'right' else 'wrong' end
       where user_id = v.user_id and pari_id = q.id;
      if gap >= 0.0005 and ok then
        perform xp_grant(v.user_id, 'pari', q.id || ':right', 25);
        -- Bonnes réponses d'affilée (les votes annulés ne comptent pas, ni pour ni contre).
        select count(*) into run from (
          select w.result, sum(case when w.result = 'wrong' then 1 else 0 end) over (order by p.day desc) as broken
            from aur_pari_vote w join aur_pari p on p.id = w.pari_id
           where w.user_id = v.user_id and p.day <= q.day and w.result in ('right', 'wrong')) z
         where z.broken = 0;
        if run > 0 and run % 3 = 0 then perform xp_grant(v.user_id, 'pari', q.id || ':three', 40); end if;
      end if;
    end loop;
    update aur_pari set status = 'resolved', px = prices, resolved_at = p_now where id = q.id;
  end loop;
end $$;
revoke execute on function pari_tick(timestamptz) from public, anon, authenticated;

-- Le pari du moment (le dernier créé) ; la répartition des votes n'apparaît qu'après avoir voté.
create function my_pari() returns jsonb language sql stable security definer set search_path = public as $$
  with q as (select * from aur_pari order by day desc limit 1), v as (select w.* from aur_pari_vote w, q where w.pari_id = q.id and w.user_id = auth.uid())
  select case when q.id is null then null else jsonb_build_object(
    'id', q.id, 'day', q.day, 'kind', q.kind, 'tks', q.tks, 'open_until', extract(epoch from q.open_until), 'resolve_at', extract(epoch from q.resolve_at),
    'status', q.status, 'px', q.px,
    'mine', (select jsonb_build_object('choice', v.choice, 'ref', v.ref, 'result', v.result) from v),
    'dist', case when exists (select 1 from v) then (select jsonb_object_agg(choice, n) from (select choice, count(*) n from aur_pari_vote where pari_id = q.id group by 1) c) end,
    'run', (select count(*) from (select w.result, sum(case when w.result = 'wrong' then 1 else 0 end) over (order by p.day desc) as broken
              from aur_pari_vote w join aur_pari p on p.id = w.pari_id where w.user_id = auth.uid() and w.result in ('right', 'wrong')) z where z.broken = 0)) end
  from (select 1) one left join q on true
$$;

create function pari_vote(p_choice text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); q aur_pari; ref jsonb;
begin
  if u is null then raise exception 'Connexion requise.'; end if;
  select * into q from aur_pari where day = paris_date(now());
  if not found then raise exception 'Le pari du jour ouvre à 8 h.'; end if;
  if now() >= q.open_until or q.status <> 'open' then raise exception 'Les votes sont clos (14 h).'; end if;
  if not ((q.kind = 'A' and p_choice in ('up', 'down')) or (q.kind = 'B' and p_choice = any(q.tks))) then raise exception 'Réponse invalide.'; end if;
  select jsonb_object_agg(t.tk, aur_fresh(t.tk)) into ref from unnest(q.tks) t(tk);
  if exists (select 1 from jsonb_each(ref) e where e.value = 'null'::jsonb) then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  insert into aur_pari_vote (user_id, pari_id, choice, ref) values (u, q.id, p_choice, ref) on conflict do nothing;
  if not found then raise exception 'Tu as déjà voté.'; end if;
  perform xp_grant(u, 'pari', q.id || ':vote', 10);
  perform quests_check(u);
  return my_pari();
end $$;
revoke execute on function my_pari(), pari_vote(text) from public, anon;
grant execute on function my_pari(), pari_vote(text) to authenticated;

-- 20261028400000_niveaux_quetes.sql ; + pari du jour.
create or replace function progress_tick() returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform pari_tick();
  for r in select id from profiles where not bot and last_seen > now() - interval '10 minutes' loop perform quests_check(r.id); end loop;
end $$;
