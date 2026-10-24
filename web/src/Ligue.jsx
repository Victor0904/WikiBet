// Ligue (H6) : ma division, mon groupe classé en direct, zones de montée et de descente, historique des saisons.
// Tout est décidé par le serveur (my_league) ; règles et récompenses : supabase/functions/_shared/progression.js.
import { useCallback, useEffect, useState } from "react";
import { DIVISIONS, ELIGIBLE_TRADES } from "../supabase/functions/_shared/progression.js";
import { W, pct, cls } from "./format.js";
import { LOCALE } from "./i18n.js";
import { Loading } from "./nav.jsx";

// Famille de la division (cadre de couleur, aussi autour de l'avatar en H2).
export const tierOf = d => ["bronze", "argent", "or", "platine", "diamant", "maitre"][Math.min(5, Math.floor(d / 3))];
export const DivBadge = ({ d, size = 56 }) => (
  <span className={"div-badge tier-" + tierOf(d)} style={{ width: size, height: size }} aria-hidden="true">
    <svg viewBox="0 0 24 24" width={size * .55} height={size * .55} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      {d >= 15 ? <path d="M3 18h18l-2-10-4.5 4L12 5l-2.5 7L5 8z" /> : <path d="M12 2 4 5v6c0 5 3.4 9.2 8 11 4.6-1.8 8-6 8-11V5z" />}
      {d < 15 && Array.from({ length: d % 3 + 1 }, (_, i) => <path key={i} d={`M8 ${9 + 3 * i}l4 2.5 4-2.5`} />)}
    </svg>
  </span>
);
const ZONE = { 2: ["z-promo2", "Montée de 2 divisions"], 1: ["z-promo", "Montée"], 0: ["z-stay", "Maintien"], [-1]: ["z-down", "Descente"] };
const left = s => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d} j ${h} h` : `${h} h ${String(m).padStart(2, "0")} min` };

export function League({ api, now, say }) {
  const [l, setL] = useState(null);
  const load = useCallback(() => api.myLeague().then(setL).catch(e => say(e.message, "down")), [api, say]);
  useEffect(() => { load(); const id = setInterval(() => { if (!document.hidden) load() }, 60000); return () => clearInterval(id) }, [load]);
  if (!l) return <Loading />;
  const g = l.group, el = l.trades >= ELIGIBLE_TRADES;
  return (
    <section className="league talents">
      <header className="lg-head">
        <DivBadge d={l.division} />
        <div><small className="muted">Ma division</small><b>{DIVISIONS[l.division]}</b>
          <small className="muted">{`Fin de la saison dans ${left(l.week_end - now / 1000)}`}</small></div>
      </header>
      <div className="plain">
        <div className="plain-row"><span>Trades valides cette semaine</span><span className={"mono " + (el ? "up" : "")}>{`${l.trades} / ${ELIGIBLE_TRADES}`}</span></div>
        <div className="plain-row"><span>Récompense de la division</span><span className="mono">{W(l.reward)}</span></div>
        {g && <div className="plain-row"><span>Mon rang</span><span className="mono">{`${g.members.find(m => m.me)?.rank} sur ${g.n}`}</span></div>}
      </div>
      <p className="muted small">{el ? "Tu peux monter et toucher la récompense de ta division lundi." : `Encore ${ELIGIBLE_TRADES - l.trades} trade${ELIGIBLE_TRADES - l.trades > 1 ? "s" : ""} valide${ELIGIBLE_TRADES - l.trades > 1 ? "s" : ""} (mise de 100 W ou plus, tenu 150 s) pour pouvoir monter et toucher la récompense.`}</p>

      {g ? <div className="ach-cat">
        <h3>{`Mon groupe, ${g.n} joueur${g.n > 1 ? "s" : ""}`}</h3>
        <div className="lg-legend">{[2, 1, 0, -1].map(z => <span key={z} className={"lg-z " + ZONE[z][0]}>{ZONE[z][1]}</span>)}</div>
        <div className="board">{g.members.map(m => (
          <div key={m.id} className={"brow lg-row " + ZONE[m.move][0] + (m.me ? " me" : "")}>
            <span className="rk mono">{m.rank}</span>
            <span><b>{m.pseudo}</b><small>{`${m.trades} trade${m.trades > 1 ? "s" : ""} valide${m.trades > 1 ? "s" : ""}`}</small></span>
            <span className={"r mono " + cls(m.ret)}>{pct(m.ret)}</span>
          </div>))}</div>
        <p className="muted small">Classement au rendement de la semaine : gain de trading (positions clôturées, et ouvertes au cours du moment) divisé par ton patrimoine de lundi, au moins 10 000 W. Petit groupe (moins de 10) : personne ne descend, seul le premier monte s'il y a 3 joueurs ou plus.</p>
      </div> : <p className="lg-empty">Clôture un trade valide pour entrer dans la saison : tu rejoindras un groupe de joueurs de ta division.</p>}

      {l.history.length > 0 && <div className="ach-cat">
        <h3>Saisons passées</h3>
        <div className="plain">{l.history.map(h => (
          <div key={h.week} className="plain-row"><span>{new Date(h.week + "T12:00:00").toLocaleDateString(LOCALE, { day: "numeric", month: "short" })}{" : "}{DIVISIONS[h.division]}{" → "}{DIVISIONS[h.after]}</span>
            <span className="mono">{`${h.rank}/${h.n}, ${pct(h.ret)}${h.reward ? ", " + W(h.reward) : ""}`}</span></div>))}</div>
      </div>}
    </section>
  );
}
