import test from 'node:test';
import assert from 'node:assert/strict';
import {createArchiveProxy} from '../deployment/pages-worker.mjs';
const configuration={upstream:'https://archive-test.trycloudflare.com',publicOrigin:'https://c0ns1d2.pages.dev'};
const page=path=>configuration.publicOrigin+path;
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
