// Avatars (H2) : 32 dessins originaux au trait (viewBox 24 × 24), sur 12 couleurs de fond. Pas d'envoi de photo ; la base
// ne garde que « code:couleur » (profiles.avatar). Le catalogue et ses règles de déblocage sont aussi dans la migration
// 20261030000000_profil.sql (avatar_defs) : tests/profil.test.js vérifie que les deux disent la même chose.
// Famille de la division (cadre de couleur de la ligue).
export const tierOf = d => ["bronze", "argent", "or", "platine", "diamant", "maitre"][Math.min(5, Math.floor(d / 3))];

// [code, déblocage, valeur, tracés]
export const AVATARS = [
  ["taureau", "free", null, ["M7 10c-3 0-4-3-4-5 1 2 3 3 5 3", "M17 10c3 0 4-3 4-5-1 2-3 3-5 3", "M8 8h8l1 5c0 4-2 7-5 7s-5-3-5-7z", "M10 17h4"]],
  ["ours", "free", null, ["M7 7a2.5 2.5 0 1 1 3-1.5", "M17 7a2.5 2.5 0 1 0-3-1.5", "M12 6c-4 0-7 3-7 7s3 7 7 7 7-3 7-7-3-7-7-7z", "M10 15.5c1 1 3 1 4 0", "M12 13v1"]],
  ["faucon", "free", null, ["M4 12c3-6 9-8 16-6-3 1-4 3-4 5 0 4-3 8-8 9 2-3 2-6 0-8z", "M14 8h.01"]],
  ["renard", "free", null, ["M4 4l4 5h8l4-5v7c0 5-4 9-8 9s-8-4-8-9z", "M9 13h.01", "M15 13h.01", "M11 17h2"]],
  ["hibou", "free", null, ["M5 6l3 2h8l3-2v9c0 4-3 6-7 6s-7-2-7-6z", "M7 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0", "M13 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0", "M11.5 15.5l.5 1 .5-1"]],
  ["loup", "free", null, ["M5 3l3 6h8l3-6 1 9-8 9-8-9z", "M9 12h.01", "M15 12h.01", "M10.5 16h3"]],
  ["tortue", "free", null, ["M4 15c0-5 3.5-8 8-8s8 3 8 8z", "M8 15l2-4h4l2 4", "M20 13h2", "M6 15v3", "M18 15v3"]],
  ["chat", "free", null, ["M5 4l3 4h8l3-4v9c0 4-3 7-7 7s-7-3-7-7z", "M9.5 12v1", "M14.5 12v1", "M12 15l-1 1m1-1 1 1", "M3 15h4M17 15h4"]],
  ["cerf", "free", null, ["M8 3v3L5 8M8 6l3 1M16 3v3l3 2M16 6l-3 1", "M9 9h6l1 6-4 6-4-6z"]],
  ["carpe", "free", null, ["M3 12c3-5 9-6 13-3l5-3-2 6 2 6-5-3c-4 3-10 2-13-3z", "M8 11h.01"]],
  ["requin", "level", 5, ["M2 15c4-1 7-1 10 0s6 1 10 0", "M7 14l5-9 2 9", "M2 19c4-1 7-1 10 0s6 1 10 0"]],
  ["pieuvre", "level", 10, ["M6 11a6 6 0 1 1 12 0v3", "M6 11v3c0 2-2 3-3 5M9 14c0 3-1 5-2 6M12 14v7M15 14c0 3 1 5 2 6M18 14c0 2 2 3 3 5", "M10 9h.01M14 9h.01"]],
  ["robot", "level", 15, ["M6 8h12v10H6z", "M12 4v4", "M9 12h.01M15 12h.01", "M10 15h4", "M4 12v3M20 12v3"]],
  ["abeille", "level", 20, ["M8 9h8a4 4 0 0 1 0 8H8a4 4 0 0 1 0-8z", "M11 9v8M14 9v8", "M9 9C7 5 4 5 4 7s3 2 5 2M15 9c2-4 5-4 5-2s-3 2-5 2"]],
  ["astronaute", "level", 25, ["M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M8 9h8v3a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z", "M7 17l-1 4h12l-1-4"]],
  ["phenix", "level", 40, ["M12 21c-4-3-7-7-7-11 3 1 5 3 5 5 0-4 1-8 2-11 1 3 2 7 2 11 0-2 2-4 5-5 0 4-3 8-7 11z"]],
  ["comete", "level", 50, ["M17 7a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", "M14 9 3 4M13 12H2M14 15l-10 5"]],
  ["lion", "div", 3, ["M12 4l2 2 3-1v3l3 1-2 3 2 3-3 1v3l-3-1-2 2-2-2-3 1v-3l-3-1 2-3-2-3 3-1V5l3 1z", "M10 11h.01M14 11h.01", "M11 14h2"]],
  ["aigle", "div", 6, ["M2 9c4 0 7 2 10 5 3-3 6-5 10-5-2 3-5 4-7 4l-3 7-3-7c-2 0-5-1-7-4z", "M12 6v2"]],
  ["licorne", "div", 9, ["M14 3l-1 6", "M8 21l1-6-3-3 2-4 5-1 4 3v4l-3 1 1 6"]],
  ["cristal", "div", 12, ["M7 3h10l4 6-9 12L3 9z", "M3 9h18M12 21 8 9l4-6 4 6z"]],
  ["couronne", "div", 15, ["M3 18h18l-2-10-4.5 4L12 5l-2.5 7L5 8z", "M3 21h18"]],
  ["fusee", "ach", "DOUBLE_PROMO", ["M12 2c4 3 5 8 3 13H9C7 10 8 5 12 2z", "M12 9h.01", "M9 15l-3 3 1-5M15 15l3 3-1-5", "M11 18l1 4 1-4"]],
  ["eclair", "ach", "SERIE_10", ["M13 2 4 14h7l-1 8 9-12h-7z"]],
  ["diamant", "ach", "GAIN_1M", ["M6 4h12l3 5-9 11L3 9z", "M3 9h18"]],
  ["boussole", "ach", "TOUS_SECTEURS", ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M15.5 8.5l-2 5-5 2 2-5z"]],
  ["lune", "ach", "NOCTAMBULE", ["M20 15A8 8 0 1 1 9 4a6 6 0 0 0 11 11z"]],
  ["baleine", "chest", null, ["M2 13c0-4 4-6 9-6s8 3 8 6l3-3v6l-3-2c0 3-4 5-9 5s-8-2-8-6z", "M7 11h.01", "M10 3c0 2 1 3 1 4M13 3c0 2-1 3-1 4"]],
  ["colibri", "chest", null, ["M3 6l9 5", "M12 11c2-4 6-6 9-5-1 3-3 5-6 6l-2 8-3-6z", "M8 13 5 18"]],
  ["cameleon", "chest", null, ["M4 14c0-5 4-8 9-8 4 0 7 3 7 6s-2 4-4 4c-1 0-2-1-2-2s1-2 2-2", "M4 14c0 3 2 5 5 5", "M9 19v2M13 18v3", "M8 10h.01"]],
  ["scarabee", "chest", null, ["M12 6c-3 0-5 3-5 7s2 7 5 7 5-3 5-7-2-7-5-7z", "M12 6v14", "M10 6 8 3M14 6l2-3", "M7 11H4M7 15H4M17 11h3M17 15h3"]],
  ["lynx", "chest", null, ["M5 3l3 5h8l3-5v10c0 4-3 8-7 8s-7-4-7-8z", "M9 12h.01M15 12h.01", "M10 16l2 1 2-1", "M5 15l-3 1M19 15l3 1"]],
];
const BY = Object.fromEntries(AVATARS.map(a => [a[0], a[3]]));
export const COLORS = ["#F5B83D", "#1FCB8B", "#F04B5C", "#8DB5FF", "#E07CF2", "#6FD3C3", "#C98A55", "#B9C3CE", "#FF8A3D", "#9B8CFF", "#4FC3F7", "#D4E157"];
const initials = p => (p ?? "?").split(/[\s._-]+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";

// avatar : « code:couleur » ou rien (initiales) ; division : cadre de la ligue (anneau de couleur), sinon pas de cadre.
export function PlayerAvatar({ avatar, pseudo, size = 40, division = null }) {
  const [code, c] = (avatar ?? "").split(":"), d = BY[code], bg = COLORS[+c] ?? COLORS[0];
  const inner = d
    ? <svg viewBox="0 0 24 24" width={size * .62} height={size * .62} fill="none" stroke="#0B0C10" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d.map((p, i) => <path key={i} d={p} />)}</svg>
    : <span style={{ fontSize: size * .38 }}>{initials(pseudo)}</span>;
  return (
    <span className={"pav" + (division != null ? " framed tier-" + tierOf(division) : "")} style={{ width: size, height: size, background: d ? bg : undefined }} aria-hidden="true">{inner}</span>
  );
}
