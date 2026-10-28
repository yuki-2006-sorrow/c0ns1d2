import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutThreadCards, dateThreadPath, eventThreadPath } from '../src/lib/timeline-threads.mjs';

const options = { xFor: event => event.x, axisY: 240, width: 280, height: 190 };
test('nearby dates keep their exact anchors while cards fan out without overlap', () => {
  const events = [168,408,1090].map((x,index) => ({x,slug:String(index)}));
  const positions = layoutThreadCards(events, options);
  assert.deepEqual(positions.map(item => item.anchorX), [168,408,1090]);
  assert.deepEqual(positions.map(item => item.lane), [0,0,0]);
  for (let index=1;index<positions.length;++index) assert.ok(positions[index].left >= positions[index-1].left + options.width + 28);
  assert.ok(positions[1].left + options.width / 2 > events[1].x, 'rope, not date, absorbs the shift');
});

test('same-day and narrow-screen entries occupy separate rows without changing dates', () => {
  const events = [180,180,190,230,240,240].map((x,index) => ({x,slug:String(index)}));
  const positions = layoutThreadCards(events, options);
  for (let i=0;i<positions.length;++i) {
    assert.equal(positions[i].anchorX,events[i].x);
    for (let j=0;j<i;++j) {
      const a=positions[i],b=positions[j];
      assert.ok(a.left >= b.left + b.width || b.left >= a.left + a.width || a.top >= b.top + b.height || b.top >= a.top + a.height, 'cards must not overlap');
    }
  }
  assert.equal(layoutThreadCards([],options).length,0);
  assert.equal(layoutThreadCards([{x:180}],options)[0].lane,0);
});

test('date ropes start at their date and end at the shifted card pin', () => {
  const path = dateThreadPath(408,240,476,324,12);
  assert.ok(path.startsWith('M 408 240 C '));
  assert.ok(path.endsWith(', 476 324'));
  assert.ok(!path.includes('NaN'));
});

test('event ropes attach outside card edges and route row changes around the text', () => {
  const row = layoutThreadCards([{x:168},{x:408}],options);
  const across = eventThreadPath(row[0],row[1]);
  assert.equal(across.from[0],row[0].left+row[0].width+3);
  assert.equal(across.to[0],row[1].left-3);
  const rows=layoutThreadCards([{x:168},{x:168}],options);
  const down=eventThreadPath(rows[0],rows[1]);
  assert.equal(down.to[0],rows[1].left+rows[1].width+3);
  assert.ok(down.to[1]>down.from[1]);
  assert.ok(!down.d.includes('NaN'));
});

test('a row-changing rope uses the left margin when the right margin would be clipped', () => {
  const rows=layoutThreadCards([{x:180},{x:230}],options);
  const line=eventThreadPath(rows[0],rows[1],{leftBound:0,rightBound:390});
  assert.equal(line.from[0],rows[0].left-3);
  assert.equal(line.to[0],rows[1].left-3);
  assert.ok(Math.min(rows[0].left,rows[1].left)-31>=0);
});
