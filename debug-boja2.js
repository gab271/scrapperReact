/**
 * debug-boja2.js — Análisis quirúrgico del DOM del BOJA
 * Objetivo: leer un número real y ver la estructura HTML de sus entradas
 */
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9',
};

function fetch(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: HEADERS,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${u.protocol}//${u.hostname}${res.headers.location}`;
        return fetch(loc).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('══ DEBUG BOJA2 — Análisis de número individual ══\n');

  // ── PASO 1: Página principal — extraer links a números del BOJA ─────────
  console.log('📌 PASO 1: Extraer links a números del BOJA desde la homepage');
  const home = await fetch('https://www.juntadeandalucia.es/eboja/');

  // Links con patrón /eboja/YYYY/NNN/ o /eboja/boletines/YYYY/NNN/
  const linkRe = /href="([^"]*\/eboja\/[^"]+)"/gi;
  const links = new Set();
  let m;
  while ((m = linkRe.exec(home.body))) links.add(m[1]);

  console.log(`  Links encontrados al BOJA: ${links.size}`);
  [...links].slice(0, 20).forEach(l => console.log(`  ${l}`));

  // ── PASO 2: Extraer el link al último número ─────────────────────────────
  console.log('\n📌 PASO 2: Patrón de links al último número');
  // Buscar el patrón de link de número de boletín
  const boletinRe = /href="([^"]*eboja[^"]*(?:boletin|numero|BOJA)[^"]*\d+[^"]*)"/gi;
  const boletinLinks = new Set();
  while ((m = boletinRe.exec(home.body))) boletinLinks.add(m[1]);
  console.log(`  Links de boletín: ${boletinLinks.size}`);
  [...boletinLinks].slice(0, 10).forEach(l => console.log(`  ${l}`));

  // Extracto del HTML central de la homepage donde aparecen los boletines recientes
  const mainSection = home.body.match(/(?:boletines?|ultimos|recientes)[\s\S]{0,5000}/i);
  if (mainSection) {
    console.log('\n  Sección de boletines recientes:');
    console.log('  ' + mainSection[0].slice(0, 2000));
  }

  // ── PASO 3: Leer el número 1 de 2025 para ver estructura ───────────────
  console.log('\n📌 PASO 3: Leer BOJA 2025/1 y analizar estructura');
  const r3 = await fetch('https://www.juntadeandalucia.es/eboja/2025/1/');
  console.log(`  Status: ${r3.status} | Bytes: ${r3.body.length}`);

  if (r3.status === 200) {
    // Extracto completo del HTML para analizar la estructura
    console.log('\n  [Primeros 5000 chars del HTML]:');
    console.log(r3.body.slice(0, 5000));

    // Buscar todos los <p> con texto
    const pRe = /<p[^>]*>([^<]{30,500})<\/p>/gi;
    const pTags = [];
    while ((m = pRe.exec(r3.body))) {
      if (!/css|font|color|margin|padding|width/i.test(m[1])) {
        pTags.push(m[1].replace(/\s+/g, ' ').trim());
      }
    }
    console.log(`\n  Parrafos <p> con contenido relevante: ${pTags.length}`);
    pTags.slice(0, 30).forEach((p, i) => console.log(`  [${i+1}] ${p.slice(0, 200)}`));

    // Buscar links a PDFs
    const pdfRe = /href="([^"]*\.pdf[^"]*)"/gi;
    const pdfs = new Set();
    while ((m = pdfRe.exec(r3.body))) pdfs.add(m[1]);
    console.log(`\n  Links a PDFs: ${pdfs.size}`);
    [...pdfs].slice(0, 10).forEach(p => console.log(`  ${p}`));

    // Buscar estructura de cada disposición/resolución
    const resolRe = /<li[^>]*>[\s\S]{50,2000}?<\/li>/gi;
    const liItems = [];
    while ((m = resolRe.exec(r3.body)) && liItems.length < 5) {
      const text = m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (/farmaci|resoluc|disposici/i.test(text) || liItems.length < 3) {
        liItems.push(m[0].slice(0, 800));
      }
    }
    console.log(`\n  Ejemplos de <li> (resoluciones):`)
    liItems.forEach((li, i) => {
      console.log(`\n  [LI ${i+1}]:`);
      console.log('  ' + li);
    });
  }

  // ── PASO 4: Buscar el buscador real del BOJA ─────────────────────────────
  console.log('\n\n📌 PASO 4: Buscar endpoint de búsqueda en el HTML de la homepage');
  // El BOJA tiene un formulario de búsqueda — ¿a qué URL envía?
  const formActionRe = /action="([^"]+)"/gi;
  const actions = new Set();
  while ((m = formActionRe.exec(home.body))) actions.add(m[1]);
  console.log('  Form actions encontradas:');
  [...actions].forEach(a => console.log(`  ${a}`));

  // Buscar fetch/XHR/ajax en los scripts inline
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  const scripts = [];
  while ((m = scriptRe.exec(home.body)) && scripts.length < 5) {
    if (/ajax|fetch|xhr|url|endpoint|search|busca/i.test(m[1])) {
      scripts.push(m[1].slice(0, 1000));
    }
  }
  console.log(`\n  Scripts con lógica de búsqueda: ${scripts.length}`);
  scripts.forEach((s, i) => {
    console.log(`\n  [SCRIPT ${i+1}]:`);
    console.log('  ' + s.slice(0, 500));
  });

  // ── PASO 5: Probar búsqueda oficial de la Junta ──────────────────────────
  console.log('\n\n📌 PASO 5: Probar el buscador de la Junta con filtro BOJA');
  const searchUrls = [
    'https://www.juntadeandalucia.es/buscar.html?busquedageneral=oficina+de+farmacia&organismo=jda',
    'https://www.juntadeandalucia.es/eboja/boletin/busqueda?texto=oficina+de+farmacia',
    'https://www.juntadeandalucia.es/eboja/boletines/buscar?q=oficina+de+farmacia',
  ];

  for (const url of searchUrls) {
    console.log(`\n  Probando: ${url}`);
    try {
      const r = await fetch(url);
      console.log(`  Status: ${r.status} | Bytes: ${r.body.length}`);
      if (r.status === 200 && r.body.length > 1000) {
        // Buscar líneas de farmacia
        const farmaLines = r.body.split('\n').filter(l => /farmaci|oficina/i.test(l));
        console.log(`  Líneas con farmacia: ${farmaLines.length}`);
        if (farmaLines.length > 0) {
          farmaLines.slice(0, 10).forEach(l => console.log('  ' + l.trim().slice(0, 200)));
        }
        console.log('\n  Extracto:');
        console.log('  ' + r.body.slice(0, 2000));
      }
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }

  // ── PASO 6: Leer un número reciente de 2026 ─────────────────────────────
  console.log('\n\n📌 PASO 6: Leer números recientes del BOJA 2026');
  for (let n = 75; n >= 70; n--) {
    const url = `https://www.juntadeandalucia.es/eboja/2026/${n}/`;
    try {
      const r = await fetch(url);
      if (r.status === 200 && r.body.length > 1000) {
        const hasText = /Resoluci[oó]n|Orden|Decreto/i.test(r.body);
        console.log(`  BOJA 2026/${n}: OK (${r.body.length} bytes) — ¿Tiene resoluciones? ${hasText}`);
        if (hasText) {
          // Mostrar las primeras resoluciones de este número
          const pTags = [];
          const pRe2 = /<p[^>]*>([^<]{30,500})<\/p>/gi;
          let m2;
          while ((m2 = pRe2.exec(r.body))) {
            const t = m2[1].replace(/\s+/g, ' ').trim();
            if (!/css|style|margin/i.test(t)) pTags.push(t);
          }
          console.log(`  Párrafos con texto: ${pTags.length}`);
          pTags.slice(0, 15).forEach(p => console.log(`    → ${p.slice(0, 180)}`));

          // Líneas específicas de farmacia
          const farmaLines = r.body.split('\n').filter(l => /farmaci|oficina de farmacia/i.test(l));
          console.log(`  Líneas con "farmacia": ${farmaLines.length}`);
          farmaLines.slice(0, 5).forEach(l => console.log('    ' + l.trim().slice(0, 200)));

          // Ver estructura HTML de este número (primeros 3000 chars del body)
          console.log('\n  HTML del número (primeros 3000):');
          console.log(r.body.slice(0, 3000));
          break;
        }
      } else {
        console.log(`  BOJA 2026/${n}: ${r.status}`);
      }
    } catch (e) {
      console.log(`  BOJA 2026/${n}: ❌ ${e.message}`);
    }
  }

  console.log('\n══ FIN DEBUG BOJA2 ══');
}

main().catch(console.error);
