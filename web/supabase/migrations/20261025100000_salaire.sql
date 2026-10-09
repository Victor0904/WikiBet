-- Salaire proportionnel à l'activité réelle (revue d'octobre 2026) : un pari de 10 W toutes les 11 minutes rapportait
-- 500 W, soit environ 2 700 W par heure sans talent. Désormais : 10 % des mises des positions Aurelys de la séance,
-- 500 W au plus, et une position ne compte que si elle est restée ouverte au moins 1 minute réelle.
-- ponytail: tout salaire reste un revenu sans risque au-delà des frais ; plafonner selon le patrimoine si ça ne suffit pas.
alter table salaries add column amount float8 not null default 500;

create or replace function settle() returns int
language plpgsql security definer set search_path = public as $$
declare g record; r record; n int := 0; rc int; due boolean; ended timestamptz;
begin
  select * into g from game_now();
  -- Anciens modes (articles, duels, Live) : plus rien ne s'y ouvre, le règlement reste pour l'historique et les tests.
  for r in select id, session, end_tick from bets where status = 'open' and kind = 'trade' loop
    due := r.session < g.k or not g.playing or r.end_tick <= g.t;
    perform close_trade_at(r.id, case when due then r.end_tick else g.t end, due);
    n := n + 1;
  end loop;
  for r in select id from bets where status = 'open' and kind = 'duel' and (session < g.k or (session = g.k and not g.playing)) loop
    perform settle_duel(r.id); n := n + 1;
  end loop;
  for r in select id, login, created_at, end_at from bets where status = 'open' and kind = 'stream' loop
    select min(at) into ended from stream_ticks where login = r.login and not live and at > r.created_at;
    due := ended is not null or (r.end_at is not null and r.end_at <= now());
    perform close_stream_at(r.id, least(now(), coalesce(r.end_at, now()), coalesce(ended, now())), due);
    n := n + 1;
  end loop;
  n := n + resolve_markets();
  for r in select b.user_id, b.session, least(500, round(0.1 * sum(b.stake))) amt from bets b
            where b.session >= g.k - 5 and (b.session < g.k or not g.playing) and b.kind = 'aurelys'
              and coalesce(b.closed_at, now()) - b.created_at >= interval '1 minute'
            group by 1, 2 loop
    insert into salaries values (r.user_id, r.session, r.amt) on conflict do nothing;
    get diagnostics rc = row_count;
    if rc > 0 then update profiles set cash = cash + r.amt where id = r.user_id; end if;
  end loop;
  return n;
end $$;

-- Salaire doublé : le même montant une deuxième fois (et non plus 500 W fixes).
create or replace function salary_bonus() returns trigger language plpgsql set search_path = public as $$
begin
  update profiles set cash = cash + new.amount where id = new.user_id and salary_boost_until > now();
  return new;
end $$;
