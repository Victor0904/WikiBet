# Fonctions partagées par les scripts numérotés (chargé par « . _commun.sh », jamais lancé seul).
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash (Windows) : ne pas transformer les chemins passés à Docker

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # ops/vps-supabase
STACK="$ICI/stack"
DUMPS="${DUMPS:-$ICI/dumps}"
CLOUD_REF=urivyzajsfcbtbfrvjcs
SERVICES=(db api-gw auth rest realtime functions)

DRY=0
for a in "$@"; do [ "$a" = --dry-run ] && DRY=1; done

info() { printf '\033[1m→ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
avert() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
echec() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
# Commande exécutée, ou seulement affichée en --dry-run.
run() { if [ "$DRY" = 1 ]; then echo "[simulation] $*"; else "$@"; fi; }

# Chemin lisible par Python sous Windows (Git Bash) comme sous Linux.
chemin() { cygpath -w "$1" 2>/dev/null || echo "$1"; }
py() { export PYTHONUTF8=1; if python3 -c '' 2>/dev/null; then python3 "$@"; else python "$@"; fi; }
dc() { (cd "$STACK" && docker compose "$@"); }

charger_env() {
  [ -f "$STACK/.env" ] || echec "stack/.env absent : lance d'abord scripts/00-gen-secrets.sh"
  set -a; . "$STACK/.env"; set +a
}

# psql dans le conteneur db. Superutilisateur supabase_admin (session_replication_role, propriétaires) ;
# PGUSER_SQL=postgres pour ce qui doit appartenir à postgres (jobs pg_cron).
psql_db() { dc exec -T db psql -X -q -U "${PGUSER_SQL:-supabase_admin}" -d postgres -v ON_ERROR_STOP=1 "$@"; }
# Une valeur, sans alignement.
sql1() { psql_db -tA -c "$1"; }
