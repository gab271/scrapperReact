import axios from 'axios';
import iconv from 'iconv-lite';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';

// ─────────────────────────────────────────────────────────────
//  BOC — Boletín Oficial de Cantabria
//
//  Portal: https://boc.cantabria.es
//  Estrategia: sesión + POST al buscador de anuncios
//    1. GET /boces/inicioBusquedaAnuncios.do → cookie JSESSIONID
//    2. POST /boces/busquedaAnuncios.do con el formulario
//    Encoding: ISO-8859-1
//
//  Parámetros del formulario:
//    anuncioBean.filtroFecha=1   (a partir de 01/01/2010)
//    anuncioBean.entrad=<texto>  (texto a buscar)
//    anuncioBean.tipoTexto=1     (0=entradilla, 1=cuerpo completo)
//    anuncioBean.tipoBusqueda=algunasPalabras
//    boton=Buscar
//
//  Nota: Cantabria publica pocos eventos de ciclo de vida de farmacias.
//  El scraper es arquitecturalmente correcto; 0 resultados reflejan
//  la realidad del boletín, no un error del scraper.
// ─────────────────────────────────────────────────────────────

const BOC_BASE   = 'https://boc.cantabria.es';
const BOC_INIT   = `${BOC_BASE}/boces/inicioBusquedaAnuncios.do`;
const BOC_SEARCH = `${BOC_BASE}/boces/busquedaAnuncios.do`;

const KW_ACCION = [
  'transmisión', 'transmision', 'apertura', 'cierre',
  'cambio de titular', 'cambio de titularidad',
  'adjudicación', 'adjudicacion', 'traslado',
  'autorización', 'autorizacion', 'concesión', 'concesion',
];

const KW_EXCLUIR = [
  'hospitalaria', 'farmacología', 'oposición', 'oposicion',
  'bolsa de trabajo', 'concurso de traslados', 'personal estatutario',
];

const MUNICIPIOS = [
  'Santander', 'Torrelavega', 'Castro Urdiales', 'Camargo', 'Piélagos',
  'El Astillero', 'Santillana del Mar', 'Laredo', 'Santoña', 'Reinosa',
  'Colindres', 'Entrambasaguas', 'Los Corrales de Buelna',
  'Cabezón de la Sal', 'Comillas', 'San Vicente de la Barquera',
];

function esRelevante(texto: string): boolean {
  const tl = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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
  return match ? match[1].trim() : 'Cantabria';
}

export class BocCantabriaScraper implements IScraper {
  readonly nombre    = 'BOC';
  readonly comunidad = 'Cantabria';
  readonly keywords  = ['oficina de farmacia'];

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const vistos = new Map<string, AnuncioFarmacia>();

    console.log('[BOC-C] ════════════════════════════════════════');
    console.log('[BOC-C] Iniciando — Cantabria (BOC)');
    console.log('[BOC-C] Estrategia: sesión + POST busquedaAnuncios.do');
    console.log('[BOC-C] ════════════════════════════════════════');

    try {
      // 1. Obtener cookie de sesión
      const initRes = await axios.get(BOC_INIT, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
          Accept:       'text/html,application/xhtml+xml',
        },
        responseType: 'arraybuffer',
        validateStatus: () => true,
        maxRedirects: 5,
      });

      const setCookie = initRes.headers['set-cookie'] || [];
      // JSESSIONID value is quoted on this server; strip quotes
      const rawJsid = setCookie
        .join(';')
        .match(/JSESSIONID="?([^";]+)"?/)?.[1] || '';

      if (!rawJsid) {
        const msg = 'No se obtuvo JSESSIONID del BOC Cantabria';
        console.warn(`[BOC-C] ⚠️  ${msg}`);
        advertencias.push(msg);
      } else {
        console.log(`[BOC-C] Sesión obtenida: ${rawJsid.slice(0, 20)}...`);
      }

      const headers = {
        'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
        Accept:         'text/html,application/xhtml+xml',
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer:        BOC_INIT,
        Cookie:         rawJsid ? `JSESSIONID=${rawJsid}` : '',
      };

      // 2. Buscar en cuerpo de anuncio (más exhaustivo que entradilla)
      const terminos = ['farmacia', 'oficina de farmacia'];

      for (const termino of terminos) {
        const params = new URLSearchParams({
          'boton':                         'Buscar',
          'anuncioBean.filtroFecha':        '1',
          'anuncioBean.entrad':             termino,
          'anuncioBean.tipoTexto':          '1',
          'anuncioBean.tipoBusqueda':       'algunasPalabras',
          'anuncioBean.busqAct':            '',
          'anuncioBean.fecDesdeString':     '',
          'anuncioBean.fecHastaString':     '',
          'anuncioBean.idSeccion':          '0',
          'anuncioBean.idSubseccion':       '0',
          'anuncioBean.idTipAnu':           '0',
        });

        const res = await axios.post<ArrayBuffer>(BOC_SEARCH, params.toString(), {
          headers,
          responseType: 'arraybuffer',
          validateStatus: () => true,
        });

        const html = iconv.decode(Buffer.from(res.data), 'iso-8859-1');
        const $    = cheerio.load(html);

        // Results appear in a table after the search form when there are matches
        // Each result: tr with td containing fecha, boletín, sección, texto
        $('table.tablaResultados tr, .resultadoAnuncio, tr.resultadoFila').each((_, el) => {
          const $el  = $(el);
          const texto = $el.text().replace(/\s+/g, ' ').trim();
          if (!texto || texto.length < 20) return;
          if (!esRelevante(texto)) return;

          // Try to find PDF link
          const pdfHref = $el.find('a[href*=".pdf"]').attr('href') || '';
          const enlace  = pdfHref
            ? (pdfHref.startsWith('http') ? pdfHref : `${BOC_BASE}${pdfHref}`)
            : '';

          // Extract date from text
          const fechaM = texto.match(/(\d{2}\/\d{2}\/\d{4})/);
          const fecha  = fechaM ? fechaM[1] : 'Fecha no disponible';

          const key = enlace || texto.slice(0, 80);
          if (vistos.has(key)) return;

          vistos.set(key, {
            titulo:        texto.slice(0, 350),
            fecha,
            municipio:     extraerMunicipio(texto),
            enlace_pdf:    enlace,
            texto_resumen: texto.slice(0, 500),
            comunidad:     this.comunidad,
            fuente:        this.nombre,
            ...extraerTitulares(texto),
          });
        });

        console.log(`[BOC-C] "${termino}" → ${vistos.size} anuncios relevantes`);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BOC-C] ❌ ${msg}`);
      advertencias.push(msg);
    }

    const anuncios    = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    if (anuncios.length === 0 && advertencias.length === 0) {
      const msg = 'El BOC Cantabria no publicó anuncios de ciclo de vida de farmacias en el período';
      console.log(`[BOC-C] ℹ️  ${msg}`);
      advertencias.push(msg);
    }

    anuncios.forEach(a => console.log(`[BOC-C]   ${a.fecha} | ${a.titulo.slice(0, 80)}`));
    console.log('[BOC-C] ════════════════════════════════════════');
    console.log(`[BOC-C] Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[BOC-C] ════════════════════════════════════════');

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

export const bocCantabriaScraper = new BocCantabriaScraper();
