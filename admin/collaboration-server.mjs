import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCollaborationStore } from './collaboration-store.mjs';
import {parseTimetable} from './timetable-import.mjs';
import {copyFileSync} from 'node:fs';
import {buildPersonalContext} from './personal-context.mjs';
import {createPersonalAI} from './personal-ai.mjs';

const ROOT = resolve(process.env.COLLAB_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const PORT = Number(process.env.COLLAB_PORT || 4324);
const remoteConfig=join(ROOT,'.local-collaboration/remote-access.json');
const publicOrigin = process.env.COLLAB_PUBLIC_ORIGIN || (existsSync(remoteConfig)?JSON.parse(readFileSync(remoteConfig,'utf8').replace(/^\uFEFF/,'')).origin:'') || '';
if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith('https://'))) throw new Error('远程入口必须是完整HTTPS来源地址');
const privateDirectory = join(ROOT, '.local-collaboration');
mkdirSync(privateDirectory, { recursive: true });
const lock = join(privateDirectory,'server.lock');
try {
  if(existsSync(lock)){
    const pid = Number(readFileSync(lock,'utf8'));
    let alive = false;
    try { process.kill(pid,0); alive=true; } catch(error) { if(error.code!=='ESRCH') throw error; }
    if(alive) throw new Error('协作后台已经运行');
    rmSync(lock);
  }
  const fd=openSync(lock,'wx',0o600); writeFileSync(fd,String(process.pid)); closeSync(fd);
} catch(error) { throw new Error('无法取得协作资料写入锁：'+error.message); }
process.on('exit',()=>{try{rmSync(lock);}catch{}});
// Acquire the exclusive writer lock before a storage migration can run.
const store = createCollaborationStore(ROOT);
const sessions = new Map(), attempts = new Map();
const allowedOrigin = req => {
  const local = ['http://127.0.0.1:' + server.address().port,'http://localhost:' + server.address().port];
  return [...local,...(publicOrigin?[publicOrigin]:[])];
};
function reply(res,status,data) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
async function json(req) {
  let size=0;const chunks=[];
  for await (const chunk of req) { size+=chunk.length; if(size>1024*1024) throw new Error('提交内容过大'); chunks.push(chunk); }
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!data||Array.isArray(data)||typeof data!=='object')throw new Error('提交内容格式不正确');
  return data;
}
function limit(key,maximum=12) {
  const now=Date.now(); for(const [id,record] of attempts)if(record.until<now)attempts.delete(id);
  const record=attempts.get(key)||{count:0,until:now+10*60*1000};
  if(++record.count>maximum) throw Object.assign(new Error('尝试次数过多，请10分钟后再试'),{status:429});
  attempts.set(key,record);
}
const sessionCookieName=()=> 'archive_session_'+server.address().port;
function identify(req) {
  const prefix=sessionCookieName()+'=';
  const token=req.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith(prefix))?.slice(prefix.length);
  const session=sessions.get(token);
  if(!session || session.until<Date.now()) {if(token)sessions.delete(token);throw Object.assign(new Error('请先登录；如果正在编辑，请先保留文字'),{status:401});}
  return { token, user:store.checkedUser(session.id) };
}
function viewer(req,forceGuest=false){
  if(forceGuest)return store.guest();
  try{return identify(req).user;}catch(error){if(error.status===401)return store.guest();throw error;}
}
function cookie(req,res,id) {
  for(const [token,session]of sessions)if(session.until<Date.now())sessions.delete(token);
  const token=randomBytes(32).toString('hex');
  sessions.set(token,{id,until:Date.now()+8*60*60*1000});
  res.setHeader('Set-Cookie',sessionCookieName()+'='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+(publicOrigin&&req.headers.host===new URL(publicOrigin).host?'; Secure':''));
}

