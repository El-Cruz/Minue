import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Receipt } from '../src/lib/types';
import { ensureReceiptPDF } from '../server/receipt';
const download = vi.fn(), upload = vi.fn(), update = vi.fn(), eq = vi.fn();
const client = { storage: { from: () => ({ download, upload }) }, from: () => ({ update }) } as unknown as SupabaseClient;
const receipt = { id: crypto.randomUUID(), pdf_path: null, receipt_number:'PRA-065', snapshot: { signature_path: 'private/signature.png' } } as Receipt;
beforeEach(() => { vi.clearAllMocks(); update.mockReturnValue({ eq }); eq.mockResolvedValue({ error: null }); });
describe('private receipt storage recovery', () => {
  it('reuses a stored v2 PDF without overwriting an original', async () => {
    download.mockResolvedValueOnce({ error: null, data: new Blob(['existing-pdf']) });
    const bytes = await ensureReceiptPDF(client, receipt);
    expect(new TextDecoder().decode(bytes)).toBe('existing-pdf');
    expect(download).toHaveBeenCalledWith('receipts/' + receipt.id + '/v2.pdf');
    expect(upload).not.toHaveBeenCalled();
  });
  it('keeps the immutable receipt when the signature store is temporarily unavailable', async () => {
    download.mockResolvedValue({ error: { message: 'offline' }, data: null });
    await expect(ensureReceiptPDF(client, receipt)).rejects.toThrow('La entrega está guardada');
    expect(update).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });
  it('downloads the original bytes using the preserved path',async()=>{
    download.mockResolvedValue({error:null,data:new Blob(['original-bytes'])});
    const pdf=await ensureReceiptPDF(client,{...receipt,pdf_path:'receipts/original.pdf'},true);
    expect(new TextDecoder().decode(pdf)).toBe('original-bytes');expect(download).toHaveBeenCalledWith('receipts/original.pdf');
    expect(upload).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();
  });
  it('never replaces a missing original with a newly generated PDF',async()=>{
    download.mockResolvedValue({error:{message:'missing'},data:null});
    await expect(ensureReceiptPDF(client,receipt,true)).rejects.toMatchObject({status:404});
    expect(download).toHaveBeenCalledOnce();expect(upload).not.toHaveBeenCalled();
  });
  it('does not fabricate a historical signature or PDF when only an original Drive reference exists',async()=>{
    await expect(ensureReceiptPDF(client,{...receipt,legacy_id:'old-id',legacy_pdf_url:'https://drive.google.com/file/d/synthetic/view'})).rejects.toMatchObject({status:409});
    expect(download).not.toHaveBeenCalled();expect(upload).not.toHaveBeenCalled();
  });
  it('serves an exact preserved historical copy for both current and original requests',async()=>{
    download.mockResolvedValue({error:null,data:new Blob(['original-historical-bytes'])});
    const historical={...receipt,legacy_id:'old-id',pdf_path:'legacy/old.pdf'};
    for(const original of [false,true])expect(new TextDecoder().decode(await ensureReceiptPDF(client,historical,original))).toBe('original-historical-bytes');
    expect(download).toHaveBeenCalledWith('legacy/old.pdf');expect(upload).not.toHaveBeenCalled();
  });
});

it('retrieves v3 from its immutable path without falling back to or replacing v2',async()=>{
 download.mockResolvedValueOnce({error:null,data:new Blob(['vector-pdf'])});
 const bytes=await ensureReceiptPDF(client,{...receipt,template_version:3});
 expect(new TextDecoder().decode(bytes)).toBe('vector-pdf');
 expect(download).toHaveBeenCalledWith('receipts/'+receipt.id+'/v3.pdf');expect(upload).not.toHaveBeenCalled();
});
