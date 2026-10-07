-- ===== Parcelles de guilde : la ville s'agrandit =====
-- Le fondateur achète des parcelles avec le Trésor : chaque parcelle ajoute un anneau de terrain autour de la ville
-- (plus d'espace, des parcs, de la place pour les futurs membres). 6 000 W × (n + 1)², au plus 6 parcelles.
alter table guilds add column land int not null default 0 check (land between 0 and 6);
create function land_cost(p_land int) returns int language sql immutable as $$ select case when p_land >= 6 then null else 6000 * (p_land + 1) * (p_land + 1) end $$;
create function city_buy_land() returns guilds language plpgsql security definer set search_path = public as $$
declare g guilds; cost int;
begin
  select * into g from guilds where owner = auth.uid() for update;
  if not found then raise exception 'Seul le fondateur de la guilde achète des parcelles.'; end if;
  cost := land_cost(g.land);
  if cost is null then raise exception 'La ville a déjà toutes ses parcelles.'; end if;
  if g.treasury < cost then raise exception 'Trésor insuffisant : il faut % W.', to_char(cost, 'FM999G999G999'); end if;
  update guilds set treasury = treasury - cost, land = land + 1 where id = g.id returning * into g;
  return g;
end $$;
revoke execute on function city_buy_land() from public, anon;
grant execute on function city_buy_land() to authenticated;

create or replace function city_view(p_guild bigint) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', g.id, 'land', g.land, 'land_cost', land_cost(g.land), 'name', g.name, 'tag', g.tag, 'owner', g.owner, 'treasury', g.treasury, 'color', g.color, 'motto', g.motto,
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
