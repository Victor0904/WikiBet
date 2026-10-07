-- ===== Trophées du QG =====
-- Calculés à partir des paris (rien à stocker), visibles par tous : ils donnent envie de visiter le QG des autres.
-- Seul ajout : l'humeur du marché d'Aurelys au moment de la clôture (pour « J'ai survécu au krach »).

alter table bets add column reg text;

create or replace function aur_close(p_user uuid, p_id bigint, p_slip float8) returns bets
language plpgsql security definer set search_path = public as $$
declare b bets; k aur_ticks; fee float8; pay float8; px float8;
begin
  perform aur_liquidate(p_id);
  select * into b from bets where id = p_id and user_id = p_user and kind = 'aurelys' for update;
  if not found then raise exception 'Position introuvable.'; end if;
  if b.status <> 'open' then return b; end if;
  k := aur_last(b.aur);
  if k.t is null or k.t < now() - interval '30 seconds' then raise exception 'Marché indisponible, réessaie dans un instant.'; end if;
  if k.halt then raise exception 'Cotation suspendue : clôture possible à la reprise.'; end if;
  -- Clôturer une position à la hausse, c'est vendre : le prix obtenu est un peu plus bas (et inversement).
  px := k.p * (1 - (case when b.dir = 'up' then 1 else -1 end) * least(greatest(coalesce(p_slip, 0), 0), 0.2));
  fee := b.stake * b.lev * 0.001;
  pay := greatest(0, trade_value(b, px) - fee);
  update bets set status = case when pay > b.stake + b.fees then 'won' else 'lost' end,
                  payout = pay, exit = px, exit_at = now(), closed_at = now(), fees = b.fees + fee,
                  reg = (select x->>'reg' from aur_ticks where tk = 'AUR12' and t <= now() order by t desc limit 1)
   where id = b.id returning * into b;
  update profiles set cash = cash + pay where id = b.user_id;
  insert into aur_orders (tk, q) values (b.aur, (case when b.dir = 'up' then -1 else 1 end) * b.stake * b.lev);
  return b;
end $$;

-- Trophées d'un joueur : obtenu ou non, et le détail (pour le cadre du meilleur trade).
create function trophies(p_user uuid)
returns table (id text, name text, how text, got boolean, detail text)
language sql stable security definer set search_path = public as $$
  with b as (select *, bet_gain(x) as g from bets x where user_id = p_user and status <> 'open'),
       best as (select g, coalesce(aur, login, sym, tk) as what from b order by g desc limit 1),
       p as (select patrimoine(p_user) as pat, bankruptcies from profiles where id = p_user)
  select * from (values
    ('best', 'Meilleur trade', 'Ton plus gros gain sur un pari', coalesce((select g > 0 from best), false),
       (select '+' || to_char(round(g), 'FM999G999G999') || ' W · ' || replace(what, 'steam:', 'Steam ') from best where g > 0)),
    ('krach', 'J''ai survécu au krach', 'Clôturer une position Aurelys gagnante en plein krach', exists (select 1 from b where kind = 'aurelys' and status = 'won' and reg = 'krach'), null),
    ('diamant', 'Mains de diamant', 'Garder une position Aurelys gagnante un jour d''Aurelys entier (2 h)', exists (select 1 from b where kind = 'aurelys' and status = 'won' and closed_at - created_at >= interval '2 hours'), null),
    ('baleine', 'Baleine', 'Engager au moins 80 % du plafond sur une action d''Aurelys', exists (select 1 from b join aur_stocks s on s.tk = b.aur where b.stake * b.lev >= 16 * s.liq), null),
    ('oracle', 'Oracle du Live', 'Gagner 10 questions Twitch ou Steam', coalesce((select count(*) >= 10 from b where kind = 'question' and status = 'won'), false), null),
    ('centurion', 'Centurion', '100 paris clôturés', (select count(*) >= 100 from b), null),
    ('phenix', 'Phénix', 'Revenir à 50 000 W de patrimoine après une faillite', coalesce((select bankruptcies > 0 and pat >= 50000 from p), false), null),
    ('million', 'Millionnaire', '1 000 000 W de patrimoine', coalesce((select pat >= 1000000 from p), false), null)
  ) t(id, name, how, got, detail)
$$;
revoke execute on function trophies(uuid) from public, anon;
grant execute on function trophies(uuid) to authenticated;
