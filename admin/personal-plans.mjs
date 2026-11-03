import {randomUUID} from 'node:crypto';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const text=(value,max)=>{if(typeof value!=='string'||value.length>max)fail('文字格式不正确或过长');return value.trim();};
const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('日期不正确');return value;};
export function applyPersonalPlan(next,input){
  next.projects||=[];next.tasks||=[];
  const at=new Date().toISOString();
  if(input.action==='initializePlans'){
    if(next.plansInitialized)return true;
    next.plansInitialized=true;
  }else if(input.action==='timetableImport'){
    // The server supplies the parsed snapshot; browser JSON cannot write this
    // action directly through personalSave (checked by the HTTP route).
    const snapshot=input.snapshot;
    if(!snapshot?.sourceHash||!Array.isArray(snapshot.courses))fail('课表快照不正确');
    next.timetables||=[];
    const existing=next.timetables.find(item=>item.sourceKey===snapshot.sourceKey);
    if(existing?.sourceHash===snapshot.sourceHash)return true;
    const record={...snapshot,importedAt:at,source:'教务课表 Excel'};
    if(existing)Object.assign(existing,record);else next.timetables.push(record);
  }else if(input.action==='noticeImport'){
    if(!Array.isArray(input.notices)||input.notices.length>150)fail('通知数据不正确');
    const known=new Map((next.notices||[]).map(notice=>[notice.url,notice]));
    for(const notice of input.notices)known.set(notice.url,{...notice,seenAt:at});
    next.notices=[...known.values()].sort((a,b)=>b.published.localeCompare(a.published)).slice(0,300);
  }else if(input.action==='documentImport'){
    next.documents||=[];const existing=next.documents.find(doc=>doc.sourceKey===input.sourceKey);
    if(typeof input.text!=='string'||!input.text.trim()||input.text.length>64000)fail('资料文字不正确');
    if(!existing&&next.documents.length>=200)fail('最多自动导入200份资料');
    const doc={id:existing?.id||randomUUID(),sourceKey:text(input.sourceKey,100),sourceName:text(input.sourceName,120),name:text(input.name,240),contentHash:text(input.contentHash,100),text:input.text,totalCharacters:input.totalCharacters,truncated:input.truncated===true,projectId:existing?.projectId||'',shareWithAI:existing?.shareWithAI??true,updatedAt:at,stale:false};
    if(existing)Object.assign(existing,doc);else next.documents.push(doc);
  }else if(input.action==='documentState'){
    const doc=(next.documents||[]).find(doc=>doc.sourceKey===input.sourceKey);if(!doc)return true;doc.stale=true;doc.lastError=text(input.error,500);
  }else if(input.action==='documentSetting'){
    const doc=(next.documents||[]).find(doc=>doc.id===input.id);if(!doc)fail('资料不存在');const projectId=input.projectId||'';if(projectId&&!next.projects.some(project=>project.id===projectId))fail('项目不存在');if(typeof input.shareWithAI!=='boolean')fail('请选择共享状态');doc.projectId=projectId;doc.shareWithAI=input.shareWithAI;
  }else if(input.action==='resource'){
    next.resources||=[];
    const existing=input.id?next.resources.find(resource=>resource.id===input.id):null;
    if(input.id&&!existing)fail('资源不存在');
    if(!existing&&next.resources.length>=100)fail('最多保留100项资源');
    const title=text(input.title,120);if(!title)fail('请填写资源名称');
    if(!['material','course','device','tool','support','other'].includes(input.kind))fail('资源类型不正确');
    if(!['available','planned','unavailable'].includes(input.status))fail('资源状态不正确');
    const projectId=input.projectId||'';if(projectId&&!next.projects.some(project=>project.id===projectId))fail('关联项目不存在');
    if(typeof input.shareWithAI!=='boolean')fail('请选择是否供 AI 参考');
    const resource={id:existing?.id||randomUUID(),title,kind:input.kind,status:input.status,projectId,detail:text(input.detail,4000),shareWithAI:input.shareWithAI,createdAt:existing?.createdAt||at,updatedAt:at};
    if(existing)Object.assign(existing,resource);else next.resources.push(resource);
  }else if(input.action==='project'){
    const existing=input.id?next.projects.find(project=>project.id===input.id):null;
    if(input.id&&!existing)fail('项目不存在');
    const title=text(input.title,120);if(!title)fail('请填写项目名称');
    if(!['active','paused','done'].includes(input.status))fail('项目状态不正确');
    const progress=input.progress===''||input.progress===null?null:Number(input.progress);
    if(progress!==null&&(!Number.isFinite(progress)||progress<0||progress>100))fail('进度应在0到100之间，也可以留空');
    const deadline=input.deadline?date(input.deadline):'';
    const project={id:existing?.id||randomUUID(),createdAt:existing?.createdAt||at,title,status:input.status,progress,deadline,nextAction:text(input.nextAction,500),note:text(input.note,4000),updatedAt:at};
    if(existing)Object.assign(existing,project);else next.projects.push(project);
  }else if(input.action==='task'){
    const title=text(input.title,500);if(!title)fail('请填写具体要做的事情');
    const projectId=input.projectId||'';if(projectId&&!next.projects.some(project=>project.id===projectId))fail('关联项目不存在');
    const taskDate=date(input.date);
    if(next.tasks.some(task=>task.title===title&&task.projectId===projectId&&task.date===taskDate))fail('这一天已安排过同一任务');
    next.tasks.push({id:randomUUID(),title,projectId,date:taskDate,done:false,createdAt:at,updatedAt:at});
  }else if(input.action==='taskBatch'){
    if(typeof input.batchId!=='string'||!/^[-\w]{8,100}$/.test(input.batchId))fail('任务清单标识不正确');
    const previous=next.tasks.filter(task=>task.batchId===input.batchId);
    if(previous.length){
      if(!Array.isArray(input.steps)||JSON.stringify(previous.map(task=>({title:task.title,date:task.date,projectId:task.projectId})))!==JSON.stringify(input.steps.map(step=>({title:typeof step.title==='string'?step.title.trim():null,date:input.date,projectId:input.projectId}))))fail('该任务清单已保存，请到每日计划查看，修改后不要重复提交');
      return true;
    }
    if(!next.projects.some(project=>project.id===input.projectId))fail('关联项目不存在');
    if(input.projectUpdatedAt&&next.projects.find(project=>project.id===input.projectId).updatedAt!==input.projectUpdatedAt)fail('项目已更新，请重新拆解或检查步骤后再安排');
    if(!Array.isArray(input.steps)||!input.steps.length||input.steps.length>8)fail('请选择1到8个步骤');
    const taskDate=date(input.date);
    const steps=input.steps.map(step=>{const title=text(step.title,500);if(!title)fail('步骤不能为空');return title;});
    for(const title of steps)next.tasks.push({id:randomUUID(),title,projectId:input.projectId,date:taskDate,done:false,createdAt:at,updatedAt:at,source:'ai-reviewed',batchId:input.batchId});
  }else if(input.action==='taskStatus'){
    const task=next.tasks.find(task=>task.id===input.id);if(!task)fail('任务不存在');
    if(typeof input.done!=='boolean')fail('任务状态不正确');
    task.done=input.done;task.updatedAt=at;task.completedAt=input.done?at:null;
  }else if(input.action==='taskMove'){
    const task=next.tasks.find(task=>task.id===input.id);if(!task)fail('任务不存在');
    task.date=date(input.date);task.updatedAt=at;
  }else return false;
  return true;
}
