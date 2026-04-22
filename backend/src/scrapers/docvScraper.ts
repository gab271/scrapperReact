/**
 * DOCV — Diari Oficial de la Comunitat Valenciana
 *
 * Endpoint descubierto via debug-docv-v5.ts:
 *   POST https://dogv.gva.es/dogv-portal/dogv/search
 *   Query: lang=es_es&page=N&size=20&sort=fechaDogvDesc
 *   Body: { texto, soloVigentes, soloTitulo, fechaInicioPublicacion, ... }
 *
 * Sin Puppeteer — axios puro.
 */

import axios from 'axios';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';

const DOGV_ORIGIN   = 'https://dogv.gva.es';
const SEARCH_URL    = `${DOGV_ORIGIN}/dogv-portal/dogv/search`;
const PAGE_SIZE     = 20;
const MAX_PAGES     = 10;
const LOOKBACK_DAYS = 365 * 10;  // últimos 10 años (DOCV tiene muy pocos eventos; capturar historial completo)

const KW_PRINCIPAL = ['oficina de farmacia', 'oficina de farmàcia'];
const KW_ACCION    = [
  'transmisión', 'transmision', 'transmissió',
  'apertura', 'obertura',
  'cierre', 'tancament',
  'cambio de titular', 'canvi de titular',
  'adjudicación', 'adjudicacio',
  'traslado', 'trasllat',
  'autorización', 'autoritzacio',
  'deniega', 'denega',
  'archivo', 'arxiu',
  'concesión', 'concessió',
];

const MUNICIPIOS = [
  'Valencia', 'Alicante', 'Castellón de la Plana', 'Elche', 'Torrent',
  'Orihuela', 'Gandía', 'Benidorm', 'Sagunto', 'Petrer',
  'Torrevieja', 'Villena', 'Elda', 'Alcoy', 'Dénia',
  'Calpe', 'Xàtiva', 'Burjassot', 'Paterna', 'Mislata',
  'Manises', 'Ontinyent', 'Alzira', 'Sueca', 'Cullera',
  'Requena', 'Sagunt', 'Puçol', 'Quart de Poblet', 'Silla',
];

const HEADERS = {
  'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':       'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'Referer':      'https://dogv.gva.es/es/cerca-de-legislacio',
  'Origin':       DOGV_ORIGIN,
};

interface DocvResultItem {
  id:               number;
  titulo:           string;
  organismo?:       string;
  fechaPublicacion: string;   // "DD/MM/YYYY"
  fechaDogv?:       string;
  urlPdf?:          string;
  seccion?:         { id: number; descripcion: string };
  estado?:          { descripcion: string };
}

interface DocvSearchResponse {
  totalPages:    number;
  totalElements: number;
  pageNumber:    number;
  content:       DocvResultItem[];
}

function fechaCorteLookback(): Date {
  const d = new Date();
  d.setDate(d.getDate() - LOOKBACK_DAYS);
  return d;
}

