import { LOCALE, t } from "./i18n.js";
import { useEffect, useRef, useState, useCallback } from "react";
import { liqPrice, BK_LIMIT, CAP0, EPOCH, CYCLE_MS } from "./engine.js";
import { nf0, nf2, W, sW, clock, cls, HIST_DAYS, ALERTS_MAX, MAX_POS } from "./format.js";
import { LEVS, LEV_LEVEL, LEV_DIVISION, DIVISIONS, QUEST_BY, TRIGGER_LEVEL, unlocksAt } from "../supabase/functions/_shared/progression.js";
import { useAurelys } from "./aurelys.js";
import { AurelysMarket, AurelysDetail, AurelysCard, aurLive, aurCap, px as aurPx } from "./AurelysUI.jsx";
import { Achievements } from "./Succes.jsx";
import { Quests } from "./Quetes.jsx";
import { BY as AUR, slip, FEE } from "../supabase/functions/_shared/aurelys.js";
import { Dock, Segmented, SubHeader, Logo, LangSwitch, LogoLoader } from "./nav.jsx";
import { Profile, HowTo, Account, Legal, Privacy, PushPanel } from "./pages.jsx";
import { Ranking, Friends, Guilds, LoginPanel, BotTag } from "./social.jsx";
import Portfolio from "./Portfolio.jsx";

/* ===== Formats ===== */
// Une séance se nomme par son heure de début réelle (« séance de 14:32 »), plus parlante que son numéro.
const sessName = k => { const d = new Date(EPOCH + k * CYCLE_MS), t = d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `séance de ${t}` : `séance du ${d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" })} à ${t}` };

const feeOpen = r => r.kind === "aurelys" ? r.fee_open ?? r.stake * r.lev * FEE : 0; // frais d'ouverture, en plus de la mise

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
}

