import { useEffect, useState, lazy, Suspense } from "react";
import { CAP0 } from "./engine.js";
import { W } from "./format.js";
import { Logo } from "./nav.jsx";
// Accueil léger : le jeu, Supabase et les pages secondaires se chargent à part (premier affichage plus rapide).
const Game = lazy(() => import("./Game.jsx"));
const LoginPanel = lazy(() => import("./social.jsx").then(m => ({ default: m.LoginPanel })));
const ONLINE = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
// Session Supabase gardée dans ce navigateur ? Sinon, c'est une première visite : l'accueil s'affiche tout de suite.
const hasSession = () => { try { return Object.keys(localStorage).some(k => /^sb-.+-auth-token$/.test(k)) } catch { return true } };
let apiP; const getApi = () => apiP ??= import("./api.js").then(m => m.connect());
const Wait = () => <main className="center"><p className="muted">Connexion au marché…</p></main>;

export default function App() {
  const [api, setApi] = useState(null), [err, setErr] = useState(null);
  // Profil : false = accueil, true = jeu, undefined = on ne sait pas encore.
  const [profile, setProfile] = useState(() => ONLINE && !hasSession() ? false : undefined);
  useEffect(() => {
    getApi().then(async a => { setApi(a); if (profile === undefined) setProfile(!!(await a.me())) }).catch(e => setErr(e.message));
    import("./Game.jsx").catch(() => {}); // préchargé pendant l'accueil
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <main className="center"><p className="error">{err}</p></main>;
  if (profile === false) return <Onboarding api={api} onDone={() => setProfile(true)} />;
  if (!api || profile === undefined) return <Wait />;
  return <Suspense fallback={<Wait />}><Game api={api} onNoProfile={() => setProfile(false)} /></Suspense>;
}

function Onboarding({ api, onDone }) {
  const online = api ? !!api.account : ONLINE;
  const [pseudo, setPseudo] = useState(""), [pw, setPw] = useState(""), [err, setErr] = useState(null), [login, setLogin] = useState(false);
  // En ligne, le compte se crée tout de suite avec un mot de passe : on se reconnecte avec son pseudo, le navigateur s'en souvient.
  const submit = async e => {
    e.preventDefault();
    let a;
    try { a = api ?? await getApi(); await a.createProfile(pseudo) } catch (x) { return setErr(x.message) }
    if (!a.account) return onDone();
    try { await a.account.register(pseudo.trim(), pw) } catch (x) { setErr(`Partie créée, mais mot de passe refusé : ${x.message} Tu pourras le choisir dans Mon compte.`); setTimeout(onDone, 4000) }
  };
  return (
    <main className="center">
      <form className="onboard" onSubmit={submit}>
        <Logo big />
        <p className="muted">Une bourse inventée, Aurelys, dont les cours naissent des ordres des joueurs et des bots. Tu démarres avec {W(CAP0)}.</p>
        <label htmlFor="pseudo">Ton pseudo</label>
        <input id="pseudo" name="username" autoComplete="username" value={pseudo} onChange={e => setPseudo(e.target.value)} minLength={2} maxLength={20} required autoFocus />
        {online && <>
          <label htmlFor="pw">Mot de passe</label>
          <input id="pw" name="password" type="password" autoComplete="new-password" placeholder="8 caractères au moins" value={pw} onChange={e => setPw(e.target.value)} minLength={8} required />
        </>}
        {err && <p className="error">{err}</p>}
        <button className="btn primary" type="submit">Entrer sur le marché</button>
      </form>
      {online && <div className="onboard">
        {login ? (api ? <Suspense fallback={null}><LoginPanel account={api.account} /></Suspense> : <p className="muted">Connexion au marché…</p>) : <button type="button" className="link" onClick={() => setLogin(true)}>Déjà un compte ? Se connecter</button>}
      </div>}
    </main>
  );
}

