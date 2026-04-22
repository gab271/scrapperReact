/**
 * DOG — Diario Oficial de Galicia
 *
 * Estrategia: iteración de secciones por fecha (axios + cheerio)
 *   GET xunta.gal/dog/Publicados/YYYY/YYYYMMDD/SeccionesN_gl.html
 *   → parsea li.dog-toc-sumario → p.dog-descargar (en este orden)
 *
 * Nota: el DOG no publica eventos de ciclo de vida de farmacias
 * (transmisión, apertura, cierre) de forma habitual. El scraper es
 * técnicamente correcto; los 0 resultados reflejan el contenido real del BOE gallego.
 * Se incluye contenido normativo y de ayudas para ser útil.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';

const DOG_BASE      = 'https://www.xunta.gal';
const DOG_ISSUE     = '/dog/Publicados';
const LOOKBACK_DAYS = 365 * 2;   // 2 años
const SECCIONES     = ['Secciones1', 'Secciones2', 'Secciones3', 'Secciones4', 'Secciones5'];
const CONCURRENCY   = 15;

const KW_PRINCIPAL = ['oficina de farmacia', 'oficinas de farmacia', 'farmacia'];
const KW_ACCION    = [
  // Lifecycle
  'transmisión', 'transmision', 'apertura', 'cierre', 'peche',
  'cambio de titular', 'cambio de titularidade',
  'adjudicación', 'adxudicación', 'adjudicacion', 'adxudicacion',
  'traslado', 'traslación', 'traslacion', 'lekualdatzea',
  'autorización', 'autorizacion', 'autorización',
  'concesión', 'concesion',
  'denegación', 'denegacion',
  'caducidade', 'caducidad',
  // Galician-specific lifecycle
  'transmisión de licenza', 'apertura de nova oficina',
  'nova oficina de farmacia',
  // Normative (relevant for pharmacy owners)
  'axudas', 'subvencións', 'subvenciones',
  'regulación', 'decreto', 'regulamento',
];

const MUNICIPIOS = [
  'Vigo', 'A Coruña', 'Ourense', 'Lugo', 'Santiago de Compostela',
  'Pontevedra', 'Ferrol', 'Narón', 'Oleiros', 'Arteixo',
  'Vilagarcía de Arousa', 'Lalín', 'O Carballiño', 'Cangas',
  'Moaña', 'Redondela', 'Ponteareas', 'Tui', 'Cambados',
  'Ribeira', 'Boiro', 'Marín',
];

function extraerMunicipio(texto: string): string {
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(texto);
  for (const m of MUNICIPIOS) if (n.includes(norm(m))) return m;
  const match = texto.match(
    /(?:sita?|ubicada?|situada?|en\s+el\s+municipio\s+de)\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s-]{3,30}?)(?=[,.]|\s+\()/i
  );
  return match ? match[1].trim() : 'Galicia';
}

function esRelevante(titulo: string): boolean {
  const tl = titulo.toLowerCase();
  return (
    KW_PRINCIPAL.some(kw => tl.includes(kw)) &&
    KW_ACCION.some(kw => tl.includes(kw))
  );
}

export class DogScraper implements IScraper {
  readonly nombre    = 'DOG';
  readonly comunidad = 'Galicia';
  readonly keywords  = KW_PRINCIPAL;

  private readonly http = axios.create({
    baseURL: DOG_BASE,
    timeout: 10_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html',
      'Accept-Language': 'es-ES,es;q=0.9,gl;q=0.8',
    },
  });

  private mesNombre(m: number): string {
    return ['enero','febrero','marzo','abril','mayo','junio',
      'julio','agosto','septiembre','octubre','noviembre','diciembre'][m];
  }

  private parsearSeccion(html: string, fecha: string): AnuncioFarmacia[] {
    const $         = cheerio.load(html);
    const resultados: AnuncioFarmacia[] = [];
    // Use a container object to avoid TypeScript control-flow narrowing through closures
    const state = { pending: null as AnuncioFarmacia | null };

    const flushPending = () => {
      const it = state.pending;
      if (it && esRelevante(it.titulo)) resultados.push(it);
      state.pending = null;
    };

    // DOG structure per entry: li.dog-toc-sumario → p.dog-pagina → p.dog-descargar
    $('li.dog-toc-sumario, p.dog-descargar').each((_, el) => {
      const $el = $(el);

      if ($el.is('p.dog-descargar')) {
        // PDF link follows the previously captured sumario item
        if (state.pending) {
          const pdfHref = $el.find('a[href*=".pdf"]').attr('href') || '';
          if (pdfHref) {
            state.pending.enlace_pdf = pdfHref.startsWith('http')
              ? pdfHref
              : `${DOG_BASE}${pdfHref}`;
          }
          flushPending();
        }
        return;
      }

      // Flush previous item that had no p.dog-descargar (shouldn't happen normally)
      flushPending();

      const anchor = $el.find('a').first();
      const titulo = anchor.text().replace(/\s+/g, ' ').trim();
      if (!titulo || titulo.length < 20) return;

      const href   = anchor.attr('href') || '';
      const enlace = href.startsWith('http') ? href : href ? `${DOG_BASE}${href}` : '';

      state.pending = {
        titulo:        titulo.slice(0, 350),
        fecha,
        municipio:     extraerMunicipio(titulo),
        enlace_pdf:    enlace,
        texto_resumen: titulo.slice(0, 500),
        comunidad:     this.comunidad,
        fuente:        this.nombre,
      };
    });

    flushPending();
    return resultados;
  }

  private buildUrls(): { url: string; fecha: string }[] {
    const result: { url: string; fecha: string }[] = [];
    const now = new Date();
    for (let i = 1; i <= LOOKBACK_DAYS; i++) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const yyyy    = d.getFullYear();
      const mm      = String(d.getMonth() + 1).padStart(2, '0');
      const dd      = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}${mm}${dd}`;
      const fecha   = `${dd} de ${this.mesNombre(d.getMonth())} de ${yyyy}`;
      for (const sec of SECCIONES) {
        result.push({
          url:   `${DOG_ISSUE}/${yyyy}/${dateStr}/${sec}_gl.html`,
          fecha,
        });
      }
    }
    return result;
  }

  private async fetchAndParse(url: string, fecha: string): Promise<AnuncioFarmacia[]> {
    try {
      const res = await this.http.get<string>(url);
      if (!res.data || !/farmaci/i.test(res.data)) return [];
      return this.parsearSeccion(res.data, fecha);
    } catch {
      return []; // 404 en festivos / fines de semana
    }
  }

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const vistos = new Map<string, AnuncioFarmacia>();

    console.log('[DOG] ════════════════════════════════════════');
    console.log('[DOG] Iniciando — Galicia (DOG/DOGA)');
    console.log(`[DOG] Estrategia: iteración de secciones (últimos ${LOOKBACK_DAYS} días)`);
    console.log('[DOG] ════════════════════════════════════════');

    const urls   = this.buildUrls();
    const chunks = Math.ceil(urls.length / CONCURRENCY);

    for (let c = 0; c < chunks; c++) {
      const batch = urls.slice(c * CONCURRENCY, (c + 1) * CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(({ url, fecha }) => this.fetchAndParse(url, fecha))
      );
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        for (const item of r.value) {
          const key = `${item.titulo}|${item.fecha}`;
          if (!vistos.has(key)) vistos.set(key, item);
        }
      }
      if (c % 10 === 0) {
        const diasProcesados = Math.min((c + 1) * CONCURRENCY, urls.length);
        const pct = Math.round((diasProcesados / urls.length) * 100);
        console.log(`[DOG]   ${pct}% procesado (${diasProcesados}/${urls.length} URLs)`);
      }
    }

    const anuncios = Array.from(vistos.values());
    anuncios.forEach(a => {
      console.log(`[DOG]   ${a.fecha} | ${a.titulo.slice(0, 80)}`);
    });

    const duracion_ms = Date.now() - t0;
    console.log('[DOG] ════════════════════════════════════════');
    console.log(`[DOG] Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[DOG] ════════════════════════════════════════');

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
