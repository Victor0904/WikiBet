# Bourse d'Aurelys — Game Design & Moteur de marché

> Un marché boursier fictif, vivant et crédible. Les prix ne sont pas scriptés : ils **émergent** des ordres d'achat et de vente passés par des bots et par les joueurs. Ces ordres réagissent eux-mêmes à des actualités, à des cycles économiques et à quelques acteurs géants.

---

## 0. Est-ce faisable ?

Oui. C'est ce qu'on appelle en recherche une **simulation multi-agents de marché** (*agent-based market model*). Le principe tient en une phrase :

> **Le prix bouge parce que des agents achètent et vendent ; les agents achètent et vendent parce que le prix, les news et leur personnalité les y poussent.**

On ne dessine jamais la courbe directement. On simule les **causes** (ordres, sentiment, actualité) et la courbe en découle. C'est ce qui la rend crédible : les figures chartistes (tête-épaules, double creux…) apparaissent d'elles-mêmes, et un « réalisateur » peut en provoquer quand il le faut.

Le moteur est découpé en 7 briques indépendantes :

| # | Brique                  | Rôle                                                           |
| - | ----------------------- | --------------------------------------------------------------- |
| 1 | Le Monde                | Entreprises, secteurs, indice, macro-économie                  |
| 2 | Valeur fondamentale     | Ce que l'action « vaut vraiment » (invisible pour le joueur)  |
| 3 | Agents (bots)           | Personnalités d'investisseurs qui passent des ordres           |
| 4 | Impact de prix          | Comment un ordre fait monter ou descendre le cours              |
| 5 | Actualités             | Événements aléatoires qui modifient fondamental et sentiment |
| 6 | Régimes & crises       | L'humeur globale du marché (calme, euphorie, krach…)          |
| 7 | Réalisateur de figures | Injecte des patterns chartistes de façon discrète             |

---

## 1. Le Monde

### 1.1 La place financière

- **Pays fictif** : la République d'Aurelys
- **Bourse** : Bourse d'Aurelys, cotation **24h/24** (le jeu ne dort jamais), avec une activité modulée jour/nuit
- **Monnaie** : l'aurel (Ꜷ), 1 Ꜷ ≈ 1 € pour l'intuition des joueurs
- **Indice phare** : **AUR-12**, moyenne pondérée par la capitalisation des 12 sociétés
- **Banque centrale** : la Banque Centrale d'Aurelys (BCA-Centrale), qui fixe un taux directeur

### 1.2 Les secteurs

Chaque secteur a un **facteur commun** : quand le secteur bouge, toutes ses entreprises bougent un peu ensemble.

| Secteur              | Sensibilité aux taux | Cyclique ? | Volatilité           |
| -------------------- | --------------------- | ---------- | --------------------- |
| Tech                 | forte (négative)     | moyen      | élevée              |
| Énergie             | faible                | oui        | moyenne               |
| Santé               | faible                | non        | événements binaires |
| Industrie            | moyenne               | très      | moyenne               |
| Finance              | forte (positive)      | oui        | moyenne               |
| Consommation         | faible                | non        | faible                |
| Matières premières | moyenne               | très      | élevée              |
| Loisirs              | moyenne               | oui        | très élevée        |

### 1.3 Les entreprises cotées

