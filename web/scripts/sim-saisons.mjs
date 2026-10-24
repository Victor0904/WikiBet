// Saisons (H6), guildes (H7) et anti-abus (H9) : `node scripts/sim-saisons.mjs [--base=0.05] [--echelle=0.5] [--semaines=12]`.
// 1 000 comptes sur 12 semaines : casual (3 jours par semaine), régulier, hardcore, baleine, multi-comptes (5 comptes
// d'une même personne qui tradent en miroir). Règles : supabase/functions/_shared/progression.js (celles de la base).
// Modèle du trading, calé sur les paris réels de la sauvegarde du 18 octobre 2026 (3 joueurs, 141 positions, levier moyen
// ×8, gain ÷ mise d'écart type 1,32) : valeur finale ÷ mise = exp(σZ − σ²/2), σ = 0,125 × levier, donc d'espérance nulle
// avant frais (une position avec liquidation est une martingale arrêtée à 0) ; frais et impact ≈ 0,2 % × levier + 0,2 %
// de la mise. Le talent d'un joueur décale sa moyenne (écart type 3 % de la mise par trade). Plus de boutique, de ville, de banque ni de
// talents (retirés en H1) : les seules sources de W sont le salaire, la faillite (retour à 10 000 W) et les saisons ;
// le seul puits, les frais et les pertes.
import { START_CAPITAL, GROUP_MAX, ELIGIBLE_TRADES, SEASON_XP, SEASON_REWARD_PCT, seasonMove, nextDivision, DIVISIONS,
  guildMin, GUILD_BASE, guildContribution, guildXp, GUILD_TRADES, GUILD_MEMBER_XP, guildLevelOf, maxLevOf, levelOf, XP, QUEST4_LEVEL } from "../supabase/functions/_shared/progression.js";

