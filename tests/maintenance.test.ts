import {beforeEach,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const mocks=vi.hoisted(()=>({pdf:vi.fn(),google:vi.fn(),connection:vi.fn()}));
vi.mock('../server/receipt',()=>({BUCKET:'minue-private',ensureReceiptPDF:mocks.pdf}));
vi.mock('../server/drive',()=>({driveStore:mocks.connection,google:mocks.google,googleToken:async()=>({access_token:'token'}),unseal:()=> 'refresh'}));
import {processMaintenance} from '../server/maintenance';
let job:any,removed:string[],failStorage:boolean,driveStatus:string;
const client={rpc:async(_name:string,{p_action,p_payload}:any)=>{
 if(p_action==='claim')return {data:[structuredClone(job)],error:null};
 job.state=p_action==='done'?'done':'pending';job.error=p_payload.error;
 if(p_action==='prepared')job.payload.phase='archive';return {data:null,error:null};
},storage:{from:()=>({remove:async(paths:string[])=>{if(failStorage)return {error:{message:'offline'}};removed.push(...paths);return {error:null};},list:async()=>({data:[],error:null})})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:'receipt',drive_status:driveStatus},error:null})})})})} as unknown as SupabaseClient;
beforeEach(()=>{vi.clearAllMocks();removed=[];failStorage=false;driveStatus='pending';job={id:'job',lease:'lease',kind:'delete',state:'processing',payload:{paths:['receipts/test.pdf'],google_id:'drive-id'}};mocks.connection.mockResolvedValue({state:'connected',encrypted_token:'token'});mocks.google.mockResolvedValue(new Response(null,{status:200}));mocks.pdf.mockResolvedValue(new Uint8Array());});
it('retains pending cleanup after storage failure and succeeds on retry',async()=>{
 failStorage=true;await processMaintenance(client);expect(job.state).toBe('pending');expect(removed).toEqual([]);
 failStorage=false;await processMaintenance(client);expect(job.state).toBe('done');expect(removed).toEqual(['receipts/test.pdf']);
});
it('keeps cleanup pending when Drive cannot be reached',async()=>{
 mocks.google.mockRejectedValue(new Error('Drive unavailable'));await processMaintenance(client);expect(job.state).toBe('pending');expect(removed).toEqual([]);
});
it('does not finish reorganization until the new archive is saved',async()=>{
 job.kind='reorganize';job.payload.receipt_id='receipt';await processMaintenance(client);
 expect(job.state).toBe('pending');expect(job.payload.phase).toBe('archive');
 await processMaintenance(client);expect(job.state).toBe('pending');
 driveStatus='saved';await processMaintenance(client);expect(job.state).toBe('done');
});
