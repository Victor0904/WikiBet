import { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from "react";
import data from "./pageviews.json";
import { createEngine, tradeValue, liqPrice, LEVS, BK_LIMIT, CAP0, EPOCH, CYCLE_MS } from "./engine.js";
import { connect } from "./api.js";
import { TradeChart, PositionChart, Spark } from "./charts.jsx";
import { nf0, nf2, W, sW, clock, HOME_NAMES, THEMES, DEFAULT_ACCENT } from "./format.js";
import { Dock, Segmented, SubHeader } from "./nav.jsx";
import { MoreMenu, HowTo, Account, Legal } from "./pages.jsx";
const QG = lazy(() => import("./QG.jsx")); // Three.js n'est chargé qu'à l'ouverture du QG

/* ===== Formats ===== */
const pct = v => (v > 0 ? "+" : v < 0 ? "−" : "") + nf2.format(Math.abs(v * 100)) + " %";
const cls = v => v > 1e-9 ? "up" : v < -1e-9 ? "down" : "flat";
const hhmm = t => { const m = 540 + t; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0") };
// Une séance se nomme par son heure de début réelle (« séance de 14:32 »), plus parlante que son numéro.
const sessName = k => { const d = new Date(EPOCH + k * CYCLE_MS), t = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `séance de ${t}` : `séance du ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${t}` };
const STREAM_H = { "15": "15 min", "60": "1 h", live: "fin du live" };
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") };

// État d'une position à la minute courante, calculé comme le serveur (liquidation comprise).
function liveTrade(engine, b, s) {
  const p = engine.pathOf(b.tk, b.day), upto = b.session < s.k || !s.playing ? b.end_tick : Math.min(s.t, b.end_tick);
  for (let i = b.start_tick + 1; i <= upto; i++) if (tradeValue(b, p[i]) <= 0) return { value: 0, px: p[i], upto: i, liquidated: true, due: true };
  return { value: tradeValue(b, p[upto]), px: p[upto], upto, liquidated: false, due: upto >= b.end_tick };
}

// État d'une position sur un streamer d'après les relevés reçus (le serveur fait foi pour le règlement).
function liveStream(b, st, now) {
  const t0 = Date.parse(b.created_at), end = b.end_at ? Date.parse(b.end_at) : null, upto = Math.min(now, end ?? now);
  const pts = [[t0, b.entry]];
  if (st) st.ts.forEach((t, i) => { if (t > t0 && t <= upto) pts.push([t, st.vs[i]]) });
  for (const [, v] of pts.slice(1)) if (tradeValue(b, v) <= 0) return { value: 0, px: v, pts, liquidated: true, due: true };
  const px = pts[pts.length - 1][1];
  return { value: tradeValue(b, px), px, pts, liquidated: false, due: (end != null && now >= end) || (!!st && !st.live) };
}
// Instant du chiffre Twitch affiché : dernier relevé où le nombre a changé (Twitch le met à jour toutes les 1 à 3 min).
function twitchAt(x) { let t = x.ts[0] ?? Date.parse(x.at); for (let i = 1; i < x.vs.length; i++) if (x.vs[i] !== x.vs[i - 1]) t = x.ts[i]; return t }
const ago = ms => { const sec = Math.max(0, Math.round(ms / 1000)); return sec < 60 ? `il y a ${sec} s` : `il y a ${Math.floor(sec / 60)} min` };
// Sources des questions en direct : chaînes Twitch et jeux Steam (sujets 'steam:<appid>'), même mécanique.
const SRC = {
  twitch: {
    unit: "spectateurs", name: "Twitch", what: "le live",
    info: "Chiffres Twitch réels, que Twitch met à jour toutes les 1 à 3 min",
    intro: "Le live dépassera-t-il le seuil à l'heure dite ? Réponds Oui ou Non : la cote est figée au moment du pari. Paris fermés 5 min avant l'échéance.",
    demo: "Les streamers Twitch ne sont disponibles qu'en ligne : la démo locale n'a pas accès à Twitch.",
    end: "si le live est terminé, c'est Non",
    fine: "Spectateurs Twitch réels (API Twitch), relevés chaque minute. Une question se règle sur le dernier chiffre Twitch avant l'heure annoncée ; si le live est terminé, c'est Non.",
  },
  steam: {
    unit: "joueurs", name: "Steam", what: "le jeu",
    info: "Joueurs connectés réels sur Steam, relevés chaque minute",
    intro: "Le jeu aura-t-il plus de joueurs connectés que le seuil à l'heure dite ? Réponds Oui ou Non : la cote est figée au moment du pari. Paris fermés 5 min avant l'échéance.",
    demo: "Les jeux Steam ne sont disponibles qu'en ligne : la démo locale n'a pas accès à Steam.",
    end: "s'il n'y a plus de relevé, c'est le dernier chiffre connu qui compte",
    fine: "Joueurs connectés réels (API publique de Steam), relevés chaque minute. Une question se règle sur le dernier chiffre Steam avant l'heure annoncée.",
  },
};
const srcOf = login => login?.startsWith("steam:") ? SRC.steam : SRC.twitch;
// Variation du nombre de spectateurs (ou de joueurs) sur les 15 dernières minutes.
function chg15(x) {
  if (!x.live || !x.vs.length) return 0;
  const lim = Date.parse(x.at) - 15 * 60000; let ref = x.vs[0];
  x.ts.forEach((t, i) => { if (t <= lim) ref = x.vs[i] });
  return ref ? x.viewers / ref - 1 : 0;
}

export default function App() {
  const engine = useMemo(() => createEngine(data), []);
  const [api, setApi] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { connect(engine).then(setApi, e => setErr(e.message)) }, [engine]);
  if (err) return <div className="center"><p className="error">{err}</p></div>;
  if (!api) return <div className="center"><p className="muted">Connexion au marché…</p></div>;
  return <Game api={api} engine={engine} />;
}

function Game({ api, engine }) {
  const [now, setNow] = useState(api.now());
  useEffect(() => { const id = setInterval(() => setNow(api.now()), 250); return () => clearInterval(id) }, [api]);
  const s = engine.session(now);

  const [me, setMe] = useState(undefined), [bets, setBets] = useState([]), [board, setBoard] = useState([]);
  const [toast, setToast] = useState(null), [tab, setTab] = useState("market"), [ticket, setTicket] = useState(null);
  const [marketView, setMarketView] = useState("wiki"), [liveSrc, setLiveSrc] = useState("twitch"), [posView, setPosView] = useState("open"), [more, setMore] = useState(null);
  // « Comment jouer » s'ouvre tout seul à la première visite.
  const [firstVisit, setFirstVisit] = useState(() => { try { return !localStorage.getItem("wb-howto") } catch { return false } });
  const [pref, setPref] = useState({ lev: 5, shorizon: "15", stake: 500 });
  const say = useCallback((text, tone) => { setToast({ text, tone, at: Date.now() }) }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2600); return () => clearTimeout(id) }, [toast]);

  const [catalog, setCatalog] = useState([]), [inv, setInv] = useState({}), [rain, setRain] = useState(0), [visit, setVisit] = useState(null);
  useEffect(() => { if (!catalog.length) api.shopItems().then(setCatalog).catch(() => {}) }, [api, board, catalog.length]); // réessaie à chaque rafraîchissement tant qu'il est vide
  const known = useRef(null); // statut de chaque pari au chargement précédent, pour fêter les gains
  const refresh = useCallback(async () => {
    try {
      const [m, b, l, i] = await Promise.all([api.me(), api.myBets(s.k - 30), api.leaderboard().catch(() => []), api.inventoryOf(api.uid).catch(() => [])]); // classement et QG : facultatifs, le jeu tourne sans
      const prev = known.current, won = prev ? b.filter(x => x.status === "won" && prev.get(x.id) === "open") : [];
      known.current = new Map(b.map(x => [x.id, x.status]));
      setMe(m); setBets(b); setBoard(l); setInv(Object.fromEntries(i.map(r => [r.item_id, r])));
      if (won.length) { setToast({ text: `Gagné : ${sW(won.reduce((a, x) => a + x.payout - x.stake, 0))}`, tone: "up", at: Date.now() }); setRain(Date.now()) }
    } catch (e) { say(e.message, "down") }
  }, [api, s.k, say]);
  useEffect(() => { refresh(); return api.onChange(refresh) }, [api, refresh]);

  // Lives Twitch : relevés côté serveur chaque minute, rechargés ici toutes les 20 s.
  const [streams, setStreams] = useState([]), [markets, setMarkets] = useState([]);
  const loadStreams = useCallback(() => Promise.all([api.streamBoard(), api.openMarkets().catch(() => [])]).then(([b, m]) => { setStreams(b); setMarkets(m) }).catch(() => {}), [api]);
  useEffect(() => { loadStreams(); const id = setInterval(loadStreams, 20000); return () => clearInterval(id) }, [loadStreams]);
  const byLogin = useMemo(() => Object.fromEntries(streams.map(x => [x.login, x])), [streams]);

  // Règlement : au changement de phase, quand une position arrive à échéance ou se fait liquider, et toutes les 15 s.
  const due = bets.filter(b => b.status === "open" && (b.kind === "trade" ? liveTrade(engine, b, s).due : b.kind === "stream" ? liveStream(b, byLogin[b.login], now).due : b.kind === "question" ? now >= Date.parse(b.end_at) : b.session < s.k || !s.playing)).length;
  const settle = useCallback(() => api.settle().then(refresh).catch(() => {}), [api, refresh]);
  useEffect(() => { if (due) settle() }, [due, settle]);
  useEffect(() => { settle() }, [s.k, s.playing, settle]);
  useEffect(() => { const id = setInterval(settle, 15000); return () => clearInterval(id) }, [settle]);

  // Coup d'envoi en direct : bandeau quand une nouvelle séance démarre.
  const [kickoff, setKickoff] = useState(false), lastK = useRef(s.k);
  useEffect(() => {
    if (s.k !== lastK.current && s.playing) { lastK.current = s.k; setKickoff(true); const id = setTimeout(() => setKickoff(false), 4000); return () => clearTimeout(id) }
  }, [s.k, s.playing]);

  const run = async (fn, ok) => { try { const r = await fn(); if (ok) say(ok(r), "up"); await refresh(); return r } catch (e) { say(e.message, "down") } };
  const open = bets.filter(b => b.status === "open");
  const equipped = cat => catalog.find(i => i.category === cat && inv[i.id]?.equipped);
  const accent = THEMES[equipped("theme")?.id] ?? DEFAULT_ACCENT, myTitle = equipped("title")?.name, effect = equipped("effect")?.id;
  useEffect(() => { document.documentElement.style.setProperty("--accent", accent) }, [accent]);
  const openStake = open.reduce((a, b) => a + b.stake, 0);
  const objectsValue = catalog.filter(i => i.kind !== "bonus" && (inv[i.id]?.qty ?? 0) > 0).reduce((a, i) => a + Math.floor(i.price * .6), 0);
  const positions = open.filter(b => b.kind === "trade" || b.kind === "stream");
  const pnl = positions.length ? Math.round(positions.reduce((a, b) => a + (b.kind === "trade" ? liveTrade(engine, b, s) : liveStream(b, byLogin[b.login], now)).value - b.stake, 0)) : null;
  const visitQG = async row => {
    if (row.id === me.id) { setVisit(null); setTab("qg"); return }
    try { const rows = await api.inventoryOf(row.id); setVisit({ row, inv: Object.fromEntries(rows.map(r => [r.item_id, r])) }); setTab("qg") } catch (e) { say(e.message, "down") }
  };

  if (me === undefined) return <div className="center"><p className="muted">Chargement…</p></div>;
  if (me === null) return <Onboarding api={api} onDone={refresh} />;

  const go = t => { setTab(t); if (t !== "more") setMore(null); window.scrollTo({ top: 0 }) };
  const closeTrade = b => run(() => api.closeTrade(b.id), r => `Clôturée : ${sW(r.payout - r.stake)}`);
  const howtoDone = () => { try { localStorage.setItem("wb-howto", "1") } catch { } setFirstVisit(false); setMore(null); setTab("market") };
  const patrimoine = me.cash + openStake + objectsValue;
  const showHowto = firstVisit || (tab === "more" && more === "howto");

  return (
    <div className="app">
      <header className="top">
        <span className="logo">wiki<b>·</b>bourse</span>
        {api.mode === "demo" && <span className="tag">démo</span>}
        <button type="button" className="cash mono" onClick={() => { setTab("more"); setMore("account") }} aria-label="Mon compte">{W(me.cash)}</button>
      </header>
      <SessionBar s={s} now={now} engine={engine} />
      {kickoff && <div className="kickoff">Coup d'envoi · {sessName(s.k)}</div>}

      <div className="layout">
        <aside className="rail">
          <Positions engine={engine} s={s} now={now} byLogin={byLogin} bets={open} onClose={closeTrade} />
          {!s.playing && <SessionResults engine={engine} s={s} bets={bets} />}
        </aside>

        <main className="main">
          {showHowto ? <HowTo first={firstVisit} onBack={firstVisit ? howtoDone : () => setMore(null)} /> : <>
          {(tab === "market" || tab === "live") && <MiniTicker engine={engine} s={s} now={now} byLogin={byLogin} bets={open} onOpen={() => { setPosView("open"); go("positions") }} />}

          {tab === "market" && <>
            <Segmented label="Marché" value={marketView} onChange={setMarketView} options={[["wiki", "Wikipédia"], ["duels", "Duels"]]} />
            {marketView === "wiki"
              ? <Market engine={engine} s={s} bets={open} onPick={(tk, dir) => setTicket({ kind: "trade", tk, dir })} />
              : <Duels engine={engine} s={s} onPick={(duel, side) => setTicket({ kind: "duel", duel, side })} />}
          </>}

          {tab === "live" && <>
            <Segmented label="Live" value={liveSrc} onChange={setLiveSrc} options={[["twitch", "Twitch"], ["steam", "Steam"]]} />
            <Streams key={liveSrc} src={liveSrc} streams={streams} markets={markets} mode={api.mode} bets={open} now={now} onPick={(market, side) => setTicket({ kind: "question", market, side })} />
          </>}

          {tab === "positions" && <>
            <Segmented label="Mes paris" value={posView} onChange={setPosView} options={[["open", `En cours${open.length ? ` · ${open.length}` : ""}`], ["history", "Historique"]]} />
            {posView === "open" ? <>
              {!s.playing && <SessionResults engine={engine} s={s} bets={bets} />}
              {open.length ? <Positions vertical engine={engine} s={s} now={now} byLogin={byLogin} bets={open} onClose={closeTrade} />
                : <div className="empty-state"><b>Aucun pari en cours</b><p className="muted">Prends position sur un article ou réponds à une question en direct.</p>
                    <div className="empty-acts"><button type="button" className="btn primary" onClick={() => go("market")}>Marché</button><button type="button" className="btn" onClick={() => go("live")}>Live</button></div></div>}
            </> : <History engine={engine} byLogin={byLogin} bets={bets.filter(b => b.status !== "open")} />}
          </>}

          {tab === "qg" && <Suspense fallback={<p className="muted pad">Chargement du QG…</p>}>
            {visit
              ? <QG api={api} catalog={catalog} inv={visit.inv} owner={visit.row} self={false} patrimoine={visit.row.patrimoine} pnl={null}
                  accent={THEMES[catalog.find(i => i.category === "theme" && visit.inv[i.id]?.equipped)?.id] ?? DEFAULT_ACCENT} onBack={() => setVisit(null)} />
              : <QG api={api} catalog={catalog} inv={inv} me={me} owner={{ pseudo: me.pseudo, title: myTitle }} self patrimoine={patrimoine}
                  openStake={openStake} pnl={pnl} accent={accent} act={run} />}
          </Suspense>}

          {tab === "more" && (
            more === "board" ? <><SubHeader title="Classement" onBack={() => setMore(null)} /><Board board={board} me={me} onVisit={visitQG} /></>
            : more === "account" ? <Account me={me} title={myTitle} patrimoine={patrimoine} openStake={openStake} objects={objectsValue} demo={api.mode === "demo"}
                canRestart={me.cash + openStake < BK_LIMIT} onRestart={() => run(() => api.restart(), () => `Nouveau départ : ${W(CAP0)}`)} onBack={() => setMore(null)} />
            : more === "legal" ? <Legal engine={engine} onBack={() => setMore(null)} />
            : <MoreMenu go={setMore} me={me} title={myTitle} />)}
          </>}
        </main>
      </div>

      <Dock tab={showHowto && firstVisit ? null : tab} setTab={t => { if (firstVisit) howtoDone(); go(t) }} badge={open.length} />

      {ticket && <Ticket engine={engine} s={s} now={now} byLogin={byLogin} me={me} ticket={ticket} pref={pref} setPref={setPref} onClose={() => setTicket(null)}
        onSubmit={async args => {
          const opened = b => `Position ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} ouverte · ${W(b.stake)}`;
          const r = ticket.kind === "trade" ? await run(() => api.openTrade(args), opened)
            : ticket.kind === "stream" ? await run(() => api.openStream(args), opened)
            : ticket.kind === "question" ? await run(() => api.betQuestion(args), b => `Pari validé : ${b.side === "yes" ? "Oui" : "Non"} à ${nf2.format(b.odds)} · ${W(b.stake)}`)
            : await run(() => api.betDuel(args), b => `Pari validé · ${W(b.stake)}`);
          if (ticket.kind === "stream" || ticket.kind === "question") loadStreams();
          if (r) setTicket(null);
        }} />}
      {toast && <div className={"toast " + (toast.tone || "")} role="status">{toast.text}</div>}
      {effect && <Rain kind={effect} at={rain} />}
    </div>
  );
}

