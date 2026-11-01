import { randomUUID } from 'node:crypto';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const string=(value,max)=>typeof value==='string'&&value.length<=max?value.trim():fail('帖子文字格式不正确或过长');
export const isCreator=user=>!!user&&user.access!=='blocked'&&(user.role==='owner'||user.canCreate===true);
export function createPostStore({getState,transaction,audit,canRead}){
  const creator=user=>{if(!isCreator(user))fail('只有创作者可以访问素材与剪辑台',403);};
  const name=id=>getState().users.find(user=>user.id===id)?.name||'原作者';
  const editable=(user,post)=>isCreator(user)&&(user.role==='owner'||post.author===user.id||post.collaborators.includes(user.id));
  const find=id=>(getState().posts||[]).find(post=>post.id===id);
  function materialLibrary(user){creator(user);return getState().entries.filter(entry=>canRead(user,entry)).map(entry=>({id:entry.id,title:entry.title,text:[...new Set([entry.body,...(entry.quotes||[])].filter(Boolean))].join('\n\n'),date:entry.date,author:name(entry.author),
    type:entry.materialKind||(entry.type==='event'&&(entry.sourceKind==='auto'||entry.source?.startsWith('auto/'))?'chat':entry.type==='thought'?'thought':entry.type==='work'?'essay':'event'),
    images:entry.images||[],videos:entry.videos||[],revision:entry.revision}));}
  function publicPost(post){const published=post.publication;if(!published)return null;return {id:post.id,title:published.title,subtitle:published.subtitle,author:name(post.author),creators:published.credits||[name(post.author)],publishedAt:published.at,
    blocks:published.blocks.map((block,index)=>({kind:block.kind,text:block.text,caption:block.caption,author:block.author,
      ...(block.mediaRef?{media:'/api/post-media/'+post.id+'/'+index}:{} )}))};}
  function listPosts(user){return (getState().posts||[]).filter(post=>post.publication).map(publicPost);}
  function readPost(user,id){const post=find(id);if(!post||!post.publication)fail('帖子不存在',404);return publicPost(post);}
  function editPost(user,id){creator(user);const post=find(id);if(!post||!editable(user,post))fail('帖子不存在或未受邀协作',404);return {...structuredClone(post),blocks:post.blocks.map((block,index)=>({...block,viewMedia:block.mediaRef?'/api/post-draft-media/'+post.id+'/'+index:''})),history:(post.history||[]).map(version=>({...version,actorName:name(version.actor)})),authorName:name(post.author),canPublish:user.role==='owner'||post.author===user.id};}
  function drafts(user){creator(user);return (getState().posts||[]).filter(post=>editable(user,post)).map(post=>({id:post.id,title:post.title,revision:post.revision,updatedAt:post.updatedAt,published:!!post.publication,authorName:name(post.author)}));}
  function savePost(user,input){
    creator(user);const old=input.id?find(input.id):null;
    if(input.id&&(!old||!editable(user,old)))fail('帖子不存在或未受邀协作',404);
    if(old&&input.revision!==old.revision)fail('另一位创作者已保存新版本。当前编排仍保留，请先保存本地副本再重新载入。',409);
    const title=string(input.title||'',180),subtitle=string(input.subtitle||'',600);
    if(!title)fail('请给帖子起一个标题');
    if(!Array.isArray(input.clips)||input.clips.length>200)fail('帖子最多编排200个片段');
    const ids=new Set();
    const blocks=input.clips.map(clip=>{
      const id=string(clip.id||randomUUID(),100);if(ids.has(id))fail('片段重复');ids.add(id);
      const source=clip.sourceId?getState().entries.find(entry=>entry.id===clip.sourceId):null;
      const retained=old?.blocks.find(block=>block.id===clip.id&&block.sourceId===clip.sourceId&&block.mediaRef===(clip.mediaRef||''));
      if(clip.sourceId&&(!source||(!canRead(user,source)&&!retained)))fail('引用的素材不存在或无权阅读',403);
      if(!['text','image','video','audio'].includes(clip.kind))fail('片段类型不正确');
      const mediaRef=string(clip.mediaRef||'',3000);
      if(clip.kind!=='text'){
        if(!mediaRef)fail('媒体片段缺少文件');
        if(source){if(![...(source.images||[]),...(source.videos||[])].includes(mediaRef))fail('媒体不属于引用的素材',403);}
        else {let url;try{url=new URL(mediaRef);}catch{fail('独立媒体请使用HTTPS直链');}if(url.protocol!=='https:'||url.username||url.password)fail('独立媒体请使用HTTPS直链');}
      }
      return {id,sourceId:source?.id||null,kind:clip.kind,text:string(clip.text||'',20000),caption:string(clip.caption||'',500),mediaRef:clip.kind==='text'?'':mediaRef,author:source?name(source.author):name(user.id)};
    });
    const action=input.action||'draft';if(!['draft','publish','unpublish'].includes(action))fail('保存方式不正确');
    const publisher=!old||old.author===user.id||user.role==='owner';
    if(action!=='draft'&&!publisher)fail('发布与撤回由帖子发起人或站主完成',403);
    if(action==='publish'&&!blocks.length)fail('先加入一份素材或一段文字');
    if(input.collaborators!==undefined&&!Array.isArray(input.collaborators))fail('协作者格式不正确');
    const collaborators=old&&old.author!==user.id&&user.role!=='owner'?old.collaborators:[...new Set(input.collaborators||old?.collaborators||[])];
    if(collaborators.some(id=>!getState().users.some(member=>member.id===id&&isCreator(member))))fail('协作者需要创作者权限');
    const fields=[];if(old){if(title!==old.title)fields.push('标题');if(subtitle!==old.subtitle)fields.push('简介');if(JSON.stringify(blocks.map(block=>block.id))!==JSON.stringify(old.blocks.map(block=>block.id)))fields.push('片段顺序或选取');if(blocks.some(block=>old.blocks.find(previous=>previous.id===block.id)?.text!==block.text))fields.push('引用文字');if(blocks.some(block=>old.blocks.find(previous=>previous.id===block.id)?.caption!==block.caption))fields.push('片段说明');if(JSON.stringify(collaborators)!==JSON.stringify(old.collaborators))fields.push('协作者');}
    return transaction(()=>{
      const at=new Date().toISOString(),post={...old,id:old?.id||randomUUID(),author:old?.author||user.id,title,subtitle,blocks,collaborators,revision:randomUUID(),updatedAt:at,
        history:[...(old?.history||[]),...(old?[{at,actor:user.id,title:old.title,subtitle:old.subtitle,blocks:structuredClone(old.blocks)}]:[])].slice(-50),
        activity:[...(old?.activity||[]),{at,actorName:name(user.id),action:action==='publish'?'发布帖子':action==='unpublish'?'撤回公开帖子':old?'保存编排'+(fields.length?'：'+fields.join('、'):''):'创建帖子'}].slice(-100),comments:old?.comments||[]};
      if(action==='publish')post.publication={title,subtitle,blocks:structuredClone(blocks),at,credits:[...new Set([post.author,...post.history.map(version=>version.actor),user.id].map(name))]};
      if(action==='unpublish')delete post.publication;
      getState().posts||=[];if(old)getState().posts.splice(getState().posts.indexOf(old),1,post);else getState().posts.push(post);
      audit(user,'post-'+action,post.id,{title});return editPost(user,post.id);
    });
  }
  function commentPost(user,input){creator(user);const post=find(input.id);if(!post||!editable(user,post))fail('未受邀协作',403);const text=string(input.text||'',4000);if(!text)fail('先写一句建议');return transaction(()=>{post.comments.push({id:randomUUID(),actorName:name(user.id),text,at:new Date().toISOString()});post.activity.push({actorName:name(user.id),action:'留下一条协作建议',at:new Date().toISOString()});audit(user,'post-comment',post.id,{title:post.title});return editPost(user,post.id);});}
  function postAsset(id,index,user,draft=false){const post=find(id);if(draft&&(!post||!editable(user,post)))fail('文件不存在',404);const block=draft?post?.blocks[index]:post?.publication?.blocks[index];if(!block?.mediaRef)fail('文件不存在',404);const reference=block.mediaRef;
    return {reference,media:reference.startsWith('/api/media/')?getState().media.find(item=>'/api/media/'+item.id===reference):null};}
  return {materialLibrary,listPosts,readPost,editPost,drafts,savePost,commentPost,postAsset};
}
