import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {applyPersonalPlan} from './personal-plans.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function createPersonalStore({getState,transaction}){
  const authorize=user=>{if(user?.role!=='owner'||user.access==='blocked')fail('个人空间仅供本人使用',403);};
  const current=()=>getState().personal||{revision:'empty',profile:{focus:'',projects:'',goals:'',about:''},records:[]};
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const tokenPattern=/^pc_[a-f0-9]{64}$/;
  const publicDevice=({id,name,createdAt,expiresAt,lastUsedAt})=>({id,name,createdAt,expiresAt,lastUsedAt});
  function personalDevices(user){authorize(user);return (getState().personalDevices||[]).filter(device=>device.owner===user.id).map(publicDevice);}
  function personalDeviceSave(user,input){
    authorize(user);
    if(input.action==='revoke')return transaction(()=>{
      getState().personalDevices=(getState().personalDevices||[]).filter(device=>device.owner!==user.id||device.id!==input.id);
      return {devices:personalDevices(user)};
    });
    if(input.action!=='create')fail('设备操作不正确');
    const name=(input.name||'iPhone · Siri');
    if(typeof name!=='string'||!name.trim()||name.length>60)fail('设备名称不正确');
    if(personalDevices(user).length>=5)fail('最多保留5个设备凭证，请先停用不用的凭证');
    const token='pc_'+randomBytes(32).toString('hex');
    const device={id:randomUUID(),owner:user.id,name:name.trim(),tokenHash:hash(token),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+365*86400000).toISOString(),lastUsedAt:null};
    return transaction(()=>{
      getState().personalDevices||=[];getState().personalDevices.push(device);
      return {token,device:publicDevice(device),devices:personalDevices(user)};
    });
  }
  function personalCapture(token,input){
    if(typeof token!=='string'||!tokenPattern.test(token))fail('手机凭证无效或已停用',401);
    const digest=Buffer.from(hash(token),'hex');
    const device=(getState().personalDevices||[]).find(row=>/^[a-f0-9]{64}$/.test(row.tokenHash||'')&&timingSafeEqual(Buffer.from(row.tokenHash,'hex'),digest));
    if(!device||!Number.isFinite(Date.parse(device.expiresAt))||Date.parse(device.expiresAt)<=Date.now())fail('手机凭证无效或已停用',401);
    const user=getState().users.find(row=>row.id===device.owner);
    if(user?.role!=='owner'||user.access==='blocked')fail('手机凭证无效或已停用',401);
    // Keep these cases distinct: a Shortcuts field can look populated while
    // arriving under a different key or as a dictionary rather than text.
    if(!Object.hasOwn(input,'body'))fail('未收到body字段，请将JSON左侧的键名重新输入为body');
    if(typeof input.body!=='string')fail('body字段不是文本，请将该JSON字段的类型设为文本');
    if(!input.body.trim())fail('body字段为空，请先确认听写结果有文字');
    if(input.body.length>8000)fail('想法超过8000字，请分成几条记录');
    const body=input.body.trim(),requestId=input.requestId;
    if(requestId!==undefined&&(typeof requestId!=='string'||!/^[\w.:-]{8,120}$/.test(requestId)))fail('请求标识格式不正确');
    const previous=requestId&&current().records.find(row=>row.deviceId===device.id&&row.requestId===requestId);
    const receipt=(record,duplicate)=>({ok:true,id:record.id,date:record.date,createdAt:record.createdAt,duplicate,message:duplicate?'这条想法已经记下':'已记下这条想法'});
    if(previous){if(previous.body!==body)fail('请求标识已用于另一条内容',409);return receipt(previous,true);}
    const at=new Date().toISOString();
    const dateParts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));
    const part=name=>dateParts.find(item=>item.type===name).value;
    const record={id:randomUUID(),kind:'thought',date:`${part('year')}-${part('month')}-${part('day')}`,body,sleep:null,createdAt:at,source:'siri',deviceId:device.id,...(requestId?{requestId}:{})};
    return transaction(()=>{
      const next=structuredClone(current());next.records.push(record);next.revision=randomUUID();next.updatedAt=at;
      getState().personal=next;device.lastUsedAt=at;
      return receipt(record,false);
    });
  }
  function personalRead(user){authorize(user);return structuredClone(current());}
  function personalSave(user,input){
    authorize(user);
    if(input.revision!==current().revision)fail('记录已更新，请先保留输入再刷新页面',409);
    const text=(value,max)=>{if(typeof value!=='string'||value.length>max)fail('文字格式不正确或过长');return value.trim();};
    const next=structuredClone(current()),at=new Date().toISOString();
    if(input.action==='profile'){
      for(const field of ['focus','projects','goals','about','availability','skills','constraints'])next.profile[field]=text(input.profile?.[field]??next.profile[field]??'',12000);
    }else if(input.action==='record'){
      if(!['day','week','thought'].includes(input.kind))fail('记录类型不正确');
      const date=text(input.date,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail('日期不正确');
      const body=text(input.body,20000);if(!body)fail('先写下一点内容');
      const sleep=input.sleep===''||input.sleep===undefined?null:Number(input.sleep);
      if(sleep!==null&&(!Number.isFinite(sleep)||sleep<0||sleep>24))fail('睡眠时长应在0到24小时之间');
      next.records.push({id:randomUUID(),kind:input.kind,date,body,sleep,createdAt:at,source:'manual'});
    }else if(!applyPersonalPlan(next,input))fail('保存操作不正确');
    next.revision=randomUUID();next.updatedAt=at;
    return transaction(()=>{getState().personal=next;return personalRead(user);});
  }
  return {personalRead,personalSave,personalDevices,personalDeviceSave,personalCapture};
}
