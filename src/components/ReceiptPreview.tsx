import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Expand, Minimize, Minus, Plus } from 'lucide-react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useApp } from '../lib/context';
import { receiptFilename } from '../lib/receipt-format';
import { legacyReceiptUrl } from '../lib/legacy';
import { receiptState, saveBlob } from '../lib/api';
import type { Receipt, ReceiptState } from '../lib/types';
import Modal from './Modal';
import ReceiptLoading from './ReceiptLoading';

export default function ReceiptPreview({receipt,onClose}:{receipt:Receipt;onClose:()=>void}) {
  const {getPDF,demo}=useApp();
  const loadedBlob=useRef<Blob|null>(null);
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[state,setState]=useState<ReceiptState|null>(null),[error,setError]=useState('');
  const [page,setPage]=useState(1),[zoom,setZoom]=useState(1),[photo,setPhoto]=useState(false),[controls,setControls]=useState(false),[original,setOriginal]=useState(false),[retry,setRetry]=useState(0),[width,setWidth]=useState(500);
  const [renderedKey,setRenderedKey]=useState(''),[frameHeight,setFrameHeight]=useState(0);
  const renderKey=[receipt.id,original,retry,page].join(':');
  const ready=Boolean(pdf)&&renderedKey===renderKey;
  const canvas=useRef<HTMLCanvasElement>(null),frame=useRef<HTMLDivElement>(null),viewer=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    let live=true,loadingTask:PDFDocumentLoadingTask|undefined;
    setError('');setPdf(null);setRenderedKey('');setPage(1);loadedBlob.current=null;
    (async()=>{const [blob,pdfjs]=await Promise.all([getPDF(receipt.delivery_id,original),import('pdfjs-dist')]);pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
      loadingTask=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer())});
      const document=await loadingTask.promise;
      if(live){loadedBlob.current=blob;setPdf(document);}else await loadingTask.destroy();
    })().catch(()=>{if(live)setError(receipt.legacy_id?'El comprobante histórico se conserva en Drive. Abre el original con una cuenta que tenga acceso.':'La entrega está confirmada. No pudimos abrir el PDF; vuelve a intentarlo.');});
    return()=>{live=false;if(loadingTask)void loadingTask.destroy().catch(()=>{});};
  },[receipt.id,original,retry]);
  useEffect(()=>{
    if(demo)return;let live=true;
    const refresh=()=>receiptState(receipt.delivery_id).then(s=>{if(live)setState(s);}).catch(()=>{});
    void refresh();return()=>{live=false;};
  },[receipt.id,demo]);
  useEffect(()=>{if(!frame.current)return;const observer=new ResizeObserver(entries=>{setWidth(entries[0].contentRect.width);if(photo)setFrameHeight(entries[0].contentRect.height);});observer.observe(frame.current);return()=>observer.disconnect();},[pdf,photo]);
  useEffect(()=>{
    if(!pdf || !canvas.current)return;
    let cancelled=false,task:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;
    (async()=>{const p=await pdf.getPage(page);if(cancelled)return;
      const base=p.getViewport({scale:1}),available=photo?Math.min(width,Math.max(1,frameHeight-16)*base.width/base.height):width;
      const cssScale=Math.max(.1,(available-8)/base.width*zoom),ratio=Math.min(devicePixelRatio||1,3),viewport=p.getViewport({scale:cssScale*ratio});
      const c=canvas.current!;c.width=Math.round(viewport.width);c.height=Math.round(viewport.height);c.style.width=viewport.width/ratio+'px';c.style.height=viewport.height/ratio+'px';
      task=p.render({canvas:c,viewport});await task.promise;if(!cancelled)setRenderedKey(renderKey);
    })().catch(e=>{if(!cancelled && e?.name!=='RenderingCancelledException')setError('No pudimos mostrar esta página. Reintenta abrir el comprobante.');});
    return()=>{cancelled=true;task?.cancel();};
  },[pdf,page,width,frameHeight,zoom,photo,controls,renderKey]);
  useEffect(()=>{const changed=()=>{if(!document.fullscreenElement)setPhoto(false);};document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed);},[]);
  async function leavePhoto(){setPhoto(false);setControls(false);if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});}
  async function fullPhoto(){setZoom(1);setControls(false);setPhoto(true);await viewer.current?.requestFullscreen?.().catch(()=>{});}

  const visible=!photo||controls||Boolean(error),number=state?.receipt.receipt_number||receipt.receipt_number||receipt.folio;
  const legacyUrl=legacyReceiptUrl(state?.receipt||receipt);
  return <Modal title="Comprobante de entrega" subtitle={number} wide onClose={()=>{if(photo)void leavePhoto();else onClose();}} className={photo?'receipt-photo-dialog '+(controls||error?'show-controls':''):'receipt-preview-dialog'}>
    <div ref={viewer} className={'receipt-viewer '+(photo?'photo':'')}>
      {visible && <div className="receipt-toolbar">
        <button className="icon-button" aria-label="Página anterior" disabled={!pdf || page===1} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button>
        <span aria-live="polite">{page} / {pdf?.numPages||'…'}</span>
        <button className="icon-button" aria-label="Página siguiente" disabled={!pdf || page===(pdf?.numPages||1)} onClick={()=>setPage(page+1)}><ChevronRight size={18}/></button>
        <button className="icon-button" aria-label="Reducir zoom" disabled={zoom<=.5} onClick={()=>setZoom(Math.max(.5,zoom-.25))}><Minus size={17}/></button>
        <button className="icon-button" aria-label="Ampliar zoom" disabled={zoom>=3} onClick={()=>setZoom(Math.min(3,zoom+.25))}><Plus size={17}/></button>
        <button className="button subtle" disabled={!photo&&!ready} onClick={()=>photo?void leavePhoto():void fullPhoto()}>{photo?<Minimize size={16}/>:<Expand size={16}/>} {photo?'Salir de pantalla completa':'Pantalla completa para foto'}</button>
      </div>}
      <div ref={frame} className={'receipt-frame '+(!ready&&!error?'is-preparing':'')} aria-busy={!ready&&!error}>
        {!ready&&!error && <ReceiptLoading/>}
        <div className={(photo?'receipt-photo-page ':'')+(ready?'receipt-page-ready':'receipt-page-preparing')} role={photo?'button':undefined} tabIndex={photo&&ready?0:undefined} aria-label={photo?'Mostrar u ocultar controles del comprobante':undefined} onClick={()=>{if(photo)setControls(!controls);}} onKeyDown={e=>{if(photo && (e.key==='Enter'||e.key===' ')){e.preventDefault();setControls(!controls);}}}>
          <canvas ref={canvas} aria-label={'Vista previa del comprobante '+number+', página '+page} style={{display:pdf?'block':'none'}}/>
        </div>
      </div>
      {visible && <div className="receipt-footer">
        {error && <p className="form-error" role="alert">{error}<button className="text-button" onClick={()=>setRetry(retry+1)}>Volver a intentar</button></p>}
        <p className="receipt-confirmed-status">{receipt.legacy_id?'Comprobante histórico · se conserva el original':demo?'Demostración · entrega de ejemplo confirmada.':ready?'Entrega confirmada. Comprobante disponible en Minue.':'Entrega confirmada.'}</p>
        <div className="receipt-actions"><button className="button primary" disabled={!ready} onClick={()=>{if(loadedBlob.current)saveBlob(loadedBlob.current,receiptFilename(state?.receipt||receipt,original));}}><Download size={16}/>Descargar comprobante PDF</button>
        {legacyUrl && <a className="button subtle" href={legacyUrl} target="_blank" rel="noopener noreferrer">Abrir PDF original en Google Drive</a>}
        {!receipt.legacy_id && state?.originalAvailable && <button className="text-button" onClick={()=>setOriginal(!original)}>{original?'Ver formato nuevo':'Ver PDF original'}</button>}
        <button className="text-button" onClick={onClose}>Volver a mis entregas</button></div>
      </div>}
    </div>
  </Modal>;
}
