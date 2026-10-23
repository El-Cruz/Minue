import { rgb, degrees, type PDFPage, type PDFFont } from 'pdf-lib';
import { RECEIPT_SCENE, RECEIPT_SIZE, type SceneNode } from './receipt-scene.js';
const color=(hex:string)=>rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);
export type SceneFonts={body:PDFFont;bold?:PDFFont;logo?:PDFFont;label?:PDFFont;title?:PDFFont;script?:PDFFont};
export function drawReceiptScene(page:PDFPage,nodes:SceneNode[],height:number,fonts:SceneFonts){
  for(const node of nodes){
    const common={color:node.fill?color(node.fill):undefined,borderColor:node.stroke?color(node.stroke):undefined,borderWidth:node.stroke?node.strokeWidth:0,opacity:node.opacity ?? 1};
    if(node.kind==='path')page.drawSvgPath(node.d,{x:0,y:height,...common});
    else if(node.kind==='ellipse')page.drawEllipse({x:node.cx,y:height-node.cy,xScale:node.rx,yScale:node.ry,...common});
    else {
      const face=(node.font?fonts[node.font]:node.weight===700?fonts.bold:fonts.body)||fonts.body;
      const spacing=node.spacing||0,width=face.widthOfTextAtSize(node.text,node.size)+spacing*(node.text.length-1);
      let x=node.x-(node.anchor==='middle'?width/2:0);
      const options={font:face,size:node.size,y:height-node.y,color:node.fill?color(node.fill):rgb(0,0,0),rotate:degrees(node.rotate||0)};
      if(spacing){for(const char of node.text){page.drawText(char,{...options,x});x+=face.widthOfTextAtSize(char,node.size)+spacing;}}
      else page.drawText(node.text,{...options,x});
    }
  }
}
export function drawVectorReceipt(page:PDFPage,font:PDFFont,bold:PDFFont=font){drawReceiptScene(page,RECEIPT_SCENE,RECEIPT_SIZE.height,{body:font,bold});}
