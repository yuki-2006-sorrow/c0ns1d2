import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createCollaborationStore} from '../admin/collaboration-store.mjs';
import {timetableFixture} from './fixtures/timetable.mjs';

test('Shortcuts can append without a browser session; bearer tokens grant no read or management access',async()=>{
  const root=mkdtempSync(join(tmpdir(),'c0ns1d2-phone-'));
  const password='test-only-password-123';let child;
  try{
    const store=createCollaborationStore(root);
    const owner=store.checkedUser(store.setup({username:'owner',name:'测试站主',password},readFileSync(store.setupFile,'utf8')).id);
    store.configure(owner,{questions:[{text:'fixture',answers:['yes']}],threshold:1,defaultAccess:'all',defaultCreate:true});
    store.register({username:'reader',name:'其他账号',password,consent:true,answers:{[store.questions().questions[0].id]:'yes'}});
    child=spawn(process.execPath,[resolve('admin/collaboration-server.mjs')],{env:{...process.env,COLLAB_ROOT:root,COLLAB_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
    let origin;for(let i=0;i<150&&!origin;i++){origin=logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(!origin)await new Promise(resolve=>setTimeout(resolve,40));}assert.ok(origin,logs);
    const browserHeaders={'Content-Type':'application/json','X-Archive-Client':'1',Origin:origin};
    async function login(username){const response=await fetch(origin+'/api/login',{method:'POST',headers:browserHeaders,body:JSON.stringify({username,password})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];}
    const ownerCookie=await login('owner');
    assert.equal((await fetch(origin+'/api/personal/imports')).status,401);
    assert.equal((await fetch(origin+'/personal/import',{redirect:'manual'})).status,303);
    assert.equal((await fetch(origin+'/personal/import',{headers:{Cookie:ownerCookie}})).status,200);
    const imports=await fetch(origin+'/api/personal/imports',{headers:{Cookie:ownerCookie}});assert.equal(imports.status,200);assert.equal((await imports.json()).intervalSeconds,60);
    assert.equal((await fetch(origin+'/api/personal/imports',{method:'POST',headers:{...browserHeaders,Cookie:ownerCookie},body:'{}'})).status,202);
    const timetableFile=Buffer.from(timetableFixture()).toString('base64');
    const postTable=input=>fetch(origin+'/api/personal/timetable',{method:'POST',headers:{...browserHeaders,Cookie:ownerCookie},body:JSON.stringify(input)});
    const preview=await postTable({action:'preview',file:timetableFile});assert.equal(preview.status,200);assert.equal((await preview.json()).snapshot.courses.length,1);
    const before=await(await fetch(origin+'/api/personal',{headers:{Cookie:ownerCookie}})).json();assert.ok(!before.timetables);
    assert.equal((await postTable({action:'import',file:timetableFile,revision:'stale'})).status,409);
    const imported=await(await postTable({action:'import',file:timetableFile,revision:before.revision})).json();assert.equal(imported.timetables.length,1);
    const repeated=await(await postTable({action:'import',file:timetableFile,revision:imported.revision})).json();assert.equal(repeated.revision,imported.revision);
    assert.equal((await fetch(origin+'/api/personal',{method:'POST',headers:{...browserHeaders,Cookie:ownerCookie},body:JSON.stringify({action:'timetableImport',revision:imported.revision,snapshot:{}})})).status,400);
    assert.equal((await fetch(origin+'/api/login',{method:'POST',headers:browserHeaders,body:JSON.stringify({username:'reader',password})})).status,403);
    for(const path of ['/studio','/materials','/posts','/topics']){const retired=await fetch(origin+path,{redirect:'manual'});assert.equal(retired.status,303);assert.equal(retired.headers.get('Location'),'/personal');}
    for(const path of ['/api/posts','/api/materials','/api/register','/api/entries'])assert.equal((await fetch(origin+path)).status,410);
    assert.equal((await fetch(origin+'/personal/plans',{redirect:'manual'})).status,303);
    assert.equal((await fetch(origin+'/api/personal/ai')).status,401);
    const aiStatus=await(await fetch(origin+'/api/personal/ai',{headers:{Cookie:ownerCookie}})).json();assert.equal(aiStatus.configured,false);
    const config=await fetch(origin+'/api/personal/ai',{method:'POST',headers:{...browserHeaders,Cookie:ownerCookie},body:JSON.stringify({apiKey:'sk-test-only-1234567890',model:'deepseek-flash'})});
    assert.equal(config.status,200);assert.deepEqual(await config.json(),{configured:true,provider:'DeepSeek',model:'deepseek-flash'});
    const exported=await(await fetch(origin+'/api/export',{headers:{Cookie:ownerCookie}})).text();assert.ok(!exported.includes('sk-test-only'));
    const home=await fetch(origin+'/',{redirect:'manual',headers:{Cookie:ownerCookie}});assert.equal(home.status,303);assert.equal(home.headers.get('Location'),'/personal');
    const mint=await fetch(origin+'/api/personal/devices',{method:'POST',headers:{...browserHeaders,Cookie:ownerCookie},body:JSON.stringify({action:'create'})});assert.equal(mint.status,200);
    const {token,device}=await mint.json();
    const phoneHeaders={'Content-Type':'application/json',Authorization:'Bearer '+token};
    const capture=body=>fetch(origin+'/api/personal/capture',{method:'POST',headers:phoneHeaders,body:JSON.stringify(body)});
    for(const [input,error] of [
      [{},'未收到body字段，请将JSON左侧的键名重新输入为body'],
      [{'body ':'手机测试记录'},'未收到body字段，请将JSON左侧的键名重新输入为body'],
      [{body:{text:'手机测试记录'}},'body字段不是文本，请将该JSON字段的类型设为文本'],
      [{body:['手机测试记录']},'body字段不是文本，请将该JSON字段的类型设为文本'],
      [{body:' \n '},'body字段为空，请先确认听写结果有文字'],
      [{body:'字'.repeat(8001)},'想法超过8000字，请分成几条记录']
    ]){
      const rejected=await capture(input);assert.equal(rejected.status,400);
      assert.deepEqual(await rejected.json(),{error});
    }
    const response=await capture({body:'SIRI_PRIVATE_SENTENCE',requestId:'request-iphone-1'});assert.equal(response.status,200);
    const receipt=await response.json();assert.equal(receipt.ok,true);assert.ok(!JSON.stringify(receipt).includes('SIRI_PRIVATE_SENTENCE'));
    assert.equal((await(await capture({body:'SIRI_PRIVATE_SENTENCE',requestId:'request-iphone-1'})).json()).id,receipt.id);
    for(const path of ['/api/personal','/api/personal/devices','/api/personal/ai','/api/personal/imports','/api/export'])assert.equal((await fetch(origin+path,{headers:phoneHeaders})).status,401,path);
    assert.equal((await fetch(origin+'/api/personal/capture',{headers:phoneHeaders})).status,405);
    assert.equal((await fetch(origin+'/api/personal/capture',{method:'POST',headers:{'Content-Type':'application/json',Cookie:ownerCookie},body:JSON.stringify({body:'cookie cannot capture'})})).status,401);
    assert.equal((await fetch(origin+'/api/personal/capture',{method:'POST',headers:{...phoneHeaders,Origin:'https://evil.example'},body:JSON.stringify({body:'cross-origin'})})).status,403);
    assert.equal((await fetch(origin+'/api/personal',{method:'POST',headers:phoneHeaders,body:'{}'})).status,403);
    assert.equal((await fetch(origin+'/api/personal/devices',{method:'POST',headers:browserHeaders,body:JSON.stringify({action:'create'})})).status,401);
    const data=await(await fetch(origin+'/api/personal',{headers:{Cookie:ownerCookie}})).json();assert.equal(data.records.length,1);assert.equal(data.records[0].body,'SIRI_PRIVATE_SENTENCE');
    for(const path of ['/api/personal/devices','/api/export']){const body=await(await fetch(origin+path,{headers:{Cookie:ownerCookie}})).text();assert.ok(!body.includes(token));assert.ok(!body.includes('tokenHash'));}
    assert.ok(!JSON.stringify(createCollaborationStore(root).personalRead(owner)).includes(token));
    const revoke=await fetch(origin+'/api/personal/devices',{method:'POST',headers:{...browserHeaders,Cookie:ownerCookie},body:JSON.stringify({action:'revoke',id:device.id})});assert.equal(revoke.status,200);
    assert.equal((await capture({body:'revoked'})).status,401);
    const reloaded=createCollaborationStore(root);
    assert.equal(reloaded.personalRead(owner).records.length,1);
    assert.throws(()=>reloaded.personalCapture(token,{body:'revoked after restart'}),{status:401});
  }finally{if(child&&!child.killed){child.kill();await once(child,'exit').catch(()=>{});}assert.ok(basename(root).startsWith('c0ns1d2-phone-'));rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
