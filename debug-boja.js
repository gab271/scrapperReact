/**
 * debug-boja.js — Análisis del DOM real del BOJA (Junta de Andalucía)
 * Ejecutar: node debug-boja.js
 *
 * Objetivos:
 *  1. Encontrar el endpoint / forma de búsqueda por texto
 *  2. Ver la estructura HTML de cada resultado
 *  3. Identificar selectores para: título, fecha, municipio, enlace_pdf
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9',
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
      // Seguir redirecciones
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

// Recortar HTML para no saturar la consola
function preview(html, chars = 3000) {
  return html.slice(0, chars) + (html.length > chars ? `\n... [+${html.length - chars} chars]` : '');
}

// Extraer <title> y primeros <form> del HTML
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

// ── Función principal ────────────────────────────────────────────────────────
async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log(' DEBUG BOJA — Boletín Oficial de la Junta de Andalucía');
  console.log('══════════════════════════════════════════════════════════\n');

  // ── PASO 1: Comprobar la homepage del BOJA ───────────────────
  console.log('📌 PASO 1: Homepage del BOJA');
  const BOJA_HOME = 'https://www.juntadeandalucia.es/eboja/';
  try {
    const r = await fetch(BOJA_HOME);
    console.log(`  Status: ${r.status}`);
    const { title, forms } = analyzeForm(r.body);
    console.log(`  Título de página: ${title}`);
    console.log(`  Formularios encontrados: ${forms.length}`);
    forms.forEach((f, i) => {
      console.log(`\n  [FORM ${i + 1}]:\n${f.slice(0, 800)}`);
    });
    console.log('\n  [HEAD de la respuesta]:');
    console.log('  ' + preview(r.body, 2000));
  } catch (e) {
    console.error(`  ❌ Error: ${e.message}`);
  }

  // ── PASO 2: Probar búsqueda por texto en el BOJA ─────────────
  console.log('\n\n📌 PASO 2: Búsqueda "oficina de farmacia" en BOJA');

  const BOJA_SEARCH_URLS = [
    // Variantes conocidas del buscador del BOJA
    'https://www.juntadeandalucia.es/eboja/buscadorBolsas.do?query=oficina+de+farmacia',
    'https://www.juntadeandalucia.es/eboja/busqueda?texto=oficina+de+farmacia',
    'https://www.juntadeandalucia.es/eboja/boletin/buscador?texto=oficina+de+farmacia&desde=&hasta=&tema=&rango=',
    'https://www.juntadeandalucia.es/eboja/buscador?q=oficina+de+farmacia',
    'https://boja.juntadeandalucia.es/boja/buscador?texto=oficina+de+farmacia',
  ];

  for (const url of BOJA_SEARCH_URLS) {
    console.log(`\n  Probando: ${url}`);
    try {
      const r = await fetch(url);
      console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
      if (r.status === 200 && r.body.length > 500) {
        console.log(`  ✅ Respuesta válida — guardando extracto:`);
        console.log('  ' + preview(r.body, 2500));
        break;
      }
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }

  // ── PASO 3: Buscar el endpoint de API del BOJA ───────────────
  console.log('\n\n📌 PASO 3: Explorar endpoint de búsqueda avanzada BOJA');
  const BOJA_API_URLS = [
    'https://www.juntadeandalucia.es/eboja/boletin/busquedaAvanzada?texto=oficina+de+farmacia&desde=01%2F01%2F2024&hasta=31%2F12%2F2025&materia=',
    'https://www.juntadeandalucia.es/eboja/boletines/busquedaBoletinesPortal.do?tipo=D&texto=oficina+de+farmacia',
    'https://www.juntadeandalucia.es/eboja/consultas/busquedaBoletinesPortal.do?texto=oficina+de+farmacia&tipo=D&pagina=1',
  ];

  for (const url of BOJA_API_URLS) {
    console.log(`\n  Probando: ${url}`);
    try {
      const r = await fetch(url);
      console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
      if (r.status === 200 && r.body.length > 300) {
        console.log('  ' + preview(r.body, 2000));
      }
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }

  // ── PASO 4: Buscar un número reciente del BOJA directamente ──
  console.log('\n\n📌 PASO 4: Estructura de un número reciente del BOJA');
  const BOJA_NUMERO = 'https://www.juntadeandalucia.es/eboja/2025/1/';
  try {
    const r = await fetch(BOJA_NUMERO);
    console.log(`  Status: ${r.status}`);
    if (r.status === 200) {
      // Buscar patrones de resoluciones de farmacia
      const lines = r.body.split('\n').filter(l =>
        /farmaci|oficina|resoluci/i.test(l)
      );
      console.log(`  Líneas relevantes (farmacia/resolución): ${lines.length}`);
      lines.slice(0, 20).forEach(l => console.log('  ' + l.trim().slice(0, 200)));
    }
  } catch (e) {
    console.error(`  ❌ Error: ${e.message}`);
  }

  // ── PASO 5: Probar el índice del BOJA por año ────────────────
  console.log('\n\n📌 PASO 5: Índice del BOJA 2025');
  const BOJA_INDEX_URLS = [
    'https://www.juntadeandalucia.es/eboja/2025/',
    'https://www.juntadeandalucia.es/eboja/boletines/2025/',
  ];

  for (const url of BOJA_INDEX_URLS) {
    console.log(`\n  Probando: ${url}`);
    try {
      const r = await fetch(url);
      console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
      if (r.status === 200) {
        console.log('  ' + preview(r.body, 1500));
      }
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }

  console.log('\n\n══════════════════════════════════════════════════════════');
  console.log(' FIN DEBUG BOJA');
  console.log('══════════════════════════════════════════════════════════');
}

main().catch(console.error);
