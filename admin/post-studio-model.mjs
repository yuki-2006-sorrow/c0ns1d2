export const DRAFT_VERSION = 1;
const clone = value => structuredClone(value);
const id = () => globalThis.crypto?.randomUUID?.() || 'clip-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

export function createDemoState() {
  const materials = [
    { id: 'summer-image', type: 'image', title: '放学后，向夏天走去', text: '', image: '/studio-sample.svg', caption: '傍晚的路 · 示例插画', author: '林', date: '2026-06-18' },
    { id: 'last-day', type: 'event', title: '最后一次一起走出校门', text: '最后一场考试结束，我们没有马上回家。\n有人提议再绕操场走一圈，于是所有人又默契地慢了下来。', author: '你', date: '2026-06-18' },
    { id: 'summer-thought', type: 'thought', title: '原来告别没有那么响亮', text: '以前总以为告别应该很郑重，后来发现，它常常只是一个普通的下午。\n直到很久以后，我们才知道那一天有多特别。', author: '林', date: '2026-06-19' },
    { id: 'friendship', type: 'opinion', title: '一起经历过，比合照更重要', text: '一段关系最值得留下的，不只是我们站在一起的照片，还有我们为什么会站在一起。', author: '你', date: '2026-06-20' },
    { id: 'small-shop', type: 'essay', title: '校门口的小店，还没打烊', text: '风扇转得很慢，老板还是记得我们平时点的东西。\n我们聊了以后要去的城市，又约定下次回来还坐这一桌。', author: '林', date: '2026-06-21' },
    { id: 'opening-video', type: 'video', title: '那些闪过的片刻', text: '', media: '/intro/intro.mp4', caption: '影片片段 · 示例视频', author: '你', date: '2026-06-22' },
  ];
  const clips = materials.slice(0, 3).map((source, index) => ({ id: 'opening-' + index, sourceId: source.id, text: source.text, caption: source.caption || '', author: '你' }));
  return { version: DRAFT_VERSION, materials, title: '毕业前的最后一个夏天', subtitle: '把散落在不同人手里的片刻，剪成我们共同的回忆。', clips,
    selectedId: clips[0].id, undoStack: [], redoStack: [], activity: [], comments: [], batch: null };
}

