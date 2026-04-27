import { Router, Request, Response } from 'express';
import {
  getFarmaciasDirectorio,
  getMunicipiosDirectorio,
  countDirectorioByComunidad,
} from '../db/directorioService';
import { scrapeDirectorioComunidad } from '../scrapers/overpassScraper';

const router = Router();

// GET /api/directorio/:comunidad
router.get('/:comunidad', async (req: Request, res: Response) => {
  const { comunidad }      = req.params;
  const { busqueda, municipio } = req.query as Record<string, string>;
  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

  const t0 = Date.now();

  try {
    // Auto-sync si la comunidad no tiene datos aún
    const count = countDirectorioByComunidad(comunidad);
    if (count === 0) {
      console.log(`[Directorio] Sin datos para ${comunidad}, lanzando sync inicial…`);
      await scrapeDirectorioComunidad(comunidad);
    }

    const result     = getFarmaciasDirectorio({ comunidad, busqueda, municipio, page, limit });
    const municipios = getMunicipiosDirectorio(comunidad);

    res.json({
      ok: true,
      comunidad,
      ...result,
      municipios,
      duracion_ms: Date.now() - t0,
      timestamp:   new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[Directorio] Error GET ${comunidad}:`, err);
    res.status(500).json({
      ok:    false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    });
  }
});

// POST /api/directorio/sync/:comunidad
router.post('/sync/:comunidad', async (req: Request, res: Response) => {
  const { comunidad } = req.params;
  const t0 = Date.now();

  try {
    const result = await scrapeDirectorioComunidad(comunidad);
    res.json({
      ok: true,
      comunidad,
      ...result,
      duracion_ms: Date.now() - t0,
      timestamp:   new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[Directorio] Error sync ${comunidad}:`, err);
    res.status(500).json({
      ok:    false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    });
  }
});

export default router;
