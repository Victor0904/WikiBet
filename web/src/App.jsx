import { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from "react";
import { tradeValue, liqPrice, LEVS, BK_LIMIT, CAP0, EPOCH, CYCLE_MS } from "./engine.js";
import { connect } from "./api.js";
import { PositionChart, Spark } from "./charts.jsx";
import { nf0, nf2, W, sW, clock, pct, cls, HOME_NAMES, THEMES, DEFAULT_ACCENT, PERKS } from "./format.js";
import { useAurelys } from "./aurelys.js";
import { AurelysMarket, AurelysDetail, AurelysCard, aurLive, aurCap, px as aurPx } from "./AurelysUI.jsx";
import { BY as AUR, slipEstimate, FEE } from "../supabase/functions/_shared/aurelys.js";
import { Dock, Segmented, SubHeader } from "./nav.jsx";
import { MoreMenu, HowTo, Account, Legal } from "./pages.jsx";
import { Ranking, Friends, Guilds, LoginPanel } from "./social.jsx";
const QG = lazy(() => import("./QG.jsx")); // Three.js n'est chargé qu'à l'ouverture du QG

/* ===== Formats ===== */
// Une séance se nomme par son heure de début réelle (« séance de 14:32 »), plus parlante que son numéro.
const sessName = k => { const d = new Date(EPOCH + k * CYCLE_MS), t = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `séance de ${t}` : `séance du ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${t}` };
const STREAM_H = { "15": "15 min", "60": "1 h", live: "fin du live" };
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") };

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
// Question « pic du jour » : échéance à 23:59:59 (les questions à l'heure tombent sur des quarts d'heure ronds).
const isPeak = m => new Date(m.end_at ?? m.closes_at).getSeconds() === 59;
const srcOf = login => login?.startsWith("steam:") ? SRC.steam : SRC.twitch;
// Variation du nombre de spectateurs (ou de joueurs) sur les 15 dernières minutes.
function chg15(x) {
  if (!x.live || !x.vs.length) return 0;
  const lim = Date.parse(x.at) - 15 * 60000; let ref = x.vs[0];
  x.ts.forEach((t, i) => { if (t <= lim) ref = x.vs[i] });
  return ref ? x.viewers / ref - 1 : 0;
}

export default function App() {
  const [api, setApi] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { connect().then(setApi, e => setErr(e.message)) }, []);
  if (err) return <div className="center"><p className="error">{err}</p></div>;
  if (!api) return <div className="center"><p className="muted">Connexion au marché…</p></div>;
  return <Game api={api} />;
}