| Ticker | Nom                  | Secteur              | Prix initial | Actions (M) | Volatilité σ/jour | β marché | Liquidité | Personnalité                                |
| ------ | -------------------- | -------------------- | ------------ | ----------- | ------------------- | ---------- | ---------- | -------------------------------------------- |
| NXR    | Nexora Systems       | Tech                 | 142,00       | 80          | 2,8 %               | 1,4        | haute      | Star de l'IA, adorée et surévaluée        |
| PXF    | Pixelfold Studios    | Loisirs              | 38,50        | 25          | 4,5 %               | 1,6        | faible     | Vit et meurt à chaque sortie de jeu         |
| OMB    | Ombrelune Pharma     | Santé               | 64,20        | 40          | 2,0 % (+ sauts)     | 0,7        | moyenne    | Essais cliniques = loterie                   |
| HLV    | Helvane Énergie     | Énergie             | 27,80        | 300         | 1,0 %               | 0,6        | haute      | Valeur refuge, gros dividende                |
| FRC    | Ferrocap Industries  | Industrie            | 19,40        | 150         | 1,9 %               | 1,2        | moyenne    | Sidérurgie, suit l'économie                |
| VLS    | Vélisse Motors      | Industrie            | 55,00        | 60          | 3,2 %               | 1,5        | moyenne    | Voitures électriques, PDG imprévisible     |
| BCS    | Banque Castellane    | Finance              | 46,30        | 200         | 1,6 %               | 1,1        | haute      | Profite des taux hauts, craint les crises    |
| MRV    | Marivent Logistique  | Industrie            | 31,10        | 90          | 2,2 %               | 1,0        | moyenne    | Fret maritime, sensible aux tensions         |
| GTR    | Granterre Agro       | Consommation         | 22,60        | 120         | 1,3 %               | 0,5        | moyenne    | Dépend de la météo et des récoltes       |
| LMR    | Lumirue Distribution | Consommation         | 16,90        | 250         | 1,2 %               | 0,8        | haute      | Supermarchés, très défensive              |
| SLM    | Solarmine Lithium    | Matières premières | 12,40        | 70          | 3,8 %               | 1,3        | faible     | Petite minière, cible favorite des baleines |
| KST    | Kestrel Aéro        | Industrie            | 88,70        | 45          | 1,8 %               | 0,9        | moyenne    | Aéronautique et contrats d'État            |

> Les noms sont inventés. Avant une sortie publique, faire une vérification rapide qu'aucun ne correspond à une marque déposée.

### 1.4 Les personnages (pour donner de la chair aux news)

- **Ilan Varesko**, PDG de Vélisse Motors : tweete trop, fait bouger son titre de ±8 % sur une phrase
- **Dr Maëlle Orsini**, directrice scientifique d'Ombrelune : ses annonces d'essais sont attendues comme des verdicts
- **Gouverneur Albrecht Holm**, Banque Centrale : chaque conférence fait trembler le marché
- **« Le Kraken »**, une baleine anonyme dont la rumeur seule suffit à faire bouger SLM
- **Sofia Delmar**, analyste star de Castellane Research : ses recommandations déplacent les flux

### 1.5 La macro-économie

Quelques variables globales évoluent lentement et influencent tout le monde :

| Variable                | Valeur initiale | Évolution                                                       | Effet                              |
| ----------------------- | --------------- | ---------------------------------------------------------------- | ---------------------------------- |
| Taux directeur`r`     | 3,0 %           | décisions de la Banque Centrale (toutes les ~2 semaines de jeu) | ↑ taux = Tech ↓, Finance ↑      |
| Croissance`g`         | +1,5 %          | marche aléatoire lente                                          | ↑ = cycliques ↑                  |
| Inflation`π`         | 2,4 %           | marche aléatoire lente                                          | ↑ = Consommation ↓, Matières ↑ |
| Peur`F` (indice VIXA) | 15              | calculé à partir de la volatilité réelle                     | ↑ = tous les bots plus prudents   |

---

## 2. La valeur fondamentale (le « vrai prix » caché)

Chaque action a une **valeur fondamentale** `V(t)` invisible pour le joueur. Le prix de marché `P(t)` oscille autour, s'en éloigne (bulles, paniques) puis finit par y revenir.

```
V(t+dt) = V(t) · exp( μ·dt + σ_V·√dt·Z + Σ chocs_news )
```

- `μ` : croissance de long terme de l'entreprise (ex. Nexora +12 %/an, Lumirue +3 %/an)
- `σ_V` : incertitude sur l'entreprise, nettement **plus faible** que la volatilité du prix
- `Z` : tirage gaussien N(0,1)
- `chocs_news` : les actualités (section 5) modifient V brutalement

