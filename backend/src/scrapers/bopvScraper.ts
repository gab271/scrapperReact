/**
 * BOPV — Boletín Oficial del País Vasco / EHAA
 *
 * Arquitectura descubierta via sondeo manual:
 *
 *   1. Calendario mensual (sin Puppeteer):
 *      GET /bopv2/datos/YYYYMM.shtml
 *      → contiene: var enlaces = [['e26_0074.shtml'], ...]
 *
 *   2. Sumario de cada boletín:
 *      GET /web01-bopv/es/bopv2/datos/YYYY/MM/s26_NNNN.shtml
 *      → contiene: <p class="BOPVSumarioTitulo"><a href="NNNNa.shtml">TÍTULO</a></p>
 *
 *   Encoding: ISO-8859-1 (no UTF-8)
 *   Sin Puppeteer — axios + cheerio.
 */

import axios from 'axios';
import iconv from 'iconv-lite';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';

const BOPV_BASE    = 'https://www.euskadi.eus';
const LOOKBACK_MONTHS = 3;

const KW_PRINCIPAL = ['oficina de farmacia', 'farmazia bulegoa'];
const KW_ACCION    = [
  'transmisión', 'transmision', 'apertura', 'irekitzea',
  'cierre', 'itxiera',
  'cambio de titular', 'cambio de titularidad', 'titular aldaketa',
  'adjudicación', 'adjudicacion', 'traslado', 'lekualdatzea',
  'autorización', 'autorizacion', 'concesión', 'concesion',
  'denegación', 'denegacion', 'caducidad',
];

const MUNICIPIOS = [
  'Bilbao', 'Vitoria-Gasteiz', 'Vitoria', 'Gasteiz',
  'San Sebastián', 'Donostia', 'Barakaldo', 'Getxo',
  'Irun', 'Irún', 'Sestao', 'Basauri', 'Rentería', 'Errenteria',
  'Leioa', 'Galdakao', 'Portugalete', 'Santurtzi', 'Bermeo',
  'Durango', 'Eibar', 'Mondragón', 'Arrasate', 'Zarautz',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml',
  'Referer':    `${BOPV_BASE}/web01-bopv/es/bopv2/datos/Ultimo.shtml`,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function extraerMunicipio(texto: string): string {
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(texto);
  for (const m of MUNICIPIOS) if (n.includes(norm(m))) return m;
  const match = texto.match(
    /(?:sita?|ubicada?|situada?)\s+en\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s-]{3,30}?)(?=[,.]|\s+\()/i
  );
  return match ? match[1].trim() : 'País Vasco';
}

function esRelevante(titulo: string): boolean {
  const tl = titulo.toLowerCase();
  return (
    KW_PRINCIPAL.some(kw => tl.includes(kw)) &&
    KW_ACCION.some(kw => tl.includes(kw))
  );
}

// axios + iconv-lite para páginas ISO-8859-1
async function getIso(url: string): Promise<string> {
  const res = await axios.get(url, {
    headers:      HEADERS,
    timeout:      20_000,
    responseType: 'arraybuffer',
  });
  return iconv.decode(Buffer.from(res.data as ArrayBuffer), 'iso-8859-1');
}

// ─── Clase principal ────────────────────────────────────────────────────────

export class BopvScraper implements IScraper {
  readonly nombre    = 'BOPV';
  readonly comunidad = 'País Vasco';
  readonly keywords  = KW_PRINCIPAL;

  /**
   * Fetch del calendario mensual → extrae los números de boletín del mes.
   * URL: /bopv2/datos/YYYYMM.shtml
   * Contiene: var enlaces = [['e26_0074.shtml'], ...]
   * Devuelve array de números de boletín (ej. [62, 63, ..., 74])
   */
  private async numerosDelMes(year: number, month: number): Promise<number[]> {
    const mm  = String(month).padStart(2, '0');
    const url = `${BOPV_BASE}/bopv2/datos/${year}${mm}.shtml`;
    let html: string;
    try {
      html = await getIso(url);
    } catch {
      return [];
    }

    // var enlaces = [['e26_0062.shtml'], ['e26_0063.shtml'], ...]
    const match = html.match(/var\s+enlaces\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) return [];

    const numeros: number[] = [];
    // Extraer números de tipo e26_NNNN.shtml
    const re = /[es]\d{2}_(\d{4})\.shtml/g;
    let m: RegExpExecArray | null;
    const seen = new Set<number>();
    while ((m = re.exec(match[1])) !== null) {
      const n = parseInt(m[1], 10);
      if (!seen.has(n)) { seen.add(n); numeros.push(n); }
    }
    return numeros;
  }

