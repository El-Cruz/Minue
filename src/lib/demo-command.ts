import type { Data, Receipt, ReceiptSnapshot } from './types';
import { today } from './dates';

export function demoCommand(data: Data, actorId: string, action: string, payload: Record<string, unknown>): Data {
  const next = structuredClone(data);
  const now = new Date().toISOString();
  const id = () => crypto.randomUUID();
  const event = (delivery_id: string, kind: Data['events'][number]['kind'], note: string) => next.events.push({ id: id(), delivery_id, actor_id: actorId, kind, note, created_at: now });
  if (action === 'save_destination' || action === 'save_product') {
    const collection = action === 'save_destination' ? next.destinations : next.products;
    const index = collection.findIndex(entry => entry.id === payload.id);
    const value = { ...payload, id: payload.id || id(), active: payload.active ?? true } as never;
    if (index >= 0) collection[index] = value; else collection.push(value);
  } else if (action === 'save_contact') {
    const index = next.contacts.findIndex(contact => contact.id === payload.id);
    const contact = { id: String(payload.id || id()), destination_id: String(payload.destination_id), name: String(payload.name) };
    if (index >= 0) next.contacts[index] = contact; else next.contacts.push(contact);
  } else if (action === 'save_delivery') {
    const index = next.deliveries.findIndex(entry => entry.id === payload.id);
    if (index >= 0 && next.deliveries[index].status === 'delivered') throw new Error('Una entrega confirmada no se puede modificar.');
    const value = { ...payload, id: payload.id || id(), status: 'pending', created_at: index >= 0 ? next.deliveries[index].created_at : now } as Data['deliveries'][number];
    if (index >= 0) next.deliveries[index] = value; else next.deliveries.push(value);
    event(value.id, index >= 0 ? 'updated' : 'created', 'Entrega programada');
  } else if (action === 'confirm_delivery') {
    const delivery = next.deliveries.find(d => d.id === payload.delivery_id)!;
    if (delivery.status === 'delivered') return next;
    if (delivery.status !== 'pending' || delivery.scheduled_date > today()) throw new Error('Esta entrega no está disponible para confirmar.');
    const destination = next.destinations.find(d => d.id === delivery.destination_id)!;
    let recipient = next.contacts.find(c => c.id === payload.recipient_id && c.destination_id === destination.id);
    if (!recipient && String(payload.new_recipient || '').trim()) {
      recipient = { id: id(), destination_id: destination.id, name: String(payload.new_recipient).trim() };
      next.contacts.push(recipient);
    }
    if (!recipient || !payload.signature) throw new Error('Selecciona a quien recibe y agrega su firma.');
    const snapshot: ReceiptSnapshot = { destination: { name: destination.name, address: destination.address, city: destination.city }, items: structuredClone(delivery.items), courier: next.profiles.find(p => p.id === actorId)!.name, recipient: recipient.name, observation: String(payload.observation || ''), scheduled_date: delivery.scheduled_date, confirmed_at: now, signature_path: '' };
    const receipt: Receipt = { id: id(), delivery_id: delivery.id, folio: `MIN-${today().replaceAll('-', '')}-${String(next.receipts.length + 1).padStart(5, '0')}`, snapshot, created_at: now, pdf_path: null, signature_data: String(payload.signature) };
    next.receipts.push(receipt); delivery.status = 'delivered';
    event(delivery.id, 'delivered', `Recibió ${recipient.name}`);
  } else if (action === 'fail_delivery') {
    const delivery = next.deliveries.find(d => d.id === payload.delivery_id)!;
    if (delivery.status !== 'pending') throw new Error('La entrega ya cambió de estado.');
    delivery.status = 'failed'; event(delivery.id, 'failed', String(payload.note));
  } else if (action === 'reschedule_delivery') {
    const delivery = next.deliveries.find(d => d.id === payload.delivery_id)!;
    if (delivery.status === 'delivered') throw new Error('No se puede reprogramar una entrega confirmada.');
    const previous = delivery.scheduled_date;
    delivery.scheduled_date = String(payload.scheduled_date); delivery.status = 'pending';
    event(delivery.id, 'rescheduled', `${previous} → ${delivery.scheduled_date}. ${payload.note || ''}`);
  } else if (action === 'invite_user') {
    throw new Error('Las invitaciones solo se envían al conectar Supabase. No se envió ningún correo.');
  } else if (action === 'update_profile') {
    const profile = next.profiles.find(p => p.id === payload.id)!;
    Object.assign(profile, payload);
  } else throw new Error('Acción no disponible.');
  return next;
}
