-- Faille de 20261029000000_securite.sql (audit du 20 octobre 2026) : les droits par défaut de Supabase donnent ALL à
-- authenticated sur toute nouvelle vue. public_profiles est une vue simple, donc modifiable, exécutée avec les droits de
-- son propriétaire (sans RLS) : un joueur pouvait changer le cash de n'importe qui ou supprimer un profil.
-- Une vue du propriétaire ne doit jamais accorder plus que SELECT.
revoke all on public_profiles from public, anon, authenticated;
grant select on public_profiles to authenticated;
