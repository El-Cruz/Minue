import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import type { Profile } from '../src/lib/types';
export type Request = IncomingMessage & { body?: unknown };
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function json(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(JSON.stringify(value));
}
export function adminClient() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new HttpError(503, 'Falta configurar la conexión de Minue en el servidor.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
export async function authorize(req: Request) {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Debes iniciar sesión.');
  const client = adminClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Tu sesión terminó. Vuelve a ingresar.');
  const { data: profile, error: profileError } = await client.from('profiles').select('*').eq('id', data.user.id).single();
  if (profileError || !profile?.active) throw new HttpError(403, 'Tu cuenta no tiene acceso activo.');
  return { client, user: data.user, profile: profile as Profile };
}
export async function body(req: Request) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Formato de solicitud no válido.');
  const origin = req.headers.origin, appUrl = process.env.APP_URL;
  if (origin && appUrl && origin !== new URL(appUrl).origin) throw new HttpError(403, 'Origen de solicitud no autorizado.');
  if (req.body !== undefined) {
    const content = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(content) > 350000) throw new HttpError(413, 'La solicitud supera el tamaño permitido.');
    try { return JSON.parse(content); } catch { throw new HttpError(400, 'Solicitud no válida.'); }
  }
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) { const bytes = Buffer.from(chunk); length += bytes.length; if (length > 350000) throw new HttpError(413, 'La solicitud supera el tamaño permitido.'); chunks.push(bytes); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'Solicitud no válida.'); }
}
export function fail(res: ServerResponse, error: unknown) {
  if (error instanceof HttpError) return json(res, error.status, { error: error.message });
  console.error('minue_api_error', error instanceof Error ? { name: error.name, message: error.message.slice(0, 180) } : { name: 'unknown' });
  return json(res, 500, { error: 'No pudimos completar la operación. Inténtalo de nuevo.' });
}
