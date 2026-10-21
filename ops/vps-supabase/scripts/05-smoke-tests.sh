#!/usr/bin/env bash
# Vérifie la stack après 03 et 04 : santé d'auth, REST, RPC principales, fonction aurelys, temps réel, jobs pg_cron,
# settle() sans erreur, moteur (réponses de pg_net). Affiche la latence de chaque appel. Rien n'est écrit en base.
# Les appels se font au nom d'un bot (jeton de 5 min signé avec JWT_SECRET) : les RPC du jeu sont réservées aux
# joueurs connectés, et le captcha empêche ici une connexion anonyme.
#   --url https://API_DOMAIN   passer par le reverse proxy (défaut : http://127.0.0.1:API_GW_PORT)
#   --dry-run                  liste les vérifications
. "$(dirname "$0")/_commun.sh"
charger_env
BASE="http://127.0.0.1:$API_GW_PORT"
while [ $# -gt 0 ]; do case "$1" in --url) BASE="${2%/}"; shift;; esac; shift; done
if [ "$DRY" = 1 ]; then
  info "simulation : vérifications prévues sur $BASE"
  printf '  %s\n' auth/v1/health "rest/v1/aur_stocks" "rpc server_time, aur_feed, aur_history, aur_rumor_list, my_wealth" \
    "functions/v1/aurelys (action inconnue → 400)" "realtime/v1/websocket (101)" "cron.job, job_run_details, settle(), net._http_response"
  exit 0
fi

KO=0
ko() { printf '\033[31m✗ %s\033[0m\n' "$*"; KO=$((KO + 1)); }
uid=$(sql1 "select id from public.profiles order by bot desc, created_at limit 1" 2>/dev/null || true)
[ -n "$uid" ] || echec "aucun profil en base : lance d'abord 03-restore.sh"
TOKEN=$(UID_TEST="$uid" py -c '
import base64, hashlib, hmac, json, os, time
b = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
n = int(time.time())
h = b(b"{\"alg\":\"HS256\",\"typ\":\"JWT\"}")
p = b(json.dumps({"sub": os.environ["UID_TEST"], "role": "authenticated", "aud": "authenticated", "iss": "supabase", "iat": n, "exp": n + 300}).encode())
print(f"{h}.{p}." + b(hmac.new(os.environ["JWT_SECRET"].encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()))')

# appel NOM ATTENDU MÉTHODE CHEMIN [CORPS] : code HTTP et latence ; corps de la réponse dans $R.
appel() {
  local nom=$1 attendu=$2 m=$3 chemin=$4 corps=${5:-} out
  # Corps puis, sur la dernière ligne, code et durée (pas de fichier : le curl de Windows ne lit pas les chemins /c/…).
  out=$(curl -sS -m 30 -X "$m" -w '\n%{http_code} %{time_total}' "$BASE$chemin" \
        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' ${corps:+-d "$corps"}) || out=$'\n000 0'
  R=${out%$'\n'*}; R=${R:0:300}; out=${out##*$'\n'}
  local code=${out% *} ms; ms=$(awk -v s="${out#* }" 'BEGIN { printf "%d", s * 1000 }')
  if [ "$code" = "$attendu" ]; then ok "$(printf '%-34s %s %6s ms' "$nom" "$code" "$ms")"
  else ko "$(printf '%-34s %s %6s ms (attendu %s) : %s' "$nom" "$code" "$ms" "$attendu" "$R")"; fi
}
info "API sur $BASE (au nom du profil $uid)"
appel "auth/v1/health"               200 GET  /auth/v1/health
appel "rest/v1/aur_stocks"           200 GET  "/rest/v1/aur_stocks?select=tk&limit=1"
appel "rpc server_time"              200 POST /rest/v1/rpc/server_time '{}'
appel "rpc aur_feed"                 200 POST /rest/v1/rpc/aur_feed '{"p_since":null}'
appel "rpc aur_history (180 min)"    200 POST /rest/v1/rpc/aur_history '{"p_tk":null,"p_minutes":180}'
appel "rpc aur_rumor_list"           200 POST /rest/v1/rpc/aur_rumor_list '{}'
appel "rpc my_wealth"                200 POST /rest/v1/rpc/my_wealth '{}'
# Action inconnue : la fonction démarre, vérifie le jeton auprès de GoTrue, lit l'état du marché, puis refuse (400).
appel "functions/v1/aurelys"         400 POST /functions/v1/aurelys '{"action":"verification"}'
[[ "$R" == *"Marché indisponible"* ]] && ko "le moteur n'a pas encore écrit d'état utilisable (tick en échec ?)"

info "temps réel"
# La connexion reste ouverte après la poignée de main : curl s'arrête au bout de 3 s ; la latence est celle de la réponse 101.
ws=$(curl -sS -m 3 -o /dev/null -w '%{http_code} %{time_starttransfer}' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: QXVyZWx5czEyMzQ1Njc4OQ==' \
  "$BASE/realtime/v1/websocket?apikey=$ANON_KEY&vsn=1.0.0" 2>/dev/null || true)
ms=$(awk -v s="${ws#* }" 'BEGIN { printf "%d", s * 1000 }')
[ "${ws%% *}" = 101 ] && ok "$(printf '%-34s %s %6s ms' "realtime/v1/websocket" 101 "$ms")" || ko "realtime/v1/websocket : ${ws:-pas de réponse} (attendu 101)"

info "pg_cron et moteur"
psql_db -c "select jobname, schedule, active from cron.job order by jobid"
n=$(sql1 "select count(*) from cron.job where active")
[ "$n" -gt 0 ] && ok "$n job(s) actif(s)" || ko "aucun job pg_cron actif"
echecs=$(sql1 "select count(*) from cron.job_run_details where status = 'failed' and start_time > now() - interval '10 minutes'")
[ "$echecs" = 0 ] && ok "aucun échec de job en 10 min" ||
  { ko "$echecs échec(s) de job en 10 min :"; psql_db -c "select j.jobname, left(d.return_message, 120) message, d.start_time from cron.job_run_details d join cron.job j using (jobid) where d.status = 'failed' and d.start_time > now() - interval '10 minutes' order by d.start_time desc limit 5"; }
s=$(sql1 "select d.status || ' ' || to_char(d.end_time - d.start_time, 'SS.MS') || ' s, ' || to_char(d.start_time, 'HH24:MI:SS')
            from cron.job_run_details d join cron.job j using (jobid) where j.command ~ 'settle\(\)' order by d.start_time desc limit 1")
[[ "$s" == succeeded* ]] && ok "settle() : $s" || ko "settle() : ${s:-jamais lancé (attendre la minute suivante)}"
t=$(sql1 "select count(*) filter (where status_code = 200) || '/' || count(*) || ', ' || coalesce(max(status_code) filter (where status_code <> 200)::text, 'aucune erreur')
            from net._http_response where created > now() - interval '5 minutes'")
[[ "$t" =~ ^([0-9]+)/([0-9]+) ]] && [ "${BASH_REMATCH[1]}" -gt 0 ] && [ "${BASH_REMATCH[1]}" = "${BASH_REMATCH[2]}" ] &&
  ok "moteur : appels réussis en 5 min $t" ||
  { ko "moteur : appels réussis en 5 min $t"; psql_db -c "select status_code, left(coalesce(error_msg, content::text), 150) r, created from net._http_response order by id desc limit 3"; }

[ "$KO" = 0 ] && ok "tout est vert" || echec "$KO vérification(s) en échec"
