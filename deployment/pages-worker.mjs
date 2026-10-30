const configuration = "__ARCHIVE_REMOTE_CONFIGURATION__";

function videoResponse(request,response,headers,size){
  headers.set('Accept-Ranges','bytes');
  const range=request.headers.get('Range'),condition=request.headers.get('If-Range');
  const matches=!condition||(!condition.startsWith('W/')&&condition===response.headers.get('ETag'))||condition===response.headers.get('Last-Modified');
  if(response.status!==200||!range||!matches)return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
  const parsed=/^bytes=(\d*)-(\d*)$/.exec(range);
  let start=-1,end=size-1;
  if(parsed&&(parsed[1]||parsed[2])){start=parsed[1]?Number(parsed[1]):Math.max(0,size-Number(parsed[2]));if(parsed[1]&&parsed[2])end=Math.min(Number(parsed[2]),size-1);}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size){
    void response.body?.cancel().catch(()=>{});headers.set('Content-Range','bytes */'+size);headers.set('Content-Length','0');return new Response(null,{status:416,headers});
  }
  headers.delete('Content-Encoding');headers.set('Content-Range',`bytes ${start}-${end}/${size}`);headers.set('Content-Length',String(end-start+1));
  if(request.method==='HEAD')return new Response(null,{status:206,headers});
  const reader=response.body.getReader();let position=0;
  const body=new ReadableStream({
    async pull(controller){
      try{while(true){
        const {done,value}=await reader.read();if(done){controller.close();return;}
        const from=Math.max(0,start-position),to=Math.min(value.length,end-position+1);position+=value.length;
        if(to>from)controller.enqueue(value.subarray(from,to));
        if(position>end){controller.close();void reader.cancel().catch(()=>{});return;}
        if(to>from)return;
      }}catch(error){controller.error(error);void reader.cancel().catch(()=>{});}
    },
    cancel(reason){return reader.cancel(reason);}
  });
  return new Response(body,{status:206,headers});
}

const unavailable=(request)=>{
  const api=request&&new URL(request.url).pathname.startsWith('/api/');
  return new Response(api?JSON.stringify({error:'记忆库暂时离线或连接超时，请稍后重试。当前输入仍保留，请不要刷新编辑页。'}):'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>记忆库暂时离线</title><body style="background:#101014;color:#d8c8b8;font:18px/1.9 sans-serif;padding:10vh 8vw"><h1>记忆库暂时离线</h1><p>站主的电脑或共享通道暂未连接，请稍后再来。</p><a href="" style="color:#e1b89c">重新连接 →</a></body></html>',{status:503,headers:{'Content-Type':api?'application/json; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','Retry-After':'60','X-Content-Type-Options':'nosniff'}});
};

export function validateArchiveOrigins({upstream,publicOrigin,publicAliases=[]}){
  const approvedSites=new Set(['https://c0ns1d2.pages.dev','https://c0ns1d2.com','https://www.c0ns1d2.com']);
  if(!Array.isArray(publicAliases)||![publicOrigin,...publicAliases].every(origin=>approvedSites.has(origin)))throw new Error('Invalid archive public origin');
  const target=new URL(upstream);
  const quick=/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(upstream);
  if(!quick&&upstream!=='https://backend.c0ns1d2.com')throw new Error('Invalid archive upstream');
  return {target,origins:new Set([publicOrigin,...publicAliases])};
}

