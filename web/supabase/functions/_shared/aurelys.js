// Bourse d'Aurelys : marché fictif simulé par agents (conception : bourse-aurelys.md à la racine du dépôt).
// Les prix ne sont pas dessinés : ils naissent des ordres des bots, des baleines et des joueurs (loi de la racine carrée),
// et ces ordres réagissent aux actualités, aux régimes de marché et à la valeur fondamentale cachée.
// Partagé par la fonction serveur « aurelys » (Deno), le mode démo (navigateur) et l'écran. Aucune dépendance.
// 1 tick = 1 minute de jeu = SPM secondes réelles (une journée d'Aurelys dure 2 h). S.t compte les minutes de jeu depuis EPOCH_S.
// Tout l'aléatoire passe par un générateur dont la graine est dans l'état : le même état rejoue exactement la même suite.

import { STORIES } from "./aurelys-stories.js";

export const DAY = 1440;                          // minutes de jeu par jour d'Aurelys
export const SPM = 5;                             // secondes réelles par minute de jeu : un jour d'Aurelys = 2 h réelles
export const EPOCH_S = Date.UTC(2026, 9, 1) / 1000; // jour 1, 00:00 d'Aurelys
export const INDEX = "AUR12";
export const FEE = 0.001;                         // 0,1 % du montant engagé, à l'ouverture et à la clôture
export const CAP_MULT = 20;                       // exposition max d'un joueur par action = 20 × liquidité par minute
const Y = 0.34, PERM = 0.3, TAU = 5;              // impact : constante, part permanente, décroissance du temporaire (ticks)
const FLOW = 0.55, GAP = 0.5;                                      // taille des ordres des bots, en part de la liquidité
const VIX_BASE = 1.7e-7;                          // variance par tick de l'indice en marché calme (calibrée)

const LIQ = { haute: 60000, moyenne: 20000, faible: 6000 }; // Ꜷ échangés par minute de jeu, en journée
// Profondeur du carnet face à l'ordre d'un joueur (Ꜷ) : un ordre de cette taille fait bouger le cours d'environ 0,43 σ jour.
// Volontairement faible, pour que « plus on achète, plus ça monte » se voie : 25 000 W sur Solarmine ≈ 1 % de hausse.
const DEPTH = { haute: 600000, moyenne: 200000, faible: 60000 };

export const SECTORS = {
  tech: { name: "Tech", rate: -0.08, cyc: 0.5, infl: 0 },
  energie: { name: "Énergie", rate: -0.01, cyc: 1, infl: 0.5 },
  sante: { name: "Santé", rate: -0.01, cyc: 0, infl: 0 },
  industrie: { name: "Industrie", rate: -0.03, cyc: 1.5, infl: -0.2 },
  finance: { name: "Finance", rate: 0.04, cyc: 1, infl: 0 },
  conso: { name: "Consommation", rate: -0.01, cyc: 0, infl: -0.5 },
  matieres: { name: "Matières premières", rate: -0.03, cyc: 1.5, infl: 0.6 },
  loisirs: { name: "Loisirs", rate: -0.03, cyc: 1, infl: -0.2 },
};

export const STOCKS = [
  // ticker, nom, secteur, prix, actions (M), σ/jour, β, liquidité, croissance/an, PER, dividende %, couleur, personnalité
  ["NXR", "Nexora Systems", "tech", 142, 80, .028, 1.4, "haute", .12, 38, 0, "#4DA2FF", "Star de l'IA, adorée et surévaluée."],
  ["PXF", "Pixelfold Studios", "loisirs", 38.5, 25, .045, 1.6, "faible", .06, 24, 0, "#F472B6", "Studio de jeux vidéo : vit et meurt à chaque sortie."],
  ["OMB", "Ombrelune Pharma", "sante", 64.2, 40, .020, .7, "moyenne", .05, 30, .8, "#A78BFA", "Laboratoire : chaque essai clinique est une loterie."],
  ["HLV", "Helvane Énergie", "energie", 27.8, 300, .010, .6, "haute", .03, 11, 6.2, "#E8C547", "Valeur refuge, gros dividende."],
  ["FRC", "Ferrocap Industries", "industrie", 19.4, 150, .019, 1.2, "moyenne", .04, 9, 3.1, "#9AA3B5", "Sidérurgie : suit l'économie."],
  ["VLS", "Vélisse Motors", "industrie", 55, 60, .032, 1.5, "moyenne", .09, 45, 0, "#F04B5C", "Voitures électriques, PDG imprévisible."],
  ["BCS", "Banque Castellane", "finance", 46.3, 200, .016, 1.1, "haute", .04, 10, 4.5, "#3CC8E6", "Profite des taux hauts, craint les crises."],
  ["MRV", "Marivent Logistique", "industrie", 31.1, 90, .022, 1.0, "moyenne", .04, 13, 2.4, "#2A6CF0", "Fret maritime, sensible aux tensions."],
  ["GTR", "Granterre Agro", "conso", 22.6, 120, .013, .5, "moyenne", .03, 16, 2.8, "#8DC351", "Agriculture : dépend de la météo et des récoltes."],
  ["LMR", "Lumirue Distribution", "conso", 16.9, 250, .012, .8, "haute", .03, 18, 3.5, "#F5B83D", "Supermarchés, très défensive."],
  ["SLM", "Solarmine Lithium", "matieres", 12.4, 70, .038, 1.3, "faible", .07, 21, 0, "#1FCB8B", "Petite minière, cible favorite des baleines."],
  ["KST", "Kestrel Aéro", "industrie", 88.7, 45, .018, .9, "moyenne", .05, 22, 1.6, "#C2A633", "Aéronautique et contrats d'État."],
  ["OND", "Ondéo Live", "loisirs", 24.5, 50, .03, 1.2, "moyenne", .08, 35, 0, "#7C5CFF", "Plateforme de streaming : vit de l'audience des lives."],
].map(([tk, name, sector, p0, shares, sig, beta, liq, mu, per, div, color, desc], i) => {
  const sm = 0.006 * beta, ss = 0.005; // part du marché et du secteur dans la volatilité
  return { i, tk, name, sector, p0, shares: shares * 1e6, sig, beta, liq, L: LIQ[liq], depth: DEPTH[liq], mu, per, div, color, desc,
    si: Math.sqrt(Math.max((0.3 * sig) ** 2, sig * sig - sm * sm - ss * ss)) };
});
export const BY = Object.fromEntries(STOCKS.map(s => [s.tk, s]));
// Entreprises branchées sur des chiffres réels, relevés par le serveur (fonction aurelys) : un écart à la normale fait
// bouger leur valeur fondamentale et leurs prochains résultats. Ce sont des données futures : on ne peut pas les connaître d'avance.
export const LINKS = {
  PXF: { src: "Joueurs connectés sur Steam (29 jeux suivis), comparés à la veille à la même heure", beta: .5 },
  OND: { src: "Spectateurs des grands lives Twitch francophones, comparés à la veille à la même heure", beta: .5 },
  GTR: { src: "Pluie des 14 derniers jours et chaleur prévue en Beauce (Open-Meteo)", beta: .4 },
  HLV: { src: "Consommation électrique française (RTE éCO2mix), comparée à la veille", beta: .4 },
  LMR: { src: "Jours fériés à venir et météo du week-end à Paris (Open-Meteo)", beta: .3 },
};
const DIV = STOCKS.reduce((a, s) => a + s.p0 * s.shares, 0) / 1000; // AUR-12 vaut 1 000 au départ

export const CHARACTERS = [
  { name: "Ilan Varesko", role: "PDG de Vélisse Motors", tk: "VLS", bio: "Tweete trop. Une phrase de lui fait bouger le titre de ±8 %." },
  { name: "Dr Maëlle Orsini", role: "Directrice scientifique d'Ombrelune", tk: "OMB", bio: "Ses annonces d'essais sont attendues comme des verdicts." },
  { name: "Albrecht Holm", role: "Gouverneur de la Banque Centrale", tk: null, bio: "Chaque conférence fait trembler le marché." },
  { name: "« Le Kraken »", role: "Baleine anonyme", tk: "SLM", bio: "Sa rumeur seule suffit à faire bouger Solarmine." },
  { name: "Sofia Delmar", role: "Analyste star de Castellane Research", tk: "BCS", bio: "Ses recommandations déplacent les flux." },
];

