# Wiki-Bourse en ligne

Tous les joueurs prennent position sur les mêmes cours, au même moment. Une séance dure 10 minutes de jeu (9:00 → 17:30 en heure de marché), suivie d'une minute de pause pour les résultats, puis la suivante démarre.

## Essayer tout de suite (mode démo)

```bash
npm install
npm run dev
```

Sans clés Supabase, le jeu tourne en **mode démo locale** : la vraie base SQL tourne dans le navigateur (PGlite) avec un seul joueur. Les règles sont celles de la version en ligne.

## Mettre en ligne (Supabase + Vercel)

1. **Supabase** : crée un projet sur supabase.com.
2. **Base** : connecte le dépôt GitHub au projet (*Project Settings → Integrations → GitHub*). Indique `web/supabase` comme dossier Supabase, active le déploiement en production sur la branche `main`. Les migrations de `web/supabase/migrations/` s'appliquent alors à chaque push. Sans l'intégration : dans *SQL Editor*, colle `supabase/migrations/20261006000000_init.sql` et lance-le. Si pg_cron est indisponible, active l'extension *pg_cron* dans *Database → Extensions* puis relance le dernier bloc du fichier.
3. **Connexion** : dans *Authentication → Sign In / Providers*, active **Anonymous sign-ins**. Les joueurs n'ont qu'un pseudo à choisir.
4. **Clés** : copie `.env.example` en `.env.local` et remplis-le depuis *Project Settings → API* (URL, clé `anon`, clé `service_role`).
5. **Données** : `npm run seed` envoie les articles, les vues, les cours minute par minute et les duels.
6. **Vercel** : importe le dépôt, choisis `web` comme *Root Directory*, ajoute `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans les variables d'environnement, puis déploie. Vercel reconnaît Vite tout seul. Sans dépôt Git, `npx vercel` depuis ce dossier fait la même chose.

Ne mets jamais la clé `service_role` dans Vercel ni dans le code du front : elle contourne toutes les règles d'accès.

## Comment c'est construit

- `src/engine.js` : le moteur, partagé par le front, le seed et les tests. Il calcule l'horloge des séances, les cours minute par minute (pont brownien seedé) et les duels. Tout est déterministe.
- `supabase/migrations/20261006000000_init.sql` : tables, règles d'accès (RLS) et fonctions de jeu. **La base fait foi** : ouvrir, clôturer et régler un pari passe par des fonctions SQL qui lisent l'heure du serveur. Un joueur ne peut ni modifier son solde ni voir les paris des autres.
- `src/api.js` : appels Supabase et temps réel (classement et paris). `src/demo.js` : la même interface avec PGlite.
- `src/App.jsx`, `src/charts.jsx`, `src/styles.css` : l'interface.

## Tests

```bash
npm test
```

Les tests lancent la vraie migration dans PGlite et vérifient plusieurs points : l'horloge SQL et le moteur JS tombent sur la même minute ; l'ouverture et la clôture se font au bon cours ; la liquidation arrive à la bonne minute ; le règlement de fin de séance est correct (échéances, duels, salaire unique) ; la RLS empêche de toucher à son solde ; on ne peut pas parier pendant la pause.

## Rafraîchir les données

```bash
python ../scripts/fetch_pageviews.py
npm run seed
```
