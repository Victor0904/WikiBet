# Bascule de Supabase Cloud vers le VPS, pas à pas

Chemins relatifs au dossier d'installation sur le VPS (`<INSTALL_DIR>`, qui contient `stack/` et `scripts/`).
Les commandes SQL « Cloud » se tapent dans Supabase → SQL Editor du projet `urivyzajsfcbtbfrvjcs`.

## Avant le jour J (sans coupure)

- [ ] **Front** : appliquer `scripts/front-storagekey.diff` (`git apply ops/vps-supabase/scripts/front-storagekey.diff`),
      `npm test`, pousser. Sans effet tant que l'adresse est celle du Cloud ; indispensable ensuite, sinon chaque joueur
      perd sa session (et une partie anonyme, sans mot de passe ni Discord, est alors perdue pour lui).
- [ ] **VPS** prêt selon `INTEGRATION-VPS.md` : DuckDNS à jour, reverse proxy, `https://<API_DOMAIN>/auth/v1/health`
      répond (401 sans clé, c'est normal), unité systemd installée.
- [ ] `stack/.env` complet : `00-gen-secrets.sh --jwt-cloud` (garde les sessions), puis à la main API_DOMAIN, API_GW_PORT,
      DISCORD_CLIENT_ID, DISCORD_SECRET, TURNSTILE_SECRET, VAPID_PRIVATE, SITE_URL, ADDITIONAL_REDIRECT_URLS.
- [ ] **Discord** (portail développeur → l'application → OAuth2 → Redirects) : **ajouter**
      `https://<API_DOMAIN>/auth/v1/callback`, sans retirer l'adresse du Cloud (retour arrière).
- [ ] `cloud.env` (PGURL, PGPASSWORD du Session pooler) posé à côté de `scripts/`, chmod 600.
- [ ] **Répétition sur le VPS**, sans toucher à Vercel : `01` → `02` → `03` → `04` → `05` tous verts. Le moteur du VPS
      tourne alors sur une copie : sans effet pour les joueurs. Puis repartir de zéro :
      `cd stack && docker compose down && rm -rf volumes/db/data` (le volume `db-config` peut rester).

## Jour J (indisponibilité attendue : 15 à 25 min)

1. [ ] Prévenir les joueurs (Discord, bandeau) quelques minutes avant.
2. [ ] **Cloud : mettre le moteur en pause** (réversible, les jobs restent définis) :
       `select cron.alter_job(jobid, active := false) from cron.job;`
       Le marché se fige : les ordres sont refusés (« cours de plus de 30 s »), plus rien ne s'écrit.
3. [ ] `scripts/01-export-cloud.sh` (2 à 5 min selon la taille de la base).
4. [ ] `scripts/02-start-stack.sh`, puis `scripts/03-restore.sh` : il demande la valeur des secrets Vault autres
       que `aurelys_tick` (pris dans TICK_SECRET). Les comptes doivent être identiques (« tables identiques »).
5. [ ] `cd stack && docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < ../scripts/04-post-migration.sql`
6. [ ] Attendre 1 à 2 min (premiers passages du moteur et de settle), puis `scripts/05-smoke-tests.sh`
       et `scripts/05-smoke-tests.sh --url https://<API_DOMAIN>` : tout vert.
   - [ ] **Nouvelle paire VAPID** (la clé privée du Cloud est perdue) : `git apply ops/vps-supabase/scripts/vapid-public.diff`
         (clé publique dans `web/src/api.js` et la fonction `aurelys`), pousser, mettre à jour la copie `FUNCTIONS_SRC` du VPS,
         `docker compose restart functions`. Le redéploiement de l'étape 8 emporte le front. Les joueurs réactivent les notifications.
7. [ ] **Vercel** → projet → Settings → Environment Variables, environnements Production et Preview :
       - `VITE_SUPABASE_URL` = `https://<API_DOMAIN>`
       - `VITE_SUPABASE_ANON_KEY` = `ANON_KEY` de `stack/.env` (`grep ^ANON_KEY= stack/.env | cut -d= -f2-`)
       - `VITE_TURNSTILE_SITE_KEY` : inchangée.
       Noter les anciennes valeurs avant de les remplacer (retour arrière).
8. [ ] **Redéployer** (Deployments → dernier déploiement de production → Redeploy) : Vite inscrit ces variables au build,
       un simple changement de variable ne suffit pas.
9. [ ] **Tests à la main** sur https://aurelys-trade.vercel.app (et en navigation privée) :
       - [ ] un navigateur déjà connecté avant la bascule retrouve sa partie (session gardée) ;
       - [ ] nouvelle partie sans compte : captcha, choix du pseudo, marché qui bouge (cours toutes les secondes) ;
       - [ ] inscription pseudo + mot de passe, déconnexion, reconnexion ;
       - [ ] connexion avec Discord, et « Sauvegarder avec Discord » depuis une partie anonyme ;
       - [ ] ouvrir une position, la clôturer ; acheter puis vendre une action du portefeuille ;
       - [ ] le solde se met à jour seul (temps réel), le classement s'affiche, les actualités arrivent ;
       - [ ] stop / objectif sur une position ; notification de liquidation si VAPID_PRIVATE est posé.
10. [ ] **Validé : couper définitivement le moteur Cloud**, pour qu'un seul moteur tourne :
        `select cron.unschedule(jobid) from cron.job;`
        (leurs définitions d'origine restent dans `dumps/cron_jobs.sql`).
11. [ ] Sauvegardes : installer le cron de `scripts/07-backup.sh` (voir INTEGRATION-VPS.md), le lancer une fois puis
        `scripts/07-backup.sh --test`. Retirer `/etc/cron.d/aurelys-backup` (il sauvegarderait l'ancienne base figée).
12. [ ] Garder le projet Cloud tel quel (pas supprimé) au moins 2 semaines.

## Retour arrière

À tout moment avant l'étape 10, en 5 minutes :

1. Vercel : remettre les anciennes valeurs de `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`, redéployer.
2. Cloud : relancer le moteur : `select cron.alter_job(jobid, active := true) from cron.job;`
3. VPS : arrêter le moteur de la copie : `cd stack && docker compose stop` (ou `systemctl stop aurelys-supabase`).

Après l'étape 10, les jobs Cloud sont à recréer : coller dans le SQL Editor du Cloud le fichier `dumps/cron_jobs.sql`
**tel quel** (c'est l'export d'origine : adresses du Cloud, jamais la version réécrite par 03-restore.sh).

Ce qui a été joué sur le VPS entre la bascule et le retour arrière est perdu pour les joueurs (le Cloud repart de
l'instant de l'export). Pour le garder, il faudrait refaire la procédure dans l'autre sens : à décider avant.
