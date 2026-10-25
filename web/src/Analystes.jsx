// Onglet Analystes du Marché : acheter un tuyau sur les prochains résultats d'une société, puis prendre position soi-même.
// Tout est décidé par le serveur (analyst_list, analyst_quote, rumor_buy, my_tuyaux) ; l'écran ne fait qu'afficher.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BY, STOCKS } from "../supabase/functions/_shared/aurelys.js";
import { W, sW } from "./format.js";
import { LANG, t } from "./i18n.js";
import { Loading } from "./nav.jsx";
import { PlayerAvatar } from "./avatars.jsx";
import { TkIcon } from "./logos.jsx";

const L = (o, k) => o[`${k}_${LANG}`] ?? o[`${k}_fr`];
const fig = v => v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1).replace(".", LANG === "en" ? "." : ",")} %`;
const left = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}` };
const SIDE = { up: "Au-dessus des attentes", down: "En dessous des attentes", flat: "Conforme aux attentes" };
const LEVELS = ["Le sens : au-dessus, en dessous ou conforme aux attentes.", "Le sens et une fourchette de 8 points.",
  "Le sens et une fourchette de 4 points.", "Le chiffre, à 1 point près.", "Le chiffre, à 0,5 point près."];
const BADGE = { nouveau: ["Nouveau", "flat"], forme: ["En forme", "up"], disgrace: ["En disgrâce : −30 %", "down"] };
const SORTS = [["value", "Meilleur rapport"], ["price", "Prix"], ["rate", "Réussite"], ["clients", "Clients de la semaine"]];
const covers = (a, tk) => !a.specialties.length || a.specialties.includes(tk);

