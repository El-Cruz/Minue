import { useEffect, useState } from 'react';
import { Cloud, LoaderCircle, RefreshCw } from 'lucide-react';
import { apiPost, driveStatus, receiptState } from '../lib/api';
import { useApp } from '../lib/context';
import { formatDate } from '../lib/dates';
import type { Receipt } from '../lib/types';
export default function DriveSettings() {
  const {demo,data,user}=useApp();
  const [state,setState]=useState<Awaited<ReturnType<typeof driveStatus>>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(0);
  const [statuses,setStatuses]=useState<Record<string,Receipt['drive_status']>>({});
  useEffect(()=>{let active=true;if(!demo&&user.is_admin)driveStatus().then(s=>{if(active)setState(s);}).catch(()=>{if(active)setError('No se pudo consultar la conexión con Drive.');});return()=>{active=false;};},[demo,user.is_admin]);
  const receipts=data.receipts.filter(r=>!r.legacy_id);
  const status=(r:Receipt)=>statuses[r.id]||r.drive_status||'pending';
  const pending=receipts.filter(r=>status(r)!=='saved').sort((a,b)=>a.created_at.localeCompare(b.created_at));
  const lastPage=Math.max(0,Math.ceil(pending.length/10)-1),currentPage=Math.min(page,lastPage),visible=pending.slice(currentPage*10,currentPage*10+10);
  const query=new URLSearchParams(location.search).get('drive');
  async function connect(){setBusy(true);setError('');try{const result=await apiPost('/api/drive-connect');location.assign(result.url);}catch(e){setError((e as Error).message);setBusy(false);}}
  async function refresh(){
    setBusy(true);setError('');
    try {
      const [connection,updates]=await Promise.all([driveStatus(),Promise.all(visible.map(async r=>({id:r.id,state:await receiptState(r.delivery_id)})))]);
      setState(connection);setStatuses(previous=>({...previous,...Object.fromEntries(updates.map(r=>[r.id,r.state.drive_status]))}));
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function retry(receipt:Receipt){
    setBusy(true);setError('');
    try{await apiPost('/api/receipt-retry?delivery_id='+encodeURIComponent(receipt.delivery_id));const update=await receiptState(receipt.delivery_id);setStatuses(previous=>({...previous,[receipt.id]:update.drive_status}));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  if(!user.is_admin)return null;
  return <section className="panel settings-panel"><div className="section-icon"><Cloud size={22}/></div><h2>Comprobantes en Google Drive</h2>
    <p>Archivo mensual en puntodeentregasminue@gmail.com.</p>
    <p className="field-note">Administración gestiona esta conexión. Las entregas y los PDF siguen disponibles en Minue aunque Drive esté desconectado.</p>
    {state?.connected && <p className="form-success">Google Drive conectado.</p>}
    {state && !state.connected && <p className="field-note">{state.state==='reconnect'?'Requiere reconexión de Drive.':'Google Drive está desconectado.'}</p>}
    {query==='wrong_account' && <p role="alert" className="form-error">Selecciona la cuenta puntodeentregasminue@gmail.com para guardar los comprobantes.</p>}
    {query==='error' && <p role="alert" className="form-error">No se pudo completar la conexión. Vuelve a intentarlo.</p>}
    {state && !state.configured && <p className="field-note">Falta configurar la conexión de Google. Los comprobantes siguen disponibles en Minue.</p>}
    {demo && <p className="field-note">La demostración no conecta cuentas ni guarda archivos en Drive.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="button primary full" disabled={demo || busy || !state?.configured} onClick={connect}>{busy?<LoaderCircle size={17} className="spin"/>:<Cloud size={17}/>} {state?.connected?'Volver a conectar Google Drive':'Conectar Google Drive'}</button>
    {!demo && <div className="drive-archive"><p>{receipts.length-pending.length} guardados en Drive · {pending.length} pendientes</p><button className="button subtle" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15}/> Actualizar estado</button>
      {visible.map(r=><div className="drive-archive-row" key={r.id}><div><strong>{r.receipt_number||r.folio}</strong><small>{formatDate(r.created_at)} · {status(r)==='reconnect'?'Requiere reconexión':'Pendiente de Drive'}</small></div><button className="button subtle" disabled={busy||!state?.connected} onClick={()=>void retry(r)}>Reintentar</button></div>)}
      {lastPage>0&&<div className="receipt-toolbar"><button className="text-button" disabled={busy||currentPage===0} onClick={()=>setPage(currentPage-1)}>Anterior</button><span>{currentPage+1} / {lastPage+1}</span><button className="text-button" disabled={busy||currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>Siguiente</button></div>}
    </div>}
  </section>;
}
