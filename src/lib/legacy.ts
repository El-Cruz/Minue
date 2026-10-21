import type {Delivery,Receipt} from './types';
export function belongsToProfile(delivery:Delivery,profileId:string){
  return delivery.assigned_to===profileId || delivery.partner_id===profileId || Boolean(delivery.legacy_profile_ids?.includes(profileId));
}
export function legacyReceiptUrl(receipt?:Receipt){
  if(!receipt?.legacy_id || !receipt.legacy_pdf_url)return null;
  try{
    const url=new URL(receipt.legacy_pdf_url);
    return url.protocol==='https:' && url.hostname==='drive.google.com' && /^\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(url.pathname)?url.href:null;
  }catch{return null;}
}

export function deliveryCouriers(delivery:Delivery,profiles:{id:string;name:string}[]){return delivery.legacy_courier || [delivery.assigned_to,delivery.partner_id].filter(Boolean).map(id=>profiles.find(p=>p.id===id)?.name).filter(Boolean).join(' / ') || 'Sin asignar';}