export function Analysts({ api, data, mine, focus, onFocus, now, onPick, onDetail, reload }) {
  const [sort, setSort] = useState("value"), [open, setOpen] = useState(null);
  const list = useMemo(() => {
    const l = (data?.list ?? []).filter(a => !focus || covers(a, focus)), r = a => a.displayed_rate ?? .5;
    const by = { value: (a, b) => r(b) / b.base_price - r(a) / a.base_price, price: (a, b) => a.base_price - b.base_price,
      rate: (a, b) => r(b) - r(a), clients: (a, b) => b.weekly_clients - a.weekly_clients };
    return [...l].sort(by[sort]);
  }, [data, focus, sort]);
  if (!data) return <Loading size={40} />;
  const active = (mine ?? []).filter(x => !x.resolved), done = (mine ?? []).filter(x => x.resolved);
  return (
    <div className="ana">
      <p className="ana-band">{t("{n}/{m} tuyaux aujourd'hui · remise à zéro à minuit", { n: data.today, m: data.max })}</p>
      <div className="chips" role="group" aria-label="Trier les analystes">
        {SORTS.map(([k, l]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}
        {focus && <button type="button" aria-pressed="true" onClick={() => onFocus(null)} aria-label={t("Retirer le filtre {s}", { s: BY[focus]?.name ?? focus })}>{BY[focus]?.name ?? focus} ×</button>}
      </div>
      <div className="ana-list">{list.map(a => (
        <button key={a.id} type="button" className="ana-card" onClick={() => setOpen(a)}>
          <PlayerAvatar avatar={a.avatar} pseudo={L(a, "name")} size={48} />
          <span className="ana-b">
            <b>{L(a, "name")}</b>
            <small className="muted">{L(a, "bio")}</small>
            <span className="ana-sp">{a.specialties.length ? a.specialties.map(tk => <span key={tk} className="ana-tk"><TkIcon tk={tk} size={16} />{tk}</span>) : <span className="ana-tk">Toutes les sociétés</span>}</span>
            <span className="rtags">{a.badges.map(k => <span key={k} className={"rtag " + BADGE[k][1]}>{BADGE[k][0]}</span>)}</span>
          </span>
          <span className="ana-n">
            <b className="mono">{a.displayed_rate == null ? "—" : `${Math.round(100 * a.displayed_rate)} %`}</b>
            <small className="muted">{t("{n} résolus", { n: a.resolved_count })}</small>
            <small className="mono">{t("dès {w}", { w: W(a.base_price) })}</small>
          </span>
        </button>))}
      </div>
      {!list.length && <p className="muted small">Aucun analyste ne suit cette société.</p>}

      <section className="d-sec">
        <h2>Mes tuyaux</h2>
        {active.map(x => (
          <div key={x.id} className="tuyau">
            <TkIcon tk={x.tk} size={30} />
            <span className="tuyau-b"><b>{L(x, "text")}</b>
              <small className="muted">{t("Résultats dans {d} · consensus {c}", { d: left(Date.parse(x.deadline_at) - now), c: fig(x.cons) })}</small></span>
            <button type="button" className="btn" onClick={() => onDetail(x.tk)}>Voir</button>
          </div>))}
        {done.slice(0, 15).map(x => (
          <div key={x.id} className="tuyau">
            <TkIcon tk={x.tk} size={30} />
            <span className="tuyau-b"><b>{L(x, "text")}</b>
              <span className="rtags">
                <span className={"rtag " + (x.result === "correct" ? "up" : x.result === "wrong" ? "down" : "flat")}>{x.result === "correct" ? "Juste" : x.result === "wrong" ? "Faux" : "Sans suite, remboursé"}</span>
                {x.published != null && <span className="rtag flat">{t("Publié : {f}", { f: fig(x.published) })}</span>}
                {x.pnl != null && <span className={"rtag " + (x.pnl >= 0 ? "up" : "down")}>{t("Tes trades : {w}", { w: sW(x.pnl) })}</span>}
              </span></span>
            <small className="mono muted">{W(x.price_paid)}</small>
          </div>))}
        {!active.length && !done.length && <p className="muted small">Pas encore de tuyau. Un analyste annonce le chiffre des prochains résultats ; à toi de deviner comment le cours réagira.</p>}
      </section>
      <p className="fine">Un tuyau porte sur le chiffre publié aux prochains résultats, jamais sur le cours. Il peut être faux : chaque analyste a son taux de réussite public, sur ses 30 derniers tuyaux. Les W payés sont perdus, quel que soit le résultat.</p>
      {open && <BuySheet api={api} a={open} focus={focus} remaining={data.max - data.today} onClose={() => setOpen(null)} onPick={onPick} onDone={reload} />}
    </div>
  );
}

function BuySheet({ api, a, focus, onClose, onPick, onDone }) {
  const tks = STOCKS.map(s => s.tk).filter(tk => covers(a, tk));
  const [tk, setTk] = useState(focus && tks.includes(focus) ? focus : tks[0]), [level, setLevel] = useState(3), [q, setQ] = useState(null);
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(null), [got, setGot] = useState(null);
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onClose]);
  useEffect(() => { let on = true; setConfirm(false); api.analystQuote(a.id, tk, level).then(r => on && setQ(r)).catch(e => on && setErr(e.message)); return () => { on = false } }, [api, a.id, tk, level]);
  const buy = async () => {
    setBusy(true); setErr(null);
    try { setGot((await api.rumorBuy(a.id, tk, level)).rumor); onDone() } catch (e) { setErr(e.message); setConfirm(false) } finally { setBusy(false) }
  };
  return createPortal(
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ana-sheet" role="dialog" aria-modal="true" aria-label={t("Acheter un tuyau à {a}", { a: L(a, "name") })}>
        <div className="sheet-h"><span className="who"><PlayerAvatar avatar={a.avatar} pseudo={L(a, "name")} size={36} /><b>{L(a, "name")}</b></span>
          <button type="button" className="x" onClick={onClose} aria-label="Fermer">×</button></div>
        {got ? <>
          <p className="tuyau-big">{L(got, "text")}</p>
          <p className="muted small">{t("Jugé à la publication des résultats, dans {d}. Le cours, lui, peut réagir autrement.", { d: left(Date.parse(got.deadline_at) - Date.now()) })}</p>
          {got.direction === "flat"
            ? <button type="button" className="btn primary big" onClick={() => { onClose(); onPick(got.tk, null) }}>Voir la société</button>
            : <button type="button" className="btn primary big" onClick={() => { onClose(); onPick(got.tk, got.direction) }}>{got.direction === "up" ? "Prendre position ▲ Hausse" : "Prendre position ▼ Baisse"}</button>}
        </> : <>
          <label className="row"><span>Société</span>
            <select className="p-select" value={tk} onChange={e => setTk(e.target.value)} aria-label="Société">
              {tks.map(x => <option key={x} value={x}>{BY[x].name}</option>)}</select></label>
          <label className="ana-lvl"><span>{t("Précision {n}/5", { n: level })}</span>
            <input type="range" min="1" max="5" step="1" value={level} onChange={e => setLevel(+e.target.value)} aria-label="Précision du tuyau" /></label>
          <p className="small">{LEVELS[level - 1]}</p>
          {q?.reason && <p className="down small">{q.reason}{q.missing != null && " " + t("Il te manque {w}.", { w: W(q.missing) })}</p>}
          {err && <p className="down small">{err}</p>}
          <button type="button" className="btn primary big" disabled={!q?.allowed || busy} onClick={() => confirm ? buy() : setConfirm(true)}>
            {q?.price == null ? "…" : confirm ? t("Confirmer : {w} perdus quoi qu'il arrive", { w: W(q.price) }) : t("Acheter pour {w}", { w: W(q.price) })}</button>
          <p className="muted small">{t("Encore {n} aujourd'hui. Un seul tuyau en cours par société.", { n: q?.remaining_today ?? "—" })}</p>
        </>}
      </div>
    </div>,
    document.body
  );
}

// Pastille de l'onglet : un tuyau jugé depuis la dernière visite.
export const lastResolved = mine => Math.max(0, ...(mine ?? []).filter(x => x.resolved_at).map(x => Date.parse(x.resolved_at)));
