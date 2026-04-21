/**
 * debug-boa.js — v2: BOA es una SPA Angular (rutas /#/...)
 * El BRSCGI retorna "Error interno" — la búsqueda real está en /#/busquedaboletin
 *
 * Ejecutar desde /backend:
 *   node debug-boa.js
 */

const puppeteer     = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs            = require('fs');

puppeteer.use(StealthPlugin());

const BOA_BUSQUEDA = 'https://www.boa.aragon.es/#/busquedaboletin';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sep(t) { console.log('\n' + '═'.repeat(60) + '\n  ' + t + '\n' + '═'.repeat(60)); }

async function main() {
  sep('Lanzando Puppeteer con Stealth');

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
    if (type === 'xhr' || type === 'fetch') {
      try {
        const body = await res.text();
        apiCalls.push({ url, status: res.status(), bodySlice: body.substring(0, 400) });
      } catch { /* stream already consumed */ }
    }
  });

  try {
    // ── Paso 1: Cargar la SPA ────────────────────────────
    sep('Paso 1: Navegando a /#/busquedaboletin');
    await page.goto(BOA_BUSQUEDA, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: 'debug-boa-spa-loaded.png', fullPage: true });
    console.log('Screenshot → debug-boa-spa-loaded.png');

    const html1 = await page.content();
    fs.writeFileSync('debug-boa-spa.html', html1, 'utf8');
    console.log(`HTML SPA guardado (${html1.length} chars) → debug-boa-spa.html`);

    // ── Paso 2: Analizar formulario ──────────────────────
    sep('Paso 2: Análisis del formulario Angular');
    const dom = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
        tag:         el.tagName,
        type:        el.getAttribute('type') || '-',
        name:        el.getAttribute('name') || '-',
        id:          el.getAttribute('id')   || '-',
        placeholder: el.getAttribute('placeholder') || '-',
        ngModel:     el.getAttribute('ng-model') || el.getAttribute('[(ngmodel)]') || '-',
        class:       el.className.substring(0, 60),
      }));

      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b => ({
        tag:   b.tagName,
        text:  b.innerText.trim().substring(0, 80),
        type:  b.getAttribute('type') || '-',
        class: b.className.substring(0, 60),
      }));

      const bodyText = document.body.innerText.substring(0, 1500);
      return { inputs, buttons, bodyText };
    });

    console.log('\nInputs encontrados:', dom.inputs.length);
    dom.inputs.forEach(i => console.log(`  <${i.tag}> type="${i.type}" placeholder="${i.placeholder}" id="${i.id}" name="${i.name}" class="${i.class}"`));

    console.log('\nBotones encontrados:', dom.buttons.length);
    dom.buttons.forEach(b => console.log(`  <${b.tag}> text="${b.text}" type="${b.type}" class="${b.class}"`));

    console.log('\nTexto visible (primeros 1500 chars):');
    console.log(dom.bodyText);

    // ── Paso 3: Intentar buscar ──────────────────────────
    sep('Paso 3: Interactuando con el formulario');

    // Esperar a que aparezcan inputs (Angular puede tardar en renderizar)
    try {
      await page.waitForSelector('input', { timeout: 10_000 });
    } catch {
      console.log('⚠️  No aparecieron inputs en 10s — la SPA puede no cargar');
    }

    // Intentar encontrar el campo de texto libre
    const selectorTexto = [
      'input[placeholder*="busca" i]',
      'input[placeholder*="texto" i]',
      'input[placeholder*="palabra" i]',
      'input[type="search"]',
      'input[type="text"]:first-of-type',
    ];

    let inputEncontrado = null;
    for (const sel of selectorTexto) {
      inputEncontrado = await page.$(sel);
      if (inputEncontrado) { console.log(`Input encontrado con selector: "${sel}"`); break; }
    }

    if (inputEncontrado) {
      await inputEncontrado.click({ clickCount: 3 });
      await page.keyboard.type('oficina de farmacia', { delay: 50 });
      console.log('Texto "oficina de farmacia" escrito en el input');

      // Intentar enviar el formulario
      const selectorBoton = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button.btn-primary',
        'button.btn-search',
        'button:contains("Buscar")',
      ];

      let boton = null;
      for (const sel of selectorBoton) {
        try { boton = await page.$(sel); if (boton) { console.log(`Botón con: "${sel}"`); break; } } catch {}
      }

      // Fallback: buscar botón por texto
      if (!boton) {
        boton = await page.evaluateHandle(() => {
          const all = Array.from(document.querySelectorAll('button'));
          return all.find(b => /buscar|search/i.test(b.innerText)) || null;
        });
        const isNull = await page.evaluate(el => el === null, boton);
        if (isNull) boton = null;
      }

      if (boton) {
        console.log('Haciendo clic en botón de búsqueda...');
        await boton.click();
        await page.waitForTimeout ? page.waitForTimeout(3000) : new Promise(r => setTimeout(r, 3000));
        await page.screenshot({ path: 'debug-boa-spa-resultados.png', fullPage: true });
        console.log('Screenshot → debug-boa-spa-resultados.png');

        const htmlResultados = await page.content();
        fs.writeFileSync('debug-boa-spa-resultados.html', htmlResultados, 'utf8');
        console.log(`HTML resultados guardado → debug-boa-spa-resultados.html`);

        // Extraer resultados visibles
        const resultados = await page.evaluate(() => {
          const lineas = document.body.innerText.split('\n')
            .map(l => l.trim()).filter(l => l.length > 20)
            .filter(l => /farmacia|transmis|apertura|cierre/i.test(l))
            .slice(0, 20);
          const links = Array.from(document.querySelectorAll('a[href*=".pdf"], a[href*="pdf"]')).map(a => a.href);
          return { lineas, links };
        });

        console.log('\nLíneas con "farmacia/transmis/apertura":');
        resultados.lineas.forEach(l => console.log('  ', l));
        console.log('\nLinks PDF encontrados:', resultados.links);
      } else {
        console.log('⚠️  No se encontró botón de búsqueda');
      }
    } else {
      console.log('⚠️  No se encontró input de búsqueda');
    }

    // ── Paso 4: API calls interceptadas ─────────────────
    sep('Paso 4: Llamadas API de Angular interceptadas');
    console.log(`Total: ${apiCalls.length} llamadas`);
    apiCalls.forEach((c, i) => {
      console.log(`\n[${i + 1}] ${c.status} ${c.url.substring(0, 120)}`);
      if (c.bodySlice) console.log('    Body:', c.bodySlice.substring(0, 200));
    });

  } finally {
    await browser.close();
    sep('Diagnóstico completado');
    console.log('Archivos generados: debug-boa-spa.html / debug-boa-spa-resultados.html');
    console.log('Comparte esta salida para ajustar el scraper.');
  }
}

main().catch(err => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