// Bande compacte de mes paris en cours, en haut du Marché et du Live (sur mobile) : un appui ouvre l'onglet Positions.
function MiniTicker({ engine, s, now, byLogin, bets, onOpen }) {
  if (!bets.length) return null;
  const chip = b => {
    if (b.kind === "trade") { const net = liveTrade(engine, b, s).value - b.stake; return [engine.BY[b.tk].name, sW(net), cls(net)] }
    if (b.kind === "stream") { const net = liveStream(b, byLogin[b.login], now).value - b.stake; return [byLogin[b.login]?.display_name ?? b.login, sW(net), cls(net)] }
    if (b.kind === "question") { const st = byLogin[b.login], cur = st?.viewers ?? b.entry, win = (b.side === "yes") === (cur > b.threshold); return [st?.display_name ?? b.login, b.side === "yes" ? "Oui" : "Non", win ? "up" : "down"] }
    return ["Duel", W(b.stake), "flat"];
  };
  return (
    <button type="button" className="ticker" onClick={onOpen} aria-label="Voir mes paris en cours">
      {bets.slice(0, 8).map(b => { const [n, v, c] = chip(b); return <span key={b.id} className="tick"><b>{n}</b><span className={"mono " + c}>{v}</span></span> })}
    </button>
  );
}