const arg = (k, d) => +(process.argv.find(a => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
const WEEKS = arg("semaines", 12), BASE = arg("base", 0.05), SCALE = arg("echelle", 1), N = 1000;
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());

// days : jours joués par semaine ; trades : trades valides par jour joué ; f : part du patrimoine misée par trade ;
// lev : levier voulu (borné par niveau et ligue) ; salary : salaire par jour joué sous 20 000 W de patrimoine.
const PROFILES = {
  casual: { share: .5, days: 3, trades: 3, f: .08, lev: 5, day: [.9, .6, .3], week: [.6, .3, .1], pari: .8, salary: 1500 },
  regulier: { share: .3, days: 7, trades: 5, f: .08, lev: 10, day: [.95, .8, .55], week: [.9, .7, .45], pari: .9, salary: 3000 },
  hardcore: { share: .1, days: 7, trades: 15, f: .06, lev: 20, day: [.99, .95, .85], week: [.98, .9, .8], pari: .99, salary: 6000 },
  baleine: { share: .05, days: 5, trades: 6, f: .05, lev: 5, day: [.9, .7, .5], week: [.8, .6, .4], pari: .9, salary: 0, pat0: 500000 },
  multi: { share: .05, days: 2, trades: 3, f: .3, lev: 20, day: [.9, .5, .2], week: [.3, .1, 0], pari: .5, salary: 1500 },
};
const salaryFactor = pat => pat <= 20000 ? 1 : pat >= 100000 ? 0 : (100000 - pat) / 80000;

const accounts = [];
for (const [name, p] of Object.entries(PROFILES)) {
  const n = Math.round(N * p.share);
  for (let i = 0; i < n; i++) accounts.push({ id: accounts.length, prof: name, p, skill: gauss() * .03, pat: p.pat0 ?? START_CAPITAL,
    xp: XP.tuto.howto + XP.tuto.fiche + XP.tuto.ordre, div: 0, owner: name === "multi" ? Math.floor(i / 5) : null, reach: {},
    rewards: 0, guild: null, xpDays: [] });
}
// Guildes : 40 % des joueurs honnêtes, par 10 ; les 5 comptes d'un multi dans la même guilde.
const honest = accounts.filter(a => a.prof !== "multi").sort(() => rnd() - .5).slice(0, Math.round(.4 * N));
const guilds = [];
honest.forEach((a, i) => { if (i % 10 === 0) guilds.push({ members: [], xp: 0, reachMin: 0, reach2: 0, weeks: 0 }); a.guild = guilds.at(-1); a.guild.members.push(a) });
for (const a of accounts.filter(a => a.prof === "multi")) {
  if (a.id % 5 === 0 || !guilds.at(-1).multi) guilds.push({ members: [], xp: 0, reachMin: 0, reach2: 0, weeks: 0, multi: true });
  a.guild = guilds.at(-1); a.guild.members.push(a);
}

const stats = { inject: [], salary: [], restart: [], mass: [], divs: [], guildMin: [], guild2: [] };
let day = 0;
for (let w = 0; w < WEEKS; w++) {
  let salary = 0, restart = 0;
  for (const a of accounts) { a.pat0w = Math.max(a.pat, START_CAPITAL); a.pnl = 0; a.valid = 0 }
  for (let d = 0; d < 7; d++, day++) {
    // Les multi-comptes jouent par paires en miroir : le compte pair à la hausse, l'impair à la baisse, même mise.
    const mirror = {};
    for (const a of accounts) {
      const p = a.p, plays = rnd() < p.days / 7;
      if (plays) {
        const lev = Math.min(p.lev, maxLevOf(levelOf(a.xp), a.div)), cost = .002 * lev + .002;
        for (let t = 0; t < p.trades; t++) {
          let r;
          const sg = .125 * lev, z = a.prof === "multi" ? (mirror[`${a.owner}:${Math.floor((a.id % 5) / 2)}:${t}`] ??= gauss()) * (a.id % 2 ? -1 : 1) : gauss();
          r = Math.exp(sg * z - sg * sg / 2 + (a.prof === "multi" ? 0 : a.skill)) - 1 - cost;
          a.pnl += p.f * a.pat0w * r; a.valid++;
        }
        const s = Math.round(p.salary * salaryFactor(a.pat)); a.pat += s; salary += s;
        // XP du jour (comme scripts/sim-xp.mjs) : quêtes, pari.
        const lvl = levelOf(a.xp), tiers = ["easy", "medium", "hard", ...(lvl >= QUEST4_LEVEL ? ["medium"] : [])];
        let q = 0; tiers.forEach((t, i) => { if (rnd() < p.day[i === 3 ? 1 : i]) { a.xp += XP.quest[t]; q++ } });
        if (rnd() < p.pari) a.xp += XP.pari.vote + (rnd() < .5 ? XP.pari.right : 0);
        if (q) { a.streak = (a.streak ?? 0) + 1; for (const n of [3, 7, 30]) if (a.streak === n) a.xp += XP.streak[n] }
      } else if (a.grace !== w) a.grace = w; else a.streak = 0;
      a.xpDays.push(a.xp);
      const l = levelOf(a.xp);
      for (const [lev, ok] of [[5, l >= 5], [10, l >= 12], [15, l >= 25 && a.div >= 9]]) if (ok && a.reach[lev] == null) a.reach[lev] = day + 1;
    }
  }
  // Clôture de la semaine : P&L encaissé, groupes par division, mouvements, récompenses, XP.
  let inject = 0;
  for (const a of accounts) a.pat += a.pnl;
  const byDiv = {};
  for (const a of accounts.filter(a => a.valid > 0).sort(() => rnd() - .5)) (byDiv[a.div] ??= []).push(a);
  for (const list of Object.values(byDiv)) for (let g = 0; g < list.length; g += GROUP_MAX) {
    const grp = list.slice(g, g + GROUP_MAX).map(a => ({ a, s: a.pnl / a.pat0w })).sort((x, y) => y.s - x.s), n = grp.length;
    grp.forEach((x, i) => {
      const rank = grp.findIndex(y => y.s === x.s) + 1, el = x.a.valid >= ELIGIBLE_TRADES, d0 = x.a.div;
      x.a.div = nextDivision(d0, seasonMove(rank, n), el);
      if (el) { const r = Math.round(START_CAPITAL * SEASON_REWARD_PCT[d0] / 100 * SCALE); x.a.pat += r; x.a.rewards += r; inject += r }
      x.a.xp += SEASON_XP.play + SEASON_XP.perDiv * Math.max(0, x.a.div - d0);
    });
  }
  // Guildes : objectif au minimum (et, à part, au double), contributions bornées.
  let gMin = 0, g2 = 0;
  for (const g of guilds) {
    const n = g.members.length, min = Math.round(guildMin(n, guildLevelOf(g.xp)) * BASE / GUILD_BASE);
    const tot = t => g.members.reduce((s, a) => s + guildContribution(a.pnl, t), 0);
    const okMin = tot(min) >= min, ok2 = tot(2 * min) >= 2 * min;
    // Cible du chef : le minimum une fois sur deux, sinon ×1,5, ×2 ou ×3.
    const target = Math.round(min * [1, 1, 1.5, 2, 3][Math.floor(rnd() * 5)]);
    if (!g.multi) { gMin += okMin; g2 += ok2 } g.weeks++; g.reachMin += okMin; g.reach2 += ok2;
    g.xp += guildXp(n, target, min, tot(target));
    if (tot(target) >= target) for (const a of g.members) if (a.valid >= GUILD_TRADES) a.xp += GUILD_MEMBER_XP;
  }
  // Quêtes de la semaine et succès (comme scripts/sim-xp.mjs), faillites.
  for (const a of accounts) {
    ["easy", "medium", "hard"].forEach((t, i) => { if (rnd() < a.p.week[i] * Math.min(1, a.p.days / 5)) a.xp += XP.week[t] });
    a.xp += w === 0 ? 300 : 60; if (a.pat < 2000) { restart += START_CAPITAL - a.pat; a.pat = START_CAPITAL } }
  const mass = accounts.reduce((s, a) => s + a.pat, 0);
  Object.assign(stats, { inject: [...stats.inject, inject], salary: [...stats.salary, salary], restart: [...stats.restart, restart], mass: [...stats.mass, mass],
    divs: [...stats.divs, DIVISIONS.map((_, i) => accounts.filter(a => a.prof !== "multi" && a.div === i).length)],
    guildMin: [...stats.guildMin, gMin / guilds.filter(g => !g.multi).length], guild2: [...stats.guild2, g2 / guilds.filter(g => !g.multi).length] });
}

const pct = x => (100 * x).toFixed(2) + " %", k = x => Math.round(x / 1000).toLocaleString("fr-FR") + " k";
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length < a.length / 2 ? null : s[Math.floor(a.length / 2)] };
console.log(`Simulation : ${accounts.length} comptes, ${WEEKS} semaines, base de guilde ${BASE * 100} % (fichier : ${GUILD_BASE * 100} %), échelle des récompenses ×${SCALE}`);
console.log("\nW injectés par semaine (en % de la masse en circulation en fin de semaine) :");
for (let w = 0; w < WEEKS; w++) console.log(`  S${String(w + 1).padStart(2)}  saisons ${k(stats.inject[w]).padStart(7)} (${pct(stats.inject[w] / stats.mass[w])})  salaires ${k(stats.salary[w]).padStart(7)} (${pct(stats.salary[w] / stats.mass[w])})  faillites ${k(stats.restart[w]).padStart(6)}  masse ${k(stats.mass[w])}`);
const tot = a => a.reduce((s, x) => s + x, 0);
console.log(`  Total : saisons = ${pct(tot(stats.inject) / (tot(stats.inject) + tot(stats.salary) + tot(stats.restart)))} des W créés (salaires ${pct(tot(stats.salary) / (tot(stats.inject) + tot(stats.salary) + tot(stats.restart)))}).`);
console.log("\nRépartition des divisions (comptes honnêtes) :");
console.log("        " + DIVISIONS.map(d => d.replace("Bronze ", "B").replace("Argent ", "A").replace("Or ", "O").replace("Platine ", "P").replace("Diamant ", "D").replace("Maître", "M").padStart(4)).join(""));
for (const w of [0, 3, 7, WEEKS - 1].filter(w => w < WEEKS)) console.log(`  S${String(w + 1).padStart(2)}  ${stats.divs[w].map(x => String(x).padStart(4)).join("")}`);
console.log("\nDélai médian (jours) pour ×5, ×10, ×15, et XP par jour (médiane, sur toute la période) :");
for (const prof of Object.keys(PROFILES)) {
  const list = accounts.filter(a => a.prof === prof);
  const r = [5, 10, 15].map(v => { const m = med(list.map(a => a.reach[v])); const got = list.filter(a => a.reach[v] != null).length / list.length; return `×${v} : ${m ?? "—"} (${Math.round(100 * got)} % l'ont)` });
  const xpd = med(list.map(a => (a.xp - (XP.tuto.howto + XP.tuto.fiche + XP.tuto.ordre)) / (WEEKS * 7)));
  console.log(`  ${prof.padEnd(9)} ${r.join("  ")}  ${Math.round(xpd)} XP/jour, division médiane ${DIVISIONS[med(list.map(a => a.div))]}`);
}
console.log(`\nGuildes (minimum = ${BASE * 100} % du capital × membres) : minimum atteint ${pct(tot(stats.guildMin) / WEEKS)} des semaines, objectif ×2 ${pct(tot(stats.guild2) / WEEKS)}`);
const gl = guilds.filter(g => !g.multi).map(g => guildLevelOf(g.xp));
console.log(`  Niveau de guilde après ${WEEKS} semaines : médian ${med(gl)}, max ${Math.max(...gl)}`);
const perWeek = list => tot(list.map(a => a.rewards)) / list.length / WEEKS;
const multi = accounts.filter(a => a.prof === "multi"), others = accounts.filter(a => a.prof !== "multi");
console.log("\nMulti-comptes (5 comptes en miroir, ×20 dès que possible) :");
console.log(`  récompense de saison par compte et par semaine : ${Math.round(perWeek(multi))} W (comptes honnêtes : ${Math.round(perWeek(others))} W)`);
console.log(`  par personne (5 comptes) : ${Math.round(5 * perWeek(multi))} W par semaine, intransférables (aucun don, aucun échange entre joueurs)`);
console.log(`  division médiane de leurs comptes : ${DIVISIONS[med(multi.map(a => a.div))]}, meilleure : ${DIVISIONS[Math.max(...multi.map(a => a.div))]}`);
