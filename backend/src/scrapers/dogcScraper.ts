import axios, { AxiosError } from 'axios';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';

// ─────────────────────────────────────────────────────────────
//  DOGC — Diari Oficial de la Generalitat de Catalunya
//
//  API REST verificada — abril 2026:
//    POST portaldogc.gencat.cat/eadop-rest/api/dogc/searchDOGC
//    Content-Type: application/json
//    Campos obligatorios: typeSearch (int), orderBy (int)
//    typeSearch=1 → búsqueda por palabras
//    orderBy=3    → más reciente primero
//
//  Respuesta JSON: { resultSearch: [{ title, date, linkDownloadPDF, idDocument }] }
// ─────────────────────────────────────────────────────────────
const DOGC_API_HOST = 'https://portaldogc.gencat.cat';
const DOGC_SEARCH_PATH = '/eadop-rest/api/dogc/searchDOGC';
const DOGC_DOC_BASE = 'https://dogc.gencat.cat/ca/document-del-dogc/?documentId=';

// Resultados por página máximo que devuelve la API
const NUM_RESULTS_PER_PAGE = 50;

// ── Filtros de relevancia ────────────────────────────────────
// Término principal (catalán y castellano)
const KW_PRINCIPAL = [
  'oficina de farmàcia',
  'oficina de farmacia',
];

// Acciones del ciclo de vida de la farmacia
const KW_ACCION = [
  // Catalán
  'transmissió', 'transmissio',
  'obertura', 'tancament',
  'canvi de titularitat', 'canvi de titular',
  'adjudicació', 'adjudicacio',
  'trasllat',
  // Castellano (algunas resoluciones mezclan idiomas)
  'transmisión', 'transmision',
  'apertura', 'cierre',
  'cambio de titularidad', 'cambio de titular',
  'traslado',
];

// Municipios catalanes comunes para extracción de localización
const MUNICIPIOS = [
  'Barcelona', 'Hospitalet de Llobregat', "L'Hospitalet de Llobregat",
  'Badalona', 'Terrassa', 'Sabadell', 'Lleida', 'Tarragona',
  'Mataró', 'Santa Coloma de Gramenet', 'Reus', 'Girona', 'Salt',
  'Cornellà de Llobregat', 'Sant Boi de Llobregat', 'Rubí', 'Manresa',
  'Vilanova i la Geltrú', 'Viladecans', 'Castelldefels', 'Granollers',
  'Mollet del Vallès', 'Gavà', 'Igualada', 'Esplugues de Llobregat',
  'Vic', 'Figueres', 'Martorell', 'Blanes', 'Tortosa', 'Sitges',
  'Cerdanyola del Vallès', 'Olot', 'Balaguer', 'Cambrils', 'Salou',
];

// ── Tipos de la API ──────────────────────────────────────────
interface DogcApiItem {
  title: string;
  date: string;         // "DD/MM/YYYY"
  linkDownloadPDF: string;
  linkTitle: string;    // "?action=fitxa&documentId=NNNNN"
  idDocument: string;
  current: boolean;
  tipusDiari: string;
}

interface DogcApiResponse {
  resultSearch: DogcApiItem[];
  urlCSVDownloadSearch: string | null;
}

// ─────────────────────────────────────────────────────────────

export class DogcScraper implements IScraper {
  readonly nombre = 'DOGC';
  readonly comunidad = 'Cataluña';
  readonly keywords = KW_PRINCIPAL;

