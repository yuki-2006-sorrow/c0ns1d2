import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Run the actual submit handler with deferred requests, without real accounts or browser data.
const source=readFileSync(new URL('../admin/collaboration.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('function formAction('),source.indexOf('function accountBar('));
for(const fails of [false,true])test('editor submission '+(fails?'failure preserves text and unlocks':'blocks duplicate submits and navigation until completion'),async()=>{
  let submit,finish,calls=0,message='';
  const button={disabled:false},attributes=new Map();
  const form={text:'未保存原文',addEventListener:(type,fn)=>submit=fn,querySelector:()=>button,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)};
  const statusBox={textContent:''};
  const context=vm.createContext({setTimeout,clearTimeout,statusBox,submitting:false,app:{inert:false},account:{inert:false},notify:value=>{message=value;statusBox.textContent=value;},FormData:class{constructor(input){this.text=input.text;}}});
  vm.runInContext(handler,context);
  const request=new Promise((resolve,reject)=>finish=fails?()=>reject(new Error('断线，请重试')):resolve);
  context.formAction(form,async data=>{calls++;assert.equal(data.text,'未保存原文');await request;});
  const pending=submit({preventDefault(){}});
  assert.equal(context.app.inert,true);assert.equal(context.account.inert,true);assert.equal(button.disabled,true);assert.equal(attributes.get('aria-busy'),'true');
  await submit({preventDefault(){}});assert.equal(calls,1);
  finish();await pending;
  assert.equal(context.submitting,false);assert.equal(context.app.inert,false);assert.equal(context.account.inert,false);assert.equal(button.disabled,false);assert.equal(attributes.has('aria-busy'),false);
  assert.equal(form.text,'未保存原文');if(fails)assert.equal(message,'断线，请重试');
});

test('read requests time out and writes remain single pending requests until their result arrives',async()=>{
  const timers=new Map();let timerId=0,requestCount=0,finishWrite;
  const context=vm.createContext({AbortController,setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},fetch:async(path,options)=>{
    requestCount++;
    if(options.method==='POST')return new Promise(resolve=>finishWrite=()=>resolve({ok:true,status:200,json:async()=>({ok:true})}));
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  }});
  vm.runInContext(source.slice(source.indexOf('async function api('),source.indexOf('function swap(')),context);
  const read=context.api('/api/entries');
  assert.equal(timers.size,1);[...timers.values()][0]();
  await assert.rejects(read,/等待过久/);assert.equal(timers.size,0);
  const write=context.api('/api/entry',{body:'未保存原文'});
  assert.equal(timers.size,0,'never abort or automatically replay writes');assert.equal(requestCount,2);
  finishWrite();assert.equal((await write).ok,true);
});