// Le jeu, chargé à part : l'accueil (App.jsx) s'affiche sans lui.
export default function Game({ api, trial = false, onNoProfile }) {
  const [now, setNow] = useState(api.now());
  // Horloge de l'écran : une fois par seconde, calée sur le changement de seconde (même affichage, 4 fois moins de rendus).
  useEffect(() => { let id; const tick = () => { const t = api.now(); setNow(t); id = setTimeout(tick, 1000 - t % 1000 + 5) }; tick(); return () => clearTimeout(id) }, [api]);
  const k = Math.floor((now - EPOCH) / CYCLE_MS); // numéro de séance de 11 min : sert au salaire et à la profondeur de l'historique

  const [me, setMe] = useState(undefined), [bets, setBets] = useState([]), [board, setBoard] = useState([]);
  const [toast, setToast] = useState(null), [tab, setTab] = useState("market"), [ticket, setTicket] = useState(null);
  const [aurDetail, setAurDetail] = useState(null), [aurHl, setAurHl] = useState(null), [posView, setPosView] = useState("open"), [more, setMore] = useState(null);
  // « Comment jouer » s'ouvre tout seul à la première visite.
  const [firstVisit, setFirstVisit] = useState(() => { if (trial) return false; try { return !localStorage.getItem("wb-howto") } catch { return false } }); // l'essai a ses bulles
  const [pref, setPref] = useState({ lev: 5, shorizon: "15", stake: 500 });
  const say = useCallback((text, tone) => { setToast({ text, tone, at: Date.now() }) }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), toast.long ? 7000 : 2600); return () => clearTimeout(id) }, [toast]);

  const [refs, setRefs] = useState(null); // parrainage : mon code, mes filleuls, mon parrain, mon rang de la veille
  const [holds, setHolds] = useState([]), [invest, setInvest] = useState(null), [triggers, setTriggers] = useState([]); // portefeuille d'actions (sans levier)
  const [refunds, setRefunds] = useState([]); // lignes « Remboursement QG » et « Banque fermée » de l'historique (H1)
  const known = useRef(null), knownT = useRef(null); // statut de chaque pari au chargement précédent, pour fêter les gains
  const histFrom = k - Math.round(HIST_DAYS * 1440 / 11); // séances de 11 min
  const refresh = useCallback(async () => {
    try {
      const [m, b, l, h, tg, rf, rb] = await Promise.all([api.me(), api.myBets(histFrom), api.leaderboard().catch(() => []), api.myHoldings().catch(() => []), api.myTriggers().catch(() => []), api.myReferrals?.().catch(() => null), api.myRefunds?.().catch(() => null)]); // classement, portefeuille : facultatifs, le jeu tourne sans
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
        ...refNotes(rf),
      ];
      if (notes.length) setToast({ text: notes.join("\n"), tone: ended.some(x => x.closed_by === "liq" || x.closed_by === "stop") ? "down" : "up", at: Date.now(), long: true });
      setMe(m); setBets(b); setBoard(l); if (rb) setRefunds(rb); setHolds(h.map(x => ({ ...x, qty: +x.qty, cost: +x.cost, price: +x.price }))); setTriggers(tg); if (rf) setRefs(rf);
      if (won.length && !notes.length) setToast({ text: `Gagné : ${sW(won.reduce((a, x) => a + x.payout - x.stake, 0))}`, tone: "up", at: Date.now() });
    } catch (e) { say(e.message, "down") }
  }, [api, histFrom, say]);
  // Temps réel : ouvert seulement ici, une fois la session et le profil établis ; fermé en quittant le jeu.
  useEffect(() => { refresh(); return api.onChange(refresh) }, [api, refresh]);
  useEffect(() => { if (me === null) onNoProfile?.() }, [me, onNoProfile]); // pas encore de profil : retour à l'accueil
  // Classement : toutes les 60 s (le temps réel ne suit plus que mon profil), pas quand l'onglet est caché.
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) api.leaderboard().then(setBoard).catch(() => {}) }, 60000); return () => clearInterval(id) }, [api]);
  // Présence (succès Fidèle au poste).
  useEffect(() => { const ping = () => api.touch?.().catch(() => {}); ping(); const id = setInterval(ping, 60000); return () => clearInterval(id) }, [api]);

  // Bourse d'Aurelys : cours à la seconde quand on la regarde ou qu'on y a une position, sinon toutes les 10 s.
  // Alertes de prix (Aurelys) : gardées dans ce navigateur.
  const [alerts, setAlerts] = useState(() => { try { return JSON.parse(localStorage.getItem("wb-alerts")) ?? [] } catch { return [] } });
  useEffect(() => { try { localStorage.setItem("wb-alerts", JSON.stringify(alerts)) } catch { } }, [alerts]);
  // Retour de Discord : déjà lié ailleurs → Mon compte (choix de basculer) ; annulé ou autre erreur → bandeau.
  useEffect(() => {
    const o = api.account?.oauth; if (!o) return;
    if (o.kind === "taken") { setTab("more"); setMore("account") } else setToast({ text: o.text, tone: o.kind === "error" ? "down" : "", long: true, at: Date.now() });
  }, [api]);
  // Partie anonyme : proposer de la sauvegarder avec Discord, 8 s après la première position ou au bout de 5 min de jeu,
  // au plus une fois tous les 3 jours. Jamais dans l'essai ni une fois sauvegardée.
  const hasBet = bets.length > 0;
  useEffect(() => {
    const ac = api.account; if (trial || !ac || ac.saved) return;
    const id = setTimeout(() => {
      try { if (Date.now() - Number(localStorage.getItem("wb-discord") || 0) < 3 * 864e5) return; localStorage.setItem("wb-discord", String(Date.now())) } catch { return }
      setToast({ text: "Sauvegarde ta progression avec Discord", long: true, at: Date.now(), action: { label: "Sauvegarder", go: () => ac.linkDiscord().catch(e => say(e.message)) } });
    }, hasBet ? 8000 : 5 * 60e3);
    return () => clearTimeout(id);
  }, [api, trial, hasBet, say]);
  // Succès débloqués par le serveur depuis la dernière visite : un bandeau, avec un lien vers les succès.
  const unlockCheck = useRef(null);
  useEffect(() => {
    let alive = true; const KEY = "wb-succes-vu";
    const check = unlockCheck.current = async () => {
      let since = null; try { since = localStorage.getItem(KEY) } catch { }
      const r = await api.myUnlocks?.(since).catch(() => null); if (!alive || !r) return;
      try { localStorage.setItem(KEY, r.now) } catch { }
      if (!r.list.length) return;
      const text = r.list.length === 1 ? (r.list[0].xp ? `Succès débloqué : ${r.list[0].name} (+${r.list[0].xp} XP)` : `Succès débloqué : ${r.list[0].name}`) : `${r.list.length} succès débloqués${since ? "" : " d'après ton historique"}`;
      setToast({ text, tone: "up", long: true, at: Date.now(), action: { label: "Voir mes succès", go: () => { setTab("more"); setMore("succes") } } });
    };
    check(); const id = setInterval(check, 30000);
    return () => { alive = false; clearInterval(id) };
  }, [api]); // eslint-disable-line
  // Messages du serveur (notices), lus une fois, relus toutes les 30 s : pseudo renommé d'office, refonte du jeu (H1),
  // niveau gagné, quête réussie.
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    const check = () => api.myNotices?.().then(list => {
      const lines = [];
      for (const n of list ?? []) {
        if (n.kind === "pseudo") setToast({ text: `Ton pseudo ressemblait à une adresse e-mail, visible de tous. Il devient ${n.body.pseudo} : tu peux en choisir un autre dans Mon compte.`,
          tone: "up", long: true, at: Date.now(), action: { label: "Choisir mon pseudo", go: () => { setTab("more"); setMore("account") } } });
        if (n.kind === "h1") setNotice(n.body);
        // Phrases assemblées : traduites morceau par morceau (le dictionnaire ne connaît pas la phrase entière).
        if (n.kind === "quest") lines.push(t("Quête réussie : {q} · +{xp} XP", { q: t(QUEST_BY[n.body.code]?.text ?? n.body.code), xp: n.body.xp }));
        if (n.kind === "level") {
          const got = []; for (let l = n.body.from + 1; l <= n.body.to; l++) got.push(...unlocksAt(l));
          lines.push(t("Niveau {n} !", { n: n.body.to }) + (got.length ? " " + t("Tu débloques : {list}.", { list: got.map(x => t(x)).join(", ") }) : ""));
        }
        api.noticeRead(n.id).catch(() => {});
      }
      if (lines.length) setToast({ text: lines.join("\n"), tone: "up", long: true, at: Date.now(), action: { label: "Voir mes quêtes", go: () => setTab("quests") } });
    }).catch(() => {});
    check(); const id = setInterval(() => { if (!document.hidden) check() }, 30000);
    return () => clearInterval(id);
  }, [api]);
  // Tutoriel (XP de la première séance) : ouvrir une fiche société ; « Comment jouer » est compté à sa fermeture.
  useEffect(() => { if (aurDetail) api.tutoDone?.("fiche").catch(() => {}) }, [api, aurDetail]);
  const aur = useAurelys(api, tab === "market" || !!aurDetail || alerts.length > 0 || bets.some(b => b.status === "open" && b.kind === "aurelys"));
  const beat = Math.floor(now / 2500);
  useEffect(() => {
    const hit = alerts.filter(a => { const p = aur.quotes[a.tk]?.p; return p != null && (a.above ? p >= a.price : p <= a.price) });
    if (!hit.length) return;
    say(hit.map(a => `Alerte : ${AUR[a.tk].name} ${a.above ? "au-dessus" : "en dessous"} de ${aurPx(a.price)}`).join("\n"), "up");
    setAlerts(l => l.filter(a => !hit.includes(a)));
  }, [beat]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, ok) => { try { const r = await fn(); if (ok) say(ok(r), "up"); await refresh(); return r } catch (e) { say(e.message, "down") } };
  const open = bets.filter(b => b.status === "open");
  // Positions ouvertes à leur valeur actuelle (frais de clôture déduits), comme le patrimoine en SQL (open_value).
  const openStake = open.reduce((a, b) => a + (b.kind === "aurelys" ? aurLive(b, aur.quotes[b.aur], aur.ticks[b.aur], aur.feeRate, aur.cut).value : b.stake), 0);
  const positions = open.filter(b => b.kind === "aurelys");
  if (me === undefined) return <main className="center"><LogoLoader size={72} /></main>;
  if (me === null) return null;

  // Un appui sur l'onglet déjà ouvert ramène à sa racine (Plus : retour au Profil depuis Classement, Mon compte…).
  const go = t => { if (t !== "more" || t === tab) setMore(null); setTab(t); window.scrollTo({ top: 0 }) };
  const onAuto = (id, sl, tp) => run(() => api.aurSetAuto(id, sl, tp), () => sl == null && tp == null ? "Ordres retirés." : "Ordres enregistrés."), canStop = true; // stop et objectif pour tous
  const cancelTrigger = id => run(() => api.aurTriggerCancel(id), () => "Ordre annulé.");
  const closeTrade = b => run(() => b.kind === "aurelys" ? api.aurOrder({ action: "close", id: b.id }).finally(() => { setTimeout(() => unlockCheck.current?.(), 1500) }) : api.closeTrade(b.id),
    r => `Clôturée : ${sW(r.payout - r.stake - feeOpen(r))}${feeOpen(r) ? ` (frais ${W(r.fees)})` : ""}`);
  const howtoDone = () => { try { localStorage.setItem("wb-howto", "1") } catch { } api.tutoDone?.("howto").catch(() => {}); setFirstVisit(false); setMore(null); setTab("market") };
  const holdPx = h => h.status === "listed" || h.status === "core" ? aur.quotes[h.tk]?.p ?? h.price : h.price; // cours en direct
  const holdsValue = holds.reduce((a, h) => a + h.qty * holdPx(h), 0), patrimoine = me.cash + openStake + holdsValue;
  const showHowto = firstVisit || (tab === "more" && more === "howto");

  return (
    <div className="app">
      <header className="top">
        <Logo />
        {api.mode === "demo" && <span className="tag">{trial ? "essai" : "démo"}</span>}
        <LangSwitch />
        <button type="button" className="cash mono" onClick={() => { setTab("more"); setMore("account") }} aria-label="Mon compte">{W(me.cash)}</button>
      </header>

      {trial && <TrialBar api={api} />}
      <div className="layout">
        <aside className="rail">
          <Triggers list={triggers} onCancel={cancelTrigger} />
          <Positions now={now} aur={aur} bets={open} onClose={closeTrade} onAuto={onAuto} canStop={canStop} onDetail={setAurDetail} />
        </aside>

        <main className="main">
          <div key={showHowto ? "howto" : tab + (more ?? "")} className="view-anim">
          {showHowto ? <HowTo first={firstVisit} onBack={firstVisit ? howtoDone : () => { api.tutoDone?.("howto").catch(() => {}); setMore(null) }} /> : <>
          {tab === "market" && <MiniTicker aur={aur} bets={open} onOpen={() => { setPosView("open"); go("positions") }} />}

          {tab === "market" && <AurelysMarket api={api} aur={aur} now={now} bets={open} onPick={(tk, dir) => setTicket({ kind: "aurelys", tk, dir })} onSubscribe={tk => setInvest({ tk, mode: "round" })} onDetail={(tk, hl) => { setAurDetail(tk); setAurHl(hl ?? null) }} />}

          {tab === "positions" && <>
            <Segmented label="Mes paris" value={posView} onChange={setPosView} options={[["open", `En cours${open.length ? ` (${open.length})` : ""}`], ["folio", "Portefeuille"], ["history", "Historique"]]} />
            {posView === "folio" ? <Portfolio holds={holds} aur={aur} px={holdPx} onSell={h => setInvest({ tk: h.tk, mode: "sell", qty: h.qty })} onBuy={tk => setInvest({ tk, mode: "buy" })} onMarket={() => go("market")} />
            : posView === "open" ? <>
              {api.push && positions.length > 0 && <PushPanel push={api.push} compact />}
              <Triggers list={triggers} onCancel={cancelTrigger} />
              {open.length ? <Positions vertical now={now} aur={aur} bets={open} onClose={closeTrade} onAuto={onAuto} canStop={canStop} onDetail={setAurDetail} />
                : <div className="empty-state"><b>Aucun pari en cours</b><p className="muted">Prends position sur une action d'Aurelys.</p>
                    <div className="empty-acts"><button type="button" className="btn primary" onClick={() => go("market")}>Marché</button></div></div>}
            </> : <History bets={withExtras(bets.filter(b => b.status !== "open"), refs, refunds)} />}
          </>}

          {tab === "quests" && <Quests api={api} now={now} say={say} />}
          {tab === "guild" && (trial ? <><SubHeader title="Guilde" /><Locked what="Les guildes" /></> : <Guilds api={api} me={me} say={say} />)}

          {tab === "more" && (
            more === "succes" ? <><SubHeader title="Succès" onBack={() => setMore(null)} />{trial ? <Locked what="Les succès" /> : <Achievements api={api} />}</>
            : more === "board" ? <><SubHeader title="Classement" onBack={() => setMore(null)} /><Ranking api={api} me={me} wealth={<Board board={board} me={me} />} /></>
            : trial && more === "friends" ? <><SubHeader title="Amis" onBack={() => setMore(null)} /><Locked what="Les amis" /></>
            : more === "friends" ? <Friends api={api} say={say} onBack={() => setMore(null)} />
            : more === "account" ? <Account account={api.account} push={api.push} me={me} patrimoine={patrimoine} openStake={openStake} holds={holdsValue} demo={api.mode === "demo"}
                canRestart={patrimoine < BK_LIMIT} onRestart={() => run(() => api.restart(), p => `Nouveau départ : ${W(p?.cash ?? CAP0)} en caisse`)}
                onPseudo={p => run(() => api.pseudoChange(p), r => `Ton pseudo est maintenant ${r.pseudo}.`)} onDelete={trial ? null : api.deleteAccount} onBack={() => setMore(null)} />
            : more === "legal" ? <Legal onBack={() => setMore(null)} />
            : more === "privacy" ? <Privacy onBack={() => setMore(null)} />
            : more === "notifs" && api.push ? <><SubHeader title="Notifications" onBack={() => setMore(null)} /><PushPanel push={api.push} /></>
            : <Profile api={api} me={me} board={board} patrimoine={patrimoine} refs={trial ? null : refs} trial={trial}
                say={say} go={t => t === "guilds" ? go("guild") : setMore(t)} hasPush={!!api.push} />)}
          </>}
          </div>
        </main>
      </div>

      <Dock tab={showHowto && firstVisit ? null : tab} setTab={t => { if (firstVisit) howtoDone(); go(t) }} badge={open.length} />

      {aurDetail && <AurelysDetail tk={aurDetail} hl={aurHl} aur={aur} api={api} now={now} alerts={alerts} setAlerts={setAlerts} alertsMax={ALERTS_MAX} onClose={() => { setAurDetail(null); setAurHl(null) }} onPick={(tk, dir) => { setAurDetail(null); setTicket({ kind: "aurelys", tk, dir }) }}
        onInvest={tk => { setAurDetail(null); setInvest({ tk, mode: "buy" }) }} />}
      {invest && <InvestSheet {...invest} api={api} aur={aur} me={me} hold={holds.find(h => h.tk === invest.tk)} onClose={() => setInvest(null)}
        onDone={async (args, ok) => { const r = await run(() => args.mode === "round" ? api.aurSubscribe(args.tk, args.amount) : api.aurOrder(args.mode === "buy" ? { action: "buy", tk: args.tk, amount: args.amount } : { action: "sell", tk: args.tk, qty: args.qty }), () => ok); if (r) setInvest(null) }} />}
      {ticket && <Ticket aur={aur} me={me} ticket={ticket} openCount={positions.length + triggers.filter(g => g.status === "wait").length} pref={pref} setPref={setPref} onClose={() => setTicket(null)}
        onSubmit={async args => {
          const r = args.px ? await run(() => api.aurTriggerAdd(args), g => `Ordre en attente : ouverture quand le cours ${g.above ? "monte" : "descend"} à ${aurPx(g.px)}.`)
            : await run(() => api.aurOrder({ action: "open", ...args }), b => `Position ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} ouverte · ${W(b.stake)} à ${aurPx(b.entry)} (frais ${W(b.fees)})`);
          if (r) setTicket(null);
        }} />}
      {toast && <div className={"toast " + (toast.tone || "")} role="status" onClick={() => setToast(null)}>{toast.text}
        {toast.action && <button type="button" className="toast-act" onClick={e => { e.stopPropagation(); setToast(null); toast.action.go() }}>{toast.action.label}</button>}</div>}
      {notice && <H1Notice n={notice} onClose={() => setNotice(null)} />}
      {trial && <Coach picked={!!(aurDetail || ticket)} open={open.length} bets={bets} />}
    </div>
  );
}

