import test from 'node:test';
import assert from 'node:assert/strict';
import {installTimelineNavigation} from '../src/scripts/timeline-navigation.js';

test('dense wheel input paints once per frame, preserves scale and cancels pending work on mobile',()=>{
  const element=()=>({events:{},style:{},classList:{add(){},remove(){}},addEventListener(name,fn){this.events[name]=fn;}});
  const buttons=Object.fromEntries(['tl-scale-reset','tl-scale-less','tl-scale-more'].map(id=>[id,element()]));
  const original=globalThis.document;
  globalThis.document={getElementById:id=>buttons[id]};
  try{
    const viewport=element(),sheet=element(),mobile=element(),frames=new Map();let frameId=0,changes=0;
    Object.assign(viewport,{clientWidth:800,clientHeight:500,scrollLeft:100,scrollTop:0,getBoundingClientRect:()=>({left:0,top:0}),scrollTo({left,top}){this.scrollLeft=left;this.scrollTop=top;}});
    mobile.matches=false;
    const clock={requestAnimationFrame(fn){frames.set(++frameId,fn);return frameId;},cancelAnimationFrame(id){frames.delete(id);}};
    installTimelineNavigation({viewport,sheet,mobile,clock,onChange:()=>changes++});
    const wheel={deltaX:0,deltaY:-10,deltaMode:0,clientX:200,clientY:100,preventDefault(){}};
    for(let i=0;i<20;i++)viewport.events.wheel(wheel);
    assert.equal(frames.size,1);assert.equal(changes,0);
    const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());};flush();
    assert.equal(changes,1);assert.ok(Math.abs(Number(sheet.style.zoom)-Math.exp(.3))<1e-9);
    assert.ok(Math.abs(viewport.scrollLeft-(300*Math.exp(.3)-200))<1e-9,'keep the pointer anchored');
    viewport.events.wheel(wheel);buttons['tl-scale-reset'].events.click();
    assert.equal(frames.size,0);assert.equal(sheet.style.zoom,'1');
    viewport.events.wheel(wheel);mobile.matches=true;mobile.events.change();
    assert.equal(frames.size,0);assert.equal(sheet.style.zoom,'1');
    viewport.events.wheel(wheel);assert.equal(frames.size,0);
  }finally{globalThis.document=original;}
});
