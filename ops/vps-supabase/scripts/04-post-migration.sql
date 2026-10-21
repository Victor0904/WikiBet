-- Après 03-restore.sh : ménage des journaux et index. Idempotent (relançable sans effet de bord).
-- Lancer en tant que postgres (propriétaire des tables et des jobs pg_cron), hors transaction (index CONCURRENTLY) :
--   cd stack && docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < ../scripts/04-post-migration.sql

\echo '1. Journal de pg_cron vidé (25 Mo sur Cloud, 21 % de la base : une ligne par passage du moteur toutes les 20 s)'
truncate cron.job_run_details;

\echo '2. Purge quotidienne du journal (24 h gardées), sauf si un job le purge déjà'
-- Le job wikibourse-menage (migration 20261026000000_disque.sql) purge déjà chaque heure job_run_details et
-- net._http_response au-delà d'1 h : s'il a été restauré, on ne double pas le travail.
do $$ begin
  if not exists (select from cron.job where command ilike '%delete from cron.job_run_details%') then
    perform cron.schedule('aurelys-purge-cron', '23 3 * * *',
      $c$delete from cron.job_run_details where end_time < now() - interval '24 hours'$c$);
    raise notice 'job aurelys-purge-cron créé';
  else
    raise notice 'purge déjà assurée par : %', (select string_agg(jobname, ', ') from cron.job where command ilike '%delete from cron.job_run_details%');
  end if;
end $$;

\echo '3. Index'
-- bets : positions ouvertes d'un joueur (« user_id = … and status = 'open' »). Lu à chaque ordre (aur_open : nombre de
-- positions ouvertes, exposition par action) et pour chaque profil par le classement et le patrimoine
-- (« b.user_id = p.id and b.status = 'open' »). L'index existant bets (user_id, session desc) oblige à relire toutes
-- les positions du joueur, closes comprises (des milliers pour un joueur assidu ou un bot).
-- Demandé sur (user_id, status) : index partiel sur les seules positions ouvertes, bien plus petit (quelques dizaines
-- de lignes par joueur au plus) et moins coûteux à tenir à jour ; les positions closes ont déjà
-- bets (user_id, closed_at) where status <> 'open' (migration 20261010000000_social.sql).
create index concurrently if not exists bets_user_open on public.bets (user_id) where status = 'open';

-- aur_candles : aur_history(null, 180) est appelée à l'ouverture du marché par chaque joueur (web/src/aurelys.js) et
-- filtre « t > now() - 180 min » sur toutes les actions ; la clé primaire (tk, t) ne sert qu'avec une action donnée,
-- sinon la table entière (10 jours de bougies) est relue. Cet index ne lit que les 3 dernières heures.
create index concurrently if not exists aur_candles_t on public.aur_candles (t);

-- aur_news (id desc) : PAS créé. id est la clé primaire : son index B-tree se lit aussi à l'envers, donc
-- « order by id desc limit 150 » (web/src/api.js, aurNews) et « max(id) » (aur_store) l'utilisent déjà.
-- Un second index sur la même colonne doublerait les écritures sans rien accélérer.

\echo '4. Statistiques à jour pour les nouveaux index'
analyze public.bets;
analyze public.aur_candles;

select indexrelid::regclass as index, pg_size_pretty(pg_relation_size(indexrelid)) as taille
  from pg_index where indexrelid in ('public.bets_user_open'::regclass, 'public.aur_candles_t'::regclass);
