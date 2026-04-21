import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';

// ─────────────────────────────────────────────────────────────
//  BOJA — Boletín Oficial de la Junta de Andalucía
//  Estructura verificada: /eboja/YYYY/N/ con <div class="item">
//  PDFs: <a class="item_pdf_grupo" href="BOJAXX-N-xxx.pdf">
//  Selectores verificados contra DOM real — abril 2026
// ─────────────────────────────────────────────────────────────
const BOJA_BASE = 'https://www.juntadeandalucia.es';
const BOJA_HOME = '/eboja/';

// Secciones relevantes: s52 (otras disposiciones) y s57 (anuncios)
// Las resoluciones de farmacia aparecen en estas dos secciones
const SECTIONS = ['s52', 's57'];

// Máximo de números a analizar (últimos ~18 meses = ~350 números)
const MAX_ISSUES = 370;

// ── Filtros de relevancia ────────────────────────────────────
// MUST contener la frase exacta "oficina de farmacia"
const KW_PRINCIPAL = ['oficina de farmacia'];

// MUST contener al menos una acción del ciclo de vida
const KW_ACCION = [
  'transmisión', 'transmision',
  'apertura',
  'cierre',
  'cambio de titular', 'cambio de titularidad',
  'adjudicación', 'adjudicacion',
  'traslado',
  'autorización de instalación', 'autorizacion de instalacion',
];

// Municipios andaluces para extracción de localización
const MUNICIPIOS = [
  'Sevilla', 'Málaga', 'Córdoba', 'Granada', 'Huelva', 'Cádiz', 'Almería', 'Jaén',
  'Jerez de la Frontera', 'Marbella', 'Dos Hermanas', 'Algeciras', 'Torremolinos',
  'Fuengirola', 'Roquetas de Mar', 'Chiclana de la Frontera', 'Utrera',
  'Antequera', 'Alcalá de Guadaíra', 'San Fernando', 'Linares',
  'El Puerto de Santa María', 'Benalmádena', 'Vélez-Málaga', 'Motril',
];

const SEL = {
  // Link a números del BOJA en la homepage
  issueLink: 'a[href]',
  // Cada resolución/disposición
  item: 'div.item',
  // Texto de la resolución
  texto: 'p',
  // Enlace al PDF oficial
  pdf: 'a.item_pdf_grupo',
} as const;

// ─────────────────────────────────────────────────────────────

export class BojaScraper implements IScraper {
  readonly nombre = 'BOJA';
  readonly comunidad = 'Andalucía';
  readonly keywords = KW_PRINCIPAL;

  private readonly http = axios.create({
    baseURL: BOJA_BASE,
    timeout: Number(process.env.SCRAPER_TIMEOUT_MS) || 8000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  });

  private delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

  // ── Paso 1: generar URLs de números recientes del BOJA ─────────────────
  // La homepage solo muestra ~34 números. Generamos el rango completo
  // de los últimos dos años (año actual + año anterior) directamente.
  private async getIssueUrls(): Promise<string[]> {
    const now = new Date();
    const year = now.getFullYear();
    const prevYear = year - 1;

    // El BOJA publica ~200-250 números por año (L-V). Generamos hasta 250
    // para cada año y filtramos los que existan (el servidor devuelve 404 si no existe).
    const candidatos: string[] = [];
    for (let n = 1; n <= 250; n++) candidatos.push(`${BOJA_BASE}/eboja/${prevYear}/${n}/`);
    for (let n = 1; n <= 120; n++) candidatos.push(`${BOJA_BASE}/eboja/${year}/${n}/`);

    console.log(`[BOJA] 📅 Generados ${candidatos.length} candidatos para ${prevYear}-${year}`);
    return candidatos.slice(0, MAX_ISSUES);
  }

  // ── Paso 2: parsear una página del BOJA y extraer resoluciones ──────────
  // issueBase = URL raíz del número (ej: .../eboja/2025/151/)
  // pageUrl   = URL de la página concreta (puede ser sección /s52, etc.)
  private parsearPagina(html: string, issueBase: string): AnuncioFarmacia[] {
    const $ = cheerio.load(html);
    const resultados: AnuncioFarmacia[] = [];

    const fechaBoletín = this.extraerFechaDeHtml($) || this.extraerFechaDeUrl(issueBase);

    $(SEL.item).each((_, el) => {
      const $el = $(el);

      // Texto de la resolución (el <p> más largo del item)
      let textoResolucion = '';
      $el.find(SEL.texto).each((_, p) => {
        const t = $(p).text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        if (t.length > textoResolucion.length) textoResolucion = t;
      });

      if (!textoResolucion || textoResolucion.length < 30) return;

      const textoLow = textoResolucion.toLowerCase();

      // ── Filtro estricto de relevancia ──────────────────────
      const esFarmacia = KW_PRINCIPAL.some(kw => textoLow.includes(kw));
      if (!esFarmacia) return;

      const esAccion = KW_ACCION.some(kw => textoLow.includes(kw));
      if (!esAccion) return;

      // ── PDF ────────────────────────────────────────────────
      const pdfHref = $el.find(SEL.pdf).attr('href') || '';
      let enlace_pdf = '';
      if (pdfHref) {
        enlace_pdf = pdfHref.startsWith('http')
          ? pdfHref
          : `${issueBase}${pdfHref}`;
      }

      // ── Municipio ─────────────────────────────────────────
      const municipio = this.extraerMunicipio(textoResolucion) ?? 'Andalucía';

      resultados.push({
        titulo: textoResolucion.slice(0, 350),
        fecha: fechaBoletín,
        municipio,
        enlace_pdf,
        texto_resumen: textoResolucion.slice(0, 500),
        comunidad: this.comunidad,
        fuente: this.nombre,
      });
    });

    return resultados;
  }

