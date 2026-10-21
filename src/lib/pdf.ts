import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { drawVectorReceipt } from './receipt-vector.js';
import type { Receipt } from './types.js';

export type ReceiptAssets = { template?: Uint8Array; font: Uint8Array; boldFont?: Uint8Array };
export async function loadReceiptAssets(version = 2): Promise<ReceiptAssets> {
  if(version===3){
    const responses=await Promise.all(['Poppins-Regular.ttf','Poppins-Bold.ttf'].map(name=>fetch('/receipt-assets/'+name)));
    if(responses.some(r=>!r.ok))throw new Error('No pudimos cargar la tipografía.');
    const [font,boldFont]=await Promise.all(responses.map(async r=>new Uint8Array(await r.arrayBuffer())));return {font,boldFont};
  }
  const responses = await Promise.all(['/receipt-assets/template-v2.png', '/receipt-assets/Poppins-Regular.ttf'].map(path => fetch(path)));
  if (responses.some(r => !r.ok)) throw new Error('No pudimos cargar el formato del comprobante.');
  const [template, font] = await Promise.all(responses.map(async r => new Uint8Array(await r.arrayBuffer())));
  return { template, font };
}
export { receiptFilename, receiptMonth } from './receipt-format.js';
function deliveryDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'America/Guayaquil',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
  const get = (type:string) => parts.find(p=>p.type===type)!.value;
  return get('day') + '/' + get('month') + '/' + get('year') + ' ' + get('hour') + ':' + get('minute');
}
function fitText(page: PDFPage, font: PDFFont, value: string, cx: number, baselineFromTop: number, width: number, size: number, maxLines = 2, alignAbove = false) {
  const text = value.replace(/[\u0000-\u001f]/g,' ').trim();
  let lines: string[] = [];
  for (; size >= 5; size -= .2) {
    lines = [''];
    for (const word of text.split(/\s+/)) {
      let last = lines.length - 1;
      const candidate=lines[last]?lines[last]+' '+word:word;
      if(font.widthOfTextAtSize(candidate,size)<=width){lines[last]=candidate;continue;}
      if(lines[last]){lines.push('');last++;}
      for(const char of word){
        if(font.widthOfTextAtSize(lines[last]+char,size)>width && lines[last]){lines.push('');last++;}
        lines[last]+=char;
      }
    }
    if (lines.length <= maxLines) break;
  }
  if (lines.length > maxLines) throw new Error('Un texto es demasiado largo para el comprobante.');
  lines.forEach((line, n) => page.drawText(line.trim(), {
    font, size, color:rgb(0.07,0.07,0.07), x:cx-font.widthOfTextAtSize(line.trim(),size)/2,
    y:595-baselineFromTop + ((lines.length-1)/(alignAbove?1:2)-n)*size*1.1,
  }));
}
export async function buildReceiptPDF(receipt: Receipt, signature: Uint8Array, options: {demonstration?: boolean; assets?: ReceiptAssets} = {}): Promise<Uint8Array> {
  const assets = options.assets || await loadReceiptAssets(receipt.template_version===3?3:2);
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(assets.font, {subset:true});
  const vector=receipt.template_version===3;
  const bold=vector&&assets.boldFont?await doc.embedFont(assets.boldFont,{subset:true}):font;
  if(!vector && !assets.template)throw new Error('Falta la plantilla original del comprobante.');
  const background = vector?null:await doc.embedPng(assets.template!), ink = await doc.embedPng(signature);
  const snapshot = receipt.snapshot;
  if (snapshot.items.some(item => !['kg','1 kg','1kg'].includes(item.unit.trim().toLowerCase()))) throw new Error('Revisa las cantidades en kg antes de generar este formato.');
  const chunks = Array.from({length:Math.max(1,Math.ceil(snapshot.items.length/6))},(_,n)=>snapshot.items.slice(n*6,n*6+6));
  for (const items of chunks) {
    const page = doc.addPage([419,595]);
    if(vector)drawVectorReceipt(page,font,bold);
    else page.drawImage(background!,{x:0,y:0,width:419,height:595});
    fitText(page,font,deliveryDate(snapshot.confirmed_at),267.53,175.502,146,11.2,1);
    fitText(page,font,snapshot.destination.name,259.53,218.502,155,vector?10:11.2,3);
    items.forEach((item,n)=>{
      fitText(page,font,item.name,vector?161:165.50,(vector?287.5+n*25.3:292.83+n*24),vector?182:205,10.5,2,!vector);
      const quantity = new Intl.NumberFormat('es-EC',{maximumFractionDigits:3}).format(item.quantity);
      fitText(page,font,quantity + ' kg',vector?310:315.50,(vector?287.5+n*25.3:292.83+n*24),vector?80:87,10.5,1);
    });
    fitText(page,font,snapshot.recipient,vector?253:247.53,448.118,vector?190:202,10.8,2);
    const scale = Math.min(130/ink.width,39/ink.height);
    page.drawImage(ink,{x:273-ink.width*scale/2,y:595-489-ink.height*scale/2,width:ink.width*scale,height:ink.height*scale});
    if(options.demonstration) {
      page.drawRectangle({x:30,y:34,width:359,height:16,color:rgb(1,1,1),opacity:.94});
      page.drawText('DEMOSTRACIÓN · SIN VALIDEZ OPERATIVA',{x:77,y:39,font,size:8,color:rgb(.55,.18,.12)});
    }
  }
  doc.setTitle('Minue - ' + (receipt.receipt_number || receipt.folio));
  doc.setAuthor('Minue');doc.setCreationDate(new Date(receipt.created_at));
  doc.setModificationDate(new Date(receipt.created_at));
  return doc.save();
}
