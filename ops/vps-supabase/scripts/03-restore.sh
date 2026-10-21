#!/usr/bin/env bash
# Restaure l'export de 01-export-cloud.sh dans la stack lancée par 02-start-stack.sh, dans cet ordre :
# rôles → extensions → structure → données (session_replication_role = replica) → temps réel → secrets Vault
# → ANALYZE → redémarrage d'auth et rest → jobs pg_cron (adresses réécrites vers le VPS) → comparaison des comptes.
# Idempotent : une structure déjà là ou des données déjà chargées ne sont pas rechargées (message « déjà fait »).
# Le schéma auth vient des migrations de GoTrue (02) : seules ses données sont chargées, GoTrue arrêté pendant ce temps.
#   --dry-run  montre le plan sans rien changer
. "$(dirname "$0")/_commun.sh"
charger_env
for f in roles.sql extensions.sql schema.sql data.sql cron_jobs.sql publication.sql vault_noms.txt comptes.tsv; do
  [ -f "$DUMPS/$f" ] || echec "$DUMPS/$f absent : lance d'abord 01-export-cloud.sh"
done
if [ "$DRY" = 1 ]; then
  info "simulation, rien n'est changé. Plan :"
  printf '  %s\n' "rôles ($(grep -c '^CREATE ROLE' "$DUMPS/roles.sql" || true))" "extensions ($(wc -l < "$DUMPS/extensions.sql"))" \
    "structure (si public.profiles n'existe pas)" "données $(du -h "$DUMPS/data.sql" | cut -f1) (si public.profiles est vide, auth arrêté)" \
    "temps réel ($(wc -l < "$DUMPS/publication.sql") tables)" "Vault : $(cut -f1 "$DUMPS/vault_noms.txt" | tr '\n' ' ')" \
    "ANALYZE, redémarrage auth + rest" "pg_cron ($(grep -c cron.schedule "$DUMPS/cron_jobs.sql") jobs, adresses réécrites vers http://kong:8000)"
  exit 0
fi
sql1 "select 1" >/dev/null 2>&1 || echec "base injoignable : lance d'abord 02-start-stack.sh"
[ "$(sql1 'select count(*) from auth.schema_migrations')" -gt 0 ] || echec "schéma auth absent (GoTrue pas encore démarré)"
t0=$(date +%s)
# Erreurs tolérées (objets déjà présents) : affichées si elles sont d'un autre type.
tolerant() { psql_db -v ON_ERROR_STOP=0 2>&1 | grep -vE 'already exists|already member|is already a member' || true; }

info "1/9 rôles"
tolerant < "$DUMPS/roles.sql"

info "2/9 extensions"
tolerant < "$DUMPS/extensions.sql"

info "3/9 structure"
if [ "$(sql1 "select to_regclass('public.profiles') is not null")" = t ]; then ok "déjà fait"
else psql_db --single-transaction < "$DUMPS/schema.sql" >/dev/null && ok "structure chargée"; fi

info "4/9 données"
if [ "$(sql1 'select exists (select from public.profiles)')" = t ]; then ok "déjà fait (public.profiles n'est pas vide)"
else
  dc stop auth >/dev/null 2>&1
  { echo "set session_replication_role = replica;"; cat "$DUMPS/data.sql"; } | psql_db --single-transaction >/dev/null ||
    { dc start auth >/dev/null 2>&1; echec "chargement des données annulé (rien n'a été écrit)"; }
  dc start auth >/dev/null 2>&1
  ok "données chargées"
fi

info "5/9 temps réel"
tolerant < "$DUMPS/publication.sql"
sql1 "select string_agg(tablename, ', ') from pg_publication_tables where pubname = 'supabase_realtime'"