  private readonly http = axios.create({
    baseURL: DOGC_API_HOST,
    timeout: Number(process.env.SCRAPER_TIMEOUT_MS) || 25000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'application/json',
      'Accept-Language': 'ca,es;q=0.8',
      'Content-Type': 'application/json',
      Referer: 'https://dogc.gencat.cat/',
    },
  });

  private delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

  // ── Búsqueda por keyword ─────────────────────────────────────────────────
  private async buscarKeyword(texto: string): Promise<AnuncioFarmacia[]> {
    console.log(`[DOGC] 🔍 Buscando por texto: "${texto}"`);

    const body = {
      value: texto,        // campo correcto según la API JS
      language: 'ca',
      numResultsByPage: NUM_RESULTS_PER_PAGE,
      page: 1,
      typeSearch: 1,   // búsqueda por palabras
      orderBy: 3,      // más recientes primero
      advanced: false,
    };

    return this.ejecutarBusqueda(body, texto);
  }

  // ── Lógica HTTP + filtro común ───────────────────────────────────────────
  private async ejecutarBusqueda(body: object, etiqueta: string): Promise<AnuncioFarmacia[]> {
    let data: DogcApiResponse;
    try {
      const res = await this.http.post<DogcApiResponse>(DOGC_SEARCH_PATH, body);
      data = res.data;
      console.log(`[DOGC] ✅ ${data.resultSearch?.length ?? 0} resultados para "${etiqueta}"`);
    } catch (err) {
      const msg =
        err instanceof AxiosError
          ? `HTTP ${err.response?.status ?? 'sin respuesta'} — ${err.message}`
          : String(err);
      console.warn(`[DOGC] ⚠️  Error buscando "${etiqueta}": ${msg}`);
      return [];
    }

    const resultados: AnuncioFarmacia[] = [];

    for (const item of data.resultSearch ?? []) {
      const titleLow = item.title.toLowerCase();

      // ── Filtro estricto ─────────────────────────────────
      const esFarmacia = KW_PRINCIPAL.some(kw => titleLow.includes(kw));
      if (!esFarmacia) continue;

      const esAccion = KW_ACCION.some(kw => titleLow.includes(kw));
      if (!esAccion) continue;

      const municipio = this.extraerMunicipio(item.title) ?? 'Cataluña';
      const docId = item.idDocument;

      const enlace_pdf = item.linkDownloadPDF
        || (docId ? `${DOGC_DOC_BASE}${docId}` : '');

      resultados.push({
        titulo: item.title,
        fecha: this.parsearFecha(item.date),
        municipio,
        enlace_pdf,
        texto_resumen: item.title,
        comunidad: this.comunidad,
        fuente: this.nombre,
      });
    }

    console.log(`[DOGC] 📋 "${etiqueta}" → ${resultados.length} resoluciones de farmacia`);
    return resultados;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private parsearFecha(dateStr: string): string {
    // Formato API: "17/04/2026" → "17 de abril de 2026"
    const m = dateStr?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      return new Date(`${yyyy}-${mm}-${dd}`).toLocaleDateString('es-ES', {
        day: '2-digit', month: 'long', year: 'numeric',
      });
    }
    return dateStr || 'Fecha no disponible';
  }

  private extraerMunicipio(titulo: string): string | null {
    const norm = (s: string) =>
      s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const titleNorm = norm(titulo);

    for (const mun of MUNICIPIOS) {
      if (titleNorm.includes(norm(mun))) return mun;
    }

    // Patrones en catalán y castellano
    const patterns = [
      /(?:situada?|ubicada?)\s+a\s+([A-ZÁÉÍÓÚÀÈÌÒÙÜÏL·l][A-Za-záéíóúàèìòùüïL·l\s'-]{3,30}?)(?=[,.]|\s+\()/i,
      /(?:situada?|ubicada?)\s+en\s+([A-ZÁÉÍÓÚÀÈÌÒÙÜ][A-Za-záéíóúàèìòùüA-ZÁÉÍÓÚÀÈÌÒÙÜ\s-]{3,25}?)(?=[,.])/i,
      /de\s+([A-ZÁÉÍÓÚÀÈÌÒÙÜ][A-Za-záéíóúàèìòùü\s-]{3,25}?)\s*,\s*(?:a\s+[A-Z]|carrer|carretera|avinguda)/i,
    ];

    for (const re of patterns) {
      const m = titulo.match(re);
      if (m) {
        const candidato = m[1].trim();
        if (candidato.length > 3 && candidato.length < 35) return candidato;
      }
    }

    return null;
  }

  // ── Punto de entrada ────────────────────────────────────────────────────
  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];

    console.log('[DOGC] ════════════════════════════════════════════════');
    console.log('[DOGC] 🚀 Iniciando scraper — Cataluña (DOGC)');
    console.log('[DOGC]    API: portaldogc.gencat.cat/eadop-rest/api/dogc/searchDOGC');
    console.log('[DOGC] ════════════════════════════════════════════════');

    const vistos = new Map<string, AnuncioFarmacia>();

    // Campo correcto en la API del DOGC: "value" (no "text")
    const estrategias: Array<() => Promise<AnuncioFarmacia[]>> = [
      () => this.buscarKeyword('oficina de farmàcia'),
      () => this.buscarKeyword('oficina de farmacia'),
    ];

    for (const estrategia of estrategias) {
      try {
        await this.delay(600);
        const items = await estrategia();
        for (const item of items) {
          const key = `${item.titulo}|${item.fecha}`;
          if (!vistos.has(key)) vistos.set(key, item);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[DOGC] ⚠️  ${msg}`);
        advertencias.push(msg);
      }
    }

    const anuncios = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    console.log('[DOGC] ════════════════════════════════════════════════');
    console.log(`[DOGC] ✅ Finalizado — ${anuncios.length} anuncios únicos (${duracion_ms}ms)`);
    console.log('[DOGC] ════════════════════════════════════════════════');

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

export const dogcScraper = new DogcScraper();
