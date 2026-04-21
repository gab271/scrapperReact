/**
 * debug-docv.js — Diagnóstico DOCV (Diari Oficial Comunitat Valenciana)
 * El portal es una SPA Angular que devuelve 403 a peticiones HTTP directas.
 *
 * Ejecutar desde /backend:
 *   node debug-docv.js
 *
 * Genera:
 *   debug-docv-loaded.png        → captura con el formulario cargado
 *   debug-docv-resultados.png    → captura tras la búsqueda
 *   debug-docv-resultados.html   → HTML completo tras la búsqueda
 */

const puppeteer     = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs            = require('fs');

puppeteer.use(StealthPlugin());

const DOCV_BUSQUEDA = 'https://dogv.gva.es/es/cerca-de-legislacio';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sep(t) { console.log('\n' + '═'.repeat(60) + '\n  ' + t + '\n' + '═'.repeat(60)); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  sep('Lanzando Puppeteer + Stealth para DOCV');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1280, height: 900 });
  page.setDefaultNavigationTimeout(60_000);

  // ── Interceptar llamadas API de Angular ──────────────────
  const apiCalls = [];
  page.on('response', async res => {
    const url  = res.url();
    const type = res.request().resourceType();
    if ((type === 'xhr' || type === 'fetch') && res.status() === 200) {
      try {
        const body = await res.text();
        if (body.length > 100) {
          apiCalls.push({ url, status: res.status(), body: body.substring(0, 600) });
        }
      } catch {}
    }
  });

  try {
    // ── Paso 1: Cargar la SPA ────────────────────────────
    sep('Paso 1: Navegando a la búsqueda DOCV');
    console.log('URL:', DOCV_BUSQUEDA);
    await page.goto(DOCV_BUSQUEDA, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: 'debug-docv-loaded.png', fullPage: true });
    console.log('Screenshot → debug-docv-loaded.png');

    // ── Paso 2: Analizar formulario ──────────────────────
    sep('Paso 2: Análisis del DOM');
    const dom = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
        tag:         el.tagName,
        type:        el.getAttribute('type') || '-',
        name:        el.getAttribute('name') || '-',
        id:          el.getAttribute('id')   || '-',
        placeholder: el.getAttribute('placeholder') || '-',
        class:       el.className.substring(0, 80),
      }));
      const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
        text:  b.innerText.trim().substring(0, 80),
        type:  b.getAttribute('type') || '-',
        class: b.className.substring(0, 80),
        id:    b.id || '-',
      }));
      const bodyText = document.body.innerText.substring(0, 2000);
      return { inputs, buttons, bodyText };
    });

    console.log(`\nInputs (${dom.inputs.length}):`);
    dom.inputs.forEach(i =>
      console.log(`  <${i.tag}> type="${i.type}" id="${i.id}" name="${i.name}" placeholder="${i.placeholder}" class="${i.class}"`)
    );
    console.log(`\nBotones (${dom.buttons.length}):`);
    dom.buttons.forEach(b =>
      console.log(`  text="${b.text}" type="${b.type}" id="${b.id}" class="${b.class}"`)
    );
    console.log('\nTexto visible:\n', dom.bodyText);

    // ── Paso 3: Cerrar cookies si hay modal ──────────────
    sep('Paso 3: Cerrar modal de cookies si existe');
    const cerrado = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      const btn  = btns.find(b => /aceptar|accept|cookie|agree|d\'acord/i.test(b.textContent ?? ''));
      if (btn) { (btn as HTMLElement).click(); return btn.textContent?.trim(); }
      return null;
    });
    console.log(cerrado ? `Cookies cerradas: "${cerrado}"` : 'No se encontró modal de cookies');
    if (cerrado) await delay(800);

    // ── Paso 4: Rellenar formulario ──────────────────────
    sep('Paso 4: Rellenando formulario de búsqueda');

    // Esperar inputs si Angular tarda en renderizar
    try { await page.waitForSelector('input', { timeout: 10_000 }); } catch {}

    const selectorTexto = [
      'input[name="text"]',
      'input[placeholder*="cerca" i]',
      'input[placeholder*="busca" i]',
      'input[placeholder*="text" i]',
      'input[type="search"]',
      'input[type="text"]:first-of-type',
    ];

    let inputSel = null;
    for (const sel of selectorTexto) {
      const found = await page.$(sel);
      if (found) { inputSel = sel; console.log(`Input encontrado: "${sel}"`); break; }
    }

    if (inputSel) {
      const input = await page.$(inputSel);
      await input.click({ clickCount: 3 });
      await page.keyboard.type('oficina de farmacia', { delay: 40 });
      console.log('Texto escrito: "oficina de farmacia"');

      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, inputSel);
      await delay(500);

      // Buscar botón submit
      const selectorBoton = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button.btn-primary',
        'button.btn-search',
      ];
      let botonSel = null;
      for (const sel of selectorBoton) {
        const found = await page.$(sel);
        if (found) { botonSel = sel; console.log(`Botón encontrado: "${sel}"`); break; }
      }
      if (!botonSel) {
        // fallback por texto
        const textoBoton = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const b = btns.find(b => /cerca|buscar|search/i.test(b.textContent ?? ''));
          if (b) { b.click(); return b.textContent?.trim(); }
          return null;
        });
        console.log(textoBoton ? `Botón por texto: "${textoBoton}"` : 'No se encontró botón');
      } else {
        await page.click(botonSel);
        console.log('Click en botón de búsqueda');
      }

      await delay(3000);
      try { await page.waitForNetworkIdle({ idleTime: 1500, timeout: 15_000 }); } catch {}

      await page.screenshot({ path: 'debug-docv-resultados.png', fullPage: true });
      const htmlRes = await page.content();
      fs.writeFileSync('debug-docv-resultados.html', htmlRes, 'utf8');
      console.log(`\nHTML resultados guardado (${htmlRes.length} chars) → debug-docv-resultados.html`);

      // Extraer lo que hay
      const resumen = await page.evaluate(() => {
        const texto = document.body.innerText;
        const lineas = texto.split('\n')
          .map(l => l.trim()).filter(l => l.length > 20)
          .filter(l => /farmacia|farmàcia|transmis|apertura|cierre/i.test(l))
          .slice(0, 20);
        const links = Array.from(document.querySelectorAll('a')).map(a => ({
          text: a.innerText.trim().substring(0, 100),
          href: a.href,
        })).filter(l => l.href.includes('pdf') || /farmaci/i.test(l.text));
        return { lineas, links };
      });
      console.log('\nLíneas con farmacia:', resumen.lineas);
      console.log('\nLinks relevantes:', resumen.links.slice(0, 15));
    } else {
      console.log('⚠️  No se encontró input de búsqueda');
    }

    // ── Paso 5: API calls ─────────────────────────────────
    sep('Paso 5: Llamadas API interceptadas');
    console.log(`Total: ${apiCalls.length}`);
    apiCalls.slice(0, 10).forEach((c, i) =>
      console.log(`\n[${i+1}] ${c.status} ${c.url.substring(0, 120)}\n  ${c.body.substring(0, 300)}`)
    );

  } finally {
    await browser.close();
    sep('Diagnóstico DOCV completado');
    console.log('Archivos: debug-docv-loaded.png / debug-docv-resultados.html');
  }
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
