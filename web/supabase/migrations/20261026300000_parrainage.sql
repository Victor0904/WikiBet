-- Parrainage (choix de Victor, octobre 2026) et données de la page Profil.
-- Un code court par joueur (VAYK-7Q2), donné à l'inscription (lien ?ref= ou champ facultatif). Filleul validé quand :
-- 5 positions Aurelys clôturées, mise ≥ 100 W, tenues ≥ 150 s, sur 2 jours réels différents (heure de Paris), et
-- premier logement acheté (studio ou plus). Alors +10 000 W au parrain (4 filleuls récompensés au plus) et +2 000 W
-- au filleul (toujours). Les bots ne parrainent pas et ne sont pas parrainés. Hors classement des gains (aucune
-- ligne dans bets) : la récompense compte dans le solde, donc dans le patrimoine.
--
-- Retour arrière : drop function my_referrals(), referral_check(), referral_link(uuid, text), rank_snapshot(),
-- referral_new_code(text), profiles_referral_code() cascade ; drop table referrals, rank_daily ;
-- alter table profiles drop column referral_code ; recréer create_profile(text) (20261006000000_init),
-- my_friends() (20261010000000_social) et settle() (20261026000000_disque).

-- ===== Codes =====
alter table profiles add column referral_code text unique;

-- 4 lettres du pseudo (sans accents) + 3 caractères sans ambiguïté (ni 0/O, ni 1/I).
create function referral_new_code(p_pseudo text) returns text language plpgsql volatile set search_path = public as $$
declare base text; abc text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; c text;
begin
  base := upper(left(regexp_replace(translate(coalesce(p_pseudo, ''), 'àâäáãéèêëíîïóôöõúùûüçñÀÂÄÁÃÉÈÊËÍÎÏÓÔÖÕÚÙÛÜÇÑ',
                                                            'aaaaaeeeeiiiooooouuuucnAAAAAEEEEIIIOOOOUUUUCN'), '[^A-Za-z0-9]', '', 'g'), 4));
  if base = '' then base := 'AUR'; end if;
  loop
    c := base || '-' || (select string_agg(substr(abc, 1 + floor(random() * length(abc))::int, 1), '') from generate_series(1, 3));
    exit when not exists (select 1 from profiles where referral_code = c);
  end loop;
  return c;
end $$;

-- Un code pour chaque joueur, jamais pour un bot (marqué bot après sa création : on lui retire le sien).
create function profiles_referral_code() returns trigger language plpgsql set search_path = public as $$
begin
  if new.bot then new.referral_code := null;
  elsif new.referral_code is null then new.referral_code := referral_new_code(new.pseudo); end if;
  return new;
end $$;
create trigger profiles_referral_code before insert or update of bot on profiles
  for each row execute function profiles_referral_code();

do $$ declare r record; begin
  for r in select id, pseudo from profiles where not bot and referral_code is null loop
    update profiles set referral_code = referral_new_code(r.pseudo) where id = r.id;
  end loop;
end $$;

-- ===== Parrainages =====
create table referrals (
  filleul      uuid primary key references profiles on delete cascade, -- un seul parrain, jamais modifié
  parrain      uuid not null references profiles on delete cascade,
  status       text not null default 'en_attente' check (status in ('en_attente', 'validé')),
  created_at   timestamptz not null default now(),
  validated_at timestamptz,
  paid_parrain float8 not null default 0,
  paid_filleul float8 not null default 0,
  check (parrain <> filleul)
);
create index on referrals (parrain);
alter table referrals enable row level security;
create policy "mes parrainages" on referrals for select using (auth.uid() in (parrain, filleul));

