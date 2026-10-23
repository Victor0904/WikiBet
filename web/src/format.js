// Formats partagés par les écrans (à l'anglaise si le joueur a choisi l'anglais).
import { LOCALE } from "./i18n.js";
export const nf0 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
export const nf2 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const W = v => nf0.format(Math.round(v)) + " W"; // espace insécable : « 10 000 W » ne se coupe pas
export const sW = v => { const r = Math.round(v); return (r >= 0 ? "+" : "−") + W(Math.abs(r)) }; // jamais « −0 W »
export const pct = v => { const r = Math.round(v * 10000) / 100; return (r > 0 ? "+" : r < 0 ? "−" : "") + nf2.format(Math.abs(r)) + " %" };
export const cls = v => v > 1e-9 ? "up" : v < -1e-9 ? "down" : "flat";
// Formateurs créés une fois : toLocaleTimeString en recrée un à chaque appel (12 fois plus lent).
const hhmm = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });
export const clock = ms => Number.isFinite(+ms) ? hhmm.format(ms) : "—";

// Pour tous jusqu'aux niveaux de trader (H3) : jours d'historique des paris, alertes de prix sur Aurelys (gardées dans
// le navigateur), positions Aurelys ouvertes en même temps (aur_max_pos en SQL, relu par my_terms).
export const HIST_DAYS = 30, ALERTS_MAX = 5, MAX_POS = 12;
// Joueurs fictifs (profiles.bot), chargés au démarrage : toujours affichés comme tels.
export const BOTS = new Set();
// Compte supprimé : session et réglages du jeu effacés de ce navigateur (la langue reste), retour à l'accueil avec un message.
export function leaveDeleted() {
  try { for (const k of Object.keys(localStorage)) if (/^(sb-|wb-)/.test(k) && k !== "wb-lang") localStorage.removeItem(k); sessionStorage.clear() } catch { }
  location.replace("/?compte=supprime");
}
export const CAP0_TXT = "10 000 W"; // capital de départ, pour les textes
