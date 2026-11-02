import {unzipSync,strFromU8} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
import {createHash} from 'node:crypto';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const many=value=>value===undefined?[]:Array.isArray(value)?value:[value];
const text=value=>typeof value==='object'&&value!==null?String(value['#text']??''):String(value??'');
export function parseTimetable(bytes){
 if(!bytes.length||bytes.length>512*1024)fail('课表文件应为512KB以内的xlsx');
 let files,total=0,count=0;
 try{files=unzipSync(bytes,{filter:file=>{if(++count>1000)throw Error();if(!/^xl\/(sharedStrings\.xml|worksheets\/sheet1\.xml)$/.test(file.name))return false;total+=file.originalSize;if(file.originalSize>2e6||total>4e6)throw Error();return true;}});}catch{fail('无法读取xlsx，或文件解压后过大');}
 const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:false});
 const xml=path=>{if(!files[path])return null;const source=strFromU8(files[path]);if(/<!DOCTYPE|<!ENTITY/i.test(source))fail('课表XML格式不受支持');try{return parser.parse(source);}catch{fail('课表XML无法解析');}};
 const strings=many(xml('xl/sharedStrings.xml')?.sst?.si).map(si=>si.t!==undefined?text(si.t):many(si.r).map(r=>text(r.t)).join(''));
 const sheet=xml('xl/worksheets/sheet1.xml');if(!sheet)fail('没有找到第一张课表工作表');
 const rows=many(sheet.worksheet?.sheetData?.row);if(rows.length>1000)fail('课表行数过多');
 const cells=new Map();for(const row of rows)for(const cell of many(row.c)){const ref=cell['@_r'];if(!/^[A-H]\d{1,4}$/.test(ref))continue;const value=cell['@_t']==='s'?strings[Number(cell.v)]:cell['@_t']==='inlineStr'?text(cell.is?.t)||many(cell.is?.r).map(r=>text(r.t)).join(''):text(cell.v);cells.set(ref,String(value??'').trim());}
 const title=cells.get('A1')||'',match=/^(\d{4}-\d{4})学年(秋冬|春夏|秋|冬|春|夏)学期/.exec(title);
 if(!match||cells.get('A2')!=='课程代码'||cells.get('B2')!=='课程名称'||cells.get('E2')!=='上课时间')fail('课表格式不匹配，请使用教务系统导出的课程列表xlsx');
 const courses=new Map(),warnings=[];let rawRowCount=0;
 for(const row of rows){const index=Number(row['@_r']);if(index<3)continue;const code=cells.get('A'+index);if(!code)continue;if(!/^[A-Za-z0-9_-]{2,40}$/.test(code))fail('课程代码格式不正确');rawRowCount++;
  const name=cells.get('B'+index)||'',term=cells.get('D'+index)||'',time=cells.get('E'+index)||'',location=cells.get('F'+index)||'',teacher=cells.get('C'+index)||'';
  if(!name||name.length>200||time.length>1000)fail('课程名称或时间格式不正确');
  if(!courses.has(code))courses.set(code,{code,name,terms:[],teachers:[],sessions:[],rawRows:[]});const course=courses.get(code);
  if(course.name!==name)fail('同一课程代码对应多个名称，请检查源表');
  if(!course.terms.includes(term))course.terms.push(term);if(teacher&&!course.teachers.includes(teacher))course.teachers.push(teacher);
  course.rawRows.push({row:index,term,time,location,teacher});
  const locations=location.split(/[;；]/);for(const [i,part] of time.split(/[;；]/).entries()){if(!part.trim())continue;const parsed=/^(秋|冬|春|夏)?周([一二三四五六日天])第([\d,，]+)节$/.exec(part.trim());if(!parsed){warnings.push(name+'：保留未识别时间“'+part+'”');continue;}
   const periods=parsed[3].split(/[,，]/).map(Number);if(periods.some(n=>!Number.isInteger(n)||n<1||n>20))fail('课程节次不正确');
   const session={term:parsed[1]||term,weekday:'一二三四五六日'.indexOf(parsed[2]==='天'?'日':parsed[2])+1,periods,location:locations[i]||''};
   if(!course.sessions.some(old=>JSON.stringify(old)===JSON.stringify(session)))course.sessions.push(session);
  }
 }
 if(!courses.size)fail('课表没有可导入的课程');
 return {schoolYear:match[1],term:match[2],sourceKey:match[1]+':'+match[2],sourceHash:createHash('sha256').update(bytes).digest('hex'),rawRowCount,courses:[...courses.values()],warnings,limitations:['文件未包含具体教学日期、教学周或节次钟点，不能据此准确计算每日空闲时段。']};
}
