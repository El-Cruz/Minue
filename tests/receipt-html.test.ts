import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReceiptDocument from '../src/components/ReceiptDocument';
import type { Receipt } from '../src/lib/types';

it('renders a readable receipt with its number, actual Quito timestamp and item units', () => {
  const receipt = { receipt_number: 'PRA-071', snapshot: {
    confirmed_at: '2026-11-06T01:35:00Z', scheduled_date: '2026-11-01',
    destination: { name: 'Pradera', address: '', city: 'Quito' },
    recipient: 'Ana', items: [{name:'Bark Bites',quantity:2,unit:'unidad'}],
  }} as Receipt;
  const html = renderToStaticMarkup(createElement(ReceiptDocument, {receipt, signature:'data:image/png;base64,AA=='}));
  expect(html).toContain('PRA-071');
  expect(html).toContain('05/11/2026');
  expect(html).toContain('20:35');
  expect(html).toContain('2 unidad');
  expect(html).not.toContain('<canvas');
});