function snapshot(state) {
  return clone({ title: state.title, subtitle: state.subtitle, clips: state.clips, selectedId: state.selectedId });
}
function changed(state, label, action, actor = '你', batch = null) {
  const next = clone(state);
  if (!batch || state.batch !== batch) next.undoStack = [...state.undoStack, snapshot(state)].slice(-40);
  next.redoStack = [];
  action(next);
  const log = { id: id(), actor, text: label, at: new Date().toISOString() };
  if (batch && state.batch === batch && next.activity.length) next.activity[next.activity.length - 1] = log;
  else next.activity.push(log);
  next.activity = next.activity.slice(-100);
  next.batch = batch;
  return next;
}
export function selectClip(state, clipId) {
  if (!state.clips.some(clip => clip.id === clipId)) return state;
  return { ...state, selectedId: clipId, batch: null };
}
export function appendSource(state, sourceId, actor = '你') {
  const source = state.materials.find(item => item.id === sourceId);
  if (!source) return state;
  return changed(state, '加入素材「' + source.title + '」', next => {
    const clip = { id: id(), sourceId, text: source.text, caption: source.caption || '', author: actor };
    next.clips.push(clip); next.selectedId = clip.id;
  }, actor);
}
export function addNote(state, actor = '你') {
  return changed(state, '添加一段串联文字', next => {
    const clip = { id: id(), sourceId: null, text: '在这里写下串起这些片刻的话。', caption: '', author: actor };
    next.clips.push(clip); next.selectedId = clip.id;
  }, actor);
}
export function safeMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 3000 || /[\\\u0000-\u0020]/.test(value)) throw new Error('请使用 HTTPS 媒体链接或本站路径');
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  let url; try { url = new URL(value); } catch { throw new Error('媒体链接格式不正确'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('请使用 HTTPS 媒体链接，不含账号或密码');
  return url.href;
}
export function addMediaSource(state, input, actor = '你') {
  if (!input || !['audio', 'video'].includes(input.type)) throw new Error('请选择音频或视频');
  const media = safeMediaUrl(input.url);
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 180) : '';
  if (!title) throw new Error('给这份媒体素材起一个名字');
  return changed(state, '嵌入' + (input.type === 'audio' ? '音频' : '视频') + '素材「' + title + '」', next => {
    const source = { id: id(), type: input.type, title, text: '', media, caption: '', author: actor, date: new Date().toISOString().slice(0, 10), custom: true };
    next.materials.push(source);
    const clip = { id: id(), sourceId: source.id, text: '', caption: '', author: actor };
    next.clips.push(clip); next.selectedId = clip.id;
  }, actor);
}
export function editClip(state, clipId, patch, actor = '你') {
  const current = state.clips.find(clip => clip.id === clipId);
  if (!current) return state;
  const safe = Object.fromEntries(Object.entries(patch).filter(([key, value]) => ['text', 'caption'].includes(key) && typeof value === 'string'));
  if (!Object.keys(safe).some(key => safe[key] !== current[key])) return state;
  return changed(state, '修改片段文字', next => Object.assign(next.clips.find(clip => clip.id === clipId), safe), actor, 'edit-' + clipId);
}
export function editPost(state, patch, actor = '你') {
  const safe = Object.fromEntries(Object.entries(patch).filter(([key, value]) => ['title', 'subtitle'].includes(key) && typeof value === 'string'));
  if (!Object.keys(safe).some(key => safe[key] !== state[key])) return state;
  return changed(state, '修改帖子标题或简介', next => Object.assign(next, safe), actor, 'meta-' + Object.keys(safe).join('-'));
}
export function moveClip(state, clipId, toIndex, actor = '你') {
  const from = state.clips.findIndex(clip => clip.id === clipId);
  const target = Math.max(0, Math.min(state.clips.length - 1, Math.trunc(toIndex)));
  if (from < 0 || !Number.isFinite(target) || from === target) return state;
  return changed(state, '调整第 ' + (from + 1) + ' 个片段的顺序', next => {
    const [clip] = next.clips.splice(from, 1); next.clips.splice(target, 0, clip); next.selectedId = clipId;
  }, actor);
}
export function removeClip(state, clipId, actor = '你') {
  const index = state.clips.findIndex(clip => clip.id === clipId);
  if (index < 0) return state;
  return changed(state, '移除第 ' + (index + 1) + ' 个片段的引用', next => {
    next.clips.splice(index, 1);
    next.selectedId = next.clips[Math.min(index, next.clips.length - 1)]?.id || null;
  }, actor);
}
export function undo(state, actor = '你') {
  if (!state.undoStack.length) return state;
  const next = clone(state), previous = next.undoStack.pop();
  next.redoStack.push(snapshot(state)); Object.assign(next, previous); next.batch = null;
  next.activity.push({ id: id(), actor, text: '撤销上一步编排', at: new Date().toISOString() }); return next;
}
export function redo(state, actor = '你') {
  if (!state.redoStack.length) return state;
  const next = clone(state), future = next.redoStack.pop();
  next.undoStack.push(snapshot(state)); Object.assign(next, future); next.batch = null;
  next.activity.push({ id: id(), actor, text: '重做一步编排', at: new Date().toISOString() }); return next;
}
export function addComment(state, text, actor = '你') {
  if (typeof text !== 'string' || !text.trim()) return state;
  const next = clone(state); next.batch = null;
  next.comments.push({ id: id(), actor, text: text.trim().slice(0, 4000), clipId: state.selectedId, at: new Date().toISOString() });
  next.activity.push({ id: id(), actor, text: '留下了一条讨论', at: new Date().toISOString() }); return next;
}
export function serializeDraft(state) {
  return JSON.stringify({ version: DRAFT_VERSION, document: snapshot(state), customMaterials: state.materials.filter(source => source.custom), comments: state.comments, activity: state.activity.slice(-100), savedAt: new Date().toISOString() });
}
export function restoreDraft(serialized, initial = createDemoState()) {
  const saved = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  if (!saved || saved.version !== DRAFT_VERSION || !saved.document || !Array.isArray(saved.document.clips)) throw new Error('草稿版本不兼容');
  const document = saved.document, materials = clone(initial.materials), sourceIds = new Set(materials.map(item => item.id)), ids = new Set();
  if (saved.customMaterials !== undefined && (!Array.isArray(saved.customMaterials) || saved.customMaterials.length > 50)) throw new Error('媒体素材格式不正确');
  for (const source of saved.customMaterials || []) {
    if (!source || typeof source.id !== 'string' || source.id.length > 100 || sourceIds.has(source.id) || !['audio', 'video'].includes(source.type) || typeof source.title !== 'string') throw new Error('媒体素材格式不正确');
    materials.push({ id: source.id, type: source.type, title: source.title.slice(0, 180), media: safeMediaUrl(source.media), text: '', caption: '', author: String(source.author || '你').slice(0, 60), date: String(source.date || '').slice(0, 10), custom: true });
    sourceIds.add(source.id);
  }
  if (typeof document.title !== 'string' || typeof document.subtitle !== 'string' || document.clips.length > 200) throw new Error('草稿格式不正确');
  for (const clip of document.clips) {
    if (!clip || typeof clip.id !== 'string' || clip.id.length > 100 || ids.has(clip.id) || (clip.sourceId !== null && !sourceIds.has(clip.sourceId)) || typeof clip.text !== 'string' || typeof clip.caption !== 'string' || typeof clip.author !== 'string') throw new Error('草稿片段不完整');
    ids.add(clip.id);
  }
  const next = clone(initial);
  next.materials = materials;
  next.title = document.title.slice(0, 180); next.subtitle = document.subtitle.slice(0, 600);
  next.clips = document.clips.map(clip => ({ id: clip.id.slice(0, 100), sourceId: clip.sourceId, text: clip.text.slice(0, 20000), caption: clip.caption.slice(0, 500), author: clip.author.slice(0, 60) }));
  next.selectedId = ids.has(document.selectedId) ? document.selectedId : next.clips[0]?.id || null;
  for (const key of ['comments', 'activity']) next[key] = Array.isArray(saved[key]) ? saved[key].filter(row => row && typeof row.actor === 'string' && typeof row.text === 'string' && typeof row.at === 'string').slice(-100).map(row => ({ id: String(row.id || id()), actor: row.actor.slice(0, 60), text: row.text.slice(0, 4000), at: row.at, ...(key === 'comments' ? {clipId: ids.has(row.clipId) ? row.clipId : null} : {}) })) : [];
  return next;
}
