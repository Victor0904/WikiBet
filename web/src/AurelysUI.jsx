// Bourse d'Aurelys : tableau de bord, liste des actions, actualités, carte thermique, fiche entreprise, carte de position.
import { LOCALE, t } from "./i18n.js";
import { Loading } from "./nav.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STOCKS, BY, SECTORS, REGIMES, CHARACTERS, INDEX, FEE, CAP_MULT, LINKS, IPO, SPM, DAY, EPOCH_S, gameClock, gameMin, calendar, sma, bollinger, rsi, closeQuote } from "../supabase/functions/_shared/aurelys.js";
import { dayOpen } from "./aurelys.js";
import { STORIES } from "../supabase/functions/_shared/aurelys-stories.js";
import { W, sW, nf0, nf2, pct, cls, clock } from "./format.js";
import { liqPrice } from "./engine.js";
import { Spark, PositionChart } from "./charts.jsx";
import { TkIcon } from "./logos.jsx";
import { Analysts, lastResolved } from "./Analystes.jsx";
export { TkIcon };

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
  return days === 0 ? t : days === 1 ? `demain ${t}` : days === -1 ? `hier ${t}` : `${dayFmt.format(d)} ${t}` };
const dayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short" });
const signed = v => `${v >= 0 ? "+" : "−"}${nf2.format(Math.abs(v)).replace(/[.,]?0+$/, "")} %`; // « +7 % », « +1,5 % » (« +1.5 % » en anglais)
const agoTxt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `il y a ${s} s` : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : `il y a ${Math.floor(s / 3600)} h` };
// Derniers cours pour une mini-courbe : bougies d'une heure d'Aurelys, ou cours minute par minute tant qu'il y a peu de bougies.
const closesOf = (aur, tk, n) => { const c = (aur.candles[tk] ?? []).slice(-n).map(k => k[4]); return c.length >= 5 ? c : (aur.ticks[tk] ?? []).map(k => k[1]) };
const chgOf = (aur, tk, now) => { const p = aur.quotes[tk]?.p, o = dayOpen(aur, tk, sec(now)); return p && o ? p / o - 1 : 0 };

// Fiche d'une entreprise : histoire écrite à la main (cote principale) ou générée par le moteur (jeunes pousses).
const info = tk => STORIES[tk] ?? BY[tk] ?? {};
const paras = t => (t ?? "").split("\n\n").filter(Boolean);

