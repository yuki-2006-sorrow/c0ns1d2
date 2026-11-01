import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import MarkdownIt from 'markdown-it';
import { prepareTimeline } from '../src/lib/timeline-model.mjs';
import { contentPreview } from '../src/lib/content-preview.mjs';
import { serveVideo } from './media-response.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const types={event:'events',work:'works',thought:'thoughts'};
const markdown=new MarkdownIt({html:false,breaks:true,linkify:false});
function slot(html,name,value){
  const start='<!--archive:'+name+':start-->',end='<!--archive:'+name+':end-->';
  const a=html.indexOf(start),b=html.indexOf(end,a);
  if(a<0||b<0)throw Object.assign(new Error('前台模板需要更新，请重新构建网站'),{status:503});
  return html.slice(0,a+start.length)+value+html.slice(b);
}
function urlFor(entry,prefix=''){return prefix+'/'+types[entry.type]+'/'+encodeURIComponent(entry.id);}
function topicUrl(slug,prefix=''){
  if(!slug)return prefix+'/topics/_unfiled';
  return prefix+'/topics/'+(slug==='_unfiled'?'_group/':'')+encodeURIComponent(slug);
}
function imageUrl(entry,reference,index,prefix='',kind='image'){
  if(/^https:\/\/[^\s]+$/.test(reference)&&new URL(reference).hostname!=='aka.doubaocdn.com')return reference;
  if(/^https:\/\/[^\s]+$/.test(reference))return '/api/remote-image?id='+encodeURIComponent(entry.id)+'&index='+index+(prefix==='/guest'?'&guest=1':'');
  const guest=prefix==='\/guest'?'?guest=1':'';
  if(/^\/api\/media\/[a-f0-9-]+$/.test(reference))return reference+guest;
  if(reference.startsWith('/photos/'))return '/api/legacy-media?id='+encodeURIComponent(entry.id)+'&index='+index+(kind==='video'?'&kind=video':'')+(guest?'&guest=1':'');
  return '';
}
function stateLabel(entry){return !entry.published?'草稿':entry.scope==='private'?'仅作者':entry.scope==='selected'?'定向分享':entry.visitorVisible?'访客可见':'成员共同内容';}
function preview(entry){return contentPreview(entry.summary,entry.body,170);}
const defaultImage=markdown.renderer.rules.image;
markdown.renderer.rules.image=(tokens,index,options,env,self)=>{
  const token=tokens[index],reference=token.attrGet('src')||'';
  const attachment=env.entry?.images.indexOf(reference)??-1;
  const url=attachment>=0?imageUrl(env.entry,reference,attachment,env.prefix):/^https:\/\//.test(reference)?reference:'';
  if(!url)return '<span class="bridge-muted">[图片未附在这段记录中]</span>';
  token.attrSet('src',url);
  return defaultImage(tokens,index,options,env,self);
};