**Pourquoi c'est important** : c'est ce qui rend le jeu **analysable**. Un joueur qui lit bien les news devine où va V et peut battre le marché. Le prix n'est pas du pur hasard.

---

## 3. Les agents (bots investisseurs)

Chaque bot est une petite IA avec un capital, un portefeuille, une personnalité et une règle de décision. Toutes les `Δt` (par ex. 1 seconde de jeu), une fraction des bots est « réveillée » et décide d'acheter, vendre ou ne rien faire.

### 3.1 Les familles de bots

| Famille                                   | Part         | Logique                                                                 | Effet sur la courbe                                    |
| ----------------------------------------- | ------------ | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| **Fondamentalistes**                | 20 %         | achètent si`P < V`, vendent si `P > V`                             | ramènent le prix vers la valeur → stabilité         |
| **Suiveurs de tendance** (momentum) | 25 %         | achètent ce qui monte, vendent ce qui baisse                           | amplifient les mouvements → tendances, bulles         |
| **Contrariens**                     | 10 %         | achètent les chutes fortes, vendent les envolées                      | créent des rebonds                                    |
| **Chartistes**                      | 15 %         | réagissent aux supports, résistances, cassures, moyennes mobiles      | créent des niveaux qui « tiennent », des figures    |
| **Bruit** (petits porteurs)         | 25 %         | décisions quasi aléatoires, sensibles aux news et à la foule         | le « léger random d'investisseur »                  |
| **Teneurs de marché**              | 5 %          | achètent et vendent en permanence autour du prix, encaissent le spread | apportent la liquidité, amortissent les petits ordres |
| **Baleines**                        | 2-4 entités | capital énorme, stratégies spéciales (3.3)                           | peuvent dérégler le marché                          |

> Les proportions changent avec le **régime** du marché (section 6) : en euphorie les suiveurs de tendance deviennent majoritaires, en krach les bots « bruit » vendent tous en même temps.

### 3.2 Règles de décision (formules)

Chaque bot calcule une **envie d'acheter** `D` (positive = achat, négative = vente) :

**Fondamentaliste**

```
D = k_f · (V_estimée − P) / P
V_estimée = V · (1 + ε),  ε ~ N(0, 5 %)   // chacun se trompe un peu
```

**Suiveur de tendance**

```
D = k_m · (MM_courte − MM_longue) / MM_longue
```

**Contrarien**

```
D = − k_c · rendement_sur_N_périodes   (seulement si |rendement| > seuil)
```

**Chartiste**

```
si P casse une résistance avec volume → D = +fort
si P touche un support et rebondit   → D = +moyen
si P casse un support                 → D = −fort
si RSI > 70 → D −= ;  si RSI < 30 → D +=
```

**Bruit**

```
D = sentiment_news · k_n + sentiment_foule · k_h + N(0, 1) · bruit
```

Puis, pour tous :

```
D_final = D · (1 − aversion_au_risque · Peur/100) + biais_personnel
si |D_final| > seuil_d_action → passe un ordre
taille_ordre = min(capital_dispo, |D_final| · capital · agressivité)
```

Chaque bot a des paramètres individuels (agressivité, horizon, seuil, aversion) tirés aléatoirement à sa création. **Deux bots de la même famille ne réagissent jamais exactement pareil.** C'est ce qui crée un marché naturel.

### 3.3 Les baleines

Des acteurs rares, avec un capital équivalent à **2 à 10 % de la capitalisation** d'une petite valeur. Chacune a une stratégie :

| Baleine                             | Stratégie          | Déroulé                                                                                                                        |
| ----------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Le Kraken**                 | *Pump & dump*     | Achète discrètement SLM pendant des jours → la hausse attire les suiveurs → revend tout d'un coup au sommet → chute brutale |
| **Fonds Orca**                | Accumulation        | Achète lentement une valeur sous-évaluée par petits ordres pendant des semaines → plancher solide puis décollage            |
| **Groupe Léviathan**         | Vente à découvert | Parie contre une entreprise, publie une « étude » négative (= news) puis vend massivement                                    |
| **Fonds souverain d'Aurelys** | Stabilisateur       | Intervient en cas de krach pour racheter le marché (rare, annoncé par une news)                                                |

