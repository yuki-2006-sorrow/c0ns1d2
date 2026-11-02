const $=id=>document.getElementById(id);
let state,dirty=false,saving=false;
const page=location.pathname.endsWith('/records')?'records':location.pathname.endsWith('/me')?'me':'now';
document.querySelector(`[data-page="${page}"]`).hidden=false;
document.querySelector(`nav a[href="${page==='now'?'/personal':'/personal/'+page}"]`).setAttribute('aria-current','page');
const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
const dateField=type=>parts.find(p=>p.type===type).value;
$('record-date').value=`${dateField('year')}-${dateField('month')}-${dateField('day')}`;
$('today-label').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'full'}).format(new Date());
async function request(body,path='/api/personal'){const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Archive-Client':'1'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw Error(data.error||'暂时无法保存');return data;}
function render(){
  $('focus-view').textContent=state.profile.focus||'还没有写下本周关注，慢慢想也可以。';
  $('projects-view').textContent=state.profile.projects||'可以先写下手头的一件事。';
  for(const [key,value] of Object.entries(state.profile))$('profile-form').elements[key].value=value;
  const host=$('record-list');host.replaceChildren();
  for(const record of state.records.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt))){const article=document.createElement('article');article.className='daily-record';const heading=document.createElement('h2');heading.textContent=record.date+' · '+(record.kind==='week'?'每周回顾':record.kind==='thought'?'随手想法':'日常记录');const text=document.createElement('p');text.textContent=record.body;article.append(heading,text);if(record.source==='siri'){const origin=document.createElement('small');origin.textContent='来自 Siri 快速记录';article.append(origin);}if(record.sleep!==null){const note=document.createElement('small');note.textContent='睡眠记录：'+record.sleep+' 小时';article.append(note);}host.append(article);}
  if(!state.records.length){const note=document.createElement('p');note.textContent='还没有记录。从今天的几句话开始。';host.append(note);}
}
async function save(input,form){if(saving)return;saving=true;form.inert=true;$('personal-status').textContent='正在保存…';try{state=await request({...input,revision:state.revision});if(input.action==='record'){$('record-body').value='';$('record-sleep').value='';}dirty=false;render();$('personal-status').textContent='已保存，只在个人空间中可见。';}catch(error){$('personal-status').textContent=error.message+'。输入仍然保留。';}finally{saving=false;form.inert=false;}}
document.querySelectorAll('form').forEach(form=>form.addEventListener('input',()=>dirty=true));
$('record-form').onsubmit=event=>{event.preventDefault();save({action:'record',date:$('record-date').value,kind:$('record-kind').value,body:$('record-body').value,sleep:$('record-sleep').value},event.target);};
$('profile-form').onsubmit=event=>{event.preventDefault();save({action:'profile',profile:Object.fromEntries(new FormData(event.target))},event.target);};
window.addEventListener('beforeunload',event=>{if(dirty||saving){event.preventDefault();event.returnValue='';}});
const deviceEndpoint='/api/personal/devices';
const localPreview=['localhost','127.0.0.1','::1'].includes(location.hostname);
$('capture-url').value=(localPreview?'https://c0ns1d2.com':location.origin)+'/api/personal/capture';
$('phone-environment').textContent=localPreview?'这是隔离预览。这里生成的凭证只对本机预览有效，不能用于正式站；手机配置需在正式站更新后登录生成。':'在这台 iPhone 上配置一次即可。站主电脑与网站通道需要保持在线。';
if(location.hash==='#iphone')$('iphone').open=true;
function hidePhoneSecret(){$('capture-auth').value='';$('phone-secret').hidden=true;}
$('hide-phone-secret').onclick=hidePhoneSecret;
window.addEventListener('pagehide',hidePhoneSecret);
function drawDevices(devices){
  const host=$('phone-devices');host.replaceChildren();
  for(const device of devices){
    const row=document.createElement('div');row.className='phone-device';
    const info=document.createElement('div'),title=document.createElement('span'),note=document.createElement('small');
    title.textContent=device.name;
    note.textContent='有效至 '+device.expiresAt.slice(0,10)+' · '+(device.lastUsedAt?'上次使用 '+new Date(device.lastUsedAt).toLocaleString('zh-CN'):'尚未使用');
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='停用';
    button.onclick=async()=>{button.disabled=true;try{const data=await request({action:'revoke',id:device.id},deviceEndpoint);hidePhoneSecret();drawDevices(data.devices);$('device-status').textContent='凭证已停用，手机不能再用它写入。';}catch(error){$('device-status').textContent=error.message;button.disabled=false;}};
    info.append(title,note);row.append(info,button);host.append(row);
  }
  if(!devices.length){const empty=document.createElement('p');empty.textContent='还没有配置手机。';host.append(empty);}
}
$('create-phone-token').disabled=true;
$('create-phone-token').onclick=async()=>{
  const button=$('create-phone-token');button.disabled=true;hidePhoneSecret();
  try{const result=await request({action:'create',name:'iPhone · Siri'},deviceEndpoint);drawDevices(result.devices);$('capture-auth').value='Bearer '+result.token;$('phone-secret').hidden=false;$('device-status').textContent='凭证仅本次显示，请完成自己的快捷指令配置。';}
  catch(error){$('device-status').textContent=error.message;}
  finally{button.disabled=false;}
};
try{
  state=await request();render();$('connection').textContent='';
  if(page==='me')try{drawDevices((await request(undefined,deviceEndpoint)).devices);$('create-phone-token').disabled=false;}catch(error){$('device-status').textContent=error.message;}
}catch(error){$('connection').textContent=error.message;document.querySelectorAll('form').forEach(form=>form.inert=true);}
