import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';

// ─────────────────────────────────────────────────────────────
//  BOCYL — Boletín Oficial de Castilla y León
//
//  Portal: https://bocyl.jcyl.es
//  Buscador: /busquedaCampos.do  (formulario POST Java/Struts)
//
//  Estrategia: Puppeteer headless
//    1. Cargar el formulario de búsqueda.
//    2. Rellenar campo `titulo` con "farmacia".
//    3. Marcar todas las secciones (apartadosSeleccionados).
//    4. Hacer click en el botón de envío y esperar la respuesta.
//    5. Parsear los <li class="nobullet"> del DOM:
//         <dl>Fecha/Boletín/Organismo</dl>
//         <p>Texto completo del anuncio</p>
//         <ul.descargaBoletin> → enlace PDF
//    6. Filtrar por esRelevante (farmacia + acción lifecyle).
//    7. Iterar páginas vía click en "Siguiente" o submit con page++.
//
//  Nota: La búsqueda por título en BOCYL devuelve principalmente
//  resultados de "Farmacia Hospitalaria" (oposiciones sanitarias),
//  no de ciclo de vida de oficinas de farmacia. Si el Boletín de
//  Castilla y León no publica esos eventos, el scraper devuelve 0
//  resultados reflejando la realidad de la fuente.
// ─────────────────────────────────────────────────────────────

const BOCYL_BASE   = 'https://bocyl.jcyl.es';
const BOCYL_SEARCH = `${BOCYL_BASE}/busquedaCampos.do`;
const MAX_PAGES    = 5;

const KW_ACCION = [
  'transmisión', 'transmision', 'apertura', 'cierre',
  'cambio de titular', 'cambio de titularidad',
  'adjudicación', 'adjudicacion', 'traslado',
  'autorización', 'autorizacion', 'concesión', 'concesion',
];

const MUNICIPIOS = [
  'Valladolid', 'Burgos', 'Salamanca', 'León', 'Segovia',
  'Zamora', 'Palencia', 'Ávila', 'Soria', 'Aranda de Duero',
  'Miranda de Ebro', 'Ponferrada', 'San Andrés del Rabanedo',
  'Laguna de Duero', 'Medina del Campo', 'Béjar', 'Astorga',
];

function extraerMunicipio(texto: string): string {
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(texto);
  for (const m of MUNICIPIOS) if (n.includes(norm(m))) return m;
  const match = texto.match(
    /(?:sita?|ubicada?|situada?|municipio\s+de)\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s-]{3,30}?)(?=[,.]|\s+\()/i,
  );
  return match ? match[1].trim() : 'Castilla y León';
}

const KW_EXCLUIR = [
  'hospitalaria', 'tecnico en farmacia', 'técnico en farmacia',
  'licenciado especialista', 'concurso de traslados', 'oposicion', 'oposición',
  'bolsa de trabajo', 'personal estatutario', 'funcionario',
];

function esRelevante(titulo: string): boolean {
  const tl = titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Excluir documentos sobre hospital pharmacy / oposiciones sanitarias
  if (KW_EXCLUIR.some(kw => tl.includes(kw.normalize('NFD').replace(/[̀-ͯ]/g, '')))) return false;
  return (
    tl.includes('farmacia') &&
    KW_ACCION.some(kw => tl.includes(kw.normalize('NFD').replace(/[̀-ͯ]/g, '')))
  );
}

function parsearHtml(html: string, comunidad: string, fuente: string): AnuncioFarmacia[] {
  const $       = cheerio.load(html);
  const result: AnuncioFarmacia[] = [];

  $('li.nobullet').each((_, el) => {
    const $el   = $(el);
    const titulo = $el.find('p').first().text().replace(/\s+/g, ' ').trim();
    if (!titulo || !esRelevante(titulo)) return;

    // Fecha: primer <dd> del <dl>
    const fechaTxt = $el.find('dl dd').first().text().trim();

    // PDF: primer link al PDF del boletín
    const pdfHref = $el.find('a[href*="boletines"][href*=".pdf"]').first().attr('href') ?? '';
    const enlace  = pdfHref.startsWith('http') ? pdfHref : pdfHref ? `${BOCYL_BASE}${pdfHref}` : '';

    result.push({
      titulo:        titulo.slice(0, 350),
      fecha:         fechaTxt || 'Fecha no disponible',
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

export class BocylScraper implements IScraper {
  readonly nombre    = 'BOCYL';
  readonly comunidad = 'Castilla y León';
  readonly keywords  = ['oficina de farmacia'];

  private delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const vistos = new Map<string, AnuncioFarmacia>();

    console.log('[BOCYL] ════════════════════════════════════════');
    console.log('[BOCYL] Iniciando — Castilla y León (BOCYL)');
    console.log('[BOCYL] Estrategia: Puppeteer UI + formulario /busquedaCampos.do');
    console.log('[BOCYL] ════════════════════════════════════════');

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
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      );

      console.log('[BOCYL] Cargando formulario de búsqueda...');
      await page.goto(BOCYL_SEARCH, { waitUntil: 'domcontentloaded', timeout: 40_000 });
      await this.delay(1000);

      // Rellenar formulario
      await page.evaluate(() => {
        const inp = document.getElementById('titulo');
        if (inp) (inp as HTMLInputElement).value = 'farmacia';
        document.querySelectorAll('input[name="apartadosSeleccionados"]').forEach(
          (el) => { (el as HTMLInputElement).checked = true; },
        );
      });

      // Hacer click en el botón de búsqueda
      const btn = await page.$('input[type="submit"], button[type="submit"]');
      if (!btn) throw new Error('No se encontró el botón de búsqueda en el formulario BOCYL');

      await btn.click();
      await this.delay(5000);

      console.log('[BOCYL] Formulario enviado — parseando resultados...');

      for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
        const html  = await page.content();
        const items = parsearHtml(html, this.comunidad, this.nombre);

        for (const a of items) {
          const key = a.enlace_pdf || a.titulo.slice(0, 80);
          if (!vistos.has(key)) vistos.set(key, a);
        }

        console.log(`[BOCYL]   Pág ${pagina}: ${items.length} relevantes (${vistos.size} total)`);

        // ¿Hay página siguiente?
        const siguiente = await page.$('a.siguiente, a[title*="siguiente"], a:contains("Siguiente"), #siguiente');
        if (!siguiente) break;

        await siguiente.click();
        await this.delay(3000);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BOCYL] ❌ ${msg}`);
      advertencias.push(msg);
    } finally {
      if (browser) await browser.close();
    }

    const anuncios    = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    if (anuncios.length === 0) {
      const note = 'El BOCYL no publica eventos de ciclo de vida de oficinas de farmacia '
        + '(transmisiones, aperturas) en formato buscable. Los 79 resultados para "farmacia" '
        + 'son mayoritariamente sobre "Farmacia Hospitalaria" (oposiciones sanitarias).';
      console.log(`[BOCYL] ℹ️  ${note}`);
      advertencias.push(note);
    }

    console.log('[BOCYL] ════════════════════════════════════════');
    console.log(`[BOCYL] Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[BOCYL] ════════════════════════════════════════');

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

export const bocylScraper = new BocylScraper();
