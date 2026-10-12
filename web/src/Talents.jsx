// Arbre de talents : 4 branches, points gagnés par le gain net de trading (niveau) et les succès. Les règles et les effets
// sont dans la base (migration 20261027200000_talents.sql) ; cet écran ne fait qu'afficher et demander.
// Mobile d'abord : une branche à la fois (onglets, glisser à gauche ou à droite), une carte par talent. Dès 900 px : 4 colonnes.
import { useEffect, useRef, useState } from "react";
import { W } from "./format.js";
import { Segmented } from "./nav.jsx";

const RENTE = [10, 20, 30, 50, 70, 100];
const ULT_MIN = 10; // points dans la branche pour son talent ultime (talent_buy)
export const TREE = [
  { key: "prudence", name: "Prudence", items: [
    { code: "amort", name: "Amortisseur", max: 5, fx: r => `Une liquidation par jour te rend ${3 * r} % de sa mise (1 500 W au plus)` },
    { code: "frais", name: "Frais réduits", max: 5, fx: r => `Frais d'ouverture et de clôture −${5 * r} %` },
    { code: "sangfroid", name: "Sang-froid", max: 1, fx: () => "Alerte quand une position ne vaut plus que 40 % de sa mise (au lieu de 25 %)" },
    { code: "filet", name: "Filet", max: 1, fx: () => "Stop sur tes positions, sans le loft" },
    { code: "phenix", name: "Phénix", max: 1, ult: true, fx: () => "Après une faillite, tu repars à 15 000 W au lieu de 10 000 W (une fois par semaine)" },
  ] },
  { key: "rente", name: "Rente", items: [
    { code: "passif", name: "Argent passif", max: 6, fx: r => `${RENTE[r - 1]} W par jour, si tu es venu dans les dernières 24 h` },
    { code: "dividendes", name: "Dividendes", max: 5, fx: r => `Dividendes de tes actions +${5 * r} %` },
    { code: "negociateur", name: "Négociateur", max: 5, fx: r => `Prix de la boutique du QG −${3 * r} %` },
    { code: "fidelite", name: "Fidélité", max: 5, fx: r => `Salaire +${5 * r} % (jusqu'à ${W(500 * (1 + .05 * r))} par séance)` },
    { code: "rentier", name: "Rentier", max: 1, ult: true, fx: () => "Argent passif doublé le lendemain d'une position clôturée en gain" },
  ] },
  { key: "info", name: "Information", items: [
    { code: "avant", name: "Avant-première", max: 3, fx: r => `Actualités ${[3, 6, 10][r - 1]} s avant les autres` },
    { code: "flair", name: "Flair", max: 3, fx: r => `Indice « crédible » ou « douteuse » sur les rumeurs en cours, juste ${[60, 65, 70][r - 1]} fois sur 100` },
    { code: "archiviste", name: "Archiviste", max: 3, fx: r => `${2 * r} alertes de prix en plus` },
    { code: "analyste", name: "Analyste", max: 2, fx: r => r === 1 ? "Courbe MACD sur la fiche d'une action" : "MACD, et repérage des cassures et doubles sommets ou creux" },
    { code: "initie", name: "Initié", max: 1, ult: true, fx: () => "Tu vois les révisions des analystes 1 h d'Aurelys (2 min 30) avant tout le monde" },
  ] },
  { key: "audace", name: "Audace", items: [
    { code: "multitache", name: "Multitâche", max: 3, fx: r => `${r} position${r > 1 ? "s" : ""} de plus en même temps` },
    { code: "discretion", name: "Discrétion", max: 4, fx: r => `Tes ordres font bouger le cours ${String(2.5 * r).replace(".", ",")} % de moins` },
    { code: "calibre", name: "Gros calibre", max: 3, fx: r => `Tu peux engager ${10 * r} % de plus par action` },
    { code: "timing", name: "Timing", max: 1, fx: () => "Stop et objectif exécutés au cours exact qui les touche" },
    { code: "kraken", name: "Kraken", max: 1, ult: true, fx: () => "Un ordre par jour d'Aurelys (1 h) sans faire bouger le cours" },
  ] },
];
const BY_CODE = Object.fromEntries(TREE.flatMap(b => b.items.map(t => [t.code, t])));

const ICON = {
  prudence: "M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z",
  rente: "M12 4c4 0 7 1.3 7 3s-3 3-7 3-7-1.3-7-3 3-3 7-3zM5 7v5c0 1.7 3 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3 3 7 3s7-1.3 7-3v-5",
  info: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  audace: "M13 2 4 14h7l-1 8 9-12h-7z",
  ult: "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
};
const Icon = ({ k }) => <svg className="tal-ico" viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[k]} /></svg>;

// Rangs : pastilles pleines ou vides (lisibles sans la couleur).
const Pips = ({ r, max }) => (
  <span className="pips" role="img" aria-label={`Rang ${r} sur ${max}`}>
    {Array.from({ length: max }, (_, i) => <i key={i} className={i < r ? "full" : ""} />)}
  </span>
);

