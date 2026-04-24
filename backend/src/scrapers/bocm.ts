import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';
import { parsearAnexoPDF } from './parsearPDFAnexo';

// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN — selectores verificados contra el DOM real
//  del BOCM en abril 2026. Si la web cambia, solo editar aquí.
// ─────────────────────────────────────────────────────────────
const BOCM_BASE = 'https://www.bocm.es';
const SEARCH_URL = `${BOCM_BASE}/search-free`;
const SEARCH_PARAM = 'search_api_aggregation_1';

const SEL = {
  articulo:    'article.node-orden',
  descripcion: '.field-name-field-short-description .field-item p',
  pdf:         '.field-name-field-pdf-file .file a',
  numBoletin:  '.field-name-field-bocm-number .field-item',
  // Página de detalle: texto completo de la resolución
  cuerpo:      'div#cuerpo, .field-name-body .field-items .field-item',
} as const;

// ─────────────────────────────────────────────────────────────

// Resultado intermedio entre parse y enriquecimiento
interface ResultadoPrevio {
  anuncio:  AnuncioFarmacia;
  aboutUrl: string;         // ruta relativa de la página de detalle
}

export class BocmScraper implements IScraper {
  readonly nombre    = 'BOCM';
  readonly comunidad = 'Madrid';
  readonly keywords  = [
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

  // ── Paso 1: búsqueda por keyword ────────────────────────────
  private async buscarKeyword(keyword: string): Promise<ResultadoPrevio[]> {
    const params = new URLSearchParams({ [SEARCH_PARAM]: keyword });
    console.log(`[BOCM] 🔍 Buscando: "${keyword}"`);

    let html: string;
    try {
      const res = await this.http.get<string>(`${SEARCH_URL}?${params}`);
      html = res.data;
      console.log(`[BOCM] ✅ Respuesta OK (${html.length} bytes)`);
    } catch (err) {
      const msg = err instanceof AxiosError
        ? `HTTP ${err.response?.status ?? 'sin respuesta'} — ${err.message}`
        : String(err);
      console.warn(`[BOCM] ⚠️  Error HTTP para "${keyword}": ${msg}`);
      return [];
    }

    return this.parsearResultados(html);
  }

  // ── Paso 2: parsear resultados de búsqueda ──────────────────
  private parsearResultados(html: string): ResultadoPrevio[] {
    const $         = cheerio.load(html);
    const previos: ResultadoPrevio[] = [];

    $(SEL.articulo).each((_, el) => {
      const $el = $(el);

      const descripcion = $el.find(SEL.descripcion).text().trim().replace(/ /g, ' ');
      if (!descripcion) return;

      // Exigir "farmaci" explícito para evitar urbanismo, bares, etc.
      if (!/farmaci/i.test(descripcion)) return;

      const numBoletin = $el.find(SEL.numBoletin).text().trim();
      const pdfHref    = $el.find(SEL.pdf).attr('href') || '';
      const enlace_pdf = pdfHref.startsWith('http') ? pdfHref
        : pdfHref ? `${BOCM_BASE}${pdfHref}` : '';

      const about  = $el.attr('about') || '';
      const fecha  = this.extraerFecha(about);
      const municipio = this.extraerMunicipio(descripcion) || 'Madrid (Capital)';

      const titulo = numBoletin
        ? `BOCM Nº${numBoletin} — ${descripcion.replace(/^[–-]\s*/, '')}`
        : descripcion.replace(/^[–-]\s*/, '');

      previos.push({
        anuncio: {
          titulo,
          fecha,
          municipio,
          enlace_pdf,
          texto_resumen: descripcion,
          comunidad: this.comunidad,
          fuente:    this.nombre,
          // Extracción básica sobre el título corto (suele ser insuficiente)
          ...extraerTitulares(descripcion),
        },
        aboutUrl: about,
      });
    });

    return previos;
  }

  // ── Paso 3: obtener texto completo de la página de detalle ──
  private async fetchTextoCompleto(aboutUrl: string): Promise<string | null> {
    if (!aboutUrl) return null;
    const url = aboutUrl.startsWith('http') ? aboutUrl : `${BOCM_BASE}${aboutUrl}`;
    try {
      const res = await this.http.get<string>(url);
      const $   = cheerio.load(res.data);

      // Intentar primero #cuerpo (más preciso), luego el campo body completo
      let texto = $(SEL.cuerpo).text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      if (!texto || texto.length < 50) {
        texto = $('body').text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
      }
      return texto.slice(0, 8000) || null;
    } catch {
      return null;
    }
  }

  // ── Paso 4: enriquecer — devuelve 1 registro (transmisión) o N (apertura PDF) ──
  private async enriquecer(previo: ResultadoPrevio): Promise<AnuncioFarmacia[]> {
    const textoCompleto = await this.fetchTextoCompleto(previo.aboutUrl);
    const extraido      = textoCompleto ? extraerTitulares(textoCompleto) : {};

    const base: AnuncioFarmacia = {
      ...previo.anuncio,
      ...(textoCompleto ? { texto_completo: textoCompleto } : {}),
      titular_saliente:   extraido.titular_saliente   ?? previo.anuncio.titular_saliente,
      titular_entrante:   extraido.titular_entrante   ?? previo.anuncio.titular_entrante,
      email:              extraido.email              ?? previo.anuncio.email,
      nombre_farmacia:    extraido.nombre_farmacia    ?? previo.anuncio.nombre_farmacia,
      direccion_farmacia: extraido.direccion_farmacia ?? previo.anuncio.direccion_farmacia,
    };

    // ── Apertura masiva: parsear Anexo I del PDF ───────────────
    const esApertura = /apertura|adjudicaci[oó]n/i.test(previo.anuncio.titulo);
    if (esApertura && previo.anuncio.enlace_pdf) {
      const adjudicatarios = await parsearAnexoPDF(previo.anuncio.enlace_pdf);

      if (adjudicatarios.length > 0) {
        console.log(`[BOCM PDF] 📄 ${adjudicatarios.length} adjudicatarios en ${previo.anuncio.titulo.slice(0, 60)}`);

        // Un registro por adjudicatario — clave única = pdf + nombre para evitar duplicados
        return adjudicatarios.map(adj => ({
          ...base,
          // Clave de deduplicación: añadimos NIF al enlace para que sea único en BD
          enlace_pdf:        `${previo.anuncio.enlace_pdf}#${adj.nif ?? adj.nombre.replace(/\s/g, '_')}`,
          municipio:         adj.municipio || base.municipio,
          titulo:            `${previo.anuncio.titulo.replace(/^BOCM\s+Nº\d+\s+—\s+/, '')} · ${adj.zona}`,
          texto_resumen:     `Adjudicatario: ${adj.nombre}${adj.nif ? ` (NIF: ${adj.nif})` : ''}`,
          titular_entrante:  adj.nombre,
          texto_completo:    `${adj.zona}\nAdjudicatario: ${adj.nombre}${adj.nif ? `\nNIF: ${adj.nif}` : ''}`,
        }));
      }
    }

    return [base];
  }

  // ── Helpers ─────────────────────────────────────────────────

  private extraerFecha(aboutUrl: string): string {
    const iso = aboutUrl.match(/^\/(\d{4}-\d{2}-\d{2})/);
    if (iso) {
      const [yyyy, mm, dd] = iso[1].split('-');
      return new Date(`${yyyy}-${mm}-${dd}`).toLocaleDateString('es-ES', {
        day: '2-digit', month: 'long', year: 'numeric',
      });
    }
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
    const match = descripcion.match(/^[–\-]?\s*([^.]+)\./);
    if (match) {
      const candidato = match[1].trim();
      const descartar = /licencia|farmaci|resoluc|consej|orden|decreto/i;
      if (!descartar.test(candidato) && candidato.length > 2) return candidato;
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
    console.log(`[BOCM]    Keywords: ${this.keywords.join(' | ')}`);
    console.log('[BOCM] ═══════════════════════════════════════════');

    // ── Fase 1: recopilar todos los resultados únicos ──────────
    const vistos = new Map<string, ResultadoPrevio>();

    for (const kw of this.keywords) {
      try {
        await this.delay(700);
        const items = await this.buscarKeyword(kw);
        for (const item of items) {
          const key = `${item.anuncio.titulo}|${item.anuncio.fecha}`;
          if (!vistos.has(key)) vistos.set(key, item);
        }
      } catch (err) {
        const msg = `Keyword "${kw}": ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[BOCM] ⚠️  ${msg}`);
        advertencias.push(msg);
      }
    }

    console.log(`[BOCM] 📋 ${vistos.size} anuncios únicos — enriqueciendo con páginas de detalle...`);

    // ── Fase 2: enriquecer (HTML + PDF cuando procede) ─────────
    const anuncios: AnuncioFarmacia[] = [];

    for (const previo of vistos.values()) {
      try {
        await this.delay(500);
        const resultados = await this.enriquecer(previo);
        for (const a of resultados) {
          if (a.titular_entrante || a.direccion_farmacia) {
            console.log(`[BOCM] ✔ ${a.municipio} — entrante: ${a.titular_entrante ?? '—'} | dir: ${a.direccion_farmacia ?? '—'}`);
          }
          anuncios.push(a);
        }
      } catch (err) {
        anuncios.push(previo.anuncio);
        advertencias.push(`Detalle fallido (${previo.aboutUrl}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const duracion_ms = Date.now() - t0;

    console.log('[BOCM] ═══════════════════════════════════════════');
    console.log(`[BOCM] ✅ Finalizado — ${anuncios.length} anuncios en ${duracion_ms}ms`);
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
