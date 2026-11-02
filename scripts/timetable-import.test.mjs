import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTimetable} from '../admin/timetable-import.mjs';
import {timetableFixture} from './fixtures/timetable.mjs';
import {createPersonalStore} from '../admin/personal-store.mjs';
import {buildPersonalContext} from '../admin/personal-context.mjs';
test('course rows merge by code, repeated sections deduplicate and imports replace one term only',()=>{
 const snapshot=parseTimetable(timetableFixture());assert.equal(snapshot.rawRowCount,2);assert.equal(snapshot.courses.length,1);assert.equal(snapshot.courses[0].sessions.length,2);assert.deepEqual(snapshot.courses[0].sessions[0].periods,[6,7,8]);assert.ok(!JSON.stringify(snapshot).includes('测试课表'));
 const owner={id:'owner',role:'owner'},state={};const store=createPersonalStore({getState:()=>state,transaction:action=>action()});
 const save=snapshot=>store.personalSave(owner,{action:'timetableImport',revision:store.personalRead(owner).revision,snapshot});
 save(snapshot);save(snapshot);assert.equal(state.personal.timetables.length,1);
 save({...snapshot,sourceHash:'new',courses:[...snapshot.courses,{code:'TEST200',name:'另一课程',sessions:[],terms:['冬']}]});assert.equal(state.personal.timetables[0].courses.length,2);
 save({...snapshot,sourceKey:'2027-2028:秋冬'});assert.equal(state.personal.timetables.length,2);
 const context=buildPersonalContext(state.personal,'project',{includeBackground:true});assert.equal(context.timetables.length,2);assert.ok(!JSON.stringify(context).includes('教室A'));assert.ok(!JSON.stringify(context).includes('教师'));
});
test('invalid files and entities fail without importing anything',()=>{
 for(const bytes of [new Uint8Array(),new Uint8Array(600000),new Uint8Array([1,2]),timetableFixture('<!DOCTYPE foo><worksheet/>'),timetableFixture('<worksheet/>')])assert.throws(()=>parseTimetable(bytes),{status:400});
});