function TalentCard({ t, branch, r, state, spent, onPlus }) {
  const why = { max: "Max atteint", nopoint: "Pas de point disponible", locked: `Prérequis : ${ULT_MIN} points en ${branch.name}` }[state];
  return (
    <article className={"tal-card" + (t.ult ? " ult" : "") + (r ? " on" : "")}>
      <div className="tal-card-h">
        <Icon k={t.ult ? "ult" : branch.key} />
        <b>{t.name}</b>
        <Pips r={r} max={t.max} />
      </div>
      {t.ult && <p className="tal-ult-tag">Talent ultime</p>}
      <p><span className="muted">Actuel : </span>{r ? t.fx(r) : "rien pour l'instant"}</p>
      {r < t.max && <p><span className="muted">Prochain rang : </span>{t.fx(r + 1)}</p>}
      {t.ult && state === "locked" && <div className="tal-gauge">
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={ULT_MIN} aria-valuenow={spent} aria-label={`Points investis en ${branch.name}`}><i style={{ width: `${100 * Math.min(1, spent / ULT_MIN)}%` }} /></div>
        <small className="mono">{spent} / {ULT_MIN} points investis dans la branche</small>
      </div>}
      <button type="button" className={"btn tal-plus" + (state === "ok" ? " primary" : "")} disabled={state !== "ok"} onClick={onPlus}>{state === "ok" ? "+1 point" : why}</button>
    </article>
  );
}

const WIDE = "(min-width: 900px)";
function useWide() {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => { const m = matchMedia(WIDE), f = () => setWide(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f) }, []);
  return wide;
}
const KEY = "wb-talents-branche";

