// Marché crypto : liste en direct, fiche détaillée avec bougies, carte de position.
import { useEffect, useRef, useState } from "react";
import { ASSETS, BY_SYM, eur, fetchCandles, FEE } from "./crypto.js";
import { W, sW, nf0, clock, pct, cls } from "./format.js";
import { tradeValue, liqPrice } from "./engine.js";
import { Spark, PositionChart } from "./charts.jsx";

export const CoinIcon = ({ sym, size = 34 }) => (
  <span className="coin-icon" style={{ background: BY_SYM[sym]?.color, width: size, height: size, fontSize: size * .34 }} aria-hidden="true">{sym.slice(0, 4)}</span>
);
const chg24 = q => q?.open24 ? q.price / q.open24 - 1 : 0;
const closes = (cs, q) => { const v = (cs ?? []).map(k => k[4]); if (q?.price) v.push(q.price); return v };

export function CryptoMarket({ quotes, candles, live, bets, onPick, onDetail }) {
  const mine = sym => bets.some(b => b.kind === "crypto" && b.sym === sym);
  // Sens du dernier mouvement de chaque prix, pour faire flasher la case (la clé change à chaque nouveau prix).
  const last = useRef({}), moves = {};
  for (const a of ASSETS) {
    const p = quotes[a.sym]?.price, prev = last.current[a.sym];
    if (p == null) continue;
    moves[a.sym] = !prev || p === prev.p ? prev?.m ?? "" : p > prev.p ? "f-up" : "f-down";
    if (!prev || p !== prev.p) last.current[a.sym] = { p, m: moves[a.sym] };
  }
  return (
    <section>
      <div className="feed-info"><i className={"pulse" + (live ? "" : " off")} aria-hidden="true" />{live ? "Prix réels Coinbase en direct, en euros" : "Connexion au flux de prix…"} · ouvert 24 h/24</div>
      <div className="market">
        <div className="mrow head"><span>Crypto</span><span /><span className="r">Prix · 24 h</span><span /></div>
        {ASSETS.map(a => {
          const q = quotes[a.sym], c = chg24(q), v = closes(candles[a.sym], q);
          return (
            <div key={a.sym} className={"mrow" + (mine(a.sym) ? " mine" : "")}>
              <button type="button" className="name who as-link" onClick={() => onDetail(a.sym)} aria-label={`Graphique de ${a.name}`}>
                <CoinIcon sym={a.sym} /><span><b>{a.name}</b><small>{a.sym} · voir le graphique</small></span>
              </button>
              {v.length > 1 ? <Spark path={v} t={v.length - 1} /> : <span />}
              <span className="r mono"><b key={q?.price} className={"flash " + (moves[a.sym] ?? "")}>{q ? eur(q.price) : "…"}</b><small className={cls(c)}>{q ? pct(c) : ""}</small></span>
              <span className="act">
                <button type="button" className="buy" disabled={!q} onClick={() => onPick(a.sym, "up")} aria-label={`Hausse sur ${a.name}`}>▲</button>
                <button type="button" className="sell" disabled={!q} onClick={() => onPick(a.sym, "down")} aria-label={`Baisse sur ${a.name}`}>▼</button>
              </span>
            </div>
          );
        })}
      </div>
      <p className="fine">Prix réels de Coinbase (paires en euros). Le prix d'un ordre est celui que le serveur relève chez Coinbase au moment où il le reçoit. Frais de 0,1 % du montant engagé à l'ouverture et à la clôture. Les W restent une monnaie fictive : rien ne s'achète ni ne se retire.</p>
    </section>
  );
}

// Graphique en bougies, en SVG étiré ; les prix extrêmes et le dernier prix sont écrits à droite.
function Candles({ cs, price }) {
  if (!cs.length) return <div className="candles empty"><p className="muted small">Chargement du graphique…</p></div>;
  const lo = Math.min(...cs.map(k => k.l), price ?? Infinity), hi = Math.max(...cs.map(k => k.h), price ?? -Infinity), r = (hi - lo) || hi * .001;
  const H = 100, Y = v => 4 + (1 - (v - lo) / r) * (H - 8), w = 100 / cs.length;
  const last = price ?? cs[cs.length - 1].c;
  return (
    <div className="candles">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-label="Graphique en bougies">
        {cs.map((k, i) => {
          const up = k.c >= k.o, col = up ? "var(--up)" : "var(--down)", x = i * w + w / 2;
          return <g key={k.t}>
            <line x1={x} x2={x} y1={Y(k.h)} y2={Y(k.l)} stroke={col} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <rect x={x - w * .32} width={w * .64} y={Y(Math.max(k.o, k.c))} height={Math.max(.6, Math.abs(Y(k.o) - Y(k.c)))} fill={col} />
          </g>;
        })}
        <line x1="0" x2="100" y1={Y(last)} y2={Y(last)} stroke="var(--accent)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="ax ax-hi mono">{eur(hi)}</span>
      <span className="ax ax-lo mono">{eur(lo)}</span>
      <span className="ax last mono" style={{ top: `calc(10px + (100% - 32px) * ${Y(last) / 100})` }}>{eur(last)}</span>
      <span className="ax t0 mono">{clock(cs[0].t)}</span>
      <span className="ax t1 mono">{clock(cs[cs.length - 1].t)}</span>
    </div>
  );
}

