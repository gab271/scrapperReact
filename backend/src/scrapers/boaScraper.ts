import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';

// ─────────────────────────────────────────────────────────────
//  BOA — Boletín Oficial de Aragón
//
//  Estrategia: BRSCGI JSON API (sin Puppeteer)
//    GET /cgi-bin/EBOA/BRSCGI?CMD=VERLST&BASE=BZHT&DOCS=1-100
//      &SEC=OPENDATABOAJSONAPP&OUTPUTMODE=JSON&SORT=-PUBL
//      &TEXT-C=oficina%2520de%2520farmacia   ← double-encoded
//      &@PUBL-GE=YYYYMMDD&@PUBL-LE=YYYYMMDD
//
//  Devuelve JSON con campos: DOCN, FechaPublicacion, Titulo, Texto, UrlPdf…
//  UrlPdf tiene múltiples URLs separadas por backticks.
// ─────────────────────────────────────────────────────────────

const BOA_BASE      = 'https://www.boa.aragon.es';
const BRSCGI        = `${BOA_BASE}/cgi-bin/EBOA/BRSCGI`;
const LOOKBACK_DAYS = 90;
const PAGE_SIZE     = 100;

const KW_ACCION = [
  'transmision', 'transmisión',
  'apertura',
  'cierre',
  'cambio de titular', 'cambio de titularidad',
  'adjudicacion', 'adjudicación',
  'autorizacion', 'autorización',
];

const MUNICIPIOS = [
  'Zaragoza', 'Huesca', 'Teruel', 'Calatayud', 'Barbastro',
  'Ejea de los Caballeros', 'Monzón', 'Fraga', 'Alcañiz',
  'Utebo', 'Cuarte de Huerva', 'Caspe', 'Jaca', 'Tarazona',
  'Sabiñánigo', 'Andorra', 'Calamocha', 'Híjar',
];

// ─────────────────────────────────────────────────────────────

interface BoaItem {
  DOCN:             string;
  FechaPublicacion: string;   // YYYYMMDD
  Numeroboletin:    string;
  Seccion:          string;
  Rango:            string;
  Emisor:           string;
  Titulo:           string;
  Texto:            string;
  UrlPdf?:          string;
}

export class BoaScraper implements IScraper {
  readonly nombre    = 'BOA';
  readonly comunidad = 'Aragón';
  readonly keywords  = ['oficina de farmacia'];