Les baleines laissent des **indices** détectables par un bon joueur : volume anormal, petits ordres réguliers, rumeurs dans les news.

### 3.4 Le joueur

Le joueur est un agent comme les autres. Ses ordres passent par le même moteur d'impact (section 4). **S'il achète beaucoup, il fait monter le prix contre lui.** Sur une petite valeur peu liquide comme PXF ou SLM, un gros joueur devient lui-même une baleine.

---

## 4. L'impact de prix : comment les ordres font bouger le cours

C'est le cœur de « plus on achète plus ça monte ».

### 4.1 Le déséquilibre d'ordres

À chaque pas de temps, on additionne tous les ordres :

```
Achats(t)  = Σ volumes achetés
Ventes(t)  = Σ volumes vendus
Déséquilibre Q(t) = Achats − Ventes
```

### 4.2 La loi de la racine carrée

C'est la formule observée empiriquement sur les vrais marchés : l'impact croît comme la **racine carrée** du volume, pas linéairement. Doubler la taille d'un ordre ne double pas l'impact.

```
ΔP/P = signe(Q) · Y · σ · √( |Q| / L )
```

- `σ` : volatilité de l'action
- `L` : liquidité (volume moyen échangé par période). Une action liquide bouge peu, une action peu liquide s'envole
- `Y` : constante de calibration (~0,5 à 1)

### 4.3 Impact temporaire vs permanent

Un gros ordre fait un « pic » qui se résorbe en partie :

```
impact_permanent  = 30 % de l'impact   // le marché a « appris » quelque chose
impact_temporaire = 70 % de l'impact, qui décroît : I(t) = I₀ · exp(−t / τ)
```

C'est ce qui produit les **mèches** des bougies : le prix monte fort sur un achat massif puis redescend un peu.

### 4.4 Le carnet d'ordres (option avancée)

Version simple : la formule ci-dessus.
Version réaliste : un vrai **carnet d'ordres** (liste des offres d'achat et de vente à chaque prix), alimenté par les teneurs de marché. Un ordre au marché « mange » les niveaux de prix un par un. Plus réaliste et affichable au joueur, mais plus complexe. **Commencer par la formule, passer au carnet en V2.**

### 4.5 Coupe-circuits

Comme sur les vraies bourses :

- variation > ±10 % en 1 heure de jeu → **cotation suspendue** 15 minutes, avec une news « Séance suspendue sur SLM »
- l'indice AUR-12 perd > 7 % → **suspension générale**

---

## 5. Les actualités

### 5.1 Structure d'une news

```json
{
  "id": "n_20481",
  "heure": "J12 14:32",
  "cible": "OMB",                  // ou un secteur, ou "MARCHÉ"
  "categorie": "essai_clinique",
  "titre": "Ombrelune : l'essai de phase III de l'OMB-77 atteint son critère principal",
  "texte": "...",
  "sentiment": +0.85,              // de -1 (catastrophe) à +1 (excellente)
  "magnitude": 0.18,               // choc sur la valeur fondamentale (+18 %)
  "fiabilite": 1.0,                // 1 = officiel, 0.3 = rumeur
  "demi_vie": "6h",                // durée de l'effet sur le sentiment
  "suite_possible": "n_20502"      // une rumeur peut être confirmée ou démentie
}
```

### 5.2 Fréquence (processus de Poisson)

Les news arrivent au hasard, mais avec une fréquence moyenne `λ` par entreprise :

```
λ_entreprise = 1 news / 8h de jeu en moyenne
λ_secteur    = 1 news / 12h
λ_macro      = 1 news / 24h
```

Le temps avant la prochaine news se tire avec : `attente = −ln(U) / λ`, `U ~ Uniforme(0,1)`.
En période de crise, `λ` est multiplié par 3 : l'actualité s'emballe.

### 5.3 Catalogue de catégories (avec effets)