export function Talents({ api, tal, setTal, say }) {
  const wide = useWide();
  const [branch, setBranch] = useState(() => { try { return TREE.some(b => b.key === localStorage.getItem(KEY)) ? localStorage.getItem(KEY) : "prudence" } catch { return "prudence" } });
  const [ask, setAsk] = useState(null), [busy, setBusy] = useState(false), [menu, setMenu] = useState(false), [view, setView] = useState("tree"), touch = useRef(null);
  useEffect(() => { api.myTalents?.().then(setTal).catch(() => {}) }, [api, setTal]); // à jour à chaque ouverture
  if (!tal) return <p className="muted pad">Chargement…</p>;
  if (tal.bot) return <p className="muted pad">Les joueurs fictifs n'ont pas de talents.</p>;
  if (view === "succes") return <Achievements api={api} onBack={() => setView("tree")} />;

  const pick = k => { setBranch(k); try { localStorage.setItem(KEY, k) } catch { } };
  const ranks = tal.ranks ?? {}, spentAll = Number(tal.spent), free = tal.level + Number(tal.ach) - spentAll;
  const inBranch = b => b.items.filter(t => !t.ult).reduce((a, t) => a + (ranks[t.code] ?? 0), 0);
  const stateOf = (t, b) => (ranks[t.code] ?? 0) >= t.max ? "max" : t.ult && inBranch(b) < ULT_MIN ? "locked" : free < 1 ? "nopoint" : "ok";
  const step = tal.next - tal.from, done = Math.max(0, tal.hwm - tal.from);
  const act = async (fn, msg) => { setBusy(true); try { setTal(await fn()); say(msg, "up") } catch (e) { say(e.message, "down") } setBusy(false); setAsk(null) };
  const column = b => (
    <div key={b.key} className="tal-col">
      {wide && <h2><span><Icon k={b.key} /> {b.name}</span><small className="mono">{inBranch(b)} pts</small></h2>}
      {b.items.map(t => <TalentCard key={t.code} t={t} branch={b} r={ranks[t.code] ?? 0} state={stateOf(t, b)} spent={inBranch(b)} onPlus={() => setAsk(t.code)} />)}
    </div>
  );
  // Glisser à gauche ou à droite : branche suivante ou précédente (mobile).
  const swipe = {
    onTouchStart: e => { touch.current = [e.touches[0].clientX, e.touches[0].clientY] },
    onTouchEnd: e => {
      const s = touch.current; touch.current = null; if (!s || wide) return;
      const dx = e.changedTouches[0].clientX - s[0], dy = e.changedTouches[0].clientY - s[1];
      if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return;
      const j = TREE.findIndex(b => b.key === branch) + (dx < 0 ? 1 : -1);
      if (TREE[j]) pick(TREE[j].key);
    },
  };
  const cur = ask && ask !== "reset" ? BY_CODE[ask] : null, r0 = cur ? ranks[ask] ?? 0 : 0;
  return (
    <section className="talents">
      <header className="tal-head panel">
        <div className="tal-head-row">
          <span className="tal-lv"><small>Niveau</small><b className="mono">{tal.level}</b></span>
          <span className={"tal-pts" + (free > 0 ? " on" : "")}><b className="mono">{free}</b> point{free > 1 ? "s" : ""} à dépenser</span>
          <span className="tal-more">
            <button type="button" className="tal-dots" aria-label="Autres actions" aria-expanded={menu} onClick={() => setMenu(m => !m)}>⋯</button>
            {menu && <span className="tal-menu" role="menu">
              <button type="button" role="menuitem" disabled={!spentAll} onClick={() => { setMenu(false); setAsk("reset") }}>
                Réinitialiser mes talents · {tal.reset_cost ? W(tal.reset_cost) : "gratuit (une fois)"}</button>
            </span>}
          </span>
        </div>
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={step} aria-valuenow={done} aria-label="Vers le niveau suivant"><i style={{ width: `${Math.min(100, 100 * done / step)}%` }} /></div>
        <small className="mono muted">{W(done)} / {W(step)} vers le niveau {tal.level + 1}</small>
      </header>
      <button type="button" className="tal-ach" onClick={() => setView("succes")}>
        <span>Points gagnés via succès : <b className="mono">{Number(tal.ach)}</b></span><span className="accent-txt">→ voir</span>
      </button>
      {!wide && <Segmented className="tal-tabs" label="Branche" value={branch} onChange={pick}
        options={TREE.map(b => [b.key, <span key={b.key} className="tal-tab"><span><Icon k={b.key} /> <b className="mono">{inBranch(b)}</b></span><small>{b.name}</small></span>])} />}
      <div className={wide ? "tal-grid" : "tal-list"} {...swipe}>
        {wide ? TREE.map(column) : column(TREE.find(b => b.key === branch))}
      </div>
      <p className="muted small">Un niveau par palier de gain net de trading (positions Aurelys tenues au moins 150 s, frais déduits) : 2 500 W jusqu'au niveau 5, 5 000 W jusqu'au 15, puis 10 000 W. Ton record compte : perdre ne fait pas perdre de niveau, mais il faut regagner ses pertes avant de progresser.</p>

      {ask && <div className="scrim" onClick={e => e.target === e.currentTarget && setAsk(null)}>
        <div className="sheet tal-sheet" role="dialog" aria-modal="true" aria-labelledby="tal-sheet-t">
          {cur ? <>
            <h2 id="tal-sheet-t">{cur.name}</h2>
            <p className="muted small">Rang {r0} → {r0 + 1} sur {cur.max}</p>
            <div className="tal-recap">
              <div><small className="muted">Avant</small><span>{r0 ? cur.fx(r0) : "rien"}</span></div>
              <div><small className="muted">Après</small><span>{cur.fx(r0 + 1)}</span></div>
              <div><small className="muted">Points à dépenser</small><span className="mono">{free} → {free - 1}</span></div>
            </div>
            <div className="sheet-acts">
              <button type="button" className="btn primary big" disabled={busy} onClick={() => act(() => api.talentBuy(ask), `${cur.name} : rang ${r0 + 1}`)}>Confirmer</button>
              <button type="button" className="btn big" onClick={() => setAsk(null)}>Annuler</button>
            </div>
          </> : <>
            <h2 id="tal-sheet-t">Réinitialiser tes talents ?</h2>
            <div className="tal-recap">
              <div><small className="muted">Points récupérés</small><span className="mono">{spentAll}</span></div>
              <div><small className="muted">Coût</small><span>{tal.reset_cost ? W(tal.reset_cost) : "gratuit (la première fois), puis 5 000 W"}</span></div>
            </div>
            <div className="sheet-acts">
              <button type="button" className="btn primary big" disabled={busy} onClick={() => act(() => api.talentReset(), "Talents réinitialisés.")}>Confirmer</button>
              <button type="button" className="btn big" onClick={() => setAsk(null)}>Annuler</button>
            </div>
          </>}
        </div>
      </div>}
    </section>
  );
}

// Succès : 2e source de points de talent (1, 2 ou 3 points selon la difficulté).
function Achievements({ api, onBack }) {
  const [list, setList] = useState(null);
  useEffect(() => { api.achievements?.().then(setList).catch(() => setList([])) }, [api]);
  return (
    <section className="talents">
      <button type="button" className="link" onClick={onBack}>‹ Talents</button>
      <h2>Succès</h2>
      {list === null ? <p className="muted">Chargement…</p> : !list.length ? <p className="muted">La liste des succès arrive bientôt. Chacun rapportera 1, 2 ou 3 points de talent.</p>
        : list.map(a => (
          <article key={a.code} className={"tal-card" + (a.got ? " on" : "")}>
            <div className="tal-card-h"><Icon k="ult" /><b>{a.name}</b><span className="mono">{a.points} pt{a.points > 1 ? "s" : ""}</span></div>
            <p>{a.descr}</p>
            <p className={a.got ? "up" : "muted"}>{a.got ? "✓ Obtenu" : "○ Pas encore"}</p>
          </article>
        ))}
    </section>
  );
}
