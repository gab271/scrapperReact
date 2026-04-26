import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';

// ─────────────────────────────────────────────────────────────
//  BOCYL — Boletín Oficial de Castilla y León
//
//  Portal: https://bocyl.jcyl.es
//  Estrategia: sesión + POST directo al buscador (sin Puppeteer)
//    1. GET /busquedaCampos.do → extraer JSESSIONID de Set-Cookie
//    2. POST /busquedaCampos;jsessionid=<ID>
//       Campos: titulo=farmacia, page=0, todos los apartados (13-17)
//
//  Estructura de resultados: div#resultadosbusqueda > ul > li.nobullet
//    <dl>
//      <dt>Fecha de publicación:</dt><dd>27/12/2017</dd>
//      <dt class="boletin">Nº de Boletín:</dt><dd>246/2017</dd>
//      <dt>Sección:</dt><dd>...</dd>
//      <dt>Organismo:</dt><dd>...</dd>
//    </dl>
//    <p>Texto completo del anuncio</p>
//    <ul class="descargaBoletin"><li><a href="https://bocyl.jcyl.es/boletines/...pdf">
//
//  Nota: la mayoría de resultados para "farmacia" corresponden a
//  "Farmacia Hospitalaria" (oposiciones). Se filtran con KW_EXCLUIR.
// ─────────────────────────────────────────────────────────────

const BOCYL_BASE   = 'https://bocyl.jcyl.es';
const BOCYL_FORM   = `${BOCYL_BASE}/busquedaCampos.do`;
const BOCYL_SEARCH = `${BOCYL_BASE}/busquedaCampos`;

// Secciones actuales (desde 2017 en adelante)
const APARTADOS_ACTUALES = [
  '13', '13:16', '13:17', '13:18', '13:19', '13:20',
  '14', '15', '16', '17',
];

const KW_ACCION = [
  'transmisión', 'transmision', 'apertura', 'cierre',
  'cambio de titular', 'cambio de titularidad',
  'adjudicación', 'adjudicacion', 'traslado',
  'autorización', 'autorizacion', 'concesión', 'concesion',
  'información pública',
];

const KW_EXCLUIR = [
  'hospitalaria', 'técnico en farmacia', 'tecnico en farmacia',
  'farmacología', 'licenciado especialista',
  'concurso de traslados', 'oposición', 'oposicion',
  'bolsa de trabajo', 'personal estatutario', 'funcionario',
  'enfermería', 'médico',
];

const MUNICIPIOS = [
  'Valladolid', 'Burgos', 'Salamanca', 'León', 'Segovia',
  'Zamora', 'Palencia', 'Ávila', 'Soria', 'Aranda de Duero',
  'Miranda de Ebro', 'Ponferrada', 'San Andrés del Rabanedo',
  'Laguna de Duero', 'Medina del Campo', 'Béjar', 'Astorga',
  'Benavente', 'Ciudad Rodrigo', 'Peñafiel', 'Cuéllar',
];

function esRelevante(titulo: string): boolean {
  const tl = titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (KW_EXCLUIR.some(k => tl.includes(k.normalize('NFD').replace(/[̀-ͯ]/g, '')))) return false;
  return (
    tl.includes('farmacia') &&
    KW_ACCION.some(k => tl.includes(k.normalize('NFD').replace(/[̀-ͯ]/g, '')))
  );
}

function extraerMunicipio(texto: string): string {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(texto);
  for (const m of MUNICIPIOS) if (n.includes(norm(m))) return m;
  const match = texto.match(
    /(?:sita?|ubicada?|situada?|municipio\s+de)\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s-]{3,35}?)(?=[,.]|\s+\()/i,
  );
  return match ? match[1].trim() : 'Castilla y León';
}

export class BocylScraper implements IScraper {
  readonly nombre    = 'BOCYL';
  readonly comunidad = 'Castilla y León';
  readonly keywords  = ['oficina de farmacia'];

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const vistos = new Map<string, AnuncioFarmacia>();

    console.log('[BOCYL] ════════════════════════════════════════');
    console.log('[BOCYL] Iniciando — Castilla y León (BOCYL)');
    console.log('[BOCYL] Estrategia: axios sesión + POST /busquedaCampos (sin Puppeteer)');
    console.log('[BOCYL] ════════════════════════════════════════');

