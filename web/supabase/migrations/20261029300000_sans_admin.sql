-- Tableau de bord admin supprimé (dossier admin/, octobre 2026) : ses objets SQL partent avec lui. Rien dans le jeu ne
-- les appelait. presence_days reste (succès « Fidèle »).
drop function if exists admin_snapshot();
drop function if exists admin_check();
drop table if exists admin_config;

-- login_email n'était ouverte à anon que pour la connexion de l'admin. Le jeu l'appelle toujours après la connexion
-- anonyme (signIn n'existe qu'une fois la session ouverte, api.js), donc avec le rôle authenticated.
revoke execute on function login_email(text) from public, anon;
grant execute on function login_email(text) to authenticated;
