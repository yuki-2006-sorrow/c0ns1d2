import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createCollaborationStore } from '../admin/collaboration-store.mjs';
import { createCollaborationFrontend } from '../admin/collaboration-frontend.mjs';
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

test('topics combine all record types and descendants without revealing private groups or records',()=>{
  const {root,store,owner,member}=fixture();
  try{
    const topic=store.saveCatalog(owner,{kind:'group',title:'共同专题',parent:''});
    const child=store.saveCatalog(owner,{kind:'group',title:'专题里的作品',parent:topic.slug});
    const grandchild=store.saveCatalog(owner,{kind:'group',title:'后来的随想',parent:child.slug});
    const hidden=store.saveCatalog(owner,{kind:'group',title:'PRIVATE_TOPIC_NAME_971',parent:''});
    const empty=store.saveCatalog(owner,{kind:'group',title:'新建的空专题',parent:''});
    const visible=[];
    for(const values of [
      {title:'同一专题的经历',type:'event',medium:topic.slug},
      {title:'同一专题的一部电影',type:'work',kind:'film',medium:child.slug},
      {title:'同一专题的一点想法',type:'thought',medium:grandchild.slug},
      {title:'尚未归类的记录',type:'event',medium:''},
    ]){
      const record=store.saveEntry(member,entry(values));
      visible.push(store.setVisitorAccess(owner,{id:record.id,revision:record.revision,visible:true}));
    }
    store.saveEntry(owner,entry({title:'PRIVATE_TOPIC_RECORD_158',medium:hidden.slug,scope:'private'}));
    store.saveEntry(owner,entry({title:'PRIVATE_DESCENDANT_265',medium:grandchild.slug,scope:'private'}));
    const frontend=createCollaborationFrontend(root,store);
    for(const viewer of [member,store.guest()]){
      const prefix=viewer.role==='guest'?'/guest':'';
      const index=frontend.render(prefix+'/topics',viewer);
      assert.ok(index.includes('共同专题'));
      assert.ok(index.includes('3 条记录'),'root topic count includes descendants of every type');
      assert.ok(!index.includes('新建的空专题'));
      const detail=frontend.render(prefix+'/topics/'+topic.slug,viewer);
      for(const record of visible.slice(0,3))assert.ok(detail.includes(record.title),record.title);
      assert.ok(!detail.includes('尚未归类的记录'));
      for(const token of ['PRIVATE_TOPIC_NAME_971','PRIVATE_TOPIC_RECORD_158','PRIVATE_DESCENDANT_265']){
        assert.ok(!index.includes(token));assert.ok(!detail.includes(token));
      }
      assert.equal(frontend.render(prefix+'/topics/'+hidden.slug,viewer),null);
      assert.equal(frontend.render(prefix+'/topics/'+empty.slug,viewer),null);
      const nested=frontend.render(prefix+'/topics/'+child.slug,viewer);
      assert.ok(nested.includes('同一专题的一部电影')&&nested.includes('同一专题的一点想法'));
      assert.ok(!nested.includes('同一专题的经历'));
      const unfiled=frontend.render(prefix+'/topics/_unfiled',viewer);
      assert.ok(unfiled.includes('尚未归类的记录')&&!unfiled.includes('同一专题的一部电影'));
      const reading=frontend.render(prefix+'/works/'+visible[1].id,viewer);
      assert.ok(reading.includes('href="'+prefix+'/topics/'+child.slug+'"'));
      assert.ok(!reading.includes('bridge-thought-form'),'one topic writing entry replaces extra quick-note forms');
      for(const route of ['/events','/works','/thoughts'])assert.ok(frontend.render(prefix+route,viewer).includes('<h1>专题</h1>'));
    }
    const memberDetail=frontend.render('/topics/'+child.slug,member);
    assert.ok(memberDetail.includes('href="/shared?new=event&amp;topic='+child.slug+'"'));
    assert.ok(frontend.render('/topics',owner).includes('href="/shared?view=topic-new"'));
    assert.ok(frontend.render('/topics',owner).includes('新建的空专题'));
    assert.ok(frontend.render('/topics/'+empty.slug,owner).includes('这里还没有记录'));
  }finally{cleanup(root);}
});

