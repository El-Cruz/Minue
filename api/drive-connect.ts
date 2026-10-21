import type { ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { authorize,fail,json,body,HttpError,type Request } from '../server/http.js';
import { callbackUrl,driveConfigured,seal,DRIVE_EMAIL } from '../server/drive.js';
export default async function handler(req:Request,res:ServerResponse){
  if(req.method!=='POST')return json(res,405,{error:'Método no permitido.'});
  try{
    const {user,profile}=await authorize(req);if(!profile.is_admin)throw new HttpError(403,'Se requiere administración.');await body(req);
    if(!driveConfigured())throw new HttpError(503,'Falta configurar el cliente de Google Drive en el servidor.');
    const nonce=randomBytes(24).toString('base64url');
    const cookie=seal(JSON.stringify({nonce,adminId:user.id,expires:Date.now()+600000}),'oauth-state');
    const secure=new URL(process.env.APP_URL!).protocol==='https:'?'; Secure':'';
    res.setHeader('Set-Cookie','minue_drive_state='+cookie+'; HttpOnly; SameSite=Lax; Path=/api/drive-callback; Max-Age=600'+secure);
    const params=new URLSearchParams({client_id:process.env.GOOGLE_DRIVE_CLIENT_ID!,redirect_uri:callbackUrl(),response_type:'code',scope:'openid email https://www.googleapis.com/auth/drive.file',access_type:'offline',prompt:'consent select_account',state:nonce,login_hint:DRIVE_EMAIL});
    return json(res,200,{url:'https://accounts.google.com/o/oauth2/v2/auth?'+params});
  }catch(error){return fail(res,error);}
}
