/**
 * debug-dogc2.js — Análisis profundo del DOGC
 * El DOGC usa un buscador JS. Vamos a explorar la API de búsqueda HTTP.
 */
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ca,es;q=0.8,en;q=0.6',
  'Referer': 'https://dogc.gencat.cat/',
};

function fetch(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { ...HEADERS, ...opts.headers },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${u.protocol}//${u.hostname}${res.headers.location}`;
        return fetch(loc, opts).then(resolve).catch(reject);
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
    req.end();
  });
}

async function main() {
  console.log('══ DEBUG DOGC2 — Búsqueda de la API del buscador ══\n');

  // ── PASO 1: Ver entorn_config.js del DOGC (puede contener URLs de API) ──
  console.log('📌 PASO 1: Leer entorn_config.js (configuración del entorno)');
  try {
    const r = await fetch('https://dogc.gencat.cat/web/resources/fwkResponsives/common/js/entorn_config.js');
    console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
    if (r.status === 200) console.log(r.body);
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
  }

  // ── PASO 2: Ver la URL del sumari del últim DOGC publicat ───────────────
  console.log('\n📌 PASO 2: Ver el sumari del darrer DOGC publicat');
  try {
    const r = await fetch('https://dogc.gencat.cat/ca/inici/index.html');
    console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
    // Buscar en el HTML las URLs de fetch/ajax que usa el DOGC para buscar
    const urlsInJs = [];
    const urlRe = /'(https?:\/\/[^']+)'|"(https?:\/\/[^"]+)"/g;
    let m;
    while ((m = urlRe.exec(r.body))) {
      const url = (m[1] || m[2]);
      if (/dogc|gencat|search|busca|api|rest/i.test(url)) {
        urlsInJs.push(url);
      }
    }
    console.log(`  URLs en el HTML: ${urlsInJs.length}`);
    [...new Set(urlsInJs)].forEach(u => console.log(`  ${u}`));

    // Buscar módulos JS incluidos
    const scriptSrcRe = /src="([^"]+\.js[^"]*)"/gi;
    const scripts = new Set();
    while ((m = scriptSrcRe.exec(r.body))) scripts.add(m[1]);
    console.log(`\n  Scripts cargados (${scripts.size}):`);
    [...scripts].forEach(s => console.log(`  ${s}`));
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
  }

  // ── PASO 3: Probar la API del sumari del DOGC ───────────────────────────
  console.log('\n📌 PASO 3: API del sumari/sumaris del DOGC');
  const apiUrls = [
    // API conocida del DOGC para buscar sumaris
    'https://dogc.gencat.cat/web/system/modules/cat.gencat.wcmResponsive.formatters.httpFetch/resources/fpca_sumari_ultim_DOGC_publicat/json/sumari.json',
    'https://dogc.gencat.cat/dogc/web/resources/json/sumari.json',
    // Servicio REST del DOGC
    'https://portaldogc.gencat.cat/utilsEADOP/AppJava/consultaDiari/getDiariActual.do',
    'https://portaldogc.gencat.cat/utilsEADOP/AppJava/search/searchDiari.do?op=consultaDiari&paraula=oficina+de+farm%C3%A0cia',
    'https://portaldogc.gencat.cat/utilsEADOP/AppJava/search/searchDiari.do?op=search&texto=oficina+de+farmacia',
    // API REST documentada del DOGC
    'https://dogc.gencat.cat/api/dogc/search?paraula=oficina+de+farm%C3%A0cia',
  ];

  for (const url of apiUrls) {
    console.log(`\n  Probando: ${url}`);
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json, text/html' } });
      console.log(`  Status: ${r.status} | CT: ${r.headers['content-type']} | Bytes: ${r.body.length}`);
      if (r.status === 200 && r.body.length > 100) {
        console.log('  ' + r.body.slice(0, 2000));
      }
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }

  // ── PASO 4: Explorar el portal EADOP ───────────────────────────────────
  console.log('\n📌 PASO 4: Portal EADOP (repositorio oficial del DOGC)');
  const eadopUrls = [
    'https://portaldogc.gencat.cat/utilsEADOP/AppJava/consultaDiari/index.do',
    'https://portaldogc.gencat.cat/utilsEADOP/AppJava/search/index.do',
    'https://portaldogc.gencat.cat/utilsEADOP/AppJava/search/searchDiari.do?op=search&texto=oficina+de+farm%C3%A0cia&rangDates=ultims30dies',
  ];

  for (const url of eadopUrls) {
    console.log(`\n  Probando: ${url}`);
    try {
      const r = await fetch(url);
      console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
      if (r.status === 200 && r.body.length > 500) {
        const farmaLines = r.body.split('\n').filter(l => /farmàcia|farmacia|oficina/i.test(l));
        console.log(`  Líneas farmacia: ${farmaLines.length}`);
        farmaLines.slice(0, 10).forEach(l => console.log('  ' + l.trim().slice(0, 200)));
        if (farmaLines.length > 0) {
          console.log('\n  [Extracto HTML]:');
          console.log(r.body.slice(0, 3000));
        } else {
          console.log('  Extracto: ' + r.body.slice(0, 500));
        }
      }
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }

  // ── PASO 5: Buscar por número del DOGC ─────────────────────────────────
  console.log('\n📌 PASO 5: Leer un número del DOGC directamente');
  const dogcIssueUrls = [
    'https://dogc.gencat.cat/ca/sumari-del-dogc/?numDiari=9109',
    'https://dogc.gencat.cat/ca/sumari-del-dogc/',
    'https://dogc.gencat.cat/ca/inici/index.html',
  ];

  for (const url of dogcIssueUrls) {
    console.log(`\n  Probando: ${url}`);
    try {
      const r = await fetch(url);
      console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
      if (r.status === 200 && r.body.length > 1000) {
        // Buscar URLs de API en el HTML
        const apiCalls = [];
        const fetchRe = /(?:fetch|ajax|XMLHttpRequest|url\s*[:=])\s*['"`]([^'"`]+)['"`]/gi;
        let m;
        while ((m = fetchRe.exec(r.body))) {
          apiCalls.push(m[1]);
        }
        console.log(`  Llamadas fetch/ajax encontradas: ${apiCalls.length}`);
        apiCalls.slice(0, 15).forEach(u => console.log(`  ${u}`));

        // Buscar JSON inline
        const jsonRe = /(?:data|config|settings)\s*=\s*(\{[^;]{50,500})/gi;
        while ((m = jsonRe.exec(r.body))) {
          console.log('\n  JSON inline: ' + m[1].slice(0, 300));
        }

        // Primeros 3000 chars
        console.log('\n  HTML extracto:');
        console.log(r.body.slice(0, 3000));
      }
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }

  // ── PASO 6: Probar la búsqueda via formulario POST ──────────────────────
  console.log('\n📌 PASO 6: POST de búsqueda al DOGC');
  const postUrls = [
    {
      url: 'https://portaldogc.gencat.cat/utilsEADOP/AppJava/search/searchDiari.do',
      body: 'op=search&texto=oficina+de+farm%C3%A0cia&rangDates=ultims30dies',
    },
  ];

  for (const { url, body } of postUrls) {
    console.log(`\n  POST a: ${url}`);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body).toString(),
        },
        body,
      });
      console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
      if (r.status === 200) console.log('  ' + r.body.slice(0, 2000));
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }

  console.log('\n══ FIN DEBUG DOGC2 ══');
}

main().catch(console.error);