-- Rattache un nouveau joueur au propriétaire du code. Accepte aussi un lien collé (…?ref=CODE).
create function referral_link(p_filleul uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare c text := upper(trim(regexp_replace(coalesce(p_code, ''), '^.*[?&]ref=', ''))); par profiles;
begin
  if c = '' then return; end if;
  select * into par from profiles where referral_code = c;
  if not found then raise exception 'Code de parrainage inconnu.'; end if;
  if par.id = p_filleul then raise exception 'Tu ne peux pas utiliser ton propre code.'; end if;
  if par.bot or (select bot from profiles where id = p_filleul) then raise exception 'Code de parrainage non valable.'; end if;
  insert into referrals (filleul, parrain) values (p_filleul, par.id) on conflict (filleul) do nothing;
end $$;
revoke execute on function referral_link(uuid, text) from public, anon, authenticated;

drop function create_profile(text);
create function create_profile(p_pseudo text, p_ref text default null) returns profiles
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  begin
    insert into profiles (id, pseudo) values (auth.uid(), trim(p_pseudo)) returning * into p;
  exception when unique_violation then
    raise exception 'Ce pseudo est déjà pris.';
  end;
  perform referral_link(p.id, p_ref); -- code inconnu : rien n'est créé, le joueur corrige ou vide le champ
  return p;
end $$;

-- Validation, appelée par settle() chaque minute. Verrous : la ligne du parrainage (une seule validation) puis le
-- profil du parrain (le compte des filleuls récompensés ne peut pas dépasser 4, même en parallèle).
create function referral_check() returns int language plpgsql security definer set search_path = public as $$
declare r referrals; n int := 0; paid int; amt float8;
begin
  for r in select * from referrals where status = 'en_attente' for update skip locked loop
    if (select bot from profiles where id = r.filleul) or (select bot from profiles where id = r.parrain) then continue; end if;
    if home_level(r.filleul) < 1 then continue; end if;
    if (select count(*) < 5 or count(distinct (closed_at at time zone 'Europe/Paris')::date) < 2
          from bets where user_id = r.filleul and kind = 'aurelys' and status <> 'open' and stake >= 100
           and closed_at - created_at >= interval '150 seconds') then continue; end if;
    perform 1 from profiles where id = r.parrain for update;
    select count(*) into paid from referrals where parrain = r.parrain and paid_parrain > 0;
    amt := case when paid < 4 then 10000 else 0 end;
    update referrals set status = 'validé', validated_at = now(), paid_parrain = amt, paid_filleul = 2000
     where filleul = r.filleul and status = 'en_attente';
    if found then
      if amt > 0 then update profiles set cash = cash + amt where id = r.parrain; end if;
      update profiles set cash = cash + 2000 where id = r.filleul;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function referral_check() from public, anon, authenticated;

-- ===== Rang de la veille (▲/▼ sur la page Profil) =====
-- Au premier passage de settle() d'un jour (heure de Paris) : le classement au patrimoine du moment, donc celui de
-- la fin de la veille. Gardé 7 jours.
create table rank_daily (day date, user_id uuid references profiles on delete cascade, rank int not null, primary key (day, user_id));
alter table rank_daily enable row level security;

create function rank_snapshot() returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from rank_daily where day = paris_day()) then return; end if;
  insert into rank_daily select paris_day(), l.id, row_number() over (order by l.patrimoine desc) from leaderboard() l
  on conflict do nothing;
  delete from rank_daily where day < paris_day() - 7;
end $$;
revoke execute on function rank_snapshot() from public, anon, authenticated;

-- Tout ce dont la page Profil a besoin en un appel léger : mon code, mon rang de la veille, mes filleuls, mon parrain.
create function my_referrals() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', (select referral_code from profiles where id = auth.uid()),
    'rank_day', (select rank from rank_daily where user_id = auth.uid() and day = paris_day()),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('id', r.filleul, 'pseudo', p.pseudo, 'status', r.status,
                        'at', r.created_at, 'validated_at', r.validated_at, 'paid', r.paid_parrain) order by r.created_at)
                      from referrals r join profiles p on p.id = r.filleul where r.parrain = auth.uid()), '[]'::jsonb),
    'sponsor', (select jsonb_build_object('pseudo', p.pseudo, 'status', r.status, 'validated_at', r.validated_at, 'paid', r.paid_filleul)
                from referrals r join profiles p on p.id = r.parrain where r.filleul = auth.uid()))
$$;
revoke execute on function my_referrals() from public, anon;
grant execute on function my_referrals() to authenticated;

-- Amis : qui est en ligne (vu il y a moins de 2 minutes, voir touch()).
drop function my_friends();
create function my_friends() returns table (id uuid, pseudo text, state text, guild text, today float8, total float8, online boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo,
         case when f.accepted then 'ami' when f.user_id = auth.uid() then 'envoye' else 'recu' end,
         (select g.tag from guild_members m join guilds g on g.id = m.guild_id where m.user_id = p.id),
         gain_since(p.id, day_start()), gain_since(p.id, null),
         coalesce(p.last_seen > now() - interval '2 minutes', false)
  from friends f join profiles p on p.id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
  where auth.uid() in (f.user_id, f.friend_id)
  order by 3 desc, 5 desc
$$;
revoke execute on function my_friends() from public, anon;
grant execute on function my_friends() to authenticated;

-- ===== settle() : + parrainages et rang du jour =====
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
                      and not exists (select 1 from salaries s where s.user_id = b.user_id and s.session = b.session)
                    group by 1, 2, 3) x
            group by 1, 2 loop
    insert into salaries values (r.user_id, r.session, r.amt) on conflict do nothing;
    get diagnostics rc = row_count;
    if rc > 0 and r.amt > 0 then update profiles set cash = cash + r.amt where id = r.user_id; end if;
  end loop;
  perform referral_check();
  perform rank_snapshot();
  return n;
end $$;
