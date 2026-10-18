// Quêtes du jour et de la semaine, série, pari du jour, niveau de trader. Tout est décidé par le serveur (my_quests,
// my_pari, pari_vote) ; l'écran relit toutes les 30 s. Textes et paliers : supabase/functions/_shared/progression.js.
import { useCallback, useEffect, useState } from "react";
import { QUEST_BY, unlocksAt } from "../supabase/functions/_shared/progression.js";
import { BY } from "../supabase/functions/_shared/aurelys.js";
import { pct } from "./format.js";
import { t as tr } from "./i18n.js";
import { Loading } from "./nav.jsx";
import { px as aurPx } from "./AurelysUI.jsx";

const left = s => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d} j ${h} h` : `${h} h ${String(m).padStart(2, "0")} min` };
const Bar = ({ cur, goal, label }) => (
  <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={cur} aria-label={label}><i style={{ width: `${100 * Math.min(1, cur / goal)}%` }} /></div>
);

export function Quests({ api, now, say }) {
  const [q, setQ] = useState(null), [pari, setPari] = useState(undefined);
  const load = useCallback(() => {
    api.myQuests().then(setQ).catch(e => say(e.message, "down"));
    api.myPari().then(setPari).catch(() => setPari(null));
  }, [api, say]);
  useEffect(() => { load(); const id = setInterval(() => { if (!document.hidden) load() }, 30000); return () => clearInterval(id) }, [load]);
  if (!q) return <Loading />;
  const t = now / 1000, next = unlocksAt(q.level + 1);
  const list = period => q.quests.filter(x => x.period === period);
  const item = x => (
    <div key={x.code} className={"quest" + (x.done ? " done" : "")}>
      <span className="ach-ico" aria-hidden="true">{x.done ? "✓" : ""}</span>
      <div className="quest-b">
        <div className="ach-h"><b>{QUEST_BY[x.code]?.text ?? x.code}</b><span className="xp-tag mono">+{x.xp} XP</span></div>
        {x.done ? <small className="up">Réussie</small> : <span className="q-prog"><Bar cur={x.cur} goal={x.goal} label={`Progression : ${QUEST_BY[x.code]?.text ?? x.code}`} /><small className="mono muted">{`${x.cur} / ${x.goal}`}</small></span>}
      </div>
    </div>
  );
  return (
    <section className="quests talents">
      <header className="quest-head">
        <div className="quest-lv"><span><small>Niveau de trader</small><b className="mono">{q.level}</b></span>
          <span className="streak"><small>Série</small><b className="mono">{`${q.streak} jour${q.streak > 1 ? "s" : ""}`}</b></span></div>
        {q.next != null && <><Bar cur={q.xp - q.from} goal={q.next - q.from} label="Vers le niveau suivant" />
          <small className="mono muted">{`${q.xp - q.from} / ${q.next - q.from} XP vers le niveau ${q.level + 1}`}</small></>}
        {next.length > 0 && <p className="small">{tr("Au niveau {n} : {list}.", { n: q.level + 1, list: next.map(x => tr(x)).join(", ") })}</p>}
        <p className="muted small">L'XP vient des quêtes, de la série et du pari du jour, jamais de tes gains. Série : un jour sans quête est pardonné chaque semaine ; bonus à 3, 7 et 30 jours.</p>
      </header>
      <Pari api={api} pari={pari} t={t} say={say} onDone={load} />
      <div className="ach-cat">
        <h3>Quêtes du jour <small className="muted">{`· nouvelles dans ${left(q.day_end - t)}`}</small></h3>
        <div className="q-list">{list("day").map(item)}</div>
      </div>
      <div className="ach-cat">
        <h3>Quêtes de la semaine <small className="muted">{`· nouvelles dans ${left(q.week_end - t)}`}</small></h3>
        <div className="q-list">{list("week").map(item)}</div>
        {q.chest && <p className="small accent">Coffre de la semaine gagné : il s'ouvrira avec les profils, bientôt.</p>}
      </div>
    </section>
  );
}

// Pari du jour : gratuit, une réponse, XP seulement. La répartition des votes n'apparaît qu'après avoir voté.
function Pari({ api, pari, t, say, onDone }) {
  const [busy, setBusy] = useState(false);
  if (pari === undefined) return null;
  if (!pari) return <div className="panel pari"><b>Pari du jour</b><p className="muted small">Il ouvre chaque jour à 8 h.</p></div>;
  const name = tk => BY[tk]?.name ?? tk, open = pari.status === "open" && t < pari.open_until && !pari.mine;
  const total = pari.dist ? Object.values(pari.dist).reduce((a, n) => a + +n, 0) : 0, share = k => total ? `${Math.round(100 * (+pari.dist[k] || 0) / total)} %` : "";
  const answers = pari.kind === "A" ? [["up", "▲ Plus haut"], ["down", "▼ Plus bas"]] : pari.tks.map(tk => [tk, name(tk)]);
  const vote = async c => { setBusy(true); try { await api.pariVote(c); say("Vote enregistré : +10 XP.", "up"); onDone() } catch (e) { say(e.message, "down") } setBusy(false) };
  const res = pari.mine?.result;
  return (
    <div className="panel pari">
      <div className="ach-h"><b>Pari du jour</b><span className="xp-tag mono">XP seulement</span></div>
      <p>{pari.kind === "A" ? tr("{n} sera-t-elle plus haute à 20 h qu'au moment de ton vote ?", { n: name(pari.tks[0]) })
        : tr("Qui fera la plus forte hausse d'ici 20 h : {list} ?", { list: pari.tks.map(name).join(", ") })}</p>
      <div className="seg" role="group" aria-label="Ta réponse">
        {answers.map(([k, l]) => <button key={k} type="button" disabled={!open || busy} aria-pressed={pari.mine?.choice === k} onClick={() => vote(k)}>{l}{pari.dist ? ` · ${share(k)}` : ""}</button>)}
      </div>
      {pari.mine ? <p className="small">{tr("Ton vote : {a}, au cours de {p}.", { a: tr(answers.find(([k]) => k === pari.mine.choice)?.[1] ?? ""), p: pari.tks.map(tk => `${name(tk)} ${aurPx(pari.mine.ref[tk])}`).join(", ") })}{" "}
          <span>{res === "right" ? "Juste : +25 XP." : res === "wrong" ? "Raté, ce sera pour demain." : res === "void" ? "Annulé (écart trop faible ou cours indisponible), sans pénalité." : "Résultat à 20 h."}</span></p>
        : <p className="muted small">{t < pari.open_until ? "Vote jusqu'à 14 h, une seule fois." : "Les votes sont clos (14 h)."}</p>}
      {pari.status === "resolved" && pari.px && <p className="small mono">{tr("À 20 h : {list}", { list: pari.tks.map(tk => `${name(tk)} ${aurPx(pari.px[tk])}${pari.mine ? ` (${pct(pari.px[tk] / pari.mine.ref[tk] - 1)})` : ""}`).join(", ") })}</p>}
      <p className="muted small">{`+10 XP pour voter, +25 si c'est juste, +40 toutes les 3 bonnes réponses d'affilée (tu en es à ${pari.run}).`}</p>
    </div>
  );
}
