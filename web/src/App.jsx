import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { liqPrice, BK_LIMIT, CAP0, EPOCH, CYCLE_MS } from "./engine.js";
import { connect } from "./api.js";
import { nf0, nf2, W, sW, clock, cls, HOME_NAMES, THEMES, DEFAULT_ACCENT, PERKS, AUTO_LV, TRIGGER_LV } from "./format.js";
import { useAurelys } from "./aurelys.js";
import { AurelysMarket, AurelysDetail, AurelysCard, aurLive, aurCap, px as aurPx } from "./AurelysUI.jsx";
import { BY as AUR, slipEstimate, FEE, gameClock } from "../supabase/functions/_shared/aurelys.js";
import { Dock, Segmented, SubHeader, Logo } from "./nav.jsx";
import { MoreMenu, HowTo, Account, Legal, PushPanel } from "./pages.jsx";
import { Ranking, Friends, Guilds, LoginPanel, BotTag } from "./social.jsx";
import Portfolio from "./Portfolio.jsx";
const QG = lazy(() => import("./QG.jsx")); // Three.js n'est chargé qu'à l'ouverture du QG

/* ===== Formats ===== */
// Une séance se nomme par son heure de début réelle (« séance de 14:32 »), plus parlante que son numéro.
const sessName = k => { const d = new Date(EPOCH + k * CYCLE_MS), t = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `séance de ${t}` : `séance du ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${t}` };

