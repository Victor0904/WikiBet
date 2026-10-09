// Bourse d'Aurelys : tableau de bord, liste des actions, actualités, carte thermique, fiche entreprise, carte de position.
import { useEffect, useMemo, useRef, useState } from "react";
import { STOCKS, BY, SECTORS, REGIMES, CHARACTERS, INDEX, FEE, CAP_MULT, LINKS, IPO, SPM, DAY, EPOCH_S, gameClock, gameMin, calendar, sma, bollinger, rsi } from "../supabase/functions/_shared/aurelys.js";
import { dayOpen } from "./aurelys.js";
import { STORIES } from "../supabase/functions/_shared/aurelys-stories.js";
import { W, sW, nf0, nf2, pct, cls, clock } from "./format.js";
import { tradeValue, liqPrice } from "./engine.js";
import { Spark, PositionChart } from "./charts.jsx";

export const px = v => v == null || isNaN(v) ? "—" : nf2.format(v);
const sec = ms => ms / 1000;
// Tout s'affiche en temps d'Aurelys (1 min de jeu = 5 s réelles), sauf « il y a … » des actualités, en temps réel.
const gdur = ms => { const m = Math.max(0, Math.floor(ms / 1000 / SPM)), d = Math.floor(m / DAY), h = Math.floor(m % DAY / 60);
  return d ? `${d} j ${h} h` : h ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${m} min` };
// « aujourd'hui 14:45 », « demain 09:00 », « jour 14 · 16:00 » (jour et heure d'Aurelys).
const gwhen = (atMs, nowMs) => { const a = gameClock(atMs / 1000), n = gameClock(nowMs / 1000), d = a.day - n.day;
  return `${d === 0 ? "aujourd'hui" : d === 1 ? "demain" : `jour ${a.day}`} ${a.hm}` };
// Heure réelle, pour les articles et les levées de fonds : « 21:30 », « demain 01:30 », « ven. 9 oct. 14:00 ».
const real = ms => { const d = new Date(ms), t = clock(ms), n = new Date(), days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(n).setHours(0, 0, 0, 0)) / 864e5);
  return days === 0 ? t : days === 1 ? `demain ${t}` : days === -1 ? `hier ${t}` : `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} ${t}` };
const signed = v => `${v >= 0 ? "+" : "−"}${nf2.format(Math.abs(v)).replace(/,?0+$/, "")} %`;
const agoTxt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `il y a ${s} s` : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : `il y a ${Math.floor(s / 3600)} h` };
// Derniers cours pour une mini-courbe : bougies d'une heure d'Aurelys, ou cours minute par minute tant qu'il y a peu de bougies.
const closesOf = (aur, tk, n) => { const c = (aur.candles[tk] ?? []).slice(-n).map(k => k[4]); return c.length >= 5 ? c : (aur.ticks[tk] ?? []).map(k => k[1]) };
const chgOf = (aur, tk, now) => { const p = aur.quotes[tk]?.p, o = dayOpen(aur, tk, sec(now)); return p && o ? p / o - 1 : 0 };

// Fiche d'une entreprise : histoire écrite à la main (cote principale) ou générée par le moteur (jeunes pousses).
const info = tk => STORIES[tk] ?? BY[tk] ?? {};
const paras = t => (t ?? "").split("\n\n").filter(Boolean);

export const TkIcon = ({ tk, size = 34 }) => (
  <span className="coin-icon tk-icon" style={{ background: BY[tk]?.color ?? "var(--panel2)", width: size, height: size, fontSize: size * .3 }} aria-hidden="true">{tk}</span>
);

// Bandeau : horloge d'Aurelys (décor), régime, AUR-12.
function AurBar({ aur, now }) {
  const c = gameClock(sec(now)), reg = REGIMES[aur.x?.reg ?? "calme"], idx = aur.quotes[INDEX]?.p, ch = chgOf(aur, INDEX, now);
  return (
    <div className="aur-bar">
      <span className="aur-clock mono" title="Heure d'Aurelys : une journée dure 1 h réelle"><small>Aurelys · jour {c.day}</small>{c.hm}</span>
      <span className="aur-reg" title={REG_TXT[aur.x?.reg ?? "calme"]}><i aria-hidden="true">{reg.icon}</i>{reg.name}</span>
      <span className="r mono"><b>AUR-12 {px(idx)}</b><small className={cls(ch)}>{pct(ch)} jour</small></span>
    </div>
  );
}

// L'humeur du marché n'est pas le cours du jour : elle dit comment les investisseurs se comportent en ce moment.
const REG_TXT = {
  calme: "Calme : peu de surprises, les cours suivent la valeur des entreprises.",
  euphorie: "Euphorie : les acheteurs se bousculent, les tendances s'emballent. Une bulle peut se former.",
  nervosite: "Nervosité : les investisseurs hésitent, les cours bougent plus fort dans les deux sens.",
  krach: "Krach : panique, les ventes l'emportent. Les coupe-circuits peuvent suspendre la cote.",
  reprise: "Reprise : les acheteurs reviennent après une baisse. L'indice peut encore être dans le rouge sur la journée.",
};
// Nouvelles qui comptent : mises en avant (badge, bandeau), les autres restent dans le fil.
const MAJOR = new Set(["resultats", "essai", "scandale", "produit", "taux", "crise", "baleine", "suspension", "reel", "macro"]);
const isMajor = n => MAJOR.has(n.cat) || Math.abs(n.sent) >= .7;

// La liste des actions a son propre onglet (stocks) ; le Marché garde tableau de bord, journal et carte.
const VIEWS = [["board", "Tableau de bord"], ["news", "Journal"], ["heat", "Carte"]];
export function AurelysMarket({ aur, now, bets, onPick, onDetail, onSubscribe, stocks, onList }) {
  const [v, setView] = useState("board"), [read, setRead] = useState(null), view = stocks ? "list" : v;
  const live = aur.live;
  return (
    <section>
      <div className="feed-info"><i className={"pulse" + (live ? "" : " off")} aria-hidden="true" />{live ? "Bourse fictive, simulée en continu par des bots et les joueurs" : "Connexion au marché…"} · un jour d'Aurelys = 1 h réelle</div>
      <AurBar aur={aur} now={now} />
      <Flash aur={aur} now={now} onDetail={onDetail} />
      {!stocks && <div className="chips" role="group" aria-label="Vue">
        {VIEWS.map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
      </div>}
      {view === "board" ? <Board aur={aur} now={now} onDetail={onDetail} onNews={() => setView("news")} onRead={setRead} onList={onList} />
        : view === "list" ? <List aur={aur} now={now} bets={bets} onPick={onPick} onDetail={onDetail} onSubscribe={onSubscribe} onRead={setRead} />
        : view === "news" ? <News aur={aur} now={now} onDetail={onDetail} onRead={setRead} />
        : <Heat aur={aur} now={now} onDetail={onDetail} />}
      {read && <Article n={read} now={now} onClose={() => setRead(null)} onDetail={tk => { setRead(null); onDetail(tk) }} />}
      <p className="fine">Marché entièrement fictif : entreprises, personnages, cours et actualités sont simulés. Les prix naissent des ordres de bots (fondamentalistes, suiveurs de tendance, contrariens, chartistes, petits porteurs), de baleines et des joueurs : un gros ordre fait bouger le cours. Frais de 0,1 % du montant engagé à l'ouverture et à la clôture.</p>
    </section>
  );
}

// Bandeau d'une nouvelle majeure toute fraîche (moins de 2 min réelles).
function Flash({ aur, now, onDetail }) {
  const n = aur.news.find(n => isMajor(n) && now - n.at < 120000);
  if (!n) return null;
  const tone = n.sent > .15 ? "up" : n.sent < -.15 ? "down" : "flat";
  return <button type="button" className={"flash " + tone} onClick={() => n.tk && onDetail(n.tk)}><b>{CAT[n.cat] ?? "Flash"}</b><span>{n.title}</span></button>;
}

// Prochain rendez-vous, avec le consensus des analystes pour les résultats.
const CalRow = ({ e, aur, now }) => {
  const c = e.tk ? aur.x?.cons?.[e.tk] : null;
  return <div className="row"><span>{e.title}{c != null && <small className="cons"> · attendu {signed(c)}</small>}</span><b className="mono">{gwhen(e.at, now)}</b></div>;
};

function Board({ aur, now, onDetail, onNews, onRead, onList }) {
  const x = aur.x, reg = REGIMES[x?.reg ?? "calme"], idx = closesOf(aur, INDEX, 36);
  // Palmarès figé une heure d'Aurelys (5 min réelles) pour ne pas bouger sous le doigt.
  const slot = Math.floor(now / 300000);
  const movers = useMemo(() => STOCKS.map(s => ({ s, c: chgOf(aur, s.tk, now) })).sort((a, b) => b.c - a.c), [slot, aur.ok]); // eslint-disable-line
  const cal = calendar(sec(now), 4, aur.young), last = aur.news.filter(isMajor).slice(0, 3);
  return (
    <div className="aur-board">
      <div className="panel">
        <h2>AUR-12 <span className="muted">36 dernières heures d'Aurelys</span></h2>
        {idx.length > 1 ? <Spark path={idx} t={idx.length - 1} h={80} /> : <p className="muted small">Chargement…</p>}
        <p className="muted small">Moyenne des 13 sociétés, pondérée par leur capitalisation (1 000 au lancement).</p>
      </div>
      <div className="tiles">
        <div className="tile wide-tile"><small>Humeur du marché{x?.regAge != null ? ` · depuis ${x.regAge < 1 ? "moins d'une heure" : `${x.regAge} h`}` : ""}</small><b>{reg.icon} {reg.name}</b><p className="muted small">{REG_TXT[x?.reg ?? "calme"]}</p></div>
        <div className="tile"><small>Peur (VIXA)</small><b className="mono">{x ? nf0.format(x.vixa) : "—"}</b></div>
        <div className="tile"><small>Taux directeur</small><b className="mono">{x ? nf2.format(x.r) + " %" : "—"}</b></div>
        <div className="tile"><small>Croissance · inflation</small><b className="mono">{x ? `${nf2.format(x.g)} · ${nf2.format(x.pi)} %` : "—"}</b></div>
      </div>
      {aur.rounds.map(d => (
        <button key={d.tk} type="button" className="panel round-teaser" onClick={onList}>
          <span className="paper-kicker">Introduction en bourse · levée de fonds</span>
          <b>{d.name} · {d.what}</b>
          <span className="muted small">Souscription à {px(d.roundPrice)} W jusqu'à {real(d.roundEnds)} · dès {W(IPO.minWealth)} disponibles</span>
          <span className="accent small">Voir la levée →</span>
        </button>
      ))}
      <div className="panel">
        <h2>Le jour d'Aurelys <span className="muted">depuis 00:00</span></h2>
        {[...movers.slice(0, 3), ...movers.slice(-3)].map(({ s }) => {
          const c = chgOf(aur, s.tk, now);
          return <button key={s.tk} type="button" className="row as-link wide" onClick={() => onDetail(s.tk)}><span className="who"><TkIcon tk={s.tk} size={22} />{s.name}</span><b className={"mono " + cls(c)}>{c >= 0 ? "▲" : "▼"} {pct(c)}</b></button>;
        })}
      </div>
      <div className="panel">
        <h2>À venir</h2>
        {cal.map(e => <CalRow key={e.m + (e.tk ?? "")} e={e} aur={aur} now={now} />)}
        <p className="muted small">Le cours réagit à l'écart entre le chiffre publié et ce qui était attendu. Les indices sortent avant : commandes, rumeurs, révisions des analystes.</p>
      </div>
      <div className="panel">
        <h2>Dernières actualités <button type="button" className="btn ghost" onClick={onNews}>Tout voir</button></h2>
        {last.map(n => <NewsItem key={n.id} n={n} now={now} onDetail={onDetail} onRead={onRead} />)}
        {!last.length && <p className="muted small">Les premières nouvelles arrivent.</p>}
      </div>
    </div>
  );
}

function List({ aur, now, bets, onPick, onDetail, onSubscribe, onRead }) {
  const mine = tk => bets.some(b => b.kind === "aurelys" && b.aur === tk);
  const row = s => {
    const q = aur.quotes[s.tk], c = chgOf(aur, s.tk, now), v = closesOf(aur, s.tk, 60), young = !STORIES[s.tk];
    return (
      <div key={s.tk} className={"mrow" + (mine(s.tk) ? " mine" : "")}>
        <button type="button" className="name who as-link" onClick={() => onDetail(s.tk)} aria-label={`Fiche de ${s.name}`}>
          <TkIcon tk={s.tk} /><span><b>{s.name}{LINKS[s.tk] && <i className="real-tag" title={LINKS[s.tk].src}>réel</i>}{young && <i className="risk-tag">risqué</i>}</b><small>{q?.halt ? "cotation suspendue" : info(s.tk).what}</small></span>
        </button>
        {v.length > 1 ? <Spark path={v} t={v.length - 1} /> : <span />}
        <span className="r mono"><b>{px(q?.p)}</b><small className={cls(c)}>{q ? pct(c) : ""}</small></span>
        <span className="act">
          <button type="button" className="buy" disabled={!q || q.halt} onClick={() => onPick(s.tk, "up")} aria-label={`Hausse sur ${s.name}`}>▲</button>
          <button type="button" className="sell" disabled={!q || q.halt} onClick={() => onPick(s.tk, "down")} aria-label={`Baisse sur ${s.name}`}>▼</button>
        </span>
      </div>
    );
  };
  const news = tk => aur.news.find(n => n.tk == null && n.cat === "ipo" && n.title.startsWith(BY[tk]?.name));
  return (
    <>
      {aur.rounds.length > 0 && <>
        <h3 className="sec">Levées de fonds <span className="muted small">avant l'entrée en bourse</span></h3>
        {aur.rounds.map(d => (
          <article key={d.tk} className="panel round">
            <div className="round-h"><TkIcon tk={d.tk} size={30} /><span><b>{d.name}</b><small className="muted">{d.what} · {SECTORS[d.sector]?.name}</small></span>
              <span className="r mono"><b>{px(d.roundPrice)} W</b><small>clôture {d.roundEnds ? real(d.roundEnds) : "—"}</small></span></div>
            <RoundClock d={d} now={now} stats={aur.roundStats?.[d.tk]} />
            <p className="small">{d.story}</p>
            <div className="empty-acts">
              <button type="button" className="btn primary" onClick={() => onSubscribe(d.tk)}>Souscrire</button>
              {news(d.tk) && <button type="button" className="btn" onClick={() => onRead(news(d.tk))}>Lire l'annonce</button>}
            </div>
            <p className="muted small">Réservé aux joueurs qui ont {W(IPO.minWealth)} disponibles (sans les logements), {IPO.maxShare * 100} % au plus. Le premier cours peut être bien au-dessus… ou en dessous.</p>
          </article>
        ))}
      </>}
      <h3 className="sec">Cote principale</h3>
      <div className="market">
        <div className="mrow head"><span>Société</span><span /><span className="r">Cours · jour</span><span /></div>
        {STOCKS.map(row)}
      </div>
      <h3 className="sec">Jeunes pousses <span className="muted small">très volatiles, radiées sous {Math.round(IPO.delist * 100)} % de leur prix d'introduction</span></h3>
      {aur.young.length ? <div className="market">{aur.young.map(row)}</div> : <p className="muted small">Aucune pour l'instant : la prochaine levée de fonds arrive.</p>}
    </>
  );
}

const CAT = { resultats: "Résultats", essai: "Essai clinique", contrat: "Contrat", scandale: "Scandale", pdg: "Déclaration", analyste: "Analyste", rumeur: "Rumeur",
  produit: "Produit", meteo: "Météo", baleine: "Baleine", crise: "Crise", marche: "Marché", macro: "Macro", taux: "Banque Centrale", secteur: "Secteur", suspension: "Suspension", reel: "Chiffre réel",
  ipo: "Introduction en bourse", faillite: "Faillite" };
// Levée de fonds : temps restant (heure réelle), part du temps écoulé, montant déjà souscrit.
function RoundClock({ d, now, stats }) {
  const start = d.roundEnds - IPO.roundDays * DAY * SPM * 1000, left = Math.max(0, d.roundEnds - now), h = Math.floor(left / 3600e3), m = Math.floor(left / 60e3) % 60;
  return (
    <div className="round-clock">
      <div className="round-stats mono">
        <span><small>Clôture dans</small><b>{left ? `${h} h ${String(m).padStart(2, "0")}` : "clôturée"}</b></span>
        <span><small>Déjà souscrit</small><b>{W(stats?.total ?? 0)}</b></span>
        <span><small>Investisseurs</small><b>{nf0.format(stats?.investors ?? 0)}</b></span>
      </div>
      <span className="timebar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, (now - start) / (d.roundEnds - start) * 100))}%` }} /></span>
    </div>
  );
}

