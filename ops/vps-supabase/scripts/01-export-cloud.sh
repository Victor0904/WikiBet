#!/usr/bin/env bash
# Export de la base Supabase Cloud, en LECTURE SEULE, par le Session pooler (comme ops/aurelys-backup/backup.sh).
# Identifiants : PGURL et PGPASSWORD, lus dans l'environnement ou dans le fichier CLOUD_ENV (ops/vps-supabase/cloud.env
# par défaut, ignoré par git, chmod 600) ; même format que ops/aurelys-backup/env.example.
# Sortie dans DUMPS (ops/vps-supabase/dumps/, ignoré par git, chmod 700) : données de joueurs, hash de mots de passe.
#   roles.sql        rôles propres au projet (ceux de Supabase retirés), sans mot de passe
#   extensions.sql   extensions installées
#   schema.sql       structure des schémas applicatifs (public + autres) ; auth est créé par GoTrue lui-même
#   data.sql         données de public + auth (sans auth.schema_migrations, sans tables UNLOGGED)
#   cron_jobs.sql    jobs pg_cron rejouables (cron.schedule)
#   publication.sql  tables suivies par le temps réel
#   vault_noms.txt   noms des secrets du Vault (jamais les valeurs)
#   comptes.tsv      nombre de lignes par table, comparé par 03-restore.sh
#   stats.txt        tailles des tables et requêtes les plus coûteuses (pour 04-post-migration.sql)
#   --dry-run        montre les commandes sans rien lancer
. "$(dirname "$0")/_commun.sh"

CLOUD_ENV="${CLOUD_ENV:-$ICI/cloud.env}"
if [ -z "${PGURL:-}" ] && [ -f "$CLOUD_ENV" ]; then set -a; . "$CLOUD_ENV"; set +a; fi
[ -n "${PGURL:-}" ] || echec "PGURL vide : renseigne $CLOUD_ENV (voir ops/aurelys-backup/env.example)"
# URL copiée du bouton « Connect » de Supabase : le gabarit [YOUR-PASSWORD] masquerait PGPASSWORD.
PGURL="${PGURL/:\[YOUR-PASSWORD\]@/@}"
[ -n "${PGPASSWORD:-}" ] || [ "$DRY" = 1 ] || echec "PGPASSWORD vide dans $CLOUD_ENV"
export PGPASSWORD="${PGPASSWORD:-}"

# Client PostgreSQL 17 : image Docker postgres:17-alpine (sortie sur stdout, aucun volume), sinon le client local s'il est en 17.
if docker info >/dev/null 2>&1; then
  pg() { docker run --rm -i -e PGPASSWORD postgres:17-alpine "$@"; }
else
  v=$(pg_dump --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)
  [ "$v" = 17 ] || echec "ni Docker ni pg_dump 17 (trouvé : ${v:-aucun})"
  pg() { "$@"; }
fi
# Toute requête passe en transaction en lecture seule : une écriture serait refusée par le serveur.
q() { pg psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -c "set default_transaction_read_only = on" -c "$1"; }

# Schémas gérés par l'image Supabase : jamais exportés en structure.
GERES="'extensions','graphql','graphql_public','pgbouncer','pgsodium','pgsodium_masks','realtime','supabase_functions',
'storage','vault','_realtime','_supabase','cron','net','auth','information_schema','_analytics','supabase_migrations'"
# Rôles créés par l'image : jamais recréés ni modifiés (« ALTER ROLE postgres NOSUPERUSER » casserait la base).
ROLES_GERES="anon authenticated authenticator dashboard_user postgres service_role cli_login_postgres"

if [ "$DRY" = 1 ]; then
  info "simulation : export vers $DUMPS"
  for f in roles.sql extensions.sql schema.sql data.sql cron_jobs.sql publication.sql vault_noms.txt comptes.tsv stats.txt; do
    echo "[simulation] $f"; done
  exit 0
fi

mkdir -p "$DUMPS"; chmod 700 "$DUMPS"; umask 077
t0=$(date +%s)
info "connexion au projet $CLOUD_REF (lecture seule)"
[ "$(q 'show transaction_read_only')" = on ] || echec "la session n'est pas en lecture seule, arrêt"
APP=$(q "select string_agg(nspname, ' ' order by nspname) from pg_namespace where nspname !~ '^pg_' and nspname not in ($GERES)")
ok "schémas applicatifs : $APP (+ auth en données seulement)"
NS=(); for s in $APP; do NS+=(-n "$s"); done

