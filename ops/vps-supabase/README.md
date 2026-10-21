# Migration de la base d'Aurelys : Supabase Cloud → Supabase allégé sur le VPS

Pourquoi : le projet Cloud `urivyzajsfcbtbfrvjcs` (Nano, plan Free) sature (Disk IO épuisé, 503/504, réponses à 200 s).
Même code applicatif, plus aucune limite ni dépendance à Supabase Cloud. **Rien n'est déployé** : tout est prêt ici.

## Ce que l'app utilise vraiment (vérifié dans le code)

La liste de départ était presque juste, avec une correction de taille :

- **Edge Function `aurelys` indispensable.** C'est le moteur du marché : pg_cron l'appelle toutes les 20 s par pg_net,
  avec le secret Vault `aurelys_tick`. Elle traite aussi les ordres du jeu (ouvrir, clôturer, acheter, vendre :
  `aurOrder` dans `web/src/api.js`), l'inscription par mot de passe (`register`) et le texte des notifications push
  (`push_info`, appelé par `public/sw.js`). La stack compte donc **6 services** : db, api-gw, auth, rest, realtime **et
  functions**. Sans eux, le marché s'arrête et plus aucun ordre ne passe.
- PostgREST : tables et RPC (`aur_feed`, `aur_history`, `aur_rumor_list`, `my_referrals`, `leaderboard`…), RLS.
- pg_cron, 5 jobs : moteur (20 s), `settle()` (chaque minute), ménage des journaux (chaque heure), bots et parties
  anonymes (chaque nuit). pg_net (installé dans `public` sur le Cloud). Vault : un seul secret, `aurelys_tick`.
- Auth : parties anonymes (`signInAnonymously`, indispensable), pseudo + mot de passe (adresse interne
  `<id>@joueurs.aurelys.invalid`, déjà confirmée), Discord (connexion et `linkIdentity`, d'où
  `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED`), **captcha Cloudflare Turnstile** sur la connexion anonyme et par mot de passe.
- Realtime : `postgres_changes` sur `profiles` et `bets` (sa ligne seulement).
- Ni Storage ni GraphQL. Fonctions `twitch-poll` et `steam-poll` abandonnées (crons retirés), non montées.

## Parcours qui dépendent d'un e-mail

**Aucun.** Le front n'appelle ni mot de passe oublié, ni lien magique, ni OTP, ni changement d'e-mail
(`resetPasswordForEmail`, `signInWithOtp`, `verifyOtp`, `updateUser({ email })` : absents de `web/src`).
L'e-mail facultatif de Mon compte (`set_login_email`) n'est qu'un identifiant de connexion, jamais vérifié et sans envoi.
Seul reste un message d'erreur inatteignable (« Confirme d'abord ton e-mail », impossible avec l'auto-confirmation).
Sans SMTP, rien ne change pour les joueurs.

## Ordre d'exécution

Tout se lance depuis `ops/vps-supabase/` (sur le VPS : `<INSTALL_DIR>`). Chaque script accepte `--dry-run`.

| Étape | Commande | Durée mesurée (répétition) |
|---|---|---|
| Secrets | `scripts/00-gen-secrets.sh --jwt-cloud`, puis compléter `stack/.env` | 1 s + saisie |
| Export Cloud (lecture seule) | `scripts/01-export-cloud.sh` | 28 s |
| Démarrage | `scripts/02-start-stack.sh` | 50 à 75 s (+ 3 à 5 min de téléchargement des images la 1re fois) |
| Restauration | `scripts/03-restore.sh` | 45 s |
| Index et ménage | `cd stack && docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < ../scripts/04-post-migration.sql` | 1 s |
| Vérification | `scripts/05-smoke-tests.sh` (puis `--url https://<API_DOMAIN>`) | 10 s |
| Bascule | `scripts/06-cutover-checklist.md` | voir ci-dessous |
| Sauvegarde | `scripts/07-backup.sh` (cron), `scripts/07-backup.sh --test` | 4 s, test 12 s |

