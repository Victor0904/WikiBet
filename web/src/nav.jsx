// Navigation mobile : barre d'onglets flottante en verre (« liquid glass »), contrôle segmenté, en-tête de sous-page.
import { useEffect, useRef, useState } from "react";
import { LANG, setLang } from "./i18n.js";
const ICONS = {
  market: <path d="M3 17l5-6 4 3 6-8 3 4" />,
  actions: <><path d="M6 4v16M12 7v13M18 3v14" /><rect x="4" y="8" width="4" height="7" rx="1" /><rect x="10" y="10" width="4" height="6" rx="1" /><rect x="16" y="6" width="4" height="6" rx="1" /></>,
  positions: <><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M3 12h18" /></>,
  guild: <><path d="M5 21V4M5 4h11l-2 3.5L16 11H5" /><path d="M3 21h6" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
};
export const Icon = ({ name }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;

export function Dock({ tab, setTab, badge }) {
  const items = [["market", "Marché"], ["actions", "Actions"], ["positions", "Positions"], ["guild", "Guilde"], ["more", "Plus"]];
  const i = items.findIndex(([k]) => k === tab);
  return (
    <nav className="dock" aria-label="Sections">
      {i >= 0 && <span className="lens" style={{ "--i": i }} aria-hidden="true" />}
      {items.map(([k, l]) => (
        <button key={k} type="button" aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>
          <Icon name={k} /><span>{l}</span>
          {k === "positions" && badge > 0 && <i className="dot-badge">{badge}</i>}
        </button>
      ))}
    </nav>
  );
}

export function Segmented({ value, onChange, options, label, className = "" }) {
  return (
    <div className={"seg top-seg " + className} role="tablist" aria-label={label} style={{ "--n": options.length }}>
      <span className="lens" style={{ "--i": Math.max(0, options.findIndex(([k]) => k === value)) }} aria-hidden="true" />
      {options.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

// Logo d'Aurelys : un A dont la barre est une courbe qui monte (même dessin que l'icône du site, public/favicon.svg).
// Logo animé pendant un chargement : un trait (et sa traîne) fait l'aller-retour sur le A, la courbe se dessine puis
// s'efface comme un cours qui monte ; la boucle ne saute jamais (le parcours du A revient à son départ, la courbe est
// invisible au début et à la fin du cycle). Quand c'est prêt (loading faux ou isComplete), le A et la courbe se
// dessinent en entier et le logo apparaît. Couleurs : currentColor pour le A, --logo-curve pour la courbe.
const LOGO_A = "M14 50 32 13 50 50", LOGO_CURVE = "M20 39 27 34 33 37 44 28", LOGO_TRACE = LOGO_A + LOGO_CURVE;
const LOGO_LOOP = "M14 50 32 13 50 50 32 13 14 50"; // aller-retour : la fin rejoint le début
const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches } catch { return false } };
export function LogoLoader({ loading = true, isComplete = false, size = 64, strokeWidth = 5, loopDurationSeconds = 2.4, fillFadeSeconds = .45, className = "", ariaLabel = "Chargement…", onDone }) {
  const [phase, setPhase] = useState(() => reducedMotion() ? "done" : "loop"); // loop → closingOutline → fadingFill → done
  const ready = !loading || isComplete, called = useRef(false), CLOSE = 500;
  useEffect(() => {
    if (phase === "loop" && ready) setPhase("closingOutline");
    // Minuteries plutôt que les événements d'animation SVG (pas toujours émis).
    if (phase === "closingOutline") { const id = setTimeout(() => setPhase("fadingFill"), CLOSE); return () => clearTimeout(id) }
    if (phase === "fadingFill") { const id = setTimeout(() => setPhase("done"), fillFadeSeconds * 1000); return () => clearTimeout(id) }
    if (phase === "done" && ready && !called.current) { called.current = true; onDone?.() }
  }, [phase, ready, fillFadeSeconds, onDone]);
  const line = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <svg role="status" aria-label={ariaLabel} viewBox="8 7 48 48" width={size} height={size} className={"logo-loader " + className}>
      <path d={LOGO_TRACE} {...line} stroke="currentColor" strokeWidth={Math.max(1, strokeWidth / 2)} opacity=".18" />
      {phase === "loop" && <>
        {/* traîne pâle puis tête du trait, qui finissent au même point */}
        <path d={LOGO_LOOP} {...line} stroke="currentColor" strokeWidth={strokeWidth} pathLength={1} strokeDasharray="0.26 0.74" opacity=".35"
          style={{ animation: `logo-trace-trail ${loopDurationSeconds}s linear infinite` }} />
        <path d={LOGO_LOOP} {...line} stroke="currentColor" strokeWidth={strokeWidth} pathLength={1} strokeDasharray="0.12 0.88"
          style={{ animation: `logo-trace-loop ${loopDurationSeconds}s linear infinite` }} />
        <path d={LOGO_CURVE} {...line} stroke="var(--logo-curve, currentColor)" strokeWidth={strokeWidth * .7} pathLength={1} strokeDasharray="1 1.2"
          style={{ animation: `logo-curve-pulse ${loopDurationSeconds}s ease-in-out infinite` }} />
      </>}
      {phase === "closingOutline" && <>
        <path d={LOGO_A} {...line} stroke="currentColor" strokeWidth={strokeWidth} pathLength={1} strokeDasharray="1 1"
          style={{ animation: `logo-trace-close ${CLOSE}ms ease-out forwards` }} />
        <path d={LOGO_CURVE} {...line} stroke="var(--logo-curve, currentColor)" strokeWidth={strokeWidth * .7} pathLength={1} strokeDasharray="1 1"
          style={{ animation: `logo-trace-close ${CLOSE}ms ease-out ${CLOSE / 3}ms backwards` }} />
      </>}
      {(phase === "fadingFill" || phase === "done") && <g style={phase === "fadingFill" ? { animation: `logo-trace-fill ${fillFadeSeconds}s ease-out backwards` } : null}>
        <path d={LOGO_A} {...line} stroke="currentColor" strokeWidth="6.5" />
        <path d={LOGO_CURVE} {...line} stroke="var(--logo-curve, currentColor)" strokeWidth="4" />
      </g>}
    </svg>
  );
}
// Chargement d'un écran ou d'un bloc : le logo animé, centré.
export const Loading = ({ label = "Chargement…", size = 56 }) => <div className="loading-box"><LogoLoader size={size} ariaLabel={label} /></div>;

export const Logo = ({ big }) => (
  <span className={"logo" + (big ? " big" : "")}>
    <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#0F1117" />
      <path d="M14 50 32 13 50 50" fill="none" stroke="var(--accent)" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 39 27 34 33 37 44 28" fill="none" stroke="var(--up)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    Aurelys
  </span>
);

export const SubHeader = ({ title, onBack }) => (
  <div className="subhead">
    {onBack && <button type="button" className="back" onClick={onBack} aria-label="Retour">‹</button>}
    <h2>{title}</h2>
  </div>
);

// Langue : deux petits drapeaux, français et anglais (le choix recharge la page, gardé dans le navigateur).
const FLAGS = {
  fr: <><rect width="10" height="20" fill="#0055A4" /><rect x="10" width="10" height="20" fill="#fff" /><rect x="20" width="10" height="20" fill="#EF4135" /></>,
  en: <><rect width="30" height="20" fill="#012169" /><path d="M0 0l30 20M30 0L0 20" stroke="#fff" strokeWidth="4" /><path d="M0 0l30 20M30 0L0 20" stroke="#C8102E" strokeWidth="1.6" />
    <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" /><path d="M15 0v20M0 10h30" stroke="#C8102E" strokeWidth="3.4" /></>,
};
export function LangSwitch() {
  return (
    <span className="lang" role="group" aria-label="Langue / Language" translate="no">
      {[["fr", "Français"], ["en", "English"]].map(([l, name]) => (
        <button key={l} type="button" aria-pressed={LANG === l} aria-label={name} title={name} onClick={() => LANG !== l && setLang(l)}>
          <svg viewBox="0 0 30 20" width="22" height="15" aria-hidden="true">{FLAGS[l]}</svg>
        </button>))}
    </span>
  );
}
