import {zipSync,strToU8} from 'fflate';
export function timetableFixture(extra=''){
 const rows=[['2026-2027学年秋冬学期测试课表'],['课程代码','课程名称','教师姓名','学期','上课时间','上课地点'],['TEST100','测试课程','教师','秋冬','周三第6,7,8节','教室A'],['TEST100','测试课程','教师','秋冬','周三第6,7,8节;周五第3,4节','教室A;教室B']];
 const sheet='<worksheet><sheetData>'+rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((value,j)=>'<c r="'+'ABCDEFGH'[j]+(i+1)+'" t="inlineStr"><is><t>'+value+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>';
 return zipSync({'xl/worksheets/sheet1.xml':strToU8(extra||sheet)});
}