const ai=createPersonalAI(privateDirectory),aiBusy=new Set();
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try{
  const origins=allowedOrigin(req),url=new URL(req.url,'http://localhost'),path=url.pathname;
  if(!origins.some(origin=>new URL(origin).host===req.headers.host))return reply(res,403,{error:'访问地址未获允许'});
  if(!['GET','HEAD','POST'].includes(req.method))return reply(res,405,{error:'请求方式不支持'});
  if(path==='/api/personal/capture'){
   if(req.method!=='POST')return reply(res,405,{error:'手机入口仅支持新增想法'});
   if(req.headers.origin&&!origins.includes(req.headers.origin))return reply(res,403,{error:'请求来源不正确'});
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(res,415,{error:'请使用JSON请求正文'});
   const match=/^Bearer (pc_[a-f0-9]{64})$/.exec(req.headers.authorization||'');if(!match)return reply(res,401,{error:'请使用手机专用凭证'});
   limit('phone-capture:'+req.socket.remoteAddress,120);return reply(res,200,store.personalCapture(match[1],await json(req)));
  }
  if(req.method==='POST'&&(!origins.includes(req.headers.origin)||req.headers['x-archive-client']!=='1'))return reply(res,403,{error:'请求来源不正确，请从个人空间操作'});
  if(path==='/api/health')return reply(res,200,{app:'c0ns1d2-collaboration',root:publicOrigin&&req.headers.host===new URL(publicOrigin).host?undefined:ROOT,storageVersion:publicOrigin&&req.headers.host===new URL(publicOrigin).host?undefined:store.schemaVersion()});
  const assets={'/personal-context.mjs':['personal-context.mjs','text/javascript'],'/personal-login.js':['collaboration.js','text/javascript'],'/personal.css':['personal.css','text/css'],'/personal.js':['personal.js','text/javascript'],'/app.css':['collaboration.css','text/css'],'/app.js':['collaboration.js','text/javascript'],'/minimal-system.css':['minimal-system.css','text/css']};
  if(assets[path]&&req.method!=='POST'){const [file,type]=assets[path];res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:readFileSync(new URL('./'+file,import.meta.url)));}
  if(path==='/shared'&&req.method!=='POST'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:readFileSync(new URL('./collaboration.html',import.meta.url)));}
  if(['/personal','/personal/plans','/personal/records','/personal/me'].includes(path)&&req.method!=='POST'){
   let user;try{user=identify(req).user;}catch(error){if(error.status===401){res.writeHead(303,{Location:'/shared?return=personal'});return res.end();}throw error;}
   store.personalRead(user);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:readFileSync(new URL('./personal.html',import.meta.url)));
  }
  if(!path.startsWith('/api/')){res.writeHead(303,{Location:'/personal'});return res.end();}
  if(path==='/api/status'&&req.method==='GET')return reply(res,200,{setup:store.isSetup(),private:true});
  if(['/api/setup','/api/login'].includes(path)&&req.method==='POST'){
   limit((req.socket.remoteAddress||'local')+':auth',180);const data=await json(req);
   limit((req.socket.remoteAddress||'local')+':'+path+':'+String(data.username||'').slice(0,40).toLowerCase());
   let user;
   if(path==='/api/setup'){if(publicOrigin&&req.headers.host===new URL(publicOrigin).host)return reply(res,403,{error:'请在本人电脑本机初始化'});user=store.setup(data,data.token);}else user=store.login(data);
   store.personalRead(user);cookie(req,res,user.id);return reply(res,200,{user});
  }
  const allowed=new Set(['/api/me','/api/logout','/api/password','/api/export','/api/personal','/api/personal/devices','/api/personal/ai','/api/personal/decompose','/api/personal/timetable']);
  if(!allowed.has(path))return reply(res,410,{error:'旧版共同创作功能已停用，请使用个人空间'});
  const {user,token}=identify(req);const personal=store.personalRead(user);
  if(path==='/api/me'&&req.method==='GET')return reply(res,200,store.profile(user.id));
  if(path==='/api/logout'&&req.method==='POST'){sessions.delete(token);res.setHeader('Set-Cookie',sessionCookieName()+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return reply(res,200,{ok:true});}
  if(path==='/api/password'&&req.method==='POST'){const result=store.changePassword(user,await json(req));for(const [key,session]of sessions)if(session.id===result.id)sessions.delete(key);return reply(res,200,result);}
  if(path==='/api/export'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="personal-space.json"');return reply(res,200,{version:1,exportedAt:new Date().toISOString(),personal});}
  if(path==='/api/personal'){if(req.method!=='POST')return reply(res,200,personal);const input=await json(req);if(input.action==='timetableImport')return reply(res,400,{error:'请通过课表导入入口上传源文件'});return reply(res,200,store.personalSave(user,input));}
  if(path==='/api/personal/timetable'&&req.method==='POST'){const input=await json(req);if(typeof input.file!=='string'||input.file.length>700000||!/^[-A-Za-z0-9+/=]+$/.test(input.file))return reply(res,400,{error:'课表文件编码不正确'});const snapshot=parseTimetable(Buffer.from(input.file,'base64'));if(input.action==='preview')return reply(res,200,{snapshot});if(input.action!=='import')return reply(res,400,{error:'导入操作不正确'});if(input.revision!==personal.revision)return reply(res,409,{error:'资料已更新，请读取最新进度后重新导入'});if(personal.timetables?.some(item=>item.sourceKey===snapshot.sourceKey&&item.sourceHash===snapshot.sourceHash))return reply(res,200,personal);mkdirSync(join(privateDirectory,'backups'),{recursive:true});copyFileSync(join(privateDirectory,'archive.json'),join(privateDirectory,'backups','before-timetable-'+Date.now()+'.json'));return reply(res,200,store.personalSave(user,{action:'timetableImport',revision:input.revision,snapshot}));}
  if(path==='/api/personal/devices')return reply(res,200,req.method==='POST'?store.personalDeviceSave(user,await json(req)):{devices:store.personalDevices(user)});
  if(path==='/api/personal/ai')return reply(res,200,req.method==='POST'?ai.save(await json(req)):ai.status());
  if(path==='/api/personal/decompose'&&req.method==='POST'){
   const input=await json(req),project=(personal.projects||[]).find(row=>row.id===input.projectId);if(!project)return reply(res,404,{error:'项目不存在'});
   if(aiBusy.has(user.id))return reply(res,429,{error:'正在拆解一个项目，请稍候'});
   limit('ai:'+user.id,20);aiBusy.add(user.id);
   try{return reply(res,200,{...await ai.decompose(project,input.context||'',buildPersonalContext(personal,project.id,{includeBackground:input.includeBackground===true,includeResources:input.includeResources===true})),projectId:project.id,projectUpdatedAt:project.updatedAt});}finally{aiBusy.delete(user.id);}
  }
  reply(res,405,{error:'请求方式不支持'});
 }catch(error){if(!res.headersSent)reply(res,error.status||400,{error:error.message});else res.destroy();}
});
server.listen(PORT,'127.0.0.1',()=>console.log('Collaboration ready: http://127.0.0.1:'+server.address().port+'/shared'));
