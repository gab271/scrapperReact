import { Router, Request, Response } from 'express';
import { scrapers } from '../scrapers';
import { ScraperResult } from '../scrapers/types';
import { getAnunciosByComunidad, getAllAnuncios, countByComunidad, saveAnnouncements } from '../db/anunciosService';

const router = Router();

// ── Helper CSV ───────────────────────────────────────────────
function toCSV(rows: ReturnType<typeof getAnunciosByComunidad>): string {
  const cols = [
    'comunidad', 'municipio', 'fecha', 'titulo',
    'titular_entrante', 'titular_saliente',
    'nombre_farmacia', 'direccion_farmacia',
    'email', 'enlace_pdf',
  ] as const;

  const escape = (v: unknown) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[,"\n\r]/.test(s) ? `"${s}"` : s;
  };

  const header = cols.join(',');
  const body   = rows.map(r => cols.map(c => escape(r[c as keyof typeof r])).join(',')).join('\n');
  return `${header}\n${body}`;
}

// GET /api/farmacias/export  — exporta TODOS los anuncios a CSV
router.get('/export', (req: Request, res: Response) => {
  const meses = Number(req.query.meses) || undefined;
  const anuncios = getAllAnuncios(meses);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="farmalitics_export.csv"');
  res.send('﻿' + toCSV(anuncios));
});

// GET /api/farmacias/:comunidad/export  — exporta una comunidad a CSV
router.get('/:comunidad/export', (req: Request, res: Response) => {
  const key = req.params.comunidad.toLowerCase();
  if (!scrapers[key]) {
    res.status(404).json({ error: `Comunidad desconocida: ${key}` });
    return;
  }
  const mesesExp = Number(req.query.meses) || undefined;
  const anuncios = getAnunciosByComunidad(key, mesesExp);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="farmalitics_${key}.csv"`);
  res.send('﻿' + toCSV(anuncios));
});

// GET /api/farmacias/:comunidad
router.get('/:comunidad', async (req: Request, res: Response) => {
  const { comunidad } = req.params;
  const key    = comunidad.toLowerCase();
  const meses  = Number(req.query.meses) || undefined;
  const scraper = scrapers[key];

  if (!scraper) {
    res.status(404).json({
      error: `No existe scraper para "${comunidad}". Disponibles: ${Object.keys(scrapers).join(', ')}`,
    });
    return;
  }

  // ── Ruta rápida: datos en caché ───────────────────────────
  const enCache = countByComunidad(key);
  if (enCache > 0) {
    const anuncios = getAnunciosByComunidad(key, meses);
    console.log(`[API] ⚡ GET /api/farmacias/${key} — ${anuncios.length} anuncios desde DB`);
    res.json({ ok: true, comunidad: key, total: anuncios.length, anuncios, timestamp: new Date().toISOString(), duracion_ms: 0, source: 'db' });
    return;
  }

  // ── Ruta lenta: DB vacía, scraping por primera vez ────────
  console.log(`\n[API] ▶ GET /api/farmacias/${key} — DB vacía, scraping...`);
  try {
    const resultado: ScraperResult = await scraper.scrape();
    saveAnnouncements(resultado.anuncios);
    const anuncios = getAnunciosByComunidad(key);
    res.json({ ok: true, source: 'scraper', comunidad: key, total: anuncios.length, anuncios, timestamp: resultado.timestamp, duracion_ms: resultado.duracion_ms });
    console.log(`[API] ✅ ${anuncios.length} anuncios guardados`);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    console.error(`[API] ❌ Error scraping ${key}:`, mensaje);
    res.status(200).json({ ok: false, comunidad: key, total: 0, anuncios: [], timestamp: new Date().toISOString(), duracion_ms: 0, error: `El scraper de ${key} ha encontrado un problema: ${mensaje}` });
  }
});

export default router;
