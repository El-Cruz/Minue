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
});
