import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const origin = process.env.PWA_TEST_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/?demo=1', origin).href);
  await page.getByRole('heading', { name: /Hola, Alex/ }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout must not overflow');
  const manifest = await (await page.request.get(`${origin}/manifest.webmanifest`)).json();
  assert.equal(manifest.display, 'standalone');
  assert(manifest.icons.some(icon => icon.purpose === 'maskable'));
  await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker not installed')), 15000))]));
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const keys = await page.evaluate(async () => {
    const results = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name); results.push(...(await cache.keys()).map(request => request.url));
    }
    return results;
  });
  assert(keys.length > 0);
  assert(keys.every(url => !url.includes('/api/') && !url.includes('supabase')), 'Private APIs must not be cached');
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { name: 'Volvamos a conectarnos' }).waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PWA correcta: manifiesto instalable, caché estática, pantalla sin conexión y móvil sin desbordamiento.');
} finally { await browser.close(); }
