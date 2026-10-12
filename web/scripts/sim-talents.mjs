// Équilibrage de l'arbre de talents (avant de figer les valeurs) : node scripts/sim-talents.mjs
// Modèle statistique, pas la simulation complète : volatilités, impact (`slip`) et frais viennent du moteur ; les cours
// suivent une marche à queues épaisses (Student à 4 degrés), volatilité réalisée ×2 (nouvelles, voir measure-aurelys).
// A. Espérance d'une position pour un joueur SANS talent de lecture (direction au hasard) : un talent ne doit jamais la
//    rendre positive. B. 30 jours réels pour un joueur moyen et un très bon joueur : valeur de chaque talent au maximum.
import { STOCKS, slip, FEE, CAP_MULT } from "../supabase/functions/_shared/aurelys.js";

let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 };
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const t4 = () => { const c = gauss() ** 2 + gauss() ** 2 + gauss() ** 2 + gauss() ** 2; return gauss() / Math.sqrt(c / 4) / Math.SQRT2 }; // variance 1
const VR = 2, STEP = 10; // volatilité réalisée / affichée ; pas de 10 min d'Aurelys

// Une position : renvoie le paiement et le gain net (frais d'ouverture compris). T = talents (rangs).
function trade(s, dir, lev, stake, hold, edge, T, kraken) {
  const n = stake * lev, cut = 1 - .05 * (T.disc ?? 0), fee = Math.max(1, n * FEE * (1 - .05 * (T.fees ?? 0)));
  const sl0 = kraken ? 0 : slip(null, s.tk, n) * cut, sl1 = slip(null, s.tk, n) * cut;
  const sd = s.sig / Math.sqrt(1440) * VR * Math.sqrt(STEP), steps = Math.max(1, Math.round(hold / STEP));
  const mu = edge * sd * Math.sqrt(steps) / steps; // avance du joueur : `edge` écart type sur toute la durée, dans son sens
  let r = Math.log(1 + dir * sl0); // prix d'entrée dégradé par l'impact
  const val = r => 1 + lev * dir * (Math.exp(-r) - 1); // valeur / mise, cours relatif à l'entrée
  // Seuil de liquidation (r = ln(entrée / cours)) ; entre deux pas, probabilité de l'avoir touché (pont brownien),
  // sinon les allers-retours manqués au travers du seuil donnent une espérance positive qui n'existe pas en jeu (cours à la seconde).
  const rb = -Math.log(1 - dir / lev), side = Math.sign(rb);
  for (let i = 0; i < steps; i++) {
    const r0 = r; r -= dir * mu + sd * t4();
    const d0 = side * (rb - r0), d1 = side * (rb - r);
    if (val(r) <= 0 || d1 <= 0 || rnd() < Math.exp(-2 * d0 * d1 / (sd * sd))) { const pay = stake * .03 * (T.amort ?? 0); return { pay, net: pay - stake - fee, liq: 1 } }
  }
  const exit = Math.exp(-r) * (1 - dir * sl1), pay = Math.max(0, stake * (1 + lev * dir * (exit - 1)) - fee);
  return { pay, net: pay - stake - fee, liq: 0, fees: 2 * fee, slip: n * (sl0 + sl1) };
}

// ===== A. Espérance par position, direction au hasard =====
const core = STOCKS;
const evOf = (lev, hold, T, N = 120000) => {
  seed = 7; let net = 0, liq = 0;
  for (let i = 0; i < N; i++) { const s = core[i % core.length], x = trade(s, rnd() < .5 ? 1 : -1, lev, 1000, hold, 0, T, false); net += x.net; liq += x.liq }
  return { ev: net / N / 1000, liq: liq / N };
};
const BUILDS = { "aucun talent": {}, "Amortisseur 5 + Frais 5": { amort: 5, fees: 5 }, "+ Discrétion 4": { amort: 5, fees: 5, disc: 4 } };
console.log("A. Espérance d'une position de 1 000 W, direction au hasard (en % de la mise ; probabilité de liquidation)");
for (const lev of [5, 10, 15, 25]) for (const hold of [60, 360, 1440]) {
  const cells = Object.entries(BUILDS).map(([k, T]) => { const e = evOf(lev, hold, T); return `${k} ${(e.ev * 100).toFixed(1)} % (liq ${(e.liq * 100).toFixed(0)} %)` });
  console.log(`  ×${lev}, ${hold / 60} h d'Aurelys : ${cells.join(" | ")}`);
}

