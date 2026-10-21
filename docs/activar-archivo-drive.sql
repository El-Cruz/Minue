-- Run after the receipt_documents_drive migration, as project owner.
-- configure-drive-worker.mjs supplies the secret; never put it in this file.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault cascade;
create or replace function private.configure_drive_cron(p_secret text) returns void
language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
  if char_length(p_secret)<32 then raise exception 'Falta una clave segura para el trabajador.'; end if;
  select id into secret_id from vault.secrets where name='minue_drive_worker_secret';
  if secret_id is null then perform vault.create_secret(p_secret,'minue_drive_worker_secret');
  else perform vault.update_secret(secret_id,p_secret); end if;
  perform cron.schedule('minue-drive-archive','*/5 * * * *',$job$
    select net.http_post(
      url:='https://minue-delta.vercel.app/api/drive-worker',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='minue_drive_worker_secret')),
      body:='{}'::jsonb,
      timeout_milliseconds:=60000
    );
  $job$);
end;
$$;
revoke all on function private.configure_drive_cron(text) from public,anon,authenticated;
grant execute on function private.configure_drive_cron(text) to service_role;
create or replace function public.minue_configure_drive_cron(p_secret text) returns void
language sql security invoker set search_path='' as $$ select private.configure_drive_cron(p_secret); $$;
revoke all on function public.minue_configure_drive_cron(text) from public,anon,authenticated;
grant execute on function public.minue_configure_drive_cron(text) to service_role;
notify pgrst,'reload schema';
commit;
