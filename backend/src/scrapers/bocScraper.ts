import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';

// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN — selectores verificados contra el DOM real del BOC
//  Estructura confirmada: /boc/archivo/YYYY/NNN/ con <li class="justificado_boc">
// ─────────────────────────────────────────────────────────────
const BOC_BASE = 'https://www.gobiernodecanarias.org';
const BOC_HOME = `${BOC_BASE}/boc`;
// Los PDFs individuales viven en la sede electrónica
const BOC_SEDE = 'https://sede.gobiernodecanarias.org';

// Cuántos números recientes analizar (cada número = 1 día hábil)
const MAX_ISSUES = 50;

const SEL = {
  // Links a números del boletín en la homepage
  issueLinks: 'p.justificado_boc a',
  // Cada entrada/resolución dentro de un número
  entrada: 'li.justificado_boc',
  // Título de la entrada (el <a> con texto largo, sin el <b> del número)
  titulo: 'a:not(:has(b)):not([title="Versión HTML"]):not([title*="firma"]):not([title="Descargar en formato PDF"])',
  // Enlace de descarga PDF
  pdf: 'a[title="Descargar en formato PDF"]',
  // Encabezado del número (contiene la fecha)
  fechaH2: 'h2',
  // Sección (I. Disposiciones generales, III. Otras resoluciones...)
  seccion: 'h4',
  // Organismo (Consejería de Sanidad, etc.)
  organismo: 'h5',
} as const;

// Palabras clave para filtrar entradas relevantes
const KEYWORDS_FARMACIA = [
  'farmacia',
  'farmacéut',
  'farmaceut',
  'oficina de farmacia',
];

// Islas/municipios más comunes en el BOC para extracción
const MUNICIPIOS_CANARIOS = [
  'Las Palmas de Gran Canaria', 'Santa Cruz de Tenerife', 'La Laguna',
  'Telde', 'Arona', 'Las Palmas', 'Arrecife', 'Puerto del Rosario',
  'San Cristóbal de La Laguna', 'La Orotava', 'Adeje', 'Granadilla',
  'Gran Canaria', 'Tenerife', 'Lanzarote', 'Fuerteventura',
  'La Palma', 'La Gomera', 'El Hierro', 'La Graciosa',
];

// ─────────────────────────────────────────────────────────────

export class BocScraper implements IScraper {
  readonly nombre = 'BOC';
  readonly comunidad = 'Canarias';
  readonly keywords = KEYWORDS_FARMACIA;

  private readonly http = axios.create({
    baseURL: BOC_BASE,
    timeout: Number(process.env.SCRAPER_TIMEOUT_MS) || 20000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
    maxRedirects: 5,
  });

  // ── Paso 1: obtener URLs de los últimos números del BOC ──────
  // La homepage solo muestra ~16 números. Para cubrir MAX_ISSUES,
  // generamos las URLs retroactivamente usando el último número publicado.
  private async getIssueUrls(): Promise<string[]> {
    console.log(`[BOC] 🌐 Obteniendo lista de números recientes desde ${BOC_HOME}`);
    const res = await this.http.get<string>('/boc');
    const $ = cheerio.load(res.data);

    // Obtener el número más reciente de la homepage
    const firstHref = $(SEL.issueLinks).first().attr('href') || '';
    const match = firstHref.match(/\/boc\/(\d{4})\/(\d+)/);

    const urls: string[] = [];

    if (match) {
      const year = parseInt(match[1]);
      const lastNum = parseInt(match[2]);
      // Generar retroactivamente hasta MAX_ISSUES números
      for (let i = 0; i < MAX_ISSUES; i++) {
        const num = lastNum - i;
        if (num <= 0) break;
        const y = num > lastNum ? year - 1 : year; // cruzar año si es necesario
        urls.push(`${BOC_BASE}/boc/${y}/${String(num).padStart(3, '0')}`);
      }
    } else {
      // Fallback: usar links directos de la homepage
      $(SEL.issueLinks).each((_, el) => {
        const href = $(el).attr('href') || '';
        if (/\/boc\/\d{4}\/\d+/.test(href)) {
          const fullUrl = href.startsWith('http') ? href : `${BOC_BASE}${href}`;
          if (!urls.includes(fullUrl)) urls.push(fullUrl);
        }
      });
    }

    console.log(`[BOC] 📅 Números a analizar: ${urls.length} (del ${urls[urls.length - 1]?.split('/').slice(-1)} al ${urls[0]?.split('/').slice(-1)})`);
    return urls;
  }