export const REGIMES = {
  calme: { name: "Calme", icon: "☀", drift: .00005, vol: 1, news: 1, fam: { fund: 1.3, mom: .8, contra: 1, chart: 1, noise: 1 }, mm: 1, panic: 0 },
  euphorie: { name: "Euphorie", icon: "🚀", drift: .0003, vol: 1.2, news: 1.5, fam: { fund: .6, mom: 1.6, contra: .8, chart: 1, noise: 1.2 }, mm: 1, panic: .25 },
  nervosite: { name: "Nervosité", icon: "⛅", drift: 0, vol: 1.4, news: 2, fam: { fund: .9, mom: 1, contra: 1.4, chart: 1.4, noise: 1.1 }, mm: .8, panic: -.1 },
  krach: { name: "Krach", icon: "⛈", drift: -.0015, vol: 2.2, news: 3, fam: { fund: .5, mom: 1.3, contra: .7, chart: 1, noise: 1.8 }, mm: .5, panic: -.6 },
  reprise: { name: "Reprise", icon: "🌤", drift: .0002, vol: 1.2, news: 1.5, fam: { fund: 1.3, mom: 1, contra: 1.3, chart: 1, noise: 1 }, mm: .9, panic: .1 },
};
const RK = Object.keys(REGIMES);
// Probabilités de passage par heure de jeu (lignes : depuis ; colonnes : calme, euphorie, nervosité, krach, reprise).
const MARKOV = {
  calme: [.985, .008, .007, 0, 0],
  euphorie: [.010, .975, .013, .002, 0],
  nervosite: [.015, .003, .962, .020, 0],
  krach: [0, 0, .010, .950, .040],
  reprise: [.030, .005, .005, 0, .960],
};

/* ===== Hasard à graine ===== */
const hashStr = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 };
const mulberry = s => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return [s, ((t ^ t >>> 14) >>> 0) / 4294967296] };
const rngOf = seed => () => { const [s, v] = mulberry(seed); seed = s; return v };
const gauss = r => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()) };
const pick = (r, a) => a[Math.floor(r() * a.length)];
const between = (r, [a, b]) => a + (b - a) * r();

/* ===== Les bots : 40 par action, paramètres tirés une fois pour toutes (graine fixe) ===== */
// Erreur d'estimation des fondamentalistes : environ une volatilité journalière (« chacun se trompe un peu »).
const MIX = { fund: 8, mom: 10, contra: 4, chart: 6, noise: 12 }; // fondamentalistes 20 %, suiveurs 25 %, contrariens 10 %, chartistes 15 %, bruit 30 %
const EMA_H = [5, 15, 30, 60, 120, 240];
const makeBots = s => {
  const r = rngOf(hashStr("bots:" + s.tk));
  return Object.entries(MIX).flatMap(([f, n]) => Array.from({ length: n }, () => ({
    f, agg: .5 + r(), th: .25 + .5 * r(), av: r(), bias: (r() - .5) * .1, eps: gauss(r) * s.sig,
    hs: Math.floor(r() * 3), hl: 3 + Math.floor(r() * 3), n: pick(r, [30, 60, 120]), noise: .6 + .8 * r(),
  })));
};
const BOTS = STOCKS.map(makeBots), BOTS_X = {}; // les bots d'une nouvelle entreprise se tirent de son code (déterministe)
const botsOf = s => BOTS[s.i] ?? (BOTS_X[s.tk] ??= makeBots(s));

/* ===== Entreprises qui entrent en bourse (et en sortent) ===== */
// Le moteur crée lui-même de jeunes entreprises : annonce et levée de fonds (2 jours d'Aurelys), introduction en bourse,
// puis cotation très volatile. Sous 15 % du prix d'introduction, c'est la faillite : l'action est radiée.
// Leur « qualité » cachée (q) décide du premier cours et de la croissance à long terme : là est le pari.
export const IPO = { roundDays: 2, maxYoung: 5, delist: .15, minWealth: 50000, maxShare: .2 };
const defOf = (S, tk) => BY[tk] ?? S.extra?.[tk];
const listed = S => S.extra ? STOCKS.concat(Object.values(S.extra).filter(d => d.status === "listed")) : STOCKS;
const NAME_A = ["Lumi", "Verd", "Nova", "Aqua", "Célest", "Terra", "Opti", "Bio", "Néo", "Flux", "Orbi", "Sola", "Voxa", "Hélio", "Mari", "Crista", "Alti", "Zéna", "Pyro", "Sylva"];
const NAME_B = ["gen", "tek", "lys", "sys", "ra", "vel", "dyne", "line", "nis", "ora", "lab", "nova"];
const IDEAS = {
  tech: ["Cybersécurité pour les hôpitaux", "Traduction instantanée dans l'oreillette", "Puces pour lunettes connectées", "Ordinateurs quantiques de bureau"],
  sante: ["Thérapie génique contre la surdité", "Pansements qui détectent les infections", "Diagnostic des maladies par la voix", "Vaccins sans aiguille"],
  energie: ["Hydrogène vert pour les camions", "Batteries au sel", "Petites centrales marémotrices", "Panneaux solaires souples"],
  loisirs: ["Jeux vidéo en réalité virtuelle", "Concerts en hologramme", "Parcs d'escalade en ville"],
  conso: ["Viande végétale", "Courses livrées en 10 minutes", "Cosmétiques sans eau", "Vêtements loués à l'année"],
  industrie: ["Drones de livraison", "Imprimantes 3D pour le bâtiment", "Navettes autonomes", "Dirigeables cargo"],
  matieres: ["Recyclage des terres rares", "Cuivre extrait des vieux câbles", "Bois de construction à pousse rapide"],
  finance: ["Banque en ligne pour étudiants", "Assurance au kilomètre", "Prêts entre voisins"],
};
const FIRST = ["Léa", "Malo", "Inès", "Yanis", "Clara", "Noé", "Sarah", "Hugo", "Maya", "Ilyes", "Jeanne", "Tom", "Lina", "Oscar"];
const LAST = ["Arvel", "Brissac", "Corvin", "Deslandes", "Ferrand", "Gallois", "Haddad", "Lemaire", "Moreau", "Ostrowski", "Pradel", "Quintal", "Rocher", "Valence"];
const CITIES = ["Port-Aurel", "Valmeyre", "Brennes", "Castellane", "Lisère", "Haut-Ombre", "Grise-Vallée", "Sel-Rouge"];
const fmtPx = v => v.toFixed(2).replace(".", ",");

function spawn(S, R, out) {
  const sector = pick(R, Object.keys(IDEAS)), what = pick(R, IDEAS[sector]);
  let name, tk;
  S.usedTk ??= []; // un code n'est jamais réutilisé : l'historique des paris garde le bon nom
  do { name = pick(R, NAME_A) + pick(R, NAME_B); tk = name.normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() } while (BY[tk] || S.extra[tk] || S.usedTk.includes(tk) || ["AUR"].includes(tk));
  S.usedTk.push(tk);
  const f1 = `${pick(R, FIRST)} ${pick(R, LAST)}`, f2 = `${pick(R, FIRST)} ${pick(R, LAST)}`, city = pick(R, CITIES);
  const price = Math.round((5 + R() * 25) * 2) / 2, n = S.extraN = (S.extraN ?? 0) + 1;
  const d = {
    tk, name, sector, i: 100 + n, p0: price, shares: Math.round(10 + R() * 30) * 1e6, sig: .05 + R() * .04, beta: 1.3 + R() * .7,
    liq: "faible", L: LIQ.faible / 2, depth: DEPTH.faible / 2, mu: 0, per: 0, div: 0, color: `hsl(${Math.floor(R() * 360)} 65% 55%)`,
    desc: "Jeune pousse : très volatile, peut tout gagner ou tout perdre.", what, since: `${2026 - Math.floor(R() * 4)} · ${city}`,
    story: `${f1} et ${f2} ont fondé ${name} à ${city}. Leur pari : ${what.toLowerCase()}. La société n'a encore jamais gagné d'argent ; elle lève des fonds pour grandir.`,
    q: Math.max(-2, Math.min(2, gauss(R))), status: "round", roundPrice: price, roundEnd: S.t + IPO.roundDays * DAY, born: S.t,
  };
  S.extra[tk] = d; out.listing.push(pub(d));
  const end = gameClock(realOf(d.roundEnd));
  publish(S, out, { tk: null, sector, cat: "ipo", sent: .3, mag: 0, hl: 240,
    title: `${name} veut entrer en bourse : souscription ouverte à ${fmtPx(price)} Ꜷ l'action`,
    text: [`${d.story}`,
      `La levée de fonds est ouverte jusqu'au jour ${end.day} à ${end.hm}. Chaque action est proposée à ${fmtPx(price)} Ꜷ ; ${(d.shares / 1e6).toFixed(0)} millions d'actions composeront le capital.`,
      `Seuls les investisseurs déjà installés (au moins ${IPO.minWealth.toLocaleString("fr-FR")} W de patrimoine) peuvent souscrire, et pas plus de ${IPO.maxShare * 100} % de leur patrimoine.`,
      `« Ces jeunes sociétés peuvent multiplier leur valeur, ou disparaître en quelques semaines », prévient ${pick(R, ANALYSTS)}. Le premier cours sera fixé par le marché le jour de l'introduction.`].join("\n\n") });
}
// Ce qui est publié (base de données, écran) : tout sauf la qualité cachée.
const pub = d => { const { q, ...rest } = d; return { ...rest, roundEnd: realOf(d.roundEnd), ipoAt: d.ipoAt != null ? realOf(d.ipoAt) : null } };