  private readonly http = axios.create({
    baseURL: BOA_BASE,
    timeout: 20_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
      Accept: 'application/json, text/plain, */*',
    },
  });

  private delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

  private fmtDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  private fmtFecha(yyyymmdd: string): string {
    if (yyyymmdd.length !== 8) return yyyymmdd;
    return `${yyyymmdd.slice(6)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`;
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
    return match ? match[1].trim() : 'Aragón';
  }

  // Only check the Titulo field to avoid false positives from Texto
  // (e.g. "traslados interautonómicos" = patient transport, not pharmacy transfer)
  private esRelevante(titulo: string): boolean {
    const t = titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const tieneKw = KW_ACCION.some(kw =>
      t.includes(kw.normalize('NFD').replace(/[̀-ͯ]/g, ''))
    );
    return tieneKw && (t.includes('farmacia') || t.includes('oficina'));
  }

  private extraerUrlPdf(urlPdfField: string, docn: string): string {
    // UrlPdf field: "`https://url1`https://url2`   " — split on backtick/spaces
    const parts = urlPdfField.split('\x60').map(s => s.trim()).filter(s => s.startsWith('http'));
    return parts[0] || `${BRSCGI}?CMD=VERDOC&BASE=BZHT&DOCR=${docn}`;
  }

  private async consultarPagina(desde: string, hasta: string, inicio: number): Promise<BoaItem[]> {
    const docsParam = `${inicio}-${inicio + PAGE_SIZE - 1}`;

    // BRSCGI requires double-encoded spaces (%2520) and literal + as OR in SECC-C.
    // The Angular app sends TEXT-C=oficina%2520de%2520farmacia and server double-decodes.
    const url = `/cgi-bin/EBOA/BRSCGI?CMD=VERLST&BASE=BZHT&DOCS=${docsParam}`
      + `&SEC=OPENDATABOAJSONAPP&OUTPUTMODE=JSON&SORT=-PUBL&SEPARADOR=`
      + `&SECC-C=I%2BO%2BII%2BO%2BIII%2BO%2BIV%2BO%2BV`
      + `&TEXT-C=oficina%2520de%2520farmacia`
      + `&@PUBL-GE=${desde}&@PUBL-LE=${hasta}&FDIS-C=`;

    // Response is ISO-8859-1 — read as binary buffer and decode
    const res = await this.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
    const text = Buffer.from(res.data).toString('latin1');

    try {
      const data = JSON.parse(text);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const anuncios: AnuncioFarmacia[] = [];

    console.log('[BOA]  ════════════════════════════════════════════════');
    console.log('[BOA]  🚀 Iniciando scraper — Aragón (BRSCGI JSON API)');
    console.log(`[BOA]     Histórico: últimos ${LOOKBACK_DAYS} días`);
    console.log('[BOA]  ════════════════════════════════════════════════');

    const hoy    = new Date();
    const desde  = new Date(hoy);
    desde.setDate(hoy.getDate() - LOOKBACK_DAYS);
    const fechaDesde = this.fmtDate(desde);
    const fechaHasta = this.fmtDate(hoy);
    console.log(`[BOA]  Rango: ${fechaDesde} → ${fechaHasta}`);

    try {
      let inicio  = 1;
      let total   = 0;
      let paginas = 0;

      while (paginas < 5) {
        paginas++;
        console.log(`[BOA]  Consultando resultados ${inicio}-${inicio + PAGE_SIZE - 1}...`);

        const items = await this.consultarPagina(fechaDesde, fechaHasta, inicio);
        if (items.length === 0) {
          console.log('[BOA]  Sin más resultados');
          break;
        }

        total += items.length;

        for (const item of items) {
          if (!this.esRelevante(item.Titulo || '')) continue;

          const docUrl = this.extraerUrlPdf(item.UrlPdf || '', item.DOCN);

          const $ = cheerio.load(item.Texto || '');
          const textoLimpio = $.text().replace(/\s+/g, ' ').trim();

          anuncios.push({
            titulo:        (item.Titulo || '').slice(0, 350),
            fecha:         this.fmtFecha(item.FechaPublicacion),
            municipio:     this.extraerMunicipio(item.Titulo || ''),
            enlace_pdf:    docUrl,
            texto_resumen: textoLimpio.slice(0, 500) || (item.Titulo || '').slice(0, 500),
            comunidad:     this.comunidad,
            fuente:        this.nombre,
            ...extraerTitulares(textoLimpio || item.Titulo || ''),
          });
        }

        if (items.length < PAGE_SIZE) break;
        inicio += PAGE_SIZE;
        await this.delay(300);
      }

      console.log(`[BOA]  Total revisados: ${total} | Relevantes: ${anuncios.length}`);

      if (anuncios.length === 0 && total > 0) {
        const msg = `${total} docs en rango pero ninguno con keywords de acción + farmacia en título`;
        console.warn(`[BOA]  ℹ️  ${msg}`);
        advertencias.push(msg);
      } else if (total === 0) {
        const msg = 'La API BRSCGI no devolvió resultados para el rango de fechas';
        console.warn(`[BOA]  ⚠️  ${msg}`);
        advertencias.push(msg);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BOA]  ❌ ${msg}`);
      advertencias.push(msg);
    }

    const duracion_ms = Date.now() - t0;
    console.log('[BOA]  ════════════════════════════════════════════════');
    console.log(`[BOA]  ✅ Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[BOA]  ════════════════════════════════════════════════');

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

export const boaScraper = new BoaScraper();
