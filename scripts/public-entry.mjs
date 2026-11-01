import {renderGallery} from '../admin/post-pages.mjs';

// Generate from empty shells, never from a real account or archive.json.
export function createPublicEntry(){
  const html=renderGallery({listPosts:()=>[]},{id:'__visitor__',name:'访客',role:'guest',canCreate:false});
  return html.replace('<main class="exhibition">','<main class="exhibition"><section class="exhibit-empty" role="status"><h2>创作空间暂时未连接</h2><p>连接恢复后即可浏览已发布的帖子。开场仍可观看。</p><a href="/">重新连接 →</a></section>');
}