const AUR_LEVS = [1, 5, 10, 15, 20, 25];
// Montants cumulables : le premier appui remplace la mise affichée, les suivants s'ajoutent (10, 20, 30…).
// 10 000 n'apparaît qu'au-delà de 10 000 W de solde.
function StakeChips({ value, set, cash, max }) {
  const fresh = useRef(true), add = v => { set(fresh.current ? v : value + v); fresh.current = false };
  return (
    <div className="chips stake-chips">
      {[10, 100, 1000, ...(cash > 10000 ? [10000] : [])].map(v => <button key={v} type="button" onClick={() => add(v)}>+{nf0.format(v)}</button>)}
      <button type="button" onClick={() => { set(0); fresh.current = false }}>0</button>
      <button type="button" onClick={() => { set(max); fresh.current = false }}>Max</button>
    </div>
  );
} // leviers d'Aurelys (×20 et ×25 se débloquent)

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
  const [aurDetail, setAurDetail] = useState(null), [posView, setPosView] = useState("open"), [more, setMore] = useState(null);
  // « Comment jouer » s'ouvre tout seul à la première visite.
  const [firstVisit, setFirstVisit] = useState(() => { try { return !localStorage.getItem("wb-howto") } catch { return false } });
  const [pref, setPref] = useState({ lev: 5, shorizon: "15", stake: 500 });
  const say = useCallback((text, tone) => { setToast({ text, tone, at: Date.now() }) }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), toast.long ? 7000 : 2600); return () => clearTimeout(id) }, [toast]);

  const [holds, setHolds] = useState([]), [invest, setInvest] = useState(null), [triggers, setTriggers] = useState([]); // portefeuille d'actions (sans levier)
  const [catalog, setCatalog] = useState([]), [inv, setInv] = useState({}), [rain, setRain] = useState(0), [visit, setVisit] = useState(null);
  useEffect(() => { if (!catalog.length) api.shopItems().then(setCatalog).catch(() => {}) }, [api, board, catalog.length]); // réessaie à chaque rafraîchissement tant qu'il est vide
  const known = useRef(null), knownT = useRef(null); // statut de chaque pari au chargement précédent, pour fêter les gains
  // Logement : il fixe la profondeur de l'historique et le nombre d'alertes de prix (avantages durables).
  const homeLevel = Math.max(0, ...catalog.filter(i => i.kind === "home" && (inv[i.id]?.qty ?? 0) > 0).map(i => i.level)), perks = PERKS[homeLevel];
  const histFrom = k - Math.round(perks.hist * 1440 / 11); // séances de 11 min
  const refresh = useCallback(async () => {
    try {
      const [m, b, l, i, h, tg] = await Promise.all([api.me(), api.myBets(histFrom), api.leaderboard().catch(() => []), api.inventoryOf(api.uid).catch(() => []), api.myHoldings().catch(() => []), api.myTriggers().catch(() => [])]); // classement, QG, portefeuille : facultatifs, le jeu tourne sans
      const prev = known.current, ended = prev ? b.filter(x => x.status !== "open" && prev.get(x.id) === "open") : [];
      const won = ended.filter(x => x.status === "won" && !x.closed_by);
      known.current = new Map(b.map(x => [x.id, x.status]));
      const prevT = knownT.current; knownT.current = new Map(tg.map(g => [g.id, g.status]));
      const name = tk => AUR[tk]?.name ?? tk, side = x => `${x.dir === "up" ? "▲" : "▼"} ×${x.lev}`, net = x => x.payout - x.stake - (x.fee_open ?? 0);
      const notes = [
        ...ended.filter(x => x.closed_by === "liq").map(x => `Position liquidée : ${name(x.aur)} ${side(x)}, ${sW(net(x))}${x.insured ? " (assurée)" : ""}`),
        ...ended.filter(x => x.closed_by === "stop").map(x => `Stop touché : ${name(x.aur)} ${side(x)} clôturée à ${aurPx(x.exit)}, ${sW(net(x))}`),
        ...ended.filter(x => x.closed_by === "objectif").map(x => `Objectif atteint : ${name(x.aur)} ${side(x)} clôturée à ${aurPx(x.exit)}, ${sW(net(x))}`),
        ...(prevT ? tg.filter(g => prevT.get(g.id) === "wait" && g.status === "done").map(g => `Ordre exécuté : ${name(g.tk)} ${side(g)} ouverte`) : []),
        ...(prevT ? tg.filter(g => prevT.get(g.id) === "wait" && g.status === "failed").map(g => `Ordre refusé : ${name(g.tk)}. ${g.msg}`) : []),
      ];
      if (notes.length) setToast({ text: notes.join(" · "), tone: ended.some(x => x.closed_by === "liq" || x.closed_by === "stop") ? "down" : "up", at: Date.now(), long: true });
      setMe(m); setBets(b); setBoard(l); setInv(Object.fromEntries(i.map(r => [r.item_id, r]))); setHolds(h.map(x => ({ ...x, qty: +x.qty, cost: +x.cost, price: +x.price }))); setTriggers(tg);
      if (won.length && !notes.length) { setToast({ text: `Gagné : ${sW(won.reduce((a, x) => a + x.payout - x.stake, 0))}`, tone: "up", at: Date.now() }); setRain(Date.now()) }
    } catch (e) { say(e.message, "down") }
  }, [api, histFrom, say]);
  useEffect(() => { refresh(); return api.onChange(refresh) }, [api, refresh]);
  // Classement : toutes les 60 s (le temps réel ne suit plus que mon profil), pas quand l'onglet est caché.
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) api.leaderboard().then(setBoard).catch(() => {}) }, 60000); return () => clearInterval(id) }, [api]);
  // Présence : la ville de ta guilde allume tes fenêtres quand tu es connecté.
  useEffect(() => { const ping = () => api.touch?.().catch(() => {}); ping(); const id = setInterval(ping, 60000); return () => clearInterval(id) }, [api]);

  // Bourse d'Aurelys : cours à la seconde quand on la regarde ou qu'on y a une position, sinon toutes les 10 s.
  // Alertes de prix (Aurelys) : gardées dans ce navigateur, nombre selon le logement.
  const [alerts, setAlerts] = useState(() => { try { return JSON.parse(localStorage.getItem("wb-alerts")) ?? [] } catch { return [] } });
  useEffect(() => { try { localStorage.setItem("wb-alerts", JSON.stringify(alerts)) } catch { } }, [alerts]);
  const aur = useAurelys(api, tab === "market" || tab === "actions" || !!aurDetail || alerts.length > 0 || bets.some(b => b.status === "open" && b.kind === "aurelys"));
  const beat = Math.floor(now / 2500);
  useEffect(() => {
    const hit = alerts.filter(a => { const p = aur.quotes[a.tk]?.p; return p != null && (a.above ? p >= a.price : p <= a.price) });
    if (!hit.length) return;
    say(hit.map(a => `Alerte : ${AUR[a.tk].name} ${a.above ? "au-dessus" : "en dessous"} de ${aurPx(a.price)}`).join(" · "), "up");
    setAlerts(l => l.filter(a => !hit.includes(a)));
  }, [beat]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, ok) => { try { const r = await fn(); if (ok) say(ok(r), "up"); await refresh(); return r } catch (e) { say(e.message, "down") } };
  const open = bets.filter(b => b.status === "open");
  const equipped = cat => catalog.find(i => i.category === cat && inv[i.id]?.equipped);
  const accent = THEMES[equipped("theme")?.id] ?? DEFAULT_ACCENT, myTitle = equipped("title")?.name, effect = equipped("effect")?.id;
  useEffect(() => { document.documentElement.style.setProperty("--accent", accent) }, [accent]);
  // Positions ouvertes à leur valeur actuelle (frais de clôture déduits), comme le patrimoine en SQL (open_value).
  const openStake = open.reduce((a, b) => a + (b.kind === "aurelys" ? aurLive(b, aur.quotes[b.aur], aur.ticks[b.aur]).value : b.stake), 0);
  const objectsValue = catalog.filter(i => i.kind !== "bonus" && (inv[i.id]?.qty ?? 0) > 0).reduce((a, i) => a + Math.floor(i.price * .6), 0);
  const positions = open.filter(b => b.kind === "aurelys");
  const pnl = positions.length ? Math.round(positions.reduce((a, b) => a + aurLive(b, aur.quotes[b.aur], aur.ticks[b.aur]).net, 0)) : null;
  // Le QG vit avec la partie : une position par écran, l'ambiance du jour, l'heure et l'humeur d'Aurelys, la une du Courrier.
  const midnight = new Date().setHours(0, 0, 0, 0);
  const dayNet = bets.filter(b => b.status !== "open" && Date.parse(b.closed_at) >= midnight).reduce((a, b) => a + b.payout - b.stake - (b.fee_open ?? 0), 0) + (pnl ?? 0);
  const qgLive = {
    positions: positions.map(b => ({ label: AUR[b.aur]?.name ?? b.aur, pnl: aurLive(b, aur.quotes[b.aur], aur.ticks[b.aur]).net })),
    mood: Math.abs(dayNet) < 1 ? 0 : Math.sign(dayNet), hour: gameClock(now / 1000).hour, reg: aur.x?.reg ?? "calme",
    une: aur.news.find(n => n.cat !== "secteur" && Math.abs(n.sent) >= .3)?.title ?? aur.news[0]?.title ?? "",
  };
  const visitQG = async row => {
    if (row.id === me.id) { setVisit(null); setTab("qg"); return }
    row = { ...row, patrimoine: row.patrimoine ?? board.find(b => b.id === row.id)?.patrimoine };
    try { const rows = await api.inventoryOf(row.id); setVisit({ row, inv: Object.fromEntries(rows.map(r => [r.item_id, r])) }); setTab("qg") } catch (e) { say(e.message, "down") }
  };

  if (me === undefined) return <div className="center"><p className="muted">Chargement…</p></div>;
  if (me === null) return <Onboarding api={api} onDone={refresh} />;

  const go = t => { setTab(t); if (t !== "more") setMore(null); window.scrollTo({ top: 0 }) };
  const feeOpen = r => r.kind === "aurelys" ? r.stake * r.lev * FEE : 0; // frais d'ouverture, en plus de la mise
  const onAuto = homeLevel >= AUTO_LV ? (id, sl, tp) => run(() => api.aurSetAuto(id, sl, tp), () => sl == null && tp == null ? "Stop et objectif retirés." : "Stop et objectif enregistrés.") : null;
  const cancelTrigger = id => run(() => api.aurTriggerCancel(id), () => "Ordre annulé.");
  const closeTrade = b => run(() => b.kind === "aurelys" ? api.aurOrder({ action: "close", id: b.id }) : api.closeTrade(b.id),
    r => `Clôturée : ${sW(r.payout - r.stake - feeOpen(r))}${feeOpen(r) ? ` (frais ${W(r.fees)})` : ""}`);
  const howtoDone = () => { try { localStorage.setItem("wb-howto", "1") } catch { } setFirstVisit(false); setMore(null); setTab("market") };
  const holdPx = h => h.status === "listed" || h.status === "core" ? aur.quotes[h.tk]?.p ?? h.price : h.price; // cours en direct
  const holdsValue = holds.reduce((a, h) => a + h.qty * holdPx(h), 0), patrimoine = me.cash + openStake + objectsValue + holdsValue;
  const showHowto = firstVisit || (tab === "more" && more === "howto");

  return (
    <div className="app">
      <header className="top">
        <Logo />
        {api.mode === "demo" && <span className="tag">démo</span>}
        <button type="button" className="cash mono" onClick={() => { setTab("more"); setMore("account") }} aria-label="Mon compte">{W(me.cash)}</button>
      </header>

      <div className="layout">
        <aside className="rail">
          <Triggers list={triggers} onCancel={cancelTrigger} />
          <Positions now={now} aur={aur} bets={open} onClose={closeTrade} onAuto={onAuto} />
        </aside>

        <main className="main">
          <div key={showHowto ? "howto" : tab + (more ?? "")} className="view-anim">
          {showHowto ? <HowTo first={firstVisit} onBack={firstVisit ? howtoDone : () => setMore(null)} /> : <>
          {(tab === "market" || tab === "actions") && <MiniTicker aur={aur} bets={open} onOpen={() => { setPosView("open"); go("positions") }} />}

          {(tab === "market" || tab === "actions") && <AurelysMarket stocks={tab === "actions"} onList={() => go("actions")} aur={aur} now={now} bets={open} onPick={(tk, dir) => setTicket({ kind: "aurelys", tk, dir })} onDetail={setAurDetail} onSubscribe={tk => setInvest({ tk, mode: "round" })} />}

          {tab === "positions" && <>
            <Segmented label="Mes paris" value={posView} onChange={setPosView} options={[["open", `En cours${open.length ? ` · ${open.length}` : ""}`], ["folio", "Portefeuille"], ["history", "Historique"]]} />
            {posView === "folio" ? <Portfolio holds={holds} aur={aur} px={holdPx} onSell={h => setInvest({ tk: h.tk, mode: "sell", qty: h.qty })} onBuy={tk => setInvest({ tk, mode: "buy" })} onMarket={() => go("market")} />
            : posView === "open" ? <>
              {api.push && positions.length > 0 && <PushPanel push={api.push} compact />}
              <Triggers list={triggers} onCancel={cancelTrigger} />
              {open.length ? <Positions vertical now={now} aur={aur} bets={open} onClose={closeTrade} onAuto={onAuto} />
                : <div className="empty-state"><b>Aucun pari en cours</b><p className="muted">Prends position sur une action d'Aurelys.</p>
                    <div className="empty-acts"><button type="button" className="btn primary" onClick={() => go("market")}>Marché</button></div></div>}
            </> : <History bets={bets.filter(b => b.status !== "open")} />}
          </>}

          {tab === "qg" && <Suspense fallback={<p className="muted pad">Chargement du QG…</p>}>
            {visit
              ? <QG api={api} catalog={catalog} inv={visit.inv} owner={visit.row} self={false} patrimoine={visit.row.patrimoine} pnl={null}
                  accent={THEMES[catalog.find(i => i.category === "theme" && visit.inv[i.id]?.equipped)?.id] ?? DEFAULT_ACCENT} onBack={() => setVisit(null)} />
              : <QG api={api} catalog={catalog} inv={inv} me={me} owner={{ pseudo: me.pseudo, title: myTitle }} self patrimoine={patrimoine}
                  openStake={openStake} pnl={pnl} accent={accent} act={run} live={qgLive} />}
          </Suspense>}

          {tab === "more" && (
            more === "board" ? <><SubHeader title="Classement" onBack={() => setMore(null)} /><Ranking api={api} me={me} onVisit={visitQG} wealth={<Board board={board} me={me} onVisit={visitQG} />} /></>
            : more === "friends" ? <Friends api={api} say={say} onVisit={visitQG} onBack={() => setMore(null)} />
            : more === "guilds" ? <Guilds api={api} me={me} say={say} onVisit={visitQG} onBack={() => setMore(null)} accent={accent} />
            : more === "account" ? <Account account={api.account} push={api.push} me={me} title={myTitle} patrimoine={patrimoine} openStake={openStake} objects={objectsValue} demo={api.mode === "demo"}
                canRestart={me.cash + openStake + holdsValue + catalog.filter(i => i.kind !== "home").reduce((a, i) => a + Math.floor(i.price * .6) * (inv[i.id]?.qty ?? 0), 0) < BK_LIMIT} onRestart={() => run(() => api.restart(), () => `Nouveau départ : ${W(CAP0)}`)} onBack={() => setMore(null)} />
            : more === "legal" ? <Legal onBack={() => setMore(null)} />
            : <MoreMenu go={setMore} me={me} title={myTitle} />)}
          </>}
          </div>
        </main>
      </div>

      <Dock tab={showHowto && firstVisit ? null : tab} setTab={t => { if (firstVisit) howtoDone(); go(t) }} badge={open.length} />

      {aurDetail && <AurelysDetail tk={aurDetail} aur={aur} api={api} now={now} alerts={alerts} setAlerts={setAlerts} alertsMax={perks.alerts} onClose={() => setAurDetail(null)} onPick={(tk, dir) => { setAurDetail(null); setTicket({ kind: "aurelys", tk, dir }) }}
        onInvest={tk => { setAurDetail(null); setInvest({ tk, mode: "buy" }) }} />}
      {invest && <InvestSheet {...invest} api={api} aur={aur} me={me} hold={holds.find(h => h.tk === invest.tk)} onClose={() => setInvest(null)}
        onDone={async (args, ok) => { const r = await run(() => args.mode === "round" ? api.aurSubscribe(args.tk, args.amount) : api.aurOrder(args.mode === "buy" ? { action: "buy", tk: args.tk, amount: args.amount } : { action: "sell", tk: args.tk, qty: args.qty }), () => ok); if (r) setInvest(null) }} />}
      {ticket && <Ticket api={api} aur={aur} now={now} me={me} ticket={ticket} level={homeLevel} openCount={positions.length + triggers.filter(g => g.status === "wait").length} pref={pref} setPref={setPref} onClose={() => setTicket(null)}
        onSubmit={async args => {
          const r = args.px ? await run(() => api.aurTriggerAdd(args), g => `Ordre en attente : ouverture quand le cours ${g.above ? "monte" : "descend"} à ${aurPx(g.px)}.`)
            : await run(() => api.aurOrder({ action: "open", ...args }), b => `Position ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} ouverte · ${W(b.stake)} à ${aurPx(b.entry)} (frais ${W(b.fees)})`);
          if (r) setTicket(null);
        }} />}
      {toast && <div className={"toast " + (toast.tone || "")} role="status" onClick={() => setToast(null)}>{toast.text}</div>}
      {effect && <Rain kind={effect} at={rain} />}
    </div>
  );
}

