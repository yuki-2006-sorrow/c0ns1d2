import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createCollaborationStore } from '../admin/collaboration-store.mjs';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'c0ns1d2-unified-'));
  for(const folder of ['events','people','mediums'])mkdirSync(join(root,'src/content',folder),{recursive:true});
  writeFileSync(join(root,'src/content/events/test.md'),'---\ntitle: 原记忆\ndate: 2026\ndraft: false\nmedium: group\nsource: auto\nquotes: [原话]\npersons: [人物]\n---\n原正文');
  writeFileSync(join(root,'src/content/mediums/group.md'),'---\ntitle: 原分组\nparent: ""\n---\n');
  writeFileSync(join(root,'src/content/people/person.md'),'---\nname: 人物\nnickname: 原昵称\npersonality: {openness: 60}\n---\n原侧写');
  const store=createCollaborationStore(root);
  const owner=store.checkedUser(store.setup({username:'owner',name:'测试站主',password:'fixture-password-12345'},readFileSync(store.setupFile,'utf8')).id);
  store.configure(owner,{questions:[{text:'测试题目',answers:['yes']}],threshold:1,defaultAccess:'all',defaultCreate:true});
  const member=store.checkedUser(store.register({username:'alice',name:'测试成员',password:'fixture-password-12345',consent:true,answers:{[store.questions().questions[0].id]:'yes'}}).id);
  return {root,store,owner,member,file:join(store.directory,'archive.json')};
}
function cleanup(root){assert.ok(basename(root).startsWith('c0ns1d2-unified-'));rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
const record=extra=>({title:'新记忆',type:'event',date:'2026',body:'正文',scope:'members',published:true,images:[],videos:[],...extra});

test('v1 migration preserves live edits, authorship, visibility, revisions, passwords and question hashes with an exact recovery copy',()=>{
  const {root,store,owner,file}=fixture();
  try{
    const entry=store.entries(owner)[0];store.saveEntry(owner,{...entry,title:'已经在网站改过',scope:'selected',recipients:[],visitorVisible:false});
    const old=JSON.parse(readFileSync(file,'utf8'));old.version=1;delete old.catalog;delete old.catalogHistory;delete old.entries[0].quotes;delete old.entries[0].sourceKind;
    const bytes=JSON.stringify(old);writeFileSync(file,bytes);
    const migrated=createCollaborationStore(root),saved=JSON.parse(readFileSync(file,'utf8'));
    assert.deepEqual(saved.users,old.users);assert.deepEqual(saved.questions,old.questions);assert.deepEqual(saved.history,old.history);assert.equal(saved.answerKey,old.answerKey);
    assert.deepEqual({...saved.entries[0],quotes:undefined,sourceKind:undefined},{...old.entries[0],quotes:undefined,sourceKind:undefined});
    assert.deepEqual(saved.entries[0].quotes,['原话']);assert.equal(saved.entries[0].sourceKind,'auto');assert.equal(migrated.schemaVersion(),2);
    assert.equal(readFileSync(join(store.directory,'backups',saved.migration.backup),'utf8'),bytes);
    assert.equal(saved.catalog.groups.length,1);assert.equal(saved.catalog.people.length,1);
    const after=readFileSync(file,'utf8');createCollaborationStore(root);assert.equal(readFileSync(file,'utf8'),after,'migration is not replayed');
  }finally{cleanup(root);}
});

test('the canonical catalog survives restarts and does not reread edited or removed legacy Markdown',()=>{
  const {root,store,owner}=fixture();
  try{
    const catalog=store.catalog(owner),group=catalog.groups[0],person=catalog.people[0];
    store.saveCatalog(owner,{kind:'group',...group,title:'网站内更新'});
    store.saveCatalog(owner,{kind:'person',...person,body:'网站内更新的侧写'});
    writeFileSync(join(root,'src/content/mediums/group.md'),'broken old file');
    rmSync(join(root,'src/content/people/person.md'));
    const restarted=createCollaborationStore(root);
    assert.equal(restarted.catalog(owner).groups[0].title,'网站内更新');assert.equal(restarted.catalog(owner).people[0].body,'网站内更新的侧写');
    assert.equal(restarted.entries(owner)[0].body,'原正文');
  }finally{cleanup(root);}
});

test('catalog edits are owner-only, reject stale revisions and cyclic groups, and keep private profiles out of member and guest views',()=>{
  const {root,store,owner,member}=fixture();
  try{
    const group=store.catalog(owner).groups[0];
    assert.equal(store.catalog(member).people.length,0);assert.equal(store.catalog(store.guest()).people.length,0);
    assert.throws(()=>store.saveCatalog(member,{kind:'group',title:'越权'}),/站主/);
    assert.throws(()=>store.saveCatalog(owner,{kind:'group',...group,revision:'old',title:'覆盖'}),/已更新/);
    const child=store.saveCatalog(owner,{kind:'group',title:'子分组',parent:group.slug});
    assert.throws(()=>store.saveCatalog(owner,{kind:'group',...group,parent:child.slug}),/循环/);
    assert.throws(()=>store.saveCatalog(owner,{kind:'group',title:'孤立',parent:'missing'}),/不存在/);
    const person=store.catalog(owner).people[0];
    assert.throws(()=>store.saveCatalog(owner,{kind:'person',...person,name:'改名'}),/保持姓名/);
    const edited=store.saveCatalog(owner,{kind:'person',...person,nickname:'新昵称',body:'新侧写'});
    assert.equal(edited.personality.openness,60);assert.equal(edited.nickname,'新昵称');
  }finally{cleanup(root);}
});

test('bulk trash is atomic, protects existing associations, and restores the original scope and media references',()=>{
  const {root,store,owner,member,file}=fixture();
  try{
    const a=store.saveEntry(owner,record({scope:'private'})),b=store.saveEntry(owner,record({title:'第二条'}));
    const before=readFileSync(file,'utf8');
    assert.throws(()=>store.archiveBatch(owner,{items:[a,{...b,revision:'stale'}]}),/已更新/);assert.equal(readFileSync(file,'utf8'),before);
    assert.throws(()=>store.archiveBatch(member,{items:[a]}),/站主/);
    const thought=store.saveEntry(owner,record({type:'thought',fromId:b.id}));
    assert.throws(()=>store.archiveBatch(owner,{items:[b]}),/关联/);
    assert.equal(store.archiveBatch(owner,{items:[a,b,thought]}).count,3);
    assert.equal(store.entries(owner).some(entry=>entry.id===a.id),false);
    const archived=store.ownerOverview(owner).archived;
    store.archiveBatch(owner,{items:archived,archived:false});
    assert.equal(store.readEntry(owner,a.id).scope,'private');assert.deepEqual(store.readEntry(owner,a.id).images,[]);
  }finally{cleanup(root);}
});

test('summary edits and content exports use the live archive while exports exclude credentials and admission secrets',()=>{
  const {root,store,owner,member,file}=fixture();
  try{
    const entry=store.entries(owner)[0];
    const saved=store.saveEntry(owner,{...entry,summary:'手动列表介绍',body:'已经更新的正文'});
    assert.equal(store.readEntry(owner,saved.id).summary,'手动列表介绍');assert.deepEqual(saved.quotes,['原话']);
    assert.throws(()=>store.saveEntry(owner,{...saved,date:'2026-02-31'}),/日期/);
    assert.throws(()=>store.exportContent(member),/站主/);
    const exported=store.exportContent(owner),state=JSON.parse(readFileSync(file,'utf8')),text=JSON.stringify(exported);
    assert.equal(exported.entries.find(entry=>entry.id===saved.id).body,'已经更新的正文');assert.equal(exported.catalog.people.length,1);
    assert.equal(exported.users,undefined);assert.equal(exported.questions,undefined);assert.equal(text.includes(state.answerKey),false);assert.equal(text.includes(state.users[0].password.hash),false);
  }finally{cleanup(root);}
});

test('a second server cannot migrate or write an archive before obtaining its writer lock',async()=>{
  const {root,file}=fixture();
  try{
    const state=JSON.parse(readFileSync(file,'utf8'));state.version=1;delete state.catalog;delete state.catalogHistory;writeFileSync(file,JSON.stringify(state));
    const before=readFileSync(file,'utf8');writeFileSync(join(root,'.local-collaboration/server.lock'),String(process.pid));
    const child=spawn(process.execPath,[resolve('admin/collaboration-server.mjs')],{env:{...process.env,COLLAB_ROOT:root,COLLAB_PORT:'0',COLLAB_PUBLIC_ORIGIN:''},stdio:['ignore','pipe','pipe']});
    let error='';child.stderr.on('data',chunk=>error+=chunk);const [code]=await once(child,'exit');
    assert.notEqual(code,0);assert.match(error,/已经运行/);assert.equal(readFileSync(file,'utf8'),before);assert.equal(existsSync(join(root,'.local-collaboration/backups')),false);
  }finally{cleanup(root);}
});
