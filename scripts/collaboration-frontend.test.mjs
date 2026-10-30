import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createCollaborationStore } from '../admin/collaboration-store.mjs';
import {createPublicEntry} from './public-entry.mjs';
import {verifyMainEntryBrowser} from './verify-main-entry-browser.mjs';

const password='fixture-password-12345';
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'c0ns1d2-collab-front-'));
  assert.ok(existsSync('dist/collaboration-shell/home/index.html'),'Run npm run build before the frontend checks');
  cpSync('dist/collaboration-shell',join(root,'dist/collaboration-shell'),{recursive:true});
  cpSync('dist/_astro',join(root,'dist/_astro'),{recursive:true});
  mkdirSync(join(root,'src/content/events'),{recursive:true});
  mkdirSync(join(root,'public/photos'),{recursive:true});
  mkdirSync(join(root,'src/content/people'),{recursive:true});
  writeFileSync(join(root,'src/content/people/test-person.md'),'---\nname: 测试人物\n---\nPROFILE_PRIVATE_971\n');
  writeFileSync(join(root,'src/content/events/imported.md'),'---\ntitle: IMPORTED_SECRET\ndate: 2025\nmajor: true\npersons: []\ndraft: false\nimages: ["/photos/imported.png"]\n---\nImported body\n');
  writeFileSync(join(root,'public/photos/imported.png'),'test-image');
  const store=createCollaborationStore(root);
  const owner=store.checkedUser(store.setup({username:'owner',name:'测试站主',password},readFileSync(store.setupFile,'utf8')).id);
  store.configure(owner,{questions:[{text:'test',answers:['yes']}],threshold:1,defaultAccess:'all',defaultCreate:true});
  const member=store.checkedUser(store.register({username:'alice',name:'测试成员',password,consent:true,answers:{[store.questions().questions[0].id]:'yes'}}).id);
  return {root,store,owner,member};
}
const entry=(extra={})=>({title:'Visible $& <script>alert(1)</script>',date:'2026-02-03',type:'event',body:'正文 **加粗**\n\n<script>window.leaked=true</script>\n\n[危险链接](javascript:alert(1))',scope:'members',published:true,major:true,images:[],videos:[],...extra});
function cleanup(root){assert.ok(basename(root).startsWith('c0ns1d2-collab-front-'));rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}

test('guest publishing is explicit, owner-only and follows linked endpoints, author changes and attachments',()=>{
  const {root,store,owner,member}=fixture();
  try{
    const guest=store.guest();
    assert.deepEqual(store.entries(guest),[],'existing content is never automatically guest-visible');
    const record=store.saveEntry(member,entry({visitorVisible:true}));
    assert.equal(record.visitorVisible,false,'members cannot publish to anonymous guests');
    assert.throws(()=>store.setVisitorAccess(member,{id:record.id,revision:record.revision,visible:true}),/站主/);
    const privateRecord=store.saveEntry(member,entry({scope:'private'}));
    assert.throws(()=>store.setVisitorAccess(owner,{id:privateRecord.id,revision:privateRecord.revision,visible:true}),/共同内容/);
    const thought=store.saveEntry(member,entry({type:'thought',fromId:record.id}));
    assert.throws(()=>store.setVisitorAccess(owner,{id:thought.id,revision:thought.revision,visible:true}),/先向访客/);
    const visible=store.setVisitorAccess(owner,{id:record.id,revision:record.revision,visible:true});
    const linked=store.setVisitorAccess(owner,{id:thought.id,revision:thought.revision,visible:true});
    assert.equal(store.entries(guest).length,2);
    assert.throws(()=>store.setVisitorAccess(owner,{id:record.id,revision:record.revision,visible:false}),/已更新/);
    const changed=store.saveEntry(member,{...visible,body:'成员后续修改'});
    assert.equal(changed.visitorVisible,false,'editing cannot silently replace a reviewed guest publication');
    assert.equal(store.entries(guest).length,0,'linked thought closes when its source closes');
    store.setVisitorAccess(owner,{id:changed.id,revision:changed.revision,visible:true});
    assert.equal(store.readEntry(guest,linked.id).id,linked.id);
  }finally{cleanup(root);}
});

