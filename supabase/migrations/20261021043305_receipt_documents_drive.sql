-- Additive migration: original PDFs, snapshots and internal folios are preserved.
begin;
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
commit;
