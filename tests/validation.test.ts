import { describe, expect, it } from 'vitest';
import { decodeSignature, validateCommand } from '../server/validation';
import { PNG } from 'pngjs';
describe('API input boundary', () => {
  it('rejects the same courier in both assignment slots',()=>{
    const courier=crypto.randomUUID();
    expect(()=>validateCommand('save_delivery',{destination_id:crypto.randomUUID(),assigned_to:courier,partner_id:courier,scheduled_date:'2026-10-20',notes:'',time_window:'',items:[{product_id:crypto.randomUUID(),quantity:1}]})).toThrow();
  });
  it('rejects unknown actions and role-free invitations', () => {
    expect(() => validateCommand('__proto__', {})).toThrow();
    expect(() => validateCommand('invite_user', {email:'a@example.com',name:'Admin',is_admin:false,is_courier:false})).toThrow();
  });
  it('rejects impossible dates and zero quantities', () => {
    const payload={destination_id:crypto.randomUUID(),assigned_to:crypto.randomUUID(),scheduled_date:'2026-02-30',notes:'',time_window:'',items:[{product_id:crypto.randomUUID(),quantity:1}]};
    expect(() => validateCommand('save_delivery',payload)).toThrow();
    expect(() => validateCommand('save_delivery',{...payload,scheduled_date:'2026-10-20',items:[{product_id:crypto.randomUUID(),quantity:0}]})).toThrow();
  });
  it('rejects duplicate products and forged image types', () => {
    const product_id=crypto.randomUUID();
    expect(() => validateCommand('save_delivery',{destination_id:crypto.randomUUID(),assigned_to:crypto.randomUUID(),scheduled_date:'2026-10-20',notes:'',time_window:'',items:[{product_id,quantity:1},{product_id,quantity:2}]})).toThrow();
    expect(() => decodeSignature('data:image/svg+xml;base64,PHN2Zz4=')).toThrow();
    expect(() => decodeSignature('data:image/png;base64,YWJjZGVmZ2g=')).toThrow();
  });
  it('requires actual ink and validates decoded PNG contents', () => {
    const png = new PNG({ width: 150, height: 100 });
    png.data.fill(255);
    const encode = () => `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    expect(() => decodeSignature(encode())).toThrow('vacía');
    for (let x = 30; x < 80; x++) {
      const i = (50 * png.width + x) * 4;
      png.data[i] = 30; png.data[i + 1] = 55; png.data[i + 2] = 40;
    }
    expect(decodeSignature(encode()).length).toBeGreaterThan(100);
  });
});
