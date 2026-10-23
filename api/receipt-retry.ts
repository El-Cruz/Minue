import type { ServerResponse } from 'node:http';
import { waitUntil } from '@vercel/functions';
import { authorizedReceipt } from '../server/receipt-access.js';
import { fail,json,body,HttpError,type Request } from '../server/http.js';
import { driveStore,processDriveJobs } from '../server/drive.js';
export default async function handler(req:Request,res:ServerResponse){
  if(req.method!=='POST')return json(res,405,{error:'Método no permitido.'});
  try{
    const {client,receipt,profile}=await authorizedReceipt(req);
    if(!profile.is_admin)throw new HttpError(403,'Solo administración gestiona el archivo en Drive.');
    await body(req);
    if(receipt.legacy_id)throw new HttpError(409,'El comprobante histórico conserva su archivo original; no se vuelve a emitir.');
    await driveStore(client,'retry',{receipt_id:receipt.id});
    waitUntil(processDriveJobs(client,receipt.id).catch(()=>console.warn('receipt_archive_pending')));
    return json(res,202,{ok:true});
  }catch(error){return fail(res,error);}
}
