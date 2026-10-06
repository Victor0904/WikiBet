-- Marché Crypto : vrais prix (Coinbase, paires en euros), positions à levier, frais de 0,1 %, liquidation sur les vraies bougies.
-- Ouvrir et clôturer passent par la fonction serveur « crypto » : elle lit le prix réel chez Coinbase au moment de l'ordre
-- et appelle crypto_open / crypto_close, réservées au serveur (les joueurs ne peuvent pas fixer le prix).
-- La même fonction relève chaque minute les bougies d'une minute et vérifie les liquidations.

create table crypto_assets (sym text primary key, name text not null, pair text not null, sort int not null default 0);
insert into crypto_assets (sym, name, pair, sort) values
  ('BTC', 'Bitcoin', 'BTC-EUR', 1), ('ETH', 'Ethereum', 'ETH-EUR', 2), ('SOL', 'Solana', 'SOL-EUR', 3),
  ('XRP', 'XRP', 'XRP-EUR', 4), ('DOGE', 'Dogecoin', 'DOGE-EUR', 5), ('ADA', 'Cardano', 'ADA-EUR', 6),
  ('AVAX', 'Avalanche', 'AVAX-EUR', 7), ('LINK', 'Chainlink', 'LINK-EUR', 8), ('DOT', 'Polkadot', 'DOT-EUR', 9),
  ('LTC', 'Litecoin', 'LTC-EUR', 10), ('SHIB', 'Shiba Inu', 'SHIB-EUR', 11), ('UNI', 'Uniswap', 'UNI-EUR', 12),
  ('ATOM', 'Cosmos', 'ATOM-EUR', 13), ('BCH', 'Bitcoin Cash', 'BCH-EUR', 14);

-- Bougies d'une minute (heure de début de la minute), relevées par la fonction crypto.
create table crypto_candles (
  sym text not null references crypto_assets on delete cascade,
  t timestamptz not null,
  o float8 not null, h float8 not null, l float8 not null, c float8 not null,
  primary key (sym, t)
);
create index on crypto_candles (t desc);

alter table bets drop constraint bets_kind_check;
alter table bets add constraint bets_kind_check check (kind in ('trade', 'duel', 'stream', 'question', 'crypto'));
alter table bets add column sym text references crypto_assets, add column fees float8 not null default 0;

alter table crypto_assets enable row level security;
alter table crypto_candles enable row level security;
create policy "lecture publique" on crypto_assets for select using (true);
create policy "lecture publique" on crypto_candles for select using (true);

-- Frais : 0,1 % du montant engagé (mise × levier), payés à l'ouverture et à la clôture.
create function crypto_fee(p_stake float8, p_lev int) returns float8 language sql immutable as $$ select p_stake * p_lev * 0.001 $$;

create function crypto_open(p_user uuid, p_sym text, p_dir text, p_lev int, p_stake float8, p_price float8) returns bets
language plpgsql security definer set search_path = public as $$
declare g record; b bets; fee float8;
begin
  if not exists (select 1 from crypto_assets where sym = p_sym) then raise exception 'Crypto inconnue.'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Prix indisponible, réessaie.'; end if;
  fee := crypto_fee(p_stake, p_lev);
  update profiles set cash = cash - p_stake - fee where id = p_user and p_stake > 0 and cash >= p_stake + fee;
  if not found then raise exception 'Solde insuffisant (mise + frais).'; end if;
  select * into g from game_now();
  insert into bets (user_id, session, day, kind, stake, sym, dir, lev, entry, fees)
  values (p_user, g.k, g.d, 'crypto', p_stake, p_sym, p_dir, p_lev, p_price, fee) returning * into b;
  return b;
end $$;

-- Liquidation : première bougie depuis l'ouverture dont le plus bas (hausse) ou le plus haut (baisse) touche le seuil.
create function crypto_liquidate(p_id bigint) returns bets language plpgsql set search_path = public as $$
declare b bets; lq float8; t0 timestamptz;
begin
  select * into b from bets where id = p_id and kind = 'crypto' and status = 'open' for update;
  if not found then return null; end if;
  lq := b.entry * (1 - (case when b.dir = 'up' then 1 else -1 end)::float8 / b.lev);
  select min(c.t) into t0 from crypto_candles c
   where c.sym = b.sym and c.t >= date_trunc('minute', b.created_at)
     and (case when b.dir = 'up' then c.l <= lq else c.h >= lq end);
  if t0 is null then return b; end if;
  update bets set status = 'lost', payout = 0, exit = lq, exit_at = t0, closed_at = now() where id = b.id returning * into b;
  return b;
end $$;

create function crypto_close(p_user uuid, p_id bigint, p_price float8) returns bets
language plpgsql security definer set search_path = public as $$
declare b bets; fee float8; pay float8;
begin
  perform crypto_liquidate(p_id);
  select * into b from bets where id = p_id and user_id = p_user and kind = 'crypto' for update;
  if not found then raise exception 'Position introuvable.'; end if;
  if b.status <> 'open' then return b; end if;
  fee := crypto_fee(b.stake, b.lev);
  pay := greatest(0, trade_value(b, p_price) - fee);
  update bets set status = case when pay > b.stake + b.fees then 'won' else 'lost' end,
                  payout = pay, exit = p_price, exit_at = now(), closed_at = now(), fees = b.fees + fee
   where id = b.id returning * into b;
  update profiles set cash = cash + pay where id = b.user_id;
  return b;
end $$;

create function crypto_settle() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from bets where kind = 'crypto' and status = 'open' loop
    if (crypto_liquidate(r.id)).status = 'lost' then n := n + 1; end if;
  end loop;
  delete from crypto_candles where t < now() - interval '2 days';
  return n;
end $$;

-- L'assurance du QG couvre aussi les positions crypto liquidées.
create or replace function bets_bonus() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.kind = 'duel' and consume_bonus(new.user_id, 'boost_duel') then new.odds := round(new.odds * 1.2, 2); end if;
  elsif old.status = 'open' and new.status = 'lost' and coalesce(new.payout, 0) = 0 and new.kind in ('trade', 'stream', 'crypto')
        and new.exit is not null and consume_bonus(new.user_id, 'assurance') then
    new.payout := new.stake * 0.5; new.insured := true;
    update profiles set cash = cash + new.payout where id = new.user_id;
  end if;
  return new;
end $$;

-- Réservées au serveur : le prix vient de la fonction crypto, jamais du joueur.
revoke execute on function crypto_open(uuid, text, text, int, float8, float8), crypto_close(uuid, bigint, float8),
  crypto_liquidate(bigint), crypto_settle() from public, anon, authenticated;

-- Relève des bougies et vérification des liquidations chaque minute.
do $$ begin
  perform cron.schedule('wikibourse-crypto', '* * * * *', $cron$
    select net.http_post(
      url := 'https://urivyzajsfcbtbfrvjcs.supabase.co/functions/v1/crypto',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyaXZ5emFqc2ZjYnRiZnJ2amNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODE1MzQsImV4cCI6MjEwNjg1NzUzNH0.urFCndYjySGLjHQqoli4-UaP843pVG2kR1ggW7SpIxo'),
      body := '{"action":"poll"}'::jsonb)
  $cron$);
exception when others then
  raise notice 'relève crypto non planifiée (%)', sqlerrm;
end $$;