// Un article du Courrier d'Aurelys, lu en entier.
function Article({ n, now, onClose, onDetail }) {
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onClose]);
  const s = n.tk ? BY[n.tk] : null;
  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <article className="sheet paper" role="dialog" aria-modal="true" aria-label={n.title}>
        <div className="sheet-h"><span className="paper-kicker">{CAT[n.cat] ?? n.cat}{n.fiab < .5 ? " · rumeur non confirmée" : ""}</span><button type="button" className="x" onClick={onClose} aria-label="Fermer">×</button></div>
        <h2 className="paper-title">{n.title}</h2>
        <p className="paper-meta mono">Le Courrier d'Aurelys · {real(n.at)} · {agoTxt(now - n.at)}</p>
        {paras(n.body).map((p, i) => <p key={i} className={i ? "paper-p" : "paper-lead"}>{p}</p>)}
        {s && BY[s.tk]?.status !== "round" && <button type="button" className="btn" onClick={() => onDetail(s.tk)}>Voir la fiche de {s.name}</button>}
      </article>
    </div>
  );
}

function NewsItem({ n, now, onDetail, onRead }) {
  const tone = n.sent > .15 ? "up" : n.sent < -.15 ? "down" : "flat", s = n.tk ? BY[n.tk] : null;
  return (
    <article className={"news" + (isMajor(n) ? " major" : "")}>
      <span className={"nbadge " + tone} aria-label={tone === "up" ? "bonne nouvelle" : tone === "down" ? "mauvaise nouvelle" : "neutre"}>{tone === "up" ? "▲" : tone === "down" ? "▼" : "●"}</span>
      <div>
        <button type="button" className="as-link ntitle" onClick={() => onRead?.(n)}>{n.title}</button>
        {n.body && <p className="muted small chapo">{paras(n.body)[0]}</p>}
        <p className="nmeta">
          {s ? <button type="button" className="as-link ntk" onClick={() => onDetail(s.tk)}>{s.tk}</button> : n.sector ? <span>{SECTORS[n.sector]?.name}</span> : null}
          <span className={isMajor(n) ? "major-tag" : ""}>{CAT[n.cat] ?? n.cat}</span>
          {n.fiab < .5 && <span className="warn-tag">Rumeur non confirmée</span>}
          <span className="mono">{real(n.at)} · {agoTxt(now - n.at)}</span>
        </p>
      </div>
    </article>
  );
}

