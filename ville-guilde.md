# Les Villes d'Aurelys — proposition

> Chaque guilde fonde une ville dans la République d'Aurelys. Chaque membre y a sa maison, la ville se construit ensemble.
> Le but : un endroit où l'on **a envie de dépenser ses W**, de façon durable, sans fausser le classement des gains.

Document d'idées, à trier avant de coder. Les chiffres sont des points de départ, à caler par simulation comme pour Aurelys.

---

## 0. Ce qui change par rapport à l'idée de départ

| Idée de départ | Amélioration proposée | Pourquoi |
| --- | --- | --- |
| Une ville par guilde | La ville est **dans Aurelys**, sur la carte du pays (côte, montagne, plaine, désert de Sel-Rouge) | Relie la ville à la bourse fictive : le terrain choisi donne un caractère et des bâtiments propres |
| Chaque membre a sa maison | La maison **appartient au joueur**, pas à la guilde. Son intérieur, c'est le QG actuel | On ne perd rien en quittant une guilde ; le QG existant devient l'intérieur de la maison |
| Acheter des fonctionnaires | Les fonctionnaires sont **payés chaque jour** (entretien) | Une dépense qui revient, pas un achat unique : c'est ce qui manque à l'économie actuelle |
| Écoles, hôpitaux… donnent des avantages | Avantages **petits et hors trading** : salaire, assurance, frais, confort, prestige | Le classement des gains doit rester une affaire de talent, pas de portefeuille |
| Fonds d'investissement qui verse 500 W par jour | Le fonds est **placé sur l'AUR-12** et verse un dividende par palier, seulement aux membres actifs | Le fonds vit avec le marché d'Aurelys ; les absents ne s'enrichissent pas |

---

## 1. La maison du joueur

### 1.1 Huit niveaux, visibles de loin

| Niv. | Nom | Prix | Ce qu'on voit |
| - | --- | --- | --- |
| 0 | Terrain nu | offert | une parcelle, une boîte aux lettres |
| 1 | Cabanon | 8 000 W | bois, une fenêtre, une lanterne |
| 2 | Maisonnette | 25 000 W | toit en tuiles, petit jardin |
| 3 | Maison de ville | 70 000 W | deux étages, balcon |
| 4 | Villa | 180 000 W | terrasse, piscine possible |
| 5 | Hôtel particulier | 450 000 W | cour pavée, grille en fer forgé |
| 6 | Manoir | 1 000 000 W | tourelles, parc, fontaine |
| 7 | Tour privée | 2 500 000 W | gratte-ciel fin, toit-terrasse illuminé |

- Le niveau de la maison remplace les logements du QG (chambre, studio, loft…) : intérieur et extérieur montent ensemble.
- Comme les logements actuels : ne se revend pas, compte pour 60 % dans le patrimoine, survit à la faillite.

### 1.2 Personnaliser (dépenses moyennes, en continu)

- **Style de façade** : portuaire (briques, Port-Aurel), montagnard (pierre et bois, Haut-Ombre), moderne (verre et béton), classique (pierre blonde, Castellane). Changer de style coûte une rénovation.
- **Extérieur** : jardin, potager, serre, piscine, garage avec une Vélisse électrique, ponton si la parcelle est au bord de l'eau, éolienne Hélvane sur le toit, statue de soi en bronze.
- **Lumières** : guirlandes, néons, projecteurs. Visibles la nuit d'Aurelys (voir §5).
- **Agrandir la parcelle** : 3 tailles. Une grande parcelle accueille plus d'objets.

### 1.3 Petits avantages de la maison

Uniquement du confort, jamais une meilleure cote :

- un emplacement de position « favori » de plus à chaque palier ;
- l'emplacement dans la ville : plus la maison est grande, plus elle est proche de la grand-place ;
- titres automatiques : « Propriétaire », « Notable », « Baron d'Aurelys ».

---

## 2. La ville : bâtiments communs

### 2.1 Le Trésor de la ville

- Chaque membre **verse** des W au Trésor quand il veut. Ces W ne reviennent jamais : c'est la grosse dépense du jeu.
- Chaque don est inscrit. Il y a un **classement des mécènes** dans la guilde, et une plaque gravée sur la mairie pour les plus gros donateurs.
- Le Trésor paie la construction des bâtiments et l'entretien des fonctionnaires.

### 2.2 Les bâtiments

