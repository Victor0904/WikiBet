#!/bin/sh
# Test de restauration : la dernière sauvegarde dans un Postgres jetable, puis comptage des lignes clés.
# Les erreurs sur les extensions propres à Supabase (pg_cron, pg_net, vault…) sont attendues : seules les données comptent.
set -eu
cd "$(dirname "$0")"
f=$(ls -1t dumps/aurelys-*.dump | head -1)
c=aurelys-restore-test
docker rm -f $c >/dev/null 2>&1 || true
trap 'docker rm -f $c >/dev/null 2>&1 || true' EXIT
docker run -d --name $c -e POSTGRES_PASSWORD=jetable postgres:17-alpine >/dev/null
until docker exec $c pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done
# Rôles de Supabase cités par les droits et les politiques.
for r in anon authenticated service_role authenticator supabase_admin supabase_auth_admin dashboard_user; do
  docker exec $c psql -U postgres -qc "create role $r" >/dev/null
done
docker cp "$f" $c:/tmp/d.dump
docker exec $c pg_restore -U postgres -d postgres --no-owner /tmp/d.dump > restore-test.err 2>&1 || true
echo "sauvegarde testée : $f"
docker exec $c psql -U postgres -tA -F ' : ' -c "
  select 'joueurs', count(*) filter (where not bot) from public.profiles
  union all select 'bots', count(*) filter (where bot) from public.profiles
  union all select 'paris', count(*) from public.bets
  union all select 'comptes (auth.users)', count(*) from auth.users
  union all select 'XP (xp_log)', count(*) from public.xp_log
  union all select 'bougies', count(*) from public.aur_candles"
echo "messages d'erreur de pg_restore : $(grep -c 'error' restore-test.err || true) (détail : restore-test.err)"
