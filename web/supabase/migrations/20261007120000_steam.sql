-- Marché Steam : joueurs connectés par jeu, relevés chaque minute par la fonction steam-poll.
-- Un jeu est un « sujet » comme un streamer (table streamers, login = 'steam:<appid>'), avec le nombre de joueurs
-- comme valeur : toute la mécanique des questions Oui / Non (seuil, cote, règlement) s'applique telle quelle.

-- La relève Twitch ne doit demander à Twitch que des chaînes Twitch.
create or replace function streamers_to_watch() returns table (login text) language sql stable set search_path = public as $$
  select login from bets where status = 'open' and kind in ('stream', 'question') and login not like 'steam:%'
  union
  select login from stream_ticks where live and at > now() - interval '30 minutes' and login not like 'steam:%'
$$;

-- Seuil des questions : l'arrondi suit l'écart visé et plus la taille du nombre. Sinon, pour 1,3 million de joueurs,
-- l'arrondi à 50 000 près mettait le seuil 4 % au-dessus, hors d'atteinte en 15 min (Steam bouge lentement).
-- Écart visé : 0,4 écart type sur la durée (Oui ≈ 1 chance sur 3). Pas d'arrondi : la puissance de 10 sous cet écart.
create or replace function nice_threshold(v int, sigma float8, mins float8) returns int language sql immutable as $$
  select greatest(((floor(v / st) + 1) * st)::int, (round(target / st) * st)::int)
  from (select target, power(10, floor(log(greatest(target - v, 1)))) as st
        from (select v * exp(0.4 * sigma * sqrt(mins)) as target) t) x
$$;

-- Relève Steam chaque minute (pg_cron + pg_net), comme la relève Twitch.
do $$ begin
  perform cron.schedule('wikibourse-steam', '* * * * *', $cron$
    select net.http_post(
      url := 'https://urivyzajsfcbtbfrvjcs.supabase.co/functions/v1/steam-poll',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyaXZ5emFqc2ZjYnRiZnJ2amNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODE1MzQsImV4cCI6MjEwNjg1NzUzNH0.urFCndYjySGLjHQqoli4-UaP843pVG2kR1ggW7SpIxo'),
      body := '{}'::jsonb)
  $cron$);
exception when others then
  raise notice 'relève Steam non planifiée (%)', sqlerrm;
end $$;
