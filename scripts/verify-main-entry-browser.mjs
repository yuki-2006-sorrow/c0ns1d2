import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

// Only used with the disposable collaboration fixture and its fake owner.
export async function verifyMainEntryBrowser(root,origin,password){
  const profile=join(root,'browser-profile');
  const chrome=spawn(process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--window-size=1440,1000','about:blank'],{windowsHide:true,stdio:'ignore'});
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(check,label)=>{for(let i=0;i<150;i++){const value=await check();if(value)return value;await sleep(80);}throw new Error('Timeout: '+label);};
  let socket;
  try{
    const port=await until(()=>existsSync(join(profile,'DevToolsActivePort'))&&readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0],'Chrome');
    const tabs=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
    socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    const pending=new Map(),errors=[];let sequence=0;
    socket.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);if(data.method==='Page.javascriptDialogOpening'){errors.push('Unexpected dialog: '+data.params.message);void send('Page.handleJavaScriptDialog',{accept:true});}if(!pending.has(data.id))return;const task=pending.get(data.id);pending.delete(data.id);data.error?task.reject(new Error(JSON.stringify(data.error))):task.resolve(data.result);};
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('Browser command timeout: '+method));},12000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const data=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(data.exceptionDetails)throw new Error(data.exceptionDetails.exception?.description||data.exceptionDetails.text);return data.result?.value;};
    const navigate=async path=>{await send('Page.navigate',{url:origin+path});await until(()=>evaluate('document.readyState==="complete" && location.pathname==='+JSON.stringify(new URL(path,origin).pathname)),path);};
    const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
    await send('Page.enable');await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument',{source:'localStorage.setItem("introPlayed","1")'});
    await navigate('/');
    await until(()=>evaluate('document.getElementById("mainView")?.classList.contains("visible")'),'gallery');
    await click('.archive-exits a[href="/shared?return=home"]');
    await until(()=>evaluate('!!document.getElementById("login")'),'login form');
    await evaluate('document.querySelector("[name=username]").value="owner";document.querySelector("[name=password]").value='+JSON.stringify(password)+';document.getElementById("login").requestSubmit()');
    await until(()=>evaluate('location.pathname==="/" && !!document.querySelector(".archive-exits .archive-account")'),'return home after login');
    await click('.archive-exits .archive-account summary');
    assert.ok(await evaluate('document.querySelector(".archive-exits .archive-account").open'));
    await click('.archive-exits a[href="/shared?new=thought"]');
    await until(()=>evaluate('!!document.getElementById("entry-form")'),'new thought');
    assert.equal(await evaluate('document.querySelector("[name=type]").value'),'thought');
    await evaluate('const body=document.querySelector("textarea[name=body]");body.value="BROWSER_PRIVATE_NOTE_846";body.dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("entry-form").requestSubmit()');
    await until(()=>evaluate('!!document.getElementById("history") && document.querySelector(".prose")?.textContent.includes("BROWSER_PRIVATE_NOTE_846")'),'private thought saved');
    await navigate('/shared?view=manage');
    await until(()=>evaluate('!!document.getElementById("settings")'),'management deep link');
    assert.ok(await evaluate('!!document.getElementById("member-select") && !!document.getElementById("visitor-records")'));
    await navigate('/');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await until(()=>evaluate('!!document.querySelector(".archive-exits .archive-account")'),'mobile account menu');
    await click('.archive-exits .archive-account summary');
    assert.ok(await evaluate('(()=>{const r=document.querySelector(".archive-exits .archive-account-links").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()'),'mobile menu stays on screen');
    mkdirSync('data-tools',{recursive:true});
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('data-tools/main-entry-mobile-fixture.png',Buffer.from(shot.data,'base64'));
    await click('.archive-exits a[href="/guest"]');
    await until(()=>evaluate('location.pathname==="/guest" && !!document.getElementById("mainView")'),'guest preview');
    assert.equal(await evaluate('!!document.querySelector(".archive-exits .archive-account")'),false);
    assert.ok(!(await evaluate('document.body.textContent')).includes('BROWSER_PRIVATE_NOTE_846'));
    assert.deepEqual(errors,[]);
    console.log('Main entry browser verified: homepage login return, author menu, private thought save, management, guest preview and 390px menu.');
  }finally{
    socket?.close();chrome.kill();await sleep(500);
  }
}