export function createCollaborationFrontend(root,store){
  const cache=new Map();
  function template(name){
    const path=join(root,'dist/collaboration-shell',name,'index.html');
    if(!existsSync(path))throw Object.assign(new Error('前台需要构建，请双击启动.bat'),{status:503});
    const stamp=statSync(path).mtimeMs;
    if(cache.get(path)?.stamp!==stamp)cache.set(path,{stamp,html:readFileSync(path,'utf8')});
    return cache.get(path).html;
  }
  function folders(entries,user){
    const metadata=Object.fromEntries(store.catalog(user).groups.map(group=>[group.slug,{title:group.title,parent:group.parent||''}]));
    const visible={};
    for(const entry of entries){
      let id=entry.medium;const visited=new Set();
      if(id&&!metadata[id])metadata[id]={title:id,parent:''};
      while(id&&metadata[id]&&!visited.has(id)){visited.add(id);visible[id]=metadata[id];id=metadata[id].parent;}
    }
    return visible;
  }
  function profiles(user){ return store.catalog(user).people; }
  function topicGroups(user,entries){
    const groups=Object.fromEntries(store.catalog(user).groups.map(group=>[group.slug,{title:group.title,parent:group.parent||''}]));
    for(const entry of entries)if(entry.medium&&!groups[entry.medium])groups[entry.medium]={title:entry.medium,parent:''};
    return groups;
  }
  function withinTopic(entry,slug,groups){
    if(!slug)return !entry.medium;
    let id=entry.medium;const visited=new Set();
    while(id&&!visited.has(id)){if(id===slug)return true;visited.add(id);id=groups[id]?.parent;}
    return false;
  }
  function renderPerson(user,prefix,entries,slug){
    // Old biographies do not yet have per-record sharing controls. Keep them with the owner.
    if(user.role!=='owner')return null;
    const person=profiles(user).find(person=>person.slug===slug);if(!person)return null;
    const traits=[['openness','开放性'],['conscientiousness','尽责性'],['extraversion','外向性'],['agreeableness','宜人性'],['neuroticism','神经质']];
    const memories=entries.filter(entry=>entry.type==='event'&&entry.persons.includes(person.name));
    const reading='<article class="reading-page"><header class="reading-header"><a class="reading-back" href="/topics">← 专题</a><p class="archive-eyebrow">人物档案 · 站主可见</p><h1>'+escape(person.name)+'</h1><p class="reading-meta">'+[person.nickname,person.role,person.university,person.major].filter(Boolean).map(escape).join(' · ')+'</p></header><div class="reading-layout"><div class="reading-main"><details class="reading-meta"><summary>大五人格画像</summary>'+traits.map(([key,label])=>'<label class="bridge-trait">'+label+'<meter min="0" max="100" value="'+Math.min(100,Math.max(0,Number(person.personality?.[key])||0))+'"></meter></label>').join('')+'</details><div class="reading-prose">'+markdown.render(person.body||'')+'</div></div><aside class="reading-rail"><h2>参与的素材</h2>'+memories.map(entry=>'<a href="'+urlFor(entry,prefix)+'">'+escape(entry.date)+' · '+escape(entry.title)+' ↗</a>').join('')+'</aside></div></article>';
    return chrome(slot(template('read'),'reading',reading),user,prefix,person.name);
  }
  function chrome(html,user,prefix,title){
    const account=user.role==='guest'?'<details class="archive-account"><summary>我的</summary><div class="archive-account-links"><a href="/shared?return=home">登录</a><a href="/shared?join=1&amp;return=home">答题加入</a><a href="'+prefix+'/timeline">按时间浏览</a></div></details>':'<details class="archive-account"><summary>'+escape(user.name)+'</summary><div class="archive-account-links"><a href="/shared?view=library">我的记录</a>'+(user.canCreate?'<a href="/shared?new=event">收录素材</a>':'')+'<a href="/timeline">按时间浏览</a>'+(user.role==='owner'?'<a href="/shared?view=organize">整理专题</a><a href="/shared?view=activity">改动记录</a><a href="/shared?view=manage">成员管理</a>':'')+'<a href="/shared?view=password">修改密码</a><a href="/guest/topics">查看访客视角</a></div></details>';
    const start='<!--archive:account:start-->',end='<!--archive:account:end-->';
    html=html.split(start+end).join(start+account+end);
    if(prefix)html=html.replace(/href="\/(topics|events|works|thoughts|timeline)(?=[/"])/g,'href="/guest/$1').replace('href="/" class="nav-logo"','href="/guest" class="nav-logo"');
    html=html.replace(/<title>[\s\S]*?<\/title>/,()=>'<title>'+escape(title)+' · c0ns1d2</title>');
    html=html.replace('</head>','<link rel="stylesheet" href="/bridge.css"><script type="module" src="/bridge-client.js"></script></head>');
    return html;
  }
  function renderHome(user,prefix,entries){
    const cards=entries.filter(entry=>entry.major).sort((a,b)=>a.date.localeCompare(b.date));
    let html=template('home');
    html=html.replace(/<nav class="archive-exits"[^>]*>[\s\S]*?<\/nav>/,'<nav class="archive-exits" aria-label="继续浏览"><a href="/topics">专题</a><button type="button" id="replayIntro">重看开场</button><!--archive:account:start--><!--archive:account:end--></nav>');
    html=slot(html,'cards',cards.map((entry,index)=>'<button type="button" class="card" data-index="'+index+'" aria-label="查看 '+escape(entry.title)+'"><div class="card-img">'+(imageUrl(entry,entry.images[0]||'',0,prefix)?'<img data-src="'+escape(imageUrl(entry,entry.images[0],0,prefix))+'" alt="'+escape(entry.title)+'" decoding="async">':'<span class="card-placeholder"><small>'+escape(entry.date)+'</small>'+escape(entry.title)+'</span>')+'</div><div class="card-shine"></div></button>').join(''));
    html=slot(html,'texts',cards.length?cards.map((entry,index)=>'<div class="text-item" data-index="'+index+'"><span class="text-date">'+escape(entry.date)+'</span><h2 class="text-title">'+escape(entry.title)+'</h2><p class="text-desc">'+escape((entry.persons||[]).join(' · '))+'</p><a href="'+urlFor(entry,prefix)+'" class="text-enter">打开记录 →</a></div>').join(''):'<div id="homeEmpty"><h2>这里还没有向你开放的精选记录</h2><p>可以先打开一个专题看看。</p><a href="'+prefix+'/topics">浏览专题 →</a></div>');
    html=html.replace(/(<span id="totalNum">)[\s\S]*?(<\/span>)/,(_,start,end)=>start+String(cards.length).padStart(2,'0')+end);
    html=html.replace('<div class="shots"','<div class="cinema-entrances"><a href="'+prefix+'/topics">进入专题 →</a></div><div class="shots"');
    return chrome(html,user,prefix,'时间与素材');
  }
  function timelineCards(model,prefix){
    return model.entries.map((entry,index)=>'<li class="tl-item" data-event="'+escape(entry.slug)+'"><div class="tl-date">'+escape(entry.time.label)+'</div><a class="tl-card'+(entry.major?' tl-card-major':'')+(entry.image?' tl-card-photo':'')+'" href="'+prefix+'/events/'+encodeURIComponent(entry.slug)+'" aria-labelledby="title-'+index+'" aria-describedby="date-'+index+'"><span class="tl-pin" aria-hidden="true"></span>'+(entry.image?'<div class="tl-photo"><img src="'+escape(entry.image)+'" alt="" loading="lazy" decoding="async"><span class="tl-photo-fallback">照片暂时未能载入</span></div>':'')+'<div class="tl-card-text"><div class="tl-card-meta"><span>'+escape(entry.major?'重要素材':entry.trail.at(-1)?.title||'素材片段')+'</span><span class="tl-number" aria-hidden="true">'+String(index+1).padStart(3,'0')+'</span></div><h2 id="title-'+index+'">'+escape(entry.title)+'</h2>'+(entry.summary?'<p class="tl-summary">'+escape(entry.summary)+'</p>':'')+'<span id="date-'+index+'" class="tl-sr-only">'+escape(entry.time.label)+'</span><span class="tl-enter">打开这段素材 <span aria-hidden="true">↗</span></span></div></a></li>').join('');
  }
  function renderTimeline(user,prefix,entries){
    const events=entries.filter(entry=>entry.type==='event').map(entry=>({slug:entry.id,title:entry.title,date:entry.date,major:entry.major,medium:entry.medium,summary:preview(entry),image:imageUrl(entry,entry.images[0]||'',0,prefix)}));
    const model=prepareTimeline(events,folders(events,user));
    let html=template('timeline');
    html=slot(html,'years','<button type="button" data-year="all" aria-pressed="true">全部</button>'+model.years.map(year=>'<button type="button" data-year="'+escape(year)+'" aria-pressed="false">'+(year==='undated'?'日期未定':year)+'</button>').join(''));
    html=slot(html,'groups',model.groups.length?'<label class="tl-group-label">分组<select id="tl-group"><option value="">全部素材</option>'+model.groups.map(group=>'<option value="'+escape(group.id)+'">'+escape(group.title)+'（'+group.count+'）</option>').join('')+'</select></label>':'');
    html=slot(html,'timeline-cards',timelineCards(model,prefix));
    const data={entries:model.entries.map(({slug,time,trail})=>({slug,time,trail})),years:model.years,groups:model.groups.map(group=>group.id),viewKey:user.id+':'+prefix};
    html=html.replace(/(<script id="timeline-data"[^>]*>)[\s\S]*?(<\/script>)/,(_,start,end)=>start+json(data)+end);
    html=html.replace(/(<p id="tl-info"[^>]*>)[\s\S]*?(<\/p>)/,(_,start,end)=>start+model.entries.length+' 段素材'+end);
    if(events.length)html=html.replace(/(<p class="tl-empty" id="tl-empty")(?! hidden)/,'$1 hidden');
    return chrome(html,user,prefix,'时间与素材');
  }
  function recordRows(entries,prefix){
    return entries.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(entry=>{
      const image=imageUrl(entry,entry.images[0]||'',0,prefix);
      return '<a data-memory-row class="memory-row'+(image?' with-image':'')+'" href="'+urlFor(entry,prefix)+'">'+(image?'<img src="'+escape(image)+'" alt="" loading="lazy">':'')+'<div><span class="memory-date">'+escape(entry.date)+' · '+escape(entry.authorName)+' · '+escape(stateLabel(entry))+'</span><h3>'+escape(entry.title)+'</h3>'+(preview(entry)?'<p>'+escape(preview(entry))+'</p>':'')+'</div><span class="memory-arrow" aria-hidden="true">↗</span></a>';
    }).join('');
  }
  function topicCards(topics,entries,groups,prefix){
    return topics.map(([slug,group])=>{
      const records=entries.filter(entry=>withinTopic(entry,slug,groups)).sort((a,b)=>b.date.localeCompare(a.date));
      const latest=records[0];
      return '<a data-memory-row class="topic-card" href="'+topicUrl(slug,prefix)+'"><span class="topic-count">'+records.length+' 条记录</span><h2>'+escape(group.title)+'</h2><p>'+escape(latest?.title||'还没有记录，随时可以收录素材。')+'</p><span class="topic-enter">打开专题 ↗</span></a>';
    }).join('');
  }
  function renderTopics(user,prefix,entries,selection){
    const groups=topicGroups(user,entries);
    const index=selection===undefined;
    if(!index&&selection!==''&&!groups[selection])return null;
    const selected=index?entries:entries.filter(entry=>withinTopic(entry,selection,groups));
    const title=index?'专题':selection===''?'未归入专题':groups[selection].title;
    const parent=!index&&selection?groups[selection].parent:'';
    const children=Object.entries(groups).filter(([slug,group])=>index?!group.parent||!groups[group.parent]:selection!==''&&group.parent===selection&&slug!==selection).sort((a,b)=>a[1].title.localeCompare(b[1].title,'zh-CN'));
    if(index&&entries.some(entry=>!entry.medium))children.push(['',{title:'未归入专题',parent:''}]);
    const write=user.canCreate&&!index?'<a class="archive-button" href="/shared?new=event'+(selection?'&amp;topic='+encodeURIComponent(selection):'')+'">收录素材</a>':'';
    const create=user.role==='owner'&&index?'<a class="archive-button" href="/shared?view=topic-new">新建专题</a>':'';
    const back=index?'':'<a class="reading-back" href="'+(parent?topicUrl(parent,prefix):prefix+'/topics')+'">← '+escape(parent&&groups[parent]?groups[parent].title:'全部专题')+'</a>';
    const content='<header class="topic-heading">'+back+'<div class="topic-title"><h1>'+escape(title)+'</h1>'+create+write+'</div><p class="index-intro">'+(index?'将相关素材分组，供创作帖子时查找和引用。':selected.length+' 条记录，按时间放在一起。')+'</p><input class="bridge-search" id="bridge-search" type="search" placeholder="'+(index?'找一个专题':'搜索这个专题')+'" aria-label="'+(index?'搜索专题':'搜索专题内的记录')+'"></header>'+
      (children.length?'<div class="topic-grid" aria-label="'+(index?'专题':'子专题')+'">'+topicCards(children,entries,groups,prefix)+'</div>':'')+
      (!index&&selected.length?'<div class="topic-records">'+recordRows(selected,prefix)+'</div>':'')+
      (index&&!children.length?'<p class="bridge-empty">'+(user.role==='owner'?'还没有专题，先建一个，再把相关记录放进来。':'暂时还没有向你开放的专题。')+'</p>':!index&&!selected.length?'<p class="bridge-empty">这里还没有记录。'+(user.canCreate?'点击“收录素材”，留下第一条。':'')+'</p>':'')+
      '<p id="bridge-no-results" class="bridge-empty" hidden>没有找到匹配的内容。</p>';
    return chrome(slot(template('list'),'listing',content),user,prefix,title);
  }
  function renderRead(user,prefix,entries,entry){
    const knownPeople=user.role==='owner'?profiles(user):[];
    const quotes=(entry.quotes||[]).map(quote=>'<blockquote>'+escape(quote)+'</blockquote>').join('');
    const fragments=quotes?'<details class="reading-meta"><summary>原话与片段</summary><div class="reading-prose">'+quotes+'</div></details>':'';
    const related=entries.filter(other=>other.type==='thought'&&(other.fromId===entry.id||other.toId===entry.id)&&other.id!==entry.id);
    const targets=[['fromId','从这里出发'],['toId','又想到']].map(([key,label])=>{const target=entries.find(other=>other.id===entry[key]);return target?'<a href="'+urlFor(target,prefix)+'">'+label+' · '+escape(target.title)+' ↗</a>':'';}).join('');
    const actions=entry.editable?'<a class="archive-button" href="/shared?edit='+entry.id+'">编辑</a>':'';
    const returnUrl=topicUrl(entry.medium,prefix);
    const returnTitle=entry.medium?(topicGroups(user,entries)[entry.medium]?.title||entry.medium):'未归入专题';
    const photos=entry.images.map((reference,index)=>{const url=imageUrl(entry,reference,index,prefix);return url?'<button class="gallery-trigger" type="button" aria-label="查看照片 '+(index+1)+'"><img class="gallery-img" src="'+escape(url)+'" alt="'+escape(entry.title)+' · 照片 '+(index+1)+'" loading="lazy"></button>':'';}).join('');
    const videos=entry.videos.map((reference,index)=>imageUrl(entry,reference,index,prefix,'video')).filter(Boolean).map(url=>'<video class="bridge-video" controls preload="metadata" src="'+escape(url)+'"></video>').join('');
    const thoughts=related.map(thought=>'<article class="bridge-thought"><span>'+escape(thought.authorName)+'</span><h3><a href="'+urlFor(thought,prefix)+'">'+escape(thought.title)+'</a></h3><p>'+escape(contentPreview('',thought.body,280))+'</p></article>').join('');

    const people=(entry.persons||[]).map(name=>{const person=knownPeople.find(person=>person.name===name);return person?'<a href="/people/'+encodeURIComponent(person.slug)+'">'+escape(name)+'</a>':escape(name);}).join(' · ');
    const reading='<article class="reading-page"><header class="reading-header"><a class="reading-back" href="'+returnUrl+'">← '+escape(returnTitle)+'</a><p class="archive-eyebrow">'+escape(entry.date)+' · '+escape(entry.authorName)+' · '+escape(stateLabel(entry))+'</p><h1>'+escape(entry.title)+'</h1>'+(people?'<p class="reading-meta">'+people+'</p>':'')+'<div class="bridge-actions">'+actions+'</div></header><div class="reading-layout"><div class="reading-main">'+(entry.summary&&entry.summary!==entry.body?'<p class="reading-summary">'+escape(entry.summary)+'</p>':'')+'<div class="reading-prose">'+markdown.render(entry.body,{entry,prefix})+'</div>'+fragments+(photos?'<section class="reading-media"><h2>留下的照片</h2><div class="reading-media-grid">'+photos+'</div></section>':'')+(videos?'<section class="reading-media"><h2>影像</h2>'+videos+'</section>':'')+'<footer class="reading-footer"><a href="'+returnUrl+'">← 回到'+escape(returnTitle)+'</a></footer></div><aside class="reading-rail"><h2>关联记录</h2>'+targets+thoughts+(!targets&&!thoughts?'<p class="bridge-muted">还没有关联的记录。</p>':'')+'</aside></div></article>';
    return chrome(slot(template('read'),'reading',reading),user,prefix,entry.title);
  }
  function render(path,user){
    const prefix=path==='/guest'||path.startsWith('/guest/')?'/guest':'';
    const current=(prefix?path.slice(prefix.length):path).replace(/\/$/,'')||'/';
    const entries=store.entries(user);
    if(current==='/')return renderHome(user,prefix,entries);
    if(current==='/topics')return renderTopics(user,prefix,entries);
    if(current==='/topics/_unfiled')return renderTopics(user,prefix,entries,'');
    if(current.startsWith('/topics/')){
      let slug;try{slug=decodeURIComponent(current.slice(current.startsWith('/topics/_group/')?15:8));}catch{return null;}
      return renderTopics(user,prefix,entries,slug);
    }
    if(current==='/timeline')return renderTimeline(user,prefix,entries);
    if(current.startsWith('/people/')){let slug;try{slug=decodeURIComponent(current.slice(8));}catch{return null;}return renderPerson(user,prefix,entries,slug);}
    for(const [type,route]of Object.entries(types)){
      if(current==='/'+route)return renderTopics(user,prefix,entries);
      if(current.startsWith('/'+route+'/')){
        let id;try{id=decodeURIComponent(current.slice(route.length+2));}catch{return null;}
        const matches=entries.filter(entry=>entry.type===type&&(entry.id===id||entry.source?.split('/').at(-1)?.replace(/\.md$/,'')===id));
        if(matches.length!==1)return null;
        return renderRead(user,prefix,entries,matches[0]);
      }
    }
    return null;
  }
  function resource(req,res,path){
    let target,type;
    if(/^\/_astro\/[a-zA-Z0-9_.-]+$/.test(path)){
      target=resolve(root,'dist','.'+path);const base=resolve(root,'dist/_astro');
      if(relative(base,target).startsWith('..')||isAbsolute(relative(base,target)))return false;
      const ext=path.split('.').at(-1);type=({js:'text/javascript',css:'text/css',woff:'font/woff',woff2:'font/woff2',svg:'image/svg+xml',png:'image/png'})[ext];
      if(!type)return false;
    }else if(/^\/intro\/(?:intro\.mp4|k[1-9]\.png)$/.test(path)){target=join(root,'public',path);type=path.endsWith('.mp4')?'video/mp4':'image/png';}
    else return false;
    if(!existsSync(target))return false;
    if(type==='video/mp4')return serveVideo(req,res,target),true;
    res.writeHead(200,{'Content-Type':type});if(req.method==='HEAD')res.end();else createReadStream(target).on('error',()=>res.destroy()).pipe(res);
    return true;
  }
  return {render,resource};
}
