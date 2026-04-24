import { Router, Request, Response } from 'express';
import { scrapers } from '../scrapers';
import { saveAnnouncements } from '../db/anunciosService';

const router = Router();

// POST /api/farmacias/sync  — sincroniza todos los scrapers
router.post('/', async (_req: Request, res: Response) => {
  console.log('\n[SYNC] ▶ Iniciando sincronización de todos los scrapers...');
  const inicio = Date.now();
  const resultados: Record<string, { total: number; nuevos: number; error?: string }> = {};

  await Promise.allSettled(
    Object.entries(scrapers).map(async ([key, scraper]) => {
      try {
        const result = await scraper.scrape();
        const nuevos = saveAnnouncements(result.anuncios);
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
  console.log(`[SYNC] ✅ Completado en ${(duracion_ms / 1000).toFixed(1)}s — ${total_nuevos} nuevos\n`);

  res.json({ ok: true, duracion_ms, total_nuevos, resultados, timestamp: new Date().toISOString() });
});

// POST /api/farmacias/sync/:comunidad  — sincroniza solo una comunidad
router.post('/:comunidad', async (req: Request, res: Response) => {
  const key     = req.params.comunidad.toLowerCase();
  const scraper = scrapers[key];

  if (!scraper) {
    res.status(404).json({ error: `No existe scraper para "${key}". Disponibles: ${Object.keys(scrapers).join(', ')}` });
    return;
  }

  console.log(`\n[SYNC] ▶ Sincronizando ${key}...`);
  const t0 = Date.now();

  try {
    const result   = await scraper.scrape();
    const nuevos   = saveAnnouncements(result.anuncios);
    const duracion = Date.now() - t0;
    console.log(`[SYNC] ✅ ${key}: ${result.total} anuncios (${nuevos} nuevos) en ${duracion}ms`);
    res.json({ ok: true, comunidad: key, total: result.total, nuevos, duracion_ms: duracion, timestamp: new Date().toISOString() });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Error desconocido';
    console.error(`[SYNC] ❌ ${key}: ${error}`);
    res.status(500).json({ ok: false, comunidad: key, error });
  }
});

export default router;
