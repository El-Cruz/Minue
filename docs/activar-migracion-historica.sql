-- Apply once to the existing Minue database. Structure and numbering metadata; no historical delivery rows are imported.
-- Use when the receipt_documents_drive migration has NOT been applied yet.
begin;
-- Additive migration: original PDFs, snapshots and internal folios are preserved.
alter table public.destinations add column receipt_code text unique check(receipt_code ~ '^[A-Z0-9]{2,8}$');
alter table public.destinations add column receipt_next_number bigint not null default 1 check(receipt_next_number > 0);
alter table public.receipts add column receipt_number text unique;
alter table public.receipts add column template_version integer not null default 1;
alter table public.receipts alter column template_version set default 2;
alter table public.receipts add column drive_status text not null default 'pending' check(drive_status in ('pending','saved','reconnect'));

create table public.receipt_documents (
  receipt_id uuid not null references public.receipts(id),
  version integer not null check(version in (1,2)),
  pdf_path text not null unique,
  checksum text,
  created_at timestamptz not null default now(),
  primary key(receipt_id,version)
);
alter table public.receipt_documents enable row level security;
create policy documents_read on public.receipt_documents for select to authenticated
using(exists(select 1 from public.receipts r where r.id=receipt_id));
revoke all on public.receipt_documents from public,anon,authenticated;
grant select on public.receipt_documents to authenticated;
grant all on public.receipt_documents to service_role;