// Refonte du jeu (H1) : ce qui disparaît, ce que le joueur a reçu, son niveau de départ. Montré une fois.
function H1Notice({ n, onClose }) {
  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Le jeu change">
        <div className="sheet-h"><b>Le jeu change</b><button type="button" className="x" onClick={onClose} aria-label="Fermer">×</button></div>
        <p>Le QG, la banque, les talents et la ville de guilde sont retirés. Nouveau : niveaux de trader, quêtes et pari du jour (onglet Quêtes). Bientôt : ligues et guildes à objectifs.</p>
        {n.w > 0 && <p>Remboursement de tes logements, objets et parts de Trésor : <b className="mono">{W(n.w)}</b> dans ton solde.</p>}
        {n.bank > 0 && <p>Ton dépôt à la banque est revenu dans ton solde : <b className="mono">{W(n.bank)}</b>.</p>}
        <p>Ton niveau de trader de départ : <b className="mono">{n.level}</b>.</p>
        <p className="muted small">Stop et objectif pour tous. Le levier et le nombre de positions ouvertes suivent maintenant ton niveau ; tes positions déjà ouvertes ne changent pas. Ces remboursements ne comptent pas dans les classements de gains.</p>
        <button type="button" className="btn big primary" onClick={onClose}>Compris</button>
      </div>
    </div>
  );
}

