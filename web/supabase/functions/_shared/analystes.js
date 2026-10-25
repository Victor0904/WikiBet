// Analystes et tuyaux : valeurs par défaut. La base fait foi (table analyst_config, modifiable sur le VPS sans redéployer) ;
// tests/analystes.test.js vérifie qu'elle part de ces valeurs. Utilisé aussi par scripts/sim-analystes.mjs.
// Un tuyau porte sur le chiffre des prochains résultats d'une société (croissance du chiffre d'affaires, en points de %),
// jamais sur le cours : il est jugé à la publication, d'après le titre du Courrier (choix de Victor après la simulation).
export const TUYAU = {
  maxPerDay: 3,                                   // tuyaux par joueur et par jour (heure de Paris)
  wealthDiv: 50000, wealthCap: 9,                 // facteur patrimoine = 1 + min(patrimoine / wealthDiv, wealthCap)
  precision: [1, 1.4, 2, 3, 4.5],                 // facteur de prix des niveaux 1 à 5
  delta: [-.15, -.08, 0, .04, .07],               // probabilité d'être vrai = fiabilité + delta, bornée
  pMin: .45, pMax: .93,
  range: [0, 4, 2, 1, .5],                        // demi-largeur de la fourchette annoncée, en points (niveaux 2 à 5)
  noise: [0, 1.5, .8, .4, .2],                    // bruit sur le chiffre d'un tuyau vrai, en points
  decoy: [1, 6],                                  // écart d'un leurre, en points
  flat: .5,                                       // « conforme aux attentes » : écart de moins de 0,5 point (moteur)
  minLead: 60,                                    // plus de tuyau à moins d'une minute des résultats
  relMin: .55, relMax: .90, drift: .03,           // dérive du lundi
  disgrace: .7,                                   // prix en disgrâce (−30 %)
};
export const tuyauPrice = (base, networth, level, disgrace = false, C = TUYAU) =>
  Math.round(base * (1 + Math.min(Math.max(networth, 0) / C.wealthDiv, C.wealthCap)) * C.precision[level - 1] * (disgrace ? C.disgrace : 1));
export const tuyauProb = (rel, level, C = TUYAU) => Math.min(C.pMax, Math.max(C.pMin, rel + C.delta[level - 1]));
export const sideOf = (fig, cons, C = TUYAU) => Math.abs(fig - cons) < C.flat ? "flat" : fig > cons ? "up" : "down";

// Tuyau tiré à l'achat (la base fait de même dans rumor_buy). act : vrai chiffre caché, cons : consensus.
export function drawTuyau(act, cons, rel, level, R = Math.random, g = () => 0, C = TUYAU) {
  const isTrue = R() < tuyauProb(rel, level, C), truth = sideOf(act, cons, C), u = C.decoy[0] + R() * (C.decoy[1] - C.decoy[0]);
  // Bruit borné à 80 % de la fourchette : un tuyau vrai est toujours jugé juste (sauf retouche du chiffre par le moteur).
  if (isTrue) return { isTrue, dir: truth, fig: level > 1 ? act + Math.max(-.8, Math.min(.8, C.noise[level - 1] * g() / C.range[level - 1])) * C.range[level - 1] : null };
  // Leurre : sens faux, ou bon sens mais chiffre exagéré (moitié-moitié ; toujours un sens faux au niveau 1).
  if (level > 1 && truth !== "flat" && R() < .5) return { isTrue, dir: truth, fig: act + (truth === "up" ? 1 : -1) * (C.range[level - 1] + u) };
  const dir = truth === "flat" ? (R() < .5 ? "up" : "down") : truth === "up" ? "down" : "up";
  return { isTrue, dir, fig: level > 1 ? cons + (dir === "up" ? 1 : -1) * (C.flat + u) : null };
}
// Jugé sur le chiffre publié : bon sens, et chiffre dans la fourchette annoncée (niveaux 2 à 5).
export const tuyauOk = (x, level, r, C = TUYAU) => r.side === x.dir && (level === 1 || Math.abs(r.pub - x.fig) <= C.range[level - 1]);
// Titre du Courrier : « Nexora Systems : chiffre d'affaires +11,8 %, au-dessus des +4,5 % attendus » (results() du moteur).
export function parseResults(title) {
  const n = s => (s[0] === "−" ? -1 : 1) * +s.slice(1).replace(",", ".");
  const m = title.match(/chiffre d'affaires ([+−]\d+,\d) %, (conforme|au-dessus|en dessous)(?: des ([+−]\d+,\d) % attendus)?/);
  return m && { pub: n(m[1]), side: m[2] === "conforme" ? "flat" : m[2] === "au-dessus" ? "up" : "down", cons: m[3] ? n(m[3]) : null };
}

// [slug, nom, fiabilité cachée, prix de base, spécialités (vide = toutes)]
export const ANALYSTS = [
  ["hibou", "Le Hibou", .86, 800, ["NXR", "PXF", "VLS"]],
  ["varlet", "Varlet & Associés", .74, 400, ["BCS", "FRC", "MRV"]],
  ["meteo", "Madame Météo", .80, 300, ["GTR", "HLV", "LMR"]],
  ["gazette", "La Gazette du Port", .65, 100, []],
  ["solar", "Solal", .70, 200, ["SLM", "OMB", "KST"]],
  ["ondeo", "L'Oreille", .78, 270, ["OND", "PXF"]],
];
