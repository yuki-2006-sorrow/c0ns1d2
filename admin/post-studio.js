import { createDemoState, appendSource, addNote, addMediaSource, selectClip, editClip, editPost, moveClip, removeClip, undo, redo, addComment, serializeDraft, restoreDraft } from './post-studio-model.mjs';

const $ = id => document.getElementById(id);
const connected=document.body.dataset.connected==='true';
const params=new URLSearchParams(location.search);
let key='c0ns1d2-post-studio-demo-v1',state=createDemoState(),dirty=false,profile=null,postId=params.get('id')||'',postRevision='',collaborators=[],isPublished=false,canPublish=true,postVersions=[];
const typeNames={chat:'聊天记录',event:'经历',thought:'想法',opinion:'观点',essay:'随笔',image:'图片',audio:'音频',video:'视频'};
async function request(path,body){const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Archive-Client':'1'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error||'保存失败');return data;}
function librarySources(rows){return rows.flatMap(row=>{
  const base={entryId:row.id,author:row.author,date:row.date,title:row.title,text:row.text};
  const textSources=['image','video','audio'].includes(row.type)&&((row.images||[]).length||(row.videos||[]).length)?[]:[{...base,id:'text:'+row.id,type:row.type}];
  return [...textSources,...(row.images||[]).map((ref,index)=>({...base,id:'image:'+row.id+':'+index,type:'image',text:'',rawRef:ref,image:ref.startsWith('/photos/')?'/api/legacy-media?id='+row.id+'&index='+index:/^https:\/\/aka\.doubaocdn\.com\//.test(ref)?'/api/remote-image?id='+row.id+'&index='+index:ref})),...(row.videos||[]).map((ref,index)=>({...base,id:'media:'+row.id+':'+index,type:row.type==='audio'?'audio':'video',text:'',rawRef:ref,media:ref}))];
});}
function acceptSaved(post){postVersions=post.history||[];postId=post.id;postRevision=post.revision;collaborators=post.collaborators;isPublished=!!post.publication;canPublish=post.canPublish;state.activity=(post.activity||[]).map(row=>({actor:row.actorName,text:row.action,at:row.at}));state.comments=(post.comments||[]).map(row=>({actor:row.actorName,text:row.text,at:row.at}));}
if(connected){
 try{
  const [me,rows]=await Promise.all([request('/api/me'),request('/api/materials')]);profile=me;key='c0ns1d2-post-draft-'+me.id+'-'+(postId||'new');
  state={...state,materials:librarySources(rows),title:'未命名作品',subtitle:'',clips:[],selectedId:null,activity:[],comments:[]};
  if(postId){const post=await request('/api/posts?edit=1&id='+encodeURIComponent(postId));acceptSaved(post);state.title=post.title;state.subtitle=post.subtitle;
   state.clips=post.blocks.map(block=>{let source=state.materials.find(source=>source.entryId===block.sourceId&&(block.kind==='text'?source.id.startsWith('text:'):source.rawRef===block.mediaRef));
    if(!source&&block.sourceId){source={id:'snapshot:'+block.id,entryId:block.sourceId,type:block.kind==='text'?'essay':block.kind,title:'已引用片段',text:block.text,author:block.author,date:'',rawRef:block.mediaRef,...(block.kind==='image'?{image:block.viewMedia}:block.kind!=='text'?{media:block.viewMedia}:{})};state.materials.push(source);}
    return {id:block.id,sourceId:source?.id||null,text:block.text,caption:block.caption,author:block.author};});state.selectedId=state.clips[0]?.id||null;
  }else{const ids=(params.get('sources')||'').split(',');for(const id of ids){const source=state.materials.find(source=>source.entryId===id);if(source)state=appendSource(state,source.id,me.name);}dirty=state.clips.length>0;try{const inspiration=JSON.parse(sessionStorage.getItem('creative-inspiration')||'null');if(inspiration&&state.clips.length){const chosen=state.clips.find(clip=>state.materials.find(source=>source.id===clip.sourceId)?.entryId===inspiration.sourceId);if(chosen)state=editClip(state,chosen.id,{text:inspiration.text},me.name);sessionStorage.removeItem('creative-inspiration');}}catch{}}
  $('save-status').textContent='已连接素材库 · 草稿仅协作者可见';
  const members=await request('/api/members');const people=$('collaborator-list');if(people){for(const member of members.filter(member=>member.id!==me.id&&member.canCreate)){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=member.id;box.checked=collaborators.includes(member.id);box.disabled=!canPublish;box.onchange=()=>{collaborators=[...people.querySelectorAll('input:checked')].map(box=>box.value);dirty=true;};label.append(box,document.createTextNode(member.name));people.append(label);}}
 }catch(error){$('save-status').textContent=error.message;document.querySelectorAll('button,input,textarea,select').forEach(field=>field.disabled=true);throw error;}
}else{try{const saved=localStorage.getItem(key);if(saved)state=restoreDraft(saved);}catch{$('save-status').textContent='本地草稿无法读取，已打开示例';}}
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const sourceFor = clip => state.materials.find(source => source.id === clip.sourceId);
const selected = () => state.clips.find(clip => clip.id === state.selectedId);
let announcementTimer;
function announce(text) {
  clearTimeout(announcementTimer);
  $('studio-status').textContent = text;
  announcementTimer = setTimeout(() => { $('studio-status').textContent = ''; }, 4000);
}
function commit(next, message) {
  if (next === state) return;
  state = next; dirty = true; $('save-status').textContent = connected?'尚未保存 · 保留当前编排':'尚未保存 · 仅本机预览'; render(); if (message) announce(message);
}
function timeLabel(value) { const date = new Date(value); return Number.isNaN(+date) ? '' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
function renderMaterials() {
  const query = $('material-search').value.trim().toLowerCase(), filter = $('material-filter').value;
  const filtered = state.materials.filter(source => (!query || (source.title + source.text + source.author).toLowerCase().includes(query)) && (filter === 'all' || (filter === 'text' ? !['image', 'audio', 'video'].includes(source.type) : source.type === filter)));
  $('material-count').textContent = state.materials.length;
  $('material-list').replaceChildren(...filtered.map(source => {
    const card = element('button', 'material-card'); card.type = 'button'; card.dataset.source = source.id; card.draggable = true;
    card.setAttribute('aria-label', '加入素材：' + source.title);
    const head = element('div', 'material-card-head'); head.append(element('span', 'material-type', typeNames[source.type]), element('span', 'material-add', '+')); card.append(head);
    if (source.image) { const image = element('img'); image.src = source.image; image.alt = source.title; card.append(image); }
    card.append(element('h3', '', source.title), element('p', '', source.text || source.caption), element('span', 'material-meta', source.author + ' · ' + source.date + (connected?'':' · 示例素材')));
    card.onclick = () => commit(appendSource(state, source.id), '已加入帖子；素材原文保持不变。');
    card.ondragstart = event => { event.dataTransfer.setData('application/x-studio-source', source.id); event.dataTransfer.effectAllowed = 'copy'; };
    return card;
  }));
  if (!filtered.length) $('material-list').append(element('p', 'editor-note', '没有匹配的素材，试试其他关键词。'));
}
function readingNodes(interactive = false) {
  const fragment = document.createDocumentFragment();
  fragment.append(element('span', 'post-eyebrow', '共同创作 · 作品草稿'), element('h1', '', state.title || '未命名帖子'), element('p', 'post-subtitle', state.subtitle));
  if (!state.clips.length) fragment.append(element('p', 'editor-note', '从左侧加入第一份素材，或者添加一段自己的文字。'));
  for (const clip of state.clips) {
    const source = sourceFor(clip), block = element(source?.image ? 'figure' : 'section', 'post-block' + (interactive && clip.id === state.selectedId ? ' selected' : ''));
    block.dataset.clip = clip.id;
    if (interactive) { block.tabIndex = 0; block.setAttribute('aria-label', '选择片段：' + (source?.title || '串联文字')); block.onclick = () => { state = selectClip(state, clip.id); render(); }; block.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); state = selectClip(state, clip.id); render(); } }; }
    if (source?.image) { const img = element('img'); img.src = source.image; img.alt = clip.caption || source.title;img.onerror=()=>img.replaceWith(element('p','editor-note','图片暂时无法读取，引用仍保留；请补传原图。')); block.append(img); if (clip.caption) block.append(element('figcaption', '', clip.caption)); }
    if (source?.media && ['audio', 'video'].includes(source.type)) {
      const media = element(source.type); media.src = source.media; media.controls = true; media.preload = 'none'; media.style.width = '100%';
      media.addEventListener('click', event => event.stopPropagation()); media.addEventListener('keydown', event => event.stopPropagation()); block.append(media);
    }
    if (clip.text) { const text = element('p', '', clip.text); text.style.whiteSpace = 'pre-wrap'; block.append(text); }
    if (!source?.image && clip.caption) block.append(element('p', 'editor-note', clip.caption));
    block.append(element('small', 'clip-attribution', source ? '素材来自 ' + source.author + ' · ' + source.title : '串联文字 · ' + clip.author));
    fragment.append(block);
  }
  return fragment;
}
function renderTrack() {
  $('clip-count').textContent = state.clips.length;
  $('clip-track').replaceChildren(...state.clips.map((clip, index) => {
    const source = sourceFor(clip), card = element('button', 'clip-card' + (clip.id === state.selectedId ? ' selected' : '') + (source?.image ? ' image-clip' : ''));
    card.type = 'button'; card.dataset.clip = clip.id; card.draggable = true; card.setAttribute('aria-pressed', String(clip.id === state.selectedId));
    card.append(element('span', 'clip-index', String(index + 1).padStart(2, '0')), element('span', 'clip-kind', source ? typeNames[source.type] : '串联文字'), element('h3', '', source?.title || '串联文字'), element('p', '', clip.text || clip.caption || '图片片段'));
    card.onclick = () => { state = selectClip(state, clip.id); render(); };
    card.ondragstart = event => { event.dataTransfer.setData('application/x-studio-clip', clip.id); event.dataTransfer.effectAllowed = 'move'; };
    return card;
  }));
  if (!state.clips.length) $('clip-track').append(element('p', 'editor-note', '素材加入后会排在这里。可以拖动片段调整顺序。'));
}
function syncField(id, value) { const field = $(id); if (document.activeElement !== field && field.value !== value) field.value = value; }
function renderEditor() {
  const clip = selected(), source = clip && sourceFor(clip), index = state.clips.findIndex(item => item.id === state.selectedId);
  syncField('post-title', state.title); syncField('post-subtitle', state.subtitle);
  if ($('post-title-display')) $('post-title-display').textContent = state.title || '未命名帖子';
  $('selection-label').textContent = clip ? '片段 ' + String(index + 1).padStart(2, '0') : '选择一个片段';
  $('empty-selection').hidden = !!clip;
  $('clip-editor').disabled = !clip; $('clip-caption').disabled = !clip;
  syncField('clip-editor', clip?.text || ''); syncField('clip-caption', clip?.caption || '');
  $('clip-source').textContent = !clip ? '' : source ? '原素材：' + source.title + ' / ' + source.author + '。这里修改的是帖子中的引用，素材原文不会改变。' : '这是你为帖子添加的串联文字。';
  $('move-left').disabled = !clip || index <= 0; $('move-right').disabled = !clip || index >= state.clips.length - 1; $('remove-clip').disabled = !clip;
  if($('publish-post')){$('publish-post').disabled=!canPublish;$('publish-post').title=canPublish?'发布当前编排为公开成品':'由作品发起人或站主发布';}
  if($('unpublish-post'))$('unpublish-post').hidden=!connected||!isPublished||!canPublish;
  $('undo').disabled = !state.undoStack.length; $('redo').disabled = !state.redoStack.length;
}
function renderCollaboration() {
  if($('collaborator-settings'))$('collaborator-settings').hidden=!connected;
  const activities = state.activity.slice(-30).reverse();
  $('activity-list').replaceChildren(...activities.map(item => { const row = element('article'); row.append(element('p', '', item.actor + ' · ' + item.text), element('small', '', timeLabel(item.at) + (connected?'':' · 本机预览'))); return row; }));
  if(connected)for(const version of postVersions.slice().reverse()){const details=element('details','post-version'),summary=element('summary','',timeLabel(version.at)+' · '+version.actorName+' 保存前的版本'),text=element('p','',version.title+'\n'+version.blocks.map(block=>block.text||block.caption).filter(Boolean).join('\n\n'));details.append(summary,text);$('activity-list').append(details);}
  if (!activities.length) $('activity-list').append(element('p', 'editor-note', '添加素材、调整顺序或修改文字后，具体操作会显示在这里。'));
  $('comment-list').replaceChildren(...state.comments.slice().reverse().map(item => { const row = element('article'); const index = state.clips.findIndex(clip => clip.id === item.clipId); row.append(element('small', '', item.actor + ' · ' + (index >= 0 ? '片段 ' + (index + 1) : '整个帖子') + ' · ' + timeLabel(item.at)), element('p', '', item.text)); return row; }));
}
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let hasRendered = false;
function motionTargets() { return [...document.querySelectorAll('#post-preview [data-clip], #clip-track [data-clip]')]; }
function motionKey(node) { return (node.closest('#clip-track') ? 'track:' : 'paper:') + node.dataset.clip; }
function render() {
  const previous = new Map(motionTargets().map(node => [motionKey(node), {rect: node.getBoundingClientRect(), selected: node.classList.contains('selected')}]));
  $('post-preview').replaceChildren(readingNodes(true)); renderTrack(); renderEditor(); renderCollaboration();
  if (hasRendered && !reducedMotion.matches) {
    const targets = motionTargets();
    const structureChanged = [...previous.keys()].join('|') !== targets.map(motionKey).join('|');
    for (const node of targets) {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const before = previous.get(motionKey(node));
      const options = {duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)'};
      if (!before) {
        node.animate([{opacity: 0, transform: 'translateY(8px)'}, {opacity: 1, transform: 'none'}], options);
      } else {
        const x = before.rect.left - rect.left, y = before.rect.top - rect.top;
        if (structureChanged && before.rect.width && (Math.abs(x) > 1 || Math.abs(y) > 1)) {
          node.animate([{transform: `translate(${x}px,${y}px)`}, {transform: 'none'}], options);
        }
        if (!before.selected && node.classList.contains('selected')) {
          node.animate([{backgroundColor: 'var(--surface-alt)'}, {backgroundColor: getComputedStyle(node).backgroundColor}], {duration: 280});
        }
      }
    }
  }
  hasRendered = true;
}
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) document.getAnimations().forEach(animation => animation.cancel());
});
$('material-search').addEventListener('input', renderMaterials); $('material-filter').addEventListener('change', renderMaterials);
$('post-title').addEventListener('input', event => commit(editPost(state, {title: event.target.value})));
$('post-subtitle').addEventListener('input', event => commit(editPost(state, {subtitle: event.target.value})));
$('clip-editor').addEventListener('input', event => { if (selected()) commit(editClip(state, state.selectedId, {text:event.target.value})); });
$('clip-caption').addEventListener('input', event => { if (selected()) commit(editClip(state, state.selectedId, {caption:event.target.value})); });
const move = delta => { const index = state.clips.findIndex(clip => clip.id === state.selectedId); if (index >= 0) commit(moveClip(state, state.selectedId, index + delta), '片段顺序已调整。'); };
$('move-left').onclick = () => move(-1); $('move-right').onclick = () => move(1);
$('remove-clip').onclick = () => commit(removeClip(state, state.selectedId), '已移除引用，原素材仍在素材库。');
$('add-note').onclick = () => { commit(addNote(state), '已添加串联文字。'); $('clip-editor').focus(); $('clip-editor').select(); };
$('undo').onclick = () => commit(undo(state), '已撤销上一步。'); $('redo').onclick = () => commit(redo(state), '已重做。');
let saving=false;
async function saveLive(action='draft'){
  if(saving)throw Error('正在保存，请稍候');saving=true;$('workspace').inert=true;
  try{
  const clips=state.clips.map(clip=>{const source=sourceFor(clip);return {id:clip.id,sourceId:source?.entryId||null,kind:source?.image?'image':source?.media?source.type:'text',mediaRef:source?.rawRef||source?.media||'',text:clip.text,caption:clip.caption};});
  try{localStorage.setItem(key,serializeDraft(state));}catch{}
  const post=await request('/api/posts',{id:postId||undefined,revision:postRevision,title:state.title,subtitle:state.subtitle,clips,collaborators,action});acceptSaved(post);dirty=false;history.replaceState(null,'','/studio?id='+postId);$('save-status').textContent=action==='publish'?'作品已发布，访客可以阅读':action==='unpublish'?'已撤回公开作品':'已保存到共享资料库';render();return post;
  }finally{saving=false;$('workspace').inert=false;}
}
$('save-draft').onclick=async()=>{const button=$('save-draft');button.disabled=true;try{if(connected){await saveLive();announce('草稿已保存，受邀创作者可继续编排。');}else{localStorage.setItem(key,serializeDraft(state));dirty=false;$('save-status').textContent='已保存到此浏览器 · 示例草稿';announce('示例草稿已保存，没有写入正式资料。');}}catch(error){announce(error.message+' 当前编排仍保留。');}finally{button.disabled=false;}};
if($('publish-post')){$('publish-post').hidden=!connected;$('publish-post').onclick=async()=>{try{await saveLive('publish');announce('成品已发布到作品展厅。');}catch(error){announce(error.message);}};}
if($('unpublish-post')){$('unpublish-post').hidden=!connected;$('unpublish-post').onclick=async()=>{try{await saveLive('unpublish');announce('作品已撤回，创作草稿继续保留。');}catch(error){announce(error.message);}};}
if($('export-draft'))$('export-draft').onclick=()=>{const url=URL.createObjectURL(new Blob([serializeDraft(state)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='作品编排备份.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
if ($('embed-media')) $('embed-media').onclick = () => $('embed-dialog').showModal();
if ($('close-embed')) $('close-embed').onclick = () => $('embed-dialog').close();
if ($('embed-form')) $('embed-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const next = addMediaSource(state, { type: $('embed-kind').value, url: $('embed-url').value.trim(), title: $('embed-title').value });
    commit(next, '媒体素材已加入帖子，点击播放后才会加载。'); renderMaterials(); $('embed-dialog').close(); $('embed-form').reset();
  } catch (error) { const field = $('embed-url'); field.setCustomValidity(error.message); field.reportValidity(); }
});
if ($('embed-url')) $('embed-url').addEventListener('input', event => event.target.setCustomValidity(''));
$('preview-toggle').onclick = () => { const article = element('article', 'post-paper'); article.append(readingNodes(false)); $('reading-content').replaceChildren(article); $('reading-dialog').showModal(); };
$('close-reading').onclick = () => $('reading-dialog').close();
$('collab-toggle').onclick = () => { const panel = $('collab-panel'); panel.hidden = !panel.hidden; $('collab-toggle').setAttribute('aria-expanded', String(!panel.hidden)); };
if ($('close-collab')) $('close-collab').onclick = () => { $('collab-panel').hidden = true; $('collab-toggle').setAttribute('aria-expanded', 'false'); };
$('comment-form').addEventListener('submit',async event=>{event.preventDefault();const input=$('comment-input');if(!input.value.trim())return;try{if(connected){if(!postId)await saveLive();const post=await request('/api/post-comments',{id:postId,text:input.value});state.comments=post.comments.map(row=>({actor:row.actorName,text:row.text,at:row.at}));renderCollaboration();announce('建议已保存到共享作品。');}else commit(addComment(state,input.value),'已留下本机演示讨论。');input.value='';}catch(error){announce(error.message);}});
$('clip-track').addEventListener('dragover', event => event.preventDefault());
$('clip-track').addEventListener('drop', event => {
  event.preventDefault(); const sourceId = event.dataTransfer.getData('application/x-studio-source'), clipId = event.dataTransfer.getData('application/x-studio-clip');
  const targetId = event.target.closest('[data-clip]')?.dataset.clip, targetIndex = state.clips.findIndex(clip => clip.id === targetId);
  if (sourceId) { let next = appendSource(state, sourceId); if (next !== state && targetIndex >= 0) next = moveClip(next, next.selectedId, targetIndex); commit(next, '已把素材加入编排。'); }
  else if (clipId) commit(moveClip(state, clipId, targetIndex < 0 ? state.clips.length - 1 : targetIndex), '片段顺序已调整。');
});
document.addEventListener('keydown', event => {
  if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); $('save-draft').click(); }
});
window.addEventListener('beforeunload', event => { if (dirty||saving) { event.preventDefault(); event.returnValue = ''; } });

// 移动端分段标签切换（桌面/平板下 CSS 隐藏分段控件，不影响网格）
const workspace = $('workspace');
workspace.dataset.mobileTab = 'arrange';
const mobileTabs = document.querySelectorAll('.mobile-tab');
mobileTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    workspace.dataset.mobileTab = tab.dataset.tab;
    mobileTabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    window.scrollTo({ top: 0 });
  });
});

renderMaterials(); render();
