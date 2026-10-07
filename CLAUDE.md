# Wiki-Bourse — contexte pour Claude Code

## Le projet

Jeu web viral inspiré de WikiMasters : chaque article de Wikipédia en français a un cours qui suit son audience. Le joueur prend position à la hausse ou à la baisse avec un levier, comme un trade crypto, et parie sur des duels du jour (« qui fera le plus de vues ? »).

Deux versions cohabitent :

- **`web/` : la version en ligne, celle sur laquelle on travaille.** React + Vite, base Supabase (Postgres), déploiement Vercel. Tous les joueurs voient les mêmes cours au même moment. Sans clés Supabase, elle tourne en mode démo locale (PGlite dans le navigateur). Voir `web/README.md`.
- Racine (`index.html`, `style.css`, `app.js`, `data/pageviews.js`) : l'ancien prototype solo, statique, ouvrable par double-clic. Gardé comme référence tant que `web/` n'est pas en ligne ; ne plus le faire évoluer.

## Décisions validées par Victor

- Version en ligne sur **Supabase + Vercel**, React avec Vite (étape de build acceptée).
- Rythme : **10 min de jeu + 1 min de pause**, en continu. La séance k commence à `EPOCH + k × 11 min` (EPOCH = 1er janvier 2026 UTC). On voit en direct le coup d'envoi de la séance suivante.
- Style **mode trader, plus sombre** (choisi en octobre 2026, il remplace le thème nuit violette du prototype). Il avait rejeté plus tôt un « terminal de bourse » trop dense, pas mobile et fade : rester lisible sur téléphone, des cartes et des listes aérées, pas un tableau de bord surchargé.
- Gains comme un trade : valeur = `mise × (1 + levier × sens × variation)`, plancher 0, levier ×1/×5/×10, liquidation à 0. Les duels gardent des cotes.
- Positions sur les articles : **pas de choix de durée**. Elles restent ouvertes jusqu'à « Clôturer » ou jusqu'à la fin de la séance. Les anciennes échéances « 15 min / 1 h » étaient en heure de marché simulée (1 minute de jeu ≈ 1,2 s réelle) et trompaient le joueur. N'afficher aux joueurs que de vraies durées (l'heure de marché 9:00 → 17:30 reste un simple décor, étiqueté « marché »).
- Priorité au suivi en direct de ses positions : toujours visibles en tête (mobile) ou dans la colonne de gauche (grand écran), avec graphique et bouton « Clôturer ».
- Économie : 10 000 W au départ, salaire de 500 W par séance **où le joueur a parié** (sinon les absents s'enrichiraient à 130 séances par jour), faillite sous 2 000 W (retour à 10 000 W, compteur visible). **Pas d'achat de monnaie** (risque juridique type loot box) ; monétiser par du cosmétique ou des ligues privées pour streamers. Parrainage pas encore porté dans `web/`.
- Il accepte que l'intraday soit simulé tant que les clôtures et les duels sont réels.

## Architecture de `web/`

- `src/engine.js` : moteur partagé (front, seed, tests), sans dépendance.
  - Clôture du jour d : `√(vues[d]) ÷ 2`.
  - `pathOf(tk, d)` : cours minute par minute (T = 510 minutes de jeu) de la clôture d à d+1. Pont brownien seedé (`hashStr(tk) + d*9973`). Si |variation réelle| > 0,25 en log, 75 % du mouvement arrive d'un coup.
  - `session(now)` : séance k, jour de données `START + k mod 30`, minute de jeu `floor(off × T / PLAY_MS)`. Même calcul que `game_now()` en SQL : ne modifier l'un qu'avec l'autre.
  - Duels : paires d'audience proche (ratio < 3), probabilité selon `vues^0.85`, cote = 0,93 / p (min 1,08), premier duel boosté ×1,4 sur l'outsider, réglés sur `vues[d+1]`.
- `supabase/migrations/20261006000000_init.sql` : **la base fait foi.** Les cours sont stockés par `npm run seed` (tableau de 511 points par article et par jour, calculés par le moteur). Les joueurs n'écrivent rien directement (RLS). Tout passe par des fonctions `security definer` : `open_trade`, `close_trade`, `bet_duel`, `restart`, `create_profile`, `settle`. `settle()` tourne chaque minute (pg_cron) et à la demande des clients. Chaque règlement verrouille la ligne, donc pas de double paiement.
- `src/api.js` : Supabase (connexion anonyme + pseudo, comptes Apple / e-mail, temps réel sur `profiles` et sur mes `bets`, décalage d'horloge corrigé avec `server_time()`). `src/demo.js` : même interface sur PGlite.
- `tests/` : `npm test` lance la vraie migration dans PGlite (horloge, cours, liquidation, règlement, RLS, pause).
- Pas de bots : le classement réunit les vrais joueurs.
- **Comptes, classement des gains, amis, guildes** (migration `20261010000000_social.sql`, front `src/social.jsx`) :
  - On joue d'abord en anonyme. Dans Mon compte, la partie devient un vrai compte en liant Apple (`linkIdentity`) ou un e-mail (`updateUser`, lien de confirmation, puis mot de passe ; `user_metadata.pw` dit qu'il est choisi). Même identifiant : rien n'est perdu. Connexion : Apple ou e-mail et mot de passe, puis rechargement de la page. Se connecter depuis une partie anonyme la remplace.
  - À régler dans Supabase : fournisseur Apple (Services ID, clé de l'Apple Developer), « Allow manual linking », Site URL et Redirect URLs du site Vercel. La confirmation d'e-mail est active.
  - Gain d'un pari = paiement − mise − frais d'ouverture (`bet_gain`). Classements : du jour (depuis minuit, heure de Paris), total, patrimoine ; pour tous, mes amis ou ma guilde (`gains_board`).
  - Amis par pseudo : demande, puis acceptation (`friend_add` des deux côtés). Guildes ouvertes : 30 membres, une à la fois, sigle de 2 à 4 caractères, le fondateur peut exclure, le plus ancien membre lui succède. Classement des guildes = somme des gains de leurs membres actuels.
- **Marché Crypto, le marché principal** (choisi par Victor : « le plus vrai et réel ») : migration `20261008000000_crypto.sql`, fonction `supabase/functions/crypto`, front `src/crypto.js` et `src/CryptoUI.jsx`.
  - Prix réels de Coinbase, **paires en dollars** (migration `20261008120000_crypto_usd.sql`). Mesuré : en euros, la plupart des cryptos restaient figées (0 à 3 échanges en 30 s) ; en dollars, Bitcoin bouge environ 3 fois par seconde. 14 actifs : BTC, ETH, SOL, XRP, DOGE, ADA, AVAX, LINK, LTC, BCH, SUI, UNI, XLM, TIA. DOT, SHIB et ATOM sont désactivés (`crypto_assets.active`), mais gardés pour l'historique. Avant d'ajouter une crypto, mesurer son activité sur le flux Coinbase en dollars.
  - **Le prix d'un ordre vient du serveur**, jamais du joueur. La fonction `crypto` (actions `open` et `close`, avec le jeton du joueur) lit le ticker Coinbase, puis appelle `crypto_open` / `crypto_close`, que seule la clé serveur peut exécuter.
  - Frais de 0,1 % du montant engagé (mise × levier) à l'ouverture et à la clôture, d'où un avantage maison. Pas de clôture automatique.
  - Liquidation vérifiée chaque minute (action `poll` lancée par pg_cron) sur les vrais plus bas et plus hauts des bougies d'une minute (`crypto_candles`, 2 jours gardés).
  - L'écran lit les prix en direct par le WebSocket public Coinbase, rafraîchi toutes les 0,5 s, et les bougies par l'API REST. Fiche détaillée avec bougies de 1 min à 1 h.
  - En démo, le navigateur relève le prix lui-même.
  - Les simulateurs de trading en monnaie fictive sont un format courant ; rester sans achat de W, sans lots de valeur et sans promotion de courtier.
- **Bourse d'Aurelys** (conception : `bourse-aurelys.md`) : bourse fictive de 12 entreprises inventées, onglet Marché → Aurelys. Migration `20261009000000_aurelys.sql`, moteur `supabase/functions/_shared/aurelys.js` (partagé serveur, démo et écran), fonction `supabase/functions/aurelys`, front `src/aurelys.js` et `src/AurelysUI.jsx`.
  - 1 tick = 1 s réelle = 1 min d'Aurelys (jour de jeu = 24 min). Les prix naissent des ordres : 40 bots par action (fondamentalistes, suiveurs, contrariens, chartistes, bruit), teneurs de marché, baleines (Kraken, Orca, Léviathan, fonds souverain) et joueurs, avec impact en racine carrée (30 % permanent). Valeur fondamentale cachée, actualités (Poisson + gabarits, rumeurs confirmées ou démenties, résultats et Banque Centrale au calendrier), régimes de Markov, GARCH horaire, crises scénarisées, coupe-circuits, réalisateur de figures chartistes.
  - Calibré par simulation : diffusion ≈ σ cible en marché calme ; les nouvelles rendent la volatilité réalisée 2 à 3 fois plus forte (voulu). À l'annonce, les teneurs de marché font passer la moitié du choc d'un coup (`GAP`), le reste vient des ordres.
  - pg_cron appelle la fonction toutes les 10 s (à défaut : chaque minute, 75 s d'avance) ; elle simule jusqu'à maintenant + 20 s. Les cours à venir restent cachés : `aur_ticks` et `aur_state` sont illisibles, `aur_feed` s'arrête à `now()`, les nouvelles ne sont visibles qu'à leur heure. Le moteur doit rester déterministe (état en JSON, graine dans l'état).
  - Ordre : le serveur calcule l'impact de l'ordre (`slip`), `aur_open` / `aur_close` lisent le dernier cours en base. Frais 0,1 %, plafond 20 × liquidité par action (mise × levier), refus si cotation suspendue ou cours de plus de 30 s. Le flux de l'ordre entre dans la simulation au pas suivant (`aur_take_orders`).
  - En démo, le navigateur fait tourner la simulation tant que la page est ouverte.
- **Marché Steam** (migration `20261007120000_steam.sql`, fonction `supabase/functions/steam-poll`) : joueurs connectés sur 29 jeux, relevés chaque minute par l'API publique de Steam, sans clé. Un jeu est un sujet `steam:<appid>` dans `streamers` / `stream_ticks`, donc les questions Oui / Non s'appliquent telles quelles (onglet Steam = le même écran que Streamers, avec la source `steam`). `streamers_to_watch()` et le garde-fou de `twitch-poll` ignorent `steam:%`. Le seuil des questions est arrondi selon l'écart visé (puissance de 10 sous cet écart) et non plus selon la taille du nombre : sinon, 1,3 M de joueurs donnait un seuil 4 % au-dessus. Déploiement : `npx supabase functions deploy steam-poll --use-api`, puis `npx supabase db push`, lançables depuis cette machine.
- **QG du trader** (migration `20261007000000_qg.sql`, `src/QG.jsx`, `src/qg/scene.js`) : la boutique où dépenser ses W, choisie par Victor pour donner envie de dépenser.
  - Catalogue dans `shop_items`, inscrit dans la migration : 4 logements par paliers (studio, open space, loft, penthouse ; la chambre est offerte), 18 objets de déco, des cosmétiques (thème de couleur, titre sous le pseudo, effet de victoire, un seul équipé par catégorie) et 3 bonus consommables.
  - Achat, revente (60 %, déco et cosmétiques seulement) et équipement passent par des fonctions SQL. Les objets survivent à la faillite.
  - **Classement au patrimoine** = solde + mises en cours + 60 % du prix des objets (`leaderboard()`). Acheter ne fait donc pas perdre de places.
  - Bonus branchés par déclencheurs, sans toucher au règlement. Assurance : 50 % de la mise rendue sur une position liquidée (`bets.insured`). Cote boostée : +20 % sur le prochain duel. Salaire doublé : 500 W de plus par salaire pendant 1 h.
  - La 3D est en Three.js, chargée seulement à l'ouverture de l'onglet QG. Pièce isométrique qui grandit avec le logement ; objets en formes simples, sans modèle externe, placés depuis le coin du fond. Les écrans du bureau affichent le gain ou la perte des positions ouvertes. Rotation à la souris, léger balancement sur écran tactile.
  - Les QG des autres joueurs se visitent depuis le classement (inventaire lisible par tous).
- **Questions sur les streamers** (migration `20261006180000_questions.sql`) : c'est la forme de pari affichée pour Twitch, choisie par Victor. « X dépassera-t-il N spectateurs à HH:MM ? », Oui / Non à cote fixe. `settle()` crée chaque minute, pour chaque live frais d'au moins 100 spectateurs, trois questions : au prochain quart d'heure à au moins 10 min, puis +15 et +45 min. Le seuil est rond et placé à 0,4 écart type au-dessus de l'audience (Oui ≈ 1 chance sur 3). La cote vient de la loi normale sur ln(V/N) / (σ√t), où σ est la volatilité par minute du live sur la dernière heure, avec une marge de 7 %. Elle est figée au pari. Paris fermés 5 min avant l'échéance. Règlement sur le dernier relevé avant l'échéance, 0 si le live est fini. L'interface indique que Twitch ne met son chiffre à jour que toutes les 1 à 3 min (mesuré : 26 % des relevés à la minute changent). Les positions ▲/▼ sur streamers (`open_stream`) restent en base mais ne sont plus proposées.
- **Streamers Twitch** (migration `20261006120000_twitch.sql`, fonction `supabase/functions/twitch-poll`) : pg_cron appelle la fonction chaque minute via pg_net. Elle relève les 40 lives francophones les plus regardés, plus tout streamer qui a un pari ouvert ou était en live il y a moins de 30 min, dans `stream_ticks`. Position = même formule que les articles, avec les spectateurs comme cours. Échéances en temps réel : 15 min, 1 h ou fin du live. Règlement au dernier relevé en live avant l'échéance ou la fin du stream, liquidation au premier relevé qui met la valeur à 0. Ouverture refusée si le dernier relevé date de plus de 3 min. Secrets `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` côté Supabase uniquement. `stream_board()` renvoie une ligne par streamer avec sa courbe (l'API REST plafonne à 1 000 lignes).

## Design (`web/src/styles.css`)

Noir bleuté `#08090D`, panneaux `#0F1117`/`#161922`, filets `#222634`. Gain `#1FCB8B`, perte `#F04B5C` (toujours doublés d'un signe ou d'une flèche ▲▼), action principale ambre `#F5B83D`. IBM Plex Sans (texte), Plex Sans Condensed (titres, noms), Plex Mono (chiffres). Mobile : positions en tête puis onglets Marché / Duels / Historique / Classement. À partir de 1024 px : positions en colonne gauche collante.

**Navigation (refonte mobile d'octobre 2026, demandée par Victor) :**
- Barre d'onglets flottante en bas, en « liquid glass » (verre flouté, `src/nav.jsx`, classe `.dock`) : Marché (Wikipédia | Duels), Live (Twitch | Steam), Positions (En cours | Historique, badge du nombre de paris ouverts), QG, Plus.
- Le menu Plus (`src/pages.jsx`) regroupe Classement, Comment jouer, Mon compte (patrimoine, faillite) et Sources des données.
- « Comment jouer » s'ouvre tout seul à la première visite (clé `wb-howto` dans le localStorage).
- **Rien ne doit bouger sous le doigt.** L'ordre du marché est figé au coup d'envoi ou au changement de tri, avec un bouton « Retrier ». Celui du Live est figé par échéance. Seuls les prix se mettent à jour sur place.
- Sur mobile, une bande compacte des paris en cours s'affiche en haut du Marché et du Live. Sur grand écran, la colonne des positions reste à gauche.
- Animations (`/* ===== Animations et liquid glass ===== */` dans styles.css) :
  - une « lentille » de verre glisse avec un ressort sous l'onglet actif, dans la barre du bas et dans les contrôles segmentés. Le contrôle segmenté ne doit pas être recréé au changement de sous-onglet, sinon la lentille saute ;
  - un reflet balaie la barre en verre ;
  - les feuilles montent en ressort, et le contenu fait un fondu glissé au changement d'onglet ;
  - les boutons s'enfoncent à l'appui, et les prix crypto flashent vert ou rouge quand ils changent ;
  - tout est coupé par `prefers-reduced-motion`.
- Montants avec espace insécable (`W()` dans `src/format.js`).

Les graphiques suivent le skill dataviz : traits de 2 px, pointillé pour le cours d'entrée, zone verte du côté gagnant et rouge du côté perdant.

## Données

`scripts/fetch_pageviews.py` (stdlib) récupère les vues quotidiennes (agent `user`) pour `scripts/articles.json` et écrit `web/src/pageviews.json` (et `data/pageviews.js` pour le prototype). Ensuite `npm run seed` dans `web/` pousse tout en base. L'API Wikimedia limite le débit : garder la pause entre requêtes.

Attention au biais actuel : une partie des articles a été choisie dans le top des plus vus du dernier jour, ce qui rend certaines séances explosives (+100 % en une séance). Pour la suite, choisir les articles sans regarder la fin de la période.

## Pistes suivantes

1. Coter tout Wikipédia : une tâche planifiée récupère chaque matin le top 1 000 des articles du jour (`/metrics/pageviews/top/...`) et recalcule les cours, au lieu de rejouer 30 jours en boucle.
2. Données plus fines : vues horaires (dumps.wikimedia.org/other/pageviews) pour un intraday réel ; EventStreams (`https://stream.wikimedia.org/v2/stream/recentchange`) comme signal d'agitation.
3. Parrainage, ligues privées pour streamers.
4. Frais d'ouverture sur les positions : sans eux, la maison n'a aucun avantage.
5. Partage du résultat en image.

## Règles de travail

- Tout texte affiché en français, phrases courtes.
- Ne pas présenter des données simulées comme réelles : la mention en bas de l'écran doit rester à jour.
- Toute règle de jeu se code d'abord en SQL (la base fait foi), puis se reflète dans le front pour l'affichage en direct. Ajouter un test dans `web/tests/` à chaque règle.
