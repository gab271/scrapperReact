const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu'] });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);

  const xhrUrls = [];
  const xhrBodies = [];
  page.on('response', async res => {
    const url = res.url();
    const type = res.request().resourceType();
    if ((type === 'xhr' || type === 'fetch') && url.includes('BRSCGI')) {
      xhrUrls.push(url);
      try {
        const body = await res.text();
        xhrBodies.push({ url, body: body.substring(0, 2000) });
      } catch {}
    }
  });

  await page.goto('https://www.boa.aragon.es/#/busquedaboletin', { waitUntil: 'networkidle2' });

  await page.evaluate(function() {
    var btns = Array.from(document.querySelectorAll('button'));
    var btn = btns.find(function(b) { return /aceptar/i.test(b.textContent); });
    if (btn) btn.click();
  });
  await new Promise(function(r) { setTimeout(r, 800); });

  await page.waitForSelector('#id-inputTexto', { timeout: 15000 });
  await page.click('#id-inputTexto', { clickCount: 3 });
  await page.type('#id-inputTexto', 'oficina de farmacia', { delay: 30 });
  await page.evaluate(function() {
    var el = document.getElementById('id-inputTexto');
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  await page.click('button[aria-label="Buscar"]');
  await new Promise(function(r) { setTimeout(r, 3000); });
  try { await page.waitForNetworkIdle({ idleTime: 1500, timeout: 10000 }); } catch(e) {}

  console.log('BRSCGI URLs:');
  xhrUrls.forEach(function(u) { console.log(u); });
  console.log('\nFull JSON (first entry):');
  if (xhrBodies.length > 0) {
    // Find the search results URL (not disabledDays)
    var resultsXhr = xhrBodies.find(function(x) { return x.url.includes('VERLST') || x.url.includes('QUERY'); });
    if (resultsXhr) {
      console.log('URL:', resultsXhr.url);
      console.log('Body (first 2000):', resultsXhr.body);
    } else {
      xhrBodies.forEach(function(x) {
        console.log('URL:', x.url);
        console.log('Body:', x.body.substring(0, 500));
        console.log('---');
      });
    }
  }

  await browser.close();
}

main().catch(function(e) { console.error(e.message); process.exit(1); });