// Tête du Marché : l'indice AUR-12 en grand avec sa courbe (l'élément marquant de l'écran), puis l'heure et l'humeur
// d'Aurelys en une phrase. Les autres vues du Marché n'en gardent qu'une ligne (AurLine).
function AurHero({ aur, now }) {
  const c = gameClock(sec(now)), k = aur.x?.reg ?? "calme", idx = aur.quotes[INDEX]?.p, ch = chgOf(aur, INDEX, now), path = closesOf(aur, INDEX, 36);
  return (
    <header className="aur-hero">
      <div className="hero-top">
        <span className="hero-idx"><small>AUR-12, l'indice des 13 sociétés</small><b className="mono">{px(idx)}</b></span>
        <span className={"hero-ch mono " + cls(ch)}><b>{ch >= 0 ? "▲" : "▼"} {pct(ch)}</b><small>depuis 00:00</small></span>
      </div>
      {path.length > 1 ? <div className="hero-chart"><Spark path={path} t={path.length - 1} h={110} fill /></div> : <div className="hero-chart"><Loading size={40} /></div>}
      <p className="hero-say"><i className={"pulse" + (aur.live ? "" : " off")} aria-hidden="true" />
        <span>{aur.live ? `Jour ${c.day}, ${c.hm} à Aurelys.` : "Connexion au marché…"}</span>{" "}
        <span className="reg"><i aria-hidden="true">{REGIMES[k].icon}</i> {REG_TXT[k]}</span></p>
    </header>
  );
}
function AurLine({ aur, now }) {
  const c = gameClock(sec(now)), reg = REGIMES[aur.x?.reg ?? "calme"], ch = chgOf(aur, INDEX, now);
  return (
    <div className="aur-line">
      <i className={"pulse" + (aur.live ? "" : " off")} aria-hidden="true" />
      <b className="mono">AUR-12 {px(aur.quotes[INDEX]?.p)}</b><span className={"mono " + cls(ch)}>{pct(ch)}</span>
      <span className="muted">{`jour ${c.day}, ${c.hm}`}</span><span className="muted">{reg.icon} {reg.name}</span>
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

// Le Marché : tableau de bord, liste des actions, journal, carte et rumeurs.
// Actions d'abord (demande de Victor, octobre 2026) : toutes les sociétés dès l'arrivée, l'Aperçu (indice, macro) ensuite.
const VIEWS = [["list", "Actions"], ["board", "Aperçu"], ["news", "Journal"], ["heat", "Carte"], ["rumors", "Rumeurs"], ["analysts", "Analystes"]];
export function AurelysMarket({ api, aur, now, bets, onPick, onDetail, onSubscribe, focus, onFocus }) {
  const [view, setView] = useState("list"), [read, setRead] = useState(null), onList = () => setView("list");
  // Analystes : liste et tuyaux du joueur relus toutes les 30 s (pastille quand un tuyau vient d'être jugé). `focus` : société
  // choisie depuis sa fiche (« Demander à un analyste »).
  const [ana, setAna] = useState(null), [mine, setMine] = useState(null), [anaSeen, setAnaSeen] = useState(() => { try { return +localStorage.getItem("wb-tuyaux") || 0 } catch { return 0 } });
  const loadAna = () => api?.analystList && Promise.all([api.analystList(), api.myTuyaux()]).then(([a, m]) => { setAna(a); setMine(m) }).catch(() => {});
  useEffect(() => { if (!api?.analystList) return; loadAna(); const id = setInterval(() => { if (!document.hidden) loadAna() }, 30000); return () => clearInterval(id) }, [api]); // eslint-disable-line
  useEffect(() => { if (focus) setView("analysts") }, [focus]);
  const anaTop = lastResolved(mine);
  useEffect(() => { if (view === "analysts" && anaTop > anaSeen) { setAnaSeen(anaTop); try { localStorage.setItem("wb-tuyaux", String(anaTop)) } catch { } } }, [view, anaTop, anaSeen]);
  // Rumeurs : relues toutes les 10 s (pastille sur l'onglet quand une nouvelle arrive, dernière vue gardée dans le navigateur).
  const [rum, setRum] = useState(null), [seen, setSeen] = useState(() => { try { return +localStorage.getItem("wb-rumeurs") || 0 } catch { return 0 } });
  useEffect(() => {
    if (!api) return; let on = true;
    const load = () => api.aurRumors().then(d => on && setRum(d)).catch(() => {});
    load(); const id = setInterval(load, 10000); return () => { on = false; clearInterval(id) };
  }, [api]);
  const top = rum?.list[0]?.id ?? 0;
  useEffect(() => { if (view === "rumors" && top > seen) { setSeen(top); try { localStorage.setItem("wb-rumeurs", String(top)) } catch { } } }, [view, top, seen]);
  return (
    <section className="aur-market">
      {/* Barre d'onglets fixe (demande de Victor) : rien au-dessus ne change de hauteur d'un onglet à l'autre ; le grand
          bandeau de l'indice (Aperçu) et le flash d'actualité passent dessous. */}
      <AurLine aur={aur} now={now} />
      <div className="tabs" role="group" aria-label="Vue du marché">
        {VIEWS.filter(([k]) => k !== "analysts" || api?.analystList).map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{l}{k === "rumors" && top > seen && <i className="chip-dot" role="img" aria-label="nouvelle rumeur" />}{k === "analysts" && anaTop > anaSeen && <i className="chip-dot" role="img" aria-label="tuyau jugé" />}</button>)}
      </div>
      {view === "board" && <AurHero aur={aur} now={now} />}
      <Flash aur={aur} now={now} onDetail={onDetail} />
      {view === "board" ? <Board aur={aur} now={now} onDetail={onDetail} onNews={() => setView("news")} onRead={setRead} onList={onList} />
        : view === "list" ? <List aur={aur} now={now} bets={bets} onPick={onPick} onDetail={onDetail} onSubscribe={onSubscribe} onRead={setRead} />
        : view === "news" ? <News aur={aur} now={now} onDetail={onDetail} onRead={setRead} />
        : view === "rumors" ? <Rumors data={rum} now={now} onDetail={onDetail} />
        : view === "analysts" ? <Analysts api={api} data={ana} mine={mine} focus={focus} onFocus={onFocus} now={now} reload={loadAna}
            onDetail={onDetail} onPick={(tk, dir) => dir ? onPick(tk, dir) : onDetail(tk)} />
        : <Heat aur={aur} now={now} onDetail={onDetail} />}
      {read && <Article api={api} n={read} now={now} onClose={() => setRead(null)} onDetail={tk => { setRead(null); onDetail(tk) }} />}
      <p className="fine">Un jour d'Aurelys dure 1 h réelle.</p>
      <p className="fine">Marché entièrement fictif : entreprises, personnages, cours et actualités sont simulés. Les prix naissent des ordres de bots (fondamentalistes, suiveurs de tendance, contrariens, chartistes, petits porteurs), de baleines et des joueurs : un gros ordre fait bouger le cours. Frais de 0,1 % du montant engagé à l'ouverture et à la clôture.</p>
    </section>
  );
}

// Rumeurs des 7 derniers jours (aur_rumor_list) : l'issue n'arrive du serveur qu'une fois la résolution publiée.
const RUMOR_ST = { open: ["En cours", "flat"], ok: ["Confirmée", "up"], no: ["Démentie", "down"], void: ["Sans suite (société radiée)", "flat"] };
function Rumors({ data, now, onDetail }) {
  const [st, setSt] = useState("all"), [sector, setSector] = useState("");
  if (!data) return <Loading size={40} />;
  const list = data.list.filter(r => (st === "all" || (st === "open") === (r.status === "open")) && (!sector || BY[r.tk]?.sector === sector)), s = data.stats;
  return (
    <div>
      <div className="chips" role="group" aria-label="Filtrer les rumeurs">
        {[["open", "En cours"], ["done", "Résolues"], ["all", "Toutes"]].map(([k, l]) => <button key={k} type="button" aria-pressed={st === k} onClick={() => setSt(k)}>{l}</button>)}
        <select className="chip-select" value={sector} onChange={e => setSector(e.target.value)} aria-label="Secteur">
          <option value="">Tous les secteurs</option>
          {Object.entries(SECTORS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
        </select>
      </div>
      {list.map(r => {
        const [label, tone] = RUMOR_ST[r.status];
        return (
          <button key={r.id} type="button" className="rumor" onClick={() => onDetail(r.tk, r.t)} aria-label={`${r.title}, ${label}. Voir ${BY[r.tk]?.name ?? r.tk}`}>
            <TkIcon tk={r.tk} size={30} />
            <span className="rumor-b">
              <small className="muted">{BY[r.tk]?.name ?? r.tk} · {r.tk} · {gwhen(r.t * 1000, now)}</small>
              <b>{r.title}</b>
              <span className="rtags"><span className={"rtag " + tone}>{label}{r.res_t ? ` · ${gwhen(r.res_t * 1000, now)}` : ""}</span></span>
            </span>
            <span className={"mono " + (r.chg == null ? "muted" : cls(r.chg))}>{r.chg == null ? "—" : pct(r.chg)}</span>
          </button>
        );
      })}
      {!list.length && <p className="muted small">Aucune rumeur ici pour l'instant.</p>}
      <section className="d-sec">
        <h2>Sur 7 jours</h2>
        {s?.n ? <>
          <div className="row"><span>Rumeurs résolues</span><b className="mono">{s.n}</b></div>
          <div className="row"><span>Confirmées</span><b className="mono">{nf0.format(100 * s.ok / s.n)} %</b></div>
          <div className="row"><span>Réaction moyenne du cours, dans le sens de la rumeur</span><b className={"mono " + cls(s.chg ?? 0)}>{s.chg == null ? "—" : pct(s.chg)}</b></div>
        </> : <p className="muted small">Pas encore de rumeur résolue.</p>}
        <p className="muted small">Réaction : du cours à la sortie de la rumeur jusqu'à sa résolution (ou jusqu'à maintenant si elle est en cours).</p>
      </section>
    </div>
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
  return <div className="plain-row"><span>{e.title}{c != null && <small>{`Attendu : ${signed(c)} sur un an`}</small>}</span><b className="mono">{gwhen(e.at, now)}</b></div>;
};

function Board({ aur, now, onDetail, onNews, onRead, onList }) {
  const x = aur.x;
  // Palmarès figé une heure d'Aurelys (5 min réelles) pour ne pas bouger sous le doigt.
  const slot = Math.floor(now / 300000);
  const movers = useMemo(() => STOCKS.map(s => ({ s, c: chgOf(aur, s.tk, now) })).sort((a, b) => b.c - a.c), [slot, aur.ok]); // eslint-disable-line
  const cal = calendar(sec(now), 4, aur.young), last = aur.news.filter(isMajor).slice(0, 3);
  const mover = ({ s }) => { const c = chgOf(aur, s.tk, now);
    return <button key={s.tk} type="button" className="p-row" onClick={() => onDetail(s.tk)}><TkIcon tk={s.tk} size={24} /><span className="p-lab">{s.name}</span><span className={"p-val mono " + cls(c)}>{c >= 0 ? "▲" : "▼"} {pct(c)}</span></button> };
  return (
    <div className="aur-board">
      <dl className="macro">
        <div><dt>Peur (VIXA)</dt><dd className="mono">{x ? nf0.format(x.vixa) : "—"}</dd></div>
        <div><dt>Taux directeur</dt><dd className="mono">{x ? nf2.format(x.r) + " %" : "—"}</dd></div>
        <div><dt>Croissance</dt><dd className="mono">{x ? nf2.format(x.g) + " %" : "—"}</dd></div>
        <div><dt>Inflation</dt><dd className="mono">{x ? nf2.format(x.pi) + " %" : "—"}</dd></div>
      </dl>
      {aur.rounds.map(d => (
        <button key={d.tk} type="button" className="round-teaser" onClick={onList}>
          <span className="paper-kicker">Introduction en bourse</span>
          <b>{d.name}, {d.what}</b>
          <span className="muted small">{`Souscription à ${px(d.roundPrice)} W jusqu'à ${real(d.roundEnds)}, dès ${W(IPO.minWealth)} disponibles.`}</span>
        </button>
      ))}
      <section className="b-sec">
        <h2>Le jour d'Aurelys <span className="muted">depuis 00:00</span></h2>
        <div className="p-list">{movers.slice(0, 3).map(mover)}<span className="p-gap" aria-hidden="true" />{movers.slice(-3).map(mover)}</div>
        <button type="button" className="link b-more" onClick={onList}>{`Toutes les actions (${STOCKS.length})`}</button>
      </section>
      <section className="b-sec">
        <h2>À venir</h2>
        <div className="plain">{cal.map(e => { const c = e.tk ? aur.x?.cons?.[e.tk] : null;
          return <div key={e.m + (e.tk ?? "")} className="plain-row"><span>{e.title}{c != null && <small>{`Attendu : ${signed(c)} sur un an`}</small>}</span><b className="mono">{gwhen(e.at, now)}</b></div> })}</div>
        <p className="muted small">Le cours réagit à l'écart entre le chiffre publié et ce qui était attendu. Les indices sortent avant : commandes, rumeurs, révisions des analystes.</p>
      </section>
      <section className="b-sec">
        <h2>Dernières actualités</h2>
        {last.map(n => <NewsItem key={n.id} n={n} now={now} onDetail={onDetail} onRead={onRead} />)}
        {!last.length && <p className="muted small">Les premières nouvelles arrivent.</p>}
        <button type="button" className="link b-more" onClick={onNews}>Tout le journal</button>
      </section>
    </div>
  );
}

function List({ aur, now, bets, onPick, onDetail, onSubscribe, onRead }) {
  const mine = tk => bets.some(b => b.kind === "aurelys" && b.aur === tk);
  const row = s => {
    const q = aur.quotes[s.tk], c = chgOf(aur, s.tk, now), v = closesOf(aur, s.tk, 60), young = !STORIES[s.tk];
    return (
      <div key={s.tk} className={"srow" + (mine(s.tk) ? " mine" : "")}>
        <button type="button" className="srow-open" onClick={() => onDetail(s.tk)} aria-label={`Fiche de ${s.name}`}>
          <TkIcon tk={s.tk} />
          <span className="srow-n"><b>{s.name}</b><small>{LINKS[s.tk] && <i className="real-tag" title={LINKS[s.tk].src}>réel</i>}{young && <i className="risk-tag">risqué</i>}{q?.halt ? "cotation suspendue" : info(s.tk).what}</small></span>
          {v.length > 1 ? <Spark path={v} t={v.length - 1} /> : <span />}
          <span className="r mono"><b>{px(q?.p)}</b><small className={cls(c)}>{q ? pct(c) : ""}</small></span>
        </button>
        <span className="srow-q">
          <button type="button" className="q-up" disabled={!q || q.halt} onClick={() => onPick(s.tk, "up")} aria-label={`Hausse sur ${s.name}`}>▲</button>
          <button type="button" className="q-down" disabled={!q || q.halt} onClick={() => onPick(s.tk, "down")} aria-label={`Baisse sur ${s.name}`}>▼</button>
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
      <h2 className="l-head">Cote principale <span className="muted">cours et variation du jour</span></h2>
      <div className="p-list">{STOCKS.map(row)}</div>
      <p className="muted small">▲ ou ▼ pour prendre position tout de suite ; touche une société pour voir sa fiche.</p>
      <h2 className="l-head">Jeunes pousses</h2>
      <p className="muted small">{`Très volatiles : radiées sous ${Math.round(IPO.delist * 100)} % de leur prix d'introduction.`}</p>
      {aur.young.length ? <div className="p-list">{aur.young.map(row)}</div> : <p className="muted small">Aucune pour l'instant : la prochaine levée de fonds arrive.</p>}
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
function Article({ api, n, now, onClose, onDetail }) {
  useEffect(() => { api?.articleRead?.(n.id).catch(() => {}) }, [api, n.id]); // succès Lecteur assidu (compté par le serveur)
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

// Recherche sans accents ni majuscules : « helvane » trouve Helvane Énergie.
const fold = s => (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function News({ aur, now, onDetail, onRead }) {
  const [f, setF] = useState("Tout"), [shown, setShown] = useState(null), [major, setMajor] = useState(false), [q, setQ] = useState("");
  const top = aur.news[0]?.id ?? 0, lim = shown ?? top;
  useEffect(() => { if (shown == null && top) setShown(top) }, [top, shown]);
  const fresh = aur.news.filter(n => n.id > lim).length;
  const list = aur.news.filter(n => n.id <= lim && (!major || isMajor(n)) && (f === "Tout" || n.sector === f || BY[n.tk]?.sector === f || (f === "Marché" && !n.tk && !n.sector)));
  // Recherche : les articles des entreprises trouvées (nom ou code) passent en tête, puis ceux qui citent le texte cherché.
  const k = fold(q.trim()), hits = k ? new Set(Object.values(BY).filter(s => fold(s.name).includes(k) || fold(s.tk) === k).map(s => s.tk)) : null;
  const rank = n => !k ? 0 : hits.has(n.tk) ? 0 : fold(n.title).includes(k) ? 1 : 2;
  if (k) list.sort((a, b) => rank(a) - rank(b)); // tri stable : du plus récent au plus ancien dans chaque groupe
  const found = k ? list.filter(n => rank(n) < 2).length : 0;
  const une = k ? null : list.find(isMajor) ?? list[0];
  return (
    <div>
      <div className="paper-mast"><b>Le Courrier d'Aurelys</b><span className="mono">édition de {clock(now)}</span></div>
      {une && <button type="button" className="paper-une" onClick={() => onRead(une)}>
        <span className="paper-kicker">À la une · {CAT[une.cat] ?? une.cat}</span>
        <span className="paper-title">{une.title}</span>
        <span className="paper-lead">{paras(une.body)[0]}</span>
        <span className="accent small">Lire l'article →</span>
      </button>}
      <section className="b-sec n-cal">
        <h2>Calendrier</h2>
        <div className="plain">{calendar(sec(now), 6, aur.young).map(e => <CalRow key={e.m + (e.tk ?? "")} e={e} aur={aur} now={now} />)}</div>
        <p className="muted small">Avant un rendez-vous, le marché est nerveux : la volatilité monte.</p>
      </section>
      <input type="search" className="news-search" placeholder="Rechercher une entreprise (Nexora, SLM…)" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher une entreprise dans le journal" />
      {k && <p className="muted small">{found ? `${found} article${found > 1 ? "s" : ""} en tête${hits.size ? ` : ${[...hits].map(tk => BY[tk].name).join(", ")}` : ""}.` : "Aucun article des 2 dernières heures ne correspond."}</p>}
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
  return out;
}

const gLabel = (t, g) => { const c = gameClock(t); return g >= 60 ? `j${c.day} ${c.hm}` : c.hm };
// Fenêtre affichée : n bougies, finissant `off` bougies avant la dernière. Glisser pour remonter le temps, molette ou − / + pour zoomer.
const fitView = ({ n, off }, len) => { n = Math.max(Math.min(20, len), Math.min(n, len, 400)); return { n, off: Math.max(0, Math.min(off, len - n)) } };
// lines : cours de référence ({ v, label, c, fit } : entrée, liquidation, stop, objectif, achat moyen ; fit = toujours dans l'échelle).
// opens : ouvertures de mes positions ({ t, label }, t en secondes réelles).
function AurChart({ rows, g, last, ind, marks, onMark, hl, lines = [], opens = [] }) {
  const [hover, setHover] = useState(null), [view, setView] = useState({ n: 80, off: 0 }), box = useRef(null), drag = useRef(null), len = useRef(0);
  len.current = rows.length;
  const zoom = f => setView(v => fitView({ n: Math.round(v.n * f), off: v.off }, len.current));
  useEffect(() => {
    const el = box.current; if (!el) return;
    const w = e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15) };
    el.addEventListener("wheel", w, { passive: false }); return () => el.removeEventListener("wheel", w);
  }, [rows.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return <div className="candles empty"><Loading size={48} label="Chargement du graphique…" /></div>;
  // Indicateurs sur tout l'historique chargé (une MM 50 juste dès la première bougie affichée), puis découpés.
  const all = rows.map(k => k.c), { n, off } = fitView(view, rows.length), end = rows.length - off, start = end - n;
  const cut = a => a.slice(start, end), cs = cut(rows), closes = cut(all), m20 = cut(sma(all, 20)), m50 = cut(sma(all, 50)), bb = cut(bollinger(all, 20));
  const band = bb.map((b, i) => b && [i, b[0], b[1]]).filter(Boolean), fit = lines.filter(l => l.fit).map(l => l.v);
  const lo0 = Math.min(...cs.map(k => k.l), ...fit, ...(ind.boll ? bb.filter(Boolean).map(b => b[0]) : [])), hi0 = Math.max(...cs.map(k => k.h), ...fit, ...(ind.boll ? bb.filter(Boolean).map(b => b[1]) : []));
  const lo = Math.min(lo0, last ?? Infinity), hi = Math.max(hi0, last ?? -Infinity), r = (hi - lo) || hi * .001;
  const H = 100, PH = 78, Y = v => 4 + (1 - (v - lo) / r) * (PH - 8), w = 100 / cs.length, X = i => i * w + w / 2;
  const vmax = Math.max(...cs.map(k => k.v), 1), VY = v => H - v / vmax * (H - PH - 4);
  const line = a => a.map((v, i) => v == null ? null : `${X(i).toFixed(2)},${Y(v).toFixed(2)}`).filter(Boolean).map((p, i) => (i ? "L" : "M") + p).join("");
  const t0 = cs[0].t, t1 = cs[cs.length - 1].t + g * SPM, XT = t => (t - t0) / (t1 - t0);
  const at = e => { const b = box.current.getBoundingClientRect(); setHover(Math.max(0, Math.min(cs.length - 1, Math.floor((e.clientX - b.left - 10) / (b.width - 80) * cs.length)))) };
  const down = e => { drag.current = { x: e.clientX, off, moved: false }; at(e) };
  const move = e => {
    const d = drag.current;
    if (d && e.buttons) {
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) > 6) { d.moved = true; e.currentTarget.setPointerCapture?.(e.pointerId) }
      if (d.moved) { setHover(null); setView(v => fitView({ n: v.n, off: d.off + Math.round(dx / (box.current.offsetWidth - 80) * n) }, len.current)); return }
    }
    at(e);
  };
  const shown = lines.filter(l => l.v >= lo && l.v <= hi), here = opens.filter(o => o.t >= t0 && o.t < t1);
  const lineCol = c => c === "up" ? "var(--up)" : c === "down" ? "var(--down)" : "var(--ink)";
  const hk = hover != null ? cs[hover] : null;
  return (
    <>
      <div className="candles aur-chart" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerLeave={() => { drag.current = null; setHover(null) }}>
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
          {shown.map((l, i) => <line key={i} x1="0" x2="100" y1={Y(l.v)} y2={Y(l.v)} stroke={lineCol(l.c)} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />)}
          {here.map((o, i) => <line key={i} x1={XT(o.t) * 100} x2={XT(o.t) * 100} y1="0" y2={PH} stroke="var(--ink)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />)}
          {last != null && <line x1="0" x2="100" y1={Y(last)} y2={Y(last)} stroke="var(--accent)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          {hk && <line x1={X(hover)} x2={X(hover)} y1="0" y2={H} stroke="var(--faint)" vectorEffect="non-scaling-stroke" />}
          {hl >= t0 && hl < t1 && <line x1={XT(hl) * 100} x2={XT(hl) * 100} y1="0" y2={H} stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        </svg>
        {marks.filter(n => sec(n.at) >= t0 && sec(n.at) < t1).map(n => (
          <button key={n.id} type="button" className={"nmark " + (n.sent > .15 ? "up" : n.sent < -.15 ? "down" : "flat")} style={{ left: `calc(10px + (100% - 80px) * ${XT(sec(n.at))})` }} onClick={() => onMark(n)} aria-label={`Actualité : ${n.title}`} />
        ))}
        {shown.map((l, i) => <span key={i} className={"ax-ref mono " + (l.c || "")} style={{ top: `calc(10px + (100% - 32px) * ${Y(l.v) / 100})` }}>{`${l.label} ${px(l.v)}`}</span>)}
        {here.map((o, i) => <span key={i} className="ax-open mono" style={{ left: `calc(10px + (100% - 80px) * ${XT(o.t)})` }}>{o.label}</span>)}
        <span className="ax ax-hi mono">{px(hi)}</span>
        <span className="ax ax-lo mono">{px(lo)}</span>
        {last != null && <span className="ax last mono" style={{ top: `calc(10px + (100% - 32px) * ${Y(last) / 100})` }}>{px(last)}</span>}
        <span className="ax t0 mono">{gLabel(t0, g)}</span>
        <span className="ax t1 mono">{gLabel(cs[cs.length - 1].t, g)}</span>
        {hk && <span className="tip mono">{gLabel(hk.t, g)} · O {px(hk.o)} H {px(hk.h)} B {px(hk.l)} C {px(hk.c)} · vol. {nf0.format(hk.v)}</span>}
      </div>
      <div className="chart-nav">
        <button type="button" className="btn ghost" onClick={() => zoom(1.5)} disabled={n >= Math.min(rows.length, 400)} aria-label="Dézoomer">−</button>
        <button type="button" className="btn ghost" onClick={() => zoom(1 / 1.5)} disabled={n <= 20} aria-label="Zoomer">+</button>
        {off > 0 ? <button type="button" className="btn ghost" onClick={() => setView(v => ({ ...v, off: 0 }))}>Revenir à maintenant</button>
          : <small className="muted">Glisse le graphique pour remonter le temps.</small>}
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

// Mes positions sur une société, pour la fiche : cours de référence et heures d'ouverture sur le graphique.
const mineOf = (tk, bets, hold) => {
  const mine = bets.filter(b => b.kind === "aurelys" && b.aur === tk), lines = [], opens = [];
  for (const b of mine) {
    const a = b.dir === "up" ? "▲" : "▼";
    lines.push({ v: b.entry, label: `Entrée ${a}×${b.lev}`, fit: true }, { v: liqPrice(b), label: "Liquidation", c: "down" });
    if (b.sl != null) lines.push({ v: b.sl, label: "Stop", c: "down" });
    if (b.tp != null) lines.push({ v: b.tp, label: "Objectif", c: "up" });
    opens.push({ t: Date.parse(b.created_at) / 1000, label: `${a}×${b.lev}` });
  }
  if (hold?.qty > 0) lines.push({ v: hold.cost / hold.qty, label: "Achat moyen", fit: true });
  return { mine, lines, opens };
};
// Unité de temps qui montre l'ouverture de ma plus vieille position (70 bougies au plus), sinon 15 min.
const frameFor = (opens, now) => {
  if (!opens.length) return null;
  const age = (now / 1000 - Math.min(...opens.map(o => o.t))) / SPM;
  return (FRAMES.find(([v]) => age / v < 70) ?? FRAMES.at(-1))[0];
};

export function AurelysDetail({ tk, hl, aur, api, now, onPick, onInvest, onSell, onClose, onAnalyst, onTrade, onAuto, canStop, bets = [], hold, alerts = [], setAlerts, alertsMax = 1 }) {
  const s = BY[tk], q = aur.quotes[tk], c = chgOf(aur, tk, now), my = mineOf(tk, bets, hold);
  const [g, setG] = useState(() => hl ? 60 : frameFor(my.opens, now) ?? (hold ? 60 : 15)), [ind, setInd] = useState({ mm20: true, mm50: false, boll: false, rsi: false }), [long, setLong] = useState([]), [mins, setMins] = useState([]), [mark, setMark] = useState(null);
  // Assez d'historique pour remonter de 400 bougies (plus 50 pour la MM 50) : bougies d'une heure d'Aurelys (10 jours réels
  // au plus côté serveur), ou cours des 2 dernières heures réelles.
  useEffect(() => {
    let on = true;
    const need = Math.min(14400, Math.ceil(450 * g * SPM / 60)); // minutes réelles
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
          <span className="who"><TkIcon tk={tk} size={38} /><span><b className="detail-name">{s.name}</b><small className="muted">{tk}, <span>{SECTORS[s.sector].name}</span>{!STORIES[tk] && <>, <span>jeune pousse</span></>}</small></span></span>
          <button type="button" className="x" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <div className="detail-price"><b className="mono">{px(q?.p)}</b><span className={"mono " + cls(c)}>{q?.halt ? "cotation suspendue" : `${c >= 0 ? "▲" : "▼"} ${pct(c)} jour`}</span></div>
        <div className="seg" role="group" aria-label="Unité de temps">{FRAMES.map(([v, l]) => <button key={v} type="button" aria-pressed={g === v} onClick={() => setG(v)}>{l}</button>)}</div>
        <div className="chips legend" role="group" aria-label="Indicateurs">
          {MM.map(([k, l, col]) => <button key={k} type="button" aria-pressed={ind[k]} onClick={() => setInd(x => ({ ...x, [k]: !x[k] }))}><i style={{ background: col }} aria-hidden="true" />{l}</button>)}
        </div>
        <AurChart key={g} rows={cs} g={g} last={q?.p} ind={ind} marks={aur.news.filter(n => n.tk === tk)} onMark={setMark} hl={hl} lines={my.lines} opens={my.opens} />
        {hl && <p className="muted small">Trait ambre : la rumeur, {gwhen(hl * 1000, now)}.</p>}
        {mark && <Article api={api} n={mark} now={now} onClose={() => setMark(null)} onDetail={() => setMark(null)} />}
        {(my.mine.length > 0 || hold) && <MyStake tk={tk} mine={my.mine} hold={hold} aur={aur} now={now} onSell={onSell} onTrade={onTrade} onAuto={onAuto} canStop={canStop} />}
        <div className="qbtns">
          <button type="button" className="buy" disabled={!q || q.halt} onClick={() => onPick(tk, "up")}><span>▲ Hausse</span></button>
          <button type="button" className="sell" disabled={!q || q.halt} onClick={() => onPick(tk, "down")}><span>▼ Baisse</span></button>
        </div>
        <button type="button" className="btn invest-btn" disabled={!q || q.halt} onClick={() => onInvest(tk)}>{hold ? "Renforcer sans levier" : "Investir sans levier"}</button>
        <p className="muted small d-hint">Hausse et Baisse : une position à levier, à clôturer quand tu veux. Investir : de vraies actions, sans liquidation, à garder.</p>
        {setAlerts && <Alerts tk={tk} last={q?.p} alerts={alerts} setAlerts={setAlerts} max={alertsMax} />}
        {nextRes && <section className="d-sec">
          <h2>Prochains résultats <span className="muted">{gwhen(nextRes.at, now)}</span></h2>
          <p>{cons != null ? <>Les analystes attendent un chiffre d'affaires en hausse de <b className="mono">{signed(cons)}</b> sur un an. Le cours réagira à l'écart avec ce chiffre.</> : "Le consensus des analystes arrive."}</p>
          {onAnalyst && STORIES[tk] && <button type="button" className="btn" onClick={() => onAnalyst(tk)}>Demander à un analyste</button>}
        </section>}
        {LINKS[tk] && <section className="d-sec d-real">
          <h2>Branchée sur du réel</h2>
          <p className="muted">{LINKS[tk].src}.</p>
          <p>{sig ? <>Dernier relevé : {sig.txt}. {sig.z > .02 ? "Au-dessus de la normale : bon pour l'entreprise." : sig.z < -.02 ? "Sous la normale : mauvais pour l'entreprise." : "Proche de la normale."}</> : "Premier relevé en attente."}</p>
          <p className="muted">Ces chiffres sont réels et à venir : celui qui anticipe (une sortie de jeu, une canicule, un long week-end) a un temps d'avance.</p>
        </section>}
        <section className="d-sec">
          <h2>L'entreprise</h2>
          <p><b>{info(tk).what}</b>{(([y, c]) => c ? t(", fondée en {y} à {c}.", { y, c: t(c) }) : t(", fondée en {y}.", { y }))(String(info(tk).since ?? "").split(" · "))}</p>
          <p>{info(tk).story}</p>
          <p className="muted">{s.desc}</p>
          {people.map(p => <p key={p.name}><b>{p.name}</b>, {p.role.toLowerCase()} : {p.bio}</p>)}
        </section>
        <section className="d-sec">
          <h2>Chiffres clés</h2>
          <div className="plain">
            <div className="plain-row"><span>Capitalisation</span><b className="mono">{q ? `${nf0.format(q.p * s.shares / 1e6)} M` : "—"}</b></div>
            <div className="plain-row"><span>PER</span><b className="mono">{q && eps ? nf2.format(q.p / eps) : "—"}</b></div>
            <div className="plain-row"><span>Rendement du dividende</span><b className="mono">{q && s.div ? pct(s.div / 100 * s.p0 / q.p) : "aucun"}</b></div>
            <div className="plain-row"><span>Volatilité habituelle</span><b className="mono">{nf2.format(s.sig * 100)} % par jour d'Aurelys</b></div>
            <div className="plain-row"><span>Volatilité mesurée (dernier jour)</span><b className="mono">{vol == null ? "—" : `${nf2.format(vol * 100)} %`}</b></div>
            <div className="plain-row"><span>Liquidité</span><b>{s.liq}</b></div>
            <div className="plain-row"><span>Bêta</span><b className="mono">{nf2.format(s.beta)}</b></div>
          </div>
        </section>
        <h2>Actualités</h2>
        {news.slice(0, 8).map(n => <NewsItem key={n.id} n={n} now={now} onDetail={() => {}} onRead={setMark} />)}
        {!news.length && <p className="muted small">Rien de neuf pour l'instant.</p>}
      </div>
    </div>
  );
}

// Fiche : ce que j'ai sur cette société (positions à levier en cours, actions détenues), gain ou perte en direct.
function MyStake({ tk, mine, hold, aur, now, onSell, onTrade, onAuto, canStop }) {
  const q = aur.quotes[tk], p = q?.p ?? hold?.price, val = hold ? hold.qty * p : 0, g = hold ? val - hold.cost : 0;
  return (
    <section className="d-sec">
      <h2>Ma position</h2>
      {mine.map(b => <MyBet key={b.id} b={b} aur={aur} now={now} onTrade={onTrade} onAuto={onAuto} canStop={canStop} />)}
      {hold && <div className="plain">
        <div className="plain-row"><span>{`${nf2.format(hold.qty).replace(/,00$/, "")} actions`}</span><b className="mono">{W(val)}</b></div>
        <div className="plain-row"><span>Plus-value</span><b className={"mono " + cls(g)}>{`${sW(g)}, ${pct(g / hold.cost)}`}</b></div>
        <div className="plain-row"><span>Achat moyen, cours</span><b className="mono">{`${px(hold.cost / hold.qty)}, ${px(p)}`}</b></div>
        {BY[tk]?.div > 0 && <div className="plain-row"><span>Dividende</span><b className="mono">{nf2.format(BY[tk].div)} % par an</b></div>}
      </div>}
      {hold && onSell && <button type="button" className="btn" disabled={!q || q.halt} onClick={() => onSell(hold)}>Vendre mes actions</button>}
      <p className="muted small">Pointillés sur le graphique : entrée, liquidation, stop, objectif et achat moyen ; trait vertical : ouverture.</p>
    </section>
  );
}
// Une position à levier dans la fiche : gain en direct, seuils, clôture, stop et objectif (comme la carte de position).
function MyBet({ b, aur, now, onTrade, onAuto, canStop }) {
  const x = aurLive(b, aur.quotes[b.aur], aur.ticks[b.aur], aur.feeRate, aur.cut), [ask, setAsk] = useState(false), [auto, setAuto] = useState(false), [busy, setBusy] = useState(false);
  return (
    <div className="my-bet">
      <div className="plain">
        <div className="plain-row"><span>{`${b.dir === "up" ? "▲" : "▼"} ×${b.lev}, ${W(b.stake)} depuis ${gdur(now - Date.parse(b.created_at))}`}</span>
          <b className={"mono " + cls(x.net)}>{`${sW(x.net)}, ${pct(x.net / b.stake)}`}</b></div>
        <div className="plain-row"><span>Entrée, liquidation</span><b className="mono">{`${px(b.entry)}, ${px(x.lq)}`}</b></div>
        {(b.sl != null || b.tp != null) && <div className="plain-row"><span>Stop, objectif</span><b className="mono">{`${px(b.sl)}, ${px(b.tp)}`}</b></div>}
      </div>
      {onAuto && (auto ? <AutoForm b={b} onAuto={onAuto} canStop={canStop} onDone={() => setAuto(false)} />
        : <button type="button" className="link" onClick={() => setAuto(true)}>{b.sl != null || b.tp != null ? "Modifier le stop et l'objectif" : "Ajouter un stop ou un objectif"}</button>)}
      {onTrade && (x.hit ? <p className="muted small">Seuil de liquidation touché, règlement en cours…</p>
        : <button type="button" className="btn primary" disabled={busy || x.halt} onClick={() => setAsk(true)}>{`Clôturer pour ${W(x.value)}`}</button>)}
      {ask && !x.hit && <CloseSheet b={b} x={x} busy={busy} onCancel={() => setAsk(false)} onConfirm={async () => { setBusy(true); await onTrade(b); setBusy(false); setAsk(false) }} />}
    </div>
  );
}

// Positions en cours, toutes visibles d'un coup : une ligne par position (courbe depuis l'ouverture, gain si je clôture
// maintenant). Un appui ouvre la fiche : graphique navigable, clôture, stop et objectif.
export function OpenList({ bets, aur, now, onOpen }) {
  const rows = bets.filter(b => b.kind === "aurelys").sort((a, b) => b.id - a.id).map(b => ({ b, x: aurLive(b, aur.quotes[b.aur], aur.ticks[b.aur], aur.feeRate, aur.cut) }));
  const net = rows.reduce((a, r) => a + r.x.net, 0), stake = rows.reduce((a, r) => a + r.b.stake, 0);
  return (
    <section className="folio">
      <div className="folio-total"><small>Si tu clôtures tout maintenant</small><b className={"mono " + cls(net)}>{sW(net)}</b>
        <span className="mono muted">{`${rows.length} en cours, ${W(stake)} misés`}</span></div>
      <div className="p-list">
        {rows.map(({ b, x }) => {
          const t0 = Date.parse(b.created_at), danger = !x.hit && x.value <= .25 * b.stake, name = BY[b.aur]?.name ?? b.aur;
          return (
            <button key={b.id} type="button" className={"h-row" + (danger ? " danger" : "")} onClick={() => onOpen(b.aur)} aria-label={`Graphique de ma position ${name}`}>
              <TkIcon tk={b.aur} size={30} />
              <span className="h-n"><b>{name}</b><small>{`${b.dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×${b.lev}, ${W(b.stake)}${x.hit ? ", liquidée" : ""}`}</small></span>
              <span className="h-spark"><PositionChart id={"r" + b.id} entry={b.entry} dir={b.dir} pts={posPts(b, aur, now, x.px)} x0={t0} x1={Math.max(now, t0 + 60 * SPM * 1000)} h={28} /></span>
              <span className="r mono"><b className={cls(x.net)}>{sW(x.net)}</b><small className={cls(x.net)}>{pct(x.net / b.stake)}</small></span>
            </button>
          );
        })}
      </div>
      <p className="muted small">Touche une position pour son graphique, la clôturer ou poser un stop.</p>
    </section>
  );
}
// Courbe d'une position : cours minute par minute tant qu'on les a (dernière heure réelle), sinon bougies d'une heure d'Aurelys.
const posPts = (b, aur, now, last) => {
  const t0 = Date.parse(b.created_at), ticks = aur.ticks[b.aur];
  const cs = (aur.candles[b.aur] ?? []).filter(k => k[0] * 1000 > t0 - 300000), recent = (ticks ?? []).filter(k => k[0] * 1000 > t0);
  return [[t0, b.entry], ...((ticks?.[0]?.[0] ?? Infinity) * 1000 <= t0 ? recent.map(k => [k[0] * 1000, k[1]]) : cs.map(k => [Math.min(now, (k[0] + 60 * SPM) * 1000), k[4]])), [now, last]];
};

// Volatilité réalisée sur les 24 dernières bougies d'une heure, ramenée à un jour d'Aurelys.
function realizedVol(cs) {
  const c = cs.slice(-25).map(k => k[4]); if (c.length < 8) return null;
  const r = c.slice(1).map((v, i) => Math.log(v / c[i])), m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1) * 24);
}

/* ===== Position ===== */
// Valeur en direct : ce que rapporterait la clôture maintenant (closeQuote : impact de l'ordre et frais de clôture
// compris, même calcul que aur_close), et seuil de liquidation.
export const aurLive = (b, q, ticks, feeRate = FEE, cut = 1) => {
  const t0 = Date.parse(b.created_at) / 1000, lq = liqPrice(b);
  const hit = (ticks ?? []).some(([t, p]) => t > t0 && (b.dir === "up" ? p <= lq : p >= lq));
  const p = q?.p ?? b.entry, c = closeQuote(b, p, feeRate, cut), value = hit ? (b.amort ?? 0) * b.stake : c.value;
  return { px: p, value, net: value - b.stake - b.fees, closeFee: c.fee, exitPx: c.px, sl: c.sl, lq, hit, halt: q?.halt };
};

// Détail avant de clôturer, recalculé à chaque cours : le montant final suit le cours au moment où le serveur exécute.
function CloseSheet({ b, x, busy, onConfirm, onCancel }) {
  useEffect(() => { const k = e => e.key === "Escape" && onCancel(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onCancel]);
  const n = b.stake * b.lev;
  // Portail : la carte se soulève au survol (transform), ce qui ferait d'elle le repère du position: fixed (feuille qui clignote).
  return createPortal(
    <div className="scrim" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Clôturer la position">
        <div className="sheet-h"><b>Clôturer {BY[b.aur]?.name ?? b.aur} {b.dir === "up" ? "▲" : "▼"} ×{b.lev}</b><button type="button" className="x" onClick={onCancel} aria-label="Fermer">×</button></div>
        <div className="row"><span>Cours</span><b className="mono">{px(x.px)}</b></div>
        <div className="row"><span>Impact de ton ordre ({pct(-x.sl)})</span><b className="mono">{`${px(x.exitPx)}, −${W(n * x.sl)}`}</b></div>
        <div className="row"><span>Frais de clôture</span><b className="mono">−{W(x.closeFee)}</b></div>
        <div className="row"><span>Tu recevras (environ)</span><b className={"mono " + cls(x.net)}>{W(x.value)} ({sW(x.net)})</b></div>
        <p className="muted small">Le montant suit le cours jusqu'à l'exécution par le serveur.</p>
        <button type="button" className="btn primary big" disabled={busy || x.halt} onClick={onConfirm}>{`Clôturer pour ${W(x.value)}`}</button>
      </div>
    </div>,
    document.body
  );
}

// Objectif (pour tous) et stop (loft) d'une position : un cours vide retire l'ordre. Vérifiés par le serveur (aur_set_auto).
function AutoForm({ b, onAuto, canStop, onDone }) {
  const [sl, setSl] = useState(b.sl ?? ""), [tp, setTp] = useState(b.tp ?? ""), [busy, setBusy] = useState(false);
  const num = v => String(v).trim() === "" ? null : +String(v).replace(",", ".");
  return (
    <form className="auto-form" onSubmit={async e => { e.preventDefault(); setBusy(true); const r = await onAuto(b.id, canStop ? num(sl) : null, num(tp)); setBusy(false); if (r) onDone() }}>
      {canStop && <label>Stop<input className="mono" inputMode="decimal" placeholder="aucun" value={sl} onChange={e => setSl(e.target.value)} /></label>}
      <label>Objectif<input className="mono" inputMode="decimal" placeholder="aucun" value={tp} onChange={e => setTp(e.target.value)} /></label>
      <button type="submit" className="btn" disabled={busy}>OK</button>
      <p className="muted small">Dès que le cours touche {canStop ? "un seuil" : "l'objectif"}, la position est clôturée au cours du marché (prix qui peut différer un peu du seuil).{canStop ? "" : " Stop : avec le loft (QG)."}</p>
    </form>
  );
}

export function AurelysCard({ b, aur, now, onClose, onAuto, canStop, onDetail, Facts }) {
  const q = aur.quotes[b.aur], ticks = aur.ticks[b.aur], x = aurLive(b, q, ticks, aur.feeRate, aur.cut), t0 = Date.parse(b.created_at), [busy, setBusy] = useState(false), [auto, setAuto] = useState(false), [ask, setAsk] = useState(false);
  const pts = posPts(b, aur, now, x.px);
  const d = x.lq / x.px - 1, danger = !x.hit && x.value <= .25 * b.stake; // proche de la liquidation : la carte clignote
  return (
    <article className={"pos " + (x.net >= 0 ? "gain" : "loss") + (danger ? " danger" : "")}>
      <div className="pos-h">
        <button type="button" className="who link" onClick={() => onDetail?.(b.aur)} aria-label={`Voir le marché de ${BY[b.aur]?.name ?? b.aur}`}><TkIcon tk={b.aur} size={22} /><b>{BY[b.aur]?.name ?? b.aur}</b></button>
        <span className={"side " + b.dir}>{b.dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×{b.lev}</span>
      </div>
      <div className="pos-pnl"><b className={"mono " + cls(x.net)}>{sW(x.net)}</b><span className={"mono " + cls(x.net)}>{pct(x.net / b.stake)}</span><small>si tu clôtures maintenant</small></div>
      <div className="pos-chart" role="button" tabIndex={0} onClick={() => onDetail?.(b.aur)} onKeyDown={e => e.key === "Enter" && onDetail?.(b.aur)} aria-label="Voir le graphique du marché">
        <PositionChart id={b.id} entry={b.entry} dir={b.dir} pts={pts} x0={t0} x1={Math.max(now, t0 + 60 * SPM * 1000)} h={130} fmt={px} />
      </div>
      <Facts items={[
        ["Mise", `${W(b.stake)} à ×${b.lev}`],
        ["Valeur", W(x.value), cls(x.net)],
        ["Entrée", px(b.entry)],
        ["Cours", `${px(x.px)} (${pct(x.px / b.entry - 1)})`, cls((x.px / b.entry - 1) * (b.dir === "up" ? 1 : -1))],
        ["Liquidation", `${px(x.lq)} (${pct(d)})`, Math.abs(d) < .03 ? "down warn" : ""],
        ["Ouverte depuis", `${gdur(now - t0)} d'Aurelys`],
        b.sl != null && ["Stop", px(b.sl), "down"],
        b.tp != null && ["Objectif", px(b.tp), "up"],
        x.halt && ["Clôture", "à la reprise de la cotation"],
      ]} />
      <details className="t-more">
        <summary>Frais et impact</summary>
        <div className="plain">
          <div className="plain-row"><span>Frais d'ouverture payés</span><b className="mono">{W(b.fees)}</b></div>
          <div className="plain-row"><span>Frais de clôture</span><b className="mono">{W(x.closeFee)}</b></div>
          <div className="plain-row"><span>Impact de l'ordre de clôture</span><b className="mono">{`${pct(-x.sl)}, soit −${W(b.stake * b.lev * x.sl)}`}</b></div>
          <div className="plain-row"><span>Ouverte le</span><b className="mono">{gwhen(t0, now)}</b></div>
        </div>
      </details>
      {onAuto && (auto ? <AutoForm b={b} onAuto={onAuto} canStop={canStop} onDone={() => setAuto(false)} />
        : <button type="button" className="link" onClick={() => setAuto(true)}>{b.sl != null || b.tp != null ? (canStop ? "Modifier le stop et l'objectif" : "Modifier l'objectif") : canStop ? "Ajouter un stop ou un objectif" : "Ajouter un objectif (take profit)"}</button>)}
      {x.hit
        ? <p className="muted small">Seuil de liquidation touché, règlement en cours…</p>
        : <button type="button" className="btn primary" disabled={busy || x.halt} onClick={() => setAsk(true)}>{`Clôturer pour ${W(x.value)}`}</button>}
      {ask && !x.hit && <CloseSheet b={b} x={x} busy={busy} onCancel={() => setAsk(false)} onConfirm={async () => { setBusy(true); await onClose(b); setBusy(false); setAsk(false) }} />}
    </article>
  );
}

export const aurCap = tk => CAP_MULT * BY[tk].L;
