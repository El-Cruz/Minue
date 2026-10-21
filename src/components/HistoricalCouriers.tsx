import {useState,type FormEvent} from 'react';
import {useApp} from '../lib/context';
import type {Delivery} from '../lib/types';
export default function HistoricalCouriers({delivery}:{delivery:Delivery}){
  const {data,run,busy,online,notify}=useApp();
  const [first,setFirst]=useState(delivery.assigned_to||delivery.legacy_profile_ids?.[0]||'');
  const [second,setSecond]=useState(delivery.partner_id||delivery.legacy_profile_ids?.[1]||'');
  const [error,setError]=useState('');
  async function save(event:FormEvent){
    event.preventDefault();if(busy)return;setError('');
    const ids=[first,second].filter(Boolean);
    if(new Set(ids).size!==ids.length){setError('Selecciona repartidores diferentes.');return;}
    try{await run('link_legacy_couriers',{delivery_id:delivery.id,profile_ids:ids});notify('Repartidores relacionados. El comprobante original se conserva.');}
    catch(e){setError((e as Error).message);}
  }
  return <details className="detail-section"><summary>Relacionar repartidores del historial</summary><form onSubmit={save}>
    <p className="field-note">Relaciona hasta dos usuarios para que vean esta entrega en su historial personal. El texto y el comprobante originales se conservan.</p>
    <label>Primer repartidor del historial<select value={first} onChange={e=>{setFirst(e.target.value);if(!e.target.value || second===e.target.value)setSecond('');}} disabled={busy}><option value="">Sin relacionar</option>{data.profiles.filter(p=>p.active&&p.is_courier).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>Segundo repartidor del historial<select value={second} onChange={e=>setSecond(e.target.value)} disabled={busy||!first}><option value="">Sin segundo repartidor</option>{data.profiles.filter(p=>p.active&&p.is_courier&&p.id!==first).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {error&&<p className="form-error" role="alert">{error}</p>}<button className="button subtle full" disabled={busy||!online}>Guardar repartidores del historial</button>
  </form></details>;
}
