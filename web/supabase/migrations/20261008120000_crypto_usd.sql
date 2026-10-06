-- Crypto : passage des paires en euros aux paires en dollars.
-- Mesuré sur Coinbase : en euros, la plupart des cryptos restaient figées de longues secondes (0 à 3 échanges en 30 s) ;
-- en dollars, Bitcoin bouge environ 3 fois par seconde. On garde 14 cryptos actives ; les trop calmes sont désactivées
-- (gardées en base pour l'historique des paris).

alter table crypto_assets add column active boolean not null default true;
update crypto_assets set pair = sym || '-USD';
update crypto_assets set active = false where sym in ('DOT', 'SHIB', 'ATOM');
insert into crypto_assets (sym, name, pair, sort) values ('SUI', 'Sui', 'SUI-USD', 11), ('XLM', 'Stellar', 'XLM-USD', 13), ('TIA', 'Celestia', 'TIA-USD', 14);
update crypto_assets set sort = s.sort from (values ('BTC', 1), ('ETH', 2), ('SOL', 3), ('XRP', 4), ('DOGE', 5), ('ADA', 6), ('AVAX', 7),
  ('LINK', 8), ('LTC', 9), ('BCH', 10), ('UNI', 12)) as s(sym, sort) where crypto_assets.sym = s.sym;

-- Positions encore ouvertes au prix en euros : converties en dollars au taux du moment (1 € = 1,1252 $, relevé sur Coinbase).
-- Leur variation en %, donc leur gain en W, est inchangée.
update bets set entry = entry * 1.1252 where kind = 'crypto' and status = 'open';

-- Les bougies en euros fausseraient la liquidation des positions en dollars.
delete from crypto_candles;

-- On ne peut plus ouvrir de position sur une crypto désactivée.
create or replace function crypto_open(p_user uuid, p_sym text, p_dir text, p_lev int, p_stake float8, p_price float8) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets; fee float8;
begin
  if not exists (select 1 from crypto_assets where sym = p_sym and active) then raise exception 'Crypto indisponible.'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Prix indisponible, réessaie.'; end if;
  fee := crypto_fee(p_stake, p_lev);
  update profiles set cash = cash - p_stake - fee where id = p_user and p_stake > 0 and cash >= p_stake + fee;
  if not found then raise exception 'Solde insuffisant (mise + frais).'; end if;
  select * into g from game_now();
  insert into bets (user_id, session, day, kind, stake, sym, dir, lev, entry, fees)
  values (p_user, g.k, g.d, 'crypto', p_stake, p_sym, p_dir, p_lev, p_price, fee) returning * into b;
  return b;
end $$;
revoke execute on function crypto_open(uuid, text, text, int, float8, float8) from public, anon, authenticated;
