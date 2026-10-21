import { rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { RECEIPT_SCENE, RECEIPT_SIZE } from './receipt-scene.js';
const color=(hex:string)=>rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);
export function drawVectorReceipt(page:PDFPage,font:PDFFont,bold:PDFFont=font) {
  for(const node of RECEIPT_SCENE){
    const common={color:node.fill?color(node.fill):undefined,borderColor:node.stroke?color(node.stroke):undefined,borderWidth:node.stroke?node.strokeWidth:0,opacity:node.opacity ?? 1};
    if(node.kind==='path')page.drawSvgPath(node.d,{x:0,y:RECEIPT_SIZE.height,...common});
    else if(node.kind==='ellipse')page.drawEllipse({x:node.cx,y:RECEIPT_SIZE.height-node.cy,xScale:node.rx,yScale:node.ry,...common});
    else {const face=node.weight===700?bold:font;page.drawText(node.text,{font:face,size:node.size,x:node.x-(node.anchor==='middle'?face.widthOfTextAtSize(node.text,node.size)/2:0),y:RECEIPT_SIZE.height-node.y,color:node.fill?color(node.fill):rgb(0,0,0)});}
  }
}
