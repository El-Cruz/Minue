import { useEffect, useState } from 'react';
import { Cloud, LoaderCircle } from 'lucide-react';
import { apiPost, driveStatus } from '../lib/api';
import { useApp } from '../lib/context';
export default function DriveSettings() {
  const {demo}=useApp();
  const [state,setState]=useState<Awaited<ReturnType<typeof driveStatus>>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;if(!demo)driveStatus().then(s=>{if(active)setState(s);}).catch(()=>{if(active)setError('Falta activar la integración con Drive.');});return()=>{active=false;};},[demo]);
  const query=new URLSearchParams(location.search).get('drive');
  async function connect(){setBusy(true);setError('');try{const result=await apiPost('/api/drive-connect');location.assign(result.url);}catch(e){setError((e as Error).message);setBusy(false);}}
  return <section className="panel settings-panel"><div className="section-icon"><Cloud size={22}/></div><h2>Comprobantes en Google Drive</h2>
    <p>Archivo mensual en puntodeentregasminue@gmail.com.</p>
    {state?.connected && <p className="form-success">Google Drive conectado.</p>}
    {query==='wrong_account' && <p role="alert" className="form-error">Selecciona la cuenta puntodeentregasminue@gmail.com para guardar los comprobantes.</p>}
    {query==='error' && <p role="alert" className="form-error">No se pudo completar la conexión. Vuelve a intentarlo.</p>}
    {state && !state.configured && <p className="field-note">Falta configurar la conexión de Google. Los comprobantes siguen disponibles en Minue.</p>}
    {demo && <p className="field-note">La demostración no conecta cuentas ni guarda archivos en Drive.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="button primary full" disabled={demo || busy || !state?.configured} onClick={connect}>{busy?<LoaderCircle size={17} className="spin"/>:<Cloud size={17}/>} {state?.connected?'Volver a conectar Google Drive':'Conectar Google Drive'}</button>
  </section>;
}
