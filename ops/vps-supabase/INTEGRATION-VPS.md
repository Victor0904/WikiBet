# Aurelys : ce que le VPS doit fournir à son Supabase allégé

Pour la session qui refond le VPS. Rien n'est encore installé ; la session Aurelys n'a rien touché sur le serveur.
Source : dépôt `Victor0904/WikiBet`, branche `migration-vps`, dossier `ops/vps-supabase/` (mode d'emploi : `README.md`).

## Ce que c'est

Base du jeu Aurelys (aujourd'hui sur Supabase Cloud) déplacée sur le VPS : stack officielle `supabase/supabase/docker`
copiée telle quelle, réduite à 6 services par `stack/docker-compose.override.yml`. Démarrage :
`docker compose up -d db api-gw auth rest realtime functions` (jamais un `up` sans liste : il lancerait studio, storage…).

| Service | Conteneur (nom fixé par le compose officiel) | Image | Port interne |
|---|---|---|---|
| db | `supabase-db` | supabase/postgres:17.6.1.136 | 5432 |
| api-gw | `supabase-envoy` (alias réseau `kong`, `envoy`) | envoyproxy/envoy:v1.39.1 | 8000 |
| auth | `supabase-auth` | supabase/gotrue:v2.197.0 | 9999 |
| rest | `supabase-rest` | postgrest/postgrest:v14.18 | 3000 |
| realtime | `realtime-dev.supabase-realtime` | supabase/realtime:v2.143.3 | 4000 |
| functions | `supabase-edge-functions` | supabase/edge-runtime:v1.77.4 | 9000 |

Ces noms de conteneurs doivent être libres : aucune autre stack Supabase sur la machine. Projet compose : `aurelys-supabase`.

## Ressources (mesurées pendant la répétition locale, base réelle de 138 Mo, moteur en marche)

- RAM : environ 770 Mo au repos (realtime 260, db 215, functions 140, rest 90, envoy 42, auth 14).
  **Prévoir 1,5 Go** avec la charge des joueurs. Pas de limite posée dans le compose.
- CPU : quelques % d'un cœur au repos, pointes au passage du moteur (toutes les 20 s) et de settle (chaque minute).
- Disque : 140 Mo de données Postgres aujourd'hui, + 8 Mo par sauvegarde quotidienne (14 gardées), + 2,5 Go d'images.
- Docker Compose **2.24.4 au moins** (balises `!reset` / `!override` de l'override).
- **Horloge synchronisée par NTP** (`timedatectl` : « System clock synchronized: yes »). Le moteur du marché suit l'heure
  du serveur : une horloge en retard le fige, une horloge en avance fait sauter des minutes au marché.
- Sortie vers internet : registre npm (premier démarrage des fonctions), api.open-meteo.com, odre.opendatasoft.com,
  calendrier.api.gouv.fr, services Web Push (Google, Apple, Mozilla), www.duckdns.org, challenges.cloudflare.com (Turnstile).

## Réseau et exposition

- **Seule exposition publique : `https://<API_DOMAIN>`** (sous-domaine DuckDNS, A → 2.24.43.73), en HTTPS Let's Encrypt,
  vers le gateway `127.0.0.1:<API_GW_PORT>`. WebSocket à laisser passer sur `/realtime/v1/` (connexions longues).
- Le reverse proxy doit **écraser** l'en-tête `X-Real-IP` avec l'adresse du client (limites par joueur de GoTrue,
  `GOTRUE_RATE_LIMIT_HEADER`). Sans lui, une limite de 30 parties anonymes par heure s'appliquerait à tout le site.
- **Ne jamais exposer** : Postgres (5432, aucun port publié, accès par `docker compose exec db`), auth, rest, realtime,
  functions (réseau Docker seulement), et le gateway lui-même sur 0.0.0.0. Pas de studio.
- Réseau Docker : `aurelys-supabase_default` (bridge créé par compose). Aucun réseau externe requis.
- **Le port 8000 est pris par Coolify** : choisir un autre `API_GW_PORT` libre (ex. 8100).
- Trois façons de servir `https://<API_DOMAIN>`, selon le proxy retenu :
  - Caddy : `stack/Caddyfile.snippet` ;
  - Nginx : `stack/nginx.conf.snippet` (WebSocket compris) ;
  - **Traefik de Coolify** (s'il garde 80/443) : ajouter au service `api-gw` d'un fichier compose propre au VPS :
    ```yaml
    services:
      api-gw:
        networks: [default, coolify]
        labels:
          - traefik.enable=true
          - traefik.docker.network=coolify
          - traefik.http.routers.aurelys-api.rule=Host(`<API_DOMAIN>`)
          - traefik.http.routers.aurelys-api.entrypoints=https
          - traefik.http.routers.aurelys-api.tls.certresolver=letsencrypt
          - traefik.http.services.aurelys-api.loadbalancer.server.port=8000
    networks:
      coolify:
        external: true
    ```
    (Traefik pose lui-même `X-Real-Ip` et passe le WebSocket ; le réseau `default` garde les alias `kong` / `envoy`.)
- Règle du VPS « nouveau projet = Coolify » : cette stack est prévue en `docker compose` manuel (6 services sur 12 du
  compose officiel, avec un override, et des scripts de restauration qui passent par `docker compose exec`). Non essayée
  dans Coolify. **À inscrire comme exception au registre (`/srv/projets/REGISTRE.md`), ou à adapter à Coolify :
  décision de Victor.**

## Installation (le jour venu)

1. Copier dans `<INSTALL_DIR>` (ex. `/opt/aurelys-supabase`) en gardant les chemins relatifs du dépôt :
   `ops/vps-supabase/` et `web/supabase/functions/` (le compose monte `aurelys/` et `_shared/` depuis ce dossier :
   variable `FUNCTIONS_SRC` de `stack/.env`, relative à `stack/` ou absolue).
2. `scripts/00-gen-secrets.sh --jwt-cloud`, puis compléter `stack/.env` (placeholders ci-dessous), `chmod 600`.
   Le script écrit aussi `JWT_JWKS` et `JWT_KEYS` à partir de `stack/cloud-jwks.json` (sessions ES256 du Cloud
   acceptées, voir « Sessions des joueurs » dans README.md). Le relancer si ce fichier change.
3. Unité systemd : `stack/aurelys-supabase.service`, remplacer `<INSTALL_DIR>` (dossier qui contient `stack/`),
   copier dans `/etc/systemd/system/`, `systemctl daemon-reload && systemctl enable aurelys-supabase`.
   Les conteneurs ont aussi `restart: unless-stopped`.
4. Ensuite seulement : procédure de `scripts/06-cutover-checklist.md` (session Aurelys ou Victor).

## Données

- PGDATA : **`<INSTALL_DIR>/stack/volumes/db/data`** (dossier monté, propriétaire l'utilisateur postgres du conteneur).
- Volume Docker `aurelys-supabase_db-config` : clé de chiffrement du Vault (pgsodium). **À sauvegarder avec le reste** :
  sans elle, les secrets du Vault d'une copie de PGDATA sont illisibles.
- Volume `aurelys-supabase_deno-cache` : cache des fonctions, jetable.
- Sauvegardes : `<INSTALL_DIR>/sauvegardes/` (chmod 700, fichiers 600, hash de mots de passe dedans).

## Crons système

```
# /etc/cron.d/aurelys-duckdns : sous-domaine DuckDNS à jour (jeton dans /etc/aurelys/duckdns.token, chmod 600 :
# ligne 1 le jeton, ligne 2 le sous-domaine sans .duckdns.org)
*/5 * * * * root <INSTALL_DIR>/stack/duckdns-update.sh >> /var/log/aurelys-duckdns.log 2>&1

# /etc/cron.d/aurelys-sauvegarde : base d'Aurelys chaque nuit, 14 jours gardés. À poser APRÈS la bascule, et retirer
# alors /etc/cron.d/aurelys-backup (ancienne sauvegarde par le pooler du Cloud).
30 3 * * * root <INSTALL_DIR>/scripts/07-backup.sh >> <INSTALL_DIR>/sauvegardes/backup.log 2>&1
```

## Placeholders à fixer

| Où | Nom | Valeur attendue |
|---|---|---|
| `stack/.env` | `API_DOMAIN` | `<nom>.duckdns.org`, sans `https://` |
| `stack/.env` | `API_GW_PORT` | port local libre (pas 8000, pris par Coolify), ex. 8100 |
| `stack/.env` | `FUNCTIONS_SRC` | chemin de `web/supabase/functions` (défaut `../../../web/supabase/functions`) |
| `stack/.env` | `SITE_URL`, `ADDITIONAL_REDIRECT_URLS` | `https://aurelys-trade.vercel.app`, `https://aurelys-trade.vercel.app/**` (fournis par Victor) |
| `stack/.env` | `DISCORD_CLIENT_ID`, `DISCORD_SECRET`, `TURNSTILE_SECRET`, `VAPID_PRIVATE` | fournis par Victor |
| `stack/.env` | `JWT_JWKS`, `JWT_KEYS` | écrits par `00-gen-secrets.sh` (JSON entre apostrophes), jamais à la main |
| `aurelys-supabase.service` | `<INSTALL_DIR>` | dossier qui contient `stack/` |
| `Caddyfile.snippet` / `nginx.conf.snippet` / labels Traefik | `<API_DOMAIN>`, `<API_GW_PORT>` | comme dans `stack/.env` |
| crons | `<INSTALL_DIR>` | idem |
| `/etc/aurelys/duckdns.token` | jeton + sous-domaine | fournis par Victor, chmod 600 |
