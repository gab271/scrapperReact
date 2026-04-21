import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';

puppeteer.use(StealthPlugin());

// ─────────────────────────────────────────────────────────────
//  DOCV — Diari Oficial de la Comunitat Valenciana
//
//  El portal dogv.gva.es es una SPA Angular.
//  Las peticiones HTTP directas devuelven 403.
//  Puppeteer + Stealth simula un navegador real y supera el bloqueo.
//
//  Flujo:
//    1. Navegar a /es/cerca-de-legislacio  (waitUntil: networkidle2)
//    2. Cerrar modal de cookies si aparece
//    3. Rellenar campo de búsqueda con "oficina de farmacia"
//    4. Capturar llamadas XHR/fetch para extraer JSON directo si es posible
//    5. Si no hay JSON aprovechable, parsear el DOM renderizado
//    6. Paginar hasta MAX_PAGINAS
// ─────────────────────────────────────────────────────────────

const DOCV_BASE     = 'https://dogv.gva.es';
const DOCV_BUSQUEDA = `${DOCV_BASE}/es/cerca-de-legislacio`;
const MAX_PAGINAS   = 5;

const KW_PRINCIPAL = ['oficina de farmacia', 'oficina de farmàcia'];
const KW_ACCION    = [
  'transmisión', 'transmision', 'transmissió',
  'apertura', 'obertura',
  'cierre', 'tancament',
  'cambio de titular', 'canvi de titular',
  'adjudicación', 'adjudicacio',
  'traslado', 'trasllat',
  'autorización', 'autoritzacio',
];

const MUNICIPIOS = [
  'Valencia', 'Alicante', 'Castellón de la Plana', 'Elche', 'Torrent',
  'Orihuela', 'Gandía', 'Benidorm', 'Sagunto', 'Petrer',
  'Torrevieja', 'Villena', 'Elda', 'Alcoy', 'Dénia',
  'Calpe', 'Xàtiva', 'Burjassot', 'Paterna', 'Mislata',
  'Manises', 'Ontinyent', 'Alzira', 'Sueca', 'Cullera',
];

// ─────────────────────────────────────────────────────────────

export class DocvScraper implements IScraper {
  readonly nombre    = 'DOCV';
  readonly comunidad = 'Valencia';
  readonly keywords  = KW_PRINCIPAL;

  private delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

