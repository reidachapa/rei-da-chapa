select cron.schedule('rei-processar-fotos-catalogo', '* * * * *',
  'select app_internal.rei_processar_fotos_pendentes()');
