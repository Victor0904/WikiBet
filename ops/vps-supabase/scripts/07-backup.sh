#!/usr/bin/env bash
# Sauvegarde quotidienne de la base d'Aurelys sur le VPS (remplace ops/aurelys-backup/backup.sh après la bascule,
# voir ops-backup.diff). pg_dump dans le conteneur db (plus de Session pooler ni de mot de passe à part).
# Schémas public (le jeu) et auth (les comptes), ticks non journalisés exclus (le moteur les recrée).
# 14 jours gardés dans BACKUP_DIR (ops/vps-supabase/sauvegardes/ par défaut), chmod 600 : hash de mots de passe.
# Cron (voir INTEGRATION-VPS.md) : 30 3 * * * root <INSTALL_DIR>/scripts/07-backup.sh >> <INSTALL_DIR>/sauvegardes/backup.log 2>&1
#   --test     restaure la dernière sauvegarde dans un Postgres jetable et compte les lignes clés
#   --dry-run  montre ce qui serait fait
# Les secrets du Vault ne sont pas dans la sauvegarde : garder stack/.env (TICK_SECRET) hors du serveur.
. "$(dirname "$0")/_commun.sh"
B="${BACKUP_DIR:-$ICI/sauvegardes}"
TEST=0; for a in "$@"; do [ "$a" = --test ] && TEST=1; done
mkdir -p "$B"; chmod 700 "$B"
horo() { date -u +%FT%TZ; }

if [ "$TEST" = 0 ]; then
  # Moins de 2 Go libres : pas de sauvegarde, pour ne pas remplir le VPS (les autres projets en dépendent).
  libre=$(df -Pm "$B" | awk 'NR == 2 { print $4 }')
  [ "$libre" -ge 2048 ] || { echo "$(horo) ÉCHEC : seulement $libre Mo libres (2 048 au moins), pas de sauvegarde"; exit 1; }
  f="aurelys-$(date -u +%Y%m%d-%H%M).dump"
  if [ "$DRY" = 1 ]; then echo "[simulation] pg_dump -Fc -n public -n auth vers $B/$f, puis rotation à 14 jours"; exit 0; fi
  umask 077
  dc exec -T db pg_dump -U supabase_admin -d postgres -Fc -n public -n auth --no-unlogged-table-data > "$B/$f.part"
  mv "$B/$f.part" "$B/$f"
  find "$B" -name 'aurelys-*.dump' -mtime +13 -delete
  find "$B" -name '*.part' -mmin +120 -delete
  echo "$(horo) ok $f $(du -h "$B/$f" | cut -f1)"
  exit 0
fi

f=$(ls -1t "$B"/aurelys-*.dump 2>/dev/null | head -1) || true
[ -n "$f" ] || echec "aucune sauvegarde dans $B"
[ "$DRY" = 1 ] && { echo "[simulation] restauration de $f dans un postgres:17-alpine jetable"; exit 0; }
c=aurelys-restore-test
docker rm -f $c >/dev/null 2>&1 || true
trap 'docker rm -f $c >/dev/null 2>&1 || true' EXIT
docker run -d --name $c -e POSTGRES_PASSWORD=jetable postgres:17-alpine >/dev/null
until docker exec $c pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done
# Rôles de Supabase cités par les droits et les politiques.
for r in anon authenticated service_role authenticator supabase_admin supabase_auth_admin dashboard_user; do
  docker exec $c psql -U postgres -qc "create role $r" >/dev/null
done
docker exec -i $c sh -c 'cat > /tmp/d.dump' < "$f"
docker exec $c pg_restore -U postgres -d postgres --no-owner /tmp/d.dump > "$B/restore-test.err" 2>&1 || true
echo "sauvegarde testée : $f"
docker exec $c psql -U postgres -tA -F ' : ' -c "
  select 'joueurs', count(*) filter (where not bot) from public.profiles
  union all select 'bots', count(*) filter (where bot) from public.profiles
  union all select 'paris', count(*) from public.bets
  union all select 'comptes (auth.users)', count(*) from auth.users
  union all select 'XP (xp_log)', count(*) from public.xp_log
  union all select 'bougies', count(*) from public.aur_candles"
echo "messages d'erreur de pg_restore : $(grep -c 'error' "$B/restore-test.err" || true) (détail : $B/restore-test.err)"
