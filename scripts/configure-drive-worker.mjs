import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env');
if(!process.env.DRIVE_WORKER_SECRET || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)throw new Error('Falta configurar .env.');
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {error}=await client.rpc('minue_configure_drive_cron',{p_secret:process.env.DRIVE_WORKER_SECRET});
if(error){console.error('No se pudo activar Cron. Aplica primero docs/activar-archivo-drive.sql en el proyecto correcto.');process.exit(1);}
console.log('Archivo automático programado cada cinco minutos. La clave no se muestra.');