// ===== B. 30 jours réels =====
const PROFILES = {
  "débutant (au hasard)": { days: 30, trades: 12, sessions: 5, stakeP: .05, lev: 10, hold: 90, edge: 0, aurDays: 1, pos: 5 },
  moyen: { days: 30, trades: 20, sessions: 8, stakeP: .06, lev: 10, hold: 90, edge: .12, aurDays: 2, pos: 8 },
  "très bon": { days: 30, trades: 40, sessions: 16, stakeP: .08, lev: 15, hold: 120, edge: .25, aurDays: 3, pos: 12 },
};
const TALENTS = {
  "aucun": {}, "Frais réduits 5": { fees: 5 }, "Amortisseur 5": { amort: 5 }, "Phénix": { phenix: 1 },
  "Argent passif 6 + Rentier": { rente: 6, rentier: 1 }, "Fidélité 5": { fid: 5 }, "Dividendes 5": { div: 5 },
  "Multitâche 3": { multi: 3 }, "Discrétion 4": { disc: 4 }, "Gros calibre 3": { cal: 3 }, "Kraken": { kraken: 1 },
};
const RENTE = [0, 10, 20, 30, 50, 70, 100];
function month(P, T, run) {
  seed = 1000 + run; let cash = 10000, cum = 0, hwm = 0, bk = 0, hold = 30000; // le très bon joueur garde 30 000 W en actions (rendement 3 %)
  const extra = { rente: 0, sal: 0, div: 0 };
  for (let d = 0; d < P.days; d++) {
    const nT = Math.round(P.trades * (T.multi ? (P.pos + T.multi) / P.pos : 1)); let won = false, stakes = 0;
    for (let i = 0; i < nT; i++) {
      const s = core[Math.floor(rnd() * core.length)], dir = rnd() < .5 ? 1 : -1;
      const cap = CAP_MULT * s.L * (1 + .1 * (T.cal ?? 0)), stake = Math.min(cash * P.stakeP, cap / P.lev);
      const k = !!T.kraken && i < P.aurDays; // un ordre sans impact par jour d'Aurelys
      const x = trade(s, dir, P.lev, stake, P.hold, P.edge, T, k);
      cash += x.net; cum += x.net; hwm = Math.max(hwm, cum); stakes += stake; if (x.net > 0) won = true;
      if (cash < 2000) { cash = T.phenix ? 15000 : 10000; bk++ }
    }
    // Salaire : 10 % des mises de la séance, 500 W au plus (Fidélité : +5 % par rang, plafond relevé d'autant), dégressif.
    const wealth = cash + (P.edge ? hold : 0), f = Math.min(1, Math.max(0, (100000 - wealth) / 80000)), boost = 1 + .05 * (T.fid ?? 0);
    const sal = P.sessions * Math.min(500 * boost, stakes / P.sessions * .1 * boost) * f; cash += sal; extra.sal += sal;
    const rente = RENTE[T.rente ?? 0] * (T.rentier && won ? 2 : 1); cash += rente; extra.rente += rente; // par jour réel
    if (P.edge) { const dv = hold * .03 / 365 * 24 * (1 + .05 * (T.div ?? 0)); cash += dv; extra.div += dv } // 24 jours d'Aurelys par jour réel
  }
  return { cash, level: Math.floor(hwm / 10000), bk, ...extra };
}
console.log("\nB. 30 jours réels, moyenne de 300 joueurs (chaque talent au maximum dès le premier jour, mêmes tirages)");
for (const [name, P] of Object.entries(PROFILES)) {
  const runs = 300, avg = T => { const a = { cash: 0, level: 0, bk: 0, sal: 0, rente: 0, div: 0 }; for (let r = 0; r < runs; r++) { const m = month(P, T, r); for (const k in a) a[k] += m[k] / runs } return a };
  const base = avg({});
  console.log(`  Joueur ${name} : solde final ${Math.round(base.cash)} W, niveau ${base.level.toFixed(1)}, faillites ${base.bk.toFixed(1)}, salaire ${Math.round(base.sal)} W`);
  for (const [k, T] of Object.entries(TALENTS)) if (k !== "aucun") {
    const a = avg(T), d = a.cash - base.cash;
    console.log(`    ${k.padEnd(26)} ${d >= 0 ? "+" : ""}${Math.round(d)} W en 30 jours (${d >= 0 ? "+" : ""}${Math.round(d / 30)} W/jour), niveau ${a.level.toFixed(1)}`);
  }
}
