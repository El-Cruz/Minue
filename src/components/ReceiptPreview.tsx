import {useEffect,useState,useRef} from 'react';
import {ArrowLeft,Download,RefreshCw} from 'lucide-react';
import {useApp} from '../lib/context';
import {receiptState} from '../lib/api';
import {legacyReceiptUrl} from '../lib/legacy';
import type {Receipt} from '../lib/types';
import ReceiptDocument from './ReceiptDocument';
export default function ReceiptPreview({receipt,onClose}:{receipt:Receipt;onClose:()=>void}) {
 const {demo,download}=useApp();const [current,setCurrent]=useState(receipt),[signature,setSignature]=useState(receipt.signature_data),[loading,setLoading]=useState(!demo),[error,setError]=useState(''),[pdfError,setPdfError]=useState(''),[downloading,setDownloading]=useState(false),[retry,setRetry]=useState(0);
 const back=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;back.current?.focus();const siblings=Array.from(document.querySelector('.app-layout')?.children||[]).filter(el=>!el.contains(back.current)) as HTMLElement[];const inert=siblings.map(el=>el.inert);siblings.forEach(el=>el.inert=true);const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=overflow;siblings.forEach((el,i)=>el.inert=inert[i]);previous?.focus();};},[]);
 useEffect(()=>{if(demo)return;let live=true;setLoading(true);setError('');receiptState(receipt.delivery_id).then(s=>{if(live){setCurrent(s.receipt);setSignature(s.signature_data||s.receipt.signature_data);setLoading(false);}}).catch(()=>{if(live){setError('La entrega está confirmada. No pudimos cargar el comprobante.');setLoading(false);}});return()=>{live=false;};},[receipt.id,demo,retry]);
 async function getPDF(){setDownloading(true);setPdfError('');try{await download(receipt.delivery_id);}catch(e){setPdfError((e as Error).message);}finally{setDownloading(false);}}
 const legacy=legacyReceiptUrl(current);
 return <section className="receipt-screen" aria-label="Comprobante de entrega" onKeyDown={e=>{if(e.key==='Escape')onClose();}}>
  <nav className="receipt-screen-nav"><button ref={back} className="button subtle" onClick={onClose}><ArrowLeft size={18}/>Regresar</button><span>{current.receipt_number||current.folio}</span></nav>
  <div className="receipt-screen-body">
   {loading?<div className="receipt-skeleton" role="status" aria-label="Preparando comprobante"><div className="skeleton-brand"/><div/><div/><div/><div className="skeleton-table"/><div/><div className="skeleton-signature"/><p>Preparando comprobante…</p></div>:error?<div role="alert"><p>{error}</p><button className="button subtle" onClick={()=>setRetry(retry+1)}><RefreshCw size={16}/>Volver a intentar</button></div>:<ReceiptDocument receipt={current} signature={signature}/>}
   <footer className="receipt-screen-actions"><p>Entrega confirmada.</p>{pdfError&&<p role="alert" className="form-error">{pdfError}</p>}<button className="button primary" disabled={downloading||loading||Boolean(error)} onClick={getPDF}><Download size={18}/>{downloading?'Preparando PDF…':'Descargar comprobante PDF'}</button>{legacy&&<a className="button subtle" href={legacy} target="_blank" rel="noopener noreferrer">Abrir comprobante original</a>}<button className="text-button" onClick={onClose}>Regresar a mis entregas</button></footer>
  </div>
 </section>;
}
