import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { createCollaborationStore } from '../admin/collaboration-store.mjs';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'c0ns1d2-collab-'));
  mkdirSync(join(root,'src/content/events'),{recursive:true});
  for(const [name,draft]of [['public',false],['private',true]])writeFileSync(join(root,'src/content/events',name+'.md'),'---\ntitle: '+name+'\ndate: 2026-01-01\npersons: []\ndraft: '+draft+'\n---\n原始文字\n');
  return root;
}
function cleanup(root){assert.ok(basename(root).startsWith('c0ns1d2-collab-'));rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
const password='test-password-12345';
function ownerSetup(store){return store.checkedUser(store.setup({username:'owner',name:'站主',password},readFileSync(store.setupFile,'utf8')).id);}
function configure(store,owner){
  store.configure(owner,{questions:[{text:'第一题',answers:['测试','TEST']}],threshold:1,defaultAccess:'all',defaultCreate:true});
}
function register(store,name){
  const questions=store.questions();
  return store.checkedUser(store.register({username:name,name,password,answers:{[questions.questions[0].id]:' ＴＥＳＴ '},consent:true,role:'owner',access:'all'}).id);
}
const makeEntry=(user,title='记忆')=>({title,date:'2026',body:'署名原文',type:'event',published:true,scope:'members',recipients:[],images:[],videos:[]});

test('setup is single-use; answers are secret; automatic admission accepts configured aliases',()=>{
  const root=fixture();
  try{
    const store=createCollaborationStore(root);
    assert.throws(()=>store.setup({username:'owner',name:'站主',password},'wrong'),/凭据/);
    const owner=ownerSetup(store);configure(store,owner);
    assert.ok(!existsSync(store.setupFile));
    assert.throws(()=>store.setup({},''),/已建立/);
    assert.ok(!JSON.stringify(store.questions()).includes('hashes'));
    assert.throws(()=>store.register({username:'bad',name:'bad',password,consent:true,answers:{}}),/通过条件/);
    assert.throws(()=>store.register({username:'bad',name:'bad',password,answers:{}}),/加入说明/);
    const user=register(store,'alice');
    const thought=store.saveEntry(user,{...makeEntry(user),title:'',body:'标题留空也可以先写想法',type:'thought',published:false});
    assert.equal(thought.title,'标题留空也可以先写想法');
    assert.equal(user.role,'member');
    assert.equal(store.entries(user).filter(entry=>entry.type==='event').length,1,'existing draft is private');
    assert.equal(readFileSync(join(root,'src/content/events/public.md'),'utf8').includes('原始文字'),true);
    assert.equal(store.login({username:'alice',password}).id,user.id);
    assert.throws(()=>store.login({username:'alice',password:'wrong'}),/不正确/);
    const source=readFileSync(join(store.directory,'archive.json'),'utf8');
    assert.ok(!source.includes(password));assert.ok(!source.includes('"TEST"'));
  }finally{cleanup(root);}
});

test('authorship, targeted sharing, full/common access, revocation and grants remain independent',()=>{
  const root=fixture();
  try{
    const store=createCollaborationStore(root),owner=ownerSetup(store);configure(store,owner);
    const a=register(store,'alice'),b=register(store,'bob'),c=register(store,'carol');
    const privateEntry=store.saveEntry(a,{...makeEntry(a),scope:'private'});
    const targeted=store.saveEntry(a,{...makeEntry(a),scope:'selected',recipients:[b.id]});
    const common=store.saveEntry(a,makeEntry(a));
    const linked=store.saveEntry(a,{...makeEntry(a,'从私人记忆出发的想法'),type:'thought',fromId:privateEntry.id});
    assert.throws(()=>store.readEntry(b,linked.id),/无权/,'shared thought cannot reveal its private origin');
    assert.throws(()=>store.readEntry(c,privateEntry.id),/无权/);
    assert.throws(()=>store.readEntry(c,targeted.id),/无权/);
    assert.equal(store.readEntry(b,targeted.id).title,'记忆');
    assert.throws(()=>store.saveEntry(b,{...common,body:'覆盖作者'}),/只能修改/);
    assert.throws(()=>store.saveEntry(owner,{...common,body:'站主重写'}),/只能修改/);
    assert.throws(()=>store.saveEntry(a,{...common,revision:''}),/已更新/);
    const updated=store.saveEntry(a,{...common,body:'新版'});
    assert.throws(()=>store.saveEntry(a,{...common,body:'旧窗口覆盖'}),/已更新/);
    assert.equal(store.history(a,common.id)[0].entry.body,'署名原文');
    assert.throws(()=>store.history(b,common.id),/只有作者/);
    store.updateMember(owner,{id:b.id,access:'selected',canCreate:false,grants:[]});
    assert.throws(()=>store.readEntry(b,common.id),/无权/);
    assert.equal(store.readEntry(b,targeted.id).id,targeted.id);
    assert.throws(()=>store.saveEntry(b,makeEntry(b)),/投稿资格/);
    store.updateMember(owner,{id:b.id,access:'selected',grants:[common.id],canCreate:true});
    assert.equal(store.readEntry(b,common.id).body,'新版');
    assert.throws(()=>store.updateMember(b,{id:a.id,access:'blocked'}),/站主/);
    store.archive(a,{id:common.id,revision:updated.revision,archived:true});
    assert.throws(()=>store.readEntry(b,common.id),/无权/);
    const archived=store.ownerOverview(owner).archived[0];
    store.archive(owner,{id:common.id,revision:archived.revision,archived:false});
    assert.equal(store.readEntry(b,common.id).body,'新版');
    const moderated=store.readEntry(owner,common.id);
    store.archive(owner,{id:common.id,revision:moderated.revision,archived:true});
    const removed=store.ownerOverview(owner).archived.find(e=>e.id===common.id);
    assert.throws(()=>store.archive(a,{id:common.id,revision:removed.revision,archived:false}),/只能由站主/);
    assert.throws(()=>store.archive(a,{id:common.id,revision:removed.revision,archived:true}),/只能由站主/,'re-archiving must not replace the moderator');
    store.archive(owner,{id:common.id,revision:removed.revision,archived:false});
    store.updateMember(owner,{id:b.id,access:'blocked'});
    assert.throws(()=>store.checkedUser(b.id),/未获准/);
  }finally{cleanup(root);}
});

test('attachments inherit entry sharing; password reset and disk reload preserve ownership',()=>{
  const root=fixture();
  try{
    const store=createCollaborationStore(root),owner=ownerSetup(store);configure(store,owner);
    const a=register(store,'alice'),b=register(store,'bob');
    const media=store.mediaAdd(a,{id:'test-media',extension:'.png',name:'照片'});
    assert.throws(()=>store.mediaRead(b,media.id),/无权/);
    const entry=store.saveEntry(a,{...makeEntry(a),scope:'selected',recipients:[b.id],images:['/api/media/'+media.id]});
    assert.equal(store.mediaRead(b,media.id).owner,a.id);
    assert.throws(()=>store.saveEntry(b,{...makeEntry(b),images:['/api/media/'+media.id]}),/自己上传/);
    store.saveEntry(a,{...entry,scope:'private'});
    assert.throws(()=>store.mediaRead(b,media.id),/无权/);
    store.changePassword(owner,{id:a.id,password:'a-new-password-12345'});
    assert.throws(()=>store.login({username:a.username,password}),/不正确/);
    const reloaded=createCollaborationStore(root);
    assert.equal(reloaded.login({username:a.username,password:'a-new-password-12345'}).id,a.id);
    assert.equal(reloaded.entries(reloaded.checkedUser(a.id)).find(e=>e.id===entry.id).author,a.id);
  }finally{cleanup(root);}
});

test('HTTP blocks unauthenticated reads, cross-origin posts, unsafe hosts and revoked sessions',async()=>{
  const root=fixture();
  mkdirSync(join(root,'.local-collaboration'),{recursive:true});
  const remoteOrigin='https://remote-test.trycloudflare.com';
  writeFileSync(join(root,'.local-collaboration/remote-access.json'),'\uFEFF'+JSON.stringify({origin:remoteOrigin}));
  const child=spawn(process.execPath,[resolve('admin/collaboration-server.mjs')],{env:{...process.env,COLLAB_ROOT:root,COLLAB_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
  const until=async check=>{for(let i=0;i<150;i++){const result=await check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('timeout '+logs);};
  try{
    const origin=await until(()=>logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]);
    const remote=async(path,body,cookie='')=>new Promise((resolve,reject)=>{
      const call=request(origin+path,{method:body===undefined?'GET':'POST',headers:{Host:new URL(remoteOrigin).host,Origin:remoteOrigin,'X-Archive-Client':'1','Content-Type':'application/json',Cookie:cookie}},response=>{
        let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,data:JSON.parse(text)}));
      });call.on('error',reject);call.end(body===undefined?undefined:JSON.stringify(body));
    });
    assert.equal((await remote('/api/setup',{})).status,403,'remote callers cannot initialize the owner');
    assert.equal((await remote('/api/health')).data.root,undefined,'remote health never reveals the filesystem path');
    let cookie='';
    const post=async(path,body,extra={})=>{const response=await fetch(origin+path,{method:'POST',headers:{Origin:origin,'X-Archive-Client':'1','Content-Type':'application/json',Cookie:cookie,...extra},body:JSON.stringify(body)});const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];return {status:response.status,data:await response.json()};};
    assert.equal((await fetch(origin+'/api/entries')).status,401);
    const adminEntry=await fetch(origin+'/admin',{redirect:'manual'});
    assert.equal(adminEntry.status,303);assert.equal(adminEntry.headers.get('Location'),'/shared?view=library');
    assert.equal((await post('/api/setup',{}, {Origin:'https://evil.example'})).status,403);
    const token=readFileSync(join(root,'.local-collaboration/setup-token'),'utf8');
    assert.equal((await post('/api/setup',{username:'owner',name:'站主',password,token})).status,200);
    const remoteLogin=await remote('/api/login',{username:'owner',password});
    assert.equal(remoteLogin.status,200);assert.ok(remoteLogin.headers['set-cookie'][0].includes('; Secure'));
    assert.equal((await remote('/api/entries',undefined,remoteLogin.headers['set-cookie'][0].split(';')[0])).status,200);
    assert.equal((await fetch(origin+'/api/entries',{headers:{Cookie:cookie}})).status,200);
    const badHostStatus=await new Promise((resolve,reject)=>{const call=request(origin+'/api/entries',{headers:{Host:'evil.example',Cookie:cookie}},response=>{response.resume();resolve(response.statusCode);});call.on('error',reject);call.end();});
    assert.equal(badHostStatus,403);
    const ownerCookie=cookie;
    await post('/api/settings',{questions:[{text:'题目',answers:['答案']}],threshold:1,defaultAccess:'all',defaultCreate:true});
    const status=await(await fetch(origin+'/api/status')).json();
    assert.ok(!JSON.stringify(status).includes('答案'));
    cookie='';
    const admitted=await post('/api/register',{username:'alice',name:'Alice',password,consent:true,answers:{[status.questions[0].id]:'答案'}});
    assert.equal(admitted.status,200);
    const memberCookie=cookie;
    for(let i=0;i<39;i++){
      cookie='';const joined=await post('/api/register',{username:'member_'+i,name:'成员'+i,password,consent:true,answers:{[status.questions[0].id]:'答案'}});
      assert.equal(joined.status,200,'40 people can join without sharing an account');
    }
    cookie=memberCookie;
    assert.equal((await fetch(origin+'/api/manage',{headers:{Cookie:cookie}})).status,403);
    cookie=ownerCookie;
    await post('/api/member',{id:admitted.data.user.id,access:'blocked'});
    assert.equal((await fetch(origin+'/api/entries',{headers:{Cookie:memberCookie}})).status,401);
    cookie='';
    for(let i=0;i<12;i++)await post('/api/login',{username:'missing',password:'wrong'});
    assert.equal((await post('/api/login',{username:'missing',password:'wrong'})).status,429);
  }finally{
    child.kill();await once(child,'exit');cleanup(root);
  }
});
