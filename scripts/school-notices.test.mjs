import test from 'node:test';import assert from 'node:assert/strict';import {parseSchoolNotices,fetchSchoolNotices,fetchStudentNotices} from '../admin/school-notices.mjs';
test('notice source deduplicates exact campus URLs and keeps publication separate from deadlines',async()=>{
 const link='<a href="/2026/1102/c123a456/page.htm" title="本科生AI比赛通知">本科生AI比赛通知</a>';
 const html=link+link+'<a href="https://evil.example/2026/1102/c123a456/page.htm" title="活动">外部</a>';
 const notices=parseSchoolNotices(html);assert.equal(notices.length,1);assert.equal(notices[0].published,'2026-11-02');assert.equal(notices[0].relevant,true);assert.ok(!('deadline' in notices[0]));
 assert.deepEqual(await fetchSchoolNotices(async()=>new Response(html)),notices);await assert.rejects(()=>fetchSchoolNotices(async()=>new Response('<html>请登录</html>')),/未读取到/);
});
test('student notices use their own fixed origin and preserve publication dates',async()=>{
 const html='<a href="/2026/1102/c53018a1/page.htm" title="关于开展开源课堂书画班的通知">通知</a><a href="/2026/1101/c53018a2/page.htm" title="关于公示获奖学生名单的通知">公示</a><a href="https://evil.example/2026/1102/c1a1/page.htm" title="外部活动通知">外部</a>';
 const notices=await fetchStudentNotices(async(url,options)=>{assert.equal(url,'http://www.xgb.zju.edu.cn/');assert.equal(options.redirect,'error');assert.ok(!options.headers.Authorization);return new Response(html);});
 assert.equal(notices.length,2);assert.equal(notices[0].source,'浙大学工部');assert.equal(notices[0].published,'2026-11-02');assert.equal(notices[0].relevant,true);assert.equal(notices[1].relevant,false);
});
