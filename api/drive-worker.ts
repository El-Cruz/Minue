import type { ServerResponse } from 'node:http';
import { equalSecret,processDriveJobs } from '../server/drive.js';
import { json,type Request } from '../server/http.js';
export default async function handler(req:Request,res:ServerResponse){
  if(req.method!=='POST')return json(res,405,{error:'Método no permitido.'});
  const token=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]||'';
  if(!process.env.DRIVE_WORKER_SECRET || !equalSecret(token,process.env.DRIVE_WORKER_SECRET))return json(res,401,{error:'Acceso no autorizado.'});
  try{await processDriveJobs();return json(res,200,{ok:true});}catch{return json(res,503,{error:'El archivo sigue pendiente de reintento.'});}
}
