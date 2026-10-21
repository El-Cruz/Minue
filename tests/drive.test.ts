import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DRIVE_EMAIL, DriveError, seal, unseal, processDriveJobs, googleToken } from '../server/drive';
import { receiptMonth } from '../src/lib/receipt-format';
const env={GOOGLE_DRIVE_CLIENT_ID:'client',GOOGLE_DRIVE_CLIENT_SECRET:'secret-for-test',DRIVE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,5).toString('base64'),APP_URL:'https://minue.example'};
beforeEach(()=>{for(const [k,v] of Object.entries(env))vi.stubEnv(k,v);});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('Drive credentials and month boundaries',()=>{
 it('encrypts credentials and separates OAuth state from refresh tokens',()=>{
  const ciphertext=seal('private-refresh');
  expect(ciphertext).not.toContain('private-refresh');expect(unseal(ciphertext)).toBe('private-refresh');
  expect(()=>unseal(ciphertext,'oauth-state')).toThrow();
  expect(()=>unseal(ciphertext.slice(0,-6)+'AAAAAA')).toThrow();
 });
 it('uses the original confirmation month in Quito at UTC and year boundaries',()=>{
  expect(receiptMonth('2027-01-01T04:59:59Z')).toEqual({year:'2026',key:'2026-12',name:'2026-12 Diciembre'});
  expect(receiptMonth('2027-01-01T05:00:00Z').key).toBe('2027-01');
 });
 it('recognises a revoked connection without exposing Google error contents',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'invalid_grant',error_description:'private-data'}),{status:400})));
  await expect(googleToken({grant_type:'refresh_token',refresh_token:'test'})).rejects.toMatchObject({kind:'reconnect'});
 });
});
describe('archive retry after an ambiguous upload',()=>{
 it('reuses a reserved file ID and verifies bytes instead of uploading a duplicate',async()=>{
  const pdf=Buffer.from('%PDF-test-bytes'),receipt={id:crypto.randomUUID(),receipt_number:'PRA-065',template_version:3,snapshot:{confirmed_at:'2026-11-01T04:30:00Z'}};
  const files=new Map<string,any>(),folders=new Map<string,any>();
  let serial=0,uploads=0,pending=true,saved=false;
  const job={receipt_id:receipt.id,lease:crypto.randomUUID(),google_id:null as string|null,attempts:1};
  const client={
   rpc:vi.fn(async(_name:string,{p_action:a,p_payload:p}:any)=>{
    let data:any=null;
    if(a==='claim'){data=pending?[{...job}]:[];pending=false;}
    if(a==='connection_get')data={email:DRIVE_EMAIL,state:'connected',encrypted_token:seal('refresh')};
    if(a==='folder_get')data=folders.get(p.key)||null;
    if(a==='folder_reserve'){if(!folders.has(p.key))folders.set(p.key,{google_id:p.google_id,parent_id:p.parent_id,name:p.name});data=folders.get(p.key);}
    if(a==='file_id'){job.google_id ||=p.google_id;data={...job};}
    if(a==='failed')pending=true;
    if(a==='saved')saved=true;
    return {data,error:null};
   }),
   from:()=>({select:()=>({eq:()=>({single:async()=>({data:receipt,error:null})})})}),
   storage:{from:()=>({download:async()=>({data:new Blob([pdf]),error:null})})}
  } as unknown as SupabaseClient;
  vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
   const url=new URL(input);
   if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'access'});
   if(url.pathname.endsWith('/generateIds'))return Response.json({ids:['file-'+(++serial)]});
   if(url.hostname!=='www.googleapis.com')throw new Error('Unexpected destination');
   if(url.pathname.startsWith('/upload/')){
    expect(Buffer.from(init!.body as Uint8Array).toString()).toContain('\"template_version\":\"3\"');
    uploads++;files.set(job.google_id!,{id:job.google_id,mimeType:'application/pdf',md5Checksum:createHash('md5').update(pdf).digest('hex')});
    throw new Error('Connection lost after Google saved the file');
   }
   if(init?.method==='POST'){
    const body=JSON.parse(String(init.body));files.set(body.id,{...body,trashed:false});return Response.json({id:body.id});
   }
   const id=url.pathname.split('/').at(-1)!;
   return files.has(id)?Response.json(files.get(id)):new Response('{}',{status:404});
  }));
  await processDriveJobs(client);expect(uploads).toBe(1);expect(saved).toBe(false);
  const reserved=job.google_id;
  await processDriveJobs(client);expect(saved).toBe(true);expect(job.google_id).toBe(reserved);expect(uploads).toBe(1);
  expect([...folders.keys()]).toContain('month:2026-10');
 });
 it('pauses jobs when the required account is not connected',async()=>{
  const calls:string[]=[];
  const client={rpc:async(_n:string,{p_action}:any)=>{calls.push(p_action);return {data:p_action==='claim'?[{receipt_id:crypto.randomUUID()}]:null,error:null};}} as unknown as SupabaseClient;
  await processDriveJobs(client);expect(calls).toEqual(['claim','connection_get','connection_reconnect']);
 });
 it('requests reconnection when an encrypted credential can no longer be decrypted',async()=>{
  const calls:string[]=[];
  const client={rpc:async(_n:string,{p_action}:any)=>{calls.push(p_action);return {data:p_action==='claim'?[{receipt_id:crypto.randomUUID()}]:p_action==='connection_get'?{state:'connected',encrypted_token:'invalid'}:null,error:null};}} as unknown as SupabaseClient;
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await processDriveJobs(client);expect(calls).toEqual(['claim','connection_get','connection_reconnect']);expect(fetch).not.toHaveBeenCalled();
 });
});
