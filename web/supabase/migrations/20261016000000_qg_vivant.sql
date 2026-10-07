-- ===== QG vivant, souvenirs et ville qui vit =====

-- Actionnaires fondateurs : chaque premier souscripteur d'une levée reçoit un numéro (n° 1, n° 2…).
create table aur_founders (tk text references aur_stocks, user_id uuid references profiles on delete cascade, n int not null, at timestamptz not null default now(), primary key (tk, user_id));
alter table aur_founders enable row level security;

create or replace function aur_subscribe(p_tk text, p_amount float8) returns aur_holdings
language plpgsql security definer set search_path = public as $$
declare s aur_stocks; pat float8; mine float8; h aur_holdings;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  select * into s from aur_stocks where tk = p_tk for update; -- numéros de fondateur dans l'ordre d'arrivée
  if not found or s.status <> 'round' or s.round_ends <= now() then raise exception 'Cette levée de fonds est close.'; end if;
  pat := bk_value(auth.uid());
  if pat < 50000 then raise exception 'Les levées de fonds demandent 50 000 W disponibles (solde, mises, actions et objets revendables) ; tu en as %.', to_char(pat, 'FM999G999G999'); end if;
  select coalesce(sum(cost), 0) into mine from aur_holdings where user_id = auth.uid() and tk = p_tk;
  if mine + p_amount > .2 * pat then raise exception 'Au plus 20 %% de ta richesse disponible par levée : encore % W possibles.', to_char(greatest(0, .2 * pat - mine), 'FM999G999G999'); end if;
  if not (p_amount >= 100) then raise exception 'Souscription de 100 W au moins.'; end if;
  update profiles set cash = cash - p_amount where id = auth.uid() and cash >= p_amount;
  if not found then raise exception 'Solde insuffisant.'; end if;
  insert into aur_holdings (user_id, tk, qty, cost) values (auth.uid(), p_tk, p_amount / s.round_price, p_amount)
  on conflict (user_id, tk) do update set qty = aur_holdings.qty + excluded.qty, cost = aur_holdings.cost + excluded.cost returning * into h;
  insert into aur_founders (tk, user_id, n) values (p_tk, auth.uid(), (select count(*) + 1 from aur_founders where tk = p_tk)) on conflict do nothing;
  return h;
end $$;

-- Souvenirs d'un joueur, visibles dans son QG : le meilleur trade (avec le vrai graphique s'il est encore en mémoire,
-- 10 jours), la une du Courrier ce jour-là, les certificats d'actionnaire fondateur.
create function souvenirs(p_user uuid) returns jsonb language sql stable security definer set search_path = public as $$
  with best as (
    select b.*, bet_gain(b) as g from bets b where b.user_id = p_user and b.status <> 'open' and b.aur is not null order by bet_gain(b) desc limit 1)
  select jsonb_build_object(
    'best', (select jsonb_build_object('tk', best.aur, 'name', coalesce(s.meta->>'name', s.name), 'gain', round(best.g), 'dir', best.dir, 'lev', best.lev, 'kind', best.kind,
               'entry', best.entry, 'exit', best.exit, 'at', best.closed_at,
               'series', (select coalesce(jsonb_agg(c.c order by c.t), '[]') from aur_candles c
                          where c.tk = best.aur and c.t between best.created_at - interval '6 minutes' and coalesce(best.exit_at, best.closed_at) + interval '6 minutes'),
               'une', (select n.title from aur_news n where n.t <= best.closed_at and n.cat in ('resultats', 'essai', 'scandale', 'produit', 'taux', 'crise', 'baleine', 'ipo', 'reel', 'macro')
                       order by n.t desc limit 1))
             from best join aur_stocks s on s.tk = best.aur where best.g > 0),
    'founders', coalesce((select jsonb_agg(jsonb_build_object('tk', f.tk, 'name', coalesce(s.meta->>'name', s.name), 'n', f.n) order by f.at)
                          from aur_founders f join aur_stocks s on s.tk = f.tk where f.user_id = p_user), '[]'))
$$;
revoke execute on function souvenirs(uuid) from public, anon;
grant execute on function souvenirs(uuid) to authenticated;

-- Présence : un joueur connecté se signale chaque minute (fenêtres allumées dans la ville de sa guilde).
alter table profiles add column last_seen timestamptz;
create function touch() returns void language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where id = auth.uid()
$$;
revoke execute on function touch() from public, anon;
grant execute on function touch() to authenticated;

-- Identité de guilde : une couleur (bannières, blason) choisie par le fondateur.
alter table guilds add column color text not null default '#F5B83D' check (color ~ '^#[0-9A-Fa-f]{6}$');
create function guild_update(p_color text, p_motto text) returns guilds language plpgsql security definer set search_path = public as $$
declare g guilds;
begin
  update guilds set color = coalesce(p_color, color), motto = coalesce(nullif(trim(p_motto), ''), motto) where owner = auth.uid() returning * into g;
  if not found then raise exception 'Seul le fondateur peut changer l''identité de la guilde.'; end if;
  return g;
end $$;
revoke execute on function guild_update(text, text) from public, anon;
grant execute on function guild_update(text, text) to authenticated;

-- Objectifs de la semaine (lundi, heure de Paris) : 50 paris gagnants et 20 000 W de dons, ensemble.
create function week_start() returns timestamptz language sql stable as $$
  select date_trunc('week', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'
$$;

create or replace function city_view(p_guild bigint) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', g.id, 'name', g.name, 'tag', g.tag, 'owner', g.owner, 'treasury', g.treasury, 'color', g.color, 'motto', g.motto,
    'fund', g.fund_units * coalesce(aur_index(), 0), 'hwm', g.fund_hwm,
    'cap', 30 + 5 * coalesce((select level from city_buildings where guild_id = g.id and building = 'mairie'), 0),
    'active', active_members(g.id),
    'upkeep', (select least(coalesce(sum(spent), 0) * .01, 150 * greatest(active_members(g.id), 1)) from city_buildings where guild_id = g.id),
    'buildings', coalesce((select jsonb_agg(jsonb_build_object('id', b.building, 'level', b.level, 'asleep', b.asleep)) from city_buildings b where b.guild_id = g.id), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'home', home_level(p.id),
                           'online', p.last_seen > now() - interval '3 minutes', 'gain', gain_since(p.id, day_start()) > 0) order by m.joined_at)
                         from guild_members m join profiles p on p.id = m.user_id where m.guild_id = g.id), '[]'),
    'goals', jsonb_build_object(
      'wins', (select count(*) from bets b join guild_members m on m.user_id = b.user_id where m.guild_id = g.id and b.status = 'won' and b.closed_at >= week_start()),
      'gifts', (select coalesce(sum(amount), 0) from city_gifts c where c.guild_id = g.id and c.kind <> 'dividende' and c.at >= week_start())),
    'donors', coalesce((select jsonb_agg(x order by x->>'total' desc) from (
                select jsonb_build_object('pseudo', p.pseudo, 'total', sum(c.amount)) as x from city_gifts c join profiles p on p.id = c.user_id
                where c.guild_id = g.id and c.kind <> 'dividende' group by p.pseudo order by sum(c.amount) desc limit 10) d), '[]'))
  from guilds g where g.id = p_guild
$$;
