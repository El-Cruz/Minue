import { useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Clock3, Download, FileCheck2, LoaderCircle, MapPin, Package, Phone, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { useApp } from '../lib/context';
import { formatDate, formatTime, today } from '../lib/dates';
import Modal from './Modal';
import GoogleMapsLink from './GoogleMapsLink';
import Signature from './Signature';
import HistoricalCouriers from './HistoricalCouriers';
import ReceiptPreview from './ReceiptPreview';
import ReceiptLoading from './ReceiptLoading';
import {legacyReceiptUrl,belongsToProfile,deliveryCouriers} from '../lib/legacy';

export type FlowState = { type: 'detail' | 'confirm' | 'incident' | 'reschedule' | 'success' | 'preview'; id: string };
export const statusText = { pending: 'Pendiente', delivered: 'Entregada', failed: 'Intento fallido' };
export function StatusBadge({ status }: { status: keyof typeof statusText }) { return <span className={`status-badge ${status}`}><i />{statusText[status]}</span>; }

export default function DeliveryFlow({ flow, setFlow, onClose }: { flow: FlowState; setFlow: (state: FlowState) => void; onClose: () => void }) {
  const { data, user, run, busy, online, download, notify } = useApp();
  const [recipient, setRecipient] = useState(''), [newName, setNewName] = useState('');
  const [signature, setSignature] = useState(''), [observation, setObservation] = useState('');
  const [error, setError] = useState(''), [downloading, setDownloading] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  const delivery = data.deliveries.find(d => d.id === flow.id)!;
  if (!delivery) return null;
  const destination = data.destinations.find(d => d.id === delivery.destination_id)!;
  const contacts = data.contacts.filter(c => c.destination_id === destination.id);
  const receipt = data.receipts.find(r => r.delivery_id === delivery.id);
  const legacyUrl = legacyReceiptUrl(receipt);
  const events = data.events.filter(e => e.delivery_id === delivery.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const canConfirm = user.is_courier && delivery.status === 'pending' && (delivery.assigned_to===user.id || delivery.partner_id===user.id) && delivery.scheduled_date <= today();
  async function confirm(e: FormEvent) {
    e.preventDefault(); if (submitting.current) return;
    if (!signature) { setError('Falta la firma de quien recibe.'); return; }
    if (!recipient || (recipient === 'new' && !newName.trim())) { setError('Selecciona a quien recibe o escribe su nombre.'); return; }
    submitting.current = true; setError('');
    try {
      await run('confirm_delivery', { delivery_id: delivery.id, recipient_id: recipient === 'new' ? null : recipient, new_recipient: recipient === 'new' ? newName.trim() : '', signature, observation: observation.trim(), request_id: requestId.current });
      setFlow({ type: 'preview', id: delivery.id });
    } catch (e) { setError((e as Error).message); } finally { submitting.current = false; }
  }
  async function incident(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (submitting.current) return; submitting.current = true; setError('');
    const values = new FormData(e.currentTarget);
    try {
      await run(flow.type === 'reschedule' ? 'reschedule_delivery' : 'fail_delivery', { delivery_id: delivery.id, note: String(values.get('note')).trim(), ...(flow.type === 'reschedule' ? { scheduled_date: String(values.get('date')) } : {}) });
      notify(flow.type === 'reschedule' ? 'Entrega reprogramada.' : 'Intento fallido registrado.'); onClose();
    } catch (e) { setError((e as Error).message); } finally { submitting.current = false; }
  }
  async function getPDF() { setDownloading(true); try { await download(delivery.id); } catch (e) { setError((e as Error).message); } finally { setDownloading(false); } }
  const title = flow.type === 'confirm' ? 'Confirmar recepción' : flow.type === 'success' ? '¡Una entrega más, mucho bienestar!' : flow.type === 'incident' ? 'Registrar un intento fallido' : flow.type === 'reschedule' ? 'Reprogramar entrega' : 'Resumen de la entrega';
  if (flow.type === 'preview' && receipt) return <ReceiptPreview receipt={receipt} onClose={onClose} />;
  return <Modal title={title} subtitle={flow.type === 'success' ? 'La entrega quedó guardada correctamente.' : destination.name} onClose={onClose} locked={busy}>
    {flow.type === 'detail' && <><div className="detail-destination"><div className="destination-icon"><MapPin size={23} /></div><div><h3>{destination.name}</h3><p>{destination.address || 'Dirección no registrada'} · {destination.city}</p></div><StatusBadge status={delivery.status} /></div><GoogleMapsLink destination={destination} /><div className="detail-meta"><span><Clock3 size={16} />{formatDate(delivery.scheduled_date)} · {delivery.time_window || 'Sin franja horaria'}</span><span><UserRound size={16} />{deliveryCouriers(delivery,data.profiles)}</span>{destination.phone && <a href={`tel:${destination.phone.replace(/[^+\d]/g, '')}`}><Phone size={16} />{destination.phone}</a>}</div><div className="detail-section"><h4><Package size={16} /> Alimentos para entregar</h4>{delivery.items.map((item, i) => <div className="item-row" key={i}><span>{item.name}<small>{item.unit}</small></span><strong>{item.quantity} kg</strong></div>)}</div>{(delivery.notes || destination.notes) && <div className="note-box"><AlertCircle size={17} /><div><strong>Ten en cuenta</strong><p>{[delivery.notes, destination.notes].filter(Boolean).join(' ')}</p></div></div>}{receipt && <div className="receipt-info"><FileCheck2 size={20} /><div><strong>{receipt.receipt_number || receipt.folio}</strong><p>Recibió {receipt.snapshot.recipient} · {formatTime(receipt.snapshot.confirmed_at)}</p></div></div>}{receipt?.legacy_id && <div className="note-box"><div><strong>Registro histórico · {delivery.legacy_code}</strong><p>{receipt.snapshot.observation}</p><p>{receipt.legacy_signature_reference?'Referencia de firma conservada; pendiente de verificar el archivo original.':'No hay firma registrada en la fuente.'}</p></div></div>}{user.is_admin && delivery.legacy_id && <HistoricalCouriers key={delivery.id} delivery={delivery} />}{events.length > 0 && <details className="events"><summary>Historial de la entrega <ChevronDown size={15} /></summary>{events.map(event => <div key={event.id}><small>{formatDate(event.created_at)} · {formatTime(event.created_at)}</small><p>{event.note || event.kind}</p></div>)}</details>}
    {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions">{canConfirm && <><button className="button primary full" disabled={!online || busy} onClick={() => setFlow({ type: 'confirm', id: delivery.id })}>Confirmar entrega <ArrowRight size={17} /></button><button className="text-button danger center" disabled={!online || busy} onClick={() => setFlow({ type: 'incident', id: delivery.id })}>No pude realizar la entrega</button></>}{delivery.status === 'pending' && delivery.scheduled_date > today() && <p className="field-note">Podrás confirmar esta entrega el día programado.</p>}{delivery.status === 'failed' && <p className="field-note">La entrega requiere reprogramación por administración.</p>}{receipt && <button className="button subtle full" onClick={() => setFlow({ type: 'preview', id: delivery.id })}><FileCheck2 size={18} /> Ver comprobante</button>}{legacyUrl && <a className="button primary full" href={legacyUrl} target="_blank" rel="noopener noreferrer">Abrir comprobante original en Google Drive</a>}{receipt && !legacyUrl && <button className="button primary full" disabled={downloading || !online} onClick={getPDF}>{downloading ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />} Descargar comprobante PDF</button>}{user.is_admin && delivery.status !== 'delivered' && <button className="button subtle full" disabled={busy || !online} onClick={() => setFlow({ type: 'reschedule', id: delivery.id })}>Reprogramar entrega</button>}</div></>}
    {flow.type === 'confirm' && <div className="confirmation-stage" aria-busy={busy}>{busy && <div className="confirmation-loading"><ReceiptLoading label="Confirmando entrega…" /></div>}<form onSubmit={confirm} style={busy?{visibility:'hidden'}:undefined}><div className="step-indicator"><span><Check size={13} /> Resumen</span><i /><span className="current">2 Recepción</span></div><label>¿Quién recibe? <span className="required">*</span><select value={recipient} onChange={e => setRecipient(e.target.value)} required disabled={busy}><option value="">Selecciona una persona</option>{contacts.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}<option value="new">+ Agregar otra persona</option></select></label>{recipient === 'new' && <label>Nombre y apellido<input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre de quien recibe" minLength={2} maxLength={100} required disabled={busy} /></label>}<Signature onChange={setSignature} disabled={busy} /><details className="observation"><summary><Plus size={17} /> Agregar una observación <span>Opcional</span><ChevronDown size={16} /></summary><label className="sr-only" htmlFor="observation">Observación de la entrega</label><textarea id="observation" value={observation} onChange={e => setObservation(e.target.value)} placeholder="¿Algo que debamos saber sobre esta entrega?" rows={3} maxLength={2000} disabled={busy} /></details><p className="signature-notice"><ShieldCheck size={16} /> Al confirmar, se guardará la firma como constancia de recepción de los alimentos detallados.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button primary full" disabled={busy || !online}>{busy ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />} Confirmar y generar comprobante</button><button type="button" className="text-button center" disabled={busy} onClick={() => setFlow({ type: 'detail', id: delivery.id })}><ArrowLeft size={15} /> Volver al resumen</button></div></form></div>}
    {(flow.type === 'incident' || flow.type === 'reschedule') && <form onSubmit={incident}><p className="muted">{flow.type === 'incident' ? 'El motivo quedará en el historial para que administración pueda coordinar un nuevo intento.' : 'Conservaremos los intentos anteriores y asignaremos una nueva fecha a esta entrega.'}</p>{flow.type === 'reschedule' && <label>Nueva fecha<input type="date" name="date" min={today()} defaultValue={today()} required /></label>}<label>{flow.type === 'reschedule' ? 'Motivo de reprogramación' : '¿Qué ocurrió?'}<textarea name="note" minLength={3} maxLength={2000} rows={4} required placeholder="Describe el motivo…" /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button primary full" disabled={busy || !online}>{busy && <LoaderCircle className="spin" size={17} />} {flow.type === 'reschedule' ? 'Guardar nueva fecha' : 'Registrar intento fallido'}</button></div></form>}
    {flow.type === 'success' && <div className="confirmation-success"><div className="success-seal"><CheckCircle2 size={43} strokeWidth={1.5} /></div><h3>Alimento entregado.<br />Confianza compartida.</h3><p>{destination.name} ya recibió su entrega.{receipt && <> El comprobante <strong>{receipt.receipt_number || receipt.folio}</strong> está listo para descargar.</>}</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={downloading || !online} onClick={getPDF}>{downloading ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />} Descargar comprobante PDF</button><button className="button subtle full" onClick={onClose}>Volver a mis entregas</button><small>También lo encontrarás en el historial.</small></div>}
  </Modal>;
}
