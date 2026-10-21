-- MINUE: preparacion inicial del proyecto cpycykduhgwsalgwhkxd.
-- Ejecutar todo este archivo una sola vez desde el SQL Editor de ese proyecto.
-- Crea tablas, permisos, funciones y almacenamiento privado. No carga datos de ejemplo.
-- Si hay un error, no continuar con sentencias sueltas: la transaccion se revierte.
begin;

-- Reference schema. Deploy the identical SQL in migrations/, never this file twice.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users(id),
  name text not null check (char_length(name) between 2 and 100),
  email text not null,
  is_admin boolean not null default false,
  is_courier boolean not null default true,
  active boolean not null default false,
  check (is_admin or is_courier)
);
create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 150),
  address text not null check (char_length(address) between 2 and 250),
  city text not null check (char_length(city) between 2 and 100),
  phone text not null default '' check (char_length(phone) <= 40),
  notes text not null default '' check (char_length(notes) <= 2000),
  active boolean not null default true
);
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null references public.destinations(id),
  name text not null check (char_length(name) between 2 and 100)
);
create index contacts_destination_idx on public.contacts(destination_id);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 150),
  unit text not null check (char_length(unit) between 1 and 80),
  species text not null check (species in ('dog', 'cat', 'both')),
  active boolean not null default true
);
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null references public.destinations(id),
  assigned_to uuid not null references public.profiles(id),
  scheduled_date date not null,
  time_window text not null default '' check (char_length(time_window) <= 80),
  notes text not null default '' check (char_length(notes) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100),
  created_at timestamptz not null default now()
);
create index deliveries_courier_date_idx on public.deliveries(assigned_to, scheduled_date, status);
create index deliveries_destination_idx on public.deliveries(destination_id);
create table public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id),
  actor_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('created', 'updated', 'failed', 'rescheduled', 'delivered')),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index delivery_events_delivery_idx on public.delivery_events(delivery_id, created_at);
create index delivery_events_actor_idx on public.delivery_events(actor_id);
create sequence private.receipt_number;
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null unique references public.deliveries(id),
  request_id uuid not null unique,
  folio text not null unique,
  snapshot jsonb not null,
  pdf_path text,
  created_at timestamptz not null default now()
);

-- Internal lookups avoid recursive profile policies. They never take a user ID
-- from the browser; identity always comes from the verified JWT.
create function private.is_admin() returns boolean language sql stable security definer
set search_path = '' as $$ select exists(select 1 from public.profiles where id = (select auth.uid()) and active and is_admin) $$;
create function private.is_active() returns boolean language sql stable security definer
set search_path = '' as $$ select exists(select 1 from public.profiles where id = (select auth.uid()) and active) $$;
revoke all on function private.is_admin(), private.is_active() from public, anon;
grant execute on function private.is_admin(), private.is_active() to authenticated;

alter table public.profiles enable row level security;
alter table public.destinations enable row level security;
alter table public.contacts enable row level security;
alter table public.products enable row level security;
alter table public.deliveries enable row level security;
alter table public.delivery_events enable row level security;
alter table public.receipts enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()) or (select private.is_admin()));
create policy deliveries_read on public.deliveries for select to authenticated using ((select private.is_active()) and (assigned_to = (select auth.uid()) or (select private.is_admin())));
create policy destinations_read on public.destinations for select to authenticated using ((select private.is_admin()) or exists(select 1 from public.deliveries d where d.destination_id = destinations.id));
create policy contacts_read on public.contacts for select to authenticated using (exists(select 1 from public.destinations d where d.id = contacts.destination_id));
create policy products_read on public.products for select to authenticated using ((select private.is_active()));
create policy events_read on public.delivery_events for select to authenticated using (exists(select 1 from public.deliveries d where d.id = delivery_events.delivery_id));
create policy receipts_read on public.receipts for select to authenticated using (exists(select 1 from public.deliveries d where d.id = receipts.delivery_id));
revoke all on public.profiles, public.destinations, public.contacts, public.products, public.deliveries, public.delivery_events, public.receipts from anon, authenticated;
grant select on public.profiles, public.destinations, public.contacts, public.products, public.deliveries, public.delivery_events, public.receipts to authenticated;
grant all on public.profiles, public.destinations, public.contacts, public.products, public.deliveries, public.delivery_events, public.receipts to service_role;
grant usage, select on sequence private.receipt_number to service_role;