Chaque bâtiment a 3 niveaux. La **mairie** plafonne le niveau de tous les autres.

| Bâtiment | Coût niv. 1 / 2 / 3 | Avantage pour chaque membre |
| --- | --- | --- |
| Mairie | 100 k / 400 k / 1,5 M | Débloque les autres niveaux. +5 places dans la guilde par niveau (30 → 45) |
| École | 150 k / 500 k / 1,5 M | Salaire de séance +10 / +20 / +30 % |
| Hôpital | 200 k / 600 k / 2 M | Une fois par jour, une position liquidée rend 15 / 25 / 35 % de sa mise (en plus de l'assurance du QG) |
| Bourse locale | 250 k / 800 k / 2,5 M | Frais d'ordre crypto et Aurelys −10 / −20 / −30 % |
| Port (ville côtière) | 300 k / 900 k / 3 M | Débloque le ponton, les bateaux et des déco marines ; +1 bonus « cote boostée » offert par semaine |
| Centrale (Hélvane) | 200 k / 700 k / 2 M | Les lumières de la ville restent allumées ; la nuit, +10 % de salaire aux membres actifs |
| Parc et fontaine | 80 k / 250 k / 800 k | Prestige seulement : arbres, bancs, promeneurs |
| Stade | 500 k / 1,5 M / 5 M | Débloque les défis entre guildes (§4) |
| Statue du fondateur | 1 M | Prestige pur, en or sur la grand-place |

Garde-fous :

- les avantages ne se cumulent pas au-delà d'un plafond par joueur (par exemple, salaire au plus +50 % en tout) ;
- **aucun bâtiment ne change une cote, un cours ou un levier**.

### 2.3 Les fonctionnaires (l'entretien)

- Chaque bâtiment demande des fonctionnaires : un directeur d'école, des médecins, un maire adjoint, des gardiens.
- Ils sont **payés chaque jour par le Trésor**, par exemple 1 % du coût du bâtiment par jour, partagé entre ses fonctionnaires.
- Trésor vide : les bâtiments **s'endorment**. Fenêtres éteintes, avantages coupés. Ils ne sont jamais détruits, et se réveillent dès que le Trésor est renfloué.
- Embaucher plus que le minimum donne un petit plus. Exemple : un deuxième médecin fait passer l'hôpital à deux remboursements par jour.
- Chaque fonctionnaire a un nom et une petite figurine dans la ville. On les voit marcher entre la mairie et leur bâtiment.

C'est la dépense qui revient : une ville ambitieuse doit continuer à jouer et à verser.

---

## 3. Le fonds d'investissement de la guilde

### 3.1 Principe

- Les membres versent des W au **Fonds**, à part du Trésor.
- Le Fonds est **placé sur la Bourse d'Aurelys** : sa valeur suit l'indice AUR-12, ou un panier de secteurs voté par les membres (tech, énergie, défensif…). Un krach à Aurelys fait baisser le Fonds de la ville, ce qui rend les actualités importantes pour tous.
- Les W versés **ne se retirent pas**. On ne touche que les dividendes.

### 3.2 Paliers de dividende

Chaque jour à minuit (heure de Paris), le Fonds verse à chaque membre **actif** (au moins un pari ce jour-là) :

| Valeur du Fonds | Dividende par membre actif et par jour |
| --- | --- |
| 250 000 W | 100 W |
| 1 000 000 W | 250 W |
| 3 000 000 W | 500 W |
| 10 000 000 W | 1 000 W + un bonus du QG au choix chaque semaine |

- Ce qui est versé chaque jour reste sous 0,5 % du Fonds : il faut environ 200 jours pour récupérer sa mise. Le Fonds retire donc des W du jeu au lieu d'en créer.
- Il faut être membre depuis 3 jours pour toucher le dividende, pour éviter qu'on saute de guilde en guilde.
- Le dividende ne compte pas dans le classement des gains : il ne vient pas d'un pari.

### 3.3 Visible dans la ville

La **tour du Fonds** grandit avec sa valeur. Elle a un écran géant qui affiche la courbe du Fonds en direct, en vert ou en rouge.

---

## 4. Faire vivre les villes entre elles

- **Classement des villes** par valeur : maisons, bâtiments et Fonds.
- **Concours de la plus belle ville**, chaque semaine : les joueurs votent pour une autre ville que la leur. La ville gagnante reçoit un monument unique pour la semaine (arc de triomphe, grande roue).
- **Défis entre guildes** (avec un stade) : deux villes s'affrontent sur les gains du jour. Mise prise sur les deux Trésors ; la ville gagnante prend le pot moins 10 % (dépense).
- **Visiter** : depuis le classement, on se promène dans la ville d'une autre guilde, et on entre dans les maisons, qui sont les QG.
- **Le maire** : il est élu chaque semaine par les membres et choisit l'ordre de construction. Le fondateur ne décide plus seul, et on évite qu'il exclue un gros donateur sur un coup de tête.

---

## 5. Le rendu : donner envie de construire

C'est le cœur du projet. Même moteur que le QG (Three.js, chargé seulement à l'ouverture), sans modèle externe : formes simples, mais soignées.

