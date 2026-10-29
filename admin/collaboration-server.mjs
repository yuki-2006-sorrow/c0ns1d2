import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createCollaborationStore } from './collaboration-store.mjs';
import { serveVideo } from './media-response.mjs';
import { createCollaborationFrontend } from './collaboration-frontend.mjs';

const ROOT = resolve(process.env.COLLAB_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const PORT = Number(process.env.COLLAB_PORT || 4324);
const publicOrigin = process.env.COLLAB_PUBLIC_ORIGIN || '';
if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith('https://'))) throw new Error('远程入口必须是完整HTTPS来源地址');
const store = createCollaborationStore(ROOT);
const frontend=createCollaborationFrontend(ROOT,store);
const lock = join(store.directory,'server.lock');
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
const MIME={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.mp4':'video/mp4','.webm':'video/webm'};
const extensions={'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp','image/avif':'.avif','video/mp4':'.mp4','video/webm':'.webm'};
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; media-src 'self' https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  let url;
  try{
    const origins=allowedOrigin(req);
    if(!origins.some(origin=>new URL(origin).host===req.headers.host))return reply(res,403,{error:'访问地址未获允许'});
    url=new URL(req.url,'http://localhost');
    if(!['GET','HEAD','POST'].includes(req.method))return reply(res,405,{error:'请求方式不支持'});
    if(req.method==='POST' && (!origins.includes(req.headers.origin)||req.headers['x-archive-client']!=='1'))return reply(res,403,{error:'请求来源不正确，请从协作页面操作'});
    const path=url.pathname;
    if(path==='/api/health')return reply(res,200,{app:'c0ns1d2-collaboration',root:publicOrigin&&req.headers.host===new URL(publicOrigin).host?undefined:ROOT});
    if(['GET','HEAD'].includes(req.method)&&frontend.resource(req,res,path))return;
    if(path==='/bridge.css'||path==='/bridge-client.js'){
      res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});
      return res.end(req.method==='HEAD'?undefined:readFileSync(new URL(path.endsWith('.js')?'./collaboration-frontend.js':'./collaboration-frontend.css',import.meta.url)));
    }
    if(['GET','HEAD'].includes(req.method)&&/^\/(?:guest(?:\/.*)?|events(?:\/.*)?|works(?:\/.*)?|thoughts(?:\/.*)?|people(?:\/.*)?|timeline)?\/?$/.test(path)){
      const html=frontend.render(path,viewer(req,path==='/guest'||path.startsWith('/guest/')));
      if(html===null)return reply(res,404,{error:'记录不存在或无权查看'});
      const nonce=randomBytes(24).toString('base64');
      const policy="default-src 'self'; script-src 'self' 'nonce-"+nonce+"'; style-src 'self' 'nonce-"+nonce+"'; img-src 'self' https: data:; media-src 'self' https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
      res.setHeader('Content-Security-Policy',policy);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      return res.end(req.method==='HEAD'?undefined:html.replace(/<(script|style)\b([^>]*)>/g,(_,tag,attributes)=>'<'+tag+' nonce="'+nonce+'"'+attributes+'>'));
    }
    if(path==='/shared'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      return res.end(readFileSync(new URL('./collaboration.html',import.meta.url)));
    }
    if(path==='/app.js'||path==='/app.css'){
      res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});
      return res.end(readFileSync(new URL(path.endsWith('.js')?'./collaboration.js':'./collaboration.css',import.meta.url)));
    }
    if(path==='/api/status'&&req.method==='GET')return reply(res,200,{setup:store.isSetup(),...store.questions(),notice:'站主可查看本机保存的全部记录，包括私人记录。请在知悉此规则后加入。'});
    if(['/api/setup','/api/register','/api/login'].includes(path)&&req.method==='POST'){
      limit((req.socket.remoteAddress||'local')+':auth',180);
      const data=await json(req);
      limit((req.socket.remoteAddress||'local')+':'+path+':'+String(data.username||'').slice(0,40).toLowerCase());
      let user;
      if(path==='/api/setup'){
        if(publicOrigin&&req.headers.host===new URL(publicOrigin).host)return reply(res,403,{error:'请在站主电脑本机初始化'});
        user=store.setup(data,data.token);
      }else user=path==='/api/register'?store.register(data):store.login(data);
      cookie(req,res,user.id); return reply(res,200,{user});
    }
    if(path.startsWith('/api/media/')&&['GET','HEAD'].includes(req.method)){
      const media=store.mediaRead(viewer(req,url.searchParams.get('guest')==='1'),path.slice('/api/media/'.length));
      const target=join(store.directory,'media',media.id+media.extension);
      if(media.extension==='.mp4')return serveVideo(req,res,target);
      res.writeHead(200,{'Content-Type':MIME[media.extension]});
      if(req.method==='HEAD')return res.end();
      return createReadStream(target).on('error',()=>res.destroy()).pipe(res);
    }
    if(path==='/api/legacy-media'&&['GET','HEAD'].includes(req.method)){
      const entry=store.readEntry(viewer(req,url.searchParams.get('guest')==='1'),url.searchParams.get('id'));
      const reference=(url.searchParams.get('kind')==='video'?entry.videos:entry.images)[Number(url.searchParams.get('index'))];
      if(typeof reference!=='string'||!reference.startsWith('/photos/'))return reply(res,404,{error:'文件不存在'});
      const directory=resolve(ROOT,'public/photos'),target=resolve(ROOT,'public','.'+decodeURIComponent(reference));
      if(relative(directory,target).startsWith('..')||isAbsolute(relative(directory,target))||!existsSync(target))return reply(res,404,{error:'文件不存在'});
      const extension=Object.keys(MIME).find(ext=>target.toLowerCase().endsWith(ext));
      if(!extension)return reply(res,404,{error:'文件不存在'});
      if(extension==='.mp4')return serveVideo(req,res,target);
      res.writeHead(200,{'Content-Type':MIME[extension]});
      if(req.method==='HEAD')return res.end();
      return createReadStream(target).on('error',()=>res.destroy()).pipe(res);
    }
    const {user,token}=identify(req);
    if(path==='/api/me')return reply(res,200,store.profile(user.id));
    if(path==='/api/logout'&&req.method==='POST'){sessions.delete(token);res.setHeader('Set-Cookie',sessionCookieName()+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return reply(res,200,{ok:true});}
    if(path==='/api/entries'&&req.method==='GET')return reply(res,200,store.entries(user));
    if(path==='/api/entry'&&req.method==='POST')return reply(res,200,store.saveEntry(user,await json(req)));
    if(path==='/api/entry'&&req.method==='GET')return reply(res,200,store.readEntry(user,url.searchParams.get('id')));
    if(path==='/api/history'&&req.method==='GET')return reply(res,200,store.history(user,url.searchParams.get('id')));
    if(path==='/api/archive'&&req.method==='POST')return reply(res,200,store.archive(user,await json(req)));
    if(path==='/api/members'&&req.method==='GET')return reply(res,200,store.members(user));
    if(path==='/api/manage'&&req.method==='GET')return reply(res,200,store.ownerOverview(user));
    if(path==='/api/settings'&&req.method==='POST')return reply(res,200,store.configure(user,await json(req)));
    if(path==='/api/member'&&req.method==='POST'){
      const input=await json(req),result=store.updateMember(user,input);
      if(result.access==='blocked')for(const [key,session]of sessions)if(session.id===result.id)sessions.delete(key);
      return reply(res,200,result);
    }
    if(path==='/api/guest-access'&&req.method==='POST')return reply(res,200,store.setVisitorAccess(user,await json(req)));
    if(path==='/api/password'&&req.method==='POST'){
      const result=store.changePassword(user,await json(req));
      for(const [key,session]of sessions)if(session.id===result.id)sessions.delete(key);
      return reply(res,200,result);
    }
    if(path==='/api/upload'&&req.method==='POST'){
      if(!user.canCreate)return reply(res,403,{error:'尚未获得投稿资格'});
      const extension=extensions[req.headers['content-type']];
      if(!extension)return reply(res,400,{error:'请选择JPG、PNG、GIF、WebP、AVIF、MP4或WebM文件'});
      const id=randomUUID(),directory=join(store.directory,'media');
      mkdirSync(directory,{recursive:true});
      const target=join(directory,id+extension);
      let size=0;
      try{
        await pipeline(req,new Transform({transform(chunk,encoding,done){size+=chunk.length;done(size>500*1024*1024?new Error('单个文件不超过500MB'):null,chunk);}}),createWriteStream(target,{flags:'wx',mode:0o600}));
        store.mediaAdd(user,{id,extension,size,name:String(url.searchParams.get('name')||'附件').slice(0,200)});
      }catch(error){rmSync(target,{force:true});throw error;}
      return reply(res,200,{url:'/api/media/'+id});
    }
    reply(res,404,{error:'页面不存在'});
  }catch(error){if(!res.headersSent)reply(res,error.status||400,{error:error.message});else res.destroy();}
});
server.listen(PORT,'127.0.0.1',()=>console.log('Collaboration ready: http://127.0.0.1:'+server.address().port+'/shared'));
