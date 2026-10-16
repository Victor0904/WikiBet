-- Tableau de bord admin (dossier admin/, local, jamais déployé) : lecture seule, réservée à l'id de admin_config.
-- L'id ne vit qu'ici, jamais dans le front. À poser une fois (éditeur SQL de Supabase) :
--   insert into admin_config select 1, id from profiles where pseudo = 'Vayk';
-- admin_snapshot() renvoie tout d'un coup ; l'écran l'appelle toutes les 20 s au plus.
-- Retour arrière : drop function admin_snapshot(); drop function admin_check(); drop table admin_config;

create table admin_config (id int primary key default 1 check (id = 1), admin uuid not null references auth.users on delete cascade);
alter table admin_config enable row level security; -- aucune politique : illisible par les joueurs

create function admin_check() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.uid() is distinct from (select admin from admin_config) then
    raise exception 'Accès réservé';
  end if;
end $$;
revoke execute on function admin_check() from public, anon, authenticated;

-- stable : toute écriture y serait refusée par PostgreSQL.
create function admin_snapshot() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb := '{}'; v jsonb; d0 timestamptz := day_start();
begin
  perform admin_check();

  -- Sociétés : dernier cours et exposition (mise × levier) des positions ouvertes, joueurs et bots séparés.
  select coalesce(jsonb_agg(jsonb_build_object(
           'tk', s.tk, 'name', s.name, 'sector', s.sector, 'status', s.status, 'p', (aur_last(s.tk)).p,
           'long', coalesce(e.long, 0), 'short', coalesce(e.short, 0), 'bots', coalesce(e.bots, 0)) order by s.tk), '[]')
    into v
    from aur_stocks s
    left join (select b.aur, sum(b.stake * b.lev) filter (where b.dir = 'up' and not p.bot) long,
                      sum(b.stake * b.lev) filter (where b.dir = 'down' and not p.bot) short,
                      sum(b.stake * b.lev) filter (where p.bot) bots
                 from bets b join profiles p on p.id = b.user_id
                where b.status = 'open' and b.kind = 'aurelys' group by b.aur) e on e.aur = s.tk
   where s.status in ('core', 'listed');
  r := r || jsonb_build_object('stocks', v);

  -- Joueurs (les 1 000 vus le plus récemment) avec positions, talents, succès, filleuls.
  -- ponytail: 1 000 profils au plus, paginer si le jeu dépasse.
  select coalesce(jsonb_agg(x order by x->>'seen' desc nulls last), '[]') into v from (
    select jsonb_build_object(
      'id', p.id, 'pseudo', p.pseudo, 'bot', p.bot, 'cash', p.cash, 'bank', p.bank, 'patrimoine', patrimoine(p.id),
      'created', p.created_at, 'seen', p.last_seen, 'bankruptcies', p.bankruptcies,
      'level', talent_level(p.tal_hwm), 'tal_cum', p.tal_cum,
      'positions', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'tk', b.aur, 'dir', b.dir, 'lev', b.lev, 'stake', b.stake,
                      'entry', b.entry, 'at', b.created_at, 'value', trade_value(b, coalesce((aur_last(b.aur)).p, b.entry))) order by b.id), '[]')
                    from bets b where b.user_id = p.id and b.status = 'open' and b.kind = 'aurelys'),
      'talents', (select coalesce(jsonb_object_agg(t.code, t.rank), '{}') from talents t where t.user_id = p.id),
      'achievements', (select coalesce(jsonb_agg(a.code order by a.unlocked_at), '[]') from aur_achievements a where a.user_id = p.id),
      'filleuls', (select coalesce(jsonb_agg(jsonb_build_object('pseudo', f.pseudo, 'status', rf.status)), '[]')
                     from referrals rf join profiles f on f.id = rf.filleul where rf.parrain = p.id),
      'parrain', (select pp.pseudo from referrals rf join profiles pp on pp.id = rf.parrain where rf.filleul = p.id)) x
    from profiles p order by p.last_seen desc nulls last limit 1000) q;
  r := r || jsonb_build_object('players', v);

  -- Indicateurs (joueurs seulement, sans bots).
  select jsonb_build_object(
    'online', count(*) filter (where last_seen > now() - interval '2 minutes'),
    'signups_today', count(*) filter (where created_at >= d0),
    'demos', null, -- non mesuré : la démo tourne dans le navigateur, sans appel au serveur
    'w_cash', sum(cash + bank),
    'players', count(*)) into v
    from profiles where not bot;
  r := r || jsonb_build_object('kpi', v || jsonb_build_object(
    'liq_hour', (select count(*) from bets b join profiles p on p.id = b.user_id where b.closed_by = 'liq' and b.closed_at > now() - interval '1 hour' and not p.bot),
    'liq_hour_bots', (select count(*) from bets b join profiles p on p.id = b.user_id where b.closed_by = 'liq' and b.closed_at > now() - interval '1 hour' and p.bot),
    'retention', (select jsonb_build_object(
        'j1_n', count(*) filter (where c <= today - 1), 'j1', count(*) filter (where c <= today - 1 and exists (select 1 from presence_days d where d.user_id = id and d.day = c + 1)),
        'j7_n', count(*) filter (where c <= today - 7), 'j7', count(*) filter (where c <= today - 7 and exists (select 1 from presence_days d where d.user_id = id and d.day = c + 7)))
      from (select id, (created_at at time zone 'Europe/Paris')::date c, (now() at time zone 'Europe/Paris')::date today
              from profiles where not bot and created_at > now() - interval '30 days') n)));

  -- Santé : avance du moteur (cours calculés jusqu'à … ; négatif = en retard), settle(), appels de la fonction, aur_ticks.
  r := r || jsonb_build_object('health', jsonb_build_object(
    'engine_ahead_s', (select extract(epoch from min(m) - now()) from (select (select max(k.t) from aur_ticks k where k.tk = s.tk) m
                         from aur_stocks s where s.status in ('core', 'listed')) z),
    'ticks_bytes', pg_total_relation_size('aur_ticks'),
    'ticks_rows', (select reltuples::bigint from pg_class where oid = 'aur_ticks'::regclass)));
  if to_regclass('cron.job_run_details') is not null then -- absent des tests et de la démo
    execute $q$ select jsonb_build_object('last_ms', (array_agg(ms order by start_time desc))[1], 'avg_ms', avg(ms), 'max_ms', max(ms),
                  'failed', count(*) filter (where status = 'failed'), 'runs', count(*))
                from (select d.start_time, d.status, extract(epoch from d.end_time - d.start_time) * 1000 ms
                        from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                       where j.jobname = 'wikibourse-settle' order by d.start_time desc limit 30) z $q$ into v;
    r := jsonb_set(r, '{health,settle}', v);
  end if;
  if to_regclass('net._http_response') is not null then
    execute $q$ select coalesce(jsonb_agg(jsonb_build_object('at', created, 'status', status_code, 'error', error_msg, 'body', left(content, 300)) order by created desc), '[]')
                from (select * from net._http_response where error_msg is not null or status_code >= 400 order by created desc limit 10) z $q$ into v;
    r := jsonb_set(r, '{health,errors}', v);
  end if;

  -- Alertes.
  select coalesce(jsonb_agg(z), '[]') into v from ( -- un joueur porte plus de 25 % de l'exposition d'une société
    select jsonb_build_object('kind', 'concentration', 'pseudo', p.pseudo, 'tk', e.aur, 'share', e.x / t.tot) z
      from (select aur, user_id, sum(stake * lev) x from bets where status = 'open' and kind = 'aurelys' group by 1, 2) e
      join (select aur, sum(stake * lev) tot from bets where status = 'open' and kind = 'aurelys' group by 1) t using (aur)
      join profiles p on p.id = e.user_id
     where not p.bot and e.x > 0.25 * t.tot
    union all -- gain du jour plus de 5 fois la médiane des gains positifs du jour
    select jsonb_build_object('kind', 'gain', 'pseudo', g.pseudo, 'gain', g.gain, 'median', m.med)
      from (select p.pseudo, sum(bet_gain(b)) gain from bets b join profiles p on p.id = b.user_id
             where b.closed_at >= d0 and b.kind in ('aurelys', 'invest') and not p.bot group by p.pseudo) g
      cross join (select percentile_cont(0.5) within group (order by gain) med from (
                    select sum(bet_gain(b)) gain from bets b join profiles p on p.id = b.user_id
                     where b.closed_at >= d0 and b.kind in ('aurelys', 'invest') and not p.bot group by p.id) q where gain > 0) m
     where g.gain > 5 * m.med
    union all -- comptes du même parrain (lui compris) qui ouvrent la même position à moins d'une minute d'écart, 3 fois au moins en 24 h
    select jsonb_build_object('kind', 'mirror', 'parrain', pp.pseudo, 'pseudos', w.pseudos, 'pairs', w.n)
      from (select g.parrain, count(*) n, jsonb_agg(distinct pa.pseudo) || jsonb_agg(distinct pb.pseudo) pseudos
              from (select parrain, filleul u from referrals union select distinct parrain, parrain from referrals) g
              join (select parrain, filleul u from referrals union select distinct parrain, parrain from referrals) h on h.parrain = g.parrain and h.u > g.u
              join bets a on a.user_id = g.u and a.kind = 'aurelys' and a.created_at > now() - interval '24 hours'
              join bets b on b.user_id = h.u and b.kind = 'aurelys' and b.aur = a.aur and b.dir = a.dir
                         and b.created_at between a.created_at - interval '60 seconds' and a.created_at + interval '60 seconds'
              join profiles pa on pa.id = g.u join profiles pb on pb.id = h.u
             group by g.parrain having count(*) >= 3) w
      join profiles pp on pp.id = w.parrain) a;
  r := r || jsonb_build_object('alerts', v, 'now', now());
  return r;
end $$;
revoke execute on function admin_snapshot() from public, anon;
grant execute on function admin_snapshot() to authenticated;
