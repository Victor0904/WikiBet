import { useEffect, useState, lazy, Suspense } from "react";
import { CAP0 } from "./engine.js";
import { W } from "./format.js";
import { Logo, LangSwitch, LogoLoader } from "./nav.jsx";
// Accueil léger : le jeu, Supabase et les pages secondaires se chargent à part (premier affichage plus rapide).
const Game = lazy(() => import("./Game.jsx"));
const LoginPanel = lazy(() => import("./social.jsx").then(m => ({ default: m.LoginPanel })));
const Landing = lazy(() => import("./Landing.jsx"));
const ONLINE = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
// Session Supabase gardée dans ce navigateur ? Sinon, c'est une première visite : l'accueil s'affiche tout de suite.
const hasSession = () => { try { return Object.keys(localStorage).some(k => /^sb-.+-auth-token$/.test(k)) } catch { return true } };
// Routes : « / » la page d'accueil, « /jouer » le jeu, « /jouer?demo=1 » l'essai sans compte (base locale, rien sur le serveur).
const PATH = location.pathname.replace(/\/+$/, "") || "/";
export const TRIAL = PATH === "/jouer" && new URLSearchParams(location.search).get("demo") === "1";
// Lien de parrainage (?ref=CODE) : le code est gardé dans ce navigateur jusqu'à l'inscription, l'adresse est nettoyée.
try {
  const q = new URLSearchParams(location.search), r = q.get("ref");
  if (r) { localStorage.setItem("wb-ref", r.slice(0, 40)); q.delete("ref"); history.replaceState(null, "", location.pathname + (q.size ? "?" + q : "")) }
} catch { }
// Déjà connecté : « / » mène droit au jeu.
const LANDING = PATH === "/" && !(ONLINE && hasSession());
if (PATH === "/" && !LANDING) history.replaceState(null, "", "/jouer");
let apiP; const getApi = () => apiP ??= TRIAL ? import("./demo.js").then(m => m.demoApi()) : import("./api.js").then(m => m.connect());
const Wait = () => <main className="center"><LogoLoader size={72} ariaLabel={TRIAL ? "Préparation du marché d'essai, dans ton navigateur…" : "Connexion au marché…"} /></main>;

export default function App() {
  if (LANDING) return <Suspense fallback={<main className="center"><LogoLoader size={72} /></main>}><Landing /></Suspense>;
  return <><Play /><NewVersion /></>;
}

// Page chargée avant une mise à jour : une fonction du serveur n'existe plus (api.js, « wb-version »), ou un morceau
// du site n'est plus en ligne (Vite, « vite:preloadError »). Le service worker ne met rien en cache : recharger suffit.
function NewVersion() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const show = e => { setOn(true); e?.preventDefault?.() };
    addEventListener("wb-version", show); addEventListener("vite:preloadError", show);
    return () => { removeEventListener("wb-version", show); removeEventListener("vite:preloadError", show) };
  }, []);
  if (!on) return null;
  return <div className="toast update" role="alert">Nouvelle version disponible.
    <button type="button" className="toast-act" onClick={() => location.reload()}>Recharger</button></div>;
}