-- Only the authenticated server can call this SECURITY INVOKER function.
-- Every change and its audit event share a single Postgres transaction.
create function public.minue_command(p_actor uuid, p_action text, p_payload jsonb)
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
  elsif p_action = 'save_delivery' then
    entity_id := coalesce((p_payload->>'id')::uuid, gen_random_uuid());
    select * into delivery from public.deliveries where id=entity_id for update;
    if found and delivery.status='delivered' then raise exception 'Una entrega confirmada no se puede modificar.'; end if;
    if not exists(select 1 from public.destinations where id=(p_payload->>'destination_id')::uuid and active) then raise exception 'Selecciona un destino activo.'; end if;
    if not exists(select 1 from public.profiles where id=(p_payload->>'assigned_to')::uuid and active and is_courier) then raise exception 'Selecciona un repartidor activo.'; end if;
    select jsonb_agg(jsonb_build_object('product_id',p.id,'name',p.name,'quantity',(item->>'quantity')::numeric,'unit',p.unit) order by ord), count(*)
    into canonical_items,item_count
    from jsonb_array_elements(p_payload->'items') with ordinality as i(item,ord)
    join public.products p on p.id=(item->>'product_id')::uuid and p.active
    where (item->>'quantity')::numeric>0 and (item->>'quantity')::numeric<=100000;
    if item_count<1 or item_count>100 or item_count<>jsonb_array_length(p_payload->'items') or item_count<>(select count(distinct item->>'product_id') from jsonb_array_elements(p_payload->'items') item) then raise exception 'Revisa los productos y las cantidades.'; end if;
    event_kind := case when delivery.id is null then 'created' when delivery.scheduled_date<>(p_payload->>'scheduled_date')::date or delivery.status='failed' then 'rescheduled' else 'updated' end;
    event_note := case when event_kind='rescheduled' then 'Reprogramada desde '||delivery.scheduled_date::text||' a '||(p_payload->>'scheduled_date') else 'Entrega programada para '||(p_payload->>'scheduled_date') end;
    insert into public.deliveries(id,destination_id,assigned_to,scheduled_date,time_window,notes,items)
    values(entity_id,(p_payload->>'destination_id')::uuid,(p_payload->>'assigned_to')::uuid,(p_payload->>'scheduled_date')::date,p_payload->>'time_window',p_payload->>'notes',canonical_items)
    on conflict(id) do update set destination_id=excluded.destination_id,assigned_to=excluded.assigned_to,scheduled_date=excluded.scheduled_date,time_window=excluded.time_window,notes=excluded.notes,items=excluded.items,status='pending';
    insert into public.delivery_events(delivery_id,actor_id,kind,note) values(entity_id,actor.id,event_kind,event_note);
    return jsonb_build_object('id',entity_id);
  elsif p_action in ('confirm_delivery','fail_delivery','reschedule_delivery') then
    select * into delivery from public.deliveries where id=(p_payload->>'delivery_id')::uuid for update;
    if not found then raise exception 'No se encontró la entrega.'; end if;
    if p_action<>'reschedule_delivery' and (delivery.assigned_to<>actor.id or not actor.is_courier) then raise exception 'Solo puedes confirmar tus entregas asignadas.'; end if;
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
        'items',delivery.items,'courier',actor.name,'recipient',contact.name,'observation',coalesce(p_payload->>'observation',''),
        'scheduled_date',delivery.scheduled_date,'confirmed_at',confirmed_at,'signature_path',p_payload->>'signature_path'), confirmed_at)
    returning * into receipt;
    update public.deliveries set status='delivered' where id=delivery.id;
    insert into public.delivery_events(delivery_id,actor_id,kind,note) values(delivery.id,actor.id,'delivered','Recibió '||contact.name);
    return to_jsonb(receipt);
  end if;
  raise exception 'Acción no válida.';
end;
$$;
revoke all on function public.minue_command(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.minue_command(uuid,text,jsonb) to service_role;

-- File reads and writes go through the server after checking live membership.
-- No browser role gets bucket policies or public download URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('minue-private','minue-private',false,5242880,array['image/png','application/pdf']);

notify pgrst, 'reload schema';
commit;

-- Verificacion: deben aparecer las siete tablas con rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles','destinations','contacts','products','deliveries','delivery_events','receipts')
order by tablename;

-- El almacenamiento de firmas y comprobantes debe ser privado (public = false).
select id, public from storage.buckets where id = 'minue-private';
