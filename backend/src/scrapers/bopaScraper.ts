import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';

// ─────────────────────────────────────────────────────────────
//  BOPA — Boletín Oficial del Principado de Asturias
//
//  Portal: https://miprincipado.asturias.es/bopa
//
//  Estrategia: iterar días hábiles y obtener el sumario de cada
//  edición mediante el portlet Liferay SedeBopaSummaryWeb:
//
//    GET https://miprincipado.asturias.es/bopa/ultimos-boletines
//      ?p_p_id=pa_sede_bopa_web_portlet_SedeBopaSummaryWeb
//      &p_p_lifecycle=0 &p_p_state=normal &p_p_mode=view
//      &_pa_sede_bopa_web_portlet_SedeBopaSummaryWeb_mvcRenderCommandName=%2F
//      &p_r_p_summaryDate=DD%2FMM%2FYYYY
//      &p_r_p_summaryLastBopa=false
//
//  Respuesta: HTML con <div id="bopa-boletin"> que contiene <dl>
//    <dt>Texto completo del título de la disposición</dt>
//    <dd>
//      <a href="...">Texto de la disposición</a>
//      <a href="/bopa/YYYY/MM/DD/YYYY-NNNNN.pdf">PDF</a>
//    </dd>
//
//  Días sin boletín (fines de semana, festivos): devuelve HTML
//  sin #bopa-boletin o con boletin vacío → se ignoran silenciosamente.
// ─────────────────────────────────────────────────────────────

const BOPA_BASE    = 'https://miprincipado.asturias.es';
const BOPA_PORTLET = '/bopa/ultimos-boletines'
  + '?p_p_id=pa_sede_bopa_web_portlet_SedeBopaSummaryWeb'
  + '&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view'
  + '&_pa_sede_bopa_web_portlet_SedeBopaSummaryWeb_mvcRenderCommandName=%2F'
  + '&p_r_p_summaryLastBopa=false';

const LOOKBACK_DAYS = 90;
const CONCURRENCY  = 5;

const KW_ACCION = [
  'transmisión', 'transmision', 'apertura', 'cierre',
  'cambio de titular', 'cambio de titularidad',
  'adjudicación', 'adjudicacion', 'traslado',
  'autorización', 'autorizacion', 'concesión', 'concesion',
  'denegación', 'denegacion', 'caducidad',
];

const MUNICIPIOS = [
  'Oviedo', 'Gijón', 'Avilés', 'Mieres', 'Langreo',
  'San Martín del Rey Aurelio', 'Siero', 'Castrillón',
  'Llanera', 'Cangas del Narcea', 'Tineo', 'Llanes',
  'Villaviciosa', 'Navia', 'Luarca', 'Colunga',
];

// ─────────────────────────────────────────────────────────────

function fmtDdMmYyyy(d: Date): string {
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('%2F');
}

function fmtFechaLeg(d: Date): string {
  const meses = ['enero','febrero','marzo','abril','mayo','junio',
    'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function extraerMunicipio(texto: string): string {
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(texto);
  for (const m of MUNICIPIOS) if (n.includes(norm(m))) return m;
  const match = texto.match(
    /(?:sita?|ubicada?|situada?|municipio\s+de|concejo\s+de)\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s-]{3,30}?)(?=[,.]|\s+\()/i,
  );
  return match ? match[1].trim() : 'Asturias';
}

function esRelevante(titulo: string): boolean {
  const tl = titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return (
    tl.includes('farmacia') &&
    KW_ACCION.some(kw => tl.includes(kw.normalize('NFD').replace(/[̀-ͯ]/g, '')))
  );
}

// ─────────────────────────────────────────────────────────────

export class BopaScraper implements IScraper {
  readonly nombre    = 'BOPA';
  readonly comunidad = 'Asturias';
  readonly keywords  = ['oficina de farmacia'];

  private readonly http = axios.create({
    baseURL: BOPA_BASE,
    timeout: 20_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  });

  private delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

  private async parsearDia(d: Date): Promise<AnuncioFarmacia[]> {
    const dateParam = fmtDdMmYyyy(d);
    const url = `${BOPA_PORTLET}&p_r_p_summaryDate=${dateParam}`;
    const fechaLeg = fmtFechaLeg(d);

    let html: string;
    try {
      const res = await this.http.get<string>(url);
      html = res.data;
    } catch {
      return [];
    }

    const $       = cheerio.load(html);
    const $boletin = $('#bopa-boletin');
    if (!$boletin.length) return [];   // día sin publicación

    const anuncios: AnuncioFarmacia[] = [];

    $boletin.find('dl').each((_, dl) => {
      const $dl  = $(dl);
      const titulo = $dl.find('dt').text().replace(/\s+/g, ' ').trim();
      if (!titulo || !esRelevante(titulo)) return;

      const $dd    = $dl.find('dd');
      const pdfHref = $dd.find('a[href*=".pdf"]').attr('href') ?? '';
      const enlace  = pdfHref.startsWith('http')
        ? pdfHref
        : pdfHref ? `${BOPA_BASE}${pdfHref}` : '';

      anuncios.push({
        titulo:        titulo.slice(0, 350),
        fecha:         fechaLeg,
        municipio:     extraerMunicipio(titulo),
        enlace_pdf:    enlace,
        texto_resumen: titulo.slice(0, 500),
        comunidad:     this.comunidad,
        fuente:        this.nombre,
        ...extraerTitulares(titulo),
      });
    });

    return anuncios;
  }

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const vistos = new Map<string, AnuncioFarmacia>();

    console.log('[BOPA] ════════════════════════════════════════');
    console.log('[BOPA] Iniciando — Principado de Asturias (BOPA)');
    console.log('[BOPA] Estrategia: sumario diario via SedeBopaSummaryWeb portlet');
    console.log(`[BOPA] Cobertura: últimos ${LOOKBACK_DAYS} días`);
    console.log('[BOPA] ════════════════════════════════════════');

    const dias: Date[] = [];
    const hoy = new Date();
    for (let i = 1; i <= LOOKBACK_DAYS; i++) {
      const d = new Date(hoy);
      d.setDate(hoy.getDate() - i);
      // Excluir fines de semana (el BOPA no publica)
      if (d.getDay() !== 0 && d.getDay() !== 6) dias.push(d);
    }

    let procesados = 0;
    const chunks = Math.ceil(dias.length / CONCURRENCY);

    for (let c = 0; c < chunks; c++) {
      const batch = dias.slice(c * CONCURRENCY, (c + 1) * CONCURRENCY);
      const resultados = await Promise.allSettled(
        batch.map(d => this.parsearDia(d)),
      );
      for (const r of resultados) {
        if (r.status !== 'fulfilled') continue;
        for (const a of r.value) {
          const key = a.enlace_pdf || a.titulo.slice(0, 80);
          if (!vistos.has(key)) vistos.set(key, a);
        }
      }
      procesados += batch.length;
      if (c % 5 === 0) {
        console.log(`[BOPA]   ${procesados}/${dias.length} días — ${vistos.size} coincidencias`);
      }
    }

    const anuncios    = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    console.log('[BOPA] ════════════════════════════════════════');
    console.log(`[BOPA] Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[BOPA] ════════════════════════════════════════');

    return {
      comunidad:  this.comunidad,
      total:      anuncios.length,
      anuncios,
      timestamp:  new Date().toISOString(),
      duracion_ms,
      ...(advertencias.length ? { advertencias } : {}),
    };
  }
}

export const bopaScraper = new BopaScraper();
