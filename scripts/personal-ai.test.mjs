import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {createPersonalAI} from '../admin/personal-ai.mjs';
const project={title:'微积分',progress:null,deadline:'',nextAction:'',note:'确认范围'};
const good={summary:'先明确范围，再逐章练习。',questions:['哪天考试？'],steps:[{title:'整理考试范围',minutes:20}]};
const envelope=(result=good,finish_reason='stop')=>new Response(JSON.stringify({choices:[{finish_reason,message:{content:JSON.stringify(result)}}]}));
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
