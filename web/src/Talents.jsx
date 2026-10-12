// Arbre de talents : 4 branches, points gagnés par le gain net de trading (niveau) et les succès. Les règles et les effets
// sont dans la base (migration 20261027200000_talents.sql) ; cet écran ne fait qu'afficher et demander.
import { useState } from "react";
import { W } from "./format.js";

const RENTE = [10, 20, 30, 50, 70, 100];
export const TREE = [
  { key: "prudence", name: "Prudence", items: [
    { code: "amort", name: "Amortisseur", max: 5, fx: r => `Une liquidation par jour rend ${3 * r} % de sa mise (1 500 W au plus)` },
    { code: "frais", name: "Frais réduits", max: 5, fx: r => `Frais −${5 * r} %` },
    { code: "sangfroid", name: "Sang-froid", max: 1, fx: () => "Alerte de liquidation dès 40 % de la mise" },
    { code: "filet", name: "Filet", max: 1, fx: () => "Stop sur une position, sans le loft" },
    { code: "phenix", name: "Phénix", max: 1, ult: true, fx: () => "Après une faillite, repartir à 15 000 W (une fois par semaine)" },
  ] },
  { key: "rente", name: "Rente", items: [
    { code: "passif", name: "Argent passif", max: 6, fx: r => `${RENTE[r - 1]} W par jour, si tu es venu dans les dernières 24 h` },
    { code: "dividendes", name: "Dividendes", max: 5, fx: r => `Dividendes +${5 * r} %` },
    { code: "negociateur", name: "Négociateur", max: 5, fx: r => `Boutique du QG −${3 * r} %` },
    { code: "fidelite", name: "Fidélité", max: 5, fx: r => `Salaire +${5 * r} %` },
    { code: "rentier", name: "Rentier", max: 1, ult: true, fx: () => "Rente doublée le lendemain d'une position gagnante" },
  ] },
  { key: "info", name: "Information", items: [
    { code: "avant", name: "Avant-première", max: 3, fx: r => `Actualités ${[3, 6, 10][r - 1]} s plus tôt` },
    { code: "flair", name: "Flair", max: 3, fx: r => `Fiabilité des rumeurs en cours, juste ${[60, 65, 70][r - 1]} % du temps` },
    { code: "archiviste", name: "Archiviste", max: 3, fx: r => `+${2 * r} alertes de prix` },
    { code: "analyste", name: "Analyste", max: 2, fx: r => r === 1 ? "MACD sur la fiche" : "MACD et détection des figures" },
    { code: "initie", name: "Initié", max: 1, ult: true, fx: () => "Révisions du consensus 1 h d'Aurelys avant tout le monde" },
  ] },
  { key: "audace", name: "Audace", items: [
    { code: "multitache", name: "Multitâche", max: 3, fx: r => `+${r} position${r > 1 ? "s" : ""} en même temps` },
    { code: "discretion", name: "Discrétion", max: 4, fx: r => `Impact de tes ordres −${String(2.5 * r).replace(".", ",")} %` },
    { code: "calibre", name: "Gros calibre", max: 3, fx: r => `Plafond par action +${10 * r} %` },
    { code: "timing", name: "Timing", max: 1, fx: () => "Stop et objectif exécutés au cours qui les touche" },
    { code: "kraken", name: "Kraken", max: 1, ult: true, fx: () => "Un ordre sans impact par jour d'Aurelys" },
  ] },
];
const BY_CODE = Object.fromEntries(TREE.flatMap(b => b.items.map(t => [t.code, { ...t, branch: b }])));

