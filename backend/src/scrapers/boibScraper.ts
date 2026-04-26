import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnuncioFarmacia, IScraper, ScraperResult } from './types';
import { extraerTitulares } from './extractorTitulares';

// ─────────────────────────────────────────────────────────────
//  BOIB — Butlletí Oficial de les Illes Balears
//
//  Portal: https://www.caib.es/eboibfront
//  Estrategia: POST al buscador completo
//    POST https://www.caib.es/eboibfront/cercar
//    Campos: publico=N, lang=ca, texto=<término>, fec_ini, fec_fin
//    Encoding: UTF-8
//
//  Estructura de resultados: ul.llistat > li > div.caja
//    <h4>BOIB Núm X/YYYY de DD/MM/YYYY - Número d'edicte: NNNN</h4>
//    ul.resolucions > li:
//      <p>Organisme</p>
//      <p>Resum (títol de la disposició)</p>
//      <a class="pdf" href="/eboibfront/pdf/VisPdf?action=VisEnviament&idEnviament=XXXX&lang=ca">
//      <a class="html" href="/eboibfront/ca/YYYY/NNNN/XXXX/...">
// ─────────────────────────────────────────────────────────────

const BOIB_BASE   = 'https://www.caib.es';
const BOIB_SEARCH = `${BOIB_BASE}/eboibfront/cercar`;

const KW_ACCION = [
  'transmissió', 'transmisió', 'transmision', 'transmisión',
  'apertura', 'obertura', 'tancament', 'cierre',
  'canvi de titular', 'cambio de titular', 'cambio de titularidad',
  'adjudicació', 'adjudicacion', 'adjudicación',
  'autorització', 'autorizacion', 'autorización',
  'concessió', 'concesion', 'concesión',
  'trasllat', 'traslado',
  'concurs de mèrits', 'concurso de méritos',
];

const KW_EXCLUIR = [
  'hospitalària', 'hospitalaria', 'oposició', 'oposicion',
  'borsa de treball', 'bolsa de trabajo', 'personal estatutari',
  'concurs de trasllats', 'concurso de traslados',
  'farmàcia clínica', 'farmacia clinica',
];

const MUNICIPIOS = [
  'Palma', 'Manacor', 'Calvià', 'Llucmajor', 'Marratxí',
  'Inca', 'Alcúdia', 'Felanitx', 'Sóller', 'Pollença',
  'Andratx', 'Santanyí', 'Eivissa', 'Sant Josep de sa Talaia',
  'Maó', 'Ciutadella de Menorca', 'Binissalem', 'Pina',
  'Sa Pobla', 'Muro', 'Campos', 'Artà', 'Petra',
];

function esRelevante(texto: string): boolean {
  const tl = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (KW_EXCLUIR.some(k => tl.includes(k.normalize('NFD').replace(/[̀-ͯ]/g, '')))) return false;
  return (
    (tl.includes('farmàcia') || tl.includes('farmacia') || tl.includes('oficina')) &&
    KW_ACCION.some(k => tl.includes(k.normalize('NFD').replace(/[̀-ͯ]/g, '')))
  );
}

