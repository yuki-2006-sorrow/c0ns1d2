let events = [];
let current = null;
let currentData = null;
let mediums = [];
const listEl = document.getElementById('list');
const mainEl = document.getElementById('main');
const qEl = document.getElementById('q');
const esc = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
const escAttr = value => esc(value).replace(/'/g, '&#39;');
const catName = value => ({ core: '核心', food: '聚餐/生日', exam: '考试', other: '其他' }[value] || value);
async function api(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || '请求失败，请重试');
  return result;
}
async function loadEvents() {
  events = await api('/api/events');
  events.sort((first, second) => (first.date || '').localeCompare(second.date || ''));
  renderList();
}
function renderList() {
  if (window.editorMode === 'works') return;
  const keywords = qEl.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = events.filter(entry => keywords.every(word => `${entry.title} ${entry.persons.join(' ')} ${entry.date} ${entry.summary} ${entry.medium} ${entry.source}`.toLowerCase().includes(word)));
  listEl.innerHTML = `<div class="list-count">${filtered.length} / ${events.length} 个事件</div>` + filtered.map(entry => `<button type="button" class="item ${entry.rel === current ? 'active' : ''}" data-rel="${escAttr(entry.rel)}" aria-pressed="${entry.rel === current}"><div class="t">${esc(entry.title) || '无标题'}</div><div class="m"><span>${esc(entry.date)}</span><span>${esc(catName(entry.category))}</span>${entry.medium ? `<span>📁 ${esc(entry.medium)}</span>` : ''}<span class="${entry.draft ? 'minor-tag' : 'draft-tag'}">${entry.draft ? '草稿 · 不公开' : '已公开'}</span>${entry.major ? '<span class="draft-tag">大事件</span>' : ''}</div></button>`).join('');
  if (!filtered.length) {
    listEl.insertAdjacentHTML('beforeend', '<div class="empty">没有匹配的事件<br><button type="button" class="mini-btn" id="clear-event-search">清空搜索</button></div>');
    document.getElementById('clear-event-search').onclick = () => { qEl.value = ''; renderList(); qEl.focus(); };
  }
  listEl.querySelectorAll('[data-rel]').forEach(button => button.addEventListener('click', () => selectEvent(button.dataset.rel)));
}
async function selectEvent(rel) {
  if (rel === current && window.editorMode === 'events' && mainEl.querySelector('#f-title')) { window.navigationToken = (window.navigationToken || 0) + 1; return; }
  if (window.confirmEditorNavigation && !window.confirmEditorNavigation()) return;
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
  return '<option value="">（无）</option>' + mediums.map(folder => `<option value="${escAttr(folder.slug)}" ${folder.slug === selected ? 'selected' : ''}>${esc(folder.title)}</option>`).join('');
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
  mainEl.innerHTML = `<div class="hint-top">${data.rel ? `文件：<code>${esc(data.rel)}</code>` : '新建事件 · 默认保留为草稿'}</div>
    <div class="row"><div class="field" style="flex:2"><label for="f-title">标题</label><input id="f-title" value="${escAttr(data.title)}" required></div><div class="field"><label for="f-date">日期（年 / 年-月 / 年-月-日，未知写 ?）</label><input id="f-date" value="${escAttr(data.date)}" placeholder="2024 / 2024-03 / 2024-03-01 / ?"></div></div>
    <div class="row"><div class="field"><label for="f-category">分类</label><select id="f-category">${['core','food','exam','other'].map(kind => `<option value="${kind}" ${data.category === kind ? 'selected' : ''}>${catName(kind)}</option>`).join('')}</select></div><div class="field" style="flex:2"><label for="f-persons">参与人（逗号或空格分隔）</label><input id="f-persons" value="${escAttr(data.persons.join(', '))}"></div></div>
    <div class="field"><label for="f-medium">所属文件夹</label><select id="f-medium">${mediumOptions(data.medium)}</select></div>
    <div class="field"><label for="f-summary">摘要</label><textarea id="f-summary" rows="3">${esc(data.summary)}</textarea></div>
    <div class="field"><label>照片</label><div class="imgs" id="f-imgs"></div><button type="button" class="img-add" id="add-img" aria-label="上传照片">＋</button><div class="drop-hint">点击或拖入照片；支持多张，每张不超过 10MB。上传后还需保存事件。</div></div>
    <div class="field"><label for="f-body">正文</label><textarea id="f-body" rows="10">${esc(data.body)}</textarea></div>
    <div class="checks field"><input type="checkbox" id="f-published" ${!data.draft ? 'checked' : ''}><label for="f-published" style="margin:0">公开发布</label></div>
    <div class="checks field"><input type="checkbox" id="f-major" ${data.major ? 'checked' : ''}><label for="f-major" style="margin:0">上照片墙（公开后展示）</label></div>
    <div class="btn-bar"><button type="button" class="btn btn-save" id="save">${data.rel ? '保存' : '创建'}</button><button type="button" class="btn btn-build" id="build">重建预览</button>${data.url && !data.draft ? `<a href="${escAttr(data.url)}" target="_blank" rel="noopener" class="mini-btn">查看页面 ↗</a>` : ''}<span class="status" id="status" role="status" aria-live="polite"></span></div>
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
    mainEl.querySelector('#save').textContent = '保存';
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
  host.innerHTML = `<div class="folders-head"><span>文件夹</span><button type="button" id="new-medium" class="mini-btn">＋ 新建</button></div><div class="folders-list">${mediums.map(folder => `<button type="button" class="folder-item" data-slug="${escAttr(folder.slug)}">${esc(folder.title)}<span class="cnt">${folder.count}</span></button>`).join('')}</div>`;
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
  host.innerHTML = `<div class="folders-head"><span>${folder ? '编辑文件夹' : '新建文件夹'}</span><button type="button" id="cancel-medium" class="mini-btn" aria-label="收起文件夹编辑">×</button></div><form class="medium-form"><input id="nm-title" aria-label="文件夹名称" placeholder="名称" value="${escAttr(folder?.title)}" required><textarea id="nm-summary" aria-label="文件夹介绍" placeholder="介绍（可选）">${esc(folder?.summary)}</textarea><select id="nm-parent" aria-label="父文件夹"><option value="">（无父文件夹）</option>${mediums.filter(item => !folder || !descendant(item)).map(item => `<option value="${escAttr(item.slug)}" ${folder?.parent === item.slug ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select><button type="submit" id="nm-save" class="btn btn-save">保存文件夹</button><span id="folder-status" class="status" role="status"></span></form>`;
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
document.getElementById('new-event').onclick = () => window.editorMode === 'works' ? window.newWork() : newEvent();
qEl.oninput = () => window.editorMode === 'works' ? window.renderWorkList() : renderList();
qEl.onkeydown = event => { if (event.key === 'Escape') { qEl.value = ''; qEl.oninput(); } };
window.editorReady = Promise.all([
  loadEvents().catch(error => { listEl.textContent = '读取失败：' + error.message; }),
  loadMediums().catch(error => { document.getElementById('folders').textContent = '读取失败：' + error.message; })
]);