export function createArchiveProxy({upstream,publicOrigin,publicAliases=[],staticAssets=[],introSize=0},forward=fetch,assets,{readTimeoutMs=12000}={}){
  const {target,origins}=validateArchiveOrigins({upstream,publicOrigin,publicAliases});
  const publicFiles=new Set(staticAssets.filter(path=>/^\/_astro\/[a-zA-Z0-9_.-]+\.(?:js|css|woff2?|svg|png)$/.test(path)||/^\/intro\/(?:intro\.mp4|k[1-9]\.png)$/.test(path)||/^\/(?:app|bridge)\.css$|^\/(?:app|bridge-client)\.js$/.test(path)));
  return async request=>{
    const address=new URL(request.url);
    if(!origins.has(address.origin))return unavailable(request);
    if(!['GET','HEAD','POST'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD, POST','Cache-Control':'no-store'}});
    if(request.method==='POST'&&(request.headers.get('Origin')!==address.origin||request.headers.get('X-Archive-Client')!=='1'))return new Response('请求来源不正确',{status:403,headers:{'Cache-Control':'no-store'}});
    if(address.pathname==='/admin'&&['GET','HEAD'].includes(request.method))return new Response(null,{status:303,headers:{Location:'/shared?view=library','Cache-Control':'no-store'}});
    const offline=async()=>{
      const shell=['/','/guest','/guest/'].includes(address.pathname)?'/archive-entry.html':address.pathname==='/shared'?'/archive-shared.html':null;
      if(assets&&shell&&['GET','HEAD'].includes(request.method))try{
        const response=await assets.fetch(new Request(new URL(shell,address.origin),{method:request.method,headers:{Accept:'text/html'}}));
        if(response.status===200&&/text\/html/i.test(response.headers.get('Content-Type')||'')){
          const returned=new Headers(response.headers);returned.delete('Set-Cookie');returned.set('Cache-Control','no-store');returned.set('X-Archive-Gateway','entry');returned.set('X-Archive-Connection','offline');
          returned.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
          returned.set('X-Content-Type-Options','nosniff');
          return new Response(request.method==='HEAD'?null:response.body,{status:200,headers:returned});
        }
      }catch{}
      return unavailable(request);
    };
    // Only build-listed, content-free resources bypass the authenticated backend.
    // Never use ASSETS as a fallback for pages, photos or private API responses.
    if(assets&&['GET','HEAD'].includes(request.method)&&publicFiles.has(address.pathname)){
      try{
        const assetHeaders=new Headers(request.headers);assetHeaders.delete('Cookie');assetHeaders.delete('Authorization');
        if(address.pathname==='/intro/intro.mp4')assetHeaders.set('Accept-Encoding','identity');
        const response=await assets.fetch(new Request(request.url,{method:request.method,headers:assetHeaders,redirect:'manual'}));
        if(![200,206,304,416].includes(response.status)||/text\/html/i.test(response.headers.get('Content-Type')||''))return unavailable(request);
        const returned=new Headers(response.headers);returned.delete('Set-Cookie');
        returned.set('Cache-Control',address.pathname.startsWith('/_astro/')?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate');
        returned.set('X-Archive-Gateway','static');returned.set('X-Content-Type-Options','nosniff');
        if(address.pathname==='/intro/intro.mp4'&&Number.isSafeInteger(introSize)&&introSize>0)return videoResponse(request,response,returned,introSize);
        return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers:returned});
      }catch{return unavailable(request);}
    }
    const destination=new URL(target);destination.pathname=address.pathname;destination.search=address.search;
    const headers=new Headers(request.headers);
    headers.delete('Host');headers.delete('Forwarded');headers.delete('X-Forwarded-Host');headers.delete('X-Forwarded-Proto');
    if(request.method==='POST')headers.set('Origin',upstream);
    const controller=new AbortController();
    const cancel=()=>controller.abort();
    if(request.signal.aborted)cancel();else request.signal.addEventListener('abort',cancel,{once:true});
    // Bound waiting for read response headers. Uploads and writes are never retried.
    const timer=['GET','HEAD'].includes(request.method)?setTimeout(cancel,readTimeoutMs):null;
    try{
      const response=await forward(new Request(destination,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual',duplex:'half',signal:controller.signal}));
      if(response.status>=500)return offline();
      const returned=new Headers(response.headers);returned.set('Cache-Control','no-store');returned.set('X-Archive-Gateway','collaboration');
      const location=returned.get('Location');
      if(location){const redirect=new URL(location,upstream);if(redirect.origin!==upstream)return unavailable(request);returned.set('Location',address.origin+redirect.pathname+redirect.search+redirect.hash);}
      return new Response(request.method==='HEAD'?null:response.body,{status:response.status,statusText:response.statusText,headers:returned});
    }catch{return offline();}
    finally{if(timer!==null)clearTimeout(timer);request.signal.removeEventListener('abort',cancel);}
  };
}
export default {fetch:(request,env)=>createArchiveProxy(configuration,fetch,env?.ASSETS)(request)};
