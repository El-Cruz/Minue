import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const argv = process.argv.slice(2);
const option = key => { const index = argv.indexOf(key); return index < 0 ? '' : argv[index + 1] || ''; };
const email = (option('--email') || process.env.INITIAL_ADMIN_EMAIL || '').trim();
const name = (option('--name') || process.env.INITIAL_ADMIN_NAME || '').trim();
if (!email.includes('@') || name.length < 2 || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY || !process.env.APP_URL) {
  console.error('Configura .env y ejecuta: npm run bootstrap -- --email tu@correo.com --name "Tu nombre"');
  process.exit(1);
}
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: admins, error: checkError } = await client.from('profiles').select('id').eq('is_admin', true).eq('active', true).limit(1);
if (checkError) { console.error('Aplica primero la migración de la base de datos.'); process.exit(1); }
if (admins.length) { console.error('Ya existe una cuenta administradora activa. Agrega personas desde Equipo.'); process.exit(1); }
const { data, error } = await client.auth.admin.inviteUserByEmail(email, { redirectTo: `${process.env.APP_URL}/auth/invite`, data: { name } });
if (error || !data.user) { console.error('No se pudo enviar la invitación. Revisa SMTP y si la cuenta ya existe en Auth.'); process.exit(1); }
const { error: profileError } = await client.from('profiles').upsert({ id: data.user.id, email: data.user.email, name, is_admin: true, is_courier: true, active: true });
if (profileError) { console.error('Invitación creada, pero falta habilitar el perfil en la base de datos. No repitas la invitación; revisa el perfil en Supabase.'); process.exit(1); }
console.log('Cuenta administradora habilitada. Revisa el correo para crear la contraseña.');
