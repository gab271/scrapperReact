import axios from 'axios';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';

puppeteer.use(StealthPlugin());

// ─────────────────────────────────────────────────────────────
//  DOG — Diario Oficial de Galicia
//
//  Estrategia dual:
//    A (principal): Buscador avanzado de la Xunta via Puppeteer
//       xunta.gal/dog/Publicados/busca
//       → busca "oficina de farmacia" filtrando los últimos 90 días
//
//    B (fallback): Iteración de secciones por fecha (axios)
//       xunta.gal/dog/Publicados/YYYY/YYYYMMDD/SeccionesN_gl.html
//       → cubre 90 días naturales atrás, silencia 404 de festivos
//
//  parsePersons se aplica en el service layer (anunciosService),
//  no necesita llamarse aquí.
// ─────────────────────────────────────────────────────────────

const DOG_BASE       = 'https://www.xunta.gal';
const DOG_ISSUE      = '/dog/Publicados';
const DOG_BUSCADOR   = `${DOG_BASE}/dog/Publicados/busca`;
const LOOKBACK_DAYS  = 90;
const SECCIONES      = ['Secciones1', 'Secciones2', 'Secciones3'];

const KW_PRINCIPAL = ['oficina de farmacia', 'farmacia'];
const KW_ACCION    = [
  'transmisión', 'transmision', 'apertura', 'cierre', 'peche',
  'cambio de titular', 'cambio de titularidade',
  'adjudicación', 'adxudicación', 'traslado', 'autorización',
];

const MUNICIPIOS = [
  'Vigo', 'A Coruña', 'Coruña', 'Ourense', 'Lugo',
  'Santiago de Compostela', 'Pontevedra', 'Ferrol',
  'Narón', 'Oleiros', 'Arteixo', 'Vilagarcía de Arousa',
  'Lalín', 'O Carballiño', 'Cangas', 'Moaña', 'Redondela',
  'Ponteareas', 'Tui', 'Cambados', 'Ribeira', 'Boiro', 'Marín',
];

// ─────────────────────────────────────────────────────────────

export class DogScraper implements IScraper {
  readonly nombre    = 'DOG';
  readonly comunidad = 'Galicia';
  readonly keywords  = KW_PRINCIPAL;

