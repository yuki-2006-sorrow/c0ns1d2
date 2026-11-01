const app=document.getElementById('app'), account=document.getElementById('account'), statusBox=document.getElementById('status');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setupToken=new URLSearchParams(location.hash.slice(1)).get('setup')||'';
if(location.hash)history.replaceState(null,'',location.pathname);
let me=null,records=[],people=[],filter='all',query='',dirty=false,submitting=false;
let catalogCache={groups:[],people:[]};
const notify=value=>{statusBox.textContent=value;};
statusBox.addEventListener('click',()=>notify(''));
window.addEventListener('beforeunload',event=>{if(dirty||submitting){event.preventDefault();event.returnValue='';}});
window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){const form=document.getElementById('entry-form')||document.getElementById('catalog-form');if(form){event.preventDefault();if(!submitting)form.requestSubmit();}}});
async function api(path,body,raw=false){
  const options=body===undefined?{}:{method:'POST',headers:{'X-Archive-Client':'1','Content-Type':raw?body.type:'application/json'},body:raw?body:JSON.stringify(body)};
  const controller=new AbortController(),timer=body===undefined?setTimeout(()=>controller.abort(),15000):null;
  options.signal=controller.signal;
  try{
    let response;
    try{response=await fetch(path,options);}catch{throw new Error(controller.signal.aborted?'连接等待过久，请稍后重试；当前输入仍保留。':'协作服务未连接。请确认站主电脑和协作后台正在运行，当前输入可以先保留。');}
    let data;
    try{data=await response.json();}catch{throw new Error(controller.signal.aborted?'连接等待过久，请稍后重试；当前输入仍保留。':'服务返回了无法读取的内容，请稍后重试；当前输入仍保留。');}
    if(response.status===401&&path!=='/api/login')throw Object.assign(new Error('登录已过期。请在新标签页打开 /shared 重新登录，再回到这里重试；不要刷新当前编辑页。'),{status:401});
    if(!response.ok)throw new Error(data.error||'请求失败');
    return data;
  }finally{if(timer!==null)clearTimeout(timer);}
}
function swap(html){if(dirty&&!confirm('当前文字尚未保存，是否离开？'))return false;dirty=false;app.innerHTML=html;return true;}
function formAction(form,action){form.addEventListener('submit',async event=>{
  event.preventDefault();if(submitting)return;
  const data=new FormData(form),button=form.querySelector('[type=submit]');
  submitting=true;app.inert=true;account.inert=true;form.setAttribute('aria-busy','true');
  if(button)button.disabled=true;notify('');
  const waiting=setTimeout(()=>notify('仍在处理，请保留此页，避免重复提交。'),4000);
  try{await action(data);}catch(error){notify(error.message);}
  finally{clearTimeout(waiting);if(statusBox.textContent==='仍在处理，请保留此页，避免重复提交。')notify('');submitting=false;app.inert=false;account.inert=false;form.removeAttribute('aria-busy');if(button)button.disabled=false;}
});}
function accountBar(){
  account.innerHTML=me?'<a class="button subtle" href="/materials">素材库</a><details class="account-more"><summary>'+escape(me.name)+'</summary><div id="more-actions"><button class="subtle" id="home">我的素材</button>'+(me.role==='owner'?'<button class="subtle" id="activity">改动记录</button><button class="subtle" id="organize">资料整理</button><button class="subtle" id="manage">成员与准入</button>':'')+'<button class="subtle" id="password">改密码</button><button class="subtle" id="logout">退出</button></div></details>':'<a class="button subtle" href="/">浏览帖子</a>';
  account.querySelector('#activity')?.addEventListener('click',()=>activity().catch(error=>notify(error.message)));
  account.querySelector('#organize')?.addEventListener('click',()=>organize().catch(error=>notify(error.message)));
  account.querySelector('#home')?.addEventListener('click',()=>loadLibrary().catch(e=>notify(e.message)));
  account.querySelector('#manage')?.addEventListener('click',()=>manage().catch(e=>notify(e.message)));
  account.querySelector('#password')?.addEventListener('click',passwordPage);
  account.querySelector('#logout')?.addEventListener('click',async()=>{if(dirty&&!confirm('尚未保存，是否退出？'))return;try{await api('/api/logout',{});dirty=false;me=null;records=[];people=[];notify('');await initialize();}catch(error){notify(error.message);}});
}
function passwordPage(){
  if(!swap('<section class="auth"><h1>更改密码</h1><form id="password-form"><label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>新密码（至少12个字符）<input name="password" type="password" minlength="12" autocomplete="new-password" required></label><button type="submit">保存并重新登录</button></form></section>'))return;
  formAction(document.getElementById('password-form'),async data=>{await api('/api/password',Object.fromEntries(data));me=null;await initialize();notify('密码已更改，请重新登录。');});
}
async function initialize(){
  const [state,profile]=await Promise.all([api('/api/status'),api('/api/me').catch(error=>{if(error.status===401)return null;throw error;})]);
  me=profile;
  accountBar();
  if(me)return enterRecords();
  if(!state.setup){
    app.innerHTML='<section class="auth"><p class="muted">建立这座共同创作空间</p><h1>设置站主账号</h1><p>建立账号后，即可收录素材、编排帖子并邀请共同创作。请在这台电脑上操作。</p>'+(!setupToken?'<p class="notice">请双击项目里的“启动.bat”，从它打开的页面完成初始化。</p>':'<form id="setup"><label>账号（字母、数字、下划线）<input name="username" autocomplete="username" required pattern="[a-zA-Z0-9_-]{3,40}"></label><label>昵称<input name="name" required maxlength="60"></label><label>密码（至少12个字符）<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><label>再输入一次密码<input name="repeat" type="password" autocomplete="new-password" minlength="12" required></label><div class="actions"><button type="submit">建立站主账号</button></div></form>')+'</section>';
    const form=document.getElementById('setup');
    if(form)formAction(form,async data=>{if(data.get('password')!==data.get('repeat'))throw new Error('两次密码不一致');me=(await api('/api/setup',{...Object.fromEntries(data),token:setupToken})).user;accountBar();await manage();});
    return;
  }
  app.innerHTML='<section class="auth"><p class="muted">每个人留下自己的那一部分</p><h1>共同留下</h1><form id="login"><label>账号<input name="username" autocomplete="username" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><div class="actions"><button type="submit">登录</button>'+(state.ready?'<button class="subtle" id="join" type="button">回答问题，加入创作空间</button>':'<span class="muted">站主尚未开放问答入口</span>')+'</div></form><p class="notice">'+escape(state.notice)+'</p><small>忘记密码时，请联系站主重置。</small></section>';
  formAction(document.getElementById('login'),async data=>{me=(await api('/api/login',Object.fromEntries(data))).user;accountBar();await enterRecords();});
  document.getElementById('join')?.addEventListener('click',()=>registration(state));
  if(state.ready&&new URLSearchParams(location.search).get('join')==='1')registration(state);
}
function registration(state){
  app.innerHTML='<section class="auth"><h1>从几个问题开始</h1><p class="muted">回答至少 '+state.threshold+' 题正确后，可以建立个人账号。</p><p class="notice">'+escape(state.notice)+'</p><form id="register">'+state.questions.map(q=>'<label>'+escape(q.text)+'<input name="answer-'+escape(q.id)+'" autocomplete="off"></label>').join('')+'<label>账号<input name="username" autocomplete="username" pattern="[a-zA-Z0-9_-]{3,40}" required></label><label>昵称<input name="name" maxlength="60" required></label><label>密码（至少12个字符）<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><label>再输入一次密码<input name="repeat" type="password" autocomplete="new-password" required></label><label class="checkbox"><input name="consent" type="checkbox" required>我已知悉站主可以管理、查看本机保存的内容。</label><div class="actions"><button type="submit">核对答案并加入</button><button type="button" id="back-login" class="subtle">返回登录</button></div></form></section>';
  document.getElementById('back-login').onclick=()=>{const next=new URL(location.href);next.searchParams.delete('join');history.replaceState(null,'',next);initialize().catch(e=>notify(e.message));};
  formAction(document.getElementById('register'),async data=>{if(data.get('password')!==data.get('repeat'))throw new Error('两次密码不一致');const answers=Object.fromEntries(state.questions.map(q=>[q.id,data.get('answer-'+q.id)]));me=(await api('/api/register',{username:data.get('username'),name:data.get('name'),password:data.get('password'),consent:!!data.get('consent'),answers})).user;accountBar();await enterRecords();});
}
async function enterRecords(){
  if(me.role!=='owner'&&!me.canCreate){if(new URLSearchParams(location.search).get('view')==='password')return passwordPage();location.assign('/');return;}
  const request=new URLSearchParams(location.search),id=request.get('edit')||request.get('from'),create=request.get('new');
  if(!id&&!create){
    if(request.get('view')==='topic-new'&&me.role==='owner')return createTopic();
    if(request.get('view')==='organize'&&me.role==='owner')return organize();
    if(request.get('view')==='activity'&&me.role==='owner')return activity();
    if(request.get('view')==='manage'&&me.role==='owner')return manage();
    if(request.get('view')==='password')return passwordPage();
    if(['studio','materials'].includes(request.get('return'))){location.assign('/'+request.get('return'));return;}
    if(request.get('return')==='home'){submitting=false;location.assign('/');return;}
  }
  if(['event','work','thought'].includes(create))filter=create;
  await loadLibrary();
  if(!id&&['event','work','thought'].includes(create)){
    if(!me.canCreate)return notify('目前还没有投稿资格，可以先浏览或联系站主。');
    return edit({type:create,medium:request.get('topic')||'',scope:'private',recipients:[],images:[],videos:[],date:'?',title:'',body:''});
  }
  if(!id)return;const entry=records.find(entry=>entry.id===id);
  if(!entry)return notify('这份素材不存在或当前无权访问。');
  if(request.has('edit')){if(entry.editable)edit(entry);else await read(entry.id);}
  else if(me.canCreate&&entry.type!=='thought')edit({type:'thought',fromId:entry.id,toId:'',scope:'private',recipients:[],images:[],videos:[],date:'?',title:'',body:''});
  else notify('目前还没有投稿资格，可以先浏览或联系站主。');
}

