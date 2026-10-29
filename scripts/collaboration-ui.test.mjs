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
  const context=vm.createContext({submitting:false,app:{inert:false},account:{inert:false},notify:value=>message=value,FormData:class{constructor(input){this.text=input.text;}}});
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