  /**
   * Fetch del sumario de un boletín específico.
   * URL: /web01-bopv/es/bopv2/datos/YYYY/MM/s26_NNNN.shtml
   * Parsea p.BOPVSumarioTitulo → filtra por keywords → devuelve AnuncioFarmacia[]
   */
  private async parsearSumario(
    year: number, month: number, numBoletin: number,
  ): Promise<AnuncioFarmacia[]> {
    const yy  = String(year).slice(-2);      // "26"
    const mm  = String(month).padStart(2, '0');
    const nn  = String(numBoletin).padStart(4, '0');
    const url = `${BOPV_BASE}/web01-bopv/es/bopv2/datos/${year}/${mm}/s${yy}_${nn}.shtml`;

    let html: string;
    try {
      html = await getIso(url);
    } catch {
      return [];
    }

    const $   = cheerio.load(html);
    const anuncios: AnuncioFarmacia[] = [];

    // Extraer fecha del h2.tituGeneral ("Sumario n.º 74, fecha 22/04/2026" o similar)
    let fechaBoletin = 'Fecha no disponible';
    $('h2.tituGeneral').each((_, el) => {
      const txt = $(el).text();
      const fm  = txt.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
      if (fm) { fechaBoletin = fm[1]; return false; }
      // formato "22 de abril de 2026"
      const fe = txt.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
      if (fe) {
        const meses: Record<string, string> = {
          enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',
          julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12',
        };
        const m2 = meses[fe[2].toLowerCase()];
        if (m2) fechaBoletin = `${fe[1].padStart(2,'0')}/${m2}/${fe[3]}`;
        return false;
      }
    });

    // Si no hay fecha exacta, aproximar con el mes
    if (fechaBoletin === 'Fecha no disponible') {
      fechaBoletin = `01/${String(month).padStart(2,'0')}/${year}`;
    }

    const baseUrl = `${BOPV_BASE}/web01-bopv/es/bopv2/datos/${year}/${mm}/`;

    $('p.BOPVSumarioTitulo').each((_, el) => {
      const $el   = $(el);
      const $a    = $el.find('a').first();
      const titulo = $a.text().replace(/\s+/g, ' ').trim();

      if (!titulo || titulo.length < 20) return;
      if (!esRelevante(titulo)) return;

      const href   = $a.attr('href') ?? '';
      const enlace = href.startsWith('http') ? href
        : href ? `${baseUrl}${href}` : '';

      anuncios.push({
        titulo:        titulo.slice(0, 350),
        fecha:         fechaBoletin,
        municipio:     extraerMunicipio(titulo),
        enlace_pdf:    enlace,
        texto_resumen: titulo.slice(0, 500),
        comunidad:     this.comunidad,
        fuente:        this.nombre,
      });
    });

    return anuncios;
  }

  // ── Scraper principal ─────────────────────────────────────────────────────

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const anuncios: AnuncioFarmacia[] = [];
    const vistos = new Set<string>();

    console.log('[BOPV] ════════════════════════════════════════');
    console.log('[BOPV] Iniciando — País Vasco (BOPV/EHAA)');
    console.log('[BOPV] Estrategia: sumarios mensuales (axios + cheerio ISO-8859-1)');
    console.log(`[BOPV] Cobertura: últimos ${LOOKBACK_MONTHS} meses`);
    console.log('[BOPV] ════════════════════════════════════════');

    const hoy   = new Date();
    const meses: { year: number; month: number }[] = [];
    for (let i = 0; i < LOOKBACK_MONTHS; i++) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      meses.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    for (const { year, month } of meses) {
      const mm = String(month).padStart(2, '0');
      console.log(`[BOPV] Mes ${year}/${mm} — obteniendo lista de boletines...`);

      let numeros: number[];
      try {
        numeros = await this.numerosDelMes(year, month);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        advertencias.push(`Calendario ${year}/${mm}: ${msg}`);
        continue;
      }

      if (!numeros.length) {
        console.log(`[BOPV]   Sin boletines para ${year}/${mm}`);
        continue;
      }

      console.log(`[BOPV]   ${numeros.length} boletines: ${numeros[0]}–${numeros[numeros.length - 1]}`);

      for (const num of numeros) {
        try {
          const items = await this.parsearSumario(year, month, num);
          for (const item of items) {
            const key = item.enlace_pdf || item.titulo.substring(0, 80);
            if (!vistos.has(key)) { vistos.add(key); anuncios.push(item); }
          }
          if (items.length > 0) {
            console.log(`[BOPV]   Boletín ${num}: ${items.length} coincidencias`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          advertencias.push(`Boletín ${num} (${year}/${mm}): ${msg}`);
        }
      }
    }

    const duracion_ms = Date.now() - t0;
    console.log('[BOPV] ════════════════════════════════════════');
    console.log(`[BOPV] Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[BOPV] ════════════════════════════════════════');

    return {
      comunidad: this.comunidad,
      total:     anuncios.length,
      anuncios,
      timestamp: new Date().toISOString(),
      duracion_ms,
      ...(advertencias.length ? { advertencias } : {}),
    };
  }
}

export const bopvScraper = new BopvScraper();
