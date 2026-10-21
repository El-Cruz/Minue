import type { SupabaseClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { buildReceiptPDF, type ReceiptAssets } from '../src/lib/pdf.js';
import type { Receipt } from '../src/lib/types.js';
import { HttpError } from './http.js';
export const BUCKET = 'minue-private';
let assets: Promise<ReceiptAssets> | undefined;
export function serverReceiptAssets() {
  return assets ||= Promise.all(['template-v2.png','Poppins-Regular.ttf'].map(name=>readFile(join(process.cwd(),'public','receipt-assets',name))))
    .then(([template,font])=>({template,font})).catch(error=>{assets=undefined;throw error;});
}
export async function ensureReceiptPDF(client: SupabaseClient, receipt: Receipt, original = false): Promise<Uint8Array> {
  if (!receipt.receipt_number && !original) throw new HttpError(503,'Falta activar la actualización de comprobantes en Supabase.');
  const path = original ? receipt.pdf_path || 'receipts/' + receipt.id + '.pdf' : 'receipts/' + receipt.id + '/v2.pdf';
  const existing = await client.storage.from(BUCKET).download(path);
  if (!existing.error && existing.data) return new Uint8Array(await existing.data.arrayBuffer());
  if (original) throw new HttpError(404,'El archivo original no está disponible.');
  const signature = await client.storage.from(BUCKET).download(receipt.snapshot.signature_path);
  if (signature.error || !signature.data) throw new HttpError(503,'La entrega está guardada, pero no pudimos leer la firma para generar el PDF. Inténtalo de nuevo.');
  const pdf = await buildReceiptPDF(receipt,new Uint8Array(await signature.data.arrayBuffer()),{assets:await serverReceiptAssets()});
  const upload = await client.storage.from(BUCKET).upload(path,pdf,{contentType:'application/pdf',upsert:false,cacheControl:'0'});
  let stored = pdf;
  if (upload.error) {
    const raced = await client.storage.from(BUCKET).download(path);
    if (raced.error || !raced.data) throw new HttpError(503,'La entrega está guardada. Reintenta generar el comprobante desde el historial.');
    stored = new Uint8Array(await raced.data.arrayBuffer());
  }
  const updated = await client.from('receipt_documents').update({checksum:createHash('sha256').update(stored).digest('hex')}).eq('receipt_id',receipt.id).eq('version',2);
  if (updated.error) throw new HttpError(503,'El comprobante está guardado, pero falta actualizar su estado.');
  return stored;
}