function Onboarding({ api, onDone }) {
  const [pseudo, setPseudo] = useState(""), [err, setErr] = useState(null);
  return (
    <div className="center">
      <form className="onboard" onSubmit={async e => { e.preventDefault(); try { await api.createProfile(pseudo); onDone() } catch (x) { setErr(x.message) } }}>
        <span className="logo big">wiki<b>·</b>bourse</span>
        <p className="muted">Prends position sur l'audience des articles de Wikipédia. Une séance toutes les 11 minutes, les mêmes cours pour tout le monde. Tu démarres avec {W(CAP0)}.</p>
        <label htmlFor="pseudo">Ton pseudo</label>
        <input id="pseudo" value={pseudo} onChange={e => setPseudo(e.target.value)} minLength={2} maxLength={20} required autoFocus />
        {err && <p className="error">{err}</p>}
        <button className="btn primary" type="submit">Entrer sur le marché</button>
      </form>
    </div>
  );
}

function SessionBar({ s, now, engine }) {
  const day = engine.dateOf(s.d + 1).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <section className={"session " + (s.playing ? "live" : "pause")} aria-live="polite">
      <span className="pill">{s.playing ? "En direct" : "Pause"}</span>
      <span className="clock mono" title="Heure du marché simulé (9:00 → 17:30)"><small>marché</small>{s.playing ? hhmm(s.t) : "17:30"}</span>
      <span className="sub">{sessName(s.k).replace("s", "S")} · vues du {day}</span>
      <span className="count mono">{s.playing ? `fin dans ${mmss(s.endsAt - now)}` : `reprise dans ${mmss(s.nextAt - now)}`}</span>
      <span className="bar"><i style={{ width: `${s.playing ? s.off / (s.endsAt - s.startsAt) * 100 : 100}%` }} /></span>
    </section>
  );
}

