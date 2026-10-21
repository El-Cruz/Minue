export const TIME_ZONE = 'America/Bogota';
export function today(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
export function offsetDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00-05:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return today(date);
}
export function formatDate(value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('es-CO', { timeZone: TIME_ZONE, ...options }).format(new Date(value.length === 10 ? `${value}T12:00:00-05:00` : value));
}
export function formatTime(value: string) {
  return new Intl.DateTimeFormat('es-CO', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
export function summarize(deliveries: { status: string }[]) {
  return { total: deliveries.length, pending: deliveries.filter(d => d.status === 'pending').length, delivered: deliveries.filter(d => d.status === 'delivered').length, failed: deliveries.filter(d => d.status === 'failed').length };
}