/* ===== Essai sans compte : tout reste dans ce navigateur ===== */
const Locked = ({ what }) => (
  <div className="empty-state locked"><b><span aria-hidden="true">🔒 </span>{what} demandent un compte</b>
    <p className="muted">Crée ton compte en 20 secondes : pseudo et mot de passe, sans e-mail. Ta partie d'essai ne sera pas reprise.</p>
    <div className="empty-acts"><a className="btn primary" href="/jouer">Créer mon compte</a></div></div>
);

function TrialBar({ api }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="trial-bar" role="note">
      <span>Mode essai : ta progression n'est pas sauvegardée. <a href="/jouer">Crée un compte</a> pour la garder.</span>
      <button type="button" className="link" disabled={busy} onClick={async () => { setBusy(true); await api.reset?.(); location.reload() }}>Recommencer</button>
    </div>
  );
}

// Trois bulles, puis, après un premier gain ou 3 minutes, l'invitation à créer un compte (sans bloquer le jeu).
const COACH = ["Choisis une société : touche une ligne du marché.", "Passe un ordre : ▲ hausse ou ▼ baisse, avec ou sans levier.", "Regarde ton gain ou ta perte bouger en direct, puis clôture quand tu veux."];
function Coach({ picked, open, bets }) {
  const [step, setStep] = useState(0), [done, setDone] = useState(false), [late, setLate] = useState(false), [nudge, setNudge] = useState(null);
  useEffect(() => { if (step === 0 && picked) setStep(1); if (step <= 1 && open) setStep(2) }, [step, picked, open]);
  useEffect(() => { const id = setTimeout(() => setLate(true), 180000); return () => clearTimeout(id) }, []);
  const won = bets.some(b => b.kind === "aurelys" && b.status !== "open" && b.payout - b.stake - feeOpen(b) > 0);
  useEffect(() => { if ((won || late) && nudge === null) setNudge(true) }, [won, late, nudge]);
  if (nudge) return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && setNudge(false)}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Garde ta progression">
        <div className="sheet-h"><b>{won ? "Premier gain !" : "Ça te plaît ?"}</b><button type="button" className="x" onClick={() => setNudge(false)} aria-label="Fermer">×</button></div>
        <p>Garde ta progression : crée ton compte. Avec le code de parrainage d'un ami, tu reçois 2 000 W de plus.</p>
        <p className="muted small">Ta partie d'essai reste dans ce navigateur : un compte repart à 10 000 W, comme tout le monde.</p>
        <a className="btn big primary" href="/jouer">Créer mon compte</a>
        <button type="button" className="btn ghost" onClick={() => setNudge(false)}>Continuer l'essai</button>
      </div>
    </div>
  );
  if (done) return null;
  return (
    <div className="coach" role="status">
      <span className="mono">{step + 1}/3</span><p>{COACH[step]}</p>
      {step === 2 && <button type="button" className="btn" onClick={() => setDone(true)}>OK</button>}
      {step < 2 && <button type="button" className="link" onClick={() => setDone(true)}>Passer</button>}
    </div>
  );
}

