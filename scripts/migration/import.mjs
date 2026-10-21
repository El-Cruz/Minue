import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
const args=process.argv.slice(2),file=args.find(a=>!a.startsWith('--'));
if(!file)throw new Error('Indica el archivo JSON privado. Sin --apply no se importa nada.');
process.loadEnvFile('.env');
if(new URL(process.env.SUPABASE_URL).hostname!=='cpycykduhgwsalgwhkxd.supabase.co')throw new Error('Proyecto incorrecto.');
const payload=JSON.parse(await readFile(file,'utf8'));
if(payload.format!=='minue-legacy-v1')throw new Error('Formato no válido.');
const expected={deliveries:payload.deliveries.length,lines:payload.deliveries.reduce((n,d)=>n+d.items.length,0),products:payload.products.length,destinations:payload.destinations.length};
console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',expected,warnings:payload.warnings.length}));
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const check=await client.from('deliveries').select('id,legacy_source,legacy_id,legacy_code,partner_id').limit(1);
if(check.error)throw new Error('Primero aplica el SQL de activación histórica. No se ha importado ningún registro histórico.');
if(!args.includes('--apply'))process.exit(0);
const assignmentsPath=args.find(a=>a.startsWith('--assignments='))?.slice('--assignments='.length);
const assignments=assignmentsPath?JSON.parse(await readFile(assignmentsPath,'utf8')):{};
const {data:profiles,error:profileError}=await client.from('profiles').select('id,is_admin,active');
const admins=profiles?.filter(p=>p.is_admin&&p.active)||[];
if(profileError||admins.length!==1)throw new Error('Selecciona expresamente un administrador si hay más de uno.');
const backup={};
for(const table of ['profiles','destinations','products','contacts','deliveries','receipts','delivery_events']){
 const {data:rows,error:readError}=await client.from(table).select('*');
 if(readError)throw new Error('No se pudo guardar una copia privada antes de importar.');backup[table]=rows;
}
await writeFile(file.replace(/\.json$/,'.before-history-'+Date.now()+'.json'),JSON.stringify(backup,null,2),{mode:0o600});
const {data,error}=await client.rpc('minue_import_legacy',{p_actor:admins[0].id,p_payload:payload,p_assignments:assignments});
if(error)throw new Error('La transacción histórica no se completó: '+error.message);
for(const [key,value] of Object.entries(expected))if(data[key]!==value)throw new Error('El recuento de importación no coincide.');
const {data:deliveries,error:deliveryError}=await client.from('deliveries').select('*').eq('legacy_source',payload.source_key);
const {data:receipts,error:receiptError}=await client.from('receipts').select('*').eq('legacy_source',payload.source_key);
if(deliveryError||receiptError)throw new Error('No se pudo verificar la importación.');
for(const source of payload.deliveries){
 const delivery=deliveries.find(d=>d.legacy_id===source.legacy_id),receipt=receipts.find(r=>r.legacy_id===source.legacy_id);
 if(!delivery||delivery.legacy_code!==source.code||delivery.items.length!==source.items.length||delivery.status!==source.status)throw new Error('Una entrega importada no coincide.');
 if(source.status==='delivered'&&(!receipt||receipt.receipt_number!==source.code||receipt.legacy_pdf_url!==source.pdf_url||receipt.legacy_signature_reference!==source.signature_reference||new Date(receipt.created_at).getTime()!==new Date(source.date).getTime()))throw new Error('Un comprobante histórico no coincide.');
 for(const item of source.items){const saved=delivery.items.find(i=>i.legacy_line_id===item.legacy_id);if(!saved||saved.quantity!==item.quantity||saved.name!==item.name)throw new Error('Una línea de producto no coincide.');}
}
const result={verified:true,counts:data,source_sha256:payload.sha256,verified_at:new Date().toISOString()};
await writeFile(file.replace(/\.json$/,'.import-result.json'),JSON.stringify(result,null,2),{mode:0o600});
console.log(JSON.stringify(result));
