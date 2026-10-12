-- 1. Faillite (revue d'octobre 2026) : le seuil (bk_value) ne compte pas les logements, qu'on ne revend pas. Acheter un
--    logement avec presque tout son solde, faire faillite et repartir à 10 000 W rapportait donc environ 10 000 W par
--    logement. Désormais, on repart à 10 000 W de patrimoine (15 000 W avec Phénix) : les logements gardés comptent à 60 %
--    (comme au classement), avec au moins 2 000 W en caisse. Le seuil reste le même : un joueur ruiné qui garde un grand
--    logement peut toujours repartir.
-- 2. Classement de la semaine (succès Top 100, Élite, Champion) : entre joueurs seulement, sans les bots.
-- Retour arrière : réappliquer restart de 20261027200000_talents.sql et ach_week_end de 20261027300000_succes.sql.

create or replace function restart() returns profiles
language plpgsql security definer set search_path = public as $$
declare tot float8; p profiles; ph boolean; homes float8;
begin
  perform 1 from profiles where id = auth.uid() for update; -- deux faillites simultanées ne paient pas deux fois
  tot := bk_value(auth.uid());
  if tot is null then raise exception 'Connexion requise.'; end if;
  if tot >= 2000 then raise exception 'Tu n''es pas en faillite : revends d''abord tes objets si tu as besoin de W.'; end if;
  update bets set status = 'lost', payout = 0, closed_at = now() where user_id = auth.uid() and status = 'open';
  ph := tal_rank(auth.uid(), 'phenix') > 0 and coalesce((select phenix_at from profiles where id = auth.uid()), '-infinity') < now() - interval '7 days';
  select coalesce(sum(floor(s.price * 0.6) * i.qty), 0) into homes from inventory i join shop_items s on s.id = i.item_id
   where i.user_id = auth.uid() and s.kind = 'home' and i.qty > 0;
  update profiles set cash = greatest(2000, case when ph then 15000 else 10000 end - homes), bankruptcies = bankruptcies + 1,
                      phenix_at = case when ph then now() else phenix_at end
   where id = auth.uid() returning * into p;
  return p;
end $$;

create or replace function ach_week_end(p_from timestamptz, p_to timestamptz) returns void language plpgsql set search_path = public as $$
declare r record;
begin
  for r in with g as (select b.user_id, sum(bet_gain(b)) as g from bets b join profiles p on p.id = b.user_id and not p.bot
                      where b.status <> 'open' and b.closed_at >= p_from and b.closed_at < p_to group by 1)
           select g.user_id, rank() over (order by g.g desc) as rk, g.g from g loop
    if r.g > 0 and r.rk <= 100 then perform achievement_grant(r.user_id, 'TOP_100'); end if;
    if r.g > 0 and r.rk <= 10 then perform achievement_grant(r.user_id, 'TOP_10'); end if;
    if r.g > 0 and r.rk = 1 then perform achievement_grant(r.user_id, 'CHAMPION'); end if;
  end loop;
  for r in with g as (select b.user_id, sum(bet_gain(b)) as g from bets b where b.status <> 'open' and b.closed_at >= p_from and b.closed_at < p_to group by 1),
           top as (select m.guild_id from guild_members m join g on g.user_id = m.user_id group by m.guild_id order by sum(g.g) desc limit 3)
           select m.user_id from guild_members m join top on top.guild_id = m.guild_id loop
    perform achievement_grant(r.user_id, 'GUILDE_TOP3');
  end loop;
end $$;
revoke execute on function ach_week_end(timestamptz, timestamptz) from public, anon, authenticated;
