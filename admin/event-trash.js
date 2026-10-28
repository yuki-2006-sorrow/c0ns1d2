(() => {
  let trashOpen = false;
  let batch = false;
  let trashed = [];
  let loading = false;
  let trashSearch = '';
  let eventSearch = '';
  let loadError = '';
  const selected = new Set();
  const tools = document.getElementById('event-tools');
  const post = (action, items) => api('/api/event-trash/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
  window.reloadTrashForConnection = async () => {
    trashed = await api('/api/event-trash');
    loadError = '';
    if (trashOpen && window.editorMode === 'events') renderList();
  };
  const busy = () => {
    if (window.editorSaving) { window.adminNotice('正在保存、上传或更新预览，请稍候'); return true; }
    return false;
  };
  const clean = () => {
    if (busy()) return false;
    if (window.editorDirty) { window.adminNotice('请先保存当前文字或联想，再整理事件'); return false; }
    return true;
  };
  window.eventSelectionCheckbox = (key, title) => batch ? `<label class="event-select"><input type="checkbox" data-event-select="${escAttr(key)}" aria-label="选择：${escAttr(title)}" ${selected.has(key) ? 'checked' : ''}></label>` : '';
  window.bindEventSelection = () => listEl.querySelectorAll('[data-event-select]').forEach(input => input.onchange = () => {
    if (busy()) { input.checked = selected.has(input.dataset.eventSelect); return; }
    if (input.checked) selected.add(input.dataset.eventSelect); else selected.delete(input.dataset.eventSelect);
    window.renderEventTools();
  });
  window.leaveEventTrash = () => {
    if (!trashOpen) return;
    trashSearch = qEl.value; qEl.value = eventSearch;
    trashOpen = false;
    batch = false;
    selected.clear();
  };
  window.updateEventToolsMode = mode => {
    if (mode !== 'events') { window.leaveEventTrash(); batch = false; selected.clear(); }
    tools.hidden = mode !== 'events';
  };
  const matches = entry => qEl.value.trim().toLowerCase().split(/\s+/).filter(Boolean).every(word => `${entry.title} ${entry.date} ${entry.summary} ${entry.rel}`.toLowerCase().includes(word));
  window.renderTrashList = () => {
    if (!trashOpen) return false;
    const filtered = trashed.filter(matches);
    listEl.innerHTML = `<div class="list-count">${loading ? '正在读取回收站…' : `${filtered.length} / ${trashed.length} 个已移除事件`}</div>` + filtered.map(entry => `<div class="event-row">${window.eventSelectionCheckbox(entry.id, entry.title)}<div class="item"><div class="t">${esc(entry.title)}</div><div class="m">${esc(entry.date)} · ${entry.photos} 张照片</div></div><button type="button" class="mini-btn trash-restore" data-event-restore="${escAttr(entry.id)}" aria-label="恢复：${escAttr(entry.title)}">恢复</button></div>`).join('') + (!loading && !filtered.length ? `<div class="empty">${loadError ? esc(loadError) : trashed.length ? '没有匹配的回收站记录' : '回收站是空的'}</div>` : '');
    listEl.querySelectorAll('[data-event-restore]').forEach(button => button.onclick = () => restore([{ id: button.dataset.eventRestore }]));
    window.bindEventSelection();
    window.renderEventTools();
    return true;
  };
  window.renderEventTools = () => {
    if (window.editorMode && window.editorMode !== 'events') { tools.hidden = true; return; }
    tools.hidden = false;
    tools.innerHTML = `${trashOpen ? '<span class="hint-top" style="margin:0;align-self:center;flex:1">回收站 · 可恢复</span>' : `<select id="event-source-filter" aria-label="事件来源"><option value="all">全部事件</option><option value="auto" ${window.autoEventsOnly ? 'selected' : ''}>自动生成的事件</option></select>`}<button type="button" class="mini-btn" id="event-batch" aria-pressed="${batch}">${batch ? '退出多选' : '多选'}</button><button type="button" class="mini-btn" id="event-trash-toggle">${trashOpen ? '返回事件' : '回收站'}</button>${batch ? `<div class="event-batch-tools"><button type="button" class="mini-btn" id="event-select-visible">全选当前结果</button><button type="button" class="mini-btn" id="event-clear-selection">清空选择</button><span role="status">已选 ${selected.size} 项</span><button type="button" class="mini-btn" id="event-batch-action" ${!selected.size ? 'disabled' : ''}>${trashOpen ? '恢复所选' : '移入回收站'}</button></div>` : ''}`;
    tools.querySelectorAll('button, select').forEach(control => { if (window.editorSaving || loading) control.disabled = true; });
    tools.querySelector('#event-source-filter')?.addEventListener('change', event => { window.autoEventsOnly = event.target.value === 'auto'; renderList(); });
    tools.querySelector('#event-batch').onclick = () => { if (busy()) return; batch = !batch; selected.clear(); renderList(); };
    tools.querySelector('#event-trash-toggle').onclick = async () => {
      if (trashOpen) {
        if (busy()) return;
        window.leaveEventTrash(); renderList();
        mainEl.innerHTML = '<div class="empty">← 选择事件，查看内容后再决定保留还是移除</div>';
        window.editorDirty = false;
        return;
      }
      if (!window.confirmEditorNavigation()) return;
      eventSearch = qEl.value; qEl.value = trashSearch;
      trashOpen = true; selected.clear(); batch = false; current = null; currentData = null;
      window.navigationToken = (window.navigationToken || 0) + 1;
      const ticket = window.navigationToken;
      showHelp('回收站', '移除的事件保存在本机，不参与网站构建。恢复时会还原原文、照片引用和原来的公开状态。照片文件不会随事件移除而清理。');
      loading = true; loadError = ''; renderList();
      try { const entries = await api('/api/event-trash'); if (trashOpen && ticket === window.navigationToken) trashed = entries; }
      catch (error) { loadError = error.message; window.adminNotice(error.message); }
      finally { loading = false; if (window.editorMode === 'events') renderList(); }
    };
    tools.querySelector('#event-select-visible')?.addEventListener('click', () => {
      for (const entry of trashOpen ? trashed.filter(matches) : window.filteredEvents || []) selected.add(trashOpen ? entry.id : entry.rel);
      renderList();
    });
    tools.querySelector('#event-clear-selection')?.addEventListener('click', () => { selected.clear(); renderList(); });
    tools.querySelector('#event-batch-action')?.addEventListener('click', () => {
      if (trashOpen) restore([...selected].map(id => ({ id })));
      else window.planEventRemoval(events.filter(entry => selected.has(entry.rel)).map(entry => ({ rel: entry.rel, revision: entry.revision })));
    });
  };
  function showHelp(title, text) {
    mainEl.innerHTML = `<section class="trash-help"><h2>${esc(title)}</h2><p>${esc(text)}</p><button type="button" class="btn btn-build" id="trash-rebuild">重建预览</button><p class="status" id="trash-status" role="status" aria-live="polite"></p></section>`;
    mainEl.querySelector('#trash-rebuild').onclick = async () => {
      if (busy()) return;
      try { await window.rebuildAndWait(mainEl.querySelector('#trash-status')); }
      catch (error) { window.adminNotice('预览更新失败：' + error.message); }
    };
    window.editorDirty = false;
  }
  async function mutate(action, items) {
    if (!clean()) return;
    window.editorSaving = true;
    renderList();
    let persisted = false;
    const label = action === 'move' ? '移入回收站' : '恢复';
    try {
      const result = await post(action, items);
      persisted = true;
      selected.clear();
      current = null; currentData = null;
      showHelp(`已${label} ${result.count} 个事件`, action === 'move' ? '照片文件已保留。需要找回时，打开左侧回收站，选择恢复。正在更新网站预览。' : '已还原事件原文和原来的展示设置。正在更新网站预览。');
      const [activeEntries, removedEntries] = await Promise.all([api('/api/events'), api('/api/event-trash'), loadMediums()]);
      events = activeEntries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      trashed = removedEntries;
      renderList();
      await window.rebuildAndWait(mainEl.querySelector('#trash-status'));
      window.adminNotice(`已${label} ${result.count} 个事件 · 预览已更新`);
    } catch (error) { window.adminNotice(`${persisted ? `已${label}，但列表或预览更新失败：` : `${label}失败：`}${error.message}`); }
    finally { window.editorSaving = false; renderList(); }
  }
  async function restore(items) { if (items.length) await mutate('restore', items); }
  window.planEventRemoval = async items => {
    if (!clean() || !items.length) return;
    window.editorSaving = true;
    let plan;
    try { plan = await post('plan', items); }
    catch (error) { window.adminNotice(error.message); return; }
    finally { window.editorSaving = false; window.renderEventTools(); }
    const opener = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'trash-dialog';
    dialog.setAttribute('aria-labelledby', 'trash-dialog-title');
    const blocked = plan.some(entry => entry.associations);
    dialog.innerHTML = `<h2 id="trash-dialog-title">将这 ${plan.length} 个事件移入回收站？</h2><p>移除后，事件将退出列表和网站预览。原文保存在本机，照片文件保留，可随时恢复。</p><ul>${plan.map(entry => `<li>${esc(entry.title)}<small>${esc(entry.date)} · ${entry.draft ? '草稿' : '已公开'} · ${entry.photos} 张照片</small>${entry.associations ? `<small class="blocked">有 ${entry.associations} 段联想，暂不能移除；请返回取消勾选此项。</small>` : ''}</li>`).join('')}</ul><div class="btn-bar"><button type="button" class="btn btn-build" id="trash-cancel" autofocus>返回检查</button><button type="button" class="btn btn-save" id="trash-confirm" ${blocked ? 'disabled' : ''}>移入回收站（${plan.length}）</button></div>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); if (opener?.isConnected) opener.focus(); }, { once: true });
    dialog.querySelector('#trash-cancel').onclick = () => dialog.close();
    dialog.querySelector('#trash-confirm').onclick = () => { dialog.close(); mutate('move', items); };
    dialog.showModal();
  };
  window.editorReady.then(() => { if (window.editorMode === 'events') renderList(); });
})();
