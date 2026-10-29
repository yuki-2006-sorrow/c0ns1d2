import assert from 'node:assert/strict';

// Shared by the focused timeline run and the full editor regression.
export async function verifyTimeline({ send, evaluate, navigate, click, fill, until, screenshot, synthetic = false }) {
  await send('Emulation.setDeviceMetricsOverride', {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await navigate('/timeline?year=all');
  await until(() => evaluate('document.querySelectorAll(".tl-rope-date").length > 0'), 'hanging cards');
  const total = await evaluate('document.querySelectorAll(".tl-item").length');
  assert.equal(await evaluate('document.querySelectorAll(".tl-item:not([hidden])").length'),total);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'only the gallery scrolls horizontally');
  assert.equal(await evaluate('!!document.querySelector("#tl-zoom-in,#tl-world,.tl-folder-bar")'),false,'old canvas engine is removed');
  await evaluate('document.fonts.ready');
  await until(() => evaluate('document.querySelector("#tl-cords").getAttribute("width") === String(document.querySelector("#tl-sheet").offsetWidth)'), 'rope dimensions settled');
  await evaluate('window.timelineFirstCard = document.querySelector(".tl-card"); window.timelineFirstRope = document.querySelector(".tl-rope"); window.timelineFirstPath = window.timelineFirstRope.querySelector("path").getAttribute("d");');
  const hasOverflow = await evaluate('document.querySelector("#tl-scroll").scrollWidth > document.querySelector("#tl-scroll").clientWidth');
  if (hasOverflow) {
    await click('#tl-next');
    await until(() => evaluate('document.querySelector("#tl-scroll").scrollLeft > 10'), 'native next page');
    assert.ok(await evaluate('window.timelineFirstCard === document.querySelector(".tl-card") && window.timelineFirstRope === document.querySelector(".tl-rope")'), 'scrolling must not rebuild cards or ropes');
    assert.equal(await evaluate('window.timelineFirstRope.querySelector("path").getAttribute("d")'),await evaluate('window.timelineFirstPath'), 'cord path remains in list coordinates');
  }
  await click('#tl-latest');
  await click('#tl-scale-more');
  assert.ok(await evaluate('Number(document.querySelector("#tl-sheet").style.zoom) > 1'), 'zoom enlarges the timeline');
  await click('#tl-scale-reset');
  assert.equal(await evaluate('document.querySelector("#tl-scale-reset").textContent'), '100%');
  await evaluate('document.querySelector("#tl-scroll").scrollLeft = 0');
  if (hasOverflow) {
    const drag = await evaluate('(() => { const box=document.querySelector(".tl-item:not([hidden]) .tl-card").getBoundingClientRect(); return {x:box.left+180,y:box.top+40}; })()');
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:drag.x,y:drag.y});
    await send('Input.dispatchMouseEvent', {type:'mousePressed',x:drag.x,y:drag.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:drag.x-100,y:drag.y,button:'left',buttons:1});
    await send('Input.dispatchMouseEvent', {type:'mouseReleased',x:drag.x-100,y:drag.y,button:'left',clickCount:1});
    assert.ok(await evaluate('document.querySelector("#tl-scroll").scrollLeft > 30'), 'drag pans the timeline');
    assert.equal(await evaluate('location.pathname'), '/timeline', 'dragging a card must not open it');
  }
  await click('#tl-latest');
  await until(() => evaluate('document.activeElement.classList.contains("tl-card")'), 'latest memory is focusable');
  const selected = await evaluate('({href:document.activeElement.getAttribute("href"),slug:document.activeElement.closest(".tl-item").dataset.event,left:document.querySelector("#tl-scroll").scrollLeft})');
  assert.ok(selected.href.startsWith('/events/'));
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(() => evaluate('location.pathname.startsWith("/events/")'), 'open card with keyboard');
  await navigate('/timeline?year=all');
  await until(() => evaluate('document.querySelectorAll(".tl-rope-date").length > 0'), 'timeline return');
  await until(() => evaluate('Math.abs(document.querySelector("#tl-scroll").scrollLeft - ' + selected.left + ') < 3'), 'return restores native scroll position');

  if (synthetic) {
    await click('[data-year="2022"]');
    await fill('#tl-group','timeline-check-parent');
    assert.equal(await evaluate('document.querySelectorAll(".tl-item:not([hidden])").length'),25,'parent filter includes direct and nested records');
    assert.ok(await evaluate('document.querySelectorAll(".tl-rope-order.is-uncertain").length > 0'),'same-day/partial dates use dashed cords');
    assert.ok(await evaluate('document.querySelectorAll(".tl-rope-order:not(.is-uncertain)").length > 0'),'definite dates use solid cords');
    await screenshot('timeline-rebuild-fixture-desktop.png');
    await click('[data-year="undated"]');
    assert.equal(await evaluate('document.querySelectorAll(".tl-item:not([hidden])").length'),1);
    assert.equal(await evaluate('document.querySelectorAll(".tl-rope-order").length'),0,'undated entry has no invented chronology');
    await click('[data-year="2025"]');
    assert.ok(await evaluate('!document.getElementById("tl-empty").hidden && document.getElementById("tl-latest").disabled'));
    await click('#tl-reset');
    assert.equal(await evaluate('document.querySelectorAll(".tl-item:not([hidden])").length'),total);
    await click('[data-year="2022"]');
    await fill('#tl-group','timeline-check-child');
    assert.equal(await evaluate('document.querySelectorAll(".tl-item:not([hidden])").length'),24,'child scope only contains descendants');
  }
  await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('window.scrollTo(0,0)');
  await until(() => evaluate('document.querySelector(".tl-cord-fiber").getAttribute("d").startsWith("M 12 ")'), 'mobile rail on left');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile has no sideways overflow');
  assert.ok(await evaluate('(() => { const nodes=[...document.querySelectorAll(".tl-item:not([hidden]) .tl-card")]; return nodes.every((node,i) => { const box=node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && (!i || box.top >= nodes[i-1].getBoundingClientRect().bottom); }); })()'), 'mobile cards fit and never overlap');
  assert.ok(await evaluate('document.querySelector("#tl-latest").getBoundingClientRect().top < innerHeight'), 'latest shortcut is available before the long list');
  await screenshot('timeline-rebuild-fixture-mobile.png');
  if (synthetic) {
    await until(() => evaluate('document.querySelector(".tl-photo img").complete'),'test photo loaded');
    assert.ok(await evaluate('document.querySelector(".tl-photo img").naturalWidth > 0'),'local photo shown on card');
    assert.ok(await evaluate('document.querySelector(".tl-photo.is-missing")'),'failed photo keeps a fallback');
    await click('#tl-latest');
    await until(() => evaluate('window.scrollY > 500'),'mobile latest jump');
    const lastHref = await evaluate('document.activeElement.getAttribute("href")');
    const top = await evaluate('window.scrollY');
    await navigate(lastHref);
    await navigate('/timeline?year=2022&group=timeline-check-child');
    await until(() => evaluate('Math.abs(window.scrollY - ' + top + ') < 4'),'mobile reading position restored');
  }
  await send('Emulation.setDeviceMetricsOverride', {width:320,height:760,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'),'narrow mobile fits');
  await navigate('/timeline?year=not-a-year&group=missing');
  await until(() => evaluate('document.querySelector("[data-year][aria-pressed=true]")?.dataset.year !== "not-a-year"'),'invalid saved filters recovered');
  assert.equal(await evaluate('document.getElementById("tl-group")?.value || ""'),'');
  await send('Emulation.setDeviceMetricsOverride', {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setScriptExecutionDisabled', {value:true});
  try {
    await navigate('/timeline');
    assert.equal(await evaluate('document.querySelectorAll(".tl-item:not([hidden])").length'),total,'server-rendered cards remain readable without JavaScript');
  } finally { await send('Emulation.setScriptExecutionDisabled', {value:false}); }
  console.log('Timeline verified: native scroll without DOM rebuild, keyboard links, return position, nested/year filters, uncertain dates, photos, empty state, 390/320px mobile, no-JS fallback.');
}
