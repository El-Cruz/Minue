import { RECEIPT_SCENE, type SceneNode } from '../lib/receipt-scene';
function Shape({node}:{node:SceneNode}) {
  const props={fill:node.fill || 'none',stroke:node.stroke,strokeWidth:node.strokeWidth,opacity:node.opacity};
  if(node.kind==='path')return <path d={node.d} {...props}/>;
  if(node.kind==='ellipse')return <ellipse cx={node.cx} cy={node.cy} rx={node.rx} ry={node.ry} {...props}/>;
  return <text x={node.x} y={node.y} fontSize={node.size} fontWeight={node.weight} textAnchor={node.anchor || 'start'} {...props}>{node.text}</text>;
}
export default function ReceiptLoading({label='Preparando comprobante…'}:{label?:string}) {
  return <div className="clipboard-loading" role="status" aria-live="polite">
    <div className="clipboard-illustration"><svg viewBox="0 0 419 595" aria-hidden="true" className="clipboard-art">
      {(['board','paper','print','clip'] as const).map(layer=><g key={layer} className={'clipboard-'+layer}>{RECEIPT_SCENE.filter(n=>n.layer===layer).map((node,i)=><Shape node={node} key={i}/>)}</g>)}
      <g className="clipboard-writing" fill="#536443">{[0,1,2,3].map(i=><rect key={i} x={83} y={282+i*25.3} width={110-i%2*32} height={3} rx={1.5} style={{animationDelay:`${i*.18}s`}}/>)}</g>
    </svg></div>
    <p>{label}</p><span className="clipboard-dots" aria-hidden="true"><i/><i/><i/></span>
  </div>;
}
