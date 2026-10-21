import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Receipt } from '../src/lib/types';
import { ensureReceiptPDF } from '../server/receipt';
const download = vi.fn(), upload = vi.fn(), update = vi.fn(), eq = vi.fn();
const client = { storage: { from: () => ({ download, upload }) }, from: () => ({ update }) } as unknown as SupabaseClient;
const receipt = { id: crypto.randomUUID(), pdf_path: null, snapshot: { signature_path: 'private/signature.png' } } as Receipt;
beforeEach(() => { vi.clearAllMocks(); update.mockReturnValue({ eq }); eq.mockResolvedValue({ error: null }); });
describe('private receipt storage recovery', () => {
  it('repairs missing metadata for an already stored PDF instead of overwriting it', async () => {
    download.mockResolvedValueOnce({ error: null, data: new Blob(['existing-pdf']) });
    const bytes = await ensureReceiptPDF(client, receipt);
    expect(new TextDecoder().decode(bytes)).toBe('existing-pdf');
    expect(update).toHaveBeenCalledWith({pdf_path:`receipts/${receipt.id}.pdf`});
    expect(upload).not.toHaveBeenCalled();
  });
  it('keeps the immutable receipt when the signature store is temporarily unavailable', async () => {
    download.mockResolvedValue({ error: { message: 'offline' }, data: null });
    await expect(ensureReceiptPDF(client, receipt)).rejects.toThrow('La entrega está guardada');
    expect(update).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });
});
