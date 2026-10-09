// Navigation mobile : barre d'onglets flottante en verre (« liquid glass »), contrôle segmenté, en-tête de sous-page.
const ICONS = {
  market: <path d="M3 17l5-6 4 3 6-8 3 4" />,
  actions: <><path d="M6 4v16M12 7v13M18 3v14" /><rect x="4" y="8" width="4" height="7" rx="1" /><rect x="10" y="10" width="4" height="6" rx="1" /><rect x="16" y="6" width="4" height="6" rx="1" /></>,
  positions: <><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M3 12h18" /></>,
  qg: <><path d="M4 11l8-6 8 6v8.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19.5z" /><path d="M10 21v-5h4v5" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
};
export const Icon = ({ name }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;

export function Dock({ tab, setTab, badge }) {
  const items = [["market", "Marché"], ["actions", "Actions"], ["positions", "Positions"], ["qg", "QG"], ["more", "Plus"]];
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

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="seg top-seg" role="tablist" aria-label={label} style={{ "--n": options.length }}>
      <span className="lens" style={{ "--i": Math.max(0, options.findIndex(([k]) => k === value)) }} aria-hidden="true" />
      {options.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

// Logo d'Aurelys : un A dont la barre est une courbe qui monte (même dessin que l'icône du site, public/favicon.svg).
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
    <button type="button" className="back" onClick={onBack} aria-label="Retour">‹</button>
    <h2>{title}</h2>
  </div>
);
