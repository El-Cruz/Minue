import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Receipt } from './types.js';
import { formatDate, formatTime } from './dates.js';

export async function buildReceiptPDF(receipt: Receipt, signature: Uint8Array, options: { demonstration?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(.14, .30, .24), muted = rgb(.38, .43, .40);
  const clean = (s: string) => s.replace(/[\u0000-\u001f]/g, ' ').replace(/[→↗]/g, '-').replace(/[^\x20-\x7e\xa0-\xff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g, '?');
  let page = doc.addPage([595, 842]), y = 785;
  function header() {
    page.drawText('minue', { x: 44, y, size: 30, font: bold, color: green });
    page.drawText('NUTRICIÓN QUE CUIDA', { x: 44, y: y - 20, size: 8, font: regular, color: muted });
    page.drawText(clean(receipt.folio), { x: 330, y: y - 2, size: 11, font: bold, color: green });
    page.drawText('COMPROBANTE DE ENTREGA', { x: 330, y: y - 20, size: 9, font: regular, color: muted });
    y -= 75;
    if (options.demonstration) {
      page.drawText('DEMOSTRACIÓN - DATOS DE EJEMPLO - SIN VALIDEZ OPERATIVA', { x: 44, y, size: 9, font: bold, color: muted });
      y -= 24;
    }
  }
  function room(height: number) {
    if (y - height < 65) { page = doc.addPage([595, 842]); y = 785; header(); }
  }
  function text(value: string, size = 11, weight = false, color = green) {
    const font = weight ? bold : regular;
    const paragraphs = clean(value).split('\n');
    for (const paragraph of paragraphs) {
      let line = '';
      const words = paragraph.match(/\S{1,50}/g) || [''];
      for (const word of words) {
        if (font.widthOfTextAtSize(`${line} ${word}`, size) > 500 && line) {
          room(size + 7); page.drawText(line, { x: 44, y, size, font, color }); y -= size + 7; line = word;
        } else line = line ? `${line} ${word}` : word;
      }
      room(size + 7); page.drawText(line, { x: 44, y, size, font, color }); y -= size + 7;
    }
  }
  header();
  const s = receipt.snapshot;
  text(s.destination.name, 19, true); text(`${s.destination.address} · ${s.destination.city}`, 11, false, muted);
  y -= 12;
  text(`Fecha programada: ${formatDate(s.scheduled_date, { day: 'numeric', month: 'long', year: 'numeric' })}`);
  text(`Entregado: ${formatDate(s.confirmed_at)} a las ${formatTime(s.confirmed_at)} (Bogotá)`);
  text(`Repartidor: ${s.courier}`); y -= 18;
  text('DETALLE DE ALIMENTOS', 10, true); y -= 5;
  for (const item of s.items) { text(item.name, 11, true); text(`${item.quantity} ${item.unit}`, 10, false, muted); y -= 8; }
  y -= 10; text(`Recibió: ${s.recipient}`, 12, true);
  if (s.observation) { y -= 12; text('Observación', 10, true); text(s.observation, 10, false, muted); }
  room(160); y -= 10;
  const image = await doc.embedPng(signature);
  const scale = Math.min(280 / image.width, 100 / image.height);
  page.drawImage(image, { x: 44, y: y - 100, width: image.width * scale, height: image.height * scale });
  y -= 115;
  page.drawLine({ start: { x: 44, y }, end: { x: 325, y }, thickness: .6, color: muted });
  y -= 17; text('Firma de quien recibe', 9, false, muted);
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText('Minue · Comprobante de recepción · Formato provisional v1', { x: 44, y: 34, size: 8, font: regular, color: muted });
    p.drawText(`${i + 1} / ${pages.length}`, { x: 520, y: 34, size: 8, font: regular, color: muted });
  });
  doc.setTitle(`Minue - ${receipt.folio}`); doc.setAuthor('Minue');
  doc.setCreationDate(new Date(receipt.created_at));
  return doc.save();
}
