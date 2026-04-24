import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';

// ─────────────────────────────────────────────────────────────
//  BON — Boletín Oficial de Navarra
//
//  Portal: https://bon.navarra.es
//
//  Estrategia: POST al portlet Liferay BuscadorPortlet
//    POST https://bon.navarra.es/es/busquedas
//      ?p_p_id=es_navarra_bon_buscador_portlet_BuscadorPortlet
//      &p_p_lifecycle=0 &p_p_state=normal &p_p_mode=view
//      &_...BuscadorPortlet_mvcRenderCommandName=buscar
//    Form body:
//      _...BuscadorPortlet_contenido=oficina+de+farmacia
//      _...BuscadorPortlet_tipoRangoFechas=false
//      _...BuscadorPortlet_rangoFechas=6   (últimos N meses — ver select)
//
//  Respuesta HTML:
//    "Se han encontrado 200 resultados"
//    Cada resultado: tr[data-qa-id="row"] > td > a
//      <a href="https://bon.navarra.es/es/anuncio/-/texto/YYYY/NUM/IDX"
//         title="BOLETÍN Nº XX - DD de mes de YYYY">
//        <h2 class="h2-arrow">BOLETÍN Nº XX - DD de mes de YYYY</h2>
//        <div class="buscador-res-content">
//          <h3>Sección</h3><h4>Organismo</h4>
//          <p>Descripción del anuncio</p>
//        </div>
//      </a>
//    Paginación: .pagination-bar, 20 por página
// ─────────────────────────────────────────────────────────────

const BON_BASE = 'https://bon.navarra.es';
const NS       = '_es_navarra_bon_buscador_portlet_BuscadorPortlet_';

// URL del portlet con mvcRenderCommandName=buscar en la querystring
const BON_SEARCH = BON_BASE
  + `/es/busquedas?p_p_id=es_navarra_bon_buscador_portlet_BuscadorPortlet`
  + `&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view`
  + `&${NS}mvcRenderCommandName=buscar`;

// rangoFechas=6 = "Últimos 6 meses" (opción más amplia sin requerir fechas concretas)
const RANGE_VALUE = '6';

const KW_ACCION = [
  'transmisión', 'transmision', 'apertura', 'cierre',
  'cambio de titular', 'cambio de titularidad',
  'adjudicación', 'adjudicacion', 'traslado',
  'autorización', 'autorizacion', 'concesión', 'concesion',
  'denegación', 'denegacion', 'caducidad',
];

const MUNICIPIOS = [
  'Pamplona', 'Tudela', 'Barañáin', 'Burlada', 'Estella',
  'Berriozar', 'Sarriguren', 'Zizur Mayor', 'Noáin', 'Ansoáin',
  'Tafalla', 'Sangüesa', 'Cintruénigo', 'Alsasua', 'Olite',
];

// ─────────────────────────────────────────────────────────────

function parsearFechaDeTitulo(raw: string): string {
  // "BOLETÍN Nº 91 - 29 de julio de 1996" → "29 de julio de 1996"
  const m = raw.match(/(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i);
  return m ? m[1] : raw;
}

function extraerMunicipio(texto: string): string {
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(texto);
  for (const m of MUNICIPIOS) if (n.includes(norm(m))) return m;
  const match = texto.match(
    /(?:sita?|ubicada?|situada?|municipio\s+de)\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s-]{3,30}?)(?=[,.]|\s+\()/i,
  );
  return match ? match[1].trim() : 'Navarra';
}

function esRelevante(texto: string): boolean {
  const tl = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return (
    tl.includes('farmacia') &&
    KW_ACCION.some(kw => tl.includes(kw.normalize('NFD').replace(/[̀-ͯ]/g, '')))
  );
}

// ─────────────────────────────────────────────────────────────

export class BonScraper implements IScraper {
  readonly nombre    = 'BON';
  readonly comunidad = 'Navarra';
  readonly keywords  = ['oficina de farmacia'];

  private readonly http = axios.create({
    baseURL: BON_BASE,
    timeout: 25_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    maxRedirects: 5,
  });

  private delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

