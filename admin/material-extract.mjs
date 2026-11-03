import {extname} from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
export async function extractMaterial(bytes,name){
 const extension=extname(name).toLowerCase();let text='';
 if(bytes.length>15*1024*1024)throw Error('文件超过15MB，未导入');
 if(['.txt','.md'].includes(extension)){text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 else if(['.docx','.pptx'].includes(extension)){
  let total=0;const files=unzipSync(bytes,{filter:file=>{if(!/^(word\/document\.xml|ppt\/slides\/slide\d+\.xml)$/.test(file.name))return false;total+=file.originalSize;if(total>12e6||file.originalSize>4e6)throw Error('文档解压后过大');return true;}});
  const parser=new XMLParser({preserveOrder:true,ignoreAttributes:true,parseTagValue:false});
  const walk=nodes=>{let result='';for(const item of nodes||[])for(const [key,value]of Object.entries(item)){if(key==='w:t'||key==='a:t')result+=(value||[]).map(x=>x['#text']||'').join('');else if(Array.isArray(value))result+=walk(value);if(key==='w:p'||key==='a:p')result+='\n';}return result;};
  for(const key of Object.keys(files).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))){const xml=strFromU8(files[key]);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('文档XML格式不受支持');text+=walk(parser.parse(xml))+'\n';}
 }else if(extension==='.pdf'){
  const {PDFParse}=await import('pdf-parse');const parser=new PDFParse({data:new Uint8Array(bytes),isEvalSupported:false});
  try{const result=await parser.getText();text=result.text;}finally{await parser.destroy();}
 }else throw Error('暂不支持该格式。可自动读取PDF、DOCX、PPTX、TXT和MD');
 text=text.replace(/\u0000/g,'').trim();
 if(!text)throw Error('未提取到文字，可能是扫描件或图片；尚未进行OCR');
 return {text:text.slice(0,64000),totalCharacters:text.length,truncated:text.length>64000};
}
