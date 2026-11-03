import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,utimesSync,rmSync,mkdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,basename} from 'node:path';
import {createCollaborationStore} from '../admin/collaboration-store.mjs';import {createAutoImporter} from '../admin/auto-import.mjs';import {extractMaterial} from '../admin/material-extract.mjs';import {zipSync,strToU8} from 'fflate';
import {buildPersonalContext} from '../admin/personal-context.mjs';
test('automatic imports create, update, deduplicate and flag removed files without deleting originals',async()=>{
 const root=mkdtempSync(join(tmpdir(),'auto-import-'));let importer;
 try{const store=createCollaborationStore(root);const owner=store.checkedUser(store.setup({username:'owner',name:'测试',password:'test-password-123456'},readFileSync(store.setupFile,'utf8')).id);importer=createAutoImporter(root,store);const folder=join(store.directory,'自动导入'),file=join(folder,'课程资料.txt');
 const write=value=>{writeFileSync(file,value);utimesSync(file,new Date(0),new Date(0));};
 write('第一章复习资料');await importer.run();let data=store.personalRead(owner);assert.equal(data.documents.length,1);assert.equal(data.documents[0].text,'第一章复习资料');const id=data.documents[0].id,revision=data.revision;
 await importer.run();assert.equal(store.personalRead(owner).revision,revision);
 write('第二章更新资料');await importer.run();data=store.personalRead(owner);assert.equal(data.documents[0].id,id);assert.equal(data.documents[0].text,'第二章更新资料');
 const settings=store.personalSave(owner,{action:'documentSetting',revision:data.revision,id,projectId:'',shareWithAI:false});assert.equal(buildPersonalContext(settings,'',{includeResources:true}).documents.length,0);
 write('第三章更新资料');await importer.run();data=store.personalRead(owner);assert.equal(data.documents[0].shareWithAI,false);assert.equal(data.documents[0].id,id);
 store.personalSave(owner,{action:'documentSetting',revision:data.revision,id,projectId:'',shareWithAI:true});
 rmSync(file);await importer.run();assert.equal(store.personalRead(owner).documents[0].stale,true);assert.equal(importer.status().files[0].status,'failed');assert.equal(buildPersonalContext(store.personalRead(owner),'',{includeResources:true}).documents.length,0);
 assert.ok(!JSON.stringify(importer.status()).includes('password'));
 }finally{importer?.stop();assert.ok(basename(root).startsWith('auto-import-'));rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
test('school polling deduplicates, bounds frequency and retains previous notices on failure',async()=>{
 const root=mkdtempSync(join(tmpdir(),'auto-import-'));let importer;
 try{const store=createCollaborationStore(root);const owner=store.checkedUser(store.setup({username:'owner',name:'测试',password:'test-password-123456'},readFileSync(store.setupFile,'utf8')).id);writeFileSync(join(store.directory,'import-sources.json'),JSON.stringify({schoolNotices:true}));let calls=0,broken=false;
 const notice={url:'https://zhfw.zju.edu.cn/2026/1103/c1a1/page.htm',title:'课程活动通知',published:'2026-11-03',source:'浙大综合服务网',relevant:true};
 importer=createAutoImporter(root,store,{fetchNotices:async()=>{calls++;if(broken)throw Error('需要重新登录');return [notice];}});
 await importer.run();const revision=store.personalRead(owner).revision;assert.equal(calls,1);assert.equal(store.personalRead(owner).notices.length,1);
 await importer.run();assert.equal(calls,1);await importer.run({force:true});assert.equal(calls,2);assert.equal(store.personalRead(owner).revision,revision);
 broken=true;await importer.run({force:true});assert.equal(importer.status().webSource.status,'failed');assert.equal(store.personalRead(owner).notices.length,1);assert.ok(importer.status().webSource.lastSuccess);
 }finally{importer?.stop();assert.ok(basename(root).startsWith('auto-import-'));rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
test('office text extraction works, while scans and unsupported types fail visibly',async()=>{
 const bytes=zipSync({'word/document.xml':strToU8('<w:document><w:body><w:p><w:r><w:t>已知课程内容</w:t></w:r></w:p></w:body></w:document>')});assert.equal((await extractMaterial(bytes,'notes.docx')).text,'已知课程内容');
 await assert.rejects(()=>extractMaterial(strToU8('image'),'photo.png'),/暂不支持/);await assert.rejects(()=>extractMaterial(new Uint8Array([255,255]),'bad.txt'));
});
