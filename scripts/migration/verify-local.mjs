import {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile} from 'node:fs/promises';
const [payloadPath,snapshotPath]=process.argv.slice(2);
const uiOutput=process.argv.find(a=>a.startsWith('--ui-output='))?.slice('--ui-output='.length);
if(!payloadPath)throw new Error('Indica el JSON privado preparado.');
const payload=JSON.parse(await readFile(payloadPath,'utf8'));
const snapshot=snapshotPath?JSON.parse(await readFile(snapshotPath,'utf8')):null;
const db=new PGlite();
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
 await db.exec(await readFile('supabase/schema.sql','utf8'));
 let actor;
 if(snapshot){
  for(const p of snapshot.profiles)await db.query('insert into auth.users values($1)',[p.id]);
  for(const table of ['profiles','destinations','products','contacts','deliveries','receipts']){
   for(const row of snapshot[table]){
    const columns=Object.keys(row);if(columns.some(c=>!/^[a-z_]+$/.test(c)))throw new Error('Unexpected snapshot column');
    await db.query('insert into public.'+table+'('+columns.join(',')+') values('+columns.map((_,i)=>'$'+(i+1)).join(',')+')',columns.map(c=>row[c]&&typeof row[c]==='object'?JSON.stringify(row[c]):row[c]));
   }
  }
  actor=snapshot.profiles.find(p=>p.is_admin&&p.active).id;
 }else{
  actor=crypto.randomUUID();await db.query('insert into auth.users values($1)',[actor]);
  await db.query("insert into public.profiles values($1,'Administrador de prueba','admin@example.com',true,true,true)",[actor]);
 }
 await db.exec(await readFile('docs/activar-migracion-historica.sql','utf8'));
 await db.exec(await readFile('docs/activar-dos-repartidores.sql','utf8'));
 const run=async()=>(await db.query('select public.minue_import_legacy($1,$2) result',[actor,JSON.stringify(payload)])).rows[0].result;
 const first=await run(),second=await run();if(JSON.stringify(first)!==JSON.stringify(second))throw new Error('Reimport mismatch');
 const deliveries=(await db.query('select * from public.deliveries where legacy_source=$1',[payload.source_key])).rows;
 const receipts=(await db.query('select * from public.receipts where legacy_source=$1',[payload.source_key])).rows;
 for(const source of payload.deliveries){
  const d=deliveries.find(x=>x.legacy_id===source.legacy_id),r=receipts.find(x=>x.legacy_id===source.legacy_id);
  if(!d||d.legacy_code!==source.code||d.status!==source.status||d.items.length!==source.items.length)throw new Error('Delivery mismatch');
  for(const item of source.items){const saved=d.items.find(x=>x.legacy_line_id===item.legacy_id);if(!saved||saved.name!==item.name||saved.quantity!==item.quantity)throw new Error('Product line mismatch');}
  if(source.status==='delivered'&&(!r||r.receipt_number!==source.code||r.legacy_pdf_url!==source.pdf_url||r.legacy_signature_reference!==source.signature_reference||r.snapshot.courier!==source.courier||r.snapshot.recipient!==(source.recipient||'')||r.snapshot.observation!==(source.observation||'')||new Date(r.created_at).getTime()!==new Date(source.date).getTime()))throw new Error('Historical receipt mismatch');
 }
 const [totals]=(await db.query("select (select count(*) from public.deliveries)::int deliveries,(select count(*) from public.receipts)::int receipts,(select count(*) from public.products)::int products,(select count(*) from public.destinations)::int destinations,(select count(*) from private.receipt_drive_jobs)::int jobs")).rows;
 if(snapshot){for(const original of snapshot.receipts){const [saved]=(await db.query('select * from public.receipts where id=$1',[original.id])).rows;if(saved.folio!==original.folio||JSON.stringify(saved.snapshot)!==JSON.stringify(original.snapshot)||saved.pdf_path!==original.pdf_path)throw new Error('Existing receipt changed');}}
 if(uiOutput){const data={};for(const table of ['profiles','destinations','products','contacts','deliveries','receipts','delivery_events'])data[table==='delivery_events'?'events':table]=(await db.query('select * from public.'+table)).rows;await writeFile(uiOutput,JSON.stringify(data),{mode:0o600});}
 console.log(JSON.stringify({local_only:true,source_matched:first,idempotent:true,total:totals,private_files_not_copied:true}));
}finally{await db.close();}