| Catégorie                | Sentiment          | Magnitude typique | Exemple de titre                                                  |
| ------------------------- | ------------------ | ----------------- | ----------------------------------------------------------------- |
| Résultats trimestriels   | −1 à +1          | ±3 à ±12 %     | « Nexora pulvérise les attentes : CA +34 % »                   |
| Essai clinique            | binaire            | ±15 à ±45 %    | « OMB-77 : échec de la phase III »                             |
| Contrat / commande        | +                  | +2 à +8 %        | « Kestrel décroche un contrat de 2 Mds Ꜷ »                    |
| Scandale / enquête       | −                 | −5 à −25 %     | « Perquisition au siège de Vélisse »                          |
| Déclaration de PDG       | ±, très bruitée | ±2 à ±10 %     | « Varesko promet une voiture volante en 2028 »                  |
| Recommandation d'analyste | ±                 | ±1 à ±4 %      | « Delmar relève Pixelfold à l'achat »                         |
| Rumeur                    | ±, fiabilité 0,3 | ±2 à ±15 %     | « Selon nos sources, Ferrocap serait en vente »                 |
| Sortie produit            | ±                 | ±5 à ±30 %     | « Le jeu phare de Pixelfold boudé par la critique »            |
| Météo / récolte        | ±                 | ±2 à ±8 %      | « Sécheresse historique : les récoltes en péril »            |
| Décision de taux         | ±, marché entier | selon secteur     | « La Banque Centrale relève ses taux de 0,5 point »            |
| Géopolitique             | −                 | secteur           | « Blocage du détroit de Varn : le fret maritime paralysé »    |
| Activité de baleine      | ±                 | variable          | « Volume inhabituel sur Solarmine : un mystérieux acheteur ? » |

### 5.4 Génération du texte

Chaque catégorie a 10 à 30 **gabarits** avec des trous :

```
"{ENTREPRISE} {VERBE_RESULTAT} les attentes : chiffre d'affaires {SIGNE}{X} %"
VERBE_RESULTAT = ["pulvérise", "dépasse", "rate de peu", "déçoit lourdement"]  // choisi selon le sentiment
```

Option V2 : générer les textes avec un LLM à partir de la structure JSON, pour une variété infinie.

### 5.5 Comment une news influence la courbe

Une news agit sur **deux leviers à la fois** :

1. **La valeur fondamentale** (effet durable)

   ```
   V ← V · (1 + magnitude · fiabilité)
   ```

   → les fondamentalistes vont acheter ou vendre jusqu'à ce que le prix rattrape V.
2. **Le sentiment** (effet émotionnel, temporaire)

   ```
   sentiment_action(t) = Σ sentiment_i · exp(−(t − t_i) · ln2 / demi_vie_i)
   ```

   → les bots « bruit » et suiveurs réagissent, souvent **trop fort** : le prix dépasse la cible puis corrige. C'est la **sur-réaction**, très visible sur les vrais marchés.
3. **La réaction anticipée** (option)
   Pour les événements programmés (résultats, décision de taux), le marché est nerveux **avant** : volatilité ×1,5 dans les heures qui précèdent. Parfois la news est bonne mais le titre baisse quand même (« vendre la nouvelle », 20 % des cas) : c'est réaliste et ça punit les joueurs trop naïfs.

### 5.6 La page Actualités

- Fil chronologique en temps réel, avec un badge par sentiment (🟢 / 🔴 / ⚪)
- Filtre par entreprise, par secteur
- Mention « Rumeur non confirmée » pour fiabilité < 0,5
- Calendrier des événements à venir (résultats, réunions de la Banque Centrale, sorties produits)
- Lien direct vers le graphique de l'action concernée, avec un **marqueur** sur la courbe à l'heure de la news

---

## 6. Régimes de marché et crises

Le marché a une **humeur globale** qui change selon une **chaîne de Markov** : à chaque heure de jeu, une probabilité de passer d'un état à un autre.

### 6.1 Les états