function News({ aur, now, onDetail, onRead }) {
  const [f, setF] = useState("Tout"), [shown, setShown] = useState(null), [major, setMajor] = useState(false);
  const top = aur.news[0]?.id ?? 0, lim = shown ?? top;
  useEffect(() => { if (shown == null && top) setShown(top) }, [top, shown]);
  const fresh = aur.news.filter(n => n.id > lim).length;
  const list = aur.news.filter(n => n.id <= lim && (!major || isMajor(n)) && (f === "Tout" || n.sector === f || BY[n.tk]?.sector === f || (f === "Marché" && !n.tk && !n.sector)));
  const une = list.find(isMajor) ?? list[0];
  return (
    <div>
      <div className="paper-mast"><b>Le Courrier d'Aurelys</b><span className="mono">édition de {clock(now)}</span></div>
      {une && <button type="button" className="paper-une" onClick={() => onRead(une)}>
        <span className="paper-kicker">À la une · {CAT[une.cat] ?? une.cat}</span>
        <span className="paper-title">{une.title}</span>
        <span className="paper-lead">{paras(une.body)[0]}</span>
        <span className="accent small">Lire l'article →</span>
      </button>}
      <div className="panel">
        <h2>Calendrier</h2>
        {calendar(sec(now), 6, aur.young).map(e => <CalRow key={e.m + (e.tk ?? "")} e={e} aur={aur} now={now} />)}
        <p className="muted small">Avant un rendez-vous, le marché est nerveux : la volatilité monte.</p>
      </div>
      <div className="chips" role="group" aria-label="Filtre">
        <button type="button" aria-pressed={major} onClick={() => setMajor(v => !v)}>★ Majeures</button>
        {["Tout", "Marché", ...Object.keys(SECTORS)].map(k => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}>{SECTORS[k]?.name ?? k}</button>)}
      </div>
      {fresh > 0 && <button type="button" className="btn fresh" onClick={() => setShown(top)}>↑ {fresh} nouvelle{fresh > 1 ? "s" : ""}</button>}
      <div className="news-list">{list.length ? list.filter(n => n !== une).map(n => <NewsItem key={n.id} n={n} now={now} onDetail={onDetail} onRead={onRead} />) : <p className="muted pad">Aucune actualité pour l'instant.</p>}</div>
    </div>
  );
}