info "6/9 secrets Vault (valeurs demandées sans écho ; aurelys_tick = TICK_SECRET du .env)"
# La valeur passe par l'entrée standard de psql, jamais par la ligne de commande.
vault_ecrire() { # nom valeur
  local tag="v$RANDOM$RANDOM" id
  id=$(sql1 "select id from vault.secrets where name = '$1'")
  if [ -n "$id" ]; then printf 'select vault.update_secret(%s, $%s$%s$%s$);\n' "'$id'" "$tag" "$2" "$tag"
  else printf 'select vault.create_secret($%s$%s$%s$, %s);\n' "$tag" "$2" "$tag" "'$1'"; fi | psql_db >/dev/null
}
while IFS=$'\t' read -r nom desc; do
  [ -n "$nom" ] || continue
  [[ "$nom" =~ ^[A-Za-z0-9_.-]+$ ]] || { avert "nom de secret inattendu ignoré : $nom"; continue; }
  if [ "$nom" = aurelys_tick ]; then
    [ -n "${TICK_SECRET:-}" ] || echec "TICK_SECRET vide dans stack/.env"
    vault_ecrire "$nom" "$TICK_SECRET"; ok "$nom (TICK_SECRET)"; continue
  fi
  if [ -n "$(sql1 "select id from vault.secrets where name = '$nom'")" ]; then ok "$nom : déjà présent"; continue; fi
  read -rsp "Valeur du secret Vault « $nom » ${desc:+($desc) }(vide = passer) : " v < /dev/tty; echo
  if [ -z "$v" ]; then avert "$nom non créé"; else vault_ecrire "$nom" "$v"; ok "$nom créé"; fi
done < "$DUMPS/vault_noms.txt"

info "7/9 ANALYZE"
psql_db -c "analyze"

info "8/9 redémarrage d'auth et rest (cache du schéma de PostgREST), avant que le moteur ne l'appelle"
dc restart auth rest >/dev/null 2>&1
dc up -d --wait --wait-timeout 120 auth rest >/dev/null 2>&1
ok "auth et rest relancés"

info "9/9 jobs pg_cron (appartiennent à postgres, comme sur Cloud)"
# Le moteur appelait https://<projet>.supabase.co/functions/v1/aurelys avec la clé anon du Cloud : il appelle
# maintenant le gateway local (alias kong) avec la nouvelle clé. Un job qui viserait encore le Cloud est refusé.
sed -e "s#https://$CLOUD_REF\.supabase\.co/functions/v1/#http://kong:8000/functions/v1/#g" \
    -e "s#Bearer eyJ[A-Za-z0-9_.-]*#Bearer $ANON_KEY#g" "$DUMPS/cron_jobs.sql" | PGUSER_SQL=postgres psql_db >/dev/null
if [ "$(sql1 "select count(*) from cron.job where command ~ 'supabase\.co'")" != 0 ]; then
  sql1 "select cron.unschedule(jobid) from cron.job where command ~ 'supabase\.co'" >/dev/null
  echec "un job pg_cron visait encore Supabase Cloud : il a été retiré, à corriger à la main dans cron_jobs.sql"
fi
psql_db -c "select jobname, schedule, active from cron.job order by jobid"


info "comparaison avec les comptes du Cloud (au moment de l'export)"
diff=$(awk -F'\t' '{ split($1, p, "."); printf "%sselect %s t, %s::bigint attendu, (select count(*) from \"%s\".\"%s\") trouve\n", (NR > 1 ? "union all " : ""), "'\''" $1 "'\''", $2, p[1], p[2] }' "$DUMPS/comptes.tsv" |
  { echo "select format('%-40s attendu %10s  trouvé %10s', t, attendu, trouve) from ("; cat; echo ") x where attendu <> trouve order by t;"; } | psql_db -tA)
if [ -z "$diff" ]; then ok "$(wc -l < "$DUMPS/comptes.tsv") tables identiques"
else avert "écarts (normaux pour les tables écrites pendant l'export si le moteur Cloud tournait) :"; echo "$diff"; fi
ok "restauration terminée en $(( $(date +%s) - t0 )) s"
