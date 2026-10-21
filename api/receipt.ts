import type { ServerResponse } from 'node:http';
import { z } from 'zod';
import { authorize, fail, HttpError, json, type Request } from '../server/http.js';
import { ensureReceiptPDF } from '../server/receipt.js';
import type { Receipt } from '../src/lib/types.js';
export default async function handler(req: Request, res: ServerResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Método no permitido.' }); }
  try {
    const id = new URL(req.url!, 'https://minue.invalid').searchParams.get('delivery_id');
    if (!z.uuid().safeParse(id).success) throw new HttpError(400, 'Entrega no válida.');
    const { client, user, profile } = await authorize(req);
    const delivery = await client.from('deliveries').select('assigned_to,status').eq('id', id).single();
    if (!delivery.data || (!profile.is_admin && delivery.data.assigned_to !== user.id)) throw new HttpError(404, 'No se encontró el comprobante.');
    const receipt = await client.from('receipts').select('*').eq('delivery_id', id).single();
    if (receipt.error || !receipt.data) throw new HttpError(404, 'Esta entrega todavía no tiene comprobante.');
    const pdf = await ensureReceiptPDF(client, receipt.data as Receipt);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receipt.data.folio}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(Buffer.from(pdf));
  } catch (e) { return fail(res, e); }
}