function ipo(S, R, out, d) {
  const open = d.roundPrice * Math.exp(.45 * d.q + gauss(R) * .25), value = d.roundPrice * Math.exp(.8 * d.q);
  Object.assign(d, { status: "listed", ipoAt: S.t, ipoPrice: open, p0: open, mu: .15 + .9 * d.q / 2 });
  S.st[d.tk] = { v: Math.log(value), lp: Math.log(open), tmp: 0, e: EMA_H.map(() => open), rg: 0, rl: 0, h: [open], gh: 1.3, h0: open,
    halt: 0, pat: null, ve: d.L, eps: open / 40, z: 0, res: null };
  S.next[d.tk] = 0;
  const ch = open / d.roundPrice - 1;
  out.listing.push(pub(d));
  publish(S, out, { tk: d.tk, cat: "ipo", sent: Math.max(-1, Math.min(1, ch * 2)), mag: 0, hl: 360,
    title: `Introduction en bourse : ${d.name} débute à ${fmtPx(open)} Ꜷ, ${ch >= 0 ? "+" : "−"}${Math.abs(Math.round(ch * 100))} % sur le prix de la levée`,
    text: [`Premier jour de cotation pour ${d.name}. Les souscripteurs avaient payé ${fmtPx(d.roundPrice)} Ꜷ l'action ; le marché l'a d'abord fixée à ${fmtPx(open)} Ꜷ.`,
      d.story,
      ch >= .3 ? `« L'appétit des investisseurs est réel, mais il faudra des résultats pour tenir ce prix », juge ${pick(R, ANALYSTS)}.`
        : ch <= -.2 ? `« Un départ difficile : le marché doute du modèle », note ${pick(R, ANALYSTS)}.`
        : `« Une entrée en bourse sans éclat, l'histoire reste à écrire », estime ${pick(R, ANALYSTS)}.`,
      `L'action rejoint le compartiment des jeunes pousses : forte volatilité, et radiation si le cours tombe sous ${Math.round(IPO.delist * 100)} % de son prix d'introduction.`].join("\n\n") });
}

function delist(S, out, d) {
  const last = Math.exp(S.st[d.tk].lp + S.st[d.tk].tmp);
  d.status = "delisted"; d.delistedAt = S.t; d.lastPrice = last;
  out.listing.push(pub(d));
  publish(S, out, { tk: d.tk, cat: "faillite", sent: -1, mag: 0, hl: 240,
    title: `${d.name} fait faillite : l'action est radiée de la cote`,
    text: [`Le cours de ${d.name} est tombé à ${fmtPx(last)} Ꜷ, moins de ${Math.round(IPO.delist * 100)} % de son prix d'introduction (${fmtPx(d.ipoPrice)} Ꜷ). La société est placée en liquidation.`,
      `Les actionnaires perdent leur mise ; les positions encore ouvertes sur le titre sont soldées au dernier cours.`,
      `Le projet était de proposer : ${d.what.toLowerCase()}. Il n'aura pas trouvé son marché à temps.`].join("\n\n") });
}

function lifecycle(S, R, out) {
  const ex = Object.values(S.extra), round = ex.find(d => d.status === "round"), young = ex.filter(d => d.status === "listed");
  if (round && S.t >= round.roundEnd) ipo(S, R, out, round);
  for (const d of young) { const p = Math.exp(S.st[d.tk].lp + S.st[d.tk].tmp); if (p < d.ipoPrice * IPO.delist) delist(S, out, d) }
  for (const d of ex) if (d.status === "delisted" && S.t - d.delistedAt > 10 * DAY) { delete S.extra[d.tk]; delete S.st[d.tk]; delete S.next[d.tk] }
  if (!round && young.length < IPO.maxYoung && S.t >= (S.nextIpo ?? 0)) { spawn(S, R, out); S.nextIpo = S.t + IPO.roundDays * DAY + Math.floor((1 + 2 * R()) * DAY) }
}

/* ===== Articles du journal ===== */
// Chaque nouvelle d'entreprise devient un article : le fait, le contexte de la société, l'avis d'un analyste, le cours.
const ANALYSTS = ["Sofia Delmar, de Castellane Research", "Marc Itier, gérant chez Aurel Capital", "Inès Varo, stratégiste à la Banque du Nord", "Hugo Brenner, du cabinet Ferrel & Fils", "Nadia Cassel, analyste indépendante"];
const QUOTES = {
  up: ["« C'est exactement ce que le marché attendait »", "« Les fondamentaux sont solides, ce n'est pas un feu de paille »", "« Il y a encore de la marge à la hausse »"],
  down: ["« Le marché va devoir revoir ses attentes »", "« C'est un vrai coup dur, et il pourrait y en avoir d'autres »", "« La confiance mettra du temps à revenir »"],
  flat: ["« Il faut attendre la suite avant de conclure »", "« Rien qui change l'histoire à long terme »", "« Le marché en a vu d'autres »"],
};
function article(S, n) {
  const d = n.tk ? defOf(S, n.tk) : null, r = rngOf(hashStr(n.title) + S.nid), tone = n.sent > .15 ? "up" : n.sent < -.15 ? "down" : "flat";
  const out = [n.text || ""];
  if (d) {
    const st = STORIES[d.tk] ?? d, [year, city] = (st.since ?? "").split(" · ");
    out.push(`${d.name} (${st.what?.toLowerCase() ?? "jeune pousse"}${year ? `, fondée en ${year} à ${city}` : ""}). ${(st.story ?? d.desc).split(/(?<=\.) /)[0]}`);
    const x = S.st[d.tk]; if (x) out.push(`Le titre cotait ${fmtPx(Math.exp(x.lp + x.tmp))} Ꜷ au moment de l'annonce.`);
  } else if (n.sector) {
    out.push(`Sont concernées : ${listed(S).filter(s => s.sector === n.sector).map(s => s.name).join(", ")}.`);
  }
  out.push(`${pick(r, QUOTES[tone])}, commente ${pick(r, ANALYSTS)}.`);
  return out.filter(Boolean).join("\n\n");
}


/* ===== Horloge d'Aurelys ===== */
export const gameMin = sec => Math.floor((sec - EPOCH_S) / SPM);
export const realOf = m => EPOCH_S + m * SPM; // seconde réelle où commence la minute de jeu m
const hourOf = m => (m % DAY) / 60;
export const gameClock = sec => {
  const m = gameMin(sec), d = Math.floor(m / DAY) + 1, h = Math.floor((m % DAY) / 60), mn = m % 60;
  return { day: d, hm: `${String(h).padStart(2, "0")}:${String(mn).padStart(2, "0")}`, hour: (m % DAY) / 60 };
};
// Activité jour / nuit : pics 10h-12h et 15h-18h, creux 2h-6h.
export const activity = h => 0.4 + 0.6 * Math.max(Math.exp(-(((h - 11) / 1.6) ** 2)), Math.exp(-(((h - 16.5) / 1.8) ** 2)), 0.05);

// Événements programmés : résultats trimestriels (chaque entreprise tous les 7 jours) et décision de taux (tous les 14 jours).
const resultsAt = (i, d) => d % 7 === i % 7 ? d * DAY + 840 + (i % 3) * 45 : null;
const bcaAt = d => d % 14 === 3 ? d * DAY + 960 : null;
// `extra` : jeunes pousses cotées (elles publient aussi leurs résultats).
export function calendar(sec, n = 8, extra = []) {
  const m = gameMin(sec), out = [];
  for (let d = Math.floor(m / DAY); out.length < n && d < Math.floor(m / DAY) + 15; d++) {
    const ev = [];
    [...STOCKS, ...extra].forEach(s => { const t = resultsAt(s.i, d); if (t != null) ev.push({ m: t, tk: s.tk, kind: "resultats", title: `Résultats de ${s.name}` }) });
    const b = bcaAt(d); if (b != null) ev.push({ m: b, tk: null, kind: "taux", title: "Décision de taux de la Banque Centrale" });
    ev.sort((a, b) => a.m - b.m).forEach(e => { if (e.m > m && out.length < n) out.push({ ...e, at: realOf(e.m) * 1000 }) });
  }
  return out;
}
const soonEvent = (s, m) => { const d = Math.floor(m / DAY); for (const dd of [d, d + 1]) { const t = resultsAt(s.i, dd), b = bcaAt(dd); if ((t != null && t > m && t - m <= 180) || (b != null && b > m && b - m <= 180)) return true } return false };

