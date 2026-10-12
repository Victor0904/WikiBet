-- Écart entre le gain affiché et le gain encaissé (signalé par Victor, octobre 2026). L'écran montrait la valeur d'une
-- position sans l'impact de l'ordre de clôture, que le serveur appliquait selon le GARCH et le régime du moment (jusqu'à
-- 7 % du cours par sens sur Pixelfold en krach). L'impact des joueurs ne dépend plus que de la taille de l'ordre et de la
-- profondeur du carnet (moteur partagé, `slip` et `closeQuote`), et l'écran connaît le taux de frais exact du joueur.
-- Retour arrière : réappliquer aur_fee de 20261014000000_retours.sql, supprimer aur_fee_rate et my_fee_rate.

-- Taux de frais Aurelys d'un joueur (salle des marchés de sa guilde) ; les frais restent de 1 W au moins.
create function aur_fee_rate(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select 0.001 * (1 - 0.1 * city_level(p_user, 'salle'))
$$;
create or replace function aur_fee(p_user uuid, p_notional float8) returns float8 language sql stable set search_path = public as $$
  select greatest(1, p_notional * aur_fee_rate(p_user))
$$;
create function my_fee_rate() returns float8 language sql stable security definer set search_path = public as $$
  select aur_fee_rate(auth.uid())
$$;