/* Mes positions en direct : toujours visibles, en tête sur mobile et dans la colonne de gauche sur grand écran. */
function Positions({ engine, s, now, byLogin, bets, onClose, vertical }) {
  if (!bets.length && !vertical) return <div className="panel empty-pos"><h2>Mes positions</h2><p className="muted">Aucune position ouverte. Choisis un article et prends position à la hausse ou à la baisse.</p></div>;
  const list = [...bets].sort((a, b) => (b.kind !== "duel") - (a.kind !== "duel") || b.id - a.id);
  const cards = list.map(b => b.kind === "trade" ? <TradeCard key={b.id} engine={engine} s={s} now={now} b={b} onClose={onClose} />
    : b.kind === "stream" ? <StreamCard key={b.id} b={b} st={byLogin[b.login]} now={now} onClose={onClose} />
    : b.kind === "question" ? <QuestionCard key={b.id} b={b} st={byLogin[b.login]} now={now} />
    : <DuelCard key={b.id} engine={engine} s={s} now={now} b={b} />);
  if (vertical) return <div className="pos-list vertical">{cards}</div>;
  return (
    <section className="panel">
      <h2>Mes positions <span className="muted">{bets.length} en cours</span></h2>
      <div className="pos-list">{cards}</div>
    </section>
  );
}

// Informations détaillées d'un pari, en grille de deux colonnes.
const Facts = ({ items }) => (
  <dl className="facts">
    {items.filter(Boolean).map(([k, v, c]) => <div key={k}><dt>{k}</dt><dd className={"mono " + (c || "")}>{v}</dd></div>)}
  </dl>
);
// Temps restant lisible : « 4:12 » sous l'heure, « 1 h 05 » au-delà.
const left = ms => ms <= 0 ? "maintenant" : ms < 3600e3 ? mmss(ms) : `${Math.floor(ms / 3600e3)} h ${String(Math.floor(ms / 60e3) % 60).padStart(2, "0")}`;
// Barre de temps : part écoulée entre l'ouverture et la clôture prévue.
const TimeBar = ({ from, to, now }) => <span className="timebar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, (now - from) / Math.max(1, to - from) * 100))}%` }} /></span>;
// Distance au seuil de liquidation, en % du cours actuel ; alerte sous 3 %.
const liqFact = (b, px, fmt) => { const lq = liqPrice(b), d = lq / px - 1; return ["Liquidation", `${fmt(lq)} (${pct(d)})`, Math.abs(d) < .03 ? "down warn" : ""] };

function TradeCard({ engine, s, now, b, onClose }) {
  const st = liveTrade(engine, b, s), net = st.value - b.stake, name = engine.BY[b.tk].name;
  const live = b.session === s.k && s.playing, [busy, setBusy] = useState(false);
  return (
    <article className={"pos " + (net >= 0 ? "gain" : "loss")}>
      <div className="pos-h">
        <b>{name}</b>
        <span className={"side " + b.dir}>{b.dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×{b.lev}</span>
      </div>
      <div className="pos-pnl mono"><span className={cls(net)}>{sW(net)}</span><span className={cls(net)}>{pct(net / b.stake)}</span></div>
      <TradeChart b={b} path={engine.pathOf(b.tk, b.day)} upto={st.upto} />
      <Facts items={[
        ["Mise", `${W(b.stake)} · ×${b.lev}`],
        ["Valeur", W(st.value), cls(net)],
        ["Entrée", `${nf2.format(b.entry)} · ${clock(Date.parse(b.created_at))}`],
        ["Cours", `${nf2.format(st.px)} (${pct(st.px / b.entry - 1)})`, cls((st.px / b.entry - 1) * (b.dir === "up" ? 1 : -1))],
        !st.liquidated && liqFact(b, st.px, v => nf2.format(v)),
        ["Clôture prévue", live ? `${clock(s.endsAt)} · dans ${left(s.endsAt - now)}` : "règlement en cours"],
      ]} />
      {live && <TimeBar from={Date.parse(b.created_at)} to={s.endsAt} now={now} />}
      {st.due
        ? <p className="muted small">{st.liquidated ? "Liquidée, règlement en cours…" : "Fin de séance, règlement en cours…"}</p>
        : <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onClose(b); setBusy(false) }}>Clôturer · {W(st.value)}</button>}
    </article>
  );
}

