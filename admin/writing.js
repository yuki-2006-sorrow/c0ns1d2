(() => {
  window.installWritingTabs = () => {
    if (mainEl.querySelector('.writing-tabs')) return;
    const association = document.getElementById('associations-editor');
    if (!association) return;
    const isWork = window.editorMode === 'works';
    const title = mainEl.querySelector(isWork ? '#w-title' : '#f-title');
    const body = mainEl.querySelector(isWork ? '#w-body' : '#f-body');
    const source = isWork ? mainEl.querySelector('#work-form') : mainEl;
    if (!title || !body || !source) return;
    const metadata = document.createElement('details');
    metadata.className = 'editor-metadata';
    const summary = document.createElement('summary');
    summary.textContent = isWork ? '类型、创作者和其他信息' : '时间、人物和其他信息';
    metadata.append(summary);
    const metaFields = isWork ? ['w-kind','w-creator','w-year','w-cover','w-summary'] : ['f-date','f-category','f-persons','f-medium','f-summary'];
    metaFields.forEach(id => { const field = mainEl.querySelector('#' + id)?.closest('.field'); if (field) metadata.append(field); });
    const titleField = title.closest('.field'), bodyField = body.closest('.field');
    source.prepend(titleField,metadata,bodyField);
    source.querySelectorAll('.row').forEach(row => { if (!row.children.length) row.remove(); });
    const bodyPane = document.createElement('section');
    bodyPane.id = 'writing-body'; bodyPane.setAttribute('role','tabpanel');
    const thoughtPane = document.createElement('section');
    thoughtPane.id = 'writing-thoughts'; thoughtPane.setAttribute('role','tabpanel'); thoughtPane.hidden = true;
    const topHeading = mainEl.querySelector('.work-heading');
    [...mainEl.children].filter(child => child !== association && child !== topHeading).forEach(child => bodyPane.append(child));
    thoughtPane.append(association);
    const tabs = document.createElement('nav');
    tabs.className = 'writing-tabs'; tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','写作区域');
    tabs.innerHTML = '<button type="button" role="tab" id="body-tab" aria-controls="writing-body" aria-selected="true">正文</button><button type="button" role="tab" id="thought-tab" aria-controls="writing-thoughts" aria-selected="false">联想</button>';
    const buttons = [...tabs.querySelectorAll('button')];
    bodyPane.setAttribute('aria-labelledby','body-tab'); thoughtPane.setAttribute('aria-labelledby','thought-tab');
    const activate = index => {
      bodyPane.hidden = index !== 0; thoughtPane.hidden = index !== 1;
      buttons.forEach((button,buttonIndex) => { button.setAttribute('aria-selected', String(buttonIndex === index)); button.tabIndex = buttonIndex === index ? 0 : -1; });
    };
    buttons.forEach((button,index) => button.onclick = () => activate(index));
    tabs.onkeydown = event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); const selected = buttons.findIndex(button => button.getAttribute('aria-selected') === 'true');
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - selected; activate(index); buttons[index].focus();
    };
    mainEl.append(tabs,bodyPane,thoughtPane);
    if (topHeading) mainEl.prepend(topHeading);
    window.showThoughts = () => activate(1);
    window.editorDirty = false;
  };
  window.editorReady?.then(async () => {
    const params = new URLSearchParams(location.search);
    const type = params.get('from'), id = params.get('entry'), thought = params.get('thought');
    if (!id || !['event','work'].includes(type)) return;
    if (type === 'event') {
      const entry = events.find(entry => entry.slug === id);
      if (!entry) return;
      await selectEvent(entry.rel);
    } else await window.openWork?.(id);
    if (thought) await window.renderAssociationEditor(type,id,thought);
    else { window.showThoughts?.(); document.getElementById('add-association')?.click(); }
  }).catch(error => window.adminNotice?.(error.message));
})();