const FRAMES = [[60, "1 min"], [300, "5 min"], [900, "15 min"], [3600, "1 h"]];
export function CryptoDetail({ sym, quotes, onPick, onClose }) {
  const a = BY_SYM[sym], q = quotes[sym], [gran, setGran] = useState(300), [cs, setCs] = useState([]);
  useEffect(() => { let on = true; setCs([]); const load = () => fetchCandles(a.pair, gran).then(k => on && setCs(k)).catch(() => {}); load(); const id = setInterval(load, 30000); return () => { on = false; clearInterval(id) } }, [a.pair, gran]);
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onClose]);
  const c = chg24(q);
  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet detail" role="dialog" aria-modal="true" aria-label={a.name}>
        <div className="sheet-h">
          <span className="who"><CoinIcon sym={sym} size={38} /><span><b className="detail-name">{a.name}</b><small className="muted">{a.sym} / EUR</small></span></span>
          <button type="button" className="x" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <div className="detail-price"><b className="mono">{q ? eur(q.price) : "…"}</b><span className={"mono " + cls(c)}>{q ? `${pct(c)} sur 24 h` : ""}</span></div>
        <div className="seg" role="group" aria-label="Unité de temps">{FRAMES.map(([g, l]) => <button key={g} type="button" aria-pressed={gran === g} onClick={() => setGran(g)}>{l}</button>)}</div>
        <Candles cs={cs} price={q?.price} />
        {q && <div className="rows mono">
          <div className="row"><span>Plus haut 24 h</span><b>{eur(q.high24)}</b></div>
          <div className="row"><span>Plus bas 24 h</span><b>{eur(q.low24)}</b></div>
          <div className="row"><span>Volume 24 h</span><b>{nf0.format(q.vol24)} {a.sym}</b></div>
        </div>}
        <div className="qbtns">
          <button type="button" className="buy" disabled={!q} onClick={() => onPick(sym, "up")}><span>▲ Hausse</span></button>
          <button type="button" className="sell" disabled={!q} onClick={() => onPick(sym, "down")}><span>▼ Baisse</span></button>
        </div>
      </div>
    </div>
  );
}

// Position crypto : valeur en direct (frais de clôture déduits), seuil de liquidation, frais.
export const cryptoLive = (b, q, cs) => {
  const t0 = Date.parse(b.created_at), lq = liqPrice(b);
  const hit = (cs ?? []).some(k => k[0] >= t0 - 60000 && (b.dir === "up" ? k[3] <= lq : k[2] >= lq)) || (q && (b.dir === "up" ? q.price <= lq : q.price >= lq));
  const px = q?.price ?? b.entry, closeFee = b.stake * b.lev * FEE;
  const value = hit ? 0 : Math.max(0, tradeValue(b, px) - closeFee);
  return { px, value, net: value - b.stake - b.fees, closeFee, lq, hit };
};
const since = ms => { const m = Math.floor(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` };

export function CryptoCard({ b, q, cs, now, onClose, Facts }) {
  const x = cryptoLive(b, q, cs), t0 = Date.parse(b.created_at), [busy, setBusy] = useState(false);
  const pts = [[t0, b.entry], ...(cs ?? []).filter(k => k[0] > t0).map(k => [k[0] + 59000, k[4]]), [now, x.px]];
  const d = x.lq / x.px - 1;
  return (
    <article className={"pos " + (x.net >= 0 ? "gain" : "loss")}>
      <div className="pos-h">
        <b className="who"><CoinIcon sym={b.sym} size={22} />{BY_SYM[b.sym]?.name ?? b.sym}</b>
        <span className={"side " + b.dir}>{b.dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×{b.lev}</span>
      </div>
      <div className="pos-pnl mono"><span className={cls(x.net)}>{sW(x.net)}</span><span className={cls(x.net)}>{pct(x.net / b.stake)}</span></div>
      <PositionChart id={b.id} entry={b.entry} dir={b.dir} pts={pts} x0={t0} x1={Math.max(now, t0 + 120000)} />
      <Facts items={[
        ["Mise", `${W(b.stake)} · ×${b.lev}`],
        ["Valeur (frais déduits)", W(x.value), cls(x.net)],
        ["Entrée", `${eur(b.entry)} · ${clock(t0)}`],
        ["Prix", `${eur(x.px)} (${pct(x.px / b.entry - 1)})`, cls((x.px / b.entry - 1) * (b.dir === "up" ? 1 : -1))],
        ["Liquidation", `${eur(x.lq)} (${pct(d)})`, Math.abs(d) < .03 ? "down warn" : ""],
        ["Frais", `${W(b.fees)} payés + ${W(x.closeFee)}`],
        ["Ouverte depuis", since(now - t0)],
        ["Clôture", "quand tu veux"],
      ]} />
      {x.hit
        ? <p className="muted small">Seuil de liquidation touché, règlement en cours…</p>
        : <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onClose(b); setBusy(false) }}>Clôturer · {W(x.value)}</button>}
    </article>
  );
}
