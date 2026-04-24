import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';

// ─────────────────────────────────────────────────────────────
//  BORM — Boletín Oficial de la Región de Murcia
//
//  Portal: https://www.borm.es  (AngularJS SPA)
//
//  Estrategia confirmada (abril 2026):
//    1. Puppeteer + stealth → cargar www.borm.es para que el JS
//       del navegador resuelva el challenge Radware StormCaster
//       y genere las cookies __uzma/__uzmb/__uzmc.
//    2. Desde el contexto del navegador (cookies ya válidas),
//       hacer un fetch() nativo al endpoint real de búsqueda:
//         POST https://www.borm.es/services/buscador
//         Headers: X-Requested-With: XMLHttpRequest
//                  Content-Type: application/json
//         Body: { textoLibre, fechaDesde, fechaHasta,
//                 tipo:"libre", origen:0, pageSize:100, currentPage:1, ... }
//    3. El servidor devuelve XML <ResultadoBusquedaDTO><anuncios>...
//       con campos: idAnuncio, sumario, fechaPublicacion, anunciante.
//    4. Parsear con cheerio (xmlMode) y filtrar por keywords.
//
//  Endpoint descubierto en: scripts/buscador/factories/buscadorFactory.js
// ─────────────────────────────────────────────────────────────

const BORM_BASE = 'https://www.borm.es';

const KW_ACCION = [
  'transmisión', 'transmision', 'apertura', 'cierre',
  'cambio de titular', 'cambio de titularidad',
  'adjudicación', 'adjudicacion', 'traslado',
  'autorización', 'autorizacion', 'concesión', 'concesion',
];

const MUNICIPIOS = [
  'Murcia', 'Cartagena', 'Lorca', 'Molina de Segura',
  'Alcantarilla', 'Yecla', 'Jumilla', 'Mazarrón',
  'Cieza', 'Torre-Pacheco', 'San Pedro del Pinatar',
  'San Javier', 'Alhama de Murcia', 'Totana', 'Caravaca de la Cruz',
  'Águilas', 'Calasparra', 'Mula',
];

// ─────────────────────────────────────────────────────────────

function parsearFecha(raw: string | undefined): string {
  if (!raw) return 'Fecha no disponible';
  // Formato API: "DD-MM-YYYY"
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return raw;
  return new Date(`${m[3]}-${m[2]}-${m[1]}`).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function ddmmaaaa(d: Date): string {
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('/');
}

function extraerMunicipio(texto: string): string {
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(texto);
  for (const m of MUNICIPIOS) if (n.includes(norm(m))) return m;
  const match = texto.match(
    /(?:sita?|ubicada?|situada?|municipio\s+de)\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s-]{3,30}?)(?=[,.]|\s+\()/i,
  );
  return match ? match[1].trim() : 'Murcia';
}

function esRelevante(texto: string): boolean {
  const tl = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return (
    tl.includes('farmacia') &&
    KW_ACCION.some(kw => tl.includes(kw.normalize('NFD').replace(/[̀-ͯ]/g, '')))
  );
}

function parsearXml(xml: string, comunidad: string, fuente: string): AnuncioFarmacia[] {
  const $       = cheerio.load(xml, { xmlMode: true });
  const result: AnuncioFarmacia[] = [];

  $('anuncios > anuncios').each((_, el) => {
    const $el   = $(el);
    const titulo = $el.find('sumario').text().replace(/\s+/g, ' ').trim();
    if (!titulo || !esRelevante(titulo)) return;

    const id       = $el.find('idAnuncio').text().trim();
    const fecha    = $el.find('fechaPublicacion').text().trim();
    const enlace   = id ? `${BORM_BASE}/services/anuncio/${id}/pdf` : '';

    result.push({
      titulo:        titulo.slice(0, 350),
      fecha:         parsearFecha(fecha),
      municipio:     extraerMunicipio(titulo),
      enlace_pdf:    enlace,
      texto_resumen: titulo.slice(0, 500),
      comunidad,
      fuente,
    });
  });

  return result;
}

// ─────────────────────────────────────────────────────────────

export class BormScraper implements IScraper {
  readonly nombre    = 'BORM';
  readonly comunidad = 'Murcia';
  readonly keywords  = ['oficina de farmacia'];

  private delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const vistos = new Map<string, AnuncioFarmacia>();

    console.log('[BORM] ════════════════════════════════════════');
    console.log('[BORM] Iniciando — Región de Murcia (BORM)');
    console.log('[BORM] Estrategia: Puppeteer + POST /services/buscador (XML)');
    console.log('[BORM] ════════════════════════════════════════');

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const puppeteerExtra = require('puppeteer-extra');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const StealthPlugin  = require('puppeteer-extra-plugin-stealth');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pptr = (puppeteerExtra.default ?? puppeteerExtra) as any;
    pptr.use(StealthPlugin());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let browser: any = null;

    try {
      browser = await pptr.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
        ],
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      );

      console.log('[BORM] Cargando www.borm.es (bypass Radware)...');
      await page.goto(BORM_BASE, { waitUntil: 'networkidle2', timeout: 30_000 });
      await this.delay(1500);

      const hoy   = new Date();
      const desde = new Date(hoy);
      desde.setDate(hoy.getDate() - 90);   // últimos 90 días
      const desdeStr = ddmmaaaa(desde);
      const hastaStr = ddmmaaaa(hoy);

      const terminos = ['oficina de farmacia', 'farmacia apertura', 'farmacia transmision'];

      for (const termino of terminos) {
        console.log(`[BORM] Buscando: "${termino}" (${desdeStr} → ${hastaStr})...`);
        await this.delay(300);

        const xml = await page.evaluate(
          async (term: string, desdeStr: string, hastaStr: string, base: string) => {
            const body = {
              textoLibre:      term,
              fechaDesde:      desdeStr,
              fechaHasta:      hastaStr,
              anunciante:      '',
              rango:           0,
              tipo:            'libre',
              nombre:          '',
              apellidos:       '',
              nif:             '',
              etiqueta:        0,
              origen:          0,
              idApartado:      '',
              anuncianteFaceta:'',
              idCategoria:     '',
              tipoBusqueda:    0,
              pageSize:        100,
              currentPage:     1,
            };
            const resp = await fetch(`${base}/services/buscador`, {
              method: 'POST',
              headers: {
                'Content-Type':    'application/json',
                'X-Requested-With':'XMLHttpRequest',
              },
              body: JSON.stringify(body),
            });
            if (!resp.ok) return `ERROR_${resp.status}`;
            return resp.text();
          },
          termino, desdeStr, hastaStr, BORM_BASE,
        );

        if (typeof xml === 'string' && xml.startsWith('ERROR_')) {
          const msg = `Búsqueda "${termino}": servidor devolvió ${xml}`;
          console.warn(`[BORM] ⚠️  ${msg}`);
          advertencias.push(msg);
          continue;
        }

        const items = parsearXml(xml as string, this.comunidad, this.nombre);
        for (const a of items) {
          const key = a.enlace_pdf || a.titulo.slice(0, 80);
          if (!vistos.has(key)) vistos.set(key, a);
        }
        console.log(`[BORM]   → ${items.length} relevantes (${vistos.size} total)`);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BORM] ❌ ${msg}`);
      advertencias.push(msg);
    } finally {
      if (browser) await browser.close();
    }

    const anuncios    = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    console.log('[BORM] ════════════════════════════════════════');
    console.log(`[BORM] Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[BORM] ════════════════════════════════════════');

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

export const bormScraper = new BormScraper();
