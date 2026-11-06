import type { Data, Receipt, ReceiptSnapshot } from './types';
import { today } from './dates';
import {deliveryCouriers} from './legacy';

export function demoCommand(data: Data, actorId: string, action: string, payload: Record<string, unknown>): Data {
  const next = structuredClone(data);
  const now = new Date().toISOString();
  const id = () => crypto.randomUUID();
  const event = (delivery_id: string, kind: Data['events'][number]['kind'], note: string) => next.events.push({ id: id(), delivery_id, actor_id: actorId, kind, note, created_at: now });
  const actor=next.profiles.find(p=>p.id===actorId);
  if(!actor?.active)throw new Error('Cuenta inactiva.');
  if(['delete_delivery','reorganize_receipts'].includes(action)&&!actor.is_superadmin)throw new Error('Se requiere superadministración.');
  if(['delete_product','delete_destination'].includes(action)&&!actor.is_admin)throw new Error('Se requiere administración.');
  if(action==='save_product'&&/bark.*bites/i.test(String(payload.name)))payload={...payload,unit:'unidad',category:'cookies'};
  if(action==='delete_delivery'){
    const receipt=next.receipts.find(r=>r.delivery_id===payload.delivery_id);if(receipt?.legacy_id)throw new Error('Los originales históricos se conservan.');
    next.deliveries=next.deliveries.filter(d=>d.id!==payload.delivery_id);next.receipts=next.receipts.filter(r=>r.delivery_id!==payload.delivery_id);next.events=next.events.filter(e=>e.delivery_id!==payload.delivery_id);
  }else if(action==='delete_product'||action==='delete_destination'){
    const used=next.deliveries.some(d=>action==='delete_product'?d.items.some(i=>i.product_id===payload.id):d.destination_id===payload.id);
    if(action==='delete_product'){if(used){const p=next.products.find(p=>p.id===payload.id)!;p.active=false;p.retired=true;}else next.products=next.products.filter(p=>p.id!==payload.id);}
    else if(used){const d=next.destinations.find(d=>d.id===payload.id)!;d.active=false;d.retired=true;}else{next.destinations=next.destinations.filter(d=>d.id!==payload.id);next.contacts=next.contacts.filter(c=>c.destination_id!==payload.id);}
  }else if(action==='reorganize_receipts'){
    const d=next.destinations.find(d=>d.id===payload.destination_id)!;const receipts=next.receipts.filter(r=>!r.legacy_id&&next.deliveries.some(x=>x.id===r.delivery_id&&x.destination_id===d.id)).sort((a,b)=>a.snapshot.confirmed_at.localeCompare(b.snapshot.confirmed_at)||a.id.localeCompare(b.id));
    receipts.forEach((r,i)=>{r.receipt_number=d.receipt_code+'-'+String(Number(payload.start_number)+i).padStart(3,'0');});d.receipt_next_number=Number(payload.start_number)+receipts.length;
  }else if (action === 'save_destination' || action === 'save_product') {
    const collection = action === 'save_destination' ? next.destinations : next.products;
    const index = collection.findIndex(entry => entry.id === payload.id);
    const value = { ...(index>=0?collection[index]:{}), ...payload, id: payload.id || id(), active: payload.active ?? true, ...(action==='save_destination'?{receipt_next_number:payload.receipt_next_number ?? (index>=0?next.destinations[index]?.receipt_next_number:1)}:{}) } as never;
    if (index >= 0) collection[index] = value; else collection.push(value);
  } else if (action === 'save_contact') {
    const index = next.contacts.findIndex(contact => contact.id === payload.id);
    const contact = { id: String(payload.id || id()), destination_id: String(payload.destination_id), name: String(payload.name) };
    if (index >= 0) next.contacts[index] = contact; else next.contacts.push(contact);
  } else if (action === 'save_delivery') {
    const index = next.deliveries.findIndex(entry => entry.id === payload.id);
    if (index >= 0 && next.deliveries[index].status === 'delivered') throw new Error('Una entrega confirmada no se puede modificar.');
    const submitted=payload.items as Data['deliveries'][number]['items'];if(submitted.some(i=>i.unit==='unidad'&&!Number.isInteger(i.quantity)))throw new Error('Los frascos se entregan en unidades enteras.');
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
    const snapshot: ReceiptSnapshot = { destination: { name: destination.name, address: destination.address, city: destination.city }, items: structuredClone(delivery.items), courier: deliveryCouriers(delivery,next.profiles), recipient: recipient.name, observation: String(payload.observation || ''), scheduled_date: delivery.scheduled_date, confirmed_at: now, signature_path: '' };
    const serial = destination.receipt_next_number || 1;
    const receiptNumber = (destination.receipt_code || 'DEMO') + '-' + String(serial).padStart(3,'0');
    destination.receipt_next_number = serial + 1;
    const receipt: Receipt = { id: id(), delivery_id: delivery.id, folio: `MIN-${today().replaceAll('-', '')}-${String(next.receipts.length + 1).padStart(5, '0')}`, snapshot, created_at: now, pdf_path: null, receipt_number: receiptNumber, template_version: 4, drive_status: 'pending', signature_data: String(payload.signature) };
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
  } else if (action === 'remove_member') {
    const actor=next.profiles.find(p=>p.id===actorId);
    if(!actor?.active || !actor.is_admin)throw new Error('Se requiere administración.');
    if(payload.id===actorId)throw new Error('No puedes eliminar tu propia cuenta de administración.');
    const member=next.profiles.find(p=>p.id===payload.id);
    if(!member)throw new Error('No se encontró el miembro.');
    member.active=false;
  } else if (action === 'update_profile') {
    const profile = next.profiles.find(p => p.id === payload.id)!;
    if(profile.is_superadmin&&(!actor.is_superadmin||!payload.active||!payload.is_admin))throw new Error('Cuenta protegida.');
    if(payload.is_superadmin!==undefined&&!actor.is_superadmin)throw new Error('Se requiere superadministración.');
    Object.assign(profile,payload);
  } else throw new Error('Acción no disponible.');
  return next;
}