export function Talents({ api, tal, setTal, say, onBack }) {
  const [ask, setAsk] = useState(null), [busy, setBusy] = useState(false);
  if (!tal) return <p className="muted pad">Chargement…</p>;
  if (tal.bot) return <p className="muted pad">Les joueurs fictifs n'ont pas de talents.</p>;
  const ranks = tal.ranks ?? {}, free = tal.level + Number(tal.ach) - Number(tal.spent);
  const inBranch = b => b.items.filter(t => !t.ult).reduce((a, t) => a + (ranks[t.code] ?? 0), 0);
  const step = tal.next - tal.from, done = Math.max(0, tal.hwm - tal.from);
  const act = async (fn, msg) => { setBusy(true); try { setTal(await fn()); say(msg, "up") } catch (e) { say(e.message, "down") } setBusy(false); setAsk(null) };
  return (
    <section className="talents">
      {onBack && <button type="button" className="link" onClick={onBack}>‹ Retour</button>}
      <div className="panel tal-head">
        <div className="tal-lv"><small>Niveau</small><b className="mono">{tal.level}</b></div>
        <div className="tal-prog">
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={step} aria-valuenow={done} aria-label="Vers le niveau suivant"><i style={{ width: `${Math.min(100, 100 * done / step)}%` }} /></div>
          <small className="mono">{W(done)} / {W(step)} vers le niveau {tal.level + 1}</small>
        </div>
        <div className="tal-lv"><small>Points</small><b className="mono">{free}</b></div>
      </div>
      <p className="muted small">Un niveau par palier de gain net de trading (positions Aurelys tenues au moins 150 s, frais déduits) : 2 500 W jusqu'au niveau 5, 5 000 W jusqu'au 15, puis 10 000 W. Ton record compte : perdre ne fait pas perdre de niveau, mais il faut regagner ses pertes avant de progresser. Les succès donnent aussi des points{Number(tal.ach) ? ` (${tal.ach} pour l'instant)` : ""}.</p>
      <div className="tal-tree">
        {TREE.map(b => (
          <div key={b.key} className="tal-col">
            <h2>{b.name} <small className="muted mono">{inBranch(b)}</small></h2>
            {b.items.map(t => {
              const r = ranks[t.code] ?? 0, maxed = r >= t.max, locked = t.ult && inBranch(b) < 10;
              return (
                <button key={t.code} type="button" className={"tal" + (t.ult ? " ult" : "") + (r ? " on" : "")} disabled={busy || maxed || locked || free < 1}
                  onClick={() => setAsk(t.code)} aria-label={`${t.name}, rang ${r} sur ${t.max}`}>
                  <span className="tal-h"><b>{t.name}</b><span className="mono">{r}/{t.max}</span></span>
                  <small>{r ? t.fx(r) : "Pas encore appris"}</small>
                  {!maxed && <small className="muted">{locked ? `Ultime : 10 points dans la branche (${inBranch(b)}/10)` : `Rang suivant : ${t.fx(r + 1)}`}</small>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <button type="button" className="btn" disabled={busy || !Number(tal.spent)} onClick={() => setAsk("reset")}>
        Réinitialiser mes talents · {tal.reset_cost ? W(tal.reset_cost) : "gratuit (une fois)"}
      </button>
      {ask && <div className="scrim" onClick={e => e.target === e.currentTarget && setAsk(null)}>
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Confirmer">
          {ask === "reset" ? <>
            <b>Réinitialiser tous tes talents ?</b>
            <p className="muted small">Tu récupères tes {tal.spent} points. {tal.reset_cost ? `Coût : ${W(tal.reset_cost)}.` : "La première fois est gratuite, ensuite 5 000 W."}</p>
            <button type="button" className="btn primary big" disabled={busy} onClick={() => act(() => api.talentReset(), "Talents réinitialisés.")}>Réinitialiser</button>
          </> : <>
            <b>{BY_CODE[ask].name} · rang {(ranks[ask] ?? 0) + 1}</b>
            <p className="small">{BY_CODE[ask].fx((ranks[ask] ?? 0) + 1)}</p>
            <p className="muted small">Dépenser 1 point ({free} disponible{free > 1 ? "s" : ""}) ?</p>
            <button type="button" className="btn primary big" disabled={busy} onClick={() => act(() => api.talentBuy(ask), `${BY_CODE[ask].name} : rang ${(ranks[ask] ?? 0) + 1}`)}>Dépenser 1 point</button>
          </>}
          <button type="button" className="btn" onClick={() => setAsk(null)}>Annuler</button>
        </div>
      </div>}
    </section>
  );
}