/* ===== Actualités : gabarits ===== */
const pctTxt = x => `${Math.round(x * 100)} %`;
const CATS = {
  resultats: { mag: [.02, .08], hl: 360, label: "Résultats" },
  essai: { mag: [.06, .18], hl: 720, big: true, label: "Essai clinique" },
  contrat: { mag: [.01, .05], hl: 240, sign: 1, label: "Contrat" },
  scandale: { mag: [.04, .15], hl: 480, big: true, sign: -1, label: "Scandale" },
  pdg: { mag: [.02, .08], hl: 120, label: "Déclaration" },
  analyste: { mag: [.005, .02], hl: 240, label: "Analyste" },
  rumeur: { mag: [.01, .08], hl: 180, fiab: .3, label: "Rumeur" },
  produit: { mag: [.04, .15], hl: 480, big: true, label: "Produit" },
  meteo: { mag: [.01, .05], hl: 360, label: "Météo" },
};
const T = {
  resultats: {
    up: ["{N} pulvérise les attentes : chiffre d'affaires +{X}", "{N} dépasse les prévisions, bénéfice en hausse de {X}", "Trimestre record pour {N}", "{N} relève ses objectifs annuels après un bon trimestre"],
    down: ["{N} déçoit lourdement : chiffre d'affaires −{X}", "{N} rate ses objectifs, bénéfice en recul de {X}", "Avertissement sur résultats chez {N}", "{N} abaisse ses prévisions pour l'année"],
    text: ["La direction présentera le détail des comptes aux analystes dans la soirée.", "Les marges surprennent le marché.", "Le carnet de commandes est scruté de près."],
  },
  essai: {
    up: ["Ombrelune : l'essai de phase III de l'OMB-{K} atteint son critère principal", "Succès pour l'OMB-{K} : le Dr Orsini parle d'une « avancée majeure »", "L'agence de santé autorise l'OMB-{K}"],
    down: ["OMB-{K} : échec de la phase III", "Ombrelune suspend l'essai de l'OMB-{K} après des effets indésirables", "L'agence de santé rejette l'OMB-{K}"],
    text: ["Le Dr Maëlle Orsini présentera les données complètes en conférence.", "Le traitement visait un marché de plusieurs milliards d'aurels."],
  },
  contrat: {
    up: ["{N} décroche un contrat de {M} Mds d'aurels", "{N} signe une commande géante avec l'État", "Partenariat stratégique pour {N}", "{N} remporte un appel d'offres international"],
    text: ["Le contrat court sur plusieurs années.", "Les détails financiers n'ont pas été communiqués."],
  },
  scandale: {
    down: ["Perquisition au siège de {N}", "{N} visé par une enquête pour fraude comptable", "Fuite de documents internes : {N} dans la tourmente", "Le directeur financier de {N} démissionne sans explication"],
    text: ["La société dément toute irrégularité.", "Le parquet financier n'a fait aucun commentaire."],
  },
  pdg: {
    up: ["Varesko promet une voiture volante en 2028", "Ilan Varesko : « Vélisse vaudra dix fois plus dans trois ans »", "Le PDG de {N} rachète des actions à titre personnel"],
    down: ["Varesko se moque de ses actionnaires en direct", "Ilan Varesko envisage de « tout plaquer pour Mars »", "Le PDG de {N} vend une partie de ses actions"],
    text: ["Le message a été partagé des milliers de fois.", "Le service communication tente de rassurer."],
  },
  analyste: {
    up: ["Delmar relève {N} à l'achat", "Castellane Research voit {N} grimper de {X}", "Sofia Delmar : « {N} est la meilleure affaire du marché »"],
    down: ["Delmar dégrade {N} à la vente", "Castellane Research coupe son objectif sur {N}", "Sofia Delmar : « {N} est trop chère »"],
    text: ["La note circule chez tous les gérants.", "L'objectif de cours est revu."],
  },
  rumeur: {
    up: ["Selon nos sources, {N} serait en vente", "Rumeur : un géant étranger tournerait autour de {N}", "{N} préparerait une annonce majeure"],
    down: ["Rumeur : {N} serait à court de trésorerie", "Selon nos sources, {N} perdrait son principal client", "{N} préparerait un plan social"],
    text: ["Rien n'est confirmé à ce stade.", "La société refuse de commenter."],
  },
  produit: {
    up: ["Le nouveau produit de {N} s'arrache", "Lancement réussi pour {N} : les précommandes explosent", "{N} dévoile une innovation saluée par la critique"],
    down: ["Le produit phare de {N} boudé par la critique", "{N} rappelle des milliers d'unités défectueuses", "Lancement raté pour {N}"],
    text: ["Les premiers chiffres de ventes sont attendus.", "Les réseaux sociaux s'enflamment."],
  },
  meteo: {
    up: ["Récolte exceptionnelle : Granterre se frotte les mains", "Pluies bienvenues sur les plaines d'Aurelys"],
    down: ["Sécheresse historique : les récoltes en péril", "Grêle sur les vergers : Granterre chiffre les dégâts"],
    text: ["Météo-Aurelys prévoit une semaine décisive.", "Les prix agricoles réagissent."],
  },
};
// Poids des catégories par entreprise : les gros chocs (essai, sortie, scandale) restent rares, les petites nouvelles fréquentes.
const PRODUCT = { PXF: { produit: .7 }, NXR: { produit: .4 }, VLS: { pdg: 2, produit: .3 }, OMB: { essai: .4 }, GTR: { meteo: 1 }, KST: { contrat: 1.2 }, FRC: { contrat: .9 }, MRV: { contrat: .9 } };
const COMMON = { analyste: 3, rumeur: 1.5, contrat: .6, scandale: .15, pdg: .4 };
const SECTOR_NEWS = {
  up: ["{S} : la demande repart nettement", "Plan de soutien de l'État au secteur {S}", "{S} : les commandes accélèrent"],
  down: ["{S} : nouvelle réglementation sévère", "{S} : la demande s'essouffle", "Les investisseurs se détournent du secteur {S}"],
};
const fill = (s, v) => s.replace(/\{(\w)\}/g, (_, k) => v[k] ?? "");

/* ===== État initial ===== */
// `last` : derniers cours connus { tk: prix } pour repartir sans trou quand l'état change de format.
export function initState(nowSec, seed = 20261001, last = {}) {
  const t = gameMin(nowSec), p0 = s => last[s.tk] ?? s.p0;
  const I = STOCKS.reduce((a, s) => a + p0(s) * s.shares, 0) / DIV;
  return {
    t, rs: seed | 0, nid: 1, sig: {}, extra: {}, nextIpo: t + DAY / 2,
    reg: "calme", regAge: 0, crisisCd: 0,
    r: 3.0, g: 1.5, pi: 2.4, vix: VIX_BASE, idx: I, idxHi: I, idxH: [],
    sent: {}, follow: [], crisis: null, flash: 0, haltAll: 0,
    next: Object.fromEntries([...STOCKS.map(s => s.tk), ...Object.keys(SECTORS).map(k => "sec:" + k), "mkt"].map(k => [k, 0])),
    whales: { kraken: { ph: "idle", until: t + 1440, pos: 0 }, orca: { ph: "idle", until: t + 2880, pos: 0 }, lev: { ph: "idle", until: t + 2160, pos: 0 }, sov: { ph: "idle", until: 0 } },
    st: Object.fromEntries(STOCKS.map(s => [s.tk, {
      v: Math.log(p0(s)), lp: Math.log(p0(s)), tmp: 0, e: EMA_H.map(() => p0(s)), rg: 0, rl: 0, h: [p0(s)], gh: 1, h0: p0(s),
      halt: 0, pat: null, ve: s.L, eps: s.p0 / s.per, z: 0, res: null,
    }])),
  };
}

/* ===== Simulation ===== */
const priceOf = x => Math.exp(x.lp + x.tmp);
const sentOf = (S, key, t) => { const a = S.sent[key]; if (!a) return 0; let v = 0; for (const [s, t0, hl] of a) v += s * Math.exp(-(t - t0) * Math.LN2 / hl); return v };
const addSent = (S, key, s, t, hl) => (S.sent[key] ??= []).push([s, t, hl]);

// Impact relatif d'un ordre de `q` Ꜷ (loi de la racine carrée) : volatilité du moment (GARCH, régime, événement proche)
// et liquidité de l'heure.
const impactOf = (s, q, act, gh, reg, pre) => Math.sign(q) * Y * (s.si / Math.sqrt(DAY)) * gh * REGIMES[reg].vol ** .7 * pre * Math.sqrt(Math.abs(q) / (s.L * act));
const impact = (S, s, q, act) => impactOf(s, q, act, S.st[s.tk].gh, S.reg, soonEvent(s, S.t) ? 1.5 : 1);
// Ordres des joueurs : même loi, mais face à la profondeur du carnet (DEPTH) et à la volatilité journalière.
const playerImpactOf = (s, q, gh, reg) => Math.sign(q) * Y * s.sig * gh * REGIMES[reg].vol ** .7 * Math.sqrt(Math.abs(q) / s.depth);
const playerImpact = (S, s, q) => playerImpactOf(s, q, S.st[s.tk].gh, S.reg);
// Écart de prix subi par un joueur pour un ordre de `notional` Ꜷ : ce qu'il paie en plus à l'achat, en moins à la vente.
// Prix moyen d'exécution : la moitié du mouvement qu'il provoque.
export const slip = (S, tk, notional) => playerImpact(S, defOf(S, tk), notional) * 0.5;
// Estimation pour l'écran, qui ne connaît pas la volatilité du moment (gardée par le serveur).
export const slipEstimate = (tk, notional, sec, reg = "calme") => playerImpactOf(BY[tk], notional, 1, reg) * 0.5;

