let events = [];
let current = null;
let currentData = null;
let mediums = [];
const listEl = document.getElementById('list');
const mainEl = document.getElementById('main');
const qEl = document.getElementById('q');
const esc = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
const escAttr = value => esc(value).replace(/'/g, '&#39;');
async function api(path, options) {
  let response;
  try { response = await fetch(path, options); }
  catch {
    document.getElementById('connection-notice').hidden = false;
    throw new Error('本地编辑服务未连接，请双击「启动.bat」，然后点左侧「重新连接」');
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('后台响应不完整，请重新启动本地编辑服务后再试'); }
  if (!response.ok || result.error) throw new Error(result.error || '请求失败，请重试');
  return result;
}
async function loadEvents() {
  events = await api('/api/events');
  events.sort((first, second) => (first.date || '').localeCompare(second.date || ''));
  renderList();
}
function renderList() {
  if (window.editorMode && window.editorMode !== 'events') return;
  if (window.renderTrashList?.()) return;
  const keywords = qEl.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = events.filter(entry => (!window.autoEventsOnly || /^auto[\\/]/.test(entry.rel)) && keywords.every(word => `${entry.title} ${entry.persons.join(' ')} ${entry.date} ${entry.summary} ${entry.medium} ${entry.source}`.toLowerCase().includes(word)));
  window.filteredEvents = filtered;
  listEl.innerHTML = `<div class="list-count">${filtered.length} / ${events.length} 个事件</div>` + filtered.map(entry => `<div class="event-row">${window.eventSelectionCheckbox?.(entry.rel, entry.title) || ''}<button type="button" class="item ${entry.rel === current ? 'active' : ''}" data-rel="${escAttr(entry.rel)}" aria-pressed="${entry.rel === current}"><div class="t">${esc(entry.title) || '无标题'}</div><div class="m"><span>${esc(entry.date)}</span><span>${entry.major ? '大事件' : '小事件'}</span>${entry.medium ? `<span>归入 ${esc(mediums.find(folder => folder.slug === entry.medium)?.title || entry.medium)}</span>` : ''}<span class="${entry.draft ? 'minor-tag' : 'draft-tag'}">${entry.draft ? '仅自己可见' : '已公开'}</span></div></button></div>`).join('');
  if (!filtered.length) {
    listEl.insertAdjacentHTML('beforeend', '<div class="empty">没有匹配的事件<br><button type="button" class="mini-btn" id="clear-event-search">清空搜索</button></div>');
    document.getElementById('clear-event-search').onclick = () => { qEl.value = ''; renderList(); qEl.focus(); };
  }
  listEl.querySelectorAll('[data-rel]').forEach(button => button.addEventListener('click', () => selectEvent(button.dataset.rel)));
  window.bindEventSelection?.();
  window.renderEventTools?.();
}
async function selectEvent(rel) {
  if (rel === current && window.editorMode === 'events' && mainEl.querySelector('#f-title')) { window.navigationToken = (window.navigationToken || 0) + 1; return; }
  if (window.confirmEditorNavigation && !window.confirmEditorNavigation()) return;
  window.leaveEventTrash?.();
  window.setEditorMode?.('events');
  const ticket = window.navigationToken;
  try {
    const data = await api('/api/event?rel=' + encodeURIComponent(rel));
    if (ticket !== window.navigationToken) return;
    current = rel;
    currentData = data;
    renderList();
    renderEditor(data);
    window.showEditor?.();
  } catch (error) { window.adminNotice?.(error.message); }
}
function newEvent() {
  if (window.confirmEditorNavigation && !window.confirmEditorNavigation()) return;
  window.leaveEventTrash?.();
  window.setEditorMode?.('events');
  current = null;
  const now = new Date();
  currentData = { rel: '', title: '', date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, category: 'other', persons: [], summary: '', images: [], medium: '', draft: true, major: false, body: '' };
  renderList();
  renderEditor(currentData);
  window.showEditor?.();
  mainEl.querySelector('#f-title').focus({ preventScroll: true });
}
function mediumOptions(selected) {
  return '<option value="">暂不归组</option>' + mediums.map(folder => {
    const path = [], seen = new Set();
    let currentFolder = folder;
    while (currentFolder && !seen.has(currentFolder.slug)) { seen.add(currentFolder.slug); path.unshift(currentFolder.title); currentFolder = mediums.find(item => item.slug === currentFolder.parent); }
    return `<option value="${escAttr(folder.slug)}" ${folder.slug === selected ? 'selected' : ''}>${esc(path.join(' / '))}</option>`;
  }).join('');
}
function captureEvent(data) {
  if (!mainEl.querySelector('#f-title')) return data;
  for (const key of ['title', 'date', 'summary', 'body', 'category', 'medium']) data[key] = mainEl.querySelector('#f-' + key).value;
  data.persons = mainEl.querySelector('#f-persons').value.split(/[,，、\s]+/).filter(Boolean);
  data.draft = !mainEl.querySelector('#f-published').checked;
  data.major = mainEl.querySelector('#f-major').checked;
  return data;
}
function renderImages(data) {
  const container = mainEl.querySelector('#f-imgs');
  container.innerHTML = (data.images || []).map((url, index) => `<div class="img-box"><img src="${escAttr(url)}" alt="事件照片 ${index + 1}" loading="lazy"><button type="button" class="del" data-image="${index}" aria-label="移除照片 ${index + 1}">×</button></div>`).join('');
  container.querySelectorAll('[data-image]').forEach(button => button.addEventListener('click', () => {
    if (window.editorSaving) return;
    data.images.splice(Number(button.dataset.image), 1);
    renderImages(data);
    window.editorDirty = true;
  }));
}
function renderEditor(data) {
  // Older entries sometimes kept all their writing in summary. Show that writing
  // in the main editor; only an explicit save moves it to body.
  if (!data.body?.trim() && data.summary?.trim()) { data.body = data.summary; data.summary = ''; }
  mainEl.innerHTML = `<p class="editor-intro">${data.rel ? '整理一段记忆' : '新建一段记忆'} · 先放照片、写文字，分组可以以后再做。</p>
    <div class="field"><label for="f-title">这件事叫什么？</label><input id="f-title" value="${escAttr(data.title)}" required placeholder="给这段记忆起个名字"></div>
    <div class="field date-field"><label for="f-date">什么时候？</label><input id="f-date" value="${escAttr(data.date)}" placeholder="2024 / 2024-03 / 2024-03-01 / ?"><p class="field-help">只记得年份也可以，完全不记得就填 ?。</p></div>
    <div class="field" id="event-photos"><label>留下的照片（可选）</label><div class="imgs" id="f-imgs"></div><button type="button" class="img-add" id="add-img" aria-label="上传照片">＋</button><div class="drop-hint">点 ＋ 或拖入多张照片，每张不超过 10MB；完成后点「保存记忆」。第一张会用作封面。</div></div>
    <div class="field"><label for="f-body">记下这件事（可选）</label><textarea id="f-body" rows="10" placeholder="经过、细节、感受，写在这里就好。">${esc(data.body)}</textarea></div>
    <details class="editor-metadata" id="event-organization"><summary>分层整理与参与人（可选）</summary><p class="field-help">大事件是重点记忆；中事件把相关记录归在一起；其他记录是小事件。</p>
      <div class="checks field"><input type="checkbox" id="f-major" ${data.major ? 'checked' : ''}><label for="f-major" style="margin:0">设为大事件 · 公开后进入首页记忆卡片</label></div>
      <div class="field"><label for="f-medium">归入哪个中事件？</label><select id="f-medium">${mediumOptions(data.medium)}</select></div>
      <div class="field"><label for="f-persons">当时有谁？</label><input id="f-persons" value="${escAttr(data.persons.join(', '))}" placeholder="多人之间用逗号分隔"></div>
    </details>
    <details class="editor-metadata" id="event-preview"><summary>自定义列表介绍（可选）${data.summary ? ' · 已填写' : ''}</summary><p class="field-help">不填时自动取正文开头。只有想给列表单独写一两句话时才需要填写。</p><div class="field"><label for="f-summary">列表介绍</label><textarea id="f-summary" rows="3">${esc(data.summary)}</textarea></div></details>
    <input type="hidden" id="f-category" value="${escAttr(data.category)}">
    <div class="visibility-setting"><div class="checks"><input type="checkbox" id="f-published" ${!data.draft ? 'checked' : ''}><label for="f-published">让这段记忆在网站上公开</label></div><p class="field-help">不勾选时只保存在本地后台。保存会自动更新本地预览。</p></div>
    <div class="btn-bar"><button type="button" class="btn btn-save" id="save">保存记忆</button>${data.url && !data.draft ? `<a href="${escAttr(data.url)}" target="_blank" rel="noopener" class="mini-btn">查看页面 ↗</a>` : ''}<details class="editor-actions"><summary>其他操作</summary><button type="button" class="mini-btn" id="build">重新生成预览</button>${data.rel ? '<button type="button" class="mini-btn" id="trash-event">移入回收站</button>' : ''}</details><span class="status" id="status" role="status" aria-live="polite"></span></div>
    <section id="associations-editor" class="association-editor"></section>`;
  renderImages(data);
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp,image/avif'; fileInput.multiple = true;
  const add = mainEl.querySelector('#add-img');
  fileInput.onchange = () => { uploadFiles(fileInput.files, data); fileInput.value = ''; };
  add.onclick = () => fileInput.click();
  add.ondragover = event => event.preventDefault();
  add.ondrop = event => { event.preventDefault(); uploadFiles(event.dataTransfer.files, data); };
  mainEl.querySelector('#save').onclick = () => save(data);
  mainEl.querySelector('#trash-event')?.addEventListener('click', () => window.planEventRemoval?.([{ rel: data.rel, revision: data.revision }]));
  mainEl.querySelector('#build').onclick = async () => {
    const status = mainEl.querySelector('#status');
    try { await window.rebuildAndWait(status); } catch (error) { status.textContent = '内容已保存，但预览更新失败：' + error.message; }
  };
  window.renderAssociationEditor?.('event', data.slug || (data.rel || '').split(/[\\/]/).pop().replace(/\.md$/, ''));
  window.editorDirty = false;
  window.installWritingTabs?.();
}
async function uploadFiles(files, data) {
  if (window.editorSaving || !files?.length) return;
  const status = mainEl.querySelector('#status');
  const add = mainEl.querySelector('#add-img');
  window.editorSaving = true;
  add.disabled = true;
  let uploaded = 0;
  try {
    for (const file of files) {
      if (!/^image\/(jpeg|png|gif|webp|avif)$/.test(file.type)) throw new Error('请选择 JPG、PNG、GIF、WebP 或 AVIF 照片');
      if (file.size > 10 * 1024 * 1024) throw new Error('照片不能超过 10MB');
      status.textContent = `正在上传 ${file.name}（${uploaded + 1}/${files.length}）…`;
      const encoded = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('无法读取这张照片'));
        reader.readAsDataURL(file);
      });
      const result = await api('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, data: encoded }) });
      data.images.push(result.url);
      uploaded++;
      renderImages(data);
      window.editorDirty = true;
    }
    status.textContent = `已上传 ${uploaded} 张，保存事件后生效`;
  } catch (error) { status.textContent = `${uploaded ? `已上传 ${uploaded} 张；` : ''}${error.message}`; }
  finally { add.disabled = false; window.editorSaving = false; }
}
async function save(data) {
  if (window.editorSaving) return;
  const status = mainEl.querySelector('#status');
  const payload = { ...captureEvent(data) };
  if (!payload.title.trim()) { status.textContent = '请填写事件标题'; mainEl.querySelector('#f-title').focus(); return; }
  window.editorSaving = true;
  const controls = [...mainEl.querySelectorAll('input, textarea, select, #save, #add-img')].filter(control => !control.closest('#associations-editor'));
  controls.forEach(control => { control.disabled = true; });
  const unlock = () => { controls.forEach(control => { control.disabled = false; }); window.editorSaving = false; };
  let persisted = false;
  try {
    status.textContent = '正在保存…';
    const result = await api('/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    persisted = true;
    data.rel = result.rel || data.rel;
    data.revision = result.revision;
    current = data.rel;
    currentData = data;
    mainEl.querySelector('#save').textContent = '保存记忆';
    window.editorDirty = false;
    unlock();
    await loadEvents();
    window.renderAssociationEditor?.('event', data.slug || data.rel.split(/[\\/]/).pop().replace(/\.md$/, ''));
    await window.rebuildAndWait(status);
  } catch (error) { status.textContent = (persisted ? '内容已保存，但预览更新失败：' : '保存失败：') + error.message; }
  finally { unlock(); }
}
async function loadMediums() {
  mediums = await api('/api/mediums');
  renderMediums();
}
function renderMediums() {
  const host = document.getElementById('folders');
  host.innerHTML = `<details class="medium-groups"><summary>中事件 · 分组整理 <span>${mediums.length}</span></summary><p class="field-help">把同一段经历里的记录归在一起，可以嵌套。点击名称编辑。</p><button type="button" id="new-medium" class="mini-btn">＋ 新建中事件</button><div class="folders-list">${mediums.map(folder => `<button type="button" class="folder-item" data-slug="${escAttr(folder.slug)}">${esc(folder.title)}${folder.parent ? `<small>属于 ${esc(mediums.find(item => item.slug === folder.parent)?.title || folder.parent)}</small>` : ''}<span class="cnt">${folder.count} 条</span></button>`).join('')}</div></details>`;
  host.querySelector('#new-medium').onclick = () => editMediumForm(null);
  host.querySelectorAll('[data-slug]').forEach(button => button.onclick = () => editMediumForm(mediums.find(folder => folder.slug === button.dataset.slug)));
}
function editMediumForm(folder) {
  if (window.folderDirty && !confirm('放弃尚未保存的文件夹修改吗？')) return;
  window.folderDirty = false;
  const host = document.getElementById('folders');
  const descendant = candidate => {
    const visited = new Set();
    let currentFolder = candidate;
    while (currentFolder && !visited.has(currentFolder.slug)) {
      if (currentFolder.slug === folder?.slug) return true;
      visited.add(currentFolder.slug);
      currentFolder = mediums.find(item => item.slug === currentFolder.parent);
    }
    return false;
  };
  host.innerHTML = `<div class="folders-head"><span>${folder ? '编辑中事件' : '新建中事件'}</span><button type="button" id="cancel-medium" class="mini-btn" aria-label="收起中事件编辑">×</button></div><form class="medium-form"><label for="nm-title">这组经历叫什么？</label><input id="nm-title" placeholder="名称" value="${escAttr(folder?.title)}" required><label for="nm-summary">介绍（可选）</label><textarea id="nm-summary">${esc(folder?.summary)}</textarea><label for="nm-parent">归入上一级中事件（可选）</label><select id="nm-parent"><option value="">不归入其他中事件</option>${mediums.filter(item => !folder || !descendant(item)).map(item => `<option value="${escAttr(item.slug)}" ${folder?.parent === item.slug ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select><button type="submit" id="nm-save" class="btn btn-save">保存中事件</button><span id="folder-status" class="status" role="status"></span></form>`;
  host.querySelector('form').oninput = () => { window.folderDirty = true; };
  host.querySelector('#cancel-medium').onclick = () => { if (window.folderDirty && !confirm('放弃文件夹修改吗？')) return; window.folderDirty = false; renderMediums(); };
  host.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const button = host.querySelector('#nm-save');
    const status = host.querySelector('#folder-status');
    button.disabled = true;
    try {
      await api('/api/medium', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: folder?.slug || '', title: host.querySelector('#nm-title').value, summary: host.querySelector('#nm-summary').value, parent: host.querySelector('#nm-parent').value }) });
      window.folderDirty = false;
      await loadMediums();
      const select = mainEl.querySelector('#f-medium');
      if (select) select.innerHTML = mediumOptions(select.value);
      await window.rebuildAndWait(document.getElementById('admin-notice'));
    } catch (error) { if (status.isConnected) status.textContent = error.message; else window.adminNotice?.(error.message); }
    finally { button.disabled = false; }
  };
}
document.getElementById('new-event').onclick = () => window.editorMode === 'works' ? window.newWork() : window.editorMode === 'thoughts' ? window.newThought() : newEvent();
qEl.oninput = () => window.editorMode === 'works' ? window.renderWorkList() : window.editorMode === 'thoughts' ? window.renderThoughtList() : renderList();
qEl.onkeydown = event => { if (event.key === 'Escape') { qEl.value = ''; qEl.oninput(); } };
window.editorReady = Promise.all([
  loadEvents().catch(error => { listEl.textContent = '读取失败：' + error.message; }),
  loadMediums().catch(error => { document.getElementById('folders').textContent = '读取失败：' + error.message; })
]);
document.getElementById('connection-retry').onclick = async () => {
  const button = document.getElementById('connection-retry');
  button.disabled = true;
  button.textContent = '正在连接…';
  try {
    await Promise.all([
      loadEvents(),
      api('/api/mediums').then(entries => { mediums = entries; if (!document.querySelector('.medium-form')) renderMediums(); }),
      window.reloadWorksForConnection?.(),
      window.reloadTrashForConnection?.(),
      window.refreshThoughtList?.(),
    ]);
    document.getElementById('connection-notice').hidden = true;
    window.adminNotice?.('后台已连接，当前输入已保留，可以继续编辑');
  } catch (error) { window.adminNotice?.(error.message); }
  finally { button.disabled = false; button.textContent = '重新连接'; }
};
