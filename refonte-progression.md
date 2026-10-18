# Refonte « progression » : où on en est, ce qui reste

Cahier des charges de Victor (18 octobre 2026). On remplace le QG, la banque et les talents par : profil, niveaux de
trader (XP) qui débloquent le levier, quêtes, pari du jour, ligues hebdomadaires et guildes à objectif collectif. On
garde les succès (trophées).

## Fait (en production le 18 octobre 2026)

| Phase | Contenu | Migration | Commit |
|---|---|---|---|
| Pseudo | Jamais en forme d'e-mail, Joueur-XXXX + changement offert | `20261028200000_pseudo_email.sql` | e5adcfb |
| H1 | QG, banque, talents, ville de guilde retirés, remboursements dans `h1_refunds` | `20261028300000_suppressions.sql` | e6eb291 |
| H3 + H4 | XP, niveaux, levier par paliers, quêtes, série | `20261028400000_niveaux_quetes.sql` | ae66b15 |
| H5 | Pari du jour | `20261028500000_pari_du_jour.sql` | ae66b15 |

Détail dans `CLAUDE.md` (sections « Refonte progression »). Valeurs partagées : `web/supabase/functions/_shared/progression.js`.

## Ce qui reste : environ 12 à 15 h de travail (3 ou 4 sessions)

| Ordre | Phase | Estimation |
|---|---|---|
| 1 | H2 Profil | 3 à 4 h |
| 2 | H6 Ligues | 3 à 4 h |
| 3 | H7 Guildes à objectifs | 3 h |
| 4 | H8 Succès en XP | 1 à 1,5 h |
| 5 | H9 Rapport consolidé des simulations | 1 à 2 h |

Après chaque phase : tests verts, sauvegarde de la production, puis Victor lance `! npm run db:push` (son terminal est
déjà dans `web`, `!` en tout début de ligne ; Claude ne lance pas lui-même `db:push`), puis vérification en lecture seule
et `git push` du front. Rapport après chaque phase : ce qui a été fait, chiffres de simulation, écarts avec le cahier des
charges, fichiers touchés, résultats des tests.

### Points ouverts
- Proposition non tranchée : plafond ×10 sur les petites valeurs (PXF, SLM), voir `web/scripts/sim-levier.mjs`.
- `player_division()` vaut 0 jusqu'à H6 : ×15 et ×20 sont fermés à tous d'ici là.
- Écart accepté sur la courbe d'XP (calée sur le casual : ×5 au jour 6, ×10 au jour 31) : le joueur régulier atteint le
  niveau 12 au jour 13 au lieu de 21.
- Avec 6 vrais joueurs, la règle des petits groupes de ligue (n < 10) s'appliquera presque toujours au début.
- Dock (5 entrées au plus) : aujourd'hui Marché, Positions, Quêtes, Guilde, Plus. À revoir quand Ligue et Profil arrivent.
- Coffres de quêtes gagnés (`quest_chests`) : à ouvrir en H2 (récompense cosmétique).
- Basse priorité : renommer `tal_hwm` / `tal_cum` (gain net de trading) dans une migration séparée, si c'est sans risque.
- La ligne `brag-output*/` de `web/.gitignore` n'est pas commitée.

## Refonte visuelle : écrans pas encore repris

Principes dans `CLAUDE.md` (« Refonte visuelle »), écrans refaits le 19 octobre 2026 (Plus, Marché, fiche, ticket,
positions, quêtes, succès, compte, guilde, Comment jouer, accueil). Reste, écrans secondaires :
- Portefeuille quand il contient des actions (tuiles `.tiles`, graphique, cartes).
- Feuilles d'investissement (`InvestSheet`) et de clôture (`CloseSheet`).
- Écran d'inscription (`Onboarding`) et présentation de l'essai (`Intro`, 4 diapositives).
- Amis, Sources des données, Confidentialité.
- Carte thermique : laissée telle quelle (visualisation), à revoir seulement si besoin.
Méthode : capture avant (`node web/scripts/capture-ecrans.mjs`), critique, plan court, code, capture après, traduction
anglaise (`i18n-keys.mjs` puis `i18n-add.mjs`), tests, push.

## Cahier des charges des phases restantes (texte de Victor)

