import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
let db:PGlite,legacy:any;
const actor='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const destination='56374960-a55c-4093-9947-c95dffbbdea6',product='30000000-0000-4000-8000-000000000001',contact='50000000-0000-4000-8000-000000000001';
async function rpc(action:string,payload:unknown){return (await db.query<{v:any}>('select public.minue_command($1,$2,$3) v',[actor,action,JSON.stringify(payload)])).rows[0].v;}
async function drive(action:string,payload:unknown={}){return (await db.query<{v:any}>('select public.minue_drive($1,$2) v',[action,JSON.stringify(payload)])).rows[0].v;}
async function delivery(){
  const id=crypto.randomUUID();
  await rpc('save_delivery',{id,destination_id:destination,assigned_to:actor,scheduled_date:'2026-10-01',time_window:'',notes:'',items:[{product_id:product,quantity:1.25}]});
  return id;
}
const confirm=(id:string)=>({delivery_id:id,recipient_id:contact,new_recipient:'',signature_path:'signatures/'+id+'/'+crypto.randomUUID()+'.png',observation:'Solo para la aplicación',request_id:crypto.randomUUID()});
beforeAll(async()=>{
 db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
 await db.exec(await readFile('supabase/schema.sql','utf8'));
 await db.query('insert into auth.users values($1),($2)',[actor,other]);
 await db.query("insert into public.profiles values($1,'Admin','admin@example.com',true,true,true),($2,'Otro','other@example.com',false,true,true)",[actor,other]);
 await rpc('save_destination',{id:destination,name:'Pradera',address:'Av. Eloy Alfaro',city:'Quito',phone:'',notes:'',active:true});
 await rpc('save_product',{id:product,name:'Pollo',unit:'1 kg',species:'dog',active:true});
 await rpc('save_contact',{id:contact,destination_id:destination,name:'Persona de prueba'});
 const id=await delivery();legacy=await rpc('confirm_delivery',confirm(id));
 const file=(await readdir('supabase/migrations')).find(n=>n.endsWith('_receipt_documents_drive.sql'))!;
 await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
},30000);
afterAll(async()=>{await db?.close();});
describe('receipt numbering, originals and durable archive',()=>{
 it('backfills PRA-065 without changing the original snapshot, folio or date',async()=>{
  const r=(await db.query<any>('select * from public.receipts where id=$1',[legacy.id])).rows[0];
  expect(r.receipt_number).toBe('PRA-065');expect(r.folio).toBe(legacy.folio);expect(r.snapshot).toEqual(legacy.snapshot);
  expect(new Date(r.created_at).toISOString()).toBe(new Date(legacy.created_at).toISOString());
  const docs=(await db.query<any>('select version,pdf_path from public.receipt_documents where receipt_id=$1 order by version',[r.id])).rows;
  expect(docs.map(x=>x.version)).toEqual([1,2]);expect(docs[0].pdf_path).toBe('receipts/'+r.id+'.pdf');
  expect((await db.query<any>('select receipt_next_number from public.destinations where id=$1',[destination])).rows[0].receipt_next_number).toBe(66);
 });
 it('allocates one number and one job for repeated confirmation',async()=>{
  const id=await delivery(),input=confirm(id),first=await rpc('confirm_delivery',input),again=await rpc('confirm_delivery',confirm(id));
  expect(first.receipt_number).toBe('PRA-066');expect(again.id).toBe(first.id);expect(again.receipt_number).toBe(first.receipt_number);
  expect((await db.query('select * from private.receipt_drive_jobs where receipt_id=$1',[first.id])).rows).toHaveLength(1);
 });
 it('keeps numbers unique across concurrent confirmations',async()=>{
  const [a,b]=await Promise.all([delivery(),delivery()]);
  const results=await Promise.all([rpc('confirm_delivery',confirm(a)),rpc('confirm_delivery',confirm(b))]);
  expect(results.map(r=>r.receipt_number).sort()).toEqual(['PRA-067','PRA-068']);
 });
 it('rejects renumbering an issued destination and unauthorised archive access',async()=>{
  await expect(rpc('save_destination',{id:destination,name:'Pradera',address:'Quito',city:'Quito',phone:'',notes:'',active:true,receipt_code:'PRA',receipt_next_number:1})).rejects.toThrow('numeración');
  await rpc('save_destination',{id:destination,name:'Pradera',address:'Quito',city:'Quito',phone:'',notes:'Dirección actualizada',active:true,receipt_code:'PRA'});
  expect((await db.query<any>('select receipt_next_number from public.destinations where id=$1',[destination])).rows[0].receipt_next_number).toBe(69);
  await db.exec("set role authenticated;select set_config('request.jwt.claim.sub','"+other+"',false);");
  expect((await db.query('select * from public.receipt_documents')).rows).toHaveLength(0);
  await expect(drive('connection_get')).rejects.toThrow('permission denied');
  await db.exec('reset role');
 });
 it('leases separate batches, rejects stale workers and preserves a stable Google ID',async()=>{
  const first=await drive('claim'),second=await drive('claim');expect(first).toHaveLength(3);expect(second).toHaveLength(1);
  const job=first[0];
  const saved=await drive('file_id',{receipt_id:job.receipt_id,lease:job.lease,google_id:'reserved-id'});
  const retried=await drive('file_id',{receipt_id:job.receipt_id,lease:job.lease,google_id:'other-id'});
  expect(saved.google_id).toBe('reserved-id');expect(retried.google_id).toBe('reserved-id');
  await expect(drive('saved',{receipt_id:job.receipt_id,lease:crypto.randomUUID()})).rejects.toThrow('asignada');
  await drive('saved',{receipt_id:job.receipt_id,lease:job.lease});
  await drive('retry',{receipt_id:job.receipt_id});
  expect((await db.query<any>('select drive_status from public.receipts where id=$1',[job.receipt_id])).rows[0].drive_status).toBe('saved');
  await drive('connection_reconnect');
  expect((await db.query<any>("select count(*)::int n from private.receipt_drive_jobs where state='reconnect'")).rows[0].n).toBe(3);
 });
 it('reclaims an expired lease without accepting completion from its previous worker',async()=>{
  await drive('connection_set',{email:'puntodeentregasminue@gmail.com',encrypted_token:'test-only'});
  const [old]=await drive('claim');
  await db.query("update private.receipt_drive_jobs set locked_until=now()-interval '1 minute' where receipt_id=$1",[old.receipt_id]);
  const next=await drive('claim');expect(next).toHaveLength(1);expect(next[0].lease).not.toBe(old.lease);
  await expect(drive('saved',{receipt_id:old.receipt_id,lease:old.lease})).rejects.toThrow('asignada');
 });
 it('rolls back the confirmation and outbox together if numbering is not configured',async()=>{
  const id=crypto.randomUUID();
  await db.query("insert into public.destinations(id,name,address,city) values($1,'Sin código','Dirección','Quito')",[id]);
  const deliveryId=crypto.randomUUID();
  await rpc('save_delivery',{id:deliveryId,destination_id:id,assigned_to:actor,scheduled_date:'2026-10-01',time_window:'',notes:'',items:[{product_id:product,quantity:0.125}]});
  await expect(rpc('confirm_delivery',{...confirm(deliveryId),recipient_id:null,new_recipient:'Persona de prueba'})).rejects.toThrow('código');
  expect((await db.query<any>('select status from public.deliveries where id=$1',[deliveryId])).rows[0].status).toBe('pending');
  expect((await db.query('select * from public.receipts where delivery_id=$1',[deliveryId])).rows).toHaveLength(0);
 });
});

