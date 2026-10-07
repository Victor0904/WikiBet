// Bourse d'Aurelys : tableau de bord, liste des actions, actualités, carte thermique, fiche entreprise, carte de position.
import { useEffect, useMemo, useRef, useState } from "react";
import { STOCKS, BY, SECTORS, REGIMES, CHARACTERS, INDEX, FEE, CAP_MULT, gameClock, calendar, sma, bollinger, rsi } from "../supabase/functions/_shared/aurelys.js";
import { dayOpen } from "./aurelys.js";
import { STORIES } from "./aurelys-stories.js";
import { W, sW, nf0, nf2, pct, cls, clock } from "./format.js";
import { tradeValue, liqPrice } from "./engine.js";
import { Spark, PositionChart } from "./charts.jsx";

export const px = v => v == null || isNaN(v) ? "—" : nf2.format(v);
const sec = ms => ms / 1000;
const inMin = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? "maintenant" : m < 60 ? `dans ${m} min` : `dans ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` };
const agoTxt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `il y a ${s} s` : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : `il y a ${Math.floor(s / 3600)} h` };
// Derniers cours pour une mini-courbe : bougies d'une minute, ou cours à la seconde tant qu'il y a peu de bougies.
const closesOf = (aur, tk, n) => { const c = (aur.candles[tk] ?? []).slice(-n).map(k => k[4]); return c.length >= 5 ? c : (aur.ticks[tk] ?? []).map(k => k[1]) };
const chgOf = (aur, tk, now) => { const p = aur.quotes[tk]?.p, o = dayOpen(aur, tk, sec(now)); return p && o ? p / o - 1 : 0 };

export const TkIcon = ({ tk, size = 34 }) => (
  <span className="coin-icon tk-icon" style={{ background: BY[tk]?.color ?? "var(--panel2)", width: size, height: size, fontSize: size * .3 }} aria-hidden="true">{tk}</span>
);

// Bandeau : horloge d'Aurelys (décor), régime, AUR-12.
function AurBar({ aur, now }) {
  const c = gameClock(sec(now)), reg = REGIMES[aur.x?.reg ?? "calme"], idx = aur.quotes[INDEX]?.p, ch = chgOf(aur, INDEX, now);
  return (
    <div className="aur-bar">
      <span className="aur-clock mono" title="Heure d'Aurelys : 1 seconde réelle = 1 minute de jeu"><small>Aurelys · jour {c.day}</small>{c.hm}</span>
      <span className="aur-reg" title="Humeur du marché"><i aria-hidden="true">{reg.icon}</i>{reg.name}</span>
      <span className="r mono"><b>AUR-12 {px(idx)}</b><small className={cls(ch)}>{pct(ch)} jour</small></span>
    </div>
  );
}