// Découpe un rectangle (en %) en tuiles d'aire proportionnelle aux poids, en gardant des tuiles proches du carré.
function squarify(items, x, y, w, h) {
  const out = [], tot = items.reduce((a, i) => a + i.w, 0); let rest = items.map(i => ({ ...i, a: i.w / tot * w * h }));
  while (rest.length) {
    const side = Math.min(w, h), row = [rest[0]]; let worst = r => { const s = r.reduce((a, i) => a + i.a, 0); return Math.max(...r.map(i => Math.max(side * side * i.a / (s * s), s * s / (side * side * i.a)))) };
    while (row.length < rest.length && worst([...row, rest[row.length]]) <= worst(row)) row.push(rest[row.length]);
    const s = row.reduce((a, i) => a + i.a, 0), t = s / side; let o = 0;
    for (const i of row) { const l = i.a / t; out.push(w >= h ? { ...i, x, y: y + o, w: t, h: l } : { ...i, x: x + o, y, w: l, h: t }); o += l }
    if (w >= h) { x += t; w -= t } else { y += t; h -= t }
    rest = rest.slice(row.length);
  }
  return out;
}
function Heat({ aur, now, onDetail }) {
  const tiles = squarify([...STOCKS].map(s => ({ s, w: (aur.quotes[s.tk]?.p ?? s.p0) * s.shares })).sort((a, b) => b.w - a.w), 0, 0, 100, 100);
  return (
    <>
      <div className="heat map">
        {tiles.map(({ s, x, y, w, h }) => {
          const c = chgOf(aur, s.tk, now), a = Math.min(.85, .12 + Math.abs(c) / .05 * .7);
          return (
            <button key={s.tk} type="button" className="hcell" onClick={() => onDetail(s.tk)} aria-label={`${s.name} ${pct(c)}`}
              style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, background: c >= 0 ? `rgba(31, 203, 139, ${a})` : `rgba(240, 75, 92, ${a})` }}>
              <b>{s.tk}</b>{w * h > 300 && <small>{s.name}</small>}<span className="mono">{c >= 0 ? "▲" : "▼"} {pct(c)}</span>
            </button>
          );
        })}
      </div>
      <p className="muted small">Taille d'une case : capitalisation de l'entreprise. Couleur : variation depuis le début du jour d'Aurelys.</p>
    </>
  );
}