  // ── Paso 3: cargar un número completo (index + secciones) ──────────────
  private async parsearNumero(issueUrl: string): Promise<AnuncioFarmacia[]> {
    const resultados: AnuncioFarmacia[] = [];

    // Intentar el index y todas las secciones
    const paginas = SECTIONS.map(sec => sec ? `${issueUrl}${sec}` : issueUrl);

    for (const pageUrl of paginas) {
      try {
        const res = await this.http.get<string>(pageUrl);
        if (res.status !== 200 || !res.data) continue;

        // Quick scan: solo parsear si la página menciona farmacia
        if (!/farmaci/i.test(res.data)) continue;

        const items = this.parsearPagina(res.data, issueUrl);
        if (items.length) {
          console.log(
            `[BOJA] 📋 ${issueUrl.split('/eboja/')[1]}${pageUrl.includes('s5') ? pageUrl.split('/').pop() : ''} ` +
            `→ ${items.length} entradas de farmacia`
          );
          resultados.push(...items);
        }
      } catch {
        // Silenciar 404 de secciones inexistentes
      }

      await this.delay(120);
    }

    return resultados;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private extraerFechaDeHtml($: cheerio.CheerioAPI): string | null {
    // Buscar fecha en el título del documento
    const title = $('title').text().trim();
    const mNum = title.match(/n[oº°]\s*(\d+)\s+de\s+(\d{4})/i);
    if (mNum) return `BOJA ${mNum[2]} nº${mNum[1]}`;

    // Buscar patrón de fecha en el contenido (ej: "Sevilla, 7 de agosto de 2025")
    const bodyText = $('body').text();
    const mDate = bodyText.match(/(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i);
    if (mDate) return mDate[1];

    return null;
  }

  private extraerFechaDeUrl(url: string): string {
    // /eboja/YYYYMMDD.html → "DD de Mes de YYYY"
    const d = url.match(/\/eboja\/(\d{4})(\d{2})(\d{2})\.html/);
    if (d) {
      return new Date(`${d[1]}-${d[2]}-${d[3]}`).toLocaleDateString('es-ES', {
        day: '2-digit', month: 'long', year: 'numeric',
      });
    }
    // /eboja/YYYY/N/ → "BOJA YYYY nºN"
    const m = url.match(/\/eboja\/(\d{4})\/(\d+)/);
    if (m) return `BOJA ${m[1]} nº${m[2]}`;

    return 'Fecha no disponible';
  }

  private extraerMunicipio(texto: string): string | null {
    for (const mun of MUNICIPIOS) {
      // Normalizar acentos para comparación robusta
      const norm = (s: string) =>
        s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (norm(texto).includes(norm(mun))) return mun;
    }
    // "sita en CIUDAD" / "ubicada en CIUDAD"
    const m = texto.match(
      /(?:sita?s?\s+en|ubicadas?\s+en|en\s+la\s+(?:ciudad|localidad|poblaci[oó]n)\s+de)\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ\s-]{3,30}?)(?=[,.]|\s+\(|\s+calle)/i
    );
    if (m) return m[1].trim();
    return null;
  }

  // ── Punto de entrada ────────────────────────────────────────────────────
  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];

    console.log('[BOJA] ════════════════════════════════════════════════');
    console.log('[BOJA] 🚀 Iniciando scraper — Andalucía (BOJA)');
    console.log(`[BOJA]    Filtro: "${KW_PRINCIPAL.join('" | "')}" + acción`);
    console.log('[BOJA] ════════════════════════════════════════════════');

    let issueUrls: string[] = [];
    try {
      issueUrls = await this.getIssueUrls();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BOJA] ❌ Error obteniendo índice: ${msg}`);
      advertencias.push(`Error obteniendo índice: ${msg}`);
    }

    const vistos = new Map<string, AnuncioFarmacia>();

    for (const url of issueUrls) {
      try {
        await this.delay(150);
        const entradas = await this.parsearNumero(url);
        for (const e of entradas) {
          const key = `${e.titulo}|${e.fecha}`;
          if (!vistos.has(key)) vistos.set(key, e);
        }
      } catch (err) {
        const msg = `Error en ${url}: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[BOJA] ⚠️  ${msg}`);
        advertencias.push(msg);
      }
    }

    const anuncios = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    console.log('[BOJA] ════════════════════════════════════════════════');
    console.log(`[BOJA] ✅ Finalizado — ${anuncios.length} anuncios en ${issueUrls.length} números (${duracion_ms}ms)`);
    console.log('[BOJA] ════════════════════════════════════════════════');

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

export const bojaScraper = new BojaScraper();
