import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { demoData, DEMO_USER } from '../src/lib/demo';
import { today, offsetDate } from '../src/lib/dates';
let db: PGlite;
const courier = '10000000-0000-4000-8000-000000000002';
const inactive = '10000000-0000-4000-8000-000000000003';
const data = demoData();
const destination = data.destinations[0].id;
const product = data.products[0].id;
const delivery = data.deliveries[0].id;
const contact = data.contacts[0].id;
async function command(actor: string, action: string, payload: unknown) {
  const result = await db.query<{ result: any }>('select public.minue_command($1::uuid,$2::text,$3::jsonb) as result',[actor,action,JSON.stringify(payload)]);
  return result.rows[0].result;
}
const confirmation = () => ({delivery_id:delivery,recipient_id:contact,new_recipient:'',signature_path:`signatures/${delivery}/${crypto.randomUUID()}.png`,observation:'Entrega refrigerada',request_id:crypto.randomUUID()});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  await db.exec(await readFile('supabase/schema.sql','utf8'));
  for(const id of [DEMO_USER,courier,inactive]) await db.query('insert into auth.users values ($1)',[id]);
  await db.query(`insert into public.profiles values ($1,'Alex','admin@example.com',true,true,true),($2,'Otro repartidor','other@example.com',false,true,true),($3,'Inactivo','inactive@example.com',false,true,false)`,[DEMO_USER,courier,inactive]);
  await command(DEMO_USER,'save_destination',data.destinations[0]);
  for (const value of data.products) await command(DEMO_USER,'save_product',value);
  await command(DEMO_USER,'save_contact',{id:contact,destination_id:destination,name:'Laura Martínez'});
  await command(DEMO_USER,'save_delivery',{ ...data.deliveries[0], items: data.deliveries[0].items.map(item => ({ ...item, name: 'Nombre manipulado desde el navegador', unit: 'unidad falsa' })) });
},30000);
afterAll(async()=>{await db?.close();});
describe('real Postgres transactions and RLS (PGlite)', () => {
  it('uses canonical product names, not client-provided names', async () => {
    const row=await db.query<{items: any[]}>('select items from public.deliveries where id=$1',[delivery]);
    expect(row.rows[0].items[0].name).toBe(data.products[0].name);
  });
  it('blocks another courier, inactive membership, and premature confirmation', async () => {
    await expect(command(courier,'confirm_delivery',confirmation())).rejects.toThrow('Solo puedes confirmar');
    await expect(command(inactive,'confirm_delivery',confirmation())).rejects.toThrow('acceso activo');
    const future={...data.deliveries[0],id:crypto.randomUUID(),scheduled_date:offsetDate(today(),1)};
    await command(DEMO_USER,'save_delivery',future);
    await expect(command(DEMO_USER,'confirm_delivery',{...confirmation(),delivery_id:future.id,signature_path:`signatures/${future.id}/${crypto.randomUUID()}.png`})).rejects.toThrow('todavía');
  });
  it('records failures and preserves attempts after rescheduling', async () => {
    await command(DEMO_USER,'fail_delivery',{delivery_id:delivery,note:'Destino cerrado'});
    await expect(command(DEMO_USER,'confirm_delivery',confirmation())).rejects.toThrow('reprogramación');
    await command(DEMO_USER,'reschedule_delivery',{delivery_id:delivery,scheduled_date:today(),note:'Recepción disponible'});
    const events=await db.query<{kind:string}>('select kind from public.delivery_events where delivery_id=$1',[delivery]);
    expect(events.rows.map(e=>e.kind)).toEqual(['created','failed','rescheduled']);
  });
  it('creates one receipt and event on repeated confirmation', async () => {
    const input=confirmation();
    const first=await command(DEMO_USER,'confirm_delivery',input);
    const again=await command(DEMO_USER,'confirm_delivery',{...input,request_id:crypto.randomUUID()});
    expect(again.id).toBe(first.id);
    expect(first.snapshot.recipient).toBe('Laura Martínez');
    expect(first.snapshot.confirmed_at).toBeTruthy();
    const receipts=await db.query('select * from public.receipts where delivery_id=$1',[delivery]);
    const events=await db.query("select * from public.delivery_events where delivery_id=$1 and kind='delivered'",[delivery]);
    expect(receipts.rows).toHaveLength(1); expect(events.rows).toHaveLength(1);
  });
  it('freezes snapshots and blocks edits or rescheduling after signature', async () => {
    await command(DEMO_USER,'save_product',{...data.products[0],name:'Nombre cambiado'});
    await command(DEMO_USER,'save_destination',{...data.destinations[0],name:'Destino cambiado'});
    const result=await db.query<{snapshot:any}>('select snapshot from public.receipts where delivery_id=$1',[delivery]);
    expect(result.rows[0].snapshot.destination.name).toBe(data.destinations[0].name);
    expect(result.rows[0].snapshot.items[0].name).toBe(data.products[0].name);
    await expect(command(DEMO_USER,'save_delivery',data.deliveries[0])).rejects.toThrow('no se puede modificar');
    await expect(command(DEMO_USER,'reschedule_delivery',{delivery_id:delivery,scheduled_date:today(),note:'Cambio'})).rejects.toThrow('no se puede modificar');
  });
  it('isolates courier reads and denies direct writes and RPC impersonation', async () => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${courier}',false);`);
    expect((await db.query('select * from public.deliveries')).rows).toHaveLength(0);
    expect((await db.query('select * from public.receipts')).rows).toHaveLength(0);
    expect((await db.query('select * from public.contacts')).rows).toHaveLength(0);
    await expect(db.query("update public.profiles set is_admin=true where id=$1",[courier])).rejects.toThrow('permission denied');
    await expect(command(DEMO_USER,'save_product',data.products[0])).rejects.toThrow('permission denied');
    await db.exec('reset role');
  });
  it('allows a courier to read their own assigned delivery and receipt only', async () => {
    const own = { ...data.deliveries[0], id: crypto.randomUUID(), assigned_to: courier };
    await command(DEMO_USER,'save_delivery',own);
    await command(courier,'confirm_delivery',{...confirmation(),delivery_id:own.id,signature_path:`signatures/${own.id}/${crypto.randomUUID()}.png`});
    try {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${courier}',false);`);
      const mine = await db.query<{id:string}>('select id from public.deliveries');
      const receipts = await db.query<{delivery_id:string}>('select delivery_id from public.receipts');
      expect(mine.rows.map(d=>d.id)).toEqual([own.id]);
      expect(receipts.rows.map(r=>r.delivery_id)).toEqual([own.id]);
    } finally { await db.exec('reset role'); }
  });
  it('rejects anonymous access and keeps bucket private', async () => {
    await db.exec('set role anon');
    await expect(db.query('select * from public.deliveries')).rejects.toThrow('permission denied');
    await db.exec('reset role');
    expect((await db.query<{public:boolean}>('select public from storage.buckets')).rows[0].public).toBe(false);
  });
  it('prevents self-deactivation and administrator self-demotion', async () => {
    await expect(command(DEMO_USER,'update_profile',{id:DEMO_USER,name:'Alex',active:false,is_admin:true,is_courier:true})).rejects.toThrow('quitarte el acceso');
    await expect(command(DEMO_USER,'update_profile',{id:DEMO_USER,name:'Alex',active:true,is_admin:false,is_courier:true})).rejects.toThrow('quitarte el acceso');
  });
  it('keeps the reference schema and unapplied deployment migration identical', async () => {
    const reference = await readFile('supabase/schema.sql','utf8');
    const migration = await readFile('supabase/migrations/20261020174822_minue_delivery_system.sql','utf8');
    expect(migration).toBe(reference);
  });
});
