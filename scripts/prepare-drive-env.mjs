import {randomBytes} from 'node:crypto';
import {readFile,writeFile,chmod} from 'node:fs/promises';
let text=await readFile('.env','utf8');
for(const key of ['DRIVE_TOKEN_ENCRYPTION_KEY','DRIVE_WORKER_SECRET']){
 if(!new RegExp('^'+key+'=.+','m').test(text))text+='\n'+key+'='+randomBytes(32).toString('base64');
}
for(const key of ['GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET']){
 if(!new RegExp('^'+key+'=','m').test(text))text+='\n'+key+'=';
}
await writeFile('.env',text.trimEnd()+'\n',{mode:0o600});await chmod('.env',0o600);
console.log('Claves de Drive preparadas en .env. No se muestran valores. No cambies la clave de cifrado después de conectar Google.');
