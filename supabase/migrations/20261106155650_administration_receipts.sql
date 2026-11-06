begin;
alter table public.profiles add column is_superadmin boolean not null default false;
do $$begin
 if not exists(select 1 from public.profiles where lower(email)='puntodeentregasminue@gmail.com') then raise exception 'No se encontró la cuenta inicial de superadministración.';end if;
 update public.profiles set is_superadmin=true,is_admin=true,active=true where lower(email)='puntodeentregasminue@gmail.com';
end$$;
alter table public.destinations add column retired boolean not null default false;
alter table public.products add column retired boolean not null default false;
alter table public.products add column category text not null default 'diet' check(category in ('diet','cookies'));
alter table public.products add column protein text not null default 'other' check(protein in ('chicken','beef','fish','turkey','pork','mixed','other'));
update public.products set unit='unidad',category='cookies' where name ilike '%bark%bites%';
update public.deliveries x set items=(select jsonb_agg(case when p.category='cookies' then i.value||jsonb_build_object('unit','unidad') else i.value end order by i.ord) from jsonb_array_elements(x.items) with ordinality i(value,ord) left join public.products p on p.id=(i.value->>'product_id')::uuid) where x.status='pending' and x.legacy_id is null;
alter table public.receipts add column current_pdf_path text;
create table private.maintenance_config(id boolean primary key default true check(id),enabled boolean not null default true);
insert into private.maintenance_config values(true,true);
create table private.maintenance_jobs(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('delete','reorganize')),destination_id uuid not null,payload jsonb not null,state text not null default 'pending' check(state in ('pending','processing','done')),lease uuid,locked_until timestamptz,attempts integer not null default 0,next_attempt_at timestamptz not null default now(),last_error text,created_at timestamptz not null default now());
create table private.receipt_leases(receipt_id uuid primary key references public.receipts(id),lease uuid not null,expires_at timestamptz not null);
alter table private.maintenance_config enable row level security;
alter table private.maintenance_jobs enable row level security;
alter table private.receipt_leases enable row level security;
revoke all on private.maintenance_config,private.maintenance_jobs,private.receipt_leases from public,anon,authenticated;
grant all on private.maintenance_config,private.maintenance_jobs,private.receipt_leases to service_role;
alter function public.minue_command(uuid,text,jsonb) rename to minue_command_previous;
alter function public.minue_command_previous(uuid,text,jsonb) set schema private;
create function public.minue_command(p_actor uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor public.profiles;target uuid;r public.receipts;d public.destinations;j uuid;mapping jsonb;entry jsonb;paths jsonb;result jsonb;
begin
 perform pg_advisory_xact_lock(72841003);
 select * into actor from public.profiles where id=p_actor and active for update;
 if actor.id is null then raise exception 'Cuenta inactiva.';end if;
 if p_action not in ('confirm_delivery','fail_delivery') and not actor.is_admin then raise exception 'Se requiere administración.';end if;
 if p_action in ('delete_delivery','reorganize_preview','reorganize_receipts','maintenance_status') and not actor.is_superadmin then raise exception 'Se requiere superadministración.';end if;
 if p_action='update_profile' and exists(select 1 from public.profiles where id=(p_payload->>'id')::uuid and is_superadmin) and (not actor.is_superadmin or not (p_payload->>'active')::boolean or not (p_payload->>'is_admin')::boolean) then raise exception 'La cuenta de superadministración está protegida.';end if;
 if p_action='update_profile' and p_payload ? 'is_superadmin' then
  if not actor.is_superadmin then raise exception 'Solo superadministración puede asignar este permiso.';end if;
  if (p_payload->>'is_superadmin')::boolean and (not (p_payload->>'active')::boolean or not (p_payload->>'is_admin')::boolean) then raise exception 'Superadministración requiere una cuenta administradora activa.';end if;
  if not (p_payload->>'is_superadmin')::boolean and exists(select 1 from public.profiles where id=(p_payload->>'id')::uuid and is_superadmin) and not exists(select 1 from public.profiles where id<>(p_payload->>'id')::uuid and active and is_superadmin) then raise exception 'Debe quedar un superadministrador activo.';end if;
 end if;
 if p_action='maintenance_status' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'destination_id',destination_id,'state',state,'error',last_error) order by created_at desc),'[]') into result from private.maintenance_jobs where state<>'done' or created_at>now()-interval '1 day';
  return jsonb_build_object('jobs',result,'reorganization_enabled',(select enabled from private.maintenance_config where id));
 end if;
 if p_action in ('delete_destination','delete_product') then
  target:=(p_payload->>'id')::uuid;
  if p_action='delete_destination' then
   if exists(select 1 from public.deliveries where destination_id=target) or exists(select 1 from private.legacy_rows where app_id=target) then update public.destinations set active=false,retired=true where id=target;
   else delete from public.contacts where destination_id=target;delete from public.destinations where id=target;end if;
  else
   if exists(select 1 from public.deliveries x,jsonb_array_elements(x.items) i where i->>'product_id'=target::text) or exists(select 1 from private.legacy_rows where app_id=target) then update public.products set active=false,retired=true where id=target;
   else delete from public.products where id=target;end if;
  end if;
  return '{}'::jsonb;
 end if;
 if p_action in ('confirm_delivery','delete_delivery') then select destination_id into target from public.deliveries where id=(p_payload->>'delivery_id')::uuid;
 elsif p_action in ('save_delivery','reorganize_preview','reorganize_receipts') then target:=(p_payload->>'destination_id')::uuid;
 elsif p_action='save_destination' then target:=(p_payload->>'id')::uuid;end if;
 if target is not null and exists(select 1 from private.maintenance_jobs where destination_id=target and kind='reorganize' and state<>'done') then raise exception 'Este destino está reorganizando comprobantes.';end if;
 if p_action in ('delete_delivery','reorganize_receipts') then
  if exists(select 1 from private.receipt_drive_jobs j join public.receipts rr on rr.id=j.receipt_id join public.deliveries x on x.id=rr.delivery_id where x.destination_id=target and j.locked_until>now()) or exists(select 1 from private.receipt_leases l join public.receipts rr on rr.id=l.receipt_id join public.deliveries x on x.id=rr.delivery_id where x.destination_id=target and l.expires_at>now()) then raise exception 'Hay comprobantes en preparación. Vuelve a intentarlo en unos momentos.';end if;
 end if;
 if p_action='delete_delivery' then
  select * into r from public.receipts where delivery_id=(p_payload->>'delivery_id')::uuid;
  if r.legacy_id is not null then raise exception 'Los originales históricos importados se conservan.';end if;
  if target is null then return '{}'::jsonb;end if;
  if r.id is null then raise exception 'Solo se eliminan entregas confirmadas desde Historial.';end if;
  select coalesce(jsonb_agg(path),'[]') into paths from (select pdf_path path from public.receipt_documents where receipt_id=r.id union select r.pdf_path union select r.current_pdf_path union select r.snapshot->>'signature_path') s where nullif(path,'') is not null;
  insert into private.maintenance_jobs(kind,destination_id,payload) values('delete',target,jsonb_build_object('paths',paths,'signature_prefix','signatures/'||(p_payload->>'delivery_id'),'google_id',(select google_id from private.receipt_drive_jobs where receipt_id=r.id)));
  delete from private.receipt_drive_jobs where receipt_id=r.id;delete from private.receipt_leases where receipt_id=r.id;
  delete from public.receipt_documents where receipt_id=r.id;delete from public.receipts where id=r.id;
  delete from public.delivery_events where delivery_id=(p_payload->>'delivery_id')::uuid;
  delete from public.deliveries where id=(p_payload->>'delivery_id')::uuid;
  return jsonb_build_object('cleanup_pending',true);
 end if;
 if p_action in ('reorganize_preview','reorganize_receipts') then
  if not (select enabled from private.maintenance_config where id) then raise exception 'La reorganización temporal está deshabilitada.';end if;
  select * into d from public.destinations where id=target for update;
  if d.id is null or d.receipt_code is null or coalesce((p_payload->>'start_number')::bigint,0)<1 then raise exception 'Revisa destino y número inicial.';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'previous',receipt_number,'next',d.receipt_code||'-'||lpad(n::text,greatest(3,length(n::text)),'0')) order by n),'[]') into mapping from (
   select rr.id,rr.receipt_number,row_number() over(order by (rr.snapshot->>'confirmed_at')::timestamptz,rr.id)+(p_payload->>'start_number')::bigint-1 n from public.receipts rr join public.deliveries x on x.id=rr.delivery_id where x.destination_id=target and rr.legacy_id is null
  ) numbered;
  if exists(select 1 from jsonb_array_elements(mapping) m join public.receipts rr on rr.receipt_number=m->>'next' where not exists(select 1 from jsonb_array_elements(mapping) own where own->>'id'=rr.id::text)) then raise exception 'La numeración coincide con comprobantes históricos. Elige otro inicio.';end if;
  if p_action='reorganize_preview' then return jsonb_build_object('mapping',mapping,'token',md5(mapping::text));end if;
  if p_payload->>'token' is distinct from md5(mapping::text) then raise exception 'El historial cambió. Revisa una nueva vista previa.';end if;
  update public.receipts set receipt_number=null where id in(select (m->>'id')::uuid from jsonb_array_elements(mapping) m);
  for entry in select value from jsonb_array_elements(mapping) loop
   select * into r from public.receipts where id=(entry->>'id')::uuid;j:=gen_random_uuid();
   select coalesce(jsonb_agg(path),'[]') into paths from (select pdf_path path from public.receipt_documents where receipt_id=r.id union select r.pdf_path union select r.current_pdf_path) s where nullif(path,'') is not null;
   insert into private.maintenance_jobs(id,kind,destination_id,payload) values(j,'reorganize',target,jsonb_build_object('receipt_id',r.id,'paths',paths,'google_id',(select google_id from private.receipt_drive_jobs where receipt_id=r.id)));
   update public.receipts set receipt_number=entry->>'next',template_version=4,current_pdf_path='receipts/'||r.id||'/'||j||'.pdf',pdf_path=null,drive_status='pending' where id=r.id;
   delete from public.receipt_documents where receipt_id=r.id;
   insert into public.receipt_documents(receipt_id,version,pdf_path) select id,4,current_pdf_path from public.receipts where id=r.id;
   delete from private.receipt_drive_jobs where receipt_id=r.id;
  end loop;
  update public.destinations set receipt_next_number=(p_payload->>'start_number')::bigint+jsonb_array_length(mapping) where id=target;
  return jsonb_build_object('count',jsonb_array_length(mapping));
 end if;
 if p_action='save_product' and exists(select 1 from public.products where id=(p_payload->>'id')::uuid and retired) then raise exception 'El producto fue retirado del catálogo.';end if;
 if p_action='save_destination' and exists(select 1 from public.destinations where id=(p_payload->>'id')::uuid and retired) then raise exception 'El destino fue retirado del catálogo.';end if;
 if p_action='save_product' and p_payload->>'name' ilike '%bark%bites%' then p_payload:=p_payload||jsonb_build_object('unit','unidad','category','cookies');end if;
 if p_action='save_product' and (p_payload->>'unit' is null or p_payload->>'unit' not in ('kg','unidad')) then raise exception 'Unidad no válida.';end if;
 if p_action='save_delivery' and exists(select 1 from jsonb_array_elements(p_payload->'items') i join public.products p on p.id=(i->>'product_id')::uuid where p.unit='unidad' and (i->>'quantity')::numeric<>trunc((i->>'quantity')::numeric)) then raise exception 'Los frascos se entregan en unidades enteras.';end if;
 if p_action='confirm_delivery' and exists(select 1 from public.deliveries x,jsonb_array_elements(x.items) i where x.id=(p_payload->>'delivery_id')::uuid and i->>'unit'='unidad' and (i->>'quantity')::numeric<>trunc((i->>'quantity')::numeric)) then raise exception 'Revisa las unidades enteras.';end if;
 if p_action in ('save_product','save_delivery','confirm_delivery') then
  result:=private.minue_command(p_actor,p_action,p_payload);
  if p_action='save_product' then update public.products set category=coalesce(p_payload->>'category','diet'),protein=coalesce(p_payload->>'protein','other') where id=(result->>'id')::uuid;
  elsif p_action='confirm_delivery' then select to_jsonb(x) into result from public.receipts x where id=(result->>'id')::uuid;end if;
  return result;
 end if;
 result:=private.minue_command_previous(p_actor,p_action,p_payload);
 if p_action='update_profile' and p_payload ? 'is_superadmin' then update public.profiles set is_superadmin=(p_payload->>'is_superadmin')::boolean where id=(p_payload->>'id')::uuid;end if;
 return result;