// Avance la simulation jusqu'à `untilSec` (seconde réelle). `orders` : ordres des joueurs [{ tk, q }] (q en Ꜷ, + achat), joués au premier tick.
// `signals` : chiffres réels du moment { tk: { z, txt } } (z = écart à la normale, +0,1 = 10 % au-dessus), voir LINKS.
// Renvoie les cours de chaque minute de jeu (t en secondes réelles) et les actualités publiées.
export function advance(S, untilSec, orders = [], signals = null) {
  const R = () => { const [s, v] = mulberry(S.rs); S.rs = s; return v };
  const out = { ticks: [], news: [] }, target = gameMin(untilSec);
  if (signals) S.sig = signals;
  S.extra ??= {}; out.listing = [];
  if (target - S.t > 300) S.t = target - 1; // longue coupure : le marché reprend là où il s'était arrêté
  const pending = {};
  for (const o of orders) pending[o.tk] = (pending[o.tk] ?? 0) + Number(o.q);
  while (S.t < target) { tick(S, R, out, pending); for (const k in pending) delete pending[k] }
  return out;
}

function publish(S, out, n) {
  const body = n.cat === "ipo" || n.cat === "faillite" ? n.text : article(S, n);
  const item = { id: S.nid++, t: realOf(S.t), tk: n.tk ?? null, sector: n.sector ?? null, cat: n.cat, title: n.title, text: body,
    sent: Math.round(n.sent * 100) / 100, fiab: n.fiab ?? 1 };
  out.news.push(item);
  const all = listed(S), hl = n.hl ?? 240, keys = n.tk ? (S.st[n.tk] ? [n.tk] : []) : n.sector ? all.filter(s => s.sector === n.sector).map(s => s.tk) : all.map(s => s.tk);
  for (const tk of keys) {
    // Nouvelles de secteur ou de marché : elles pèsent selon le tempérament de chaque action (une valeur refuge bouge moins).
    const m = (typeof n.mag === "object" ? n.mag[tk] ?? n.mag._ ?? 0 : n.mag ?? 0) * (n.tk ? 1 : Math.min(1.5, defOf(S, tk).sig / .02));
    const dv = Math.log(Math.max(.05, 1 + m * (n.fiab ?? 1)));
    S.st[tk].v += dv;
    // Les teneurs de marché décalent leurs prix dès l'annonce : une partie du choc passe d'un coup (gap), le reste par les ordres.
    if (S.st[tk].halt <= S.t && S.haltAll <= S.t) S.st[tk].lp += GAP * dv;
  }
  addSent(S, n.tk ?? (n.sector ? "sec:" + n.sector : "mkt"), n.sentEff ?? n.sent, S.t, hl);
  return item;
}

function companyNews(S, R, out, s, cat, signed) {
  const x = S.st[s.tk], hint = x.res && Math.abs(x.res.act - x.res.cons) > 1.5 && R() < .6 ? Math.sign(x.res.act - x.res.cons) : 0;
  if (cat === "analyste" && R() < .5 && revision(S, R, out, s)) return;
  const c = CATS[cat], sign = signed ?? c.sign ?? (hint || (R() < .5 ? -1 : 1));
  // Les petites nouvelles pèsent selon le tempérament de l'action ; les gros événements gardent leur ampleur.
  const mag = sign * between(R, c.mag) * (c.big ? .8 : .4 * s.sig / .02);
  const pool = T[cat][sign > 0 ? "up" : "down"] ?? T[cat].up;
  let title = fill(pick(R, pool), { N: s.name, X: pctTxt(Math.abs(mag) * (1 + R())), K: 50 + Math.floor(R() * 50), M: (1 + R() * 3).toFixed(1).replace(".", ",") });
  if (cat === "pdg" && s.tk !== "VLS" && /Varesko/.test(title)) title = fill(pick(R, T.pdg[sign > 0 ? "up" : "down"].slice(2)), { N: s.name });
  const sent = sign * Math.min(1, .3 + .7 * Math.abs(mag) / c.mag[1]);
  const n = { tk: s.tk, cat, title, text: pick(R, T[cat].text), mag, sent, fiab: c.fiab ?? 1, hl: c.hl };
  if (cat === "pdg") { n.sent = Math.max(-1, Math.min(1, sent * 1.5 + gauss(R) * .3)); n.mag = mag * .4 } // très bruitée : beaucoup d'émotion, peu de fond
  if (cat === "resultats" && R() < .2) n.sentEff = -n.sent * .6; // « vendre la nouvelle »
  if (cat === "resultats") S.st[s.tk].eps *= 1 + mag;
  publish(S, out, n);
  if (cat === "rumeur") S.follow.push({ t: S.t + 60 + Math.floor(R() * 300), tk: s.tk, mag, ok: R() < .5 });
}

// Résultats trimestriels : croissance du chiffre d'affaires sur un an, en points de %. Le consensus des analystes est public ;
// le vrai chiffre est tiré à l'avance et reste caché. Le cours réagit à la surprise (vrai − attendu), pas au chiffre.
// Des indices sortent entre-temps (commandes, déclarations, révisions d'analystes) ; les chiffres réels (LINKS) pèsent aussi.
function drawResult(R, s) {
  const cons = Math.round((s.mu * 100 + gauss(R) * 3) * 2) / 2;
  return { cons, act: cons + gauss(R) * (2 + 100 * s.sig) };
}
function results(S, R, out, s) {
  const x = S.st[s.tk], r = x.res ?? drawResult(R, s);
  const act = Math.round((r.act + (LINKS[s.tk] ? 30 * LINKS[s.tk].beta * (x.z ?? 0) : 0)) * 10) / 10, surprise = act - r.cons;
  const mag = surprise / 100 * .8, up = surprise >= 0, f = v => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1).replace(".", ",")} %`;
  const title = Math.abs(surprise) < .5 ? `${s.name} : chiffre d'affaires ${f(act)}, conforme aux attentes`
    : `${s.name} : chiffre d'affaires ${f(act)}, ${up ? "au-dessus" : "en dessous"} des ${f(r.cons)} attendus`;
  const n = { tk: s.tk, cat: "resultats", title, text: pick(R, T.resultats.text), mag, sent: Math.max(-1, Math.min(1, surprise / 6)), hl: 360 };
  if (R() < .2) n.sentEff = -n.sent * .6; // « vendre la nouvelle »
  x.eps *= 1 + act / 400;
  publish(S, out, n);
  x.res = drawResult(R, s);
}
// Révision d'un analyste : le consensus se rapproche (un peu) du vrai chiffre. C'est un indice pour qui suit l'action.
function revision(S, R, out, s) {
  const x = S.st[s.tk], r = x.res; if (!r) return false;
  const d = r.act - r.cons; if (Math.abs(d) < 1) return false;
  const nc = Math.round((r.cons + d * (.2 + .3 * R())) * 2) / 2; if (nc === r.cons) return false;
  const up = nc > r.cons; r.cons = nc;
  publish(S, out, { tk: s.tk, cat: "analyste", title: `Les analystes ${up ? "relèvent" : "abaissent"} leurs attentes pour ${s.name} : ${nc >= 0 ? "+" : "−"}${Math.abs(nc).toFixed(1).replace(".", ",")} % attendus`,
    text: "Révision du consensus avant les prochains résultats.", mag: (up ? 1 : -1) * .004, sent: up ? .3 : -.3, hl: 240 });
  return true;
}

function hourly(S, R, out) {
  for (const s of listed(S)) S.st[s.tk].res ??= drawResult(R, s); // premier consensus publié dès la première heure
  lifecycle(S, R, out);
  // Chiffres réels : un écart à la normale qui change fait bouger la valeur de l'entreprise, et c'est annoncé.
  for (const tk in LINKS) {
    const sg = S.sig?.[tk], x = S.st[tk]; if (!sg || typeof sg.z !== "number") continue;
    const d = sg.z - (x.z ?? 0); if (Math.abs(d) < .03) continue;
    x.z = sg.z;
    publish(S, out, { tk, cat: "reel", title: `${BY[tk].name} : ${sg.txt}`, text: LINKS[tk].src + ".", mag: LINKS[tk].beta * d, sent: Math.max(-1, Math.min(1, d * 6)), hl: 360 });
  }
  // Macro : marches aléatoires lentes, rappelées vers leur moyenne.
  S.g += .02 * (1.5 - S.g) + gauss(R) * .04; S.pi += .02 * (2.4 - S.pi) + gauss(R) * .03;
  for (const k in S.sent) { S.sent[k] = S.sent[k].filter(([, t0, hl]) => S.t - t0 < 6 * hl); if (!S.sent[k].length) delete S.sent[k] } // effets éteints
  // Régime (chaîne de Markov). Une euphorie qui dure rend le krach plus probable.
  const row = [...MARKOV[S.reg]];
  if (S.reg === "euphorie") { const b = Math.min(.05, S.regAge * .001); row[3] += b; row[1] -= b }
  let u = R(), j = 0; while (j < 4 && u >= row[j]) { u -= row[j]; j++ }
  if (RK[j] !== S.reg) { S.reg = RK[j]; S.regAge = 0; publish(S, out, REGIME_NEWS[S.reg](R)) } else S.regAge++;
  // Volatilité en grappes (GARCH sur les rendements horaires).
  for (const s of listed(S)) {
    const x = S.st[s.tk], p = priceOf(x), r = Math.log(p / x.h0), sh2 = (s.si * s.si) / 24;
    x.gh = Math.min(2.5, Math.max(.6, Math.sqrt((sh2 * .05 + .05 * r * r + .90 * x.gh * x.gh * sh2) / sh2)));
    x.h0 = p;
    // Réalisateur de figures : environ une tous les 3 jours par action.
    if (!x.pat && R() < 1 / 72) x.pat = startFigure(S, R, s, x);
  }
  // Grandes crises scénarisées : environ une tous les deux mois de jeu.
  if (!S.crisis && S.t > S.crisisCd && R() < 1 / 1440) startCrisis(S, R);
  whalesHourly(S, R, out);
}