  private extraerMunicipio(texto: string): string {
    const norm = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const n = norm(texto);
    for (const m of MUNICIPIOS) {
      if (n.includes(norm(m))) return m;
    }
    const match = texto.match(
      /(?:sita?|ubicada?|situada?)\s+en\s+([A-ZÁÉÍÓÚÀÈÏÜÑ][A-Za-záéíóúàèïüñ\s-]{3,30}?)(?=[,.]|\s+\()/i
    );
    return match ? match[1].trim() : 'Comunitat Valenciana';
  }

  // ── Parseo del DOM renderizado ─────────────────────────────

  private parsearDOM(html: string): AnuncioFarmacia[] {
    const $        = cheerio.load(html);
    const vistos   = new Set<string>();
    const resultado: AnuncioFarmacia[] = [];

    // Estrategia 1: buscar <article> o <li> con enlace y texto de farmacia
    $('article, li, tr, .result, .item, [class*="cerca"], [class*="resultat"]').each((_, el) => {
      const $el   = $(el);
      const texto = $el.text().replace(/\s+/g, ' ').trim();
      if (texto.length < 30 || texto.length > 1000) return;

      const tl = texto.toLowerCase();
      if (!KW_PRINCIPAL.some(kw => tl.includes(kw))) return;
      if (!KW_ACCION.some(kw => tl.includes(kw)))    return;

      const key = texto.substring(0, 80);
      if (vistos.has(key)) return;
      vistos.add(key);

      const href = $el.find('a').first().attr('href') || $el.closest('a').attr('href') || '';
      const enlace = href.startsWith('http') ? href
        : href ? `${DOCV_BASE}${href}` : '';

      const fechaMatch = texto.match(/(\d{2}[\/\.\-]\d{2}[\/\.\-]\d{4})/);

      resultado.push({
        titulo:        texto.slice(0, 350),
        fecha:         fechaMatch ? fechaMatch[1] : 'Fecha no disponible',
        municipio:     this.extraerMunicipio(texto),
        enlace_pdf:    enlace,
        texto_resumen: texto.slice(0, 500),
        comunidad:     this.comunidad,
        fuente:        this.nombre,
      });
    });

    // Estrategia 2: si no hay resultados, buscar cualquier <a> con texto de farmacia
    if (resultado.length === 0) {
      $('a').each((_, el) => {
        const $el   = $(el);
        const texto = $el.text().replace(/\s+/g, ' ').trim();
        if (texto.length < 30) return;
        const tl = texto.toLowerCase();
        if (!KW_PRINCIPAL.some(kw => tl.includes(kw))) return;
        if (!KW_ACCION.some(kw => tl.includes(kw)))    return;

        const key = texto.substring(0, 80);
        if (vistos.has(key)) return;
        vistos.add(key);

        const href   = $el.attr('href') || '';
        const enlace = href.startsWith('http') ? href : href ? `${DOCV_BASE}${href}` : '';
        const fechaMatch = texto.match(/(\d{2}[\/\.\-]\d{2}[\/\.\-]\d{4})/);

        resultado.push({
          titulo:        texto.slice(0, 350),
          fecha:         fechaMatch ? fechaMatch[1] : 'Fecha no disponible',
          municipio:     this.extraerMunicipio(texto),
          enlace_pdf:    enlace,
          texto_resumen: texto.slice(0, 500),
          comunidad:     this.comunidad,
          fuente:        this.nombre,
        });
      });
    }

    return resultado;
  }

  // ── Parseo de respuestas JSON/HTML capturadas vía XHR ─────

  private parsearXHR(body: string): AnuncioFarmacia[] {
    // Si es JSON (API Angular), intentar extraer array de resultados
    try {
      const data = JSON.parse(body);
      const items: unknown[] = Array.isArray(data) ? data
        : (data as any).resultats ?? (data as any).results ?? (data as any).items ?? [];

      return (items as any[]).flatMap(item => {
        const titulo  = String(item.titol ?? item.titulo ?? item.title ?? '');
        const resumen = String(item.text ?? item.resumen ?? item.sumari ?? titulo);
        if (!titulo) return [];

        const tl = (titulo + resumen).toLowerCase();
        if (!KW_PRINCIPAL.some(kw => tl.includes(kw))) return [];
        if (!KW_ACCION.some(kw => tl.includes(kw)))    return [];

        return [{
          titulo:        titulo.slice(0, 350),
          fecha:         String(item.data ?? item.fecha ?? item.date ?? 'Fecha no disponible'),
          municipio:     this.extraerMunicipio(titulo + ' ' + resumen),
          enlace_pdf:    String(item.url ?? item.enlace ?? item.pdf ?? ''),
          texto_resumen: resumen.slice(0, 500),
          comunidad:     this.comunidad,
          fuente:        this.nombre,
        } as AnuncioFarmacia];
      });
    } catch {
      // No es JSON — tratar como HTML parcial
      return this.parsearDOM(body);
    }
  }

  // ── Scraper principal ──────────────────────────────────────

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const anuncios: AnuncioFarmacia[] = [];
    const vistos = new Set<string>();

    console.log('[DOCV] ════════════════════════════════════════════════');
    console.log('[DOCV] 🚀 Iniciando scraper — Comunitat Valenciana (DOCV)');
    console.log('[DOCV]    Estrategia: Puppeteer + Stealth (SPA Angular)');
    console.log('[DOCV] ════════════════════════════════════════════════');

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(60_000);
      page.setDefaultTimeout(30_000);

      // Capturar respuestas XHR (la API Angular puede devolver JSON)
      const xhrCapturados: string[] = [];
      page.on('response', async res => {
        const type = res.request().resourceType();
        if ((type === 'xhr' || type === 'fetch') && res.status() === 200) {
          try {
            const body = await res.text();
            if (body.length > 200 && KW_PRINCIPAL.some(kw => body.toLowerCase().includes(kw))) {
              xhrCapturados.push(body);
              console.log(`[DOCV] 📡 XHR con farmacia: ${res.url().substring(0, 80)}`);
            }
          } catch { /* stream consumido */ }
        }
      });

      // ── 1. Cargar la SPA ──────────────────────────────
      console.log('[DOCV] Navegando a /es/cerca-de-legislacio...');
      await page.goto(DOCV_BUSQUEDA, { waitUntil: 'networkidle2' });

      // ── 2. Cerrar cookies ─────────────────────────────
      const cookieClosed = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a'));
        const btn  = btns.find(b => /aceptar|accept|d'acord|agree|cookie/i.test(b.textContent ?? ''));
        if (btn) { (btn as HTMLElement).click(); return true; }
        return false;
      });
      if (cookieClosed) {
        console.log('[DOCV] 🍪 Modal de cookies cerrado');
        await this.delay(800);
      }

      // ── 3. Esperar formulario ─────────────────────────
      try {
        await page.waitForSelector('input', { timeout: 15_000 });
        console.log('[DOCV] ✓ Formulario Angular cargado');
      } catch {
        advertencias.push('No aparecieron inputs en 15s — SPA puede no renderizar');
      }

      // ── 4. Rellenar campo de búsqueda ─────────────────
      // Orden de prioridad de selectores basado en patrones DOCV conocidos
      const SELECTORES_INPUT = [
        'input[name="text"]',
        'input[placeholder*="cerca" i]',
        'input[placeholder*="busca" i]',
        'input[placeholder*="text" i]',
        'input[type="search"]',
        'input[type="text"]',
      ];