| Régime       | Tendance moyenne | Volatilité | Fréquence news | Bots dominants                |
| ------------- | ---------------- | ----------- | --------------- | ----------------------------- |
| 🟢 Calme      | +0,02 %/h        | ×1         | ×1             | fondamentalistes              |
| 🚀 Euphorie   | +0,08 %/h        | ×1,3       | ×1,5           | suiveurs de tendance          |
| 🟠 Nervosité | 0                | ×1,8       | ×2             | chartistes, contrariens       |
| 🔴 Krach      | −0,4 %/h        | ×3,5       | ×3             | bruit (panique)               |
| 🔵 Reprise    | +0,05 %/h        | ×1,5       | ×1,5           | fondamentalistes, contrariens |

### 6.2 Matrice de transition (par heure de jeu)

| de ↓ / vers → | Calme | Euphorie | Nervosité | Krach | Reprise |
| --------------- | ----- | -------- | ---------- | ----- | ------- |
| Calme           | 0,985 | 0,008    | 0,007      | 0     | 0       |
| Euphorie        | 0,010 | 0,975    | 0,013      | 0,002 | 0       |
| Nervosité      | 0,015 | 0,003    | 0,962      | 0,020 | 0       |
| Krach           | 0     | 0        | 0,010      | 0,950 | 0,040   |
| Reprise         | 0,030 | 0,005    | 0,005      | 0     | 0,960   |

> Une euphorie qui dure fait monter la probabilité de krach (+0,001 par heure passée en euphorie) : **les bulles finissent par éclater.**

### 6.3 Les crises scénarisées

En plus des régimes, quelques **grandes crises** rares (une tous les ~2 mois de jeu) avec un récit :

| Crise                           | Déclencheur                          | Déroulé                                                              | Secteurs touchés    |
| ------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- | -------------------- |
| **Bulle de l'IA**         | Nexora > 3× sa valeur fondamentale   | euphorie → news de résultats décevants → krach Tech −40 %         | Tech, Loisirs        |
| **Crise bancaire**        | rumeur sur Castellane                 | panique, contagion à tout le marché, intervention du fonds souverain | Finance puis tout    |
| **Choc pétrolier**       | géopolitique                         | Énergie ↑↑, Industrie et Transport ↓↓                             | rotation sectorielle |
| **Pandémie aurélienne** | news santé                           | krach général, Santé et Distribution ↑                             | tout le marché      |
| **Krach éclair**         | bug d'un gros algo (aléatoire, rare) | −15 % en 10 minutes puis rebond quasi total                           | tout                 |

### 6.4 Contagion (corrélations)

Le rendement de chaque action se décompose :

```
rendement_action = β · rendement_marché + γ · rendement_secteur + rendement_propre
```

En crise, `β` augmente : **tout baisse ensemble**, comme dans la réalité où les corrélations explosent pendant les krachs.

### 6.5 Volatilité en grappes (GARCH)

Une heure agitée rend la suivante plus agitée :

```
σ²(t) = ω + α · rendement²(t−1) + β_g · σ²(t−1)
```

Valeurs typiques : `α = 0,08`, `β_g = 0,90`. C'est ce qui donne ces séquences de calme plat puis de tempête, caractéristiques des vrais graphiques.

---

## 7. Le réalisateur de figures chartistes

Les figures émergent parfois naturellement grâce aux chartistes. Pour garantir qu'on en voie régulièrement, un **réalisateur** invisible peut en déclencher.

### 7.1 Principe : ne jamais forcer le prix

Le réalisateur ne dessine **pas** la courbe. Il définit une **trajectoire cible** et **biaise discrètement les ordres** des bots « bruit » pour l'approcher. Si le marché réel (news, baleine) va à l'encontre, la figure échoue, **comme dans la vraie vie**. Les joueurs apprennent que les figures ne marchent pas à 100 %.

```
biais_bots_bruit(t) = k_r · (P_cible(t) − P(t)) / P(t)
```

### 7.2 Figures définies par des points clés

Chaque figure est une liste de points `(temps relatif, prix relatif)` reliés par un **pont brownien** (trajet aléatoire mais forcé de passer par les points).

