import type { SupabaseClient } from '@supabase/supabase-js';
import { buildReceiptPDF } from '../src/lib/pdf.js';
import type { Receipt } from '../src/lib/types.js';
import { HttpError } from './http.js';
export const BUCKET = 'minue-private';
export async function ensureReceiptPDF(client: SupabaseClient, receipt: Receipt): Promise<Uint8Array> {
  const path = receipt.pdf_path || `receipts/${receipt.id}.pdf`;
  const existing = await client.storage.from(BUCKET).download(path);
  if (!existing.error && existing.data) {
    if (!receipt.pdf_path) {
      const metadata = await client.from('receipts').update({ pdf_path: path }).eq('id', receipt.id);
      if (metadata.error) throw new HttpError(503, 'El PDF está guardado, pero no pudimos actualizar su estado. Reintenta la descarga.');
    }
    return new Uint8Array(await existing.data.arrayBuffer());
  }
  const signature = await client.storage.from(BUCKET).download(receipt.snapshot.signature_path);
  if (signature.error || !signature.data) throw new HttpError(503, 'La entrega está guardada, pero no pudimos leer la firma para generar el PDF. Inténtalo de nuevo.');
  const pdf = await buildReceiptPDF(receipt, new Uint8Array(await signature.data.arrayBuffer()));
  const { error } = await client.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false, cacheControl: '0' });
  if (error) {
    const raced = await client.storage.from(BUCKET).download(path);
    if (raced.error) throw new HttpError(503, 'La entrega está guardada. No pudimos generar el comprobante; reintenta desde el historial.');
  }
  const updated = await client.from('receipts').update({ pdf_path: path }).eq('id', receipt.id);
  if (updated.error) throw new HttpError(503, 'El comprobante está guardado, pero no pudimos actualizar su estado. Inténtalo de nuevo.');
  return pdf;
}