  // Liferay: el sort por fecha solo funciona en GET (no en POST).
  // Primera petición: POST para registrar la búsqueda en sesión.
  // Siguientes páginas / sort: GET con todos los parámetros en URL.
  private buildParams(termino: string, pagina: number): Record<string, string> {
    return {
      [`${NS}mvcRenderCommandName`]: 'buscar',
      [`${NS}contenido`]:            termino,
      [`${NS}tipoRangoFechas`]:      'false',
      [`${NS}rangoFechas`]:          RANGE_VALUE,
      [`${NS}ordenarPorFechas`]:     'true',
      [`${NS}cur`]:                  String(pagina),
    };
  }

  private parsearResultados(html: string): { anuncios: AnuncioFarmacia[]; total: number } {
    const $       = cheerio.load(html);
    const anuncios: AnuncioFarmacia[] = [];

    // Total de resultados
    const totalTxt = $('.resultados-busqueda-total strong').first().text().trim();
    const total    = parseInt(totalTxt, 10) || 0;

    const anioMin = new Date().getFullYear() - 2;  // solo últimos 2 años

    // Cada fila de resultado
    $('tr[data-qa-id="row"]').each((_, row) => {
      const $a    = $(row).find('a[href*="/anuncio/-/texto/"]').first();
      if (!$a.length) return;

      const href   = $a.attr('href') ?? '';

      // El año está embebido en la URL: /es/anuncio/-/texto/YYYY/NUM/IDX
      const anioHref = parseInt((href.match(/\/texto\/(\d{4})\//) ?? [])[1] ?? '0', 10);
      if (anioHref > 0 && anioHref < anioMin) return;  // filtrar histórico

      const titleAttr   = $a.attr('title') ?? '';           // "BOLETÍN Nº 91 - 29 de julio de 1996"
      const descripcion = $a.find('.buscador-res-content p').text().replace(/\s+/g, ' ').trim();
      const seccion     = $a.find('.buscador-res-content h3').text().trim();
      const organismo   = $a.find('.buscador-res-content h4').text().trim();

      const textoCompleto = `${descripcion} ${titleAttr} ${organismo}`.trim();
      if (!esRelevante(textoCompleto)) return;

      const enlace = href.startsWith('http') ? href : href ? `${BON_BASE}${href}` : '';

      const titulo = [organismo, descripcion].filter(Boolean).join(' — ') || titleAttr;

      anuncios.push({
        titulo:        titulo.slice(0, 350),
        fecha:         parsearFechaDeTitulo(titleAttr),
        municipio:     extraerMunicipio(textoCompleto),
        enlace_pdf:    enlace,
        texto_resumen: [seccion, organismo, descripcion].filter(Boolean).join(' | ').slice(0, 500),
        comunidad:     this.comunidad,
        fuente:        this.nombre,
        ...extraerTitulares(titulo),
      });
    });

    return { anuncios, total };
  }

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const vistos = new Map<string, AnuncioFarmacia>();

    console.log('[BON] ════════════════════════════════════════');
    console.log('[BON] Iniciando — Navarra (BON)');
    console.log('[BON] Estrategia: GET BuscadorPortlet (sort por fecha)');
    console.log('[BON] ════════════════════════════════════════');

    const terminos = ['oficina de farmacia', 'farmacia'];

    for (const termino of terminos) {
      try {
        console.log(`[BON] Buscando: "${termino}"...`);
        let pagina = 1;
        let totalPaginas = 1;

        do {
          await this.delay(400);
          const res = await this.http.get<string>(BON_SEARCH, {
            params: this.buildParams(termino, pagina),
          });
          const { anuncios, total } = this.parsearResultados(res.data);

          if (total > 0 && pagina === 1) {
            totalPaginas = Math.min(Math.ceil(total / 20), 10); // máx 10 páginas
            console.log(`[BON]   Total: ${total} resultados (${totalPaginas} páginas)`);
          }

          for (const a of anuncios) {
            const key = a.enlace_pdf || a.titulo.slice(0, 80);
            if (!vistos.has(key)) vistos.set(key, a);
          }
          console.log(`[BON]   Pág ${pagina}/${totalPaginas}: ${anuncios.length} relevantes`);

          pagina++;
        } while (pagina <= totalPaginas);

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[BON] ❌ "${termino}": ${msg}`);
        advertencias.push(msg);
      }
    }

    const anuncios    = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    console.log('[BON] ════════════════════════════════════════');
    console.log(`[BON] Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[BON] ════════════════════════════════════════');

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

export const bonScraper = new BonScraper();
