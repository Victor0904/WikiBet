// Navigation mobile : barre d'onglets flottante en verre (« liquid glass »), contrôle segmenté, en-tête de sous-page.
const ICONS = {
  market: <path d="M3 17l5-6 4 3 6-8 3 4" />,
  live: <><circle cx="12" cy="12" r="2.5" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" /></>,
  positions: <><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M3 12h18" /></>,
  qg: <><path d="M4 11l8-6 8 6v8.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19.5z" /><path d="M10 21v-5h4v5" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
};
export const Icon = ({ name }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;

export function Dock({ tab, setTab, badge }) {
  const items = [["market", "Marché"], ["live", "Live"], ["positions", "Positions"], ["qg", "QG"], ["more", "Plus"]];
  return (
    <nav className="dock" aria-label="Sections">
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
    <div className="seg top-seg" role="tablist" aria-label={label}>
      {options.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

export const SubHeader = ({ title, onBack }) => (
  <div className="subhead">
    <button type="button" className="back" onClick={onBack} aria-label="Retour">‹</button>
    <h2>{title}</h2>
  </div>
);
