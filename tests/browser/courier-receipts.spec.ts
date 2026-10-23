import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {demoData,DEMO_USER} from '../../src/lib/demo';
import {demoCommand} from '../../src/lib/demo-command';
import {buildReceiptPDF} from '../../src/lib/pdf';
import {serverReceiptAssets} from '../../server/receipt';

for(const isAdmin of [false,true])test(`confirmation never asks a ${isAdmin?'courier with admin permissions':'courier'} to connect Drive`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let data=demoData();data.profiles[0].is_admin=isAdmin;
 const user={id:DEMO_USER,email:'courier@example.com',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 const token=[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({sub:DEMO_USER,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),role:'authenticated',aud:'authenticated'})).toString('base64url'),'synthetic-test-token'].join('.');
 let servedPDF:Uint8Array|undefined;const driveRequests:string[]=[],externalRequests:string[]=[];
 page.on('request',r=>{if(/accounts\.google|drive\.google/.test(r.url()))externalRequests.push(r.url());});
 await page.route('https://*.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/auth/v1/token')return route.fulfill({json:{access_token:token,refresh_token:'test-only',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user}});
   if(path==='/auth/v1/user')return route.fulfill({json:user});
   const table=path.split('/').at(-1)!;const rows=data[table==='delivery_events'?'events':table as keyof typeof data];
   return rows?route.fulfill({json:rows}):route.fulfill({status:404,json:{error:'Outside this test'}});
 });
 await page.route('**/api/command',async route=>{
   const input=route.request().postDataJSON();expect(input.action).toBe('confirm_delivery');data=demoCommand(data,DEMO_USER,input.action,input.payload);
   data.receipts[0].drive_status='reconnect';await route.fulfill({json:{ok:true,data:data.receipts[0]}});
 });
 await page.route('**/api/receipt?**',async route=>{
   const r=data.receipts[0];servedPDF ||= await buildReceiptPDF(r,Buffer.from(r.signature_data!.split(',')[1],'base64'),{assets:await serverReceiptAssets(4),demonstration:true});
   await route.fulfill({contentType:'application/pdf',body:Buffer.from(servedPDF)});
 });
 await page.route('**/api/receipt-state?**',route=>route.fulfill({json:{receipt:data.receipts[0],versions:[4],drive_status:'reconnect',originalAvailable:false}}));
 await page.route('**/api/drive-*',route=>{driveRequests.push(new URL(route.request().url()).pathname);return route.fulfill({json:{configured:true,connected:false,state:'reconnect',email:'puntodeentregasminue@gmail.com'}});});
 await page.goto('/');await page.getByLabel('Correo electrónico').fill('courier@example.com');await page.getByLabel('Contraseña',{exact:true}).fill('synthetic-test-password');await page.getByRole('button',{name:'Ingresar a Minue'}).click();
 await page.getByRole('button',{name:/01 Veterinaria Huellitas/}).click();await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();
 await page.getByRole('combobox',{name:/Quién recibe/}).selectOption('new');await page.getByRole('textbox',{name:'Nombre y apellido'}).fill('Persona de prueba');
 const signature=page.getByLabel('Dibuja la firma de quien recibe');await signature.scrollIntoViewIfNeeded();const box=(await signature.boundingBox())!;await page.mouse.move(box.x+30,box.y+80);await page.mouse.down();await page.mouse.move(box.x+120,box.y+110,{steps:20});await page.mouse.move(box.x+200,box.y+50,{steps:20});await page.mouse.up();
 await page.getByRole('button',{name:'Confirmar y generar comprobante'}).click();
 await expect(page.getByRole('button',{name:'Pantalla completa para foto'})).toBeEnabled({timeout:15000});
 await expect(page.getByText('Entrega confirmada. Comprobante disponible en Minue.')).toBeVisible();
 await expect(page.getByRole('dialog').getByText(/Drive|conexión|verificar/i)).toHaveCount(0);
 expect(driveRequests).toEqual([]);expect(externalRequests).toEqual([]);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar comprobante PDF'}).click();const download=await downloadPromise;
 expect(Buffer.from(await readFile((await download.path())!))).toEqual(Buffer.from(servedPDF!));
 await page.getByRole('button',{name:'Volver a mis entregas'}).click();await page.getByRole('button',{name:'Ver mi perfil',exact:true}).click();
 if(isAdmin){await expect(page.getByRole('button',{name:'Conectar Google Drive',exact:true})).toBeVisible();await expect(page.getByText('Requiere reconexión de Drive.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Reintentar',exact:true})).toBeDisabled();}
 else {await expect(page.getByRole('button',{name:'Conectar Google Drive',exact:true})).toHaveCount(0);expect(driveRequests).toEqual([]);}
 expect(errors).toEqual([]);
});
