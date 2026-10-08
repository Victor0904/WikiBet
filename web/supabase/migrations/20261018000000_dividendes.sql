-- Supabase refuse un UPDATE sans WHERE (safeupdate) : au changement de jour d'Aurelys, aur_settle échouait et figeait le marché.
create or replace function aur_dividends() returns int language plpgsql security definer set search_path = public as $$
declare today int := floor((extract(epoch from now()) - 1790812800) / 3600)::int; last int; n int := 0; r record; pay float8;
begin
  select day into last from aur_div_day for update;
  if last is null then insert into aur_div_day values (1, today); return 0; end if;
  if last >= today then return 0; end if;
  update aur_div_day set day = today where id = 1;
  for r in select h.user_id, h.tk, h.qty, s.div from aur_holdings h join aur_stocks s on s.tk = h.tk where h.qty > 0 and s.div > 0 and s.status = 'core' loop
    pay := r.qty * coalesce((aur_last(r.tk)).p, 0) * r.div / 100 / 365;
    if pay > 0 then update profiles set cash = cash + pay where id = r.user_id; n := n + 1; end if;
  end loop;
  return n;
end $$;
