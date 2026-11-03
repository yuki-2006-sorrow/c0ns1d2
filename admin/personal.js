import {buildPersonalContext} from '/personal-context.mjs';
import {buildTodayFocus} from '/personal-today.mjs';
const $=id=>document.getElementById(id);
let state,dirty=false,saving=false,aiConfigured=null,importsRefreshing=false;
const dirtyForms=new Set();
const page=location.pathname.endsWith('/import')?'import':location.pathname.endsWith('/records')?'records':location.pathname.endsWith('/me')?'me':location.pathname.endsWith('/plans')?'plans':'now';
document.querySelector(`[data-page="${page}"]`).hidden=false;
document.querySelector(`.personal-nav a[href="${page==='now'?'/personal':'/personal/'+page}"]`)?.setAttribute('aria-current','page');
const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
const dateField=type=>parts.find(p=>p.type===type).value;
const today=`${dateField('year')}-${dateField('month')}-${dateField('day')}`;
$('today-label').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'full'}).format(new Date());
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
const button=(text,action)=>{const el=node('button',text,'btn');el.type='button';el.onclick=action;return el;};
function renderPlans(){
  if([...dirtyForms].some(form=>form.isConnected&&form.classList.contains('task-edit')))return;
  const projects=state.projects||[],tasks=state.tasks||[],day=$('plan-date').value;
  const selected=buildTodayFocus(state,day).tasks;
  $('task-count').textContent=`${selected.filter(task=>task.done).length} / ${selected.length} 已完成`;
  const host=$('task-list'),more=$('more-task-list');host.replaceChildren();more.replaceChildren();$('more-tasks').hidden=selected.length<=3;$('more-task-label').textContent='其他安排 · '+Math.max(0,selected.length-3)+' 件';
  for(const [index,task] of selected.entries()){
    const row=node('div',undefined,'task-row'+(task.done?' is-done':''));
    const label=node('label'),check=document.createElement('input');check.type='checkbox';check.checked=task.done;
    check.onchange=async()=>{check.disabled=true;const ok=await save({action:'taskStatus',id:task.id,done:check.checked},row);if(!ok)check.checked=task.done;check.disabled=false;};
    const copy=node('span',task.title);label.append(check,copy);row.append(label);
    const project=projects.find(project=>project.id===task.projectId);if(project)row.append(node('small',project.title));
    if(task.source==='assistant-suggested')row.append(node('small','建议安排，可调整'));
    if(!task.done){const edit=button('调整',()=>{edit.disabled=true;const form=document.createElement('form');form.className='task-edit';const title=node('label','具体要做什么'),input=document.createElement('input');input.type='text';input.value=task.title;input.maxLength=500;input.required=true;title.append(input);const dateLabel=node('label','安排到'),date=document.createElement('input');date.type='date';date.value=task.date;date.required=true;dateLabel.append(date);const actions=node('div',undefined,'project-actions'),submit=node('button','保存调整','btn');submit.type='submit';actions.append(submit,button('取消',()=>{dirtyForms.delete(form);dirty=dirtyForms.size>0;form.remove();edit.disabled=false;renderPlans();}));form.append(title,dateLabel,actions);form.onsubmit=event=>{event.preventDefault();save({action:'taskEdit',id:task.id,title:input.value,date:date.value},form);};row.append(form);dirtyForms.add(form);dirty=true;input.focus();});row.append(edit);}
    (index<3?host:more).append(row);
  }
  if(!selected.length)host.append(node('p','这一天还没有安排。先选一两件可以完成的事。','empty-note'));
  const overdue=$('overdue-list');overdue.replaceChildren();
  const pending=tasks.filter(task=>!task.done&&task.date<today);
  if(pending.length){const disclosure=node('details');disclosure.append(node('summary','之前未完成 · '+pending.length+' 件'));overdue.append(disclosure);for(const task of pending){const row=node('div',undefined,'pending-row');row.append(node('span',task.date+' · '+task.title),button('移到今天',()=>save({action:'taskMove',id:task.id,date:today},row)));disclosure.append(row);}}
  const select=$('task-project'),previous=select.value;select.replaceChildren(new Option('独立事项',''));for(const project of projects)select.add(new Option(project.title,project.id));select.value=previous;
  $('project-count').textContent=`${projects.filter(project=>project.status==='active').length} 个进行中 · ${projects.length} 个项目`;
  const list=$('project-list');list.replaceChildren();
  for(const project of projects){
    const card=node('article',undefined,'project-card');
    const top=node('div',undefined,'section-heading');top.append(node('h2',project.title),node('small',({active:'进行中',paused:'暂缓',done:'已完成'})[project.status]));card.append(top);
    if(project.progress!==null){const progress=document.createElement('progress');progress.max=100;progress.value=project.progress;progress.setAttribute('aria-label',project.title+'进度');card.append(progress,node('small',project.progress+'% · 手动记录'));}else card.append(node('p','进度尚未确认','muted'));
    card.id='project-'+project.id;if(project.deadline)card.append(node('p','关键日期 · '+project.deadline+(project.deadlineDetail?' · '+project.deadlineDetail:''),'muted'));
    card.append(node('p',project.nextAction||'下一步还没确定。','next-action'));
    if(project.note)card.append(node('p',project.note,'preserve muted'));
    const actions=node('div',undefined,'project-actions');actions.append(button('更新进展',()=>editProject(project)),button('AI 拆解',()=>openDecomposer(project)));
    if(project.nextAction&&project.status==='active')actions.append(button('安排到今天',()=>save({action:'task',title:project.nextAction,projectId:project.id,date:today},card)));
    card.append(actions);list.append(card);
  }
}
function editProject(project){
  const form=$('project-form');if(dirtyForms.has(form)&&!confirm('放弃尚未保存的项目编辑？'))return;
  form.reset();for(const key of ['id','title','status','progress','deadline','deadlineDetail','nextAction','note'])form.elements[key].value=project?.[key]??(key==='status'?'active':'');
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
  renderWorkStatus();
  renderTodayFocus();
  renderPlans();renderResources();renderTimetables();renderDocuments();renderNotices();if(!$('ai-decomposer').hidden)renderContextPreview();
  const host=$('record-list');host.replaceChildren();
  for(const record of state.records.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt))){const article=document.createElement('article');article.className='daily-record';const heading=document.createElement('h2');heading.textContent=record.date+' · '+(record.kind==='week'?'每周回顾':record.kind==='thought'?'随手想法':'日常记录');const text=document.createElement('p');text.textContent=record.body;article.append(heading,text);if(record.source==='siri'){const origin=document.createElement('small');origin.textContent='来自 Siri 快速记录';article.append(origin);}if(record.sleep!==null){const note=document.createElement('small');note.textContent='睡眠记录：'+record.sleep+' 小时';article.append(note);}host.append(article);}
  if(!state.records.length){const note=document.createElement('p');note.textContent='还没有记录。从今天的几句话开始。';host.append(note);}
}
async function save(input,form){if(saving)return;saving=true;form.inert=true;$('personal-status').textContent='正在保存…';try{state=await request({...input,revision:state.revision});if(input.action==='record'){$('record-body').value='';$('record-sleep').value='';}dirtyForms.delete(form);dirty=dirtyForms.size>0;render();$('personal-status').textContent='已保存，只在个人空间中可见。';return true;}catch(error){$('personal-status').textContent=error.message+'。输入仍然保留。';}finally{saving=false;form.inert=false;}}
document.addEventListener('input',event=>{const form=event.target.closest('form');if(form){dirtyForms.add(form);dirty=true;}});
$('record-form').onsubmit=event=>{event.preventDefault();save({action:'record',date:$('record-date').value,kind:$('record-kind').value,body:$('record-body').value,sleep:$('record-sleep').value},event.target);};
$('profile-form').onsubmit=event=>{event.preventDefault();save({action:'profile',profile:Object.fromEntries(new FormData(event.target))},event.target);};
window.addEventListener('beforeunload',event=>{if(dirty||saving){event.preventDefault();event.returnValue='';}});
const deviceEndpoint='/api/personal/devices';
const localPreview=['localhost','127.0.0.1','::1'].includes(location.hostname);
$('capture-url').value=(localPreview?'https://c0ns1d2.com':location.origin)+'/api/personal/capture';
$('phone-environment').textContent=localPreview?'这是隔离预览。这里生成的凭证只对本机预览有效，不能用于正式站；手机配置需在正式站更新后登录生成。':'在这台 iPhone 上配置一次即可。站主电脑与网站通道需要保持在线。';
if(location.hash==='#iphone')$('iphone').open=true;
if(location.hash==='#ai-settings')$('ai-settings').open=true;
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
 aiProjectId=project.id;proposal=null;renderContextPreview();$('ai-decomposer').hidden=false;$('ai-project-title').textContent='拆解 · '+project.title;$('ai-context').value='';$('ai-results').hidden=true;$('ai-result-status').textContent='';$('ai-task-date').value=today;$('ai-decomposer').scrollIntoView({behavior:'smooth',block:'start'});
}
$('close-ai').onclick=()=>{if(!aiWorking)$('ai-decomposer').hidden=true;};
$('ai-breakdown-form').onsubmit=async event=>{
 event.preventDefault();if(aiWorking)return;aiWorking=true;const form=event.target;form.inert=true;$('ai-results').hidden=true;$('ai-result-status').textContent='DeepSeek 正在拆解，通常需要几秒到几十秒…';
 try{
  proposal=await request({projectId:aiProjectId,context:$('ai-context').value,includeBackground:$('use-background').checked,includeResources:$('use-resources').checked},'/api/personal/decompose');proposal.batchId=crypto.randomUUID();
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

function getResourceKinds(){return {material:'学习资料',course:'课程',device:'设备',tool:'软件与工具',support:'支持与人脉',other:'其他'};}
function renderResources(){
 const list=$('resource-list');list.replaceChildren();
 for(const resource of state.resources||[]){const card=node('article',undefined,'project-card');card.append(node('h3',resource.title),node('small',getResourceKinds()[resource.kind]+' · '+({available:'已经可用',planned:'计划获取',unavailable:'暂不可用'})[resource.status]));if(resource.detail)card.append(node('p',resource.detail,'preserve'));const project=(state.projects||[]).find(project=>project.id===resource.projectId);card.append(node('small',(project?project.title:'通用资源')+' · '+(resource.shareWithAI?'允许 AI 参考':'不供 AI 参考')),button('更新资源',()=>editResource(resource)));list.append(card);}
 if(!(state.resources||[]).length)list.append(node('p','还没有资源。先加入手头的教材、课件或设备。','muted'));
 const select=$('resource-project'),previous=select.value;select.replaceChildren(new Option('通用资源',''));for(const project of state.projects||[])select.add(new Option(project.title,project.id));select.value=previous;
}
function editResource(resource){
 const form=$('resource-form');if(dirtyForms.has(form)&&!confirm('放弃尚未保存的资源编辑？'))return;
 form.reset();for(const key of ['id','title','kind','status','projectId','detail'])form.elements[key].value=resource?.[key]??({kind:'material',status:'available'}[key]||'');form.elements.shareWithAI.checked=resource?.shareWithAI??true;dirtyForms.delete(form);dirty=dirtyForms.size>0;$('resource-editor').open=true;$('resource-editor').scrollIntoView({behavior:'smooth',block:'start'});form.elements.title.focus({preventScroll:true});
}
$('new-resource').onclick=()=>editResource(null);
$('resource-form').onsubmit=async event=>{event.preventDefault();const form=event.target;if(await save({action:'resource',...Object.fromEntries(new FormData(form)),shareWithAI:form.elements.shareWithAI.checked},form))$('resource-editor').open=false;};
function renderContextPreview(){
 const context=buildPersonalContext(state,aiProjectId,{includeBackground:$('use-background').checked,includeResources:$('use-resources').checked});
 const labels={focus:'近期重点',goals:'长期方向',about:'我的情况',availability:'可用时间',skills:'已有基础',constraints:'限制与偏好'};
 const lines=[];for(const [key,value] of Object.entries(context.background||{}))lines.push(labels[key]+'：'+value);
 for(const table of context.timetables||[])lines.push('课表 · '+table.schoolYear+' '+table.term+'：'+table.courses.map(course=>course.name+'（'+course.sessions.map(session=>(session.term||'')+'周'+'一二三四五六日'[session.weekday-1]+'第'+session.periods.join(',')+'节').join('；')+'）').join('；')+'。注意：未确认具体教学日期与钟点。');
 for(const notice of context.opportunities||[])lines.push('学校通知 · '+notice.published+' · '+notice.title+'（仅发布信息，截止时间需看原文）');
 for(const doc of context.documents||[])lines.push('资料 · '+doc.name+'（已提取文字片段）：'+doc.excerpt);
 for(const resource of context.resources||[])lines.push('资源 · '+resource.title+'：'+(resource.detail||'详情待补充'));
 if(context.omittedResourceCount)lines.push('另有 '+context.omittedResourceCount+' 项资源未加入，本次最多参考20项。');
 $('ai-context-preview').textContent=lines.join('\n\n')||'当前没有选中的背景或可用资源。你仍可以在补充说明中填写情况。';
}
$('use-background').onchange=renderContextPreview;$('use-resources').onchange=renderContextPreview;

let timetableFile='';
function renderTimetables(){const host=$('timetable-list');host.replaceChildren();for(const table of state.timetables||[]){const section=node('details',undefined,'personal-section');section.append(node('summary',table.schoolYear+' 学年 · '+table.term+' · '+table.courses.length+' 门课程'),node('small','教务课表 Excel · 导入于 '+new Date(table.importedAt).toLocaleString('zh-CN')));for(const limitation of table.limitations)section.append(node('p',limitation,'muted'));for(const course of table.courses){const row=node('article',undefined,'course-row');row.append(node('h4',course.name),node('p',course.code+' · '+course.terms.join(' / ')));for(const session of course.sessions)row.append(node('small',(session.term||'')+' · 周'+'一二三四五六日'[session.weekday-1]+' 第'+session.periods.join(',')+'节 · '+session.location));if(!course.sessions.length)row.append(node('small','源文件未提供上课时间'));section.append(row);}host.append(section);}}
$('timetable-form').onsubmit=async event=>{event.preventDefault();const file=$('timetable-file').files[0];if(!file)return;if(file.size>512*1024){$('timetable-status').textContent='请选择512KB以内的xlsx课表。';return;}const form=event.target;form.inert=true;$('import-timetable').hidden=true;$('timetable-preview').hidden=true;try{timetableFile=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('无法读取文件'));reader.readAsDataURL(file);});const {snapshot}=await request({action:'preview',file:timetableFile},'/api/personal/timetable');const preview=$('timetable-preview');preview.replaceChildren(node('h3',snapshot.schoolYear+' '+snapshot.term),node('p',snapshot.rawRowCount+' 条记录合并为 '+snapshot.courses.length+' 门课程。'));for(const warning of [...snapshot.limitations,...snapshot.warnings])preview.append(node('p',warning,'muted'));for(const course of snapshot.courses)preview.append(node('p',course.code+' · '+course.name+' · '+course.sessions.length+' 段上课安排'));preview.hidden=false;$('import-timetable').hidden=false;$('timetable-status').textContent='核对课程后确认导入。选课时间不会当成上课日期。';}catch(error){timetableFile='';$('timetable-status').textContent=error.message;}finally{form.inert=false;}};
$('import-timetable').onclick=async()=>{if(!timetableFile||saving)return;saving=true;$('import-timetable').disabled=true;try{state=await request({action:'import',file:timetableFile,revision:state.revision},'/api/personal/timetable');render();timetableFile='';$('timetable-preview').hidden=true;$('import-timetable').hidden=true;$('timetable-status').textContent='课表已导入。以后上传新版可更新同一学期，不会重复创建课程。';dirtyForms.delete($('timetable-form'));dirty=dirtyForms.size>0;}catch(error){$('timetable-status').textContent=error.message;}finally{saving=false;$('import-timetable').disabled=false;}};

