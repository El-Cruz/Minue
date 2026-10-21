import type { Receipt } from './types.js';
export function receiptFilename(receipt: Receipt, original = false): string {
  return original ? receipt.folio + '-original.pdf' : 'Comprobante-' + (receipt.receipt_number || receipt.folio) + '.pdf';
}
export function receiptMonth(value: string) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Guayaquil',year:'numeric',month:'2-digit'}).formatToParts(new Date(value));
  const year = parts.find(p => p.type === 'year')!.value, month = parts.find(p => p.type === 'month')!.value;
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return { year, key:year + '-' + month, name:year + '-' + month + ' ' + months[Number(month)-1] };
}
