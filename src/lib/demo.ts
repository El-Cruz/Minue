import { offsetDate, today } from './dates';
import { DESTINATION_CITY } from './location';
import type { Data } from './types';
export const DEMO_USER = '10000000-0000-4000-8000-000000000001';
export function demoData(): Data {
  const now = new Date().toISOString();
  const destinations = [
    { id: '20000000-0000-4000-8000-000000000001', name: 'Veterinaria Huellitas', address: 'Calle 116 # 19-42', city: DESTINATION_CITY, phone: '601 555 0101', notes: 'Recibir en la entrada principal.', active: true },
    { id: '20000000-0000-4000-8000-000000000002', name: 'Animalia Clínica Veterinaria', address: 'Carrera 15 # 93-28', city: DESTINATION_CITY, phone: '601 555 0102', notes: 'Preguntar por recepción.', active: true },
    { id: '20000000-0000-4000-8000-000000000003', name: 'La Casa de las Mascotas', address: 'Calle 85 # 11-35', city: DESTINATION_CITY, phone: '601 555 0103', notes: '', active: true },
    { id: '20000000-0000-4000-8000-000000000004', name: 'Vet & Vida', address: 'Carrera 7 # 72-41', city: DESTINATION_CITY, phone: '601 555 0104', notes: 'Ingreso por la puerta lateral.', active: true },
  ];
  const codes = ['HUE','ANI','CAS','VET'];
  destinations.forEach((d, n) => Object.assign(d, { receipt_code: codes[n], receipt_next_number: 1 }));
  const products: Data['products'] = [
    { id: '30000000-0000-4000-8000-000000000001', name: 'Dieta natural · Pollo', unit: 'kg', species: 'dog', active: true },
    { id: '30000000-0000-4000-8000-000000000002', name: 'Dieta natural · Res', unit: 'kg', species: 'dog', active: true },
    { id: '30000000-0000-4000-8000-000000000003', name: 'Dieta felina · Pollo', unit: 'kg', species: 'cat', active: true },
  ];
  const deliveries = [0, 1, 2, 3, 4].map((n): Data['deliveries'][number] => ({
    id: `40000000-0000-4000-8000-00000000000${n + 1}`,
    destination_id: destinations[n % 4].id, assigned_to: DEMO_USER,
    scheduled_date: n === 4 ? offsetDate(today(), 1) : today(),
    time_window: ['09:00 – 11:00', '10:00 – 12:00', '13:00 – 15:00', '14:00 – 16:00', '09:00 – 11:00'][n],
    notes: n === 0 ? 'Mantener refrigerado. Entregar las dietas directamente al personal.' : '',
    status: 'pending', created_at: now,
    items: [{ product_id: products[n % 3].id, name: products[n % 3].name, quantity: [12, 8, 16, 6, 10][n], unit: products[n % 3].unit }, ...(n === 0 ? [{ product_id: products[2].id, name: products[2].name, quantity: 6, unit: products[2].unit }] : [])],
  }));
  return { profiles: [{ id: DEMO_USER, name: 'Alex', email: 'alex@ejemplo.com', is_admin: true, is_courier: true, active: true }, {id:'10000000-0000-4000-8000-000000000002',name:'Sofía',email:'sofia@ejemplo.com',is_admin:false,is_courier:true,active:true}], destinations, products, deliveries, receipts: [], events: [], contacts: destinations.flatMap((d, n) => [{ id: `50000000-0000-4000-8000-00000000000${n + 1}`, destination_id: d.id, name: ['Laura Martínez', 'Andrés Gómez', 'Camila Torres', 'Daniel Rojas'][n] }]) };
}
