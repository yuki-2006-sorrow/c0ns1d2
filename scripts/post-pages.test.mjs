import test from 'node:test';
import assert from 'node:assert/strict';
import {renderGallery,renderMaterials,renderPost} from '../admin/post-pages.mjs';

test('only the work gallery loads the intro; all other entry points remain direct',()=>{
  const visitor={role:'guest',name:'访客'};
  const post={id:'published',title:'<script>title</script>',author:'作者',subtitle:'简介',publishedAt:'2026-11-01',blocks:[{kind:'text',text:'选定的文字'}]};
  const store={listPosts:()=>[post],readPost:()=>post};
  const gallery=renderGallery(store,visitor);
  assert.match(gallery,/src="\/intro-entry.js"/);
  assert.match(gallery,/id="replay-intro"/);
  assert.ok(!gallery.includes('<script>title</script>'));
  assert.match(gallery,/选定的文字/);
  assert.ok(!renderPost(store,visitor,post.id).includes('/intro-entry.js'));
  assert.ok(!renderMaterials({role:'owner',name:'作者'}).includes('/intro-entry.js'));
});
