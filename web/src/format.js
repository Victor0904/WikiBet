// Formats partagés par les écrans.
export const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
export const nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const W = v => nf0.format(Math.round(v)) + " W"; // espace insécable : « 10 000 W » ne se coupe pas
export const sW = v => { const r = Math.round(v); return (r >= 0 ? "+" : "−") + W(Math.abs(r)) }; // jamais « −0 W »
export const pct = v => { const r = Math.round(v * 10000) / 100; return (r > 0 ? "+" : r < 0 ? "−" : "") + nf2.format(Math.abs(r)) + " %" };
export const cls = v => v > 1e-9 ? "up" : v < -1e-9 ? "down" : "flat";
export const clock = ms => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

// QG : noms des logements (palier 0 = chambre offerte) et couleurs des thèmes.
export const HOME_NAMES = ["Chambre", "Studio", "Open space", "Loft", "Penthouse"];
// Avantages durables du logement : jours d'historique des paris, alertes de prix sur Aurelys.
export const PERKS = [{ hist: 1, alerts: 1 }, { hist: 3, alerts: 2 }, { hist: 7, alerts: 3 }, { hist: 30, alerts: 5 }, { hist: 90, alerts: 10 }];
export const THEMES = { theme_cyan: "#3CC8E6", theme_violet: "#A78BFA", theme_rose: "#F472B6", theme_or: "#E8C547" };
export const DEFAULT_ACCENT = "#F5B83D";
export const CAP0_TXT = "10 000 W"; // capital de départ, pour les textes
