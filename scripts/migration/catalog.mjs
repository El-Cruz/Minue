import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
function productId(source,id){const bytes=createHash('sha1').update(Buffer.from('6ba7b8119dad11d180b400c04fd430c8','hex')).update(source+'/product/'+id).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');}
const args=process.argv.slice(2),file=args.find(a=>!a.startsWith('--'));
if(!file)throw new Error('Indica el JSON privado preparado. Sin --apply se ejecuta solo la revisión.');
process.loadEnvFile('.env');
if(new URL(process.env.SUPABASE_URL).hostname!=='cpycykduhgwsalgwhkxd.supabase.co')throw new Error('Proyecto incorrecto.');
const source=JSON.parse(await readFile(file,'utf8'));
if(source.format!=='minue-legacy-v1'||source.products.some(p=>!['dog','cat','both'].includes(p.species)))throw new Error('Revisa la clasificación de especies antes de importar.');
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:profiles,error:profileError}=await client.from('profiles').select('id,is_admin,active');
const admins=profiles?.filter(p=>p.is_admin&&p.active)||[];
if(profileError||admins.length!==1)throw new Error('Selecciona expresamente un administrador si hay más de uno.');
const {data:products,error}=await client.from('products').select('*');if(error)throw new Error('No se pudo leer el catálogo.');
const plan=source.products.map(p=>{
 const matches=products.filter(x=>x.name===p.name);if(matches.length>1)throw new Error('Nombre duplicado en el catálogo; requiere revisión.');
 return {source:p,existing:matches[0],id:matches[0]?.id||productId(source.source_key,p.legacy_id)};
});
console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',source_products:plan.length,existing:plan.filter(p=>p.existing).length,new:plan.filter(p=>!p.existing).length}));
if(!args.includes('--apply'))process.exit(0);
for(const p of plan){
 if(p.existing)continue;
 const {error}=await client.rpc('minue_command',{p_actor:admins[0].id,p_action:'save_product',p_payload:{id:p.id,name:p.source.name,unit:'kg',species:p.source.species,active:true}});
 if(error)throw new Error('No se pudo guardar un producto; los anteriores se conservan. Reintentar reutiliza sus nombres exactos.');
}
const {data:after,error:afterError}=await client.from('products').select('*');
if(afterError||source.products.some(p=>after.filter(x=>x.name===p.name).length!==1))throw new Error('La verificación del catálogo no coincide.');
const log={source_sha256:source.sha256,products:source.products.map(p=>({legacy_id:p.legacy_id,id:after.find(x=>x.name===p.name).id,name:p.name})),verified_at:new Date().toISOString()};
await writeFile(file.replace(/\.json$/,'.catalog-result.json'),JSON.stringify(log,null,2),{mode:0o600});
console.log(JSON.stringify({verified:true,products_from_source:source.products.length,total_products:after.length,preserved_existing:products.every(p=>after.some(x=>x.id===p.id))}));
