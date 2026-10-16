import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {makePairingServer} from '../server/server.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
test('real CLI prints Connected only after browser device code verification', {timeout:25000}, async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'astae-cli-e2e-'));
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
  const port=socket.address().port;await new Promise(r=>socket.close(r));
  const base='http://127.0.0.1:'+port;
  const app=await makePairingServer({baseURL:base,stateFile:path.join(tmp,'state.json')});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  const child=spawn(process.execPath,[path.resolve(HERE,'../bin/astae-remote.mjs'),'remote','--relay',base],{
    cwd:path.resolve(HERE,'..'),env:{...process.env,HOME:tmp,USERPROFILE:tmp,ASTAE_NO_BROWSER:'1'},
    stdio:['ignore','pipe','pipe']
  });
  let output='',error='',began=false;
  try {
    await new Promise((resolve,reject)=>{
      const deadline=setTimeout(()=>reject(Error('timeout: '+output+' '+error)),19000);
      child.stderr.on('data',d=>error+=d.toString());
      child.on('exit',c=>{clearTimeout(deadline);reject(Error('CLI exited '+c+' '+output+' '+error));});
      child.stdout.on('data',async d=>{
        output+=d.toString();
        if(!began){
          const m=output.match(/Verification code:\s*([A-Z2-9]{8})/);
          if(m){began=true;try{
            const res=await fetch(base+'/verify'),cookie=res.headers.get('set-cookie').split(';')[0];
            const html=await res.text(),csrf=html.match(/name="csrf" type="hidden" value="([^"]+)"/)[1];
            const approved=await fetch(base+'/verify',{method:'POST',
              headers:{'content-type':'application/x-www-form-urlencoded',cookie},
              body:new URLSearchParams({csrf,code:m[1]})});
            assert.equal(approved.status,200);
          }catch(e){clearTimeout(deadline);reject(e)}}
        }
        if(output.includes('Connected: Listening for authenticated jobs')){clearTimeout(deadline);resolve();}
      });
    });
    assert.match(output,/Device verified/);assert.match(output,/Connected: Listening/);
  }finally{child.kill('SIGTERM');await app.close();await fs.rm(tmp,{recursive:true,force:true});}
});
