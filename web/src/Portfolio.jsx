// Portefeuille d'actions (sans levier) : valeur dans le temps, répartition, une carte par ligne.
import { useMemo, useRef, useState } from "react";
import { BY } from "../supabase/functions/_shared/aurelys.js";
import { TkIcon, px as aurPx } from "./AurelysUI.jsx";
import { Spark } from "./charts.jsx";
import { W, sW, nf0, nf2, pct, cls, clock } from "./format.js";

// Cours d'une action pour les courbes : bougies d'une heure d'Aurelys (36 dernières), ou à défaut les cours à la seconde
// des dernières minutes (un point par minute d'Aurelys). Renvoie [[t, cours], …].
export const series = (aur, tk) => {
  const cs = (aur.candles[tk] ?? []).slice(-36);
  return cs.length >= 6 ? cs.map(k => [k[0], k[4]]) : (aur.ticks[tk] ?? []).filter((_, i) => i % 5 === 0).map(k => [k[0], k[1]]);
};
// Valeur des actions détenues aujourd'hui, dans le temps.
function history(holds, aur, px) {
  const S = Object.fromEntries(holds.map(h => [h.tk, series(aur, h.tk)]));
  const times = [...new Set(Object.values(S).flat().map(k => k[0]))].sort((a, b) => a - b);
  return times.map(t => [t, holds.reduce((a, h) => {
    let c = null; for (const k of S[h.tk]) { if (k[0] > t) break; c = k[1] }
    return a + h.qty * (c ?? S[h.tk][0]?.[1] ?? px(h));
  }, 0)]);
}

