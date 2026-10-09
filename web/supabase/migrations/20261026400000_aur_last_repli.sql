-- Correctif de 20261026100000_ticks_unlogged : quand aur_ticks est vide, le repli sur la dernière bougie portait
-- l'heure de début de la bougie. Dans les 30 premières secondes d'une heure d'Aurelys, ce cours passait pour frais
-- et un ordre pouvait s'exécuter au prix d'une vieille clôture. Le repli porte désormais la date -infinity : son prix
-- sert aux valorisations (patrimoine, faillite, dividendes), jamais à un ordre (« Marché indisponible »).
-- Retour arrière : réappliquer aur_last de 20261026100000_ticks_unlogged.
create or replace function aur_last(p_tk text) returns aur_ticks language sql stable set search_path = public as $$
  (select * from aur_ticks where tk = p_tk and t <= now() order by t desc limit 1)
  union all
  (select c.tk, '-infinity'::timestamptz, c.c, 0::float8, false, null::jsonb from aur_candles c where c.tk = p_tk and c.t <= now() order by c.t desc limit 1)
  limit 1
$$;
