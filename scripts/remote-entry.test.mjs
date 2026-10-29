import test from 'node:test';
import assert from 'node:assert/strict';
import {createArchiveProxy} from '../deployment/pages-worker.mjs';
const configuration={upstream:'https://archive-test.trycloudflare.com',publicOrigin:'https://c0ns1d2.pages.dev'};
const page=path=>configuration.publicOrigin+path;

test('only explicitly listed fixed resources use Pages, preserving video ranges without forwarding cookies',async()=>{
  let forwarded=0,served=0;
  const proxy=createArchiveProxy({...configuration,staticAssets:['/intro/intro.mp4','/_astro/app.hash.js','/photos/private.jpg','/events/secret','/api/media/secret']},async()=>{forwarded++;return new Response('protected',{status:401});},{fetch:async request=>{
    served++;assert.equal(request.headers.get('Cookie'),null);assert.equal(request.headers.get('Authorization'),null);
    assert.equal(request.headers.get('Range'),'bytes=0-4');
    return new Response('video',{status:206,headers:{'Content-Type':'video/mp4','Content-Range':'bytes 0-4/20'}});
  }});
  const response=await proxy(new Request(page('/intro/intro.mp4'),{headers:{Range:'bytes=0-4',Cookie:'secret',Authorization:'secret'}}));
  assert.equal(response.status,206);assert.equal(response.headers.get('X-Archive-Gateway'),'static');assert.equal(response.headers.get('Content-Range'),'bytes 0-4/20');assert.equal(await response.text(),'video');assert.equal(forwarded,0);
  for(const path of ['/photos/private.jpg','/events/secret','/api/media/secret','/_astro/not-built.js','/collaboration-shell/home/'])assert.equal((await proxy(new Request(page(path)))).status,401);
  assert.equal(forwarded,5);assert.equal(served,1);
});

test('missing static files and HTML fallback never expose an old public page',async()=>{
  for(const response of [new Response('old content',{headers:{'Content-Type':'text/html'}}),new Response('missing',{status:404})]){
    const proxy=createArchiveProxy({...configuration,staticAssets:['/intro/intro.mp4']},async()=>{throw new Error('must not forward');},{fetch:async()=>response});
    assert.equal((await proxy(new Request(page('/intro/intro.mp4')))).status,503);
  }
});
test('gateway streams protected pages and range responses; never serves old static content',async()=>{
  let incoming;
  const proxy=createArchiveProxy(configuration,async request=>{incoming=request;return new Response('slice',{status:206,headers:{'Content-Range':'bytes 0-4/20','Set-Cookie':'archive_session_4324=test; HttpOnly; SameSite=Strict; Secure; Path=/','Cache-Control':'public'}});});
  const response=await proxy(new Request(page('/api/media/test?guest=1'),{headers:{Range:'bytes=0-4',Cookie:'archive_session_4324=test'}}));
  assert.equal(incoming.url,configuration.upstream+'/api/media/test?guest=1');assert.equal(incoming.headers.get('Range'),'bytes=0-4');assert.equal(incoming.headers.get('Cookie'),'archive_session_4324=test');
  assert.equal(response.status,206);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(response.headers.get('Set-Cookie').includes('Secure'));assert.equal(await response.text(),'slice');
});
test('gateway checks the browser origin before forwarding writes, preserves data and rejects preview bypasses',async()=>{
  let calls=0;
  const proxy=createArchiveProxy(configuration,async request=>{calls++;assert.equal(request.headers.get('Origin'),configuration.upstream);assert.equal(await request.text(),'original text');return new Response('{}',{headers:{'Content-Type':'application/json'}});});
  assert.equal((await proxy(new Request(page('/api/entry'),{method:'POST',headers:{Origin:'https://evil.example','X-Archive-Client':'1'},body:'original text'}))).status,403);
  assert.equal((await proxy(new Request(page('/api/entry'),{method:'POST',headers:{Origin:configuration.publicOrigin},body:'original text'}))).status,403);
  assert.equal((await proxy(new Request('https://preview.pages.dev/events/private'))).status,503);assert.equal(calls,0);
  assert.equal((await proxy(new Request(page('/api/entry'),{method:'POST',headers:{Origin:configuration.publicOrigin,'X-Archive-Client':'1'},body:'original text'}))).status,200);assert.equal(calls,1);
});
test('offline gateway fails closed and never falls back to the formerly public archive',async()=>{
  for(const forward of [async()=>{throw new Error('offline');},async()=>new Response('tunnel failed',{status:502}),async()=>new Response('',{status:302,headers:{Location:'https://evil.example'}})]){
    const response=await createArchiveProxy(configuration,forward)(new Request(page('/events/old-public-record')));
    assert.equal(response.status,503);assert.ok((await response.text()).includes('记忆库暂时离线'));assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
});

test('stalled reads end with a usable JSON error and a later request can recover',async()=>{
  let stalled=true;
  const proxy=createArchiveProxy(configuration,async request=>{
    if(!stalled)return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});
    return new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>reject(new Error('offline'))));
  },undefined,{readTimeoutMs:5});
  const response=await proxy(new Request(page('/api/entries')));
  assert.equal(response.status,503);assert.match(response.headers.get('Content-Type'),/application\/json/);
  assert.match((await response.json()).error,/当前输入仍保留/);
  stalled=false;assert.equal((await proxy(new Request(page('/api/entries')))).status,200);
});