$('timetable-file').onchange=()=>{timetableFile='';$('timetable-preview').hidden=true;$('import-timetable').hidden=true;$('timetable-status').textContent='请选择读取并预览，核对后导入。';};

function renderDocuments(){
 if([...dirtyForms].some(form=>$('document-list').contains(form)))return;
 const host=$('document-list');host.replaceChildren();
 for(const doc of state.documents||[]){const section=node('details',undefined,'personal-section');section.append(node('summary',doc.name),node('p',(doc.stale?'源文件读取失败，旧内容暂不供AI参考。':'已提取 '+doc.text.length+' 字')+' · '+doc.sourceName),node('p',doc.text.slice(0,1000),'preserve'));const form=document.createElement('form'),label=node('label','用于哪个项目'),select=document.createElement('select');select.add(new Option('通用资料',''));for(const project of state.projects||[])select.add(new Option(project.title,project.id));select.value=doc.projectId;label.append(select);const shared=node('label',undefined,'context-choice'),check=document.createElement('input');check.type='checkbox';check.checked=doc.shareWithAI;shared.append(check,node('span','允许AI参考文字片段'));const submit=node('button','保存资料设置','btn');submit.type='submit';form.append(label,shared,submit);form.onsubmit=event=>{event.preventDefault();save({action:'documentSetting',id:doc.id,projectId:select.value,shareWithAI:check.checked},form);};section.append(form);host.append(section);}
 if(!(state.documents||[]).length)host.append(node('p','还没有读入课件正文。文件被监测并提取后会出现在这里。','muted'));
}
function sourceSummary(source){return source?.status==='ready'?'已自动读取 '+source.count+' 条通知 · '+new Date(source.lastSuccess).toLocaleString('zh-CN'):(source?.error||'等待连接')+(source?.lastSuccess?' · 上次成功：'+new Date(source.lastSuccess).toLocaleString('zh-CN'):'');}
async function refreshImports(){
 if(importsRefreshing)return;importsRefreshing=true;
 try{const status=await request(undefined,'/api/personal/imports');$('import-health').textContent=status.error?'检查失败：'+status.error:status.running?'正在读取新增或变化的文件…':status.lastRun?'上次检查：'+new Date(status.lastRun).toLocaleString('zh-CN')+' · 每60秒自动检查':'等待首次检查';const sources=$('import-sources');sources.replaceChildren();for(const source of status.sources){const row=node('div',undefined,'personal-section');row.append(node('h3',source.name),node('p',source.path,'preserve'),node('small',source.kind==='file'?'自动监测这一个文件':'自动读取目录内新增或变化的PDF、DOCX、PPTX、TXT、MD和课表xlsx'));sources.append(row);}const school=$('school-source-status');school.replaceChildren(node('h3','学校与活动来源'),node('p','综合服务网：'+sourceSummary(status.webSource)),node('p','学工部：'+sourceSummary(status.studentSource)),node('p','ETA：'+(status.etaBrowserVerifiedAt?'浏览器访问已验证（'+new Date(status.etaBrowserVerifiedAt).toLocaleDateString('zh-CN')+'）；后台持续同步待连接':'登录连接待完成，尚未自动同步')),node('p','浙大钉与学在浙大：尚未自动下载课程资料'),node('p','微信公众号：尚未连接'));const files=$('import-files');files.replaceChildren();for(const file of status.files){files.append(node('p',file.name+' · '+({ready:'已读取',failed:'读取失败',reading:'正在读取'})[file.status]+(file.characters?' · '+file.characters+'字':'')+(file.error?'：'+file.error:'')));}}catch(error){$('import-health').textContent=error.message;}
 try{const latest=await request();$('connection').textContent='';if(latest.revision!==state?.revision){if(!dirty&&!saving&&!aiWorking){state=latest;render();}else $('reload-plans').hidden=false;}}catch(error){$('import-health').textContent=error.message;if(page==='now')$('connection').textContent='暂时无法同步，当前进度可能不是最新。'+error.message;}finally{importsRefreshing=false;}
}
function renderWorkStatus(){if(!state)return;$('work-status').textContent=(aiConfigured===null?'AI 状态待检查':aiConfigured?'AI 已配置':'AI 尚未配置')+' · '+(state.timetables||[]).reduce((n,t)=>n+t.courses.length,0)+' 门课程 · '+(state.documents||[]).filter(doc=>!doc.stale).length+' 份已读资料 · '+(state.tasks||[]).filter(t=>t.date===today&&!t.done).length+' 件今日待办';}
$('check-imports').onclick=async()=>{$('check-imports').disabled=true;try{await request({},'/api/personal/imports');await refreshImports();}catch(error){$('import-health').textContent=error.message;}finally{$('check-imports').disabled=false;}};
if(page==='now'||page==='import'){
 await refreshImports();
 try{aiConfigured=(await request(undefined,'/api/personal/ai')).configured;renderWorkStatus();}catch(error){$('work-status').textContent=error.message;}
 setInterval(refreshImports,15000);
}
if(page==='plans'){const id=new URLSearchParams(location.search).get('decompose'),project=state?.projects?.find(project=>project.id===id);if(project)openDecomposer(project);}
if(page==='me'&&location.hash==='#timetable')location.replace('/personal/import#timetable');

