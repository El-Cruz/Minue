import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFDict} from 'pdf-lib';
import {buildReceiptPDF} from '../src/lib/pdf';
import {serverReceiptAssets} from '../server/receipt';
import type {Receipt} from '../src/lib/types';
const example:Receipt={id:crypto.randomUUID(),delivery_id:crypto.randomUUID(),folio:'TEST',receipt_number:'DEMO-001',template_version:3,created_at:'2026-10-21T17:30:00Z',pdf_path:null,snapshot:{destination:{name:'Veterinaria de ejemplo',address:'Quito',city:'Quito'},items:Array.from({length:7},(_,i)=>({product_id:crypto.randomUUID(),name:'Receta de ejemplo '+(i+1),unit:'kg',quantity:1.125})),courier:'Repartidor de ejemplo',recipient:'María José · Recepción de ejemplo',observation:'Privado: no imprimir',scheduled_date:'2026-10-21',confirmed_at:'2026-10-21T17:30:00Z',signature_path:''}};
it('renders v3 with vector artwork and embeds only the captured signature as an image',async()=>{
  const assets=await serverReceiptAssets(3);expect(assets.template).toBeUndefined();
  const bytes=await buildReceiptPDF(example,new Uint8Array(await readFile('public/icon-192.png')),{assets});
  const document=await PDFDocument.load(bytes);expect(document.getPageCount()).toBe(2);
  for(const page of document.getPages()){
    expect(page.getSize()).toEqual({width:419,height:595});
    const objects=page.node.Resources()!.lookup(PDFName.of('XObject'),PDFDict);
    expect(objects.keys()).toHaveLength(1); // No photo, screenshot, or raster background.
  }
});

it('renders the v4 sheet as vectors with seven rows, preserved data and the new proportions',async()=>{
  const assets=await serverReceiptAssets(4);expect(assets.template).toBeUndefined();
  for(const count of [7,8,16]){
    const receipt={...example,template_version:4,snapshot:{...example.snapshot,items:Array.from({length:count},(_,i)=>({product_id:crypto.randomUUID(),name:'Dieta de recuperación nutricional de pollo para perros y gatos '+(i+1),quantity:1.125,unit:'kg'}))}};
    const bytes=await buildReceiptPDF(receipt,new Uint8Array(await readFile('public/icon-192.png')),{assets});
    const document=await PDFDocument.load(bytes);expect(document.getPageCount()).toBe(Math.ceil(count/7));
    for(const page of document.getPages()){
      expect(page.getSize()).toEqual({width:426.5,height:640});
      expect(page.node.Resources()!.lookup(PDFName.of('XObject'),PDFDict).keys()).toHaveLength(1);
    }
  }
});