// Bande compacte de mes paris en cours, en haut du Marché (sur mobile) : un appui ouvre l'onglet Positions.
function MiniTicker({ aur, bets, onOpen }) {
  if (!bets.length) return null;
  const chip = b => {
    if (b.kind === "aurelys") { const net = aurLive(b, aur.quotes[b.aur], aur.ticks[b.aur]).net; return [b.aur, sW(net), cls(net)] }
    return [b.kind, W(b.stake), "flat"];
  };
  return (
    <button type="button" className="ticker" onClick={onOpen} aria-label="Voir mes paris en cours">
      {bets.slice(0, 8).map(b => { const [n, v, c] = chip(b); return <span key={b.id} className="tick"><b>{n}</b><span className={"mono " + c}>{v}</span></span> })}
    </button>
  );
}

function Onboarding({ api, onDone }) {
  const [pseudo, setPseudo] = useState(""), [pw, setPw] = useState(""), [err, setErr] = useState(null), [login, setLogin] = useState(false);
  // En ligne, le compte se crée tout de suite avec un mot de passe : on se reconnecte avec son pseudo, le navigateur s'en souvient.
  const submit = async e => {
    e.preventDefault();
    try { await api.createProfile(pseudo) } catch (x) { return setErr(x.message) }
    if (!api.account) return onDone();
    try { await api.account.register(pseudo.trim(), pw) } catch (x) { setErr(`Partie créée, mais mot de passe refusé : ${x.message} Tu pourras le choisir dans Mon compte.`); setTimeout(onDone, 4000) }
  };
  return (
    <div className="center">
      <form className="onboard" onSubmit={submit}>
        <Logo big />
        <p className="muted">Une bourse inventée, Aurelys, dont les cours naissent des ordres des joueurs et des bots. Tu démarres avec {W(CAP0)}.</p>
        <label htmlFor="pseudo">Ton pseudo</label>
        <input id="pseudo" name="username" autoComplete="username" value={pseudo} onChange={e => setPseudo(e.target.value)} minLength={2} maxLength={20} required autoFocus />
        {api.account && <>
          <label htmlFor="pw">Mot de passe</label>
          <input id="pw" name="password" type="password" autoComplete="new-password" placeholder="8 caractères au moins" value={pw} onChange={e => setPw(e.target.value)} minLength={8} required />
        </>}
        {err && <p className="error">{err}</p>}
        <button className="btn primary" type="submit">Entrer sur le marché</button>
      </form>
      {api.account && <div className="onboard">
        {login ? <LoginPanel account={api.account} /> : <button type="button" className="link" onClick={() => setLogin(true)}>Déjà un compte ? Se connecter</button>}
      </div>}
    </div>
  );
}