const REGIME_NEWS = {
  calme: () => ({ cat: "marche", title: "Le marché retrouve son calme", sent: .1, hl: 120 }),
  euphorie: () => ({ cat: "marche", title: "Euphorie sur la Bourse d'Aurelys : les acheteurs se bousculent", sent: .5, hl: 240 }),
  nervosite: () => ({ cat: "marche", title: "Nervosité sur les marchés : les investisseurs hésitent", sent: -.3, hl: 180 }),
  krach: () => ({ cat: "marche", title: "Vent de panique : le marché décroche", sent: -.8, hl: 240 }),
  reprise: () => ({ cat: "marche", title: "Les acheteurs reviennent : le marché se reprend", sent: .4, hl: 180 }),
};

/* ===== Réalisateur de figures chartistes ===== */
const FIG = {
  hs: [[0, 1], [.15, 1.06], [.25, 1.02], [.45, 1.10], [.6, 1.02], [.75, 1.06], [.85, 1.01], [1, .94]],
  dtop: [[0, 1], [.25, 1.08], [.5, 1.03], [.75, 1.08], [1, .97]],
  dbot: [[0, 1], [.25, .92], [.5, .97], [.75, .92], [1, 1.04]],
  tri: [[0, 1], [.15, 1.06], [.3, 1.0], [.45, 1.06], [.6, 1.025], [.75, 1.06], [.85, 1.045], [1, 1.10]],
  flag: [[0, 1], [.25, 1.10], [.4, 1.08], [.55, 1.09], [.7, 1.065], [1, 1.16]],
  cup: [[0, 1], [.15, .95], [.3, .92], [.45, .95], [.6, 1.0], [.7, .97], [.8, .98], [1, 1.06]],
};
FIG.ihs = FIG.hs.map(([t, p]) => [t, 2 - p]);
function startFigure(S, R, s, x) {
  const p = priceOf(x), back = x.h[0], run = Math.log(p / back); // tendance des 4 dernières heures
  const type = run > .04 ? pick(R, ["hs", "dtop", "flag"]) : run < -.04 ? pick(R, ["ihs", "dbot"]) : pick(R, ["tri", "cup", "flag", "hs", "dbot"]);
  const amp = s.sig / .02 * .8, dur = 480 + Math.floor(R() * 480);
  return { type, t0: S.t, dur, base: Math.log(p), tgt: Math.log(p), k: R() < .65 ? 1 : .3,
    keys: FIG[type].map(([t, r]) => [t, Math.log(1 + (r - 1) * amp)]) };
}
function figureBias(S, R, s, x) {
  const f = x.pat; if (!f) return 0;
  const u = (S.t - f.t0) / f.dur;
  if (u >= 1) { x.pat = null; return 0 }
  const nxt = f.keys.find(([t]) => t > u) ?? f.keys.at(-1), rest = Math.max(1, (nxt[0] - u) * f.dur);
  f.tgt += (f.base + nxt[1] - f.tgt) / rest + gauss(R) * s.si / Math.sqrt(DAY) * .5; // pont brownien vers le point clé suivant
  return f.k * 1.2 * (f.tgt - Math.log(priceOf(x))) / (s.sig / Math.sqrt(24));
}

/* ===== Baleines ===== */
function whalesHourly(S, R, out) {
  const W = S.whales, now = S.t, pv = s => priceOf(S.st[s.tk]) / Math.exp(S.st[s.tk].v);
  // Le Kraken : pump & dump sur Solarmine.
  const k = W.kraken;
  if (k.ph === "idle" && now >= k.until) Object.assign(k, { ph: "buy", until: now + 1440 + Math.floor(R() * 1440), pos: 0, p0: priceOf(S.st.SLM), hint: now + 300 + Math.floor(R() * 600) });
  else if (k.ph === "buy" && (now >= k.until || priceOf(S.st.SLM) > k.p0 * 1.3)) Object.assign(k, { ph: "dump", until: now + 30 });
  // Fonds Orca : accumulation lente d'une valeur sous-évaluée.
  const o = W.orca;
  if (o.ph === "idle" && now >= o.until) {
    const tk = STOCKS.filter(s => s.tk !== "SLM").sort((a, b) => pv(a) - pv(b))[0].tk;
    Object.assign(o, { ph: "buy", tk, until: now + 2160 + Math.floor(R() * 2160), pos: 0, hint: now + 600 });
  } else if (o.ph === "buy" && now >= o.until) Object.assign(o, { ph: "hold", until: now + 1440 });
  else if (o.ph === "hold" && now >= o.until) o.ph = "sell";
  else if (o.ph === "sell" && o.pos <= 0) Object.assign(o, { ph: "idle", until: now + 4320 + Math.floor(R() * 4320) });
  // Groupe Léviathan : vente à découvert après une « étude » négative.
  const l = W.lev;
  if (l.ph === "idle" && now >= l.until) {
    const s = [...STOCKS].sort((a, b) => pv(b) - pv(a))[0];
    Object.assign(l, { ph: "short", tk: s.tk, until: now + 60, pos: 0 });
    publish(S, out, { tk: s.tk, cat: "baleine", title: `Le groupe Léviathan publie une étude accablante sur ${s.name}`, text: "Le fonds annonce parier sur la baisse du titre.", sent: -.8, mag: -.05, fiab: .5, hl: 360 });
  } else if (l.ph === "short" && now >= l.until) Object.assign(l, { ph: "wait", until: now + 1440 });
  else if (l.ph === "wait" && now >= l.until) l.ph = "cover";
  else if (l.ph === "cover" && l.pos >= 0) Object.assign(l, { ph: "idle", until: now + 5760 + Math.floor(R() * 5760) });
  // Fonds souverain : rachète le marché en cas de krach profond.
  const v = W.sov;
  if (v.ph === "idle" && S.reg === "krach" && S.idx < S.idxHi * .85 && now >= v.until) sovereign(S, out);
  else if (v.ph === "buy" && now >= v.until) Object.assign(v, { ph: "idle", until: now + 2880 });
}
function sovereign(S, out) {
  Object.assign(S.whales.sov, { ph: "buy", until: S.t + 120 });
  S.reg = "reprise"; S.regAge = 0;
  publish(S, out, { cat: "baleine", title: "Le fonds souverain d'Aurelys intervient pour soutenir le marché", text: "Le gouverneur Holm salue une décision « responsable ».", sent: .7, mag: .02, hl: 360 });
}
// Flux des baleines sur une action pendant ce tick (Ꜷ, + achat).
function whaleFlow(S, R, out, s, Lt) {
  const W = S.whales; let q = 0;
  const k = W.kraken;
  if (s.tk === "SLM") {
    if (k.ph === "buy" && R() < .5) { const b = .5 * Lt; k.pos += b; q += b }
    if (k.ph === "buy" && k.hint && S.t >= k.hint) { k.hint = 0; publish(S, out, { tk: "SLM", cat: "baleine", title: "Volume inhabituel sur Solarmine : un mystérieux acheteur ?", text: "Certains évoquent le Kraken.", sent: .3, mag: 0, fiab: .3, hl: 240 }) }
    if (k.ph === "dump") { const d = k.pos / Math.max(1, k.until - S.t); k.pos -= d; q -= d; if (S.t >= k.until - 1) { Object.assign(k, { ph: "idle", until: S.t + 2880 + Math.floor(R() * 2880), pos: 0 }); publish(S, out, { tk: "SLM", cat: "baleine", title: "Solarmine s'effondre : le Kraken aurait tout vendu", text: "Les derniers acheteurs restent piégés.", sent: -.6, mag: 0, fiab: .3, hl: 240 }) } }
  }
  const o = W.orca;
  if (o.tk === s.tk) {
    if (o.ph === "buy" && R() < .6) { const b = .3 * Lt; o.pos += b; q += b }
    if (o.ph === "buy" && o.hint && S.t >= o.hint) { o.hint = 0; publish(S, out, { tk: s.tk, cat: "baleine", title: `Le fonds Orca monterait au capital de ${s.name}`, text: "Des achats réguliers sont repérés depuis plusieurs heures.", sent: .3, mag: 0, fiab: .3, hl: 360 }) }
    if (o.ph === "sell") { const d = Math.min(o.pos, .2 * Lt); o.pos -= d; q -= d }
  }
  const l = W.lev;
  if (l.tk === s.tk) {
    if (l.ph === "short") { const d = 2 * Lt; l.pos -= d; q -= d }
    if (l.ph === "cover") { const b = Math.min(-l.pos, .5 * Lt); l.pos += b; q += b }
  }
  if (W.sov.ph === "buy") q += 1.5 * Lt;
  if (S.flash > S.t) q -= 6 * Lt;
  return q;
}

