// Onglet QG : la pièce en 3D et la boutique. Chargé à la demande (Three.js ne pèse que sur cet onglet).
import { useEffect, useMemo, useRef, useState } from "react";
import { createScene } from "./qg/scene.js";
import { W, nf0, clock, HOME_NAMES, PERKS, AUTO_LV, TRIGGER_LV } from "./format.js";

const SET_STREAM = ["ecran2", "ecran3", "micro", "camera", "chaise", "neon"];
const TABS = [["decor", "Déco"], ["home", "Logement"], ["cosmetic", "Style"], ["bonus", "Bonus"]];
const CATS = { theme: "Thème", title: "Titre", effect: "Effet de victoire" };

function Scene({ level, items, accent, pnl, trophies, souvenirs, live, onReady }) {
  const ref = useRef(null), sc = useRef(null), [err, setErr] = useState(null);
  useEffect(() => {
    try { sc.current = createScene(ref.current); onReady?.(sc.current) } catch (e) { setErr(e.message) }
    return () => sc.current?.dispose();
  }, []);
  useEffect(() => { sc.current?.update({ level, items, accent, pnl, trophies, souvenirs, ...live }) }, [level, items, accent, pnl, trophies, souvenirs, live]);
  return <div className="qg-scene" ref={ref}>{err && <p className="muted small pad">La 3D n'est pas disponible sur cet appareil.</p>}</div>;
}

// Bouton en deux temps pour les achats : un premier appui demande confirmation pendant 3 s.
function Confirm({ label, confirm, onClick, disabled, className = "btn primary" }) {
  const [armed, setArmed] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { if (!armed) return; const id = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(id) }, [armed]);
  return <button type="button" className={className} disabled={disabled || busy} onClick={async () => {
    if (!armed) return setArmed(true);
    setBusy(true); await onClick(); setBusy(false); setArmed(false);
  }}>{armed ? confirm : label}</button>;
}


