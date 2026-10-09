-- Ménage après le retrait du Live : la base ne doit plus grossir sans fin.
-- Relevés Twitch / Steam : la moitié de la base, plus lus par personne (les paris gardent leurs chiffres d'entrée et de sortie).
truncate stream_ticks;

-- Journal de pg_cron : environ 35 000 lignes par jour (tâche du marché toutes les 10 s), on garde 2 jours.
do $$ begin
  perform cron.schedule('wikibourse-menage', '17 4 * * *', $c$delete from cron.job_run_details where end_time < now() - interval '2 days'$c$);
exception when others then null; end $$;
