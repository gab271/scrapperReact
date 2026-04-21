/**
 * debug-dogc.js — Análisis del DOM real del DOGC (Diari Oficial de la Generalitat de Catalunya)
 * Ejecutar: node debug-dogc.js
 *
 * Objetivos:
 *  1. Encontrar el endpoint de búsqueda por texto
 *  2. Ver la estructura HTML de cada resultado
 *  3. Identificar selectores para: títol, data, municipi, enllaç_pdf
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ca,es;q=0.8,en;q=0.6',
};

function fetch(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { ...HEADERS, ...opts.headers },
    };

    const req = lib.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirect = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${u.protocol}//${u.hostname}${res.headers.location}`;
        console.log(`  [→] Redireccionando a: ${redirect}`);
        return fetch(redirect, opts).then(resolve).catch(reject);
      }

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });

    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function preview(html, chars = 3000) {
  return html.slice(0, chars) + (html.length > chars ? `\n... [+${html.length - chars} chars]` : '');
}

function analyzeForm(html) {
  const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || ['', ''])[1];
  const forms = [];
  const formRe = /<form[\s\S]*?<\/form>/gi;
  let m;
  let i = 0;
  while ((m = formRe.exec(html)) && i < 3) {
    forms.push(m[0].slice(0, 1500));
    i++;
  }
  return { title, forms };
}

// Extraer líneas relevantes del HTML que contengan términos farmacia
function extractFarmaLines(html) {
  return html.split('\n').filter(l =>
    /farmàcia|farmacia|oficina de farm|transmiss|titularitat/i.test(l)
  );
}

// ── Función principal ────────────────────────────────────────────────────────
async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log(' DEBUG DOGC — Diari Oficial de la Generalitat de Catalunya');
  console.log('══════════════════════════════════════════════════════════\n');

  // ── PASO 1: Homepage del DOGC ────────────────────────────────
  console.log('📌 PASO 1: Homepage del DOGC');
  const DOGC_HOME = 'https://dogc.gencat.cat/ca/inici/';
  try {
    const r = await fetch(DOGC_HOME);
    console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
    const { title, forms } = analyzeForm(r.body);
    console.log(`  Título: ${title}`);
    console.log(`  Formularios: ${forms.length}`);
    forms.forEach((f, i) => console.log(`\n  [FORM ${i + 1}]:\n${f.slice(0, 1000)}`));
  } catch (e) {
    console.error(`  ❌ ${e.message}`);
  }

  // ── PASO 2: Búsqueda por texto "oficina de farmàcia" ─────────
  console.log('\n\n📌 PASO 2: Búsquedas de texto en el DOGC');

  const DOGC_SEARCH_URLS = [
    // Variantes del buscador del DOGC
    'https://dogc.gencat.cat/ca/pdogc_canals_i_serveis/pdogc_resultats_cerca/?action=fitxa&documentId=&language=ca&newLang=ca&numDiari=&seccion=&paraula_cerca=oficina+de+farm%C3%A0cia&tematica=&tipusTermini=',
    'https://dogc.gencat.cat/ca/pdogc_canals_i_serveis/pdogc_resultats_cerca/?paraula_cerca=oficina+de+farm%C3%A0cia',
    'https://dogc.gencat.cat/ca/pdogc_canals_i_serveis/pdogc_resultats_cerca/?action=fitxa&paraula_cerca=oficina+de+farmacia',
    'https://dogc.gencat.cat/ca/inici/?paraula_cerca=oficina+de+farm%C3%A0cia',
    'https://dogc.gencat.cat/ca/pdogc_canals_i_serveis/cerca-de-publicacions/?paraula=oficina+de+farm%C3%A0cia',
  ];

  for (const url of DOGC_SEARCH_URLS) {
    console.log(`\n  Probando: ${url}`);
    try {
      const r = await fetch(url);
      console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
      if (r.status === 200 && r.body.length > 500) {
        const farmaLines = extractFarmaLines(r.body);
        console.log(`  Líneas con "farmàcia": ${farmaLines.length}`);
        if (farmaLines.length > 0) {
          console.log('  ✅ RESULTADOS ENCONTRADOS:');
          farmaLines.slice(0, 15).forEach(l => console.log('  ' + l.trim().slice(0, 250)));
          console.log('\n  [Extracto HTML]:');
          console.log('  ' + preview(r.body, 3000));
          break;
        } else {
          console.log('  (sin líneas de farmacia — extracto):');
          console.log('  ' + preview(r.body, 800));
        }
      }
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }

  // ── PASO 3: Probar API REST del DOGC ─────────────────────────
  console.log('\n\n📌 PASO 3: Posible API REST del DOGC');

  const DOGC_API_URLS = [
    'https://dogc.gencat.cat/ca/pdogc_canals_i_serveis/pdogc_resultats_cerca/?action=fitxa&paraula_cerca=oficina+de+farm%C3%A0cia&numResults=25&pagina=1',
    'https://dogc.gencat.cat/dogc/rest/search?paraula=oficina+de+farm%C3%A0cia',
    'https://dogc.gencat.cat/api/search?q=oficina+de+farmacia',
  ];

  for (const url of DOGC_API_URLS) {
    console.log(`\n  Probando: ${url}`);
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json, text/html' } });
      console.log(`  Status: ${r.status} | Content-Type: ${r.headers['content-type'] || '?'} | Bytes: ${r.body.length}`);
      if (r.status === 200 && r.body.length > 100) {
        console.log('  ' + preview(r.body, 2000));
      }
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }

  // ── PASO 4: Página de resultados del DOGC (Solr/Elasticsearch?) ──
  console.log('\n\n📌 PASO 4: Analizar el buscador del DOGC en profundidad');
  const DOGC_CERCA = 'https://dogc.gencat.cat/ca/pdogc_canals_i_serveis/pdogc_resultats_cerca/?paraula_cerca=oficina+de+farm%C3%A0cia&numResults=10';
  try {
    const r = await fetch(DOGC_CERCA);
    console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);

    // Buscar patrones clave
    const patterns = [
      { label: 'Links <a href>',        re: /href="[^"]*dogc[^"]*"/gi },
      { label: 'PDF links',             re: /href="[^"]*\.pdf[^"]*"/gi },
      { label: 'Fechas',                re: /\d{2}\/\d{2}\/\d{4}/g },
      { label: 'Data-atributs',         re: /data-[a-z]+="[^"]+"/gi },
      { label: 'Clases CSS resultats',  re: /class="[^"]*resultat[^"]*"/gi },
    ];

    for (const { label, re } of patterns) {
      const matches = (r.body.match(re) || []).slice(0, 10);
      if (matches.length) {
        console.log(`\n  [${label}] (${matches.length} encontrados):`);
        matches.forEach(m => console.log(`    ${m.slice(0, 150)}`));
      }
    }

    // HTML completo (extracto)
    console.log('\n  [Extracto HTML completo]:');
    console.log('  ' + preview(r.body, 4000));

  } catch (e) {
    console.error(`  ❌ ${e.message}`);
  }

  // ── PASO 5: Explorar un documento individual del DOGC ────────
  console.log('\n\n📌 PASO 5: Estructura de documento individual DOGC');
  // URL de ejemplo de un documento conocido del DOGC
  const DOGC_DOC_URLS = [
    'https://dogc.gencat.cat/ca/document-del-dogc/?documentId=1000000',
    'https://dogc.gencat.cat/ca/pdogc_canals_i_serveis/pdogc_resultats_cerca/',
  ];

  for (const url of DOGC_DOC_URLS) {
    console.log(`\n  Probando: ${url}`);
    try {
      const r = await fetch(url);
      console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
      if (r.status === 200 && r.body.length > 500) {
        console.log('  ' + preview(r.body, 2000));
      }
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }

  console.log('\n\n══════════════════════════════════════════════════════════');
  console.log(' FIN DEBUG DOGC');
  console.log('══════════════════════════════════════════════════════════');
}

main().catch(console.error);
