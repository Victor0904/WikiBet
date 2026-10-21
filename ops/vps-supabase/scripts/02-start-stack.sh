#!/usr/bin/env bash
# Lance seulement les 6 services utiles (db api-gw auth rest realtime functions) et attend qu'ils soient en bonne santé.
# Idempotent : relancé, il ne recrée que ce qui a changé.  --dry-run : montre la commande.
. "$(dirname "$0")/_commun.sh"
charger_env
grep -q '^API_DOMAIN=CHANGER' "$STACK/.env" && avert "API_DOMAIN n'est pas encore fixé (sans gêne pour un essai local)"
[ -d "$STACK/$FUNCTIONS_SRC/aurelys" ] || [ -d "$FUNCTIONS_SRC/aurelys" ] || echec "fonction aurelys introuvable dans FUNCTIONS_SRC=$FUNCTIONS_SRC"
# Les fichiers montés dans le conteneur db ne doivent pas être modifiables par d'autres.
run chmod 600 "$STACK/.env"

t0=$(date +%s)
info "démarrage : ${SERVICES[*]}"
run dc up -d --wait --wait-timeout 300 "${SERVICES[@]}"
[ "$DRY" = 1 ] && exit 0
dc ps --format 'table {{.Service}}\t{{.Status}}'
# GoTrue crée le schéma auth au premier démarrage : 03-restore.sh en a besoin.
n=$(sql1 "select count(*) from auth.schema_migrations" 2>/dev/null || echo 0)
[ "$n" -gt 0 ] || echec "le schéma auth n'est pas encore créé par GoTrue (dc logs auth)"
ok "stack prête en $(( $(date +%s) - t0 )) s (migrations GoTrue : $n), gateway sur 127.0.0.1:$API_GW_PORT"
