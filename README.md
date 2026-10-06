# Wiki-Bourse

> La version en ligne, multijoueur (React, Supabase, Vercel), est dans [`web/`](web/README.md). Ce qui suit décrit l'ancien prototype solo, gardé à la racine comme référence.

Une appli de paris fictive sur l'attention que reçoit Wikipédia. Chaque article est un « match » en direct. Tu prends position à la hausse ou à la baisse, avec un levier, et tu gagnes en proportion de la variation du cours, comme un trade en crypto. Les duels du jour se jouent avec des cotes et se règlent sur les vraies vues Wikipédia.

C'est un prototype en HTML, CSS et JavaScript, sans dépendance ni étape de build.

## Lancer le jeu

Double-clique sur `index.html`. Le jeu s'ouvre dans le navigateur, il n'a pas besoin de serveur.

Pour tester sur un téléphone branché au même Wi-Fi :

```bash
python -m http.server 8000
# puis ouvre http://<ip-de-ton-pc>:8000 sur le téléphone
```

## Rafraîchir les données

```bash
python scripts/fetch_pageviews.py            # 90 derniers jours jusqu'à hier
python scripts/fetch_pageviews.py --days 120
```

Le script prend la liste d'articles dans `scripts/articles.json` et interroge l'API Wikimedia Pageviews, une requête par article avec une pause entre deux. Il réécrit ensuite `data/pageviews.js`. Le jeu rejoue toujours les 30 dernières séances des données.

Avant de le lancer la première fois, mets ton e-mail dans `USER_AGENT` en haut du script. Wikimedia le demande.

Pour ajouter un article, ajoute une ligne dans `scripts/articles.json` puis relance le script. Le `title` est le titre exact de l'article sur fr.wikipedia.org, avec des `_` à la place des espaces.

## Structure

```
index.html              structure des écrans
style.css               thème, mise en page mobile puis grand écran
app.js                  moteur de marché, cotes, paris, séances, rendu
data/pageviews.js       données chargées par le jeu (générées)
scripts/articles.json   liste des articles cotés
scripts/fetch_pageviews.py
CLAUDE.md               contexte et règles pour Claude Code
```

## Ce qui est réel, ce qui est simulé

Sont réels les vues quotidiennes, le cours de clôture de chaque séance (`√ vues ÷ 2`), donc les variations d'une séance à l'autre, et les résultats des duels.

Le mouvement minute par minute entre deux clôtures est simulé : un pont brownien déterministe qui finit exactement sur la vraie clôture. Les positions fermées avant 17 h 30 reposent donc sur du simulé. Les cotes des duels sortent d'une formule maison et les bots de la ligue ne parient pas vraiment.

L'onglet Ligue montre la courbe de ton solde à chaque clôture, à côté de celles des bots.

La monnaie est fictive et ne peut pas s'acheter. Les données de pages vues sont sous licence CC0, les textes Wikipédia sous CC BY-SA.
