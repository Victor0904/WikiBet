-- Suppression de son compte par le joueur (demande de Victor, 23 octobre 2026). Appelée par la fonction aurelys (action
-- delete_account) avec l'identifiant tiré du jeton, jamais par un joueur directement. Une seule transaction : la guilde
-- d'abord (guilds.owner est en cascade : sans cela, la guilde partirait avec son chef), puis auth.users, et la cascade
-- emporte le profil et tout ce qui s'y rattache (positions, actions, push, parrainages, quêtes, succès, XP, amis, e-mails).
-- Les cours, bougies et actualités ne portent aucun identifiant de joueur : ils restent. Purement additive.

-- Journal sans identifiant ni pseudo : seulement la date, pour suivre le nombre de départs. Illisible par les joueurs.
create table account_delete_log (at timestamptz not null default now());
alter table account_delete_log enable row level security;
revoke all on account_delete_log from anon, authenticated;

create function account_delete(p_user uuid, p_pseudo text) returns void language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  select * into me from profiles where id = p_user for update;
  if me.id is null or me.bot then raise exception 'Compte introuvable.'; end if;
  if lower(btrim(coalesce(p_pseudo, ''))) <> lower(me.pseudo) then raise exception 'Le pseudo tapé ne correspond pas.'; end if;
  -- Chef de guilde : comme guild_leave, la guilde passe au membre le plus ancien (bot compris), ou disparaît s'il était seul.
  delete from guild_members where user_id = p_user;
  update guilds g set owner = m.user_id
    from (select distinct on (guild_id) guild_id, user_id from guild_members order by guild_id, joined_at) m
   where g.owner = p_user and m.guild_id = g.id;
  delete from guilds where owner = p_user;
  delete from auth.users where id = p_user; -- identités (Discord), sessions et profil en cascade
  insert into account_delete_log default values;
end $$;
revoke execute on function account_delete(uuid, text) from public, anon, authenticated;