      let inputEncontrado = false;
      for (const sel of SELECTORES_INPUT) {
        const el = await page.$(sel);
        if (!el) continue;

        await el.click({ clickCount: 3 });
        await el.type('oficina de farmacia', { delay: 40 });
        await page.evaluate((s: string) => {
          const input = document.querySelector(s);
          if (input) {
            input.dispatchEvent(new Event('input',  { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, sel);

        console.log(`[DOCV] ✓ Texto escrito en: "${sel}"`);
        inputEncontrado = true;
        break;
      }

      if (!inputEncontrado) {
        const msg = 'No se encontró campo de búsqueda en el formulario Angular del DOCV';
        console.warn(`[DOCV] ⚠️  ${msg}`);
        advertencias.push(msg);
      } else {
        await this.delay(400);

        // ── 5. Click en buscar ───────────────────────────
        const SELECTORES_BOTON = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button.btn-primary',
          'button.btn-search',
          'button.c-button--primary',
          'button[aria-label="Buscar"]',
          'button[aria-label="Cerca"]',
        ];

        let botonClicado = false;
        for (const sel of SELECTORES_BOTON) {
          const btn = await page.$(sel);
          if (!btn) continue;
          await btn.click();
          console.log(`[DOCV] 🔍 Búsqueda enviada con: "${sel}"`);
          botonClicado = true;
          break;
        }

        if (!botonClicado) {
          // Fallback: buscar por texto
          botonClicado = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn  = btns.find(b => /cerca|buscar|search/i.test(b.textContent ?? ''));
            if (btn) { (btn as HTMLButtonElement).click(); return true; }
            return false;
          });
          if (botonClicado) console.log('[DOCV] 🔍 Búsqueda enviada (por texto)');
        }

        if (!botonClicado) {
          advertencias.push('No se encontró botón de búsqueda');
        } else {
          // ── 6. Esperar resultados ─────────────────────
          await this.delay(2_000);
          try {
            await page.waitForNetworkIdle({ idleTime: 1_500, timeout: 20_000 });
          } catch { /* timeout aceptable */ }

          // ── 7. Extraer resultados ─────────────────────
          // Prioridad: XHR capturado (JSON más limpio que DOM)
          if (xhrCapturados.length > 0) {
            for (const xhr of xhrCapturados) {
              const items = this.parsearXHR(xhr);
              for (const item of items) {
                const key = item.enlace_pdf || item.titulo.substring(0, 80);
                if (!vistos.has(key)) { vistos.add(key); anuncios.push(item); }
              }
            }
            console.log(`[DOCV] 📋 ${anuncios.length} anuncios desde XHR`);
          }

          // Fallback: DOM renderizado
          if (anuncios.length === 0) {
            const htmlPagina = await page.content();
            const items      = this.parsearDOM(htmlPagina);
            for (const item of items) {
              const key = item.enlace_pdf || item.titulo.substring(0, 80);
              if (!vistos.has(key)) { vistos.add(key); anuncios.push(item); }
            }
            console.log(`[DOCV] 📋 ${anuncios.length} anuncios desde DOM`);
          }

          // ── 8. Paginar ────────────────────────────────
          let pagina = 2;
          while (anuncios.length > 0 && pagina <= MAX_PAGINAS) {
            const siguiente = await page.$(
              'button[aria-label="Siguiente"], a[aria-label="Siguiente"], ' +
              'button[aria-label="Pàgina següent"], .pagination-next, ' +
              '[class*="next"]:not([disabled])'
            );
            if (!siguiente) break;

            await siguiente.click();
            await this.delay(2_000);
            try { await page.waitForNetworkIdle({ idleTime: 1_000, timeout: 10_000 }); } catch {}

            const htmlPag  = await page.content();
            const itemsPag = xhrCapturados.length > 0
              ? []
              : this.parsearDOM(htmlPag);

            let nuevos = 0;
            for (const item of itemsPag) {
              const key = item.enlace_pdf || item.titulo.substring(0, 80);
              if (!vistos.has(key)) { vistos.add(key); anuncios.push(item); nuevos++; }
            }
            if (nuevos === 0) break;
            console.log(`[DOCV] 📋 Pág. ${pagina}: +${nuevos} anuncios`);
            pagina++;
          }
        }
      }

      if (anuncios.length === 0) {
        const msg = 'DOCV SPA Angular no devolvió resultados. '
          + 'Verificar selectores con debug-docv.js si el portal ha cambiado.';
        console.warn(`[DOCV] ⚠️  ${msg}`);
        advertencias.push(msg);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DOCV] ❌ ${msg}`);
      advertencias.push(msg);
    } finally {
      await browser.close();
    }

    const duracion_ms = Date.now() - t0;
    console.log('[DOCV] ════════════════════════════════════════════════');
    console.log(`[DOCV] ✅ Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[DOCV] ════════════════════════════════════════════════');

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

export const docvScraper = new DocvScraper();
