import {expect,it} from 'vitest';
import {belongsToProfile,legacyReceiptUrl} from '../src/lib/legacy';
import {receiptFilename} from '../src/lib/receipt-format';
import type {Delivery,Receipt} from '../src/lib/types';
it('allows explicit historical participants without treating a similar name as identity',()=>{
 const delivery={assigned_to:null,legacy_courier:'Nombre parecido',legacy_profile_ids:['verified-profile-id']} as Delivery;
 expect(belongsToProfile(delivery,'verified-profile-id')).toBe(true);
 expect(belongsToProfile(delivery,'different-profile-id')).toBe(false);
 expect(belongsToProfile({...delivery,partner_id:'partner-profile-id'},'partner-profile-id')).toBe(true);
});
it('accepts only original Google Drive PDF references on historical receipts',()=>{
 const receipt={legacy_id:'old-id',legacy_pdf_url:'https://drive.google.com/file/d/synthetic-id/view?usp=drivesdk',receipt_number:'HIS-042'} as Receipt;
 expect(legacyReceiptUrl(receipt)).toBe(receipt.legacy_pdf_url);
 expect(receiptFilename(receipt)).toBe('Comprobante-HIS-042.pdf');
 for(const url of ['javascript:alert(1)','https://drive.google.com.evil.example/file/d/id/view','https://other.example/file/d/id/view'])expect(legacyReceiptUrl({...receipt,legacy_pdf_url:url})).toBeNull();
});