async function loadLibrary(){
  const viewer=me?.id;
  const [nextRecords,nextPeople,nextMe,nextCatalog]=await Promise.all([api('/api/entries'),api('/api/members'),api('/api/me'),api('/api/catalog')]);
  if(me?.id!==viewer)return;
  if(!swap('<h1>我的素材</h1><p class="muted">这里只管理创作素材；帖子请在创作台编排和发布。</p><div class="toolbar"><input id="search" aria-label="搜索我的素材" placeholder="搜索标题或文字">'+(nextMe.canCreate?'<button id="create">＋ 收录素材</button>':'')+'</div><div class="grid" id="entries"></div>'))return;
  me=nextMe;records=nextRecords;people=nextPeople;catalogCache=nextCatalog;
  document.getElementById('search').value=query;
  document.getElementById('search').oninput=event=>{query=event.target.value;renderList();};
  document.getElementById('create')?.addEventListener('click',()=>edit({type:'event',scope:'private',recipients:[],images:[],videos:[],date:'?',title:'',body:''}));
  renderList();
}
const scopeLabel=entry=>!entry.published?'草稿':entry.scope==='private'?'仅作者':entry.scope==='selected'?'指定成员':'创作者可引用';
function renderList(){
  const filtered=records.filter(entry=>entry.editable&&(entry.title+' '+entry.body).toLowerCase().includes(query.toLowerCase()));
  const container=document.getElementById('entries');
  container.innerHTML=filtered.length?filtered.map(entry=>'<button class="card" data-entry="'+escape(entry.id)+'"><small>'+escape(entry.date)+' · '+escape(entry.authorName)+'</small><h2>'+escape(entry.title)+'</h2><p>'+escape(entry.body.slice(0,180))+'</p><small class="end">'+escape(entry.medium?groupLabel(entry.medium)+' · ':'')+scopeLabel(entry)+(entry.editable?' · 我的原文':'')+' ↗</small></button>').join(''):'<p class="search-empty">这里还没有你写下的记录。'+(me.canCreate?'点“收录素材”开始。':'站主可以为你开放内容或投稿权限。')+'</p>';
  container.querySelectorAll('[data-entry]').forEach(button=>button.onclick=()=>read(button.dataset.entry).catch(e=>notify(e.message)));
}
function mediaUrl(entry,reference,index){
  if(/^https:\/\/aka\.doubaocdn\.com\//.test(reference))return '/api/remote-image?id='+encodeURIComponent(entry.id)+'&index='+index;
  if(/^https:\/\/[^\s]+$/.test(reference)||/^\/api\/media\/[a-f0-9-]+$/.test(reference))return reference;
  if(reference.startsWith('/photos/'))return '/api/legacy-media?id='+encodeURIComponent(entry.id)+'&index='+index;
  return '';
}
async function read(id){
  const viewer=me?.id;
  const [entry,latestRecords]=await Promise.all([api('/api/entry?id='+encodeURIComponent(id)),api('/api/entries')]);
  if(me?.id!==viewer)return;
  records=latestRecords;
  if(!swap('<section class="reading"><button class="subtle" id="back">← 返回</button><p class="muted">'+escape(entry.date)+' · '+escape(entry.authorName)+' · '+scopeLabel(entry)+'</p><h1>'+escape(entry.title)+'</h1><div class="prose">'+escape(entry.body)+'</div><div class="media">'+entry.images.map((ref,index)=>{const url=mediaUrl(entry,ref,index);return url?'<a href="'+escape(url)+'" target="_blank" rel="noopener"><img src="'+escape(url)+'" alt="素材照片" loading="lazy"></a>':'';}).join('')+entry.videos.map(ref=>/^\/api\/media\/[a-f0-9-]+$/.test(ref)?'<video controls preload="metadata" src="'+escape(ref)+'"></video>':'').join('')+'</div><div class="actions">'+(entry.editable?'<button id="edit">编辑</button>':'')+(entry.editable||me.role==='owner'?'<button class="subtle" id="history">修改历史</button><button class="subtle" id="archive">移入回收站</button>':'')+'</div><div id="history-list"></div></section>'))return;
  const extraActions=document.createElement('details');extraActions.className='reading-options';extraActions.innerHTML='<summary>更多操作</summary>';
  for(const key of ['history','archive']){const button=document.getElementById(key);if(button)extraActions.append(button);}
  if(extraActions.childElementCount>1)document.getElementById('history-list').before(extraActions);
  document.getElementById('back').onclick=()=>loadLibrary().catch(e=>notify(e.message));
  const connections=document.createElement('nav');connections.className='actions';connections.setAttribute('aria-label','这段想法的关联');
  for(const [key,label]of [['fromId','从这里出发'],['toId','又想到']]){
    const target=records.find(record=>record.id===entry[key]);
    if(target){const button=document.createElement('button');button.className='subtle';button.textContent=label+' · '+target.title;button.onclick=()=>read(target.id).catch(e=>notify(e.message));connections.append(button);}
  }
  if(connections.childElementCount)app.querySelector('.prose').after(connections);
  document.getElementById('edit')?.addEventListener('click',()=>edit(entry));
  document.getElementById('archive')?.addEventListener('click',async()=>{if(!confirm('把这份素材移入可恢复的回收站？'))return;try{await api('/api/archive',{id,revision:entry.revision,archived:true});await loadLibrary();}catch(e){notify(e.message);}});
  document.getElementById('history')?.addEventListener('click',async()=>{try{const revisions=await api('/api/history?id='+id);document.getElementById('history-list').innerHTML=revisions.length?revisions.slice().reverse().map(h=>'<details><summary>'+escape(h.at)+' · '+escape(h.actorName||'原账号')+'</summary><h3>'+escape(h.entry.title)+'</h3><pre>'+escape(h.entry.body)+'</pre><small>可复制历史文字，回到自己的编辑页保存。</small></details>').join(''):'<p class="muted">还没有更早的版本。</p>';}catch(e){notify(e.message);}});
}
function edit(entry){
  if(!swap('<section class="reading"><h1>'+ (entry.id?'编辑素材':'收录素材')+'</h1><form id="entry-form"><label>标题<input name="title" required maxlength="300" value="'+escape(entry.title)+'"></label><input type="hidden" name="type"><div><label>时间（记不清可填 ?）<input name="date" value="'+escape(entry.date||'?')+'"></label></div><div id="work-kind" hidden><label>素材类别<select name="kind"><option value="book">书</option><option value="film">电影</option><option value="game">游戏</option></select></label></div><div id="thought-links"><p class="muted">关联可以留空；引用的记录也需获准阅读，才能看到这段关联想法。</p>'+['fromId','toId'].map(key=>'<label>'+(key==='fromId'?'从哪段素材或作品出发':'又想到了哪段素材或作品')+'<select name="'+key+'"><option value="">暂不关联</option>'+records.filter(record=>record.type!=='thought').map(record=>'<option value="'+record.id+'">'+escape(record.title)+'</option>').join('')+'</select></label>').join('')+'</div><label>文字<textarea name="body" rows="15">'+escape(entry.body)+'</textarea></label><label>添加图片、音频或视频<input id="files" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,audio/mpeg,audio/ogg,audio/wav,audio/mp4" '+(!me.canCreate?'disabled':'')+'></label><p class="muted">单个文件不超过500MB。上传后还需保存素材，才会随分享设置开放。</p><div id="attachments"></div><details><summary>素材整理信息</summary><label>素材分组<input name="medium" value="'+escape(entry.medium||'')+'"></label><label>参与人（逗号分隔）<input name="persons" value="'+escape((entry.persons||[]).join('，'))+'"></label><label class="checkbox"><input name="major" type="checkbox" '+(entry.major?'checked':'')+'>标记为重点素材</label></details><label>分享范围<select name="scope"><option value="private">仅自己（站主仍可管理）</option><option value="members">有权限的创作者</option><option value="selected">指定成员</option></select></label><label id="recipient-label">分享给谁<select name="recipients" multiple size="5">'+people.filter(person=>person.id!==me.id).map(person=>'<option value="'+escape(person.id)+'">'+escape(person.name)+'</option>').join('')+'</select></label><label class="checkbox"><input name="published" type="checkbox" '+(entry.published?'checked':'')+'>允许有权限的创作者引用（不勾选则保留私有草稿）</label><div class="actions"><button type="submit">保存素材</button><button type="button" class="subtle" id="cancel">返回</button></div></form></section>'))return;
  const form=document.getElementById('entry-form');
  const materialLabel=document.createElement('label');materialLabel.textContent='素材类型';const materialType=document.createElement('select');materialType.name='materialKind';for(const [value,label]of [['event','经历'],['chat','聊天记录'],['thought','想法'],['opinion','观点'],['essay','随笔'],['image','图片'],['video','视频'],['audio','音频']]){const option=document.createElement('option');option.value=value;option.textContent=label;materialType.append(option);}materialType.value=entry.materialKind||'event';materialLabel.append(materialType);form.elements.title.closest('label').before(materialLabel);
  const introduction=document.createElement('details');introduction.innerHTML='<summary>列表介绍（可选）</summary><label>留空时自动取正文开头<textarea name="summary" rows="3">'+escape(entry.summary||'')+'</textarea></label>';form.elements.body.closest('label').after(introduction);
  const groupInput=form.elements.medium,groupSelect=document.createElement('select');groupSelect.name='medium';groupSelect.innerHTML='<option value="">先放在未归专题</option>'+catalogCache.groups.map(group=>'<option value="'+escape(group.slug)+'">'+escape(groupLabel(group.slug))+'</option>').join('')+(entry.medium&&!catalogCache.groups.some(group=>group.slug===entry.medium)?'<option value="'+escape(entry.medium)+'">'+escape(entry.medium)+'</option>':'');groupInput.replaceWith(groupSelect);groupSelect.value=entry.medium||'';
  form.elements.type.value=entry.type;form.elements.scope.value=entry.scope;
  form.elements.kind.value=entry.kind||'book';
  form.elements.fromId.value=entry.fromId||'';form.elements.toId.value=entry.toId||'';
  const showType=()=>{form.elements.title.required=form.elements.type.value!=='thought';form.elements.title.placeholder=form.elements.type.value==='thought'?'可留空，自动取文字开头':'';document.getElementById('work-kind').hidden=true;document.getElementById('thought-links').hidden=form.elements.type.value!=='thought';};showType();form.elements.type.onchange=showType;
  [...form.elements.recipients.options].forEach(option=>option.selected=entry.recipients.includes(option.value));
  const more=document.createElement('details');more.className='editor-options';more.innerHTML='<summary>更多选项</summary>';
  const grouping=form.elements.persons.closest('details');
  const topicLabel=form.elements.medium.closest('label');form.elements.title.closest('label').before(topicLabel);
  more.append(document.getElementById('work-kind'),document.getElementById('thought-links'),grouping,introduction);
  const sharing=document.createElement('details');sharing.className='editor-sharing';
  const sharingSummary=document.createElement('summary');sharing.append(sharingSummary);
  const scope=form.elements.scope.closest('label'),recipients=document.getElementById('recipient-label'),publish=form.elements.published.closest('label');
  const visitor=form.elements.visitorVisible?.closest('label');
  sharing.append(scope,recipients,publish);if(visitor)sharing.append(visitor);
  const actions=form.querySelector('.actions');actions.before(sharing,more);
  const visibility=()=>{
    sharingSummary.textContent='谁能看到：'+(!form.elements.published.checked?'仅自己 · 草稿':form.elements.scope.value==='private'?'仅自己':form.elements.scope.value==='selected'?'指定成员':'有权限的创作者')+' · 点击调整';
  };
  visibility();form.addEventListener('change',visibility);
  const hint=document.createElement('p');hint.className='muted';hint.textContent='收录一份素材，供创作者在剪辑台中引用。成品需在剪辑台单独发布。';form.before(hint);
  form.elements.body.rows=8;
  const images=[...entry.images],videos=[...entry.videos];
  const attachments=()=>{document.getElementById('attachments').innerHTML=[...images.map((url,index)=>({url,index,kind:'image'})),...videos.map((url,index)=>({url,index,kind:'video'}))].map(item=>'<p>'+(item.kind==='image'?'<img class="attachment-preview" src="'+escape(mediaUrl(entry,item.url,item.index))+'" alt="照片预览">':'')+'<span class="muted">'+(item.kind==='image'?'照片':'视频')+' '+(item.index+1)+'</span> <button type="button" class="subtle" data-remove="'+item.kind+':'+item.index+'">移除引用</button></p>').join('');document.querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{const [kind,index]=button.dataset.remove.split(':');(kind==='image'?images:videos).splice(Number(index),1);dirty=true;attachments();});};
  attachments();
  const showScope=()=>document.getElementById('recipient-label').hidden=form.elements.scope.value!=='selected';showScope();form.elements.scope.onchange=showScope;
  form.addEventListener('input',()=>dirty=true);form.addEventListener('change',()=>dirty=true);
  let uploading=false;
  document.getElementById('files').onchange=async event=>{
    if(uploading)return;uploading=true;event.target.disabled=true;form.querySelector('[type=submit]').disabled=true;
    const files=Array.from(event.target.files),failed=[];let completed=0;
    try{for(const [index,file] of files.entries()){
      try{if(file.size>500*1024*1024)throw new Error('单个文件不超过500MB');
        notify('正在上传 '+(index+1)+' / '+files.length+'：'+file.name);
        const result=await api('/api/upload?name='+encodeURIComponent(file.name),file,true);
        (file.type.startsWith('video/')||file.type.startsWith('audio/')?videos:images).push(result.url);completed++;dirty=true;attachments();
      }catch(error){failed.push(file.name+'：'+error.message);}
    }notify('已上传 '+completed+' / '+files.length+'，请保存素材。'+(failed.length?'\n未完成：\n'+failed.join('\n'):''));
    }finally{uploading=false;form.querySelector('[type=submit]').disabled=false;event.target.disabled=false;event.target.value='';}
  };
  document.getElementById('cancel').onclick=()=>loadLibrary().catch(e=>notify(e.message));
  formAction(form,async data=>{if(uploading)throw new Error('请等待上传完成');const saved=await api('/api/entry',{id:entry.id,revision:entry.revision,title:data.get('title'),date:data.get('date'),body:data.get('body'),summary:data.get('summary'),type:data.get('type'),materialKind:data.get('materialKind'),kind:data.get('kind'),fromId:data.get('fromId'),toId:data.get('toId'),scope:data.get('scope'),recipients:data.getAll('recipients'),published:!!data.get('published'),visitorVisible:!!data.get('visitorVisible'),medium:data.get('medium'),persons:String(data.get('persons')).split(/[,，]/).map(p=>p.trim()).filter(Boolean),major:!!data.get('major'),images,videos});dirty=false;await read(saved.id);notify('已保存，网站会按分享范围立即显示。');});
}
function createTopic(){
  if(me?.role!=='owner')return;
  if(!swap('<section class="reading"><h1>新建专题</h1><p class="muted">围绕一件事，把照片、回忆、作品和想法放在一起。例如“毕业那年”或“一起看过的电影”。</p><form id="catalog-form"><label>专题名称<input name="title" required maxlength="300" placeholder="给这段经历起个名字"></label><div class="actions"><button type="submit">创建专题</button><a class="button subtle" href="/topics">返回专题</a></div></form></section>'))return;
  const form=document.getElementById('catalog-form');
  form.addEventListener('input',()=>dirty=true);
  formAction(form,async values=>{const saved=await api('/api/catalog',{kind:'group',title:values.get('title'),parent:''});dirty=false;submitting=false;location.assign('/topics/'+encodeURIComponent(saved.slug));});
}
function groupLabel(id){const titles=[],visited=new Set();while(id&&!visited.has(id)){visited.add(id);const group=catalogCache.groups.find(item=>item.slug===id);titles.unshift(group?.title||id);id=group?.parent;}return titles.join(' / ');}
async function organize(tab='records',selected='',recordFilters={}){
  if(me?.role!=='owner')return;
  const viewer=me.id;
  const [entries,catalog,overview]=await Promise.all([api('/api/entries'),api('/api/catalog'),api('/api/manage')]);
  if(me?.id!==viewer)return;
  if(!swap('<h1>整理创作空间</h1><p class="muted">在这里整理记录、专题和人物，保存后网站会直接显示更新。</p><div class="toolbar tabs" id="organize-tabs"></div><div id="organize-body"></div>'))return;
  records=entries;catalogCache=catalog;
  document.getElementById('organize-tabs').innerHTML=[['records','记录整理'],['group','专题'],['person','人物档案']].map(([key,label])=>'<button class="subtle" data-organize="'+key+'" aria-pressed="'+(tab===key)+'">'+label+'</button>').join('')+'<a class="button subtle" href="/api/export" download>导出文字资料</a><button class="subtle" id="organize-back">返回创作空间</button>';
  document.querySelectorAll('[data-organize]').forEach(button=>button.onclick=()=>organize(button.dataset.organize).catch(error=>notify(error.message)));
  document.getElementById('organize-back').onclick=()=>loadLibrary().catch(error=>notify(error.message));
  if(tab==='records')return organizeRecords([...entries,...overview.archived],recordFilters);
  const items=catalog[tab==='group'?'groups':'people'],host=document.getElementById('organize-body');
  host.innerHTML='<section class="panel"><label>选择'+(tab==='group'?'专题':'人物')+'<select id="catalog-select"><option value="">＋ 新增</option>'+items.map(item=>'<option value="'+escape(item.slug)+'">'+escape(tab==='group'?groupLabel(item.slug):item.name)+'</option>').join('')+'</select></label><div id="catalog-editor"></div></section>';
  const chooser=document.getElementById('catalog-select');chooser.value=selected;
  let current=selected;
  const draw=()=>{
    const item=items.find(item=>item.slug===chooser.value)||{};current=chooser.value;
    const traits=[['openness','开放性'],['conscientiousness','尽责性'],['extraversion','外向性'],['agreeableness','宜人性'],['neuroticism','神经质']];
    document.getElementById('catalog-editor').innerHTML='<form id="catalog-form">'+(tab==='group'?'<label>专题名称<input name="title" maxlength="300" required value="'+escape(item.title)+'"></label><label>上级专题<select name="parent"><option value="">无（最外层）</option>'+catalog.groups.filter(group=>group.slug!==item.slug).map(group=>'<option value="'+escape(group.slug)+'">'+escape(groupLabel(group.slug))+'</option>').join('')+'</select></label><p class="muted">修改名称后，专题里的记录会继续保留。</p>':'<p class="notice">人物侧写目前仅站主可见。</p><label>姓名<input name="name" maxlength="100" required '+(item.slug?'readonly':'')+' value="'+escape(item.name)+'"></label>'+[['nickname','昵称'],['university','学校'],['major','专业'],['role','身份或关系']].map(([key,label])=>'<label>'+label+'<input name="'+key+'" maxlength="300" value="'+escape(item[key])+'"></label>').join('')+'<label>人物侧写<textarea name="body" rows="16">'+escape(item.body)+'</textarea></label><details><summary>大五人格数值（可选）</summary><div class="trait-inputs">'+traits.map(([key,label])=>'<label>'+label+'<input name="'+key+'" type="number" min="0" max="100" value="'+escape(item.personality?.[key]??0)+'"></label>').join('')+'</div></details>')+'<div class="actions"><button type="submit">保存'+(tab==='group'?'分组':'人物档案')+'</button></div></form>';
    const form=document.getElementById('catalog-form');if(tab==='group')form.elements.parent.value=item.parent||'';
    form.addEventListener('input',()=>dirty=true);form.addEventListener('change',()=>dirty=true);
    formAction(form,async values=>{const data={...Object.fromEntries(values),kind:tab,slug:item.slug,revision:item.revision};if(tab==='person')data.personality=Object.fromEntries(traits.map(([key])=>[key,Number(values.get(key))]));const saved=await api('/api/catalog',data);dirty=false;await organize(tab,saved.slug);notify('已保存到统一资料库。');});
  };
  chooser.onchange=()=>{if(dirty&&!confirm('当前文字尚未保存，是否切换？')){chooser.value=current;return;}dirty=false;draw();};draw();
}
function organizeRecords(all,initial={}){
  const host=document.getElementById('organize-body'),selection=new Map();
  host.innerHTML='<div class="toolbar"><input id="organize-query" type="search" aria-label="搜索记录" placeholder="搜索标题、正文或参与人"><select id="organize-type" aria-label="记录类型"><option value="event">素材</option><option value="work">作品</option><option value="thought">想法</option><option value="">全部类型</option></select><select id="organize-source" aria-label="记录来源"><option value="">全部来源</option><option value="auto">自动生成</option><option value="manual">其他记录</option></select><select id="organize-state" aria-label="记录状态"><option value="active">全部在用记录</option><option value="draft">草稿</option><option value="published">可供引用</option><option value="archived">回收站</option></select></div><div class="organize-controls"><label><input type="checkbox" id="organize-all">选择当前结果</label><span id="organize-count" class="muted" role="status"></span><button type="button" class="subtle" id="organize-clear">取消选择</button><button type="button" id="organize-apply" disabled>移入回收站</button></div><div id="organize-rows"></div>';
  let visible=[];
  const queryBox=document.getElementById('organize-query'),type=document.getElementById('organize-type'),source=document.getElementById('organize-source'),state=document.getElementById('organize-state'),allBox=document.getElementById('organize-all'),apply=document.getElementById('organize-apply');
  queryBox.value=initial.query||'';type.value=initial.type??'event';source.value=initial.source||'';state.value=initial.state||'active';apply.textContent=state.value==='archived'?'恢复素材':'移入回收站';
  const updateCount=()=>{document.getElementById('organize-count').textContent='当前 '+visible.length+' 条 · 已选 '+selection.size+' 条';apply.disabled=!selection.size;allBox.checked=!!visible.length&&visible.every(entry=>selection.has(entry.id));allBox.indeterminate=visible.some(entry=>selection.has(entry.id))&&!allBox.checked;};
  const draw=()=>{
    const term=queryBox.value.trim().toLowerCase();
    visible=all.filter(entry=>(!type.value||entry.type===type.value)&&(!term||(entry.title+' '+entry.body+' '+(entry.persons||[]).join(' ')).toLowerCase().includes(term))&&(!source.value||(source.value==='auto'?(entry.sourceKind==='auto'||entry.source?.startsWith('auto/')):entry.sourceKind!=='auto'&&!entry.source?.startsWith('auto/')))&&(state.value==='archived'?entry.archived:!entry.archived&&(state.value==='active'||(state.value==='draft'?!entry.published:entry.published))));
    document.getElementById('organize-rows').innerHTML=visible.length?visible.map(entry=>'<div class="organize-row"><label><input type="checkbox" data-select="'+escape(entry.id)+'" '+(selection.has(entry.id)?'checked':'')+'><span><strong>'+escape(entry.title)+'</strong><small>'+escape(entry.date)+' · '+scopeLabel(entry)+' · '+entry.images.length+' 张照片</small></span></label>'+(!entry.archived?'<button type="button" class="subtle" data-open="'+escape(entry.id)+'">查看</button>':'')+'</div>').join(''):'<p class="search-empty">当前条件下没有记录。</p>';
    document.querySelectorAll('[data-select]').forEach(box=>box.onchange=()=>{const entry=all.find(entry=>entry.id===box.dataset.select);if(box.checked)selection.set(entry.id,entry);else selection.delete(entry.id);updateCount();});
    document.querySelectorAll('[data-open]').forEach(button=>button.onclick=()=>read(button.dataset.open).catch(error=>notify(error.message)));updateCount();
  };
  queryBox.oninput=draw;type.onchange=draw;source.onchange=draw;state.onchange=()=>{selection.clear();apply.textContent=state.value==='archived'?'恢复素材':'移入回收站';draw();};
  allBox.onchange=()=>{for(const entry of visible){if(allBox.checked)selection.set(entry.id,entry);else selection.delete(entry.id);}draw();};document.getElementById('organize-clear').onclick=()=>{selection.clear();draw();};
  apply.onclick=async()=>{
    if(submitting||!selection.size)return;
    const items=[...selection.values()],archived=state.value!=='archived';
    if(!confirm((archived?'移入可恢复的回收站':'恢复')+' '+items.length+' 条记录？\n'+items.slice(0,8).map(entry=>entry.date+' · '+entry.title).join('\n')+(items.length>8?'\n…':'')))return;
    submitting=true;app.inert=true;account.inert=true;
    try{await api('/api/archive-batch',{items:items.map(({id,revision})=>({id,revision})),archived});await organize('records','',{query:queryBox.value,type:type.value,source:source.value,state:state.value});notify('已'+(archived?'移入回收站':'恢复')+' '+items.length+' 条记录。');}catch(error){notify(error.message);}finally{submitting=false;app.inert=false;account.inert=false;}
  };draw();
}
async function manage(){
  const viewer=me?.id;
  const [data,managedRecords]=await Promise.all([api('/api/manage'),api('/api/entries')]);records=managedRecords;
  if(me?.id!==viewer)return;
  if(!swap('<h1>管理这座创作空间</h1><p class="muted">管理账号、创作者权限与素材回收站。帖子在创作台编排，发布后才对访客可见。</p><section class="panel"><h2>问答准入</h2><p class="muted">答案只在服务器核对。编辑已有题目时，请重新填写可接受答案；一行一个说法。新设置只影响新成员。</p><form id="settings"><div id="questions"></div><button type="button" class="subtle" id="add-question">＋ 增加题目</button><div class="form-row"><label>至少答对几题<input name="threshold" type="number" min="1" max="10" value="'+(data.settings.threshold||1)+'" required></label><label>通过后的默认阅读范围<select name="defaultAccess"><option value="selected">仅被指定分享给他的内容</option><option value="all">全部共同内容（不含他人定向或私人记录）</option></select></label></div><label class="checkbox"><input name="defaultCreate" type="checkbox" '+(data.settings.defaultCreate?'checked':'')+'>通过后授予创作者权限（可进入素材库与剪辑台）</label><div class="actions"><button type="submit">保存准入规则</button></div></form></section><section class="panel"><h2>成员与权限</h2><label>选择成员<select id="member-select"><option value="">请选择</option>'+data.members.filter(user=>user.role!=='owner').map(user=>'<option value="'+user.id+'">'+escape(user.name)+'（'+escape(user.username)+'）</option>').join('')+'</select></label><div id="member-editor"></div></section><section class="panel"><h2>回收站</h2><div id="trash"></div></section><details><summary>最近操作记录</summary><a href="/shared?view=activity">查看具体改动 →</a><div id="audit"></div></details>'))return;
  const settings=document.getElementById('settings'),questions=document.getElementById('questions');
  settings.elements.defaultAccess.value=data.settings.defaultAccess;
  function addQuestion(text=''){const block=document.createElement('div');block.className='question';block.innerHTML='<label>题目<input class="question-text" value="'+escape(text)+'" required maxlength="500"></label><label>可接受答案（一行一个）<textarea class="question-answers" required autocomplete="off"></textarea></label><button type="button" class="subtle">移除此题</button>';block.querySelector('button').onclick=()=>{block.remove();dirty=true;};questions.append(block);}
  (data.settings.questions.length?data.settings.questions:[{text:''}]).forEach(q=>addQuestion(q.text));
  document.getElementById('add-question').onclick=()=>{if(questions.children.length>=10)return notify('最多10题');addQuestion();dirty=true;};
  settings.addEventListener('input',()=>dirty=true);settings.addEventListener('change',()=>dirty=true);
  formAction(settings,async values=>{await api('/api/settings',{questions:[...questions.children].map(q=>({text:q.querySelector('input').value,answers:q.querySelector('textarea').value.split('\n').map(a=>a.trim()).filter(Boolean)})),threshold:Number(values.get('threshold')),defaultAccess:values.get('defaultAccess'),defaultCreate:!!values.get('defaultCreate')});dirty=false;notify('问答规则已保存；新访客可以回答问题并加入。');});
  document.getElementById('member-select').onchange=event=>{
    const user=data.members.find(user=>user.id===event.target.value),host=document.getElementById('member-editor');
    if(!user){host.innerHTML='';return;}
    host.innerHTML='<p class="muted">加入：'+escape(user.createdAt)+'<br>最近登录：'+escape(user.lastLogin||'尚无')+'</p><form id="member-form"><label>阅读权限<select name="access"><option value="selected">指定内容</option><option value="all">全部共同内容</option><option value="blocked">停用账号</option></select></label><label class="checkbox"><input name="canCreate" type="checkbox" '+(user.canCreate?'checked':'')+'>创作者权限（可进入素材库与剪辑台）</label><label>单独开放共同记录<select name="grants" multiple size="7">'+records.filter(e=>e.published&&e.scope==='members').map(e=>'<option value="'+e.id+'">'+escape(e.title)+'</option>').join('')+'</select></label><div class="actions"><button type="submit">保存成员权限</button></div></form><details><summary>为此成员重设密码</summary><form id="reset-password"><label>新密码（至少12个字符）<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><button type="submit">重设并退出该成员的全部登录</button></form></details>';
    const form=document.getElementById('member-form');form.elements.access.value=user.access;[...form.elements.grants.options].forEach(option=>option.selected=(user.grants||[]).includes(option.value));
    formAction(form,async values=>{await api('/api/member',{id:user.id,access:values.get('access'),canCreate:!!values.get('canCreate'),grants:values.getAll('grants')});notify('成员权限已更新。');});
    formAction(document.getElementById('reset-password'),async values=>{await api('/api/password',{id:user.id,password:values.get('password')});notify('密码已重设；请自行把新密码交给这位成员。');});
  };
  document.getElementById('trash').innerHTML=data.archived.length?data.archived.map(entry=>'<p>'+escape(entry.title)+' <button class="subtle" data-restore="'+entry.id+'">恢复</button></p>').join(''):'<p class="muted">回收站为空</p>';
  document.querySelectorAll('[data-restore]').forEach(button=>button.onclick=async()=>{try{const entry=data.archived.find(entry=>entry.id===button.dataset.restore);await api('/api/archive',{id:entry.id,revision:entry.revision,archived:false});await manage();}catch(error){notify(error.message);}});
  document.getElementById('audit').innerHTML=data.audit.map(item=>'<p><small>'+escape(item.at)+' · '+escape(data.members.find(user=>user.id===item.actor)?.name||'账号')+' · '+escape(({setup:'建立站主',login:'登录',admitted:'答题通过',save:'保存素材',member:'调整权限',questions:'修改准入题目',archive:'移入回收站',restore:'恢复素材',upload:'上传文件',password:'更改密码','post-draft':'保存帖子草稿','post-publish':'发布成品','post-unpublish':'撤回成品','post-comment':'帖子留言','visitor-access':'调整访客开放'})[item.action]||item.action)+'</small></p>').join('');
}
function connect(){
  initialize().catch(error=>{
    notify(error.message);
    if(me||dirty)return;
    app.innerHTML='<section class="auth"><h1>暂时没有连上创作空间</h1><p class="muted">请确认站主电脑与共享通道正在运行。</p><button type="button" id="retry-connection">重新连接</button></section>';
    document.getElementById('retry-connection').onclick=()=>{app.innerHTML='<p class="muted">正在重新连接…</p>';connect();};
  });
}
connect();