it('activates vector v3 only for new receipts and preserves numbering, originals and retry idempotency',async()=>{
 await db.exec(await readFile('supabase/migrations/20261021154113_legacy_sheet_import.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261021155718_two_couriers.sql','utf8'));
 const before=(await db.query('select * from public.receipts order by id')).rows;
 const documents=(await db.query('select * from public.receipt_documents order by receipt_id,version')).rows;
 const counter=(await db.query<any>('select receipt_next_number from public.destinations where id=$1',[destination])).rows[0].receipt_next_number;
 await db.exec(await readFile('docs/activar-comprobante-vectorial.sql','utf8'));
 expect((await db.query('select * from public.receipts order by id')).rows).toEqual(before);
 expect((await db.query('select * from public.receipt_documents order by receipt_id,version')).rows).toEqual(documents);
 const id=await delivery();const [one,two]=await Promise.all([rpc('confirm_delivery',confirm(id)),rpc('confirm_delivery',confirm(id))]);
 expect(one.id).toBe(two.id);expect(one.template_version).toBe(3);expect(one.receipt_number).toBe('PRA-'+String(counter).padStart(3,'0'));
 const newDocs=(await db.query<any>('select * from public.receipt_documents where receipt_id=$1',[one.id])).rows;
 expect(newDocs).toHaveLength(1);expect(newDocs[0].version).toBe(3);expect(newDocs[0].pdf_path).toBe('receipts/'+one.id+'/v3.pdf');
 expect((await db.query('select * from private.receipt_drive_jobs where receipt_id=$1',[one.id])).rows).toHaveLength(1);
 expect((await db.query<any>('select receipt_next_number from public.destinations where id=$1',[destination])).rows[0].receipt_next_number).toBe(Number(counter)+1);
});
