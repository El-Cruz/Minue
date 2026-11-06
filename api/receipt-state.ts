import type { ServerResponse } from 'node:http';
import { authorizedReceipt } from '../server/receipt-access.js';
import { BUCKET } from '../server/receipt.js';
import { fail,json,type Request } from '../server/http.js';
export default async function handler(req:Request,res:ServerResponse){
  if(req.method!=='GET')return json(res,405,{error:'Método no permitido.'});
  try{
    const {client,receipt}=await authorizedReceipt(req);
    const {data,error}=await client.from('receipt_documents').select('version').eq('receipt_id',receipt.id);
    if(error)throw new Error('No se pudo consultar el comprobante.');
    const versions=(data||[]).map(d=>d.version);
    let signature_data: string|undefined;
    if(receipt.snapshot.signature_path){
      const signature=await client.storage.from(BUCKET).download(receipt.snapshot.signature_path);
      if(signature.error || !signature.data)throw new Error('No se pudo leer la firma.');
      signature_data='data:image/png;base64,'+Buffer.from(await signature.data.arrayBuffer()).toString('base64');
    }
    return json(res,200,{signature_data,receipt,versions,drive_status:receipt.drive_status||'pending',originalAvailable:versions.includes(1)||Boolean(receipt.legacy_id&&(receipt.pdf_path||receipt.legacy_pdf_url))});
  }catch(error){return fail(res,error);}
}
