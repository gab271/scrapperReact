import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';

// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN — selectores verificados contra el DOM real
//  del BOCM en abril 2026. Si la web cambia, solo editar aquí.
// ─────────────────────────────────────────────────────────────
const BOCM_BASE = 'https://www.bocm.es';
const SEARCH_URL = `${BOCM_BASE}/search-free`;
// Nombre exacto del campo de texto del formulario de búsqueda
const SEARCH_PARAM = 'search_api_aggregation_1';

const SEL = {
  // Cada resolución es un <article class="node node-orden ...">
  articulo: 'article.node-orden',
  // Texto descriptivo de la resolución
  descripcion: '.field-name-field-short-description .field-item p',
  // Enlace al PDF del boletín
  pdf: '.field-name-field-pdf-file .file a',
  // Nº de boletín (para enriquecer el título)
  numBoletin: '.field-name-field-bocm-number .field-item',
} as const;

// ─────────────────────────────────────────────────────────────

export class BocmScraper implements IScraper {
  readonly nombre = 'BOCM';
  readonly comunidad = 'Madrid';
  readonly keywords = [
    'oficina de farmacia',
    'transmisión farmacia',
    'cambio de titular',
    'apertura farmacia',
  ];

  private readonly http = axios.create({
    baseURL: BOCM_BASE,
    timeout: Number(process.env.SCRAPER_TIMEOUT_MS) || 20000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  });

  // ── Petición + parsing por keyword ──────────────────────────
  private async buscarKeyword(keyword: string): Promise<AnuncioFarmacia[]> {
    const params = new URLSearchParams({ [SEARCH_PARAM]: keyword });
    const url = `${SEARCH_URL}?${params}`;
    console.log(`[BOCM] 🔍 Buscando: "${keyword}"`);

    let html: string;
    try {
      const res = await this.http.get<string>(url);
      html = res.data;
      console.log(`[BOCM] ✅ Respuesta OK (${html.length} bytes)`);
    } catch (err) {
      const msg =
        err instanceof AxiosError
          ? `HTTP ${err.response?.status ?? 'sin respuesta'} — ${err.message}`
          : String(err);
      console.warn(`[BOCM] ⚠️  Error HTTP para "${keyword}": ${msg}`);
      return [];
    }

    return this.parsear(html, keyword);
  }

  // ── Parser HTML con selectores verificados ──────────────────
  private parsear(html: string, keyword: string): AnuncioFarmacia[] {
    const $ = cheerio.load(html);
    const resultados: AnuncioFarmacia[] = [];

    $(SEL.articulo).each((_, el) => {
      const $el = $(el);

      // Texto de la resolución, ej: "– Alcobendas. Licencias. Farmacia"
      const descripcion = $el.find(SEL.descripcion).text().trim().replace(/\u00a0/g, ' ');
      if (!descripcion) return;

      // Nº de boletín
      const numBoletin = $el.find(SEL.numBoletin).text().trim();

      // Enlace PDF (href puede ser absoluto o relativo)
      const pdfHref = $el.find(SEL.pdf).attr('href') || '';
      const enlace_pdf = pdfHref.startsWith('http')
        ? pdfHref
        : pdfHref
        ? `${BOCM_BASE}${pdfHref}`
        : '';

      // Fecha extraída del atributo `about` del article
      // Formatos: "/2024-06-12-..." o "/bocm-20240612-..."
      const about = $el.attr('about') || '';
      const fecha = this.extraerFecha(about);

      // Municipio: primer segmento antes del punto en la descripción
      // Ej: "– Alcobendas. Licencias. Farmacia" → "Alcobendas"
      const municipio = this.extraerMunicipio(descripcion) || 'Madrid (Capital)';

      const titulo = numBoletin
        ? `BOCM Nº${numBoletin} — ${descripcion.replace(/^[–-]\s*/, '')}`
        : descripcion.replace(/^[–-]\s*/, '');

      resultados.push({
        titulo,
        fecha,
        municipio,
        enlace_pdf,
        texto_resumen: descripcion,
        comunidad: this.comunidad,
        fuente: this.nombre,
      });
    });

    console.log(`[BOCM] 📋 "${keyword}" → ${resultados.length} resultados`);
    return resultados;
  }

  // ── Helpers ─────────────────────────────────────────────────

  private extraerFecha(aboutUrl: string): string {
    // Formato 1: "/2024-06-12-..." → "2024-06-12"
    const iso = aboutUrl.match(/^\/(\d{4}-\d{2}-\d{2})/);
    if (iso) {
      const [yyyy, mm, dd] = iso[1].split('-');
      return new Date(`${yyyy}-${mm}-${dd}`).toLocaleDateString('es-ES', {
        day: '2-digit', month: 'long', year: 'numeric',
      });
    }

    // Formato 2: "/bocm-20240612-..." → "2024-06-12"
    const compact = aboutUrl.match(/bocm-(\d{4})(\d{2})(\d{2})/);
    if (compact) {
      const [, yyyy, mm, dd] = compact;
      return new Date(`${yyyy}-${mm}-${dd}`).toLocaleDateString('es-ES', {
        day: '2-digit', month: 'long', year: 'numeric',
      });
    }

    return 'Fecha no disponible';
  }

  private extraerMunicipio(descripcion: string): string | null {
    // "– Alcobendas. Licencias." → "Alcobendas"
    const match = descripcion.match(/^[–\-]?\s*([^.]+)\./);
    if (match) {
      const candidato = match[1].trim();
      // Descartar si parece una categoría genérica
      const descartar = /licencia|farmaci|resoluc|consej|orden|decreto/i;
      if (!descartar.test(candidato) && candidato.length > 2) {
        return candidato;
      }
    }
    return null;
  }

  private delay(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  // ── Punto de entrada ────────────────────────────────────────
  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];

    console.log('[BOCM] ═══════════════════════════════════════════');
    console.log('[BOCM] 🚀 Iniciando scraper — Comunidad de Madrid');
    console.log(`[BOCM]    URL: ${SEARCH_URL}`);
    console.log(`[BOCM]    Keywords: ${this.keywords.join(' | ')}`);
    console.log('[BOCM] ═══════════════════════════════════════════');

    const vistos = new Map<string, AnuncioFarmacia>();

    for (const kw of this.keywords) {
      try {
        await this.delay(700); // Pausa de cortesía entre peticiones
        const items = await this.buscarKeyword(kw);
        for (const item of items) {
          const key = `${item.titulo}|${item.fecha}`;
          if (!vistos.has(key)) vistos.set(key, item);
        }
      } catch (err) {
        const msg = `Keyword "${kw}": ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[BOCM] ⚠️  ${msg}`);
        advertencias.push(msg);
      }
    }

    const anuncios = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    console.log('[BOCM] ═══════════════════════════════════════════');
    console.log(`[BOCM] ✅ Finalizado — ${anuncios.length} anuncios únicos en ${duracion_ms}ms`);
    console.log('[BOCM] ═══════════════════════════════════════════');

    return {
      comunidad: this.comunidad,
      total: anuncios.length,
      anuncios,
      timestamp: new Date().toISOString(),
      duracion_ms,
      ...(advertencias.length ? { advertencias } : {}),
    };
  }
}

export const bocmScraper = new BocmScraper();
