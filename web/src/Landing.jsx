// Page d'accueil (« / ») : comprendre Aurelys en 5 secondes et l'essayer sans compte.
// Le graphique et le bandeau viennent du vrai moteur, qui tourne ici dans le navigateur (aucun appel au serveur).
import { useEffect, useRef, useState } from "react";
import { initState, advance, STOCKS, BY, INDEX, REGIMES, SPM } from "../supabase/functions/_shared/aurelys.js";
import { TkIcon } from "./logos.jsx";
import { Logo } from "./nav.jsx";
import { nf2, pct, cls } from "./format.js";

const HERO = "PXF", BAND = ["NXR", "HLV", "SLM"], CANDLE = 10, SHOWN = 44; // bougies de 10 minutes d'Aurelys
const px = p => p == null ? "—" : nf2.format(p);

// Marché simulé localement : 8 h d'Aurelys d'avance, puis une minute d'Aurelys toutes les 0,7 s.
function useSim() {
  const [, render] = useState(0), sim = useRef(null);
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = Math.floor(Date.now() / 1000), S = initState(t0, t0 % 1e6), d = { S, v: t0, cs: [], open: {}, last: {}, news: null, n: 0 };
    const step = mins => {
      d.v += mins * SPM;
      const o = advance(S, d.v);
      for (const k of o.ticks) {
        d.open[k.tk] ??= k.p; d.last[k.tk] = k.p;
        if (k.tk !== HERO) continue;
        const m = Math.floor((k.t - t0) / SPM / CANDLE), c = d.cs.at(-1);
        if (c && c.m === m) { c.h = Math.max(c.h, k.p); c.l = Math.min(c.l, k.p); c.c = k.p } else d.cs.push({ m, o: c?.c ?? k.p, h: k.p, l: k.p, c: k.p });
      }
      if (o.news.length) d.news = o.news.at(-1);
      if (d.cs.length > SHOWN) d.cs.splice(0, d.cs.length - SHOWN);
    };
    const id0 = setTimeout(() => { for (let i = 0; i < 4; i++) step(120); sim.current = d; render(n => n + 1) }, 30); // après le premier affichage
    const id = reduce ? null : setInterval(() => { if (!sim.current || document.hidden) return; step(1); render(n => n + 1) }, 700);
    return () => { clearTimeout(id0); clearInterval(id) };
  }, []);
  return sim.current;
}

function Candles({ cs }) {
  const w = 640, h = 280, pad = 8;
  if (!cs?.length) return <div className="land-chart" aria-hidden="true" />;
  const hi = Math.max(...cs.map(c => c.h)), lo = Math.min(...cs.map(c => c.l)), y = v => pad + (hi - v) / (hi - lo || 1) * (h - 2 * pad), step = w / SHOWN;
  return (
    <svg className="land-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Cours simulé de ${BY[HERO].name}, en bougies`}>
      {cs.map((c, i) => { const x = i * step + step / 2, up = c.c >= c.o, col = up ? "var(--up)" : "var(--down)";
        return <g key={c.m}><line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth="1.5" />
          <rect x={x - step * .32} width={step * .64} y={y(Math.max(c.o, c.c))} height={Math.max(1.5, Math.abs(y(c.o) - y(c.c)))} fill={col} rx="1" /></g> })}
    </svg>
  );
}

