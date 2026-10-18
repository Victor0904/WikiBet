-- Pseudo en forme d'adresse e-mail (demande de Victor, 18 octobre 2026) : le pseudo est public (classements, guildes,
-- amis), une adresse n'y a pas sa place. Refusé partout par une contrainte ; les pseudos existants deviennent Joueur-XXXX,
-- avec un changement gratuit (pseudo_free) et un message au joueur (notices). L'ancienne adresse reste un identifiant de
-- connexion privé (account_emails) si le compte a un mot de passe : le joueur se connecte comme avant.
-- Le code de parrainage, tiré des 4 premières lettres du pseudo, est refait. Aucune autre copie du pseudo en base
-- (classements, guildes, amis et rangs de la veille ne gardent que l'identifiant).
-- Retour arrière : supprimer la contrainte profiles_pseudo_email, les fonctions ci-dessous, la table notices,
-- la colonne pseudo_free ; recréer create_profile de 20261026300000_parrainage.sql.

create function pseudo_email_like(p text) returns boolean language sql immutable as $$
  select p ~ '@' or p ~* '\.(com|fr|net|org|io|eu|be|ch|ca|info|me|co|uk|de)$'
      or p ~* '(gmail|hotmail|outlook|yahoo|icloud|protonmail|wanadoo|laposte)'
$$;

-- Messages au joueur, lus une fois (bandeau au prochain passage dans le jeu).
create table notices (
  id bigint generated always as identity primary key, user_id uuid not null references profiles on delete cascade,
  kind text not null, body jsonb not null default '{}', created_at timestamptz not null default now(), read_at timestamptz
);
create index on notices (user_id) where read_at is null;
alter table notices enable row level security;
create function my_notices() returns setof notices language sql stable security definer set search_path = public as $$
  select * from notices where user_id = auth.uid() and read_at is null order by id
$$;
create function notice_read(p_id bigint) returns void language sql security definer set search_path = public as $$
  update notices set read_at = now() where id = p_id and user_id = auth.uid() and read_at is null
$$;

alter table profiles add column pseudo_free boolean not null default false;

create function pseudo_check(p text) returns void language plpgsql immutable as $$
begin
  if pseudo_email_like(p) then raise exception 'Ton pseudo est visible de tous : pas d''adresse e-mail.'; end if;
  if char_length(p) not between 2 and 20 then raise exception 'Pseudo de 2 à 20 caractères.'; end if;
end $$;

-- Changement offert après un renommage d'office (la règle générale des 30 jours viendra avec la page Profil).
create function pseudo_change(p_pseudo text) returns profiles language plpgsql security definer set search_path = public as $$
declare p profiles; np text := trim(coalesce(p_pseudo, ''));
begin
  select * into p from profiles where id = auth.uid() for update;
  if not found then raise exception 'Connexion requise.'; end if;
  if not p.pseudo_free then raise exception 'Changement de pseudo indisponible pour l''instant.'; end if;
  perform pseudo_check(np);
  if exists (select 1 from profiles where lower(pseudo) = lower(np) and id <> p.id) then raise exception 'Ce pseudo est déjà pris.'; end if;
  update profiles set pseudo = np, pseudo_free = false where id = p.id returning * into p;
  return p;
end $$;

-- Renomme d'office les pseudos en forme d'adresse (appelée une fois ici ; gardée pour les tests).
create function pseudo_email_fix() returns int language plpgsql security definer set search_path = public as $$
declare r record; np text; abc text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; n int := 0;
begin
  for r in select id, pseudo from profiles where pseudo_email_like(pseudo) for update loop
    loop
      np := 'Joueur-' || (select string_agg(substr(abc, 1 + floor(random() * length(abc))::int, 1), '') from generate_series(1, 4));
      exit when not exists (select 1 from profiles where lower(pseudo) = lower(np));
    end loop;
    if lower(trim(r.pseudo)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       and exists (select 1 from auth.users where id = r.id and email like '%@joueurs.aurelys.invalid') then
      insert into account_emails values (r.id, lower(trim(r.pseudo))) on conflict do nothing;
    end if;
    update profiles set pseudo = np, pseudo_free = true,
                        referral_code = case when bot then null else referral_new_code(np) end where id = r.id;
    insert into notices (user_id, kind, body) values (r.id, 'pseudo', jsonb_build_object('pseudo', np));
    n := n + 1;
  end loop;
  return n;
end $$;
select pseudo_email_fix();
alter table profiles add constraint profiles_pseudo_email check (not pseudo_email_like(pseudo));

-- 20261026300000_parrainage.sql : pseudo vérifié avant l'inscription.
create or replace function create_profile(p_pseudo text, p_ref text default null) returns profiles
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  perform pseudo_check(trim(coalesce(p_pseudo, '')));
  begin
    insert into profiles (id, pseudo) values (auth.uid(), trim(p_pseudo)) returning * into p;
  exception when unique_violation then
    raise exception 'Ce pseudo est déjà pris.';
  end;
  perform referral_link(p.id, p_ref); -- code inconnu : rien n'est créé, le joueur corrige ou vide le champ
  return p;
end $$;

revoke execute on function pseudo_email_fix() from public, anon, authenticated;
revoke execute on function my_notices(), notice_read(bigint), pseudo_change(text) from public, anon;
grant execute on function my_notices(), notice_read(bigint), pseudo_change(text) to authenticated;
