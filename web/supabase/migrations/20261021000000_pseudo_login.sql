-- Connexion par pseudo et mot de passe, sans e-mail (choix de Victor, 9 octobre 2026).
-- La fonction aurelys (action register) donne au compte une adresse interne <id>@joueurs.aurelys.invalid, déjà confirmée :
-- aucun e-mail n'est jamais envoyé. Pour se connecter, l'écran demande ici l'adresse interne du pseudo.
-- Pseudo exact d'abord (les pseudos sont uniques à la casse près), sinon sans tenir compte des majuscules.
create or replace function login_email(p_pseudo text) returns text
language sql stable security definer set search_path = public as $$
  select u.email from profiles p join auth.users u on u.id = p.id
  where lower(p.pseudo) = lower(trim(p_pseudo)) and u.email like '%@joueurs.aurelys.invalid'
  order by p.pseudo = trim(p_pseudo) desc limit 1
$$;
grant execute on function login_email(text) to anon, authenticated;
