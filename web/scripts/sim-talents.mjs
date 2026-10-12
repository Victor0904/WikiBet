// Équilibrage de l'arbre de talents : node scripts/sim-talents.mjs (environ 1 min)
// Modèle statistique, pas la simulation complète : volatilités, impact (`slip`) et frais viennent du moteur ; les cours
// suivent une marche à queues épaisses (Student à 4 degrés), volatilité réalisée ×2 (nouvelles, voir measure-aurelys).
// A. Joueur qui joue au hasard : espérance d'une position avec chaque combinaison de talents de coût, puis la meilleure
//    « ferme » de l'Amortisseur (une position par jour réel faite pour être liquidée). B. 30 jours réels pour un débutant,
//    un joueur moyen et un très bon joueur : valeur de chaque talent au maximum. Valeurs validées par Victor (octobre 2026).
import { STOCKS, slip, FEE, CAP_MULT } from "../supabase/functions/_shared/aurelys.js";

let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 };
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const t4 = () => { const c = gauss() ** 2 + gauss() ** 2 + gauss() ** 2 + gauss() ** 2; return gauss() / Math.sqrt(c / 4) / Math.SQRT2 }; // variance 1
const VR = 2, STEP = 10; // volatilité réalisée / affichée ; pas de 10 min d'Aurelys
// Amortisseur (migration 20261027500000_reglages.sql) : la position est clôturée quand elle ne vaut plus que 3 % de sa mise par
// rang, et ce reste est rendu. Salaire : plein sous 20 000 W de patrimoine, nul à 100 000 W (salary_factor).
const SAL = w => Math.min(1, Math.max(0, (100000 - w) / 80000));
const DISC = .025, FEES = .05;
// Niveau : 2 500 W de gain net par niveau jusqu'au 5, 5 000 W jusqu'au 15, puis 10 000 W (même calcul que talent_level en SQL).
export const levelOf = h => h < 12500 ? Math.floor(Math.max(0, h) / 2500) : h < 62500 ? 5 + Math.floor((h - 12500) / 5000) : 15 + Math.floor((h - 62500) / 10000);

// Une position : paiement, gain net (frais d'ouverture compris), liquidée ou non. T = talents (rangs).
function trade(s, dir, lev, stake, hold, edge, T, kraken) {
  const n = stake * lev, cut = 1 - DISC * (T.disc ?? 0), fee = Math.max(1, n * FEE * (1 - FEES * (T.fees ?? 0)));
  const sl0 = kraken ? 0 : slip(null, s.tk, n) * cut, sl1 = slip(null, s.tk, n) * cut;
  const sd = s.sig / Math.sqrt(1440) * VR * Math.sqrt(STEP), steps = Math.max(1, Math.round(hold / STEP));
  const mu = edge * sd * Math.sqrt(steps) / steps; // avance du joueur : `edge` écart type sur toute la durée, dans son sens
  let r = Math.log(1 + dir * sl0); // r = ln(entrée / cours) ; l'entrée est dégradée par l'impact
  const keep = .03 * (T.amort ?? 0), val = r => 1 + lev * dir * (Math.exp(-r) - 1) - keep; // valeur au-dessus du seuil de clôture
  // Seuil de liquidation ; entre deux pas, probabilité de l'avoir touché (pont brownien), sinon les allers-retours
  // manqués au travers du seuil donnent une espérance positive qui n'existe pas en jeu (cours à la seconde).
  const rb = -Math.log(1 - dir * (1 - keep) / lev), side = Math.sign(rb);
  for (let i = 0; i < steps; i++) {
    const r0 = r, u = rnd(); r -= dir * mu + sd * t4(); // tirages identiques d'une combinaison de talents à l'autre
    const d0 = side * (rb - r0), d1 = side * (rb - r);
    if (val(r) <= 0 || d1 <= 0 || u < Math.exp(-2 * d0 * d1 / (sd * sd))) return { net: keep * stake - stake - fee, liq: 1 };
  }
  const exit = Math.exp(-r) * (1 - dir * sl1), pay = Math.max(0, stake * (1 + lev * dir * (exit - 1)) - fee);
  return { net: pay - stake - fee, liq: 0 };
}

// ===== A. Joueur au hasard =====
const core = STOCKS;
const evOf = (lev, hold, stake, T, kraken = false, N = 60000) => {
  seed = 7; let net = 0, liq = 0;
  for (let i = 0; i < N; i++) { seed = 7 + i * 7919; const x = trade(core[i % core.length], rnd() < .5 ? 1 : -1, lev, stake, hold, 0, T, kraken); net += x.net; liq += x.liq }
  return { ev: net / N, liq: liq / N };
};
const COMBOS = { "aucun": [{}, false], "Frais 5": [{ fees: 5 }, false], "Discrétion 4": [{ disc: 4 }, false], "Frais 5 + Discrétion 4": [{ fees: 5, disc: 4 }, false],
  "+ Kraken (borne haute : chaque ordre sans impact)": [{ fees: 5, disc: 4 }, true] };
