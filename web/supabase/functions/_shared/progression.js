// Progression du joueur (refonte de Victor, octobre 2026) : niveaux de trader, XP, levier, quêtes, pari du jour.
// Partagé par l'écran, les scripts de simulation et les tests. La base fait foi : les mêmes valeurs sont inscrites
// dans la migration 20261028400000_niveaux_quetes.sql, et tests/progression.test.js vérifie qu'elles sont identiques.

// ===== Niveaux =====
// XP pour passer du niveau n au suivant, interpolée entre ces points (niveau, XP) : rapide au début, lente ensuite.
// Calibrée par scripts/sim-xp.mjs (joueur régulier : niveau 2 dès la première séance, 5 vers J3, 12 vers 3 semaines,
// 25 vers 2 mois, 40 vers 5 mois).
export const XP_KNOTS = [[1, 40], [2, 80], [4, 110], [5, 240], [11, 470], [12, 600], [24, 1200], [25, 1250], [39, 1700], [60, 2200], [100, 3000]];
export const MAX_LEVEL = 100;
const stepOf = n => {
  const k = XP_KNOTS.findIndex(([l]) => l > n);
  if (k <= 0) return XP_KNOTS[k < 0 ? XP_KNOTS.length - 1 : 0][1];
  const [l0, x0] = XP_KNOTS[k - 1], [l1, x1] = XP_KNOTS[k];
  return Math.round((x0 + (x1 - x0) * (n - l0) / (l1 - l0)) / 10) * 10;
};
// XP_TOTAL[n] : XP cumulée pour atteindre le niveau n (XP_TOTAL[1] = 0).
export const XP_TOTAL = [null, 0];
for (let n = 1; n < MAX_LEVEL; n++) XP_TOTAL.push(XP_TOTAL[n] + stepOf(n));
export const levelOf = xp => { let n = 1; while (n < MAX_LEVEL && XP_TOTAL[n + 1] <= xp) n++; return n };

// ===== Levier =====
// Levier maximal = min(plafond de la société, palier de niveau, palier de ligue). Le niveau débloque pour toujours ;
// la ligue (H6) est un privilège du moment, vérifié à l'ouverture seulement (une position ouverte n'est jamais touchée).
export const LEVS = [1, 2, 5, 10, 15, 20];
export const LEV_LEVEL = { 1: 1, 2: 2, 5: 5, 10: 12, 15: 25, 20: 40 };
export const DIVISIONS = ["Bronze 1", "Bronze 2", "Bronze 3", "Argent 1", "Argent 2", "Argent 3", "Or 1", "Or 2", "Or 3",
  "Platine 1", "Platine 2", "Platine 3", "Diamant 1", "Diamant 2", "Diamant 3", "Maître"];
export const LEV_DIVISION = { 15: 9, 20: 12 }; // ×15 : Platine 1 ou plus ; ×20 : Diamant 1 ou plus
export const maxLevOf = (level, division = 0) => Math.max(...LEVS.filter(v => level >= LEV_LEVEL[v] && division >= (LEV_DIVISION[v] ?? 0)));

// ===== Autres déblocages =====
export const maxPosOf = level => Math.min(25, 5 + Math.floor((level - 1) / 2)); // positions Aurelys ouvertes en même temps
export const TRIGGER_LEVEL = 10, GUILD_LEVEL = 8, QUEST4_LEVEL = 20;
// Ce qu'un niveau débloque (bandeau « Niveau N ! ») ; avatars, cadres, titres et thèmes arrivent avec le profil (H2).
export function unlocksAt(n) {
  const out = LEVS.filter(v => LEV_LEVEL[v] === n).map(v => LEV_DIVISION[v] ? `levier ×${v} (en ligue ${DIVISIONS[LEV_DIVISION[v]]} ou plus)` : `levier ×${v}`);
  if (n > 1 && maxPosOf(n) > maxPosOf(n - 1)) out.push(`${maxPosOf(n)} positions en même temps`);
  if (n === TRIGGER_LEVEL) out.push("ordres à déclenchement");
  if (n === GUILD_LEVEL) out.push("créer une guilde");
  if (n === QUEST4_LEVEL) out.push("une 4e quête par jour");
  return out;
}

// ===== XP =====
export const XP = {
  quest: { easy: 30, medium: 50, hard: 80 },
  week: { easy: 150, medium: 250, hard: 400 },
  streak: { 3: 50, 7: 150, 30: 500 },     // série de jours avec au moins une quête
  pari: { vote: 10, right: 25, three: 40 },
  tuto: { howto: 10, fiche: 10, ordre: 20 }, // première séance : niveau 2
};

