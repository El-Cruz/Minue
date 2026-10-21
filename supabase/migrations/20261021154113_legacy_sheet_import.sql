-- Additive historical import. Run after receipt_documents_drive; never edits Sheets/Drive.
begin;
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
