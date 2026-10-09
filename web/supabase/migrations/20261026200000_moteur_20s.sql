-- Le moteur passe de 10 s à 20 s entre deux appels, avec 35 s d'avance (au lieu de 20) : la vitesse du temps
-- d'Aurelys ne change pas, les cours à la seconde sont calculés à l'avance comme avant. Moitié moins d'écritures
-- de l'état, de passages d'aur_settle, de journaux pg_cron et d'appels de fonction.
-- Effet visible : liquidations, stops, objectifs et ordres à déclenchement exécutés jusqu'à 20 s après le seuil
-- (au lieu de 10). La liquidation reste au prix de liquidation, à l'heure du premier cours qui l'a touché.
-- Retour arrière : même appel avec '10 seconds' et "lead":20.
do $$ begin
  perform cron.alter_job(jobid, schedule := '20 seconds', command := replace(command, '"lead":20', '"lead":35'))
     from cron.job where jobname = 'wikibourse-aurelys';
exception when others then raise notice 'moteur non replanifié (%)', sqlerrm; end $$;