  // ── Paso 2: extraer entradas de farmacia de un número del BOC ──
  private async parsearNumero(issueUrl: string): Promise<AnuncioFarmacia[]> {
    let html: string;
    try {
      const res = await this.http.get<string>(issueUrl);
      html = res.data;
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      console.warn(`[BOC] ⚠️  No se pudo cargar ${issueUrl}: ${msg}`);
      return [];
    }

    const $ = cheerio.load(html);
    const resultados: AnuncioFarmacia[] = [];

    // Extraer fecha del encabezado del número
    // <h2>BOC Nº 74. Viernes 17 de abril de 2026</h2>
    const h2Text = $(SEL.fechaH2).first().text().trim();
    const fechaMatch = h2Text.match(/(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i);
    const fecha = fechaMatch ? fechaMatch[1] : this.extraerFechaDeUrl(issueUrl);

    // Para cada entrada de la lista, asociar la sección y organismo en curso
    let seccionActual = '';
    let organismoActual = '';

    $(`${SEL.seccion}, ${SEL.organismo}, ${SEL.entrada}`).each((_, el) => {
      const $el = $(el);
      const tag = el.tagName?.toLowerCase();

      if (tag === 'h4') {
        seccionActual = $el.text().trim();
        return;
      }
      if (tag === 'h5') {
        organismoActual = $el.text().trim();
        return;
      }
      if (tag !== 'li') return;

      // Es una entrada (li.justificado_boc)
      // Obtener el título: primer <a> sin <b> y con texto largo
      let titulo = '';
      $el.find('a').each((_, a) => {
        const $a = $(a);
        const hasNumber = $a.find('b').length > 0;
        const isDownload = ($a.attr('title') || '').toLowerCase().includes('descarg');
        const isHtml = ($a.attr('title') || '').toLowerCase().includes('html');
        const isFirma = ($a.attr('title') || '').toLowerCase().includes('firma');
        const texto = $a.text().trim();

        if (!hasNumber && !isDownload && !isHtml && !isFirma && texto.length > 20) {
          titulo = texto;
          return false; // break
        }
      });

      if (!titulo) return;

      // Filtrar: solo entradas que mencionen farmacia
      const tituloLower = titulo.toLowerCase();
      const esFarmacia = KEYWORDS_FARMACIA.some(kw => tituloLower.includes(kw.toLowerCase()));
      if (!esFarmacia) return;

      // PDF: buscar el enlace de descarga
      const pdfHref =
        $el.find('a[title="Descargar en formato PDF"]').attr('href') ||
        $el.find(`a[href*="sede.gobiernodecanarias.org"][href$=".pdf"]`).last().attr('href') ||
        $el.find('a[href$=".pdf"]').last().attr('href') ||
        '';

      const enlace_pdf = pdfHref.startsWith('http')
        ? pdfHref
        : pdfHref
        ? `${BOC_SEDE}${pdfHref}`
        : '';

      // Municipio: buscar nombre de isla/municipio canario en el título
      const municipio = this.extraerMunicipio(titulo) || organismoActual.split('.')[0].trim() || 'Canarias';

      resultados.push({
        titulo: titulo.replace(/\s+/g, ' ').trim(),
        fecha,
        municipio,
        enlace_pdf,
        texto_resumen: `${seccionActual}${organismoActual ? ` — ${organismoActual}` : ''}`.trim().slice(0, 300) ||
          titulo.slice(0, 300),
        comunidad: this.comunidad,
        fuente: this.nombre,
        ...extraerTitulares(titulo),
      });
    });

    if (resultados.length) {
      console.log(`[BOC] 📋 ${issueUrl.split('/').slice(-3).join('/')} → ${resultados.length} entradas de farmacia`);
    }

    return resultados;
  }

  // ── Helpers ─────────────────────────────────────────────────

  private extraerFechaDeUrl(url: string): string {
    // boc/archivo/2026/074/ → intenta inferir desde el número
    const match = url.match(/\/(\d{4})\/(\d+)/);
    if (match) return `Año ${match[1]}, nº ${parseInt(match[2])}`;
    return 'Fecha no disponible';
  }

  private extraerMunicipio(titulo: string): string | null {
    for (const municipio of MUNICIPIOS_CANARIOS) {
      if (titulo.toLowerCase().includes(municipio.toLowerCase())) {
        return municipio;
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

    console.log('[BOC] ═══════════════════════════════════════════════');
    console.log('[BOC] 🚀 Iniciando scraper — Canarias (BOC)');
    console.log(`[BOC]    Estrategia: índice de los últimos ${MAX_ISSUES} números`);
    console.log('[BOC] ═══════════════════════════════════════════════');

    let issueUrls: string[] = [];
    try {
      issueUrls = await this.getIssueUrls();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BOC] ❌ No se pudo obtener la lista de números: ${msg}`);
      advertencias.push(`Error obteniendo índice: ${msg}`);
    }

    const vistos = new Map<string, AnuncioFarmacia>();

    for (const url of issueUrls) {
      try {
        await this.delay(500);
        const entradas = await this.parsearNumero(url);
        for (const e of entradas) {
          const key = `${e.titulo}|${e.fecha}`;
          if (!vistos.has(key)) vistos.set(key, e);
        }
      } catch (err) {
        const msg = `Error en ${url}: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[BOC] ⚠️  ${msg}`);
        advertencias.push(msg);
      }
    }

    const anuncios = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    console.log('[BOC] ═══════════════════════════════════════════════');
    console.log(`[BOC] ✅ Finalizado — ${anuncios.length} anuncios en ${issueUrls.length} números (${duracion_ms}ms)`);
    console.log('[BOC] ═══════════════════════════════════════════════');

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

export const bocScraper = new BocScraper();
