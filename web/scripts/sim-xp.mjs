// Calibre la courbe d'XP (supabase/functions/_shared/progression.js) : `node scripts/sim-xp.mjs`.
// 1 000 joueurs par profil, 200 jours. Sources d'XP de H3 à H5 (quêtes, série, pari du jour, tutoriel) et, à part, celles
// prévues ensuite (saisons H6, guilde H7, succès H8) avec leurs valeurs du cahier des charges, pour que la courbe reste la
// bonne quand elles arriveront (une courbe qu'on durcit plus tard ferait baisser des niveaux).
// Probabilités de réussite : estimées, à revoir avec les vrais chiffres dès que les quêtes tournent.
import { XP, XP_TOTAL, levelOf, LEV_LEVEL, QUEST4_LEVEL } from "../supabase/functions/_shared/progression.js";

const PROFILES = {
  // jours joués par semaine (lundi = 0), réussite des quêtes du jour et de la semaine (facile, moyenne, difficile), pari.
  casual: { days: [0, 2, 5], day: [.9, .6, .3], week: [.6, .3, .1], pari: .8 },
  regulier: { days: [0, 1, 2, 3, 4, 5, 6], day: [.95, .8, .55], week: [.9, .7, .45], pari: .9 },
  hardcore: { days: [0, 1, 2, 3, 4, 5, 6], day: [.99, .95, .85], week: [.98, .9, .8], pari: .99 },
};
const FUTURE = process.argv.includes("--sans-futur") ? false : true;
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function player(p, days = 200) {
  let xp = XP.tuto.howto + XP.tuto.fiche + XP.tuto.ordre, streak = 0, graceWeek = -1, pariRun = 0;
  const reach = {};
  for (let d = 0; d < days; d++) {
    const dow = d % 7, week = Math.floor(d / 7), plays = p.days.includes(dow);
    let quests = 0;
    if (plays) {
      const lvl = levelOf(xp), tiers = ["easy", "medium", "hard", ...(lvl >= QUEST4_LEVEL ? ["medium"] : [])];
      tiers.forEach((t, i) => { if (rnd() < p.day[i === 3 ? 1 : i]) { xp += XP.quest[t]; quests++ } });
      if (rnd() < p.pari) { xp += XP.pari.vote; if (rnd() < .5) { xp += XP.pari.right; if (++pariRun % 3 === 0) xp += XP.pari.three } else pariRun = 0 }
    }
    // Série : un jour sans quête est pardonné une fois par semaine.
    if (quests) { streak++; for (const k of [3, 7, 30]) if (streak === k) xp += XP.streak[k] }
    else if (graceWeek !== week) graceWeek = week; else streak = 0;
    if (dow === 6) { // fin de semaine : quêtes de la semaine, et (prévu) saison, guilde, succès
      ["easy", "medium", "hard"].forEach((t, i) => { if (rnd() < p.week[i] * Math.min(1, p.days.length / 5)) xp += XP.week[t] });
      if (FUTURE) {
        if (p.days.length) xp += 60 + (rnd() < .15 ? 100 : rnd() < .06 ? 200 : 0); // saison : participation, division(s) gagnée(s)
        if (rnd() < .5) xp += 50;                                                   // objectif de guilde atteint
        xp += week === 0 ? 300 : 60;                                                 // succès (beaucoup la 1re semaine)
      }
    }
    const l = levelOf(xp);
    for (const t of [2, 5, 12, 25, 40]) if (l >= t && reach[t] == null) reach[t] = d + 1;
  }
  return reach;
}

const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length < a.length / 2 ? null : s[Math.floor(a.length / 2)] };
console.log(`Courbe : niveau 2 = ${XP_TOTAL[2]} XP, 5 = ${XP_TOTAL[5]}, 12 = ${XP_TOTAL[12]}, 25 = ${XP_TOTAL[25]}, 40 = ${XP_TOTAL[40]}, 50 = ${XP_TOTAL[50]}`);
console.log(`Sources prévues (H6 à H8) : ${FUTURE ? "comptées" : "non comptées"}`);
console.log("Jours (médiane) pour atteindre le niveau :");
for (const [name, p] of Object.entries(PROFILES)) {
  const runs = Array.from({ length: 1000 }, () => player(p));
  const row = [2, 5, 12, 25, 40].map(t => `niv. ${t} (×${Object.keys(LEV_LEVEL).find(v => LEV_LEVEL[v] === t) ?? "—"}) : ${med(runs.map(r => r[t])) ?? "> 200"}`);
  console.log(`  ${name.padEnd(9)} ${row.join(" · ")}`);
}
console.log("Cibles (régulier) : niv. 2 = 1, 5 ≈ 3, 12 ≈ 21, 25 ≈ 60, 40 ≈ 150. Casual : ×5 avant 7 jours, ×10 avant 35 jours.");
