import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from '../server/http';
import type { ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
const state = vi.hoisted(() => ({ client: { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } }, body: {} as any, profile: { is_admin: true, is_courier: true }, pdf: vi.fn(), json: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock('../server/http', async () => {
  const original = await vi.importActual<typeof import('../server/http')>('../server/http');
  return { ...original, authorize: vi.fn(async () => ({ client: state.client, user: { id: '10000000-0000-4000-8000-000000000001' }, profile: state.profile })), body: vi.fn(async () => state.body), json: state.json, fail: (res: ServerResponse, error: unknown) => state.json(res, error instanceof original.HttpError ? error.status : 500, { error: (error as Error).message }) };
});
vi.mock('../server/receipt', () => ({ BUCKET: 'minue-private', ensureReceiptPDF: state.pdf }));
vi.mock('../server/drive', () => ({ processDriveJobs: vi.fn(async () => {}) }));
import handler from '../api/command';
import receiptHandler from '../api/receipt';
const deliveryId = '40000000-0000-4000-8000-000000000001';
const actor = '10000000-0000-4000-8000-000000000001';
const receipt = { id: crypto.randomUUID(), delivery_id: deliveryId, snapshot: { signature_path: 'old/signature.png' } };
const req = { method: 'POST', headers: {} } as Request;
const res = {} as ServerResponse;
beforeEach(async () => {
  vi.clearAllMocks(); state.profile = { is_admin: true, is_courier: true };
  state.client.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: { assigned_to: actor, status: 'pending' } }) }) }) });
  state.client.rpc.mockResolvedValue({ data: receipt, error: null });
  state.upload.mockResolvedValue({ error: null }); state.remove.mockResolvedValue({ error: null });
  state.client.storage.from.mockReturnValue({ upload: state.upload, remove: state.remove });
  state.pdf.mockResolvedValue(new Uint8Array());
  state.body = { action: 'confirm_delivery', payload: { delivery_id: deliveryId, recipient_id: crypto.randomUUID(), new_recipient: '', signature: `data:image/png;base64,${(await readFile('public/icon-192.png')).toString('base64')}`, observation: '', request_id: crypto.randomUUID() } };
});
describe('confirmation API failure boundaries', () => {
  it('allows the second assigned courier to confirm the shared delivery',async()=>{
    state.client.from.mockReturnValue({select:()=>({eq:()=>({single:async()=>({data:{assigned_to:crypto.randomUUID(),partner_id:actor,status:'pending'}})})})});
    await handler(req,res);
    expect(state.client.rpc).toHaveBeenCalledOnce();expect(state.upload).toHaveBeenCalledOnce();
    expect(state.json).toHaveBeenCalledWith(res,200,expect.objectContaining({ok:true}));
  });
  it('keeps a successful confirmation successful when PDF creation fails', async () => {
    state.pdf.mockRejectedValue(new Error('storage unavailable'));
    await handler(req, res);
    expect(state.json).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true, pdf_pending: true, data: receipt }));
  });
  it('does not change delivery state when signature upload fails', async () => {
    state.upload.mockResolvedValue({ error: { message: 'unavailable' } });
    await handler(req, res);
    expect(state.client.rpc).not.toHaveBeenCalled();
    expect(state.json).toHaveBeenCalledWith(res, 503, expect.objectContaining({ error: expect.stringContaining('sigue pendiente') }));
  });
  it('retries already delivered requests without re-uploading a signature', async () => {
    state.client.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: { assigned_to: actor, status: 'delivered' } }) }) }) });
    await handler(req, res);
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.client.rpc).toHaveBeenCalledOnce();
    expect(state.json).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true }));
  });
  it('blocks a courier from administrator operations before the database', async () => {
    state.profile.is_admin = false;
    state.body = { action: 'reschedule_delivery', payload: { delivery_id: deliveryId, scheduled_date: '2026-10-21', note: 'Otra fecha' } };
    await handler(req, res);
    expect(state.client.rpc).not.toHaveBeenCalled();
    expect(state.json).toHaveBeenCalledWith(res, 403, expect.anything());
  });
  it('keeps an uploaded signature on uncertain commit results', async () => {
    state.client.rpc.mockResolvedValue({ data: null, error: { code: 'NETWORK_ERROR' } });
    await handler(req, res);
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.json).toHaveBeenCalledWith(res, 503, expect.objectContaining({ error: expect.stringContaining('no se duplicará') }));
  });
  it('denies another courier access to a private receipt', async () => {
    state.profile.is_admin = false;
    state.client.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: { assigned_to: crypto.randomUUID(), status: 'delivered' } }) }) }) });
    await receiptHandler({ method: 'GET', url: `/api/receipt?delivery_id=${deliveryId}`, headers: {} } as Request, res);
    expect(state.pdf).not.toHaveBeenCalled();
    expect(state.json).toHaveBeenCalledWith(res,404,expect.anything());
  });
  it('returns an owned PDF with private, no-store headers', async () => {
    state.profile.is_admin = false;
    state.client.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({ single: async () => ({ data: table === 'deliveries' ? { assigned_to: actor, status: 'delivered' } : { ...receipt, folio: 'MIN-20261020-00001' } }) }) }) }));
    const response = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 } as unknown as ServerResponse;
    await receiptHandler({ method: 'GET', url: `/api/receipt?delivery_id=${deliveryId}`, headers: {} } as Request, response);
    expect(response.statusCode).toBe(200);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control','private, no-store');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type','application/pdf');
  });
});

describe('team membership access',()=>{
  it('denies removal by a courier before any profile lookup or mutation',async()=>{
    state.profile.is_admin=false;state.body={action:'remove_member',payload:{id:crypto.randomUUID()}};
    await handler(req,res);expect(state.client.from).not.toHaveBeenCalled();expect(state.client.rpc).not.toHaveBeenCalled();expect(state.json).toHaveBeenCalledWith(res,403,expect.anything());
  });
  it('denies self removal',async()=>{
    state.body={action:'remove_member',payload:{id:actor}};await handler(req,res);
    expect(state.client.rpc).not.toHaveBeenCalled();expect(state.json).toHaveBeenCalledWith(res,409,expect.anything());
  });
  it('revokes access through the protected transaction and preserves the historical profile',async()=>{
    const member={id:crypto.randomUUID(),name:'Persona de ejemplo',active:true,is_admin:false,is_courier:true};
    state.body={action:'remove_member',payload:{id:member.id}};
    state.client.from.mockReturnValue({select:()=>({eq:()=>({single:async()=>({data:member,error:null})})})});
    await handler(req,res);
    expect(state.client.rpc).toHaveBeenCalledWith('minue_command',{p_actor:actor,p_action:'update_profile',p_payload:{...member,active:false}});
    expect(state.json).toHaveBeenCalledWith(res,200,{ok:true});
  });
  it('preserves last-admin rejection from the database',async()=>{
    const id=crypto.randomUUID();state.body={action:'remove_member',payload:{id}};
    state.client.from.mockReturnValue({select:()=>({eq:()=>({single:async()=>({data:{id,name:'Otro admin',is_admin:true,is_courier:true}})})})});
    state.client.rpc.mockResolvedValue({error:{code:'P0001',message:'Debe quedar una cuenta administradora activa.'}});
    await handler(req,res);expect(state.json).toHaveBeenCalledWith(res,409,{error:'Debe quedar una cuenta administradora activa.'});
  });
});
