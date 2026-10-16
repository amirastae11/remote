#!/usr/bin/env node
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DEFAULT_RELAY, SESSION_FILE, SHARED_ROOT, relayURL, api, loadSession, saveSession, deviceAuthorize, executeSafeJob, refreshIfNecessary, legacyAgentStatus, wait } from '../lib/core.mjs';

const COLORS={green:'\x1b[92m',cyan:'\x1b[96m',yellow:'\x1b[93m',red:'\x1b[91m',blue:'\x1b[94m',reset:'\x1b[0m',bold:'\x1b[1m'};
const col=(s,c)=>process.stdout.isTTY?COLORS[c]+s+COLORS.reset:s;
const say=(s='')=>console.log(s);
const line=(glyph,label,s,c='cyan')=>say(`${col(glyph,c)}  ${label}${s===undefined?'':': '+col(s,c)}`);
function banner(){say(col('\n   ╔══════════════════════════════════════╗\n   ║  ⚡ ASTAE REMOTE  ·  DEVICE AGENT   ║\n   ╚══════════════════════════════════════╝\n','cyan'));}
async function openBrowser(url){
  const cmd=process.platform==='win32'?'cmd':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['/c','start','','"'+url+'"']:[url];
  try{const child=spawn(cmd,args,{stdio:'ignore',detached:true,windowsHide:true});child.on('error',()=>{});child.unref();}catch{}
}
async function main(){
  banner();
  const [cmd='remote',...rest]=process.argv.slice(2);
  if (['help','--help','-h'].includes(cmd)){
    say('  Usage: astae-remote remote [--relay https://...]');
    say('         astae-remote status');say('         astae-remote logout');
    say('  A first-time pairing requires explicit approval in your browser.');return;
  }
  if(cmd==='logout'){
    const old=await loadSession();await fs.rm(SESSION_FILE,{force:true});
    line('✓','Local session removed','Server-side revocation must be performed in account dashboard','yellow');
    if(old) say('  Existing server-side device must still be revoked separately.');return;
  }
  const i=rest.indexOf('--relay');
  const relay=relayURL(i>=0?rest[i+1]:process.env.ASTAE_RELAY_URL||DEFAULT_RELAY);
  let session=await loadSession();
  const existing=await legacyAgentStatus(relay);
  const ready = await api(relay,'GET','/health');
  line('✓','Relay',ready.ok?'Online':'Response received','green');
  line('→','Endpoint',relay,'cyan');
  if(existing) line(existing.connected?'✓':'!','Existing Astae Agent',existing.connected?`Heartbeat fresh, ${existing.agentId}`:`Last report ${existing.ageSeconds}s ago`,existing.connected?'green':'yellow');
  if(cmd==='status'){
    line(session?'✓':'!','Local session',session?'Saved':'Not paired',session?'green':'yellow');
    line('•','Shared folder',SHARED_ROOT);return;
  }
  if(cmd!=='remote')throw new Error('Unknown command '+cmd);
  if(existing?.connected && !session){
    line('✓','Existing Astae Agent','Already running; avoiding duplicate agent and re-pairing','green');
    line('!','ChatGPT OAuth','Still requires a one-time account connection','yellow');
    return;
  }
  if(!session || session.relay!==relay){
    line('🔐','Pairing','First run requires one-time account verification','yellow');
    const tokens=await deviceAuthorize(relay,{
      deviceName:os.hostname(),openBrowser,
      show(code,url){
        say('\n  '+col('Open in browser:','yellow')+' '+url);
        say('  '+col('Verification code:','yellow')+' '+col(code,'bold'));
        say('  Approve only if you initiated this pairing.\n');
      }
    });
    session={...tokens,relay,expires_at:Date.now()+Number(tokens.expires_in||3600)*1000};
    await saveSession(session);
    line('✓','Device verified',session.device_id,'green');
  }else line('✓','Saved identity','Reusing existing device session','green');
  await fs.mkdir(SHARED_ROOT,{recursive:true,mode:0o700});
  let backoff=1000, lastBeat=0, savedToken=session.access_token;
  let running=true; process.once('SIGINT',()=>{running=false;say('\n  Stopping after current request…');});
  process.once('SIGTERM',()=>{running=false;});
  line('✓','Agent starting','No extra approval popups; read-only tools','green');
  while(running){
    try{
      session=await refreshIfNecessary(relay,session);
      if(savedToken!==session.access_token){await saveSession(session);savedToken=session.access_token;}
      const now=Date.now();
      if(now-lastBeat>20000){
        await api(relay,'POST','/device/heartbeat',{device_id:session.device_id,capabilities:['ping','system_info','read_file']},session.access_token);
        lastBeat=now;
        line('✓','Connected','Listening for authenticated jobs','green');
      }
      const job=await api(relay,'GET',`/device/jobs?device_id=${encodeURIComponent(session.device_id)}`,undefined,session.access_token,12000);
      if(job?.job_id){
        let out;
        try {out={ok:true,result:await executeSafeJob(job)};}catch(e){out={ok:false,error:String(e.message).slice(0,120)};}
        await api(relay,'POST',`/device/jobs/${encodeURIComponent(job.job_id)}/result`,out,session.access_token);
        line(out.ok?'✓':'!','Job',job.tool,out.ok?'green':'yellow');
      }
      backoff=1000;
      await wait(1000);
    }catch(err){
      if(err.status===401||err.status===403){
        line('✗','Authorization expired','Re-run to authorize account','red');process.exitCode=2;break;
      }
      line('!','Connection retry',`${err.message} (${Math.round(backoff/1000)}s)`,'yellow');
      await wait(backoff);backoff=Math.min(30000,backoff*2);
    }
  }
  line('•','Disconnected','Agent stopped','yellow');
}
main().catch(err=>{console.error(col('  ✗ '+err.message,'red'));process.exitCode=1;});
