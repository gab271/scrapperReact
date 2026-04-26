import axios from 'axios';
import iconv from 'iconv-lite';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';

// ─────────────────────────────────────────────────────────────
//  DOE — Diario Oficial de Extremadura
//
//  Portal: https://doe.juntaex.es
//  Estrategia: POST al buscador avanzado con fechas y término
//    POST https://doe.juntaex.es/busquedas/disposiciones.php
//    buscardesc=nodesc → búsqueda por título (campo textobus)
//    Encoding: ISO-8859-1
//    Fechas formato: dd-mm-aaaa (guiones, no barras)
//
//  Resultado HTML: table.anchotabla > tr > td.justificado
//    span.DOE2VERDE → "D.O.E. Nº 43 de 03/03/2020" (boletín + fecha)
//    span.DOE2 (1) → organismo   span.DOE2 (2) → categoría
//    span.DOE4 → título + a.enlace_dis[href] → PDF relativo a /
// ─────────────────────────────────────────────────────────────

const DOE_BASE   = 'https://doe.juntaex.es';
const DOE_SEARCH = `${DOE_BASE}/busquedas/disposiciones.php`;

const KW_ACCION = [
  'transmisión', 'transmision', 'traslado', 'apertura', 'cierre',
  'cambio de titular', 'cambio de titularidad',
  'adjudicación', 'adjudicacion', 'autorización', 'autorizacion',
  'concesión', 'concesion', 'información pública',
];

const KW_EXCLUIR = [
  'hospitalaria', 'técnico en farmacia', 'farmacología',
  'oposición', 'oposicion', 'bolsa de trabajo', 'concurso de traslados',
  'personal estatutario',
];

const MUNICIPIOS = [
  'Badajoz', 'Cáceres', 'Mérida', 'Plasencia', 'Almendralejo',
  'Zafra', 'Don Benito', 'Villanueva de la Serena', 'Navalmoral de la Mata',
  'Montijo', 'Jerez de los Caballeros', 'Coria', 'Trujillo',
  'Miajadas', 'Azuaga', 'Olivenza', 'Llerena', 'Guareña',
];

function fmtFecha(hoy: Date): string {
  const dd   = String(hoy.getDate()).padStart(2, '0');
  const mm   = String(hoy.getMonth() + 1).padStart(2, '0');
  const yyyy = hoy.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function esRelevante(titulo: string): boolean {
  const tl = titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (KW_EXCLUIR.some(k => tl.includes(k.normalize('NFD').replace(/[̀-ͯ]/g, '')))) return false;
  return (
    (tl.includes('farmacia') || tl.includes('oficina')) &&
    KW_ACCION.some(k => tl.includes(k.normalize('NFD').replace(/[̀-ͯ]/g, '')))
  );
}

function extraerMunicipio(texto: string): string {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(texto);
  for (const m of MUNICIPIOS) if (n.includes(norm(m))) return m;
  const match = texto.match(
    /(?:sita?|ubicada?|situada?|localidad\s+de|municipio\s+de)\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s-]{3,35}?)(?=[,.]|\s+\()/i,
  );
  return match ? match[1].trim() : 'Extremadura';
}

function extraerFecha(texto: string): string {
  // "D.O.E. Nº 43 de 03/03/2020" → "03/03/2020"
  const m = texto.match(/de\s+(\d{2}\/\d{2}\/\d{4})/);
  return m ? m[1] : texto.trim();
}

export class DoeScraper implements IScraper {
  readonly nombre    = 'DOE';
  readonly comunidad = 'Extremadura';
  readonly keywords  = ['oficina de farmacia'];

  private readonly http = axios.create({
    baseURL:     DOE_BASE,
    timeout:     30_000,
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      Accept:       'text/html,application/xhtml+xml',
      Referer:      `${DOE_BASE}/busquedas/bus_avanzada.php`,
    },
  });

  private decode(data: ArrayBuffer): string {
    return iconv.decode(Buffer.from(data), 'iso-8859-1');
  }

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const vistos = new Map<string, AnuncioFarmacia>();

    console.log('[DOE] ════════════════════════════════════════');
    console.log('[DOE] Iniciando — Extremadura (DOE)');
    console.log('[DOE] Estrategia: POST búsqueda avanzada (título = farmacia)');
    console.log('[DOE] ════════════════════════════════════════');

    const hoy    = new Date();
    const inicio = new Date('2000-01-01');
    const params = new URLSearchParams({
      buscardesc: 'nodesc',
      textobus:   'farmacia',
      yuo:        '0',
      fecha1:     fmtFecha(inicio),
      fecha2:     fmtFecha(hoy),
      tipo:       ' ',
      rango:      '00',
      descriptor: '00',
      orgabus:    '',
    });

    try {
      const res = await this.http.post<ArrayBuffer>(DOE_SEARCH, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const html = this.decode(res.data);
      const $ = cheerio.load(html);

      $('table.anchotabla tr td.justificado').each((_, el) => {
        const $td = $(el);

        const fechaTxt  = extraerFecha($td.find('span.DOE2VERDE').first().text().trim());
        const organismos = $td.find('span.DOE2').map((_, s) => $(s).text().trim()).get();
        const organismo  = organismos[0] || '';
        const categoria  = organismos[1] || '';

        const $doe4  = $td.find('span.DOE4');
        const pdfRel = $td.find('a.enlace_dis').attr('href') || '';
        const enlace = pdfRel ? (pdfRel.startsWith('http') ? pdfRel : `${DOE_BASE}${pdfRel}`) : '';

        // Remove the PDF image text from title
        const titulo = $doe4.clone().find('a').remove().end().text()
          .replace(/\s+/g, ' ')
          .replace(/Consultar esta disposición.*$/i, '')
          .trim();

        if (!titulo || titulo.length < 10) return;
        if (!esRelevante(`${categoria} ${titulo}`)) return;

        const key = enlace || titulo.slice(0, 80);
        if (vistos.has(key)) return;

        vistos.set(key, {
          titulo:        titulo.slice(0, 350),
          fecha:         fechaTxt || 'Fecha no disponible',
          municipio:     extraerMunicipio(titulo),
          enlace_pdf:    enlace,
          texto_resumen: `${categoria} ${titulo}`.slice(0, 500),
          comunidad:     this.comunidad,
          fuente:        this.nombre,
          ...extraerTitulares(titulo),
        });
      });

      console.log(`[DOE] Encontrados: ${vistos.size} anuncios relevantes`);

      if (vistos.size === 0) {
        const msg = 'La búsqueda no devolvió anuncios de ciclo de vida de farmacias';
        console.warn(`[DOE] ℹ️  ${msg}`);
        advertencias.push(msg);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DOE] ❌ ${msg}`);
      advertencias.push(msg);
    }

    const anuncios    = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    anuncios.forEach(a => console.log(`[DOE]   ${a.fecha} | ${a.titulo.slice(0, 80)}`));
    console.log('[DOE] ════════════════════════════════════════');
    console.log(`[DOE] Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[DOE] ════════════════════════════════════════');

    return {
      comunidad:  this.comunidad,
      total:      anuncios.length,
      anuncios,
      timestamp:  new Date().toISOString(),
      duracion_ms,
      ...(advertencias.length ? { advertencias } : {}),
    };
  }
}

export const doeScraper = new DoeScraper();
