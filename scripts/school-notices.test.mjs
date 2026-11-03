import test from 'node:test';import assert from 'node:assert/strict';import {parseSchoolNotices,fetchSchoolNotices} from '../admin/school-notices.mjs';
test('notice source deduplicates exact campus URLs and keeps publication separate from deadlines',async()=>{
 const link='<a href="/2026/1102/c123a456/page.htm" title="本科生AI比赛通知">本科生AI比赛通知</a>';
 const html=link+link+'<a href="https://evil.example/2026/1102/c123a456/page.htm" title="活动">外部</a>';
 const notices=parseSchoolNotices(html);assert.equal(notices.length,1);assert.equal(notices[0].published,'2026-11-02');assert.equal(notices[0].relevant,true);assert.ok(!('deadline' in notices[0]));
 assert.deepEqual(await fetchSchoolNotices(async()=>new Response(html)),notices);await assert.rejects(()=>fetchSchoolNotices(async()=>new Response('<html>请登录</html>')),/未读取到/);
});
