const configuration = "__ARCHIVE_REMOTE_CONFIGURATION__";

const unavailable=()=>new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>记忆库暂时离线</title><body style="background:#101014;color:#d8c8b8;font:18px/1.9 sans-serif;padding:10vh 8vw"><h1>记忆库暂时离线</h1><p>站主的电脑或共享通道暂未连接，请稍后再来。</p></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Retry-After':'60','X-Content-Type-Options':'nosniff'}});

export function createArchiveProxy({upstream,publicOrigin},forward=fetch){
  const target=new URL(upstream),site=new URL(publicOrigin);
  if(target.origin!==upstream||target.protocol!=='https:'||!target.hostname.endsWith('.trycloudflare.com')||target.username||target.password||site.origin!==publicOrigin||site.protocol!=='https:')throw new Error('Invalid archive origin');
  return async request=>{
    const address=new URL(request.url);
    if(address.origin!==publicOrigin)return unavailable();
    if(!['GET','HEAD','POST'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD, POST','Cache-Control':'no-store'}});
    if(request.method==='POST'&&(request.headers.get('Origin')!==publicOrigin||request.headers.get('X-Archive-Client')!=='1'))return new Response('请求来源不正确',{status:403,headers:{'Cache-Control':'no-store'}});
    const destination=new URL(target);destination.pathname=address.pathname;destination.search=address.search;
    const headers=new Headers(request.headers);
    headers.delete('Host');headers.delete('Forwarded');headers.delete('X-Forwarded-Host');headers.delete('X-Forwarded-Proto');
    if(request.method==='POST')headers.set('Origin',upstream);
    try{
      const response=await forward(new Request(destination,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual',duplex:'half'}));
      if(response.status>=500)return unavailable();
      const returned=new Headers(response.headers);returned.set('Cache-Control','no-store');returned.set('X-Archive-Gateway','collaboration');
      const location=returned.get('Location');
      if(location){const redirect=new URL(location,upstream);if(redirect.origin!==upstream)return unavailable();returned.set('Location',publicOrigin+redirect.pathname+redirect.search+redirect.hash);}
      return new Response(request.method==='HEAD'?null:response.body,{status:response.status,statusText:response.statusText,headers:returned});
    }catch{return unavailable();}
  };
}
export default {fetch:request=>createArchiveProxy(configuration)(request)};
