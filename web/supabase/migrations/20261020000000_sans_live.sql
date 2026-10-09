-- ===== Le Live (Twitch et Steam) est retiré : moins de requêtes, base plus légère (choix de Victor) =====
-- Les tables restent pour l'historique. Pixelfold et Ondéo n'ont plus de chiffre réel : elles vivent comme les autres.

do $$ begin perform cron.unschedule('wikibourse-twitch'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('wikibourse-steam'); exception when others then null; end $$;

-- Questions et positions en cours : mises rendues.
with r as (update bets set status = 'lost', payout = stake, closed_at = now()
           where status = 'open' and kind in ('question', 'stream') returning user_id, stake)
update profiles p set cash = cash + x.s from (select user_id, sum(stake) s from r group by 1) x where p.id = x.user_id;
update stream_markets set result = false, final_viewers = 0 where result is null;

-- settle() ne crée plus de questions (chaque appel relisait une journée de relevés pour les « pics du jour »).
create or replace function make_markets() returns int language sql as $$ select 0 $$;

-- pg_cron tourne sans limite de durée : un règlement bloqué ne doit pas garder ses verrous indéfiniment.
do $$ begin
  perform cron.schedule('wikibourse-settle', '* * * * *', 'set statement_timeout = ''30s''; select public.settle()');
exception when others then null; end $$;

revoke execute on function bet_question(bigint, text, float8), open_stream(text, text, int, float8, text) from authenticated;
