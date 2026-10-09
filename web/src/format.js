// Formats partagés par les écrans.
export const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
export const nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const W = v => nf0.format(Math.round(v)) + " W"; // espace insécable : « 10 000 W » ne se coupe pas
export const sW = v => { const r = Math.round(v); return (r >= 0 ? "+" : "−") + W(Math.abs(r)) }; // jamais « −0 W »
export const pct = v => { const r = Math.round(v * 10000) / 100; return (r > 0 ? "+" : r < 0 ? "−" : "") + nf2.format(Math.abs(r)) + " %" };
export const cls = v => v > 1e-9 ? "up" : v < -1e-9 ? "down" : "flat";
// Formateurs créés une fois : toLocaleTimeString en recrée un à chaque appel (12 fois plus lent).
const hhmm = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
export const clock = ms => Number.isFinite(+ms) ? hhmm.format(ms) : "—";

// QG : noms des logements (palier 0 = chambre offerte) et couleurs des thèmes.
export const HOME_NAMES = ["Chambre", "Studio", "Open space", "Loft", "Penthouse", "Villa", "Manoir", "Château", "Île privée"];
// Avantages durables du logement : jours d'historique des paris, alertes de prix sur Aurelys.
// pos : positions Aurelys ouvertes en même temps (aur_max_pos en SQL). Stop et objectif dès le loft (3), ordres à déclenchement au penthouse (4).
export const PERKS = [{ hist: 1, alerts: 1, pos: 3 }, { hist: 3, alerts: 2, pos: 5 }, { hist: 7, alerts: 3, pos: 8 }, { hist: 30, alerts: 5, pos: 12 }, { hist: 90, alerts: 10, pos: 20 },
  { hist: 180, alerts: 15, pos: 25 }, { hist: 365, alerts: 20, pos: 30 }, { hist: 730, alerts: 30, pos: 40 }, { hist: 1095, alerts: 50, pos: 50 }];
export const AUTO_LV = 3, TRIGGER_LV = 4;
export const THEMES = { theme_cyan: "#3CC8E6", theme_violet: "#A78BFA", theme_rose: "#F472B6", theme_or: "#E8C547" };
export const DEFAULT_ACCENT = "#F5B83D";
// Joueurs fictifs (profiles.bot), chargés au démarrage : toujours affichés comme tels.
export const BOTS = new Set();
export const CAP0_TXT = "10 000 W"; // capital de départ, pour les textes
