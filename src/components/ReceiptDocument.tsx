import React from 'react';
import type { Receipt } from '../lib/types';

export default function ReceiptDocument({receipt,signature}:{receipt:Receipt;signature?:string}) {
  const s=receipt.snapshot;
  const date=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Guayaquil',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(s.confirmed_at));
  return <article className="receipt-document" aria-label="Comprobante de entrega">
    <header><div className="receipt-wordmark">MINUË</div><small>NUTRICIÓN QUE CUIDA</small><h1>COMPROBANTE DE ENTREGA</h1></header>
    <dl><div><dt>ID de entrega</dt><dd>{receipt.receipt_number||receipt.folio}</dd></div><div><dt>Fecha de entrega</dt><dd>{date}</dd></div><div><dt>Punto de entrega</dt><dd>{s.destination.name}</dd></div></dl>
    <table><thead><tr><th>Producto</th><th>Cantidad</th></tr></thead><tbody>{s.items.map((item,i)=><tr key={i}><td>{item.name}</td><td>{`${new Intl.NumberFormat('es-EC',{maximumFractionDigits:3}).format(item.quantity)} ${item.unit}`}</td></tr>)}</tbody></table>
    <dl><div><dt>Recibido por</dt><dd>{s.recipient}</dd></div></dl>
    <section className="receipt-signature"><h2>Firma de recepción</h2>{signature?<img src={signature} alt="Firma de quien recibe"/>:<p>Firma no disponible en esta vista.</p>}</section>
  </article>;
}
