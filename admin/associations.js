(() => {
  const kinds = { book: '书', film: '电影', game: '游戏' };
  let works = [];
  let workId = '';
  let selectionVersion = 0;
  const searches = { events: '', works: '' };
  window.editorMode = 'events';
  let entryDirty = false;
  let associationDirty = false;
  let entryBaseline = '';
  let associationBaseline = '';
  function snapshot(container, omit = []) {
    return JSON.stringify([...container.querySelectorAll('input, textarea, select')].filter(input => !omit.includes(input.id)).map(input => [input.id || input.name, input.type === 'checkbox' ? input.checked : input.value]));
  }
  function entrySnapshot() {
    const fields = [...mainEl.querySelectorAll('input, textarea, select')].filter(input => !input.closest('#associations-editor')).map(input => [input.id || input.name, input.type === 'checkbox' ? input.checked : input.value]);
    return JSON.stringify(fields) + JSON.stringify(window.editorMode === 'events' ? currentData?.images || [] : []);
  }
  function markAssociation() {
    const form = mainEl.querySelector('.association-form');
    associationDirty = !!form && snapshot(form, ['a-search', 'a-kind']) !== associationBaseline;
  }
  Object.defineProperty(window, 'editorDirty', { get: () => entryDirty || associationDirty || window.folderDirty, set: value => { if (!value) { entryDirty = false; entryBaseline = entrySnapshot(); } else entryDirty = entrySnapshot() !== entryBaseline; } });
  let noticeTimer;
  window.adminNotice = message => { const notice = document.getElementById('admin-notice'); notice.textContent = message; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.textContent = ''; }, 8000); };
  window.showEditor = () => { mainEl.scrollTop = 0; if (matchMedia('(max-width: 720px)').matches) mainEl.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); };

  async function request(path, data) {
    const response = await fetch(path, data === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || '请求失败');
    return result;
  }
  window.rebuildAndWait = async (status) => {
    status.textContent = '已保存，正在重建预览…';
    status.classList.add('status');
    status.classList.remove('ok');
    await request('/api/rebuild', {});
    for (let attempt = 0; attempt < 180; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const build = await request('/api/build-status');
      if (build.state === 'failed') throw new Error(build.error);
      if (build.state === 'idle' && !build.queued) {
        status.textContent = '已保存 · 预览已更新';
        status.classList.add('ok');
        if (status.id === 'admin-notice') window.adminNotice('已保存 · 预览已更新');
        return;
      }
    }
    status.textContent = '已保存，构建仍在进行，稍后刷新预览';
  };
  window.confirmEditorNavigation = () => {
    if (window.editorSaving) { window.adminNotice('正在保存或上传，请稍候再切换'); return false; }
    if (window.editorDirty && !confirm('有尚未保存的修改，仍要离开吗？')) return false;
    window.editorDirty = false;
    associationDirty = false;
    if (window.folderDirty) { window.folderDirty = false; renderMediums(); }
    return true;
  };
  window.setEditorMode = (mode) => {
    window.navigationToken = (window.navigationToken || 0) + 1;
    if (mode !== window.editorMode) {
      searches[window.editorMode] = qEl.value;
      qEl.value = searches[mode];
    }
    window.editorMode = mode;
    document.getElementById('mode-events').setAttribute('aria-pressed', String(mode === 'events'));
    document.getElementById('mode-works').setAttribute('aria-pressed', String(mode === 'works'));
    document.getElementById('new-event').textContent = mode === 'works' ? '＋ 新建作品' : '＋ 新建事件';
    document.getElementById('folders').hidden = mode === 'works';
    qEl.placeholder = mode === 'works' ? '搜索作品、作者、类型' : '搜索标题/人名/日期/摘要，空格多关键词';
  };
  mainEl.addEventListener('input', event => {
    if (event.target.closest('#associations-editor')) {
      if (!['a-search', 'a-kind'].includes(event.target.id)) markAssociation();
      return;
    }
    window.editorDirty = true;
    if (window.editorMode !== 'events' || !currentData || !mainEl.querySelector('#f-title')) return;
    for (const key of ['title', 'date', 'summary', 'body', 'category', 'medium']) currentData[key] = mainEl.querySelector('#f-' + key).value;
    currentData.persons = mainEl.querySelector('#f-persons').value.split(/[,，、\s]+/).filter(Boolean);
    currentData.draft = !mainEl.querySelector('#f-published').checked;
    currentData.major = mainEl.querySelector('#f-major').checked;
  });
  mainEl.addEventListener('change', event => {
    if (event.target.closest('#associations-editor')) { if (!['a-search', 'a-kind'].includes(event.target.id)) markAssociation(); return; }
    window.editorDirty = true;
  });
  window.addEventListener('beforeunload', event => { if (window.editorDirty) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (window.editorSaving) return;
      const associationForm = event.target.closest('.association-form');
      const folderForm = event.target.closest('.medium-form');
      if (associationForm || folderForm) (associationForm || folderForm).requestSubmit();
      else if (window.editorMode === 'works') mainEl.querySelector('#work-form')?.requestSubmit();
      else mainEl.querySelector('#save')?.click();
    }
  });

  window.renderWorkList = () => {
    const keywords = qEl.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = works.filter(work => keywords.every(word => `${work.title} ${work.creator} ${kinds[work.kind]} ${work.summary}`.toLowerCase().includes(word)));
    listEl.innerHTML = `<div class="list-count">${filtered.length} / ${works.length} 个作品</div>` + filtered.map(work => `<button type="button" class="item ${work.id === workId ? 'active' : ''}" data-work="${escAttr(work.id)}" aria-pressed="${work.id === workId}"><div class="t">${esc(work.title)}</div><div class="m">${esc(kinds[work.kind])} · ${work.draft ? '草稿' : '已公开'}</div></button>`).join('') + (!filtered.length ? `<div class="empty">${works.length ? '没有匹配的作品，试试其他关键词' : '还没有作品，点击上方新建'}</div>` : '');
    listEl.querySelectorAll('[data-work]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.work === workId && mainEl.querySelector('#work-form')) return;
      if (!window.confirmEditorNavigation()) return;
      workId = button.dataset.work;
      window.renderWorkList();
      renderWork(works.find(work => work.id === workId));
      window.showEditor();
    }));
  };
  async function showWorks() {
    if (window.editorMode === 'works') { qEl.focus(); return; }
    if (!window.confirmEditorNavigation()) return;
    window.setEditorMode('works');
    const version = ++selectionVersion;
    const createButton = document.getElementById('new-event');
    createButton.disabled = true;
    listEl.innerHTML = '<div class="empty">正在读取作品…</div>';
    try {
      works = await request('/api/works');
      if (version !== selectionVersion || window.editorMode !== 'works') return;
      window.renderWorkList();
      const selected = works.find(work => work.id === workId);
      if (selected) renderWork(selected);
      else mainEl.innerHTML = '<div class="empty">选择一部作品，或新建一条。联想可以随时回来补写。</div>';
    } catch (error) { mainEl.textContent = error.message; }
    finally { createButton.disabled = false; }
  }
  window.newWork = () => {
    if (!window.confirmEditorNavigation()) return;
    workId = '';
    renderWork({ title: '', kind: 'book', creator: '', year: '', cover: '', summary: '', body: '', draft: true });
    window.renderWorkList();
    window.showEditor();
    mainEl.querySelector('#w-title').focus({ preventScroll: true });
  };
  function renderWork(work) {
    mainEl.innerHTML = `<h2 class="work-heading">${work.id ? '编辑作品' : '新建作品'}</h2>
      <form id="work-form">
        <div class="row"><div class="field"><label for="w-title">作品标题</label><input id="w-title" name="title" value="${escAttr(work.title)}" required maxlength="300"></div>
        <div class="field"><label for="w-kind">类型</label><select id="w-kind" name="kind">${Object.entries(kinds).map(([key, label]) => `<option value="${key}" ${work.kind === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div>
        <div class="row"><div class="field"><label for="w-creator">作者 / 导演 / 开发者（可选）</label><input id="w-creator" name="creator" value="${escAttr(work.creator)}"></div><div class="field"><label for="w-year">年份（可选）</label><input id="w-year" name="year" value="${escAttr(work.year)}"></div></div>
        <div class="field"><label for="w-cover">封面地址（可选）</label><input id="w-cover" name="cover" value="${escAttr(work.cover)}" placeholder="https://… 或 /photos/…"></div>
        <div class="field"><label for="w-summary">简短记下它（可选）</label><textarea id="w-summary" name="summary" rows="3">${esc(work.summary)}</textarea></div>
        <div class="field"><label for="w-body">自己的文字（可选，支持 Markdown）</label><textarea id="w-body" name="body" rows="10">${esc(work.body)}</textarea></div>
        <label class="checks field"><input type="checkbox" name="published" ${!work.draft ? 'checked' : ''}>公开这部作品</label>
        <div class="btn-bar"><button class="btn btn-save" type="submit">保存作品</button><span id="work-status" class="status" role="status"></span></div>
      </form><section id="associations-editor" class="association-editor"></section>`;
    const form = mainEl.querySelector('#work-form');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (window.editorSaving) return;
      window.editorSaving = true;
      const status = mainEl.querySelector('#work-status');
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      const fields = Object.fromEntries(new FormData(form));
      const published = form.elements.published.checked;
      const inputs = [...form.querySelectorAll('input, textarea, select')];
      inputs.forEach(input => { input.disabled = true; });
      const unlock = () => { inputs.forEach(input => { input.disabled = false; }); submit.disabled = false; window.editorSaving = false; };
      let persisted = false;
      try {
        const result = await request('/api/work', { ...fields, id: work.id, revision: work.revision, draft: !published });
        persisted = true;
        Object.assign(work, fields, { draft: !published });
        work.id = result.id;
        work.revision = result.revision;
        mainEl.querySelector('.work-heading').textContent = '编辑作品';
        workId = result.id;
        window.editorDirty = false;
        unlock();
        works = await request('/api/works');
        if (window.editorMode === 'works') window.renderWorkList();
        await window.renderAssociationEditor('work', work.id);
        await window.rebuildAndWait(status);
      } catch (error) { status.textContent = (persisted ? '内容已保存，但预览更新失败：' : '保存失败：') + error.message; status.className = 'status'; }
      finally { unlock(); }
    });
    window.renderAssociationEditor('work', work.id);
    window.editorDirty = false;
    window.installWritingTabs?.();
  }

  window.renderAssociationEditor = async function thoughtEditor(type, id, editId) {
  const host = document.getElementById('associations-editor');
  if (!host || associationDirty && host.querySelector('.association-form')) return;
  if (!id) { host.innerHTML = '<p class="hint-top">先保存这条记忆，再记录由它想到的内容。</p>'; return; }
  const version = String(Number(host.dataset.loadVersion || 0) + 1);
  host.dataset.loadVersion = version;
  try {
    const [eventEntries, workEntries, associations] = await Promise.all([request('/api/events'), request('/api/works'), request('/api/associations')]);
    if (!host.isConnected || host.dataset.loadVersion !== version) return;
    const entries = [...eventEntries.map(entry => ({type:'event', id:entry.slug, title:entry.title, draft:entry.draft, label:'记忆'})), ...workEntries.map(entry => ({type:'work', id:entry.id, title:entry.title, draft:entry.draft, label:kinds[entry.kind]}))];
    const currentEntry = entries.find(entry => entry.type === type && entry.id === id);
    const attached = associations.filter(link => link.fromType === type && link.fromId === id || link.toType === type && link.toId === id);
    host.innerHTML = '<h2>从这里想到的</h2><p class="hint-top">可以写很多，也可以只留一个连接。先记下来，关联以后再补。</p><button type="button" class="btn btn-build" id="add-association">＋ 记下一段联想</button><div id="association-form"></div><div id="association-list"></div>';
    host.querySelector('#association-list').innerHTML = attached.map(link => {
      const isFrom = link.fromType === type && link.fromId === id;
      const other = entries.find(entry => entry.type === (isFrom ? link.toType : link.fromType) && entry.id === (isFrom ? link.toId : link.fromId));
      const state = link.draft ? '草稿' : currentEntry?.draft || other?.draft ? '待条目公开' : '已公开';
      const writing = link.body?.trim() || link.note || '';
      return `<div class="association-item"><div><strong>${esc(link.title || other?.title || '一段未命名的联想')}</strong><span class="hint-top"> / ${state}</span>${writing ? `<p>${esc(writing.slice(0,160))}${writing.length > 160 ? '…' : ''}</p>` : ''}${other ? `<p class="hint-top">关联：${esc(other.title)}</p>` : '<p class="hint-top">还没有关联到其他条目</p>'}</div><button type="button" class="mini-btn" data-edit-link="${escAttr(link.id)}">继续写</button></div>`;
    }).join('');
    function edit(link = {}) {
      if (associationDirty && !confirm('放弃尚未保存的联想文字，编辑另一条吗？')) return;
      associationDirty = false;
      const container = host.querySelector('#association-form');
      const isFrom = !link.id || link.fromType === type && link.fromId === id;
      const selectedKey = link.id && link.toType ? `${isFrom ? link.toType : link.fromType}:${isFrom ? link.toId : link.fromId}` : '';
      container.innerHTML = `<form class="association-form">
        <div class="field"><label for="a-title">标题（可选）</label><input id="a-title" value="${escAttr(link.title)}" maxlength="300" placeholder="可以以后再起标题"></div>
        <div class="field"><label for="a-note">想到的内容</label><textarea id="a-note" rows="14" maxlength="100000" placeholder="想到哪里就写到哪里；长文支持 Markdown。">${esc(link.body?.trim() ? link.body : link.note || '')}</textarea></div>
        <details class="association-reference" ${selectedKey ? 'open' : ''}><summary>关联与摘录（可以以后再补）</summary>
          <div class="field"><label for="a-search">找一条记忆或作品</label><input type="search" id="a-search" placeholder="输入名称筛选"></div>
          <div class="field"><label for="a-target">关联到（可选）</label><select id="a-target"></select></div>
          <div class="field"><label for="a-excerpt">摘录 / 镜头 / 游戏片段（可选）</label><textarea id="a-excerpt" rows="3">${esc(link.excerpt)}</textarea></div>
          <div class="field"><label for="a-locator">页码 / 时间点 / 章节（可选）</label><input id="a-locator" value="${escAttr(link.locator)}"></div>
        </details>
        <label class="checks field"><input type="checkbox" id="a-public" ${link.id && !link.draft ? 'checked' : ''}>公开这段联想</label>
        <div class="btn-bar"><button type="submit" class="btn btn-save">保存联想</button><button type="button" class="btn btn-build" id="a-cancel">收起</button><span id="a-status" class="status" role="status"></span></div>
      </form>`;
      const select = container.querySelector('#a-target');
      let chosen = selectedKey;
      const drawOptions = () => {
        const words = container.querySelector('#a-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        select.innerHTML = '<option value="">暂时不关联</option>' + entries.filter(entry => !(entry.type === type && entry.id === id)).filter(entry => words.every(word => `${entry.label} ${entry.title}`.toLowerCase().includes(word)) || `${entry.type}:${entry.id}` === chosen).map(entry => `<option value="${escAttr(entry.type + ':' + entry.id)}" ${entry.type + ':' + entry.id === chosen ? 'selected' : ''}>${esc(entry.label)} · ${esc(entry.title)}${entry.draft ? '（草稿）' : ''}</option>`).join('');
      };
      drawOptions();
      associationBaseline = snapshot(container, ['a-search', 'a-kind']);
      select.addEventListener('change', () => { chosen = select.value; });
      container.querySelector('#a-search').addEventListener('input', drawOptions);
      container.querySelector('#a-cancel').onclick = () => {
        if (associationDirty && !confirm('放弃尚未保存的联想文字吗？')) return;
        associationDirty = false; container.replaceChildren();
      };
      container.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault(); if (window.editorSaving) return;
        window.editorSaving = true;
        const status = container.querySelector('#a-status');
        const controls = [...container.querySelectorAll('input, textarea, select, button')];
        controls.forEach(control => { control.disabled = true; });
        const unlock = () => { controls.forEach(control => { control.disabled = false; }); window.editorSaving = false; };
        let persisted = false;
        try {
          const separator = select.value.indexOf(':');
          const targetType = separator < 0 ? '' : select.value.slice(0, separator);
          const targetId = separator < 0 ? '' : select.value.slice(separator + 1);
          const reverse = !isFrom && separator >= 0;
          const result = await request('/api/association', {id:link.id, revision:link.revision, fromType:reverse ? targetType : link.fromType || type, fromId:reverse ? targetId : link.fromId || id, toType:reverse ? type : targetType, toId:reverse ? id : targetId, title:container.querySelector('#a-title').value, body:container.querySelector('#a-note').value, note:link.note || '', excerpt:container.querySelector('#a-excerpt').value, locator:container.querySelector('#a-locator').value, draft:!container.querySelector('#a-public').checked});
          link.id = result.id; link.revision = result.revision; persisted = true; associationDirty = false;
          associationBaseline = snapshot(container, ['a-search', 'a-kind']); unlock();
          await window.rebuildAndWait(status);
          await window.renderAssociationEditor(type,id);
        } catch (error) { status.textContent = (persisted ? '已记录，预览更新失败：' : '记录失败：') + error.message; }
        finally { unlock(); }
      });
      window.showThoughts?.();
      container.querySelector('#a-note').focus({preventScroll:true});
    }
    host.querySelector('#add-association').onclick = () => edit();
    host.querySelectorAll('[data-edit-link]').forEach(button => button.onclick = () => edit(attached.find(link => link.id === button.dataset.editLink)));
    if (editId) {
      const existing = attached.find(link => link.id === editId);
      if (existing) edit(existing);
    }
  } catch(error) { if(host.isConnected) host.textContent = '联想读取失败：' + error.message; }
};
  document.getElementById('mode-works').addEventListener('click', showWorks);
  window.openWork = async id => { workId = id; await showWorks(); };
  document.getElementById('mode-events').addEventListener('click', () => {
    if (window.editorMode === 'events') { qEl.focus(); return; }
    if (!window.confirmEditorNavigation()) return;
    ++selectionVersion;
    window.setEditorMode('events');
    renderList();
    if (current) selectEvent(current);
    else { currentData = null; mainEl.innerHTML = '<div class="empty">← 左侧选择一个事件开始编辑</div>'; }
  });
})();
