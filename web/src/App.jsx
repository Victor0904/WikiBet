import { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from "react";
import data from "./pageviews.json";
import { createEngine, tradeValue, liqPrice, LEVS, BK_LIMIT, CAP0, EPOCH, CYCLE_MS } from "./engine.js";
import { connect } from "./api.js";
import { TradeChart, PositionChart, Spark } from "./charts.jsx";
import { nf0, nf2, W, sW, clock, HOME_NAMES, THEMES, DEFAULT_ACCENT } from "./format.js";
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
// Variation du nombre de spectateurs sur les 15 dernières minutes.
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
  const [pref, setPref] = useState({ lev: 5, shorizon: "15", stake: 500 });
  const say = useCallback((text, tone) => { setToast({ text, tone, at: Date.now() }) }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2600); return () => clearTimeout(id) }, [toast]);

  const [catalog, setCatalog] = useState([]), [inv, setInv] = useState({}), [rain, setRain] = useState(0), [visit, setVisit] = useState(null);
  useEffect(() => { api.shopItems().then(setCatalog).catch(() => {}) }, [api]);
  const known = useRef(null); // statut de chaque pari au chargement précédent, pour fêter les gains
  const refresh = useCallback(async () => {
    try {
      const [m, b, l, i] = await Promise.all([api.me(), api.myBets(s.k - 30), api.leaderboard(), api.inventoryOf(api.uid).catch(() => [])]);
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

  return (
    <div className="app">
      <header className="top">
        <span className="logo">wiki<b>·</b>bourse</span>
        {api.mode === "demo" && <span className="tag">démo locale</span>}
        <span className="me">{me.pseudo}{myTitle && <small>{myTitle}</small>}</span>
        <span className="cash mono">{W(me.cash)}</span>
      </header>

      <SessionBar s={s} now={now} engine={engine} />
      {kickoff && <div className="kickoff">Coup d'envoi · {sessName(s.k)}</div>}

      <div className="layout">
        <aside className="rail">
          <Positions engine={engine} s={s} now={now} byLogin={byLogin} bets={open} onClose={b => run(() => api.closeTrade(b.id), r => `Clôturée : ${sW(r.payout - r.stake)}`)} />
          {!s.playing && <SessionResults engine={engine} s={s} bets={bets} />}
        </aside>

        <main className="main">
          <nav className="tabs" aria-label="Sections">
            {[["market", "Marché"], ["streams", "Streamers"], ["duels", "Duels"], ["qg", "QG"], ["history", "Historique"], ["board", "Classement"]].map(([k, l]) =>
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </nav>
          {tab === "market" && <Market engine={engine} s={s} bets={open} onPick={(tk, dir) => setTicket({ kind: "trade", tk, dir })} />}
          {tab === "streams" && <Streams streams={streams} markets={markets} mode={api.mode} bets={open} now={now} onPick={(market, side) => setTicket({ kind: "question", market, side })} />}
          {tab === "duels" && <Duels engine={engine} s={s} onPick={(duel, side) => setTicket({ kind: "duel", duel, side })} />}
          {tab === "history" && <History engine={engine} byLogin={byLogin} bets={bets.filter(b => b.status !== "open")} />}
          {tab === "board" && <Board board={board} me={me} open={open} onVisit={visitQG} onRestart={() => run(() => api.restart(), () => `Nouveau départ : ${W(CAP0)}`)} />}
          {tab === "qg" && <Suspense fallback={<p className="muted pad">Chargement du QG…</p>}>
            {visit
              ? <QG api={api} catalog={catalog} inv={visit.inv} owner={visit.row} self={false} patrimoine={visit.row.patrimoine} pnl={null}
                  accent={THEMES[catalog.find(i => i.category === "theme" && visit.inv[i.id]?.equipped)?.id] ?? DEFAULT_ACCENT} onBack={() => setVisit(null)} />
              : <QG api={api} catalog={catalog} inv={inv} me={me} owner={{ pseudo: me.pseudo, title: myTitle }} self patrimoine={me.cash + openStake + objectsValue}
                  openStake={openStake} pnl={pnl} accent={accent} act={run} />}
          </Suspense>}
          <p className="fine">
            Séances rejouées sur les vues réelles de Wikipédia en français (API Wikimedia, du {engine.dateOf(0).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })} au {engine.dateOf(engine.END).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}, licence CC0).
            Les clôtures et les duels sont réels. Le mouvement minute par minute entre deux clôtures est simulé, identique pour tous les joueurs. Monnaie fictive, impossible à acheter.
          </p>
        </main>
      </div>

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
function Positions({ engine, s, now, byLogin, bets, onClose }) {
  if (!bets.length) return <div className="panel empty-pos"><h2>Mes positions</h2><p className="muted">Aucune position ouverte. Choisis un article et prends position à la hausse ou à la baisse.</p></div>;
  const list = [...bets].sort((a, b) => (b.kind !== "duel") - (a.kind !== "duel") || b.id - a.id);
  return (
    <section className="panel">
      <h2>Mes positions <span className="muted">{bets.length} en cours</span></h2>
      <div className="pos-list">
        {list.map(b => b.kind === "trade" ? <TradeCard key={b.id} engine={engine} s={s} b={b} onClose={onClose} />
          : b.kind === "stream" ? <StreamCard key={b.id} b={b} st={byLogin[b.login]} now={now} onClose={onClose} />
          : b.kind === "question" ? <QuestionCard key={b.id} b={b} st={byLogin[b.login]} now={now} />
          : <DuelCard key={b.id} engine={engine} b={b} />)}
      </div>
    </section>
  );
}

function TradeCard({ engine, s, b, onClose }) {
  const st = liveTrade(engine, b, s), net = st.value - b.stake, name = engine.BY[b.tk].name;
  const [busy, setBusy] = useState(false);
  return (
    <article className={"pos " + (net >= 0 ? "gain" : "loss")}>
      <div className="pos-h">
        <b>{name}</b>
        <span className={"side " + b.dir}>{b.dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×{b.lev}</span>
      </div>
      <div className="pos-pnl mono"><span className={cls(net)}>{sW(net)}</span><span className={cls(net)}>{pct(net / b.stake)}</span></div>
      <TradeChart b={b} path={engine.pathOf(b.tk, b.day)} upto={st.upto} />
      <div className="pos-x mono">
        <span>{hhmm(b.start_tick)} · entrée {nf2.format(b.entry)}</span>
        <span>{st.liquidated ? "liquidée" : `${hhmm(st.upto)} · ${nf2.format(st.px)}`}</span>
        <span>fin de séance</span>
      </div>
      {st.due
        ? <p className="muted small">{st.liquidated ? "Liquidée, règlement en cours…" : "Échéance atteinte, règlement en cours…"}</p>
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
      <div className="pos-x mono">
        <span>{clock(t0)} · {nf0.format(b.entry)} spect.</span>
        <span>{x.liquidated ? "liquidée" : `${clock(x.pts[x.pts.length - 1][0])} · ${nf0.format(x.px)}`}</span>
        <span>{b.end_at ? `fin ${clock(end)}` : "fin du live"}</span>
      </div>
      {x.due
        ? <p className="muted small">{x.liquidated ? "Liquidée, règlement en cours…" : st && !st.live ? "Live terminé, règlement en cours…" : "Échéance atteinte, règlement en cours…"}</p>
        : <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onClose(b); setBusy(false) }}>Clôturer · {W(x.value)}</button>}
    </article>
  );
}

function QuestionCard({ b, st, now }) {
  const t0 = Date.parse(b.created_at), end = Date.parse(b.end_at), upto = Math.min(now, end), pts = [[t0, b.entry]];
  if (st) st.ts.forEach((t, i) => { if (t > t0 && t <= upto) pts.push([t, st.vs[i]]) });
  const [at, cur] = pts[pts.length - 1], winning = (b.side === "yes") === (cur > b.threshold);
  return (
    <article className={"pos " + (winning ? "gain" : "loss")}>
      <div className="pos-h">
        <b className="who">{st?.avatar && <img className="avatar sm" src={st.avatar} alt="" />}{st?.display_name ?? b.login}</b>
        <span className={"side " + (b.side === "yes" ? "up" : "down")}>{b.side === "yes" ? "Oui" : "Non"} · {nf2.format(b.odds)}</span>
      </div>
      <p className="small">Plus de <b className="mono">{nf0.format(b.threshold)}</b> spectateurs à <b className="mono">{clock(end)}</b> ?</p>
      <div className="pos-q mono"><span className={winning ? "up" : "down"}>{winning ? "gagnant" : "perdant"} pour l'instant</span><span>{nf0.format(cur)} / {nf0.format(b.threshold)}</span></div>
      <PositionChart id={b.id} entry={b.threshold} dir={b.side === "yes" ? "up" : "down"} pts={pts} x0={t0} x1={end} />
      <div className="pos-x mono"><span>chiffre Twitch de {clock(at)}</span><span>mise {W(b.stake)}</span><span>gain {W(b.stake * b.odds)}</span></div>
      {now >= end && <p className="muted small">Échéance passée, règlement au prochain chiffre Twitch…</p>}
    </article>
  );
}

function Streams({ streams, markets, mode, bets, now, onPick }) {
  const [slot, setSlot] = useState(null);
  if (!streams.length) return <p className="muted pad">{mode === "demo"
    ? "Les streamers Twitch ne sont disponibles qu'en ligne : la démo locale n'a pas accès à Twitch."
    : "Aucun relevé Twitch pour l'instant. La relève tourne chaque minute, reviens dans un instant."}</p>;
  const slots = [...new Set(markets.map(m => m.closes_at))].sort(), cur = slots.includes(slot) ? slot : slots[0];
  const byL = Object.fromEntries(streams.map(x => [x.login, x])), lastTick = Math.max(...streams.map(x => Date.parse(x.at)));
  const mine = login => bets.some(b => (b.kind === "question" || b.kind === "stream") && b.login === login);
  const list = markets.filter(m => m.closes_at === cur && byL[m.login]?.live).map(m => ({ m, x: byL[m.login] }))
    .sort((a, b) => mine(b.x.login) - mine(a.x.login) || b.x.viewers - a.x.viewers);
  return (
    <section>
      <div className="feed-info"><i className="pulse" aria-hidden="true" />Chiffres Twitch réels, que Twitch met à jour toutes les 1 à 3 min · dernier relevé {ago(now - lastTick)}</div>
      <p className="muted small">Le live dépassera-t-il le seuil à l'heure dite ? Réponds Oui ou Non : la cote est figée au moment du pari. Paris fermés 5 min avant l'échéance.</p>
      {slots.length > 0 && <div className="chips" role="group" aria-label="Échéance">
        {slots.map(t => <button key={t} type="button" aria-pressed={t === cur} onClick={() => setSlot(t)}>à {clock(Date.parse(t))}</button>)}
      </div>}
      {!list.length && <p className="muted pad">Les questions arrivent avec le prochain relevé Twitch.</p>}
      <div className="qlist">
        {list.map(({ m, x }) => (
          <article key={m.id} className={"qcard" + (mine(x.login) ? " mine" : "")}>
            <div className="qhead">
              <span className="who">
                {x.avatar ? <img className="avatar" src={x.avatar} alt="" loading="lazy" /> : <span className="avatar" />}
                <span><b>{x.display_name}</b><small title={x.title || ""}>{x.game || "en live"}</small></span>
              </span>
              <span className="r mono"><b>{nf0.format(x.viewers)}</b><small>chiffre de {clock(twitchAt(x))}</small></span>
            </div>
            {x.vs.length > 1 && <Spark path={x.vs} t={x.vs.length - 1} h={24} />}
            <p className="qtext">Plus de <b className="mono">{nf0.format(m.threshold)}</b> spectateurs à <b className="mono">{clock(Date.parse(m.closes_at))}</b> ?</p>
            <div className="qbtns">
              <button type="button" className="buy" onClick={() => onPick(m, "yes")}><span>Oui</span><b className="mono">{nf2.format(m.odds_yes)}</b></button>
              <button type="button" className="sell" onClick={() => onPick(m, "no")}><span>Non</span><b className="mono">{nf2.format(m.odds_no)}</b></button>
            </div>
          </article>
        ))}
      </div>
      <p className="fine">Spectateurs Twitch réels (API Twitch), relevés chaque minute. Une question se règle sur le dernier chiffre Twitch avant l'heure annoncée ; si le live est terminé, c'est Non. Cote calculée sur l'écart au seuil, le temps restant et la volatilité du live sur la dernière heure, marge de 7 %.</p>
    </section>
  );
}

function DuelCard({ engine, b }) {
  const du = engine.makeDuels(b.day).find(x => x.id === b.duel_id);
  const [w, o] = b.side === "a" ? [du.a, du.b] : [du.b, du.a];
  return (
    <article className="pos">
      <div className="pos-h"><b>{engine.BY[w].name}</b><span className="side duel">duel</span></div>
      <p className="muted small">bat {engine.BY[o].name} en vues · réglé à la fin de la séance</p>
      <div className="pos-x mono"><span>mise {W(b.stake)} · cote {nf2.format(b.odds)}</span><span>gain {W(b.stake * b.odds)}</span></div>
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
  const [sector, setSector] = useState("Tout");
  const sectors = ["Tout", ...new Set(engine.STOCKS.map(x => x.sector))];
  const mine = tk => bets.find(b => b.kind === "trade" && b.tk === tk);
  const rows = engine.STOCKS.filter(x => sector === "Tout" || x.sector === sector)
    .map(x => { const p = engine.pathOf(x.tk, s.d); return { x, p, px: p[s.t], chg: p[s.t] / p[0] - 1 } })
    .sort((a, b) => !!mine(b.x.tk) - !!mine(a.x.tk) || Math.abs(b.chg) - Math.abs(a.chg));
  return (
    <section>
      <div className="chips" role="group" aria-label="Catégories">
        {sectors.map(x => <button key={x} type="button" aria-pressed={sector === x} onClick={() => setSector(x)}>{x}</button>)}
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

function Board({ board, me, open, onRestart, onVisit }) {
  const total = me.cash + open.reduce((a, b) => a + b.stake, 0);
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
      <div className="panel bk">
        <p><b>Faillite</b> Sous {W(BK_LIMIT)} (solde et mises en cours), tu peux repartir à {W(CAP0)}. Tes objets restent à toi. Le compteur s'affiche dans le classement.</p>
        <button type="button" className="btn" disabled={total >= BK_LIMIT} onClick={onRestart}>Repartir</button>
      </div>
      <p className="fine">Classement au patrimoine : solde, mises en cours et 60 % du prix des objets du QG. Touche un joueur pour visiter son QG. Salaire de 500 W à la fin de chaque séance où tu as parié.</p>
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
        <div className="row"><span>Fermeture automatique</span><b>fin de séance, dans {mmss(s.endsAt - now)}</b></div>
      </div>
    </>;
  } else if (isQ) {
    const m = ticket.market, x = byLogin[m.login], o = side === "yes" ? m.odds_yes : m.odds_no, end = Date.parse(m.closes_at);
    title = `${x?.display_name ?? m.login} : plus de ${nf0.format(m.threshold)} spectateurs à ${clock(end)} ?`;
    cta = `${side === "yes" ? "Oui" : "Non"} à ${nf2.format(o)} · ${W(stake)}`;
    body = <>
      <div className="seg" role="group" aria-label="Réponse">
        <button type="button" aria-pressed={side === "yes"} className="buy" onClick={() => setSide("yes")}>Oui · {nf2.format(m.odds_yes)}</button>
        <button type="button" aria-pressed={side === "no"} className="sell" onClick={() => setSide("no")}>Non · {nf2.format(m.odds_no)}</button>
      </div>
      <div className="rows mono">
        <div className="row"><span>Spectateurs (chiffre de {x ? clock(twitchAt(x)) : "—"})</span><b>{x ? nf0.format(x.viewers) : "—"}</b></div>
        <div className="row"><span>Seuil</span><b>{nf0.format(m.threshold)}</b></div>
        <div className="row"><span>Gain si {side === "yes" ? "Oui" : "Non"}</span><b>{W(stake * o)}</b></div>
        <div className="row"><span>Paris fermés à</span><b>{clock(end - 300000)}</b></div>
      </div>
      <p className="muted small">Réglé sur le dernier chiffre Twitch avant {clock(end)} ; si le live est terminé, c'est Non. La cote bouge avec l'audience et le temps : celle retenue s'affiche après validation.</p>
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
