import type { ServerResponse } from 'node:http';
import { waitUntil } from '@vercel/functions';
import { authorizedReceipt } from '../server/receipt-access.js';
import { fail,json,body,type Request } from '../server/http.js';
import { driveStore,processDriveJobs } from '../server/drive.js';
export default async function handler(req:Request,res:ServerResponse){
  if(req.method!=='POST')return json(res,405,{error:'Método no permitido.'});
  try{
    const {client,receipt}=await authorizedReceipt(req);await body(req);
    await driveStore(client,'retry',{receipt_id:receipt.id});
    waitUntil(processDriveJobs(client,receipt.id).catch(()=>console.warn('receipt_archive_pending')));
    return json(res,202,{ok:true});
  }catch(error){return fail(res,error);}
}
