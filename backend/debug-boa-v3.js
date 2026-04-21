/**
 * debug-boa-v3.js — Captura el HTML REAL de los resultados de búsqueda del BOA
 * Ejecutar desde /backend: node debug-boa-v3.js
 *
 * Genera:
 *   debug-boa-v3-resultados.html  → HTML completo tras buscar "oficina de farmacia"
 *   debug-boa-v3-resultados.png   → Screenshot
 */

const puppeteer     = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs            = require('fs');

puppeteer.use(StealthPlugin());

const BOA_BASE     = 'https://www.boa.aragon.es';
const BOA_BUSQUEDA = `${BOA_BASE}/#/busquedaboletin`;

function sep(t) { console.log('\n' + '═'.repeat(60) + '\n  ' + t + '\n' + '═'.repeat(60)); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  sep('BOA v3 — Debug búsqueda "oficina de farmacia"');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.setDefaultNavigationTimeout(60_000);
  page.setDefaultTimeout(30_000);

  // Capturar XHR
  const xhrCalls = [];
  page.on('response', async res => {
    const url  = res.url();
    const type = res.request().resourceType();
    if ((type === 'xhr' || type === 'fetch') && res.status() === 200) {
      try {
        const body = await res.text();
        if (body.length > 100) {
          xhrCalls.push({ url: url.substring(0, 120), body: body.substring(0, 800) });
        }
      } catch {}
    }
  });

  try {
    sep('1. Navegando al buscador Angular...');
    await page.goto(BOA_BUSQUEDA, { waitUntil: 'networkidle2' });
    console.log('Página cargada');

    sep('2. Cerrando cookies...');
    const modalCerrado = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn  = btns.find(b => /aceptar|rechazar|accept/i.test(b.textContent ?? ''));
      if (btn) { btn.click(); return btn.textContent.trim(); }
      return null;
    });
    console.log(modalCerrado ? `Cookie modal: "${modalCerrado}"` : 'No había modal');
    if (modalCerrado) await delay(800);

    sep('3. Esperando formulario...');
    await page.waitForSelector('#id-inputTexto', { timeout: 15_000 });
    console.log('Formulario listo: #id-inputTexto encontrado');

    sep('4. Rellenando búsqueda...');
    const inputTexto = await page.$('#id-inputTexto');
    await inputTexto.click({ clickCount: 3 });
    await inputTexto.type('oficina de farmacia', { delay: 40 });
    await page.evaluate(() => {
      const el = document.getElementById('id-inputTexto');
      if (el) {
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    console.log('Texto escrito: "oficina de farmacia"');
    await delay(400);

    sep('5. Click en Buscar...');
    const boton = await page.$('button[aria-label="Buscar"]');
    if (!boton) throw new Error('No se encontró button[aria-label="Buscar"]');
    await boton.click();
    console.log('Click en Buscar enviado');

    sep('6. Esperando resultados...');
    await delay(3_000);
    try { await page.waitForNetworkIdle({ idleTime: 2_000, timeout: 20_000 }); } catch {}
    console.log('Espera completada');

    // Capturar estado actual
    const html = await page.content();
    fs.writeFileSync('debug-boa-v3-resultados.html', html, 'utf8');
    console.log(`HTML guardado (${html.length} chars) → debug-boa-v3-resultados.html`);

    await page.screenshot({ path: 'debug-boa-v3-resultados.png', fullPage: true });
    console.log('Screenshot → debug-boa-v3-resultados.png');

    sep('7. Análisis del DOM...');
    const analisis = await page.evaluate(() => {
      const texto = document.body.innerText;
      const lineas = texto.split('\n')
        .map(l => l.trim()).filter(l => l.length > 10)
        .slice(0, 60);

      // Buscar resultados
      const resultElements = [
        ...document.querySelectorAll('a, li, tr, article, [class*="resultado"], [class*="result"]')
      ].filter(el => /farmaci/i.test(el.textContent ?? '')).slice(0, 10);

      const resultados = resultElements.map(el => ({
        tag:   el.tagName,
        class: el.className.substring(0, 80),
        text:  el.textContent?.trim().substring(0, 150),
        href:  el.getAttribute?.('href') ?? '-',
      }));

      // Estructura general
      const estructura = [
        ...document.querySelectorAll('main *, [role="main"] *')
      ].slice(0, 30).map(el => ({
        tag:   el.tagName,
        id:    el.id || '-',
        class: el.className?.substring(0, 60) || '-',
        text:  el.textContent?.trim().substring(0, 80) || '-',
      }));

      return { lineas, resultados, estructura };
    });

    console.log('\n=== TEXTO VISIBLE (primeras 60 líneas) ===');
    analisis.lineas.forEach((l, i) => console.log(`${i+1}: ${l}`));

    console.log('\n=== ELEMENTOS CON "farmaci" ===');
    if (analisis.resultados.length === 0) {
      console.log('  (ninguno — la búsqueda no devolvió resultados en el DOM)');
    } else {
      analisis.resultados.forEach((r, i) =>
        console.log(`[${i+1}] <${r.tag}> class="${r.class}" href="${r.href}"\n     ${r.text}`)
      );
    }

    console.log('\n=== ESTRUCTURA MAIN (primeros 30 elementos) ===');
    analisis.estructura.forEach(e =>
      console.log(`  <${e.tag}> id="${e.id}" class="${e.class}" → "${e.text}"`)
    );

    sep('8. XHR capturadas');
    console.log(`Total XHR: ${xhrCalls.length}`);
    xhrCalls.forEach((c, i) =>
      console.log(`\n[${i+1}] ${c.url}\n  ${c.body}`)
    );

  } finally {
    await browser.close();
    sep('Debug v3 completado');
  }
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
