-- Les identifiants des actualités viennent maintenant de la base : quand la simulation repart d'un nouvel état,
-- sa numérotation recommence à 1 et les nouvelles entraient en conflit avec les anciennes (ignorées sans bruit).
create or replace function aur_store(p_from bigint, p_state jsonb, p_ticks jsonb, p_news jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_from is null then
    insert into aur_state values (1, (p_state->>'t')::bigint, p_state);
  else
    update aur_state set state = p_state, t = (p_state->>'t')::bigint where id = 1 and t = p_from;
    if not found then raise exception 'conflit : la simulation a déjà avancé'; end if;
  end if;
  insert into aur_ticks (tk, t, p, v, halt, x)
  select r.tk, to_timestamp(r.t), r.p, r.v, coalesce(r.halt, false), r.x from jsonb_to_recordset(p_ticks) as r(t bigint, tk text, p float8, v float8, halt boolean, x jsonb)
  on conflict do nothing;
  insert into aur_news (id, t, tk, sector, cat, title, body, sent, fiab)
  select coalesce((select max(id) from aur_news), 0) + row_number() over (order by r.id), to_timestamp(r.t), r.tk, r.sector, r.cat, r.title, r.text, r.sent, r.fiab
  from jsonb_to_recordset(p_news) as r(id bigint, t bigint, tk text, sector text, cat text, title text, text text, sent float8, fiab float8);
end $$;

-- Levées de fonds en cours : combien a déjà été souscrit, et par combien d'investisseurs (sans dire qui).
create function aur_round_stats() returns table (tk text, investors int, total float8)
language sql stable security definer set search_path = public as $$
  select s.tk, count(h.user_id)::int, coalesce(sum(h.cost), 0) from aur_stocks s left join aur_holdings h on h.tk = s.tk and h.qty > 0
  where s.status = 'round' group by s.tk
$$;
revoke execute on function aur_round_stats() from public, anon;
grant execute on function aur_round_stats() to authenticated;