function renderNotices(){const all=$('all-notices');all.replaceChildren();for(const notice of (state.notices||[]).slice(0,150)){const row=node('article',undefined,'notice-row'),link=node('a',notice.title);link.href=notice.url;link.target='_blank';link.rel='noopener';row.append(link,node('small',notice.published+' · '+notice.source));all.append(row);}}

function renderTodayFocus(){
 const {upcoming,focus}=buildTodayFocus(state,today);
 $('day-direction').textContent=focus?'先推进'+focus.title+'。':'今天，做完一件重要的事。';
 $('day-reason').textContent=focus?(upcoming[1]?'先照顾更近的日期，再给'+upcoming[1].title+'留一点推进空间。':'围绕最近的关键日期，把下一步做具体。'):'完成一件，再决定下一件。';
 const host=$('deadline-list');host.replaceChildren();host.hidden=!upcoming.length;
 for(const [index,project] of upcoming.entries()){const card=node('article',undefined,'deadline-card');card.append(node('small',index===0?'最近的关键日期':'接下来'),node('h2',project.title));const formatted=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'}).format(new Date(project.deadline+'T12:00:00+08:00'));card.append(node('p',formatted+(project.deadlineDetail?' · '+project.deadlineDetail:'')),node('small',project.days===0?'日期在今天，完成情况待你确认':'还有 '+project.days+' 天'));const link=node('a','查看计划 →');link.href='/personal/plans#project-'+project.id;card.append(link);host.append(card);}
}
