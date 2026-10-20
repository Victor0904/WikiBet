-- Ménage des parties anonymes, une fois par jour (décision de Victor, octobre 2026).
-- Compte « non sauvegardé » : anonyme, sans e-mail, sans mot de passe, sans autre identité (Discord, e-mail).
--   a. sans profil (visiteur qui n'a jamais créé de partie) : supprimé après 7 jours ;
--   b. avec profil, sans activité depuis 90 jours : supprimé.
-- Activité = la plus récente de : visite du jeu (profiles.last_seen, touch() chaque minute), dernier ordre (bets),
-- dernière connexion (auth.users.last_sign_in_at), création du compte.
-- Jamais touchés : bots, comptes sauvegardés, fondateurs de guilde (une guilde disparaît avec son fondateur : ils sont
-- signalés dans le journal, pas supprimés). Suppression par auth.users : tout part en cascade.
create table anon_purge_log (
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  sans_profil int not null, inactifs int not null, fondateurs_gardes text[] not null default '{}'
);
alter table anon_purge_log enable row level security; -- aucune politique : illisible par les joueurs
revoke all on anon_purge_log from anon, authenticated;

-- p_dry : comptage à blanc, rien n'est supprimé ni journalisé.
create function anon_purge(p_dry boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare a uuid[]; b uuid[]; f text[];
begin
  with unsaved as (
    select u.id, u.created_at, u.last_sign_in_at from auth.users u
     where u.is_anonymous and u.email is null and coalesce(u.encrypted_password, '') = ''
       and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider <> 'anonymous')
  ), act as (
    select s.id, p.pseudo, coalesce(p.bot, false) bot, p.id is not null a_profil,
      exists (select 1 from guilds g where g.owner = s.id) fondateur,
      greatest(s.created_at, s.last_sign_in_at, p.last_seen, (select max(x.created_at) from bets x where x.user_id = s.id)) derniere
    from unsaved s left join profiles p on p.id = s.id
  )
  select coalesce(array_agg(id) filter (where not a_profil and derniere < now() - interval '7 days'), '{}'),
         coalesce(array_agg(id) filter (where a_profil and not bot and not fondateur and derniere < now() - interval '90 days'), '{}'),
         coalesce(array_agg(pseudo) filter (where a_profil and not bot and fondateur and derniere < now() - interval '90 days'), '{}')
    into a, b, f from act;
  if not p_dry then
    delete from auth.users where id = any(a || b);
    insert into anon_purge_log (sans_profil, inactifs, fondateurs_gardes) values (cardinality(a), cardinality(b), f);
  end if;
  return jsonb_build_object('a_blanc', p_dry, 'sans_profil', cardinality(a), 'inactifs', cardinality(b), 'fondateurs_gardes', f);
end $$;
revoke execute on function anon_purge(boolean) from public, anon, authenticated;

do $$ begin
  perform cron.schedule('wikibourse-anonymes', '41 4 * * *', 'select public.anon_purge()');
exception when others then raise notice 'ménage des anonymes non planifié (%)', sqlerrm; end $$;
