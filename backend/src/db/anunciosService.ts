import { getDb } from './database';
import { AnuncioFarmacia } from '../scrapers/types';
import { parsePersons } from '../utils/parsePersons';
import { parsearFechaISO } from '../utils/parsearFechaISO';

// Meses máximos a conservar. Se puede sobreescribir con env LOOKBACK_MONTHS.
const LOOKBACK_MONTHS = Number(process.env.LOOKBACK_MONTHS) || 12;

// ── Helpers ──────────────────────────────────────────────────

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

/** ISO de hace N meses para usar en WHERE fecha_iso >= ? */
function fechaLimite(meses: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ── Servicio ─────────────────────────────────────────────────

/**
 * Inserta anuncios usando INSERT OR IGNORE (dedup por enlace_pdf).
 * Omite registros con fecha_iso parseable que sea más antigua que LOOKBACK_MONTHS.
 * Devuelve el número de registros insertados.
 */
export function saveAnnouncements(anuncios: AnuncioFarmacia[]): number {
  const db   = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO anuncios
      (fuente, comunidad, titulo, fecha, fecha_iso, municipio, enlace_pdf,
       texto_resumen, tipo_operacion,
       titular_saliente, titular_entrante,
       email, nombre_farmacia, direccion_farmacia, texto_completo)
    VALUES
      (@fuente, @comunidad, @titulo, @fecha, @fecha_iso, @municipio, @enlace_pdf,
       @texto_resumen, @tipo_operacion,
       @titular_saliente, @titular_entrante,
       @email, @nombre_farmacia, @direccion_farmacia, @texto_completo)
  `);

  const limite = fechaLimite(LOOKBACK_MONTHS);

  const insertMany = db.transaction((items: AnuncioFarmacia[]) => {
    let inserted = 0;
    for (const item of items) {
      const fecha_iso = parsearFechaISO(item.fecha);

      // Descartar registros demasiado antiguos (solo si podemos parsear la fecha)
      if (fecha_iso && fecha_iso < limite) continue;

      let { titular_saliente, titular_entrante } = item;
      if (!titular_saliente || !titular_entrante) {
        const textoFallback = [item.texto_completo, item.titulo, item.texto_resumen]
          .filter(Boolean).join(' ');
        const personas = parsePersons(item.titulo, textoFallback);
        titular_saliente = titular_saliente ?? personas.titular_saliente;
        titular_entrante = titular_entrante ?? personas.titular_entrante;
      }

      const result = stmt.run({
        fuente:             item.fuente,
        comunidad:          normalizeComunidadKey(item.comunidad),
        titulo:             item.titulo,
        fecha:              item.fecha,
        fecha_iso,
        municipio:          item.municipio,
        enlace_pdf:         item.enlace_pdf,
        texto_resumen:      item.texto_resumen,
        tipo_operacion:     detectTipoOperacion(item.titulo + ' ' + item.texto_resumen),
        titular_saliente:   titular_saliente   ?? null,
        titular_entrante:   titular_entrante   ?? null,
        email:              item.email             ?? null,
        nombre_farmacia:    item.nombre_farmacia   ?? null,
        direccion_farmacia: item.direccion_farmacia ?? null,
        texto_completo:     item.texto_completo    ?? null,
      });
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  return insertMany(anuncios);
}

export function getAnunciosByComunidad(
  comunidadKey: string,
  meses = LOOKBACK_MONTHS,
): AnuncioFarmacia[] {
  const db = getDb();
  const limite = fechaLimite(meses);

  return db.prepare(`
    SELECT fuente, comunidad, titulo, fecha, fecha_iso, municipio, enlace_pdf,
           texto_resumen, titular_saliente, titular_entrante,
           email, nombre_farmacia, direccion_farmacia
    FROM   anuncios
    WHERE  comunidad = ?
      AND  (fecha_iso IS NULL OR fecha_iso >= ?)
    ORDER  BY fecha_iso DESC, creado_at DESC
  `).all(comunidadKey.toLowerCase(), limite) as AnuncioFarmacia[];
}

export function getAllAnuncios(meses = LOOKBACK_MONTHS): AnuncioFarmacia[] {
  const db = getDb();
  const limite = fechaLimite(meses);

  return db.prepare(`
    SELECT fuente, comunidad, titulo, fecha, fecha_iso, municipio, enlace_pdf,
           texto_resumen, titular_saliente, titular_entrante,
           email, nombre_farmacia, direccion_farmacia
    FROM   anuncios
    WHERE  (fecha_iso IS NULL OR fecha_iso >= ?)
    ORDER  BY fecha_iso DESC, creado_at DESC
  `).all(limite) as AnuncioFarmacia[];
}

export function countByComunidad(comunidadKey: string): number {
  const db  = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as n FROM anuncios WHERE comunidad = ?'
  ).get(comunidadKey.toLowerCase()) as { n: number };
  return row.n;
}