test('a real topic named _unfiled remains distinct from unfiled records',()=>{
  const {root,store,owner}=fixture();
  try{
    const records=[entry({id:'reserved-topic-record',authorName:'测试站主',medium:'_unfiled',title:'命名冲突的专题记录'}),entry({id:'unfiled-record',authorName:'测试站主',medium:'',title:'真正未归类的记录'})];
    const frontend=createCollaborationFrontend(root,{entries:()=>records,catalog:()=>({groups:[{slug:'_unfiled',title:'真实专题'}],people:[]})});
    assert.ok(frontend.render('/topics',owner).includes('href="/topics/_group/_unfiled"'));
    const named=frontend.render('/topics/_group/_unfiled',owner);
    assert.ok(named.includes('命名冲突的专题记录')&&!named.includes('真正未归类的记录'));
    const unfiled=frontend.render('/topics/_unfiled',owner);
    assert.ok(unfiled.includes('真正未归类的记录')&&!unfiled.includes('命名冲突的专题记录'));
  }finally{cleanup(root);}
});

test('public works expose selected published content while all legacy raw material routes require creator access',async()=>{
 const {root,store,owner,member}=fixture();let child;
 try{
  const mediaId=randomUUID();store.mediaAdd(owner,{id:mediaId,extension:'.png',name:'原图',size:10});mkdirSync(join(store.directory,'media'),{recursive:true});writeFileSync(join(store.directory,'media',mediaId+'.png'),'test-photo');
  const source=store.saveEntry(owner,entry({title:'RAW_PRIVATE_TITLE',body:'SELECTED_SENTENCE 未采用聊天 PRIVATE_REMAINDER',scope:'private',images:['/api/media/'+mediaId]}));
  const legacy=store.saveEntry(owner,entry({title:'OLD_PUBLIC_RAW_SECRET',visitorVisible:true}));
  const post=store.savePost(owner,{title:'公开成品',subtitle:'导语',clips:[{id:'text',sourceId:source.id,kind:'text',text:'SELECTED_SENTENCE'},{id:'image',sourceId:source.id,kind:'image',mediaRef:'/api/media/'+mediaId}],action:'publish'});
  store.updateMember(owner,{id:member.id,access:'all',canCreate:false});
  child=spawn(process.execPath,[resolve('admin/collaboration-server.mjs')],{env:{...process.env,COLLAB_ROOT:root,COLLAB_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);let origin;for(let i=0;i<150&&!origin;i++){origin=logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(!origin)await new Promise(resolve=>setTimeout(resolve,40));}assert.ok(origin,logs);
  const login=async username=>{const response=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'X-Archive-Client':'1','Content-Type':'application/json'},body:JSON.stringify({username,password})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
  const ownerCookie=await login('owner'),readerCookie=await login('alice');
  for(const path of ['/','/guest','/posts/'+post.id,'/api/posts','/api/posts?id='+post.id]){const response=await fetch(origin+path);assert.equal(response.status,200,path);const body=await response.text();for(const secret of ['RAW_PRIVATE_TITLE','PRIVATE_REMAINDER','OLD_PUBLIC_RAW_SECRET',source.id])assert.ok(!body.includes(secret),path+' leaked '+secret);}
  for(const cookie of ['',readerCookie])for(const path of ['/materials','/studio','/api/materials','/api/entries','/api/entry?id='+source.id,'/api/media/'+mediaId,'/api/legacy-media?id='+source.id+'&index=0','/events/'+source.id,'/events/'+legacy.id,'/api/entry?id='+legacy.id,'/api/posts?edit=1&id='+post.id,'/api/post-draft-media/'+post.id+'/1']){const response=await fetch(origin+path,{headers:cookie?{Cookie:cookie}:{}});assert.ok([401,403,404].includes(response.status),path+' exposed raw material');}
  assert.equal((await fetch(origin+'/api/materials',{headers:{Cookie:ownerCookie}})).status,200);assert.equal((await fetch(origin+'/studio',{headers:{Cookie:ownerCookie}})).status,200);
  const published=await(await fetch(origin+'/api/posts?id='+post.id)).json();assert.equal(published.blocks[0].text,'SELECTED_SENTENCE');assert.equal(await(await fetch(origin+published.blocks[1].media)).text(),'test-photo');
  const withdraw=await fetch(origin+'/api/posts',{method:'POST',headers:{Origin:origin,'X-Archive-Client':'1','Content-Type':'application/json',Cookie:ownerCookie},body:JSON.stringify({id:post.id,revision:post.revision,title:post.title,clips:[],action:'unpublish'})});assert.equal(withdraw.status,200);assert.equal((await fetch(origin+published.blocks[1].media)).status,404);
 }finally{if(child&&!child.killed){child.kill();await once(child,'exit').catch(()=>{});}cleanup(root);}
});
