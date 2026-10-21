import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ServerResponse } from 'node:http';
import type { Request } from '../server/http';
const state=vi.hoisted(()=>({
  profile:{is_admin:true,active:true},rpc:vi.fn(),fetch:vi.fn(),worker:vi.fn(async()=>{}),
}));
vi.mock('../server/http',async()=>{
  const actual=await vi.importActual<typeof import('../server/http')>('../server/http');
  const client={rpc:state.rpc,from:()=>({select:()=>({eq:()=>({single:async()=>({data:state.profile})})})})};
  return {...actual,adminClient:()=>client,authorize:async()=>({client,user:{id:'admin-id'},profile:state.profile})};
});
vi.mock('../server/drive',async()=>({...await vi.importActual<typeof import('../server/drive')>('../server/drive'),processDriveJobs:state.worker}));
import callback from '../api/drive-callback';
import connect from '../api/drive-connect';
import worker from '../api/drive-worker';
import { DRIVE_EMAIL,seal,unseal } from '../server/drive';
function response(){return {setHeader:vi.fn(),end:vi.fn(),statusCode:0} as unknown as ServerResponse;}
function request(overrides:Partial<Request>={}){return {method:'GET',url:'/api/drive-callback?code=auth-code&state=nonce',headers:{cookie:'minue_drive_state='+seal(JSON.stringify({nonce:'nonce',adminId:'admin-id',expires:Date.now()+60000}),'oauth-state')},...overrides} as Request;}
beforeEach(()=>{
  vi.clearAllMocks();state.profile={is_admin:true,active:true};
  for(const [key,value] of Object.entries({GOOGLE_DRIVE_CLIENT_ID:'client-id',GOOGLE_DRIVE_CLIENT_SECRET:'test-client-secret',DRIVE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),DRIVE_WORKER_SECRET:'test-worker-secret',APP_URL:'https://minue.example'}))vi.stubEnv(key,value);
  state.rpc.mockResolvedValue({data:null,error:null});
  state.fetch.mockImplementation(async(input:string)=>input.includes('/token')?Response.json({access_token:'access',refresh_token:'private-refresh-token'}):Response.json({email:DRIVE_EMAIL,email_verified:true}));
  vi.stubGlobal('fetch',state.fetch);
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('rejects expired or mismatched OAuth state before contacting Google',async()=>{
  const expired=seal(JSON.stringify({nonce:'nonce',adminId:'admin-id',expires:Date.now()-1}),'oauth-state');
  for(const req of [request({headers:{cookie:'minue_drive_state='+expired}}),request({url:'/api/drive-callback?code=x&state=incorrect'})]){
    const res=response();await callback(req,res);expect(res.setHeader).toHaveBeenCalledWith('Location','/?drive=error');
  }
  expect(state.fetch).not.toHaveBeenCalled();expect(state.rpc).not.toHaveBeenCalled();
});
it('rechecks current administrator access before accepting an OAuth callback',async()=>{
  state.profile.is_admin=false;const res=response();await callback(request(),res);
  expect(state.fetch).not.toHaveBeenCalled();expect(res.setHeader).toHaveBeenCalledWith('Location','/?drive=error');
});
it('refuses another Google account and unverified email without persisting credentials',async()=>{
  for(const identity of [{email:'someone@example.com',email_verified:true},{email:DRIVE_EMAIL,email_verified:false}]){
    state.fetch.mockImplementation(async(input:string)=>input.includes('/token')?Response.json({access_token:'access',refresh_token:'refresh'}):Response.json(identity));
    const res=response();await callback(request(),res);
    expect(res.setHeader).toHaveBeenCalledWith('Location','/?drive=wrong_account');
  }
  expect(state.rpc).not.toHaveBeenCalled();expect(state.worker).not.toHaveBeenCalled();
});
it('persists only an encrypted refresh token and starts pending jobs after the required account connects',async()=>{
  const res=response();await callback(request(),res);
  const payload=state.rpc.mock.calls.find(call=>call[1].p_action==='connection_set')![1].p_payload;
  expect(payload.email).toBe(DRIVE_EMAIL);expect(payload.encrypted_token).not.toContain('private-refresh-token');
  expect(unseal(payload.encrypted_token)).toBe('private-refresh-token');
  expect(res.setHeader).toHaveBeenCalledWith('Location','/?drive=connected');
  expect(state.worker).toHaveBeenCalledOnce();
  expect(JSON.stringify(vi.mocked(res.end).mock.calls)).not.toContain('private-refresh-token');
});
it('allows only administrators and same-origin JSON requests to initiate the connection',async()=>{
  state.profile.is_admin=false;
  let res=response();await connect(request({method:'POST',body:{},headers:{'content-type':'application/json'}}),res);expect(res.statusCode).toBe(403);
  state.profile.is_admin=true;
  res=response();await connect(request({method:'POST',body:{},headers:{'content-type':'application/json',origin:'https://other.example'}}),res);expect(res.statusCode).toBe(403);
  expect(state.fetch).not.toHaveBeenCalled();
});
it('requests only file access and identity scopes with a protected state cookie',async()=>{
  const res=response();await connect(request({method:'POST',body:{},headers:{'content-type':'application/json',origin:'https://minue.example'}}),res);
  const result=JSON.parse(vi.mocked(res.end).mock.calls[0][0] as string),url=new URL(result.url);
  expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/drive.file');
  expect(url.searchParams.get('redirect_uri')).toBe('https://minue.example/api/drive-callback');
  expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie',expect.stringMatching(/HttpOnly; SameSite=Lax; Path=\/api\/drive-callback; Max-Age=600; Secure/));
});
it('requires the worker secret before processing queued receipts',async()=>{
  const denied=response();await worker(request({method:'POST',headers:{authorization:'Bearer wrong'}}),denied);
  expect(denied.statusCode).toBe(401);expect(state.worker).not.toHaveBeenCalled();
  const allowed=response();await worker(request({method:'POST',headers:{authorization:'Bearer test-worker-secret'}}),allowed);
  expect(allowed.statusCode).toBe(200);expect(state.worker).toHaveBeenCalledOnce();
});