/* ===== Crises ===== */
const CRISES = {
  bulle: [
    [0, { tk: "NXR", cat: "crise", title: "Nexora dépasse les 30 Mds d'aurels de capitalisation : la folie de l'IA continue", sent: .8, mag: 0, hl: 240 }, "euphorie"],
    [240, { sector: "tech", cat: "crise", title: "Bulle de l'IA : Nexora publie des résultats décevants, la Tech plonge", sent: -1, mag: { NXR: -.4, _: -.25 }, hl: 480 }, "krach"],
  ],
  banque: [
    [0, { tk: "BCS", cat: "crise", title: "Rumeur : la Banque Castellane cacherait des pertes colossales", sent: -.6, mag: -.05, fiab: .3, hl: 240 }, "nervosite"],
    [90, { sector: "finance", cat: "crise", title: "Crise bancaire : Castellane suspend les retraits", sent: -1, mag: -.25, hl: 480 }, "krach"],
    [100, { cat: "crise", title: "Contagion : toute la cote recule", sent: -.7, mag: -.06, hl: 360 }, null],
    [300, "souverain"],
  ],
  petrole: [
    [0, { cat: "crise", title: "Blocage du détroit de Varn : le fret maritime paralysé", sent: -.5, mag: { HLV: .15, MRV: -.15, FRC: -.07, VLS: -.07, KST: -.07, _: -.02 }, hl: 480 }, "nervosite"],
  ],
  pandemie: [
    [0, { sector: "sante", cat: "crise", title: "Un virus inconnu se propage à Port-Aurel", sent: -.4, mag: 0, hl: 240 }, "nervosite"],
    [180, { cat: "crise", title: "Pandémie aurélienne : le pays se confine", sent: -.9, mag: { OMB: .15, LMR: .08, _: -.12 }, hl: 600 }, "krach"],
  ],
  eclair: [
    [0, "flash"],
    [12, { cat: "crise", title: "Krach éclair : un algorithme fou vend tout en quelques minutes", text: "Les cours se reprennent presque aussitôt.", sent: -.2, mag: 0, hl: 60 }, null],
  ],
};
function startCrisis(S, R) {
  const nx = S.st.NXR, bubble = S.reg === "euphorie" && priceOf(nx) > Math.exp(nx.v) * 1.4;
  S.crisis = { id: bubble ? "bulle" : pick(R, ["banque", "petrole", "pandemie", "eclair"]), i: 0, t0: S.t };
}
function runCrisis(S, out) {
  const c = S.crisis; if (!c) return;
  const steps = CRISES[c.id];
  while (c.i < steps.length && S.t >= c.t0 + steps[c.i][0]) {
    const [, what, reg] = steps[c.i++];
    if (what === "souverain") sovereign(S, out);
    else if (what === "flash") S.flash = S.t + 10;
    else publish(S, out, what);
    if (reg) { S.reg = reg; S.regAge = 0 }
  }
  if (c.i >= steps.length) { S.crisis = null; S.crisisCd = S.t + 1440 * 20 }
}

// SPM cours de a vers b (le dernier vaut b) : marche aléatoire ramenée sur b (pont brownien), pas de σ par seconde.
function bridge(R, a, b, sd) {
  const w = [0]; for (let k = 1; k <= SPM; k++) w.push(w[k - 1] + gauss(R) * sd);
  const la = Math.log(a), lb = Math.log(b), out = [];
  for (let k = 1; k <= SPM; k++) out.push(k === SPM ? b : Math.exp(la + (lb - la) * k / SPM + w[k] - w[SPM] * k / SPM));
  return out;
}

