import { it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { serverReceiptAssets } from '../server/receipt';
import { buildReceiptPDF } from '../src/lib/pdf';
import type { Receipt } from '../src/lib/types';
it('generates a readable multipage PDF with Spanish text and signature', async () => {
  const receipt: Receipt={id:crypto.randomUUID(),delivery_id:crypto.randomUUID(),folio:'MIN-20261020-00001',created_at:new Date().toISOString(),pdf_path:null,snapshot:{destination:{name:'Veterinaria Nutrición',address:'Calle 123',city:'Bogotá'},courier:'Nicolás',recipient:'María Gómez',observation:'Observación extensa. '.repeat(180),scheduled_date:'2026-10-20',confirmed_at:new Date().toISOString(),signature_path:'',items:Array.from({length:35},(_,n)=>({product_id:crypto.randomUUID(),name:`Dieta número ${n+1} · Pollo`,quantity:2,unit:'kg'}))}};
  const bytes=await buildReceiptPDF(receipt,new Uint8Array(await readFile('public/icon-192.png')),{assets:await serverReceiptAssets()});
  const pdf=await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(6);
  expect(pdf.getPage(0).getSize()).toEqual({width:419,height:595});
  expect(pdf.getTitle()).toContain(receipt.folio);
  expect(bytes.length).toBeGreaterThan(5000);
});