function Play() {
  const [api, setApi] = useState(null), [err, setErr] = useState(null), [intro, setIntro] = useState(TRIAL);
  // Profil : false = accueil, true = jeu, undefined = on ne sait pas encore.
  const [profile, setProfile] = useState(() => ONLINE && !TRIAL && !hasSession() ? false : undefined);
  useEffect(() => {
    getApi().then(async a => {
      // Essai : un joueur local créé d'office, sans toucher au code de parrainage gardé pour la vraie inscription.
      if (TRIAL && !(await a.me())) await a.createProfile("Invité");
      setApi(a); if (profile === undefined) setProfile(!!(await a.me()))
    }).catch(e => setErr(e.message));
    import("./Game.jsx").catch(() => {}); // préchargé pendant l'accueil
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <main className="center"><p className="error">{err}</p></main>;
  if (intro) return <Intro ready={!!api && profile !== undefined} onDone={() => setIntro(false)} />;
  if (profile === false) return <Onboarding api={api} onDone={() => setProfile(true)} />;
  if (!api || profile === undefined) return <Wait />;
  return <Suspense fallback={<Wait />}><Game api={api} trial={TRIAL} onNoProfile={() => setProfile(false)} /></Suspense>;
}

// Essai : présentation du jeu pendant que la base locale s'installe (environ 14 s), puis le jeu s'ouvre seul.
const SLIDES = [
  ["Bienvenue à Aurelys", "Un pays inventé, une bourse de 13 sociétés fictives. Tu démarres avec 10 000 W, une monnaie fictive."],
  ["Les cours naissent des ordres", "Joueurs, bots et baleines achètent et vendent. Ton propre ordre fait bouger le prix."],
  ["Hausse ou baisse, avec levier", "À ×5, une hausse de 1 % rapporte 5 % de ta mise. Mais si le cours part dans l'autre sens, ta position peut tomber à 0."],
  ["Suis les nouvelles", "Rumeurs, résultats, banque centrale, et de vrais chiffres : la pluie en Beauce, l'électricité en France, les jours fériés."],
];
const SLIDE_MS = 3500;
function Intro({ ready, onDone }) {
  const [i, setI] = useState(0), last = i >= SLIDES.length - 1;
  useEffect(() => { if (!last) { const id = setTimeout(() => setI(i + 1), SLIDE_MS); return () => clearTimeout(id) } }, [i, last]);
  useEffect(() => { if (last && ready) { const id = setTimeout(onDone, SLIDE_MS); return () => clearTimeout(id) } }, [last, ready, onDone]);
  const [title, text] = SLIDES[i];
  return (
    <main className="center intro">
      <div className="intro-box">
        <LangSwitch />
        <div className="intro-bars" aria-hidden="true">{SLIDES.map((_, k) => <span key={k} className={k < i ? "done" : k === i ? "on" : ""} />)}</div>
        <span className="logo big"><LogoLoader size={44} loading={!ready} ariaLabel={ready ? "Le marché est prêt." : "Chargement…"} />Aurelys</span>
        <div key={i} className="intro-slide" aria-live="polite"><h1>{title}</h1><p>{text}</p></div>
        <p className="muted small">{ready ? "Le marché est prêt." : "Préparation du marché d'essai, dans ton navigateur…"}</p>
        <button type="button" className="btn primary" disabled={!ready} onClick={onDone}>{ready ? "Passer" : "Chargement…"}</button>
      </div>
    </main>
  );
}

function Onboarding({ api, onDone }) {
  const online = api ? !!api.account : ONLINE;
  const [pseudo, setPseudo] = useState(""), [pw, setPw] = useState(""), [err, setErr] = useState(null), [login, setLogin] = useState(false);
  const [ref, setRef] = useState(() => { try { return localStorage.getItem("wb-ref") ?? "" } catch { return "" } });
  // En ligne, le compte se crée tout de suite avec un mot de passe : on se reconnecte avec son pseudo, le navigateur s'en souvient.
  const submit = async e => {
    e.preventDefault();
    let a;
    try { a = api ?? await getApi(); await a.createProfile(pseudo, ref.trim()) } catch (x) { return setErr(x.message) }
    try { localStorage.removeItem("wb-ref") } catch { }
    if (!a.account) return onDone();
    try { await a.account.register(pseudo.trim(), pw) } catch (x) { setErr(`Partie créée, mais mot de passe refusé : ${x.message} Tu pourras le choisir dans Mon compte.`); setTimeout(onDone, 4000) }
  };
  return (
    <main className="center">
      <form className="onboard" onSubmit={submit}>
        <LangSwitch />
        <Logo big />
        <p className="muted">Une bourse inventée, Aurelys, dont les cours naissent des ordres des joueurs et des bots. Tu démarres avec {W(CAP0)}.</p>
        <label htmlFor="pseudo">Ton pseudo</label>
        <input id="pseudo" name="username" autoComplete="username" value={pseudo} onChange={e => setPseudo(e.target.value)} minLength={2} maxLength={20} required autoFocus />
        {online && <>
          <label htmlFor="pw">Mot de passe</label>
          <input id="pw" name="password" type="password" autoComplete="new-password" placeholder="8 caractères au moins" value={pw} onChange={e => setPw(e.target.value)} minLength={8} required />
        </>}
        <label htmlFor="ref">Code de parrainage <span className="muted">(facultatif)</span></label>
        <input id="ref" name="ref" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ex. VAYK-7Q2" value={ref} onChange={e => setRef(e.target.value)} maxLength={40} />
        {err && <p className="error">{err}</p>}
        <button className="btn primary" type="submit">Entrer sur le marché</button>
      </form>
      {online && <div className="onboard">
        {login ? (api ? <Suspense fallback={null}><LoginPanel account={api.account} /></Suspense> : <LogoLoader size={40} ariaLabel="Connexion au marché…" />) : <button type="button" className="link" onClick={() => setLogin(true)}>Déjà un compte ? Se connecter</button>}
      </div>}
    </main>
  );
}