/* ===== Un tick ===== */
function tick(S, R, out, pending) {
  const t = ++S.t, m = t, hour = hourOf(m), act = activity(hour), reg = REGIMES[S.reg];
  if (m % 60 === 0) hourly(S, R, out);
  runCrisis(S, out);

  // Actualités (processus de Poisson) : 1 par entreprise / 8 h, par secteur / 12 h, macro / 24 h, plus en période agitée.
  for (const s of listed(S)) {
    if (S.next[s.tk] <= t) {
      if (S.next[s.tk]) { const w = { ...COMMON, ...PRODUCT[s.tk] }, tot = Object.values(w).reduce((a, b) => a + b, 0); let u = R() * tot, cat; for (cat in w) if ((u -= w[cat]) < 0) break; companyNews(S, R, out, s, cat) }
      S.next[s.tk] = t + Math.ceil(-Math.log(1 - R()) * 960 / reg.news);
    }
    if (resultsAt(s.i, Math.floor(m / DAY)) === m) results(S, R, out, s);
  }
  for (const sec of Object.keys(SECTORS)) {
    const key = "sec:" + sec;
    if (S.next[key] <= t) {
      if (S.next[key]) { const up = R() < .5, mag = (up ? 1 : -1) * (.005 + R() * .02); publish(S, out, { sector: sec, cat: "secteur", title: fill(pick(R, SECTOR_NEWS[up ? "up" : "down"]), { S: SECTORS[sec].name }), mag, sent: mag * 15, hl: 360 }) }
      S.next[key] = t + Math.ceil(-Math.log(1 - R()) * 1440 / reg.news);
    }
  }
  if (S.next.mkt <= t) { if (S.next.mkt) macroNews(S, R, out); S.next.mkt = t + Math.ceil(-Math.log(1 - R()) * 1440 / reg.news) }
  if (bcaAt(Math.floor(m / DAY)) === m) rateDecision(S, R, out);
  for (const f of S.follow.filter(f => f.t <= t)) {
    const s = defOf(S, f.tk); if (!S.st[f.tk]) continue;
    publish(S, out, f.ok
      ? { tk: f.tk, cat: "rumeur", title: `${s.name} confirme : la rumeur était fondée`, mag: f.mag * .7, sent: Math.sign(f.mag) * .6, hl: 240 }
      : { tk: f.tk, cat: "rumeur", title: `${s.name} dément formellement les rumeurs`, mag: -f.mag * .3, sent: -Math.sign(f.mag) * .4, hl: 180 });
  }
  S.follow = S.follow.filter(f => f.t > t);

  // Facteurs communs : marché (tendance du régime) et secteurs.
  const mk = reg.drift / 60 + gauss(R) * .006 / Math.sqrt(DAY) * reg.vol;
  const sk = Object.fromEntries(Object.keys(SECTORS).map(k => [k, gauss(R) * .005 / Math.sqrt(DAY) * reg.vol]));
  const sentM = sentOf(S, "mkt", t), sentS = Object.fromEntries(Object.keys(SECTORS).map(k => [k, sentOf(S, "sec:" + k, t)]));
  const fear = 15 * Math.sqrt(S.vix / VIX_BASE), yr = 365 * DAY;

  let cap = 0, vol = 0, allHalt = S.haltAll > t;
  const sub = []; // cours de chaque seconde de la minute, par action (voir plus bas)
  for (const s of listed(S)) {
    const x = S.st[s.tk], sec = SECTORS[s.sector];
    // Valeur fondamentale : croissance (modulée par la macro), incertitude, facteurs communs.
    const mu = (s.mu + sec.cyc * (S.g - 1.5) * .04 + sec.infl * (S.pi - 2.4) * .03) / yr;
    const f = s.beta * mk + sk[s.sector];
    x.v += mu + gauss(R) * .3 * s.sig / Math.sqrt(DAY) + f;
    const Lt = s.L * act;
    let q = 0, v = 0;
    const halted = allHalt || x.halt > t;
    if (!halted) {
      const p = priceOf(x), V = Math.exp(x.v), sh = s.sig / Math.sqrt(24), sd = s.sig;
      const sent = sentOf(S, s.tk, t) + .6 * sentS[s.sector] + .5 * sentM;
      const n = x.h.length, crowd = n > 10 ? Math.log(p / x.h[n - 11]) / (sh / 2) : 0;
      const rsi = x.rl ? 100 - 100 / (1 + x.rg / x.rl) : 50;
      const win = x.h.slice(-120, -5), hi = win.length ? Math.max(...win) : p, lo = win.length ? Math.min(...win) : p, prev = x.h[n - 1];
      const loud = x.vol0 > 1.5 * x.ve;
      const fig = figureBias(S, R, s, x);
      const pull = p > 3 * V || p < V / 3 ? 3 : 1;
      for (const b of botsOf(s)) {
        if (R() > .2 * act) continue;
        let D;
        if (b.f === "fund") D = 4 * pull * (V * (1 + b.eps) - p) / p / sd;
        else if (b.f === "mom") D = 1.5 * (x.e[b.hs] - x.e[b.hl]) / x.e[b.hl] / sh;
        else if (b.f === "contra") { const back = x.h[Math.max(0, n - 1 - b.n)], r = Math.log(p / back), sn = sh * Math.sqrt(b.n / 60); D = Math.abs(r) > 1.5 * sn ? -.8 * r / sn : 0 }
        else if (b.f === "chart") {
          D = 0;
          if (p > hi * 1.002 && loud) D = 2; else if (p < lo * .998) D = -2;
          else if (p < lo * 1.004 && p > prev) D = 1; else if (p > hi * .996 && p < prev) D = -1;
          if (rsi > 70) D -= .7; else if (rsi < 30) D += .7;
        } else D = 1.5 * sent + .3 * crowd + gauss(R) * b.noise + fig + reg.panic;
        D = D * (1 - b.av * fear / 100) * reg.fam[b.f] + b.bias;
        if (Math.abs(D) <= b.th) continue;
        const size = Math.min(b.f === "fund" ? 8 : 3, Math.abs(D) * b.agg) * FLOW * Lt;
        q += Math.sign(D) * size; v += size;
      }
      // Teneurs de marché : ils absorbent une partie du déséquilibre (jamais moins de 10 %).
      q *= 1 - Math.max(.1, .35 * reg.mm);
      const wq = whaleFlow(S, R, out, s, Lt), pq = pending[s.tk] ?? 0;
      q += wq + pq; v += Math.abs(wq) + Math.abs(pq);
      const qb = q - pq, imp = (qb ? impact(S, s, qb, act) : 0) + (pq ? playerImpact(S, s, pq) : 0);
      x.lp += PERM * imp + f; x.tmp = x.tmp * Math.exp(-1 / TAU) + (1 - PERM) * imp;
    }
    const p = priceOf(x), last = x.h[x.h.length - 1];
    // Indicateurs suivis par les bots : moyennes mobiles exponentielles, RSI, historique de 4 h.
    EMA_H.forEach((h, j) => { x.e[j] += (p - x.e[j]) * 2 / (h + 1) });
    const d = p - last; x.rg = (x.rg * 13 + Math.max(0, d)) / 14; x.rl = (x.rl * 13 + Math.max(0, -d)) / 14;
    x.h.push(p); if (x.h.length > 240) x.h.shift();
    x.vol0 = v; x.ve += (v - x.ve) / 60;
    // Coupe-circuit : plus de 10 % en une heure de jeu → cotation suspendue 15 minutes.
    // (Une fois par mouvement : pas de nouvelle suspension tant que l'heure qui l'a déclenchée est dans la fenêtre.)
    if (!halted && t - (x.cb ?? 0) > 60 && x.h.length > 60 && Math.abs(p / x.h[x.h.length - 61] - 1) > .10) {
      x.halt = t + 15; x.cb = t;
      publish(S, out, { tk: s.tk, cat: "suspension", title: `Séance suspendue sur ${s.name} après un mouvement de ${pctTxt(p / x.h[x.h.length - 61] - 1).replace(/^(\d)/, "+$1")}`, sent: 0, mag: 0, hl: 30 });
    }
    if (BY[s.tk]) cap += p * s.shares; vol += v; // l'AUR-12 ne compte que la cote principale
    // Une minute d'Aurelys = SPM secondes : entre le cours précédent et le nouveau, un pont brownien donne un vrai cours
    // à chaque seconde (même volatilité, cours atteignables par les ordres et la liquidation).
    const ps = bridge(R, last, p, halted ? 0 : s.sig / Math.sqrt(DAY * SPM)), hl = halted || x.halt > t;
    if (BY[s.tk]) sub.push({ s, ps });
    ps.forEach((q, k) => out.ticks.push({ t: realOf(t - 1) + k + 1, tk: s.tk, p: +q.toPrecision(7), v: Math.round(v / SPM), halt: hl }));
  }
  const idx = cap / DIV, ri = Math.log(idx / S.idx);
  S.vix += (ri * ri - S.vix) / 120; S.idx = idx; S.idxHi = Math.max(idx, S.idxHi * (1 - 1 / 2880));
  S.idxH.push(idx); if (S.idxH.length > 61) S.idxH.shift();
  if (!allHalt && t - (S.cbAll ?? 0) > 60 && S.idxH.length > 60 && idx / S.idxH[0] - 1 < -.07) {
    S.haltAll = t + 15; S.cbAll = t;
    publish(S, out, { cat: "suspension", title: "AUR-12 : chute de plus de 7 %, toute la cote est suspendue 15 minutes", sent: -.3, mag: 0, hl: 60 });
  }
  for (let k = 0; k < SPM - 1; k++) out.ticks.push({ t: realOf(t - 1) + k + 1, tk: INDEX, p: +(sub.reduce((a, { s, ps }) => a + ps[k] * s.shares, 0) / DIV).toPrecision(7), v: Math.round(vol / SPM), halt: allHalt });
  out.ticks.push({ t: realOf(t), tk: INDEX, p: +idx.toPrecision(7), v: Math.round(vol / SPM), halt: allHalt,
    x: { reg: S.reg, regAge: S.regAge, vixa: Math.round(fear * 10) / 10, r: Math.round(S.r * 100) / 100, g: Math.round(S.g * 100) / 100, pi: Math.round(S.pi * 100) / 100,
      eps: Object.fromEntries(listed(S).map(s => [s.tk, +S.st[s.tk].eps.toPrecision(4)])),
      cons: Object.fromEntries(listed(S).map(s => [s.tk, S.st[s.tk].res?.cons ?? null])), // consensus des analystes (le vrai chiffre reste caché)
      sig: S.sig } });
}

function macroNews(S, R, out) {
  const kind = pick(R, ["croissance", "inflation", "geo"]);
  if (kind === "croissance") {
    const g = S.g + gauss(R) * .3, up = g >= S.g; S.g = g;
    publish(S, out, { cat: "macro", title: `Croissance d'Aurelys : ${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(1).replace(".", ",")} % sur un an, ${up ? "mieux" : "moins bien"} que prévu`, sent: up ? .4 : -.4, mag: Object.fromEntries([...STOCKS.map(s => [s.tk, (up ? 1 : -1) * .01 * SECTORS[s.sector].cyc])]), hl: 360 });
  } else if (kind === "inflation") {
    const pi = Math.max(0, S.pi + gauss(R) * .3), up = pi >= S.pi; S.pi = pi;
    publish(S, out, { cat: "macro", title: `Inflation : ${pi.toFixed(1).replace(".", ",")} % sur un an, ${up ? "en accélération" : "en repli"}`, sent: up ? -.3 : .3, mag: Object.fromEntries(STOCKS.map(s => [s.tk, (up ? 1 : -1) * .01 * SECTORS[s.sector].infl])), hl: 360 });
  } else {
    const t = pick(R, [["Tensions à la frontière nord : les marchés s'inquiètent", { MRV: -.06, HLV: .04, KST: .03, _: -.01 }], ["Accord commercial historique avec les pays voisins", { MRV: .05, FRC: .03, _: .01 }], ["Grève générale dans les ports d'Aurelys", { MRV: -.08, LMR: -.02, _: -.005 }]]);
    const neg = Object.values(t[1]).reduce((a, b) => a + b, 0) < 0;
    publish(S, out, { cat: "macro", title: t[0], sent: neg ? -.5 : .4, mag: t[1], hl: 360 });
  }
}

function rateDecision(S, R, out) {
  const want = .5 * (S.pi - 2) + .25 * (S.g - 1.5) + gauss(R) * .15;
  const dr = Math.max(-.5, Math.min(.5, Math.round(want / .25) * .25)), r = Math.max(0, S.r + dr), real = r - S.r;
  S.r = r;
  const txt = real === 0 ? `La Banque Centrale maintient son taux à ${r.toFixed(2).replace(".", ",")} %`
    : `La Banque Centrale ${real > 0 ? "relève" : "baisse"} ses taux de ${Math.abs(real).toFixed(2).replace(".", ",")} point, à ${r.toFixed(2).replace(".", ",")} %`;
  publish(S, out, { cat: "taux", title: txt, text: "Conférence du gouverneur Albrecht Holm dans la foulée.", sent: -real * 1.2,
    mag: Object.fromEntries(STOCKS.map(s => [s.tk, SECTORS[s.sector].rate * real])), hl: 480 });
}

/* ===== Indicateurs pour l'écran ===== */
export const sma = (v, n) => v.map((_, i) => i < n - 1 ? null : v.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n);
export function bollinger(v, n = 20) {
  const m = sma(v, n);
  return m.map((x, i) => { if (x == null) return null; const sd = Math.sqrt(v.slice(i - n + 1, i + 1).reduce((a, b) => a + (b - x) ** 2, 0) / n); return [x - 2 * sd, x + 2 * sd] });
}
export function rsi(v, n = 14) {
  let g = 0, l = 0; const out = [null];
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + Math.max(0, d)) / n; l = (l * (n - 1) + Math.max(0, -d)) / n;
    out.push(i < n ? null : l ? 100 - 100 / (1 + g / l) : 100);
  }
  return out;
}