// Mode photo : l'image du QG ou de la ville, à partager (ou à enregistrer si le partage n'est pas possible).
export async function sharePhoto(url, name) {
  try {
    const file = new File([await (await fetch(url)).blob()], `${name}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: name });
  } catch { /* partage annulé : on enregistre l'image */ }
  const a = document.createElement("a"); a.href = url; a.download = `${name}.png`; a.click();
}

export default function QG({ api, catalog, inv, me, owner, self, patrimoine, openStake, pnl, accent, act, onBack, live }) {
  const [tab, setTab] = useState("decor"), [troph, setTroph] = useState([]);
  const uid = self ? me?.id : owner?.id;
  useEffect(() => { if (uid) api.trophies(uid).then(setTroph).catch(() => {}) }, [api, uid]);
  const wall = useMemo(() => troph.filter(t => t.got).map(t => ({ name: t.name, detail: t.detail })), [troph]);
  const [souv, setSouv] = useState(null), scn = useRef(null);
  useEffect(() => { if (uid) api.souvenirs(uid).then(setSouv).catch(() => {}) }, [api, uid]);
  const owned = id => (inv[id]?.qty ?? 0) > 0;
  const level = Math.max(0, ...catalog.filter(i => i.kind === "home" && owned(i.id)).map(i => i.level));
  const decor = catalog.filter(i => i.kind === "decor" && owned(i.id)).map(i => i.id);
  const resale = catalog.filter(i => (i.kind === "decor" || i.kind === "cosmetic") && owned(i.id)).reduce((a, i) => a + Math.floor(i.price * .6), 0);
  const homes = catalog.filter(i => i.kind === "home" && owned(i.id)).reduce((a, i) => a + Math.floor(i.price * .6), 0);
  const next = catalog.find(i => i.kind === "home" && i.level === level + 1);
  const setDone = SET_STREAM.filter(owned).length;
  const boost = me?.salary_boost_until && Date.parse(me.salary_boost_until) > Date.now() ? Date.parse(me.salary_boost_until) : null;

  return (
    <section className="qg">
      <div className="qg-head">
        <div>
          {!self && <button type="button" className="btn small-btn" onClick={onBack}>← Mon QG</button>}
          <h2>{self ? "Mon QG" : `QG de ${owner.pseudo}`} <span className="muted">{HOME_NAMES[level]}</span></h2>
          {owner.title && <p className="title-tag">{owner.title}</p>}
        </div>
        {patrimoine != null && <div className="r mono"><b className="big-num">{W(patrimoine)}</b><small>patrimoine</small></div>}
      </div>
      {self && <p className="muted small">Solde {W(me.cash)} · positions {W(openStake)} · objets revendables {W(resale)} · logements {W(homes)} (ne se revendent pas, comptés à 60 % au classement)</p>}

      <Scene level={level} items={decor} accent={accent} pnl={self ? pnl : null} trophies={wall} souvenirs={souv} live={self ? live : null} onReady={s => { scn.current = s }} />
      <button type="button" className="btn ghost photo-btn" onClick={() => scn.current && sharePhoto(scn.current.snapshot(`${self ? "Mon QG" : `Le QG de ${owner.pseudo}`} sur Aurelys`), "QG Aurelys")}>📷 Photo</button>

      <div className="qg-badges">
        <span className={"badge" + (setDone === SET_STREAM.length ? " done" : "")}>Setup streamer {setDone}/{SET_STREAM.length}</span>
        <span className="badge">{decor.length} objet{decor.length > 1 ? "s" : ""} de déco</span>
        {boost && <span className="badge done">Salaire doublé jusqu'à {clock(boost)}</span>}
      </div>

      {troph.length > 0 && <div className="panel trophies">
        <h2>Trophées <span className="muted">{troph.filter(t => t.got).length}/{troph.length}</span></h2>
        <div className="troph-grid">
          {troph.map(t => <div key={t.id} className={"troph" + (t.got ? " got" : "")} title={t.how}><b>{t.got ? "★" : "☆"} {t.name}</b><small>{t.got ? t.detail ?? t.how : t.how}</small></div>)}
        </div>
      </div>}

      {self && <div className="panel perks">
        <b>Avantages de ton logement</b>
        <p className="muted small">{PERKS[level].pos} positions ouvertes en même temps · historique de tes paris sur {PERKS[level].hist} jour{PERKS[level].hist > 1 ? "s" : ""} · {PERKS[level].alerts} alerte{PERKS[level].alerts > 1 ? "s" : ""} de prix sur Aurelys{level >= AUTO_LV ? " · stop et objectif automatiques" : ""}{level >= TRIGGER_LV ? " · ordres à déclenchement" : ""}.</p>
        {next && <p className="muted small">{next.name} : {PERKS[level + 1].pos} positions, {PERKS[level + 1].hist} jours d'historique, {PERKS[level + 1].alerts} alertes{level + 1 === AUTO_LV ? ", stop et objectif automatiques sur tes positions" : ""}{level + 1 === TRIGGER_LV ? ", ordres à déclenchement (ouvrir quand le cours atteint un seuil)" : ""}.</p>}
      </div>}

      {self && next && (
        <div className="panel next-home">
          <div><b>Prochain logement : {next.name}</b><p className="muted small">{next.description}</p>
            <span className="bar"><i style={{ width: `${Math.min(100, me.cash / next.price * 100)}%` }} /></span>
            <small className="muted mono">{W(Math.min(me.cash, next.price))} / {W(next.price)}</small></div>
          <Confirm label={`Emménager · ${W(next.price)}`} confirm="Confirmer le déménagement ?" disabled={me.cash < next.price}
            onClick={() => act(() => api.buyItem(next.id), () => `Emménagement réussi : ${next.name} !`)} />
        </div>
      )}

      {self && <>
        <nav className="tabs" aria-label="Boutique">
          {TABS.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </nav>
        <div className="shop">
          {catalog.filter(i => i.kind === tab).map(it => {
            const has = owned(it.id), qty = inv[it.id]?.qty ?? 0, locked = it.kind !== "home" && it.level > level;
            const resale = Math.floor(it.price * .6), equipped = inv[it.id]?.equipped;
            let action;
            if (it.kind === "home") action = has ? <span className="muted small">{it.level === level ? "Ton logement" : "Déjà habité"}</span>
              : it.level === level + 1 ? <Confirm label={`Emménager · ${W(it.price)}`} confirm="Confirmer ?" disabled={me.cash < it.price} onClick={() => act(() => api.buyItem(it.id), () => `Emménagement réussi : ${it.name} !`)} />
              : <span className="muted small">Après {HOME_NAMES[it.level - 1]}</span>;
            else if (locked) action = <span className="muted small">À partir du logement {HOME_NAMES[it.level]}</span>;
            else if (it.kind === "bonus") action = <div className="item-acts">
              {qty > 0 && it.id === "salaire_x2" && <button type="button" className="btn" onClick={() => act(() => api.useBonus(it.id), () => "Salaire doublé pendant 1 h")}>Activer</button>}
              <Confirm label={`Acheter · ${W(it.price)}`} confirm="Confirmer ?" disabled={me.cash < it.price} onClick={() => act(() => api.buyItem(it.id), () => `${it.name} ajouté`)} />
            </div>;
            else if (has) action = <div className="item-acts">
              {it.kind === "cosmetic" && (equipped
                ? <button type="button" className="btn" onClick={() => act(() => api.unequip(it.category), () => `${CATS[it.category]} retiré`)}>Retirer</button>
                : <button type="button" className="btn" onClick={() => act(() => api.equipItem(it.id), () => `${it.name} équipé`)}>Équiper</button>)}
              <Confirm className="btn" label={`Revendre · ${W(resale)}`} confirm="Confirmer la revente ?" onClick={() => act(() => api.sellItem(it.id), () => `${it.name} revendu ${W(resale)}`)} />
            </div>;
            else action = <Confirm label={`Acheter · ${W(it.price)}`} confirm="Confirmer ?" disabled={me.cash < it.price} onClick={() => act(() => api.buyItem(it.id), () => `${it.name} acheté`)} />;
            return (
              <article key={it.id} className={"item" + (has && it.kind !== "bonus" ? " owned" : "") + (locked ? " locked" : "")}>
                <div className="item-h"><b>{it.name}</b><span className="mono">{W(it.price)}</span></div>
                <p className="muted small">{it.kind === "cosmetic" ? `${CATS[it.category]} · ` : ""}{it.description}</p>
                {it.kind === "bonus" && qty > 0 && <p className="small">En stock : <b className="mono">{nf0.format(qty)}</b></p>}
                {has && it.kind === "cosmetic" && equipped && <p className="small accent">Équipé</p>}
                {action}
              </article>
            );
          })}
        </div>
        <p className="fine">Les objets survivent à une faillite et comptent dans ton patrimoine pour 60 % de leur prix, leur valeur de revente. Les logements et les bonus ne se revendent pas. Les W ne s'achètent pas : tout se gagne en jouant.</p>
      </>}
    </section>
  );
}