function extraerMunicipio(texto: string): string {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(texto);
  for (const m of MUNICIPIOS) if (n.includes(norm(m))) return m;
  const match = texto.match(
    /(?:de|de la zona farmacèutica de|al municipi de)\s+([A-ZÁÉÍÓÚÑÀÈÏÒÙÜÇ][A-Za-záéíóúàèïòùüçñ\s'-]{2,35}?)(?=[,.]|\s+\(|\s+i\s)/i,
  );
  return match ? match[1].trim() : 'Illes Balears';
}

function parsearFechaBoib(h4: string): string {
  // "BOIB Núm 70/2023 de 27/05/2023 - Número d'edicte: 5060"
  const m = h4.match(/de\s+(\d{2}\/\d{2}\/\d{4})/);
  return m ? m[1] : '';
}

function fmtDateBoib(d: Date): string {
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export class BoibScraper implements IScraper {
  readonly nombre    = 'BOIB';
  readonly comunidad = 'Illes Balears';
  readonly keywords  = ['oficina de farmàcia', 'oficina de farmacia'];

  private readonly http = axios.create({
    baseURL: BOIB_BASE,
    timeout: 30_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      Accept:       'text/html,application/xhtml+xml',
      Referer:      `${BOIB_BASE}/eboibfront/ca/cerca-completa`,
    },
  });

  async scrape(): Promise<ScraperResult> {
    const t0 = Date.now();
    const advertencias: string[] = [];
    const vistos = new Map<string, AnuncioFarmacia>();

    console.log('[BOIB] ════════════════════════════════════════');
    console.log('[BOIB] Iniciando — Illes Balears (BOIB)');
    console.log('[BOIB] Estrategia: POST buscador /eboibfront/cercar');
    console.log('[BOIB] ════════════════════════════════════════');

    const hoy    = new Date();
    const inicio = new Date();
    inicio.setFullYear(hoy.getFullYear() - 10);

    const terminos = ['oficina de farmàcia', 'farmàcia'];

    for (const termino of terminos) {
      try {
        console.log(`[BOIB] Buscando: "${termino}"`);
        const params = new URLSearchParams({
          publico:  'N',
          lang:     'ca',
          texto:    termino,
          fec_ini:  fmtDateBoib(inicio),
          fec_fin:  fmtDateBoib(hoy),
        });

        const res = await this.http.post<string>(BOIB_SEARCH, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          responseType: 'text',
        });

        const $ = cheerio.load(res.data);

        $('ul.llistat > li').each((_, liEl) => {
          const $li = $(liEl);

          // Header: BOIB Nº and date
          const h4Txt = $li.find('h4').first().text().replace(/\s+/g, ' ').trim();
          const fecha = parsearFechaBoib(h4Txt) || 'Fecha no disponible';

          $li.find('ul.resolucions > li').each((_, resEl) => {
            const $res = $(resEl);

            // First <p> = organism, second <p> = title
            const paras    = $res.find('> p').map((_, p) => $(p).text().replace(/\s+/g, ' ').trim()).get();
            const organisme = paras[0] || '';
            const resum     = paras[1] || '';

            if (!resum || !esRelevante(`${organisme} ${resum}`)) return;

            const $pdfA  = $res.find('a.pdf').first();
            const $htmlA = $res.find('a.html').first();
            const pdfRel  = $pdfA.attr('href') || '';
            const htmlRel = $htmlA.attr('href') || '';
            const enlace  = pdfRel
              ? (pdfRel.startsWith('http') ? pdfRel : `${BOIB_BASE}${pdfRel}`)
              : htmlRel
              ? (htmlRel.startsWith('http') ? htmlRel : `${BOIB_BASE}${htmlRel}`)
              : '';

            const key = enlace || resum.slice(0, 80);
            if (vistos.has(key)) return;

            vistos.set(key, {
              titulo:        resum.slice(0, 350),
              fecha,
              municipio:     extraerMunicipio(`${organisme} ${resum}`),
              enlace_pdf:    enlace,
              texto_resumen: resum.slice(0, 500),
              comunidad:     this.comunidad,
              fuente:        this.nombre,
              ...extraerTitulares(resum),
            });
          });
        });

        console.log(`[BOIB] "${termino}" → ${vistos.size} anuncios hasta ahora`);

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[BOIB] ❌ Error buscando "${termino}": ${msg}`);
        advertencias.push(msg);
      }
    }

    const anuncios    = Array.from(vistos.values());
    const duracion_ms = Date.now() - t0;

    anuncios.forEach(a => console.log(`[BOIB]   ${a.fecha} | ${a.titulo.slice(0, 80)}`));
    console.log('[BOIB] ════════════════════════════════════════');
    console.log(`[BOIB] Finalizado — ${anuncios.length} anuncios (${(duracion_ms / 1000).toFixed(1)}s)`);
    console.log('[BOIB] ════════════════════════════════════════');

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

export const boibScraper = new BoibScraper();
