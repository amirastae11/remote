// Astae Remote — dedicated Cloudflare Worker pairing bridge v0.3.
// Storage is per-installation Cloudflare D1. No dependency on DuckDNS or the old VPS.
// Device pairing is one-time-code based; ChatGPT MCP account auth is separate.
const encoder=new TextEncoder();
const rand=(n=24)=>{const b=new Uint8Array(n);crypto.getRandomValues(b);return [...b].map(v=>v.toString(16).padStart(2,'0')).join('')};
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const shortCode=()=>{const b=new Uint8Array(8);crypto.getRandomValues(b);return [...b].map(x=>alphabet[x%alphabet.length]).join('')};
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(String(s))))).map(b=>b.toString(16).padStart(2,'0')).join('');
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const j=(status,obj,head={})=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...head}});
const ui=(status,content,head={})=>new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Astae Remote · Pair</title><style>html,body{margin:0;min-height:100%;background:#07101b;color:#f1f7fb;font-family:system-ui,Arial}body{display:grid;place-items:center;min-height:100vh;background:radial-gradient(ellipse at 50% 0%,#194e59,#07101b 72%)}main{width:min(440px,83vw);border:1px solid #30616f;background:#0e2030;border-radius:20px;padding:28px;box-shadow:0 18px 55px #0009}h1{color:#70efe8;font-size:27px}p{color:#bfd1df;line-height:1.55}input{display:block;width:100%;box-sizing:border-box;margin:16px 0;padding:16px;border-radius:10px;border:1px solid #517782;background:#132f41;color:white;font:700 24px monospace;letter-spacing:3px;text-transform:uppercase}button{width:100%;background:#34dbc1;color:#08303b;border:none;border-radius:11px;padding:16px;font-weight:750;font-size:16px;cursor:pointer}a{color:#6de7f3}</style><main><h1>⚡ Astae Remote</h1>'+content+'</main></html>',{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",...head}});
async function body(req){let t=await req.text();if(t.length>4096)throw Object.assign(Error('request_too_large'),{status:413});if((req.headers.get('content-type')||'').includes('application/json'))return JSON.parse(t||'{}');return Object.fromEntries(new URLSearchParams(t))}
async function throttle(db,key,max,now){const row=await db.prepare('SELECT count,resets FROM ratelimits WHERE key=?').bind(key).first();if(row&&row.resets>now&&row.count>=max)return false;await db.prepare('INSERT INTO ratelimits (key,count,resets) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN resets<? THEN 1 ELSE count+1 END,resets=CASE WHEN resets<? THEN ? ELSE resets END').bind(key,1,now+600000,now,now,now+600000).run();return true;}
const cookie=(req,name)=>{const s=req.headers.get('cookie')||'';return s.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||''};
async function owner(req,db,now){const raw=cookie(req,'__Host-astae_sid');if(!raw)return null;const sess=await db.prepare('SELECT owner FROM owner_sessions WHERE token_hash=? AND expires>?').bind(await hash(raw),now).first();return sess?.owner||null}
async function authDevice(req,db,now){const raw=req.headers.get('authorization')||'';if(!raw.startsWith('Bearer '))return null;return db.prepare('SELECT device_id,owner FROM access_tokens WHERE token_hash=? AND expires>?').bind(await hash(raw.slice(7)),now).first()}
const deviceCodeGrant='urn:ietf:params:oauth:grant-type:device_code';
async function issue(db,device,now){const access=rand(32),refresh=rand(32);
await db.batch([
db.prepare('INSERT INTO access_tokens(token_hash,device_id,owner,expires) VALUES (?,?,?,?)').bind(await hash(access),device.id,device.owner,now+3600000),
db.prepare('INSERT INTO refresh_tokens(token_hash,device_id,owner,expires) VALUES (?,?,?,?)').bind(await hash(refresh),device.id,device.owner,now+30*86400000)
]);return {access_token:access,refresh_token:refresh,token_type:'Bearer',device_id:device.id,expires_in:3600}}
export default {async fetch(req,env){
const db=env.DB,url=new URL(req.url),route=url.pathname,now=Date.now(),method=req.method.toUpperCase(),ip=req.headers.get('CF-Connecting-IP')||'unknown';
if(!db)return j(503,{error:'database_not_configured'});
try{
if(method==='GET'&&(route==='/'||route==='/pair'))return Response.redirect(url.origin+'/verify',302);
if(method==='GET'&&route==='/health')return j(200,{ok:true,service:'astae-device-pairing',version:'0.3.0',deviceFlow:true,platform:'cloudflare'});
if(method==='POST'&&route==='/device/authorization'){
if(!await throttle(db,'init:'+ip,12,now))return j(429,{error:'rate_limited'});
const d=await body(req),dc=rand(32),uc=shortCode();
await db.prepare("INSERT INTO pair_requests (device_hash,user_hash,device_name,expires,status,next_poll) VALUES (?,?,?,?, 'pending', 0)").bind(await hash(dc),await hash(uc),String(d.device_name||'My Computer').slice(0,80),now+600000).run();
return j(200,{device_code:dc,user_code:uc,verification_uri:url.origin+'/verify',interval:3,expires_in:600});
}
if(method==='POST'&&route==='/device/token'){
if(!await throttle(db,'token:'+ip,500,now))return j(429,{error:'rate_limited'});
const a=await body(req);
if(a.grant_type===deviceCodeGrant){
const h=await hash(a.device_code||''),r=await db.prepare('SELECT status,expires,next_poll,device_id FROM pair_requests WHERE device_hash=?').bind(h).first();
if(!r)return j(400,{error:'invalid_grant'});
if(r.expires<now)return j(400,{error:'expired_token'});
if(r.status==='pending'){
 if(r.next_poll>now)return j(400,{error:'slow_down'});
 await db.prepare('UPDATE pair_requests SET next_poll=? WHERE device_hash=? AND status=?').bind(now+3000,h,'pending').run();
 return j(400,{error:'authorization_pending'});
}
if(r.status!=='approved')return j(400,{error:'invalid_grant'});
const claimed=await db.prepare("UPDATE pair_requests SET status='consumed' WHERE device_hash=? AND status='approved' RETURNING device_id").bind(h).first();
if(!claimed)return j(400,{error:'invalid_grant'});
const device=await db.prepare('SELECT id,owner FROM devices WHERE id=?').bind(claimed.device_id).first();
if(!device)return j(400,{error:'invalid_grant'});
return j(200,await issue(db,device,now));
}
if(a.grant_type==='refresh_token'){
const h=await hash(a.refresh_token||'');
const old=await db.prepare('DELETE FROM refresh_tokens WHERE token_hash=? AND expires>? RETURNING device_id,owner').bind(h,now).first();
if(!old)return j(400,{error:'invalid_grant'});
const device=await db.prepare('SELECT id,owner FROM devices WHERE id=? AND owner=?').bind(old.device_id,old.owner).first();
if(!device)return j(400,{error:'invalid_grant'});
return j(200,await issue(db,device,now));
}
return j(400,{error:'unsupported_grant_type'});
}
if(method==='POST'&&route==='/device/heartbeat'){
const a=await authDevice(req,db,now);if(!a)return j(401,{error:'unauthorized'});
const d=await body(req);
if(d.device_id!==a.device_id)return j(403,{error:'device_mismatch'});
const result=await db.prepare('UPDATE devices SET last_seen=? WHERE id=? AND owner=?').bind(now,a.device_id,a.owner).run();
if(!result.meta?.changes)return j(403,{error:'device_mismatch'});
return j(200,{ok:true,connected:true,device_id:a.device_id});
}
if(method==='GET'&&route==='/device/jobs'){
const a=await authDevice(req,db,now);if(!a)return j(401,{error:'unauthorized'});
if(url.searchParams.get('device_id')!==a.device_id)return j(403,{error:'device_mismatch'});
return j(200,{job:null});
}
if(method==='POST'&&/^\/device\/jobs\/[^/]+\/result$/.test(route)){
if(!await authDevice(req,db,now))return j(401,{error:'unauthorized'});
return j(404,{error:'unknown_job'});
}
if(method==='GET'&&route==='/verify'){
const csrf=rand(24);await db.prepare('INSERT INTO form_nonces(nonce_hash,expires) VALUES (?,?)').bind(await hash(csrf),now+600000).run();
const sample=esc(url.searchParams.get('code')||'');
return ui(200,'<p>Type the 8-character code shown on your computer. Only approve a code you just requested.</p><form method="POST" action="/verify"><input type="hidden" name="csrf" value="'+csrf+'"><input name="code" required pattern="[A-Za-z0-9]{8}" maxlength="8" autocomplete="off" placeholder="8-character code" value="'+sample+'"><button type="submit">Verify Device</button></form><p>Code expires in 10 minutes. No account or extra password required.</p>');
}
if(method==='POST'&&route==='/verify'){
 // Safe for iOS ChatGPT embedded browser: validation relies on one-use form nonce, not Origin/cookie.
 if(!await throttle(db,'verify:'+ip,15,now))return ui(429,'<p>Too many attempts. Retry in 10 minutes.</p>');
 const v=await body(req),nonceHash=await hash(v.csrf||'');
 const validForm=await db.prepare('DELETE FROM form_nonces WHERE nonce_hash=? AND expires>? RETURNING nonce_hash').bind(nonceHash,now).first();
 if(!validForm)return ui(403,'<p>Verification form expired. <a href="/verify">Try again</a>.</p>');
 const entered=String(v.code||'').trim().replace(/[^A-Z0-9]/gi,'').toUpperCase();
 if(!/^[A-Z2-9]{8}$/.test(entered))return ui(400,'<p>Invalid code. <a href="/verify">Try again</a>.</p>');
 const request=await db.prepare("UPDATE pair_requests SET status='approved' WHERE user_hash=? AND status='pending' AND expires>? RETURNING device_name,device_hash").bind(await hash(entered),now).first();
 if(!request)return ui(400,'<p>Incorrect or expired code. <a href="/verify">Try again</a>.</p>');
 const previousOwner=await owner(req,db,now);const ownerId=previousOwner||rand(20),deviceId=crypto.randomUUID();
 await db.batch([
 db.prepare('INSERT INTO devices(id,owner,name,created_at,last_seen) VALUES (?,?,?,?,0)').bind(deviceId,ownerId,request.device_name,now),
 db.prepare("UPDATE pair_requests SET device_id=? WHERE device_hash=? AND status='approved'").bind(deviceId,request.device_hash)
 ]);
 const session=rand(32);
 await db.prepare('INSERT INTO owner_sessions(token_hash,owner,expires) VALUES (?,?,?)').bind(await hash(session),ownerId,now+90*86400000).run();
 return ui(200,'<h2>✓ Device verified</h2><p>'+esc(request.device_name)+' was paired. Return to CMD and wait for the green <b>Connected</b> message.</p><a href="/devices">Your devices</a>',{'set-cookie':'__Host-astae_sid='+session+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000'});
}
if(method==='GET'&&route==='/api/devices'){
const who=await owner(req,db,now);if(!who)return j(401,{error:'login_required'});
const devices=await db.prepare('SELECT id,name,last_seen FROM devices WHERE owner=? ORDER BY created_at DESC LIMIT 50').bind(who).all();
return j(200,{devices:devices.results.map(d=>({id:d.id,name:d.name,connected:now-d.last_seen<60000,last_seen:d.last_seen}))});
}
if(method==='GET'&&route==='/devices'){
const who=await owner(req,db,now);if(!who)return ui(401,'<p>Pair a device to view your device list. <a href="/verify">Enter a code</a></p>');
const devices=await db.prepare('SELECT name,last_seen FROM devices WHERE owner=? ORDER BY created_at DESC LIMIT 50').bind(who).all();
return ui(200,'<h2>Your devices</h2>'+devices.results.map(d=>'<p><b>'+esc(d.name)+'</b> — '+(now-d.last_seen<60000?'🟢 Connected':'⚪ Offline')+'</p>').join('')+'<a href="/verify">Pair another device</a>');
}
return j(404,{error:'not_found'});
}catch(e){return j(e.status||500,{error:e.status===413?'body_too_large':'internal_error'});}
}};
