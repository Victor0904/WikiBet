#!/bin/sh
# Sauvegarde quotidienne de la base d'Aurelys (Supabase) par le Session pooler (IPv4), 14 sauvegardes gardées.
# Lancée chaque nuit par /etc/cron.d/aurelys-backup. Mot de passe dans .env (chmod 600), jamais ailleurs.
# Schémas public (le jeu) et auth (les comptes : profiles en dépend). Ticks non journalisés exclus (le moteur les recrée).
set -eu
cd "$(dirname "$0")"
set -a; . ./.env; set +a
: "${PGPASSWORD:?PGPASSWORD vide dans /opt/aurelys-backup/.env}"
mkdir -p dumps
# Disque presque plein (moins de 2 Go libres) : pas de sauvegarde, pour ne pas remplir le VPS (les autres projets
# en dépendent). Le message va dans backup.log (sortie du cron).
libre=$(df -Pm dumps | awk 'NR == 2 { print $4 }')
if [ "$libre" -lt 2048 ]; then echo "$(date -u +%FT%TZ) ÉCHEC : seulement $libre Mo libres (2 048 au moins), pas de sauvegarde"; exit 1; fi
f="aurelys-$(date -u +%Y%m%d-%H%M).dump"
docker run --rm -e PGPASSWORD -v "$PWD/dumps:/dumps" postgres:17-alpine \
  pg_dump "$PGURL" -Fc -n public -n auth --no-unlogged-table-data -f "/dumps/$f.part"
mv "dumps/$f.part" "dumps/$f"
chmod 600 "dumps/$f"
find dumps -name 'aurelys-*.dump' -mtime +13 -delete
find dumps -name '*.part' -mmin +120 -delete
echo "$(date -u +%FT%TZ) ok $f $(du -h "dumps/$f" | cut -f1)"
