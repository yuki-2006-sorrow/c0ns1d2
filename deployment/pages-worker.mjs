const configuration = "__ARCHIVE_REMOTE_CONFIGURATION__";

const unavailable=(request)=>{
  const api=request&&new URL(request.url).pathname.startsWith('/api/');
  return new Response(api?JSON.stringify({error:'记忆库暂时离线或连接超时，请稍后重试。当前输入仍保留，请不要刷新编辑页。'}):'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>记忆库暂时离线</title><body style="background:#101014;color:#d8c8b8;font:18px/1.9 sans-serif;padding:10vh 8vw"><h1>记忆库暂时离线</h1><p>站主的电脑或共享通道暂未连接，请稍后再来。</p><a href="" style="color:#e1b89c">重新连接 →</a></body></html>',{status:503,headers:{'Content-Type':api?'application/json; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','Retry-After':'60','X-Content-Type-Options':'nosniff'}});
};

export function createArchiveProxy({upstream,publicOrigin,staticAssets=[]},forward=fetch,assets,{readTimeoutMs=12000}={}){
  const target=new URL(upstream),site=new URL(publicOrigin);
  const publicFiles=new Set(staticAssets.filter(path=>/^\/_astro\/[a-zA-Z0-9_.-]+\.(?:js|css|woff2?|svg|png)$/.test(path)||/^\/intro\/(?:intro\.mp4|k[1-9]\.png)$/.test(path)||/^\/(?:app|bridge)\.css$|^\/(?:app|bridge-client)\.js$/.test(path)));
  if(target.origin!==upstream||target.protocol!=='https:'||!target.hostname.endsWith('.trycloudflare.com')||target.username||target.password||site.origin!==publicOrigin||site.protocol!=='https:')throw new Error('Invalid archive origin');
  return async request=>{
    const address=new URL(request.url);
    if(address.origin!==publicOrigin)return unavailable(request);
    if(!['GET','HEAD','POST'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD, POST','Cache-Control':'no-store'}});
    if(request.method==='POST'&&(request.headers.get('Origin')!==publicOrigin||request.headers.get('X-Archive-Client')!=='1'))return new Response('请求来源不正确',{status:403,headers:{'Cache-Control':'no-store'}});
    // Only build-listed, content-free resources bypass the authenticated backend.
    // Never use ASSETS as a fallback for pages, photos or private API responses.
    if(assets&&['GET','HEAD'].includes(request.method)&&publicFiles.has(address.pathname)){
      try{
        const assetHeaders=new Headers(request.headers);assetHeaders.delete('Cookie');assetHeaders.delete('Authorization');
        const response=await assets.fetch(new Request(request.url,{method:request.method,headers:assetHeaders,redirect:'manual'}));
        if(![200,206,304,416].includes(response.status)||/text\/html/i.test(response.headers.get('Content-Type')||''))return unavailable(request);
        const returned=new Headers(response.headers);returned.delete('Set-Cookie');
        returned.set('Cache-Control',address.pathname.startsWith('/_astro/')?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate');
        returned.set('X-Archive-Gateway','static');returned.set('X-Content-Type-Options','nosniff');
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
      if(response.status>=500)return unavailable(request);
      const returned=new Headers(response.headers);returned.set('Cache-Control','no-store');returned.set('X-Archive-Gateway','collaboration');
      const location=returned.get('Location');
      if(location){const redirect=new URL(location,upstream);if(redirect.origin!==upstream)return unavailable(request);returned.set('Location',publicOrigin+redirect.pathname+redirect.search+redirect.hash);}
      return new Response(request.method==='HEAD'?null:response.body,{status:response.status,statusText:response.statusText,headers:returned});
    }catch{return unavailable(request);}
    finally{if(timer!==null)clearTimeout(timer);request.signal.removeEventListener('abort',cancel);}
  };
}
export default {fetch:(request,env)=>createArchiveProxy(configuration,fetch,env?.ASSETS)(request)};
