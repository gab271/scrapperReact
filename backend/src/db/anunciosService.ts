import { getDb } from './database';
import { AnuncioFarmacia } from '../scrapers/types';
import { parsePersons } from '../utils/parsePersons';

// ── Helpers ──────────────────────────────────────────────────

// Normalize comunidad to match URL route keys (no accents, no spaces).
// 'País Vasco' → 'paisvasco', 'Aragón' → 'aragon', 'Cataluña' → 'cataluna'.
function normalizeComunidadKey(c: string): string {
  return c.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '');
}

function detectTipoOperacion(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('transmis') || t.includes('traspas') || t.includes('compraventa')) return 'transmision';
  if (t.includes('apertura') || t.includes('nueva farmacia'))                        return 'apertura';
  if (t.includes('cierre'))                                                           return 'cierre';
  return 'otro';
}

// ── Servicio ─────────────────────────────────────────────────

/**
 * Inserta anuncios usando INSERT OR IGNORE para evitar duplicados por enlace_pdf.
 * Extrae automáticamente titular_saliente y titular_entrante del texto.
 * Devuelve el número de registros realmente insertados.
 */
export function saveAnnouncements(anuncios: AnuncioFarmacia[]): number {
  const db   = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO anuncios
      (fuente, comunidad, titulo, fecha, municipio, enlace_pdf,
       texto_resumen, tipo_operacion, titular_saliente, titular_entrante)
    VALUES
      (@fuente, @comunidad, @titulo, @fecha, @municipio, @enlace_pdf,
       @texto_resumen, @tipo_operacion, @titular_saliente, @titular_entrante)
  `);

  const insertMany = db.transaction((items: AnuncioFarmacia[]) => {
    let inserted = 0;
    for (const item of items) {
      const personas = parsePersons(item.titulo, item.texto_resumen);
      const result   = stmt.run({
        fuente:           item.fuente,
        comunidad:        normalizeComunidadKey(item.comunidad),
        titulo:           item.titulo,
        fecha:            item.fecha,
        municipio:        item.municipio,
        enlace_pdf:       item.enlace_pdf,
        texto_resumen:    item.texto_resumen,
        tipo_operacion:   detectTipoOperacion(item.titulo + ' ' + item.texto_resumen),
        titular_saliente: personas.titular_saliente ?? null,
        titular_entrante: personas.titular_entrante ?? null,
      });
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  return insertMany(anuncios);
}

/**
 * Devuelve todos los anuncios de una comunidad desde SQLite,
 * incluyendo los datos de personas. Orden: fecha descendente.
 */
export function getAnunciosByComunidad(comunidadKey: string): AnuncioFarmacia[] {
  const db = getDb();
  return db.prepare(`
    SELECT fuente, comunidad, titulo, fecha, municipio, enlace_pdf,
           texto_resumen, titular_saliente, titular_entrante
    FROM   anuncios
    WHERE  comunidad = ?
    ORDER  BY fecha DESC, creado_at DESC
  `).all(comunidadKey.toLowerCase()) as AnuncioFarmacia[];
}

/**
 * Devuelve todos los anuncios de todas las comunidades.
 */
export function getAllAnuncios(): AnuncioFarmacia[] {
  const db = getDb();
  return db.prepare(`
    SELECT fuente, comunidad, titulo, fecha, municipio, enlace_pdf,
           texto_resumen, titular_saliente, titular_entrante
    FROM   anuncios
    ORDER  BY fecha DESC, creado_at DESC
  `).all() as AnuncioFarmacia[];
}

/**
 * Cuenta cuántos anuncios hay para una comunidad concreta.
 */
export function countByComunidad(comunidadKey: string): number {
  const db  = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as n FROM anuncios WHERE comunidad = ?'
  ).get(comunidadKey.toLowerCase()) as { n: number };
  return row.n;
}
