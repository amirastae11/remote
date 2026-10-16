import test from 'node:test';
import assert from 'node:assert/strict';
import {makePairingServer} from '../server/server.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
async function local(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'astae-pair-'));
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
  const port=socket.address().port;await new Promise(r=>socket.close(r));
  const origin='http://127.0.0.1:'+port;
  const app=await makePairingServer({baseURL:origin,stateFile:path.join(tmp,'pairs.json')});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  return {origin,done:async()=>{await app.close();await fs.rm(tmp,{recursive:true,force:true});}};
}
const send=(url,data,head={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...head},body:JSON.stringify(data)});
test('CODE -> site verification -> token -> live heartbeat -> Connected',async()=>{
  const t=await local();try{
    const r=await send(t.origin+'/device/authorization',{device_name:'Test laptop'});
    assert.equal(r.status,200);
    const init=await r.json();assert.match(init.user_code,/^[A-Z2-9]{8}$/);
    let x=await send(t.origin+'/device/token',{grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:init.device_code});
    assert.equal(x.status,400);assert.equal((await x.json()).error,'authorization_pending');
    x=await send(t.origin+'/device/heartbeat',{device_id:'unauthorized'});assert.equal(x.status,401);
    x=await fetch(t.origin+'/verify');const cookie=x.headers.get('set-cookie').split(';')[0];
    const html=await x.text();const csrf=html.match(/name="csrf" type="hidden" value="([^"]+)"/)[1];
    x=await fetch(t.origin+'/verify',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',cookie},body:new URLSearchParams({code:init.user_code,csrf})});
    assert.equal(x.status,200);const accountCookie=x.headers.get('set-cookie').match(/astae_session=([^;]+)/)[0];
    x=await send(t.origin+'/device/token',{grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:init.device_code});
    assert.equal(x.status,200);const auth=await x.json();
    x=await send(t.origin+'/device/heartbeat',{device_id:auth.device_id},{authorization:'Bearer '+auth.access_token});assert.equal(x.status,200);
    x=await fetch(t.origin+'/api/devices',{headers:{cookie:accountCookie}});assert.equal((await x.json()).devices[0].connected,true);
    x=await send(t.origin+'/device/token',{grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:init.device_code});assert.equal(x.status,400);
    x=await send(t.origin+'/device/token',{grant_type:'refresh_token',refresh_token:auth.refresh_token});assert.equal(x.status,200);
  }finally{await t.done();}
});
test('cross-origin and unauthenticated jobs are forbidden',async()=>{
  const t=await local();try{
    let r=await send(t.origin+'/device/authorization',{}, {origin:'https://evil.invalid'});assert.equal(r.status,403);
    r=await fetch(t.origin+'/device/jobs?device_id=any');assert.equal(r.status,401);
    r=await fetch(t.origin+'/api/devices');assert.equal(r.status,401);
  }finally{await t.done();}
});
