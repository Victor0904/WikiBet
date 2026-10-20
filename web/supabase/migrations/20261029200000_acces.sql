-- Accès abusables (audit d'octobre 2026). Rien ne change à l'écran, sauf un message en cas de rafale d'ordres.

-- 1. Fonctions DEFINER sans usage avant connexion : le jeu les appelle toujours après la connexion anonyme (rôle
-- authenticated). login_email reste ouverte à anon : le tableau de bord admin s'en sert pour se connecter.
revoke execute on function aur_feed(timestamptz), aur_history(text, int), aur_set_auto(bigint, float8, float8),
  aur_trigger_add(text, text, int, float8, float8), aur_trigger_cancel(bigint), create_profile(text, text), leaderboard(),
  my_fee_rate(), my_login_email(), push_subscribe(text), push_unsubscribe(text), set_login_email(text) from public, anon;
grant execute on function aur_feed(timestamptz), aur_history(text, int), aur_set_auto(bigint, float8, float8),
  aur_trigger_add(text, text, int, float8, float8), aur_trigger_cancel(bigint), create_profile(text, text), leaderboard(),
  my_fee_rate(), my_login_email(), push_subscribe(text), push_unsubscribe(text), set_login_email(text) to authenticated;
revoke execute on function guild_bot_yield() from public, anon, authenticated; -- fonction de déclencheur

-- 2. Rafales d'ordres : 8 ordres au plus par fenêtre de 10 s et par joueur (ouvrir, clôturer, acheter, vendre),
-- vérifié par la fonction aurelys avant chaque ordre. Chaque appel coûte une exécution de fonction (quota du projet).
alter table profiles add column if not exists ord_win timestamptz, add column if not exists ord_n int not null default 0;
create or replace function order_gate(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update profiles set
    ord_n = case when ord_win is null or ord_win < clock_timestamp() - interval '10 seconds' then 1 else ord_n + 1 end,
    ord_win = case when ord_win is null or ord_win < clock_timestamp() - interval '10 seconds' then clock_timestamp() else ord_win end
   where id = p_user and not bot returning ord_n into n;
  if n > 8 then raise exception 'Trop d''ordres d''un coup : attends quelques secondes.'; end if; -- annule aussi le comptage
end $$;
revoke execute on function order_gate(uuid) from public, anon, authenticated;

-- 3. tick (avancer le marché) : seul pg_cron l'appelle, avec le secret « aurelys_tick » du Vault en en-tête. Le même
-- secret est TICK_SECRET dans les secrets de la fonction. Posés à la main, jamais dans le dépôt (voir CLAUDE.md).
do $$ begin
  perform cron.alter_job(jobid, command := replace(command, '''Content-Type'', ''application/json'',',
    '''Content-Type'', ''application/json'', ''x-tick-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''aurelys_tick''),'))
     from cron.job where jobname = 'wikibourse-aurelys' and command not like '%x-tick-secret%';
exception when others then raise notice 'moteur : en-tête non ajouté (%)', sqlerrm; end $$;