info "rôles"
pg pg_dumpall -d "$PGURL" --roles-only --no-role-passwords | awk -v g="$ROLES_GERES" '
  BEGIN { n = split(g, a, " "); for (i = 1; i <= n; i++) R[a[i]] = 1 }
  function gere(x) { gsub(/[";]/, "", x); return (x in R) || x ~ /^(pg_|supabase|pgsodium|pgbouncer)/ }
  /^(CREATE|ALTER) ROLE / { if (gere($3)) next }
  /^COMMENT ON ROLE / { if (gere($4)) next }
  /^GRANT / { if (gere($2)) next }
  { print }' > "$DUMPS/roles.sql"
ok "roles.sql : $(grep -c '^CREATE ROLE' "$DUMPS/roles.sql" || true) rôle(s) propre(s) au projet"

info "extensions"
q "select format('create extension if not exists %I with schema %I;', e.extname, n.nspname)
     from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname <> 'plpgsql' order by 1" > "$DUMPS/extensions.sql"
ok "extensions.sql : $(wc -l < "$DUMPS/extensions.sql") extension(s)"

info "structure"
# « CREATE SCHEMA public » existe déjà dans l'image : ligne retirée.
pg pg_dump "$PGURL" --schema-only --no-publications --no-subscriptions "${NS[@]}" | sed '/^CREATE SCHEMA public;$/d' > "$DUMPS/schema.sql"
ok "schema.sql : $(grep -c '^CREATE TABLE' "$DUMPS/schema.sql") tables, $(grep -c '^CREATE FUNCTION' "$DUMPS/schema.sql") fonctions"

info "données (le plus long)"
pg pg_dump "$PGURL" --data-only --no-unlogged-table-data "${NS[@]}" -n auth -T auth.schema_migrations > "$DUMPS/data.sql"
ok "data.sql : $(du -h "$DUMPS/data.sql" | cut -f1)"

info "jobs pg_cron, temps réel, Vault"
q "select format('select cron.schedule(%L, %L, %L);', jobname, schedule, command)
       || case when active then '' else format(E'\nselect cron.alter_job(jobid, active := false) from cron.job where jobname = %L;', jobname) end
     from cron.job order by jobid" > "$DUMPS/cron_jobs.sql"
q "select format('alter publication supabase_realtime add table %I.%I;', schemaname, tablename)
     from pg_publication_tables where pubname = 'supabase_realtime' order by 1" > "$DUMPS/publication.sql"
q "select name || E'\t' || coalesce(description, '') from vault.secrets order by name" > "$DUMPS/vault_noms.txt"
ok "$(grep -c 'cron.schedule' "$DUMPS/cron_jobs.sql") job(s) cron, $(wc -l < "$DUMPS/publication.sql") table(s) en temps réel, $(wc -l < "$DUMPS/vault_noms.txt") secret(s) Vault (noms seulement)"

info "comptage des lignes et statistiques"
q "select n.nspname || '.' || c.relname || E'\t' ||
          (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and c.relpersistence = 'p' and (n.nspname = 'auth' or n.nspname = any(string_to_array('$APP', ' ')))
      and (n.nspname, c.relname) <> ('auth', 'schema_migrations') order by 1" > "$DUMPS/comptes.tsv"
{
  echo "== Tables les plus grosses (taille totale, index compris)"
  q "select format('%-45s %10s', n.nspname || '.' || c.relname, pg_size_pretty(pg_total_relation_size(c.oid)))
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc limit 25"
  echo; echo "== Index jamais utilisés depuis la remise à zéro des statistiques (public)"
  q "select format('%-50s %10s', indexrelname, pg_size_pretty(pg_relation_size(indexrelid))) from pg_stat_user_indexes
      where schemaname = 'public' and idx_scan = 0 order by pg_relation_size(indexrelid) desc"
  echo; echo "== Parcours séquentiels (public)"
  q "select format('%-35s seq %10s  idx %10s  lignes lues en seq %14s', relname, seq_scan, coalesce(idx_scan, 0), seq_tup_read)
       from pg_stat_user_tables where schemaname = 'public' order by seq_tup_read desc limit 20"
  echo; echo "== Requêtes les plus coûteuses (pg_stat_statements)"
  q "select format('%10s ms  %8s appels  %s', round(total_exec_time), calls, left(regexp_replace(query, '\s+', ' ', 'g'), 160))
       from pg_stat_statements order by total_exec_time desc limit 25" 2>/dev/null || echo "(pg_stat_statements illisible)"
} > "$DUMPS/stats.txt"
ok "comptes.tsv ($(wc -l < "$DUMPS/comptes.tsv") tables), stats.txt"

chmod 600 "$DUMPS"/*
ok "export terminé en $(( $(date +%s) - t0 )) s dans $DUMPS"
