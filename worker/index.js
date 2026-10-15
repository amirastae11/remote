
const json=(x,status=200,extra={})=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json","cache-control":"no-store",...extra}});
const rpc=(id,result)=>json({jsonrpc:"2.0",id,result});
const err=(id,code,message)=>json({jsonrpc:"2.0",id,error:{code,message}});
const defs=[
{name:"laptop_status",description:"Check online/offline status of the personal laptop agent.",inputSchema:{type:"object",properties:{}}},
{name:"list_directory",description:"Queue a directory listing under the explicitly allowed laptop root. Returns job_id.",inputSchema:{type:"object",properties:{path:{type:"string"}},required:["path"]}},
{name:"read_text_file",description:"Queue reading a UTF-8 text file (max 60 KB) within allowed laptop root.",inputSchema:{type:"object",properties:{path:{type:"string"}},required:["path"]}},
{name:"git_status",description:"Queue read-only git status, diff, or log within the allowed laptop root.",inputSchema:{type:"object",properties:{path:{type:"string"},mode:{type:"string",enum:["status","diff","log"]}},required:["path"]}},
{name:"write_text_file",description:"Queue an optional scoped write. Laptop agent must opt in with CHAYI_ALLOW_WRITE=1. Existing file requires explicit overwrite; creates backup.",inputSchema:{type:"object",properties:{path:{type:"string"},content:{type:"string"},overwrite:{type:"boolean"}},required:["path","content"]}},
{name:"job_result",description:"Get a queued operation's status and result.",inputSchema:{type:"object",properties:{job_id:{type:"string"}},required:["job_id"]}}
];
export class LaptopQueue {
constructor(ctx){this.ctx=ctx}
async fetch(req){
 const u=new URL(req.url),storage=this.ctx.storage;
 if(u.pathname==="/status"){const last=await storage.get("last_seen")||0;return json({online:Date.now()-last<25000,last_seen:last?new Date(last).toISOString():null});}
 if(u.pathname==="/poll"){let q=await storage.get("queue")||[];const job=q.shift()||null;await storage.put("last_seen",Date.now());if(job){await storage.put("queue",q);await storage.put("job:"+job.id,{state:"running",started_at:Date.now()});}return json({job});}
 if(u.pathname==="/enqueue"){const job=await req.json();const q=await storage.get("queue")||[];if(q.length>=20)return json({error:"Queue full"},429);q.push(job);await storage.put("queue",q);await storage.put("job:"+job.id,{state:"queued",started_at:Date.now()});return json({job_id:job.id,state:"queued"});}
 if(u.pathname==="/report"){const body=await req.json(),found=await storage.get("job:"+body.id);if(!found||found.state!=="running")return json({error:"Unknown job"},404);await storage.put("job:"+body.id,{state:"done",result:body.result,finished_at:Date.now()});return json({accepted:true});}
 if(u.pathname==="/result"){const id=u.searchParams.get("id")||"";if(!/^[a-f0-9-]{36}$/.test(id))return json({error:"Invalid ID"},400);const v=await storage.get("job:"+id);if(!v)return json({state:"not_found"});if(v.state!=="done"&&Date.now()-v.started_at>120000)return json({state:"timed_out"});return json(v);}
 return json({error:"Not found"},404);
}}
export default {async fetch(req,env){
const u=new URL(req.url);
if(u.pathname==="/health")return json({service:"chayi-laptop-remote",ready:true,version:"1.0.0"});
const agent=u.pathname.startsWith("/agent/");
if(!agent&&u.pathname!=="/mcp")return json({error:"Not found"},404);
const token=agent?env.AGENT_TOKEN:env.CLIENT_TOKEN;
if(!token||token.length<32||req.headers.get("Authorization")!=="Bearer "+token)return json({error:"Unauthorized"},401,{"www-authenticate":'Bearer realm="Chayi Remote"'});
const stub=env.LAPTOP_QUEUE.get(env.LAPTOP_QUEUE.idFromName("primary"));
if(agent){if(req.method!=="POST"||!["/agent/poll","/agent/report"].includes(u.pathname))return json({error:"Not found"},404);return stub.fetch("https://internal"+u.pathname.slice(6),{method:"POST",body:u.pathname==="/agent/poll"?"{}":await req.text()});}
if(req.method!=="POST")return json({error:"POST required"},405,{allow:"POST"});
let body;try{body=await req.json()}catch{return err(null,-32700,"Parse error")}
if(!body||body.jsonrpc!=="2.0")return err(body?.id??null,-32600,"Invalid JSON-RPC");
if(body.id===undefined||body.id===null)return new Response(null,{status:202});
if(body.method==="initialize")return rpc(body.id,{protocolVersion:"2025-06-18",capabilities:{tools:{listChanged:false}},serverInfo:{name:"chayi-laptop-remote",version:"1.0.0"}});
if(body.method==="ping")return rpc(body.id,{});
if(body.method==="tools/list")return rpc(body.id,{tools:defs});
if(body.method!=="tools/call")return err(body.id,-32601,"Unknown method");
const {name,arguments:args={}}=body.params||{};
if(!defs.some(t=>t.name===name))return err(body.id,-32602,"Unknown tool");
try{let v;
if(name==="laptop_status")v=await(await stub.fetch("https://internal/status")).json();
else if(name==="job_result"){if(typeof args.job_id!=="string")return err(body.id,-32602,"job_id required");v=await(await stub.fetch("https://internal/result?id="+encodeURIComponent(args.job_id))).json();}
else{if(typeof args.path!=="string"||args.path.length>512)return err(body.id,-32602,"Valid path required");
if(name==="write_text_file"&&(typeof args.content!=="string"||args.content.length>32000))return err(body.id,-32602,"Invalid content");
const job={id:crypto.randomUUID(),name,args};v=await(await stub.fetch("https://internal/enqueue",{method:"POST",body:JSON.stringify(job)})).json();}
return rpc(body.id,{content:[{type:"text",text:JSON.stringify(v)}]});
}catch{return rpc(body.id,{isError:true,content:[{type:"text",text:"Remote request failed"}]});}
}};