**Indisponibilité attendue pendant la bascule : 10 à 20 min**, entre la pause du moteur Cloud et la fin du
redéploiement Vercel (export 0,5 min, restauration 1 min, vérifications 2 min, variables et build Vercel 3 à 5 min,
tests à la main). Le marché est figé pendant ce temps ; au redémarrage, le moteur rattrape les minutes manquées.

## Ce que tu dois fournir

- **DuckDNS** : le sous-domaine (`<nom>.duckdns.org`) et son jeton.
- **Discord** : l'ID client et le secret de l'application (ceux du Cloud conviennent), et **ajouter** sur le portail
  Discord (OAuth2 → Redirects) la nouvelle adresse de retour `https://<API_DOMAIN>/auth/v1/callback`.
- **Turnstile** : la clé secrète (Cloudflare → Turnstile → le site). La clé de site du front ne change pas.
- **VAPID_PRIVATE** : la clé privée des notifications de liquidation (JWK). Supabase ne la réaffiche pas : il faut
  ta copie. Sans elle, pas de notification push, le reste fonctionne.
- **Legacy JWT secret** du Cloud (Settings → JWT Keys), saisi par `00-gen-secrets.sh --jwt-cloud` : les sessions
  ouvertes restent valides après la bascule. Sans lui, un joueur dont le jeton (1 h) n'a pas expiré est déconnecté ;
  pour une partie anonyme, c'est la partie perdue. Vérifier d'abord que le projet signe encore ses jetons avec ce secret
  (et non avec une clé asymétrique).
- **Secrets Vault** : rien à fournir. Le seul secret, `aurelys_tick`, est refait (`TICK_SECRET`), côté fonction et
  côté Vault à la fois.
- **Session pooler** : `cloud.env` (PGURL, PGPASSWORD), comme `ops/aurelys-backup/env.example`.
- **Adresses de retour** : Site URL et Redirect URLs du Cloud (Authentication → URL Configuration), si elles
  diffèrent de `https://aurelys-trade.vercel.app`.

## Contenu

```
INTEGRATION-VPS.md          pour la session qui refond le VPS (ports, volumes, proxy, crons, placeholders)
stack/docker-compose.yml    compose officiel, copié sans modification (supabase/supabase@9ac3f4d78b48888226405bbf08e4339f430a8427,
                            dossier docker/, 2026-10-21) ; images épinglées par tag dedans
stack/volumes/              fichiers officiels du même commit (init de la base, envoy, routeur des fonctions)
stack/docker-compose.override.yml   ajouts d'Aurelys (port local, Discord, captcha, linking, fonctions, en-tête X-Real-IP)
stack/.env.template         toutes les variables, commentées, sans secret
stack/Caddyfile.snippet, nginx.conf.snippet, duckdns-update.sh, aurelys-supabase.service
scripts/00 … 07             scripts idempotents, messages en français ; _commun.sh : fonctions partagées
scripts/front-storagekey.diff   changement du front indispensable avant la bascule (voir plus bas)
scripts/ops-backup.diff     ce qui change dans ops/aurelys-backup/backup.sh (remplacé par 07-backup.sh)
```

Ignorés par git : `stack/.env`, `cloud.env`, `dumps/`, `sauvegardes/`, `stack/volumes/db/data/`.
Mettre à jour la stack : reprendre `docker/docker-compose.yml` et `docker/volumes/` d'un commit plus récent de
supabase/supabase, sans toucher à l'override, puis `scripts/02-start-stack.sh`.

## Un changement du front indispensable

supabase-js range la session sous une clé dérivée de l'adresse de l'API (`sb-urivyzajsfcbtbfrvjcs-auth-token`).
Avec la nouvelle adresse, la clé change : chaque joueur repartirait sur une partie anonyme neuve et perdrait la sienne
s'il n'a ni mot de passe ni Discord. `scripts/front-storagekey.diff` fixe la clé à l'ancienne valeur (3 lignes dans
`web/src/api.js`). Sans effet tant que l'adresse est celle du Cloud : il peut partir avant la bascule.

