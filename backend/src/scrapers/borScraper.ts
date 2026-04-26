import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';

// ─────────────────────────────────────────────────────────────
//  BOR — Boletín Oficial de La Rioja
//
//  Portal: https://web.larioja.org/bor-portada/bor
//  Estrategia: GET con ?q=<término> (buscador GNOSS del portal)
//    Resultados renderizados server-side en <li> items.
//
//  Estructura de cada <li>:
//    <h6> → organismo
//    <p><a href="https://ias1.larioja.org/boletin/Bor_Boletin_visor_Servlet?referencia=...">TITULO</a></p>
//    <p>BOR nº 64 - Fecha: 07/04/2026 - <a href="/bor-portada/boranuncio?n=anu-XXXXX">html</a></p>
//    <p class="highlighting">...extracto...</p>
// ─────────────────────────────────────────────────────────────

const BOR_BASE   = 'https://web.larioja.org';
const BOR_SEARCH = `${BOR_BASE}/bor-portada/bor`;

const KW_PRINCIPAL = ['oficina de farmacia', 'farmacia'];
const KW_ACCION = [
  'transmisión', 'transmision', 'apertura', 'cierre',
  'cambio de titular', 'cambio de titularidad',
  'adjudicación', 'adjudicacion', 'traslado',
  'autorización', 'autorizacion', 'concesión', 'concesion',
  'zona farmacéutica', 'zona farmaceutica', 'farmacia rural',
  'autorización de apertura',
];

const KW_EXCLUIR = [
  'hospitalaria', 'facultativo especialista', 'oposición', 'oposicion',
  'bolsa de trabajo', 'concurso de traslados', 'personal estatutario',
  'ciclo formativo', 'técnico en farmacia', 'farmacología',
  'universidad', 'facultad de',
];

const MUNICIPIOS = [
  'Logroño', 'Calahorra', 'Arnedo', 'Alcalá de Ebro', 'Haro',
  'Alfaro', 'Nájera', 'Santo Domingo de la Calzada', 'Ezcaray',
  'Cervera del Río Alhama', 'Albelda de Iregua', 'Lardero',
  'Villanueva de Cameros', 'Ortigosa de Cameros', 'Yanguas',
];

function esRelevante(titulo: string): boolean {
  const tl = titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (KW_EXCLUIR.some(k => tl.includes(k.normalize('NFD').replace(/[̀-ͯ]/g, '')))) return false;
  return (
    KW_PRINCIPAL.some(k => tl.includes(k.normalize('NFD').replace(/[̀-ͯ]/g, ''))) &&
    KW_ACCION.some(k => tl.includes(k.normalize('NFD').replace(/[̀-ͯ]/g, '')))
  );
}

function extraerMunicipio(texto: string): string {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(texto);
  for (const m of MUNICIPIOS) if (n.includes(norm(m))) return m;
  const match = texto.match(
    /(?:sita?|ubicada?|situada?|localidad\s+de|municipio\s+de)\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s-]{3,35}?)(?=[,.]|\s+\()/i,
  );
  return match ? match[1].trim() : 'La Rioja';
}

function parsearFecha(txt: string): string {
  // "BOR nº 64 - Fecha: 07/04/2026"
  const m = txt.match(/Fecha:\s*(\d{2}\/\d{2}\/\d{4})/);
  return m ? m[1] : '';
}

export class BorScraper implements IScraper {
  readonly nombre    = 'BOR';
  readonly comunidad = 'La Rioja';
  readonly keywords  = ['oficina de farmacia'];

  private readonly http = axios.create({
    baseURL: BOR_BASE,
    timeout: 30_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      Accept:       'text/html,application/xhtml+xml',
    },
  });

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const vistos = new Map<string, AnuncioFarmacia>();

    console.log('[BOR]  ════════════════════════════════════════');
    console.log('[BOR]  Iniciando — La Rioja (BOR)');
    console.log('[BOR]  Estrategia: GET buscador GNOSS ?q=farmacia');
    console.log('[BOR]  ════════════════════════════════════════');

    const terminos = ['farmacia', 'oficina de farmacia'];

    for (const termino of terminos) {
      try {
        console.log(`[BOR]  Buscando: "${termino}"`);
        const res = await this.http.get<string>(BOR_SEARCH, {
          params: { q: termino },
          responseType: 'text',
        });

        const html = res.data;
        const $    = cheerio.load(html);

        // Results are in <li> elements inside the main content area
        // Each li has: h6 (org), p > a (title + pdf), p (date), p.highlighting (excerpt)
        $('li').each((_, el) => {
          const $li = $(el);

          const $h6     = $li.find('h6').first();
          const organismo = $h6.text().trim();
          if (!organismo) return;

          // Title anchor — links to ias1.larioja.org PDF/visor
          const $titleA  = $li.find('p > a').not('.btn').first();
          const titulo   = $titleA.text().replace(/\s+/g, ' ').trim();
          const pdfHref  = $titleA.attr('href') || '';

          if (!titulo || titulo.length < 15) return;
          if (!esRelevante(`${organismo} ${titulo}`)) return;

          // Date: "BOR nº 64 - Fecha: 07/04/2026"
          const $metaP = $li.find('p').filter((_, p) => /BOR\s+nº/i.test($(p).text())).first();
          const fecha  = parsearFecha($metaP.text()) || 'Fecha no disponible';

          // HTML alternate link
          const $htmlA  = $metaP.find('a.btn').first();
          const htmlHref = $htmlA.attr('href') || '';
          const enlacePdf = pdfHref.startsWith('http') ? pdfHref : pdfHref ? `${BOR_BASE}${pdfHref}` : '';

          // Excerpt
          const excerpt = $li.find('p.highlighting').text().replace(/\s+/g, ' ').trim().slice(0, 500);

          const key = enlacePdf || titulo.slice(0, 80);
          if (vistos.has(key)) return;

          vistos.set(key, {
            titulo:        titulo.slice(0, 350),
            fecha,
            municipio:     extraerMunicipio(`${titulo} ${excerpt}`),
            enlace_pdf:    enlacePdf || (htmlHref ? `${BOR_BASE}${htmlHref}` : ''),
            texto_resumen: excerpt || titulo.slice(0, 500),
            comunidad:     this.comunidad,
            fuente:        this.nombre,
            ...extraerTitulares(`${titulo} ${excerpt}`),
          });
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[BOR]  ❌ Error buscando "${termino}": ${msg}`);
        advertencias.push(msg);
      }
    }

    const anuncios    = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    anuncios.forEach(a => console.log(`[BOR]    ${a.fecha} | ${a.titulo.slice(0, 80)}`));
    console.log(`[BOR]  ════════════════════════════════════════`);
    console.log(`[BOR]  Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log(`[BOR]  ════════════════════════════════════════`);

    if (anuncios.length === 0 && advertencias.length === 0) {
      const msg = 'El BOR no publicó anuncios de ciclo de vida de farmacias en el período consultado';
      console.log(`[BOR]  ℹ️  ${msg}`);
      advertencias.push(msg);
    }

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

export const borScraper = new BorScraper();
