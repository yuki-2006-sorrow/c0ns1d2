import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,lstatSync,realpathSync,copyFileSync} from 'node:fs';
import {join,resolve,extname,basename,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {parseTimetable} from './timetable-import.mjs';
import {fetchSchoolNotices} from './school-notices.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function extract(bytes,name){return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./material-worker.mjs',import.meta.url),{workerData:{bytes,name},resourceLimits:{maxOldGenerationSizeMb:192}});const timer=setTimeout(()=>{worker.terminate();reject(Error('文件读取超过30秒，已停止'));},30000);worker.once('message',message=>{clearTimeout(timer);worker.terminate();message.error?reject(Error(message.error)):resolve(message.result);});worker.once('error',error=>{clearTimeout(timer);reject(error);});worker.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('文件解析进程已停止'));});});}
export function createAutoImporter(root,store,{fetchNotices=fetchSchoolNotices}={}){
 const directory=join(root,'.local-collaboration'),inbox=join(directory,'自动导入');mkdirSync(inbox,{recursive:true});
 const configFile=join(directory,'import-sources.json'),stateFile=join(directory,'import-state.json');
 let report=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{files:{},lastRun:null},running=false;
 const persist=()=>{writeFileSync(stateFile+'.tmp',JSON.stringify(report));renameSync(stateFile+'.tmp',stateFile);};
 const sources=()=>[{id:'inbox',name:'课程资料目录',kind:'folder',path:inbox},...(existsSync(configFile)?JSON.parse(readFileSync(configFile,'utf8')).sources||[]:[])];
 function status(){return {running,lastRun:report.lastRun,error:report.error,webSource:report.webSource||{status:'waiting'},intervalSeconds:60,sources:sources().map(({id,name,kind,path})=>({id,name,kind,path})),files:Object.values(report.files).map(({name,status,error,updatedAt,characters})=>({name,status,error,updatedAt,characters})).slice(-100)};}
 async function run({force=false}={}){
  if(running)return status();running=true;let backupMade=false;
  try{
   const archive=JSON.parse(readFileSync(join(directory,'archive.json'),'utf8'));const owner=store.checkedUser(archive.users.find(user=>user.role==='owner'&&user.access!=='blocked').id);
   const save=input=>{if(!backupMade){mkdirSync(join(directory,'backups'),{recursive:true});copyFileSync(join(directory,'archive.json'),join(directory,'backups','before-auto-import-'+Date.now()+'.json'));backupMade=true;}return store.personalSave(owner,{...input,revision:store.personalRead(owner).revision});};
   for(const source of sources()){
    let paths=[];
    if(source.kind==='file')paths=[source.path];
    else if(source.kind==='folder'&&existsSync(source.path)){
     const base=realpathSync(source.path);const scan=(dir,depth)=>{if(depth>5||paths.length>=200)return;for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink()||entry.name.startsWith('~$')||entry.name.startsWith('.'))continue;const file=join(dir,entry.name),rel=relative(base,realpathSync(file));if(rel.startsWith('..')||isAbsolute(rel))continue;if(entry.isDirectory())scan(file,depth+1);else if(entry.isFile())paths.push(file);if(paths.length>=200)break;}};scan(base,0);
    }
    for(const file of paths){
     const key=hash(source.id+'\n'+resolve(file));let fingerprint;
     try{
      if(!existsSync(file))throw Error('源文件不存在，已保留上次导入数据');const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('不是普通文件');
      if(Date.now()-stat.mtimeMs<3000)continue;
      if(stat.size>15*1024*1024)throw Error('文件超过15MB，未读取');
      const bytes=readFileSync(file);fingerprint=hash(bytes);if(report.files[key]?.hash===fingerprint&&report.files[key]?.status==='ready')continue;
      report.files[key]={sourceId:source.id,path:file,name:basename(file),hash:fingerprint,status:'reading',updatedAt:new Date().toISOString()};persist();
      if(extname(file).toLowerCase()==='.xlsx'){save({action:'timetableImport',snapshot:parseTimetable(bytes)});}
      else{const parsed=await extract(bytes,basename(file));save({action:'documentImport',sourceKey:key,sourceName:source.name,name:basename(file),contentHash:fingerprint,...parsed});report.files[key].characters=parsed.text.length;}
      report.files[key].status='ready';
     }catch(error){report.files[key]={sourceId:source.id,path:file,name:basename(file),hash:fingerprint,status:'failed',error:error.message,updatedAt:new Date().toISOString()};if(store.personalRead(owner).documents?.some(doc=>doc.sourceKey===key&&!doc.stale))save({action:'documentState',sourceKey:key,error:error.message.slice(0,500)});}
     persist();
    }
    for(const [key,old]of Object.entries(report.files))if(old.sourceId===source.id&&old.path&&!existsSync(old.path)&&old.status!=='failed'){old.status='failed';old.error='源文件已移走，保留旧记录但暂不供AI参考';if(store.personalRead(owner).documents?.some(doc=>doc.sourceKey===key&&!doc.stale))save({action:'documentState',sourceKey:key,error:old.error});persist();}
   }
   const config=existsSync(configFile)?JSON.parse(readFileSync(configFile,'utf8')):{};
   if(config.schoolNotices===true&&(force||!report.webSource?.checkedAt||Date.now()-Date.parse(report.webSource.checkedAt)>(report.webSource.status==='failed'?300000:3600000))){
    const checkedAt=new Date().toISOString();try{const notices=await fetchNotices();const known=new Map((store.personalRead(owner).notices||[]).map(notice=>[notice.url,notice]));if(notices.some(notice=>Object.entries(notice).some(([key,value])=>known.get(notice.url)?.[key]!==value)))save({action:'noticeImport',notices});report.webSource={status:'ready',name:'浙大综合服务网',url:'https://zhfw.zju.edu.cn/',checkedAt,lastSuccess:checkedAt,count:notices.length};}catch(error){report.webSource={...report.webSource,status:'failed',checkedAt,error:error.message};}
   }
   report.lastRun=new Date().toISOString();report.error=null;persist();
  }catch(error){report.error=error.message;persist();}finally{running=false;}
  return status();
 }
 const timer=setInterval(()=>run(),60000);timer.unref();
 return {run,status,stop:()=>clearInterval(timer)};
}
