-- Se connecter aussi avec son e-mail (facultatif). Aucun e-mail n'est envoyé ni vérifié (pas de service d'envoi) :
-- l'adresse sert seulement d'autre identifiant. Elle reste privée (aucune politique RLS, lue par les fonctions ci-dessous).
create table account_emails (
  user_id uuid primary key references profiles on delete cascade,
  email text not null unique check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
alter table account_emails enable row level security;

-- Vide = retirer l'adresse. Il faut un mot de passe : sans lui, l'adresse ne mène à rien.
create function set_login_email(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(p_email, '')));
begin
  if not exists (select 1 from auth.users where id = auth.uid() and email like '%@joueurs.aurelys.invalid') then
    raise exception 'Choisis d''abord ton mot de passe.';
  end if;
  if e = '' then delete from account_emails where user_id = auth.uid(); return null; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse e-mail invalide.'; end if;
  insert into account_emails values (auth.uid(), e) on conflict (user_id) do update set email = excluded.email;
  return e;
exception when unique_violation then
  raise exception 'Cet e-mail est déjà utilisé par un autre joueur.';
end $$;

create function my_login_email() returns text
language sql stable security definer set search_path = public as $$
  select email from account_emails where user_id = auth.uid()
$$;

-- Identifiant de connexion : pseudo ou e-mail.
create or replace function login_email(p_pseudo text) returns text
language sql stable security definer set search_path = public as $$
  select u.email from profiles p join auth.users u on u.id = p.id
  left join account_emails a on a.user_id = p.id
  where (lower(p.pseudo) = lower(trim(p_pseudo)) or a.email = lower(trim(p_pseudo))) and u.email like '%@joueurs.aurelys.invalid'
  order by p.pseudo = trim(p_pseudo) desc limit 1
$$;
grant execute on function set_login_email(text), my_login_email() to authenticated;
