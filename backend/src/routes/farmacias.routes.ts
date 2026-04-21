import { Router, Request, Response } from 'express';
import { scrapers } from '../scrapers';
import { ScraperResult } from '../scrapers/types';
import { getAnunciosByComunidad, countByComunidad, saveAnnouncements } from '../db/anunciosService';

const router = Router();

// GET /api/farmacias/:comunidad
// Sirve desde SQLite si hay datos (carga instantánea).
// Si la DB está vacía para esa comunidad, ejecuta el scraper bajo demanda
// y persiste el resultado antes de responder.
router.get('/:comunidad', async (req: Request, res: Response) => {
  const { comunidad } = req.params;
  const key = comunidad.toLowerCase();
  const scraper = scrapers[key];

  if (!scraper) {
    const disponibles = Object.keys(scrapers).join(', ');
    res.status(404).json({
      error: `No existe scraper para "${comunidad}". Disponibles: ${disponibles}`,
    });
    return;
  }

  // ── Ruta rápida: datos en caché ───────────────────────────
  const enCache = countByComunidad(key);
  if (enCache > 0) {
    const anuncios = getAnunciosByComunidad(key);
    console.log(`[API] ⚡ GET /api/farmacias/${key} — ${anuncios.length} anuncios desde DB`);
    res.json({
      ok:          true,
      comunidad:   key,
      total:       anuncios.length,
      anuncios,
      timestamp:   new Date().toISOString(),
      duracion_ms: 0,
      source:      'db',
    });
    return;
  }

  // ── Ruta lenta: primer arranque, DB vacía ─────────────────
  console.log(`\n[API] ▶ GET /api/farmacias/${key} — DB vacía, scraping por primera vez...`);

  try {
    const resultado: ScraperResult = await scraper.scrape();
    saveAnnouncements(resultado.anuncios);

    // Devolver desde DB para incluir personas extraídas
    const anuncios = getAnunciosByComunidad(key);
    res.json({
      ok:          true,
      source:      'scraper',
      comunidad:   key,
      total:       anuncios.length,
      anuncios,
      timestamp:   resultado.timestamp,
      duracion_ms: resultado.duracion_ms,
    });

    console.log(`[API] ✅ ${anuncios.length} anuncios — guardados en DB`);
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : 'Error desconocido en el scraper';

    console.error(`[API] ❌ Error scraping ${key}:`, mensaje);

    res.status(200).json({
      ok:          false,
      comunidad:   key,
      total:       0,
      anuncios:    [],
      timestamp:   new Date().toISOString(),
      duracion_ms: 0,
      error:       `El scraper de ${key} ha encontrado un problema: ${mensaje}`,
    });
  }
});

export default router;
