import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { today, offsetDate } from '../../src/lib/dates';

async function openFirst(page: Page) {
  await page.getByRole('button', { name: /01 Veterinaria Huellitas/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function sign(page: Page) {
  const canvas = page.getByLabel('Dibuja la firma de quien recibe');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 35, box.y + 110);
  await page.mouse.down();
  for (let n = 0; n < 30; n++) await page.mouse.move(box.x + 35 + n * 5, box.y + 95 + Math.sin(n * .7) * 30);
  await page.mouse.up();
}

test('mobile dashboard, navigation and modal keyboard behavior', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: /Hola, Alex/ })).toBeVisible();
  await expect(page.getByText('Vista de demostración')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tu ruta de hoy 4' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openFirst(page);
  await expect(page.getByRole('heading', { name: 'Resumen de la entrega' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Día siguiente' }).click();
  await expect(page.getByRole('heading', { name: /Tu ruta del/ })).toBeVisible();
  await page.getByRole('button', { name: 'Día siguiente' }).click();
  await expect(page.getByText('No hay entregas para esta fecha')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
  await page.getByRole('button', { name: 'Productos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alimentos con propósito' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('recipient, required signature, observation and valid PDF on Android-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1'); await openFirst(page);
  await page.getByRole('button', { name: 'Confirmar entrega', exact: true }).click();
  await page.getByRole('combobox', { name: /Quién recibe/ }).selectOption('new');
  await page.getByRole('textbox', { name: 'Nombre y apellido' }).fill('María Pérez');
  await page.getByRole('button', { name: 'Confirmar y generar comprobante' }).click();
  await expect(page.getByText('Falta la firma de quien recibe.')).toBeVisible();
  await sign(page);
  await page.getByText('Agregar una observación').click();
  await page.getByLabel('Observación de la entrega').fill('Se entregaron todos los alimentos refrigerados.');
  await page.getByRole('button', { name: 'Confirmar y generar comprobante' }).click();
  await expect(page.getByRole('heading', { name: '¡Una entrega más, mucho bienestar!' })).toBeVisible();
  const received = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar comprobante PDF' }).click();
  const download = await received;
  expect(download.suggestedFilename()).toMatch(/^MIN-\d{8}-\d{5}\.pdf$/);
  const pdf = await PDFDocument.load(await readFile((await download.path())!));
  expect(pdf.getPageCount()).toBe(1);
  await download.saveAs('docs/comprobante-ejemplo.pdf');
  await page.getByRole('button', { name: 'Volver a mis entregas' }).click();
  await page.getByRole('navigation', { name: 'Navegación móvil' }).getByRole('button', { name: 'Historial' }).click();
  await expect(page.getByText('Veterinaria Huellitas')).toBeVisible();
  await page.getByRole('button', { name: /01|Veterinaria Huellitas/ }).first().click();
  await expect(page.locator('.receipt-info').getByText(/Recibió María Pérez/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar entrega', exact: true })).toHaveCount(0);
});

test('failed attempt, reprogramming and preserved event history', async ({ page }) => {
  await page.goto('/?demo=1'); await openFirst(page);
  await page.getByRole('button', { name: 'No pude realizar la entrega' }).click();
  await page.getByRole('textbox', { name: '¿Qué ocurrió?' }).fill('La veterinaria está cerrada.');
  await page.getByRole('button', { name: 'Registrar intento fallido', exact: true }).click();
  await page.getByRole('button', { name: /01 Veterinaria Huellitas/ }).click();
  await page.getByRole('button', { name: 'Reprogramar entrega', exact: true }).click();
  await page.getByLabel('Nueva fecha').fill(offsetDate(today(), 1));
  await page.getByLabel('Motivo de reprogramación').fill('Recibirán mañana.');
  await page.getByRole('button', { name: 'Guardar nueva fecha' }).click();
  await page.getByRole('button', { name: 'Día siguiente' }).click();
  await page.getByRole('button', { name: /Veterinaria Huellitas/ }).first().click();
  await page.getByText('Historial de la entrega').click();
  await expect(page.getByText('La veterinaria está cerrada.')).toBeVisible();
  await expect(page.getByText('Podrás confirmar esta entrega el día programado.')).toBeVisible();
});

test('admin creates destination, contact, product and assigned delivery', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Destinos', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo destino', exact: true }).click();
  await page.getByLabel('Nombre de la veterinaria').fill('Veterinaria Prueba');
  await page.getByLabel('Dirección', { exact: true }).fill('Calle 100 # 2-30');
  await expect(page.getByLabel('Ciudad', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Veterinaria Prueba' }) });
  const maps = card.getByRole('link', { name: 'Cómo llegar a Veterinaria Prueba en Google Maps' });
  const mapsUrl = new URL((await maps.getAttribute('href'))!);
  expect(mapsUrl.origin).toBe('https://www.google.com');
  expect(mapsUrl.pathname).toBe('/maps/dir/');
  expect(mapsUrl.searchParams.get('destination')).toBe('Calle 100 # 2-30, Quito');
  await expect(maps).toHaveAttribute('target', '_blank');
  await expect(maps).toHaveAttribute('rel', 'noopener noreferrer');
  await card.getByText('Ver contactos').click();
  await card.getByRole('button', { name: 'Agregar contacto' }).click();
  await page.getByLabel('Nombre y apellido').fill('Persona de prueba');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(card.getByText('Persona de prueba')).toBeVisible();
  await page.getByRole('button', { name: 'Productos', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click();
  await page.getByLabel('Nombre del alimento').fill('Dieta especial de prueba');
  await page.getByLabel('Unidad de entrega').fill('porciones de 400 g');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await page.getByRole('button', { name: 'Gestionar entregas', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva entrega', exact: true }).click();
  await page.getByRole('combobox', { name: 'Destino', exact: true }).selectOption({ label: 'Veterinaria Prueba' });
  await page.getByLabel('Producto para agregar').selectOption({ label: 'Dieta especial de prueba' });
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByLabel('Cantidad de Dieta especial de prueba').fill('7');
  await page.getByRole('button', { name: 'Crear entrega', exact: true }).click();
  await expect(page.getByText('Veterinaria Prueba', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Veterinaria Prueba/ }).first().click();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Cómo llegar a Veterinaria Prueba en Google Maps' })).toHaveAttribute('href', mapsUrl.href);
});

test('offline blocks signing and demo makes invitations explicitly unavailable', async ({ page, context }) => {
  await page.goto('/?demo=1'); await openFirst(page);
  await context.setOffline(true);
  await expect(page.getByRole('alert').filter({ hasText: 'Sin conexión.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar entrega', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cerrar ventana' }).click();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Equipo', exact: true }).click();
  await page.getByRole('button', { name: 'Invitar persona' }).click();
  await page.getByLabel('Nombre y apellido').fill('Repartidor de prueba');
  await page.getByLabel('Correo electrónico').fill('prueba@example.com');
  await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.getByText(/No se envió ningún correo/)).toBeVisible();
});

test('API rejects unauthenticated mutations and unsupported methods', async ({ request }) => {
  expect((await request.post('/api/command', { data: { action: 'confirm_delivery', payload: {} } })).status()).toBe(401);
  expect((await request.get('/api/command')).status()).toBe(405);
  expect((await request.get(`/api/receipt?delivery_id=${crypto.randomUUID()}`)).status()).toBe(401);
});