export default function Landing() {
  const d = useSim(), chg = tk => d && d.open[tk] ? d.last[tk] / d.open[tk] - 1 : 0, reg = d && REGIMES[d.S.reg];
  return (
    <div className="landing">
      <header className="land-top"><Logo /><a className="link" href="/jouer">Se connecter</a></header>

      <section className="land-hero">
        <div>
          <h1>Une bourse inventée, branchée sur le vrai monde</h1>
          <p className="land-sub">Achète ou vends 13 sociétés fictives, avec ou sans levier. Leurs cours naissent des ordres des joueurs et réagissent à de vrais chiffres : météo, électricité, jours fériés.</p>
          <div className="land-cta">
            <a className="btn primary big" href="/jouer?demo=1">Essayer maintenant (sans compte)</a>
            <a className="btn big" href="/jouer">Créer un compte</a>
          </div>
          <p className="muted small">Gratuit. Aucune vraie monnaie : tu démarres avec 10 000 W fictifs.</p>
        </div>
        <figure className="land-fig panel">
          <figcaption><span className="who"><TkIcon tk={HERO} size={26} /><b>{BY[HERO].name}</b></span>
            <span className="mono">{px(d?.last[HERO])} W <span className={cls(chg(HERO))}>{chg(HERO) >= 0 ? "▲" : "▼"} {pct(chg(HERO))}</span></span></figcaption>
          <Candles cs={d?.cs} />
          <p className="fine">Simulation calculée en direct dans ton navigateur par le moteur du jeu.</p>
        </figure>
      </section>

      <section className="land-band panel" aria-label="Le marché vit en ce moment">
        <h2>Le marché vit en ce moment <span className="muted">aperçu simulé</span></h2>
        <div className="land-quotes">
          <div><small>AUR-12</small><b className="mono">{px(d?.last[INDEX])}</b><span className={"mono " + cls(chg(INDEX))}>{pct(chg(INDEX))}</span></div>
          {BAND.map(tk => <div key={tk}><small className="who"><TkIcon tk={tk} size={18} />{BY[tk].name}</small><b className="mono">{px(d?.last[tk])}</b><span className={"mono " + cls(chg(tk))}>{chg(tk) >= 0 ? "▲" : "▼"} {pct(chg(tk))}</span></div>)}
          <div><small>Humeur du marché</small><b>{reg ? `${reg.icon} ${reg.name}` : "—"}</b></div>
        </div>
        <p className="small"><b>Dernière nouvelle :</b> {d?.news?.title ?? "les analystes préparent leurs notes…"}</p>
      </section>

      <section className="land-sec">
        <h2>Comment ça marche</h2>
        <ol className="land-steps">
          <li><b>Choisis une société</b><span>Une star de l'IA, un studio de jeux vidéo, une minière, une banque…</span></li>
          <li><b>Achète ou vends</b><span>À la hausse ou à la baisse, avec ou sans levier. Tu clôtures quand tu veux.</span></li>
          <li><b>Suis les nouvelles</b><span>Rumeurs, résultats, banque centrale : chaque annonce fait bouger les cours.</span></li>
        </ol>
      </section>

      <section className="land-sec">
        <h2>Ce qui le rend différent</h2>
        <div className="land-cards">
          <article className="panel"><b>Un marché qui réagit à tes ordres</b><p>Les prix naissent des ordres des joueurs, des bots et des baleines. Un gros ordre fait bouger le cours.</p></article>
          <article className="panel"><b>Branché sur le vrai monde</b><p>Granterre suit la pluie en Beauce, Helvane la consommation d'électricité (RTE), Lumirue les jours fériés.</p></article>
          <article className="panel"><b>Des guildes</b><p>Rejoins une guilde, remplis son trésor et construis sa ville avec les autres membres.</p></article>
          <article className="panel"><b>Talents et succès</b><p>Ton gain de trading te fait monter de niveau. 4 branches de talents, 51 succès à débloquer.</p></article>
        </div>
      </section>

      <section className="land-sec">
        <h2>En images</h2>
        <div className="land-shots">
          {[["marche", "Le marché"], ["fiche", "La fiche d'une société"], ["guilde", "Une guilde"]].map(([f, t]) => (
            <figure key={f}><img src={`/captures/${f}.webp`} alt={t} width="375" height="760" loading="lazy" decoding="async" /><figcaption className="muted small">{t}</figcaption></figure>))}
        </div>
      </section>

      <section className="land-sec">
        <h2>Les 13 sociétés cotées <span className="muted">et de jeunes pousses qui entrent en bourse</span></h2>
        <ul className="land-cos">
          {STOCKS.map(s => <li key={s.tk}><TkIcon tk={s.tk} size={34} /><span><b>{s.name}</b><small className="muted">{s.desc}</small></span></li>)}
        </ul>
        <div className="land-cta"><a className="btn primary big" href="/jouer?demo=1">Essayer maintenant (sans compte)</a></div>
      </section>

      <footer className="land-foot">
        <p><b>Jeu gratuit, aucune vraie monnaie, aucun conseil financier. Le W est une monnaie fictive.</b></p>
        <p>Les sociétés, leurs dirigeants et leurs cours sont inventés. Aucun cookie de suivi : ta session reste dans ton navigateur.</p>
        <details><summary>Mentions légales</summary>
          <p>Éditeur : Aurelys, projet personnel non professionnel (identité communiquée à l'hébergeur, art. 6-III-2 de la LCEN).
            Hébergement : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis. Données de jeu : Supabase.</p>
        </details>
        <p><a href="https://github.com/Victor0904/WikiBet/issues" rel="noopener">Contact</a></p>
      </footer>
    </div>
  );
}