create table private.drive_connection (
  id boolean primary key default true check(id),
  email text not null check(email='puntodeentregasminue@gmail.com'),
  encrypted_token text not null,
  state text not null default 'connected' check(state in ('connected','reconnect')),
  updated_at timestamptz not null default now()
);
create table private.drive_folders (
  folder_key text primary key,
  google_id text not null unique,
  parent_id text,
  name text not null
);
create table private.receipt_drive_jobs (
  receipt_id uuid primary key references public.receipts(id),
  state text not null default 'pending' check(state in ('pending','processing','saved','reconnect')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease uuid,
  locked_until timestamptz,
  google_id text unique,
  last_error text,
  saved_at timestamptz
);
create index drive_jobs_due on private.receipt_drive_jobs(next_attempt_at) where state in ('pending','processing');
revoke all on private.drive_connection,private.drive_folders,private.receipt_drive_jobs from public,anon,authenticated;
grant all on private.drive_connection,private.drive_folders,private.receipt_drive_jobs to service_role;

-- This project has one existing destination; configure only that explicit record.
update public.destinations set receipt_code='PRA',receipt_next_number=65
where id='56374960-a55c-4093-9947-c95dffbbdea6'::uuid;
-- 1 kg is already a weight, not a portion count.
update public.products set unit='kg' where lower(trim(unit)) in ('kg','1 kg','1kg');

create function private.allocate_receipt_number(p_receipt uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare r public.receipts; d public.destinations; destination_id uuid; number bigint;
begin
  select * into r from public.receipts where id=p_receipt for update;
  if not found then raise exception 'No se encontró el comprobante.'; end if;
  if r.receipt_number is null then
    select x.destination_id into destination_id from public.deliveries x where x.id=r.delivery_id;
    select * into d from public.destinations where id=destination_id for update;
    if d.receipt_code is null then raise exception 'Configura el código del destino antes de emitir su comprobante.'; end if;
    number:=d.receipt_next_number;
    update public.destinations set receipt_next_number=number+1 where id=d.id;
    update public.receipts set receipt_number=d.receipt_code||'-'||lpad(number::text,greatest(3,length(number::text)),'0'),template_version=2 where id=r.id;
  end if;
  insert into public.receipt_documents(receipt_id,version,pdf_path)
  values(r.id,2,'receipts/'||r.id::text||'/v2.pdf') on conflict do nothing;
  insert into private.receipt_drive_jobs(receipt_id) values(r.id) on conflict do nothing;
end;
$$;
revoke all on function private.allocate_receipt_number(uuid) from public,anon,authenticated;
grant execute on function private.allocate_receipt_number(uuid) to service_role;

create function private.enqueue_receipt() returns trigger language plpgsql security invoker set search_path='' as $$
begin perform private.allocate_receipt_number(new.id); return new; end;
$$;
revoke all on function private.enqueue_receipt() from public,anon,authenticated;
create trigger receipt_archive after insert on public.receipts for each row execute function private.enqueue_receipt();

-- Backfill in delivery order; preserve the original file path before creating v2.
insert into public.receipt_documents(receipt_id,version,pdf_path)
select id,1,coalesce(pdf_path,'receipts/'||id::text||'.pdf') from public.receipts;
do $$ declare r record; begin
  for r in select id from public.receipts order by created_at,id loop
    perform private.allocate_receipt_number(r.id);
  end loop;
end $$;

-- Wrap the existing, tested transaction without changing its original snapshots.
alter function public.minue_command(uuid,text,jsonb) set schema private;
create function public.minue_command(p_actor uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; d public.destinations; code text; next_number bigint; issued boolean;
begin
  if p_action='save_product' then p_payload:=p_payload||jsonb_build_object('unit','kg'); end if;
  if p_action='save_destination' then
    code:=upper(trim(p_payload->>'receipt_code'));
    if code is null or code !~ '^[A-Z0-9]{2,8}$' then raise exception 'Agrega un código de 2 a 8 letras o números.'; end if;
    next_number:=(p_payload->>'receipt_next_number')::bigint;
    if next_number < 1 then raise exception 'Revisa el siguiente número del comprobante.'; end if;
    if nullif(p_payload->>'id','') is not null then
      select * into d from public.destinations where id=(p_payload->>'id')::uuid for update;
      next_number:=coalesce(next_number,d.receipt_next_number);
      select exists(select 1 from public.receipts r join public.deliveries x on x.id=r.delivery_id where x.destination_id=d.id) into issued;
      if issued and (code is distinct from d.receipt_code or next_number <> d.receipt_next_number) then
        raise exception 'La numeración de un destino con comprobantes emitidos no se puede cambiar.';
      end if;
    end if;
  end if;
  if p_action='save_delivery' and exists(
    select 1 from jsonb_array_elements(p_payload->'items') i join public.products p on p.id=(i->>'product_id')::uuid where p.unit<>'kg'
  ) then raise exception 'Las nuevas entregas deben registrarse en kg.'; end if;
  if p_action='confirm_delivery' and exists(
    select 1 from public.deliveries x,jsonb_array_elements(x.items) i where x.id=(p_payload->>'delivery_id')::uuid and lower(trim(i->>'unit')) not in ('kg','1 kg','1kg')
  ) then raise exception 'Revisa los kg de la entrega antes de confirmar.'; end if;
  next_number:=coalesce(next_number,1);
  result:=private.minue_command(p_actor,p_action,p_payload);
  if p_action='save_destination' then
    update public.destinations set receipt_code=code,receipt_next_number=next_number where id=(result->>'id')::uuid;
  elsif p_action='confirm_delivery' then
    select to_jsonb(r) into result from public.receipts r where id=(result->>'id')::uuid;
  end if;
  return result;
end;
$$;
revoke all on function public.minue_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.minue_command(uuid,text,jsonb) to service_role;

-- Private data is reachable through this service-only RPC, never through browser clients.
create function public.minue_drive(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; j private.receipt_drive_jobs; token uuid; delay_minutes integer;
begin
  if p_action='connection_get' then
    select to_jsonb(c) into result from private.drive_connection c where id;
  elsif p_action='connection_set' then
    insert into private.drive_connection(id,email,encrypted_token) values(true,p_payload->>'email',p_payload->>'encrypted_token')
    on conflict(id) do update set encrypted_token=excluded.encrypted_token,state='connected',updated_at=now();
    update private.receipt_drive_jobs set state='pending',next_attempt_at=now() where state='reconnect';
    update public.receipts set drive_status='pending' where drive_status='reconnect';
  elsif p_action='connection_reconnect' then
    update private.drive_connection set state='reconnect' where id;
    update private.receipt_drive_jobs set state='reconnect',lease=null,locked_until=null where state<>'saved';
    update public.receipts set drive_status='reconnect' where drive_status<>'saved';
  elsif p_action='folder_reserve' then
    insert into private.drive_folders(folder_key,google_id,parent_id,name)
    values(p_payload->>'key',p_payload->>'google_id',p_payload->>'parent_id',p_payload->>'name') on conflict do nothing;
    select to_jsonb(f) into result from private.drive_folders f where folder_key=p_payload->>'key';
  elsif p_action='folder_get' then
    select to_jsonb(f) into result from private.drive_folders f where folder_key=p_payload->>'key';
  elsif p_action='claim' then
    with due as (
      select receipt_id from private.receipt_drive_jobs
      where ((state='pending' and next_attempt_at<=now()) or (state='processing' and locked_until<now()))
      and (p_payload->>'receipt_id' is null or receipt_id=(p_payload->>'receipt_id')::uuid)
      order by next_attempt_at for update skip locked limit 3
    ), claimed as (
      update private.receipt_drive_jobs x set state='processing',attempts=attempts+1,lease=gen_random_uuid(),locked_until=now()+interval '3 minutes'
      from due where x.receipt_id=due.receipt_id returning x.*
    ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
  elsif p_action='retry' then
    update private.receipt_drive_jobs set state='pending',next_attempt_at=now()
    where receipt_id=(p_payload->>'receipt_id')::uuid and state in ('pending','reconnect');
    update public.receipts set drive_status='pending' where id=(p_payload->>'receipt_id')::uuid and drive_status<>'saved';
  elsif p_action in ('file_id','saved','failed') then
    select * into j from private.receipt_drive_jobs where receipt_id=(p_payload->>'receipt_id')::uuid for update;
    if j.lease is distinct from (p_payload->>'lease')::uuid or j.state<>'processing' or j.locked_until<now() then
      raise exception 'La tarea ya no está asignada a este proceso.';
    end if;
    if p_action='file_id' then
      update private.receipt_drive_jobs set google_id=coalesce(google_id,p_payload->>'google_id') where receipt_id=j.receipt_id returning to_jsonb(private.receipt_drive_jobs.*) into result;
    elsif p_action='saved' then
      update private.receipt_drive_jobs set state='saved',saved_at=now(),last_error=null,lease=null,locked_until=null where receipt_id=j.receipt_id;
      update public.receipts set drive_status='saved' where id=j.receipt_id;
    else
      delay_minutes:=case when j.attempts<=1 then 5 when j.attempts=2 then 15 when j.attempts=3 then 60 else 360 end;
      update private.receipt_drive_jobs set state='pending',next_attempt_at=now()+make_interval(mins=>greatest(delay_minutes,coalesce((p_payload->>'retry_minutes')::integer,0))),last_error=left(p_payload->>'error',120),lease=null,locked_until=null where receipt_id=j.receipt_id;
      update public.receipts set drive_status='pending' where id=j.receipt_id;
    end if;
  else raise exception 'Acción de archivo no válida.';
  end if;
  return coalesce(result,'null'::jsonb);
end;
$$;
revoke all on function public.minue_drive(text,jsonb) from public,anon,authenticated;
grant execute on function public.minue_drive(text,jsonb) to service_role;
notify pgrst,'reload schema';


-- Additive historical import. Run after receipt_documents_drive; never edits Sheets/Drive.
alter table public.destinations add column legacy_imported boolean not null default false;
alter table public.destinations alter column address drop not null;
alter table public.destinations add constraint destination_missing_address_history_only
 check(address is not null or (legacy_imported and not active));
alter table public.deliveries add column legacy_source text;
alter table public.deliveries add column legacy_id text;
alter table public.deliveries add column legacy_code text;
alter table public.deliveries add column legacy_courier text;
alter table public.deliveries add column legacy_profile_ids uuid[] not null default '{}';
alter table public.deliveries add unique(legacy_source,legacy_id);
alter table public.deliveries alter column assigned_to drop not null;
alter table public.deliveries add constraint delivery_assignment_required
 check(assigned_to is not null or (legacy_source is not null and legacy_id is not null));
alter table public.receipts add column legacy_source text;
alter table public.receipts add column legacy_id text;
alter table public.receipts add column legacy_pdf_url text;
alter table public.receipts add column legacy_signature_reference text;
alter table public.receipts add unique(legacy_source,legacy_id);

create table private.legacy_import_batches(
 source_key text not null,source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 payload jsonb not null,counts jsonb not null,imported_at timestamptz not null default now(),
 primary key(source_key,source_sha256)
);
create table private.legacy_rows(
 source_key text not null,entity text not null check(entity in ('product','destination','delivery','line')),
 legacy_id text not null,app_id uuid not null,payload jsonb not null,
 primary key(source_key,entity,legacy_id)
);
alter table private.legacy_import_batches enable row level security;
alter table private.legacy_rows enable row level security;
revoke all on private.legacy_import_batches,private.legacy_rows from public,anon,authenticated;
grant all on private.legacy_import_batches,private.legacy_rows to service_role;

-- Historical receipts keep their original number/PDF and never enqueue a redesign.
create or replace function private.enqueue_receipt() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.legacy_id is null then perform private.allocate_receipt_number(new.id); end if;
 return new;
end;
$$;
revoke all on function private.enqueue_receipt() from public,anon,authenticated;
drop policy deliveries_read on public.deliveries;
create policy deliveries_read on public.deliveries for select to authenticated
using((select private.is_active()) and (assigned_to=(select auth.uid()) or (select auth.uid())=any(legacy_profile_ids) or (select private.is_admin())));

create function public.minue_import_legacy(p_actor uuid,p_payload jsonb,p_assignments jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 source text:=p_payload->>'source_key';sha text:=p_payload->>'sha256';
 v_record jsonb;line jsonb;recorded jsonb;raw jsonb;items jsonb;members uuid[];
 app_id uuid;destination_id uuid;product_id uuid;receipt_id uuid;existing_count integer;
 mapped private.legacy_rows;dest public.destinations;code text;prefix text;next_number bigint;date timestamptz;
 counts jsonb;line_count integer:=0;delivery_count integer:=0;
begin
 if not exists(select 1 from public.profiles where id=p_actor and active and is_admin) then raise exception 'Se requiere administración activa.'; end if;
 if p_payload->>'format' is distinct from 'minue-legacy-v1' or source is null or source !~ '^[A-Za-z0-9_-]{20,200}$' or sha is null or sha !~ '^[a-f0-9]{64}$' then raise exception 'Formato de importación no válido.'; end if;
 if jsonb_typeof(p_payload->'products') is distinct from 'array' or jsonb_typeof(p_payload->'destinations') is distinct from 'array' or jsonb_typeof(p_payload->'deliveries') is distinct from 'array' then raise exception 'Faltan tablas de la fuente.'; end if;
 perform pg_advisory_xact_lock(72841002);
 select payload into recorded from private.legacy_import_batches where source_key=source and source_sha256=sha;
 if recorded is not null and recorded<>p_payload then raise exception 'El mismo archivo tiene un contenido preparado diferente; revisa la importación.'; end if;

 for v_record in select value from jsonb_array_elements(p_payload->'products') loop
  if v_record->>'species' not in ('dog','cat','both') or v_record->>'species' is null then raise exception 'Revisa las especies del catálogo.'; end if;
  select * into mapped from private.legacy_rows where source_key=source and private.legacy_rows.entity='product' and legacy_id=v_record->>'legacy_id';
  if found then
   if mapped.payload<>v_record->'raw' then raise exception 'Una receta importada cambió en la fuente; requiere revisión.'; end if;
   app_id:=mapped.app_id;
  else
   select count(*),min(id::text)::uuid into existing_count,app_id from public.products where name=v_record->>'name';
   if existing_count>1 then raise exception 'Hay productos con el mismo nombre; revisa su relación.'; end if;
   if app_id is null then
    insert into public.products(name,unit,species,active) values(v_record->>'name','kg',v_record->>'species',true) returning id into app_id;
   end if;
   insert into private.legacy_rows values(source,'product',v_record->>'legacy_id',app_id,v_record->'raw');
  end if;
 end loop;

 for v_record in select value from jsonb_array_elements(p_payload->'destinations') loop
  prefix:=v_record->>'code';
  if prefix is null or prefix !~ '^[A-Z0-9]{2,8}$' then raise exception 'Código de destino no válido.'; end if;
  raw:=jsonb_build_object('name',v_record->>'name','code',prefix);
  select * into mapped from private.legacy_rows where source_key=source and private.legacy_rows.entity='destination' and legacy_id=v_record->>'name';
  if found then
   if mapped.payload<>raw then raise exception 'Un destino importado cambió; requiere revisión.'; end if;
   app_id:=mapped.app_id;
  else
   select count(*),min(id::text)::uuid into existing_count,app_id from public.destinations where receipt_code=prefix or name=v_record->>'name';
   if existing_count>1 then raise exception 'El nombre y código del destino apuntan a registros distintos.'; end if;
   if app_id is null then
    insert into public.destinations(name,address,city,active,legacy_imported,receipt_code)
    values(v_record->>'name',null,'Quito',false,true,prefix) returning id into app_id;
   end if;
   insert into private.legacy_rows values(source,'destination',v_record->>'name',app_id,raw);
  end if;
  select * into dest from public.destinations where id=app_id for update;
  if dest.receipt_code is not null and dest.receipt_code<>prefix then raise exception 'El destino ya tiene otro código.'; end if;
  select coalesce(max(substring(receipt_number from length(prefix)+2)::bigint)+1,1) into next_number
  from public.receipts where receipt_number ~ ('^'||prefix||'-[0-9]+$');
  update public.destinations set receipt_code=prefix,receipt_next_number=greatest(receipt_next_number,next_number,(v_record->>'next_number')::bigint) where id=app_id;
 end loop;

 for v_record in select value from jsonb_array_elements(p_payload->'deliveries') loop
  if v_record->>'status' not in ('pending','delivered') or v_record->>'status' is null then raise exception 'Estado histórico desconocido.'; end if;
  code:=v_record->>'code';date:=(v_record->>'date')::timestamptz;
  if code is null or code !~ '^[A-Z0-9]{2,8}-[0-9]+$' or date is null then raise exception 'Código o fecha de entrega no válido.'; end if;
  select private.legacy_rows.app_id into destination_id from private.legacy_rows where source_key=source and private.legacy_rows.entity='destination' and legacy_id=v_record->>'destination';
  if destination_id is null then raise exception 'No se resolvió el destino.'; end if;
  members:='{}';
  if p_assignments ? (v_record->>'courier') then
   if jsonb_typeof(p_assignments->(v_record->>'courier'))<>'array' then raise exception 'Revisa las asignaciones de perfiles.'; end if;
   select coalesce(array_agg(distinct value::uuid),'{}') into members from jsonb_array_elements_text(p_assignments->(v_record->>'courier'));
   if exists(select 1 from unnest(members) member where not exists(select 1 from public.profiles where id=member and active and is_courier)) then raise exception 'Un perfil de reparto no existe o no está activo.'; end if;
  end if;
  select * into mapped from private.legacy_rows where source_key=source and private.legacy_rows.entity='delivery' and legacy_id=v_record->>'legacy_id';
  if found then
   if mapped.payload<>v_record->'raw' then raise exception 'Una entrega importada cambió en la fuente; no se sobrescribirá.'; end if;
   app_id:=mapped.app_id;
   if p_assignments ? (v_record->>'courier') then update public.deliveries set legacy_profile_ids=members where id=app_id; end if;
  else
   app_id:=gen_random_uuid();
  end if;
  items:='[]';
  for line in select value from jsonb_array_elements(v_record->'items') loop
   if (line->>'quantity')::numeric<0 or (line->>'quantity')::numeric>100000 or line->>'quantity' is null then raise exception 'Cantidad histórica no válida.'; end if;
   select private.legacy_rows.app_id into product_id from private.legacy_rows where source_key=source and private.legacy_rows.entity='product' and legacy_id=line->>'recipe_id';
   if product_id is null then raise exception 'No se resolvió la receta de un producto.'; end if;
   items:=items||jsonb_build_array(jsonb_build_object('product_id',product_id,'name',line->>'name','quantity',(line->>'quantity')::numeric,'unit','kg','legacy_line_id',line->>'legacy_id','legacy_code',line->'raw'->>'CodigoEntrega'));
   select * into mapped from private.legacy_rows where source_key=source and private.legacy_rows.entity='line' and legacy_id=line->>'legacy_id';
   if found then
    if mapped.app_id<>app_id or mapped.payload<>line->'raw' then raise exception 'Una línea histórica cambió o apunta a otra entrega.'; end if;
   else
    insert into private.legacy_rows values(source,'line',line->>'legacy_id',app_id,line->'raw');
   end if;
   line_count:=line_count+1;
  end loop;
  if jsonb_array_length(items)=0 then raise exception 'Una entrega no tiene productos.'; end if;
  if exists(select 1 from public.deliveries where id=app_id) then
   if (select public.deliveries.items from public.deliveries where id=app_id)<>items then raise exception 'Los productos históricos no coinciden; no se sobrescribirán.'; end if;
  else
   insert into public.deliveries(id,destination_id,assigned_to,scheduled_date,status,items,created_at,legacy_source,legacy_id,legacy_code,legacy_courier,legacy_profile_ids)
   values(app_id,destination_id,null,(date at time zone 'America/Guayaquil')::date,v_record->>'status',items,date,source,v_record->>'legacy_id',code,v_record->>'courier',members);
   insert into private.legacy_rows values(source,'delivery',v_record->>'legacy_id',app_id,v_record->'raw');
   if v_record->>'status'='delivered' then
    if coalesce(v_record->>'pdf_url','')<>'' and (v_record->>'pdf_url') !~ '^https://drive\.google\.com/file/d/[A-Za-z0-9_-]+/view([?].*)?$' then raise exception 'Enlace de comprobante no válido.'; end if;
    select * into dest from public.destinations where id=destination_id;
    insert into public.receipts(delivery_id,request_id,folio,receipt_number,template_version,snapshot,created_at,legacy_source,legacy_id,legacy_pdf_url,legacy_signature_reference)
    values(app_id,gen_random_uuid(),code,code,1,
     jsonb_build_object('destination',jsonb_build_object('name',v_record->>'destination','address',dest.address,'city','Quito'),
      'items',items,'courier',v_record->>'courier','recipient',coalesce(v_record->>'recipient',''),'observation',coalesce(v_record->>'observation',''),
      'scheduled_date',(date at time zone 'America/Guayaquil')::date,'confirmed_at',date,'signature_path',''),
     date,source,v_record->>'legacy_id',nullif(v_record->>'pdf_url',''),v_record->>'signature_reference') returning id into receipt_id;
   end if;
  end if;
  delivery_count:=delivery_count+1;
 end loop;
 counts:=jsonb_build_object('deliveries',delivery_count,'lines',line_count,'products',jsonb_array_length(p_payload->'products'),'destinations',jsonb_array_length(p_payload->'destinations'));
 insert into private.legacy_import_batches(source_key,source_sha256,payload,counts) values(source,sha,p_payload,counts) on conflict do nothing;
 return counts;
end;
$$;
revoke all on function public.minue_import_legacy(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.minue_import_legacy(uuid,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';


commit;
