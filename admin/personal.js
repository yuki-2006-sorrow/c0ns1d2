const $=id=>document.getElementById(id);
let state,dirty=false,saving=false;
const dirtyForms=new Set();
const page=location.pathname.endsWith('/records')?'records':location.pathname.endsWith('/me')?'me':location.pathname.endsWith('/plans')?'plans':'now';
document.querySelector(`[data-page="${page}"]`).hidden=false;
document.querySelector(`.personal-nav a[href="${page==='now'?'/personal':'/personal/'+page}"]`).setAttribute('aria-current','page');
const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
const dateField=type=>parts.find(p=>p.type===type).value;
const today=`${dateField('year')}-${dateField('month')}-${dateField('day')}`;
$('today-label').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'full'}).format(new Date());
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
const button=(text,action)=>{const el=node('button',text,'btn');el.type='button';el.onclick=action;return el;};
function renderPlans(){
  const projects=state.projects||[],tasks=state.tasks||[],day=$('plan-date').value;
  const selected=tasks.filter(task=>task.date===day);
  $('task-count').textContent=`${selected.filter(task=>task.done).length} / ${selected.length} 已完成`;
  const host=$('task-list');host.replaceChildren();
  for(const task of selected){
    const row=node('div',undefined,'task-row'+(task.done?' is-done':''));
    const label=node('label'),check=document.createElement('input');check.type='checkbox';check.checked=task.done;
    check.onchange=async()=>{check.disabled=true;const ok=await save({action:'taskStatus',id:task.id,done:check.checked},row);if(!ok)check.checked=task.done;check.disabled=false;};
    const copy=node('span',task.title);label.append(check,copy);row.append(label);
    const project=projects.find(project=>project.id===task.projectId);if(project)row.append(node('small',project.title));
    if(!task.done)row.append(button('改日期',()=>{const input=document.createElement('input');input.type='date';input.value=task.date;input.setAttribute('aria-label','任务的新日期');const move=button('确认改期',()=>{if(input.value)save({action:'taskMove',id:task.id,date:input.value},row);});row.append(input,move);}));
    host.append(row);
  }
  if(!selected.length)host.append(node('p','这一天还没有安排。先选一两件可以完成的事。','empty-note'));
  const overdue=$('overdue-list');overdue.replaceChildren();
  const pending=tasks.filter(task=>!task.done&&task.date<today);
  if(pending.length){overdue.append(node('h3','之前尚未完成'));for(const task of pending){const row=node('div',undefined,'pending-row');row.append(node('span',task.date+' · '+task.title),button('移到今天',()=>save({action:'taskMove',id:task.id,date:today},row)));overdue.append(row);}}
  const select=$('task-project'),previous=select.value;select.replaceChildren(new Option('独立事项',''));for(const project of projects)select.add(new Option(project.title,project.id));select.value=previous;
  $('project-count').textContent=`${projects.filter(project=>project.status==='active').length} 个进行中 · ${projects.length} 个项目`;
  const list=$('project-list');list.replaceChildren();
  for(const project of projects){
    const card=node('article',undefined,'project-card');
    const top=node('div',undefined,'section-heading');top.append(node('h2',project.title),node('small',({active:'进行中',paused:'暂缓',done:'已完成'})[project.status]));card.append(top);
    if(project.progress!==null){const progress=document.createElement('progress');progress.max=100;progress.value=project.progress;progress.setAttribute('aria-label',project.title+'进度');card.append(progress,node('small',project.progress+'% · 手动记录'));}else card.append(node('p','进度尚未确认','muted'));
    if(project.deadline)card.append(node('p','关键日期 · '+project.deadline,'muted'));
    card.append(node('p',project.nextAction||'下一步还没确定。','next-action'));
    if(project.note)card.append(node('p',project.note,'preserve muted'));
    const actions=node('div',undefined,'project-actions');actions.append(button('更新进展',()=>editProject(project)),button('AI 拆解',()=>openDecomposer(project)));
    if(project.nextAction&&project.status==='active')actions.append(button('安排到今天',()=>save({action:'task',title:project.nextAction,projectId:project.id,date:today},card)));
    card.append(actions);list.append(card);
  }
}
function editProject(project){
  const form=$('project-form');if(dirtyForms.has(form)&&!confirm('放弃尚未保存的项目编辑？'))return;
  form.reset();for(const key of ['id','title','status','progress','deadline','nextAction','note'])form.elements[key].value=project?.[key]??(key==='status'?'active':'');
  dirtyForms.delete(form);dirty=dirtyForms.size>0;$('project-editor').open=true;$('project-editor').scrollIntoView({behavior:'smooth',block:'start'});form.elements.title.focus({preventScroll:true});
}
$('plan-date').onchange=()=>{if($('plan-date').value)renderPlans();};
$('new-project').onclick=()=>editProject(null);
$('cancel-project').onclick=()=>{$('project-editor').open=false;};
$('project-form').onsubmit=async event=>{event.preventDefault();const form=event.target;if(await save({action:'project',...Object.fromEntries(new FormData(form))},form))$('project-editor').open=false;};
$('task-form').onsubmit=async event=>{event.preventDefault();const form=event.target;if(await save({action:'task',...Object.fromEntries(new FormData(form)),date:$('plan-date').value},form)){form.reset();$('task-entry').open=false;}};
$('record-date').value=today;
$('plan-date').value=today;
async function request(body,path='/api/personal'){const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Archive-Client':'1'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok){if(response.status===409)$('reload-plans').hidden=false;throw Error(data.error||'暂时无法保存');}return data;}
function render(){
  $('focus-view').textContent=state.profile.focus||'还没有写下本周关注，慢慢想也可以。';
  $('projects-view').textContent=(state.projects||[]).filter(project=>project.status==='active').map(project=>project.title).join(' · ')||state.profile.projects||'到计划页添加第一个项目。';
  renderPlans();
  const host=$('record-list');host.replaceChildren();
  for(const record of state.records.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt))){const article=document.createElement('article');article.className='daily-record';const heading=document.createElement('h2');heading.textContent=record.date+' · '+(record.kind==='week'?'每周回顾':record.kind==='thought'?'随手想法':'日常记录');const text=document.createElement('p');text.textContent=record.body;article.append(heading,text);if(record.source==='siri'){const origin=document.createElement('small');origin.textContent='来自 Siri 快速记录';article.append(origin);}if(record.sleep!==null){const note=document.createElement('small');note.textContent='睡眠记录：'+record.sleep+' 小时';article.append(note);}host.append(article);}
  if(!state.records.length){const note=document.createElement('p');note.textContent='还没有记录。从今天的几句话开始。';host.append(note);}
}
async function save(input,form){if(saving)return;saving=true;form.inert=true;$('personal-status').textContent='正在保存…';try{state=await request({...input,revision:state.revision});if(input.action==='record'){$('record-body').value='';$('record-sleep').value='';}dirtyForms.delete(form);dirty=dirtyForms.size>0;render();$('personal-status').textContent='已保存，只在个人空间中可见。';return true;}catch(error){$('personal-status').textContent=error.message+'。输入仍然保留。';}finally{saving=false;form.inert=false;}}
document.querySelectorAll('form').forEach(form=>form.addEventListener('input',()=>{dirtyForms.add(form);dirty=true;}));
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
  state=await request();
  if(!state.plansInitialized)state=await request({action:'initializePlans',revision:state.revision});
  for(const [key,value] of Object.entries(state.profile))$('profile-form').elements[key].value=value;
  render();$('connection').textContent='';
  if(page==='me'){await loadAISettings();}
  if(page==='me')try{drawDevices((await request(undefined,deviceEndpoint)).devices);$('create-phone-token').disabled=false;}catch(error){$('device-status').textContent=error.message;}
}catch(error){$('connection').textContent=error.message;document.querySelectorAll('form').forEach(form=>form.inert=true);}