/* ===== Fiche entreprise ===== */
const MM = [["mm20", "MM 20", "#c98500"], ["mm50", "MM 50", "#3987e5"], ["boll", "Bollinger", "var(--muted)"], ["rsi", "RSI", "var(--ink)"]];
// Unités en minutes d'Aurelys. 1 min et 15 min : cours minute par minute ; 1 h et plus : bougies d'une heure.
const FRAMES = [[1, "1 min"], [15, "15 min"], [60, "1 h"], [240, "4 h"], [1440, "1 j"]];
// Regroupe des bougies (ou des cours [t, p, v]) par tranches de `g` minutes d'Aurelys (t en secondes réelles).
function group(rows, g, isTick) {
  const out = [], span = g * SPM;
  for (const r of rows) {
    const [t, o, h, l, c, v] = isTick ? [r[0], r[1], r[1], r[1], r[1], r[2]] : r, m = t - (t - EPOCH_S) % span, k = out[out.length - 1];
    if (k && k.t === m) { k.h = Math.max(k.h, h); k.l = Math.min(k.l, l); k.c = c; k.v += v } else out.push({ t: m, o, h, l, c, v });
  }
  return out.slice(-80);
}

const gLabel = (t, g) => { const c = gameClock(t); return g >= 60 ? `j${c.day} ${c.hm}` : c.hm };
function AurChart({ cs, g, last, ind, marks, onMark }) {
  const [hover, setHover] = useState(null), box = useRef(null);
  if (!cs.length) return <div className="candles empty"><p className="muted small">Chargement du graphique…</p></div>;
  const closes = cs.map(k => k.c), m20 = sma(closes, 20), m50 = sma(closes, 50), bb = bollinger(closes, 20);
  const band = bb.map((b, i) => b && [i, b[0], b[1]]).filter(Boolean);
  const lo0 = Math.min(...cs.map(k => k.l), ...(ind.boll ? bb.filter(Boolean).map(b => b[0]) : [])), hi0 = Math.max(...cs.map(k => k.h), ...(ind.boll ? bb.filter(Boolean).map(b => b[1]) : []));
  const lo = Math.min(lo0, last ?? Infinity), hi = Math.max(hi0, last ?? -Infinity), r = (hi - lo) || hi * .001;
  const H = 100, PH = 78, Y = v => 4 + (1 - (v - lo) / r) * (PH - 8), w = 100 / cs.length, X = i => i * w + w / 2;
  const vmax = Math.max(...cs.map(k => k.v), 1), VY = v => H - v / vmax * (H - PH - 4);
  const line = a => a.map((v, i) => v == null ? null : `${X(i).toFixed(2)},${Y(v).toFixed(2)}`).filter(Boolean).map((p, i) => (i ? "L" : "M") + p).join("");
  const t0 = cs[0].t, t1 = cs[cs.length - 1].t + g * SPM;
  const at = e => { const b = box.current.getBoundingClientRect(), i = Math.floor((e.clientX - b.left - 10) / (b.width - 80) * cs.length); setHover(Math.max(0, Math.min(cs.length - 1, i))) };
  const hk = hover != null ? cs[hover] : null;
  return (
    <>
      <div className="candles aur-chart" ref={box} onPointerMove={at} onPointerDown={at} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-label="Graphique en bougies avec volumes">
          {ind.boll && band.length > 1 && <path d={"M" + [...band.map(([i, , u]) => [X(i), Y(u)]), ...band.map(([i, l]) => [X(i), Y(l)]).reverse()].map(p => p.map(n => n.toFixed(2)).join(",")).join("L") + "Z"} fill="rgba(144, 151, 168, .14)" stroke="none" />}
          {cs.map((k, i) => {
            const up = k.c >= k.o, col = up ? "var(--up)" : "var(--down)";
            return <g key={k.t}>
              <line x1={X(i)} x2={X(i)} y1={Y(k.h)} y2={Y(k.l)} stroke={col} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <rect x={X(i) - w * .32} width={w * .64} y={Y(Math.max(k.o, k.c))} height={Math.max(.6, Math.abs(Y(k.o) - Y(k.c)))} fill={col} />
              <rect x={X(i) - w * .32} width={w * .64} y={VY(k.v)} height={H - VY(k.v)} fill={col} opacity=".45" />
            </g>;
          })}
          {ind.mm20 && <path d={line(m20)} fill="none" stroke="#c98500" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
          {ind.mm50 && <path d={line(m50)} fill="none" stroke="#3987e5" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
          {last != null && <line x1="0" x2="100" y1={Y(last)} y2={Y(last)} stroke="var(--accent)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          {hk && <line x1={X(hover)} x2={X(hover)} y1="0" y2={H} stroke="var(--faint)" vectorEffect="non-scaling-stroke" />}
        </svg>
        {marks.filter(n => sec(n.at) >= t0 && sec(n.at) < t1).map(n => (
          <button key={n.id} type="button" className={"nmark " + (n.sent > .15 ? "up" : n.sent < -.15 ? "down" : "flat")} style={{ left: `calc(10px + (100% - 80px) * ${(sec(n.at) - t0) / (t1 - t0)})` }} onClick={() => onMark(n)} aria-label={`Actualité : ${n.title}`} />
        ))}
        <span className="ax ax-hi mono">{px(hi)}</span>
        <span className="ax ax-lo mono">{px(lo)}</span>
        {last != null && <span className="ax last mono" style={{ top: `calc(10px + (100% - 32px) * ${Y(last) / 100})` }}>{px(last)}</span>}
        <span className="ax t0 mono">{gLabel(t0, g)}</span>
        <span className="ax t1 mono">{gLabel(cs[cs.length - 1].t, g)}</span>
        {hk && <span className="tip mono">{gLabel(hk.t, g)} · O {px(hk.o)} H {px(hk.h)} B {px(hk.l)} C {px(hk.c)} · vol. {nf0.format(hk.v)}</span>}
      </div>
      {ind.rsi && <RsiPanel v={rsi(closes)} />}
    </>
  );
}
function RsiPanel({ v }) {
  const H = 40, Y = x => H - x / 100 * H, d = v.map((x, i) => x == null ? null : `${(i / Math.max(1, v.length - 1) * 100).toFixed(2)},${Y(x).toFixed(2)}`).filter(Boolean).map((p, i) => (i ? "L" : "M") + p).join("");
  const lastV = v[v.length - 1];
  return (
    <div className="rsi">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-label="RSI 14">
        <rect x="0" y={Y(70)} width="100" height={Y(30) - Y(70)} fill="rgba(144, 151, 168, .1)" />
        <path d={d} fill="none" stroke="var(--ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="mono small">RSI 14 : {lastV == null ? "—" : nf0.format(lastV)}{lastV > 70 ? " · suracheté" : lastV < 30 ? " · survendu" : ""}</span>
    </div>
  );
}

// Alertes de prix : « préviens-moi si le cours passe au-dessus (ou en dessous) de… ». Leur nombre dépend du logement.
function Alerts({ tk, last, alerts, setAlerts, max }) {
  const [v, setV] = useState(""), mine = alerts.filter(a => a.tk === tk), full = alerts.length >= max, price = Number(String(v).replace(",", "."));
  const add = above => { if (price > 0 && !full) { setAlerts(l => [...l, { tk, above, price }]); setV("") } };
  return (
    <div className="panel alerts">
      <p className="small"><b>Alerte de prix</b> · {alerts.length}/{max} utilisée{alerts.length > 1 ? "s" : ""} (plus avec un plus grand logement)</p>
      {mine.map((a, i) => <p key={i} className="small row"><span>{a.above ? "Au-dessus de" : "En dessous de"} <b className="mono">{px(a.price)}</b></span>
        <button type="button" className="btn ghost" onClick={() => setAlerts(l => l.filter(x => x !== a))}>Retirer</button></p>)}
      {!full && <div className="add-row">
        <input inputMode="decimal" placeholder={last ? px(last) : "Prix"} value={v} onChange={e => setV(e.target.value)} aria-label="Prix de l'alerte" />
        <button type="button" className="btn" disabled={!(price > 0)} onClick={() => add(true)}>▲ Au-dessus</button>
        <button type="button" className="btn" disabled={!(price > 0)} onClick={() => add(false)}>▼ En dessous</button>
      </div>}
    </div>
  );
}

export function AurelysDetail({ tk, aur, api, now, onPick, onInvest, onClose, alerts = [], setAlerts, alertsMax = 1 }) {
  const s = BY[tk], q = aur.quotes[tk], c = chgOf(aur, tk, now);
  const [g, setG] = useState(15), [ind, setInd] = useState({ mm20: true, mm50: false, boll: false, rsi: false }), [long, setLong] = useState([]), [mins, setMins] = useState([]), [mark, setMark] = useState(null);
  // Assez d'historique pour 80 bougies et une MM 50 : bougies d'une heure d'Aurelys, ou cours des 2 dernières heures réelles.
  useEffect(() => {
    let on = true;
    const need = Math.ceil(Math.max(24, 130 * g / 60) * 60 * SPM / 60); // minutes réelles
    const load = () => Promise.all([api.aurHistory(tk, need), g < 60 ? api.aurTicks(tk, 120) : null])
      .then(([h, k]) => { if (!on) return; setLong((h[tk] ?? []).map(r => r.map(Number))); if (k) setMins(k.map(r => [Number(r[0]), Number(r[1]), Number(r[2])])) }).catch(() => {});
    load(); const id = setInterval(load, 60000); return () => { on = false; clearInterval(id) };
  }, [api, tk, g]);
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onClose]);
  const live = aur.ticks[tk] ?? [], lastMin = mins.length ? mins[mins.length - 1][0] : 0;
  const cs = g < 60 ? group([...mins, ...live.filter(k => k[0] > lastMin)], g, true) : group([...long, ...(aur.candles[tk] ?? []).filter(k => k[0] > (long.at(-1)?.[0] ?? 0))], g);
  const vol = realizedVol(long), cons = aur.x?.cons?.[tk], sig = aur.x?.sig?.[tk], nextRes = calendar(sec(now), 40, aur.young).find(e => e.tk === tk);
  const eps = aur.x?.eps?.[tk], news = aur.news.filter(n => n.tk === tk || n.sector === s.sector || (!n.tk && !n.sector));
  const people = CHARACTERS.filter(p => p.tk === tk);
  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet detail" role="dialog" aria-modal="true" aria-label={s.name}>
        <div className="sheet-h">
          <span className="who"><TkIcon tk={tk} size={38} /><span><b className="detail-name">{s.name}</b><small className="muted">{tk} · {SECTORS[s.sector].name}{!STORIES[tk] ? " · jeune pousse" : ""}</small></span></span>
          <button type="button" className="x" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <div className="detail-price"><b className="mono">{px(q?.p)}</b><span className={"mono " + cls(c)}>{q?.halt ? "cotation suspendue" : `${c >= 0 ? "▲" : "▼"} ${pct(c)} jour`}</span></div>
        <div className="seg" role="group" aria-label="Unité de temps">{FRAMES.map(([v, l]) => <button key={v} type="button" aria-pressed={g === v} onClick={() => setG(v)}>{l}</button>)}</div>
        <div className="chips legend" role="group" aria-label="Indicateurs">
          {MM.map(([k, l, col]) => <button key={k} type="button" aria-pressed={ind[k]} onClick={() => setInd(x => ({ ...x, [k]: !x[k] }))}><i style={{ background: col }} aria-hidden="true" />{l}</button>)}
        </div>
        <AurChart cs={cs} g={g} last={q?.p} ind={ind} marks={aur.news.filter(n => n.tk === tk)} onMark={setMark} />
        {mark && <Article n={mark} now={now} onClose={() => setMark(null)} onDetail={() => setMark(null)} />}
        <div className="qbtns">
          <button type="button" className="buy" disabled={!q || q.halt} onClick={() => onPick(tk, "up")}><span>▲ Hausse</span></button>
          <button type="button" className="sell" disabled={!q || q.halt} onClick={() => onPick(tk, "down")}><span>▼ Baisse</span></button>
        </div>
        <button type="button" className="btn invest-btn" disabled={!q || q.halt} onClick={() => onInvest(tk)}>Investir : acheter des actions (sans levier, à garder)</button>
        {setAlerts && <Alerts tk={tk} last={q?.p} alerts={alerts} setAlerts={setAlerts} max={alertsMax} />}
        {nextRes && <div className="panel cons-box">
          <p className="small"><b>Prochains résultats</b> · {gwhen(nextRes.at, now)}</p>
          <p className="small">{cons != null ? <>Les analystes attendent un chiffre d'affaires en hausse de <b className="mono">{signed(cons)}</b> sur un an. Le cours réagira à l'écart avec ce chiffre.</> : "Le consensus des analystes arrive."}</p>
        </div>}
        {LINKS[tk] && <div className="panel real-box">
          <p className="small"><b>Branchée sur du réel</b> · {LINKS[tk].src}.</p>
          <p className="small">{sig ? <>Dernier relevé : {sig.txt}. {sig.z > .02 ? "Au-dessus de la normale : bon pour l'entreprise." : sig.z < -.02 ? "Sous la normale : mauvais pour l'entreprise." : "Proche de la normale."}</> : "Premier relevé en attente."}</p>
          <p className="muted small">Ces chiffres sont réels et à venir : celui qui anticipe (une sortie de jeu, une canicule, un long week-end) a un temps d'avance.</p>
        </div>}
        <div className="story">
          <p className="small"><b>{info(tk).what}</b> · fondée en {info(tk).since}</p>
          <p className="small">{info(tk).story}</p>
          <p className="small muted">{s.desc}</p>
        </div>
        <div className="rows mono">
          <div className="row"><span>Capitalisation</span><b>{q ? `${nf0.format(q.p * s.shares / 1e6)} M` : "—"}</b></div>
          <div className="row"><span>PER</span><b>{q && eps ? nf2.format(q.p / eps) : "—"}</b></div>
          <div className="row"><span>Rendement du dividende</span><b>{q && s.div ? pct(s.div / 100 * s.p0 / q.p) : "aucun"}</b></div>
          <div className="row"><span>Volatilité habituelle</span><b>{nf2.format(s.sig * 100)} % par jour d'Aurelys</b></div>
          <div className="row"><span>Volatilité mesurée (dernier jour)</span><b>{vol == null ? "—" : `${nf2.format(vol * 100)} %`}</b></div>
          <div className="row"><span>Liquidité · bêta</span><b>{s.liq} · {nf2.format(s.beta)}</b></div>
        </div>
        {people.map(p => <p key={p.name} className="small"><b>{p.name}</b>, {p.role.toLowerCase()} : {p.bio}</p>)}
        <h2>Actualités</h2>
        {news.slice(0, 8).map(n => <NewsItem key={n.id} n={n} now={now} onDetail={() => {}} onRead={setMark} />)}
        {!news.length && <p className="muted small">Rien de neuf pour l'instant.</p>}
      </div>
    </div>
  );
}

// Volatilité réalisée sur les 24 dernières bougies d'une heure, ramenée à un jour d'Aurelys.
function realizedVol(cs) {
  const c = cs.slice(-25).map(k => k[4]); if (c.length < 8) return null;
  const r = c.slice(1).map((v, i) => Math.log(v / c[i])), m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1) * 24);
}