console.log("A1. Espérance d'une position de 1 000 W jouée au hasard (% de la mise), talents de coût au maximum");
let worst = -Infinity;
for (const lev of [1, 5, 10, 15, 25]) for (const hold of [60, 360, 1440]) {
  const base = evOf(lev, hold, 1000, {});
  const cells = Object.entries(COMBOS).map(([k, [T, kr]]) => { const e = evOf(lev, hold, 1000, T, kr); worst = Math.max(worst, e.ev / 10); return `${k} ${(e.ev / 10).toFixed(2)}` });
  console.log(`  ×${String(lev).padStart(2)}, ${String(hold / 60).padStart(2)} h : ${cells.join(" | ")}`);
}
console.log(`  → la meilleure combinaison reste à ${worst.toFixed(2)} % par position`);
console.log("\nA2. Ferme de l'Amortisseur (5 rangs) : une seule position par jour réel, faite pour être liquidée, avec Frais 5 + Discrétion 4 + Kraken");
let farm = { ev: -Infinity };
for (const lev of [10, 15, 25]) for (const hold of [360, 1440]) for (const stake of [2000, 5000, 10000, 50000]) {
  const e = evOf(lev, hold, stake, { fees: 5, disc: 4, amort: 5 }, true, 20000), day = e.ev;
  if (day > farm.ev) farm = { ev: day, lev, hold, stake, liq: e.liq };
}
console.log(`  Meilleure : ×${farm.lev}, ${farm.hold / 60} h, ${farm.stake} W → ${farm.ev >= 0 ? "+" : ""}${Math.round(farm.ev)} W par jour (liquidée ${Math.round(farm.liq * 100)} % des fois)`);

// ===== B. 30 jours réels =====
const PROFILES = {
  "débutant (au hasard)": { days: 30, trades: 12, sessions: 5, stakeP: .05, lev: 10, hold: 90, edge: 0, aurDays: 1, pos: 5 },
  moyen: { days: 30, trades: 20, sessions: 8, stakeP: .06, lev: 10, hold: 90, edge: .12, aurDays: 2, pos: 8 },
  "très bon": { days: 30, trades: 40, sessions: 16, stakeP: .08, lev: 15, hold: 120, edge: .25, aurDays: 3, pos: 12 },
};
const TALENTS = {
  "aucun": {}, "Frais réduits 5": { fees: 5 }, "Amortisseur 5": { amort: 5 },
  "Argent passif 6 + Rentier": { rente: 6, rentier: 1 }, "Fidélité 5": { fid: 5 }, "Dividendes 5": { div: 5 },
  "Multitâche 3": { multi: 3 }, "Discrétion 4": { disc: 4 }, "Gros calibre 3": { cal: 3 }, "Kraken": { kraken: 1 },
  "Prudence + Audace au max": { fees: 5, amort: 5, disc: 4, multi: 3, kraken: 1 },
};
const RENTE = [0, 10, 20, 30, 50, 70, 100];
function month(P, T, run) {
  seed = 1000 + run; let cash = 10000, cum = 0, hwm = 0, bk = 0; const hold = 30000; // le très bon joueur garde 30 000 W en actions (rendement 3 %)
  const extra = { rente: 0, sal: 0, div: 0, amort: 0 };
  for (let d = 0; d < P.days; d++) {
    const nT = Math.round(P.trades * (T.multi ? (P.pos + T.multi) / P.pos : 1)); let won = false, stakes = 0;
    for (let i = 0; i < nT; i++) {
      const s = core[Math.floor(rnd() * core.length)], dir = rnd() < .5 ? 1 : -1;
      const cap = CAP_MULT * s.L * (1 + .1 * (T.cal ?? 0)), stake = Math.min(cash * P.stakeP, cap / P.lev);
      const x = trade(s, dir, P.lev, stake, P.hold, P.edge, T, !!T.kraken && i < P.aurDays); // un ordre sans impact par jour d'Aurelys
      cash += x.net; cum += x.net; hwm = Math.max(hwm, cum); stakes += stake; if (x.net > 0) won = true;
      if (cash < 2000) { cash = 10000; bk++ }
    }
    const wealth = cash + (P.edge ? hold : 0), f = SAL(wealth), boost = 1 + .05 * (T.fid ?? 0);
    const sal = P.sessions * Math.min(500 * boost, stakes / P.sessions * .1 * boost) * f; cash += sal; extra.sal += sal;
    const rente = RENTE[T.rente ?? 0] * (T.rentier && won ? 2 : 1); cash += rente; extra.rente += rente; // par jour réel
    if (P.edge) { const dv = hold * .03 / 365 * 24 * (1 + .05 * (T.div ?? 0)); cash += dv; extra.div += dv } // 24 jours d'Aurelys par jour réel
  }
  return { cash, level: levelOf(hwm), bk, ...extra };
}
console.log("\nB. 30 jours réels, moyenne de 300 joueurs (chaque talent au maximum dès le premier jour, mêmes tirages)");
for (const [name, P] of Object.entries(PROFILES)) {
  const runs = 300, avg = T => { const a = { cash: 0, level: 0, bk: 0, sal: 0 }; for (let r = 0; r < runs; r++) { const m = month(P, T, r); for (const k in a) a[k] += m[k] / runs } return a };
  const base = avg({});
  console.log(`  Joueur ${name} : solde final ${Math.round(base.cash)} W, niveau ${base.level.toFixed(1)}, faillites ${base.bk.toFixed(1)}, salaire ${Math.round(base.sal)} W`);
  for (const [k, T] of Object.entries(TALENTS)) if (k !== "aucun") {
    const a = avg(T), d = a.cash - base.cash;
    console.log(`    ${k.padEnd(26)} ${d >= 0 ? "+" : ""}${Math.round(d)} W en 30 jours (${Math.round(100 * d / base.cash)} %), niveau ${a.level.toFixed(1)}`);
  }
}