const VIEWS = [["board", "Tableau de bord"], ["list", "Actions"], ["news", "Actualités"], ["heat", "Carte"]];
export function AurelysMarket({ aur, now, bets, onPick, onDetail }) {
  const [view, setView] = useState("board");
  const live = aur.live;
  return (
    <section>
      <div className="feed-info"><i className={"pulse" + (live ? "" : " off")} aria-hidden="true" />{live ? "Bourse fictive, simulée en continu par des bots et les joueurs" : "Connexion au marché…"} · 1 s réelle = 1 min d'Aurelys</div>
      <AurBar aur={aur} now={now} />
      <div className="chips" role="group" aria-label="Vue">
        {VIEWS.map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
      </div>
      {view === "board" ? <Board aur={aur} now={now} onDetail={onDetail} onNews={() => setView("news")} />
        : view === "list" ? <List aur={aur} now={now} bets={bets} onPick={onPick} onDetail={onDetail} />
        : view === "news" ? <News aur={aur} now={now} onDetail={onDetail} />
        : <Heat aur={aur} now={now} onDetail={onDetail} />}
      <p className="fine">Marché entièrement fictif : entreprises, personnages, cours et actualités sont simulés. Les prix naissent des ordres de bots (fondamentalistes, suiveurs de tendance, contrariens, chartistes, petits porteurs), de baleines et des joueurs : un gros ordre fait bouger le cours. Frais de 0,1 % du montant engagé à l'ouverture et à la clôture.</p>
    </section>
  );
}

function Board({ aur, now, onDetail, onNews }) {
  const x = aur.x, reg = REGIMES[x?.reg ?? "calme"], idx = closesOf(aur, INDEX, 180);
  // Palmarès figé une minute (une heure d'Aurelys) pour ne pas bouger sous le doigt.
  const slot = Math.floor(now / 60000);
  const movers = useMemo(() => STOCKS.map(s => ({ s, c: chgOf(aur, s.tk, now) })).sort((a, b) => b.c - a.c), [slot, aur.ok]); // eslint-disable-line
  const cal = calendar(sec(now), 4), last = aur.news.slice(0, 3);
  return (
    <div className="aur-board">
      <div className="panel">
        <h2>AUR-12 <span className="muted">3 dernières heures</span></h2>
        {idx.length > 1 ? <Spark path={idx} t={idx.length - 1} h={80} /> : <p className="muted small">Chargement…</p>}
        <p className="muted small">Moyenne des 12 sociétés, pondérée par leur capitalisation (1 000 au lancement).</p>
      </div>
      <div className="tiles">
        <div className="tile"><small>Régime</small><b>{reg.icon} {reg.name}</b></div>
        <div className="tile"><small>Peur (VIXA)</small><b className="mono">{x ? nf0.format(x.vixa) : "—"}</b></div>
        <div className="tile"><small>Taux directeur</small><b className="mono">{x ? nf2.format(x.r) + " %" : "—"}</b></div>
        <div className="tile"><small>Croissance · inflation</small><b className="mono">{x ? `${nf2.format(x.g)} · ${nf2.format(x.pi)} %` : "—"}</b></div>
      </div>
      <div className="panel">
        <h2>Le jour d'Aurelys <span className="muted">depuis 00:00</span></h2>
        {[...movers.slice(0, 3), ...movers.slice(-3)].map(({ s }) => {
          const c = chgOf(aur, s.tk, now);
          return <button key={s.tk} type="button" className="row as-link wide" onClick={() => onDetail(s.tk)}><span className="who"><TkIcon tk={s.tk} size={22} />{s.name}</span><b className={"mono " + cls(c)}>{c >= 0 ? "▲" : "▼"} {pct(c)}</b></button>;
        })}
      </div>
      <div className="panel">
        <h2>À venir</h2>
        {cal.map(e => <div key={e.m + (e.tk ?? "")} className="row"><span>{e.title}</span><b className="mono">{gameClock(e.at / 1000).hm} · {inMin(e.at - now)}</b></div>)}
      </div>
      <div className="panel">
        <h2>Dernières actualités <button type="button" className="btn ghost" onClick={onNews}>Tout voir</button></h2>
        {last.map(n => <NewsItem key={n.id} n={n} now={now} onDetail={onDetail} />)}
      </div>
    </div>
  );
}

function List({ aur, now, bets, onPick, onDetail }) {
  const mine = tk => bets.some(b => b.kind === "aurelys" && b.aur === tk);
  return (
    <div className="market">
      <div className="mrow head"><span>Société</span><span /><span className="r">Cours · jour</span><span /></div>
      {STOCKS.map(s => {
        const q = aur.quotes[s.tk], c = chgOf(aur, s.tk, now), v = closesOf(aur, s.tk, 60);
        return (
          <div key={s.tk} className={"mrow" + (mine(s.tk) ? " mine" : "")}>
            <button type="button" className="name who as-link" onClick={() => onDetail(s.tk)} aria-label={`Fiche de ${s.name}`}>
              <TkIcon tk={s.tk} /><span><b>{s.name}</b><small>{q?.halt ? "cotation suspendue" : STORIES[s.tk].what}</small></span>
            </button>
            {v.length > 1 ? <Spark path={v} t={v.length - 1} /> : <span />}
            <span className="r mono"><b>{px(q?.p)}</b><small className={cls(c)}>{q ? pct(c) : ""}</small></span>
            <span className="act">
              <button type="button" className="buy" disabled={!q || q.halt} onClick={() => onPick(s.tk, "up")} aria-label={`Hausse sur ${s.name}`}>▲</button>
              <button type="button" className="sell" disabled={!q || q.halt} onClick={() => onPick(s.tk, "down")} aria-label={`Baisse sur ${s.name}`}>▼</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

const CAT = { resultats: "Résultats", essai: "Essai clinique", contrat: "Contrat", scandale: "Scandale", pdg: "Déclaration", analyste: "Analyste", rumeur: "Rumeur",
  produit: "Produit", meteo: "Météo", baleine: "Baleine", crise: "Crise", marche: "Marché", macro: "Macro", taux: "Banque Centrale", secteur: "Secteur", suspension: "Suspension" };
function NewsItem({ n, now, onDetail }) {
  const tone = n.sent > .15 ? "up" : n.sent < -.15 ? "down" : "flat", s = n.tk ? BY[n.tk] : null;
  return (
    <article className="news">
      <span className={"nbadge " + tone} aria-label={tone === "up" ? "bonne nouvelle" : tone === "down" ? "mauvaise nouvelle" : "neutre"}>{tone === "up" ? "▲" : tone === "down" ? "▼" : "●"}</span>
      <div>
        <p className="ntitle">{n.title}</p>
        {n.body && <p className="muted small">{n.body}</p>}
        <p className="nmeta">
          {s ? <button type="button" className="as-link ntk" onClick={() => onDetail(s.tk)}>{s.tk}</button> : n.sector ? <span>{SECTORS[n.sector]?.name}</span> : null}
          <span>{CAT[n.cat] ?? n.cat}</span>
          {n.fiab < .5 && <span className="warn-tag">Rumeur non confirmée</span>}
          <span className="mono">{gameClock(n.at / 1000).hm} · {agoTxt(now - n.at)}</span>
        </p>
      </div>
    </article>
  );
}

function News({ aur, now, onDetail }) {
  const [f, setF] = useState("Tout"), [shown, setShown] = useState(null);
  const top = aur.news[0]?.id ?? 0, lim = shown ?? top;
  useEffect(() => { if (shown == null && top) setShown(top) }, [top, shown]);
  const fresh = aur.news.filter(n => n.id > lim).length;
  const list = aur.news.filter(n => n.id <= lim && (f === "Tout" || n.sector === f || BY[n.tk]?.sector === f || (f === "Marché" && !n.tk && !n.sector)));
  return (
    <div>
      <div className="panel">
        <h2>Calendrier</h2>
        {calendar(sec(now), 6).map(e => <div key={e.m + (e.tk ?? "")} className="row"><span>{e.title}</span><b className="mono">{gameClock(e.at / 1000).hm} · {inMin(e.at - now)}</b></div>)}
        <p className="muted small">Avant un rendez-vous, le marché est nerveux : la volatilité monte.</p>
      </div>
      <div className="chips" role="group" aria-label="Filtre">
        {["Tout", "Marché", ...Object.keys(SECTORS)].map(k => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}>{SECTORS[k]?.name ?? k}</button>)}
      </div>
      {fresh > 0 && <button type="button" className="btn fresh" onClick={() => setShown(top)}>↑ {fresh} nouvelle{fresh > 1 ? "s" : ""}</button>}
      <div className="news-list">{list.length ? list.map(n => <NewsItem key={n.id} n={n} now={now} onDetail={onDetail} />) : <p className="muted pad">Aucune actualité pour l'instant.</p>}</div>
    </div>
  );
}

function Heat({ aur, now, onDetail }) {
  return (
    <div className="heat">
      {STOCKS.map(s => {
        const c = chgOf(aur, s.tk, now), a = Math.min(.85, .12 + Math.abs(c) / .05 * .7);
        return (
          <button key={s.tk} type="button" className="hcell" onClick={() => onDetail(s.tk)} style={{ background: c >= 0 ? `rgba(31, 203, 139, ${a})` : `rgba(240, 75, 92, ${a})` }} aria-label={`${s.name} ${pct(c)}`}>
            <b>{s.tk}</b><small>{s.name}</small><span className="mono">{c >= 0 ? "▲" : "▼"} {pct(c)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ===== Fiche entreprise ===== */
const MM = [["mm20", "MM 20", "#c98500"], ["mm50", "MM 50", "#3987e5"], ["boll", "Bollinger", "var(--muted)"], ["rsi", "RSI", "var(--ink)"]];
const FRAMES = [[5, "5 s"], [60, "1 min"], [300, "5 min"], [900, "15 min"]];
// Regroupe des bougies (ou des cours [t, p, v]) par tranches de `g` secondes.
function group(rows, g, isTick) {
  const out = [];
  for (const r of rows) {
    const [t, o, h, l, c, v] = isTick ? [r[0], r[1], r[1], r[1], r[1], r[2]] : r, m = t - t % g, k = out[out.length - 1];
    if (k && k.t === m) { k.h = Math.max(k.h, h); k.l = Math.min(k.l, l); k.c = c; k.v += v } else out.push({ t: m, o, h, l, c, v });
  }
  return out.slice(-80);
}

function AurChart({ cs, last, ind, marks, onMark }) {
  const [hover, setHover] = useState(null), box = useRef(null);
  if (!cs.length) return <div className="candles empty"><p className="muted small">Chargement du graphique…</p></div>;
  const closes = cs.map(k => k.c), m20 = sma(closes, 20), m50 = sma(closes, 50), bb = bollinger(closes, 20);
  const band = bb.map((b, i) => b && [i, b[0], b[1]]).filter(Boolean);
  const lo0 = Math.min(...cs.map(k => k.l), ...(ind.boll ? bb.filter(Boolean).map(b => b[0]) : [])), hi0 = Math.max(...cs.map(k => k.h), ...(ind.boll ? bb.filter(Boolean).map(b => b[1]) : []));
  const lo = Math.min(lo0, last ?? Infinity), hi = Math.max(hi0, last ?? -Infinity), r = (hi - lo) || hi * .001;
  const H = 100, PH = 78, Y = v => 4 + (1 - (v - lo) / r) * (PH - 8), w = 100 / cs.length, X = i => i * w + w / 2;
  const vmax = Math.max(...cs.map(k => k.v), 1), VY = v => H - v / vmax * (H - PH - 4);
  const line = a => a.map((v, i) => v == null ? null : `${X(i).toFixed(2)},${Y(v).toFixed(2)}`).filter(Boolean).map((p, i) => (i ? "L" : "M") + p).join("");
  const t0 = cs[0].t, t1 = cs[cs.length - 1].t + (cs[1] ? cs[1].t - cs[0].t : 60);
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
        <span className="ax t0 mono">{clock(t0 * 1000)}</span>
        <span className="ax t1 mono">{clock(cs[cs.length - 1].t * 1000)}</span>
        {hk && <span className="tip mono">{clock(hk.t * 1000)} · O {px(hk.o)} H {px(hk.h)} B {px(hk.l)} C {px(hk.c)} · vol. {nf0.format(hk.v)}</span>}
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

export function AurelysDetail({ tk, aur, api, now, onPick, onClose }) {
  const s = BY[tk], q = aur.quotes[tk], c = chgOf(aur, tk, now);
  const [g, setG] = useState(() => (aur.candles[tk] ?? []).length >= 10 ? 60 : 5), [ind, setInd] = useState({ mm20: true, mm50: false, boll: false, rsi: false }), [long, setLong] = useState([]), [mark, setMark] = useState(null);
  useEffect(() => {
    if (g < 300) return; let on = true;
    const load = () => api.aurHistory(tk, 1440).then(h => on && setLong((h[tk] ?? []).map(r => r.map(Number)))).catch(() => {});
    load(); const id = setInterval(load, 60000); return () => { on = false; clearInterval(id) };
  }, [api, tk, g]);
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onClose]);
  const cs = g === 5 ? group(aur.ticks[tk] ?? [], 5, true) : g === 60 ? group(aur.candles[tk] ?? [], 60) : group(long, g);
  const eps = aur.x?.eps?.[tk], news = aur.news.filter(n => n.tk === tk || n.sector === s.sector || (!n.tk && !n.sector));
  const people = CHARACTERS.filter(p => p.tk === tk);
  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet detail" role="dialog" aria-modal="true" aria-label={s.name}>
        <div className="sheet-h">
          <span className="who"><TkIcon tk={tk} size={38} /><span><b className="detail-name">{s.name}</b><small className="muted">{tk} · {SECTORS[s.sector].name}</small></span></span>
          <button type="button" className="x" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <div className="detail-price"><b className="mono">{px(q?.p)}</b><span className={"mono " + cls(c)}>{q?.halt ? "cotation suspendue" : `${c >= 0 ? "▲" : "▼"} ${pct(c)} jour`}</span></div>
        <div className="seg" role="group" aria-label="Unité de temps">{FRAMES.map(([v, l]) => <button key={v} type="button" aria-pressed={g === v} onClick={() => setG(v)}>{l}</button>)}</div>
        <div className="chips legend" role="group" aria-label="Indicateurs">
          {MM.map(([k, l, col]) => <button key={k} type="button" aria-pressed={ind[k]} onClick={() => setInd(x => ({ ...x, [k]: !x[k] }))}><i style={{ background: col }} aria-hidden="true" />{l}</button>)}
        </div>
        <AurChart cs={cs} last={q?.p} ind={ind} marks={aur.news.filter(n => n.tk === tk)} onMark={setMark} />
        {mark && <p className="small mark-note"><b>{gameClock(mark.at / 1000).hm}</b> {mark.title}</p>}
        <div className="qbtns">
          <button type="button" className="buy" disabled={!q || q.halt} onClick={() => onPick(tk, "up")}><span>▲ Hausse</span></button>
          <button type="button" className="sell" disabled={!q || q.halt} onClick={() => onPick(tk, "down")}><span>▼ Baisse</span></button>
        </div>
        <div className="story">
          <p className="small"><b>{STORIES[tk].what}</b> · fondée en {STORIES[tk].since}</p>
          <p className="small">{STORIES[tk].story}</p>
          <p className="small muted">{s.desc}</p>
        </div>
        <div className="rows mono">
          <div className="row"><span>Capitalisation</span><b>{q ? `${nf0.format(q.p * s.shares / 1e6)} M` : "—"}</b></div>
          <div className="row"><span>PER</span><b>{q && eps ? nf2.format(q.p / eps) : "—"}</b></div>
          <div className="row"><span>Rendement du dividende</span><b>{q && s.div ? pct(s.div / 100 * s.p0 / q.p) : "aucun"}</b></div>
          <div className="row"><span>Volatilité habituelle</span><b>{nf2.format(s.sig * 100)} % par jour d'Aurelys</b></div>
          <div className="row"><span>Liquidité · bêta</span><b>{s.liq} · {nf2.format(s.beta)}</b></div>
        </div>
        {people.map(p => <p key={p.name} className="small"><b>{p.name}</b>, {p.role.toLowerCase()} : {p.bio}</p>)}
        <h2>Actualités</h2>
        {news.slice(0, 8).map(n => <NewsItem key={n.id} n={n} now={now} onDetail={() => {}} />)}
        {!news.length && <p className="muted small">Rien de neuf pour l'instant.</p>}
      </div>
    </div>
  );
}

/* ===== Position ===== */
// Valeur en direct (frais de clôture déduits, hors impact de l'ordre de clôture) et seuil de liquidation.
export const aurLive = (b, q, ticks) => {
  const t0 = Date.parse(b.created_at) / 1000, lq = liqPrice(b);
  const hit = (ticks ?? []).some(([t, p]) => t > t0 && (b.dir === "up" ? p <= lq : p >= lq));
  const p = q?.p ?? b.entry, closeFee = b.stake * b.lev * FEE, value = hit ? 0 : Math.max(0, tradeValue(b, p) - closeFee);
  return { px: p, value, net: value - b.stake - b.fees, closeFee, lq, hit, halt: q?.halt };
};
const since = ms => { const m = Math.floor(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` };

export function AurelysCard({ b, aur, now, onClose, Facts }) {
  const q = aur.quotes[b.aur], ticks = aur.ticks[b.aur], x = aurLive(b, q, ticks), t0 = Date.parse(b.created_at), [busy, setBusy] = useState(false);
  const cs = (aur.candles[b.aur] ?? []).filter(k => k[0] * 1000 > t0 - 60000);
  const pts = [[t0, b.entry], ...(now - t0 < 540000 ? (ticks ?? []).filter(k => k[0] * 1000 > t0).map(k => [k[0] * 1000, k[1]]) : cs.map(k => [k[0] * 1000 + 59000, k[4]])), [now, x.px]];
  const d = x.lq / x.px - 1;
  return (
    <article className={"pos " + (x.net >= 0 ? "gain" : "loss")}>
      <div className="pos-h">
        <b className="who"><TkIcon tk={b.aur} size={22} />{BY[b.aur]?.name ?? b.aur}</b>
        <span className={"side " + b.dir}>{b.dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×{b.lev}</span>
      </div>
      <div className="pos-pnl mono"><span className={cls(x.net)}>{sW(x.net)}</span><span className={cls(x.net)}>{pct(x.net / b.stake)}</span></div>
      <PositionChart id={b.id} entry={b.entry} dir={b.dir} pts={pts} x0={t0} x1={Math.max(now, t0 + 120000)} />
      <Facts items={[
        ["Mise", `${W(b.stake)} · ×${b.lev}`],
        ["Valeur (frais déduits)", W(x.value), cls(x.net)],
        ["Entrée", `${px(b.entry)} · ${clock(t0)}`],
        ["Cours", `${px(x.px)} (${pct(x.px / b.entry - 1)})`, cls((x.px / b.entry - 1) * (b.dir === "up" ? 1 : -1))],
        ["Liquidation", `${px(x.lq)} (${pct(d)})`, Math.abs(d) < .03 ? "down warn" : ""],
        ["Frais", `${W(b.fees)} payés + ${W(x.closeFee)}`],
        ["Ouverte depuis", since(now - t0)],
        ["Clôture", x.halt ? "à la reprise de la cotation" : "quand tu veux"],
      ]} />
      {x.hit
        ? <p className="muted small">Seuil de liquidation touché, règlement en cours…</p>
        : <button type="button" className="btn primary" disabled={busy || x.halt} onClick={async () => { setBusy(true); await onClose(b); setBusy(false) }}>Clôturer · {W(x.value)}</button>}
    </article>
  );
}

export const aurCap = tk => CAP_MULT * BY[tk].L;