### Règles de travail
- CLAUDE.md : tests verts avant tout déploiement, jamais --no-verify, seul le code de sortie de npm test fait foi.
- Migrations : continuer la numérotation après la dernière existante. Ne jamais renommer l'existant.
- Tout le calcul est côté serveur (SQL / Edge Function), jamais côté client, et idempotent (un double settle() ne double rien).
- Pas de nouvelle dépendance npm lourde. Mobile d'abord : aucun débordement horizontal à 360, 375, 414 px, test
  automatisé via tests/browser.js étendu à chaque nouvel écran.
- Ne jamais afficher ni écrire la clé service_role. La sauvegarde contient des hash de mots de passe : elle reste hors du dépôt.
- « Trade valide » = mise ≥ 100 W ET position tenue ≥ 150 s. « Semaine » = lundi 00:00 → dimanche 23:59:59, heure de
  Paris (changement d'heure géré, test à horloge simulée). Les gains « de trading » excluent toujours : salaire,
  parrainage, récompenses de saison, XP.

### H2. Profil complet
- Pseudo : 3 à 16 caractères, unique sans tenir compte de la casse, filtre de gros mots FR/EN, noms réservés (admin,
  aurelys…), modifiable 1 fois par 30 jours. (Déjà fait : jamais en forme d'e-mail.)
- Avatar : PAS d'upload de photo (modération, RGPD / mineurs, quotas du plan gratuit). Une galerie d'avatars ORIGINAUX
  générés par un script versionné (comme logos/make.py), en SVG dans web/public/avatars/ : ~30 personnages, animaux ou
  emblèmes géométriques (taureau, ours, faucon, requin, renard, hibou, pieuvre, robot, astronaute…) × 12 couleurs de fond.
  Aucun personnage, mascotte ni logo existant. Seul l'identifiant est stocké en base. Une partie des avatars se débloque
  par niveau, trophée ou ligue.
- Cadre autour de l'avatar = ligue actuelle (Bronze → Maître), en CSS.
- Titre : un seul équipé parmi ceux débloqués, affiché sous le pseudo partout (classements, guilde, profil). ~30 titres
  débloqués par trophées, niveaux et ligues.
- Page profil, la sienne et une page publique /joueur/<pseudo> : avatar + cadre, pseudo, titre, niveau + barre d'XP,
  ligue ; patrimoine (= « score » du profil) ; 3 trophées épinglés ; stats (trades valides, taux de gain, meilleur trade,
  série de quêtes) ; guilde ; historique des 8 dernières saisons.
- Option « profil masqué » : pas de page publique, mais le joueur reste dans les classements. Aucune donnée personnelle
  (e-mail…) sur la page publique.
- Décision de Victor (H1) : pas de table de cosmétiques en H1 ; H2 crée la table des déblocages (personne n'avait de
  cosmétique ; `h1_refunds` garde la trace des lignes « cosmetique » s'il y en avait).

### H6. Saisons hebdomadaires et ligues
- 16 divisions : Bronze 1-2-3, Argent 1-2-3, Or 1-2-3, Platine 1-2-3, Diamant 1-2-3, Maître. Départ : Bronze 1.
- Entrée : à la clôture de son premier trade valide de la semaine, le joueur est placé dans un groupe de sa division
  (jusqu'à 100 joueurs ; si tous sont pleins, on en crée un). Un joueur qui ne trade pas n'est dans aucun groupe et garde
  sa division.
- Classement : rendement de la semaine = P&L de trading net (clôturé + positions ouvertes valorisées par closeQuote à un
  cours frais en fin de semaine) divisé par max(patrimoine de début de semaine, capital de départ). Classement en %, pas en W.
- Résultat d'un groupe de n joueurs : 5 % meilleurs → +2 divisions ; 15 % suivants → +1 ; 60 % → stagnent ; 20 % derniers
  → −1. Avec n = 100 : 5 / 15 / 60 / 20. Pas de montée au-dessus de Maître, pas de descente sous Bronze 1. Arrondis vers le
  bas ; égalités départagées en faveur du meilleur résultat. Petits groupes (n < 10) : aucune descente, et seul le 1er
  monte d'une division si n ≥ 3. Si une division compte trop peu de joueurs, les regrouper en un seul groupe. JAMAIS de
  faux joueurs : afficher le vrai effectif.
- Éligibilité : ≥ 5 trades valides dans la semaine pour monter ou toucher la récompense. En dessous, le joueur est classé
  mais ne peut ni monter ni toucher de récompense (il peut descendre). Pour toucher la récompense : compte confirmé par
  e-mail et ≥ 48 h d'ancienneté. (À voir : le jeu ne vérifie aucun e-mail ; proposer une règle équivalente à Victor.)
- Récompense de saison : somme fixe, identique pour tous les joueurs éligibles d'une même division, versée en espèces.
  Échelle indicative en % du capital de départ : Bronze 1-2-3 : 1 / 1,5 / 2 ; Argent : 3 / 3,5 / 4 ; Or : 5 / 5,5 / 6 ;
  Platine : 7 / 8 / 9 ; Diamant : 10 / 11 / 12 ; Maître : 15. À valider en H9 (proposer une échelle réduite si
  l'injection hebdomadaire est insoutenable). Enregistrée avec la source « saison », exclue des classements de gains.
  En plus : XP +60 de participation, +100 par division gagnée.
- Clôture : tâche pg_cron le lundi 00:05, idempotente (verrou par saison, rattrapage si une exécution est manquée). Pas de
  nouvel appel périodique coûteux (settle() tourne déjà chaque minute).
- Levier : `player_division()` (aujourd'hui `select 0`) doit renvoyer la division actuelle ; ×15 exige Platine 1, ×20
  Diamant 1, à l'ouverture seulement.
- UI « Ligue » : ma division avec son cadre, mon rang dans mon groupe ; zones colorées (promotion ×2, promotion, maintien,
  relégation) ; compte à rebours de fin de semaine ; classement du groupe (avatars, titres) ; historique. En essai sans
  compte : cadenas.

### H7. Guildes (sans QG, sans maison, sans banque)
- Création : niveau de trader ≥ 8 (déjà en place), nom unique filtré, un joueur = une guilde. Quitter ou être exclu =
  24 h avant de rejoindre une autre. Rôles : chef + membres, avec transfert de chef. Chef inactif depuis 14 jours : le
  membre actif le plus ancien devient chef.
- Objectif hebdomadaire : le chef fixe un montant en W = somme des P&L de trading nets des membres sur la semaine (mêmes
  règles qu'en H6). Modifiable jusqu'au lundi 00:00, puis verrouillé. Seuls les membres présents au verrouillage comptent ;
  un arrivant en cours de semaine contribue à partir de la suivante. Contribution par membre bornée à [−10 %, +40 %] de la
  cible.
- Minimum = membres au verrouillage × base(niveau de guilde), base = 5 % du capital de départ × (1 + 0,1 × (niveau − 1)).
  Maximum autorisé : 5 × le minimum. À calibrer pour qu'un minimum soit atteignable par une guilde médiane (H9).
- XP de guilde si l'objectif est atteint : XP = Xbase(niveau, membres) × g(r), r = cible / minimum. g(1) = 0,1 ;
  g(1,5) = 0,4 ; g(2) = 0,7 ; g(3) = 1,0 ; g(5) = 1,4 (interpolation linéaire). Entre 75 % et 100 % de la cible : 25 % de
  l'XP. En dessous : 0, sans pénalité.
- Récompense individuelle : chaque membre avec ≥ 3 trades valides dans la semaine reçoit +50 XP de trader quand
  l'objectif est atteint.
- Niveaux de guilde (1 à 20) : plus de membres max (10 au niveau 1, +5 tous les 2 niveaux, 50 au maximum) ;
  personnalisation de la page publique (emblèmes, bannières, couleurs, devise, description, mur des trophées, historique
  des objectifs, meilleurs contributeurs). Emblèmes et bannières = SVG originaux générés par script. Pas d'upload.
- Page publique /guilde/<nom> : emblème, bannière, niveau + barre d'XP, membres (avatar, titre, niveau, contribution),
  objectif et progression de la semaine, trophées, historique. Recherche de guildes (filtres niveau, taille, ouverte / sur
  invitation).
- Saison de guilde mensuelle (mois civil, Paris) : classement des guildes par XP de guilde gagnée par membre actif (≥ 5
  membres actifs pour être classé) ; récompenses cosmétiques seulement (bannière de saison, trophée, titre pour le chef) ;
  +200 XP de trader aux membres actifs du top 3. Aucun W.
- Migration : les guildes existantes démarrent au niveau 1, membres conservés (attention : la limite de 10 membres au
  niveau 1 ne doit exclure personne). La banque et le Trésor de guilde sont déjà retirés (H1).
- Quêtes déjà prévues pour la guilde : `guild_win`, `w_guild_10` (aujourd'hui : trades gagnants d'un membre) → les brancher
  sur l'objectif de guilde.

### H8. Trophées adaptés
- Garder les règles des succès : idempotence, évaluation côté serveur, rétroactivité limitée, succès secrets.
- Récompense = XP (plus de points de talent) : 0 point → 25 XP ; 1 → 75 XP ; 2 → 150 XP. Certains trophées débloquent
  aussi un titre ou un avatar.
- Déjà retirés en H1 : PROPRIO, BANQUIER, SPECIALISTE, POLYVALENT. Remplacer GUILDE_TOP3 par « objectif de guilde atteint
  4 semaines d'affilée ».
- Ajouter : LIGUE_ARGENT, LIGUE_OR, LIGUE_PLATINE, LIGUE_DIAMANT, MAITRE ; PODIUM (top 3 d'un groupe), DOUBLE_PROMO ;
  QUETES_7, QUETES_30 (séries) ; PARI_3 (3 justes d'affilée), PARI_10 ; NIVEAU_10, NIVEAU_25, NIVEAU_50 ;
  CHEF_DE_GUILDE (guilde de ≥ 5 membres), OBJECTIF_GUILDE, OBJECTIF_GUILDE_4 ; PROFIL_COMPLET.
- Garder « Renaissance » et la suppression d'« Oracle du Live ».
- Remplacer le test « 21 points au plus » (supprimé en H1) par un test équivalent sur le total d'XP des trophées.
- La courbe d'XP compte déjà ~300 XP de succès la 1re semaine puis ~60 par semaine (`sim-xp.mjs`) : vérifier que les
  vraies valeurs restent proches, sinon la courbe ne tient plus ses cibles (et un niveau ne doit jamais baisser).

### H9. Anti-abus, simulation, tests
- Anti-abus : tout côté serveur avec clés d'idempotence ; pas de transfert de W entre joueurs ; quêtes, pari et trophées
  ne donnent jamais de W (seul versement de W : la récompense de saison) ; journaliser sans bloquer les comptes suspects
  (comptes d'un même parrain qui tradent en miroir, même appareil sur plusieurs comptes) pour la future vue admin.
- Script web/scripts/sim-saisons.mjs (dans l'esprit de sim-talents, supprimé en H1) : 1 000 joueurs sur 12 semaines,
  profils casual (3 jours par semaine), régulier, hardcore, baleine, multi-comptes. Mesurer : injection hebdomadaire de W
  par les saisons / masse en circulation ; répartition des divisions au fil des semaines ; délai pour atteindre ×5, ×10 et
  ×15 ; XP par jour ; part des guildes qui atteignent le minimum et un objectif ×2 ; gain moyen d'un multi-comptes (doit
  rester négligeable). Seuils : injection soutenable (proposer une échelle réduite sinon) ; un casual atteint ×5 en moins
  de 7 jours et ×10 en moins de 5 semaines (déjà vérifié par sim-xp.mjs : jours 6 et 31). Tenir compte de la disparition
  des anciens puits et sources de W (boutique, ville, intérêts de la banque, réinitialisation de talents).
- Tests au minimum : idempotence de la saison et de l'objectif de guilde ; cron de saison rejoué deux fois = un seul
  versement ; promotions 5/15/60/20 pour n = 100, petits groupes, bornes, égalités, inéligibles ; récompense identique
  pour tous dans une division et exclue des classements de gains ; contributions de guilde plafonnées, arrivant exclu ;
  unicité des pseudos ; absence de « service_role » dans les sources. (Déjà faits : conservation des W, frais sans
  talents, plafond de levier et positions ouvertes intactes, idempotence des quêtes et du pari, pari non résolu sans cours
  frais, semaine traversant le changement d'heure.)
- UI : captures à 375 et 1280 px de Profil, Quêtes, Ligue, Guilde (page publique) et Pari. Aucun débordement horizontal
  (test automatisé).
- Mettre à jour CLAUDE.md. Sur la landing, remplacer les cartes par « ligues, quêtes, guildes ».
