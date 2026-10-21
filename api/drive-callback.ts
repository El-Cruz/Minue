import type { ServerResponse } from 'node:http';
import { waitUntil } from '@vercel/functions';
import { adminClient,type Request } from '../server/http.js';
import { callbackUrl,driveStore,equalSecret,googleToken,processDriveJobs,seal,unseal,DRIVE_EMAIL,type DriveConnection } from '../server/drive.js';
export default async function handler(req:Request,res:ServerResponse){
  res.setHeader('Cache-Control','no-store, private');
  if(req.method!=='GET'){res.statusCode=405;return res.end();}
  const redirect=(state:string)=>{res.setHeader('Set-Cookie','minue_drive_state=; HttpOnly; SameSite=Lax; Path=/api/drive-callback; Max-Age=0; Secure');res.statusCode=303;res.setHeader('Location','/?drive='+state);res.end();};
  try {
    const query=new URL(req.url!,'https://minue.invalid').searchParams;
    const encoded=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('minue_drive_state='))?.slice('minue_drive_state='.length);
    if(!encoded || !query.get('code') || query.has('error'))return redirect('error');
    const state=JSON.parse(unseal(encoded,'oauth-state'));
    if(state.expires<Date.now() || !equalSecret(state.nonce,query.get('state')||''))return redirect('error');
    const client=adminClient();
    const {data:profile}=await client.from('profiles').select('is_admin,active').eq('id',state.adminId).single();
    if(!profile?.active || !profile.is_admin)return redirect('error');
    const token=await googleToken({grant_type:'authorization_code',code:query.get('code')!,redirect_uri:callbackUrl()});
    const response=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
    if(!response.ok)return redirect('error');
    const identity=await response.json();
    if(identity.email!==DRIVE_EMAIL || identity.email_verified!==true)return redirect('wrong_account');
    const previous=await driveStore<DriveConnection|null>(client,'connection_get');
    const encrypted=token.refresh_token?seal(token.refresh_token):previous?.encrypted_token;
    if(!encrypted)return redirect('error');
    await driveStore(client,'connection_set',{email:DRIVE_EMAIL,encrypted_token:encrypted});
    waitUntil(processDriveJobs(client).catch(()=>console.warn('receipt_archive_pending')));
    return redirect('connected');
  }catch{return redirect('error');}
}