**Tête-épaules (signal baissier)**

```
t:    0     0.15   0.25   0.45   0.60   0.75   0.85   1.0
P:   1.00   1.06   1.02   1.10   1.02   1.06   1.01   0.94
     départ ép.G  creux  tête  creux  ép.D  ligne  cassure
                                              de cou
```

**Tête-épaules inversée (haussier)** : mêmes points, symétriques.

**Double sommet (« M », baissier)**

```
t: 0    0.25  0.5   0.75  1.0
P: 1.00 1.08  1.03  1.08  0.97
```

**Double creux (« W », haussier)**

```
t: 0    0.25  0.5   0.75  1.0
P: 1.00 0.92  0.97  0.92  1.04
```

**Triangle ascendant** : sommets à niveau constant, creux de plus en plus hauts, puis cassure par le haut.

**Drapeau** : forte hausse (le mât), petite consolidation en canal descendant, reprise de la hausse.

**Tasse avec anse** : creux arrondi (parabole), petite baisse, cassure haussière.

### 7.3 Règles du réalisateur

- 1 figure active max par action
- Probabilité de lancer une figure : ~1 fois / 3 jours de jeu par action
- La figure est **choisie selon le contexte** : une tête-épaules a plus de chances après une longue hausse
- Taux de réussite volontairement imparfait : ~65 %
- Amplitude proportionnelle à la volatilité de l'action

### 7.4 Le pont brownien (rappel)

Pour aller de `P_a` (au temps `t_a`) à `P_b` (au temps `t_b`) de façon aléatoire :

```
pour chaque pas dt :
    restant = t_b − t
    dérive  = (ln P_b − ln P_t) / restant
    ln P_{t+dt} = ln P_t + dérive · dt + σ · √dt · Z
```

Le trajet est aléatoire, mais arrive pile sur la cible.

---

## 8. La boucle de simulation complète

```
CHAQUE TICK (ex. 1 seconde réelle = 1 minute de jeu) :

1. Avancer le temps de jeu
2. Mettre à jour la macro (taux, croissance, inflation) — lent
3. Tirer un éventuel changement de régime (Markov)
4. Tirer les news (Poisson) → appliquer chocs sur V et sentiment
5. Mettre à jour les valeurs fondamentales V de chaque action
6. Mettre à jour la volatilité GARCH de chaque action
7. Réalisateur : avancer les figures en cours, en lancer éventuellement une
8. Baleines : avancer leurs plans
9. Réveiller une fraction des bots → chacun calcule D et passe (ou non) un ordre
10. Ajouter les ordres des joueurs
11. Pour chaque action :
       Q = achats − ventes
       appliquer l'impact (permanent + temporaire)
       appliquer le facteur marché + secteur
       vérifier les coupe-circuits
12. Construire les bougies (OHLC + volume) sur 1 min, 5 min, 1 h, 1 jour
13. Calculer les indicateurs (MM20, MM50, RSI, Bollinger, VIXA, AUR-12)
14. Diffuser aux clients (WebSocket)
```

### 8.1 Rythme jour / nuit

Même en cotation 24h/24, l'activité varie :

```
activité(h) = 0,4 + 0,6 · cloche(h)   // pic 10h-12h et 15h-18h, creux 2h-6h
```

Moins de bots réveillés la nuit → moins de volume → mouvements plus erratiques sur les petites valeurs (opportunités pour les joueurs nocturnes).

### 8.2 Reproductibilité

Tout l'aléatoire passe par un **générateur à graine** (seed). Avec la même graine, la même simulation se rejoue à l'identique. C'est indispensable pour déboguer, tester l'équilibrage et rejouer une partie.

---

## 9. Visualisation

### 9.1 Le graphique d'une action

- **Chandeliers** (OHLC) avec choix d'unité : 1 min, 5 min, 1 h, 1 jour
- **Volume** en barres sous le graphique (vert si hausse, rouge si baisse)
- **Indicateurs** activables : moyennes mobiles 20/50, Bollinger, RSI, MACD
- **Marqueurs de news** sur la courbe (petites pastilles cliquables)
- **Outils de tracé** pour le joueur : lignes de tendance, supports, résistances
- Bibliothèque conseillée : **Lightweight Charts** (open source, faite pour les bougies)

