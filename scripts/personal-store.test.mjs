import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalStore} from '../admin/personal-store.mjs';
test('personal records are owner-only, preserve originals and reject stale writes',()=>{
  const state={entries:[],users:[{id:'owner'}]},owner={id:'owner',role:'owner',access:'all'};
  const store=createPersonalStore({getState:()=>state,transaction:action=>action()});
  for(const user of [null,{role:'guest'},{role:'member',canCreate:true},{role:'owner',access:'blocked'}]){
    assert.throws(()=>store.personalRead(user),{status:403});
    assert.throws(()=>store.personalSave(user,{action:'record'}),{status:403});
  }
  const first=store.personalSave(owner,{revision:'empty',action:'record',date:'2026-11-02',kind:'day',body:'今天推进了个人网站。',sleep:'7.5'});
  assert.equal(first.records[0].sleep,7.5);first.records[0].body='mutated';
  assert.equal(store.personalRead(owner).records[0].body,'今天推进了个人网站。');
  assert.throws(()=>store.personalSave(owner,{revision:'empty',action:'profile'}),{status:409});
  const profile=store.personalSave(owner,{revision:first.revision,action:'profile',profile:{focus:'写下一周'}});
  assert.equal(profile.profile.focus,'写下一周');assert.equal(profile.records.length,1);assert.deepEqual(state.entries,[]);
  for(const input of [{date:'2026-02-30',sleep:''},{date:'2026-11-02',sleep:25}])assert.throws(()=>store.personalSave(owner,{revision:profile.revision,action:'record',kind:'day',body:'内容',...input}),{status:400});
});

test('phone credentials only append private thoughts, can be revoked and never appear in personal data',()=>{
  const owner={id:'owner',role:'owner',access:'all'};
  const state={users:[owner],entries:[]};
  const store=createPersonalStore({getState:()=>state,transaction:action=>action()});
  assert.throws(()=>store.personalDeviceSave({role:'member'},{action:'create'}),{status:403});
  const created=store.personalDeviceSave(owner,{action:'create',name:'我的 iPhone'});
  assert.match(created.token,/^pc_[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(state).includes(created.token));
  assert.ok(!JSON.stringify(store.personalDevices(owner)).includes('tokenHash'));
  const original=store.personalRead(owner);
  const first=store.personalCapture(created.token,{body:'突然想到一个点子。',requestId:'request-0001',action:'profile',profile:{about:'不得改写'}});
  assert.equal(first.ok,true);assert.ok(!('body' in first));assert.ok(!('records' in first));
  const current=store.personalRead(owner);
  assert.equal(current.records[0].kind,'thought');assert.equal(current.records[0].source,'siri');
  assert.equal(current.profile.about,'');assert.match(current.records[0].date,/^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!JSON.stringify(current).includes('tokenHash'));
  assert.throws(()=>store.personalSave(owner,{revision:original.revision,action:'profile'}),{status:409});
  const repeat=store.personalCapture(created.token,{body:'突然想到一个点子。',requestId:'request-0001'});
  assert.equal(repeat.duplicate,true);assert.equal(first.id,repeat.id);assert.equal(store.personalRead(owner).records.length,1);
  assert.throws(()=>store.personalCapture(created.token,{body:'不同内容',requestId:'request-0001'}),{status:409});
  assert.throws(()=>store.personalCapture(created.token,{body:''}),{status:400});
  assert.throws(()=>store.personalCapture('pc_'+'0'.repeat(64),{body:'不能写入'}),{status:401});
  state.users[0].access='blocked';assert.throws(()=>store.personalCapture(created.token,{body:'不能写入'}),{status:401});
  state.users[0].access='all';
  state.personalDevices[0].expiresAt='2000-01-01';assert.throws(()=>store.personalCapture(created.token,{body:'不能写入'}),{status:401});
  store.personalDeviceSave(owner,{action:'revoke',id:created.device.id});
  assert.equal(store.personalDevices(owner).length,0);
  assert.throws(()=>store.personalCapture(created.token,{body:'不能写入'}),{status:401});
  assert.equal(store.personalRead(owner).records.length,1);
});
