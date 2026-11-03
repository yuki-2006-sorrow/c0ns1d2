const school={url:'https://zhfw.zju.edu.cn/',name:'浙大综合服务网'};
const student={url:'http://www.xgb.zju.edu.cn/',name:'浙大学工部',student:true};
export function parseSchoolNotices(html,source=school){
 const notices=new Map();
 const decode=value=>value.replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/<[^>]+>/g,'').trim();
 for(const match of html.matchAll(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi)){
  const href=/\bhref\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1],title=/\btitle\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
  if(!href||!title)continue;let url;try{url=new URL(href,source.url);}catch{continue;}
  const date=/^\/(\d{4})\/(\d{2})(\d{2})\/.+\/page\.(?:htm|psp)$/.exec(url.pathname);
  if(url.origin!==new URL(source.url).origin||!date)continue;
  const name=decode(title);if(name.length<4||name.length>300)continue;
  notices.set(url.href,{url:url.href,title:name,published:date[1]+'-'+date[2]+'-'+date[3],source:source.name,relevant:(source.student||/活动|讲座|报名|比赛|竞赛|本科|课程|AI|展览|交流|创新|英语|摄影|考试|奖学金|招募/i.test(name))&&!/科技成果转化|负面清单|项目申报指南|退休人员|教职工|公示/.test(name)});
 }
 return [...notices.values()].sort((a,b)=>b.published.localeCompare(a.published)).slice(0,150);
}
async function fetchNoticeSource(source,forward){
 const response=await forward(source.url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'text/html'}});
 if(!response.ok)throw Error(source.name+'返回 '+response.status);
 const reader=response.body.getReader();let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2e6){await reader.cancel();throw Error('来源页面过大');}chunks.push(value);}
 const notices=parseSchoolNotices(Buffer.concat(chunks).toString('utf8'),source);if(!notices.length)throw Error('未读取到通知列表，可能需要校园网或登录；旧数据保留');return notices;
}
export const fetchSchoolNotices=(forward=fetch)=>fetchNoticeSource(school,forward);
export const fetchStudentNotices=(forward=fetch)=>fetchNoticeSource(student,forward);
