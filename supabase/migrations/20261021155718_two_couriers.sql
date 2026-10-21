-- Add one optional second courier; confirmation remains locked per delivery.
begin;
alter table public.deliveries add column partner_id uuid references public.profiles(id);
alter table public.deliveries add constraint distinct_delivery_couriers check(partner_id is null or (assigned_to is not null and partner_id<>assigned_to));
alter table public.deliveries add constraint at_most_two_legacy_couriers check(cardinality(legacy_profile_ids)<=2);
create index deliveries_partner_date_idx on public.deliveries(partner_id,scheduled_date,status) where partner_id is not null;
drop policy deliveries_read on public.deliveries;
create policy deliveries_read on public.deliveries for select to authenticated
using((select private.is_active()) and (assigned_to=(select auth.uid()) or partner_id=(select auth.uid()) or (select auth.uid())=any(legacy_profile_ids) or (select private.is_admin())));

create or replace function private.minue_command(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor public.profiles;
  target public.profiles;
  delivery public.deliveries;
  destination public.destinations;
  contact public.contacts;
  receipt public.receipts;
  entity_id uuid;
  canonical_items jsonb;
  item_count integer;
  event_kind text;
  event_note text;
  confirmed_at timestamptz;
  receipt_sequence bigint;
  selected_profiles uuid[];
  local_day date := (now() at time zone 'America/Bogota')::date;
begin
  if p_action = 'update_profile' then perform pg_advisory_xact_lock(72841001); end if;
  select * into actor from public.profiles where id = p_actor for share;
  if not found or not actor.active then raise exception 'Tu cuenta no tiene acceso activo.'; end if;
  if p_action not in ('confirm_delivery', 'fail_delivery') and not actor.is_admin then raise exception 'Se requiere acceso de administración.'; end if;

  if p_action = 'save_destination' then
    entity_id := coalesce((p_payload->>'id')::uuid, gen_random_uuid());
    insert into public.destinations(id, name, address, city, phone, notes, active)
    values(entity_id, p_payload->>'name', p_payload->>'address', p_payload->>'city', p_payload->>'phone', p_payload->>'notes', (p_payload->>'active')::boolean)
    on conflict(id) do update set name=excluded.name,address=excluded.address,city=excluded.city,phone=excluded.phone,notes=excluded.notes,active=excluded.active;
    return jsonb_build_object('id',entity_id);
  elsif p_action = 'save_product' then
    entity_id := coalesce((p_payload->>'id')::uuid, gen_random_uuid());
    insert into public.products(id,name,unit,species,active)
    values(entity_id,p_payload->>'name',p_payload->>'unit',p_payload->>'species',(p_payload->>'active')::boolean)
    on conflict(id) do update set name=excluded.name,unit=excluded.unit,species=excluded.species,active=excluded.active;
    return jsonb_build_object('id',entity_id);
  elsif p_action = 'save_contact' then
    entity_id := coalesce((p_payload->>'id')::uuid, gen_random_uuid());
    if exists(select 1 from public.contacts where id=entity_id and destination_id<>(p_payload->>'destination_id')::uuid) then raise exception 'El contacto pertenece a otro destino.'; end if;
    insert into public.contacts(id,destination_id,name) values(entity_id,(p_payload->>'destination_id')::uuid,p_payload->>'name')
    on conflict(id) do update set name=excluded.name;
    return jsonb_build_object('id',entity_id);
  elsif p_action = 'update_profile' then
    select * into target from public.profiles where id=(p_payload->>'id')::uuid for update;
    if not found then raise exception 'No se encontró la cuenta.'; end if;
    if target.id=actor.id and (not (p_payload->>'active')::boolean or not (p_payload->>'is_admin')::boolean) then raise exception 'No puedes quitarte el acceso de administración.'; end if;
    if target.active and target.is_admin and (not (p_payload->>'active')::boolean or not (p_payload->>'is_admin')::boolean)
    and not exists(select 1 from public.profiles where active and is_admin and id<>target.id) then raise exception 'Debe quedar una cuenta administradora activa.'; end if;
    update public.profiles set name=p_payload->>'name',active=(p_payload->>'active')::boolean,is_admin=(p_payload->>'is_admin')::boolean,is_courier=(p_payload->>'is_courier')::boolean where id=target.id;
    return jsonb_build_object('id',target.id);
  elsif p_action = 'link_legacy_couriers' then
    select * into delivery from public.deliveries where id=(p_payload->>'delivery_id')::uuid for update;
    if not found or delivery.legacy_id is null then raise exception 'Selecciona una entrega histórica.'; end if;
    if jsonb_typeof(p_payload->'profile_ids') is distinct from 'array' or jsonb_array_length(p_payload->'profile_ids')>2 then raise exception 'Selecciona hasta dos repartidores.'; end if;
    select coalesce(array_agg(value::uuid order by ord),'{}') into selected_profiles from jsonb_array_elements_text(p_payload->'profile_ids') with ordinality as x(value,ord);
    if cardinality(selected_profiles)<>(select count(distinct p) from unnest(selected_profiles) p) or exists(select 1 from unnest(selected_profiles) p where not exists(select 1 from public.profiles where id=p and active and is_courier)) then raise exception 'Selecciona repartidores activos y diferentes.'; end if;
    update public.deliveries set assigned_to=selected_profiles[1],partner_id=selected_profiles[2],legacy_profile_ids=selected_profiles where id=delivery.id;
    insert into public.delivery_events(delivery_id,actor_id,kind,note) values(delivery.id,actor.id,'updated','Se relacionaron los repartidores del registro histórico.');
    return jsonb_build_object('id',delivery.id);
  elsif p_action = 'save_delivery' then
    entity_id := coalesce((p_payload->>'id')::uuid, gen_random_uuid());
    select * into delivery from public.deliveries where id=entity_id for update;
    if found and delivery.status='delivered' then raise exception 'Una entrega confirmada no se puede modificar.'; end if;
    if not exists(select 1 from public.destinations where id=(p_payload->>'destination_id')::uuid and active) then raise exception 'Selecciona un destino activo.'; end if;
    if not exists(select 1 from public.profiles where id=(p_payload->>'assigned_to')::uuid and active and is_courier) then raise exception 'Selecciona un repartidor activo.'; end if;
    if nullif(p_payload->>'partner_id','') is not null and ((p_payload->>'partner_id')::uuid=(p_payload->>'assigned_to')::uuid or not exists(select 1 from public.profiles where id=(p_payload->>'partner_id')::uuid and active and is_courier)) then raise exception 'Selecciona un segundo repartidor activo y diferente.'; end if;
    select jsonb_agg(jsonb_build_object('product_id',p.id,'name',p.name,'quantity',(item->>'quantity')::numeric,'unit',p.unit) order by ord), count(*)
    into canonical_items,item_count
    from jsonb_array_elements(p_payload->'items') with ordinality as i(item,ord)
    join public.products p on p.id=(item->>'product_id')::uuid and p.active
    where (item->>'quantity')::numeric>0 and (item->>'quantity')::numeric<=100000;
    if item_count<1 or item_count>100 or item_count<>jsonb_array_length(p_payload->'items') or item_count<>(select count(distinct item->>'product_id') from jsonb_array_elements(p_payload->'items') item) then raise exception 'Revisa los productos y las cantidades.'; end if;
    event_kind := case when delivery.id is null then 'created' when delivery.scheduled_date<>(p_payload->>'scheduled_date')::date or delivery.status='failed' then 'rescheduled' else 'updated' end;
    event_note := case when event_kind='rescheduled' then 'Reprogramada desde '||delivery.scheduled_date::text||' a '||(p_payload->>'scheduled_date') else 'Entrega programada para '||(p_payload->>'scheduled_date') end;
    insert into public.deliveries(id,destination_id,assigned_to,partner_id,scheduled_date,time_window,notes,items)
    values(entity_id,(p_payload->>'destination_id')::uuid,(p_payload->>'assigned_to')::uuid,nullif(p_payload->>'partner_id','')::uuid,(p_payload->>'scheduled_date')::date,p_payload->>'time_window',p_payload->>'notes',canonical_items)
    on conflict(id) do update set destination_id=excluded.destination_id,assigned_to=excluded.assigned_to,partner_id=excluded.partner_id,scheduled_date=excluded.scheduled_date,time_window=excluded.time_window,notes=excluded.notes,items=excluded.items,status='pending';
    insert into public.delivery_events(delivery_id,actor_id,kind,note) values(entity_id,actor.id,event_kind,event_note);
    return jsonb_build_object('id',entity_id);
  elsif p_action in ('confirm_delivery','fail_delivery','reschedule_delivery') then
    select * into delivery from public.deliveries where id=(p_payload->>'delivery_id')::uuid for update;
    if not found then raise exception 'No se encontró la entrega.'; end if;
    if p_action<>'reschedule_delivery' and ((delivery.assigned_to is distinct from actor.id and delivery.partner_id is distinct from actor.id) or not actor.is_courier) then raise exception 'Solo puedes confirmar tus entregas asignadas.'; end if;
    if p_action='confirm_delivery' and delivery.status='delivered' then
      select * into receipt from public.receipts where delivery_id=delivery.id;
      return to_jsonb(receipt);
    end if;
    if delivery.status='delivered' then raise exception 'Una entrega confirmada no se puede modificar.'; end if;
    if p_action='reschedule_delivery' then
      if (p_payload->>'scheduled_date')::date < local_day then raise exception 'La nueva fecha no puede estar en el pasado.'; end if;
      if char_length(trim(p_payload->>'note'))<3 then raise exception 'Escribe el motivo de reprogramación.'; end if;
      update public.deliveries set scheduled_date=(p_payload->>'scheduled_date')::date,status='pending' where id=delivery.id;
      insert into public.delivery_events(delivery_id,actor_id,kind,note) values(delivery.id,actor.id,'rescheduled','De '||delivery.scheduled_date::text||' a '||(p_payload->>'scheduled_date')||'. '||(p_payload->>'note'));
      return jsonb_build_object('id',delivery.id);
    end if;
    if delivery.status<>'pending' then raise exception 'La entrega requiere reprogramación antes de continuar.'; end if;
    if delivery.scheduled_date>local_day then raise exception 'La entrega todavía no está programada para hoy.'; end if;
    if p_action='fail_delivery' then
      if char_length(trim(p_payload->>'note'))<3 then raise exception 'Escribe el motivo del intento fallido.'; end if;
      update public.deliveries set status='failed' where id=delivery.id;
      insert into public.delivery_events(delivery_id,actor_id,kind,note) values(delivery.id,actor.id,'failed',p_payload->>'note');
      return jsonb_build_object('id',delivery.id);
    end if;
    if coalesce(p_payload->>'signature_path','') !~ ('^signatures/'||delivery.id::text||'/[0-9a-f-]{36}\.png$') then raise exception 'Falta una firma válida.'; end if;
    if (p_payload->>'recipient_id') is not null then
      select * into contact from public.contacts where id=(p_payload->>'recipient_id')::uuid and destination_id=delivery.destination_id;
      if not found then raise exception 'La persona seleccionada no pertenece a este destino.'; end if;
    else
      if char_length(trim(p_payload->>'new_recipient')) not between 2 and 100 then raise exception 'Escribe el nombre de quien recibe.'; end if;
      insert into public.contacts(destination_id,name) values(delivery.destination_id,trim(p_payload->>'new_recipient')) returning * into contact;
    end if;
    select * into destination from public.destinations where id=delivery.destination_id;
    confirmed_at := clock_timestamp();
    receipt_sequence := nextval('private.receipt_number');
    insert into public.receipts(delivery_id,request_id,folio,snapshot,created_at)
    values(delivery.id,(p_payload->>'request_id')::uuid,
      'MIN-'||to_char(confirmed_at at time zone 'America/Bogota','YYYYMMDD')||'-'||lpad(receipt_sequence::text,greatest(5,length(receipt_sequence::text)),'0'),
      jsonb_build_object('destination',jsonb_build_object('name',destination.name,'address',destination.address,'city',destination.city),
        'items',delivery.items,'courier',(select string_agg(p.name,' / ' order by case when p.id=delivery.assigned_to then 0 else 1 end) from public.profiles p where p.id=delivery.assigned_to or p.id=delivery.partner_id),'confirmed_by',actor.name,'recipient',contact.name,'observation',coalesce(p_payload->>'observation',''),
        'scheduled_date',delivery.scheduled_date,'confirmed_at',confirmed_at,'signature_path',p_payload->>'signature_path'), confirmed_at)
    returning * into receipt;
    update public.deliveries set status='delivered' where id=delivery.id;
    insert into public.delivery_events(delivery_id,actor_id,kind,note) values(delivery.id,actor.id,'delivered','Recibió '||contact.name);
    return to_jsonb(receipt);
  end if;
  raise exception 'Acción no válida.';
end;
$$;
revoke all on function private.minue_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.minue_command(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