// ===== C. Points de talent avec les succès, à 7, 30 et 90 jours =====
// Les succès liés au trading sont tirés des trades simulés ; le reste suit des hypothèses (LIFE) : jours joués, humeur du
// marché, articles lus, logement, guilde, filleuls, classements de la semaine. Points : même liste que la migration
// 20261027300000_succes.sql (les autres succès sont des badges à 0 point, qui comptent pour Collectionneur et Légende).
// Points validés par Victor (octobre 2026) : seuls les succès difficiles rapportent (21 points) ; avec la liste d'origine
// (36 points), 78 % des points d'un joueur moyen à 30 jours venaient des succès, contre 26 % ainsi.
const PTS = { FIRST_TRADE: 1, SERIE_10: 2, COUP_50: 1, COUP_100: 2, MAIN_FER: 1, ASSIDU_30: 2, GAIN_100K: 1, GAIN_500K: 1, GAIN_1M: 2, PAT_1M: 1,
  SURPRISES: 1, MENTOR: 1, TOP_10: 1, CHAMPION: 2, LEGENDE: 2 };
const CAP = Object.values(PTS).reduce((a, b) => a + b, 0);
if (CAP !== 21) throw new Error("points des succès : 21 attendus");
const LIFE = {
  moyen: { ...PROFILES.moyen, play: .85, reads: 2, home: 3, guild: 2, ref: null, top100: .3, top10: 0, champion: 0, guildTop3: .15, stops: 0 },
  "gros joueur": { ...PROFILES["très bon"], play: .97, reads: 5, home: 1, guild: 1, ref: 20, top100: 1, top10: .5, champion: .1, guildTop3: .4, stops: .3 },
};
const HOLD_S = P => P.hold * 2.5; // secondes réelles
function career(P, run, days = 90) {
  seed = 5000 + run; let cash = 10000, cum = 0, hwm = 0, streak = 0, zl = 0, valid = 0, stops = 0, surprises = 0, run_days = 0, target = null;
  const got = new Set(), won = {}, snaps = {};
  const pts = () => Math.min(CAP, [...got].reduce((a, c) => a + (PTS[c] ?? 0), 0));
  const give = c => got.add(c);
  for (let d = 1; d <= days; d++) {
    const played = rnd() < P.play; let lmrWin = false;
    if (played) {
      for (let i = 0; i < P.trades; i++) {
        const s = core[Math.floor(rnd() * core.length)], dir = rnd() < .5 ? 1 : -1, stake = Math.min(cash * P.stakeP, CAP_MULT * s.L / P.lev);
        const before = cash, x = trade(s, dir, P.lev, stake, P.hold, P.edge, {}, false), w = x.net > 0;
        cash += x.net; cum += x.net; hwm = Math.max(hwm, cum); valid++; give("FIRST_TRADE"); give("SALAIRE");
        streak = w ? streak + 1 : 0; zl = x.liq ? 0 : zl + 1;
        if (x.liq && target == null) target = before;
        if (rnd() < P.stops) stops++;
        if (w) {
          give("FIRST_GREEN"); (won[s.tk] ??= 0); won[s.tk]++; if (s.tk === "LMR") lmrWin = true;
          if (rnd() < .5) give("INDICIEL");
          const r = rnd(); if ((dir > 0 && r < .12) || (dir < 0 && r > .88)) give("CONTRARIEN"); // ouvert en Nervosité (à la hausse) ou en Euphorie (à la baisse)
          if (rnd() < HOLD_S(P) / (7 * 3600)) { give("SNIPER"); if (rnd() < .7) surprises++ } // résultats de la société pendant la position
          if (rnd() < .02) give("BIEN_INFORME");
        }
        if (streak >= 5) give("SERIE_5"); if (streak >= 10) give("SERIE_10"); if (zl >= 100) give("ZERO_LIQ");
        if (cash < 2000) { cash = 10000; target = null }
      }
      const f = SAL(cash); cash += Math.min(500 * P.sessions, P.trades * cash * P.stakeP * .1) * f; // salaire
    }
    run_days = played ? run_days + 1 : 0;
    if (run_days >= 7) { give("ASSIDU_7"); give("FIDELE") } if (run_days >= 30) give("ASSIDU_30");
    if (lmrWin && rnd() < 11 / 365) give("FERIE");
    if (valid >= 50) give("SCALPEUR"); if (valid >= 500) give("VETERAN");
    if (stops >= 20) give("DISCIPLINE"); if (surprises >= 5) give("SURPRISES");
    for (const [tk, c] of [["GTR", "AGRONOME"], ["HLV", "ELECTRICIEN"], ["LMR", "FLANEUR"]]) if ((won[tk] ?? 0) >= 5) give(c);
    if (core.every(s => won[s.tk])) give("TOUS_SECTEURS");
    if (P.trades >= 5 && d >= 2) give("DIVERSIFIE");
    if (P.reads * d >= 20) give("LECTEUR"); if (d >= P.home) give("PROPRIO"); if (d >= P.guild) give("GUILDE");
    for (const [h, c] of [[10000, "GAIN_10K"], [50000, "GAIN_50K"], [100000, "GAIN_100K"], [500000, "GAIN_500K"], [1e6, "GAIN_1M"]]) if (hwm >= h) give(c);
    if (cash >= 250000) give("PAT_250K"); if (cash >= 1e6) give("PAT_1M");
    if (target != null && cash > target) { give("RENAISSANCE"); target = null }
    if (P.ref && d >= P.ref) give("PARRAIN");
    if (d % 7 === 0) {
      if (rnd() < P.top100) give("TOP_100"); if (rnd() < P.top10) give("TOP_10"); if (rnd() < P.champion) give("CHAMPION");
      if (rnd() < P.guildTop3) give("GUILDE_TOP3");
    }
    const all = levelOf(hwm) + pts();
    if (all >= 11) give("SPECIALISTE"); if (all >= 24) give("POLYVALENT");
    if (got.size >= 25) give("COLLECTIONNEUR"); if (got.size >= 45) give("LEGENDE");
    if ([7, 30, 90].includes(d)) snaps[d] = { level: levelOf(hwm), ach: pts(), n: got.size, got: [...got] };
  }
  return snaps;
}
console.log("\nC. Points de talent : niveau (gain net) + succès (21 au plus), moyenne de 200 joueurs");
for (const [name, P] of Object.entries(LIFE)) {
  const acc = { 7: { level: 0, ach: 0, n: 0 }, 30: { level: 0, ach: 0, n: 0 }, 90: { level: 0, ach: 0, n: 0 } }, runs = 200;
  const freq = {};
  for (let r = 0; r < runs; r++) { const s = career(P, r); for (const d in acc) for (const k in acc[d]) acc[d][k] += s[d][k] / runs; for (const c of s[30].got) freq[c] = (freq[c] ?? 0) + 1 / runs }
  console.log(`  Joueur ${name}`);
  for (const d of [7, 30, 90]) {
    const a = acc[d], tot = a.level + a.ach;
    console.log(`    ${String(d).padStart(2)} jours : niveau ${a.level.toFixed(1)} + succès ${a.ach.toFixed(1)} pts (${a.n.toFixed(0)} succès) = ${tot.toFixed(1)} points, dont ${Math.round(100 * a.ach / tot)} % par les succès`);
  }
  console.log("    Succès à points obtenus à 30 jours (part des joueurs) : " + Object.entries(freq).filter(([c]) => PTS[c]).sort((a, b) => b[1] - a[1]).map(([c, p]) => `${c} ${PTS[c]} pt ${Math.round(100 * p)} %`).join(", "));
}
