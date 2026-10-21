import {afterAll,beforeAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
let db:PGlite;
const admin='10000000-0000-4000-8000-000000000001',courier='10000000-0000-4000-8000-000000000002',other='10000000-0000-4000-8000-000000000003';
const source='synthetic_source_for_legacy_tests';
const products=[{legacy_id:'Receta de ejemplo',name:'Receta de ejemplo',species:'dog',raw:{'ID Receta':'Receta de ejemplo','Nombre Receta':'Receta de ejemplo'}}];
const payload={format:'minue-legacy-v1',source_key:source,sha256:'a'.repeat(64),products,destinations:[{name:'Destino histórico',code:'HIS',next_number:43}],deliveries:[{
 legacy_id:'old-delivery-id',code:'HIS-042',destination:'Destino histórico',date:'2026-05-06T17:00:00+00:00',status:'delivered',courier:'Persona histórica / Otra persona',recipient:'Receptor de ejemplo',observation:'Observación original',signature_reference:'Old_Images/signature.png',pdf_url:'https://drive.google.com/file/d/synthetic_pdf_id/view',raw:{ID:'old-delivery-id',CodigoEntrega:'HIS-042',Firma:'Old_Images/signature.png',GenerarComprobante:false},
 items:[{legacy_id:'line-1',recipe_id:'Receta de ejemplo',name:'Receta de ejemplo',quantity:1.125,raw:{IDProducto:'line-1',IDEntrega:'old-delivery-id',CodigoEntrega:'OTHER-042',Kg:1.125}},{legacy_id:'line-zero',recipe_id:'Receta de ejemplo',name:'Receta de ejemplo',quantity:0,raw:{IDProducto:'line-zero',IDEntrega:'old-delivery-id',CodigoEntrega:'HIS-042',Kg:0}}]
}]};
const run=async(input:any=payload,assignments:Record<string,string[]>={})=>(await db.query<any>('select public.minue_import_legacy($1,$2,$3) result',[admin,JSON.stringify(input),JSON.stringify(assignments)])).rows[0].result;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
 await db.exec(await readFile('supabase/schema.sql','utf8'));
 await db.query('insert into auth.users values($1),($2),($3)',[admin,courier,other]);
 await db.query("insert into public.profiles values($1,'Admin','admin@example.com',true,true,true),($2,'Repartidor','courier@example.com',false,true,true),($3,'Otro','other@example.com',false,true,true)",[admin,courier,other]);
 await db.exec(await readFile('supabase/migrations/20261021043305_receipt_documents_drive.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261021154113_legacy_sheet_import.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261021155718_two_couriers.sql','utf8'));
},30000);
afterAll(async()=>{await db?.close();});
it('imports original IDs, decimal and zero kg, signature references and original PDF without redesign or new archive jobs',async()=>{
 expect(await run()).toEqual({deliveries:1,lines:2,products:1,destinations:1});
 const [d]=(await db.query<any>('select * from public.deliveries')).rows;
 const [r]=(await db.query<any>('select * from public.receipts')).rows;
 expect(d.assigned_to).toBeNull();expect(d.legacy_id).toBe('old-delivery-id');expect(d.items.map((i:any)=>i.quantity)).toEqual([1.125,0]);
 expect(d.items[0].legacy_code).toBe('OTHER-042');expect(r.receipt_number).toBe('HIS-042');expect(r.template_version).toBe(1);
 expect(r.snapshot.courier).toBe(payload.deliveries[0].courier);expect(r.snapshot.observation).toBe('Observación original');
 expect(r.legacy_pdf_url).toBe(payload.deliveries[0].pdf_url);expect(r.legacy_signature_reference).toBe('Old_Images/signature.png');
 expect(new Date(r.created_at).toISOString()).toBe('2026-05-06T17:00:00.000Z');
 expect((await db.query('select * from private.receipt_drive_jobs')).rows).toHaveLength(0);
 expect((await db.query('select * from public.receipt_documents')).rows).toHaveLength(0);
 const [dest]=(await db.query<any>('select * from public.destinations')).rows;
 expect(dest.address).toBeNull();expect(dest.active).toBe(false);expect(dest.receipt_next_number).toBe(43);
});
it('reimport is idempotent and never lowers the current counter',async()=>{
 await db.exec('update public.destinations set receipt_next_number=99');
 await run();expect((await db.query('select * from public.receipts')).rows).toHaveLength(1);
 expect((await db.query<any>('select receipt_next_number from public.destinations')).rows[0].receipt_next_number).toBe(99);
 expect((await db.query('select * from private.legacy_rows')).rows).toHaveLength(5);
});
it('rejects source changes and rolls back every insertion in that attempt',async()=>{
 const changed=structuredClone(payload);changed.sha256='b'.repeat(64);changed.products.push({legacy_id:'Nueva receta',name:'Nueva receta',species:'cat',raw:{'ID Receta':'Nueva receta','Nombre Receta':'Nueva receta'}});
 changed.deliveries[0].raw.Firma='different.png';
 await expect(run(changed)).rejects.toThrow('no se sobrescribirá');
 expect((await db.query('select * from public.products')).rows).toHaveLength(1);
 expect((await db.query('select * from private.legacy_import_batches')).rows).toHaveLength(1);
});
it('grants historical access only to explicit profile mappings and administrators',async()=>{
 await run(payload,{[payload.deliveries[0].courier]:[courier]});
 await db.exec("set role authenticated;select set_config('request.jwt.claim.sub','"+courier+"',false);");
 expect((await db.query('select * from public.receipts')).rows).toHaveLength(1);
 await expect(db.query('select * from private.legacy_rows')).rejects.toThrow('permission denied');
 await expect(run()).rejects.toThrow('permission denied');
 await db.exec("select set_config('request.jwt.claim.sub','"+other+"',false);");
 expect((await db.query('select * from public.receipts')).rows).toHaveLength(0);
 await db.exec('reset role');
});
it('does not infer a recipient, address, user account or confirmed signature when missing',async()=>{
 expect((await db.query('select * from public.contacts')).rows).toHaveLength(0);
 expect((await db.query('select * from public.profiles')).rows).toHaveLength(3);
 expect((await db.query<any>('select snapshot from public.receipts')).rows[0].snapshot.signature_path).toBe('');
});