$('reload-plans').onclick=async()=>{try{state=await request();render();$('reload-plans').hidden=true;$('personal-status').textContent='已读取最新进度，表单输入保留，请检查后重新保存。';}catch(error){$('personal-status').textContent=error.message;}};

let aiProjectId='',proposal=null,aiWorking=false;
function openDecomposer(project){
 if(aiWorking){$('personal-status').textContent='正在生成步骤，请稍候。';return;}
 aiProjectId=project.id;proposal=null;$('ai-decomposer').hidden=false;$('ai-project-title').textContent='拆解 · '+project.title;$('ai-context').value='';$('ai-results').hidden=true;$('ai-result-status').textContent='';$('ai-task-date').value=today;$('ai-decomposer').scrollIntoView({behavior:'smooth',block:'start'});
}
$('close-ai').onclick=()=>{if(!aiWorking)$('ai-decomposer').hidden=true;};
$('ai-breakdown-form').onsubmit=async event=>{
 event.preventDefault();if(aiWorking)return;aiWorking=true;const form=event.target;form.inert=true;$('ai-results').hidden=true;$('ai-result-status').textContent='DeepSeek 正在拆解，通常需要几秒到几十秒…';
 try{
  proposal=await request({projectId:aiProjectId,context:$('ai-context').value},'/api/personal/decompose');proposal.batchId=crypto.randomUUID();
  $('ai-summary').textContent=proposal.summary;
  const questions=$('ai-questions');questions.replaceChildren();if(proposal.questions.length){questions.append(node('h3','还需要确认'));for(const question of proposal.questions)questions.append(node('p',question));}
  const host=$('ai-step-list');host.replaceChildren();
  for(const [index,step] of proposal.steps.entries()){
   const row=node('div',undefined,'ai-step');const label=node('label'),check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label','选择步骤 '+(index+1));label.append(check,node('span','步骤 '+(index+1)+' · 约 '+step.minutes+' 分钟'));const title=document.createElement('input');title.type='text';title.value=step.title;title.maxLength=500;title.setAttribute('aria-label','步骤 '+(index+1)+' 的内容');row.append(label,title);host.append(row);
  }
  $('ai-results').hidden=false;$('ai-result-status').textContent=(proposal.provider==='DeepSeek'?'DeepSeek 已生成建议。':proposal.provider+'。')+'选择需要的步骤，可以修改内容和安排日期。';
 }catch(error){proposal=null;$('ai-result-status').textContent=error.message;}
 finally{aiWorking=false;form.inert=false;}
};
$('adopt-ai-steps').onclick=async()=>{
 if(!proposal)return;const steps=[...$('ai-step-list').children].filter(row=>row.querySelector('[type=checkbox]').checked).map(row=>({title:row.querySelector('[type=text]').value}));
 if(!steps.length){$('ai-result-status').textContent='先选择要加入计划的步骤。';return;}
 if(!$('ai-task-date').value){$('ai-result-status').textContent='请选择安排日期。';return;}
 const ok=await save({action:'taskBatch',projectId:proposal.projectId,projectUpdatedAt:proposal.projectUpdatedAt,batchId:proposal.batchId,date:$('ai-task-date').value,steps},$('ai-results'));
 if(ok){dirtyForms.delete($('ai-breakdown-form'));dirty=dirtyForms.size>0;$('ai-results').hidden=true;$('ai-result-status').textContent='选中的步骤已加入每日计划。';proposal=null;}
};
async function loadAISettings(){
 if(location.port==='4327'){$('ai-config-form').inert=true;$('ai-config-status').textContent='隔离预览不保存 API Key。请在正式网站的“我”页面配置 DeepSeek。';return;}
 try{const result=await request(undefined,'/api/personal/ai');$('deepseek-model').value=result.model;$('ai-config-status').textContent=result.configured?'DeepSeek 已配置，可以在项目里使用 AI 拆解。':'尚未配置。请填写你自己的 DeepSeek API Key。';}catch(error){$('ai-config-status').textContent=error.message;}
}
$('ai-config-form').onsubmit=async event=>{
 event.preventDefault();const form=event.target;form.inert=true;
 try{await request({apiKey:$('deepseek-key').value,model:$('deepseek-model').value},'/api/personal/ai');$('deepseek-key').value='';dirtyForms.delete(form);dirty=dirtyForms.size>0;await loadAISettings();}catch(error){$('ai-config-status').textContent=error.message;}finally{form.inert=false;}
};
window.addEventListener('pagehide',()=>{$('deepseek-key').value='';});
