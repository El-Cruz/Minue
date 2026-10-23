import { RECEIPT_SHEET_SCENE } from '../lib/receipt-sheet-scene';
import type { SceneNode } from '../lib/receipt-scene';
function Shape({node}:{node:SceneNode}) {
  const props={fill:node.fill || 'none',stroke:node.stroke,strokeWidth:node.strokeWidth,opacity:node.opacity};
  if(node.kind==='path')return <path d={node.d} {...props}/>;
  if(node.kind==='ellipse')return <ellipse cx={node.cx} cy={node.cy} rx={node.rx} ry={node.ry} {...props}/>;
  return <text x={node.x} y={node.y} fontSize={node.size} fontWeight={node.weight} fontFamily={node.font==='logo'?'ReceiptLogo':node.font==='script'?'ReceiptScript':node.font==='title'?'ReceiptTitle':node.font==='label'?'ReceiptLabel':'ReceiptPoppins'} letterSpacing={node.spacing||undefined} transform={node.rotate?`rotate(${-node.rotate} ${node.x} ${node.y})`:undefined} textAnchor={node.anchor||'start'} {...props}>{node.text}</text>;
}
export default function ReceiptLoading({label='Preparando comprobante…'}:{label?:string}) {
  return <div className="sheet-loading" role="status" aria-live="polite">
    <div className="sheet-illustration"><svg viewBox="0 0 426.5 640" aria-hidden="true" className="sheet-art">
      <g className="sheet-paper">{RECEIPT_SHEET_SCENE.filter(n=>n.layer==='paper').map((node,i)=><Shape node={node} key={i}/>)}</g>
      <g className="sheet-print">{RECEIPT_SHEET_SCENE.filter(n=>n.layer==='print').map((node,i)=><Shape node={node} key={i}/>)}</g>
      <g className="sheet-writing" fill="#3f5033">{[0,1,2,3].map(i=><rect key={i} x={44} y={287+i*23.214} width={135-i%2*32} height={2.5} rx={1.25} style={{animationDelay:`${i*.18}s`}}/>)}</g>
    </svg></div>
    <p>{label}</p><span className="sheet-dots" aria-hidden="true"><i/><i/><i/></span>
  </div>;
}
