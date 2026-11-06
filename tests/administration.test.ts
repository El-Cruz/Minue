import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
let db:PGlite;
const owner='10000000-0000-4000-8000-000000000001',admin='10000000-0000-4000-8000-000000000002',courier='10000000-0000-4000-8000-000000000003';
const dest=crypto.randomUUID(),product=crypto.randomUUID();
async function rpc(action:string,payload:unknown={},actor=owner){return(await db.query<any>('select public.minue_command($1,$2,$3) result',[actor,action,JSON.stringify(payload)])).rows[0].result;}
async function delivered(){const id=crypto.randomUUID();await rpc('save_delivery',{id,destination_id:dest,assigned_to:owner,scheduled_date:'2026-01-01',time_window:'',notes:'',items:[{product_id:product,quantity:2}]});return rpc('confirm_delivery',{delivery_id:id,new_recipient:'Ana',signature_path:`signatures/${id}/${crypto.randomUUID()}.png`,observation:'',request_id:crypto.randomUUID()});}
beforeAll(async()=>{
 db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
 await db.exec(await readFile('supabase/schema.sql','utf8'));
 for(const id of [owner,admin,courier])await db.query('insert into auth.users values($1)',[id]);
 await db.query("insert into public.profiles values($1,'Owner','puntodeentregasminue@gmail.com',true,true,true),($2,'Admin','admin@example.com',true,false,true),($3,'Courier','courier@example.com',false,true,true)",[owner,admin,courier]);
 for(const file of (await readdir('supabase/migrations')).sort().filter(f=>!f.startsWith('20261020174822')))await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 await rpc('save_destination',{id:dest,name:'Pradera',address:'Quito',city:'Quito',phone:'',notes:'',active:true,receipt_code:'PRA',receipt_next_number:71});
 await rpc('save_product',{id:product,name:'Bark Bites',unit:'unidad',category:'cookies',protein:'chicken',species:'dog',active:true});
},30000);
afterAll(async()=>{await db?.close();});
it('keeps units canonical and rejects fractional jars',async()=>{
 expect((await db.query<any>('select unit from public.products where id=$1',[product])).rows[0].unit).toBe('unidad');
 await expect(rpc('save_delivery',{destination_id:dest,assigned_to:owner,scheduled_date:'2026-01-01',time_window:'',notes:'',items:[{product_id:product,quantity:1.5}]})).rejects.toThrow();
});
it('restricts deletion to active superadmins and persists cleanup before removing data',async()=>{
 const receipt=await delivered();
 for(const actor of [admin,courier])await expect(rpc('delete_delivery',{delivery_id:receipt.delivery_id},actor)).rejects.toThrow();
 await rpc('delete_delivery',{delivery_id:receipt.delivery_id});
 expect((await db.query('select id from public.deliveries where id=$1',[receipt.delivery_id])).rows).toHaveLength(0);
 expect((await db.query<any>('select payload from private.maintenance_jobs')).rows.some(r=>r.payload.paths.includes(receipt.snapshot.signature_path))).toBe(true);
});
it('retires used catalogs and prevents ordinary admins changing superadmin profiles',async()=>{
 await delivered();await rpc('delete_product',{id:product},admin);
 expect((await db.query<any>('select active,retired from public.products where id=$1',[product])).rows[0]).toEqual({active:false,retired:true});
 await expect(rpc('update_profile',{id:owner,name:'Changed',is_admin:false,is_courier:true,active:false},admin)).rejects.toThrow();
});
it('previews renumbering, rejects stale previews and blocks emissions until archive completion',async()=>{
 await db.query('update public.products set active=true,retired=false where id=$1',[product]);
 const second=await delivered();
 const preview=await rpc('reorganize_preview',{destination_id:dest,start_number:1});
 expect(preview.mapping).toHaveLength(2);
 expect(preview.mapping.map((r:any)=>r.next)).toEqual(['PRA-001','PRA-002']);
 await expect(rpc('reorganize_receipts',{destination_id:dest,start_number:1,token:'invalid'})).rejects.toThrow('historial cambió');
 const lease=(await db.query<any>("select public.minue_maintenance('acquire_pdf',$1) token",[JSON.stringify({receipt_id:second.id})])).rows[0].token;
 await expect(rpc('delete_delivery',{delivery_id:second.delivery_id})).rejects.toThrow('preparación');
 await db.query("select public.minue_maintenance('release_pdf',$1)",[JSON.stringify({receipt_id:second.id,lease})]);
 await rpc('reorganize_receipts',{destination_id:dest,start_number:1,token:preview.token});
 expect((await db.query<any>('select receipt_next_number from public.destinations where id=$1',[dest])).rows[0].receipt_next_number).toBe(3);
 await expect(rpc('delete_delivery',{delivery_id:second.delivery_id})).rejects.toThrow('reorganizando');
 await expect(delivered()).rejects.toThrow('reorganizando');
 const jobs=(await db.query<any>("select * from private.maintenance_jobs where kind='reorganize'")).rows;
 expect(jobs).toHaveLength(2);
 for(const job of jobs){
   await db.query("update private.maintenance_jobs set state='processing',lease=$2,locked_until=now()+interval '3 minutes' where id=$1",[job.id,job.id]);
   await db.query("select public.minue_maintenance('prepared',$1)",[JSON.stringify({id:job.id,lease:job.id})]);
 }
 await expect(rpc('delete_delivery',{delivery_id:second.delivery_id})).rejects.toThrow('reorganizando');
 expect((await db.query<any>("select payload->>'phase' phase from private.maintenance_jobs where kind='reorganize'")).rows.every(j=>j.phase==='archive')).toBe(true);
});
it('denies inactive accounts and browser roles direct mutation RPC access',async()=>{
 await db.query('update public.profiles set active=false where id=$1',[owner]);
 await expect(rpc('maintenance_status')).rejects.toThrow('inactiva');
 await db.query('update public.profiles set active=true where id=$1',[owner]);
 const permissions=(await db.query<any>("select has_function_privilege('authenticated','public.minue_command(uuid,text,jsonb)','execute') command,has_function_privilege('anon','public.minue_maintenance(text,jsonb)','execute') worker")).rows[0];
 expect(permissions).toEqual({command:false,worker:false});
});
it('only a superadmin grants that role and the last owner cannot revoke it',async()=>{
 const promotion={id:admin,name:'Admin',active:true,is_admin:true,is_courier:false,is_superadmin:true};
 await expect(rpc('update_profile',promotion,admin)).rejects.toThrow('Solo superadministración');
 await expect(rpc('update_profile',{id:owner,name:'Owner',active:true,is_admin:true,is_courier:true,is_superadmin:false})).rejects.toThrow('Debe quedar');
 await rpc('update_profile',promotion);
 expect((await db.query<any>('select is_superadmin from public.profiles where id=$1',[admin])).rows[0].is_superadmin).toBe(true);
});