  private readonly http = axios.create({
    baseURL: DOG_BASE,
    timeout: 15_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
      Accept: 'text/html',
      'Accept-Language': 'es-ES,es;q=0.9,gl;q=0.8',
    },
  });

  private delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

  private mesNombre(m: number): string {
    return ['enero','febrero','marzo','abril','mayo','junio',
      'julio','agosto','septiembre','octubre','noviembre','diciembre'][m];
  }

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
    return match ? match[1].trim() : 'Galicia';
  }

  // ── Estrategia A: Buscador web del DOG (Puppeteer) ─────────

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

      // Interceptar XHR
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

      console.log('[DOG]  Navegando al buscador avanzado...');
      await page.goto(DOG_BUSCADOR, { waitUntil: 'networkidle2' });

      // Cerrar cookies
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, a'))
          .find(b => /aceptar|accept|entendido|agree/i.test(b.textContent ?? ''));
        if (btn) (btn as HTMLElement).click();
      });
      await this.delay(600);

      // Esperar inputs
      try { await page.waitForSelector('input', { timeout: 10_000 }); } catch {}

      // Calcular rango de fechas (últimos 90 días)
      const hoy    = new Date();
      const hace90 = new Date(hoy);
      hace90.setDate(hoy.getDate() - LOOKBACK_DAYS);
      const fmt = (d: Date) =>
        `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

      // Rellenar formulario
      const filled = await page.evaluate(
        (desde: string, hasta: string) => {
          const byPlaceholder = (p: string) =>
            document.querySelector(`input[placeholder*="${p}" i]`) as HTMLInputElement | null;
          const byName = (n: string) =>
            document.querySelector(`input[name="${n}"]`) as HTMLInputElement | null;
          const byType = (t: string) =>
            document.querySelector(`input[type="${t}"]`) as HTMLInputElement | null;

          const setVal = (el: HTMLInputElement | null, val: string) => {
            if (!el) return;
            el.value = val;
            el.dispatchEvent(new Event('input',  { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };

          // Campo texto libre
          const txtEl = byPlaceholder('busca') ?? byPlaceholder('text') ?? byType('search') ?? byType('text');
          setVal(txtEl, 'oficina de farmacia');

          // Fechas
          const desdEl = byPlaceholder('dende') ?? byPlaceholder('desde') ?? byName('dataInicio') ?? byName('fechaDesde');
          const hastaEl = byPlaceholder('ata') ?? byPlaceholder('hasta') ?? byName('dataFin') ?? byName('fechaHasta');
          setVal(desdEl, desde);
          setVal(hastaEl, hasta);

          return !!txtEl;
        },
        fmt(hace90),
        fmt(hoy)
      );

      if (!filled) {
        console.warn('[DOG]  ⚠️  No se encontró input de búsqueda en el buscador');
        return anuncios;
      }

      // Click buscar
      const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        const btn  = btns.find(b =>
          /buscar|cerca|search|busca/i.test(b.textContent ?? (b as HTMLInputElement).value ?? '')
        );
        if (btn) { (btn as HTMLElement).click(); return true; }
        const form = document.querySelector('form');
        if (form) { form.submit(); return true; }
        return false;
      });

      if (clicked) {
        await this.delay(2_500);
        try { await page.waitForNetworkIdle({ idleTime: 1_500, timeout: 15_000 }); } catch {}

        const html  = xhrCapturados.length > 0 ? xhrCapturados[0] : await page.content();
        const items = this.parsearHTML(html);
        for (const item of items) {
          const key = item.enlace_pdf || item.titulo.substring(0, 80);
          if (!vistos.has(key)) { vistos.add(key); anuncios.push(item); }
        }

        // Paginación
        let pagina = 2;
        while (pagina <= 5 && anuncios.length > 0) {
          const sig = await page.$('[aria-label="Siguiente"], .pagination-next, [class*="next"]:not([disabled])');
          if (!sig) break;
          await sig.click();
          await this.delay(2_000);
          try { await page.waitForNetworkIdle({ idleTime: 1_000, timeout: 10_000 }); } catch {}
          const htmlPag = await page.content();
          const itemsPag = this.parsearHTML(htmlPag);
          let nuevos = 0;
          for (const item of itemsPag) {
            const key = item.enlace_pdf || item.titulo.substring(0, 80);
            if (!vistos.has(key)) { vistos.add(key); anuncios.push(item); nuevos++; }
          }
          if (nuevos === 0) break;
          pagina++;
        }

        console.log(`[DOG]  📋 ${anuncios.length} anuncios (buscador Puppeteer)`);
      }
    } finally {
      await browser.close();
    }

    return anuncios;
  }

  // ── Estrategia B: Iteración de fechas via axios ─────────────
  // Cubre 90 días naturales descargando Seccion1/2/3_gl.html
  // directamente (estáticas, no necesitan JS).

  private getSectionUrls(): { url: string; date: string }[] {
    const result: { url: string; date: string }[] = [];
    const now = new Date();
    for (let i = 0; i < LOOKBACK_DAYS; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const yyyy   = d.getFullYear();
      const mm     = String(d.getMonth() + 1).padStart(2, '0');
      const dd     = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}${mm}${dd}`;
      for (const sec of SECCIONES) {
        result.push({
          url:  `${DOG_ISSUE}/${yyyy}/${dateStr}/${sec}_gl.html`,
          date: `${dd} de ${this.mesNombre(d.getMonth())} de ${yyyy}`,
        });
      }
    }
    return result;
  }

  private parsearSeccion(html: string, fecha: string): AnuncioFarmacia[] {
    const $        = cheerio.load(html);
    const resultados: AnuncioFarmacia[] = [];
    const dogData  = $('#DOGData').text().trim();
    const fechaFin = dogData || fecha;
    let pendingPdf = '';

    $('li.dog-toc-sumario, p.dog-descargar').each((_, el) => {
      const $el = $(el);
      if ($el.hasClass('dog-descargar')) {
        pendingPdf = $el.find('a[href*=".pdf"]').attr('href') || '';
        return;
      }
      const anchor = $el.find('a').first();
      const titulo = anchor.text().replace(/\s+/g, ' ').trim();
      if (!titulo || titulo.length < 20) return;

      const tl = titulo.toLowerCase();
      if (!KW_PRINCIPAL.some(kw => tl.includes(kw))) return;
      if (!KW_ACCION.some(kw => tl.includes(kw)))    return;

      const href    = anchor.attr('href') || '';
      const enlace  = pendingPdf
        ? (pendingPdf.startsWith('http') ? pendingPdf : `${DOG_BASE}${pendingPdf}`)
        : href
        ? (href.startsWith('http') ? href : `${DOG_BASE}${href}`)
        : '';

      resultados.push({
        titulo:        titulo.slice(0, 350),
        fecha:         fechaFin,
        municipio:     this.extraerMunicipio(titulo),
        enlace_pdf:    enlace,
        texto_resumen: titulo.slice(0, 500),
        comunidad:     this.comunidad,
        fuente:        this.nombre,
      });
      pendingPdf = '';
    });

    return resultados;
  }

  private async rascarPorFechas(): Promise<AnuncioFarmacia[]> {
    const vistos  = new Map<string, AnuncioFarmacia>();
    const urls    = this.getSectionUrls();
    let analizadas = 0;

    for (const { url, date } of urls) {
      try {
        await this.delay(120);
        const res = await this.http.get<string>(url);
        if (res.status !== 200 || !res.data) continue;
        if (!/farmaci/i.test(res.data))       continue;

        analizadas++;
        const items = this.parsearSeccion(res.data, date);
        for (const item of items) {
          const key = `${item.titulo}|${item.fecha}`;
          if (!vistos.has(key)) vistos.set(key, item);
        }
        if (items.length) {
          const slug = url.split('/Publicados/')[1]?.split('/').slice(0, 2).join('/') ?? '';
          console.log(`[DOG]  📋 ${slug} → ${items.length} entradas`);
        }
      } catch { /* 404 en festivos — silenciar */ }
    }

    console.log(`[DOG]  Secciones con farmacia: ${analizadas}`);
    return Array.from(vistos.values());
  }

  // Parser genérico para HTML del buscador web
  private parsearHTML(html: string): AnuncioFarmacia[] {
    const $        = cheerio.load(html);
    const vistos   = new Set<string>();
    const resultado: AnuncioFarmacia[] = [];

    $('li, tr, article, .resultado, .dog-toc-sumario').each((_, el) => {
      const $el   = $(el);
      const texto = $el.text().replace(/\s+/g, ' ').trim();
      if (texto.length < 20) return;

      const tl = texto.toLowerCase();
      if (!KW_PRINCIPAL.some(kw => tl.includes(kw))) return;
      if (!KW_ACCION.some(kw => tl.includes(kw)))    return;

      const key = texto.substring(0, 80);
      if (vistos.has(key)) return;
      vistos.add(key);

      const href   = $el.find('a').first().attr('href') || '';
      const enlace = href.startsWith('http') ? href : href ? `${DOG_BASE}${href}` : '';
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

    console.log('[DOG]  ════════════════════════════════════════════════');
    console.log('[DOG]  🚀 Iniciando scraper — Galicia (DOG)');
    console.log(`[DOG]     Histórico: últimos ${LOOKBACK_DAYS} días`);
    console.log('[DOG]  ════════════════════════════════════════════════');

    let anuncios: AnuncioFarmacia[] = [];

    // Estrategia A: buscador web con Puppeteer
    try {
      anuncios = await this.buscarConPuppeteer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[DOG]  ⚠️  Buscador Puppeteer falló: ${msg}`);
      advertencias.push(`Buscador web: ${msg}`);
    }

    // Estrategia B: fallback por fechas (más lento pero más fiable)
    if (anuncios.length === 0) {
      console.log('[DOG]  Usando fallback: iteración de fechas...');
      try {
        anuncios = await this.rascarPorFechas();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        advertencias.push(`Fallback fechas: ${msg}`);
      }
    }

    const duracion_ms = Date.now() - t0;
    console.log('[DOG]  ════════════════════════════════════════════════');
    console.log(`[DOG]  ✅ Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[DOG]  ════════════════════════════════════════════════');

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

export const dogScraper = new DogScraper();
