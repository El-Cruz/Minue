import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './http.js';
import { ensureReceiptPDF } from './receipt.js';
import { receiptFilename, receiptMonth } from '../src/lib/receipt-format.js';
import type { Receipt } from '../src/lib/types.js';
export const DRIVE_EMAIL = 'puntodeentregasminue@gmail.com';
export type DriveConnection = {email:string;encrypted_token:string;state:'connected'|'reconnect'};
export type DriveJob = {receipt_id:string;lease:string;google_id:string|null;attempts:number};
export class DriveError extends Error {
  constructor(public kind:'reconnect'|'temporary',message:string,public retryMinutes=0){super(message);}
}
export async function driveStore<T = unknown>(client:SupabaseClient,action:string,payload:Record<string,unknown> = {}):Promise<T> {
  const {data,error}=await client.rpc('minue_drive',{p_action:action,p_payload:payload});
  if(error)throw new Error('No se pudo actualizar el archivo de comprobantes.');
  return data as T;
}
export function driveConfigured() { return Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET && process.env.DRIVE_TOKEN_ENCRYPTION_KEY && process.env.APP_URL); }
function encryptionKey() {
  const key=Buffer.from(process.env.DRIVE_TOKEN_ENCRYPTION_KEY||'','base64');
  if(key.length!==32)throw new Error('Falta configurar la conexión segura con Drive.');
  return key;
}
export function seal(value:string,purpose='refresh') {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
  cipher.setAAD(Buffer.from('minue-drive:'+purpose));
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function unseal(value:string,purpose='refresh') {
  const bytes=Buffer.from(value,'base64url');
  if(bytes.length<29)throw new Error('Credencial no válida.');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),bytes.subarray(0,12));
  decipher.setAAD(Buffer.from('minue-drive:'+purpose));decipher.setAuthTag(bytes.subarray(12,28));
  return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
}
export function equalSecret(a:string,b:string) { const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y); }
export function callbackUrl() { return new URL('/api/drive-callback',process.env.APP_URL!).href; }
export async function googleToken(params:Record<string,string>) {
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_id:process.env.GOOGLE_DRIVE_CLIENT_ID!,client_secret:process.env.GOOGLE_DRIVE_CLIENT_SECRET!}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok)throw new DriveError(data.error==='invalid_grant'?'reconnect':'temporary','Google no autorizó la conexión con Drive.');
  return data as {access_token:string;refresh_token?:string};
}
async function google(token:string,path:string,init:RequestInit={},upload=false) {
  const response=await fetch((upload?'https://www.googleapis.com/upload/drive/v3/':'https://www.googleapis.com/drive/v3/')+path,{...init,headers:{Authorization:'Bearer '+token,...init.headers},signal:AbortSignal.timeout(20000)});
  if([401,403].includes(response.status)) {
    const data=await response.json().catch(()=>null);
    const reason=data?.error?.errors?.[0]?.reason;
    if(reason==='storageQuotaExceeded')throw new DriveError('temporary','No hay espacio suficiente en Google Drive.',360);
    throw new DriveError(response.status===401 || reason==='insufficientPermissions'?'reconnect':'temporary','Google Drive no permite completar el archivo.',60);
  }
  if(response.status===429 || response.status>=500)throw new DriveError('temporary','Google Drive no está disponible temporalmente.',Math.ceil(Number(response.headers.get('retry-after')||0)/60));
  return response;
}
async function generatedId(token:string) {
  const r=await google(token,'files/generateIds?count=1&space=drive&type=files');
  if(!r.ok)throw new DriveError('temporary','No se pudo reservar el archivo en Drive.');
  return (await r.json()).ids[0] as string;
}
async function ensureFolder(client:SupabaseClient,token:string,key:string,name:string,parent?:string):Promise<string> {
  type Folder={google_id:string;name:string;parent_id:string|null};
  let folder=await driveStore<Folder|null>(client,'folder_get',{key});
  if(!folder)folder=await driveStore<Folder>(client,'folder_reserve',{key,name,parent_id:parent,google_id:await generatedId(token)});
  const found=await google(token,'files/'+encodeURIComponent(folder.google_id)+'?fields=id,trashed,mimeType');
  if(found.ok) { const data=await found.json();if(data.trashed || data.mimeType!=='application/vnd.google-apps.folder')throw new DriveError('temporary','La carpeta de comprobantes no está disponible.',360);return folder.google_id; }
  if(found.status!==404)throw new DriveError('temporary','No pudimos comprobar la carpeta de Drive.');
  const created=await google(token,'files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:folder.google_id,name:folder.name,mimeType:'application/vnd.google-apps.folder',...(folder.parent_id?{parents:[folder.parent_id]}:{})})});
  if(!created.ok && created.status!==409)throw new DriveError('temporary','No pudimos crear la carpeta de Drive.');
  if(created.status===409) {const check=await google(token,'files/'+encodeURIComponent(folder.google_id)+'?fields=id,trashed');if(!check.ok || (await check.json()).trashed)throw new DriveError('temporary','No pudimos verificar la carpeta de Drive.');}
  return folder.google_id;
}
async function uploadReceipt(client:SupabaseClient,token:string,job:DriveJob) {
  const {data,error}=await client.from('receipts').select('*').eq('id',job.receipt_id).single();
  if(error || !data)throw new DriveError('temporary','No se encontró el comprobante para archivar.');
  const receipt=data as Receipt,pdf=await ensureReceiptPDF(client,receipt);
  const root=await ensureFolder(client,token,'root','Minue - Comprobantes');
  const month=receiptMonth(receipt.snapshot.confirmed_at);
  const year=await ensureFolder(client,token,'year:'+month.year,month.year,root);
  const folder=await ensureFolder(client,token,'month:'+month.key,month.name,year);
  if(!job.google_id) {
    const updated=await driveStore<DriveJob>(client,'file_id',{receipt_id:job.receipt_id,lease:job.lease,google_id:await generatedId(token)});
    job.google_id=updated.google_id;
  }
  const id=encodeURIComponent(job.google_id!);
  const md5=createHash('md5').update(pdf).digest('hex');
  const verify=async()=>{const r=await google(token,'files/'+id+'?fields=id,md5Checksum,trashed');if(!r.ok)return false;const f=await r.json();return !f.trashed && f.md5Checksum===md5;};
  if(!await verify()) {
    const boundary='minue-'+randomBytes(12).toString('hex');
    const metadata={id:job.google_id,name:receiptFilename(receipt),parents:[folder],appProperties:{receipt_id:receipt.id,template_version:'2'}};
    const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: application/pdf\r\n\r\n'),Buffer.from(pdf),Buffer.from('\r\n--'+boundary+'--')]);
    const response=await google(token,'files?uploadType=multipart&fields=id,md5Checksum',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body},true);
    if(!response.ok && response.status!==409)throw new DriveError('temporary','No se pudo subir el comprobante a Drive.');
    if(!await verify())throw new DriveError('temporary','No se pudo verificar el archivo en Drive.');
  }
  await driveStore(client,'saved',{receipt_id:job.receipt_id,lease:job.lease});
}
export async function processDriveJobs(client=adminClient(),receiptId?:string) {
  const jobs=await driveStore<DriveJob[]>(client,'claim',receiptId?{receipt_id:receiptId}:{});
  if(!jobs.length)return;
  let access:string;
  try {
    const connection=await driveStore<DriveConnection|null>(client,'connection_get');
    if(!connection || connection.state!=='connected' || !driveConfigured())throw new DriveError('reconnect','Falta conectar Google Drive.');
    let refresh:string;
    try{refresh=unseal(connection.encrypted_token);}catch{throw new DriveError('reconnect','Vuelve a conectar Google Drive.');}
    access=(await googleToken({grant_type:'refresh_token',refresh_token:refresh})).access_token;
  }catch(error) {
    if(error instanceof DriveError && error.kind==='reconnect'){await driveStore(client,'connection_reconnect');return;}
    await Promise.all(jobs.map(job=>driveStore(client,'failed',{receipt_id:job.receipt_id,lease:job.lease,error:'Conexión con Google no disponible.'})));return;
  }
  await Promise.allSettled(jobs.map(async job=>{
    try {await uploadReceipt(client,access,job);console.info('receipt_drive_saved',{receipt_id:job.receipt_id});}
    catch(error) {
      if(error instanceof DriveError && error.kind==='reconnect')await driveStore(client,'connection_reconnect');
      else await driveStore(client,'failed',{receipt_id:job.receipt_id,lease:job.lease,error:error instanceof DriveError?error.message:'Archivo pendiente de reintento.',retry_minutes:error instanceof DriveError?error.retryMinutes:0});
      console.warn('receipt_drive_pending',{receipt_id:job.receipt_id});
    }
  }));
}