// ===== Quêtes =====
// [code, période, difficulté, objectif, condition, texte]. Condition : "lev10" (×10 débloqué), "guild" (membre d'une
// guilde), "pari" (pari du jour ouvert). Trade valide : mise de 100 W ou plus, tenu 150 s ou plus. Jamais de risque
// excessif : le levier le plus haut demandé est ×10.
export const QUESTS = [
  ["trade_1", "day", "easy", 1, null, "Clôturer un trade valide"],
  ["stop_1", "day", "easy", 1, null, "Poser un stop ou un objectif sur une position"],
  ["read_2", "day", "easy", 2, null, "Lire 2 articles du Courrier"],
  ["pari_vote", "day", "easy", 1, "pari", "Voter au pari du jour"],
  ["invest_1", "day", "easy", 1, null, "Acheter des actions (Investir)"],
  ["hold_10", "day", "easy", 1, null, "Tenir une position 10 minutes, puis la clôturer"],
  ["trade_3co", "day", "medium", 3, null, "Trader 3 sociétés différentes"],
  ["win_1", "day", "medium", 1, null, "Clôturer un trade valide gagnant"],
  ["real_1", "day", "medium", 1, null, "Trader une société liée aux données réelles (Granterre, Helvane, Lumirue)"],
  ["news_trade", "day", "medium", 1, null, "Lire une actualité, puis trader la même société dans l'heure"],
  ["trade_5", "day", "medium", 5, null, "Clôturer 5 trades valides"],
  ["short_1", "day", "medium", 1, null, "Clôturer un trade valide à la baisse (▼)"],
  ["hold_30", "day", "medium", 1, null, "Tenir une position 30 minutes, puis la clôturer"],
  ["guild_win", "day", "medium", 2, "guild", "Clôturer 2 trades gagnants pour l'objectif de ta guilde"],
  ["win_3", "day", "hard", 3, null, "Clôturer 3 trades valides gagnants"],
  ["trade_5co", "day", "hard", 5, null, "Trader 5 sociétés différentes"],
  ["gain_10", "day", "hard", 1, null, "Un trade valide à +10 % sur la mise"],
  ["real_3", "day", "hard", 3, null, "Clôturer 3 trades valides sur des sociétés liées aux données réelles"],
  ["lev10_win", "day", "hard", 1, "lev10", "Clôturer un trade valide gagnant à ×10"],
  ["news_trade_2", "day", "hard", 2, null, "Deux fois : lire une actualité, puis trader la même société dans l'heure"],
  ["trade_10", "day", "hard", 10, null, "Clôturer 10 trades valides"],
  ["results", "day", "hard", 1, null, "Ouvrir une position avant des résultats et la clôturer après, en gain"],
  ["w_trade_15", "week", "easy", 15, null, "Clôturer 15 trades valides"],
  ["w_days_3", "week", "easy", 3, null, "Trader 3 jours différents"],
  ["w_read_15", "week", "easy", 15, null, "Lire 15 articles du Courrier"],
  ["w_stop_5", "week", "easy", 5, null, "Clôturer 5 trades valides avec un stop ou un objectif posé"],
  ["w_win_8", "week", "medium", 8, null, "Clôturer 8 trades valides gagnants"],
  ["w_co_8", "week", "medium", 8, null, "Trader 8 sociétés différentes"],
  ["w_quests_10", "week", "medium", 10, null, "Réussir 10 quêtes du jour"],
  ["w_pari_5", "week", "medium", 5, "pari", "Voter 5 fois au pari du jour"],
  ["w_guild_10", "week", "medium", 10, "guild", "Clôturer 10 trades gagnants pour l'objectif de ta guilde"],
  ["w_days_5", "week", "hard", 5, null, "Trader 5 jours différents"],
  ["w_trade_40", "week", "hard", 40, null, "Clôturer 40 trades valides"],
  ["w_real_10", "week", "hard", 10, null, "Clôturer 10 trades valides sur des sociétés liées aux données réelles"],
  ["w_win_20", "week", "hard", 20, null, "Clôturer 20 trades valides gagnants"],
].map(([code, period, tier, goal, needs, text]) => ({ code, period, tier, goal, needs, text }));
export const QUEST_BY = Object.fromEntries(QUESTS.map(q => [q.code, q]));