/* ===== Position ===== */
// Valeur en direct (frais de clôture déduits, hors impact de l'ordre de clôture) et seuil de liquidation.
export const aurLive = (b, q, ticks) => {
  const t0 = Date.parse(b.created_at) / 1000, lq = liqPrice(b);
  const hit = (ticks ?? []).some(([t, p]) => t > t0 && (b.dir === "up" ? p <= lq : p >= lq));
  const p = q?.p ?? b.entry, closeFee = b.stake * b.lev * FEE, value = hit ? 0 : Math.max(0, tradeValue(b, p) - closeFee);
  return { px: p, value, net: value - b.stake - b.fees, closeFee, lq, hit, halt: q?.halt };
};

// Stop et objectif d'une position (loft) : un cours vide retire l'ordre. Vérifiés par le serveur (aur_set_auto).
function AutoForm({ b, onAuto, onDone }) {
  const [sl, setSl] = useState(b.sl ?? ""), [tp, setTp] = useState(b.tp ?? ""), [busy, setBusy] = useState(false);
  const num = v => String(v).trim() === "" ? null : +String(v).replace(",", ".");
  return (
    <form className="auto-form" onSubmit={async e => { e.preventDefault(); setBusy(true); const r = await onAuto(b.id, num(sl), num(tp)); setBusy(false); if (r) onDone() }}>
      <label>Stop<input className="mono" inputMode="decimal" placeholder="aucun" value={sl} onChange={e => setSl(e.target.value)} /></label>
      <label>Objectif<input className="mono" inputMode="decimal" placeholder="aucun" value={tp} onChange={e => setTp(e.target.value)} /></label>
      <button type="submit" className="btn" disabled={busy}>OK</button>
      <p className="muted small">Dès que le cours touche un seuil, la position est clôturée au cours du marché (prix qui peut différer un peu du seuil).</p>
    </form>
  );
}