    try {
      // 1. Obtener JSESSIONID
      const initRes = await axios.get(BOCYL_FORM, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
          Accept:       'text/html,application/xhtml+xml',
        },
        responseType: 'text',
        validateStatus: () => true,
        maxRedirects:   5,
      });

      const setCookie = (initRes.headers['set-cookie'] || []).join(';');
      const jsid = setCookie.match(/JSESSIONID=([A-F0-9]+)/)?.[1] || '';

      if (!jsid) {
        const msg = 'No se obtuvo JSESSIONID del BOCYL';
        console.warn(`[BOCYL] ⚠️  ${msg}`);
        advertencias.push(msg);
      } else {
        console.log(`[BOCYL] Sesión: ${jsid.slice(0, 20)}...`);
      }

      // 2. POST con jsessionid en URL path (como requiere el servidor Struts/Java EE)
      const searchUrl = jsid
        ? `${BOCYL_SEARCH};jsessionid=${jsid}`
        : BOCYL_SEARCH;

      // Build URLSearchParams with repeated keys (múltiples apartadosSeleccionados)
      const bodyParts = [
        'page=0',
        'resultadosPorPagina=200',
        'esPortada=false',
        'titulo=farmacia',
        ...APARTADOS_ACTUALES.map(v => `apartadosSeleccionados=${encodeURIComponent(v)}`),
      ];

      const res = await axios.post<string>(searchUrl, bodyParts.join('&'), {
        headers: {
          'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
          Accept:         'text/html,application/xhtml+xml',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer:        BOCYL_FORM,
          Cookie:         jsid ? `JSESSIONID=${jsid}` : '',
        },
        responseType:   'text',
        validateStatus: () => true,
        maxRedirects:   3,
      });

      const $ = cheerio.load(res.data);

      // Check total results
      const totalTxt = $('p.negro').text();
      const totalM   = totalTxt.match(/(\d+)\s+resultados?/i);
      const total    = totalM ? parseInt(totalM[1], 10) : 0;
      console.log(`[BOCYL] Total resultados para "farmacia": ${total || 'desconocido'}`);

      $('li.nobullet').each((_, el) => {
        const $li = $(el);

        // Extract metadata from <dl>
        const $dl    = $li.find('dl').first();
        const fecha  = $dl.find('dd').first().text().trim();
        const boletin = $dl.find('dd.limpiaDer').first().text().trim();

        // Title is in <p> (not inside <dl>)
        const titulo = $li.find('> p').first()
          .text()
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (!titulo || titulo.length < 15) return;
        if (!esRelevante(titulo)) return;

        // PDF link in ul.descargaBoletin
        const pdfHref = $li.find('ul.descargaBoletin a[href*=".pdf"]').first().attr('href') || '';
        const enlace  = pdfHref
          ? (pdfHref.startsWith('http') ? pdfHref : `${BOCYL_BASE}${pdfHref}`)
          : '';

        const key = enlace || `${boletin}|${titulo.slice(0, 60)}`;
        if (vistos.has(key)) return;

        vistos.set(key, {
          titulo:        titulo.slice(0, 350),
          fecha:         fecha || 'Fecha no disponible',
          municipio:     extraerMunicipio(titulo),
          enlace_pdf:    enlace,
          texto_resumen: titulo.slice(0, 500),
          comunidad:     this.comunidad,
          fuente:        this.nombre,
          ...extraerTitulares(titulo),
        });
      });

      if (vistos.size === 0 && total > 0) {
        const msg = `${total} resultados para "farmacia" pero ninguno con keywords de acción en título — la mayoría son oposiciones de Farmacia Hospitalaria`;
        console.log(`[BOCYL] ℹ️  ${msg}`);
        advertencias.push(msg);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BOCYL] ❌ ${msg}`);
      advertencias.push(msg);
    }

    const anuncios    = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    anuncios.forEach(a => console.log(`[BOCYL]   ${a.fecha} | ${a.titulo.slice(0, 80)}`));
    console.log('[BOCYL] ════════════════════════════════════════');
    console.log(`[BOCYL] Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[BOCYL] ════════════════════════════════════════');

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

export const bocylScraper = new BocylScraper();