function ValueChart({ pts, cost }) {
  const [hover, setHover] = useState(null), box = useRef(null);
  if (pts.length < 2) return <p className="muted small">La courbe se dessine au fil des heures d'Aurelys.</p>;
  const v = pts.map(p => p[1]), lo = Math.min(...v, cost), hi = Math.max(...v, cost), r = (hi - lo) || hi * .01 || 1, H = 120;
  const X = i => i / (pts.length - 1) * 100, Y = x => 8 + (1 - (x - lo) / r) * (H - 16);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(2)},${Y(p[1]).toFixed(2)}`).join("");
  const up = v.at(-1) >= cost, col = up ? "var(--up)" : "var(--down)", h = hover != null ? pts[hover] : null;
  const at = e => { const b = box.current.getBoundingClientRect(); setHover(Math.max(0, Math.min(pts.length - 1, Math.round((e.clientX - b.left) / b.width * (pts.length - 1))))) };
  return (
    <div className="folio-chart" ref={box} onPointerMove={at} onPointerDown={at} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-label="Valeur du portefeuille sur les 36 dernières heures d'Aurelys">
        <path d={`${line}L100,${H}L0,${H}Z`} fill={up ? "var(--up-soft)" : "var(--down-soft)"} />
        <line x1="0" x2="100" y1={Y(cost)} y2={Y(cost)} stroke="var(--faint)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <path d={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {h && <line x1={X(hover)} x2={X(hover)} y1="0" y2={H} stroke="var(--faint)" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="ax ax-hi mono">{W(hi)}</span><span className="ax ax-lo mono">{W(lo)}</span>
      <span className="folio-cost mono" style={{ top: `${Y(cost) / H * 100}%` }}>investi {W(cost)}</span>
      {h && <span className="tip mono">{clock(h[0] * 1000)} · {W(h[1])}</span>}
    </div>
  );
}

export default function Portfolio({ holds, aur, px, onSell, onBuy, onMarket }) {
  const pts = useMemo(() => history(holds, aur, px), [holds, aur, aur.candles, px]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!holds.length) return (
    <div className="empty-state"><b>Portefeuille vide</b>
      <p className="muted">Ouvre la fiche d'une entreprise et choisis « Investir » : tu achètes des actions, sans levier, et tu les gardes aussi longtemps que tu veux. Certaines versent un dividende chaque jour d'Aurelys.</p>
      <div className="empty-acts"><button type="button" className="btn primary" onClick={onMarket}>Marché</button></div></div>
  );
  const rows = holds.map(h => { const p = px(h), d = BY[h.tk] ?? {}; return { h, d, p, val: h.qty * p, gain: h.qty * p - h.cost } }).sort((a, b) => b.val - a.val);
  const tot = rows.reduce((a, r) => a + r.val, 0), cost = rows.reduce((a, r) => a + r.h.cost, 0), gain = tot - cost;
  const divDay = rows.reduce((a, r) => a + (r.d.div ? r.val * r.d.div / 100 / 365 : 0), 0), maxG = Math.max(...rows.map(r => Math.abs(r.gain / r.h.cost)), .01);
  return (
    <section className="folio">
      <div className="panel folio-top">
        <div className="folio-total"><small>Valeur du portefeuille</small><b className="mono">{W(tot)}</b>
          <span className={"mono " + cls(gain)}>{gain >= 0 ? "▲" : "▼"} {sW(gain)} · {pct(gain / cost)}</span></div>
        <ValueChart pts={pts} cost={cost} />
        <p className="muted small">Valeur des actions que tu détiens{(pts.at(-1)?.[0] - pts[0]?.[0]) > 3 * 3600 ? ", sur les 36 dernières heures d'Aurelys" : ", sur les dernières minutes"}. Pointillé : ce que tu as investi.</p>
      </div>
      <div className="tiles">
        <div className="tile"><small>Investi</small><b className="mono">{W(cost)}</b></div>
        <div className="tile"><small>Plus-value</small><b className={"mono " + cls(gain)}>{sW(gain)}</b></div>
        <div className="tile"><small>Dividendes / jour d'Aurelys</small><b className="mono up">{divDay ? `+${W(divDay)}` : "—"}</b></div>
        <div className="tile"><small>Lignes</small><b className="mono">{rows.length}</b></div>
      </div>
      <div className="panel">
        <h2>Répartition</h2>
        <div className="alloc" role="img" aria-label="Répartition du portefeuille par entreprise">
          {rows.map(r => <i key={r.h.tk} style={{ width: `${r.val / tot * 100}%`, background: r.d.color ?? "var(--muted)" }} title={`${r.d.name} ${pct(r.val / tot).replace("+", "")}`} />)}
        </div>
        <div className="alloc-legend">
          {rows.map(r => <span key={r.h.tk}><i style={{ background: r.d.color ?? "var(--muted)" }} />{r.d.name ?? r.h.tk}<b className="mono">{nf0.format(r.val / tot * 100)} %</b></span>)}
        </div>
      </div>
      <div className="folio-cards">
        {rows.map(({ h, d, p, val, gain: g }) => {
          const v = series(aur, h.tk).map(k => k[1]), rel = g / h.cost;
          return (
            <article key={h.tk} className={"panel folio-card " + (g >= 0 ? "gain" : "loss")}>
              <div className="folio-h">
                <TkIcon tk={h.tk} size={32} />
                <span><b>{d.name ?? h.tk}</b><small className="muted">{h.status === "round" ? "levée en cours · cotation à venir" : h.status === "listed" ? "jeune pousse · risqué" : "cote principale"}{d.div ? ` · dividende ${nf2.format(d.div)} %/an` : ""}</small></span>
                <span className="r mono"><b>{W(val)}</b><small className={cls(g)}>{sW(g)} · {pct(rel)}</small></span>
              </div>
              {v.length > 1 && <Spark path={v} t={v.length - 1} h={34} />}
              <div className="gainbar" aria-hidden="true"><i className={g >= 0 ? "up" : "down"} style={{ width: `${Math.abs(rel) / maxG * 50}%`, [g >= 0 ? "left" : "right"]: "50%" }} /></div>
              <div className="folio-facts mono">
                <span><small>Actions</small>{nf2.format(h.qty)}</span>
                <span><small>Achat moyen</small>{aurPx(h.cost / h.qty)}</span>
                <span><small>Cours</small>{aurPx(p)}</span>
                <span><small>Poids</small>{nf0.format(val / tot * 100)} %</span>
              </div>
              {h.status !== "round" && <div className="empty-acts">
                <button type="button" className="btn" onClick={() => onBuy(h.tk)}>Renforcer</button>
                <button type="button" className="btn" onClick={() => onSell(h)}>Vendre</button>
              </div>}
            </article>
          );
        })}
      </div>
      <p className="fine">Pas de levier, pas de liquidation : la valeur suit le cours. Les jeunes pousses peuvent faire faillite (sous 15 % de leur prix d'introduction), et leurs actions sont alors perdues. Frais de 0,1 % à l'achat et à la vente ; un gros ordre fait bouger le cours.</p>
    </section>
  );
}