test('real frontend routes contain only readable records; media and guest preview enforce the same boundary',async()=>{
  const {root,store,owner,member}=fixture();
  let child;
  try{
    const mediaId=randomUUID();
    store.mediaAdd(member,{id:mediaId,extension:'.png',name:'照片',size:10});
    mkdirSync(join(store.directory,'media'),{recursive:true});writeFileSync(join(store.directory,'media',mediaId+'.png'),'test-photo');
    const record=store.saveEntry(member,entry({images:['/api/media/'+mediaId],persons:['测试人物']}));
    const secret=store.saveEntry(owner,entry({title:'PRIVATE_TOKEN_984',body:'PRIVATE_BODY_192',scope:'private'}));
    const targeted=store.saveEntry(owner,entry({title:'TARGETED_TOKEN_642',scope:'selected',recipients:[member.id]}));
    const visible=store.setVisitorAccess(owner,{id:record.id,revision:record.revision,visible:true});
    child=spawn(process.execPath,[resolve('admin/collaboration-server.mjs')],{env:{...process.env,COLLAB_ROOT:root,COLLAB_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
    let origin;
    for(let i=0;i<150&&!origin;i++){origin=logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(!origin)await new Promise(resolve=>setTimeout(resolve,40));}
    assert.ok(origin,logs);
    const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'X-Archive-Client':'1','Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})});
    const cookie=login.headers.get('set-cookie').split(';')[0];assert.equal(login.status,200);
    assert.ok(cookie.startsWith('archive_session_'+new URL(origin).port+'='),'separate localhost services must not overwrite each other’s session cookie');
    for(const path of ['/','/guest','/events','/guest/events','/timeline','/guest/timeline','/works','/thoughts','/events/'+visible.id,'/guest/events/'+visible.id]){
      const response=await fetch(origin+path);assert.equal(response.status,200,path);
      const html=await response.text();
      for(const token of ['PRIVATE_TOKEN_984','PRIVATE_BODY_192','TARGETED_TOKEN_642','IMPORTED_SECRET','PROFILE_PRIVATE_971'])assert.ok(!html.includes(token),path+' leaked '+token);
      assert.ok(!html.includes('<script>alert(1)</script>'),path+' escaped title');
      assert.ok(response.headers.get('content-security-policy').includes("'nonce-"));
      if(path.includes('/events/')){assert.ok(html.includes('<strong>加粗</strong>'));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('<title>Visible $&amp; &lt;script&gt;'));}
    }
    for(const path of ['/events/'+secret.id,'/events/'+targeted.id,'/events/imported','/photos/imported.png','/dist/events/imported/index.html','/collaboration-shell/home','/api/entries']){
      assert.ok([401,404].includes((await fetch(origin+path)).status),path+' must not bypass permissions');
    }
    assert.equal((await fetch(origin+'/api/media/'+mediaId)).status,200);
    const ownerHtml=await(await fetch(origin+'/events',{headers:{Cookie:cookie}})).text();assert.ok(ownerHtml.includes('PRIVATE_TOKEN_984'));
    const ownerHome=await(await fetch(origin+'/',{headers:{Cookie:cookie}})).text();
    for(const link of ['/thoughts','/timeline','/shared?new=event','/shared?new=work','/shared?new=thought','/shared?view=manage'])assert.ok(ownerHome.includes('href="'+link+'"'),link);
    const guestHome=await(await fetch(origin+'/')).text();
    assert.ok(guestHome.includes('/shared?join=1&amp;return=home'));assert.ok(!guestHome.includes('/shared?new=event'));assert.ok(!guestHome.includes('/shared?view=manage'));
    const offlineHome=createPublicEntry(root);
    assert.ok(offlineHome.includes('共享资料暂时离线'));assert.ok(offlineHome.includes('id="introVideo"'));
    for(const token of ['PRIVATE_TOKEN_984','IMPORTED_SECRET','Visible $&amp;','PROFILE_PRIVATE_971'])assert.ok(!offlineHome.includes(token),'empty offline shell leaked '+token);
    const oldAdmin=await fetch(origin+'/admin',{redirect:'manual'});assert.equal(oldAdmin.status,303);assert.equal(oldAdmin.headers.get('Location'),'/shared?view=library');
    assert.equal((await fetch(origin+'/people/test-person')).status,404);
    assert.equal((await fetch(origin+'/guest/people/test-person',{headers:{Cookie:cookie}})).status,404);
    const profile=await fetch(origin+'/people/test-person',{headers:{Cookie:cookie}});assert.equal(profile.status,200);assert.ok((await profile.text()).includes('PROFILE_PRIVATE_971'));
    const forcedGuest=await(await fetch(origin+'/guest/events',{headers:{Cookie:cookie}})).text();assert.ok(!forcedGuest.includes('PRIVATE_TOKEN_984'));
    const revoke=await fetch(origin+'/api/guest-access',{method:'POST',headers:{Origin:origin,'X-Archive-Client':'1','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({id:visible.id,revision:visible.revision,visible:false})});
    assert.equal(revoke.status,200);
    assert.equal((await fetch(origin+'/events/'+visible.id)).status,404);
    assert.equal((await fetch(origin+'/api/media/'+mediaId)).status,404);
    assert.equal((await fetch(origin+'/api/media/'+mediaId+'?guest=1',{headers:{Cookie:cookie}})).status,404);
    const imported=store.entries(owner).find(e=>e.source==='imported.md');
    assert.equal((await fetch(origin+'/api/legacy-media?id='+imported.id+'&index=0')).status,404);
    const openLegacy=await fetch(origin+'/api/guest-access',{method:'POST',headers:{Origin:origin,'X-Archive-Client':'1','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({id:imported.id,revision:imported.revision,visible:true})});
    assert.equal(openLegacy.status,200);
    assert.equal((await fetch(origin+'/api/legacy-media?id='+imported.id+'&index=0')).status,200,'legacy photos inherit explicit guest permission');
    if(process.env.CHECK_MAIN_BROWSER==='1')await verifyMainEntryBrowser(root,origin,password);
  }finally{
    if(child){child.kill();await once(child,'exit');}
    cleanup(root);
  }
});