- **Vue isométrique** de la ville, à la façon d'un diorama posé sur une table. On tourne au doigt et on zoome jusqu'à une maison. Un appui sur une maison entre dans le QG de son propriétaire.
- **Jour et nuit synchronisés avec Aurelys** : une journée dure 24 minutes. Le soleil tourne, les ombres bougent. La nuit, les fenêtres s'allument une à une, avec les lampadaires et les néons achetés.
- **Fenêtres qui racontent** : une maison est éclairée quand son joueur est en ligne. Son toit clignote vert ou rouge quand il a une position qui gagne ou qui perd.
- **Chantiers animés** : une construction en cours montre un échafaudage, une grue et des ouvriers. Elle se termine au prochain « jour » d'Aurelys. Il y a une petite cérémonie avec confettis à l'inauguration.
- **Vie** : des promeneurs dans le parc, des bateaux au port, des voitures Vélisse dans les rues, de la fumée sur les cheminées en hiver. Tout passe par des objets instanciés, pour rester fluide sur téléphone.
- **Météo d'Aurelys** : pluie quand le régime du marché est « crise », soleil en « euphorie ». La ville respire avec la bourse.
- **Avant / après** : chaque achat montre la maison qui monte d'un niveau, en animation. C'est le moment de satisfaction.
- **Partage** : une photo de sa maison ou de sa ville à partager (piste 5 de CLAUDE.md).

---

## 6. Et les joueurs sans guilde ?

- Leur maison est dans **Port-Aurel**, la capitale. C'est une ville publique sans Trésor, avec des bâtiments déjà construits mais aux avantages réduits de moitié.
- En rejoignant une guilde, la maison **déménage** avec tout ce qu'elle contient. Elle revient à Port-Aurel si le joueur quitte la guilde.

---

## 7. Économie : ordres de grandeur

- Ce qui entre aujourd'hui : 500 W par séance jouée, et jusqu'à 130 séances par jour. Un joueur très actif gagne donc plusieurs dizaines de milliers de W par jour sans compter ses paris.
- Ce qui sort : il n'y a presque que les objets du QG, qu'on achète une fois. C'est pour ça qu'il faut des **dépenses sans fin** : Trésor, entretien, Fonds, rénovations.
- Règle : **chaque W qui revient (dividende, avantages) doit venir d'une dépense au moins 3 fois plus grosse**. On simule une guilde de 20 joueurs sur 60 jours avant de fixer les prix.
- Toujours **pas d'achat de W en argent réel**. La ville ne se paie qu'en jouant.

---

## 8. Ordre de construction proposé

1. **Maison du joueur** (§1) branchée sur le QG existant, et vue de la ville en 3D avec le jour et la nuit. C'est le plus visible, et ça donne envie dès le départ.
2. **Trésor, mairie, école, hôpital et fonctionnaires** (§2), avec l'entretien quotidien.
3. **Fonds d'investissement** sur l'AUR-12 (§3).
4. **Port-Aurel** pour les joueurs sans guilde (§6).
5. Concours, défis, maire élu (§4).

Chaque règle (coûts, entretien, dividendes, plafonds) dans le SQL d'abord, avec ses tests, comme le reste du jeu.

---

## Questions à trancher

1. La maison **remplace-t-elle** les logements du QG (chambre → penthouse), ou s'ajoute-t-elle à côté ?
2. Accepte-t-on des avantages qui touchent un peu le trading (frais −30 %, remboursement à l'hôpital), ou seulement le salaire et le prestige ?
3. Le Fonds suit-il l'AUR-12 (il peut baisser), ou est-il sans risque ?
4. Garde-t-on le maire élu, ou le fondateur reste-t-il seul à décider ?