end$$;
revoke all on function public.minue_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.minue_command(uuid,text,jsonb) to service_role;
create function public.minue_maintenance(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;j private.maintenance_jobs;t uuid;
begin
 perform pg_advisory_xact_lock(72841003);
 if p_action='claim' then
  with due as(select id from private.maintenance_jobs where (state='pending' and next_attempt_at<=now()) or (state='processing' and locked_until<now()) order by created_at for update skip locked limit 1),claimed as(update private.maintenance_jobs x set state='processing',lease=gen_random_uuid(),locked_until=now()+interval '3 minutes',attempts=attempts+1 from due where x.id=due.id returning x.*) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
 elsif p_action in ('done','failed','prepared') then
  select * into j from private.maintenance_jobs where id=(p_payload->>'id')::uuid for update;
  if j.lease is distinct from (p_payload->>'lease')::uuid or j.state<>'processing' or j.locked_until<now() then raise exception 'La tarea cambió de proceso.';end if;
  update private.maintenance_jobs set state=case when p_action='done' then 'done' else 'pending' end,payload=case when p_action='prepared' then payload||jsonb_build_object('phase','archive') else payload end,lease=null,locked_until=null,next_attempt_at=now()+interval '1 minute',last_error=case when p_action in ('done','prepared') then null else left(p_payload->>'error',180) end where id=j.id;
  if p_action='prepared' and j.kind='reorganize' then insert into private.receipt_drive_jobs(receipt_id) values((j.payload->>'receipt_id')::uuid) on conflict do nothing;end if;
 elsif p_action='acquire_pdf' then
  if exists(select 1 from private.maintenance_jobs where payload->>'receipt_id'=p_payload->>'receipt_id' and state<>'done') and not coalesce((p_payload->>'maintenance')::boolean,false) then raise exception 'Comprobante en reorganización.';end if;
  t:=gen_random_uuid();
  insert into private.receipt_leases values((p_payload->>'receipt_id')::uuid,t,now()+interval '3 minutes') on conflict(receipt_id) do update set lease=excluded.lease,expires_at=excluded.expires_at where private.receipt_leases.expires_at<now();
  if not found then raise exception 'El comprobante se está preparando. Reintenta en unos momentos.';end if;
  result:=to_jsonb(t);
 elsif p_action='release_pdf' then delete from private.receipt_leases where receipt_id=(p_payload->>'receipt_id')::uuid and lease=(p_payload->>'lease')::uuid;
 else raise exception 'Acción no válida.';end if;
 return coalesce(result,'null');
end$$;
revoke all on function public.minue_maintenance(text,jsonb) from public,anon,authenticated;
grant execute on function public.minue_maintenance(text,jsonb) to service_role;
-- Serialize claiming archive work against deletion and reorganization transactions.
alter function public.minue_drive(text,jsonb) rename to minue_drive_previous;
alter function public.minue_drive_previous(text,jsonb) set schema private;
create function public.minue_drive(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(72841003);
 return private.minue_drive_previous(p_action,p_payload);
end$$;
revoke all on function public.minue_drive(text,jsonb) from public,anon,authenticated;
grant execute on function public.minue_drive(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
