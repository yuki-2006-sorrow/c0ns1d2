import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTodayFocus} from '../admin/personal-today.mjs';
test('today prioritizes upcoming dates without inventing afternoon clock times or completing projects',()=>{
 const personal={projects:[{id:'math',title:'微积分',status:'active',deadline:'2026-11-07',deadlineDetail:'下午，具体钟点待确认'},{id:'english',title:'英语',status:'active',deadline:'2026-11-05',deadlineDetail:'上午08:00'},{id:'other',title:'以后',status:'active',deadline:'2026-12-01'}],tasks:[{id:'m',date:'2026-11-03',projectId:'math',done:false},{id:'e',date:'2026-11-03',projectId:'english',done:false},{id:'done',date:'2026-11-03',projectId:'english',done:true},{id:'tomorrow',date:'2026-11-04',projectId:'english',done:false}]};
 const original=JSON.stringify(personal),today=buildTodayFocus(personal,'2026-11-03');assert.equal(today.focus.id,'english');assert.equal(today.focus.days,2);assert.equal(today.upcoming[1].deadlineDetail,'下午，具体钟点待确认');assert.deepEqual(today.tasks.map(task=>task.id),['e','m','done']);
 assert.equal(buildTodayFocus(personal,'2026-11-06').focus.id,'math');assert.equal(buildTodayFocus(personal,'2026-11-05').focus.days,0);assert.equal(buildTodayFocus(personal,'2026-11-08').focus,null);assert.equal(JSON.stringify(personal),original);
});
