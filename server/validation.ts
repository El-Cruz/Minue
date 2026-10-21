import { z } from 'zod';
import { PNG } from 'pngjs';
const uuid = z.uuid();
const short = (max: number, min = 0) => z.string().trim().min(min).max(max);
const date = z.iso.date();
const optionalId = uuid.optional();
const item = z.object({ product_id: uuid, quantity: z.number().positive().max(100000), name: short(150).optional(), unit: short(80).optional() });
export const schemas = {
  save_destination: z.object({ id: optionalId, name: short(150, 2), address: short(250, 2), city: short(100, 2), phone: short(40), notes: short(2000), active: z.boolean() }),
  save_product: z.object({ id: optionalId, name: short(150, 2), unit: short(80, 1), species: z.enum(['dog', 'cat', 'both']), active: z.boolean() }),
  save_delivery: z.object({ id: optionalId, destination_id: uuid, assigned_to: uuid, scheduled_date: date, time_window: short(80), notes: short(2000), items: z.array(item).min(1).max(100).refine(items => new Set(items.map(i => i.product_id)).size === items.length, 'Hay productos duplicados.') }),
  confirm_delivery: z.object({ delivery_id: uuid, recipient_id: uuid.nullable(), new_recipient: short(100), signature: z.string().max(300000), observation: short(2000), request_id: uuid }).refine(v => Boolean(v.recipient_id) !== Boolean(v.new_recipient.length >= 2), 'Selecciona una persona o agrega su nombre.'),
  fail_delivery: z.object({ delivery_id: uuid, note: short(2000, 3) }),
  reschedule_delivery: z.object({ delivery_id: uuid, scheduled_date: date, note: short(2000, 3) }),
  update_profile: z.object({ id: uuid, name: short(100, 2), is_admin: z.boolean(), is_courier: z.boolean(), active: z.boolean() }).refine(v => v.is_admin || v.is_courier, 'Faltan permisos.'),
  invite_user: z.object({ email: z.email().max(254), name: short(100, 2), is_admin: z.boolean(), is_courier: z.boolean() }).refine(v => v.is_admin || v.is_courier, 'Faltan permisos.'),
  save_contact: z.object({ id: optionalId, destination_id: uuid, name: short(100, 2) }),
};
export function validateCommand(action: unknown, payload: unknown) {
  if (typeof action !== 'string' || !Object.hasOwn(schemas, action)) throw new Error('Acción no válida.');
  const result = schemas[action as keyof typeof schemas].safeParse(payload);
  if (!result.success) throw new Error('Revisa los campos: hay datos incompletos o no válidos.');
  return { action, payload: result.data as Record<string, unknown> };
}
export function decodeSignature(value: string): Buffer {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('La firma no es una imagen PNG válida.');
  const bytes = Buffer.from(value.split(',')[1], 'base64');
  if (bytes.length < 100 || bytes.length > 220000 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('La firma no es válida.');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 100 || height < 80 || width > 5000 || height > 5000 || width * height > 10000000) throw new Error('Las dimensiones de la firma no son válidas.');
  let png: PNG;
  try { png = PNG.sync.read(bytes); } catch { throw new Error('No pudimos leer la firma. Vuelve a dibujarla.'); }
  let ink = 0;
  for (let i = 0; i < png.data.length && ink < 12; i += 4) {
    if (png.data[i + 3] > 80 && Math.min(png.data[i], png.data[i + 1], png.data[i + 2]) < 200) ink++;
  }
  if (ink < 12) throw new Error('La firma está vacía. Dibuja la firma antes de confirmar.');
  return bytes;
}
