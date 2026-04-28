import { scrapers } from './scrapers';
import { saveAnnouncements } from './db/anunciosService';

// Calcula los ms hasta la próxima ejecución a la hora indicada
function msHastaProxima(hour: number, minute = 0): number {
  const now  = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function runNightlySync(): Promise<void> {
  const inicio = Date.now();
  console.log(`\n[Scheduler] ▶ Sync nocturno — ${new Date().toLocaleString('es-ES')}`);

  const keys = Object.keys(scrapers);

  const resultados = await Promise.allSettled(
    keys.map(async key => {
      try {
        const result = await scrapers[key].scrape();
        const nuevos = saveAnnouncements(result.anuncios);
        console.log(`[Scheduler] ✓ ${key.padEnd(16)} ${nuevos} nuevos`);
        return nuevos;
      } catch (err) {
        console.error(`[Scheduler] ✗ ${key}:`, err instanceof Error ? err.message : err);
        return 0;
      }
    }),
  );

  const totalNuevos = resultados.reduce(
    (sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0),
    0,
  );

  const duracion = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`[Scheduler] ✅ Completado en ${duracion}s — ${totalNuevos} anuncios nuevos\n`);
}

export function initScheduler(): void {
  const HORA_SYNC = 3; // 03:00 cada noche

  const arrancarCiclo = () => {
    runNightlySync();
    // Después del primer disparo, repetir cada 24 h exactas
    setInterval(runNightlySync, 24 * 60 * 60 * 1000);
  };

  const delay = msHastaProxima(HORA_SYNC);
  const proxima = new Date(Date.now() + delay);
  console.log(`[Scheduler] Próximo sync nocturno: ${proxima.toLocaleString('es-ES')}`);

  setTimeout(arrancarCiclo, delay);
}
