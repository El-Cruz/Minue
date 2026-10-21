import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

if (existsSync('.env')) process.loadEnvFile('.env');
const project = 'cpycykduhgwsalgwhkxd';
const url = process.env.SUPABASE_URL;
const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const serverKey = process.env.SUPABASE_SECRET_KEY;
function kind(key = '') {
  if (key.startsWith('sb_publishable_')) return 'public';
  if (key.startsWith('sb_secret_')) return 'secret';
  try {
    const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
    return role === 'anon' ? 'public' : role === 'service_role' ? 'secret' : 'unknown';
  } catch { return 'unknown'; }
}
function report(check, result, details = {}) {
  console.log(JSON.stringify({ check, result, ...details }));
}
if (!url || process.env.VITE_SUPABASE_URL !== url || new URL(url).hostname !== `${project}.supabase.co`) {
  report('project', 'invalid'); process.exit(1);
}
if (kind(publicKey) !== 'public' || kind(serverKey) !== 'secret') {
  report('keys', 'invalid', { message: 'Revisa el tipo de clave en las variables; no se muestran los valores.' });
  process.exit(1);
}
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
};
const admin = createClient(url, serverKey, options);
const anon = createClient(url, publicKey, options);
let missing = false;
try {
  const settingsResponse = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publicKey }, signal: AbortSignal.timeout(15000) });
  const settings = await settingsResponse.json();
  report('public_key', settingsResponse.ok ? 'ok' : 'failed', { status: settingsResponse.status });
  if (!settingsResponse.ok) missing = true;
  report('public_registration', settings.disable_signup ? 'disabled' : 'enabled', { message: settings.disable_signup ? 'Acceso por invitacion.' : 'Desactiva los registros publicos en Authentication antes del uso real.' });
  const { data: users, error: userError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  report('server_key', userError ? 'failed' : 'ok', { hasUsers: !userError && users.users.length > 0 });
  if (userError) missing = true;
  const tables = ['profiles', 'destinations', 'contacts', 'products', 'deliveries', 'delivery_events', 'receipts'];
  for (const table of tables) {
    const { data, error, status } = await admin.from(table).select('id').limit(1);
    const valid = !error && Array.isArray(data);
    report(table, valid ? 'ok' : 'missing_or_inaccessible', { status, ...(error ? { code: error.code } : {}) });
    if (!valid) missing = true;
  }
  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  const bucket = buckets?.find(item => item.id === 'minue-private');
  report('private_bucket', bucket && !bucket.public && !bucketError ? 'ok' : 'missing_or_not_private');
  if (!bucket || bucket.public || bucketError) missing = true;
  const exposed = await anon.from('deliveries').select('id').limit(1);
  const rejected = Boolean(exposed.error) && [401, 403].includes(exposed.status);
  report('anonymous_access', rejected ? 'denied' : 'not_verified', { status: exposed.status });
  if (!rejected) missing = true;
  report('database_setup', missing ? 'pending' : 'verified');
  process.exitCode = missing ? 1 : 0;
} catch {
  report('connection', 'failed', { message: 'No se pudo completar la conexion. Revisa la red y vuelve a intentarlo. No se han mostrado credenciales.' });
  process.exitCode = 1;
}
