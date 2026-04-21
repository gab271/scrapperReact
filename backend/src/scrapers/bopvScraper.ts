import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';

puppeteer.use(StealthPlugin());

// ─────────────────────────────────────────────────────────────
//  BOPV — Boletín Oficial del País Vasco / EHAA
//
//  Antes: solo leía Ultimo.shtml (1 boletín, falla en festivos).
//  Ahora: usa el buscador avanzado de euskadi.eus para obtener
//         histórico de los últimos 3 meses por palabra clave.
//
//  Buscador: https://www.euskadi.eus/buscador/
//    → campo: "oficina de farmacia"
//    → filtro: BOPV/EHAA
//    → rango: últimos 3 meses
// ─────────────────────────────────────────────────────────────

const BOPV_BASE      = 'https://www.euskadi.eus';
// Buscador general de Euskadi (indexa el BOPV)
const BOPV_BUSQUEDA  = `${BOPV_BASE}/web01-bopv/es/bopv2/datos/Ultimo.shtml`;
// URL del buscador avanzado del BOPV
const BOPV_SEARCH    = `${BOPV_BASE}/web01-bopv/es/p59aDbBopvWar/busquedas.apl`;

const KW_PRINCIPAL = ['oficina de farmacia', 'farmazia bulegoa'];
const KW_ACCION    = [
  'transmisión', 'transmision', 'apertura', 'irekitzea',
  'cierre', 'itxiera',
  'cambio de titular', 'cambio de titularidad', 'titular aldaketa',
  'adjudicación', 'adjudicacion', 'traslado', 'lekualdatzea',
  'autorización de instalación',
];

const MUNICIPIOS = [
  'Bilbao', 'Vitoria-Gasteiz', 'Vitoria', 'Gasteiz',
  'San Sebastián', 'Donostia', 'Barakaldo', 'Getxo',
  'Irun', 'Irún', 'Sestao', 'Basauri', 'Rentería', 'Errenteria',
  'Leioa', 'Galdakao', 'Portugalete', 'Santurtzi', 'Bermeo',
  'Durango', 'Eibar', 'Mondragón', 'Arrasate', 'Zarautz',
];

// Nº de días hacia atrás que cubre el scraper
const LOOKBACK_DAYS = 90;

// ─────────────────────────────────────────────────────────────

