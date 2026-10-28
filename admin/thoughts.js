(() => {
  let thoughts = [];
  let selectedId = '';
  let openVersion = 0;
  window.renderThoughtList = () => {
    if (window.editorMode !== 'thoughts') return;
    const words = qEl.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = thoughts.filter(thought => words.every(word => `${thought.title} ${thought.body || thought.note || ''}`.toLowerCase().includes(word)));
    listEl.innerHTML = `<div class="list-count">${filtered.length} 个想法</div>` + filtered.map(thought => `<button type="button" class="item ${thought.id === selectedId ? 'active' : ''}" data-thought="${escAttr(thought.id)}"><div class="t">${esc(thought.title || (thought.body || thought.note || '').slice(0,36) || '一个想法')}</div><div class="m">${thought.draft ? '仅自己可见' : '已勾选公开'}${thought.fromId ? ' · 写在一段记录旁' : ''}</div></button>`).join('') + (!filtered.length ? '<div class="empty">这里收着你写过的想法。<br>不必先找一件事，也不用区分随笔或联想。</div>' : '');
    listEl.querySelectorAll('[data-thought]').forEach(button => button.onclick = async () => {
      if (!window.confirmEditorNavigation()) return;
      selectedId = button.dataset.thought;
      window.navigationToken++;
      const thought = thoughts.find(item => item.id === selectedId);
      await openThought(thought);
    });
  };
  window.refreshThoughtList = async () => {
    thoughts = await api('/api/associations');
    window.renderThoughtList();
  };
  async function openThought(thought) {
    const version = ++openVersion;
    mainEl.innerHTML = '<section id="associations-editor" class="association-editor thought-writing"></section>';
    window.editorDirty = false;
    window.renderThoughtList();
    await window.renderAssociationEditor(thought?.fromType || '', thought?.fromId || '', thought?.id);
    if (version !== openVersion || window.editorMode !== 'thoughts') return;
    if (!thought) document.getElementById('add-association')?.click();
    window.showEditor();
  }
  window.newThought = async () => {
    if (!window.confirmEditorNavigation()) return;
    selectedId = '';
    try { await openThought(); } catch (error) { window.adminNotice(error.message); }
  };
  window.onThoughtSaved = async id => {
    if (window.editorMode !== 'thoughts') return;
    selectedId = id;
    await window.refreshThoughtList();
    await openThought(thoughts.find(thought => thought.id === id));
  };
  document.getElementById('mode-thoughts').onclick = async () => {
    if (window.editorMode === 'thoughts') { qEl.focus(); return; }
    if (!window.confirmEditorNavigation()) return;
    window.setEditorMode('thoughts');
    const ticket = window.navigationToken;
    mainEl.innerHTML = '<div class="empty">选择写过的想法，或直接写一个新的。</div>';
    try {
      await window.refreshThoughtList();
      if (window.editorMode !== 'thoughts' || ticket !== window.navigationToken) return;
      window.editorDirty = false;
    } catch (error) { window.adminNotice(error.message); }
  };
})();
