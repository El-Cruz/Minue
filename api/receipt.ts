import type { ServerResponse } from 'node:http';
import { authorizedReceipt } from '../server/receipt-access.js';
import { ensureReceiptPDF } from '../server/receipt.js';
import { fail, json, type Request } from '../server/http.js';
import { receiptFilename } from '../src/lib/receipt-format.js';
export default async function handler(req:Request,res:ServerResponse) {
  if(req.method!=='GET'){res.setHeader('Allow','GET');return json(res,405,{error:'Método no permitido.'});}
  try {
    const {client,receipt}=await authorizedReceipt(req);
    const original=new URL(req.url!,'https://minue.invalid').searchParams.get('version')==='original';
    const pdf=await ensureReceiptPDF(client,receipt,original);
    res.statusCode=200;res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="'+receiptFilename(receipt,original)+'"');
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(Buffer.from(pdf));
  }catch(error){return fail(res,error);}
}