// Bande compacte de mes paris en cours, en haut du Marché (sur mobile) : un appui ouvre l'onglet Positions.
function MiniTicker({ aur, bets, onOpen }) {
  if (!bets.length) return null;
  const chip = b => {
    if (b.kind === "aurelys") { const net = aurLive(b, aur.quotes[b.aur], aur.ticks[b.aur], aur.feeRate, aur.cut).net; return [b.aur, sW(net), cls(net)] }
    return [b.kind, W(b.stake), "flat"];
  };
  return (
    <button type="button" className="ticker" onClick={onOpen} aria-label="Voir mes paris en cours">
      {bets.slice(0, 8).map(b => { const [n, v, c] = chip(b); return <span key={b.id} className="tick"><b>{n}</b><span className={"mono " + c}>{v}</span></span> })}
    </button>
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

function Positions({ now, aur, bets, onClose, onAuto, canStop, onDetail, vertical }) {
  if (!bets.length && !vertical) return <div className="panel empty-pos"><h2>Mes positions</h2><p className="muted">Aucune position ouverte. Choisis une action d'Aurelys et prends position à la hausse ou à la baisse.</p></div>;
  const list = [...bets].filter(b => b.kind === "aurelys").sort((a, b) => b.id - a.id);
  const cards = list.map(b => <AurelysCard key={b.id} b={b} aur={aur} now={now} onClose={onClose} onAuto={onAuto} canStop={canStop} onDetail={onDetail} Facts={Facts} />);
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

// Parrainage : bandeaux quand un filleul s'inscrit ou est validé (comparé au dernier état vu dans ce navigateur).
function refNotes(rf) {
  if (!rf) return [];
  const rows = [...rf.mine.map(r => ({ k: r.id, s: r.status, txt: r.status === "validé" ? `Parrainage : ${r.pseudo} validé, ${r.paid ? sW(r.paid) : "plus de récompense (4 filleuls déjà récompensés)"}` : `${r.pseudo} s'est inscrit avec ton code` })),
    ...(rf.sponsor ? [{ k: "parrain", s: rf.sponsor.status, txt: rf.sponsor.status === "validé" ? `Parrainage validé : ${sW(rf.sponsor.paid)}` : null }] : [])];
  let seen = null; try { seen = JSON.parse(localStorage.getItem("wb-refs")) } catch { }
  try { localStorage.setItem("wb-refs", JSON.stringify(Object.fromEntries(rows.map(r => [r.k, r.s])))) } catch { }
  if (!seen) return []; // première fois dans ce navigateur : rien de neuf à annoncer
  return rows.filter(r => r.txt && seen[r.k] !== r.s).map(r => r.txt);
}
// Lignes de parrainage et de remboursement (H1) dans l'historique, à leur date (hors classement des gains).
function withExtras(list, refs, refunds) {
  const lines = [...(refs?.mine ?? []).filter(r => r.status === "validé").map(r => ({ id: "ref-" + r.id, kind: "parrainage", at: r.validated_at, text: `Parrainage : ${r.pseudo} validé`, gain: r.paid, note: r.paid ? "bonus" : "plafond atteint" })),
    ...(refs?.sponsor?.status === "validé" ? [{ id: "ref-me", kind: "parrainage", at: refs.sponsor.validated_at, text: `Parrainage : bienvenue de ${refs.sponsor.pseudo}`, gain: refs.sponsor.paid, note: "bonus" }] : []),
    ...refunds.map(r => ({ id: "h1-" + r.kind, kind: "parrainage", at: r.at, text: r.kind === "banque" ? "Banque fermée : dépôt rendu" : "Remboursement QG", gain: r.amount, note: r.kind === "banque" ? "transfert" : "remboursement" }))];
  const out = [...list];
  for (const l of lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const i = out.findIndex(b => b.kind !== "parrainage" && Date.parse(b.created_at) < Date.parse(l.at));
    out.splice(i < 0 ? out.length : i, 0, l);
  }
  return out;
}

function History({ bets }) {
  if (!bets.length) return <p className="muted pad">Tes paris réglés apparaîtront ici.</p>;
  return (
    <div className="history">
      {bets.map(b => {
        if (b.kind === "parrainage") return (
          <div key={b.id} className="hrow">
            <span><b>{b.text}</b><small>{`${clock(Date.parse(b.at))}, hors classement des gains`}</small></span>
            <span className="r mono"><b className={cls(b.gain)}>{sW(b.gain)}</b><small>{b.note}</small></span>
          </div>
        );
        const net = b.payout - b.stake;
        // Anciens marchés (crypto, Wikipédia, duels) : retirés du jeu, gardés dans l'historique.
        const label = b.kind === "trade" ? `${b.tk} ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} · Wikipédia`
          : b.kind === "stream" ? `${b.login} ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} · Twitch`
          : b.kind === "crypto" ? `${b.sym} ${b.dir === "up" ? "▲" : "▼"} ×${b.lev} · crypto`
          : b.kind === "invest" ? `${AUR[b.aur]?.name ?? b.aur} · actions vendues${b.payout === 0 ? " (faillite)" : ""}`
          : "Duel Wikipédia";
        if (b.kind === "aurelys") return (
          <div key={b.id} className="hrow">
            <span><b>{`${AUR[b.aur]?.name ?? b.aur} ${b.dir === "up" ? "▲" : "▼"} ×${b.lev}`}</b><small>{`${clock(Date.parse(b.created_at))} → ${b.exit_at ? clock(Date.parse(b.exit_at)) : "—"}, de ${aurPx(b.entry)} à ${b.exit != null ? aurPx(b.exit) : "—"}, frais ${W(b.fees)}${b.payout === 0 ? ", liquidée" : ""}${b.insured ? ", assurée" : ""}`}</small></span>
            <span className="r mono"><b className={cls(net - feeOpen(b))}>{sW(net - feeOpen(b))}</b><small>mise {W(b.stake)}</small></span>
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
  const notional = sell ? qty * p : amount, sl = round ? 0 : slip(null, tk, notional) * aur.cut, fee = round ? 0 : Math.max(1, notional * aur.feeRate);
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
        <dl className="t-figs">
          <div><dt>{sell ? "Actions vendues" : "Actions obtenues (environ)"}</dt><dd className="mono">{nf2.format(sell ? qty : amount / (exec || 1))}</dd></div>
          {sell ? <div><dt>Tu recevras (environ)</dt><dd className="mono">{W(qty * exec - fee)}</dd></div>
            : round ? <div><dt>Encore possible (20 % du disponible)</dt><dd className="mono">{W(maxRound)}</dd></div>
            : <div><dt>{round ? "Prix de la levée" : "Cours actuel"}</dt><dd className="mono">{aurPx(p)}</dd></div>}
        </dl>
        <details className="t-more">
          <summary>Détail de l'ordre</summary>
          <div className="plain">
            <div className="plain-row"><span>{round ? "Prix de la levée" : "Cours actuel"}</span><b className="mono">{aurPx(p)}</b></div>
            {!round && <div className="plain-row"><span>Impact de ton ordre (estimé)</span><b className="mono">{sell ? "−" : "+"}{nf2.format(sl * 100)} %</b></div>}
            {!round && <div className="plain-row"><span>Frais (0,1 %)</span><b className="mono">{W(fee)}</b></div>}
          </div>
        </details>
        <p className="muted small">{round ? "Le premier cours sera fixé par le marché à l'introduction en bourse : il peut être bien au-dessus du prix de la levée… ou en dessous. Une jeune pousse peut aussi faire faillite."
          : "Sans levier : ta mise suit le cours, sans liquidation. Le prix exact est calculé par le serveur."}</p>
        <button type="submit" className={"btn big " + (sell ? "sell" : "buy")} disabled={!ok}>{round ? `Souscrire pour ${W(amount)}` : sell ? `Vendre pour ${W(qty * exec - fee)}` : `Acheter pour ${W(amount)}`}</button>
      </form>
    </div>
  );
}

function Board({ board, me }) {
  return (
    <section>
      <div className="board">
        {board.map((p, i) => (
          <div key={p.id} className={"brow" + (p.id === me.id ? " me" : "")}>
            <span className="rk mono">{i + 1}</span>
            <span><b>{p.pseudo}<BotTag id={p.id} /></b><small>{[p.level != null && `niveau ${p.level}`, p.bankruptcies > 0 && `${p.bankruptcies} faillite${p.bankruptcies > 1 ? "s" : ""}`].filter(Boolean).join(", ")}</small></span>
            <span className="r mono">{W(p.patrimoine ?? p.cash)}<small>solde {W(p.cash)}</small></span>
          </div>
        ))}
      </div>
      <p className="fine">Classement au patrimoine : solde, valeur actuelle des positions et actions.</p>
    </section>
  );
}

function Ticket({ aur, me, ticket, openCount, pref, setPref, onClose, onSubmit }) {
  const [stake, setStake] = useState(pref.stake), [busy, setBusy] = useState(false), [dir, setDir] = useState(ticket.dir), [trig, setTrig] = useState("");
  const terms = aur.terms ?? {}, level = terms.level ?? 1, division = terms.division ?? 0, trigPx = trig.trim() === "" ? null : +trig.replace(",", "."), maxPos = terms.max_pos ?? MAX_POS, full = openCount >= maxPos;
  const set = p => setPref(x => ({ ...x, ...p }));
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k) }, [onClose]);
  // Levier maximal décidé par le serveur (my_terms) ; jeunes pousses : ×5 au plus (vérifié par le serveur).
  // Un levier fermé dit ce qui l'ouvre : le niveau (pour toujours) ou la ligue (le temps d'y rester).
  const lockOf = v => level < LEV_LEVEL[v] ? `×${v} : débloqué au niveau ${LEV_LEVEL[v]} (tu es niveau ${level}).` : `×${v} : en ligue ${DIVISIONS[LEV_DIVISION[v]]} ou plus.`;
  const lev0 = terms.max_lev ?? 1, young = aur.young.some(s => s.tk === ticket.tk), maxLev = young ? Math.min(5, lev0) : lev0;
  useEffect(() => { if (pref.lev > maxLev) setPref(x => ({ ...x, lev: maxLev })) }, [maxLev, pref.lev, setPref]);
  const fee = Math.max(1, stake * pref.lev * aur.feeRate);
  const cap = aurCap(ticket.tk), aq = aur.quotes[ticket.tk], overCap = stake * pref.lev > cap;
  const open = !!aq && !aq.halt && !overCap;
  const ok = stake > 0 && stake + fee <= me.cash && !full && (trigPx == null ? open : trigPx > 0 && !overCap);
  // Max : tout le solde, frais d'ouverture compris, et sans dépasser le plafond d'une action d'Aurelys.
  const maxStake = Math.min(Math.floor(me.cash / (1 + pref.lev * FEE)), Math.floor(cap / pref.lev));
  let body, title, cta;
  {
    const p = aq?.p ?? 0, sl = slip(null, ticket.tk, stake * pref.lev), entry = p * (1 + (dir === "up" ? sl : -sl)), b = { entry, lev: pref.lev, dir, stake };
    title = AUR[ticket.tk].name;
    cta = `${trigPx ? "Placer l'ordre : " : ""}${dir === "up" ? "▲ Hausse" : "▼ Baisse"} ×${pref.lev}, ${W(stake)}`;
    body = <>
      <div className="seg" role="group" aria-label="Sens">
        <button type="button" aria-pressed={dir === "up"} className="buy" onClick={() => setDir("up")}>▲ Hausse</button>
        <button type="button" aria-pressed={dir === "down"} className="sell" onClick={() => setDir("down")}>▼ Baisse</button>
      </div>
      <label htmlFor="stake">Mise</label>
      <div className="stake"><input id="stake" className="mono" type="number" inputMode="numeric" min="1" step="1" value={stake} onChange={e => setStake(Math.max(0, Math.floor(+e.target.value || 0)))} /><span>W</span></div>
      <StakeChips value={stake} set={setStake} cash={me.cash} max={maxStake} />
      <label>Levier</label>
      <div className="seg" role="group" aria-label="Levier">{LEVS.map(v => <button key={v} type="button" aria-pressed={pref.lev === v} disabled={v > maxLev} title={v > maxLev ? lockOf(v) : undefined} onClick={() => set({ lev: v })}>×{v}{v > maxLev ? " 🔒" : ""}</button>)}</div>
      {young ? <p className="muted small">Jeune pousse, très volatile : levier ×5 au plus.</p>
        : LEVS.some(v => v > maxLev) && <p className="muted small">{lockOf(LEVS.find(v => v > maxLev))}</p>}
      <dl className="t-figs">
        <div><dt>Si le cours bouge de 1 %</dt><dd className="mono">±{W(stake * pref.lev / 100)}</dd></div>
        <div><dt>Liquidation à</dt><dd className="mono">{aurPx(liqPrice(b))}</dd></div>
      </dl>
      <details className="t-more">
        <summary>Détail de l'ordre</summary>
        <div className="plain">
          <div className="plain-row"><span>Cours actuel</span><b className="mono">{aurPx(p)}</b></div>
          <div className="plain-row"><span>Impact de ton ordre (estimé)</span><b className="mono">{dir === "up" ? "+" : "−"}{nf2.format(sl * 100)} %</b></div>
          <div className="plain-row"><span>Prix d'exécution estimé</span><b className="mono">{aurPx(entry)}</b></div>
          <div className="plain-row"><span>Frais d'ouverture (0,1 %)</span><b className="mono">{W(fee)}</b></div>
          <div className="plain-row"><span>Plafond sur cette action</span><b className="mono">{W(cap)} engagés</b></div>
        </div>
        <p className="muted small">Ton ordre fait bouger le cours : plus il est gros, et plus l'action est peu liquide, plus tu paies cher (même chose à la clôture). Le prix exact est calculé par le serveur. La position reste ouverte jusqu'à ce que tu la clôtures, ou jusqu'à la liquidation.</p>
      </details>
      {!terms.triggers && <p className="muted small">Ordres à déclenchement (ouvrir quand le cours atteint un seuil) : niveau {TRIGGER_LEVEL}.</p>}
      {terms.triggers && <>
        <label htmlFor="trig">Ouvrir seulement quand le cours atteint (facultatif)</label>
        <input id="trig" className="mono" inputMode="decimal" placeholder="tout de suite" value={trig} onChange={e => setTrig(e.target.value)} />
        {trigPx > 0 && <p className="muted small">L'ordre attend que le cours {trigPx > p ? "monte" : "descende"} à {aurPx(trigPx)}, puis part au cours du marché (prix qui peut différer un peu). Ton solde n'est débité qu'à ce moment-là.</p>}
      </>}
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
        {full && <p className="error small">Au plus {maxPos} positions ouvertes ou en attente.</p>}
        {overCap && <p className="error small">Au plus {W(cap)} engagés (mise × levier) sur cette action.</p>}
        {aq?.halt && <p className="error small">Cotation suspendue, reprise dans quelques secondes.</p>}
        {stake + fee > me.cash && <p className="error small">Solde insuffisant : il te manque {W(stake + fee - me.cash)}{fee ? " (frais compris)" : ""}.</p>}
        <button type="submit" className={"btn big " + (dir === "up" ? "buy" : "sell")} disabled={!ok || busy}>{cta}</button>
      </form>
    </div>
  );
}
