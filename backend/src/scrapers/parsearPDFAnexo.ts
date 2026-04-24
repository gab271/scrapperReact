import axios from 'axios';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

export interface AdjudicatarioPDF {
  zona:      string;
  municipio: string;
  nombre:    string;
  nif:       string | null;
}

const RE_NIF    = /([XYZ]\d{7}[A-Z]|\d{8}[A-Z])/;
const RE_ZONA   = /ZONA\s+FARMAC[EÉ]UTICA\s+[\d.]+\.-?\s*(.+)/i;
const RE_SCORE  = /\d{1,3}[,.]\d{2}/;

// Línea de una sola entrada: "1 12345678A JUAN PÉREZ GARCÍA 21,35"
const RE_FILA_1 = /^1\s+([XYZ]\d{7}[A-Z]|\d{8}[A-Z])\s+(.+?)\s+\d{1,3}[,.]\d{1,2}\s*$/;

// Línea de posición sola: "1"  "2"  "10"
const RE_POS_SOLA = /^\d{1,3}$/;

// Cabeceras de página a ignorar entre zona y primer registro
const RE_CABECERA = /^(BOCM|BOLETÍN|JUEVES|LUNES|MARTES|MIÉRCOLES|VIERNES|SÁBADO|DOMINGO|Nº|N\.I\.F|NOMBRE\s+APELLIDOS?|PUNTUACIÓN|B\.O\.C\.M)/i;

/**
 * Descarga un PDF del BOCM y extrae el adjudicatario (posición 1) de cada zona del Anexo I.
 */
export async function parsearAnexoPDF(pdfUrl: string): Promise<AdjudicatarioPDF[]> {
  if (!pdfUrl) return [];

  let buffer: Buffer;
  try {
    const res = await axios.get<ArrayBuffer>(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 25_000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    buffer = Buffer.from(res.data);
  } catch {
    return [];
  }

  let texto: string;
  try {
    const data = await pdfParse(buffer);
    texto = data.text;
  } catch {
    return [];
  }

  const todos = extraerAdjudicatarios(texto);
  return deduplicarPorNIF(todos);
}

function extraerAdjudicatarios(texto: string): AdjudicatarioPDF[] {
  const adjudicatarios: AdjudicatarioPDF[] = [];
  const lineas = texto
    .split(/\r?\n/)
    .map(l => l.replace(/\s{2,}/g, ' ').trim())
    .filter(l => l.length > 0);

  for (let i = 0; i < lineas.length; i++) {
    const mZona = lineas[i].match(RE_ZONA);
    if (!mZona) continue;

    const zona      = lineas[i];
    const municipio = capitalizarZona(mZona[1].trim());

    // Buscar el primer registro de la zona (saltando cabeceras de página)
    let j = i + 1;
    while (j < lineas.length && RE_CABECERA.test(lineas[j])) j++;
    if (j >= lineas.length) continue;

    // ── Formato A: "1 NIF NOMBRE APELLIDOS PUNTUACIÓN" en una sola línea ──
    const mFila = lineas[j].match(RE_FILA_1);
    if (mFila) {
      adjudicatarios.push({
        zona,
        municipio,
        nombre: capitalizarNombre(mFila[2].trim()),
        nif:    mFila[1],
      });
      i = j; // avanzar para no procesar esta zona dos veces
      continue;
    }

    // ── Formato B: posición "1" sola, NIF+nombre en la línea siguiente ──
    if (lineas[j] === '1') {
      let k = j + 1;
      if (k >= lineas.length) continue;

      const lineaNif = lineas[k]; k++;
      const mNif = lineaNif.match(RE_NIF);
      if (!mNif) continue;

      // Recoger líneas de apellidos hasta la puntuación o siguiente posición
      const apellidoParts: string[] = [];
      while (
        k < lineas.length &&
        !RE_SCORE.test(lineas[k]) &&
        !RE_POS_SOLA.test(lineas[k]) &&
        !RE_ZONA.test(lineas[k])
      ) {
        apellidoParts.push(lineas[k]);
        k++;
      }

      const nif        = mNif[1];
      const nombreRaw  = lineaNif.replace(nif, '').trim();
      const nombre     = capitalizarNombre(
        [nombreRaw, apellidoParts.join(' ')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      );

      if (nombre.length >= 3) {
        adjudicatarios.push({ zona, municipio, nombre, nif });
      }
      i = j;
    }
  }

  return adjudicatarios;
}

/**
 * Si el mismo farmacéutico (mismo NIF) gana varias zonas, agrupa sus municipios
 * en un solo registro separado por " · " en lugar de crear N registros duplicados.
 */
function deduplicarPorNIF(adj: AdjudicatarioPDF[]): AdjudicatarioPDF[] {
  const porNif = new Map<string, AdjudicatarioPDF & { municipios: string[] }>();

  for (const a of adj) {
    const clave = a.nif ?? a.nombre; // si no hay NIF, usar nombre como clave
    const prev  = porNif.get(clave);
    if (prev) {
      if (!prev.municipios.includes(a.municipio)) prev.municipios.push(a.municipio);
    } else {
      porNif.set(clave, { ...a, municipios: [a.municipio] });
    }
  }

  return Array.from(porNif.values()).map(({ municipios, ...rest }) => ({
    ...rest,
    municipio: municipios.join(' · '),
    zona: municipios.length > 1
      ? `${municipios.length} zonas: ${municipios.join(', ')}`
      : rest.zona,
  }));
}

// ── Helpers ──────────────────────────────────────────────────

const PARTICULAS = new Set(['DE', 'LA', 'LOS', 'LAS', 'DEL', 'Y', 'E', 'EL']);

function capitalizar(s: string): string {
  return PARTICULAS.has(s.toUpperCase())
    ? s.toLowerCase()
    : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function capitalizarNombre(s: string): string {
  return s.split(/\s+/).map(capitalizar).join(' ');
}

function capitalizarZona(zona: string): string {
  const partes = zona.split(/\s+/).map(capitalizar);
  // La primera palabra siempre en mayúscula (ej: "El Molar", "Las Rozas")
  if (partes.length > 0) partes[0] = partes[0].charAt(0).toUpperCase() + partes[0].slice(1);
  return partes.join(' ');
}