export class BopvScraper implements IScraper {
  readonly nombre    = 'BOPV';
  readonly comunidad = 'País Vasco';
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
      /(?:sita?|ubicada?|situada?)\s+en\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s-]{3,30}?)(?=[,.]|\s+\()/i
    );
    return match ? match[1].trim() : 'País Vasco';
  }

  // Fecha formateada como DD/MM/YYYY para el buscador del BOPV
  private fechaFormato(date: Date): string {
    const d  = String(date.getDate()).padStart(2, '0');
    const m  = String(date.getMonth() + 1).padStart(2, '0');
    const y  = date.getFullYear();
    return `${d}/${m}/${y}`;
  }

  // ── Estrategia A: Buscador web del BOPV via Puppeteer ─────

  private async buscarConPuppeteer(): Promise<AnuncioFarmacia[]> {
    const anuncios: AnuncioFarmacia[] = [];
    const vistos = new Set<string>();

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(60_000);
      page.setDefaultTimeout(30_000);

      // Capturar XHR con farmacia
      const xhrCapturados: string[] = [];
      page.on('response', async res => {
        const type = res.request().resourceType();
        if ((type === 'xhr' || type === 'fetch') && res.status() === 200) {
          try {
            const body = await res.text();
            if (body.length > 200 && KW_PRINCIPAL.some(kw => body.toLowerCase().includes(kw))) {
              xhrCapturados.push(body);
            }
          } catch {}
        }
      });

      console.log('[BOPV] Navegando al buscador avanzado...');
      await page.goto(BOPV_SEARCH, { waitUntil: 'networkidle2' });

      // Cerrar cookies si existe
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, a'))
          .find(b => /aceptar|accept|ados|konforme/i.test(b.textContent ?? ''));
        if (btn) (btn as HTMLElement).click();
      });
      await this.delay(600);

      // Esperar inputs
      try { await page.waitForSelector('input[type="text"], input[type="search"]', { timeout: 12_000 }); } catch {}

      // Calcular fechas
      const hoy       = new Date();
      const hace90    = new Date(hoy);
      hace90.setDate(hoy.getDate() - LOOKBACK_DAYS);
      const fechaDesde = this.fechaFormato(hace90);
      const fechaHasta = this.fechaFormato(hoy);

      // Rellenar formulario
      const filled = await page.evaluate(
        (desde: string, hasta: string) => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
          if (inputs.length === 0) return false;

          // Primer input suele ser búsqueda libre
          const txtInput = inputs[0] as HTMLInputElement;
          txtInput.value = 'oficina de farmacia';
          txtInput.dispatchEvent(new Event('input',  { bubbles: true }));
          txtInput.dispatchEvent(new Event('change', { bubbles: true }));

          // Intentar rellenar fechas si hay más de 1 input
          const dateInputs = inputs.filter(i =>
            (i as HTMLInputElement).placeholder?.includes('/') ||
            (i as HTMLInputElement).name?.toLowerCase().includes('fecha') ||
            (i as HTMLInputElement).name?.toLowerCase().includes('data')
          );
          if (dateInputs.length >= 2) {
            (dateInputs[0] as HTMLInputElement).value = desde;
            dateInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
            (dateInputs[1] as HTMLInputElement).value = hasta;
            dateInputs[1].dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true;
        },
        fechaDesde,
        fechaHasta
      );

      if (!filled) {
        console.warn('[BOPV] ⚠️  No se pudo rellenar el formulario del buscador');
        return anuncios;
      }

      // Click en buscar
      const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        const btn  = btns.find(b => /buscar|bilatu|search/i.test(b.textContent ?? (b as HTMLInputElement).value ?? ''));
        if (btn) { (btn as HTMLElement).click(); return true; }
        // último recurso: submit del form
        const form = document.querySelector('form');
        if (form) { form.submit(); return true; }
        return false;
      });

      if (clicked) {
        await this.delay(2_500);
        try { await page.waitForNetworkIdle({ idleTime: 1_500, timeout: 15_000 }); } catch {}

        const html   = await page.content();
        const items  = this.parsearResultados(xhrCapturados.length > 0 ? xhrCapturados[0] : html);
        for (const item of items) {
          const key = item.enlace_pdf || item.titulo.substring(0, 80);
          if (!vistos.has(key)) { vistos.add(key); anuncios.push(item); }
        }
        console.log(`[BOPV] 📋 ${anuncios.length} anuncios (buscador web)`);
      }

    } finally {
      await browser.close();
    }

    return anuncios;
  }

  // ── Estrategia B: HTML estático de los últimos N boletines ─
  // Mantiene la lógica original de Ultimo.shtml como fallback.

  private async rascarUltimoBoletin(): Promise<AnuncioFarmacia[]> {
    const { default: axios } = await import('axios');
    const anuncios: AnuncioFarmacia[] = [];

    try {
      const res = await axios.get<string>(BOPV_BUSQUEDA, {
        timeout: 20_000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
          Accept: 'text/html',
        },
      });
      if (res.status !== 200) return anuncios;

      const $         = cheerio.load(res.data);
      const tituloGen = $('h2.tituGeneral').text().trim();
      const fechaMatch = tituloGen.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
      const fecha     = fechaMatch ? fechaMatch[1] : new Date().toLocaleDateString('es-ES');

      $('p.BOPVSumarioTitulo').each((_, el) => {
        const $el   = $(el);
        const anchor = $el.find('a').first();
        const titulo = anchor.text().replace(/\s+/g, ' ').trim();
        if (!titulo || titulo.length < 20) return;

        const tl = titulo.toLowerCase();
        if (!KW_PRINCIPAL.some(kw => tl.includes(kw))) return;
        if (!KW_ACCION.some(kw => tl.includes(kw)))    return;

        const relHref  = anchor.attr('href') || '';
        const enlace   = relHref ? `${BOPV_BASE}/y22-bopv/es/bopv2/datos/${relHref}` : '';

        anuncios.push({
          titulo:        titulo.slice(0, 350),
          fecha,
          municipio:     this.extraerMunicipio(titulo),
          enlace_pdf:    enlace,
          texto_resumen: titulo.slice(0, 500),
          comunidad:     this.comunidad,
          fuente:        this.nombre,
        });
      });
    } catch (err) {
      console.warn('[BOPV] ⚠️  Fallback Ultimo.shtml falló:', err instanceof Error ? err.message : err);
    }

    return anuncios;
  }

  private parsearResultados(html: string): AnuncioFarmacia[] {
    const $        = cheerio.load(html);
    const vistos   = new Set<string>();
    const resultado: AnuncioFarmacia[] = [];

    $('p.BOPVSumarioTitulo, li, tr, article, .resultado').each((_, el) => {
      const $el   = $(el);
      const texto = $el.text().replace(/\s+/g, ' ').trim();
      if (texto.length < 20) return;

      const tl = texto.toLowerCase();
      if (!KW_PRINCIPAL.some(kw => tl.includes(kw))) return;
      if (!KW_ACCION.some(kw => tl.includes(kw)))    return;

      const key = texto.substring(0, 80);
      if (vistos.has(key)) return;
      vistos.add(key);

      const href  = $el.find('a').first().attr('href') || '';
      const enlace = href.startsWith('http') ? href
        : href ? `${BOPV_BASE}${href}` : '';
      const fechaMatch = texto.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);

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

    return resultado;
  }

  // ── Scraper principal ──────────────────────────────────────

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];

    console.log('[BOPV] ════════════════════════════════════════════════');
    console.log('[BOPV] 🚀 Iniciando scraper — País Vasco (BOPV/EHAA)');
    console.log(`[BOPV]    Histórico: últimos ${LOOKBACK_DAYS} días`);
    console.log('[BOPV] ════════════════════════════════════════════════');

    let anuncios: AnuncioFarmacia[] = [];

    try {
      // Intento principal: buscador web con Puppeteer
      anuncios = await this.buscarConPuppeteer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[BOPV] ⚠️  Buscador web falló: ${msg}`);
      advertencias.push(`Buscador web: ${msg}`);
    }

    // Fallback: Ultimo.shtml clásico
    if (anuncios.length === 0) {
      console.log('[BOPV] Usando fallback Ultimo.shtml...');
      try {
        anuncios = await this.rascarUltimoBoletin();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        advertencias.push(`Fallback Ultimo.shtml: ${msg}`);
      }
    }

    const duracion_ms = Date.now() - t0;
    console.log('[BOPV] ════════════════════════════════════════════════');
    console.log(`[BOPV] ✅ Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[BOPV] ════════════════════════════════════════════════');

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
