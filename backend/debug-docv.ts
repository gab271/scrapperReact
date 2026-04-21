/**
 * debug-docv.ts
 * Ejecutar: npx ts-node debug-docv.ts
 *
 * Script de diagnóstico para el portal DOCV (dogv.gva.es).
 * Toma capturas en cada paso y vuelca el HTML renderizado
 * para poder identificar selectores reales sin lanzar el scraper completo.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';

puppeteer.use(StealthPlugin());

const OUT_DIR  = path.resolve(__dirname, '.');   // mismo directorio que el script
const BASE_URL = 'https://dogv.gva.es/es/';
const UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                 '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function shot(label: string) {
  return path.join(OUT_DIR, `debug-docv-${label}.png`);
}

async function delay(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

(async () => {
  console.log('══════════════════════════════════════════════');
  console.log('  DEBUG DOCV — dogv.gva.es con Stealth');
  console.log('══════════════════════════════════════════════');

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--window-size=1920,1080',
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1920, height: 1080 });
  page.setDefaultNavigationTimeout(60_000);
  page.setDefaultTimeout(30_000);

  // ── Capturar respuestas de red ──────────────────────────────
  const networkLog: string[] = [];
  page.on('response', async res => {
    const status = res.status();
    const url    = res.url();
    const type   = res.request().resourceType();
    if (['document', 'xhr', 'fetch'].includes(type)) {
      networkLog.push(`[${status}] ${type.toUpperCase()} ${url.substring(0, 120)}`);
    }
    if (status === 403 || status === 429) {
      console.warn(`  ⚠️  BLOQUEADO ${status}: ${url.substring(0, 100)}`);
    }
  });

  // ── PASO 1: Cargar home ─────────────────────────────────────
  console.log(`\n[1] Navegando a ${BASE_URL} ...`);
  let navOk = false;
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 45_000 });
    navOk = true;
  } catch (e) {
    console.error('  ❌ Timeout / error en goto:', (e as Error).message);
  }

  const title1 = await page.title();
  const url1   = page.url();
  console.log(`  Título: "${title1}"`);
  console.log(`  URL:    ${url1}`);
  await page.screenshot({ path: shot('1-home'), fullPage: true });
  console.log(`  Screenshot → debug-docv-1-home.png`);

  if (!navOk) {
    console.log('\n[!] La navegación inicial falló. Abortando.');
    await browser.close();
    return;
  }

  // ── PASO 2: Cerrar cookies ──────────────────────────────────
  console.log('\n[2] Buscando banner de cookies...');
  const cookieClosed = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a'));
    const btn  = btns.find(b =>
      /aceptar|accept|d'acord|agree|cookie|entendido/i.test(b.textContent ?? '')
    );
    if (btn) { (btn as HTMLElement).click(); return (btn as HTMLElement).textContent?.trim(); }
    return null;
  });
  if (cookieClosed) {
    console.log(`  ✓ Cookie cerrado: "${cookieClosed}"`);
    await delay(800);
  } else {
    console.log('  Sin modal de cookies (o ya aceptado)');
  }

  // ── PASO 3: Detectar inputs en la página ───────────────────
  console.log('\n[3] Analizando inputs disponibles...');
  const inputInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(inp => ({
      type:        inp.type,
      id:          inp.id,
      name:        inp.name,
      placeholder: inp.placeholder,
      className:   inp.className.substring(0, 80),
      visible:     inp.offsetParent !== null,
    }));
  });
  console.log(`  Inputs encontrados: ${inputInfo.length}`);
  inputInfo.forEach((i, idx) =>
    console.log(`    [${idx}] type="${i.type}" id="${i.id}" name="${i.name}" placeholder="${i.placeholder}" visible=${i.visible}`)
  );

  // ── PASO 4: Intentar escribir en el primer input visible ───
  console.log('\n[4] Intentando escribir "oficina de farmacia"...');
  const SELECTORES = [
    'input[name="text"]',
    'input[name="q"]',
    'input[id*="text" i]',
    'input[id*="cerca" i]',
    'input[id*="search" i]',
    'input[placeholder*="cerca" i]',
    'input[placeholder*="busca" i]',
    'input[type="search"]',
    'input[type="text"]:not([hidden])',
  ];

  let selectorUsado: string | null = null;
  for (const sel of SELECTORES) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      const visible = await page.evaluate(
        (e: Element) => (e as HTMLElement).offsetParent !== null, el
      );
      if (!visible) continue;

      await el.click({ clickCount: 3 });
      await page.type(sel, 'oficina de farmacia', { delay: 45 });
      // Disparar eventos Angular/React
      await page.evaluate((s: string) => {
        const inp = document.querySelector(s);
        if (inp) {
          inp.dispatchEvent(new Event('input',  { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, sel);

      selectorUsado = sel;
      console.log(`  ✓ Texto escrito con selector: "${sel}"`);
      break;
    } catch { /* selector no disponible */ }
  }

  if (!selectorUsado) {
    console.warn('  ⚠️  No se encontró ningún input de búsqueda visible');
  }

  await delay(500);
  await page.screenshot({ path: shot('2-typed'), fullPage: true });
  console.log('  Screenshot → debug-docv-2-typed.png');

  // ── PASO 5: Enviar búsqueda ────────────────────────────────
  console.log('\n[5] Enviando búsqueda...');
  let enviado = false;

  // Intentar botón submit
  const BOTONES = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[aria-label*="cerca" i]',
    'button[aria-label*="busca" i]',
    'button[aria-label*="search" i]',
    'button.btn-primary',
    'button.btn-search',
    '[class*="search"] button',
  ];
  for (const sel of BOTONES) {
    const btn = await page.$(sel);
    if (!btn) continue;
    await btn.click();
    console.log(`  ✓ Click en botón: "${sel}"`);
    enviado = true;
    break;
  }

  // Fallback: buscar por texto del botón
  if (!enviado) {
    enviado = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
      const btn  = btns.find(b =>
        /cerca|buscar|search|bilatu/i.test(b.textContent ?? (b as HTMLInputElement).value ?? '')
      );
      if (btn) { (btn as HTMLElement).click(); return true; }
      return false;
    });
    if (enviado) console.log('  ✓ Click por texto del botón');
  }

  // Fallback: Enter en el input
  if (!enviado && selectorUsado) {
    await page.keyboard.press('Enter');
    console.log('  ✓ Enviado con Enter');
    enviado = true;
  }

  if (!enviado) {
    console.warn('  ⚠️  No se pudo enviar la búsqueda');
  }

  // ── PASO 6: Esperar carga de resultados ────────────────────
  console.log('\n[6] Esperando resultados...');
  await delay(2_000);
  try {
    await page.waitForNetworkIdle({ idleTime: 1_500, timeout: 20_000 });
    console.log('  ✓ Red estabilizada');
  } catch {
    console.warn('  ⚠️  Timeout networkidle — la SPA puede seguir cargando');
  }

  // Intentar detectar selectores de resultados conocidos
  const RESULT_SELECTORS = [
    '.lista-resultats', '.lista-resultados',
    'table.lista', 'table.resultats',
    '.resultats', '.results', '.search-results',
    'ul.llista', 'ul.list',
    'app-llista-cerca', 'app-search-results',
    '[class*="resultat"]', '[class*="result"]',
    'article', 'li.item',
  ];

  for (const sel of RESULT_SELECTORS) {
    try {
      await page.waitForSelector(sel, { timeout: 4_000 });
      console.log(`  ✓ Selector de resultados encontrado: "${sel}"`);
      break;
    } catch { /* no existe */ }
  }

  // ── PASO 7: Screenshot de resultados ──────────────────────
  await page.screenshot({ path: shot('3-results'), fullPage: true });
  console.log('\n  Screenshot → debug-docv-3-results.png');

  // ── PASO 8: Análisis del DOM ───────────────────────────────
  console.log('\n[7] Analizando DOM resultante...');
  const urlFinal = page.url();
  const tituloFinal = await page.title();
  console.log(`  URL final:    ${urlFinal}`);
  console.log(`  Título final: "${tituloFinal}"`);

  const domInfo = await page.evaluate(() => {
    const countEls = (sel: string) => document.querySelectorAll(sel).length;
    return {
      links:    countEls('a[href]'),
      tables:   countEls('table'),
      articles: countEls('article'),
      lis:      countEls('li'),
      inputs:   countEls('input'),
      iframes:  countEls('iframe'),
      bodyText: document.body.innerText.substring(0, 800),
    };
  });

  console.log(`  Links: ${domInfo.links}  |  Tablas: ${domInfo.tables}  |  `
    + `Articles: ${domInfo.articles}  |  LIs: ${domInfo.lis}  |  `
    + `Iframes: ${domInfo.iframes}`);

  // Si hay iframes, entrar en cada uno y buscar contenido
  if (domInfo.iframes > 0) {
    console.log('\n[8] Hay iframes — explorando...');
    const frames = page.frames();
    for (const frame of frames) {
      if (frame === page.mainFrame()) continue;
      const frameUrl = frame.url();
      if (!frameUrl || frameUrl === 'about:blank') continue;
      console.log(`  Iframe URL: ${frameUrl}`);
      try {
        const frameText = await frame.evaluate(
          () => document.body?.innerText?.substring(0, 400) ?? '(vacío)'
        );
        console.log(`  Iframe texto: ${frameText.substring(0, 200)}`);
      } catch { console.warn('  ⚠️  No se pudo leer iframe'); }
    }
  }

  // Fragmento del texto visible
  console.log('\n[9] Primeros 800 chars del body:');
  console.log('  ' + domInfo.bodyText.replace(/\n/g, '\n  '));

  // Guardar HTML completo
  const htmlCompleto = await page.content();
  const htmlPath = path.join(OUT_DIR, 'debug-docv-page.html');
  fs.writeFileSync(htmlPath, htmlCompleto, 'utf-8');
  console.log(`\n[10] HTML completo guardado → debug-docv-page.html (${(htmlCompleto.length / 1024).toFixed(1)} KB)`);

  // Resumen de red
  console.log('\n[11] Log de red (document/xhr/fetch):');
  networkLog.slice(0, 25).forEach(l => console.log('  ' + l));
  if (networkLog.length > 25) console.log(`  ... y ${networkLog.length - 25} más`);

  await browser.close();
  console.log('\n══════════════════════════════════════════════');
  console.log('  Debug completado. Revisa los .png y el .html');
  console.log('══════════════════════════════════════════════');
})();
