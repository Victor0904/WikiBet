// Logos des entreprises d'Aurelys, à part : la page d'accueil les affiche sans charger l'écran du marché.
import { BY } from "../supabase/functions/_shared/aurelys.js";

// Logos (blanc sur la couleur de l'entreprise, 24 × 24). Jeunes pousses : le logo de leur secteur.
const LS = { fill: "none", stroke: "#fff", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
const LOGOS = {
  NXR: <><path {...LS} d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" /><circle cx="12" cy="12" r="3" fill="#fff" /></>,
  PXF: <path fill="#fff" d="M4 4h6v6H4zM10 10h6v6h-6zM16 16h4v4h-4zM4 14h4v6H4z" />,
  OMB: <path fill="#fff" d="M15 3a9 9 0 1 0 6 14A7.5 7.5 0 0 1 15 3z" />,
  HLV: <path fill="#fff" d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6z" />,
  FRC: <path fill="#fff" d="M4 4h16v3.5h-6v9h6V20H4v-3.5h6v-9H4z" />,
  VLS: <><path {...LS} d="M3 6h4l5 10 5-10h4" /><path {...LS} d="M9 19h6" /></>,
  BCS: <path fill="#fff" d="M12 3 21 8v2H3V8zM5 11h3v6H5zM10.5 11h3v6h-3zM16 11h3v6h-3zM3 18h18v3H3z" />,
  MRV: <><path fill="#fff" d="M11 3v12H4zM13 6l6 9h-6z" /><path {...LS} d="M3 19c3 0 3-1.5 4.5-1.5S9 19 12 19s3-1.5 4.5-1.5S18 19 21 19" /></>,
  GTR: <><path {...LS} d="M12 21V9" /><path fill="#fff" d="M12 14C6 14 4 10 4 6c5 0 8 3 8 8zM12 11c0-5 3-8 8-8 0 4-2 8-8 8z" /></>,
  LMR: <><circle cx="12" cy="12" r="4.5" fill="#fff" /><path {...LS} d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  SLM: <><path fill="#fff" d="M12 2 19 9l-7 13L5 9z" /><path d="M5 9h14M12 2l-3 7 3 13 3-13z" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="1.2" /></>,
  KST: <path fill="#fff" d="M12 2c1 0 1.5 1 1.5 2.5V9l8 5v2l-8-2.5V18l2.5 2v1.5l-4-1-4 1V20l2.5-2v-4.5l-8 2.5v-2l8-5V4.5C10.5 3 11 2 12 2z" />,
  OND: <><path fill="#fff" d="M8 7.5v9l7.5-4.5z" /><path {...LS} d="M18 7a7 7 0 0 1 0 10M5.9 17a7 7 0 0 1 0-10" /></>,
};
const SECTOR_LOGO = { tech: "NXR", energie: "HLV", sante: "OMB", industrie: "FRC", finance: "BCS", conso: "LMR", matieres: "SLM", loisirs: "OND" };

export const TkIcon = ({ tk, size = 34 }) => {
  const logo = LOGOS[tk] ?? LOGOS[SECTOR_LOGO[BY[tk]?.sector]];
  return (
    <span className="coin-icon tk-icon" style={{ background: BY[tk]?.color ?? "var(--panel2)", width: size, height: size, fontSize: size * .3 }} aria-hidden="true">
      {logo ? <svg viewBox="0 0 24 24" width={size * .62} height={size * .62}>{logo}</svg> : tk}
    </span>
  );
};
