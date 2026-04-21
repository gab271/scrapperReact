import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

export interface BrowserSession {
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Lanza un navegador headless con stealth y devuelve browser + page listos.
 * Llamar a close() al terminar para liberar recursos.
 */
export async function launchBrowser(opts: {
  timeout?: number;
  viewport?: { width: number; height: number };
} = {}): Promise<BrowserSession> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(DEFAULT_UA);
  await page.setViewport(opts.viewport ?? { width: 1280, height: 900 });
  page.setDefaultNavigationTimeout(opts.timeout ?? 45_000);
  page.setDefaultTimeout(opts.timeout ?? 45_000);

  return {
    browser,
    page,
    close: () => browser.close(),
  };
}