function StreamCard({ b, st, now, onClose }) {
  const x = liveStream(b, st, now), net = x.value - b.stake, t0 = Date.parse(b.created_at);
  const end = b.end_at ? Date.parse(b.end_at) : Math.max(now, t0 + 30 * 60000);
  const [busy, setBusy] = useState(false);
  return (
    <article className={"pos " + (net >= 0 ? "gain" : "loss")}>
      <div className="pos-h">
        <b className="who">{st?.avatar && <img className="avatar sm" src={st.avatar} alt="" />}{st?.display_name ?? b.login}</b>
        <span className={"side " + b.dir}>{b.dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×{b.lev}</span>
      </div>
      <div className="pos-pnl mono"><span className={cls(net)}>{sW(net)}</span><span className={cls(net)}>{pct(net / b.stake)}</span></div>
      <PositionChart id={b.id} entry={b.entry} dir={b.dir} pts={x.pts} x0={t0} x1={end} />
      <Facts items={[
        ["Mise", `${W(b.stake)} · ×${b.lev}`],
        ["Valeur", W(x.value), cls(net)],
        ["Entrée", `${nf0.format(b.entry)} · ${clock(t0)}`],
        ["Actuel", `${nf0.format(x.px)} (${pct(x.px / b.entry - 1)})`],
        !x.liquidated && liqFact(b, x.px, v => nf0.format(Math.round(v))),
        ["Clôture prévue", b.end_at ? `${clock(end)} · dans ${left(end - now)}` : "à la fin du live"],
      ]} />
      {b.end_at && <TimeBar from={t0} to={end} now={now} />}
      {x.due
        ? <p className="muted small">{x.liquidated ? "Liquidée, règlement en cours…" : st && !st.live ? "Live terminé, règlement en cours…" : "Échéance atteinte, règlement en cours…"}</p>
        : <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onClose(b); setBusy(false) }}>Clôturer · {W(x.value)}</button>}
    </article>
  );
}

function QuestionCard({ b, st, now }) {
  const t0 = Date.parse(b.created_at), end = Date.parse(b.end_at), upto = Math.min(now, end), pts = [[t0, b.entry]];
  if (st) st.ts.forEach((t, i) => { if (t > t0 && t <= upto) pts.push([t, st.vs[i]]) });
  const [at, cur] = pts[pts.length - 1], winning = (b.side === "yes") === (cur > b.threshold), S = srcOf(b.login);
  return (
    <article className={"pos " + (winning ? "gain" : "loss")}>
      <div className="pos-h">
        <b className="who">{st?.avatar && <img className="avatar sm" src={st.avatar} alt="" />}{st?.display_name ?? b.login}</b>
        <span className={"side " + (b.side === "yes" ? "up" : "down")}>{b.side === "yes" ? "Oui" : "Non"} · {nf2.format(b.odds)}</span>
      </div>
      <p className="small">Plus de <b className="mono">{nf0.format(b.threshold)}</b> {S.unit} à <b className="mono">{clock(end)}</b> ?</p>
      <div className="pos-q mono"><span className={winning ? "up" : "down"}>{winning ? "gagnant" : "perdant"} pour l'instant</span><span>{nf0.format(cur)} / {nf0.format(b.threshold)}</span></div>
      <PositionChart id={b.id} entry={b.threshold} dir={b.side === "yes" ? "up" : "down"} pts={pts} x0={t0} x1={end} />
      <Facts items={[
        ["Mise", W(b.stake)],
        ["Gain si gagné", W(b.stake * b.odds), "up"],
        ["Au pari", `${nf0.format(b.entry)} · ${clock(t0)}`],
        ["Écart au seuil", `${cur > b.threshold ? "+" : "−"}${nf0.format(Math.abs(cur - b.threshold))} (${pct(cur / b.threshold - 1)})`, winning ? "up" : "down"],
        ["Échéance", now < end ? `${clock(end)} · dans ${left(end - now)}` : `${clock(end)} · passée`],
        ["Chiffre affiché", `${S.name} de ${clock(at)}`],
      ]} />
      <TimeBar from={t0} to={end} now={now} />
      {now >= end && <p className="muted small">Échéance passée, règlement au prochain chiffre {S.name}…</p>}
    </article>
  );
}

function Streams({ src, streams: all, markets: allMarkets, mode, bets, now, onPick }) {
  const [slot, setSlot] = useState(null), frozen = useRef({ key: null, logins: [] }), S = SRC[src], mineSrc = login => (srcOf(login) === S);
  const streams = all.filter(x => mineSrc(x.login)), markets = allMarkets.filter(m => mineSrc(m.login));
  if (!streams.length) return <p className="muted pad">{mode === "demo" ? S.demo : `Aucun relevé ${S.name} pour l'instant. La relève tourne chaque minute, reviens dans un instant.`}</p>;
  const slots = [...new Set(markets.map(m => m.closes_at))].sort(), cur = slots.includes(slot) ? slot : slots[0];
  const byL = Object.fromEntries(streams.map(x => [x.login, x])), lastTick = Math.max(...streams.map(x => Date.parse(x.at)));
  const mine = login => bets.some(b => (b.kind === "question" || b.kind === "stream") && b.login === login);
  const list = markets.filter(m => m.closes_at === cur && byL[m.login]?.live).map(m => ({ m, x: byL[m.login] }));
  // Ordre figé tant qu'on reste sur la même échéance, pour ne pas faire bouger les cartes sous le doigt.
  if (frozen.current.key !== src + cur || !frozen.current.logins.length) frozen.current = { key: src + cur, logins: [...list].sort((a, b) => b.x.viewers - a.x.viewers).map(r => r.x.login) };
  const rank = l => { const i = frozen.current.logins.indexOf(l); return i < 0 ? 1e9 : i };
  list.sort((a, b) => rank(a.x.login) - rank(b.x.login));
  return (
    <section>
      <div className="feed-info"><i className="pulse" aria-hidden="true" />{S.info} · dernier relevé {ago(now - lastTick)}</div>
      <p className="muted small">{S.intro}</p>
      {slots.length > 0 && <div className="chips" role="group" aria-label="Échéance">
        {slots.map(t => <button key={t} type="button" aria-pressed={t === cur} onClick={() => setSlot(t)}>à {clock(Date.parse(t))}</button>)}
      </div>}
      {!list.length && <p className="muted pad">Les questions arrivent avec le prochain relevé {S.name}.</p>}
      <div className="qlist">
        {list.map(({ m, x }) => (
          <article key={m.id} className={"qcard" + (mine(x.login) ? " mine" : "")}>
            <div className="qhead">
              <span className="who">
                {x.avatar ? <img className="avatar" src={x.avatar} alt="" loading="lazy" /> : <span className="avatar" />}
                <span><b>{x.display_name}</b><small title={x.title || ""}>{src === "steam" ? "joueurs connectés" : x.game || "en live"}</small></span>
              </span>
              <span className="r mono"><b>{nf0.format(x.viewers)}</b><small>chiffre de {clock(twitchAt(x))}</small></span>
            </div>
            {x.vs.length > 1 && <Spark path={x.vs} t={x.vs.length - 1} h={24} />}
            <p className="qtext">Plus de <b className="mono">{nf0.format(m.threshold)}</b> {S.unit} à <b className="mono">{clock(Date.parse(m.closes_at))}</b> ?</p>
            <div className="qbtns">
              <button type="button" className="buy" onClick={() => onPick(m, "yes")}><span>Oui</span><b className="mono">{nf2.format(m.odds_yes)}</b></button>
              <button type="button" className="sell" onClick={() => onPick(m, "no")}><span>Non</span><b className="mono">{nf2.format(m.odds_no)}</b></button>
            </div>
          </article>
        ))}
      </div>
      <p className="fine">{S.fine} Cote calculée sur l'écart au seuil, le temps restant et la volatilité du live sur la dernière heure, marge de 7 %.</p>
    </section>
  );
}

