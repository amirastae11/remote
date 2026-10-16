import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const HOME = os.homedir();
export const DEFAULT_RELAY = 'https://astae-remote-relay-production.up.railway.app';
export const SESSION_FILE = path.join(HOME, '.astae-remote-cli', 'session.json');
export const SHARED_ROOT = path.join(HOME, 'AstaeRemote');
export const LEGACY_STATUS_FILE = path.join(HOME, '.astae-remote', 'relay_agent.json');

// Compatibility check only; never reads agent_auth.json or exports existing credentials.
export async function legacyAgentStatus(relay, file=LEGACY_STATUS_FILE, now=Date.now()) {
  try {
    const status = JSON.parse(await fs.readFile(file,'utf8'));
    const lastSeen = Number(status.last_seen||0)*1000;
    const matching = relayURL(status.relay_url) === relayURL(relay);
    const ageSeconds = Math.max(0,Math.floor((now-lastSeen)/1000));
    return {configured:status.configured===true, connected:matching&&status.connected===true&&ageSeconds<90,
      ageSeconds, agentId:String(status.agent_id||''), version:String(status.version||''), source:'local-agent-heartbeat'};
  } catch { return null; }
}


export function relayURL(raw) {
  const uri = new URL(raw);
  if (uri.username || uri.password || uri.search || uri.hash || (uri.protocol !== 'https:' && !(uri.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)))) {
    throw new Error('Relay URL must be HTTPS (HTTP allowed only for loopback development) without credentials or query');
  }
  if (uri.pathname!=='/' && !/^\/[A-Za-z0-9_-]+\/$/.test(uri.pathname)) throw new Error('Invalid relay path; use / or /prefix/');
  return uri.origin+(uri.pathname==='/'?'':uri.pathname);
}

export async function api(relay, method, endpoint, data, token, timeoutMs=8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {'accept':'application/json'};
    if (data !== undefined) headers['content-type'] = 'application/json';
    if (token) headers['authorization'] = `Bearer ${token}`;
    const response = await fetch(new URL(endpoint.replace(/^\//,''), relayURL(relay)+'/'), {
      method, headers, body: data === undefined ? undefined : JSON.stringify(data),
      signal: controller.signal, redirect: 'error',
    });
    let json;
    try { json = await response.json(); } catch { json = {}; }
    if (!response.ok) {
      const e = new Error(`HTTP ${response.status} ${String(json.error||'request_failed').slice(0,80)}`);
      e.status = response.status; e.code = json.error; throw e;
    }
    return json;
  } finally { clearTimeout(timer); }
}

export async function loadSession(file=SESSION_FILE) {
  try {
    const s = JSON.parse(await fs.readFile(file,'utf8'));
    if (!s || typeof s.access_token !== 'string' || typeof s.relay !== 'string') return null;
    return s;
  } catch (e) { if (e.code==='ENOENT') return null; throw e; }
}
export async function saveSession(session, file=SESSION_FILE) {
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(session,null,2), {mode:0o600,flag:'wx'});
    await fs.rename(temp,file);
    if (process.platform!=='win32') await fs.chmod(file,0o600);
  } finally { await fs.rm(temp,{force:true}).catch(()=>{}); }
}

export const wait = (ms) => new Promise(resolve=>setTimeout(resolve,ms));

export async function deviceAuthorize(relay, {deviceName=os.hostname(), show, openBrowser=async()=>{}, poll=api, sleep=wait}={}) {
  const init = await poll(relay,'POST','/device/authorization',{
    device_name: deviceName, client_type:'astae-remote-cli', capabilities:['ping','system_info','read_file']
  });
  if (!init.device_code || !init.user_code || !init.verification_uri) throw new Error('Device authorization unsupported by this Relay version');
  const verification = new URL(init.verification_uri);
  if (verification.origin !== new URL(relay).origin || verification.protocol !== new URL(relay).protocol) throw new Error('Untrusted verification URL');
  if (show) show(init.user_code,verification.href);
  await openBrowser(verification.href);
  const timeout = Date.now() + Math.min(900,Math.max(30, Number(init.expires_in)||600))*1000;
  let interval = Math.max(3,Math.min(15,Number(init.interval)||5));
  while (Date.now()<timeout) {
    await sleep(interval*1000);
    try {
      const t = await poll(relay,'POST','/device/token',{grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:init.device_code});
      if (t.access_token && t.device_id) return t;
      throw new Error('Invalid device token response');
    } catch(e) {
      if (e.code==='authorization_pending') continue;
      if (e.code==='slow_down') {interval=Math.min(30,interval+5);continue;}
      if (e.code==='access_denied') throw new Error('Device authorization denied by account owner');
      if (e.code==='expired_token') throw new Error('Device code expired');
      // Keep showing the same code across intermittent network failures. Never auto-authorize.
      if ([408, 429, 500, 502, 503, 504].includes(e.status) || (!e.status && /aborted|aborterror|timeout|fetch failed|network/i.test(String(e.message||e.name)))) continue;
      throw e;
    }
  }
  throw new Error('Device code expired');
}

export async function safeReadFile(root, target) {
  await fs.mkdir(root,{recursive:true,mode:0o700});
  if (typeof target !== 'string' || path.isAbsolute(target) || target.includes('\0')) throw new Error('Denied: expected a relative file path');
  const base = await fs.realpath(root);
  const full = await fs.realpath(path.resolve(base,target));
  if (!full.startsWith(base + path.sep)) throw new Error('Denied: path is outside the shared folder');
  const stat=await fs.stat(full);
  if (!stat.isFile() || stat.size > 64*1024) throw new Error('Denied: not a file or exceeds 64 KiB');
  return await fs.readFile(full,'utf8');
}

export async function executeSafeJob(job,root=SHARED_ROOT) {
  if (!job || typeof job !== 'object' || typeof job.tool !== 'string') throw new Error('Invalid job');
  if (job.tool==='ping') return {ok:true,pong:true};
  if (job.tool==='system_info') return {platform:process.platform,arch:process.arch,node:process.version,host:os.hostname()};
  if (job.tool==='read_file') return {content:await safeReadFile(root,job.arguments?.path)};
  throw new Error('Unsupported tool: refusing shell, write or unrestricted command');
}

export async function refreshIfNecessary(relay,session){
  if (!session.refresh_token || !session.expires_at || session.expires_at>Date.now()+60_000) return session;
  const refreshed=await api(relay,'POST','/device/token',{grant_type:'refresh_token',refresh_token:session.refresh_token});
  return {...session,...refreshed,relay,expires_at:Date.now()+Number(refreshed.expires_in||3600)*1000};
}
