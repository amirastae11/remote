// Astae Device Pairing v0.2 — staging only. Node.js 20+, no dependencies.
// Uses user-entered one-time codes, owner-scoped browser sessions and device tokens.
// Do NOT expose privileged MCP tools until real user sign-in/OAuth is added.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const rand=()=>crypto.randomBytes(32).toString('base64url');
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const ABC='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code=()=>Array.from(crypto.randomBytes(8),b=>ABC[b%ABC.length]).join('');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
function template(content){
  return '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Astae Remote · Pair Device</title><style>body{min-height:100vh;margin:0;display:grid;place-items:center;background:radial-gradient(ellipse at top,#174355,#080f1a 70%);color:#ebf9ff;font:16px system-ui}main{width:min(420px,86vw);background:#0b1c2c;border:1px solid #326174;border-radius:20px;padding:30px;box-shadow:0 24px 70px #0008}h1{color:#6ef1ff}p{color:#b8cbd5;line-height:1.5}input{width:100%;box-sizing:border-box;background:#122b3a;color:white;border:1px solid #426575;border-radius:9px;padding:14px;font:700 22px monospace;letter-spacing:2px;margin:12px 0}button{background:#24d8b0;color:#09242b;border:0;border-radius:9px;width:100%;padding:13px;font-weight:bold;cursor:pointer}a{color:#65ecff}</style><main><h1>⚡ ASTAE REMOTE</h1>'+content+'</main></html>';
}
export async function makePairingServer({baseURL='http://127.0.0.1:9011',stateFile=path.resolve('data/pairs.json'),now=()=>Date.now()}={}){
  const base=new URL(baseURL);
  if(base.username||base.password||base.search||base.hash||!/^(\/|\/[a-zA-Z0-9_-]+\/)$/u.test(base.pathname)||!['https:','http:'].includes(base.protocol))throw Error('Invalid relay base URL');
  if(base.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('HTTPS required');
  let db={requests:{},sessions:{},tokens:{},refresh:{},devices:{}};
  try{db=JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  let saveQueue=Promise.resolve();
  const save=()=>{const data=JSON.stringify(db);saveQueue=saveQueue.then(async()=>{
    await fs.mkdir(path.dirname(stateFile),{recursive:true,mode:0o700});
    const tmp=stateFile+'.'+process.pid+'.'+rand().slice(0,7);
    try{await fs.writeFile(tmp,data,{mode:0o600,flag:'wx'});await fs.rename(tmp,stateFile);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  });return saveQueue;};
  const limits=new Map();
  const limited=(req,key,max)=>{const id=key+':'+req.socket.remoteAddress,t=now(),recent=(limits.get(id)||[]).filter(x=>t-x<600000);recent.push(t);limits.set(id,recent);return recent.length>max;};
  const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.includes('=')).map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
  const owner=req=>{const c=cookies(req).astae_session,r=c&&db.sessions[hash(c)];return r&&r.expires>now()?r.owner:null;};
  const deviceAuth=req=>{const b=req.headers.authorization||'',r=b.startsWith('Bearer ')&&db.tokens[hash(b.slice(7))];return r&&r.expires>now()?r:null;};
  const publicPath=base.pathname;
  const secure=base.protocol==='https:'?'; Secure':'';
  function respond(res,status,obj,head={}){
    res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY',...head});res.end(JSON.stringify(obj));
  }
  function webpage(res,status,content,head={}){
    const rewriteCookie=s=>s.replaceAll('Path=/verify', 'Path='+publicPath+'verify').replaceAll('Path=/;', 'Path='+publicPath+';');
    if(head['set-cookie']) head['set-cookie']=Array.isArray(head['set-cookie'])?head['set-cookie'].map(rewriteCookie):rewriteCookie(head['set-cookie']);
    res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",...head});res.end(template(content).replace(/(href|action)="\//g, '$1="'+publicPath));
  }
  async function parse(req){const parts=[];let bytes=0;for await(const p of req){bytes+=p.length;if(bytes>4096){const e=Error('request_too_large');e.status=413;throw e;}parts.push(p);}
    const s=Buffer.concat(parts).toString('utf8');return (req.headers['content-type']||'').includes('application/json')?JSON.parse(s):Object.fromEntries(new URLSearchParams(s));}
  const issue=d=>{const access=rand(),refresh=rand();
    db.tokens[hash(access)]={owner:d.owner,id:d.id,expires:now()+3600000};
    db.refresh[hash(refresh)]={owner:d.owner,id:d.id,expires:now()+30*86400000};
    return {access_token:access,refresh_token:refresh,token_type:'Bearer',device_id:d.id,expires_in:3600};};
  async function handler(req,res){try{
    const u=new URL(req.url,'http://localhost'),route=u.pathname;
    if(req.headers.origin&&req.headers.origin!==base.origin)return respond(res,403,{error:'bad_origin'});
    if(req.method==='GET'&&route==='/health')return respond(res,200,{ok:true,service:'astae-device-pairing',version:'0.2.0',deviceFlow:true});
    if(req.method==='POST'&&route==='/device/authorization'){
      if(limited(req,'start',8))return respond(res,429,{error:'rate_limited'});
      const args=await parse(req),deviceCode=rand(),userCode=code();
      db.requests[hash(deviceCode)]={hash:hash(userCode),name:String(args.device_name||'My computer').slice(0,80),expires:now()+600000,status:'pending',nextPoll:0};
      await save();return respond(res,200,{device_code:deviceCode,user_code:userCode,verification_uri:base.origin+publicPath+'verify',interval:3,expires_in:600});
    }
    if(req.method==='POST'&&route==='/device/token'){
      if(limited(req,'token',400))return respond(res,429,{error:'rate_limited'});
      const args=await parse(req);
      if(args.grant_type==='urn:ietf:params:oauth:grant-type:device_code'){
        const r=db.requests[hash(args.device_code||'')];
        if(!r)return respond(res,400,{error:'invalid_grant'});
        if(r.expires<now())return respond(res,400,{error:'expired_token'});
        if(r.status==='pending'){if(r.nextPoll>now())return respond(res,400,{error:'slow_down'});
          r.nextPoll=now()+3000;await save();return respond(res,400,{error:'authorization_pending'});}
        if(r.status!=='approved')return respond(res,400,{error:'invalid_grant'});
        const d=db.devices[r.deviceId];r.status='consumed';const tokens=issue(d);await save();return respond(res,200,tokens);
      }
      if(args.grant_type==='refresh_token'){
        const k=hash(args.refresh_token||''),r=db.refresh[k];
        if(!r||r.expires<now())return respond(res,400,{error:'invalid_grant'});
        const d=db.devices[r.id];if(!d||d.owner!==r.owner)return respond(res,400,{error:'invalid_grant'});
        delete db.refresh[k];const tokens=issue(d);await save();return respond(res,200,tokens);
      }
      return respond(res,400,{error:'unsupported_grant_type'});
    }
    if(req.method==='POST'&&route==='/device/heartbeat'){
      const a=deviceAuth(req);if(!a)return respond(res,401,{error:'unauthorized'});
      const args=await parse(req),d=db.devices[a.id];
      if(args.device_id!==a.id||!d||d.owner!==a.owner)return respond(res,403,{error:'device_mismatch'});
      d.lastSeen=now();await save();return respond(res,200,{ok:true,connected:true,device_id:d.id});
    }
    if(req.method==='GET'&&route==='/device/jobs'){
      const a=deviceAuth(req);if(!a)return respond(res,401,{error:'unauthorized'});
      if(u.searchParams.get('device_id')!==a.id)return respond(res,403,{error:'device_mismatch'});
      return respond(res,200,{job:null});
    }
    if(req.method==='POST'&&route.startsWith('/device/jobs/')&&route.endsWith('/result')){
      if(!deviceAuth(req))return respond(res,401,{error:'unauthorized'});
      return respond(res,404,{error:'unknown_job'});
    }
    if(req.method==='GET'&&route==='/verify'){
      const csrf=rand(),val=esc(String(u.searchParams.get('code')||'').slice(0,9));
      return webpage(res,200,'<p>Enter the code printed by Astae Remote on your computer. Approve only a device you started.</p><form method="post" action="/verify"><input name="csrf" type="hidden" value="'+csrf+'"><input name="code" placeholder="DEVICE CODE" autocomplete="off" maxlength="9" required value="'+val+'"><button>Verify Device</button></form><p>Code expires after 10 minutes.</p>',{'set-cookie':'astae_csrf='+csrf+'; HttpOnly; Path=/verify; SameSite=Strict; Max-Age=900'+secure});
    }
    if(req.method==='POST'&&route==='/verify'){
      if(limited(req,'verify',12))return webpage(res,429,'<p>Too many attempts. Retry later.</p>');
      const args=await parse(req),csrf=cookies(req).astae_csrf;
      if(!csrf||!equal(csrf,args.csrf||''))return webpage(res,403,'<p>Verification session expired. Reload the page.</p>');
      const entered=String(args.code||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
      const r=Object.values(db.requests).find(v=>v.status==='pending'&&v.expires>now()&&equal(v.hash,hash(entered)));
      if(!r)return webpage(res,400,'<p>Invalid or expired code.</p>');
      const account=owner(req)||rand(),id=crypto.randomUUID();
      db.devices[id]={id,owner:account,name:r.name,createdAt:now(),lastSeen:0};
      r.status='approved';r.deviceId=id;
      const session=rand();db.sessions[hash(session)]={owner:account,expires:now()+90*86400000};await save();
      return webpage(res,200,'<h2>✓ Device verified</h2><p>'+esc(r.name)+' is paired. Return to CMD; it will turn green after an authenticated heartbeat.</p><a href="/devices">See your devices</a>',{'set-cookie':['astae_session='+session+'; HttpOnly; Path=/; SameSite=Lax; Max-Age=7776000'+secure,'astae_csrf=gone; HttpOnly; Path=/verify; Max-Age=0'+secure]});
    }
    if(req.method==='GET'&&route==='/api/devices'){
      const account=owner(req);if(!account)return respond(res,401,{error:'login_required'});
      return respond(res,200,{devices:Object.values(db.devices).filter(d=>d.owner===account).map(d=>({id:d.id,name:d.name,connected:now()-d.lastSeen<60000,last_seen:d.lastSeen}))});
    }
    if(req.method==='GET'&&route==='/devices'){
      const account=owner(req);if(!account)return webpage(res,401,'<p>Sign in by verifying a code from your terminal.</p>');
      const rows=Object.values(db.devices).filter(d=>d.owner===account).map(d=>'<p><b>'+esc(d.name)+'</b> — '+(now()-d.lastSeen<60000?'🟢 Connected':'⚪ Offline')+'</p>').join('');
      return webpage(res,200,'<h2>Your devices</h2>'+(rows||'<p>No devices yet.</p>')+'<a href="/verify">Pair another device</a>');
    }
    return respond(res,404,{error:'not_found'});
  }catch(e){return respond(res,e.status||500,{error:e.status===413?'body_too_large':'internal_error'});}}
  const server=http.createServer(handler);
  return {server,state:db,close:()=>new Promise(r=>server.close(r))};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const port=Number(process.env.PORT||9011),baseURL=process.env.ASTAE_PAIR_BASE_URL||'http://127.0.0.1:'+port,stateFile=process.env.ASTAE_PAIR_DB||path.resolve('data/pairs.json');
  const app=await makePairingServer({baseURL,stateFile});
  app.server.listen(port,'127.0.0.1',()=>console.log('Astae Pairing Relay ready on port '+port));
}
