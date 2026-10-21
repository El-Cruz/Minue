import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Expand, Minimize, Minus, Plus, RefreshCw, LoaderCircle } from 'lucide-react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useApp } from '../lib/context';
import { receiptFilename } from '../lib/receipt-format';
import { receiptState, apiPost, saveBlob } from '../lib/api';
import type { Receipt, ReceiptState } from '../lib/types';
import Modal from './Modal';

export default function ReceiptPreview({receipt,onClose}:{receipt:Receipt;onClose:()=>void}) {
  const {getPDF,demo}=useApp();
  const loadedBlob=useRef<Blob|null>(null);
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[state,setState]=useState<ReceiptState|null>(null),[error,setError]=useState('');
  const [page,setPage]=useState(1),[zoom,setZoom]=useState(1),[photo,setPhoto]=useState(false),[controls,setControls]=useState(false),[original,setOriginal]=useState(false),[retry,setRetry]=useState(0),[width,setWidth]=useState(500);
  const canvas=useRef<HTMLCanvasElement>(null),frame=useRef<HTMLDivElement>(null),viewer=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    let live=true,loadingTask:PDFDocumentLoadingTask|undefined;
    setError('');setPdf(null);setPage(1);loadedBlob.current=null;
    (async()=>{const [blob,pdfjs]=await Promise.all([getPDF(receipt.delivery_id,original),import('pdfjs-dist')]);pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
      loadingTask=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer())});
      const document=await loadingTask.promise;
      if(live){loadedBlob.current=blob;setPdf(document);}else await loadingTask.destroy();
    })().catch(()=>{if(live)setError('La entrega está confirmada. No pudimos abrir el PDF; vuelve a intentarlo.');});
    return()=>{live=false;if(loadingTask)void loadingTask.destroy().catch(()=>{});};
  },[receipt.id,original,retry]);
  useEffect(()=>{
    if(demo)return;let live=true;
    const refresh=()=>receiptState(receipt.delivery_id).then(s=>{if(live)setState(s);}).catch(()=>{});
    void refresh();const timer=setInterval(refresh,8000);return()=>{live=false;clearInterval(timer);};
  },[receipt.id,demo]);
  useEffect(()=>{if(!frame.current)return;const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width));observer.observe(frame.current);return()=>observer.disconnect();},[pdf,photo]);
  useEffect(()=>{
    if(!pdf || !canvas.current)return;
    let cancelled=false,task:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;
    (async()=>{const p=await pdf.getPage(page);if(cancelled)return;
      const base=p.getViewport({scale:1}),available=photo?Math.min(width,(window.innerHeight-(controls?110:12))*base.width/base.height):width;
      const cssScale=Math.max(.1,(available-8)/base.width*zoom),ratio=Math.min(devicePixelRatio||1,3),viewport=p.getViewport({scale:cssScale*ratio});
      const c=canvas.current!;c.width=Math.round(viewport.width);c.height=Math.round(viewport.height);c.style.width=viewport.width/ratio+'px';c.style.height=viewport.height/ratio+'px';
      task=p.render({canvas:c,viewport});await task.promise;
    })().catch(e=>{if(!cancelled && e?.name!=='RenderingCancelledException')setError('No pudimos mostrar esta página. Reintenta abrir el comprobante.');});
    return()=>{cancelled=true;task?.cancel();};
  },[pdf,page,width,zoom,photo,controls]);
  useEffect(()=>{const changed=()=>{if(!document.fullscreenElement)setPhoto(false);};document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed);},[]);
  async function leavePhoto(){setPhoto(false);setControls(false);if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});}
  async function fullPhoto(){setZoom(1);setControls(false);setPhoto(true);await viewer.current?.requestFullscreen?.().catch(()=>{});}
  async function retryDrive(){try{await apiPost('/api/receipt-retry?delivery_id='+encodeURIComponent(receipt.delivery_id));setState(await receiptState(receipt.delivery_id));}catch{setError('El comprobante sigue guardado en Minue. No pudimos iniciar el reintento de Drive.');}}
  const visible=!photo||controls,number=state?.receipt.receipt_number||receipt.receipt_number||receipt.folio;
  const status=state?.drive_status||receipt.drive_status||'pending';
  return <Modal title="Comprobante de entrega" subtitle={number} wide onClose={()=>{if(photo)void leavePhoto();else onClose();}} className={photo?'receipt-photo-dialog '+(controls?'show-controls':''):'receipt-preview-dialog'}>
    <div ref={viewer} className={'receipt-viewer '+(photo?'photo':'')}>
      {visible && <div className="receipt-toolbar">
        <button className="icon-button" aria-label="Página anterior" disabled={!pdf || page===1} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button>
        <span aria-live="polite">{page} / {pdf?.numPages||'…'}</span>
        <button className="icon-button" aria-label="Página siguiente" disabled={!pdf || page===(pdf?.numPages||1)} onClick={()=>setPage(page+1)}><ChevronRight size={18}/></button>
        <button className="icon-button" aria-label="Reducir zoom" disabled={zoom<=.5} onClick={()=>setZoom(Math.max(.5,zoom-.25))}><Minus size={17}/></button>
        <button className="icon-button" aria-label="Ampliar zoom" disabled={zoom>=3} onClick={()=>setZoom(Math.min(3,zoom+.25))}><Plus size={17}/></button>
        <button className="button subtle" disabled={!pdf} onClick={()=>photo?void leavePhoto():void fullPhoto()}>{photo?<Minimize size={16}/>:<Expand size={16}/>} {photo?'Salir de pantalla completa':'Pantalla completa para foto'}</button>
      </div>}
      <div ref={frame} className="receipt-frame">
        {!pdf&&!error && <p className="receipt-loading"><LoaderCircle className="spin" size={22}/>Preparando comprobante…</p>}
        <div className={photo?'receipt-photo-page':''} role={photo?'button':undefined} tabIndex={photo?0:undefined} aria-label={photo?'Mostrar u ocultar controles del comprobante':undefined} onClick={()=>{if(photo)setControls(!controls);}} onKeyDown={e=>{if(photo && (e.key==='Enter'||e.key===' ')){e.preventDefault();setControls(!controls);}}}>
          <canvas ref={canvas} aria-label={'Vista previa del comprobante '+number+', página '+page} style={{display:pdf?'block':'none'}}/>
        </div>
      </div>
      {visible && <div className="receipt-footer">
        {error && <p className="form-error" role="alert">{error}<button className="text-button" onClick={()=>setRetry(retry+1)}>Volver a intentar</button></p>}
        <p className={'receipt-drive-status '+status}>{demo?'Demostración: no se guarda en Drive.':status==='saved'?'Guardado en Drive':status==='reconnect'?'Requiere reconexión de Drive':'Pendiente de Drive'}</p>
        <div className="receipt-actions"><button className="button primary" disabled={!pdf} onClick={()=>{if(loadedBlob.current)saveBlob(loadedBlob.current,receiptFilename(state?.receipt||receipt,original));}}><Download size={16}/>Descargar comprobante PDF</button>
        {!demo && status!=='saved' && <button className="button subtle" onClick={()=>void retryDrive()}><RefreshCw size={16}/>Reintentar Drive</button>}
        {state?.originalAvailable && <button className="text-button" onClick={()=>setOriginal(!original)}>{original?'Ver formato nuevo':'Ver PDF original'}</button>}
        <button className="text-button" onClick={onClose}>Volver a mis entregas</button></div>
      </div>}
    </div>
  </Modal>;
}