it('links up to two historical couriers without rewriting the receipt',async()=>{
 const [delivery]=(await db.query<any>('select * from public.deliveries')).rows;
 const [before]=(await db.query<any>('select snapshot,receipt_number from public.receipts')).rows;
 await db.query('select public.minue_command($1,$2,$3)',[admin,'link_legacy_couriers',JSON.stringify({delivery_id:delivery.id,profile_ids:[courier,other]})]);
 const [saved]=(await db.query<any>('select assigned_to,partner_id,legacy_profile_ids from public.deliveries')).rows;
 expect(saved.assigned_to).toBe(courier);expect(saved.partner_id).toBe(other);expect(saved.legacy_profile_ids).toEqual([courier,other]);
 expect((await db.query('select snapshot,receipt_number from public.receipts')).rows[0]).toEqual(before);
 await expect(db.query('select public.minue_command($1,$2,$3)',[courier,'link_legacy_couriers',JSON.stringify({delivery_id:delivery.id,profile_ids:[]})])).rejects.toThrow('administración');
});
it('lets either assigned courier confirm once and rejects duplicate courier assignments',async()=>{
 const [product]=(await db.query<any>('select id from public.products')).rows;
 const [dest]=(await db.query<any>('select id from public.destinations')).rows;
 await db.query("update public.destinations set address='Dirección de prueba',active=true where id=$1",[dest.id]);
 const id=crypto.randomUUID(),command=async(actor:string,action:string,payload:unknown)=>(await db.query<any>('select public.minue_command($1,$2,$3) result',[actor,action,JSON.stringify(payload)])).rows[0].result;
 const input={id,destination_id:dest.id,assigned_to:courier,partner_id:other,scheduled_date:'2026-05-06',time_window:'',notes:'',items:[{product_id:product.id,quantity:1.25}]};
 await expect(command(admin,'save_delivery',{...input,partner_id:courier})).rejects.toThrow('diferente');
 await command(admin,'save_delivery',input);
 const confirm={delivery_id:id,recipient_id:null,new_recipient:'Receptor de prueba',observation:'',signature_path:'signatures/'+id+'/'+crypto.randomUUID()+'.png',request_id:crypto.randomUUID()};
 const first=await command(other,'confirm_delivery',confirm),again=await command(courier,'confirm_delivery',{...confirm,request_id:crypto.randomUUID()});
 expect(first.id).toBe(again.id);expect(first.snapshot.courier).toBe('Repartidor / Otro');expect(first.snapshot.confirmed_by).toBe('Otro');
 expect((await db.query('select * from public.receipts where delivery_id=$1',[id])).rows).toHaveLength(1);
 expect((await db.query("select * from public.delivery_events where delivery_id=$1 and kind='delivered'",[id])).rows).toHaveLength(1);
});
