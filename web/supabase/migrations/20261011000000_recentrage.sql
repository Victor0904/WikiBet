-- ===== Corrections après revue : faillite, recentrage =====

-- Faillite : on compte aussi ce qui se revend (déco, cosmétiques) et les bonus non utilisés, à 60 %.
-- Sinon : tout convertir en objets, faire faillite, toucher 10 000 W, revendre les objets, recommencer = W infinis.
-- Les logements ne comptent pas : ils ne se revendent pas, et aucun ne s'achète avec le capital de départ.
create function bk_value(p_user uuid) returns float8 language sql stable set search_path = public as $$
  select p.cash
       + coalesce((select sum(b.stake) from bets b where b.user_id = p_user and b.status = 'open'), 0)
       + coalesce((select sum(floor(s.price * 0.6) * i.qty) from inventory i join shop_items s on s.id = i.item_id
                   where i.user_id = p_user and s.kind <> 'home' and i.qty > 0), 0)
  from profiles p where p.id = p_user
$$;

create or replace function restart() returns profiles
language plpgsql security definer set search_path = public as $$
declare tot float8; p profiles;
begin
  perform 1 from profiles where id = auth.uid() for update; -- deux faillites simultanées ne paient pas deux fois
  tot := bk_value(auth.uid());
  if tot is null then raise exception 'Connexion requise.'; end if;
  if tot >= 2000 then raise exception 'Tu n''es pas en faillite : revends d''abord tes objets si tu as besoin de W.'; end if;
  update bets set status = 'lost', payout = 0, closed_at = now() where user_id = auth.uid() and status = 'open';
  update profiles set cash = 10000, bankruptcies = bankruptcies + 1 where id = auth.uid() returning * into p;
  return p;
end $$;

-- ===== Recentrage : la crypto et le replay Wikipédia sont retirés ; Aurelys et le Live restent =====
-- Crypto : hasard à court terme. Wikipédia : des jours passés, donc trichables. Les tables restent pour l'historique.

-- Positions crypto encore ouvertes : clôturées au dernier cours connu (bougie d'une minute), frais habituels.
do $$
declare r record; px float8;
begin
  for r in select id, user_id, sym from bets where status = 'open' and kind = 'crypto' loop
    select c into px from crypto_candles where sym = r.sym order by t desc limit 1;
    if px is not null then perform crypto_close(r.user_id, r.id, px);
    else
      update bets set status = 'lost', payout = stake, closed_at = now() where id = r.id;
      update profiles set cash = cash + (select stake from bets where id = r.id) where id = r.user_id;
    end if;
  end loop;
end $$;

-- Positions et duels Wikipédia en cours : mises rendues.
with r as (update bets set status = 'lost', payout = stake, closed_at = now()
           where status = 'open' and kind in ('trade', 'duel') returning user_id, stake)
update profiles p set cash = cash + x.s from (select user_id, sum(stake) s from r group by 1) x where p.id = x.user_id;

revoke execute on function open_trade(text, text, int, float8, text), bet_duel(text, text, float8) from authenticated;
do $$ begin perform cron.unschedule('wikibourse-crypto'); exception when others then null; end $$;