### 9.2 Les autres écrans

| Écran           | Contenu                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Tableau de bord  | AUR-12, VIXA (peur), régime actuel (icône météo), top hausses et baisses              |
| Fiche entreprise | graphique, description, personnages, historique des news, ratios fictifs (PER, dividende) |
| Actualités      | fil en temps réel + calendrier (section 5.6)                                             |
| Portefeuille     | positions, plus/moins-values, historique d'ordres                                         |
| Carte thermique  | toutes les actions en carrés colorés selon la variation du jour                         |
| Classement       | meilleurs joueurs                                                                         |

---

## 10. Modèle de données

```
Entreprise   { ticker, nom, secteur, actions, V, P, σ_base, β, γ, liquidité, μ, personnage_id }
Secteur      { id, nom, facteur_courant, sensibilité_taux, cyclique }
Macro        { taux, croissance, inflation, peur, régime, t_régime }
News         { id, t, cible, catégorie, titre, texte, sentiment, magnitude, fiabilité, demi_vie, suite }
Bot          { id, famille, capital, portefeuille{}, agressivité, horizon, seuil, aversion, biais }
Baleine      { id, nom, stratégie, cible, capital, phase, plan[] }
Figure       { action, type, points[], t_début, durée, active, réussie }
Bougie       { ticker, unité, t, open, high, low, close, volume }
Ordre        { id, auteur, ticker, sens, volume, t }
Joueur       { id, pseudo, cash, portefeuille{}, historique[] }
```

---

## 11. Équilibrage et garde-fous

- **Pas de prix négatif** : tout se calcule en log-prix
- **Pas d'explosion infinie** : les fondamentalistes ramènent toujours vers V ; si P > 3V, leur force de rappel est multipliée
- **Liquidité minimale** : les teneurs de marché ne disparaissent jamais complètement, même en krach
- **Anti-manipulation des joueurs** : plafond d'ordre par joueur selon la liquidité, frais de transaction (0,1 %) pour éviter l'aller-retour infini
- **Calibration** : comparer les statistiques du jeu à celles des vrais marchés :
  - rendements à « queues épaisses » (plus d'événements extrêmes qu'une loi normale)
  - volatilité en grappes
  - pas d'autocorrélation des rendements (sinon trop prévisible)
  - corrélations qui augmentent en crise

---

## 12. Feuille de route

| Version      | Contenu                                                                              | Objectif                        |
| ------------ | ------------------------------------------------------------------------------------ | ------------------------------- |
| **V0** | 3 actions, prix = pont brownien + GARCH, graphique en bougies                        | voir une courbe crédible       |
| **V1** | bots (fondamentalistes, suiveurs, bruit), impact racine carrée, valeur fondamentale | le marché vit seul             |
| **V2** | news (gabarits + Poisson), page Actualités, marqueurs sur le graphique              | le marché raconte une histoire |
| **V3** | régimes de Markov, crises, contagion, baleines                                      | drame et imprévisibilité      |
| **V4** | réalisateur de figures, chartistes                                                  | patterns lisibles               |
| **V5** | joueurs multiples, classement, carnet d'ordres, textes par LLM                       | jeu complet                     |

---

## 13. Références (pour aller plus loin)

- **Modèle de Lux-Marchesi** : marché multi-agents fondamentalistes / chartistes qui reproduit les propriétés des vrais marchés
- **Modèle de Santa Fe (Artificial Stock Market)** : l'ancêtre des marchés simulés par agents
- **Loi de la racine carrée de l'impact** : travaux de Jean-Philippe Bouchaud (Capital Fund Management)
- **GARCH** : Robert Engle et Tim Bollerslev, modèles de volatilité
- **Chaînes de Markov à changement de régime** : modèle de James Hamilton
- **Diffusion à sauts** : modèle de Robert Merton (1976)
