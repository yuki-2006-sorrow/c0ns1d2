import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {createPersonalAI} from '../admin/personal-ai.mjs';
import {buildPersonalContext} from '../admin/personal-context.mjs';
const project={title:'微积分',progress:null,deadline:'2026-11-07',deadlineDetail:'下午，具体钟点待确认',nextAction:'',note:'确认范围'};
const good={summary:'先明确范围，再逐章练习。',questions:['哪天考试？'],steps:[{title:'整理考试范围',minutes:20}]};
const envelope=(result=good,finish_reason='stop')=>new Response(JSON.stringify({choices:[{finish_reason,message:{content:JSON.stringify(result)}}]}));
test('personal context includes only opted-in available resources for the selected project',()=>{
 const personal={profile:{availability:'每天一小时',skills:'基础待巩固',password:'NO_SECRET'},records:[{body:'NO_DIARY'}],personalDevices:[{token:'NO_TOKEN'}],resources:[
  {title:'教材',kind:'material',detail:'课程教材',status:'available',shareWithAI:true,projectId:'math'},
  {title:'手机',kind:'device',detail:'已有设备',status:'available',shareWithAI:true,projectId:''},
  {title:'另一项目资料',kind:'material',detail:'NO_OTHER',status:'available',shareWithAI:true,projectId:'other'},
  {title:'计划购买',kind:'device',detail:'NO_PLANNED',status:'planned',shareWithAI:true},
  {title:'不共享',kind:'tool',detail:'NO_PRIVATE',status:'available',shareWithAI:false}
 ]};
 assert.deepEqual(buildPersonalContext(personal,'math'),{});
 const context=buildPersonalContext(personal,'math',{includeBackground:true,includeResources:true});
 assert.deepEqual(context.resources.map(resource=>resource.title),['教材','手机']);assert.equal(context.background.availability,'每天一小时');assert.ok(!JSON.stringify(context).includes('NO_'));
 const resourcesOnly=buildPersonalContext(personal,'math',{includeResources:true});assert.ok(!resourcesOnly.background);
 const huge={profile:{about:'字'.repeat(2000)},resources:Array.from({length:30},()=>({title:'资料',kind:'material',detail:'字'.repeat(2000),status:'available',shareWithAI:true}))};
 const limited=buildPersonalContext(huge,'math',{includeBackground:true,includeResources:true});assert.equal(limited.background.about.length,1500);assert.equal(limited.resources.length,20);assert.equal(limited.resources[0].detail.length,800);assert.equal(limited.omittedResourceCount,10);
});
test('DeepSeek sends only selected project/context and keeps credentials out of responses',async()=>{
 const root=mkdtempSync(join(tmpdir(),'personal-ai-'));const secret='sk-test-only-1234567890';
 try{
  let sent=0;
  const ai=createPersonalAI(root,{env:{},forward:async(url,options)=>{sent++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.headers.Authorization,'Bearer '+secret);const body=JSON.parse(options.body);assert.equal(body.response_format.type,'json_object');assert.equal(body.model,'deepseek-flash');assert.deepEqual(JSON.parse(body.messages[1].content),{project,context:'每天一小时'});return envelope();}});
  assert.equal(ai.status().configured,false);await assert.rejects(()=>ai.decompose(project,''),{status:503});
  const status=ai.save({apiKey:secret,model:'deepseek-flash'});assert.equal(status.configured,true);assert.ok(!JSON.stringify(status).includes(secret));
  const result=await ai.decompose({...project,unrelatedSecret:'NEVER_SEND'},'每天一小时');assert.equal(sent,1);assert.deepEqual(result.steps,good.steps);assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(createPersonalAI(root,{env:{}}).status().configured,true);
  ai.save({apiKey:'',model:'deepseek-v4-pro'});assert.equal(JSON.parse(readFileSync(join(root,'ai-config.json'))).apiKey,secret);
  assert.throws(()=>ai.save({apiKey:'bad',model:'deepseek-flash'}),{status:400});
  assert.throws(()=>ai.save({apiKey:secret,model:'unknown'}),{status:400});
 }finally{assert.ok(basename(root).startsWith('personal-ai-'));rmSync(root,{recursive:true,force:true});}
});
test('provider failures, blank, truncated and malformed replies never become tasks',async()=>{
 const root=mkdtempSync(join(tmpdir(),'personal-ai-'));
 try{for(const forward of [async()=>new Response('secret diagnostic',{status:401}),async()=>{throw Error('secret');},async()=>envelope(good,'length'),async()=>envelope({...good,steps:[{title:'',minutes:20}]}),async()=>new Response('{broken'),async()=>new Response('x'.repeat(66000))]){
  const ai=createPersonalAI(root,{env:{DEEPSEEK_API_KEY:'sk-test-only-1234567890'},forward});
  await assert.rejects(()=>ai.decompose(project,''),error=>error.status===502&&!error.message.includes('secret'));
 }}finally{assert.ok(basename(root).startsWith('personal-ai-'));rmSync(root,{recursive:true,force:true});}
});
