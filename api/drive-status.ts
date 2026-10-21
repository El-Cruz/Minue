import type { ServerResponse } from 'node:http';
import { authorize,fail,json,HttpError,type Request } from '../server/http.js';
import { driveStore,driveConfigured,DRIVE_EMAIL,type DriveConnection } from '../server/drive.js';
export default async function handler(req:Request,res:ServerResponse){
  if(req.method!=='GET')return json(res,405,{error:'Método no permitido.'});
  try{
    const {client,profile}=await authorize(req);if(!profile.is_admin)throw new HttpError(403,'Se requiere administración.');
    const connection=await driveStore<DriveConnection|null>(client,'connection_get');
    return json(res,200,{configured:driveConfigured(),connected:connection?.state==='connected',email:DRIVE_EMAIL,state:connection?.state||'disconnected'});
  }catch(error){return fail(res,error);}
}