function Game({ api }) {
  const [now, setNow] = useState(api.now());
  useEffect(() => { const id = setInterval(() => setNow(api.now()), 250); return () => clearInterval(id) }, [api]);
  const k = Math.floor((now - EPOCH) / CYCLE_MS); // numéro de séance de 11 min : sert au salaire et à la profondeur de l'historique

  const [me, setMe] = useState(undefined), [bets, setBets] = useState([]), [board, setBoard] = useState([]);
  const [toast, setToast] = useState(null), [tab, setTab] = useState("market"), [ticket, setTicket] = useState(null);
  const [aurDetail, setAurDetail] = useState(null), [liveSrc, setLiveSrc] = useState("twitch"), [posView, setPosView] = useState("open"), [more, setMore] = useState(null);
  useEffect(() => { if (api.account?.landed) { setTab("more"); setMore("account") } }, [api]); // retour d'un lien e-mail
  // « Comment jouer » s'ouvre tout seul à la première visite.
  const [firstVisit, setFirstVisit] = useState(() => { try { return !localStorage.getItem("wb-howto") } catch { return false } });
  const [pref, setPref] = useState({ lev: 5, shorizon: "15", stake: 500 });
  const say = useCallback((text, tone) => { setToast({ text, tone, at: Date.now() }) }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2600); return () => clearTimeout(id) }, [toast]);

  const [holds, setHolds] = useState([]), [invest, setInvest] = useState(null); // portefeuille d'actions (sans levier)
  const [catalog, setCatalog] = useState([]), [inv, setInv] = useState({}), [rain, setRain] = useState(0), [visit, setVisit] = useState(null);
  useEffect(() => { if (!catalog.length) api.shopItems().then(setCatalog).catch(() => {}) }, [api, board, catalog.length]); // réessaie à chaque rafraîchissement tant qu'il est vide
  const known = useRef(null); // statut de chaque pari au chargement précédent, pour fêter les gains
  // Logement : il fixe la profondeur de l'historique et le nombre d'alertes de prix (avantages durables).
  const homeLevel = Math.max(0, ...catalog.filter(i => i.kind === "home" && (inv[i.id]?.qty ?? 0) > 0).map(i => i.level)), perks = PERKS[homeLevel];
  const histFrom = k - Math.round(perks.hist * 1440 / 11); // séances de 11 min
  const refresh = useCallback(async () => {
    try {
      const [m, b, l, i, h] = await Promise.all([api.me(), api.myBets(histFrom), api.leaderboard().catch(() => []), api.inventoryOf(api.uid).catch(() => []), api.myHoldings().catch(() => [])]); // classement, QG, portefeuille : facultatifs, le jeu tourne sans
      const prev = known.current, won = prev ? b.filter(x => x.status === "won" && prev.get(x.id) === "open") : [];
      known.current = new Map(b.map(x => [x.id, x.status]));
      setMe(m); setBets(b); setBoard(l); setInv(Object.fromEntries(i.map(r => [r.item_id, r]))); setHolds(h.map(x => ({ ...x, qty: +x.qty, cost: +x.cost, price: +x.price })));
      if (won.length) { setToast({ text: `Gagné : ${sW(won.reduce((a, x) => a + x.payout - x.stake, 0))}`, tone: "up", at: Date.now() }); setRain(Date.now()) }
    } catch (e) { say(e.message, "down") }
  }, [api, histFrom, say]);
  useEffect(() => { refresh(); return api.onChange(refresh) }, [api, refresh]);

  // Lives Twitch : relevés côté serveur chaque minute, rechargés ici toutes les 20 s.
  const [streams, setStreams] = useState([]), [markets, setMarkets] = useState([]);
  const loadStreams = useCallback(() => Promise.all([api.streamBoard(), api.openMarkets().catch(() => [])]).then(([b, m]) => { setStreams(b); setMarkets(m) }).catch(() => {}), [api]);
  useEffect(() => { loadStreams(); const id = setInterval(loadStreams, 20000); return () => clearInterval(id) }, [loadStreams]);
  const byLogin = useMemo(() => Object.fromEntries(streams.map(x => [x.login, x])), [streams]);
  // Bourse d'Aurelys : cours à la seconde quand on la regarde ou qu'on y a une position, sinon toutes les 10 s.
  // Alertes de prix (Aurelys) : gardées dans ce navigateur, nombre selon le logement.
  const [alerts, setAlerts] = useState(() => { try { return JSON.parse(localStorage.getItem("wb-alerts")) ?? [] } catch { return [] } });
  useEffect(() => { try { localStorage.setItem("wb-alerts", JSON.stringify(alerts)) } catch { } }, [alerts]);
  const aur = useAurelys(api, tab === "market" || !!aurDetail || alerts.length > 0 || bets.some(b => b.status === "open" && b.kind === "aurelys"));
  const beat = Math.floor(now / 2500);
  useEffect(() => {
    const hit = alerts.filter(a => { const p = aur.quotes[a.tk]?.p; return p != null && (a.above ? p >= a.price : p <= a.price) });
    if (!hit.length) return;
    say(hit.map(a => `Alerte : ${AUR[a.tk].name} ${a.above ? "au-dessus" : "en dessous"} de ${aurPx(a.price)}`).join(" · "), "up");
    setAlerts(l => l.filter(a => !hit.includes(a)));
  }, [beat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Règlement des questions et positions du Live : à l'échéance, et toutes les 15 s.
  const due = bets.filter(b => b.status === "open" && (b.kind === "stream" ? liveStream(b, byLogin[b.login], now).due : b.kind === "question" && now >= Date.parse(b.end_at))).length;
  const settle = useCallback(() => api.settle().then(refresh).catch(() => {}), [api, refresh]);
  useEffect(() => { if (due) settle() }, [due, settle]);
  useEffect(() => { const id = setInterval(settle, 15000); return () => clearInterval(id) }, [settle]);

  const run = async (fn, ok) => { try { const r = await fn(); if (ok) say(ok(r), "up"); await refresh(); return r } catch (e) { say(e.message, "down") } };
  const open = bets.filter(b => b.status === "open");
  const equipped = cat => catalog.find(i => i.category === cat && inv[i.id]?.equipped);
  const accent = THEMES[equipped("theme")?.id] ?? DEFAULT_ACCENT, myTitle = equipped("title")?.name, effect = equipped("effect")?.id;
  useEffect(() => { document.documentElement.style.setProperty("--accent", accent) }, [accent]);
  const openStake = open.reduce((a, b) => a + b.stake, 0);
  const objectsValue = catalog.filter(i => i.kind !== "bonus" && (inv[i.id]?.qty ?? 0) > 0).reduce((a, i) => a + Math.floor(i.price * .6), 0);
  const positions = open.filter(b => b.kind === "stream" || b.kind === "aurelys");
  const pnl = positions.length ? Math.round(positions.reduce((a, b) => a + (b.kind === "aurelys" ? aurLive(b, aur.quotes[b.aur], aur.ticks[b.aur]).net
    : liveStream(b, byLogin[b.login], now).value - b.stake), 0)) : null;
  const visitQG = async row => {
    if (row.id === me.id) { setVisit(null); setTab("qg"); return }
    row = { ...row, patrimoine: row.patrimoine ?? board.find(b => b.id === row.id)?.patrimoine };
    try { const rows = await api.inventoryOf(row.id); setVisit({ row, inv: Object.fromEntries(rows.map(r => [r.item_id, r])) }); setTab("qg") } catch (e) { say(e.message, "down") }
  };

  if (me === undefined) return <div className="center"><p className="muted">Chargement…</p></div>;
  if (me === null) return <Onboarding api={api} onDone={refresh} />;

  const go = t => { setTab(t); if (t !== "more") setMore(null); window.scrollTo({ top: 0 }) };
  const feeOpen = r => r.kind === "aurelys" ? r.stake * r.lev * FEE : 0; // frais d'ouverture, en plus de la mise
  const closeTrade = b => run(() => b.kind === "aurelys" ? api.aurOrder({ action: "close", id: b.id }) : api.closeTrade(b.id),
    r => `Clôturée : ${sW(r.payout - r.stake - feeOpen(r))}${feeOpen(r) ? ` (frais ${W(r.fees)})` : ""}`);
  const howtoDone = () => { try { localStorage.setItem("wb-howto", "1") } catch { } setFirstVisit(false); setMore(null); setTab("market") };
  const holdPx = h => h.status === "listed" || h.status === "core" ? aur.quotes[h.tk]?.p ?? h.price : h.price; // cours en direct
  const patrimoine = me.cash + openStake + objectsValue + holds.reduce((a, h) => a + h.qty * holdPx(h), 0);
  const showHowto = firstVisit || (tab === "more" && more === "howto");

  return (
    <div className="app">
      <header className="top">
        <span className="logo">wiki<b>·</b>bourse</span>
        {api.mode === "demo" && <span className="tag">démo</span>}
        <button type="button" className="cash mono" onClick={() => { setTab("more"); setMore("account") }} aria-label="Mon compte">{W(me.cash)}</button>
      </header>

      <div className="layout">
        <aside className="rail">
          <Positions now={now} byLogin={byLogin} aur={aur} bets={open} onClose={closeTrade} />
        </aside>

        <main className="main">
          <div key={showHowto ? "howto" : tab + (more ?? "")} className="view-anim">
          {showHowto ? <HowTo first={firstVisit} onBack={firstVisit ? howtoDone : () => setMore(null)} /> : <>
          {(tab === "market" || tab === "live") && <MiniTicker now={now} byLogin={byLogin} aur={aur} bets={open} onOpen={() => { setPosView("open"); go("positions") }} />}

          {tab === "market" && <AurelysMarket aur={aur} now={now} bets={open} onPick={(tk, dir) => setTicket({ kind: "aurelys", tk, dir })} onDetail={setAurDetail} onSubscribe={tk => setInvest({ tk, mode: "round" })} />}

          {tab === "live" && <>
            <Segmented label="Live" value={liveSrc} onChange={setLiveSrc} options={[["twitch", "Twitch"], ["steam", "Steam"]]} />
            <Streams key={liveSrc} src={liveSrc} streams={streams} markets={markets} mode={api.mode} bets={open} now={now} onPick={(market, side) => setTicket({ kind: "question", market, side })} />
          </>}

          {tab === "positions" && <>
            <Segmented label="Mes paris" value={posView} onChange={setPosView} options={[["open", `En cours${open.length ? ` · ${open.length}` : ""}`], ["folio", "Portefeuille"], ["history", "Historique"]]} />
            {posView === "folio" ? <Portfolio holds={holds} px={holdPx} onSell={h => setInvest({ tk: h.tk, mode: "sell", qty: h.qty })} onBuy={tk => setInvest({ tk, mode: "buy" })} onMarket={() => go("market")} />
            : posView === "open" ? <>
              {open.length ? <Positions vertical now={now} byLogin={byLogin} aur={aur} bets={open} onClose={closeTrade} />
                : <div className="empty-state"><b>Aucun pari en cours</b><p className="muted">Prends position sur une action d'Aurelys ou réponds à une question en direct.</p>
                    <div className="empty-acts"><button type="button" className="btn primary" onClick={() => go("market")}>Marché</button><button type="button" className="btn" onClick={() => go("live")}>Live</button></div></div>}
            </> : <History byLogin={byLogin} bets={bets.filter(b => b.status !== "open")} />}
          </>}

          {tab === "qg" && <Suspense fallback={<p className="muted pad">Chargement du QG…</p>}>
            {visit
              ? <QG api={api} catalog={catalog} inv={visit.inv} owner={visit.row} self={false} patrimoine={visit.row.patrimoine} pnl={null}
                  accent={THEMES[catalog.find(i => i.category === "theme" && visit.inv[i.id]?.equipped)?.id] ?? DEFAULT_ACCENT} onBack={() => setVisit(null)} />
              : <QG api={api} catalog={catalog} inv={inv} me={me} owner={{ pseudo: me.pseudo, title: myTitle }} self patrimoine={patrimoine}
                  openStake={openStake} pnl={pnl} accent={accent} act={run} />}
          </Suspense>}

          {tab === "more" && (
            more === "board" ? <><SubHeader title="Classement" onBack={() => setMore(null)} /><Ranking api={api} me={me} onVisit={visitQG} wealth={<Board board={board} me={me} onVisit={visitQG} />} /></>
            : more === "friends" ? <Friends api={api} say={say} onVisit={visitQG} onBack={() => setMore(null)} />
            : more === "guilds" ? <Guilds api={api} me={me} say={say} onVisit={visitQG} onBack={() => setMore(null)} accent={accent} />
            : more === "account" ? <Account account={api.account} me={me} title={myTitle} patrimoine={patrimoine} openStake={openStake} objects={objectsValue} demo={api.mode === "demo"}
                canRestart={me.cash + openStake + catalog.filter(i => i.kind !== "home").reduce((a, i) => a + Math.floor(i.price * .6) * (inv[i.id]?.qty ?? 0), 0) < BK_LIMIT} onRestart={() => run(() => api.restart(), () => `Nouveau départ : ${W(CAP0)}`)} onBack={() => setMore(null)} />
            : more === "legal" ? <Legal onBack={() => setMore(null)} />
            : <MoreMenu go={setMore} me={me} title={myTitle} />)}
          </>}
          </div>
        </main>
      </div>

      <Dock tab={showHowto && firstVisit ? null : tab} setTab={t => { if (firstVisit) howtoDone(); go(t) }} badge={open.length} />

      {aurDetail && <AurelysDetail tk={aurDetail} aur={aur} api={api} now={now} alerts={alerts} setAlerts={setAlerts} alertsMax={perks.alerts} onClose={() => setAurDetail(null)} onPick={(tk, dir) => { setAurDetail(null); setTicket({ kind: "aurelys", tk, dir }) }}
        onInvest={tk => { setAurDetail(null); setInvest({ tk, mode: "buy" }) }} />}
      {invest && <InvestSheet {...invest} aur={aur} me={me} patrimoine={patrimoine} hold={holds.find(h => h.tk === invest.tk)} onClose={() => setInvest(null)}
        onDone={async (args, ok) => { const r = await run(() => args.mode === "round" ? api.aurSubscribe(args.tk, args.amount) : api.aurOrder(args.mode === "buy" ? { action: "buy", tk: args.tk, amount: args.amount } : { action: "sell", tk: args.tk, qty: args.qty }), () => ok); if (r) setInvest(null) }} />}
      {ticket && <Ticket api={api} aur={aur} now={now} byLogin={byLogin} me={me} ticket={ticket} pref={pref} setPref={setPref} onClose={() => setTicket(null)}
        onSubmit={async args => {
          const opened = b => `Position ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} ouverte · ${W(b.stake)}`;
          const r = ticket.kind === "aurelys" ? await run(() => api.aurOrder({ action: "open", ...args }), b => `${opened(b)} à ${aurPx(b.entry)} (frais ${W(b.fees)})`)
            : ticket.kind === "stream" ? await run(() => api.openStream(args), opened)
            : await run(() => api.betQuestion(args), b => `Pari validé : ${b.side === "yes" ? "Oui" : "Non"} à ${nf2.format(b.odds)} · ${W(b.stake)}`);
          if (ticket.kind === "stream" || ticket.kind === "question") loadStreams();
          if (r) setTicket(null);
        }} />}
      {toast && <div className={"toast " + (toast.tone || "")} role="status">{toast.text}</div>}
      {effect && <Rain kind={effect} at={rain} />}
    </div>
  );
}

// Bande compacte de mes paris en cours, en haut du Marché et du Live (sur mobile) : un appui ouvre l'onglet Positions.
function MiniTicker({ now, byLogin, aur, bets, onOpen }) {
  if (!bets.length) return null;
  const chip = b => {
    if (b.kind === "aurelys") { const net = aurLive(b, aur.quotes[b.aur], aur.ticks[b.aur]).net; return [b.aur, sW(net), cls(net)] }
    if (b.kind === "stream") { const net = liveStream(b, byLogin[b.login], now).value - b.stake; return [byLogin[b.login]?.display_name ?? b.login, sW(net), cls(net)] }
    if (b.kind === "question") { const st = byLogin[b.login], cur = st?.viewers ?? b.entry, win = (b.side === "yes") === (cur > b.threshold); return [st?.display_name ?? b.login, b.side === "yes" ? "Oui" : "Non", win ? "up" : "down"] }
    return [b.kind, W(b.stake), "flat"];
  };
  return (
    <button type="button" className="ticker" onClick={onOpen} aria-label="Voir mes paris en cours">
      {bets.slice(0, 8).map(b => { const [n, v, c] = chip(b); return <span key={b.id} className="tick"><b>{n}</b><span className={"mono " + c}>{v}</span></span> })}
    </button>
  );
}

function Onboarding({ api, onDone }) {
  const [pseudo, setPseudo] = useState(""), [err, setErr] = useState(null), [login, setLogin] = useState(!!api.account?.error);
  return (
    <div className="center">
      <form className="onboard" onSubmit={async e => { e.preventDefault(); try { await api.createProfile(pseudo); onDone() } catch (x) { setErr(x.message) } }}>
        <span className="logo big">wiki<b>·</b>bourse</span>
        <p className="muted">Une bourse inventée, Aurelys, dont les cours naissent des ordres des joueurs et des bots, et des questions en direct sur Twitch et Steam. Tu démarres avec {W(CAP0)}.</p>
        <label htmlFor="pseudo">Ton pseudo</label>
        <input id="pseudo" value={pseudo} onChange={e => setPseudo(e.target.value)} minLength={2} maxLength={20} required autoFocus />
        {err && <p className="error">{err}</p>}
        <button className="btn primary" type="submit">Entrer sur le marché</button>
      </form>
      {api.account && <div className="onboard">
        {api.account.error && <p className="error">{api.account.error}</p>}
        {login ? <LoginPanel account={api.account} /> : <button type="button" className="link" onClick={() => setLogin(true)}>Déjà un compte ? Se connecter</button>}
      </div>}
    </div>
  );
}

/* Mes positions en direct : toujours visibles, en tête sur mobile et dans la colonne de gauche sur grand écran. */
function Positions({ now, byLogin, aur, bets, onClose, vertical }) {
  if (!bets.length && !vertical) return <div className="panel empty-pos"><h2>Mes positions</h2><p className="muted">Aucune position ouverte. Choisis une action d'Aurelys et prends position à la hausse ou à la baisse.</p></div>;
  const list = [...bets].sort((a, b) => b.id - a.id);
  const cards = list.map(b => b.kind === "aurelys" ? <AurelysCard key={b.id} b={b} aur={aur} now={now} onClose={onClose} Facts={Facts} />
    : b.kind === "stream" ? <StreamCard key={b.id} b={b} st={byLogin[b.login]} now={now} onClose={onClose} />
    : <QuestionCard key={b.id} b={b} st={byLogin[b.login]} now={now} />);
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
  const peak = isPeak(b), at = pts[pts.length - 1][0], cur = peak ? Math.max(...pts.map(p => p[1])) : pts[pts.length - 1][1]; // pic du jour : le plus haut atteint
  const winning = (b.side === "yes") === (cur > b.threshold), S = srcOf(b.login);
  return (
    <article className={"pos " + (winning ? "gain" : "loss")}>
      <div className="pos-h">
        <b className="who">{st?.avatar && <img className="avatar sm" src={st.avatar} alt="" />}{st?.display_name ?? b.login}</b>
        <span className={"side " + (b.side === "yes" ? "up" : "down")}>{b.side === "yes" ? "Oui" : "Non"} · {nf2.format(b.odds)}</span>
      </div>
      <p className="small">{peak ? <>Pic d'aujourd'hui au-dessus de <b className="mono">{nf0.format(b.threshold)}</b> {S.unit} (le pic d'hier) ?</> : <>Plus de <b className="mono">{nf0.format(b.threshold)}</b> {S.unit} à <b className="mono">{clock(end)}</b> ?</>}</p>
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
  const slots = [...new Set(markets.filter(m => m.kind !== "peak").map(m => m.closes_at))].sort();
  if (markets.some(m => m.kind === "peak")) slots.push("peak");
  const cur = slots.includes(slot) ? slot : slots[0];
  const byL = Object.fromEntries(streams.map(x => [x.login, x])), lastTick = Math.max(...streams.map(x => Date.parse(x.at)));
  const mine = login => bets.some(b => (b.kind === "question" || b.kind === "stream") && b.login === login);
  const list = (cur === "peak" ? markets.filter(m => m.kind === "peak") : markets.filter(m => m.closes_at === cur && byL[m.login]?.live))
    .map(m => ({ m, x: byL[m.login] ?? { login: m.login, display_name: m.login, viewers: 0, vs: [], ts: [], live: false } }));
  // Ordre figé tant qu'on reste sur la même échéance, pour ne pas faire bouger les cartes sous le doigt.
  if (frozen.current.key !== src + cur || !frozen.current.logins.length) frozen.current = { key: src + cur, logins: [...list].sort((a, b) => b.x.viewers - a.x.viewers).map(r => r.x.login) };
  const rank = l => { const i = frozen.current.logins.indexOf(l); return i < 0 ? 1e9 : i };
  list.sort((a, b) => rank(a.x.login) - rank(b.x.login));
  return (
    <section>
      <div className="feed-info"><i className="pulse" aria-hidden="true" />{S.info} · dernier relevé {ago(now - lastTick)}</div>
      <p className="muted small">{S.intro}</p>
      {slots.length > 0 && <div className="chips" role="group" aria-label="Échéance">
        {slots.map(t => <button key={t} type="button" aria-pressed={t === cur} onClick={() => setSlot(t)}>{t === "peak" ? "★ Pic du jour" : `à ${clock(Date.parse(t))}`}</button>)}
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
            {m.kind === "peak"
              ? <p className="qtext">Pic d'aujourd'hui au-dessus de celui d'hier, <b className="mono">{nf0.format(m.threshold)}</b> {S.unit} ? <small className="muted">Paris jusqu'à {clock(Date.parse(m.bet_until))}, réglé à minuit.</small></p>
              : <p className="qtext">Plus de <b className="mono">{nf0.format(m.threshold)}</b> {S.unit} à <b className="mono">{clock(Date.parse(m.closes_at))}</b> ?</p>}
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





function History({ byLogin, bets }) {
  if (!bets.length) return <p className="muted pad">Tes paris réglés apparaîtront ici.</p>;
  return (
    <div className="history">
      {bets.map(b => {
        const net = b.payout - b.stake;
        // Anciens marchés (crypto, Wikipédia, duels) : retirés du jeu, gardés dans l'historique.
        const label = b.kind === "trade" ? `${b.tk} ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} · Wikipédia`
          : b.kind === "stream" ? `${byLogin[b.login]?.display_name ?? b.login} ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} · Twitch`
          : b.kind === "crypto" ? `${b.sym} ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} · crypto`
          : b.kind === "invest" ? `${AUR[b.aur]?.name ?? b.aur} · actions vendues${b.payout === 0 ? " (faillite)" : ""}`
          : "Duel Wikipédia";
        if (b.kind === "aurelys") return (
          <div key={b.id} className="hrow">
            <span><b>{AUR[b.aur]?.name ?? b.aur} {b.dir === "up" ? "▲" : "▼"} ×{b.lev} · Aurelys</b><small>{clock(Date.parse(b.created_at))} → {b.exit_at ? clock(Date.parse(b.exit_at)) : "—"} · {aurPx(b.entry)} → {b.exit != null ? aurPx(b.exit) : "—"} · frais {W(b.fees)}{b.payout === 0 ? " · liquidée" : ""}{b.insured ? " · assurée" : ""}</small></span>
            <span className="r mono"><b className={cls(net - b.stake * b.lev * FEE)}>{sW(net - b.stake * b.lev * FEE)}</b><small>mise {W(b.stake)}</small></span>
          </div>
        );
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
            <span><b>{label}</b><small>{sessName(b.session)}{b.fees ? ` · frais ${W(b.fees)}` : ""}{b.payout === 0 ? " · liquidée" : ""}{b.odds ? ` · cote ${nf2.format(b.odds)}` : ""}</small></span>
            <span className="r mono"><b className={cls(net - (b.kind === "crypto" ? b.stake * b.lev * FEE : 0))}>{sW(net - (b.kind === "crypto" ? b.stake * b.lev * FEE : 0))}</b><small>mise {W(b.stake)}</small></span>
          </div>
        );
      })}
    </div>
  );
}

// Portefeuille : actions achetées sans levier (cote principale, jeunes pousses, levées en attente d'introduction).
function Portfolio({ holds, px, onSell, onBuy, onMarket }) {
  if (!holds.length) return <div className="empty-state"><b>Portefeuille vide</b><p className="muted">Ouvre la fiche d'une entreprise et choisis « Investir » : tu achètes des actions, sans levier, et tu les gardes aussi longtemps que tu veux. Certaines versent un dividende chaque jour d'Aurelys.</p>
    <div className="empty-acts"><button type="button" className="btn primary" onClick={onMarket}>Marché</button></div></div>;
  const tot = holds.reduce((a, h) => a + h.qty * px(h), 0), cost = holds.reduce((a, h) => a + h.cost, 0);
  return (
    <section>
      <div className="panel folio-head"><span>Valeur du portefeuille</span><b className="mono">{W(tot)}</b><small className={"mono " + cls(tot - cost)}>{sW(tot - cost)} ({pct(tot / cost - 1)}) depuis l'achat</small></div>
      <div className="history">
        {holds.map(h => {
          const p = px(h), val = h.qty * p, gain = val - h.cost, d = AUR[h.tk];
          return (
            <div key={h.tk} className="hrow folio-row">
              <span><b>{d?.name ?? h.tk}{h.status === "round" ? " · levée en cours" : h.status === "listed" ? " · jeune pousse" : ""}</b>
                <small>{nf2.format(h.qty)} actions · achat moyen {aurPx(h.cost / h.qty)} · cours {aurPx(p)}{d?.div ? ` · dividende ${nf2.format(d.div)} %/an` : ""}</small></span>
              <span className="r mono"><b>{W(val)}</b><small className={cls(gain)}>{sW(gain)}</small></span>
              {h.status !== "round" && <span className="folio-acts">
                <button type="button" className="btn ghost" onClick={() => onBuy(h.tk)}>Acheter</button>
                <button type="button" className="btn ghost" onClick={() => onSell(h)}>Vendre</button>
              </span>}
            </div>
          );
        })}
      </div>
      <p className="fine">Pas de levier, pas de liquidation : la valeur suit le cours. Les jeunes pousses peuvent faire faillite (sous 15 % de leur prix d'introduction), et leurs actions sont alors perdues. Frais de 0,1 % à l'achat et à la vente ; un gros ordre fait bouger le cours.</p>
    </section>
  );
}

// Acheter, vendre ou souscrire à une levée de fonds.
function InvestSheet({ tk, mode, qty: q0, aur, me, patrimoine, hold, onClose, onDone }) {
  const d = AUR[tk], round = mode === "round", sell = mode === "sell", [amount, setAmount] = useState(round ? 1000 : 500), [share, setShare] = useState(1), [busy, setBusy] = useState(false);
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onClose]);
  const p = round ? d?.roundPrice : aur.quotes[tk]?.p ?? 0, qty = sell ? (q0 ?? 0) * share : 0;
  const notional = sell ? qty * p : amount, sl = round ? 0 : slipEstimate(tk, notional, Date.now() / 1000, aur.x?.reg), fee = round ? 0 : notional * FEE;
  const exec = p * (1 + (sell ? -sl : sl)), maxRound = Math.max(0, Math.floor(.2 * patrimoine - (hold?.cost ?? 0)));
  const gate = round && patrimoine < 50000, ok = !busy && !gate && (sell ? qty > 0 : amount > 0 && amount + fee <= me.cash && (!round || amount <= maxRound));
  const title = round ? `Souscrire à ${d?.name}` : sell ? `Vendre des actions ${d?.name}` : `Investir dans ${d?.name}`;
  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="sheet" role="dialog" aria-modal="true" aria-label={title} onSubmit={async e => { e.preventDefault(); if (!ok) return; setBusy(true);
        await onDone({ mode, tk, amount, qty }, round ? `Souscription de ${W(amount)} à ${d?.name}` : sell ? `Vendu ${nf2.format(qty)} actions` : `${W(amount)} investis dans ${d?.name}`); setBusy(false) }}>
        <div className="sheet-h"><b>{title}</b><button type="button" className="x" onClick={onClose} aria-label="Fermer">×</button></div>
        {gate && <p className="error small">Les levées de fonds sont réservées aux joueurs qui ont 50 000 W de patrimoine (tu en as {W(patrimoine)}).</p>}
        {sell ? <>
          <label>Part à vendre</label>
          <div className="seg" role="group" aria-label="Part à vendre">{[[.25, "25 %"], [.5, "50 %"], [1, "Tout"]].map(([v, l]) => <button key={v} type="button" aria-pressed={share === v} onClick={() => setShare(v)}>{l}</button>)}</div>
        </> : <>
          <label htmlFor="inv-amount">Montant</label>
          <div className="stake"><input id="inv-amount" className="mono" type="number" inputMode="numeric" min="1" value={amount} onChange={e => setAmount(Math.max(0, Math.floor(+e.target.value || 0)))} /><span>W</span></div>
          <div className="chips">{[500, 2000, 10000].map(v => <button key={v} type="button" onClick={() => setAmount(v)}>{nf0.format(v)}</button>)}
            <button type="button" onClick={() => setAmount(round ? Math.min(maxRound, Math.floor(me.cash)) : Math.floor(me.cash / (1 + FEE)))}>Max</button></div>
        </>}
        <div className="rows mono">
          <div className="row"><span>{round ? "Prix de la levée" : "Cours actuel"}</span><b>{aurPx(p)}</b></div>
          {!round && <div className="row"><span>Impact de ton ordre (estimé)</span><b>{sell ? "−" : "+"}{nf2.format(sl * 100)} %</b></div>}
          <div className="row"><span>{sell ? "Actions vendues" : "Actions obtenues (environ)"}</span><b>{nf2.format(sell ? qty : amount / (exec || 1))}</b></div>
          {!round && <div className="row"><span>Frais (0,1 %)</span><b>{W(fee)}</b></div>}
          {sell && <div className="row"><span>Tu recevras (environ)</span><b>{W(qty * exec - fee)}</b></div>}
          {round && <div className="row"><span>Encore possible (20 % du patrimoine)</span><b>{W(maxRound)}</b></div>}
        </div>
        <p className="muted small">{round ? "Le premier cours sera fixé par le marché à l'introduction en bourse : il peut être bien au-dessus du prix de la levée… ou en dessous. Une jeune pousse peut aussi faire faillite."
          : "Sans levier : ta mise suit le cours, sans liquidation. Le prix exact est calculé par le serveur."}</p>
        <button type="submit" className={"btn big " + (sell ? "sell" : "buy")} disabled={!ok}>{round ? `Souscrire · ${W(amount)}` : sell ? `Vendre · ${W(qty * exec - fee)}` : `Acheter · ${W(amount)}`}</button>
      </form>
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

function Ticket({ api, aur, now, byLogin, me, ticket, pref, setPref, onClose, onSubmit }) {
  const [stake, setStake] = useState(pref.stake), [busy, setBusy] = useState(false), [dir, setDir] = useState(ticket.dir), [side, setSide] = useState(ticket.side);
  const isStream = ticket.kind === "stream";
  const st = isStream ? byLogin[ticket.login] : null;
  const set = p => setPref(x => ({ ...x, ...p }));
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onClose]);
  const isQ = ticket.kind === "question", isAur = ticket.kind === "aurelys";
  // Aurelys : le levier ×10 se débloque après 30 positions clôturées (vérifié par le serveur).
  const [xp, setXp] = useState(null);
  useEffect(() => { if (ticket.kind === "aurelys") api.aurXp().then(setXp).catch(() => setXp(0)) }, [api, ticket.kind]);
  const lev10 = !isAur || (xp ?? 0) >= 30;
  useEffect(() => { if (!lev10 && pref.lev === 10) setPref(x => ({ ...x, lev: 5 })) }, [lev10, pref.lev, setPref]);
  const fee = isAur ? stake * pref.lev * FEE : 0;
  const aq = isAur ? aur.quotes[ticket.tk] : null, overCap = isAur && stake * pref.lev > aurCap(ticket.tk);
  const open = isAur ? !!aq && !aq.halt && !overCap : isQ ? Date.parse(ticket.market.bet_until) > now : !!st?.live;
  const ok = stake > 0 && stake + fee <= me.cash && open;
  // Max : tout le solde, frais d'ouverture compris, et sans dépasser le plafond d'une action d'Aurelys.
  const maxStake = isAur ? Math.min(Math.floor(me.cash / (1 + pref.lev * FEE)), isAur ? Math.floor(aurCap(ticket.tk) / pref.lev) : Infinity) : Math.floor(me.cash);
  let body, title, cta;
  if (isAur) {
    const p = aq?.p ?? 0, sl = slipEstimate(ticket.tk, stake * pref.lev, now / 1000, aur.x?.reg), entry = p * (1 + (dir === "up" ? sl : -sl)), b = { entry, lev: pref.lev, dir, stake };
    title = AUR[ticket.tk].name;
    cta = `${dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×${pref.lev} · ${W(stake)}`;
    body = <>
      <div className="seg" role="group" aria-label="Sens">
        <button type="button" aria-pressed={dir === "up"} className="buy" onClick={() => setDir("up")}>▲ Hausse</button>
        <button type="button" aria-pressed={dir === "down"} className="sell" onClick={() => setDir("down")}>▼ Baisse</button>
      </div>
      <label>Levier</label>
      <div className="seg" role="group" aria-label="Levier">{LEVS.map(v => <button key={v} type="button" aria-pressed={pref.lev === v} disabled={v === 10 && !lev10} onClick={() => set({ lev: v })}>×{v}{v === 10 && !lev10 ? " 🔒" : ""}</button>)}</div>
      {!lev10 && xp != null && <p className="muted small">×10 se débloque après 30 positions clôturées sur Aurelys ({xp}/30).</p>}
      <div className="rows mono">
        <div className="row"><span>Cours actuel</span><b>{aurPx(p)}</b></div>
        <div className="row"><span>Impact de ton ordre (estimé)</span><b>{dir === "up" ? "+" : "−"}{nf2.format(sl * 100)} %</b></div>
        <div className="row"><span>Prix d'exécution estimé</span><b>{aurPx(entry)}</b></div>
        <div className="row"><span>1 % de variation</span><b>±{W(stake * pref.lev / 100)}</b></div>
        <div className="row"><span>Frais d'ouverture (0,1 %)</span><b>{W(fee)}</b></div>
        <div className="row"><span>Liquidation à</span><b>{aurPx(liqPrice(b))}</b></div>
        <div className="row"><span>Plafond sur cette action</span><b>{W(aurCap(ticket.tk))} engagés</b></div>
      </div>
      <p className="muted small">Ton ordre fait bouger le cours : plus il est gros, et plus l'action est peu liquide, plus tu paies cher (même chose à la clôture). Le prix exact est calculé par le serveur. La position reste ouverte jusqu'à ce que tu la clôtures, ou jusqu'à la liquidation.</p>
    </>;
  } else if (isQ) {
    const m = ticket.market, x = byLogin[m.login], o = side === "yes" ? m.odds_yes : m.odds_no, end = Date.parse(m.closes_at);
    const S = srcOf(m.login);
    title = m.kind === "peak" ? `${x?.display_name ?? m.login} : pic d'aujourd'hui au-dessus de ${nf0.format(m.threshold)} ${S.unit} ?` : `${x?.display_name ?? m.login} : plus de ${nf0.format(m.threshold)} ${S.unit} à ${clock(end)} ?`;
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
        <div className="row"><span>Paris fermés à</span><b>{clock(Date.parse(m.bet_until))}</b></div>
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
  }
  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="sheet" role="dialog" aria-modal="true" aria-label={title} onSubmit={async e => {
        e.preventDefault(); if (!ok) return; setBusy(true); set({ stake });
        await onSubmit(isAur ? { tk: ticket.tk, dir, lev: pref.lev, stake }
          : isStream ? { login: ticket.login, dir, lev: pref.lev, stake, horizon: pref.shorizon }
          : { market: ticket.market.id, side, stake });
        setBusy(false);
      }}>
        <div className="sheet-h"><h2>{title}</h2><button type="button" className="x" onClick={onClose} aria-label="Fermer">×</button></div>
        {body}
        <label htmlFor="stake">Mise</label>
        <div className="stake"><input id="stake" className="mono" type="number" inputMode="numeric" min="1" step="1" value={stake} onChange={e => setStake(Math.max(0, Math.floor(+e.target.value || 0)))} /><span>W</span></div>
        <div className="chips">{[100, 500, 1000].map(v => <button key={v} type="button" onClick={() => setStake(v)}>{nf0.format(v)}</button>)}<button type="button" onClick={() => setStake(maxStake)}>Max</button></div>
        {overCap && <p className="error small">Au plus {W(aurCap(ticket.tk))} engagés (mise × levier) sur cette action.</p>}
        {isAur && aq?.halt && <p className="error small">Cotation suspendue, reprise dans quelques secondes.</p>}
        {!open && !isAur && <p className="error small">{isQ ? "Les paris sur cette question sont fermés." : "Ce streamer n'est plus en live."}</p>}
        {stake + fee > me.cash && <p className="error small">Solde insuffisant : il te manque {W(stake + fee - me.cash)}{fee ? " (frais compris)" : ""}.</p>}
        <button type="submit" className={"btn big " + (isQ ? (side === "yes" ? "buy" : "sell") : dir === "up" ? "buy" : "sell")} disabled={!ok || busy}>{cta}</button>
      </form>
    </div>
  );
}