export function AurelysCard({ b, aur, now, onClose, onAuto, Facts }) {
  const q = aur.quotes[b.aur], ticks = aur.ticks[b.aur], x = aurLive(b, q, ticks), t0 = Date.parse(b.created_at), [busy, setBusy] = useState(false), [auto, setAuto] = useState(false);
  // Cours minute par minute tant qu'on les a (dernière heure réelle), sinon bougies d'une heure d'Aurelys.
  const cs = (aur.candles[b.aur] ?? []).filter(k => k[0] * 1000 > t0 - 300000), recent = (ticks ?? []).filter(k => k[0] * 1000 > t0);
  const pts = [[t0, b.entry], ...((ticks?.[0]?.[0] ?? Infinity) * 1000 <= t0 ? recent.map(k => [k[0] * 1000, k[1]]) : cs.map(k => [k[0] * 1000 + 299000, k[4]])), [now, x.px]];
  const d = x.lq / x.px - 1;
  return (
    <article className={"pos " + (x.net >= 0 ? "gain" : "loss")}>
      <div className="pos-h">
        <b className="who"><TkIcon tk={b.aur} size={22} />{BY[b.aur]?.name ?? b.aur}</b>
        <span className={"side " + b.dir}>{b.dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×{b.lev}</span>
      </div>
      <div className="pos-pnl mono"><span className={cls(x.net)}>{sW(x.net)}</span><span className={cls(x.net)}>{pct(x.net / b.stake)}</span></div>
      <PositionChart id={b.id} entry={b.entry} dir={b.dir} pts={pts} x0={t0} x1={Math.max(now, t0 + 60 * SPM * 1000)} />
      <Facts items={[
        ["Mise", `${W(b.stake)} · ×${b.lev}`],
        ["Valeur (frais déduits)", W(x.value), cls(x.net)],
        ["Entrée", `${px(b.entry)} · ${gwhen(t0, now)}`],
        ["Cours", `${px(x.px)} (${pct(x.px / b.entry - 1)})`, cls((x.px / b.entry - 1) * (b.dir === "up" ? 1 : -1))],
        ["Liquidation", `${px(x.lq)} (${pct(d)})`, Math.abs(d) < .03 ? "down warn" : ""],
        ["Frais", `${W(b.fees)} payés + ${W(x.closeFee)}`],
        ["Ouverte depuis", `${gdur(now - t0)} d'Aurelys`],
        b.sl != null && ["Stop", px(b.sl), "down"],
        b.tp != null && ["Objectif", px(b.tp), "up"],
        x.halt && ["Clôture", "à la reprise de la cotation"],
      ]} />
      {onAuto ? (auto ? <AutoForm b={b} onAuto={onAuto} onDone={() => setAuto(false)} />
        : <button type="button" className="link" onClick={() => setAuto(true)}>{b.sl != null || b.tp != null ? "Modifier le stop et l'objectif" : "Ajouter un stop ou un objectif"}</button>)
        : <p className="muted small">Stop et objectif automatiques : avec le loft (QG).</p>}
      {x.hit
        ? <p className="muted small">Seuil de liquidation touché, règlement en cours…</p>
        : <button type="button" className="btn primary" disabled={busy || x.halt} onClick={async () => { setBusy(true); await onClose(b); setBusy(false) }}>Clôturer · {W(x.value)}</button>}
    </article>
  );
}

export const aurCap = tk => CAP_MULT * BY[tk].L;
