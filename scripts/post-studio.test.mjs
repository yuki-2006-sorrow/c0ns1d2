import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoState, appendSource, addNote, addMediaSource, safeMediaUrl, editClip, editPost, moveClip, removeClip, undo, redo, addComment, serializeDraft, restoreDraft } from '../admin/post-studio-model.mjs';

test('post excerpts and ordering never change the original materials', () => {
  const initial = createDemoState(), originals = structuredClone(initial.materials);
  let state = appendSource(initial, 'friendship', '你');
  const clip = state.clips.at(-1);
  state = editClip(state, clip.id, {text:'剪辑过的引用文字'});
  state = moveClip(state, clip.id, 0);
  assert.equal(state.clips[0].text,'剪辑过的引用文字');
  state = removeClip(state, clip.id);
  assert.deepEqual(state.materials, originals);
  assert.deepEqual(initial.materials, originals);
  assert.equal(initial.clips.length,3);
});
test('undo and redo restore the complete document and coalesce consecutive text edits', () => {
  const initial = createDemoState(), clip = initial.clips[1];
  let state = editClip(initial,clip.id,{text:'一'});
  state = editClip(state,clip.id,{text:'一段文字'});
  assert.equal(state.undoStack.length,1);
  state = undo(state);assert.equal(state.clips[1].text,clip.text);
  state = redo(state);assert.equal(state.clips[1].text,'一段文字');
  state = editPost(state,{title:'新帖子'});state = undo(state);assert.equal(state.title,initial.title);
  state = addNote(state);assert.equal(state.clips.at(-1).sourceId,null);assert.equal(state.redoStack.length,0);
});
test('local comments identify an actor and remain through document undo', () => {
  let state=addNote(createDemoState());const clipId=state.selectedId;
  state=addComment(state,'  这里可以接一段照片  ','你');
  state=undo(state);
  assert.equal(state.comments[0].actor,'你');assert.equal(state.comments[0].clipId,clipId);
  assert.equal(state.comments[0].text,'这里可以接一段照片');
  assert.ok(state.activity.every(row=>row.actor==='你'));
});
test('draft reload validates its version and source references; sources come from the known library', () => {
  let state=editPost(addNote(createDemoState()),{title:'保存后的帖子'});
  state=addComment(state,'保留这段');
  const restored=restoreDraft(serializeDraft(state));
  assert.equal(restored.title,state.title);assert.deepEqual(restored.clips,state.clips);assert.equal(restored.comments.length,1);
  const invalid=JSON.parse(serializeDraft(state));invalid.version=99;
  assert.throws(()=>restoreDraft(invalid),/版本/);
  invalid.version=1;invalid.document.clips[0].sourceId='https://unsafe.example/private';
  assert.throws(()=>restoreDraft(invalid),/片段/);
});

test('audio/video embeds accept safe media references, survive reload and reject active or credentialed URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:video/mp4;base64,xxx', '//external.example/movie.mp4', '/\\external.example/movie.mp4', 'http://example.com/a.mp3', 'https://user:password@example.com/a.mp3']) assert.throws(()=>safeMediaUrl(url));
  assert.equal(safeMediaUrl('/intro/intro.mp4'),'/intro/intro.mp4');
  const state=addMediaSource(createDemoState(),{type:'audio',title:'一段声音',url:'https://example.com/voice.mp3'});
  assert.equal(state.materials.at(-1).type,'audio');assert.equal(state.clips.at(-1).sourceId,state.materials.at(-1).id);
  const restored=restoreDraft(serializeDraft(state));
  assert.equal(restored.materials.at(-1).media,'https://example.com/voice.mp3');
  assert.equal(restored.clips.at(-1).sourceId,state.clips.at(-1).sourceId);
  const invalid=JSON.parse(serializeDraft(state));invalid.customMaterials[0].media='javascript:alert(1)';assert.throws(()=>restoreDraft(invalid));
});
