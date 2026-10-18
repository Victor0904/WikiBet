// Succès (trophées). Tout est décidé par le serveur (my_achievements) ; les secrets restent « ??? » avec leur indice
// jusqu'au déblocage. Ils rapportaient des points de talent ; ils rapporteront de l'XP de trader (H8).
import { LOCALE } from "./i18n.js";
import { useEffect, useState } from "react";
import { W } from "./format.js";
import { Loading } from "./nav.jsx";

const amount = (v, unit) => unit === "W" ? W(v) : `${Math.floor(v)}${unit ? " " + unit : ""}`;
export function Achievements({ api }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.myAchievements?.().then(setData).catch(() => setData({ list: [], total: 0 })) }, [api]);
  if (!data) return <Loading />;
  const got = data.list.filter(a => a.at).length, cats = [...new Set(data.list.map(a => a.cat))];
  return (
    <section className="talents">
      <header className="panel ach-head">
        <h2>Succès</h2>
        <p className="mono">{got} / {data.total} succès</p>
      </header>
      {cats.map(c => (
        <div key={c} className="ach-cat">
          <h3>{c}</h3>
          {data.list.filter(a => a.cat === c).map(a => {
            const done = !!a.at, bar = !done && a.goal && a.cur != null;
            return (
              <article key={a.code} className={"ach" + (done ? " done" : "")}>
                <span className="ach-ico" aria-hidden="true">{done ? "★" : a.secret ? "?" : "☆"}</span>
                <div className="ach-b">
                  <div className="ach-h"><b>{a.name}</b></div>
                  <p>{a.descr ?? <>Indice : « {a.hint} »</>}</p>
                  {bar && <div className="tal-gauge">
                    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={a.goal} aria-valuenow={Math.min(a.cur, a.goal)} aria-label={`Progression : ${a.name}`}><i style={{ width: `${100 * Math.min(1, a.cur / a.goal)}%` }} /></div>
                    <small className="mono">{amount(Math.min(a.cur, a.goal), a.unit === "W" ? "W" : null)} / {amount(a.goal, a.unit)}</small>
                  </div>}
                  {done && <small className="ach-date">Débloqué le {new Date(a.at).toLocaleDateString(LOCALE)}</small>}
                </div>
              </article>
            );
          })}
        </div>
      ))}
    </section>
  );
}
