import { z } from 'zod';
import { authorize, HttpError, type Request } from './http.js';
import type { Receipt } from '../src/lib/types.js';
export async function authorizedReceipt(req: Request) {
  const id = new URL(req.url!,'https://minue.invalid').searchParams.get('delivery_id');
  if (!z.uuid().safeParse(id).success) throw new HttpError(400,'Entrega no válida.');
  const auth = await authorize(req);
  const delivery = await auth.client.from('deliveries').select('assigned_to,partner_id,legacy_profile_ids').eq('id',id).single();
  if (!delivery.data || (!auth.profile.is_admin && delivery.data.assigned_to!==auth.user.id && delivery.data.partner_id!==auth.user.id && !delivery.data.legacy_profile_ids?.includes(auth.user.id))) throw new HttpError(404,'No se encontró el comprobante.');
  const receipt = await auth.client.from('receipts').select('*').eq('delivery_id',id).single();
  if (receipt.error || !receipt.data) throw new HttpError(404,'Esta entrega todavía no tiene comprobante.');
  return {...auth,receipt:receipt.data as Receipt};
}
