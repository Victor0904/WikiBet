-- Sécurité (test d'intrusion d'octobre 2026) : la politique « classement public » laissait lire toute la table profiles
-- avec la seule clé publique : code de parrainage, dates d'inscription et de dernière visite, compteurs internes.
-- Désormais chacun ne lit que sa propre ligne ; les autres joueurs se lisent par la vue public_profiles (colonnes publiques),
-- les classements par leurs fonctions security definer.
drop policy if exists "classement public" on profiles;
create policy "mon profil" on profiles for select using (id = auth.uid());

-- Vue du propriétaire (security_invoker désactivé) : elle passe la RLS mais ne montre que ces colonnes.
create or replace view public_profiles as select id, pseudo, cash, bankruptcies, bot from profiles;
revoke all on public_profiles from public, anon;
grant select on public_profiles to authenticated;

-- settle() tourne par pg_cron chaque minute ; un joueur n'a pas à le lancer (charge à volonté sur la base).
revoke execute on function settle() from public, anon, authenticated;
