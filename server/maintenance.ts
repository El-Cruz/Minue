import type { SupabaseClient } from '@supabase/supabase-js';
import {adminClient} from './http.js';
import {BUCKET,ensureReceiptPDF} from './receipt.js';
import {driveStore,google,googleToken,unseal,type DriveConnection} from './drive.js';
type Job={id:string;lease:string;kind:'delete'|'reorganize';payload:{phase?:string;paths:string[];google_id?:string;signature_prefix?:string;receipt_id?:string}};
export async function processMaintenance(client:SupabaseClient=adminClient()) {
  const call=async(action:string,payload:Record<string,unknown>={})=>{
    const {data,error}=await client.rpc('minue_maintenance',{p_action:action,p_payload:payload});
    if(error)throw new Error('No se pudo actualizar la limpieza de comprobantes.');return data;
  };
  const jobs=await call('claim') as Job[];
  for(const job of jobs){
    try{
      if(job.payload.phase==='archive'){
        const receipt=await client.from('receipts').select('drive_status').eq('id',job.payload.receipt_id).single();
        if(receipt.error||receipt.data?.drive_status!=='saved')throw new Error('Esperando sincronización con Drive. Revisa su conexión.');
        await call('done',{id:job.id,lease:job.lease});continue;
      }
      if(job.payload.google_id){
        const connection=await driveStore<DriveConnection|null>(client,'connection_get');
        if(!connection || connection.state!=='connected')throw new Error('Reconecta Google Drive para completar la limpieza.');
        const token=await googleToken({grant_type:'refresh_token',refresh_token:unseal(connection.encrypted_token)});
        const response=await google(token.access_token,'files/'+encodeURIComponent(job.payload.google_id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trashed:true})});
        if(!response.ok && response.status!==404)throw new Error('No se pudo retirar el archivo de Drive.');
      }
      const bucket=client.storage.from(BUCKET);
      if(job.payload.paths.length){const removed=await bucket.remove(job.payload.paths);if(removed.error)throw new Error('La limpieza de archivos sigue pendiente.');}
      if(job.payload.signature_prefix){
        // Each batch is deleted before listing the next, so retries cannot skip objects.
        const listed=await bucket.list(job.payload.signature_prefix,{limit:100});
        if(listed.error)throw new Error('No se pudieron consultar las firmas de prueba.');
        if(listed.data.length){const removed=await bucket.remove(listed.data.map(f=>job.payload.signature_prefix+'/'+f.name));if(removed.error)throw new Error('No se pudieron limpiar las firmas.');}
        if(listed.data.length===100)throw new Error('Continúa la limpieza de firmas en el siguiente intento.');
      }
      if(job.kind==='reorganize'){
        const receipt=await client.from('receipts').select('*').eq('id',job.payload.receipt_id).single();
        if(receipt.error || !receipt.data)throw new Error('No se encontró el comprobante a reorganizar.');
        await ensureReceiptPDF(client,receipt.data,false,true);
      }
      await call(job.kind==='reorganize'?'prepared':'done',{id:job.id,lease:job.lease});
    }catch(error){await call('failed',{id:job.id,lease:job.lease,error:error instanceof Error?error.message:'Tarea pendiente de reintento.'});}
  }
}