## Après la bascule

- Fonction `aurelys` : `npm run fn:deploy` vise le Cloud. Sur le VPS : copier `web/supabase/functions/`, puis
  `docker compose restart functions`.
- Migrations : `npm run db:push` vise le Cloud. Sur le VPS : `docker compose exec -T db psql -U postgres -d postgres
  -v ON_ERROR_STOP=1 < migration.sql`, après `npm test` (règle des tests verts inchangée).
- Les règles de `CLAUDE.md` qui citent ces commandes sont à mettre à jour le jour de la bascule.

## Répétition locale du 21 octobre 2026 (Docker Desktop sur le PC)

Déroulé complet sur les vraies données : 00 → 02 → 01 (lecture seule) → 03 → 04 → 05 → 07, plus un parcours joueur
de bout en bout avec supabase-js (partie anonyme, pseudo, ouverture et clôture d'une position, achat, solde reçu en
temps réel, inscription par mot de passe, reconnexion) : tout vert, **77 tables identiques au Cloud**.
Non testés en local : Discord et Turnstile (secrets réels nécessaires), HTTPS et proxy (propres au VPS).

Ce qui a cassé, et la correction :

1. **GoTrue refusait de démarrer** : `SMTP_PORT` vide (« converting '' to type int »). → `SMTP_PORT=587` dans le
   modèle ; `SMTP_HOST` reste vide, donc aucun envoi.
2. **`docker compose --project-directory` ne trouvait pas le compose.** → les scripts font `cd stack` avant compose.
3. **Python sous Windows ne lisait pas les chemins `/c/…`** (00). → conversion par `cygpath` quand elle existe.
4. **Mot de passe du pooler refusé** : l'URL recopiée depuis le bouton « Connect » contenait le gabarit
   `[YOUR-PASSWORD]`, qui prime sur `PGPASSWORD`. → 01 retire ce gabarit de l'URL.
5. **Premiers passages du moteur en erreur (503)** : les jobs pg_cron démarraient avant le redémarrage de `rest`.
   → 03 redémarre auth et rest avant de reprogrammer les jobs.
6. **Moteur figé quelques minutes après la restauration** : l'horloge du PC retardait de 4 min, l'état du marché
   venu du Cloud était donc « dans le futur ». → aucun changement de code ; INTEGRATION-VPS.md exige un VPS synchronisé
   par NTP.
7. **Premier abonné temps réel servi en retard** (événements reçus au bout de plus de 10 s) : démarrage à froid de la
   chaîne de réplication de Realtime, une seule fois après son démarrage. → rien à corriger ; les essais suivants
   reçoivent l'événement immédiatement.
8. **`curl` de Windows ne lisait pas les chemins `/c/…`** (05). → réponses lues sur la sortie standard, sans fichier.
9. **05 s'arrêtait sans message** sur une réponse de plus de 300 octets (`head` coupait le tube, fatal avec
   `pipefail`). → découpage par bash, sans tube.

Pour finir, restauration refaite depuis une base vide avec les scripts définitifs : 02 (74 s) → 03 (43 s) → 04 → 05,
tout vert dès les premiers passages du moteur.

Mesures utiles : RAM ≈ 770 Mo au repos pour les 6 services ; sur la copie locale `aur_settle` ≈ 25 ms (180 ms sur
le Cloud), `aur_history(null, 180)` ≈ 17 ms (340 ms), `aur_rumor_list` ≈ 34 ms (245 ms) : la lenteur actuelle vient
du Nano saturé, pas d'index manquants. Index retenus et refusés : commentaires de `scripts/04-post-migration.sql`
(`aur_news (id desc)` refusé : sa clé primaire sert déjà, lue à l'envers).
