import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineDate, folderTrail, prepareTimeline, selectTimeline, hasChronologicalOrder } from '../src/lib/timeline-model.mjs';
import { dateThreadPath, eventThreadPath } from '../src/lib/timeline-threads.mjs';

const event = (slug, date, medium = '') => ({ slug, date, medium, title: slug });
test('full and partial dates keep their actual precision, including leap years', () => {
  assert.equal(timelineDate('2024-02-29').start, Date.UTC(2024, 1, 29));
  assert.equal(timelineDate('2024-02').end, Date.UTC(2024, 1, 29));
  assert.equal(timelineDate('2024').end, Date.UTC(2024, 11, 31));
  assert.match(timelineDate('2024').label, /年份/);
  assert.match(timelineDate('2024-02').label, /月份/);
});
test('impossible or unknown dates survive in the undated section instead of disappearing', () => {
  for (const value of ['2025-02-29','2026-13','2026-04-31','?','','未知','2026-02-01oops']) {
    assert.equal(timelineDate(value).start, null, value);
    assert.equal(timelineDate(value).year, 'undated');
  }
  assert.equal(prepareTimeline([event('unknown','?')]).entries.length, 1);
});
test('same-day ordering is deterministic and does not mutate input or fabricate chronology', () => {
  const source = [event('z','2026-01-01'),event('a','2026-01-01'),event('later','2026-01-02')];
  const entries = prepareTimeline(source).entries;
  assert.deepEqual(entries.map(item => item.slug), ['a','z','later']);
  assert.equal(source[0].slug, 'z');
  assert.equal(hasChronologicalOrder(entries[0], entries[1]), false);
  assert.equal(hasChronologicalOrder(entries[1], entries[2]), true);
  assert.equal(hasChronologicalOrder({time:timelineDate('2026')},{time:timelineDate('2026-05-01')}), false);
  assert.equal(hasChronologicalOrder({time:timelineDate('?')},{time:timelineDate('2026-05-01')}), false);
});
test('nested groups include descendants, orphan records remain visible, cycles terminate', () => {
  const folders = { parent:{title:'父级'}, child:{title:'子级',parent:'parent'}, empty:{title:'空组'}, loop:{title:'循环',parent:'loop'} };
  const model = prepareTimeline([event('a','2025','child'), event('b','2026','parent'), event('orphan','?','missing')],folders);
  assert.equal(selectTimeline(model.entries,'all','parent').length,2);
  assert.equal(selectTimeline(model.entries,'2025','parent').length,1);
  assert.equal(selectTimeline(model.entries,'2026','child').length,0);
  assert.equal(selectTimeline(model.entries,'undated')[0].slug,'orphan');
  assert.equal(model.groups.some(group => group.id === 'empty'),false);
  assert.deepEqual(folderTrail('loop', folders),[{id:'loop',title:'循环'}]);
  assert.deepEqual(model.years,['2025','2026','undated']);
});
test('empty archives and dense same-day groups remain complete', () => {
  assert.deepEqual(prepareTimeline([]),{entries:[],years:[],groups:[]});
  const model = prepareTimeline(Array.from({length:500},(_,i) => event(String(i),'2026-01-01')));
  assert.equal(selectTimeline(model.entries,'2026').length,500);
  assert.equal(new Set(model.entries.map(item => item.slug)).size,500);
});
test('hanging ropes attach to the supplied pin in both orientations', () => {
  for (const mobile of [false,true]) {
    const d = dateThreadPath({x:12,y:24},{x:48,y:90},mobile);
    assert.ok(d.startsWith('M 12 24 C '));
    assert.ok(d.endsWith(', 48 90'));
    assert.ok(!d.includes('NaN'));
  }
});
test('chronological ropes stay in card gutters, independent from viewport position', () => {
  const a = {left:28,right:320,top:106,bottom:468};
  const b = {left:384,right:676,top:122,bottom:484};
  const across = eventThreadPath(a,b);
  assert.equal(across.from.x,a.right);
  assert.equal(across.to.x,b.left);
  assert.ok(across.to.x>across.from.x);
  const below = {left:48,right:340,top:510,bottom:800};
  const down = eventThreadPath({...a,left:48},below,true);
  assert.equal(down.from.x,48); assert.equal(down.to.x,48);
  assert.ok(down.to.y>down.from.y);
  assert.ok(down.d.includes('C 24 '), 'vertical connector stays outside the reading area');
});
