import { supabase } from './supabase';
import type { Data, Command } from './types';
async function headers() {
  const { data } = await supabase!.auth.getSession();
  if (!data.session) throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.');
  return { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' };
}
export async function loadData(): Promise<Data> {
  const names = ['profiles', 'destinations', 'contacts', 'products', 'deliveries', 'delivery_events', 'receipts'];
  const results = await Promise.all(names.map(async name => {
    const rows: unknown[] = [];
    for (let start = 0; ; start += 500) {
      const result = await supabase!.from(name).select('*').order('id').range(start, start + 499);
      if (result.error) throw new Error('No pudimos cargar los datos. Comprueba la conexión y la configuración de Minue.');
      rows.push(...result.data);
      if (result.data.length < 500) return rows;
    }
  }));
  return Object.fromEntries(results.map((rows, n) => [n === 5 ? 'events' : names[n], rows])) as Data;
}
export async function command(input: Command) {
  if (!navigator.onLine) throw new Error('Necesitas conexión para guardar los cambios.');
  const response = await fetch('/api/command', { method: 'POST', headers: await headers(), body: JSON.stringify(input) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo guardar. Inténtalo de nuevo.');
  return result;
}
export async function receiptPDF(deliveryId: string) {
  const response = await fetch(`/api/receipt?delivery_id=${encodeURIComponent(deliveryId)}`, { headers: await headers(), cache: 'no-store' });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'No se pudo generar el PDF. Puedes reintentarlo desde el historial.');
  }
  return response.blob();
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
