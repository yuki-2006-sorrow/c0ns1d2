import { isCreator } from './post-store.mjs';
import { renderGallery,renderPost,renderMaterials,renderDrafts } from './post-pages.mjs';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createCollaborationStore } from './collaboration-store.mjs';
import { serveVideo } from './media-response.mjs';
import { remoteImage } from './remote-image.mjs';
import { createCollaborationFrontend } from './collaboration-frontend.mjs';

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
const frontend=createCollaborationFrontend(ROOT,store);
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
const MIME={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.m4a':'audio/mp4'};
const extensions={'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp','image/avif':'.avif','video/mp4':'.mp4','video/webm':'.webm','audio/mpeg':'.mp3','audio/ogg':'.ogg','audio/wav':'.wav','audio/mp4':'.m4a'};
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
    const path=url.pathname;
    // This append-only endpoint uses its own bearer credential, never a login cookie.
    if(path==='/api/personal/capture'){
      if(req.method!=='POST')return reply(res,405,{error:'手机入口仅支持新增想法'});
      if(req.headers.origin&&!origins.includes(req.headers.origin))return reply(res,403,{error:'请求来源不正确'});
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(res,415,{error:'请使用JSON请求正文'});
      const match=/^Bearer (pc_[a-f0-9]{64})$/.exec(req.headers.authorization||'');
      if(!match)return reply(res,401,{error:'请使用手机专用凭证'});
      limit('phone-capture:'+req.socket.remoteAddress,120);
      return reply(res,200,store.personalCapture(match[1],await json(req)));
    }
    if(req.method==='POST' && (!origins.includes(req.headers.origin)||req.headers['x-archive-client']!=='1'))return reply(res,403,{error:'请求来源不正确，请从协作页面操作'});
    if(path==='/admin'&&['GET','HEAD'].includes(req.method)){res.writeHead(303,{Location:'/shared?view=library'});return res.end();}
    const requireCreator=user=>{if(!isCreator(user))throw Object.assign(new Error('只有创作者可以访问素材库'),{status:403});return user;};
    const creativeAssets={'/personal.css':['personal.css','text/css'],'/personal.js':['personal.js','text/javascript'],'/intro-entry.js':['intro-entry.js','text/javascript'],'/intro-controller.js':['../src/scripts/intro-controller.js','text/javascript'],'/minimal-system.css':['minimal-system.css','text/css'],'/post-pages.css':['post-pages.css','text/css'],'/materials.js':['materials.js','text/javascript'],'/post-studio.css':['post-studio.css','text/css'],'/post-studio.js':['post-studio.js','text/javascript'],'/post-studio-model.mjs':['post-studio-model.mjs','text/javascript']};
    if(creativeAssets[path]){const [file,type]=creativeAssets[path];res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:readFileSync(new URL('./'+file,import.meta.url)));}
    if(path==='/api/personal'){const user=identify(req).user;return reply(res,200,req.method==='POST'?store.personalSave(user,await json(req)):store.personalRead(user));}
    if(path==='/api/personal/devices'){const user=identify(req).user;return reply(res,200,req.method==='POST'?store.personalDeviceSave(user,await json(req)):{devices:store.personalDevices(user)});}
    if(['/personal','/personal/records','/personal/me'].includes(path)){
      let user;try{user=identify(req).user;}catch(error){if(error.status===401){res.writeHead(303,{Location:'/shared?return=personal'});return res.end();}throw error;}
      store.personalRead(user);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:readFileSync(new URL('./personal.html',import.meta.url)));
    }
    if(path==='/studio'||path==='/materials'||path==='/drafts'){
      const user=requireCreator(identify(req).user);
      const html=path==='/studio'?readFileSync(new URL('./post-studio.html',import.meta.url),'utf8').replace('<body>','<body data-connected="true">').replace('交互原型','创作者工作区').replace('示例素材 · 仅保存在此浏览器','共享素材 · 版本保存').replace('这是协作流程预览。此处记录你在当前浏览器的修改和留言；多人实时同步尚未接入。','受邀创作者共同编排帖子。保存会核对版本；他人保存后需重新打开帖子载入新版本。').replace('href="/topics"','href="/"'):path==='/materials'?renderMaterials(user):renderDrafts(store,user);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:html);
    }
    if((path==='/'||path==='/guest'||path==='/posts'||path.startsWith('/posts/'))&&['GET','HEAD'].includes(req.method)){
      const user=viewer(req,path==='/guest');
      if(path==='/'&&user.role==='owner'){res.writeHead(303,{Location:'/personal'});return res.end();}
      const html=path.startsWith('/posts/')?renderPost(store,user,path.slice(7)):renderGallery(store,user);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:html);
    }
    if(path==='/api/posts'&&req.method==='GET'){
      if(url.searchParams.get('edit')==='1')return reply(res,200,store.editPost(identify(req).user,url.searchParams.get('id')));
      return reply(res,200,url.searchParams.has('id')?store.readPost(viewer(req),url.searchParams.get('id')):store.listPosts(viewer(req)));
    }
    if((path.startsWith('/api/post-media/')||path.startsWith('/api/post-draft-media/'))&&['GET','HEAD'].includes(req.method)){
      const draft=path.startsWith('/api/post-draft-media/');const parts=path.slice(draft?22:16).split('/');if(parts.length!==2||!/^\d+$/.test(parts[1]))return reply(res,404,{error:'文件不存在'});
      const asset=store.postAsset(parts[0],Number(parts[1]),draft?identify(req).user:undefined,draft);
      if(asset.reference.startsWith('https://')){if(new URL(asset.reference).hostname==='aka.doubaocdn.com'){const image=await remoteImage(store.directory,asset.reference);res.writeHead(200,{'Content-Type':image.type,'Content-Length':image.bytes.length});return res.end(req.method==='HEAD'?undefined:image.bytes);}res.writeHead(302,{Location:asset.reference});return res.end();}
      let target,extension;
      if(asset.media){target=join(store.directory,'media',asset.media.id+asset.media.extension);extension=asset.media.extension;}
      else if(asset.reference.startsWith('/photos/')){const directory=resolve(ROOT,'public/photos');target=resolve(ROOT,'public','.'+decodeURIComponent(asset.reference));if(relative(directory,target).startsWith('..')||isAbsolute(relative(directory,target)))return reply(res,404,{error:'文件不存在'});extension=Object.keys(MIME).find(ext=>target.toLowerCase().endsWith(ext));}
      if(!target||!extension||!existsSync(target))return reply(res,404,{error:'文件不存在'});
      if(MIME[extension]?.startsWith('video/')||MIME[extension]?.startsWith('audio/'))return serveVideo(req,res,target,MIME[extension]);
      res.writeHead(200,{'Content-Type':MIME[extension]});if(req.method==='HEAD')return res.end();return createReadStream(target).on('error',()=>res.destroy()).pipe(res);
    }
    if(path==='/api/health')return reply(res,200,{app:'c0ns1d2-collaboration',root:publicOrigin&&req.headers.host===new URL(publicOrigin).host?undefined:ROOT,storageVersion:publicOrigin&&req.headers.host===new URL(publicOrigin).host?undefined:store.schemaVersion(),publicOrigin:publicOrigin&&req.headers.host===new URL(publicOrigin).host?undefined:publicOrigin});
    if(['GET','HEAD'].includes(req.method)&&frontend.resource(req,res,path))return;
    if(path==='/bridge.css'||path==='/bridge-client.js'){
      res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});
      return res.end(req.method==='HEAD'?undefined:readFileSync(new URL(path.endsWith('.js')?'./collaboration-frontend.js':'./collaboration-frontend.css',import.meta.url)));
    }
    if(['GET','HEAD'].includes(req.method)&&/^\/(?:guest(?:\/.*)?|topics(?:\/.*)?|events(?:\/.*)?|works(?:\/.*)?|thoughts(?:\/.*)?|people(?:\/.*)?|timeline)?\/?$/.test(path)){
      const browsingUser=viewer(req,path.startsWith('/guest'));
      if(!isCreator(browsingUser)){if(/^\/(?:guest\/)?(?:events|works|thoughts|people)\//.test(path))return reply(res,404,{error:'素材仅供创作者查看'});res.writeHead(303,{Location:'/'});return res.end();}
      const html=frontend.render(path,browsingUser);
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
    if(path==='/api/remote-image'&&['GET','HEAD'].includes(req.method)){
      const entry=store.readEntry(requireCreator(viewer(req,url.searchParams.get('guest')==='1')),url.searchParams.get('id'));
      const image=await remoteImage(store.directory,entry.images[Number(url.searchParams.get('index'))]);
      res.writeHead(200,{'Content-Type':image.type,'Content-Length':image.bytes.length});
      return res.end(req.method==='HEAD'?undefined:image.bytes);
    }
    if(path.startsWith('/api/media/')&&['GET','HEAD'].includes(req.method)){
      const media=store.mediaRead(requireCreator(viewer(req,url.searchParams.get('guest')==='1')),path.slice('/api/media/'.length));
      const target=join(store.directory,'media',media.id+media.extension);
      if(MIME[media.extension]?.startsWith('video/')||MIME[media.extension]?.startsWith('audio/'))return serveVideo(req,res,target,MIME[media.extension]);
      res.writeHead(200,{'Content-Type':MIME[media.extension]});
      if(req.method==='HEAD')return res.end();
      return createReadStream(target).on('error',()=>res.destroy()).pipe(res);
    }
    if(path==='/api/legacy-media'&&['GET','HEAD'].includes(req.method)){
      const entry=store.readEntry(requireCreator(viewer(req,url.searchParams.get('guest')==='1')),url.searchParams.get('id'));
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
    if(path==='/api/materials'&&req.method==='GET')return reply(res,200,store.materialLibrary(user));
    if(path==='/api/drafts'&&req.method==='GET')return reply(res,200,store.drafts(user));
    if(path==='/api/posts'&&req.method==='POST')return reply(res,200,store.savePost(user,await json(req)));
    if(path==='/api/post-comments'&&req.method==='POST')return reply(res,200,store.commentPost(user,await json(req)));
    if(['/api/entries','/api/entry','/api/catalog','/api/history','/api/archive','/api/archive-batch','/api/upload'].includes(path))requireCreator(user);
    if(path==='/api/guest-access')return reply(res,410,{error:'原始素材不再直接对访客开放，请在剪辑台发布帖子'});
    if(path==='/api/me')return reply(res,200,store.profile(user.id));
    if(path==='/api/logout'&&req.method==='POST'){sessions.delete(token);res.setHeader('Set-Cookie',sessionCookieName()+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return reply(res,200,{ok:true});}
    if(path==='/api/entries'&&req.method==='GET')return reply(res,200,store.entries(user));
    if(path==='/api/catalog'&&req.method==='GET')return reply(res,200,store.catalog(user));
    if(path==='/api/catalog'&&req.method==='POST')return reply(res,200,store.saveCatalog(user,await json(req)));
    if(path==='/api/archive-batch'&&req.method==='POST')return reply(res,200,store.archiveBatch(user,await json(req)));
    if(path==='/api/export'&&req.method==='GET'){
      const data=store.exportContent(user);
      res.setHeader('Content-Disposition','attachment; filename="c0ns1d2-content.json"');
      return reply(res,200,data);
    }
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
