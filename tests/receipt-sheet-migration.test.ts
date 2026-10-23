import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
let db:PGlite;
const actor='10000000-0000-4000-8000-000000000001',destination='56374960-a55c-4093-9947-c95dffbbdea6',product='30000000-0000-4000-8000-000000000001';
async function rpc(action:string,payload:unknown){return(await db.query<any>('select public.minue_command($1,$2,$3) result',[actor,action,JSON.stringify(payload)])).rows[0].result;}
async function delivery(){const id=crypto.randomUUID();await rpc('save_delivery',{id,destination_id:destination,assigned_to:actor,scheduled_date:'2026-10-01',time_window:'',notes:'',items:[{product_id:product,quantity:1.125}]});return id;}
const confirmation=(id:string)=>({delivery_id:id,recipient_id:null,new_recipient:'Persona de prueba',signature_path:'signatures/'+id+'/'+crypto.randomUUID()+'.png',observation:'Solo en la aplicación',request_id:crypto.randomUUID()});
beforeAll(async()=>{
 db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
 await db.exec(await readFile('supabase/schema.sql','utf8'));
 await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into public.profiles values($1,'Admin','admin@example.com',true,true,true)",[actor]);
 await rpc('save_destination',{id:destination,name:'Pradera',address:'Dirección de ejemplo',city:'Quito',phone:'',notes:'',active:true});
 await rpc('save_product',{id:product,name:'Receta de ejemplo',species:'dog',unit:'kg',active:true});
 await rpc('confirm_delivery',confirmation(await delivery()));
 for(const file of ['20261021043305_receipt_documents_drive.sql','20261021154113_legacy_sheet_import.sql','20261021155718_two_couriers.sql'])await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
},30000);
afterAll(async()=>{await db?.close();});
it('activates v4 directly from v2 without backfilling previous receipts or reducing counters',async()=>{
 const before=(await db.query<any>('select * from public.receipts order by id')).rows,documents=(await db.query('select * from public.receipt_documents order by version')).rows;
 const counter=(await db.query<any>('select receipt_next_number from public.destinations where id=$1',[destination])).rows[0].receipt_next_number;
 await db.exec(await readFile('docs/activar-comprobante-minue-v4.sql','utf8'));
 expect((await db.query('select * from public.receipts order by id')).rows).toEqual(before);
 expect((await db.query('select * from public.receipt_documents order by version')).rows).toEqual(documents);
 const id=await delivery();const [one,two]=await Promise.all([rpc('confirm_delivery',confirmation(id)),rpc('confirm_delivery',confirmation(id))]);
 expect(one.id).toBe(two.id);expect(one.template_version).toBe(4);expect(one.receipt_number).toBe('PRA-'+String(counter).padStart(3,'0'));
 const docs=(await db.query<any>('select version,pdf_path from public.receipt_documents where receipt_id=$1',[one.id])).rows;
 expect(docs).toEqual([{version:4,pdf_path:'receipts/'+one.id+'/v4.pdf'}]);
 expect((await db.query('select * from private.receipt_drive_jobs where receipt_id=$1',[one.id])).rows).toHaveLength(1);
 expect((await db.query<any>('select receipt_next_number from public.destinations where id=$1',[destination])).rows[0].receipt_next_number).toBe(Number(counter)+1);
 // Reapplying activation and retrying old/new allocations does not issue another number or version.
 await db.exec(await readFile('docs/activar-comprobante-minue-v4.sql','utf8'));
 await db.query('select private.allocate_receipt_number($1)',[before[0].id]);await db.query('select private.allocate_receipt_number($1)',[one.id]);
 expect((await db.query('select version from public.receipt_documents where receipt_id=$1 order by version',[before[0].id])).rows).toEqual([{version:1},{version:2}]);
 expect((await db.query('select * from public.receipts where id=$1',[before[0].id])).rows[0]).toEqual(before[0]);
});
