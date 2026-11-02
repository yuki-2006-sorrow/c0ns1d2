
const app=document.getElementById('app'),account=document.getElementById('account'),statusBox=document.getElementById('status');
const setupToken=new URLSearchParams(location.hash.slice(1)).get('setup')||'';if(location.hash)history.replaceState(null,'',location.pathname+location.search);
async function api(path,body){const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Archive-Client':'1'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'请求失败'),{status:response.status});return data;}
function bind(id,action){const form=document.getElementById(id);form.onsubmit=async event=>{event.preventDefault();form.inert=true;statusBox.textContent='正在处理…';try{await action(Object.fromEntries(new FormData(form)));}catch(error){statusBox.textContent=error.message;}finally{form.inert=false;}};}
async function initialize(){
 const state=await api('/api/status');let me;try{me=await api('/api/me');}catch(error){if(error.status!==401&&error.status!==403)throw error;}
 if(me){
  account.innerHTML='<a href="/personal">回到个人空间</a> <button id="logout" class="subtle">退出登录</button>';
  document.getElementById('logout').onclick=async()=>{try{await api('/api/logout',{});location.assign('/shared');}catch(error){statusBox.textContent=error.message;}};
  if(new URLSearchParams(location.search).get('view')!=='password'){location.replace('/personal');return;}
  app.innerHTML='<section class="auth"><h1>更改密码</h1><form id="password-form"><label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>新密码（至少12个字符）<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><button type="submit">保存并重新登录</button></form></section>';
  bind('password-form',async data=>{await api('/api/password',data);location.assign('/shared');});return;
 }
 if(!state.setup){app.innerHTML='<section class="auth"><h1>建立私人空间</h1><p>请在本人电脑上完成初始化。</p>'+(setupToken?'<form id="setup"><label>账号<input name="username" autocomplete="username" pattern="[a-zA-Z0-9_-]{3,40}" required></label><label>昵称<input name="name" maxlength="60" required></label><label>密码<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><button type="submit">建立个人账号</button></form>':'<p>从本机启动程序提供的初始化入口打开。</p>')+'</section>';if(setupToken)bind('setup',async data=>{await api('/api/setup',{...data,token:setupToken});location.assign('/personal');});return;}
 app.innerHTML='<section class="auth"><p class="muted">把注意力放回自己的生活</p><h1>登录私人空间</h1><p>查看今天的安排，跟进自己的项目。</p><form id="login"><label>账号<input name="username" autocomplete="username" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">进入个人空间</button></form></section>';
 bind('login',async data=>{await api('/api/login',data);location.assign('/personal');});
}
initialize().catch(error=>{app.textContent='个人空间暂时无法连接，请稍后刷新。';statusBox.textContent=error.message;});