async function activity(){
  const data=await api('/api/manage');
  const labels={save:'保存素材',upload:'上传文件',archive:'移入回收站',restore:'恢复素材',catalog:'整理资料',member:'调整成员权限',questions:'修改准入规则','visitor-access':'调整访客开放',setup:'建立站主',login:'登录',admitted:'加入创作空间',password:'更改密码'};
  const fields={title:'标题',body:'正文',date:'时间',summary:'列表介绍',images:'照片',videos:'视频',scope:'分享范围',recipients:'分享对象',published:'引用状态',visitorVisible:'访客开放',medium:'素材分组',persons:'参与人',major:'重点素材',type:'类型',kind:'素材类别',fromId:'起点关联',toId:'终点关联'};
  if(!swap('<section class="reading"><h1>谁做了哪些改动</h1><p class="muted">最近200次操作。历史版本只有作者和站主可以查看。</p><div id="activity-list"></div></section>'))return;
  document.getElementById('activity-list').innerHTML=data.audit.map(item=>'<article class="activity-item"><p><strong>'+escape(item.actorName)+'</strong> · '+escape(item.created?'新建记录':labels[item.action]||item.action)+'</p><p>'+escape(item.title||'系统设置')+'</p>'+(item.fields?.length?'<p class="muted">修改了：'+escape(item.fields.map(key=>fields[key]||key).join('、'))+'</p>':'')+'<small>'+escape(new Date(item.at).toLocaleString())+'</small>'+(data.archived.some(entry=>entry.id===item.target)?'<p class="muted">记录在回收站</p>':data.audit.some(row=>row.target===item.target&&row.action==='save')?'<p><button class="subtle" data-open-entry="'+escape(item.target)+'">查看记录与历史</button></p>':'')+'</article>').join('')||'<p class="muted">还没有操作记录。</p>';
  document.querySelectorAll('[data-open-entry]').forEach(button=>button.onclick=()=>read(button.dataset.openEntry).catch(error=>notify(error.message)));
}

document.addEventListener('error',event=>{
  const img=event.target;
  if(!(img instanceof HTMLImageElement)||!img.getAttribute('src')||img.nextElementSibling?.classList.contains('photo-retry'))return;
  const retry=document.createElement('button');retry.type='button';retry.className='photo-retry';retry.textContent='照片未能载入 · 点击重试';
  retry.onclick=event=>{event.preventDefault();event.stopPropagation();retry.remove();const src=img.src;img.removeAttribute('src');img.src=src;};
  img.after(retry);
},true);
