import { Router, Request, Response } from 'express';
import { scrapers } from '../scrapers';
import { saveAnnouncements } from '../db/anunciosService';

const router = Router();

interface SyncResultado {
  total: number;
  nuevos: number;
  error?: string;
}

// POST /api/farmacias/sync
// Ejecuta todos los scrapers en paralelo y persiste los resultados en SQLite.
// Devuelve cuando todos han terminado (o fallado) con un resumen.
router.post('/', async (_req: Request, res: Response) => {
  console.log('\n[SYNC] ▶ Iniciando sincronización de todos los scrapers...');
  const inicio = Date.now();

  const resultados: Record<string, SyncResultado> = {};

  await Promise.allSettled(
    Object.entries(scrapers).map(async ([key, scraper]) => {
      try {
        const result  = await scraper.scrape();
        const nuevos  = saveAnnouncements(result.anuncios);
        resultados[key] = { total: result.total, nuevos };
        console.log(`[SYNC] ✅ ${key}: ${result.total} anuncios (${nuevos} nuevos)`);
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Error desconocido';
        resultados[key] = { total: 0, nuevos: 0, error };
        console.error(`[SYNC] ❌ ${key}: ${error}`);
      }
    })
  );

  const duracion_ms  = Date.now() - inicio;
  const total_nuevos = Object.values(resultados).reduce((s, r) => s + r.nuevos, 0);

  console.log(`[SYNC] ✅ Completado en ${(duracion_ms / 1000).toFixed(1)}s — ${total_nuevos} nuevos anuncios insertados\n`);

  res.json({
    ok:           true,
    duracion_ms,
    total_nuevos,
    resultados,
    timestamp:    new Date().toISOString(),
  });
});

export default router;