function DuelCard({ engine, s, now, b }) {
  const du = engine.makeDuels(b.day).find(x => x.id === b.duel_id);
  const [w, o] = b.side === "a" ? [du.a, du.b] : [du.b, du.a], W1 = engine.BY[w], W2 = engine.BY[o];
  const live = b.session === s.k && s.playing;
  return (
    <article className="pos">
      <div className="pos-h"><b>{W1.name}</b><span className="side duel">duel · {nf2.format(b.odds)}</span></div>
      <p className="muted small">bat {W2.name} en vues sur la journée</p>
      <Facts items={[
        ["Mise", W(b.stake)],
        ["Gain si gagné", W(b.stake * b.odds), "up"],
        ["Vues la veille", `${nf0.format(W1.views[b.day])} contre ${nf0.format(W2.views[b.day])}`],
        ["Résultat", live ? `${clock(s.endsAt)} · dans ${left(s.endsAt - now)}` : "règlement en cours"],
      ]} />
      {live && <TimeBar from={s.startsAt} to={s.endsAt} now={now} />}
    </article>
  );
}

function SessionResults({ engine, s, bets }) {
  const mine = bets.filter(b => b.session === s.k && b.status !== "open"), net = mine.reduce((a, b) => a + b.payout - b.stake, 0);
  const movers = engine.STOCKS.map(x => ({ x, c: x.px[s.d + 1] / x.px[s.d] - 1 })).sort((a, b) => b.c - a.c);
  return (
    <section className="panel results">
      <h2>Coup de sifflet final</h2>
      <div className="row"><span>Ton bilan de séance</span><b className={"mono " + cls(net)}>{mine.length ? sW(net) : "aucun pari"}</b></div>
      {mine.length > 0 && <div className="row"><span>Salaire de séance</span><b className="mono up">+{W(500)}</b></div>}
      <div className="row"><span>Plus forte hausse</span><b className="mono up">{movers[0].x.name} {pct(movers[0].c)}</b></div>
      <div className="row"><span>Plus forte baisse</span><b className="mono down">{movers.at(-1).x.name} {pct(movers.at(-1).c)}</b></div>
    </section>
  );
}

