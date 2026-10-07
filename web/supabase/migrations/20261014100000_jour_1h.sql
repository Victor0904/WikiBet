-- Un jour d'Aurelys dure maintenant 1 h réelle (1 minute d'Aurelys = 2,5 s) : bougies d'une heure d'Aurelys de 150 s,
-- dividendes à chaque jour d'Aurelys (3 600 s), trophée « Mains de diamant » sur un jour d'Aurelys (1 h).
create or replace function aur_hour(p_t timestamptz) returns timestamptz language sql immutable as $$
  select to_timestamp(1790812800 + floor((extract(epoch from p_t) - 1790812800) / 150) * 150)
$$;
create or replace function aur_dividends() returns int language plpgsql security definer set search_path = public as $$
declare today int := floor((extract(epoch from now()) - 1790812800) / 3600)::int; last int; n int := 0; r record; pay float8;
begin
  select day into last from aur_div_day for update;
  if last is null then insert into aur_div_day values (1, today); return 0; end if;
  if last >= today then return 0; end if;
  update aur_div_day set day = today;
  for r in select h.user_id, h.tk, h.qty, s.div from aur_holdings h join aur_stocks s on s.tk = h.tk where h.qty > 0 and s.div > 0 and s.status = 'core' loop
    pay := r.qty * coalesce((aur_last(r.tk)).p, 0) * r.div / 100 / 365;
    if pay > 0 then update profiles set cash = cash + pay where id = r.user_id; n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function trophies(p_user uuid)
returns table (id text, name text, how text, got boolean, detail text)
language sql stable security definer set search_path = public as $$
  with b as (select *, bet_gain(x) as g from bets x where user_id = p_user and status <> 'open'),
       best as (select g, coalesce(aur, login, sym, tk) as what from b order by g desc limit 1),
       p as (select patrimoine(p_user) as pat, bankruptcies from profiles where id = p_user)
  select * from (values
    ('best', 'Meilleur trade', 'Ton plus gros gain sur un pari', coalesce((select g > 0 from best), false),
       (select '+' || to_char(round(g), 'FM999G999G999') || ' W · ' || replace(what, 'steam:', 'Steam ') from best where g > 0)),
    ('krach', 'J''ai survécu au krach', 'Clôturer une position Aurelys gagnante en plein krach', exists (select 1 from b where kind = 'aurelys' and status = 'won' and reg = 'krach'), null),
    ('diamant', 'Mains de diamant', 'Garder une position Aurelys gagnante un jour d''Aurelys entier (1 h)', exists (select 1 from b where kind = 'aurelys' and status = 'won' and closed_at - created_at >= interval '1 hour'), null),
    ('baleine', 'Baleine', 'Engager au moins 80 % du plafond sur une action d''Aurelys', exists (select 1 from b join aur_stocks s on s.tk = b.aur where b.stake * b.lev >= 16 * s.liq), null),
    ('oracle', 'Oracle du Live', 'Gagner 10 questions Twitch ou Steam', coalesce((select count(*) >= 10 from b where kind = 'question' and status = 'won'), false), null),
    ('centurion', 'Centurion', '100 paris clôturés', (select count(*) >= 100 from b), null),
    ('phenix', 'Phénix', 'Revenir à 50 000 W de patrimoine après une faillite', coalesce((select bankruptcies > 0 and pat >= 50000 from p), false), null),
    ('million', 'Millionnaire', '1 000 000 W de patrimoine', coalesce((select pat >= 1000000 from p), false), null)
  ) t(id, name, how, got, detail)
$$;
