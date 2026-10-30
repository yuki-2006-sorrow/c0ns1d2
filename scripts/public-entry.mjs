import {createCollaborationFrontend} from '../admin/collaboration-frontend.mjs';

// Generate from empty shells, never from a real account or archive.json.
export function createPublicEntry(root){
  const frontend=createCollaborationFrontend(root,{entries:()=>[]});
  const html=frontend.render('/',{id:'__visitor__',name:'访客',role:'guest',canCreate:false});
  return html.replace('<div class="red-flash"','<p class="bridge-offline-notice" role="status">共享资料暂时离线，开场仍可观看。<a href="/">重新连接 →</a></p><div class="red-flash"')
    .replace(/<div id="homeEmpty">[\s\S]*?<\/div>/,'<div id="homeEmpty"><h2>记忆库暂时未连接</h2><p>站主电脑恢复连接后，便可继续浏览获准分享给你的记忆。</p><a href="/">重新连接 →</a><a href="/shared?return=home">登录／答题加入 →</a></div>');
}