function Market({ engine, s, bets, onPick }) {
  const [sector, setSector] = useState("Tout"), [sort, setSort] = useState("move"), [order, setOrder] = useState(null);
  const sectors = ["Tout", ...new Set(engine.STOCKS.map(x => x.sector))];
  const mine = tk => bets.find(b => b.kind === "trade" && b.tk === tk);
  const all = engine.STOCKS.map(x => { const p = engine.pathOf(x.tk, s.d); return { x, p, px: p[s.t], chg: p[s.t] / p[0] - 1 } });
  // L'ordre ne bouge pas tout seul : il est calculé au coup d'envoi, au changement de tri ou sur « Retrier ».
  const resort = () => setOrder([...all].sort(sort === "az" ? (a, b) => a.x.name.localeCompare(b.x.name, "fr") : (a, b) => Math.abs(b.chg) - Math.abs(a.chg)).map(r => r.x.tk));
  useEffect(resort, [sort, s.k]);
  const byTk = Object.fromEntries(all.map(r => [r.x.tk, r]));
  const rows = (order ?? all.map(r => r.x.tk)).map(tk => byTk[tk]).filter(r => sector === "Tout" || r.x.sector === sector);
  return (
    <section>
      <div className="chips" role="group" aria-label="Catégories">
        {sectors.map(x => <button key={x} type="button" aria-pressed={sector === x} onClick={() => setSector(x)}>{x}</button>)}
      </div>
      <div className="sortbar">
        <div className="seg mini" role="group" aria-label="Tri">
          <button type="button" aria-pressed={sort === "move"} onClick={() => setSort("move")}>Mouvements</button>
          <button type="button" aria-pressed={sort === "az"} onClick={() => setSort("az")}>A → Z</button>
        </div>
        {sort === "move" && <button type="button" className="btn ghost" onClick={resort}>↻ Retrier</button>}
      </div>
      <div className="market">
        <div className="mrow head"><span>Article</span><span /><span className="r">Cours · séance</span><span /></div>
        {rows.map(({ x, p, px, chg }) => {
          const pos = mine(x.tk);
          return (
            <div key={x.tk} className={"mrow" + (pos ? " mine" : "")}>
              <span className="name"><b>{x.name}</b><small>{x.sector} · {nf0.format(x.views[s.d])} vues la veille</small></span>
              <Spark path={p} t={s.t} />
              <span className="r mono"><b>{nf2.format(px)}</b><small className={cls(chg)}>{pct(chg)}</small></span>
              <span className="act">
                <button type="button" className="buy" disabled={!s.playing} onClick={() => onPick(x.tk, "up")} aria-label={`Hausse sur ${x.name}`}>▲</button>
                <button type="button" className="sell" disabled={!s.playing} onClick={() => onPick(x.tk, "down")} aria-label={`Baisse sur ${x.name}`}>▼</button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Duels({ engine, s, onPick }) {
  const duels = engine.makeDuels(s.d);
  return (
    <section className="duels">
      <p className="muted small">Qui fera le plus de vues sur Wikipédia ce jour-là ? Réglé sur les vraies vues à la fin de la séance.</p>
      {duels.map(d => (
        <article key={d.id} className={"duel panel" + (d.boost ? " boost" : "")}>
          {d.boost && <span className="tag">cote boostée</span>}
          {["a", "b"].map(side => {
            const x = engine.BY[d[side]], o = d["o" + side];
            return (
              <button key={side} type="button" className="dside" disabled={!s.playing} onClick={() => onPick(d, side)}>
                <b>{x.name}</b><small>{nf0.format(x.views[s.d])} vues la veille</small>
                <span className="odd mono">{d.boost === side && <s>{nf2.format(d.base)}</s>}{nf2.format(o)}</span>
              </button>
            );
          })}
        </article>
      ))}
    </section>
  );
}

function History({ engine, byLogin, bets }) {
  if (!bets.length) return <p className="muted pad">Tes paris réglés apparaîtront ici.</p>;
  return (
    <div className="history">
      {bets.map(b => {
        const net = b.payout - b.stake;
        const label = b.kind === "trade" ? `${engine.BY[b.tk].name} ${b.dir === "up" ? "▲" : "▼"} ×${b.lev}`
          : b.kind === "stream" ? `${byLogin[b.login]?.display_name ?? b.login} ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} · Twitch`
          : (() => { const d = engine.makeDuels(b.day).find(x => x.id === b.duel_id); return `${engine.BY[b.side === "a" ? d.a : d.b].name} (duel)` })();
        if (b.kind === "question") return (
          <div key={b.id} className="hrow">
            <span><b>{byLogin[b.login]?.display_name ?? b.login} · plus de {nf0.format(b.threshold)} à {clock(Date.parse(b.end_at))} : {b.side === "yes" ? "Oui" : "Non"}</b><small>chiffre final {b.exit != null ? nf0.format(b.exit) : "—"} · cote {nf2.format(b.odds)}</small></span>
            <span className="r mono"><b className={cls(net)}>{sW(net)}</b><small>mise {W(b.stake)}</small></span>
          </div>
        );
        if (b.kind === "stream") return (
          <div key={b.id} className="hrow">
            <span><b>{label}</b><small>{clock(Date.parse(b.created_at))} → {b.exit_at ? clock(Date.parse(b.exit_at)) : "—"} · {nf0.format(b.entry)} → {b.exit != null ? nf0.format(b.exit) : "—"} spectateurs{b.payout === 0 ? " · liquidée" : ""}</small></span>
            <span className="r mono"><b className={cls(net)}>{sW(net)}</b><small>mise {W(b.stake)}</small></span>
          </div>
        );
        return (
          <div key={b.id} className="hrow">
            <span><b>{label}</b><small>{sessName(b.session)}{b.kind === "trade" ? ` · ${hhmm(b.start_tick)} → ${hhmm(b.closed_tick ?? b.end_tick)}${b.payout === 0 ? " · liquidée" : ""}` : ` · cote ${nf2.format(b.odds)}`}</small></span>
            <span className="r mono"><b className={cls(net)}>{sW(net)}</b><small>mise {W(b.stake)}</small></span>
          </div>
        );
      })}
    </div>
  );
}

function Board({ board, me, onVisit }) {
  return (
    <section>
      <div className="board">
        {board.map((p, i) => (
          <button type="button" key={p.id} className={"brow" + (p.id === me.id ? " me" : "")} onClick={() => onVisit(p)} aria-label={`Voir le QG de ${p.pseudo}`}>
            <span className="rk mono">{i + 1}</span>
            <span><b>{p.pseudo}</b><small>{[p.title, HOME_NAMES[p.home ?? 0], p.bankruptcies > 0 && `${p.bankruptcies} faillite${p.bankruptcies > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</small></span>
            <span className="r mono">{W(p.patrimoine ?? p.cash)}<small>solde {W(p.cash)}</small></span>
          </button>
        ))}
      </div>
      <p className="fine">Classement au patrimoine : solde, mises en cours et 60 % du prix des objets du QG. Touche un joueur pour visiter son QG.</p>
    </section>
  );
}

// Pluie de confettis ou de billets quand un pari est gagné (cosmétique « effet de victoire »).
function Rain({ kind, at }) {
  const [on, setOn] = useState(false);
  useEffect(() => { if (!at) return; setOn(true); const id = setTimeout(() => setOn(false), 2800); return () => clearTimeout(id) }, [at]);
  if (!on) return null;
  const bills = kind === "effet_billets";
  return (
    <div className="rain" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => <i key={i} className={bills ? "bill" : "conf"}
        style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 9) * .13}s`, background: bills ? undefined : ["var(--accent)", "var(--up)", "#4be0ff", "#f472b6"][i % 4] }}>{bills ? "W" : ""}</i>)}
    </div>
  );
}

function Ticket({ engine, s, now, byLogin, me, ticket, pref, setPref, onClose, onSubmit }) {
  const [stake, setStake] = useState(pref.stake), [busy, setBusy] = useState(false), [dir, setDir] = useState(ticket.dir), [side, setSide] = useState(ticket.side);
  const isTrade = ticket.kind === "trade", isStream = ticket.kind === "stream", isPos = isTrade || isStream;
  const st = isStream ? byLogin[ticket.login] : null;
  const set = p => setPref(x => ({ ...x, ...p }));
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onClose]);
  const isQ = ticket.kind === "question";
  const open = isQ ? Date.parse(ticket.market.closes_at) - 300000 > now : isStream ? !!st?.live : s.playing;
  const ok = stake > 0 && stake <= me.cash && open;
  let body, title, cta;
  if (isTrade) {
    const x = engine.BY[ticket.tk], px = engine.price(ticket.tk, s.d, s.t), b = { entry: px, lev: pref.lev, dir, stake };
    title = x.name;
    cta = `${dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×${pref.lev} · ${W(stake)}`;
    body = <>
      <div className="seg" role="group" aria-label="Sens">
        <button type="button" aria-pressed={dir === "up"} className="buy" onClick={() => setDir("up")}>▲ Hausse</button>
        <button type="button" aria-pressed={dir === "down"} className="sell" onClick={() => setDir("down")}>▼ Baisse</button>
      </div>
      <label>Levier</label>
      <div className="seg" role="group" aria-label="Levier">{LEVS.map(v => <button key={v} type="button" aria-pressed={pref.lev === v} onClick={() => set({ lev: v })}>×{v}</button>)}</div>
      <p className="muted small">La position reste ouverte jusqu'à ce que tu la clôtures, au plus tard au coup de sifflet final.</p>
      <div className="rows mono">
        <div className="row"><span>Cours actuel</span><b>{nf2.format(px)}</b></div>
        <div className="row"><span>1 % de variation</span><b>±{W(stake * pref.lev / 100)}</b></div>
        <div className="row"><span>Liquidation si le cours atteint</span><b>{nf2.format(liqPrice(b))}</b></div>
        <div className="row"><span>Fermeture</span><b>fin de séance · {mmss(s.endsAt - now)}</b></div>
      </div>
    </>;
  } else if (isQ) {
    const m = ticket.market, x = byLogin[m.login], o = side === "yes" ? m.odds_yes : m.odds_no, end = Date.parse(m.closes_at);
    const S = srcOf(m.login);
    title = `${x?.display_name ?? m.login} : plus de ${nf0.format(m.threshold)} ${S.unit} à ${clock(end)} ?`;
    cta = `${side === "yes" ? "Oui" : "Non"} à ${nf2.format(o)} · ${W(stake)}`;
    body = <>
      <div className="seg" role="group" aria-label="Réponse">
        <button type="button" aria-pressed={side === "yes"} className="buy" onClick={() => setSide("yes")}>Oui · {nf2.format(m.odds_yes)}</button>
        <button type="button" aria-pressed={side === "no"} className="sell" onClick={() => setSide("no")}>Non · {nf2.format(m.odds_no)}</button>
      </div>
      <div className="rows mono">
        <div className="row"><span>{S.unit[0].toUpperCase() + S.unit.slice(1)} (chiffre de {x ? clock(twitchAt(x)) : "—"})</span><b>{x ? nf0.format(x.viewers) : "—"}</b></div>
        <div className="row"><span>Seuil</span><b>{nf0.format(m.threshold)}</b></div>
        <div className="row"><span>Gain si {side === "yes" ? "Oui" : "Non"}</span><b>{W(stake * o)}</b></div>
        <div className="row"><span>Paris fermés à</span><b>{clock(end - 300000)}</b></div>
      </div>
      <p className="muted small">Réglé sur le dernier chiffre {S.name} avant {clock(end)} ; {S.end}. La cote bouge avec l'audience et le temps : celle retenue s'affiche après validation.</p>
    </>;
  } else if (isStream) {
    const px = st?.viewers ?? 0, b = { entry: px, lev: pref.lev, dir, stake };
    title = st?.display_name ?? ticket.login;
    cta = `${dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×${pref.lev} · ${W(stake)}`;
    body = <>
      {st?.title && <p className="muted small clip" title={st.title}>{st.game ? `${st.game} · ` : ""}{st.title}</p>}
      <div className="seg" role="group" aria-label="Sens">
        <button type="button" aria-pressed={dir === "up"} className="buy" onClick={() => setDir("up")}>▲ Hausse</button>
        <button type="button" aria-pressed={dir === "down"} className="sell" onClick={() => setDir("down")}>▼ Baisse</button>
      </div>
      <label>Levier</label>
      <div className="seg" role="group" aria-label="Levier">{LEVS.map(v => <button key={v} type="button" aria-pressed={pref.lev === v} onClick={() => set({ lev: v })}>×{v}</button>)}</div>
      <label>Échéance</label>
      <div className="seg" role="group" aria-label="Échéance">{Object.entries(STREAM_H).map(([k, l]) => <button key={k} type="button" aria-pressed={pref.shorizon === k} onClick={() => set({ shorizon: k })}>{l}</button>)}</div>
      <div className="rows mono">
        <div className="row"><span>Spectateurs (dernier relevé)</span><b>{nf0.format(px)}</b></div>
        <div className="row"><span>1 % de variation</span><b>±{W(stake * pref.lev / 100)}</b></div>
        <div className="row"><span>Liquidation à</span><b>{nf0.format(Math.round(liqPrice(b)))} spectateurs</b></div>
        <div className="row"><span>Fermeture automatique</span><b>{pref.shorizon === "live" ? "fin du live" : clock(now + +pref.shorizon * 60000)}</b></div>
      </div>
    </>;
  } else {
    const d = ticket.duel, x = engine.BY[d[ticket.side]], y = engine.BY[d[ticket.side === "a" ? "b" : "a"]], o = d["o" + ticket.side];
    title = `${x.name} bat ${y.name}`;
    cta = `Parier ${W(stake)} à ${nf2.format(o)}`;
    body = <div className="rows mono"><div className="row"><span>Cote</span><b>{nf2.format(o)}</b></div><div className="row"><span>Gain si {x.name} fait plus de vues</span><b>{W(stake * o)}</b></div></div>;
  }
  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="sheet" role="dialog" aria-modal="true" aria-label={title} onSubmit={async e => {
        e.preventDefault(); if (!ok) return; setBusy(true); set({ stake });
        await onSubmit(isTrade ? { tk: ticket.tk, dir, lev: pref.lev, stake }
          : isStream ? { login: ticket.login, dir, lev: pref.lev, stake, horizon: pref.shorizon }
          : isQ ? { market: ticket.market.id, side, stake }
          : { duel: ticket.duel.id, side: ticket.side, stake });
        setBusy(false);
      }}>
        <div className="sheet-h"><h2>{title}</h2><button type="button" className="x" onClick={onClose} aria-label="Fermer">×</button></div>
        {body}
        <label htmlFor="stake">Mise</label>
        <div className="stake"><input id="stake" className="mono" type="number" inputMode="numeric" min="1" step="1" value={stake} onChange={e => setStake(Math.max(0, Math.floor(+e.target.value || 0)))} /><span>W</span></div>
        <div className="chips">{[100, 500, 1000].map(v => <button key={v} type="button" onClick={() => setStake(v)}>{nf0.format(v)}</button>)}<button type="button" onClick={() => setStake(Math.floor(me.cash))}>Max</button></div>
        {!open && <p className="error small">{isQ ? "Les paris sur cette question sont fermés." : isStream ? "Ce streamer n'est plus en live." : "Séance fermée, reprise dans quelques secondes."}</p>}
        {stake > me.cash && <p className="error small">Solde insuffisant : il te manque {W(stake - me.cash)}.</p>}
        <button type="submit" className={"btn big " + (isPos ? (dir === "up" ? "buy" : "sell") : isQ ? (side === "yes" ? "buy" : "sell") : "primary")} disabled={!ok || busy}>{cta}</button>
      </form>
    </div>
  );
}