function parseFecha(ddmmyyyy: string): Date | null {
  const m = ddmmyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function extraerMunicipio(texto: string): string {
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(texto);
  for (const m of MUNICIPIOS) if (n.includes(norm(m))) return m;
  const match = texto.match(
    /(?:sita?|ubicada?|situada?)\s+en\s+([A-ZÁÉÍÓÚÀÈÏÜÑ][A-Za-záéíóúàèïüñ\s-]{3,30}?)(?=[,.]|\s+\()/i
  );
  return match ? match[1].trim() : 'Comunitat Valenciana';
}

function esRelevante(titulo: string): boolean {
  const tl = titulo.toLowerCase();
  return (
    KW_PRINCIPAL.some(kw => tl.includes(kw)) &&
    KW_ACCION.some(kw => tl.includes(kw))
  );
}

export class DocvScraper implements IScraper {
  readonly nombre    = 'DOCV';
  readonly comunidad = 'Valencia';
  readonly keywords  = KW_PRINCIPAL;

  private buildBody(texto: string) {
    // El servidor DOGV rechaza cualquier valor de fecha distinto de null.
    // Filtramos por fecha en el cliente usando parseFecha() + LOOKBACK_DAYS.
    return {
      texto,
      soloVigentes:              false,
      soloTitulo:                true,   // false causa error 500 en el servidor DOGV
      soloDerogadas:             false,
      soloConsolidadas:          false,
      tiposDocumentosId:         null,
      seccionId:                 null,
      isSeccion:                 false,
      organismosEmisoresId:      null,
      organismosPublicadoresId:  null,
      fechaInicioPublicacion:    null,
      fechaFinPublicacion:       null,
      legislaturas:              null,
      numeroDiarioOficial:       null,
      numeroDocumento:           null,
      fechaInicioDocumento:      null,
      fechaFinDocumento:         null,
    };
  }

  private itemToAnuncio(item: DocvResultItem): AnuncioFarmacia {
    const pdfPath = item.urlPdf ?? '';
    const enlace  = pdfPath.startsWith('http') ? pdfPath
      : pdfPath ? `${DOGV_ORIGIN}${pdfPath}` : '';

    return {
      titulo:        item.titulo.trim().slice(0, 350),
      fecha:         item.fechaPublicacion ?? item.fechaDogv ?? 'Fecha no disponible',
      municipio:     extraerMunicipio(item.titulo),
      enlace_pdf:    enlace,
      texto_resumen: item.titulo.trim().slice(0, 500),
      comunidad:     this.comunidad,
      fuente:        this.nombre,
    };
  }

  private async buscar(
    texto: string,
    advertencias: string[],
  ): Promise<AnuncioFarmacia[]> {
    const anuncios: AnuncioFarmacia[] = [];
    const vistos = new Set<string>();
    const corte  = fechaCorteLookback();

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        lang: 'es_es',
        page: String(page),
        size: String(PAGE_SIZE),
        sort: 'fechaDogvDesc',
      });

      let data: DocvSearchResponse;
      try {
        const res = await axios.post<DocvSearchResponse>(
          `${SEARCH_URL}?${params}`,
          this.buildBody(texto),
          { headers: HEADERS, timeout: 20_000 },
        );
        data = res.data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        advertencias.push(`Página ${page} falló: ${msg}`);
        break;
      }

      const { content, totalPages } = data;
      if (!content?.length) break;

      for (const item of content) {
        const fecha = parseFecha(item.fechaPublicacion);
        if (fecha && fecha < corte) continue;

        if (!esRelevante(item.titulo)) continue;
        const key = item.id ? String(item.id) : item.titulo.substring(0, 80);
        if (vistos.has(key)) continue;
        vistos.add(key);
        anuncios.push(this.itemToAnuncio(item));
      }

      console.log(`[DOCV] Página ${page + 1}/${totalPages} — ${anuncios.length} relevantes hasta ahora`);

      if (page + 1 >= totalPages) break;
    }

    return anuncios;
  }

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];

    console.log('[DOCV] ════════════════════════════════════════');
    console.log('[DOCV] Iniciando — Comunitat Valenciana (DOCV)');
    console.log('[DOCV] Estrategia: REST API POST /dogv-portal/dogv/search');
    console.log('[DOCV] ════════════════════════════════════════');

    let anuncios: AnuncioFarmacia[] = [];

    try {
      // Búsqueda en castellano
      const es = await this.buscar('oficina de farmacia', advertencias);
      // Búsqueda en valenciano
      const ca = await this.buscar('oficina de farmàcia', advertencias);

      // Deduplicar por enlace o título
      const vistos = new Set<string>();
      for (const a of [...es, ...ca]) {
        const key = a.enlace_pdf || a.titulo.substring(0, 80);
        if (!vistos.has(key)) { vistos.add(key); anuncios.push(a); }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DOCV] ❌ ${msg}`);
      advertencias.push(msg);
    }

    const duracion_ms = Date.now() - t0;
    console.log('[DOCV] ════════════════════════════════════════');
    console.log(`[DOCV] Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[DOCV] ════════════════════════════════════════');

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