/* Mes positions en direct : toujours visibles, en tête sur mobile et dans la colonne de gauche sur grand écran. */
// Ordres à déclenchement (penthouse) : en attente, ou exécutés / refusés depuis moins d'un jour.
function Triggers({ list, onCancel }) {
  if (!list.length) return null;
  return (
    <section className="panel triggers">
      <h2>Ordres à déclenchement</h2>
      {list.slice(0, 8).map(g => (
        <div key={g.id} className="row">
          <span><b>{AUR[g.tk]?.name ?? g.tk}</b> {g.dir === "up" ? "▲" : "▼"} ×{g.lev} · {W(g.stake)} quand le cours {g.above ? "monte à" : "descend à"} {aurPx(g.px)}
            {g.status === "done" && <small className="up"> · exécuté</small>}
            {g.status === "failed" && <small className="down"> · refusé : {g.msg}</small>}
            {g.status === "cancelled" && <small className="muted"> · annulé</small>}</span>
          {g.status === "wait" && <button type="button" className="link" onClick={() => onCancel(g.id)}>Annuler</button>}
        </div>
      ))}
    </section>
  );
}

function Positions({ now, aur, bets, onClose, onAuto, vertical }) {
  if (!bets.length && !vertical) return <div className="panel empty-pos"><h2>Mes positions</h2><p className="muted">Aucune position ouverte. Choisis une action d'Aurelys et prends position à la hausse ou à la baisse.</p></div>;
  const list = [...bets].filter(b => b.kind === "aurelys").sort((a, b) => b.id - a.id);
  const cards = list.map(b => <AurelysCard key={b.id} b={b} aur={aur} now={now} onClose={onClose} onAuto={onAuto} Facts={Facts} />);
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

function History({ bets }) {
  if (!bets.length) return <p className="muted pad">Tes paris réglés apparaîtront ici.</p>;
  return (
    <div className="history">
      {bets.map(b => {
        const net = b.payout - b.stake;
        // Anciens marchés (crypto, Wikipédia, duels) : retirés du jeu, gardés dans l'historique.
        const label = b.kind === "trade" ? `${b.tk} ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} · Wikipédia`
          : b.kind === "stream" ? `${b.login} ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} · Twitch`
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
            <span><b>{b.login} · plus de {nf0.format(b.threshold)} à {clock(Date.parse(b.end_at))} : {b.side === "yes" ? "Oui" : "Non"}</b><small>chiffre final {b.exit != null ? nf0.format(b.exit) : "—"} · cote {nf2.format(b.odds)}</small></span>
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

// Acheter, vendre ou souscrire à une levée de fonds.
function InvestSheet({ api, tk, mode, qty: q0, aur, me, hold, onClose, onDone }) {
  const d = AUR[tk], round = mode === "round", sell = mode === "sell", [amount, setAmount] = useState(round ? 1000 : 500), [share, setShare] = useState(1), [busy, setBusy] = useState(false);
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onClose]);
  // Levées : on compte la richesse disponible (solde, mises, actions, objets revendables), pas les logements.
  const [patrimoine, setWealth] = useState(0);
  useEffect(() => { if (round) api.myWealth().then(w => setWealth(+w)).catch(() => {}) }, [api, round]);
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
        {gate && <p className="error small">Les levées de fonds demandent 50 000 W disponibles : solde, valeur actuelle des positions, actions et objets revendables, sans les logements (tu en as {W(patrimoine)}).</p>}
        {sell ? <>
          <label>Part à vendre</label>
          <div className="seg" role="group" aria-label="Part à vendre">{[[.25, "25 %"], [.5, "50 %"], [1, "Tout"]].map(([v, l]) => <button key={v} type="button" aria-pressed={share === v} onClick={() => setShare(v)}>{l}</button>)}</div>
        </> : <>
          <label htmlFor="inv-amount">Montant</label>
          <div className="stake"><input id="inv-amount" className="mono" type="number" inputMode="numeric" min="1" value={amount} onChange={e => setAmount(Math.max(0, Math.floor(+e.target.value || 0)))} /><span>W</span></div>
          <StakeChips value={amount} set={setAmount} cash={me.cash} max={round ? Math.min(maxRound, Math.floor(me.cash)) : Math.floor(me.cash / (1 + FEE))} />
        </>}
        <div className="rows mono">
          <div className="row"><span>{round ? "Prix de la levée" : "Cours actuel"}</span><b>{aurPx(p)}</b></div>
          {!round && <div className="row"><span>Impact de ton ordre (estimé)</span><b>{sell ? "−" : "+"}{nf2.format(sl * 100)} %</b></div>}
          <div className="row"><span>{sell ? "Actions vendues" : "Actions obtenues (environ)"}</span><b>{nf2.format(sell ? qty : amount / (exec || 1))}</b></div>
          {!round && <div className="row"><span>Frais (0,1 %)</span><b>{W(fee)}</b></div>}
          {sell && <div className="row"><span>Tu recevras (environ)</span><b>{W(qty * exec - fee)}</b></div>}
          {round && <div className="row"><span>Encore possible (20 % du disponible)</span><b>{W(maxRound)}</b></div>}
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
            <span><b>{p.pseudo}<BotTag id={p.id} /></b><small>{[p.title, HOME_NAMES[p.home ?? 0], p.bankruptcies > 0 && `${p.bankruptcies} faillite${p.bankruptcies > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</small></span>
            <span className="r mono">{W(p.patrimoine ?? p.cash)}<small>solde {W(p.cash)}</small></span>
          </button>
        ))}
      </div>
      <p className="fine">Classement au patrimoine : solde, valeur actuelle des positions, actions et 60 % du prix des objets du QG. Touche un joueur pour visiter son QG.</p>
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

function Ticket({ api, aur, now, me, ticket, level, openCount, pref, setPref, onClose, onSubmit }) {
  const [stake, setStake] = useState(pref.stake), [busy, setBusy] = useState(false), [dir, setDir] = useState(ticket.dir), [trig, setTrig] = useState("");
  const trigPx = trig.trim() === "" ? null : +trig.replace(",", "."), maxPos = PERKS[level].pos, full = openCount >= maxPos;
  const set = p => setPref(x => ({ ...x, ...p }));
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onClose]);
  // Aurelys : ×20 avec un logement, ×25 dans une guilde qui a une salle des marchés (vérifié par le serveur).
  // Jeunes pousses : ×5 au plus (vérifié par le serveur).
  const [lev0, setMaxLev] = useState(15), young = aur.young.some(s => s.tk === ticket.tk), maxLev = young ? Math.min(5, lev0) : lev0;
  useEffect(() => { api.aurMaxLev().then(n => setMaxLev(+n)).catch(() => {}) }, [api]);
  useEffect(() => { if (pref.lev > maxLev) setPref(x => ({ ...x, lev: maxLev })) }, [maxLev, pref.lev, setPref]);
  const fee = stake * pref.lev * FEE;
  const aq = aur.quotes[ticket.tk], overCap = stake * pref.lev > aurCap(ticket.tk);
  const open = !!aq && !aq.halt && !overCap;
  const ok = stake > 0 && stake + fee <= me.cash && !full && (trigPx == null ? open : trigPx > 0 && !overCap);
  // Max : tout le solde, frais d'ouverture compris, et sans dépasser le plafond d'une action d'Aurelys.
  const maxStake = Math.min(Math.floor(me.cash / (1 + pref.lev * FEE)), Math.floor(aurCap(ticket.tk) / pref.lev));
  let body, title, cta;
  {
    const p = aq?.p ?? 0, sl = slipEstimate(ticket.tk, stake * pref.lev, now / 1000, aur.x?.reg), entry = p * (1 + (dir === "up" ? sl : -sl)), b = { entry, lev: pref.lev, dir, stake };
    title = AUR[ticket.tk].name;
    cta = `${trigPx ? "Placer l'ordre · " : ""}${dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×${pref.lev} · ${W(stake)}`;
    body = <>
      <div className="seg" role="group" aria-label="Sens">
        <button type="button" aria-pressed={dir === "up"} className="buy" onClick={() => setDir("up")}>▲ Hausse</button>
        <button type="button" aria-pressed={dir === "down"} className="sell" onClick={() => setDir("down")}>▼ Baisse</button>
      </div>
      <label>Levier</label>
      <div className="seg" role="group" aria-label="Levier">{AUR_LEVS.map(v => <button key={v} type="button" aria-pressed={pref.lev === v} disabled={v > maxLev} onClick={() => set({ lev: v })}>×{v}{v > maxLev ? " 🔒" : ""}</button>)}</div>
      {young ? <p className="muted small">Jeune pousse, très volatile : levier ×5 au plus.</p>
        : maxLev < 25 && <p className="muted small">{maxLev < 20 ? "×20 : achète un logement dans ton QG (studio ou plus). " : ""}×25 : rejoins une guilde qui a une salle des marchés.</p>}
      <div className="rows mono">
        <div className="row"><span>Cours actuel</span><b>{aurPx(p)}</b></div>
        <div className="row"><span>Impact de ton ordre (estimé)</span><b>{dir === "up" ? "+" : "−"}{nf2.format(sl * 100)} %</b></div>
        <div className="row"><span>Prix d'exécution estimé</span><b>{aurPx(entry)}</b></div>
        <div className="row"><span>1 % de variation</span><b>±{W(stake * pref.lev / 100)}</b></div>
        <div className="row"><span>Frais d'ouverture (0,1 %)</span><b>{W(fee)}</b></div>
        <div className="row"><span>Liquidation à</span><b>{aurPx(liqPrice(b))}</b></div>
        <div className="row"><span>Plafond sur cette action</span><b>{W(aurCap(ticket.tk))} engagés</b></div>
      </div>
      {level >= TRIGGER_LV ? <>
        <label htmlFor="trig">Ouvrir seulement quand le cours atteint (facultatif)</label>
        <input id="trig" className="mono" inputMode="decimal" placeholder="tout de suite" value={trig} onChange={e => setTrig(e.target.value)} />
        {trigPx > 0 && <p className="muted small">L'ordre attend que le cours {trigPx > p ? "monte" : "descende"} à {aurPx(trigPx)}, puis part au cours du marché (prix qui peut différer un peu). Ton solde n'est débité qu'à ce moment-là.</p>}
      </> : <p className="muted small">Ordres à déclenchement (ouvrir quand le cours atteint un seuil) : avec le penthouse (QG).</p>}
      <p className="muted small">Ton ordre fait bouger le cours : plus il est gros, et plus l'action est peu liquide, plus tu paies cher (même chose à la clôture). Le prix exact est calculé par le serveur. La position reste ouverte jusqu'à ce que tu la clôtures, ou jusqu'à la liquidation.</p>
    </>;
  }
  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="sheet" role="dialog" aria-modal="true" aria-label={title} onSubmit={async e => {
        e.preventDefault(); if (!ok) return; setBusy(true); set({ stake });
        await onSubmit({ tk: ticket.tk, dir, lev: pref.lev, stake, ...(trigPx ? { px: trigPx } : {}) });
        setBusy(false);
      }}>
        <div className="sheet-h"><h2>{title}</h2><button type="button" className="x" onClick={onClose} aria-label="Fermer">×</button></div>
        {body}
        <label htmlFor="stake">Mise</label>
        <div className="stake"><input id="stake" className="mono" type="number" inputMode="numeric" min="1" step="1" value={stake} onChange={e => setStake(Math.max(0, Math.floor(+e.target.value || 0)))} /><span>W</span></div>
        <StakeChips value={stake} set={setStake} cash={me.cash} max={maxStake} />
        {full && <p className="error small">Au plus {maxPos} positions ouvertes ou en attente avec ton logement : un logement plus grand en permet davantage (QG).</p>}
        {overCap && <p className="error small">Au plus {W(aurCap(ticket.tk))} engagés (mise × levier) sur cette action.</p>}
        {aq?.halt && <p className="error small">Cotation suspendue, reprise dans quelques secondes.</p>}
        {stake + fee > me.cash && <p className="error small">Solde insuffisant : il te manque {W(stake + fee - me.cash)}{fee ? " (frais compris)" : ""}.</p>}
        <button type="submit" className={"btn big " + (dir === "up" ? "buy" : "sell")} disabled={!ok || busy}>{cta}</button>
      </form>
    </div>
  );
}
