import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { authorize, body, fail, HttpError, json, type Request } from '../server/http';
import { decodeSignature, validateCommand } from '../server/validation';
import { BUCKET, ensureReceiptPDF } from '../server/receipt';
import type { Receipt } from '../src/lib/types';

export default async function handler(req: Request, res: ServerResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método no permitido.' }); }
  try {
    const { client, user, profile } = await authorize(req);
    const input = await body(req);
    let validated: ReturnType<typeof validateCommand>;
    try { validated = validateCommand(input?.action, input?.payload); } catch (e) { throw new HttpError(400, (e as Error).message); }
    const { action, payload } = validated;
    if (!['confirm_delivery', 'fail_delivery'].includes(action) && !profile.is_admin) throw new HttpError(403, 'Esta acción requiere permisos de administración.');
    if (action === 'invite_user') {
      if (!process.env.APP_URL) throw new HttpError(503, 'Falta configurar la dirección pública de Minue.');
      const { data: invited, error } = await client.auth.admin.inviteUserByEmail(String(payload.email), { redirectTo: `${process.env.APP_URL}/auth/invite`, data: { name: payload.name } });
      if (error || !invited.user) throw new HttpError(400, 'No se pudo invitar a esa persona. Revisa el correo, las cuentas existentes y la configuración de envío.');
      const { error: profileError } = await client.from('profiles').upsert({ id: invited.user.id, email: invited.user.email!, name: payload.name, is_admin: payload.is_admin, is_courier: payload.is_courier, active: true });
      if (profileError) throw new HttpError(503, 'Se creó la invitación pero falta habilitar el perfil. Administración debe completar la cuenta antes de ingresar.');
      return json(res, 200, { ok: true });
    }
    let signaturePath: string | null = null;
    if (action === 'confirm_delivery') {
      const delivery = await client.from('deliveries').select('assigned_to,status').eq('id', payload.delivery_id).single();
      if (!delivery.data || delivery.data.assigned_to !== user.id || !profile.is_courier) throw new HttpError(403, 'Solo puedes confirmar tus entregas asignadas.');
      if (delivery.data.status !== 'delivered') {
        let signature: Buffer;
        try { signature = decodeSignature(String(payload.signature)); } catch (e) { throw new HttpError(400, (e as Error).message); }
        // A fresh immutable object avoids overwrites if a client retries the request.
        signaturePath = `signatures/${payload.delivery_id}/${randomUUID()}.png`;
        const upload = await client.storage.from(BUCKET).upload(signaturePath, signature, { contentType: 'image/png', upsert: false, cacheControl: '0' });
        if (upload.error) throw new HttpError(503, 'No pudimos guardar la firma. La entrega sigue pendiente; vuelve a intentarlo.');
      }
      delete payload.signature; payload.signature_path = signaturePath;
    }
    const { data, error } = await client.rpc('minue_command', { p_actor: user.id, p_action: action, p_payload: payload });
    if (error) {
      // Keep the uploaded object on uncertain network failures: the transaction may have committed.
      const knownFailure = error.code && ['P0001', '23514', '23503', '22P02', '22007', '22008'].includes(error.code);
      if (signaturePath && knownFailure) await client.storage.from(BUCKET).remove([signaturePath]);
      if (error.code === 'P0001') throw new HttpError(409, error.message);
      throw new HttpError(503, 'No se pudo verificar el guardado. Reintenta; la confirmación no se duplicará.');
    }
    if (action === 'confirm_delivery') {
      const receipt = data as Receipt;
      if (signaturePath && receipt.snapshot.signature_path !== signaturePath) await client.storage.from(BUCKET).remove([signaturePath]);
      try { await ensureReceiptPDF(client, receipt); }
      catch { return json(res, 200, { ok: true, data: receipt, pdf_pending: true, message: 'Entrega confirmada. El PDF se podrá generar desde el historial.' }); }
    }
    return json(res, 200, { ok: true, data });
  } catch (e) { return fail(res, e); }
}
