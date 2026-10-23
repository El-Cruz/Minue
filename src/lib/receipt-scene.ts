/** Shared top-left coordinates for the SVG loader and the vector PDF. */
export const RECEIPT_SIZE = { width: 419, height: 595 };
export const receiptColors = { green: '#536443', gold: '#ddb66d', paper: '#fffefa', line: '#a4aa94', cork: '#cfa373', ink: '#242a23' };
export type SceneLayer = 'board' | 'paper' | 'print' | 'clip' | 'seal';
type Style = { fill?: string; stroke?: string; strokeWidth?: number; opacity?: number; layer: SceneLayer };
export type SceneNode = Style & (
  { kind: 'path'; d: string } |
  { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number } |
  { kind: 'text'; x: number; y: number; text: string; size: number; anchor?: 'start' | 'middle'; weight?: 700; font?: 'body'|'logo'|'label'|'title'|'script'; spacing?: number; rotate?: number }
);
function rounded(x:number,y:number,w:number,h:number,r:number) {
  return `M ${x+r} ${y} H ${x+w-r} Q ${x+w} ${y} ${x+w} ${y+r} V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h} H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r} V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
}
export function receiptScene(): SceneNode[] {
  const n:SceneNode[]=[],c=receiptColors;
  const path=(d:string,fill:string|undefined,layer:SceneLayer,stroke?:string,strokeWidth=.5,opacity=1)=>n.push({kind:'path',d,fill,layer,stroke,strokeWidth,opacity});
  const box=(x:number,y:number,w:number,h:number,r:number,fill:string,layer:SceneLayer,stroke?:string)=>path(rounded(x,y,w,h,r),fill,layer,stroke);
  const ellipse=(cx:number,cy:number,rx:number,ry:number,fill:string,layer:SceneLayer)=>n.push({kind:'ellipse',cx,cy,rx,ry,fill,layer});
  const text=(value:string,x:number,y:number,size:number,layer:SceneLayer='print',anchor:'start'|'middle'='start',fill=c.green)=>n.push({kind:'text',text:value,x,y,size,layer,anchor,fill});
  const line=(x:number,y:number,x2:number,y2:number,color=c.line,width=.5,layer:SceneLayer='print')=>path(`M ${x} ${y} L ${x2} ${y2}`,undefined,layer,color,width);
  const heart=(x:number,y:number,s:number,layer:SceneLayer='print')=>path(`M ${x} ${y+s} C ${x-s*2} ${y-s*.3} ${x-s} ${y-s*1.6} ${x} ${y-s*.7} C ${x+s} ${y-s*1.6} ${x+s*2} ${y-s*.3} ${x} ${y+s} Z`,c.gold,layer);
  const paw=(x:number,y:number,s:number,layer:SceneLayer='print')=>{
    path(`M ${x-s*1.5} ${y+s} C ${x-s*1.8} ${y} ${x-s*.8} ${y-s*.2} ${x-s*.5} ${y-s} Q ${x} ${y-s*1.5} ${x+s*.5} ${y-s} C ${x+s*.8} ${y-s*.2} ${x+s*1.8} ${y} ${x+s*1.5} ${y+s} Q ${x+s} ${y+s*1.4} ${x} ${y+s*.8} Q ${x-s} ${y+s*1.4} ${x-s*1.5} ${y+s} Z`,c.green,layer);
    for(const [dx,dy,rx,ry] of [[-1.8,-1.3,.48,.7],[-.7,-2.2,.5,.75],[.7,-2.2,.5,.75],[1.8,-1.3,.48,.7]])ellipse(x+dx*s,y+dy*s,rx*s,ry*s,c.green,layer);
  };
  box(0,0,419,595,0,'#eee9df','board');
  box(23,9,377,582,19,'#d4c9b8','board');
  box(19,6,379,582,19,c.cork,'board','#ad7e50');
  box(22,9,373,576,17,'#d9b387','board');
  // Fixed grain, never a random texture or a bitmap.
  for(let i=0;i<160;i++){
    const x=25+(i*67%363),y=15+(i*109%564);
    ellipse(x,y,.45+(i%3)*.15,.65,'#c1986b','board');
  }
  box(40,25,345,559,1,'#bb956f','paper');
  box(37,22,345,560,0,c.paper,'paper');
  // The small metal highlights and dark rubber tips are vector shapes too.
  box(119,17,182,43,10,'#d1cbbb','clip');
  box(121,12,178,43,10,'#26332a','clip');
  box(124,13,172,38,8,'#baad8d','clip');
  box(127,16,166,31,7,c.paper,'clip');
  path('M 124 24 V 44 Q 124 52 134 52 H 181 Q 209 39 237 52 H 286 Q 296 52 296 44 V 24',undefined,'clip','#343c30',2.3);
  path('M 128 24 V 43 Q 128 49 135 49 H 182 Q 209 37 236 49 H 286 Q 292 49 292 43 V 24',undefined,'clip','#b7a071',1.2);
  box(127,4,164,13,2,'#403e32','clip');
  for(const [y,h,color] of [[5,2,'#b9b19b'],[7,3,'#f2ead6'],[10,2,'#c5b795'],[12,3,'#665d49']] as const)box(129,y,160,h,0,color,'clip');
  box(118,23,10,24,3,'#202d24','clip');box(291,23,10,24,3,'#202d24','clip');
  box(126,46,20,10,2,'#202d24','clip');box(273,46,20,10,2,'#202d24','clip');
  for(let i=0;i<4;i++){line(120+i*1.5,25,120+i*1.5,38,'#697162',.45,'clip');line(293+i*1.5,25,293+i*1.5,38,'#697162',.45,'clip');}
  paw(210,69,4.4);text('minué',210,92,25,'print','middle');
  for(const side of [-1,1]){line(210+side*119,80,210+side*123,72,c.gold,1.2);line(210+side*126,84,210+side*133,78,c.gold,1.2);line(210+side*130,91,210+side*136,89,c.gold,1.2);}
  text('COMPROBANTE DE ENTREGA',210,122,16.5,'print','middle',c.ink);
  (n[n.length-1] as Extract<SceneNode,{kind:'text'}>).weight=700;
  line(106,140,197,140,c.gold);line(222,140,313,140,c.gold);heart(209.5,140,4);
  box(72,153,276,35,7,c.paper,'print',c.line);
  box(190,159,150,23,5,'#f6f5ef','print');
  box(83,162,17,17,2,c.paper,'print',c.green);line(83,167,100,167,c.green,1.2);line(87,160,87,165,c.green,1.6);line(96,160,96,165,c.green,1.6);
  for(let i=0;i<6;i++)ellipse(87+i%3*4.3,171+Math.floor(i/3)*4,1,1,c.green,'print');
  text('FECHA DE ENTREGA:',112,174,7.4);
  box(66,197,288,43,7,c.paper,'print',c.line);
  path('M 85 205 C 71 205 73 217 85 231 C 97 217 99 205 85 205 Z',c.green,'print');ellipse(85,213,4,4,c.paper,'print');
  text('PUNTO DE ENTREGA:',104,216,7.4);heart(340,214,4);
  box(61,249,297,174,6,c.paper,'print',c.line);
  path('M 67 249 H 352 Q 358 249 358 255 V 271 H 61 V 255 Q 61 249 67 249 Z',c.green,'print');
  path('M 125 265 Q 128 261 130 256 M 128 261 Q 122 262 124 257 Q 127 257 128 261 M 129 259 Q 134 258 132 254 Q 129 255 129 259',undefined,'print',c.gold,.8);
  text('PRODUCTO',165.5,264,9.5,'print','middle',c.paper);text('CANTIDAD (KG)',310,264,8,'print','middle',c.paper);
  line(261,249,261,423,c.line,.5);
  for(let i=0;i<6;i++)line(61,271+i*25.3,358,271+i*25.3);
  box(61,430,297,31,7,c.paper,'print',c.line);box(157,434,195,23,4,'#f6f5ef','print');
  ellipse(76,445,8.5,8.5,c.green,'print');ellipse(76,442,2.7,2.7,c.paper,'print');path('M 71 450 Q 71 443 76 446 Q 81 443 81 450 Z',c.paper,'print');
  text('RECIBIDO POR:',92,448,7.5);
  box(61,465,297,44,7,c.paper,'print',c.line);box(177,469,175,36,4,'#f6f5ef','print');
  path('M 70 494 L 73 487 L 82 477 Q 84 476 85 479 L 76 490 Z',undefined,'print',c.green,1.4);line(73,487,76,490,c.green,1.2);
  text('FIRMA DE RECEPCIÓN:',86,491,7.3);
  text('ENTREGA CONFIRMADA',209.5,523,8,'seal','middle');
  ellipse(209.5,541,12.5,12.5,c.paper,'seal');path('M 209.5 528.5 A 12.5 12.5 0 1 1 209.49 528.5',undefined,'seal',c.green,1.7);
  path('M 203.5 541 L 208 545.5 L 216 536',undefined,'seal',c.green,2.5);
  for(const side of [-1,1]){line(209.5+side*49,541,209.5+side*57,541,c.gold,1.2,'seal');line(209.5+side*48,535,209.5+side*54,531,c.gold,1.2,'seal');line(209.5+side*48,547,209.5+side*54,551,c.gold,1.2,'seal');}
  heart(135,568,4.5,'seal');text('Gracias por confiar en Minué',208,571,8.5,'seal','middle');paw(282,568,2.4,'seal');
  return n;
}
export const RECEIPT_SCENE = receiptScene();
