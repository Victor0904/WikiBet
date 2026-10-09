-- Jeunes pousses (cotation très volatile) : levier ×5 au plus. À ×20, la liquidation tombait à −5 % et l'impact plus
-- les frais coûtaient environ 10 % de la mise dès l'ouverture : du hasard, pas du talent (revue d'octobre 2026).
-- Un déclencheur sur bets couvre l'ouverture à la main et les ordres à déclenchement (aur_open dans les deux cas).
create function bets_young_lev() returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind = 'aurelys' and new.lev > 5 and exists (select 1 from aur_stocks where tk = new.aur and status = 'listed') then
    raise exception 'Jeune pousse : levier ×5 au plus.';
  end if;
  return new;
end $$;
create trigger bets_young_lev before insert on bets for each row execute function bets_young_lev();
