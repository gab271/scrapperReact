const MESES: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04',
  mayo: '05', junio: '06', julio: '07', agosto: '08',
  septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
};

/**
 * Convierte cualquier formato de fecha de boletín a ISO (YYYY-MM-DD).
 * Formatos soportados:
 *   "27 de febrero de 2014"  →  "2014-02-27"
 *   "01/04/2026"             →  "2026-04-01"
 *   "2026-04-01"             →  "2026-04-01"
 * Devuelve null si no se puede parsear.
 */
export function parsearFechaISO(fecha: string): string | null {
  if (!fecha) return null;

  // "27 de febrero de 2014" / "7 de agosto de 2025"
  const mLarga = fecha.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
  if (mLarga) {
    const mes = MESES[mLarga[2].toLowerCase()];
    if (mes) return `${mLarga[3]}-${mes}-${mLarga[1].padStart(2, '0')}`;
  }

  // "01/04/2026"  (DD/MM/YYYY)
  const mSlash = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mSlash) {
    return `${mSlash[3]}-${mSlash[2].padStart(2, '0')}-${mSlash[1].padStart(2, '0')}`;
  }

  // "2026-04-01"  (ya en ISO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;

  return null;
}
