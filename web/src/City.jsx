// Ville de guilde : la 3D (chargée à la demande), le Trésor, le fonds d'investissement et les bâtiments publics.
import { useEffect, useRef, useState } from "react";
import { createCity } from "./qg/city.js";
import { W, nf0 } from "./format.js";
import { gameClock } from "../supabase/functions/_shared/aurelys.js";

const TIERS = [[250000, 100], [1000000, 250], [3000000, 500], [10000000, 1000]];

function Scene({ v, accent, now, onVisit }) {
  const ref = useRef(null), sc = useRef(null), [err, setErr] = useState(null), pick = useRef(onVisit);
  pick.current = onVisit;
  useEffect(() => { try { sc.current = createCity(ref.current, m => pick.current(m)) } catch (e) { setErr(e.message) } return () => sc.current?.dispose() }, []);
  const hour = gameClock(now / 1000).hour;
  useEffect(() => { sc.current?.update({ members: v.members, buildings: v.buildings, accent, hour }) }, [v, accent, hour]);
  return <div className="qg-scene city-scene" ref={ref}>{err && <p className="muted small pad">La 3D n'est pas disponible sur cet appareil.</p>}</div>;
}

export default function City({ api, guildId, me, mine, say, onVisit, accent }) {
  const [v, setV] = useState(null), [cat, setCat] = useState([]), [amt, setAmt] = useState(""), [now, setNow] = useState(Date.now());
  const load = () => api.cityView(guildId).then(setV).catch(e => say(e.message, "down"));
  useEffect(() => { load(); api.cityCatalog().then(setCat).catch(() => {}) }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(id) }, []);
  if (!v) return <p className="muted small">Chargement de la ville…</p>;
  const boss = v.owner === me.id, lv = id => v.buildings.find(b => b.id === id), mairie = lv("mairie")?.level ?? 0;
  const run = async (fn, ok) => { try { await fn(); say(ok, "up"); setAmt(""); load() } catch (e) { say(e.message, "down") } };
  const amount = Math.floor(Number(amt)), tier = [...TIERS].reverse().find(([s]) => v.fund >= s), next = TIERS.find(([s]) => v.fund < s);
  return (
    <div className="city">
      <Scene v={v} accent={accent} now={now} onVisit={onVisit} />
      <p className="muted small">Un immeuble par membre : son allure suit son logement. Touche-le pour visiter son QG. La nuit d'Aurelys, les fenêtres s'allument.</p>
      <div className="tiles">
        <div className="tile"><small>Trésor</small><b className="mono">{W(v.treasury)}</b><small>entretien {W(v.upkeep)} / jour</small></div>
        <div className="tile"><small>Fonds (placé sur l'AUR-12)</small><b className="mono">{W(v.fund)}</b><small>{tier ? `${tier[1]} W / jour par membre actif` : "pas encore de dividende"}</small></div>
      </div>
      {next && <p className="muted small">Prochain palier du fonds : {W(next[0])}, soit {W(next[1])} par jour pour chaque membre actif (un pari la veille, présent depuis 3 jours).</p>}
      {mine && <div className="add-row">
        <input inputMode="numeric" placeholder="Montant (100 W au moins)" value={amt} onChange={e => setAmt(e.target.value.replace(/\D/g, ""))} aria-label="Montant du don" />
        <button type="button" className="btn primary" disabled={!(amount >= 100)} onClick={() => run(() => api.cityGive(amount, "tresor"), `${W(amount)} donnés au Trésor`)}>Trésor</button>
        <button type="button" className="btn" disabled={!(amount >= 100)} onClick={() => run(() => api.cityGive(amount, "fonds"), `${W(amount)} placés dans le fonds`)}>Fonds</button>
      </div>}
      {mine && <p className="fine">Les dons ne reviennent pas : le Trésor paie la construction et l'entretien, le fonds suit la Bourse d'Aurelys et verse un dividende chaque nuit. Sans Trésor pour l'entretien, la ville s'endort (plus d'avantages) sans rien perdre.</p>}
      <h3 className="sec">Bâtiments publics</h3>
      <div className="shop">
        {cat.map(c => {
          const b = lv(c.id), level = b?.level ?? 0, cost = c.costs[level], blocked = c.id !== "mairie" && level + 1 > mairie;
          return (
            <article key={c.id} className={"item" + (level ? " owned" : "")}>
              <div className="item-h"><b>{c.name}</b><span className="mono">{level ? `niv. ${level}` : "à bâtir"}</span></div>
              <p className="muted small">{c.description}</p>
              {b?.asleep && <p className="small down">Endormi : le Trésor n'a pas pu payer l'entretien.</p>}
              {level < 3 && boss ? <button type="button" className="btn primary" disabled={blocked || v.treasury < cost}
                onClick={() => run(() => api.cityBuild(c.id), `${c.name} : niveau ${level + 1}`)}>{blocked ? "Mairie d'abord" : `${level ? "Agrandir" : "Bâtir"} · ${W(cost)}`}</button>
                : level < 3 ? <span className="muted small">Prochain niveau : {W(cost)} (décidé par le fondateur)</span> : <span className="muted small">Niveau maximal</span>}
            </article>
          );
        })}
      </div>
      {v.donors.length > 0 && <>
        <h3 className="sec">Mécènes</h3>
        <div className="board">{v.donors.map((d, i) => <div key={d.pseudo} className="brow"><span className="rk mono">{i + 1}</span><span><b>{d.pseudo}</b></span><span className="r mono">{W(d.total)}</span></div>)}</div>
      </>}
      <p className="fine">{v.members.length}/{v.cap} membres · la mairie ajoute 5 places par niveau. {nf0.format(v.buildings.length)} bâtiment{v.buildings.length > 1 ? "s" : ""} public{v.buildings.length > 1 ? "s" : ""}.</p>
    </div>
  );
}
