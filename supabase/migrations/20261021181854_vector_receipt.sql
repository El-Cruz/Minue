-- Apply only after deploying the app that can render versions 2 and 3.
-- No backfill: existing receipts, Drive files and counters remain unchanged.
begin;
alter table public.receipt_documents drop constraint receipt_documents_version_check;
alter table public.receipt_documents add constraint receipt_documents_version_check check(version in (1,2,3));
alter table public.receipts alter column template_version set default 3;

create or replace function private.allocate_receipt_number(p_receipt uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare r public.receipts; d public.destinations; destination_id uuid; number bigint; version_number integer;
begin
  select * into r from public.receipts where id=p_receipt for update;
  if not found then raise exception 'No se encontró el comprobante.'; end if;
  if r.legacy_id is not null then return; end if;
  version_number:=case when r.template_version=3 then 3 else 2 end;
  if r.receipt_number is null then
    select x.destination_id into destination_id from public.deliveries x where x.id=r.delivery_id;
    select * into d from public.destinations where id=destination_id for update;
    if d.receipt_code is null then raise exception 'Configura el código del destino antes de emitir su comprobante.'; end if;
    number:=d.receipt_next_number;
    update public.destinations set receipt_next_number=number+1 where id=d.id;
    update public.receipts set receipt_number=d.receipt_code||'-'||lpad(number::text,greatest(3,length(number::text)),'0'),template_version=version_number where id=r.id;
  end if;
  insert into public.receipt_documents(receipt_id,version,pdf_path)
  values(r.id,version_number,'receipts/'||r.id::text||'/v'||version_number::text||'.pdf') on conflict do nothing;
  insert into private.receipt_drive_jobs(receipt_id) values(r.id) on conflict do nothing;
end;
$$;
revoke all on function private.allocate_receipt_number(uuid) from public,anon,authenticated;
grant execute on function private.allocate_receipt_number(uuid) to service_role;
notify pgrst,'reload schema';
commit;
