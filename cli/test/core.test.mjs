import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {relayURL,safeReadFile,executeSafeJob,saveSession,loadSession,deviceAuthorize,legacyAgentStatus} from '../lib/core.mjs';

test('reject non-HTTPS, credentials and query',()=>{
  assert.throws(()=>relayURL('http://example.org'));
  assert.throws(()=>relayURL('https://user:pass@example.com'));
  assert.throws(()=>relayURL('https://example.com/?token=x'));
  assert.equal(relayURL('http://127.0.0.1:7000'),'http://127.0.0.1:7000');
});
test('restrict file sharing path and size; deny unauthorized tools',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'astae-test-'));
  const root=path.join(tmp,'share'); await fs.mkdir(root);
  await fs.writeFile(path.join(root,'ok.txt'),'hi');
  await fs.writeFile(path.join(tmp,'secret.txt'),'private');
  assert.equal(await safeReadFile(root,'ok.txt'),'hi');
  await assert.rejects(()=>safeReadFile(root,'../secret.txt'),/outside/);
  await assert.rejects(()=>safeReadFile(root,path.join(tmp,'secret.txt')),/relative/);
  await assert.rejects(()=>executeSafeJob({tool:'command_run',arguments:{command:'whoami'}},root),/Unsupported/);
  await assert.rejects(()=>executeSafeJob({tool:'read_file',arguments:{path:'../secret.txt'}},root),/outside/);
  await fs.rm(tmp,{recursive:true,force:true});
});
test('persist session with owner-only perms',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'astae-config-'));
  const target=path.join(tmp,'session.json');
  await saveSession({access_token:'test',relay:'http://127.0.0.1'},target);
  assert.equal((await loadSession(target)).access_token,'test');
  if(process.platform!=='win32')assert.equal((await fs.stat(target)).mode&0o777,0o600);
  await fs.rm(tmp,{recursive:true,force:true});
});
test('device code flow polls and succeeds only on positive authorization',async()=>{
  let approved=false,opened=false,shown=false;
  const token=await deviceAuthorize('https://remote.example',{deviceName:'test',sleep:async()=>{},show(){shown=true;},openBrowser:async()=>{opened=true;},poll:async(_r,_m,p)=>{
    if(p==='/device/authorization')return {device_code:'sec',user_code:'123-456',verification_uri:'https://remote.example/device/verify',expires_in:30,interval:3};
    if(!approved){approved=true;const e=new Error('pending');e.code='authorization_pending';throw e;}
    return {device_id:'abc',access_token:'test',expires_in:3600};
  }});
  assert.equal(token.device_id,'abc');assert.ok(opened&&shown);
});
test('verification URI must belong to relay',async()=>{
  await assert.rejects(()=>deviceAuthorize('https://remote.example',{openBrowser:async()=>{},poll:async()=>({device_code:'x',user_code:'y',verification_uri:'https://evil.example/token'})}),/Untrusted/);
});

test('existing agent status is read only and requires fresh heartbeat',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'astae-existing-'));
  const target=path.join(tmp,'agent.json');
  const now=Date.now();
  await fs.writeFile(target,JSON.stringify({connected:true,configured:true,agent_id:'demo-laptop',relay_url:'https://relay.example',last_seen:now/1000,version:'1.4'}));
  const live=await legacyAgentStatus('https://relay.example',target,now);
  assert.ok(live.connected);assert.equal(live.agentId,'demo-laptop');
  assert.equal((await legacyAgentStatus('https://other.example',target,now)).connected,false);
  assert.equal((await legacyAgentStatus('https://relay.example',target,now+120000)).connected,false);
  await fs.rm(tmp,{recursive:true,force:true});
});
