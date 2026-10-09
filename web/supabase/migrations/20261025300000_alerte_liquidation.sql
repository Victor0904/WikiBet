-- Prévenir avant la liquidation (revue d'octobre 2026) : une notification quand une position ne vaut plus que 25 %, puis
-- 10 % de sa mise, une fois chacune. Seulement pour les joueurs abonnés aux notifications (calcul à chaque pas de la fonction).
alter table bets add column warn smallint not null default 0, add column warn_at timestamptz;

create or replace function push_due() returns table (endpoint text) language sql security definer set search_path = public as $$
  with l as (update bets set push_at = now() where closed_by = 'liq' and push_at is null and closed_at > now() - interval '1 hour' returning user_id),
  v as (select b.id, trade_value(b, (aur_last(b.aur)).p) / b.stake r from bets b
         where b.kind = 'aurelys' and b.status = 'open' and b.warn < 2 and b.user_id in (select user_id from push_subs)),
  w as (update bets b set warn = case when v.r <= .10 then 2 else 1 end, warn_at = now() from v
         where b.id = v.id and (v.r <= .10 or (v.r <= .25 and b.warn < 1)) returning b.user_id)
  select s.endpoint from push_subs s where s.user_id in (select user_id from l union select user_id from w)
$$;

-- Détail pour le texte : liquidations et alertes des 10 dernières minutes. kind = 'liq', '25' ou '10'.
drop function push_info(text);
create function push_info(p_endpoint text) returns table (kind text, aur text, dir text, lev int, stake float8, lq float8)
language sql stable security definer set search_path = public as $$
  (select 'liq', b.aur, b.dir, b.lev, b.stake, b.exit from bets b join push_subs s on s.user_id = b.user_id
    where s.endpoint = p_endpoint and b.closed_by = 'liq' and b.push_at > now() - interval '10 minutes'
    order by b.closed_at desc limit 5)
  union all
  (select case when b.warn = 2 then '10' else '25' end, b.aur, b.dir, b.lev, b.stake,
          b.entry * (1 - (case when b.dir = 'up' then 1 else -1 end)::float8 / b.lev)
     from bets b join push_subs s on s.user_id = b.user_id
    where s.endpoint = p_endpoint and b.status = 'open' and b.warn_at > now() - interval '10 minutes'
    order by b.warn_at desc limit 5)
$$;
revoke execute on function push_due(), push_info(text) from public, anon, authenticated;
