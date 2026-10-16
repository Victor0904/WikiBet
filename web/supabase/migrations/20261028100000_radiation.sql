-- Radiation des jeunes pousses : aur_listing plantait (« cannot cast type record to bets ») dès qu'une position
-- était ouverte sur le titre. Le moteur radiait quand même l'action puis l'oubliait 10 jours d'Aurelys plus tard :
-- en base, elle restait « cotée », sans cours, avec ses positions et ses actions figées (MAR, FLU, SOL, NOV, octobre 2026).

create or replace function aur_listing(p_defs jsonb) returns int language plpgsql security definer set search_path = public as $$
declare d jsonb; n int := 0; r bets; px float8; g record;
begin
  for d in select * from jsonb_array_elements(p_defs) loop
    insert into aur_stocks (tk, name, sector, liq, status, meta, round_price, round_ends, ipo_price, listed_at)
    values (d->>'tk', d->>'name', d->>'sector', (d->>'L')::float8, d->>'status', d, (d->>'roundPrice')::float8, to_timestamp((d->>'roundEnd')::float8),
            (d->>'ipoPrice')::float8, case when d->>'status' = 'listed' then to_timestamp((d->>'ipoAt')::float8) end)
    on conflict (tk) do update set status = excluded.status, meta = excluded.meta, ipo_price = coalesce(excluded.ipo_price, aur_stocks.ipo_price),
      listed_at = coalesce(excluded.listed_at, aur_stocks.listed_at),
      delisted_at = case when excluded.status = 'delisted' then now() else aur_stocks.delisted_at end;
    if d->>'status' = 'delisted' then
      px := (d->>'lastPrice')::float8;
      -- Positions à effet de levier : soldées au dernier cours.
      for r in select * from bets where kind = 'aurelys' and aur = d->>'tk' and status = 'open' for update loop
        update bets set status = 'lost', payout = greatest(0, trade_value(r, px)), exit = px, exit_at = now(), closed_at = now() where id = r.id;
        update profiles set cash = cash + greatest(0, trade_value(r, px)) where id = r.user_id;
      end loop;
      -- Actions détenues : perdues, inscrites dans l'historique.
      select * into g from game_now();
      insert into bets (user_id, session, day, kind, stake, aur, status, payout, entry, exit, fees, fee_open, closed_at, exit_at)
      select user_id, g.k, g.d, 'invest', cost, tk, 'lost', 0, cost / qty, 0, 0, 0, now(), now() from aur_holdings where tk = d->>'tk' and qty > 0;
      update aur_holdings set qty = 0, cost = 0 where tk = d->>'tk';
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Rattrapage : jeunes pousses « cotées » que le moteur ne connaît plus. Radiées au dernier cours connu.
do $$
declare s record; px float8;
begin
  if not exists (select 1 from aur_state) then return; end if;
  for s in select * from aur_stocks where status = 'listed'
             and not (select coalesce(state->'extra', '{}') from aur_state) ? tk loop
    px := coalesce((select p from aur_ticks where tk = s.tk order by t desc limit 1),
                   (select c from aur_candles where tk = s.tk order by t desc limit 1), 0);
    perform aur_listing(jsonb_build_array(s.meta || jsonb_build_object('status', 'delisted', 'lastPrice', px)));
  end loop;
end $$;
