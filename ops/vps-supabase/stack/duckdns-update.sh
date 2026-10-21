#!/bin/sh
# Met à jour le sous-domaine DuckDNS de l'API d'Aurelys avec l'adresse IPv4 publique du VPS.
# Cron toutes les 5 minutes (voir INTEGRATION-VPS.md) :
#   */5 * * * * root /chemin/duckdns-update.sh >> /var/log/aurelys-duckdns.log 2>&1
# Fichier du jeton (chmod 600, une seule ligne : le jeton DuckDNS) : DUCKDNS_TOKEN_FILE, /etc/aurelys/duckdns.token par défaut.
# Sous-domaine (sans .duckdns.org) : DUCKDNS_DOMAIN, ou deuxième ligne du fichier du jeton.
set -eu
f="${DUCKDNS_TOKEN_FILE:-/etc/aurelys/duckdns.token}"
[ -r "$f" ] || { echo "$(date -u +%FT%TZ) ÉCHEC : jeton DuckDNS illisible ($f)"; exit 1; }
case "$(stat -c %a "$f")" in 600|400) ;; *) echo "$(date -u +%FT%TZ) ÉCHEC : $f doit être en chmod 600"; exit 1;; esac
token=$(sed -n 1p "$f")
domain="${DUCKDNS_DOMAIN:-$(sed -n 2p "$f")}"
[ -n "$token" ] && [ -n "$domain" ] || { echo "$(date -u +%FT%TZ) ÉCHEC : jeton ou sous-domaine vide"; exit 1; }
# ip= vide : DuckDNS prend l'adresse d'où vient la requête. Jeton passé par un fichier de config curl, jamais
# sur la ligne de commande (visible dans la liste des processus).
r=$(printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' "$domain" "$token" | curl -4 -fsS -m 20 -K -)
[ "$r" = OK ] || { echo "$(date -u +%FT%TZ) ÉCHEC : DuckDNS a répondu « $r »"; exit 1; }
